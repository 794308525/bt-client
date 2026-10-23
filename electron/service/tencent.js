'use strict';

const { CommonClient } = require('tencentcloud-sdk-nodejs-common');
const { createHash } = require('crypto');
const { pub } = require('../class/public.js');

const VERSIONS = { billing: '2018-07-09', cvm: '2017-03-12', vpc: '2017-03-12', lighthouse: '2020-03-24', region: '2022-06-27', monitor: '2018-07-24' };
const TTL = 5 * 60 * 1000;
const DAY = 86400000;
const OFFSET = 8 * 3600000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const serverKey = server => `${server.source}:${server.region_id}:${server.instance_id}`;

async function mapLimit(items, limit, handler) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, limit) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await handler(items[index], index);
    }
  }));
  return result;
}

function errorOf(error, account) {
  const code = String(error && error.code || 'TencentCloudError').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120);
  let message = String(error && error.message || '腾讯云请求失败');
  if (account) {
    for (const value of [account.secret_id, account.secret_key]) {
      if (value) message = message.split(value).join('[已隐藏]');
    }
  }
  message = message.replace(/AKID[a-zA-Z0-9]+/g, '[已隐藏]').replace(/[\r\n<>]/g, ' ').slice(0, 400);
  if (/AuthFailure|UnauthorizedOperation/.test(code)) message = '凭据无效或缺少操作权限，请核对账号站点、SecretId、SecretKey 和 CAM 授权';
  if (/RequestLimitExceeded|LimitExceeded/.test(code)) message = '腾讯云查询频率或额度受限，请稍后刷新';
  if (/timeout|ETIMEDOUT|network|fetch failed/i.test(message)) message = '腾讯云请求超时或网络异常，请稍后刷新';
  const result = new Error(message);
  result.code = code;
  result.requestId = String(error && error.requestId || '').slice(0, 120);
  return result;
}

function validateServer(input) {
  const source = String(input.source || '');
  const instanceId = String(input.instance_id || '');
  const region = String(input.region_id || '');
  if (!['cvm', 'lighthouse'].includes(source) || !/^[a-z]{2}-[a-z0-9-]{2,40}$/.test(region) ||
      !(source === 'cvm' ? /^ins-[a-zA-Z0-9]+$/ : /^lhins-[a-zA-Z0-9]+$/).test(instanceId)) {
    throw new Error('服务器类型、地域或实例 ID 不正确');
  }
  return { source, region_id: region, instance_id: instanceId };
}

function normalizeInstance(raw, source, region) {
  const disks = [raw.SystemDisk, ...(raw.DataDisks || [])].filter(Boolean);
  return {
    source, instance_id: raw.InstanceId, name: raw.InstanceName || raw.InstanceId,
    region_id: region.region_id, region_name: region.name,
    zone: (raw.Placement || {}).Zone || raw.Zone || '', status: raw.InstanceState || 'UNKNOWN',
    os_name: raw.OsName || raw.Platform || '', cpu: raw.CPU ?? null, memory_gb: raw.Memory ?? null,
    disk_gb: disks.length ? disks.reduce((sum, disk) => sum + Number(disk.DiskSize || 0), 0) : null,
    bandwidth_mbps: (raw.InternetAccessible || {}).InternetMaxBandwidthOut ?? null,
    public_ips: raw.PublicIpAddresses || raw.PublicAddresses || [],
    private_ips: raw.PrivateIpAddresses || raw.PrivateAddresses || [],
    instance_type: raw.InstanceType || raw.BundleId || '', charge_type: raw.InstanceChargeType || '',
    expired_time: raw.ExpiredTime || '', created_time: raw.CreatedTime || '',
    latest_operation: raw.LatestOperation || '', latest_operation_state: raw.LatestOperationState || '',
    latest_operation_request_id: raw.LatestOperationRequestId || '',
  };
}

const dateLabel = time => new Date(time + OFFSET).toISOString().slice(0, 10);
function statisticsRange(now = Date.now()) {
  const date = new Date(now + OFFSET);
  const today = Math.floor((now + OFFSET) / DAY) * DAY - OFFSET;
  return { now, today, monthStart: Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) - OFFSET,
    start: Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1) - OFFSET };
}

