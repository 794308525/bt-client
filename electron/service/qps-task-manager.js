'use strict';

const { Worker } = require('worker_threads');
const { pub } = require('../class/public.js');

const ACTIVE_STATUSES = ['pending', 'running'];
const RETENTION_KEY = 'toolbox_history_retention_days';
const PUMP_INTERVAL_MS = 20;
const EXTREME_MAX_STAGES = 20;
const EXTREME_MAX_SECONDS = 1800;
const EXTREME_CONFIRM_ATTEMPTS = 3;

function now() { return pub.time(); }
function number(value, fallback = 0) { const result = Number(value); return Number.isFinite(result) ? result : fallback; }
function json(value, fallback) { if (!value) return fallback; try { return JSON.parse(value); } catch (_) { return fallback; } }
function trimError(error) { return String(error && (error.code || error.message) || error || '请求失败').slice(0, 300); }
function round(value, digits = 4) { const factor = 10 ** digits; return Math.round(number(value, 0) * factor) / factor; }
function clamp(value, min, max) { return Math.min(max, Math.max(min, number(value, min))); }

// 与 Worker 共用按延迟区间计数的结构，桶数不随请求数量增长。
function accumulator() { return { count: 0, success: 0, failed: 0, timeouts: 0, bytes: 0, sum: 0, max: 0, histogram: {} }; }
function mergeStats(target, source) {
  if (!target || !source) return;
  target.count += number(source.count, 0); target.success += number(source.success, 0); target.failed += number(source.failed, 0);
  target.timeouts += number(source.timeouts, 0); target.bytes += number(source.bytes, 0); target.sum += number(source.sum, 0);
  target.max = Math.max(target.max, number(source.max, 0));
  for (const [bucket, count] of Object.entries(source.histogram || {})) {
    target.histogram[bucket] = number(target.histogram[bucket], 0) + number(count, 0);
  }
}
function percentile(stats, rate) {
  if (!stats || !stats.count) return 0;
  const rank = Math.max(1, Math.ceil(stats.count * rate));
  let seen = 0;
  for (const bucket of Object.keys(stats.histogram).map(Number).sort((a, b) => a - b)) {
    seen += stats.histogram[bucket];
    if (seen >= rank) return Math.min(bucket, stats.max);
  }
  return 0;
}
function summary(stats) { return { count: stats.count, success: stats.success, failed: stats.failed, timeouts: stats.timeouts, bytes: stats.bytes, avg: stats.count ? round(stats.sum / stats.count, 2) : 0, p95: percentile(stats, 0.95), max: stats.max }; }
function addError(errors, message) { const key = trimError(message); if (errors[key] !== undefined) errors[key] += 1; else if (Object.keys(errors).length < 20) errors[key] = 1; else errors['其他错误'] = (errors['其他错误'] || 0) + 1; }

class QpsTaskManager {
  constructor() { this.runtimes = new Map(); }

  getRetentionDays() { const value = pub.C(RETENTION_KEY); return value === undefined ? 90 : Math.max(0, Math.floor(number(value, 90))); }
  setRetentionDays(days) { const normalized = Math.max(0, Math.floor(number(days, 90))); pub.C(RETENTION_KEY, normalized); this.cleanupExpired(); return normalized; }

  cleanupExpired() {
    const days = this.getRetentionDays();
    if (!days) return { days, removed: 0 };
    const rows = pub.M('qps_test_task').where('created_at<?', now() - days * 86400).field('task_id').select();
    const ids = rows.map(row => Number(row.task_id)).filter(Boolean);
    if (!ids.length) return { days, removed: 0 };
    const marks = ids.map(() => '?').join(',');
    pub.M('qps_test_stage').where(`task_id IN (${marks})`, ids).delete();
    pub.M('qps_test_sample').where(`task_id IN (${marks})`, ids).delete();
    pub.M('qps_test_task').where(`task_id IN (${marks})`, ids).delete();
    return { days, removed: ids.length };
  }

  recoverInterrupted() {
    const timestamp = now();
    const changed = pub.M('qps_test_task').where('status IN (?,?)', ACTIVE_STATUSES).update({ status: 'interrupted', ended_at: timestamp, updated_at: timestamp, last_error: '应用退出导致任务中断' });
    this.cleanupExpired();
    return changed;
  }

