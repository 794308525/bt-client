'use strict';

const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const { randomBytes } = require('crypto');
const { setMaxListeners } = require('events');
const { aliyunService } = require('./aliyun.js');

const PORTS = [80, 443, 22, 3389];
const JOB_TTL = 30 * 60 * 1000;

function hostname(value) {
  const text = String(value || '').trim().replace(/\.$/, '');
  if (!text || /[\s/:@*\\?#_]/.test(text)) return '';
  try {
    const host = new URL(`https://${text}`).hostname;
    return host.length <= 253 && host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ? host : '';
  } catch { return ''; }
}

function recordHostname(record, scope) {
  if (scope.provider === 'esa') return record.record_name === '@' ? scope.name : record.record_name;
  const domain = record.domain_name || scope.domain_name;
  return record.rr === '@' ? domain : `${record.rr}.${domain}`;
}

async function mapLimit(items, limit, handler) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) { const current = index++; await handler(items[current], current); }
  }));
}

// 使用总时限，避免持续收包、DNS 等待或取消后仍占用连接。
function timedProbe(create, signal, timeout = 3000) {
  return new Promise(resolve => {
    let settled = false, connection, timer;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      if (connection) connection.destroy();
      resolve(result);
    };
    const abort = () => finish({ error: '检测已停止' });
    if (signal.aborted) return abort();
    timer = setTimeout(() => finish({ error: '连接超时' }), timeout);
    signal.addEventListener('abort', abort, { once: true });
    try {
      connection = create(finish);
      if (settled && connection) connection.destroy();
    } catch (error) { finish({ error: String(error.code || error.message || error) }); }
  });
}

function checkPort(address, port, signal) {
  return timedProbe(finish => {
    const socket = net.createConnection({ host: address, port });
    socket.once('connect', () => finish({ open: true }));
    socket.once('error', error => finish({ error: String(error.code || error.message) }));
    return socket;
  }, signal).then(result => ({ port, open: false, ...result }));
}

function checkWebsite(address, host, secure, signal) {
  const protocol = secure ? 'HTTPS' : 'HTTP';
  return timedProbe(finish => {
    const req = (secure ? https : http).request({
      hostname: address, port: secure ? 443 : 80, method: 'HEAD', path: '/', agent: false,
      servername: host, rejectUnauthorized: true,
      headers: { Host: host, 'User-Agent': 'bt-client-record-check', Connection: 'close' },
    }, response => {
      finish({ status_code: response.statusCode });
      response.destroy();
    });
    req.once('error', error => finish({ error: String(error.code || error.message) }));
    req.end();
    return req;
  }, signal, 4000).then(result => ({ protocol, ...result }));
}