// AccOuttraffic 的各粒度均为 sum，直接累加官方 MB 值；峰值带宽仅用于趋势图。
function aggregateOutbound(points, range, period = 3600) {
  const days = Array.from({ length: Math.floor((range.today - range.start) / DAY) + 1 }, (_, index) => ({
    date: dateLabel(range.start + index * DAY), out_mb: null, samples: 0, partial: false,
  }));
  const seen = new Set();
  for (const point of points) {
    if (!Number.isFinite(point.time) || !Number.isFinite(point.value) || point.value < 0 || seen.has(point.time)) continue;
    if (point.time < range.start || point.time >= range.now) continue;
    seen.add(point.time);
    const day = days[Math.floor((point.time - range.start) / DAY)];
    if (!day) continue;
    day.out_mb = (day.out_mb ?? 0) + point.value;
    day.samples++;
  }
  days.forEach((day, index) => {
    const expected = Math.ceil(Math.min(DAY, range.now - range.start - index * DAY) / (period * 1000));
    day.partial = day.out_mb === null || day.samples < expected;
  });
  const sum = rows => ({ out_mb: rows.some(day => day.out_mb !== null) ? rows.reduce((total, day) => total + (day.out_mb || 0), 0) : null,
    partial: !rows.length || rows.some(day => day.partial) });
  return { days: days.slice(-30), summary: {
    today: sum(days.filter(day => day.date === dateLabel(range.today))),
    yesterday: sum(days.filter(day => day.date === dateLabel(range.today - DAY))),
    this_month: sum(days.filter(day => day.date >= dateLabel(range.monthStart))),
    last_month: sum(days.filter(day => day.date < dateLabel(range.monthStart))),
  } };
}

function metricPoints(response) {
  return (response.DataPoints || []).flatMap(series => (series.Timestamps || []).map((time, index) => ({
    time: Number(time) * 1000,
    value: series.Values && series.Values[index] !== null && series.Values[index] !== undefined ? Number(series.Values[index]) : NaN,
  }))).filter(point => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value >= 0).sort((a, b) => a.time - b.time);
}

class TencentService {
  constructor() {
    this.cache = new Map();
    this.inflight = new Map();
    this.powerTasks = new Map();
  }

  getAccount(id) {
    const account = pub.M('tencent_account').where('account_id=?', Number(id) || 0).find();
    if (!account) throw new Error('指定腾讯云账号不存在');
    if (!['cn', 'intl'].includes(account.site)) throw new Error('腾讯云账号站点无效');
    if (!account.secret_id || !account.secret_key || [account.secret_id, account.secret_key].some(value => String(value).startsWith('BTx:'))) throw new Error('无法读取账号凭据，请解锁客户端或重新保存凭据');
    return account;
  }

  safeAccount(account) {
    if (!account) return null;
    const { secret_key: _key, ...safe } = account;
    return safe;
  }

  accountKey(account) {
    return `${account.account_id}:${createHash('sha256').update(`${account.site}:${account.secret_id}:${account.secret_key}`).digest('hex')}`;
  }

  isCurrent(account) {
    try { return this.accountKey(this.getAccount(account.account_id)) === this.accountKey(account); } catch (_) { return false; }
  }

  updateAccount(account, data) {
    if (this.isCurrent(account)) pub.M('tencent_account').where('account_id=?', account.account_id).update(data);
  }

  clearAccountCache(id) {
    for (const key of this.cache.keys()) if (key.startsWith(`${id}:`)) this.cache.delete(key);
  }

  async cached(key, ttl, force, handler, account) {
    const existing = this.cache.get(key);
    if (!force && existing && Date.now() - existing.time < ttl) return existing.data;
    if (this.inflight.has(key)) return this.inflight.get(key);
    const promise = Promise.resolve().then(handler).then(data => {
      if (this.isCurrent(account)) {
        if (this.cache.size >= 300) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { time: Date.now(), data });
      }
      return data;
    }).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  async request(account, service, action, params = {}, region = '', write = false) {
    const suffix = account.site === 'intl' ? 'intl.tencentcloudapi.com' : 'tencentcloudapi.com';
    const endpoint = region.endsWith('-fsi') ? `${service}.${region}.${suffix}` : `${service}.${suffix}`;
    const client = new CommonClient(endpoint, VERSIONS[service], {
      credential: { secretId: account.secret_id, secretKey: account.secret_key }, region,
      profile: { signMethod: 'TC3-HMAC-SHA256', language: 'zh-CN', httpProfile: { reqTimeout: 15 } },
    });
    for (let attempt = 0; ; attempt++) {
      try { return await client.request(action, params); }
      catch (error) {
        // 写操作绝不重试，网络超时不等于腾讯云未受理操作。
        if (write || attempt >= 1 || !/RequestLimitExceeded|InternalError|ETIMEDOUT/.test(String(error.code || error.message))) throw errorOf(error, account);
        await sleep(500 * (attempt + 1));
      }
    }
  }