  normalizeConfig(input = {}) {
    let parsedUrl;
    try { parsedUrl = new URL(String(input.url || '').trim()); } catch (_) { throw new Error('请输入正确的 HTTP 或 HTTPS 地址'); }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('仅支持 HTTP 和 HTTPS 地址');
    const mode = String(input.mode || 'fixed') === 'extreme' ? 'extreme' : 'fixed';
    const concurrency = Math.floor(number(input.concurrency, 0));
    const timeoutMs = Math.floor(number(input.timeout_ms, 10000));
    const targetQps = number(input.target_qps, mode === 'extreme' ? number(input.extreme_initial_qps, 10) : 0);
    const durationSeconds = Math.floor(number(input.duration_seconds, mode === 'extreme' ? EXTREME_MAX_SECONDS : 0));
    if (!(targetQps > 0)) throw new Error('目标 QPS 必须大于 0');
    if (!(concurrency > 0)) throw new Error('最大并发必须大于 0');
    if (mode === 'fixed' && !(durationSeconds > 0)) throw new Error('测试时长必须大于 0');
    if (!(timeoutMs > 0)) throw new Error('请求超时必须大于 0');

    const method = String(input.method || 'GET').trim().toUpperCase();
    if (!/^[A-Z]+$/.test(method)) throw new Error('请求方法不正确');
    const headersText = typeof input.request_headers === 'string' ? input.request_headers.trim() || '{}' : JSON.stringify(input.request_headers || {});
    const headers = json(headersText, null);
    if (!headers || Array.isArray(headers) || typeof headers !== 'object') throw new Error('请求头必须是 JSON 对象');
    const headersNormalized = {};
    Object.entries(headers).forEach(([key, value]) => { if (String(key).trim()) headersNormalized[String(key)] = String(value); });

    const initialQps = number(input.extreme_initial_qps, 10);
    const growthFactor = number(input.extreme_growth_factor, 1.5);
    const warmup = Math.floor(number(input.extreme_warmup_seconds, 10));
    const measure = Math.floor(number(input.extreme_measure_seconds, 30));
    const confirm = Math.floor(number(input.extreme_confirm_seconds, 300));
    const maxQps = Math.max(0, number(input.max_qps, 0));
    const maxErrorRate = clamp(number(input.extreme_max_error_rate, 0.01), 0, 1);
    const minSuccessRate = clamp(number(input.extreme_min_success_rate, 0.95), 0.01, 1);
    const minIssuedRate = clamp(number(input.extreme_min_issued_rate, 0.98), 0.01, 1);
    const p95LimitMs = Math.min(1000, Math.max(1, Math.floor(number(input.extreme_p95_limit_ms, 1000))));
    if (mode === 'extreme' && (!(initialQps > 0) || !(growthFactor > 1) || warmup < 0 || measure <= 0 || confirm <= 0)) throw new Error('极限模式参数不正确');

    return {
      name: String(input.name || '').trim(), url: parsedUrl.toString(), method, preset: String(input.preset || 'custom'),
      request_headers: JSON.stringify(headersNormalized), request_body: String(input.request_body || ''), mode, max_qps: maxQps,
      extreme_initial_qps: initialQps, extreme_growth_factor: growthFactor, extreme_warmup_seconds: warmup,
      extreme_measure_seconds: measure, extreme_confirm_seconds: confirm, extreme_max_error_rate: maxErrorRate,
      extreme_min_success_rate: minSuccessRate, extreme_min_issued_rate: minIssuedRate, extreme_p95_limit_ms: p95LimitMs,
      target_qps: mode === 'extreme' ? initialQps : targetQps, concurrency, duration_seconds: mode === 'extreme' ? EXTREME_MAX_SECONDS : durationSeconds,
      timeout_ms: timeoutMs, keep_alive: input.keep_alive === false || input.keep_alive === 0 ? 0 : 1,
      follow_redirects: input.follow_redirects === false || input.follow_redirects === 0 ? 0 : 1,
      ignore_tls_errors: input.ignore_tls_errors === true || input.ignore_tls_errors === 1 ? 1 : 0,
    };
  }

  createTask(input) {
    const config = this.normalizeConfig(input);
    const activeRuntimes = Array.from(this.runtimes.values());
    if (config.mode === 'extreme' && activeRuntimes.length) throw new Error('极限模式需独占本机发压器，请先停止其他 QPS 任务');
    if (activeRuntimes.some(runtime => runtime.task.mode === 'extreme')) throw new Error('当前有极限模式任务运行，请等待其结束或先停止');
    const timestamp = now();
    const taskId = pub.M('qps_test_task').insert({ ...config, status: 'pending', created_at: timestamp, updated_at: timestamp });
    if (!taskId) throw new Error('创建 QPS 测试任务失败');
    this.startTask(taskId);
    return this.getTask(taskId);
  }

  startTask(taskId) {
    const id = Number(taskId);
    if (this.runtimes.has(id)) return;
    const task = pub.M('qps_test_task').where('task_id=?', id).find();
    if (!task) throw new Error('QPS 测试任务不存在');
    const timestamp = now();
    pub.M('qps_test_task').where('task_id=?', id).update({ status: 'running', started_at: timestamp, updated_at: timestamp, last_error: '', limit_kind: '', limit_reason: '' });
    const runtime = {
      task: { ...task, task_id: id, started_at: timestamp }, startedAtMs: Date.now(), timer: null, sampleTimer: null,
      finishTimer: null, drainTimer: null, finishDeadlineMs: 0, finishStatus: '', active: 0, scheduled: 0, issued: 0,
      completed: 0, fixedScheduled: 0, dropped: 0, total: accumulator(), statusCodes: {}, errors: {},
      sample: { scheduledBase: 0, issuedBase: 0, stats: accumulator() }, pendingRequests: new Set(), ending: false,
      finalized: false, discardResults: false, stage: null, stageNo: 0, lower: 0, upper: 0, finalStable: 0,
      passedTargets: [], confirmAttempts: 0, lastLimitKind: '', lastLimitReason: '',
      worker: null, workerDone: false, eventLoopLagMs: 0,
    };
    this.runtimes.set(id, runtime);
    runtime.worker = new Worker(require.resolve('./qps-load-worker.js'), {
      workerData: {
        url: String(task.url), method: String(task.method || 'GET'), requestHeaders: json(task.request_headers, {}),
        requestBody: String(task.request_body || ''), concurrency: Number(task.concurrency) || 1,
        mode: String(task.mode || 'fixed'), targetQps: Number(task.target_qps) || 1,
        durationSeconds: Number(task.duration_seconds) || 1,
        timeoutMs: Number(task.timeout_ms) || 10000, keepAlive: Number(task.keep_alive) === 1,
        followRedirects: Number(task.follow_redirects) === 1, ignoreTlsErrors: Number(task.ignore_tls_errors) === 1,
      },
    });
    runtime.worker.on('message', message => this.handleWorkerMessage(runtime, message));
    runtime.worker.on('error', error => {
      if (runtime.finalized) return;
      runtime.workerDone = true;
      addError(runtime.errors, error);
      if (runtime.ending) this.maybeFinalize(runtime);
      else this.requestFinish(runtime, 'stopped', false);
    });
    runtime.worker.on('exit', code => {
      if (runtime.finalized) return;
      runtime.workerDone = true;
      if (runtime.ending) this.maybeFinalize(runtime);
      else if (code !== 0) this.requestFinish(runtime, 'stopped', false);
    });
    // 固定 QPS 的调度完全在发压 Worker 内完成，主进程只跟踪状态；极限模式才需要主进程驱动分档判定。
    if (task.mode === 'extreme') runtime.timer = setInterval(() => this.pump(runtime), PUMP_INTERVAL_MS);
    const duration = task.mode === 'extreme' ? EXTREME_MAX_SECONDS : Math.max(1, Number(task.duration_seconds));
    runtime.finishTimer = setTimeout(() => {
      if (task.mode === 'extreme') this.finishWithLimit(runtime, 'engine_guard', `已达极限模式 ${EXTREME_MAX_SECONDS / 60} 分钟总时长保护，仅保留当前已验证下界`);
      else this.requestFinish(runtime, 'completed', true);
    }, duration * 1000);
    if (task.mode === 'extreme') this.startExtremeStage(runtime, Number(task.extreme_initial_qps) || 10, 'probe');
    runtime.worker.postMessage({ type: 'start' });
  }

