'use strict';

const { integer, text, domain, zoneId, page, listResult } = require('./tencent-resource-utils');
const { domainToASCII } = require('url');
const { errorOf } = require('./tencent-errors');

class TencentDomains {
  constructor(service) { this.service = service; this.batches = new Set(); }

  async list(account, data = {}) {
    const registered = data.kind === 'registered';
    const params = page(data, data.probe ? 1 : 20);
    if (!registered) {
      params.Type = 'ALL';
      if (data.keyword) params.Keyword = text(data.keyword, '搜索内容', 200);
    }
    const result = await this.service.request(account, registered ? 'domain' : 'dnspod', registered ? 'DescribeDomainNameList' : 'DescribeDomainList', params);
    if (registered) return listResult(result, 'DomainSet', 'TotalCount');
    return listResult({ ...result, total: result.DomainCountInfo && result.DomainCountInfo.DomainTotal }, 'DomainList', 'total');
  }

  async records(account, data) {
    if (data.zone_id) {
      const result = await this.service.request(account, 'teo', 'DescribeDnsRecords', { ZoneId: zoneId(data.zone_id), ...page(data), ...(data.keyword ? { Filters: [{ Name: 'name', Values: [text(data.keyword, '主机记录')], Fuzzy: true }] } : {}) });
      const list = listResult(result, 'DnsRecords', 'TotalCount');
      return { ...list, data: list.data.map(row => ({ id: row.RecordId, name: row.Name, type: row.Type, value: row.Content, ttl: row.TTL, line: row.Location, priority: row.Priority, weight: row.Weight, status: row.Status, updated_at: row.ModifiedOn })) };
    }
    const result = await this.service.request(account, 'dnspod', 'DescribeRecordList', { Domain: domain(data.domain), ...page(data), ErrorOnEmpty: 'no', ...(data.keyword ? { Keyword: text(data.keyword, '搜索内容') } : {}) });
    const list = listResult({ ...result, RecordList: result.RecordList || [], total: result.RecordCountInfo && result.RecordCountInfo.TotalCount }, 'RecordList', 'total');
    return { ...list, data: list.data.map(row => ({ id: row.RecordId, name: row.Name, type: row.Type, value: row.Value, ttl: row.TTL, line: row.Line, line_id: row.LineId, priority: row.MX, weight: row.Weight, status: row.Status, remark: row.Remark, updated_at: row.UpdatedOn })) };
  }

