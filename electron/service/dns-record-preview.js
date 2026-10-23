'use strict';

const { BrowserWindow } = require('electron');
const Electron = require('ee-core/electron');

function normalizePreviewHostname(value) {
  const hostname = String(value || '').trim().replace(/\.$/, '');
  if (!hostname || /[\s/:@*\\?#_]/.test(hostname)) throw new Error('该主机记录不能直接预览网页，请使用具体的网站域名');
  const parsed = new URL(`https://${hostname}`);
  if (parsed.hostname.length > 253 || !parsed.hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new Error('预览域名格式不正确');
  }
  return parsed.hostname;
}

function webUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

class DnsRecordPreview {
  open(hostname) {
    const host = normalizePreviewHostname(hostname);
    const url = `https://${host}/`;
    if (this.window && !this.window.isDestroyed()) {
      if (this.window.isMinimized()) this.window.restore();
      this.navigate(url);
      this.window.show();
      this.window.focus();
      return { opened: true, hostname: host };
    }
    const parent = Electron.mainWindow;
    if (!parent || parent.isDestroyed()) throw new Error('主窗口不存在');
    const win = new BrowserWindow({
      parent, width: 980, height: 680, minWidth: 640, minHeight: 420,
      title: `网站预览 · ${url}`, autoHideMenuBar: true, backgroundColor: '#ffffff',
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
        partition: 'dns-record-preview',
      },
    });
    this.window = win;
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.setPermissionCheckHandler(() => false);
    const guard = (event, target) => { if (!webUrl(target)) event.preventDefault(); };
    win.webContents.on('will-navigate', guard);
    win.webContents.on('will-redirect', guard);
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (webUrl(target)) this.navigate(target);
      return { action: 'deny' };
    });
    win.webContents.on('did-start-navigation', (_event, target, _inPlace, isMainFrame) => {
      if (isMainFrame && webUrl(target)) {
        this.url = target;
        win.setTitle(`网站预览 · ${target}`);
      }
    });
    win.webContents.on('page-title-updated', event => event.preventDefault());
    win.webContents.on('did-fail-load', (_event, code, description, target, isMainFrame) => {
      if (!isMainFrame || code === -3 || !webUrl(target) || target !== this.url || win.isDestroyed()) return;
      this.showError(win, target, description, code);
    });
    const preventDownload = (event, _item, contents) => {
      if (contents !== win.webContents) return;
      event.preventDefault();
      this.showError(win, this.url, '该地址返回文件下载，无法作为网页预览', 'DOWNLOAD');
    };
    win.webContents.session.on('will-download', preventDownload);
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'Escape') { event.preventDefault(); win.close(); }
      else if ((input.meta || input.control) && input.key.toLowerCase() === 'r') {
        event.preventDefault(); this.navigate(this.url);
      }
    });
    const session = win.webContents.session;
    win.once('closed', () => {
      session.removeListener('will-download', preventDownload);
      if (this.window === win) { this.window = null; this.url = ''; }
    });
    this.navigate(url);
    return { opened: true, hostname: host };
  }

  navigate(url) {
    if (!webUrl(url) || !this.window || this.window.isDestroyed()) return;
    this.url = url;
    this.window.setTitle(`网站预览 · ${url}`);
    // 加载失败由 did-fail-load 在预览窗口展示，不向主页面重复弹错。
    this.window.loadURL(url).catch(() => {});
  }

  showError(win, target, description, code) {
    if (win !== this.window || win.isDestroyed() || !webUrl(target)) return;
    const https = new URL(target); https.protocol = 'https:';
    const http = new URL(target); http.protocol = 'http:';
    const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>网站预览</title><style>body{margin:60px;font:14px/1.8 -apple-system,sans-serif;color:#303133}h2{font-size:20px}p{overflow-wrap:anywhere;color:#606266}a{display:inline-block;margin:12px 12px 0 0;color:#d65a00}</style><h2>网站暂时无法打开</h2><p>${escapeHtml(target)}</p><p>${escapeHtml(description)}（${escapeHtml(code)}）</p><a href="${escapeHtml(https.href)}">重试 HTTPS</a><a href="${escapeHtml(http.href)}">使用 HTTP</a><p>可按 ⌘/Ctrl + R 刷新，Esc 关闭窗口。</p></html>`;
    win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(() => {});
  }
}

module.exports = { dnsRecordPreview: new DnsRecordPreview(), normalizePreviewHostname };