  async refreshBalance(id, force = true) {
    const account = this.getAccount(id);
    return this.cached(`${this.accountKey(account)}:balance`, TTL, force, async () => {
      try {
        const result = await this.request(account, 'billing', 'DescribeAccountBalance');
        const amount = result.RealBalance ?? result.Balance;
        if (amount === null || amount === undefined || !Number.isFinite(Number(amount)) || Math.abs(Number(amount)) > Number.MAX_SAFE_INTEGER) throw new Error('腾讯云返回的余额无效');
        const fields = { balance: (Number(amount) / 100).toFixed(2), balance_currency: account.site === 'intl' ? 'USD' : 'CNY',
          balance_refresh_time: pub.time(), balance_error: '' };
        this.updateAccount(account, fields);
        return fields;
      } catch (error) {
        this.updateAccount(account, { balance_error: error.message });
        throw error;
      }
    }, account);
  }

  async getRegions(account, source) {
    return this.cached(`${this.accountKey(account)}:regions:${source}`, DAY, false, async () => {
      const result = source === 'cvm'
        ? await this.request(account, 'region', 'DescribeRegions', { Product: 'cvm' })
        : await this.request(account, 'lighthouse', 'DescribeRegions');
      const regions = result.RegionSet;
      if (!Array.isArray(regions) || !regions.length) throw new Error(`${source === 'cvm' ? 'CVM' : '轻量'}地域列表为空，无法确认服务器数量`);
      return regions.filter(item => item.Region).map(item => ({ region_id: item.Region, name: item.RegionName || item.Region }));
    }, account);
  }

  async fetchRegion(account, source, region) {
    const items = [];
    for (let offset = 0; offset < 100000; offset += 100) {
      const result = await this.request(account, source, 'DescribeInstances', { Offset: offset, Limit: 100 }, region.region_id);
      if (!Array.isArray(result.InstanceSet) || !Number.isFinite(Number(result.TotalCount))) throw new Error('腾讯云实例列表返回格式无效');
      items.push(...result.InstanceSet.map(raw => normalizeInstance(raw, source, region)));
      if (offset + result.InstanceSet.length >= Number(result.TotalCount)) return items;
      if (!result.InstanceSet.length) throw new Error('腾讯云实例分页返回不完整，请重新刷新');
    }
    throw new Error('单地域服务器数量超过查询上限，请缩小账号授权范围');
  }

  async listServers(id, force = false) {
    const account = this.getAccount(id);
    const result = await this.cached(`${this.accountKey(account)}:servers`, TTL, force, async () => {
      const failures = [];
      const tasks = [];
      const complete = { cvm: true, lighthouse: true };
      await Promise.all(['cvm', 'lighthouse'].map(async source => {
        try { const regions = await this.getRegions(account, source); regions.forEach(region => tasks.push({ source, region })); }
        catch (error) { complete[source] = false; failures.push({ source, region_id: '', message: error.message }); }
      }));
      let succeeded = 0;
      const lists = await mapLimit(tasks, 3, async ({ source, region }) => {
        try { const list = await this.fetchRegion(account, source, region); succeeded++; return list; }
        catch (error) { complete[source] = false; failures.push({ source, region_id: region.region_id, message: error.message, request_id: error.requestId }); return []; }
      });
      const message = failures.map(item => `${item.source === 'cvm' ? 'CVM' : '轻量'}${item.region_id ? ` / ${item.region_id}` : ''}：${item.message}`).join('；');
      if (!succeeded && failures.length) {
        this.updateAccount(account, { server_error: message });
        throw new Error(message);
      }
      const data = lists.flat().sort((a, b) => a.region_id.localeCompare(b.region_id) || a.name.localeCompare(b.name));
      const fields = { server_error: message, server_refresh_time: pub.time(),
        cvm_count: complete.cvm ? data.filter(item => item.source === 'cvm').length : -1,
        lighthouse_count: complete.lighthouse ? data.filter(item => item.source === 'lighthouse').length : -1,
        server_count: complete.cvm && complete.lighthouse ? data.length : -1 };
      this.updateAccount(account, fields);
      return { data, failures, partial: failures.length > 0, ...fields };
    }, account);
    return { ...result, data: result.data.map(server => ({ ...server, pending: this.powerTasks.get(this.taskKey(account, server)) || null })) };
  }

