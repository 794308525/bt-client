'use strict';

const { createHash } = require('crypto');
const Bss = require('@alicloud/bssopenapi20171214');
const Swas = require('@alicloud/swas-open20200601');
const { aliyunService, normalizeError, AliyunServiceError } = require('./aliyun');

const GB = 1024 ** 3;
const TTL = 5 * 60 * 1000;
const FREE_LIMITS = [{ key: 'mainland', label: '中国内地', total_bytes: 20 * GB }, { key: 'overseas', label: '非中国内地', total_bytes: 200 * GB }];
const PUBLIC_ITEMS = new Set(['ECS_Out_Bytes', 'Eip_Out_Bytes', 'clb_out_bytes', 'Cbwp_Out_Bytes', 'Cbwp_Max_Bytes', 'IPv6_Out_Bytes', 'GA_Max_Bytes', 'Fc_Out_Bytes', 'MSE_Out_Bytes', 'PAI_Eas_Out_Bytes', 'Anycast_Max_Bytes', 'nativeapigw_Out_Bytes', 'Miniappdev_Out_Bytes']);

function nonnegative(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
}

function bytes(value, unit) {
  const number = nonnegative(value);
  const power = { b: 0, byte: 0, bytes: 0, kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3, tb: 4, tib: 4 }[String(unit || '').trim().toLowerCase()];
  return number !== null && power !== undefined ? nonnegative(number * 1024 ** power) : null;
}

function bodyOf(response) {
  const body = response && response.body;
  if (!body || body.success === false || body.code && body.code !== 'Success') {
    throw new AliyunServiceError(body && body.message || '额度接口返回异常', body && body.code || 'InvalidAllowanceResponse', body && body.requestId || '');
  }
  return body;
}

function trafficPackage(item, now) {
  const products = (item.applicableProducts && item.applicableProducts.product || []).flatMap(value => {
    try { const parsed = JSON.parse(value); return typeof parsed === 'object' && parsed ? parsed.Product || [] : [value]; } catch { return [value]; }
  }).map(String).sort();
  const name = String(item.remark || '');
  const type = String(item.packageType || '');
  const commodity = String(item.commodityCode || '');
  const related = /^(flowpack|cdt)(_|$)/i.test(commodity) || /^FPT_(generalnetwork|flowpack|cdt)(_|$)/i.test(type)
    || products.some(value => ['flowpack', 'cdt'].includes(value.toLowerCase()))
    || /共享流量包|通用流量包|CDT.*(流量|资源包)|云数据传输.*(流量|资源包)/i.test(name)
    || products.some(value => ['ecs', 'eip', 'slb', 'cbwp'].includes(value.toLowerCase())) && /流量|traffic|network/i.test(`${name} ${type}`);
  if (!related || item.status !== 'Available') return null;
  const expires = Date.parse(item.expiryTime);
  if (Number.isFinite(expires) && expires <= now) return null;
  const effective = Date.parse(item.effectiveTime);
  const total = bytes(item.totalAmount, item.totalAmountUnit);
  const remaining = bytes(item.remainingAmount, item.remainingAmountUnit);
  return {
    instance_id: String(item.instanceId || ''), name: name || type || commodity,
    package_type: type, region: String(item.region || ''), products,
    // 用完整类型作为分组条件，避免把全时、闲时和不同抵扣用途的额度合并。
    scope_key: JSON.stringify([item.region || '', type || item.instanceId, commodity, products, name]),
    scope_label: [name, item.region].filter(Boolean).join(' · ') || '适用范围待确认',
    total_bytes: total, remaining_bytes: remaining,
    used_bytes: total !== null && remaining !== null && total >= remaining ? total - remaining : null,
    total_label: `${item.totalAmount ?? '--'} ${item.totalAmountUnit || ''}`.trim(),
    remaining_label: `${item.remainingAmount ?? '--'} ${item.remainingAmountUnit || ''}`.trim(),
    effective_time: item.effectiveTime || '', expiry_time: item.expiryTime || '',
    pending: Number.isFinite(effective) && effective > now,
    expiring: Number.isFinite(expires) && expires - now <= 7 * 86400000,
    low: total > 0 && remaining !== null && remaining / total <= 0.2,
  };
}