  handleWorkerMessage(runtime, message) {
    if (!runtime || runtime.finalized || !message) return;
    if (message.type === 'health') { runtime.eventLoopLagMs = Math.max(runtime.eventLoopLagMs, number(message.eventLoopLagMs, 0)); return; }
    if (message.type === 'stage-state' && runtime.stage && runtime.stage.stageNo === Number(message.stageNo)) {
      runtime.active = Math.max(0, number(message.active, runtime.active));
      runtime.eventLoopLagMs = Math.max(runtime.eventLoopLagMs, number(message.eventLoopLagMs, 0));
      this.applyWorkerStage(runtime, message.stage);
      runtime.stage.inFlight = runtime.active;
      if (['warmup_drain', 'drain'].includes(String(message.phase || ''))) runtime.stage.drainObserved = true;
      return;
    }
    if (message.type === 'sample') return this.handleWorkerSample(runtime, message);
    if (message.type === 'done') {
      runtime.workerDone = true;
      runtime.active = 0;
      runtime.scheduled = Math.max(runtime.scheduled, number(message.scheduled, runtime.scheduled));
      runtime.issued = Math.max(runtime.issued, number(message.issued, runtime.issued));
      this.maybeFinalize(runtime);
    }
  }

  handleWorkerSample(runtime, message) {
    const stats = message.stats || accumulator();
    runtime.active = Math.max(0, number(message.active, 0));
    runtime.scheduled = Math.max(runtime.scheduled, number(message.scheduled, runtime.scheduled));
    runtime.issued = Math.max(runtime.issued, number(message.issued, runtime.issued));
    runtime.eventLoopLagMs = Math.max(runtime.eventLoopLagMs, number(message.eventLoopLagMs, 0));
    runtime.statusCodes = { ...(message.statusCodes || runtime.statusCodes) };
    runtime.errors = { ...(message.errors || runtime.errors) };
    mergeStats(runtime.total, stats);
    runtime.sample.stats = stats;
    runtime.sample.scheduledBase = runtime.scheduled - Math.max(0, number(message.scheduledDelta, 0));
    runtime.sample.issuedBase = runtime.issued - Math.max(0, number(message.issuedDelta, 0));
    this.applyWorkerStage(runtime, message.stage);
    this.flushSample(runtime);
  }

  applyWorkerStage(runtime, stageData) {
    if (!stageData || !runtime.stage || runtime.stage.stageNo !== Number(stageData.stageNo)) return;
    const stage = runtime.stage;
    stage.phase = stageData.phase || stage.phase;
    stage.inFlight = runtime.active;
    stage.scheduled = number(stageData.scheduled, stage.scheduled);
    stage.issued = number(stageData.issued, stage.issued);
    stage.warmupScheduled = number(stageData.warmupScheduled, stage.warmupScheduled);
    stage.warmupIssued = number(stageData.warmupIssued, stage.warmupIssued);
    stage.schedulingTicks = number(stageData.schedulingTicks, stage.schedulingTicks);
    stage.saturatedTicks = number(stageData.saturatedTicks, stage.saturatedTicks);
    stage.generatorLagTicks = number(stageData.generatorLagTicks, stage.generatorLagTicks);
    stage.pumpLagMs = number(stageData.pumpLagMs, stage.pumpLagMs);
    stage.workerLagMs = Math.max(number(stage.workerLagMs, 0), number(stageData.workerLagMs, 0));
    if (stageData.measure) stage.measure = stageData.measure;
    if (stageData.firstHalf) stage.firstHalf = stageData.firstHalf;
    if (stageData.secondHalf) stage.secondHalf = stageData.secondHalf;
  }

  startExtremeStage(runtime, target, kind = 'probe', engineGuardConfirmation = false) {
    if (runtime.ending) return;
    if (runtime.stageNo >= EXTREME_MAX_STAGES) return this.finishWithLimit(runtime, 'engine_guard', `已达 ${EXTREME_MAX_STAGES} 个阶段的发压保护上限`);
    const maxQps = Math.max(0, Number(runtime.task.max_qps) || 0);
    const normalizedTarget = Math.max(1, Math.round(maxQps > 0 ? Math.min(target, maxQps) : target));
    const stageNo = runtime.stageNo + 1;
    const timestamp = now();
    runtime.stageNo = stageNo;
    runtime.stage = {
      stageNo, target: normalizedTarget, kind, engineGuardConfirmation, phase: 'warmup', startedAtMs: Date.now(),
      phaseStartedAtMs: Date.now(), drainDeadlineMs: 0, lastDesired: 0, scheduled: 0, issued: 0, inFlight: 0,
      warmupScheduled: 0, warmupIssued: 0, measure: accumulator(), firstHalf: accumulator(), secondHalf: accumulator(),
      schedulingTicks: 0, saturatedTicks: 0, generatorLagTicks: 0, pumpLagMs: 0, workerLagMs: 0, drainObserved: false, limitKind: '', limitReason: '', status: 'running',
    };
    pub.M('qps_test_stage').insert({
      task_id: runtime.task.task_id, stage_no: stageNo, kind, phase: 'warmup', target_qps: normalizedTarget,
      warmup_seconds: Number(runtime.task.extreme_warmup_seconds) || 0,
      measure_seconds: kind === 'confirm' ? Number(runtime.task.extreme_confirm_seconds) || 300 : Number(runtime.task.extreme_measure_seconds) || 30,
      confirm_seconds: Number(runtime.task.extreme_confirm_seconds) || 300, started_at: timestamp, created_at: timestamp, status: 'running',
    });
    this.sendWorkerStage(runtime, runtime.stage);
    this.persistRuntime(runtime);
  }

