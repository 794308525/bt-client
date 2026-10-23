'use strict';

const path = require('path');
const { BrowserWindow, BrowserView } = require('electron');
const { pub } = require('../class/public.js');

const RETENTION_KEY = 'toolbox_history_retention_days';
const ACTIVE_STATUSES = ['pending', 'running'];
const MIN_LEFT_WIDTH = 320;
const MIN_RIGHT_WIDTH = 430;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_TASK_BODY_BYTES = 50 * 1024 * 1024;

const DEVICE_PROFILES = {
  desktop: {
    key: 'desktop', name: 'PC（桌面浏览器）', width: 1440, height: 900, mobile: false,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  },
  iphone_x: {
    key: 'iphone_x', name: 'iPhone X', width: 375, height: 812, scaleFactor: 3, mobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
  iphone_14: {
    key: 'iphone_14', name: 'iPhone 14', width: 390, height: 844, scaleFactor: 3, mobile: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
  },
  pixel_7: {
    key: 'pixel_7', name: 'Pixel 7（Android Chrome）', width: 412, height: 915, scaleFactor: 2.625, mobile: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  },
};

function now() { return pub.time(); }
function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function toBool(value) { return value === true || value === 1 || value === '1'; }
function withTimeout(promise, timeoutMs, message) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
}
function parseUrl(value, requestedProtocol = 'auto') {
  const input = String(value || '').trim();
  const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
  const protocol = ['auto', 'http', 'https'].includes(String(requestedProtocol)) ? String(requestedProtocol) : 'auto';
  const parse = target => {
    let result;
    try { result = new URL(target); } catch (_) { throw new Error('请输入正确的域名或 HTTP / HTTPS 地址'); }
    if (!['http:', 'https:'].includes(result.protocol)) throw new Error('仅支持 HTTP 和 HTTPS 地址');
    return result;
  };

  if (hasProtocol) return { url: parse(input).toString(), fallbackUrl: '' };
  if (!input) throw new Error('请输入站点 URL');
  if (protocol === 'http') return { url: parse(`http://${input}`).toString(), fallbackUrl: '' };
  if (protocol === 'https') return { url: parse(`https://${input}`).toString(), fallbackUrl: '' };
  return { url: parse(`https://${input}`).toString(), fallbackUrl: parse(`http://${input}`).toString() };
}
function fileType(url, mimeType) {
  let pathname = '';
  try { pathname = new URL(String(url || '')).pathname; } catch (_) { pathname = String(url || '').split(/[?#]/)[0]; }
  const match = pathname.match(/\.([a-z\d]{1,30})$/i);
  if (match) return match[1].toLowerCase();
  const mime = String(mimeType || '').split('/')[1] || '';
  return mime.split(';')[0].slice(0, 30).toLowerCase();
}
function phase(timing, start, end) {
  if (!timing || Number(timing[start]) < 0 || Number(timing[end]) < 0) return 0;
  return Math.max(0, Math.round((Number(timing[end]) - Number(timing[start])) * 100) / 100);
}

class SiteInspector {
  constructor() {
    this.contexts = new Map();
  }

  profiles() { return Object.values(DEVICE_PROFILES).map(({ key, name, width, height, mobile }) => ({ key, name, width, height, mobile })); }
  getRetentionDays() { const value = pub.C(RETENTION_KEY); return value === undefined ? 90 : Math.max(0, Math.floor(number(value, 90))); }
  setRetentionDays(days) { const normalized = Math.max(0, Math.floor(number(days, 90))); pub.C(RETENTION_KEY, normalized); this.cleanupExpired(); return normalized; }

  cleanupExpired() {
    const days = this.getRetentionDays();
    if (!days) return { days, removed: 0 };
    const rows = pub.M('site_check_task').where('created_at<?', now() - days * 86400).field('task_id').select();
    const ids = rows.map(row => Number(row.task_id)).filter(Boolean);
    if (!ids.length) return { days, removed: 0 };
    const marks = ids.map(() => '?').join(',');
    pub.M('site_check_request_detail').where(`task_id IN (${marks})`, ids).delete();
    pub.M('site_check_request').where(`task_id IN (${marks})`, ids).delete();
    pub.M('site_check_task').where(`task_id IN (${marks})`, ids).delete();
    return { days, removed: ids.length };
  }

  recoverInterrupted() {
    const timestamp = now();
    const changed = pub.M('site_check_task').where('status IN (?,?)', ACTIVE_STATUSES).update({ status: 'interrupted', ended_at: timestamp, updated_at: timestamp, last_error: '应用退出导致检测中断' });
    this.cleanupExpired();
    return changed;
  }

  normalizeOptions(input = {}) {
    const target = parseUrl(input.url, input.protocol);
    const profile = DEVICE_PROFILES[String(input.device_key || 'iphone_x')] || DEVICE_PROFILES.iphone_x;
    const timeoutSeconds = Math.max(1, Math.floor(number(input.timeout_seconds, 60)));
    const defaultSplitRatio = profile.mobile ? 0.30 : 0.55;
    const splitRatio = Math.min(0.75, Math.max(0.25, number(input.split_ratio, defaultSplitRatio)));
    return { url: target.url, fallback_url: target.fallbackUrl, profile, timeout_seconds: timeoutSeconds, split_ratio: splitRatio };
  }

  async start(input = {}) {
    const options = this.normalizeOptions(input);
    const timestamp = now();
    const taskId = pub.M('site_check_task').insert({
      input_url: options.url,
      device_key: options.profile.key,
      device_name: options.profile.name,
      profile_json: JSON.stringify(options.profile),
      timeout_seconds: options.timeout_seconds,
      status: 'pending',
      created_at: timestamp,
      updated_at: timestamp,
    });
    if (!taskId) throw new Error('创建站点检测任务失败');
    await this.openTask(Number(taskId), options);
    return this.getTask(taskId);
  }

  inspectorPage(taskId, splitRatio) {
    return `file://${path.join(pub.get_public_path(), 'html', 'site-inspector.html')}?task_id=${taskId}&split_ratio=${encodeURIComponent(splitRatio)}`;
  }

  async openTask(taskId, options) {
    const profile = options.profile;
    const inspectorWindow = new BrowserWindow({
      title: `站点检测 · ${profile.name}`,
      width: 1500,
      height: 900,
      minWidth: 960,
      minHeight: 620,
      show: false,
      webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
    });
    const pageView = new BrowserView({
      webPreferences: {
        partition: `site-check-${taskId}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const context = {
      taskId,
      options,
      inspectorWindow,
      pageView,
      activeRequests: new Map(),
      pendingRecords: [],
      sequence: 0,
      requestCount: 0,
      failedCount: 0,
      transferSize: 0,
      decodedSize: 0,
      startedAtMs: Date.now(),
      cdpOrigin: null,
      loadFinished: false,
      lastActivityMs: Date.now(),
      ending: false,
      flushTimer: null,
      idleTimer: null,
      timeoutTimer: null,
      loadingUrl: '',
      fallbackStarted: false,
      stage: 'opening_window',
      discoveryStarted: false,
      discoveryFinished: false,
      splitRatio: options.split_ratio,
      capturedBodyBytes: 0,
      pendingBodyCaptures: new Set(),
      requestExtraHeaders: new Map(),
      responseExtraHeaders: new Map(),
      finishStatus: '',
      finishError: '',
    };
    this.contexts.set(taskId, context);
    pub.M('site_check_task').where('task_id=?', taskId).update({ status: 'running', started_at: now(), updated_at: now() });

    this.bindWindow(context);
    inspectorWindow.webContents.on('did-finish-load', () => this.resizeView(context));
    inspectorWindow.addBrowserView(pageView);
    this.resizeView(context);
    pageView.webContents.setUserAgent(profile.userAgent);
    await inspectorWindow.loadURL(this.inspectorPage(taskId, options.split_ratio));
    if (!inspectorWindow.isDestroyed()) {
      inspectorWindow.show();
      this.scheduleResize(context, true);
    }

    try {
      // 每个任务使用唯一的内存 session，本身就是全新的缓存和 Cookie 环境。
      // Electron 21 在全新 session 上清理存储偶尔会一直不返回，导致页面导航永远不执行。
      context.stage = 'initializing_view';
      this.emit(context, { type: 'stage', stage: context.stage });
      // BrowserView 尚未导航时没有可用的 renderer，直接发送 CDP 命令会一直等待。
      await withTimeout(pageView.webContents.loadURL('about:blank'), 5000, '页面视图初始化超时');
      context.stage = 'preparing_capture';
      this.emit(context, { type: 'stage', stage: context.stage });
      await withTimeout(this.enableDebugger(context), 5000, '网络采集器启动超时');
    } catch (error) {
      this.finish(context, 'failed', String(error && error.message || error));
      throw error;
    }
    context.idleTimer = setInterval(() => this.checkCompletion(context), 500);
    context.timeoutTimer = setTimeout(() => this.finish(context, 'completed'), options.timeout_seconds * 1000);
    context.stage = 'loading_page';
    this.loadPage(context, options.url);
  }

  loadPage(context, url) {
    context.loadingUrl = url;
    context.loadFinished = false;
    context.discoveryStarted = false;
    context.discoveryFinished = false;
    context.stage = context.fallbackStarted ? 'loading_http_fallback' : 'loading_page';
    this.emit(context, { type: 'stage', stage: context.stage, url });
    let loading;
    try { loading = context.pageView.webContents.loadURL(url); }
    catch (error) {
      if (this.startHttpFallback(context, url)) return;
      this.finish(context, 'failed', String(error && error.message || error));
      return;
    }
    loading.catch(error => {
      if (context.ending || context.loadingUrl !== url) return;
      if (this.startHttpFallback(context, url)) return;
      this.finish(context, 'failed', String(error && error.message || error));
    });
  }

  startHttpFallback(context, failedUrl) {
    const fallbackUrl = context.options.fallback_url;
    if (!fallbackUrl || context.fallbackStarted || failedUrl !== context.options.url) return false;
    context.fallbackStarted = true;
    context.options.url = fallbackUrl;
    pub.M('site_check_task').where('task_id=?', context.taskId).update({ input_url: fallbackUrl, updated_at: now() });
    this.emit(context, { type: 'protocol_fallback', message: 'HTTPS 无法打开，已自动尝试 HTTP' });
    this.loadPage(context, fallbackUrl);
    return true;
  }

  bindWindow(context) {
    const { inspectorWindow, pageView } = context;
    inspectorWindow.on('resize', () => this.scheduleResize(context));
    inspectorWindow.on('maximize', () => this.scheduleResize(context, true));
    inspectorWindow.on('unmaximize', () => this.scheduleResize(context, true));
    inspectorWindow.on('closed', () => {
      if (!context.completed) this.finish(context, 'stopped', '检测窗口已关闭');
      this.contexts.delete(context.taskId);
    });
    pageView.webContents.on('did-finish-load', async () => {
      const currentUrl = pageView.webContents.getURL();
      if (!context.loadingUrl || currentUrl === 'about:blank') return;
      // 主文档解析 viewport meta 后再锁定一次设备指标。只在 about:blank 阶段
      // 设置会暂时得到 Chromium 默认的 980px 移动布局视口。
      const bounds = pageView.getBounds();
      try { await this.applyDeviceMetrics(context, bounds.width, bounds.height); } catch (_) {}
      if (context.ending) return;
      context.loadFinished = true;
      context.lastActivityMs = Date.now();
      context.stage = 'discovering_page';
      this.persistTask(context);
      this.emit(context, { type: 'page_loaded', stage: context.stage });
      this.discoverFullPage(context);
    });
    pageView.webContents.on('dom-ready', () => {
      const elapsed = Date.now() - context.startedAtMs;
      pub.M('site_check_task').where('task_id=?', context.taskId).update({ dom_content_loaded_ms: elapsed, updated_at: now() });
    });
    pageView.webContents.on('did-navigate', (_, url) => {
      pub.M('site_check_task').where('task_id=?', context.taskId).update({ final_url: url, updated_at: now() });
    });
    pageView.webContents.on('did-fail-load', (_, code, description, url, isMainFrame) => {
      if (!isMainFrame || description === 'ERR_ABORTED') return;
      if (this.startHttpFallback(context, url) || context.loadingUrl !== url) return;
      this.finish(context, 'failed', `${description || '页面加载失败'} (${code})`);
    });
  }

  scheduleResize(context, immediate = false) {
    if (!context || !context.inspectorWindow || context.inspectorWindow.isDestroyed()) return;
    if (context.resizeTimer) clearTimeout(context.resizeTimer);
    if (immediate) this.resizeView(context);
    context.resizeTimer = setTimeout(() => {
      context.resizeTimer = null;
      this.resizeView(context);
    }, 80);
  }

  resizeView(context) {
    const { inspectorWindow, pageView } = context;
    if (!inspectorWindow || inspectorWindow.isDestroyed() || !pageView || pageView.webContents.isDestroyed()) return;
    const [width, height] = inspectorWindow.getContentSize();
    const windowBounds = inspectorWindow.getBounds();
    const contentBounds = inspectorWindow.getContentBounds();
    // BrowserView 的坐标基于原生窗口，而 webContents 从内容区开始渲染。
    // macOS 标题栏约占 28px；若仍从 y=0 放置，网页顶部会被标题栏覆盖，
    // 同时底部会空出同样高度。使用实际内容区偏移可兼容窗口缩放和全屏。
    const contentTop = Math.max(0, Math.round(contentBounds.y - windowBounds.y));
    const availableWidth = Math.max(MIN_LEFT_WIDTH + MIN_RIGHT_WIDTH, Math.floor(width));
    const requestedLeft = Math.round(availableWidth * Number(context.splitRatio || 0.52));
    const leftWidth = Math.min(availableWidth - MIN_RIGHT_WIDTH, Math.max(MIN_LEFT_WIDTH, requestedLeft));
    const actualRatio = leftWidth / availableWidth;
    const viewportWidth = Math.max(1, Math.round(number(context.options.profile.width, leftWidth)));
    const viewportHeight = Math.max(1, Math.round(number(context.options.profile.height, height)));
    const displayScale = Math.max(0.1, Math.min(1, Math.min(leftWidth / viewportWidth, height / viewportHeight)));
    const deviceViewWidth = Math.max(1, Math.round(viewportWidth * displayScale));
    const deviceViewHeight = Math.max(1, Math.round(viewportHeight * displayScale));
    const deviceViewX = Math.max(0, Math.floor((leftWidth - deviceViewWidth) / 2));
    const deviceViewY = contentTop + Math.max(0, Math.floor((height - deviceViewHeight) / 2));
    context.actualSplitRatio = actualRatio;
    context.deviceDisplayScale = displayScale;
    pageView.setBounds({ x: deviceViewX, y: deviceViewY, width: deviceViewWidth, height: deviceViewHeight });
    if (!context.viewDetachedForDrag) this.applyDeviceMetrics(context, deviceViewWidth, deviceViewHeight).catch(() => {});
    const win = inspectorWindow;
    if (win.webContents && !win.webContents.isDestroyed()) {
      win.webContents.send(`site-check:layout:${context.taskId}`, {
        task_id: context.taskId,
        split_ratio: actualRatio,
        left_width: leftWidth,
        right_width: availableWidth - leftWidth,
        viewport_width: viewportWidth,
        viewport_height: viewportHeight,
        display_scale: displayScale,
      });
    }
  }

  async applyDeviceMetrics(context, viewWidth, viewHeight) {
    const { pageView, options } = context;
    if (!pageView || pageView.webContents.isDestroyed() || !pageView.webContents.debugger.isAttached()) return;
    const bounds = pageView.getBounds();
    const displayWidth = Math.max(1, Math.round(number(viewWidth, bounds.width)));
    const displayHeight = Math.max(1, Math.round(number(viewHeight, bounds.height)));
    const viewportWidth = Math.max(1, Math.round(number(options.profile.width, displayWidth)));
    const viewportHeight = Math.max(1, Math.round(number(options.profile.height, displayHeight)));
    // 设备视口始终使用配置中的固定 CSS 尺寸；外层窗口只改变画面的显示缩放，
    // 不能反过来改变 window.innerWidth / innerHeight 和响应式断点。
    const displayScale = Math.max(0.1, Math.min(2, Math.min(displayWidth / viewportWidth, displayHeight / viewportHeight)));
    await pageView.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      screenWidth: viewportWidth,
      screenHeight: viewportHeight,
      deviceScaleFactor: options.profile.scaleFactor || 1,
      mobile: Boolean(options.profile.mobile),
      scale: displayScale,
      screenOrientation: viewportWidth > viewportHeight
        ? { type: 'landscapePrimary', angle: 90 }
        : { type: 'portraitPrimary', angle: 0 },
    });
    await pageView.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: Boolean(options.profile.mobile) });
    try {
      const metrics = await pageView.webContents.executeJavaScript(`({
        inner_width: window.innerWidth,
        inner_height: window.innerHeight,
        screen_width: window.screen.width,
        screen_height: window.screen.height,
        device_pixel_ratio: window.devicePixelRatio
      })`, true);
      context.viewportMetrics = {
        inner_width: Math.round(number(metrics && metrics.inner_width)),
        inner_height: Math.round(number(metrics && metrics.inner_height)),
        screen_width: Math.round(number(metrics && metrics.screen_width)),
        screen_height: Math.round(number(metrics && metrics.screen_height)),
        device_pixel_ratio: number(metrics && metrics.device_pixel_ratio, 1),
        display_scale: displayScale,
      };
      this.emit(context, { type: 'viewport_metrics', metrics: context.viewportMetrics });
    } catch (_) {}
  }

  setLayout(taskId, splitRatio, dragging = false) {
    const context = this.contexts.get(Number(taskId));
    if (!context) throw new Error('站点检测任务不存在或已结束');
    const requested = number(splitRatio, context.splitRatio || 0.52);
    context.splitRatio = Math.min(0.75, Math.max(0.25, requested));
    const shouldDetach = toBool(dragging);
    if (shouldDetach && !context.viewDetachedForDrag) {
      try { context.inspectorWindow.removeBrowserView(context.pageView); } catch (_) {}
      context.viewDetachedForDrag = true;
    } else if (!shouldDetach && context.viewDetachedForDrag) {
      try { context.inspectorWindow.addBrowserView(context.pageView); } catch (_) {}
      context.viewDetachedForDrag = false;
    }
    this.resizeView(context);
    return { task_id: context.taskId, split_ratio: context.actualSplitRatio, requested_ratio: context.splitRatio };
  }

  async enableDebugger(context) {
    const { pageView, options } = context;
    const debuggerClient = pageView.webContents.debugger;
    if (!debuggerClient.isAttached()) debuggerClient.attach('1.3');
    debuggerClient.on('message', (_event, method, params) => this.handleNetworkEvent(context, method, params));
    await debuggerClient.sendCommand('Network.enable', {
      maxTotalBufferSize: MAX_TASK_BODY_BYTES,
      maxResourceBufferSize: MAX_BODY_BYTES,
      maxPostDataSize: MAX_BODY_BYTES,
    });
    await this.applyDeviceMetrics(context);
  }

  async discoverFullPage(context) {
    if (context.ending || context.discoveryStarted) return;
    context.discoveryStarted = true;
    context.stage = 'discovering_page';
    this.emit(context, { type: 'stage', stage: context.stage });
    const script = `new Promise(resolve => {
      const startedAt = Date.now();
      let stableBottomCount = 0;
      let lastHeight = 0;
      const tick = () => {
        const root = document.scrollingElement || document.documentElement;
        const height = Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0);
        const viewport = Math.max(window.innerHeight || 0, 320);
        const bottom = root.scrollTop + viewport >= height - 4;
        if (bottom && height === lastHeight) stableBottomCount += 1;
        else stableBottomCount = 0;
        lastHeight = height;
        if (stableBottomCount >= 3 || Date.now() - startedAt >= 15000) {
          root.scrollTop = 0;
          window.scrollTo(0, 0);
          setTimeout(resolve, 500);
          return;
        }
        root.scrollTop = Math.min(height, root.scrollTop + Math.max(320, Math.floor(viewport * 0.8)));
        window.scrollTo(0, root.scrollTop);
        setTimeout(tick, 250);
      };
      setTimeout(tick, 300);
    })`;
    try {
      await withTimeout(context.pageView.webContents.executeJavaScript(script, true), 20000, '整页资源遍历超时');
    } catch (_) {
      // 页面禁止脚本滚动时仍保留已经采集到的请求，继续进入网络空闲判断。
    }
    if (context.ending) return;
    context.discoveryFinished = true;
    context.lastActivityMs = Date.now();
    context.stage = 'waiting_network_idle';
    this.persistTask(context);
    this.emit(context, { type: 'stage', stage: context.stage });
  }

  handleNetworkEvent(context, method, params = {}) {
    if (context.ending) return;
    if (!method.startsWith('Network.')) return;
    if (method === 'Network.requestWillBeSent') return this.onRequest(context, params);
    if (method === 'Network.requestWillBeSentExtraInfo') return this.onRequestExtraInfo(context, params);
    if (method === 'Network.responseReceived') return this.onResponse(context, params);
    if (method === 'Network.responseReceivedExtraInfo') return this.onResponseExtraInfo(context, params);
    if (method === 'Network.dataReceived') return this.onDataReceived(context, params);
    if (method === 'Network.loadingFinished') return this.onFinished(context, params);
    if (method === 'Network.loadingFailed') return this.onFailed(context, params);
    if (method === 'Network.webSocketCreated') return this.onWebSocketCreated(context, params);
    if (method === 'Network.webSocketWillSendHandshakeRequest') return this.onWebSocketHandshake(context, params);
    if (method === 'Network.webSocketHandshakeResponseReceived') return this.onWebSocketResponse(context, params);
    if (method === 'Network.webSocketClosed') return this.onWebSocketClosed(context, params);
  }

  onRequest(context, params) {
    context.lastActivityMs = Date.now();
    const existing = context.activeRequests.get(params.requestId);
    if (existing && params.redirectResponse) {
      this.applyResponse(existing, params.redirectResponse);
      this.finalizeRecord(context, existing, { timestamp: params.timestamp });
    }
    if (context.cdpOrigin === null) context.cdpOrigin = Number(params.timestamp) || 0;
    const startOffset = Math.max(0, Math.round(((Number(params.timestamp) || context.cdpOrigin) - context.cdpOrigin) * 1000 * 100) / 100);
    let hostname = '';
    try { hostname = new URL(params.request && params.request.url || '').hostname; } catch (_) {}
    const redirectIndex = existing ? Number(existing.redirect_index || 0) + 1 : 0;
    const requestHeaders = { ...(params.request && params.request.headers || {}), ...(context.requestExtraHeaders.get(params.requestId) || {}) };
    context.requestExtraHeaders.delete(params.requestId);
    const rawRequestBody = String(params.request && params.request.postData || '');
    const requestBodySize = Buffer.byteLength(rawRequestBody, 'utf8');
    const requestBodyAllowed = requestBodySize <= MAX_BODY_BYTES && context.capturedBodyBytes + requestBodySize <= MAX_TASK_BODY_BYTES;
    if (rawRequestBody && requestBodyAllowed) context.capturedBodyBytes += requestBodySize;
    const record = {
      task_id: context.taskId,
      request_key: String(params.requestId || ''),
      redirect_index: redirectIndex,
      sequence: ++context.sequence,
      url: String(params.request && params.request.url || ''),
      host: hostname,
      method: String(params.request && params.request.method || 'GET'),
      resource_type: String(params.type || 'Other'),
      mime_type: '',
      file_type: '',
      status_code: 0,
      protocol: '',
      remote_ip: '',
      from_cache: 0,
      start_offset_ms: startOffset,
      duration_ms: 0,
      dns_ms: 0,
      connect_ms: 0,
      ssl_ms: 0,
      ttfb_ms: 0,
      download_ms: 0,
      transfer_size: 0,
      decoded_size: 0,
      priority: String(params.request && params.request.initialPriority || ''),
      initiator: String(params.initiator && params.initiator.type || ''),
      error_text: '',
      created_at: now(),
      _timestamp: Number(params.timestamp) || 0,
      _decoded_size: 0,
      _response_received: false,
      _request_detail: {
        request_headers: JSON.stringify(requestHeaders),
        request_body: rawRequestBody && requestBodyAllowed ? rawRequestBody : '',
        request_body_base64: 0,
        request_body_status: !rawRequestBody && params.request && params.request.hasPostData ? 'pending' : !rawRequestBody ? 'none' : requestBodySize > MAX_BODY_BYTES ? 'too_large' : !requestBodyAllowed ? 'task_limit' : 'captured',
      },
      _has_post_data: Boolean(params.request && params.request.hasPostData),
      _done: false,
    };
    context.activeRequests.set(params.requestId, record);
  }

  onResponse(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) return;
    this.applyResponse(record, params.response || {});
    record._response_timestamp = Number(params.timestamp) || 0;
    record._response_received = true;
    record._request_detail = record._request_detail || {};
    const responseHeaders = { ...(params.response && params.response.headers || {}), ...(context.responseExtraHeaders.get(params.requestId) || {}) };
    context.responseExtraHeaders.delete(params.requestId);
    record._request_detail.response_headers = JSON.stringify(responseHeaders);
    record._request_detail.timing_json = JSON.stringify(params.response && params.response.timing || {});
    record._request_detail.security_json = JSON.stringify(params.response && params.response.securityDetails || {});
    record._request_detail.response_mime_type = String(params.response && params.response.mimeType || '');
  }

  onRequestExtraInfo(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) {
      context.requestExtraHeaders.set(params.requestId, params.headers || {});
      return;
    }
    const detail = record._request_detail || (record._request_detail = {});
    let headers = {};
    try { headers = JSON.parse(detail.request_headers || '{}'); } catch (_) {}
    detail.request_headers = JSON.stringify({ ...headers, ...(params.headers || {}) });
  }

  onResponseExtraInfo(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) {
      context.responseExtraHeaders.set(params.requestId, params.headers || {});
      return;
    }
    const detail = record._request_detail || (record._request_detail = {});
    let headers = {};
    try { headers = JSON.parse(detail.response_headers || '{}'); } catch (_) {}
    detail.response_headers = JSON.stringify({ ...headers, ...(params.headers || {}) });
  }

  applyResponse(record, response = {}) {
    record.mime_type = String(response.mimeType || '');
    record.file_type = fileType(record.url, record.mime_type);
    record.status_code = Number(response.status) || 0;
    record.protocol = String(response.protocol || '');
    record.remote_ip = String(response.remoteIPAddress || '');
    record.from_cache = toBool(response.fromDiskCache) || toBool(response.fromServiceWorker) || toBool(response.fromPrefetchCache) ? 1 : 0;
    record._timing = response.timing || null;
  }

  onDataReceived(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) return;
    record._decoded_size = Math.max(0, number(record._decoded_size) + number(params.dataLength));
  }

  onFinished(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) return;
    const finish = () => {
      this.finalizeRecord(context, record, { timestamp: params.timestamp, encodedDataLength: params.encodedDataLength });
      context.activeRequests.delete(params.requestId);
      this.maybeCompleteFinish(context);
    };
    record._body_capture_pending = true;
    const capture = this.captureRequestAndResponse(context, record, params);
    if (!capture) return finish();
    context.pendingBodyCaptures.add(capture);
    capture.catch(() => {}).finally(() => {
      context.pendingBodyCaptures.delete(capture);
      record._body_capture_pending = false;
      finish();
    });
  }

  async captureRequestAndResponse(context, record, params) {
    await this.captureRequestBody(context, record);
    if (!context.discardResults) await this.captureResponseBody(context, record, params);
  }

  async captureRequestBody(context, record) {
    const detail = record._request_detail || (record._request_detail = {});
    if (detail.request_body_status !== 'pending' || !record._has_post_data) return;
    try {
      const result = await withTimeout(context.pageView.webContents.debugger.sendCommand('Network.getRequestPostData', { requestId: record.request_key }), 5000, '读取请求正文超时');
      const body = String(result && result.postData || '');
      const bodySize = Buffer.byteLength(body, 'utf8');
      if (bodySize > MAX_BODY_BYTES) detail.request_body_status = 'too_large';
      else if (context.capturedBodyBytes + bodySize > MAX_TASK_BODY_BYTES) detail.request_body_status = 'task_limit';
      else {
        context.capturedBodyBytes += bodySize;
        detail.request_body = body;
        detail.request_body_status = body ? 'captured' : 'none';
      }
    } catch (error) {
      detail.request_body_status = `unavailable: ${String(error && error.message || error || '读取请求正文失败')}`;
    }
  }

  async captureResponseBody(context, record, params) {
    const detail = record._request_detail || (record._request_detail = {});
    detail.response_headers = detail.response_headers || '{}';
    detail.response_body = '';
    detail.response_body_base64 = 0;
    detail.response_body_size = 0;
    detail.response_body_status = 'none';
    detail.capture_status = 'unavailable';
    detail.capture_error = '';
    detail.status_code = Number(record.status_code) || 0;
    detail.encoded_size = Math.max(0, Math.round(number(params.encodedDataLength, 0)));
    detail.decoded_size = Math.max(0, Math.round(number(record._decoded_size, detail.encoded_size)));
    detail.response_mime_type = detail.response_mime_type || record.mime_type || '';
    detail.timing_json = detail.timing_json || JSON.stringify(record._timing || {});
    detail.security_json = detail.security_json || '{}';
    if (!record._response_received || !context.pageView || context.pageView.webContents.isDestroyed()) {
      detail.capture_status = 'unavailable';
      detail.capture_error = '响应正文不可用';
      return null;
    }
    // 已知编码长度超限时不请求正文，避免把大响应读入主进程。
    if (detail.encoded_size > MAX_BODY_BYTES) {
      detail.capture_status = 'too_large';
      detail.capture_error = '响应正文超过 5MB 保存限制';
      return null;
    }
    if (context.capturedBodyBytes >= MAX_TASK_BODY_BYTES) {
      detail.capture_status = 'task_limit';
      detail.capture_error = '任务正文累计超过 50MB 保存限制';
      return null;
    }
    let result;
    try {
      result = await withTimeout(context.pageView.webContents.debugger.sendCommand('Network.getResponseBody', { requestId: record.request_key }), 5000, '读取响应正文超时');
    } catch (error) {
      detail.capture_status = 'unavailable';
      detail.capture_error = String(error && error.message || error || '读取响应正文失败');
      return null;
    }
    const encoded = result && result.base64Encoded === true;
    const body = String(result && result.body || '');
    const bodySize = encoded ? Buffer.byteLength(body, 'base64') : Buffer.byteLength(body, 'utf8');
    detail.response_body_size = bodySize;
    if (bodySize > MAX_BODY_BYTES) {
      detail.capture_status = 'too_large';
      detail.capture_error = '响应正文超过 5MB 保存限制';
      return null;
    }
    if (context.capturedBodyBytes + bodySize > MAX_TASK_BODY_BYTES) {
      detail.capture_status = 'task_limit';
      detail.capture_error = '任务正文累计超过 50MB 保存限制';
      return null;
    }
    // CDP 对无法转义的二进制响应可能返回非 base64 字符串；不把它误标为文本正文。
    if (!encoded && detail.response_mime_type && !/^(?:text\/|application\/(?:json|javascript|xml|x-www-form-urlencoded|graphql)|image\/svg\+xml)/i.test(detail.response_mime_type)) {
      detail.capture_status = 'binary_unavailable';
      detail.capture_error = '二进制正文未提供 base64 编码';
      detail.response_body_status = 'unavailable';
      return null;
    }
    context.capturedBodyBytes += bodySize;
    detail.response_body = body;
    detail.response_body_base64 = encoded ? 1 : 0;
    detail.response_body_status = encoded ? 'captured_base64' : 'captured';
    detail.capture_status = encoded ? 'captured_base64' : 'captured';
    return null;
  }

  onFailed(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) return;
    this.finalizeRecord(context, record, { timestamp: params.timestamp, errorText: params.errorText || '请求失败' });
    context.activeRequests.delete(params.requestId);
  }

  onWebSocketCreated(context, params) {
    if (context.activeRequests.has(params.requestId)) return;
    context.lastActivityMs = Date.now();
    if (context.cdpOrigin === null) context.cdpOrigin = Number(params.timestamp) || 0;
    let hostname = '';
    try { hostname = new URL(params.url || '').hostname; } catch (_) {}
    context.activeRequests.set(params.requestId, {
      task_id: context.taskId,
      request_key: String(params.requestId || ''),
      redirect_index: 0,
      sequence: ++context.sequence,
      url: String(params.url || ''),
      host: hostname,
      method: 'GET',
      resource_type: 'WebSocket',
      mime_type: '',
      file_type: 'websocket',
      status_code: 0,
      protocol: 'websocket',
      remote_ip: '',
      from_cache: 0,
      start_offset_ms: 0,
      duration_ms: 0,
      dns_ms: 0,
      connect_ms: 0,
      ssl_ms: 0,
      ttfb_ms: 0,
      download_ms: 0,
      transfer_size: 0,
      decoded_size: 0,
      priority: '',
      initiator: String(params.initiator && params.initiator.type || ''),
      error_text: '',
      created_at: now(),
      _timestamp: Number(params.timestamp) || context.cdpOrigin,
      _request_detail: {
        request_headers: '{}',
        request_body: '',
        request_body_base64: 0,
        request_body_status: 'none',
      },
      _done: false,
    });
  }

  onWebSocketHandshake(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) return;
    if (context.cdpOrigin === null) context.cdpOrigin = Number(params.timestamp) || 0;
    record._timestamp = Number(params.timestamp) || record._timestamp;
    record.start_offset_ms = Math.max(0, Math.round((record._timestamp - context.cdpOrigin) * 1000 * 100) / 100);
  }

  onWebSocketResponse(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) return;
    const response = params.response || {};
    record.status_code = Number(response.status) || 101;
    record._response_timestamp = Number(params.timestamp) || record._timestamp;
    record._request_detail = record._request_detail || {};
    record._request_detail.response_headers = JSON.stringify(response.headers || {});
    record._request_detail.response_body_status = 'not_applicable';
    record._request_detail.capture_status = 'not_applicable';
    record._request_detail.timing_json = '{}';
    record._request_detail.security_json = '{}';
  }

  onWebSocketClosed(context, params) {
    const record = context.activeRequests.get(params.requestId);
    if (!record) return;
    this.finalizeRecord(context, record, { timestamp: params.timestamp });
    context.activeRequests.delete(params.requestId);
  }

  finalizeRecord(context, record, data = {}) {
    if (context.discardResults || !record || record._done) return;
    record._done = true;
    const endedAt = Number(data.timestamp) || record._response_timestamp || record._timestamp;
    record.duration_ms = Math.max(0, Math.round((endedAt - record._timestamp) * 1000 * 100) / 100);
    const timing = record._timing;
    record.dns_ms = phase(timing, 'dnsStart', 'dnsEnd');
    record.connect_ms = phase(timing, 'connectStart', 'connectEnd');
    record.ssl_ms = phase(timing, 'sslStart', 'sslEnd');
    record.ttfb_ms = timing && Number(timing.receiveHeadersEnd) >= 0 ? Math.max(0, Math.round(Number(timing.receiveHeadersEnd) * 100) / 100) : 0;
    record.download_ms = Math.max(0, Math.round((record.duration_ms - record.ttfb_ms) * 100) / 100);
    record.transfer_size = Math.max(0, Math.round(number(data.encodedDataLength, 0)));
    record.decoded_size = Math.max(0, Math.round(number(record._decoded_size, record.transfer_size)));
    record.error_text = String(data.errorText || '');
    delete record._timestamp;
    delete record._response_timestamp;
    delete record._timing;
    delete record._decoded_size;
    const requestDetail = record._request_detail;
    if (requestDetail && requestDetail.request_body_status === 'pending') requestDetail.request_body_status = 'unavailable: 请求未完成，未取得发包正文';
    if (requestDetail && !requestDetail.response_body_status) requestDetail.response_body_status = 'unavailable';
    delete record._request_detail;
    delete record._response_received;
    delete record._has_post_data;
    delete record._body_capture_pending;
    delete record._done;
    context.requestCount += 1;
    if (record.error_text || record.status_code !== 200) context.failedCount += 1;
    context.transferSize += record.transfer_size;
    context.decodedSize += record.decoded_size;
    if (requestDetail) context.pendingDetails = context.pendingDetails || new Map();
    if (requestDetail) context.pendingDetails.set(record.sequence, {
      ...requestDetail,
      task_id: context.taskId,
      status_code: Number(record.status_code) || 0,
      encoded_size: record.transfer_size,
      decoded_size: record.decoded_size,
      response_mime_type: requestDetail.response_mime_type || record.mime_type || '',
      timing_json: requestDetail.timing_json || '{}',
      security_json: requestDetail.security_json || '{}',
      created_at: now(),
    });
    context.pendingRecords.push(record);
    context.lastActivityMs = Date.now();
    if (!context.flushTimer) context.flushTimer = setTimeout(() => this.flushRecords(context), 250);
    this.emit(context, { type: 'request', request: record });
  }

  flushRecords(context) {
    if (!context) return;
    if (context.flushTimer) clearTimeout(context.flushTimer);
    context.flushTimer = null;
    const records = context.pendingRecords.splice(0);
    if (context.discardResults) {
      if (context.pendingDetails) context.pendingDetails.clear();
      return;
    }
    records.forEach(record => {
      const detail = context.pendingDetails && context.pendingDetails.get(record.sequence);
      const requestId = pub.M('site_check_request').insert(record);
      if (detail) {
        context.pendingDetails.delete(record.sequence);
        pub.M('site_check_request_detail').insert({ ...detail, request_id: Number(requestId) });
      }
    });
    if (records.length) this.persistTask(context);
  }

  checkCompletion(context) {
    if (context.ending || !context.loadFinished || !context.discoveryFinished) return;
    if (context.activeRequests.size === 0 && Date.now() - context.lastActivityMs >= 3000) this.finish(context, 'completed');
  }

  persistTask(context, status, errorText = '') {
    if (context.discardResults) return;
    pub.M('site_check_task').where('task_id=?', context.taskId).update({
      ...(status ? { status, ended_at: now() } : {}),
      request_count: context.requestCount,
      failed_count: context.failedCount,
      total_transfer_size: context.transferSize,
      total_decoded_size: context.decodedSize,
      load_ms: context.loadFinished ? Date.now() - context.startedAtMs : 0,
      last_error: errorText || '',
      updated_at: now(),
    });
  }

  finish(context, status = 'stopped', errorText = '') {
    if (!context || context.ending) return;
    context.ending = true;
    context.finishStatus = status;
    context.finishError = errorText;
    if (context.idleTimer) clearInterval(context.idleTimer);
    if (context.timeoutTimer) clearTimeout(context.timeoutTimer);
    if (context.resizeTimer) clearTimeout(context.resizeTimer);
    context.activeRequests.forEach(record => {
      // loadingFinished 触发的正文抓取未完成时，保留记录直到 capture finally，确保完成事件不早于详情落库。
      if (context.pendingBodyCaptures.size && record._body_capture_pending) return;
      this.finalizeRecord(context, record, { timestamp: record._response_timestamp || record._timestamp, errorText: record.error_text || (status === 'completed' ? '' : errorText || '检测已停止') });
      context.activeRequests.delete(record.request_key);
    });
    this.completeFinish(context);
  }

  maybeCompleteFinish(context) {
    if (context && context.ending && context.pendingBodyCaptures.size === 0) this.completeFinish(context);
  }

  completeFinish(context) {
    if (!context || context.completed) return;
    // A late loadingFinished can add a capture after finish() started; wait for it.
    if (context.pendingBodyCaptures && context.pendingBodyCaptures.size) return;
    context.completed = true;
    context.stage = context.finishStatus || 'stopped';
    context.activeRequests.forEach(record => {
      this.finalizeRecord(context, record, {
        timestamp: record._response_timestamp || record._timestamp,
        errorText: record.error_text || (context.finishStatus === 'completed' ? '' : context.finishError || '检测已停止'),
      });
    });
    context.activeRequests.clear();
    this.flushRecords(context);
    const webContents = context.pageView && context.pageView.webContents;
    // 完成后的检测窗口仍允许缩放。保留 CDP 设备模拟，窗口尺寸变化时只更新
    // 展示比例；非正常结束的窗口会立即销毁，无需继续保留调试连接。
    try {
      if (context.finishStatus !== 'completed' && webContents && !webContents.isDestroyed() && webContents.debugger.isAttached()) webContents.debugger.detach();
    } catch (_) {}
    this.persistTask(context, context.finishStatus || 'stopped', context.finishError || '');
    this.emit(context, { type: 'finished', status: context.finishStatus || 'stopped', error: context.finishError || '', summary: this.summary(context) });
    if (context.finishStatus !== 'completed') this.contexts.delete(context.taskId);
    if (context.finishStatus !== 'completed' && context.inspectorWindow && !context.inspectorWindow.isDestroyed()) {
      try { context.inspectorWindow.removeBrowserView(context.pageView); } catch (_) {}
      try { if (webContents && !webContents.isDestroyed()) webContents.destroy(); } catch (_) {}
    }
  }

  summary(context) {
    return { request_count: context.requestCount, failed_count: context.failedCount, total_transfer_size: context.transferSize, total_decoded_size: context.decodedSize };
  }

  emit(context, payload) {
    const win = context.inspectorWindow;
    if (win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) win.webContents.send(`site-check:update:${context.taskId}`, payload);
  }

  getTask(taskId) {
    const task = pub.M('site_check_task').where('task_id=?', Number(taskId)).find();
    if (!task) throw new Error('站点检测任务不存在');
    const context = this.contexts.get(Number(taskId));
    if (context) task.runtime = {
      active_requests: context.activeRequests.size,
      stage: context.stage,
      loading_url: context.loadingUrl,
      current_url: context.pageView && !context.pageView.webContents.isDestroyed() ? context.pageView.webContents.getURL() : '',
      is_loading: context.pageView && !context.pageView.webContents.isDestroyed() ? context.pageView.webContents.isLoading() : false,
      debugger_attached: context.pageView && !context.pageView.webContents.isDestroyed() ? context.pageView.webContents.debugger.isAttached() : false,
      discovery_finished: context.discoveryFinished,
      viewport_metrics: context.viewportMetrics || null,
      ...this.summary(context),
    };
    return task;
  }

  getLive(taskId) {
    const task = this.getTask(taskId);
    const context = this.contexts.get(Number(taskId));
    const requests = pub.M('site_check_request').where('task_id=?', Number(taskId)).order('sequence ASC').select();
    return { task, requests: context ? requests.concat(context.pendingRecords) : requests };
  }

  listTasks(options = {}) {
    const page = Math.max(1, Math.floor(number(options.page, 1)));
    const pageSize = Math.min(100, Math.max(1, Math.floor(number(options.page_size, 20))));
    const where = [];
    const params = [];
    const keyword = String(options.keyword || '').trim();
    if (keyword) { where.push('(input_url LIKE ? OR final_url LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
    if (options.status && options.status !== 'all') { where.push('status=?'); params.push(String(options.status)); }
    if (options.device_key && options.device_key !== 'all') { where.push('device_key=?'); params.push(String(options.device_key)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortMap = { created_at: 'created_at', started_at: 'started_at', load_ms: 'load_ms', request_count: 'request_count', total_transfer_size: 'total_transfer_size' };
    const sort = sortMap[String(options.sort_by || '')] || 'created_at';
    const direction = String(options.sort_order || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const total = pub.M('site_check_task').query(`SELECT COUNT(*) AS total FROM site_check_task ${whereSql}`, params)[0].total;
    const data = pub.M('site_check_task').query(`SELECT * FROM site_check_task ${whereSql} ORDER BY ${sort} ${direction}, task_id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, (page - 1) * pageSize]));
    return { data, total: Number(total) || 0, page, page_size: pageSize };
  }

  listRequests(options = {}) {
    const taskId = Number(options.task_id);
    if (!taskId) throw new Error('检测任务不存在');
    const page = Math.max(1, Math.floor(number(options.page, 1)));
    const pageSize = Math.min(200, Math.max(1, Math.floor(number(options.page_size, 50))));
    const where = ['task_id=?'];
    const params = [taskId];
    const keyword = String(options.keyword || '').trim();
    if (keyword) { where.push('(url LIKE ? OR host LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
    if (options.resource_type && options.resource_type !== 'all') { where.push('resource_type=?'); params.push(String(options.resource_type)); }
    if (options.status_code) { where.push('status_code=?'); params.push(Math.floor(number(options.status_code))); }
    if (options.min_duration_ms !== undefined && options.min_duration_ms !== '') { where.push('duration_ms>=?'); params.push(number(options.min_duration_ms)); }
    if (options.min_transfer_size !== undefined && options.min_transfer_size !== '') { where.push('transfer_size>=?'); params.push(number(options.min_transfer_size)); }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const sortMap = { sequence: 'sequence', start_offset_ms: 'start_offset_ms', duration_ms: 'duration_ms', transfer_size: 'transfer_size', decoded_size: 'decoded_size', status_code: 'status_code', resource_type: 'resource_type' };
    const sort = sortMap[String(options.sort_by || '')] || 'sequence';
    const direction = String(options.sort_order || '').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const total = pub.M('site_check_request').query(`SELECT COUNT(*) AS total FROM site_check_request ${whereSql}`, params)[0].total;
    const data = pub.M('site_check_request').query(`SELECT * FROM site_check_request ${whereSql} ORDER BY ${sort} ${direction}, request_id ASC LIMIT ? OFFSET ?`, params.concat([pageSize, (page - 1) * pageSize]));
    const categories = pub.M('site_check_request').query(
      'SELECT resource_type, COUNT(*) AS total FROM site_check_request WHERE task_id=? GROUP BY resource_type ORDER BY total DESC, resource_type ASC',
      [taskId]
    ).map(row => ({ resource_type: String(row.resource_type || 'Other'), total: Number(row.total) || 0 }));
    return { data, total: Number(total) || 0, categories, page, page_size: pageSize };
  }

  getRequestDetail(requestId, taskId) {
    const id = Number(requestId);
    const tid = Number(taskId);
    if (!id || !tid) throw new Error('请求明细参数不正确');
    const request = pub.M('site_check_request').where('request_id=? AND task_id=?', [id, tid]).find();
    if (!request) throw new Error('请求记录不存在');
    const detail = pub.M('site_check_request_detail').where('request_id=? AND task_id=?', [id, tid]).find();
    return { request, detail };
  }

  stop(taskId) {
    const context = this.contexts.get(Number(taskId));
    if (context) this.finish(context, 'stopped', '用户停止检测');
    return this.getTask(taskId);
  }

  deleteTask(taskId) {
    const id = Number(taskId);
    const context = this.contexts.get(id);
    if (context) {
      // 正文抓取可能仍在等待 CDP 返回，删除后禁止回调重新写入明细。
      context.discardResults = true;
      this.flushRecords(context);
      this.finish(context, 'stopped', '用户删除检测记录');
    }
    pub.M('site_check_request_detail').where('task_id=?', id).delete();
    pub.M('site_check_request').where('task_id=?', id).delete();
    return pub.M('site_check_task').where('task_id=?', id).delete();
  }

  stopAll() {
    Array.from(this.contexts.values()).forEach(context => {
      this.finish(context, 'interrupted', '应用退出导致检测中断');
      if (context.inspectorWindow && !context.inspectorWindow.isDestroyed()) context.inspectorWindow.destroy();
    });
  }
}

const siteInspector = new SiteInspector();
module.exports = { siteInspector };