  async meta(account, data) {
    if (data.zone_id) return { types: ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA'], lines: [], errors: [] };
    const name = domain(data.domain);
    const detail = await this.service.request(account, 'dnspod', 'DescribeDomain', { Domain: name });
    const grade = detail.DomainInfo && detail.DomainInfo.Grade;
    if (!grade) throw new Error('无法获取域名套餐及线路信息');
    const results = await Promise.allSettled([
      this.service.request(account, 'dnspod', 'DescribeRecordType', { DomainGrade: grade }),
      this.service.request(account, 'dnspod', 'DescribeRecordLineList', { Domain: name, DomainGrade: grade }),
    ]);
    return { types: results[0].status === 'fulfilled' ? results[0].value.Types || [] : [],
      lines: results[1].status === 'fulfilled' ? results[1].value.LineList || [] : [],
      errors: results.filter(item => item.status === 'rejected').map(item => item.reason.message) };
  }

  prepare(data) {
    const operation = data.operation;
    if (!['save', 'delete', 'status'].includes(operation)) throw new Error('不支持的解析操作');
    const edge = !!data.zone_id;
    const scope = edge ? { ZoneId: zoneId(data.zone_id) } : { Domain: domain(data.domain) };
    const id = data.id ? edge ? text(data.id, '记录 ID', 120) : integer(data.id, '记录 ID') : null;
    if (operation !== 'save' && !id) throw new Error('请指定解析记录');
    let action, params;
    if (operation === 'delete') {
      if (String(data.confirm_id) !== String(id)) throw new Error('删除目标尚未确认');
      action = edge ? 'DeleteDnsRecords' : 'DeleteRecord';
      params = edge ? { ...scope, RecordIds: [id] } : { ...scope, RecordId: id };
    } else if (operation === 'status') {
      if (!['ENABLE', 'DISABLE'].includes(data.status)) throw new Error('解析状态不正确');
      action = edge ? 'ModifyDnsRecordsStatus' : 'ModifyRecordStatus';
      params = edge ? { ...scope, [data.status === 'ENABLE' ? 'RecordsToEnable' : 'RecordsToDisable']: [id] } : { ...scope, RecordId: id, Status: data.status };
    } else {
      const type = text(data.type, '记录类型', 24);
      if (!/^[A-Z][A-Z0-9]*$/.test(type)) throw new Error('记录类型不正确');
      const rawName = text(data.name || '@', '主机记录', 253);
      const name = rawName === '@' ? '@' : domainToASCII(rawName);
      if (!name) throw new Error('主机记录格式不正确');
      const value = text(data.value, '记录值', 4096);
      const ttl = integer(data.ttl, 'TTL', edge ? 60 : 1, edge ? 86400 : 604800);
      const priority = (edge ? ['MX'] : ['MX', 'HTTPS', 'SVCB']).includes(type) ? integer(data.priority ?? 0, '优先级', 0, edge ? 50 : 65535) : undefined;
      if (edge) {
        const record = { Name: name, Type: type, Content: value, TTL: ttl, ...(priority !== undefined ? { Priority: priority } : {}) };
        if (data.weight != null && ['A', 'AAAA', 'CNAME'].includes(type)) record.Weight = integer(data.weight, '权重', -1, 100);
        if (data.line && ['A', 'AAAA', 'CNAME'].includes(type)) record.Location = data.line === '默认' ? 'Default' : text(data.line, '线路', 100);
        action = id ? 'ModifyDnsRecords' : 'CreateDnsRecord';
        params = id ? { ...scope, DnsRecords: [{ ...record, RecordId: id }] } : { ...scope, ...record };
      } else {
        action = id ? 'ModifyRecord' : 'CreateRecord';
        params = { ...scope, SubDomain: name, RecordType: type, RecordLine: text(data.line || '默认', '线路', 100), Value: value, TTL: ttl };
        if (id) params.RecordId = id;
        if (data.line_id) params.RecordLineId = text(data.line_id, '线路 ID', 100);
        if (priority !== undefined) params.MX = priority;
        if (data.weight != null) params.Weight = integer(data.weight, '权重', 0, 100);
        if (['ENABLE', 'DISABLE'].includes(data.status)) params.Status = data.status;
        if (data.remark !== undefined) params.Remark = String(data.remark).slice(0, 200);
      }
    }
    return { service: edge ? 'teo' : 'dnspod', action, params };
  }

  batchKey(account, data) { return `${account.account_id}:${data.zone_id ? zoneId(data.zone_id) : domain(data.domain)}`; }

  async apply(account, prepared) {
    if (!this.service.isCurrent(account)) throw new Error('账号凭据已变更，请刷新页面');
    const result = await this.service.request(account, prepared.service, prepared.action, prepared.params, '', true);
    this.service.clearAccountCache(account.account_id);
    return { request_id: result.RequestId || '' };
  }

  async change(account, data) {
    if (this.batches.has(this.batchKey(account, data))) throw new Error('当前域名正在执行批量操作，请等待结果');
    return this.apply(account, this.prepare(data));
  }

  async batch(account, data) {
    if (!['create', 'enable', 'disable', 'delete'].includes(data.operation)) throw new Error('批量操作类型不正确');
    if (!Array.isArray(data.records) || !data.records.length || data.records.length > 100) throw new Error('每批支持 1～100 条解析记录');
    if (!data.confirm_domain || domain(data.confirm_domain) !== domain(data.domain)) throw new Error('批量操作域名尚未确认');
    const key = this.batchKey(account, data);
    if (this.batches.has(key)) throw new Error('当前域名正在执行批量操作，请等待结果');
    // 全量校验后再提交，避免格式错误导致半批写入；记录不能覆盖本批的域名或站点。
    const seen = new Set();
    const prepared = data.records.map((record, index) => {
      if (!record || typeof record !== 'object') throw new Error(`第 ${index + 1} 条解析格式不正确`);
      let item;
      try {
        item = this.prepare({ ...record, domain: data.domain, zone_id: data.zone_id,
          operation: data.operation === 'create' ? 'save' : data.operation === 'delete' ? 'delete' : 'status',
          id: data.operation === 'create' ? undefined : record.id,
          confirm_id: data.operation === 'delete' ? record.id : undefined,
          ...(data.operation === 'enable' || data.operation === 'disable' ? { status: data.operation === 'enable' ? 'ENABLE' : 'DISABLE' } : {}) });
      } catch (error) { throw new Error(`第 ${index + 1} 条：${error.message}`); }
      const identity = data.operation === 'create' ? JSON.stringify(data.zone_id
        ? [item.params.Name.toLowerCase(), item.params.Type, item.params.Content, item.params.Priority, item.params.Location]
        : [item.params.SubDomain.toLowerCase(), item.params.RecordType, item.params.Value, item.params.MX, item.params.RecordLineId || item.params.RecordLine]) : String(record.id);
      if (seen.has(identity)) throw new Error(`第 ${index + 1} 条与本批其他记录重复，请移除重复项`);
      seen.add(identity);
      return item;
    });
    this.batches.add(key);
    const results = [], deadline = Date.now() + 180000;
    let stopped = '';
    try {
      for (let index = 0; index < prepared.length; index++) {
        if (!stopped && (!this.service.isCurrent(account) || Date.now() >= deadline)) stopped = '账号凭据已变更或本批执行时间已达上限，请核对已完成结果';
        if (stopped) { results.push({ index, status: 'skipped', message: stopped }); continue; }
        try {
          const result = await this.apply(account, prepared[index]);
          results.push({ index, status: 'success', ...result });
        } catch (exception) {
          const error = errorOf(exception, account);
          const uncertain = ['timeout', 'network', 'unavailable'].includes(error.resource_status);
          results.push({ index, status: uncertain ? 'uncertain' : 'failed', message: error.message, error_code: error.code, http_code: error.httpCode, request_id: error.requestId, action: error.action });
          if (uncertain || ['permission_denied', 'invalid_credentials', 'authentication_error', 'rate_limited', 'quota_exceeded', 'not_opened', 'disabled'].includes(error.resource_status)) stopped = '遇到网络、权限或配额异常，后续记录未提交；请核对结果后处理';
        }
      }
    } finally {
      this.batches.delete(key);
      this.service.clearAccountCache(account.account_id);
    }
    return { data: results, total: results.length, success: results.filter(row => row.status === 'success').length };
  }
}

module.exports = { TencentDomains };