function summarizeCdt(rows, accountId) {
  const pools = FREE_LIMITS.map(pool => ({ ...pool, used_bytes: null, remaining_bytes: null }));
  const sums = { mainland: 0, overseas: 0 };
  const reasons = new Set();
  if (!rows.length) reasons.add('本月暂无 CDT 账单');
  let matched = 0;
  let unknown = false;
  for (const row of rows) {
    // 多账号代付账单不能混入当前账号的共享额度。
    if (!accountId || !row.ownerID) { unknown = true; reasons.add('账单缺少账号归属字段'); continue; }
    if (String(row.ownerID) !== String(accountId)) continue;
    const commodity = String(row.commodityCode || '');
    if (/^cdt_(cdtir|cucbdt)_/.test(commodity)) continue;
    if (!/^cdt_internet_public_(cn|intl)$/.test(commodity) || !PUBLIC_ITEMS.has(row.billingItemCode)) {
      unknown = true;
      reasons.add(/^cdt_DataTransfer_/.test(commodity) || row.billingItemCode === 'internet_traffic' ? 'CDT 2.0 账单尚缺免费额度识别字段' : '账单包含尚未支持识别的商品或计费项');
      continue;
    }
    // 仅识别文档明确的 CDT 1.0 出账标识；2.0 缺少费用类型字段时不猜余额。
    const parts = String(row.instanceID || '').match(/^[^;]+;([a-z0-9-]+);BGP;(\d+)$/);
    if (!parts) { unknown = true; reasons.add('账单实例标识不符合已支持的格式'); continue; }
    const region = parts[1];
    const pool = region === 'cn-hongkong' || /^(ap|eu|us|me|na|sa|af|cn-hongkong)-/.test(region) ? 'overseas' : /^cn-/.test(region) ? 'mainland' : '';
    const usage = bytes(row.usage, row.usageUnit);
    const price = nonnegative(row.listPrice);
    if (!pool || usage === null || price === null || row.item !== 'PayAsYouGoBill' || (parts[2] === '0') !== (price === 0)) {
      unknown = true;
      if (!pool) reasons.add('账单地域暂无法识别');
      if (usage === null || price === null) reasons.add('账单缺少有效用量、单位或单价');
      if (row.item !== 'PayAsYouGoBill') reasons.add('账单含退款、调账或其他未支持的类型');
      if (price !== null && (parts[2] === '0') !== (price === 0)) reasons.add('免费阶梯与单价不一致');
      continue;
    }
    matched++;
    if (parts[2] === '0') sums[pool] += usage;
  }
  if (matched && !unknown && pools.every(pool => sums[pool.key] <= pool.total_bytes)) {
    pools.forEach(pool => { pool.used_bytes = sums[pool.key]; pool.remaining_bytes = pool.total_bytes - sums[pool.key]; });
  }
  if (pools.some(pool => sums[pool.key] > pool.total_bytes)) reasons.add('免费用量超过月额度，汇总结果需核对');
  if (!matched && !reasons.size) reasons.add('没有可核对当前账号免费额度的公网账单');
  return { pools, verified: pools.every(pool => pool.used_bytes !== null), has_bills: rows.length > 0, reasons: [...reasons] };
}

class ServerAllowanceService {
  constructor(service = aliyunService) {
    this.service = service;
    this.cache = new Map();
    this.requests = new Map();
  }