  async refreshSummary(id, force = true) {
    await Promise.allSettled([this.refreshBalance(id, force), this.listServers(id, force)]);
    return this.safeAccount(this.getAccount(id));
  }

  async fetchServer(account, descriptor) {
    const server = validateServer(descriptor);
    const result = await this.request(account, server.source, 'DescribeInstances', { InstanceIds: [server.instance_id] }, server.region_id);
    const instance = (result.InstanceSet || []).find(raw => raw.InstanceId === server.instance_id);
    if (!instance) throw new Error('实例不存在或当前账号无权访问');
    return normalizeInstance(instance, server.source, { region_id: server.region_id, name: server.region_id });
  }

  taskKey(account, server) { return `${this.accountKey(account)}:${serverKey(server)}`; }

  async serverState(id, descriptor) {
    const account = this.getAccount(id);
    const server = await this.fetchServer(account, descriptor);
    const key = this.taskKey(account, server);
    const pending = this.powerTasks.get(key);
    let failed = false;
    if (pending) {
      const target = pending.action === 'start' ? 'RUNNING' : 'STOPPED';
      failed = server.latest_operation_request_id === pending.request_id && ['FAILED', 'FAIL'].includes(server.latest_operation_state);
      if (server.status === target || failed || Date.now() - pending.time > 10 * 60 * 1000) {
        this.powerTasks.delete(key);
        this.clearAccountCache(id);
      }
    }
    return { ...server, pending: this.powerTasks.get(key) || null, operation_failed: failed };
  }

  async power(id, descriptor, action, confirmId) {
    const account = this.getAccount(id);
    const target = validateServer(descriptor);
    if (!['start', 'stop'].includes(action)) throw new Error('仅支持开机和正常关机');
    if (action === 'stop' && confirmId !== target.instance_id) throw new Error('关机目标尚未确认');
    for (const [key, task] of this.powerTasks) if (Date.now() - task.time > 10 * 60 * 1000) this.powerTasks.delete(key);
    const key = this.taskKey(account, target);
    const currentTask = this.powerTasks.get(key);
    if (currentTask && Date.now() - currentTask.time < 10 * 60 * 1000) throw new Error('该实例已有操作待确认，请刷新实例状态后再操作');
    // 在查询前占位，防止多个 IPC 请求同时通过实例状态检查。
    const task = { action, time: Date.now(), request_id: '', uncertain: false };
    this.powerTasks.set(key, task);
    let submitted = false;
    try {
      const server = await this.fetchServer(account, target);
      if (server.status !== (action === 'start' ? 'STOPPED' : 'RUNNING')) throw new Error(`实例当前状态为 ${server.status}，无法${action === 'start' ? '开机' : '关机'}`);
      if (!this.isCurrent(account)) throw new Error('账号凭据已变更，请刷新页面后操作');
      const params = { InstanceIds: [server.instance_id] };
      if (action === 'stop') {
        params.StopType = 'SOFT';
        if (server.source === 'cvm') params.StoppedMode = 'KEEP_CHARGING';
      }
      submitted = true;
      const result = await this.request(account, server.source, action === 'start' ? 'StartInstances' : 'StopInstances', params, server.region_id, true);
      task.request_id = result.RequestId || '';
      this.clearAccountCache(id);
      return { ...task, status: action === 'start' ? 'STARTING' : 'STOPPING' };
    } catch (error) {
      if (submitted && !/^(AuthFailure|UnauthorizedOperation|InvalidParameter|MissingParameter|UnsupportedOperation|OperationDenied|ResourceNotFound|ResourceUnavailable|LimitExceeded|RequestLimitExceeded)/.test(error.code || '')) {
        task.uncertain = true;
        throw new Error('操作结果尚未确认，请查询实例状态后再操作，避免重复下发');
      }
      this.powerTasks.delete(key);
      throw error;
    }
  }