  sendWorkerStage(runtime, stage) {
    if (!runtime || !runtime.worker || !stage) return;
    const phase = stage.phase;
    const durationSeconds = phase === 'warmup' ? Number(runtime.task.extreme_warmup_seconds) || 0 : this.stageDurationSeconds(runtime, stage);
    runtime.worker.postMessage({ type: 'set-stage', stage: {
      stageNo: stage.stageNo, phase, target: stage.target, durationMs: Math.max(1, durationSeconds * 1000),
    } });
  }

  startConfirmation(runtime, target, engineGuardConfirmation = false) {
    if (!target) return this.finishWithLimit(runtime, 'no_stable', '没有找到符合当前稳定性阈值的 QPS');
    runtime.confirmAttempts += 1;
    this.startExtremeStage(runtime, target, 'confirm', engineGuardConfirmation);
  }

  beginMeasuredPhase(runtime, stage) {
    if (runtime.stage !== stage || runtime.ending) return;
    stage.phase = stage.kind === 'confirm' ? 'confirm' : 'measure';
    stage.phaseStartedAtMs = Date.now();
    stage.lastDesired = 0;
    stage.scheduled = 0;
    stage.issued = 0;
    stage.measure = accumulator();
    stage.firstHalf = accumulator();
    stage.secondHalf = accumulator();
    stage.schedulingTicks = 0;
    stage.saturatedTicks = 0;
    stage.generatorLagTicks = 0;
    stage.pumpLagMs = 0;
    stage.workerLagMs = 0;
    stage.drainObserved = false;
    pub.M('qps_test_stage').where('task_id=? AND stage_no=?', [runtime.task.task_id, stage.stageNo]).update({ phase: stage.phase });
    this.sendWorkerStage(runtime, stage);
    this.persistRuntime(runtime);
  }

  pump(runtime) {
    if (!runtime || runtime.ending || runtime.finalized) return;
    if (runtime.task.mode === 'extreme') this.pumpExtreme(runtime);
    else this.pumpFixed(runtime);
  }

  pumpFixed(runtime) {
    // 固定模式调度已完全移入 qps-load-worker，主线程只处理 worker 批量统计。
  }

  pumpExtreme(runtime) {
    const stage = runtime.stage;
    if (!stage) return;
    const timestamp = Date.now();
    if (stage.phase === 'warmup') {
      const warmupMs = Math.max(0, Number(runtime.task.extreme_warmup_seconds) || 0) * 1000;
      if (timestamp - stage.phaseStartedAtMs >= warmupMs) {
        stage.phase = 'warmup_drain';
        stage.drainDeadlineMs = timestamp + Math.min(30000, Math.max(2000, Number(runtime.task.timeout_ms) + 2000));
        stage.drainObserved = false;
        pub.M('qps_test_stage').where('task_id=? AND stage_no=?', [runtime.task.task_id, stage.stageNo]).update({ phase: stage.phase });
        this.sendWorkerStage(runtime, stage);
        return;
      }
      return;
    }
    if (stage.phase === 'warmup_drain') {
      if ((stage.drainObserved && stage.inFlight === 0) || timestamp >= stage.drainDeadlineMs) this.beginMeasuredPhase(runtime, stage);
      return;
    }
    if (stage.phase === 'measure' || stage.phase === 'confirm') {
      const durationMs = this.stageDurationSeconds(runtime, stage) * 1000;
      if (timestamp - stage.phaseStartedAtMs >= durationMs) {
        stage.phase = 'drain';
        stage.drainDeadlineMs = timestamp + Math.min(30000, Math.max(2000, Number(runtime.task.timeout_ms) + 2000));
        stage.drainObserved = false;
        pub.M('qps_test_stage').where('task_id=? AND stage_no=?', [runtime.task.task_id, stage.stageNo]).update({ phase: 'drain' });
        stage.phase = 'drain';
        this.sendWorkerStage(runtime, stage);
        this.persistRuntime(runtime);
        return;
      }
      return;
    }
    if (stage.phase === 'drain' && ((stage.drainObserved && stage.inFlight === 0) || timestamp >= stage.drainDeadlineMs)) this.evaluateExtremeStage(runtime, stage);
  }

  stageDurationSeconds(runtime, stage) {
    return Math.max(1, Number(stage.kind === 'confirm' ? runtime.task.extreme_confirm_seconds : runtime.task.extreme_measure_seconds) || (stage.kind === 'confirm' ? 300 : 30));
  }

