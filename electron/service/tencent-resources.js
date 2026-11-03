'use strict';

const { TencentDomains } = require('./tencent-domains');
const { TencentCos } = require('./tencent-cos');
const { TencentEdge } = require('./tencent-edge');
const { parseSummary, errorOf } = require('./tencent-errors');
const TTL = 5 * 60 * 1000;
const PRODUCTS = ['domains', 'cos', 'cdn', 'edgeone'];

class TencentResources {
  constructor(service) {
    this.service = service;
    this.domains = new TencentDomains(service);
    this.cos = new TencentCos(service);
    this.edge = new TencentEdge(service);
  }
  note(account, key, result, error) {
    if (!this.service.isCurrent(account)) return;
    const summary = parseSummary(this.service.getAccount(account.account_id).resource_summary);
    const previous = summary[key] || {};
    const now = Math.floor(Date.now() / 1000);
    const normalized = error && errorOf(error, account);
    const value = normalized ? { ...previous, status: normalized.resource_status, checked_at: now,
      error: { message: normalized.message, code: normalized.code, http_code: normalized.httpCode, request_id: normalized.requestId, action: normalized.action } }
      : { status: result.partial ? 'partial' : 'active', count: result.total ?? result.count, checked_at: now, success_at: now, error: null, partial: !!result.partial };
    this.service.updateAccount(account, { resource_summary: JSON.stringify({ ...summary, [key]: value }) });
  }
  async probe(id, force = false, product) {
    const account = this.service.getAccount(id);
    const keys = product ? PRODUCTS.filter(key => key === product) : PRODUCTS;
    if (!keys.length) throw new Error('产品类型不正确');
    // 每个账号最多同时执行三个产品探测，任一产品失败均保留其他结果。
    const queue = [...keys];
    await Promise.all(Array.from({ length: Math.min(3, keys.length) }, async () => {
      while (queue.length) {
        const key = queue.shift();
        const previous = parseSummary(this.service.getAccount(id).resource_summary)[key];
        if (!force && previous && Date.now() / 1000 - previous.checked_at < 300) continue;
        await this.service.cached(`${this.service.accountKey(account)}:probe:${key}`, TTL, force, async () => {
          try {
            if (key === 'domains') {
              await Promise.all(['domains', 'registration'].map(async part => {
                try { this.note(account, part, await this.domains.list(account, { probe: true, kind: part === 'registration' ? 'registered' : 'dns' })); }
                catch (error) { this.note(account, part, null, error); }
              }));
              return {};
            }
            const result = key === 'cos' ? await this.cos.count(account)
              : key === 'cdn' ? await this.edge.cdn(account, { probe: true }) : await this.edge.zones(account, { probe: true });
            this.note(account, key, result);
          } catch (error) { this.note(account, key, null, error); }
          return {};
        }, account);
      }
    }));
    return this.service.safeAccount(this.service.getAccount(id));
  }
  async run(id, operation, data = {}) {
    const account = this.service.getAccount(id);
    const actions = {
      domain_list: () => this.domains.list(account, data), record_list: () => this.domains.records(account, data), record_meta: () => this.domains.meta(account, data), record_change: () => this.domains.change(account, data), record_batch: () => this.domains.batch(account, data),
      cos_buckets: () => this.cos.buckets(account, data), cos_objects: () => this.cos.objects(account, data), cos_remove: () => this.cos.remove(account, data),
      cdn_list: () => this.edge.cdn(account, data), edge_zones: () => this.edge.zones(account, data), edge_domains: () => this.edge.domains(account, data), edge_plans: () => this.edge.plans(account, data),
      edge_config: () => this.edge.config(account, data), edge_change: () => this.edge.change(account, data), ssl_list: () => this.edge.certificates(account, data), cache_submit: () => this.edge.cache(account, data), cache_tasks: () => this.edge.tasks(account, data), cache_progress: () => this.edge.taskProgress(account, data), edge_traffic: () => this.edge.traffic(account, data),
    };
    if (!Object.prototype.hasOwnProperty.call(actions, operation)) throw new Error('不支持的腾讯云资源操作');
    // 未筛选的首屏列表可更新产品状态；域名、文件等资源级失败不降级整个产品。
    const key = !data.keyword && Number(data.page || 1) === 1 ? { domain_list: data.kind === 'registered' ? 'registration' : 'domains', cdn_list: 'cdn', edge_zones: 'edgeone' }[operation] : null;
    try {
      const result = await actions[operation]();
      if (key) this.note(account, key, result);
      if (operation === 'cos_objects' && this.service.isCurrent(account)) {
        const summary = parseSummary(this.service.getAccount(id).resource_summary);
        const previous = summary.cos;
        if (previous && previous.status !== 'active' && previous.status !== 'partial') {
          const now = Math.floor(Date.now() / 1000);
          const partial = { ...previous, count: undefined, status: 'partial', checked_at: now, success_at: now, partial: true,
            error: { ...previous.error, message: '指定存储桶可访问，但完整存储桶列表尚未确认；可重新探测列表权限。' } };
          this.service.updateAccount(account, { resource_summary: JSON.stringify({ ...summary, cos: partial }) });
        }
      }
      return result;
    } catch (error) {
      if (key) this.note(account, key, null, error);
      throw error;
    }
  }
}
module.exports = { TencentResources, PRODUCTS };
