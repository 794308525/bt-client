'use strict';

const { isIP } = require('net');
const { integer, text, domain, zoneId, page, listResult, stripNulls, recentRange } = require('./tencent-resource-utils');

function originAddress(value) {
  const address = text(value, '源站地址', 253);
  if (/[\s/@?#\\]/.test(address)) throw new Error('源站请填写 IP 或域名，可携带端口，不含协议和路径');
  let parsed;
  try { parsed = new URL(`http://${address}`); } catch (_) { throw new Error('源站地址不正确'); }
  if (!isIP(parsed.hostname.replace(/^\[|\]$/g, ''))) domain(parsed.hostname);
  return address;
}
function domainView(row, edge = false) {
  return edge ? { name: row.DomainName, status: row.DomainStatus, cname: row.Cname, origin: row.OriginDetail && row.OriginDetail.Origin || '', origin_type: row.OriginDetail && row.OriginDetail.OriginType || '', certificate_id: row.Certificate && row.Certificate.List && row.Certificate.List[0] && row.Certificate.List[0].CertId || '', certificate_expiry: row.Certificate && row.Certificate.List && row.Certificate.List[0] && row.Certificate.List[0].ExpireTime || '', created_at: row.CreatedOn }
    : { name: row.Domain, status: row.Status, cname: row.Cname, origin: (row.Origin && row.Origin.Origins || []).join('\n'), origin_type: row.Origin && row.Origin.OriginType || '', area: row.Area, created_at: row.CreateTime };
}
function taskState(status) {
  if (['done', 'success'].includes(status)) return 'success';
  if (['fail', 'failed', 'invalid', 'timeout', 'canceled'].includes(status)) return 'failed';
  return ['process', 'processing'].includes(status) ? 'running' : 'unknown';
}
function certificateMatches(names, target) {
  return names.some(value => {
    let name;
    try { name = domain(value, true); } catch (_) { return false; }
    return name === target || (!target.startsWith('*.') && name.startsWith('*.') && target.endsWith(name.slice(1)) && target.split('.').length === name.split('.').length);
  });
}

class TencentEdge {
  constructor(service) { this.service = service; }
  async cdn(account, data = {}) {
    const result = await this.service.request(account, 'cdn', 'DescribeDomains', { ...page(data, data.probe ? 1 : 20), ...(data.keyword ? { Filters: [{ Name: 'domain', Value: [domain(data.keyword, true)], Fuzzy: false }] } : {}) });
    const list = listResult(result, 'Domains', 'TotalNumber');
    return { ...list, data: list.data.map(row => domainView(row)) };
  }
  async zones(account, data = {}) {
    const result = await this.service.request(account, 'teo', 'DescribeZones', { ...page(data, data.probe ? 1 : 20), ...(data.keyword ? { Filters: [{ Name: 'zone-name', Values: [text(data.keyword, '站点名称')], Fuzzy: true }] } : {}) });
    const list = listResult(result, 'Zones', 'TotalCount');
    return { ...list, data: list.data.map(row => ({ id: row.ZoneId, name: row.ZoneName, alias: row.AliasZoneName, type: row.Type, area: row.Area, status: row.Status, active_status: row.ActiveStatus, paused: row.Paused, nameservers: row.NameServers || [], resources: (row.Resources || []).map(item => ({ id: item.PlanId || item.Id, status: item.Status, expire_time: item.ExpireTime })) })) };
  }
  async domains(account, data) {
    const result = await this.service.request(account, 'teo', 'DescribeAccelerationDomains', { ZoneId: zoneId(data.zone_id), ...page(data), ...(data.keyword ? { Filters: [{ Name: 'domain-name', Values: [text(data.keyword, '域名')], Fuzzy: true }] } : {}) });
    const list = listResult(result, 'AccelerationDomains', 'TotalCount');
    return { ...list, data: list.data.map(row => domainView(row, true)) };
  }
  async plans(account, data = {}) {
    const result = await this.service.request(account, 'teo', 'DescribePlans', page(data));
    return listResult(result, 'Plans', 'TotalCount');
  }
  async certificates(account, data = {}) {
    const name = domain(data.domain, true);
    const result = await this.service.request(account, 'ssl', 'DescribeCertificates', {
      ...page(data), CertificateType: 'SVR', CertificateStatus: [1], Deployable: 1,
      ...(data.keyword ? { SearchKey: text(data.keyword, '证书关键词', 200) } : {}),
    });
    const list = listResult(result, 'Certificates', 'TotalCount');
    // 证书列表仅返回选择所需的公开信息，不透传证书内容或私钥。
    return { ...list, data: list.data.map(row => {
      const names = [...new Set([row.Domain, ...(row.SubjectAltName || []), ...(row.CertSANs || [])].filter(value => typeof value === 'string' && value))];
      return { id: row.CertificateId, alias: row.Alias || '', domain: row.Domain || '', names, begin_time: row.CertBeginTime, end_time: row.CertEndTime, matches: certificateMatches(names, name) };
    }) };
  }
  async current(account, data) {
    const name = domain(data.domain, true);
    if (data.zone_id) {
      const result = await this.service.request(account, 'teo', 'DescribeAccelerationDomains', { ZoneId: zoneId(data.zone_id), Limit: 20, Filters: [{ Name: 'domain-name', Values: [name], Fuzzy: false }] });
      const row = (result.AccelerationDomains || []).find(item => item.DomainName === name);
      if (!row) throw new Error('加速域名不存在或当前密钥无权访问');
      return row;
    }
    const result = await this.service.request(account, 'cdn', 'DescribeDomainsConfig', { Limit: 1, Filters: [{ Name: 'domain', Value: [name], Fuzzy: false }] });
    const row = (result.Domains || []).find(item => item.Domain === name);
    if (!row) throw new Error('CDN 域名不存在或当前密钥无权访问');
    return row;
  }
  async config(account, data) {
    const row = await this.current(account, data);
    const edge = !!data.zone_id;
    const result = { ...domainView(row, edge), protocol: edge ? row.OriginProtocol : row.Origin && row.Origin.OriginPullProtocol,
      host_header: edge ? row.OriginDetail && row.OriginDetail.HostHeader || '' : row.Origin && row.Origin.ServerName || '',
      certificate_id: edge ? domainView(row, true).certificate_id : row.Https && row.Https.CertInfo && row.Https.CertInfo.CertId || '',
      https_enabled: edge ? !!(row.Certificate && row.Certificate.Mode !== 'disable' && row.Certificate.List && row.Certificate.List.length) : row.Https && row.Https.Switch === 'on',
      origin_editable: edge ? ['IP_DOMAIN', 'COS'].includes(row.OriginDetail && row.OriginDetail.OriginType) : ['ip', 'domain', 'cos'].includes(row.Origin && row.Origin.OriginType),
      force_redirect: row.ForceRedirect || { Switch: 'off', RedirectStatusCode: 301 }, redirect_error: '' };
    if (edge) {
      try {
        const setting = await this.service.request(account, 'teo', 'DescribeZoneSetting', { ZoneId: zoneId(data.zone_id) });
        result.force_redirect = setting.ZoneSetting && setting.ZoneSetting.ForceRedirect || { Switch: 'off', RedirectStatusCode: 301 };
      } catch (error) { result.redirect_error = error.message; }
    }
    return result;
  }
  async change(account, data) {
    const edge = !!data.zone_id;
    const name = domain(data.domain, true);
    const row = await this.current(account, data);
    let action, params, service = edge ? 'teo' : 'cdn';
    if (data.operation === 'status') {
      if (!['online', 'offline'].includes(data.status)) throw new Error('加速状态不正确');
      if (data.status === 'offline' && data.confirm_domain !== name) throw new Error('停用目标尚未确认');
      action = edge ? 'ModifyAccelerationDomainStatuses' : data.status === 'online' ? 'StartCdnDomain' : 'StopCdnDomain';
      params = edge ? { ZoneId: zoneId(data.zone_id), DomainNames: [name], Status: data.status } : { Domain: name };
    } else if (data.operation === 'origin') {
      const input = String(data.origin == null ? '' : data.origin).trim();
      if (!input || input.length > 4000) throw new Error('源站地址不正确');
      const addresses = input.split(/\r?\n/).filter(value => value.trim()).map(originAddress);
      const protocol = String(data.protocol || (edge ? row.OriginProtocol : row.Origin && row.Origin.OriginPullProtocol) || (edge ? 'FOLLOW' : 'follow'));
      if (!(edge ? ['HTTP', 'HTTPS', 'FOLLOW'] : ['http', 'https', 'follow']).includes(protocol)) throw new Error('回源协议不正确');
      if (edge) {
        const previous = row.OriginDetail || {};
        if (!['IP_DOMAIN', 'COS'].includes(previous.OriginType) || addresses.length !== 1) throw new Error('此源站类型需到腾讯云控制台修改，当前仅支持单 IP、域名和 COS 源站');
        const origin = Object.fromEntries(['OriginType', 'BackupOrigin', 'PrivateAccess', 'PrivateParameters'].filter(key => previous[key] != null).map(key => [key, previous[key]]));
        if (previous.OriginType === 'IP_DOMAIN') origin.HostHeader = this.hostHeader(data.host_header, previous.HostHeader);
        action = 'ModifyAccelerationDomain';
        params = { ZoneId: zoneId(data.zone_id), DomainName: name, OriginInfo: { ...origin, Origin: addresses[0] }, OriginProtocol: protocol };
      } else {
        if (!['ip', 'domain', 'cos'].includes(row.Origin && row.Origin.OriginType)) throw new Error('此源站类型需到腾讯云控制台修改');
        action = 'UpdateDomainConfig';
        // 复杂配置对象的遗漏字段会被云端重置，必须基于最新配置局部修改。
        params = { Domain: name, Origin: stripNulls({ ...row.Origin, Origins: addresses, OriginPullProtocol: protocol, ServerName: this.hostHeader(data.host_header, row.Origin.ServerName) }) };
      }
    } else if (data.operation === 'certificate') {
      const id = text(data.certificate_id, '腾讯云 SSL 证书 ID', 128);
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('证书 ID 不正确');
      action = edge ? 'ModifyHostsCertificate' : 'UpdateDomainConfig';
      params = edge ? { ZoneId: zoneId(data.zone_id), Hosts: [name], Mode: 'sslcert', ServerCertInfo: [{ CertId: id }] }
        : { Domain: name, Https: stripNulls({ ...row.Https, Switch: 'on', CertInfo: { CertId: id } }) };
    } else if (data.operation === 'redirect') {
      const enabled = data.enabled === true;
      const code = integer(data.redirect_code || 301, '跳转状态码', 301, 302);
      if (data.confirm_domain !== name) throw new Error('HTTPS 配置目标尚未确认');
      if (edge) {
        const result = await this.service.request(account, 'teo', 'DescribeZoneSetting', { ZoneId: zoneId(data.zone_id) });
        if (!result.ZoneSetting) throw new Error('无法读取站点设置，未提交修改');
        action = 'ModifyZoneSetting';
        params = { ZoneId: zoneId(data.zone_id), ForceRedirect: { ...result.ZoneSetting.ForceRedirect, Switch: enabled ? 'on' : 'off', RedirectStatusCode: code } };
        if (result.ZoneSetting.ImageOptimize) params.ImageOptimize = stripNulls(result.ZoneSetting.ImageOptimize);
      } else {
        if (enabled && (!row.Https || row.Https.Switch !== 'on')) throw new Error('请先部署 HTTPS 证书，再开启强制 HTTPS');
        action = 'UpdateDomainConfig';
        params = { Domain: name, ForceRedirect: stripNulls({ ...row.ForceRedirect, Switch: enabled ? 'on' : 'off', RedirectType: 'https', RedirectStatusCode: code }) };
      }
    } else throw new Error('不支持的加速域名操作');
    if (!this.service.isCurrent(account)) throw new Error('账号凭据已变更，请刷新后操作');
    const result = await this.service.request(account, service, action, params, '', true);
    this.service.clearAccountCache(account.account_id);
    return { request_id: result.RequestId || '' };
  }
  async cache(account, data) {
    const edge = !!data.zone_id;
    if (!['url', 'directory', 'prefetch'].includes(data.kind)) throw new Error('缓存操作类型不正确');
    const targets = [...new Set(String(data.targets || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean))];
    if (!targets.length || targets.length > (data.kind === 'directory' ? 100 : 1000)) throw new Error('请填写刷新/预热地址，URL 最多 1000 条、目录最多 100 条');
    const name = domain(data.domain, true);
    for (const target of targets) {
      let parsed;
      try { parsed = new URL(target); } catch (_) { throw new Error('请填写完整的 HTTP/HTTPS 地址'); }
      const match = name.startsWith('*.') ? parsed.hostname.endsWith(name.slice(1)) : parsed.hostname === name;
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.hash || !match || /[\s\\*]/.test(target)) throw new Error('地址必须属于所选加速域名，且不含凭据、片段或通配符');
      if (data.kind === 'directory' && (!parsed.pathname.endsWith('/') || parsed.search)) throw new Error('目录地址须以 / 结尾，且不携带查询参数');
    }
    await this.current(account, data);
    if (!this.service.isCurrent(account)) throw new Error('账号凭据已变更，请刷新后操作');
    const action = edge ? data.kind === 'prefetch' ? 'CreatePrefetchTask' : 'CreatePurgeTask' : data.kind === 'prefetch' ? 'PushUrlsCache' : data.kind === 'directory' ? 'PurgePathCache' : 'PurgeUrlsCache';
    const params = edge ? { ZoneId: zoneId(data.zone_id), Targets: targets, ...(data.kind === 'prefetch' ? {} : { Type: data.kind === 'url' ? 'purge_url' : 'purge_prefix', ...(data.kind === 'directory' ? { Method: 'invalidate' } : {}) }) }
      : data.kind === 'directory' ? { Paths: targets, FlushType: 'flush' } : { Urls: targets };
    const result = await this.service.request(account, edge ? 'teo' : 'cdn', action, params, '', true);
    return { task_id: result.JobId || result.TaskId || '', request_id: result.RequestId || '' };
  }
  async tasks(account, data) {
    if (!['url', 'directory', 'prefetch'].includes(data.kind)) throw new Error('缓存任务类型不正确');
    const edge = !!data.zone_id, prefetch = data.kind === 'prefetch';
    const name = domain(data.domain, true);
    const taskId = data.task_id ? text(data.task_id, '任务 ID', 160) : '';
    if (taskId && !/^[a-zA-Z0-9_-]+$/.test(taskId)) throw new Error('任务 ID 不正确');
    const params = { ...(taskId ? {} : recentRange(2)), ...page(data, data.progress ? 100 : 20) };
    if (edge) {
      params.ZoneId = zoneId(data.zone_id);
      params.Filters = [{ Name: 'domains', Values: [name] }, ...(taskId ? [{ Name: 'job-id', Values: [taskId] }] : []),
        ...(!prefetch ? [{ Name: 'type', Values: [data.kind === 'directory' ? 'purge_prefix' : 'purge_url'] }] : [])];
    } else {
      params.Keyword = name;
      if (taskId) params.TaskId = taskId;
      if (!prefetch) params.PurgeType = data.kind === 'directory' ? 'path' : 'url';
    }
    const result = await this.service.request(account, edge ? 'teo' : 'cdn', prefetch ? edge ? 'DescribePrefetchTasks' : 'DescribePushTasks' : 'DescribePurgeTasks', params);
    const list = listResult(result, edge ? 'Tasks' : prefetch ? 'PushLogs' : 'PurgeLogs', 'TotalCount');
    return { ...list, data: list.data.map(row => ({ id: row.JobId || row.TaskId, target: row.Target || row.Url, status: row.Status, state: taskState(row.Status), type: row.Type || row.PurgeType || (prefetch ? 'prefetch' : 'purge'), created_at: row.CreateTime, message: row.FailMessage || row.FailType || '', percent: Number.isFinite(row.Percent) ? Math.max(0, Math.min(100, row.Percent)) : null })) };
  }
  async taskProgress(account, data) {
    if (!data.task_id) throw new Error('请指定需要跟踪的任务 ID');
    let offset = 1, total = 0, success = 0, failed = 0, running = 0, unknown = 0, checked = 0;
    const errors = [], deadline = Date.now() + 45000;
    // 一个任务可包含多条资源，检查所有分页后才能判定整个任务完成。
    do {
      if (!this.service.isCurrent(account)) throw new Error('账号凭据已变更，请刷新后查询');
      const result = await this.tasks(account, { ...data, progress: true, page: offset++ });
      total = result.total;
      if (!result.data.length) break;
      for (const row of result.data) {
        checked++;
        if (row.state === 'success') success++;
        else if (row.state === 'failed') { failed++; if (errors.length < 5) errors.push({ target: row.target, message: row.message || row.status }); }
        else if (row.state === 'running') running++;
        else unknown++;
      }
    } while (checked < total && checked < 1000 && Date.now() < deadline);
    const complete = total > 0 && checked >= total && running === 0 && unknown === 0;
    return { task_id: data.task_id, total, checked, success, failed, running, unknown, complete, partial: checked < total, errors };
  }
  async traffic(account, data) {
    const edge = !!data.zone_id;
    const days = integer(data.days || 1, '天数', 1, 7);
    const name = domain(data.domain, true);
    const result = await this.service.request(account, edge ? 'teo' : 'cdn', edge ? 'DescribeTimingL7AnalysisData' : 'DescribeCdnData', edge
      ? { ...recentRange(days), ZoneIds: [zoneId(data.zone_id)], MetricNames: ['l7Flow_outFlux', 'l7Flow_request'], Interval: 'hour', Filters: [{ Key: 'domain', Operator: 'equals', Value: [name] }] }
      : { ...recentRange(days), Domains: [name], Metric: 'flux', Interval: 'hour', TimeZone: 'Asia/Shanghai' });
    const points = new Map();
    const put = (time, key, value) => {
      const stamp = typeof time === 'number' ? time * 1000 : Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(time) ? time : String(time).replace(' ', 'T') + '+08:00');
      if (value == null || !Number.isFinite(stamp) || !Number.isFinite(Number(value)) || Number(value) < 0) return;
      const row = points.get(stamp) || { time: stamp, bytes: null, requests: null };
      row[key] = (row[key] || 0) + Number(value);
      points.set(stamp, row);
    };
    if (edge) (result.Data || []).forEach(record => (record.TypeValue || []).forEach(metric => (metric.Detail || []).forEach(point => put(point.Timestamp, metric.MetricName === 'l7Flow_outFlux' ? 'bytes' : 'requests', point.Value))));
    else (result.Data || []).forEach(record => (record.CdnData || []).forEach(metric => (metric.DetailData || []).forEach(point => put(point.Time, 'bytes', point.Value))));
    return { data: [...points.values()].sort((a, b) => a.time - b.time), request_id: result.RequestId || '' };
  }
  hostHeader(input, previous) {
    if (input === undefined || input === previous) return previous || '';
    const value = String(input).trim();
    return value ? originAddress(value) : '';
  }
}
module.exports = { TencentEdge, domainView, originAddress };