  flushSample(runtime) {
    if (!runtime || runtime.finalized) return;
    const stats = summary(runtime.sample.stats);
    const scheduled = Math.max(0, runtime.scheduled - runtime.sample.scheduledBase);
    const issued = Math.max(0, runtime.issued - runtime.sample.issuedBase);
    if (!stats.count && !scheduled && !issued) return;
    const stage = runtime.stage;
    const target = stage ? stage.target : Number(runtime.task.target_qps) || 0;
    const phase = stage ? stage.phase : 'fixed';
    pub.M('qps_test_sample').insert({
      task_id: runtime.task.task_id, second_offset: Math.max(1, Math.floor((Date.now() - runtime.startedAtMs) / 1000)),
      stage_no: stage ? stage.stageNo : 0, phase, target_qps: target, scheduled_count: scheduled, issued_count: issued,
      sent_count: issued, completed_count: stats.count, success_count: stats.success, failed_count: stats.failed,
      active_count: runtime.active, actual_qps: stats.count, success_qps: stats.success,
      issued_rate: scheduled ? round(issued / scheduled) : 1, error_rate: stats.count ? round(stats.failed / stats.count) : 0,
      concurrency_limited_count: stage ? stage.saturatedTicks : 0, generator_limited_count: stage ? stage.generatorLagTicks : 0,
      pump_lag_ms: stage
        ? round(Math.max(stage.pumpLagMs || 0, stage.workerLagMs || 0), 2)
        : round(runtime.eventLoopLagMs || 0, 2), avg_latency_ms: stats.avg, p95_latency_ms: stats.p95,
      total_bytes: stats.bytes, created_at: now(),
    });
    runtime.sample.scheduledBase = runtime.scheduled;
    runtime.sample.issuedBase = runtime.issued;
    runtime.sample.stats = accumulator();
    this.persistRuntime(runtime);
  }

  evaluateExtremeStage(runtime, expectedStage) {
    const stage = runtime.stage;
    if (!stage || stage !== expectedStage || runtime.ending) return;
    const duration = this.stageDurationSeconds(runtime, stage);
    const stats = summary(stage.measure);
    const first = summary(stage.firstHalf);
    const second = summary(stage.secondHalf);
    const issuedRate = stage.scheduled ? stage.issued / stage.scheduled : 0;
    const successQps = stats.success / duration;
    const errorRate = stats.count ? stats.failed / stats.count : 1;
    const maxErrorRate = number(runtime.task.extreme_max_error_rate, 0.01);
    const minSuccessRate = number(runtime.task.extreme_min_success_rate, 0.95);
    const minIssuedRate = number(runtime.task.extreme_min_issued_rate, 0.98);
    const p95LimitMs = number(runtime.task.extreme_p95_limit_ms, 1000);
    const degraded = first.count > 0 && second.count > 0 && second.p95 > first.p95 * 1.5 && second.p95 - first.p95 > 200;
    const saturationRate = stage.schedulingTicks ? stage.saturatedTicks / stage.schedulingTicks : 0;
    const workerLagMs = Math.max(0, number(stage.workerLagMs, 0));
    let verdict = 'site_failed';
    let limitKind = '';
    let reason = '';
    if (workerLagMs >= 100) {
      limitKind = 'generator_limited';
      verdict = limitKind;
      reason = `本机发压 Worker 事件循环延迟 ${workerLagMs.toFixed(2)}ms，结果不再代表站点稳定上限`;
    } else if (issuedRate < minIssuedRate) {
      limitKind = saturationRate >= 0.25 ? 'concurrency_limited' : 'generator_limited';
      verdict = limitKind;
      reason = limitKind === 'concurrency_limited'
        ? `最大并发长时占满，真实发出率 ${(issuedRate * 100).toFixed(2)}% 低于 ${(minIssuedRate * 100).toFixed(2)}%`
        : `本机调度/发压能力受限，真实发出率 ${(issuedRate * 100).toFixed(2)}% 低于 ${(minIssuedRate * 100).toFixed(2)}%`;
    } else if (errorRate > maxErrorRate) reason = `HTTP 200 错误率 ${(errorRate * 100).toFixed(2)}% 超过 ${(maxErrorRate * 100).toFixed(2)}%`;
    else if (successQps < stage.target * minSuccessRate) reason = `成功 QPS ${successQps.toFixed(2)} 低于目标的 ${(minSuccessRate * 100).toFixed(2)}%`;
    else if (stats.p95 > p95LimitMs) reason = `P95 延迟 ${stats.p95}ms 超过 ${p95LimitMs}ms`;
    else if (degraded) reason = `后半段 P95 ${second.p95}ms 相比前半段 ${first.p95}ms 持续恶化`;
    else { verdict = 'passed'; reason = '错误率、成功 QPS、发出率和 P95 均通过'; }

    const stageStatus = verdict === 'passed' ? 'passed' : limitKind ? 'limited' : 'site_failed';
    stage.status = stageStatus;
    stage.limitKind = limitKind;
    stage.limitReason = reason;
    pub.M('qps_test_stage').where('task_id=? AND stage_no=?', [runtime.task.task_id, stage.stageNo]).update({
      phase: stage.kind === 'confirm' ? 'confirm' : 'measure', scheduled_count: stage.scheduled, issued_count: stage.issued,
      completed_count: stats.count, success_count: stats.success, failed_count: stats.failed, success_qps: round(successQps, 2),
      issued_rate: round(issuedRate), error_rate: round(errorRate), avg_latency_ms: stats.avg, p95_latency_ms: stats.p95,
      max_latency_ms: stats.max, latency_degraded: degraded ? 1 : 0, limit_kind: limitKind,
      limit_reason: reason, pump_lag_ms: round(workerLagMs, 2), status: stageStatus, ended_at: now(),
    });
    this.persistRuntime(runtime);
    this.handleStageVerdict(runtime, stage, verdict, reason);
  }