async function probeRecord(record, scope, signal) {
  const name = String(recordHostname(record, scope) || '');
  const type = String(record.type || '').toUpperCase();
  const base = { record_id: String(record.record_id), hostname: name, type, value: record.value, locked: !!record.locked, endpoints: [], website: '', ports: '' };
  if (!['A', 'AAAA', 'A/AAAA', 'CNAME'].includes(type)) return { ...base, status: 'skipped', reason: '该类型不使用网站和 IP 端口判定' };
  const host = hostname(name);
  let addresses;
  if (type === 'CNAME') {
    const target = hostname(record.value);
    if (!target) return { ...base, status: 'skipped', reason: 'CNAME 目标不是可检测的域名' };
    const resolved = await timedProbe(finish => {
      dns.lookup(target, { all: true }, (error, values) => finish(error ? { error: String(error.code || error.message) } : { addresses: values.map(item => item.address) }));
    }, signal);
    if (resolved.error) return { ...base, status: host && ['ENOTFOUND', 'ENODATA'].includes(resolved.error) ? 'suspect' : 'unknown', reason: `目标域名解析失败：${resolved.error}`, website: '目标域名解析失败', ports: '未取得目标 IP' };
    addresses = [...new Set(resolved.addresses)];
  } else {
    addresses = [...new Set(String(record.value || '').split(/[,;\s]+/).filter(Boolean))];
    if (!addresses.length || addresses.some(address => !net.isIP(address))) return { ...base, status: 'skipped', reason: '记录值不是有效的 IP 地址' };
  }
  if (!addresses.length || addresses.some(address => address === '0.0.0.0' || address === '::')) return { ...base, status: 'skipped', reason: '目标没有可检测的 IP 地址' };
  const truncated = addresses.length > 16;
  const endpoints = [];
  await mapLimit(addresses.slice(0, 16), 2, async address => {
    if (signal.aborted) return;
    const [ports, web] = await Promise.all([
      Promise.all(PORTS.map(port => checkPort(address, port, signal))),
      host ? Promise.all([false, true].map(secure => checkWebsite(address, host, secure, signal))) : Promise.resolve([]),
    ]);
    endpoints.push({ address, ports, web });
  });
  const responses = endpoints.flatMap(item => item.web).filter(item => item.status_code);
  const openPorts = endpoints.flatMap(item => item.ports).filter(item => item.open);
  const protocolError = item => /^(CERT_|ERR_TLS_|ERR_SSL_|DEPTH_ZERO_|UNABLE_TO_|SELF_SIGNED_|EPROTO|HPE_)/.test(item.error || '');
  const protocolEvidence = endpoints.some(item => item.web.some(protocolError));
  const networkErrors = endpoints.flatMap(item => [...item.web, ...item.ports]).filter(item => ['ENETUNREACH', 'EHOSTUNREACH', 'EAFNOSUPPORT', 'EACCES', 'EPERM'].includes(item.error));
  const failedEndpoints = endpoints.filter(item => !item.ports.some(port => port.open) && !item.web.some(web => web.status_code || protocolError(web)));
  const website = !host ? '泛域名或非网站主机名，未检测' : responses.length ? [...new Set(responses.map(item => `${item.protocol} ${item.status_code}`))].join(' / ') : protocolEvidence ? '证书、握手或 HTTP 协议异常' : 'HTTP、HTTPS 均未取得响应';
  const ports = openPorts.length ? [...new Set(openPorts.map(item => item.port))].sort((a, b) => a - b).join('、') + ' 可连接' : '80、443、22、3389 均未连接';
  const active = responses.length || openPorts.length || protocolEvidence;
  const warning = failedEndpoints.length || !responses.some(item => item.status_code >= 200 && item.status_code < 400) || truncated;
  const status = active ? warning ? 'warning' : 'reachable' : !host || truncated || networkErrors.length ? 'unknown' : 'suspect';
  const reason = truncated ? '目标 IP 超过 16 个，只展示前 16 个的结果' : active ? warning ? '目标有服务响应，请核对网站状态或部分 IP' : '网站有响应，目标仍在提供服务' : !host ? '缺少具体网站域名，不能据此判定失效' : networkErrors.length ? `本机网络无法判断目标：${networkErrors[0].error}` : '网站及常用端口均未响应，仅列为疑似失效';
  return { ...base, endpoints, website, ports, status, reason };
}

function fingerprint(record) {
  const canonical = value => value && typeof value === 'object'
    ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
  const { record_id, update_time, ...data } = record;
  return JSON.stringify(canonical(data));
}

class RecordCheckService {
  constructor(service = aliyunService) { this.service = service; this.jobs = new Map(); }

  cleanup() {
    for (const [id, job] of this.jobs) if (!job.deleting && job.finished_at && Date.now() - job.finished_at > JOB_TTL) this.jobs.delete(id);
  }

  start(accountId, options, owner) {
    this.cleanup();
    this.service.getAccount(accountId);
    if (!['dns', 'esa'].includes(options.provider)) throw new Error('解析检测类型不正确');
    if ([...this.jobs.values()].filter(job => ['loading', 'running'].includes(job.state)).length >= 2) throw new Error('最多同时执行两个解析检测任务，请先停止其他检测');
    for (const [id, previous] of this.jobs) if (this.jobs.size >= 8 && previous.finished_at && !previous.deleting) this.jobs.delete(id);
    if (this.jobs.size >= 8) throw new Error('检测任务较多，请等待其他任务完成');
    const domain = options.provider === 'dns' ? hostname(options.domain_name) : '';
    if (options.provider === 'dns' && !domain) throw new Error('请选择要检测的域名');
    const scope = options.provider === 'dns'
      ? { provider: 'dns', domain_name: domain, name: domain }
      : { provider: 'esa', site_id: String(this.service.normalizeEsaSiteId(options.site_id)), name: String(options.site_name || '') };
    const job = { id: randomBytes(16).toString('hex'), accountId: Number(accountId), ownerId: owner.id, scope, state: 'loading', total: 0, loaded: 0, checked: 0, version: 0, results: new Map(), original: new Map(), controller: new AbortController(), error: '', finished_at: 0, deleting: false };
    // 最多 3 条记录 × 2 个 IP × 6 个探测共享取消信号，各探测结束后移除监听。
    setMaxListeners(40, job.controller.signal);
    this.jobs.set(job.id, job);
    const onDestroyed = () => { if (this.jobs.has(job.id)) this.cancel(job.accountId, job.id, owner.id); };
    owner.once('destroyed', onDestroyed);
    this.run(job).finally(() => { if (!owner.isDestroyed()) owner.removeListener('destroyed', onDestroyed); });
    return this.snapshot(job);
  }

