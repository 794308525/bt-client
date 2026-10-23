'use strict';

// QPS 发压专用 worker：主线程只负责任务状态机和持久化，避免 HTTP/调度/统计阻塞 Electron。
const { parentPort, workerData } = require('worker_threads');
const http = require('http');
const https = require('https');

// ee-core 会扫描并加载 service 目录。普通服务加载时不能执行 Worker 的任务初始化。
if (!parentPort || !workerData) {
  module.exports = {};
} else {

const PUMP_INTERVAL_MS = 20;
const MAX_LAUNCH_BATCH = 1000;
const task = workerData || {};
const parsedUrl = new URL(String(task.url));
const normalizedHeaders = { ...(task.requestHeaders || {}) };
const body = Buffer.from(String(task.requestBody || ''));
if (body.length && !Object.keys(normalizedHeaders).some(key => key.toLowerCase() === 'content-length')) normalizedHeaders['Content-Length'] = body.length;
const headers = Object.freeze(normalizedHeaders);
const options = Object.freeze({
  method: String(task.method || 'GET'), headers, timeout: Math.max(1, Number(task.timeoutMs) || 10000),
});
const agentOptions = { keepAlive: Number(task.keepAlive) === 1, maxSockets: Math.max(1, Number(task.concurrency) || 1) };
const agents = {
  http: new http.Agent(agentOptions),
  https: new https.Agent({ ...agentOptions, rejectUnauthorized: Number(task.ignoreTlsErrors) !== 1 }),
};
const httpRequestOptions = Object.freeze({ ...options, agent: agents.http, rejectUnauthorized: Number(task.ignoreTlsErrors) !== 1 });
const httpsRequestOptions = Object.freeze({ ...options, agent: agents.https, rejectUnauthorized: Number(task.ignoreTlsErrors) !== 1 });

function accumulator() { return { count: 0, success: 0, failed: 0, timeouts: 0, bytes: 0, sum: 0, max: 0, histogram: {} }; }
function addResult(stats, result, latency) {
  const value = Math.max(0, Number(latency) || 0);
  stats.count += 1; stats.sum += value; stats.max = Math.max(stats.max, value);
  // 一秒以内按毫秒分桶，更慢的请求保留三位有效数字，避免长时任务按请求数占用内存。
  const precision = value <= 1000 ? 1 : 10 ** (Math.floor(Math.log10(value)) - 2);
  const bucket = Math.ceil(value / precision) * precision;
  stats.histogram[bucket] = (stats.histogram[bucket] || 0) + 1;
  stats.bytes += Math.max(0, Number(result.bytes) || 0);
  if (result.statusCode === 200) stats.success += 1; else stats.failed += 1;
  if (result.timeout) stats.timeouts += 1;
}
function trimError(error) { return String(error && (error.code || error.message) || error || '请求失败').slice(0, 300); }

let running = false;
let stopping = false;
let stopDeadline = 0;
let timer = null;
let sampleTimer = null;
let startedAt = 0;
let scheduled = 0;
let issued = 0;
let active = 0;
let stage = null;
let fixedDesired = 0;
let fixedIssued = 0;
let intervalStats = accumulator();
let pending = new Set();
let lastTick = 0;
let lastSampleScheduled = 0;
let lastSampleIssued = 0;
let maxEventLoopLagMs = 0;
const statusCodes = Object.create(null);
const errors = Object.create(null);

function captureLoopLag(timestamp) {
  const lag = lastTick ? Math.max(0, timestamp - lastTick - PUMP_INTERVAL_MS) : 0;
  maxEventLoopLagMs = Math.max(maxEventLoopLagMs, lag);
  if (stage && ['measure', 'confirm'].includes(stage.phase)) stage.workerLagMs = Math.max(stage.workerLagMs, lag);
  lastTick = timestamp;
}

function stageSnapshot() {
  if (!stage) return null;
  return {
    stageNo: stage.stageNo, phase: stage.phase, target: stage.target, scheduled: stage.scheduled, issued: stage.issued,
    warmupScheduled: stage.warmupScheduled, warmupIssued: stage.warmupIssued, schedulingTicks: stage.schedulingTicks,
    saturatedTicks: stage.saturatedTicks, generatorLagTicks: stage.generatorLagTicks, pumpLagMs: stage.pumpLagMs,
    workerLagMs: stage.workerLagMs, measure: stage.measure, firstHalf: stage.firstHalf, secondHalf: stage.secondHalf,
  };
}

function emitStageState() {
  if (!stage) return;
  parentPort.postMessage({ type: 'stage-state', stageNo: stage.stageNo, phase: stage.phase, active, eventLoopLagMs: maxEventLoopLagMs, stage: stageSnapshot() });
}

function request(targetUrl, redirectCount = 0) {
  const target = redirectCount ? new URL(targetUrl) : parsedUrl;
  const secure = target.protocol === 'https:';
  const requestOptions = secure ? httpsRequestOptions : httpRequestOptions;
  return new Promise((resolve, reject) => {
    let settled = false;
    let req;
    const settle = (handler, value) => { if (settled) return; settled = true; pending.delete(req); handler(value); };
    try {
      req = transportFor(target).request(target, requestOptions, response => {
        let bytes = 0;
        response.on('data', chunk => { bytes += chunk.length; });
        response.once('error', error => settle(reject, error));
        response.once('end', () => {
          const location = response.headers && response.headers.location;
          if (Number(task.followRedirects) === 1 && location && response.statusCode >= 300 && response.statusCode < 400 && redirectCount < 5) {
            let next;
            try { next = new URL(location, target); } catch (_) { return settle(reject, new Error('重定向地址不正确')); }
            // 自定义请求头和正文可能包含凭据，仅允许同源跳转。
            if (next.origin !== target.origin) return settle(reject, new Error('已阻止跨源重定向，请直接使用目标 URL 测试'));
            return request(next, redirectCount + 1).then(value => { value.bytes += bytes; settle(resolve, value); }, error => settle(reject, error));
          }
          settle(resolve, { statusCode: Number(response.statusCode) || 0, bytes });
        });
      });
      pending.add(req);
      req.once('timeout', () => { const error = new Error('请求超时'); error.code = 'ETIMEDOUT'; req.destroy(error); });
      req.once('error', error => settle(reject, error));
      req.end(body.length ? body : undefined);
    } catch (error) { settle(reject, error); }
  });
}
function transportFor(target) { return target.protocol === 'https:' ? https : http; }

function launch(measured) {
  active += 1; issued += 1;
  if (stage) { if (measured) stage.issued += 1; else stage.warmupIssued += 1; }
  const started = Date.now();
  const segment = measured && stage && Date.now() - stage.phaseStartedAtMs >= stage.durationMs / 2 ? 'second' : 'first';
  request(parsedUrl).then(result => finishResult(result, Date.now() - started, measured, segment), error => finishResult({ error: trimError(error), timeout: error && error.code === 'ETIMEDOUT' }, Date.now() - started, measured, segment));
}
function finishResult(result, latency, measured, segment) {
  addResult(intervalStats, result, latency);
  if (result.statusCode) statusCodes[result.statusCode] = (statusCodes[result.statusCode] || 0) + 1;
  else {
    const key = trimError(result.error);
    if (errors[key] !== undefined) errors[key] += 1;
    else if (Object.keys(errors).length < 20) errors[key] = 1;
    else errors['其他错误'] = (errors['其他错误'] || 0) + 1;
  }
  if (stage && measured) {
    addResult(stage.measure, result, latency);
    addResult(segment === 'second' ? stage.secondHalf : stage.firstHalf, result, latency);
  }
  active = Math.max(0, active - 1);
  // 排空完成时同步最终阶段统计，主进程不能只依据上一秒的采样包判定极限。
  if (stage && active === 0 && ['warmup_drain', 'drain'].includes(stage.phase)) {
    emitStageState();
  }
  if (stopping) maybeDone();
}

function pump() {
  if (!running) return;
  const tick = Date.now();
  captureLoopLag(tick);
  if (!stopping && !stage && String(task.mode || 'fixed') === 'fixed') {
    const durationMs = Math.max(1, Number(task.durationSeconds) || 1) * 1000;
    const elapsed = Math.min(durationMs, Math.max(0, tick - startedAt));
    const desired = Math.floor(elapsed * Math.max(1, Number(task.targetQps) || 1) / 1000);
    const planned = Math.max(0, desired - fixedDesired);
    fixedDesired = desired;
    scheduled += planned;
    const missing = Math.max(0, desired - fixedIssued);
    const capacity = Math.max(0, Number(task.concurrency) - active);
    const smooth = Math.max(1, Math.ceil(Number(task.targetQps) * PUMP_INTERVAL_MS / 1000 * 2));
    const launchCount = Math.min(missing, capacity, MAX_LAUNCH_BATCH, smooth);
    fixedIssued += launchCount;
    for (let index = 0; index < launchCount; index += 1) launch(false);
    // 即使主进程因短暂卡顿未及时发出 stop，Worker 也必须在固定时长结束后自行收尾。
    if (elapsed >= durationMs) stopping = true;
  } else if (!stopping && stage && ['warmup', 'measure', 'confirm'].includes(stage.phase)) {
    const elapsed = Math.max(0, tick - stage.phaseStartedAtMs);
    const desired = Math.floor(Math.min(stage.durationMs, elapsed) * stage.target / 1000);
    const previous = stage.lastDesired;
    stage.lastDesired = desired;
    const missing = Math.max(0, desired - (stage.phase === 'warmup' ? stage.warmupIssued : stage.issued));
    if (missing > 0) {
      const capacity = Math.max(0, Number(task.concurrency) - active);
      const smooth = Math.max(1, Math.ceil(stage.target * PUMP_INTERVAL_MS / 1000 * 2));
      const launchCount = Math.min(missing, capacity, MAX_LAUNCH_BATCH, smooth);
      if (stage.phase !== 'warmup') {
        stage.schedulingTicks += 1;
        if (!capacity) stage.saturatedTicks += 1;
        else if (launchCount < missing) stage.generatorLagTicks += 1;
        if (launchCount < missing) stage.pumpLagMs = Math.max(stage.pumpLagMs, (missing - launchCount) * 1000 / Math.max(1, stage.target));
      }
      const planned = Math.max(0, desired - previous);
      stage.scheduled += stage.phase === 'warmup' ? 0 : planned;
      if (stage.phase === 'warmup') stage.warmupScheduled += planned;
      scheduled += planned;
      for (let index = 0; index < launchCount; index += 1) launch(stage.phase !== 'warmup');
    }
  }
  if (stopping) maybeDone();
}

function emitSample() {
  if (!running) return;
  const stats = intervalStats;
  intervalStats = accumulator();
  const payload = {
    type: 'sample', elapsedMs: Math.max(0, Date.now() - startedAt), scheduled, issued, active,
    scheduledDelta: Math.max(0, scheduled - lastSampleScheduled), issuedDelta: Math.max(0, issued - lastSampleIssued),
    eventLoopLagMs: maxEventLoopLagMs, statusCodes, errors, stats, stage: stageSnapshot(),
  };
  lastSampleScheduled = scheduled;
  lastSampleIssued = issued;
  maxEventLoopLagMs = 0;
  parentPort.postMessage(payload);
}

function maybeDone() {
  if (!running || !stopping || active > 0) return;
  if (timer) clearInterval(timer);
  if (sampleTimer) clearInterval(sampleTimer);
  emitSample();
  running = false;
  Object.values(agents).forEach(agent => agent.destroy());
  parentPort.postMessage({ type: 'done', scheduled, issued, active: 0 });
}
function start() {
  if (running) return;
  running = true; startedAt = Date.now(); lastTick = startedAt;
  timer = setInterval(pump, PUMP_INTERVAL_MS);
  sampleTimer = setInterval(emitSample, 1000);
  pump();
}
function setStage(next) {
  if (!next) return;
  if (stage && stage.stageNo === Number(next.stageNo)) {
    const previousPhase = stage.phase;
    stage.phase = String(next.phase || stage.phase);
    stage.phaseStartedAtMs = Date.now();
    stage.durationMs = Math.max(1, Number(next.durationMs) || stage.durationMs);
    stage.lastDesired = 0;
    if (['measure', 'confirm'].includes(stage.phase) && !['measure', 'confirm'].includes(previousPhase)) {
      stage.scheduled = 0; stage.issued = 0; stage.workerLagMs = 0;
    }
    emitStageState();
    return;
  }
  stage = {
    stageNo: Number(next.stageNo) || 0, phase: String(next.phase || 'warmup'), target: Math.max(1, Number(next.target) || 1),
    phaseStartedAtMs: Date.now(), durationMs: Math.max(1, Number(next.durationMs) || 1), lastDesired: 0,
    scheduled: 0, issued: 0, warmupScheduled: 0, warmupIssued: 0, schedulingTicks: 0, saturatedTicks: 0,
    generatorLagTicks: 0, pumpLagMs: 0, workerLagMs: 0, measure: accumulator(), firstHalf: accumulator(), secondHalf: accumulator(),
  };
  emitStageState();
}
function stop(graceful) {
  if (!running) return;
  stopping = true; stopDeadline = Date.now() + Math.max(1000, Number(task.timeoutMs) + 2000);
  if (timer) clearInterval(timer);
  if (!graceful) {
    const error = new Error('用户停止发压');
    error.code = 'ECANCELED';
    pending.forEach(req => req.destroy(error));
  }
  maybeDone();
  if (graceful && active > 0) setTimeout(() => { if (active > 0) { pending.forEach(req => req.destroy()); active = 0; maybeDone(); } }, Math.max(0, stopDeadline - Date.now()));
}

parentPort.on('message', message => {
  if (!message || !message.type) return;
  if (message.type === 'start') start();
  else if (message.type === 'set-stage') setStage(message.stage);
  else if (message.type === 'stop') stop(message.graceful !== false);
});

}