  async monitor(account, server, metric, start, end, period) {
    const result = await this.request(account, 'monitor', 'GetMonitorData', {
      Namespace: server.source === 'cvm' ? 'QCE/CVM' : 'QCE/LIGHTHOUSE', MetricName: metric,
      Instances: [{ Dimensions: [{ Name: 'InstanceId', Value: server.instance_id }] }],
      Period: period, StartTime: new Date(start).toISOString(), EndTime: new Date(end).toISOString(),
    }, server.region_id);
    if (result.Msg && !(result.DataPoints || []).length) throw new Error(result.Msg);
    return { points: metricPoints(result), period: Number(result.Period) || period };
  }

  async traffic(id, descriptor, force = false) {
    const account = this.getAccount(id);
    const target = validateServer(descriptor);
    return this.cached(`${this.accountKey(account)}:traffic:${serverKey(target)}`, TTL, force, async () => {
      const server = await this.fetchServer(account, target);
      const result = { server_key: serverKey(server), update_time: pub.time(), summary: null, days: [], packages: [], errors: [] };
      try {
        if (server.source === 'cvm') {
          const range = statisticsRange();
          const cumulative = await this.monitor(account, server, 'AccOuttraffic', range.start, range.now, 3600);
          Object.assign(result, aggregateOutbound(cumulative.points, range, cumulative.period));
        } else {
          const packages = await this.request(account, 'lighthouse', 'DescribeInstancesTrafficPackages', { InstanceIds: [server.instance_id], Limit: 100 }, server.region_id);
          const bytes = value => value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
          result.packages = (packages.InstanceTrafficPackageSet || []).filter(item => item.InstanceId === server.instance_id)
            .flatMap(item => item.TrafficPackageSet || []).map(item => ({
              id: item.TrafficPackageId, total: bytes(item.TrafficPackageTotal), used: bytes(item.TrafficUsed),
              remaining: bytes(item.TrafficPackageRemaining), overflow: bytes(item.TrafficOverflow),
              start_time: item.StartTime || '', end_time: item.EndTime || '', status: item.Status || '',
            }));
        }
      } catch (error) {
        result.errors.push(`${server.source === 'cvm' ? '出站累计' : '套餐用量'}：${error.message}`);
      }
      return result;
    }, account);
  }

  async statistics(id, descriptor, days = 1, force = false) {
    const account = this.getAccount(id);
    const target = validateServer(descriptor);
    if (![1, 7, 30].includes(Number(days))) throw new Error('请选择近 24 小时、7 天或 30 天');
    return this.cached(`${this.accountKey(account)}:statistics:${serverKey(target)}:${days}`, TTL, force, async () => {
      const server = await this.fetchServer(account, target);
      const now = Date.now();
      const start = now - Number(days) * DAY;
      const period = Number(days) === 1 ? 300 : 3600;
      const errors = [];
      const read = async (name, handler) => {
        try { return await handler(); } catch (error) { errors.push(`${name}：${error.message}`); return null; }
      };
      const [inbound, outbound, traffic] = await Promise.all([
        read('入站带宽', () => this.monitor(account, server, server.source === 'cvm' ? 'WanIntraffic' : 'LighthouseIntraffic', start, now, period)),
        read('出站带宽', () => this.monitor(account, server, server.source === 'cvm' ? 'WanOuttraffic' : 'LighthouseOuttraffic', start, now, period)),
        read('流量用量', () => this.traffic(id, server, force)),
      ]);
      const rows = new Map();
      for (const [direction, result] of [['in_mbps', inbound], ['out_mbps', outbound]]) {
        for (const point of result && result.points || []) {
          if (point.time < start || point.time > now) continue;
          const row = rows.get(point.time) || { time: point.time, in_mbps: null, out_mbps: null };
          row[direction] = point.value * (server.source === 'lighthouse' ? 8 : 1);
          rows.set(point.time, row);
        }
      }
      if (traffic) errors.push(...traffic.errors);
      return { server_key: serverKey(server), update_time: pub.time(), trend_days: Number(days),
        trend_period: Math.max(inbound && inbound.period || period, outbound && outbound.period || period),
        trend: Array.from(rows.values()).sort((a, b) => a.time - b.time),
        summary: traffic && traffic.summary, days: traffic && traffic.days || [], packages: traffic && traffic.packages || [], errors,
        note: '带宽趋势为对应采样周期的峰值。CVM 累计出站使用官方流量求和指标；入站及轻量历史每日累计缺少可靠指标时不换算。统计不作为账单依据。' };
    }, account);
  }
}

const tencentService = new TencentService();
module.exports = { tencentService, TencentService, errorOf, validateServer, normalizeInstance, aggregateOutbound, statisticsRange, metricPoints, mapLimit };