  async run(job) {
    try {
      const records = await this.service.getRecordCheckSnapshot(job.accountId, job.scope, progress => {
        if (job.controller.signal.aborted) throw new Error('检测已停止');
        if (progress) Object.assign(job, progress);
      });
      if (job.controller.signal.aborted) return;
      job.total = records.length;
      job.original = new Map(records.map(record => [String(record.record_id), record]));
      job.state = 'running';
      await mapLimit(records, 3, async record => {
        if (job.controller.signal.aborted) return;
        let result;
        try { result = await probeRecord(record, job.scope, job.controller.signal); }
        catch (error) { result = { record_id: String(record.record_id), hostname: recordHostname(record, job.scope), type: record.type, value: record.value, status: 'unknown', reason: String(error.message || error), endpoints: [] }; }
        if (job.controller.signal.aborted) return;
        job.checked += 1;
        this.update(job, result);
      });
      if (!job.controller.signal.aborted) job.state = 'completed';
    } catch (error) {
      if (!job.controller.signal.aborted) { job.state = 'failed'; job.error = String(error.message || error); }
    } finally { job.finished_at = Date.now(); }
  }

  update(job, result) { job.results.set(result.record_id, { ...result, version: ++job.version }); }

  job(accountId, id, ownerId) {
    this.cleanup();
    const job = this.jobs.get(String(id));
    if (!job || job.accountId !== Number(accountId) || job.ownerId !== ownerId) throw new Error('检测任务不存在或已过期，请重新检测');
    return job;
  }

  snapshot(job, after = 0) {
    const rows = [...job.results.values()];
    return { id: job.id, scope: job.scope, state: job.state, total: job.total, loaded: job.loaded, checked: job.checked, version: job.version, error: job.error, counts: Object.fromEntries(['reachable', 'warning', 'suspect', 'unknown', 'skipped', 'deleted', 'changed'].map(state => [state, rows.filter(row => row.status === state).length])), results: rows.filter(row => row.version > Number(after || 0)) };
  }

  status(accountId, id, ownerId, after) { return this.snapshot(this.job(accountId, id, ownerId), after); }

  cancel(accountId, id, ownerId) {
    const job = this.job(accountId, id, ownerId);
    if (['loading', 'running'].includes(job.state)) {
      job.state = 'cancelled'; job.finished_at = Date.now(); job.controller.abort();
    }
    return this.snapshot(job);
  }

  async remove(accountId, id, ownerId, recordIds) {
    const job = this.job(accountId, id, ownerId);
    if (['loading', 'running'].includes(job.state) || job.deleting) throw new Error('请等待检测或删除完成');
    const ids = this.service.normalizeRecordIds(recordIds);
    if (ids.some(recordId => {
      const result = job.results.get(recordId);
      return !result || !job.original.has(recordId) || result.locked || !['reachable', 'warning', 'suspect', 'unknown', 'skipped'].includes(result.status);
    })) throw new Error('请选择本次检测中未删除、未变化且未锁定的记录');
    job.deleting = true;
    let success_count = 0;
    const failures = [];
    try {
      // 删除前重新读取整个域名/站点，阻止依据旧结果删除已修改的记录。
      const current = new Map((await this.service.getRecordCheckSnapshot(accountId, job.scope)).map(record => [String(record.record_id), record]));
      await mapLimit(ids, 3, async recordId => {
        const result = job.results.get(recordId);
        const record = current.get(recordId);
        if (!record || record.locked || fingerprint(record) !== fingerprint(job.original.get(recordId))) {
          const reason = record ? '记录已修改或锁定，请重新检测' : '记录已不存在';
          this.update(job, { ...result, status: 'changed', reason });
          failures.push({ record_id: recordId, message: reason });
          return;
        }
        try {
          if (job.scope.provider === 'esa') await this.service.deleteEsaRecord(accountId, recordId);
          else await this.service.deleteRecord(accountId, recordId);
          success_count += 1;
          this.update(job, { ...result, status: 'deleted', reason: '已删除', delete_error: '' });
        } catch (error) {
          const message = String(error.message || error);
          failures.push({ record_id: recordId, message });
          this.update(job, { ...result, delete_error: message });
        }
      });
      return { success_count, failure_count: failures.length, failures, job: this.snapshot(job) };
    } finally { job.deleting = false; job.finished_at = Date.now(); }
  }

  stopAll() { for (const job of this.jobs.values()) if (['loading', 'running'].includes(job.state)) this.cancel(job.accountId, job.id, job.ownerId); }
}

module.exports = { recordCheckService: new RecordCheckService(), RecordCheckService, probeRecord };