  handleStageVerdict(runtime, stage, verdict, reason) {
    if (verdict === 'concurrency_limited' || verdict === 'generator_limited') return this.finishWithLimit(runtime, verdict, reason);

    if (stage.kind === 'confirm') {
      if (verdict === 'passed') {
        runtime.finalStable = stage.target;
        if (stage.engineGuardConfirmation) {
          runtime.lastLimitKind = 'engine_guard';
          runtime.lastLimitReason = `已确认 ${stage.target} QPS 稳定下界，但因阶段保护未继续寻找站点失败上界`;
        } else if (Number(runtime.task.max_qps) > 0 && stage.target >= Number(runtime.task.max_qps) && !runtime.upper) {
          runtime.lastLimitKind = 'user_limit';
          runtime.lastLimitReason = `已确认用户设置的最大值 ${stage.target} QPS 稳定，站点上限可能更高`;
        } else {
          runtime.lastLimitKind = 'site';
          runtime.lastLimitReason = runtime.upper
            ? `已确认稳定 QPS ${stage.target}，首个失败上界 ${runtime.upper} QPS`
            : `已确认稳定 QPS ${stage.target}`;
        }
        stage.status = 'confirmed';
        pub.M('qps_test_stage').where('task_id=? AND stage_no=?', [runtime.task.task_id, stage.stageNo]).update({ status: 'confirmed' });
        return this.requestFinish(runtime, 'completed', true);
      }
      runtime.upper = runtime.upper ? Math.min(runtime.upper, stage.target) : stage.target;
      runtime.passedTargets = runtime.passedTargets.filter(value => value < stage.target);
      runtime.lower = runtime.passedTargets.length ? Math.max(...runtime.passedTargets) : 0;
      if (runtime.lower && runtime.confirmAttempts < EXTREME_CONFIRM_ATTEMPTS && runtime.stageNo < EXTREME_MAX_STAGES) return this.startConfirmation(runtime, runtime.lower);
      if (!runtime.lower) return this.finishWithLimit(runtime, 'no_stable', '探测阶段曾通过，但长时稳定确认未通过，未找到稳定 QPS');
      return this.finishWithLimit(runtime, 'site', `稳定确认连续失败，当前仅保留 ${runtime.lower} QPS 短时探测下界`);
    }

    if (verdict === 'passed') {
      runtime.lower = Math.max(runtime.lower, stage.target);
      if (!runtime.passedTargets.includes(stage.target)) runtime.passedTargets.push(stage.target);
      runtime.passedTargets.sort((a, b) => a - b);
    } else {
      runtime.upper = runtime.upper ? Math.min(runtime.upper, stage.target) : stage.target;
      if (!runtime.lower) {
        if (stage.target <= 1) return this.finishWithLimit(runtime, 'no_stable', '1 QPS 仍未通过当前错误率和延迟阈值');
        return this.startExtremeStage(runtime, Math.max(1, Math.floor(stage.target / 2)), 'probe');
      }
    }

    const maxQps = Math.max(0, Number(runtime.task.max_qps) || 0);
    if (verdict === 'passed' && maxQps > 0 && stage.target >= maxQps) return this.startConfirmation(runtime, runtime.lower);
    if (runtime.upper > runtime.lower && ((runtime.upper - runtime.lower) / runtime.lower <= 0.05 || runtime.upper - runtime.lower <= 1)) return this.startConfirmation(runtime, runtime.lower);
    if (runtime.stageNo >= EXTREME_MAX_STAGES - 1) {
      if (runtime.lower) return this.startConfirmation(runtime, runtime.lower, true);
      return this.finishWithLimit(runtime, 'engine_guard', `已达 ${EXTREME_MAX_STAGES} 个阶段的发压保护上限，未找到可确认的稳定值`);
    }

    let next;
    let kind;
    if (runtime.upper > runtime.lower) {
      next = Math.floor(Math.sqrt(runtime.lower * runtime.upper));
      if (next <= runtime.lower || next >= runtime.upper) return this.startConfirmation(runtime, runtime.lower);
      kind = 'search';
    } else {
      next = Math.max(runtime.lower + 1, Math.ceil(stage.target * (Number(runtime.task.extreme_growth_factor) || 1.5)));
      if (maxQps > 0) next = Math.min(next, maxQps);
      kind = 'probe';
    }
    this.startExtremeStage(runtime, next, kind);
  }

  finishWithLimit(runtime, kind, reason) {
    if (!runtime || runtime.ending) return;
    runtime.lastLimitKind = kind;
    runtime.lastLimitReason = reason;
    if (runtime.stage && runtime.stage.status === 'running') {
      runtime.stage.limitKind = kind;
      runtime.stage.limitReason = reason;
      runtime.stage.status = 'limited';
      pub.M('qps_test_stage').where('task_id=? AND stage_no=?', [runtime.task.task_id, runtime.stage.stageNo]).update({ status: 'limited', limit_kind: kind, limit_reason: reason, ended_at: now() });
    }
    this.requestFinish(runtime, 'completed', true);
  }

  stageLiveStats(runtime) {
    const stage = runtime.stage;
    if (!stage || !['measure', 'confirm', 'drain'].includes(stage.phase)) return { successQps: 0, issuedRate: 1 };
    const configured = this.stageDurationSeconds(runtime, stage);
    const elapsed = stage.phase === 'drain' ? configured : Math.min(configured, Math.max(0.001, (Date.now() - stage.phaseStartedAtMs) / 1000));
    return { successQps: summary(stage.measure).success / elapsed, issuedRate: stage.scheduled ? stage.issued / stage.scheduled : 1 };
  }

