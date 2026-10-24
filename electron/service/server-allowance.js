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

function cdtPool(region, regions = []) {
  const value = String(region || '').trim().toLowerCase().replace(/（/g, '(').replace(/）/g, ')');
  if (/^cn-(hongkong|macau|taiwan)(-|$)/.test(value)) return 'overseas';
  if (/^cn-[a-z0-9-]+$/.test(value) || value === '中国内地' || value === '中国大陆') return 'mainland';
  if (/^(ap|eu|us|me|na|sa|af|il)-[a-z0-9-]+$/.test(value) || value === '非中国内地' || value === '海外') return 'overseas';
  if (!value) return '';
  const matches = new Set();
  for (const item of regions) {
    const name = String(item.name || '').trim().toLowerCase().replace(/（/g, '(').replace(/）/g, ')');
    if (name === value || name === `中国${value}` || name.endsWith(`(${value})`)) {
      const pool = cdtPool(item.region_id);
      if (pool) matches.add(pool);
    }
  }
  return matches.size === 1 ? [...matches][0] : '';
}

function summarizeCdt(rows, accountId, regions = []) {
  const pools = FREE_LIMITS.map(pool => ({ ...pool, used_bytes: null, remaining_bytes: null, state: 'unverified', reason: '' }));
  const evidence = Object.fromEntries(pools.map(pool => [pool.key, { free: 0, exhausted: false, reasons: new Set() }]));
  const unknown = (pool, reason) => {
    (pool ? [pool] : pools.map(item => item.key)).forEach(key => evidence[key].reasons.add(reason));
  };
  if (!accountId) unknown('', '账单缺少账号归属字段');
  for (const row of rows) {
    // 额度按资源所属账号计算，不能混入代付账号下其他成员的账单。
    if (!accountId || !row.ownerID) { unknown('', '账单缺少账号归属字段'); continue; }
    if (String(row.ownerID) !== String(accountId)) continue;
    const commodity = String(row.commodityCode || '');
    if (/^cdt_(cdtir|cucbdt)_/i.test(commodity)) continue;
    // 预付费资源包订单记录购买容量，不属于公网流量消耗，也不占用月度免费额度。
    if (/^cdt_Resource_dp_(cn|intl)$/i.test(commodity)) continue;
    const legacy = /^cdt_internet_public_(cn|intl)$/i.test(commodity);
    const modern = /^cdt_DataTransfer_public_(cn|intl)$/i.test(commodity);
    if (modern && row.billingItemCode === 'inter_region_traffic') continue;
    const parts = legacy ? String(row.instanceID || '').match(/^[^;]+;([a-z0-9-]+);(BGP|BGP_PRO);(\d+)$/i) : null;
    const pool = cdtPool(parts ? parts[1] : row.region, regions);
    if ((!legacy && !modern) || (legacy && !PUBLIC_ITEMS.has(row.billingItemCode)) || (modern && row.billingItemCode !== 'internet_traffic')) {
      unknown(pool, '账单包含尚未支持识别的商品或计费项');
      continue;
    }
    if (legacy && !parts) { unknown(pool, '账单实例标识不符合已支持的格式'); continue; }
    const line = parts ? parts[2] : String(row.instanceConfig || '');
    // 精品线路不享受免费额度，不能凭收费账单推断普通 BGP 的免费额度已用尽。
    if (/BGP_PRO|精品|\bBGP\b[^;\n]*\bPro\b/i.test(line)) continue;
    if (!pool) { unknown('', '账单地域暂无法识别'); continue; }
    // 账单用量不含已被资源包抵扣的部分；抵扣后的零用量仍可能已经进入付费阶梯。
    const billedUsage = bytes(row.usage, row.usageUnit);
    const deducted = String(row.deductedByResourcePackage ?? '').trim();
    const deductedUsage = deducted ? bytes(deducted, row.usageUnit) : 0;
    const usage = billedUsage !== null && deductedUsage !== null ? nonnegative(billedUsage + deductedUsage) : null;
    const price = nonnegative(row.listPrice);
    if (usage === null || price === null || row.item !== 'PayAsYouGoBill') {
      unknown(pool, row.item !== 'PayAsYouGoBill' ? '账单含退款、调账或其他未支持的类型' : '账单缺少有效用量、资源包抵扣量、单位或单价');
      continue;
    }
    if (usage === 0) continue;
    if (legacy) {
      const tier = Number(parts[3]);
      if (!Number.isSafeInteger(tier) || (tier === 0) !== (price === 0)) { unknown(pool, '免费阶梯与单价不一致'); continue; }
      if (tier === 0) evidence[pool].free += usage;
      else evidence[pool].exhausted = true;
    } else if (price === 0) {
      // CDT 2.0 的免费公网流量目录价为零，地域改从账单地域字段读取。
      evidence[pool].free += usage;
    } else if (/\bBGP\b/i.test(line)) {
      evidence[pool].exhausted = true;
    } else {
      unknown(pool, 'CDT 2.0 收费账单缺少线路信息，暂无法确认免费额度是否用尽');
    }
  }
  for (const pool of pools) {
    const item = evidence[pool.key];
    if (item.exhausted || item.free >= pool.total_bytes) {
      pool.used_bytes = pool.total_bytes;
      pool.remaining_bytes = 0;
      pool.state = 'exhausted';
      pool.reason = item.exhausted ? '已出现普通 BGP 收费阶梯，按该地域免费额度已用尽计算' : '已出账免费用量已达到该地域月额度';
    } else if (item.reasons.size) {
      pool.reason = [...item.reasons].join('；');
    } else {
      pool.used_bytes = item.free;
      pool.remaining_bytes = pool.total_bytes - item.free;
      pool.state = item.free > 0 ? 'active' : 'unused';
      pool.reason = item.free > 0 ? '按已出账免费公网流量累计，不包含未出账用量' : '完整查询中未发现该地域已出账免费公网用量，按已出账口径显示未使用';
    }
  }
  return { pools, verified: pools.every(pool => pool.used_bytes !== null), has_bills: rows.length > 0,
    reasons: [...new Set(pools.filter(pool => pool.used_bytes === null).map(pool => `${pool.label}：${pool.reason}`))] };
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
        let regions = [];
        if (rows.some(row => String(row.ownerID) === String(owner) && /^cdt_DataTransfer_/i.test(String(row.commodityCode || '')) && row.billingItemCode === 'internet_traffic' && !cdtPool(row.region))) {
          try { regions = await this.service.getRegions(account, 'ecs'); } catch { /* 无地域查询权限时保留对应额度待核对。 */ }
        }
        const summary = summarizeCdt(rows, owner, regions);
        const status = summary.verified ? 'active' : summary.pools.some(pool => pool.used_bytes !== null) ? 'partial' : 'unverified';
        const note = '按本月已出账账单统计，通常延迟约 24 小时，不代表实时余量；未发现已出账公网用量时按未使用显示。';
        return { status, ...summary, message: summary.verified ? note : `${summary.reasons.join('；')}。对应地域余量待核对。${note}` };
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