  async get(accountId, options = {}) {
    const section = String(options.section || '');
    if (!['cdt', 'packages', 'swas'].includes(section)) throw new AliyunServiceError('流量额度查询类型不正确', 'InvalidAllowanceSection');
    const account = this.service.getAccount(accountId);
    const month = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7);
    const fingerprint = createHash('sha256').update(`${account.access_key_id}:${account.access_key_secret}`).digest('hex');
    const key = `${account.account_id}:${fingerprint}:${month}:${section}`;
    const now = Date.now();
    for (const [entry, value] of this.cache) if (now - value.time >= TTL) this.cache.delete(entry);
    if (!options.force && this.cache.has(key)) return this.cache.get(key).data;
    if (this.requests.has(key)) return this.requests.get(key);
    const request = (async () => {
      let data;
      try {
        data = await this[section](account, month);
      } catch (error) {
        const normalized = normalizeError(error);
        const permission = { cdt: 'bssapi:DescribeInstanceBill', packages: 'bss:DescribeInstances', swas: 'swas-open:ListInstancesTrafficPackages' }[section];
        data = { status: normalized.status || 'error', message: normalized.status === 'permission_denied' ? `缺少读取权限：${permission}` : normalized.message, error_code: normalized.code, request_id: normalized.requestId || '' };
      }
      const result = { ...data, section, month, update_time: Math.floor(Date.now() / 1000) };
      if (!['error', 'network', 'timeout', 'partial'].includes(result.status)) {
        if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value);
        this.cache.set(key, { time: Date.now(), data: result });
      }
      return result;
    })().finally(() => this.requests.delete(key));
    this.requests.set(key, request);
    return request;
  }

  async packages(account) {
    const { bss } = this.service.createClients(account);
    const items = [];
    const ids = new Set();
    let expectedTotal;
    for (let page = 1; page <= 20; page++) {
      const body = bodyOf(await this.service.request(() => bss.queryResourcePackageInstances(new Bss.QueryResourcePackageInstancesRequest({ pageNum: page, pageSize: 300 })), '', { retries: 1 }));
      const data = body.data;
      const rows = data && data.instances && data.instances.instance;
      if (!Array.isArray(rows)) throw new AliyunServiceError('流量包数据格式不正确', 'InvalidAllowanceResponse');
      for (const row of rows) {
        if (!row.instanceId || ids.has(row.instanceId)) throw new AliyunServiceError('资源包分页数据发生变化，请刷新重试', 'InvalidAllowancePagination');
        ids.add(row.instanceId);
        const normalized = trafficPackage(row, Date.now());
        if (normalized) items.push(normalized);
      }
      const total = nonnegative(data.totalCount);
      if (page === 1) expectedTotal = total;
      if (total !== expectedTotal) throw new AliyunServiceError('查询期间资源包数量发生变化，请刷新重试', 'InvalidAllowancePagination');
      if (total !== null && ids.size > total) throw new AliyunServiceError('资源包分页数量不一致，请刷新重试', 'InvalidAllowancePagination');
      if (total !== null ? ids.size >= total : rows.length < 300) {
        items.sort((a, b) => (Date.parse(a.expiry_time) || Infinity) - (Date.parse(b.expiry_time) || Infinity));
        return { status: items.length ? 'active' : 'empty', items };
      }
      if (!rows.length) break;
    }
    throw new AliyunServiceError('资源包数据未完整返回，请稍后刷新', 'IncompleteAllowanceData');
  }

  async cdt(account, month) {
    const { bss } = this.service.createClients(account);
    const rows = [];
    const tokens = new Set();
    let nextToken;
    let owner;
    for (let page = 0; page < 20; page++) {
      const body = bodyOf(await this.service.request(() => bss.describeInstanceBill(new Bss.DescribeInstanceBillRequest({ billingCycle: month, productCode: 'cdt', isBillingItem: true, isHideZeroCharge: false, granularity: 'MONTHLY', maxResults: 300, nextToken })), '', { retries: 1 }));
      if (!body.data || !Array.isArray(body.data.items)) throw new AliyunServiceError('CDT 账单数据格式不正确', 'InvalidAllowanceResponse');
      owner = owner || body.data.accountID;
      if (owner !== body.data.accountID) throw new AliyunServiceError('CDT 账单账号不一致', 'InvalidAllowanceResponse');
      rows.push(...body.data.items);
      nextToken = body.data.nextToken;
      if (!nextToken) {
        const total = nonnegative(body.data.totalCount);
        if (total !== null && total !== rows.length) throw new AliyunServiceError('CDT 账单数据未完整返回，请稍后刷新', 'IncompleteAllowanceData');
        const summary = summarizeCdt(rows, owner);
        return { status: summary.verified ? 'active' : 'unverified', ...summary, message: summary.verified ? '按已出账用量统计，账单通常延迟约 24 小时，不包含未结算用量。' : `${summary.reasons.join('；')}。免费已用和剩余暂不计算，可前往 CDT 控制台核对。` };
      }
      if (tokens.has(nextToken)) break;
      tokens.add(nextToken);
    }
    throw new AliyunServiceError('CDT 账单数据未完整返回，请稍后刷新', 'IncompleteAllowanceData');
  }

  async swas(account) {
    const listed = await this.service.listServers(account.account_id);
    const servers = listed.data.filter(server => server.source === 'swas');
    const failures = (listed.failures || []).filter(item => item.source === 'swas').map(item => ({ region: item.region_id, message: item.message }));
    const batches = [];
    const regions = [...new Set(servers.map(server => server.region_id))];
    for (const region of regions) {
      const instances = servers.filter(server => server.region_id === region);
      for (let index = 0; index < instances.length; index += 100) batches.push({ region, instances: instances.slice(index, index + 100) });
    }
    const values = new Map();
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(3, batches.length) }, async () => {
      while (index < batches.length) {
        const batch = batches[index++];
        try {
          const client = this.service.createSwasClient(account, batch.region);
          const body = bodyOf(await this.service.request(() => client.listInstancesTrafficPackages(new Swas.ListInstancesTrafficPackagesRequest({ regionId: batch.region, instanceIds: JSON.stringify(batch.instances.map(server => server.instance_id)) })), '', { retries: 1 }));
          if (!Array.isArray(body.instanceTrafficPackageUsages)) throw new AliyunServiceError('轻量套餐数据格式不正确', 'InvalidAllowanceResponse');
          for (const row of body.instanceTrafficPackageUsages) values.set(`${batch.region}:${row.instanceId}`, row);
        } catch (error) {
          const normalized = normalizeError(error);
          failures.push({ region: batch.region, message: normalized.status === 'permission_denied' ? '缺少读取权限：swas-open:ListInstancesTrafficPackages' : normalized.message });
        }
      }
    }));
    const items = servers.map(server => {
      const row = values.get(`${server.region_id}:${server.instance_id}`);
      const total = nonnegative(row && row.trafficPackageTotal);
      const used = nonnegative(row && row.trafficUsed);
      const remaining = nonnegative(row && row.trafficPackageRemaining);
      const overflow = nonnegative(row && row.trafficOverflow);
      return { instance_id: server.instance_id, name: server.name, region: server.region_name || server.region_id, region_id: server.region_id, total_bytes: total, used_bytes: used, remaining_bytes: remaining, overflow_bytes: overflow, low: total > 0 && remaining !== null && remaining / total <= 0.2, missing: !row || [total, used, remaining, overflow].some(value => value === null) };
    });
    items.sort((a, b) => Number(b.overflow_bytes > 0) - Number(a.overflow_bytes > 0) || Number(b.low) - Number(a.low) || a.name.localeCompare(b.name));
    const missing = items.filter(item => item.missing).length;
    return { status: failures.length || missing ? 'partial' : items.length ? 'active' : 'empty', items, failures, list_complete: !failures.length, message: `${missing ? `${missing} 台实例的套餐数据未完整返回；` : ''}套餐流量按实例独立计算，不能在实例之间共享；统计出网流量。` };
  }
}

module.exports = { serverAllowanceService: new ServerAllowanceService(), ServerAllowanceService, trafficPackage, summarizeCdt, bytes };