  persistRuntime(runtime, status) {
    if (!runtime || runtime.finalized) return;
    const elapsedSeconds = Math.max(0.001, (Date.now() - runtime.startedAtMs) / 1000);
    const stats = summary(runtime.total);
    const stage = runtime.stage;
    const live = this.stageLiveStats(runtime);
    pub.M('qps_test_task').where('task_id=?', runtime.task.task_id).update({
      ...(status ? { status, ended_at: now() } : {}), total_count: stats.count, success_count: stats.success,
      failed_count: stats.failed, timeout_count: stats.timeouts, total_bytes: stats.bytes,
      dropped_count: Math.max(0, runtime.scheduled - runtime.issued), avg_latency_ms: stats.avg,
      p95_latency_ms: stats.p95, max_latency_ms: stats.max, actual_qps: round(stats.count / elapsedSeconds, 2),
      status_codes: JSON.stringify(runtime.statusCodes), error_summary: JSON.stringify(runtime.errors),
      current_phase: stage ? stage.phase : 'fixed', current_stage: stage ? stage.stageNo : 0,
      current_target_qps: stage ? stage.target : Number(runtime.task.target_qps) || 0, lower_qps: runtime.lower || 0,
      upper_qps: runtime.upper || 0, final_stable_qps: runtime.finalStable || 0, scheduled_count: runtime.scheduled,
      issued_count: runtime.issued, success_qps: round(live.successQps, 2), issued_rate: round(live.issuedRate),
      limit_kind: runtime.lastLimitKind || (stage && stage.limitKind) || '',
      limit_reason: runtime.lastLimitReason || (stage && stage.limitReason) || '',
      last_error: Object.keys(runtime.errors)[0] || runtime.lastLimitReason || '', updated_at: now(),
    });
  }

  persistStageSnapshot(runtime, status) {
    const stage = runtime.stage;
    if (!stage || runtime.task.mode !== 'extreme') return;
    const stats = summary(stage.measure);
    const elapsed = ['measure', 'confirm', 'drain'].includes(stage.phase)
      ? Math.min(this.stageDurationSeconds(runtime, stage), Math.max(0.001, (Date.now() - stage.phaseStartedAtMs) / 1000))
      : 0;
    const issuedRate = stage.scheduled ? stage.issued / stage.scheduled : 0;
    pub.M('qps_test_stage').where('task_id=? AND stage_no=?', [runtime.task.task_id, stage.stageNo]).update({
      phase: stage.phase, scheduled_count: stage.scheduled, issued_count: stage.issued, completed_count: stats.count,
      success_count: stats.success, failed_count: stats.failed, success_qps: elapsed ? round(stats.success / elapsed, 2) : 0,
      issued_rate: round(issuedRate), error_rate: stats.count ? round(stats.failed / stats.count) : 0,
      avg_latency_ms: stats.avg, p95_latency_ms: stats.p95, max_latency_ms: stats.max,
      limit_kind: stage.limitKind || '', limit_reason: stage.limitReason || '',
      pump_lag_ms: round(Math.max(stage.pumpLagMs || 0, stage.workerLagMs || 0), 2),
      status, ended_at: now(),
    });
  }

  requestFinish(runtime, status = 'stopped', graceful = false) {
    if (!runtime || runtime.finalized) return Promise.resolve();
    if (runtime.ending) {
      if (runtime.discardResults) this.finalize(runtime);
      return runtime.finishPromise;
    }
    runtime.ending = true;
    runtime.finishStatus = status;
    runtime.finishPromise = new Promise(resolve => { runtime.resolveFinish = resolve; });
    if (runtime.timer) clearInterval(runtime.timer);
    if (runtime.sampleTimer) clearInterval(runtime.sampleTimer);
    if (runtime.finishTimer) clearTimeout(runtime.finishTimer);
    if (!runtime.worker || runtime.workerDone || runtime.discardResults) {
      this.finalize(runtime);
      return runtime.finishPromise;
    }
    // 停止请求后仍需接收最后的 sample/done；异常 Worker 最多等待两秒。
    const waitMs = graceful ? Math.min(30000, Math.max(2000, Number(runtime.task.timeout_ms) + 2000)) : 2000;
    runtime.finishDeadlineMs = Date.now() + waitMs;
    runtime.drainTimer = setInterval(() => this.maybeFinalize(runtime), 25);
    try { runtime.worker.postMessage({ type: 'stop', graceful }); }
    catch (error) { addError(runtime.errors, error); this.finalize(runtime); }
    this.maybeFinalize(runtime);
    return runtime.finishPromise;
  }

  maybeFinalize(runtime) {
    if (!runtime || !runtime.ending || runtime.finalized) return;
    if (runtime.workerDone || Date.now() >= runtime.finishDeadlineMs) this.finalize(runtime);
  }

  finalize(runtime) {
    if (!runtime || runtime.finalized) return;
    runtime.finalized = true;
    if (runtime.drainTimer) clearInterval(runtime.drainTimer);
    runtime.pendingRequests.forEach(request => request.destroy());
    runtime.pendingRequests.clear();
    if (runtime.worker) {
      runtime.worker.removeAllListeners();
      runtime.worker.terminate();
      runtime.worker = null;
    }
    if (!runtime.discardResults) {
      if (runtime.task.mode === 'extreme' && runtime.stage && ['running', 'limited'].includes(runtime.stage.status)) {
        const stageStatus = runtime.stage.status === 'limited' ? 'limited' : runtime.finishStatus === 'completed' ? 'limited' : 'stopped';
        this.persistStageSnapshot(runtime, stageStatus);
      }
      this.flushFinalSample(runtime);
      runtime.finalized = false;
      this.persistRuntime(runtime, runtime.finishStatus || 'stopped');
      runtime.finalized = true;
    }
    this.runtimes.delete(runtime.task.task_id);
    if (runtime.resolveFinish) runtime.resolveFinish();
  }

  flushFinalSample(runtime) {
    const stats = summary(runtime.sample.stats);
    const scheduled = Math.max(0, runtime.scheduled - runtime.sample.scheduledBase);
    const issued = Math.max(0, runtime.issued - runtime.sample.issuedBase);
    if (!stats.count && !scheduled && !issued) return;
    const stage = runtime.stage;
    pub.M('qps_test_sample').insert({
      task_id: runtime.task.task_id, second_offset: Math.max(1, Math.ceil((Date.now() - runtime.startedAtMs) / 1000)),
      stage_no: stage ? stage.stageNo : 0, phase: stage ? stage.phase : 'fixed',
      target_qps: stage ? stage.target : Number(runtime.task.target_qps) || 0, scheduled_count: scheduled,
      issued_count: issued, sent_count: issued, completed_count: stats.count, success_count: stats.success,
      failed_count: stats.failed, active_count: runtime.active, actual_qps: stats.count, success_qps: stats.success,
      issued_rate: scheduled ? round(issued / scheduled) : 1, error_rate: stats.count ? round(stats.failed / stats.count) : 0,
      pump_lag_ms: stage
        ? round(Math.max(stage.pumpLagMs || 0, stage.workerLagMs || 0), 2)
        : round(runtime.eventLoopLagMs || 0, 2), avg_latency_ms: stats.avg, p95_latency_ms: stats.p95,
      total_bytes: stats.bytes, created_at: now(),
    });
  }

  async stopTask(taskId) {
    const runtime = this.runtimes.get(Number(taskId));
    if (runtime) {
      await this.requestFinish(runtime, 'stopped', false);
      return this.getTask(taskId);
    }
    const task = pub.M('qps_test_task').where('task_id=?', Number(taskId)).find();
    if (!task) throw new Error('QPS 测试任务不存在');
    if (ACTIVE_STATUSES.includes(task.status)) pub.M('qps_test_task').where('task_id=?', Number(taskId)).update({ status: 'stopped', ended_at: now(), updated_at: now() });
    return this.getTask(taskId);
  }

  getTask(taskId, withSamples = true, afterSampleId = 0) {
    const task = pub.M('qps_test_task').where('task_id=?', Number(taskId)).find();
    if (!task) throw new Error('QPS 测试任务不存在');
    const runtime = this.runtimes.get(Number(taskId));
    if (runtime) {
      const live = this.stageLiveStats(runtime);
      task.runtime = {
        active_count: runtime.active, issued_count: runtime.issued, scheduled_count: runtime.scheduled,
        elapsed_seconds: Math.max(0, Math.floor((Date.now() - runtime.startedAtMs) / 1000)),
        phase: runtime.stage ? runtime.stage.phase : 'fixed', stage: runtime.stage ? runtime.stage.stageNo : 0,
        stage_kind: runtime.stage ? runtime.stage.kind : 'fixed', target_qps: runtime.stage ? runtime.stage.target : runtime.task.target_qps,
        lower_qps: runtime.lower, upper_qps: runtime.upper, success_qps: round(live.successQps, 2),
        issued_rate: round(live.issuedRate), limit_kind: runtime.lastLimitKind || '', limit_reason: runtime.lastLimitReason || '',
        event_loop_lag_ms: round(runtime.eventLoopLagMs, 2),
      };
    }
    task.status_codes = json(task.status_codes, {});
    task.error_summary = json(task.error_summary, {});
    task.request_headers = json(task.request_headers, {});
    if (withSamples) {
      const cursor = Math.max(0, Math.floor(number(afterSampleId, 0)));
      task.samples = cursor
        ? pub.M('qps_test_sample').where('task_id=? AND sample_id>?', [Number(taskId), cursor]).order('sample_id ASC').select()
        : pub.M('qps_test_sample').where('task_id=?', Number(taskId)).order('sample_id ASC').select();
    }
    task.stages = pub.M('qps_test_stage').where('task_id=?', Number(taskId)).order('stage_no ASC').select();
    return task;
  }

  listTasks(options = {}) {
    const page = Math.max(1, Math.floor(number(options.page, 1)));
    const pageSize = Math.min(100, Math.max(1, Math.floor(number(options.page_size, 20))));
    const where = [];
    const params = [];
    const keyword = String(options.keyword || '').trim();
    if (keyword) { where.push('(name LIKE ? OR url LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
    if (options.status === 'failed') { where.push('status IN (?,?)'); params.push('failed', 'interrupted'); }
    else if (options.status && options.status !== 'all') { where.push('status=?'); params.push(String(options.status)); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const sortMap = { created_at: 'created_at', started_at: 'started_at', ended_at: 'ended_at', actual_qps: 'actual_qps', avg_latency_ms: 'avg_latency_ms', success_count: 'success_count' };
    const sort = sortMap[String(options.sort_by || '')] || 'created_at';
    const direction = String(options.sort_order || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const total = pub.M('qps_test_task').query(`SELECT COUNT(*) AS total FROM qps_test_task ${whereSql}`, params)[0].total;
    const rows = pub.M('qps_test_task').query(`SELECT * FROM qps_test_task ${whereSql} ORDER BY ${sort} ${direction}, task_id DESC LIMIT ? OFFSET ?`, params.concat([pageSize, (page - 1) * pageSize]));
    return { data: rows.map(row => ({ ...row, request_headers: {}, request_body: '', status_codes: json(row.status_codes, {}), error_summary: json(row.error_summary, {}) })), total: Number(total) || 0, page, page_size: pageSize };
  }

  deleteTask(taskId) {
    const id = Number(taskId);
    const runtime = this.runtimes.get(id);
    if (runtime) {
      runtime.discardResults = true;
      this.requestFinish(runtime, 'stopped', false);
    }
    pub.M('qps_test_stage').where('task_id=?', id).delete();
    pub.M('qps_test_sample').where('task_id=?', id).delete();
    return pub.M('qps_test_task').where('task_id=?', id).delete();
  }

  retryTask(taskId) { return this.createTask(this.getTask(taskId, false)); }
  stopAll() { return Promise.all(Array.from(this.runtimes.values()).map(runtime => this.requestFinish(runtime, 'interrupted', false))); }
}

const qpsTaskManager = new QpsTaskManager();
module.exports = { qpsTaskManager };
