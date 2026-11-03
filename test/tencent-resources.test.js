'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const { errorOf, resourceStatus } = require('../electron/service/tencent-errors');
const { listResult } = require('../electron/service/tencent-resource-utils');
const { TencentCos } = require('../electron/service/tencent-cos');
const { TencentEdge } = require('../electron/service/tencent-edge');
const { TencentDomains } = require('../electron/service/tencent-domains');

// 使用真实服务和缓存逻辑，替换 Electron 数据库与网络边界，避免访问用户账号。
const filename = path.resolve(__dirname, '../electron/service/tencent.js');
const localRequire = createRequire(filename);
const fakeModule = { exports: {} };
const clients = [];
const load = vm.runInThisContext(`(function(require, module, exports) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
load(name => name === '../class/public.js' ? { pub: {} } : name === 'tencentcloud-sdk-nodejs-common' ? { CommonClient: class {
  constructor(endpoint, version) { this.endpoint = endpoint; this.version = version; this.calls = 0; clients.push(this); }
  async request() { this.calls++; throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); }
} } : localRequire(name), fakeModule, fakeModule.exports);
const { TencentService } = fakeModule.exports;
function service() {
  const instance = new TencentService();
  const account = { account_id: 1, site: 'cn', secret_id: 'test-id', secret_key: 'test-key', resource_summary: '{}' };
  instance.getAccount = () => ({ ...account });
  instance.updateAccount = (snapshot, data) => { if (instance.isCurrent(snapshot)) Object.assign(account, data); };
  return { instance, account };
}

test('错误码优先区分认证、授权、停服、限频和迁移', () => {
  assert.equal(resourceStatus('AuthFailure.UnauthorizedOperation'), 'permission_denied');
  assert.equal(resourceStatus('AuthFailure.SecretIdNotFound'), 'invalid_credentials');
  assert.equal(resourceStatus('UnauthorizedOperation.CdnUserIsSuspended'), 'disabled');
  assert.equal(resourceStatus('UnauthorizedOperation.OperationTooOften'), 'rate_limited');
  assert.equal(resourceStatus('LimitExceeded.Quota'), 'quota_exceeded');
  assert.equal(resourceStatus('OperationDenied.ProductUpgraded'), 'migrated');
  assert.equal(resourceStatus('ResourceNotFound.CdnUserNotExists'), 'not_opened');
  assert.equal(resourceStatus('ResourceNotFound.CdnHostNotExists'), 'error');
  const result = errorOf({ message: 'test-key test-id AKIDabcdef', code: 'Unknown', requestId: 'request-1' }, { secret_id: 'test-id', secret_key: 'test-key' });
  assert.doesNotMatch(result.message, /test-key|test-id|AKIDabcdef/);
  assert.equal(result.requestId, 'request-1');
});

test('成功空列表与非法列表结构严格区分', () => {
  assert.deepEqual(listResult({ Domains: null, TotalCount: 0 }, 'Domains', 'TotalCount'), { data: [], total: 0 });
  assert.throws(() => listResult({ Domains: [], TotalCount: undefined }, 'Domains', 'TotalCount'));
  assert.throws(() => listResult({ Domains: null, TotalCount: 5 }, 'Domains', 'TotalCount'));
});

test('产品探测互不阻断；失败保留历史数量；注册与解析独立；负结果缓存可强制刷新', async () => {
  const { instance, account } = service();
  account.resource_summary = JSON.stringify({ cdn: { status: 'active', count: 7, success_at: 10 } });
  let calls = 0;
  instance.request = async (_account, product) => {
    calls++;
    if (product === 'cdn') throw Object.assign(new Error('denied'), { code: 'UnauthorizedOperation.CdnCamUnauthorized', requestId: 'denied-1' });
    if (product === 'domain') throw Object.assign(new Error('registration denied'), { code: 'AuthFailure.UnauthorizedOperation' });
    return product === 'dnspod' ? { DomainList: [], DomainCountInfo: { DomainTotal: 0 } } : { Zones: [], TotalCount: 0 };
  };
  instance.resources.cos.count = async () => ({ count: 3 });
  const result = await instance.resources.probe(1);
  assert.equal(result.resource_summary.domains.status, 'active');
  assert.equal(result.resource_summary.domains.count, 0);
  assert.equal(result.resource_summary.registration.status, 'permission_denied');
  assert.equal(result.resource_summary.cdn.status, 'permission_denied');
  assert.equal(result.resource_summary.cdn.count, 7);
  assert.equal(result.resource_summary.cdn.success_at, 10);
  assert.equal(result.resource_summary.cos.count, 3);
  const count = calls;
  await instance.resources.probe(1);
  assert.equal(calls, count);
  await instance.resources.probe(1, true, 'cdn');
  assert.equal(calls, count + 1);
});

test('凭据在探测期间变更时不写入旧账号结果', async () => {
  const { instance, account } = service();
  instance.resources.cos.count = async () => { account.secret_key = 'changed-key'; return { count: 99 }; };
  await instance.resources.probe(1, true, 'cos');
  assert.deepEqual(JSON.parse(account.resource_summary), {});
});

test('仅能访问指定 COS 桶时标记部分可用，不误报完整桶数量', async () => {
  const { instance, account } = service();
  account.resource_summary = JSON.stringify({ cos: { status: 'permission_denied', count: 99, error: { action: 'cos:GetService', code: 'AccessDenied' } } });
  instance.resources.cos.objects = async () => ({ data: [], folders: [], next_marker: '' });
  await instance.resources.run(1, 'cos_objects', { bucket: 'example-1250000000', region: 'ap-guangzhou' });
  const state = JSON.parse(account.resource_summary).cos;
  assert.equal(state.status, 'partial');
  assert.equal(state.count, undefined);
  assert.equal(state.error.action, 'cos:GetService');
});

test('COS 使用公开 request 保留分页，兼容单桶 XML 节点', async () => {
  const cos = new TencentCos({});
  cos.client = () => ({});
  const markers = [];
  cos.call = async (_client, action, params) => {
    assert.equal(action, 'request');
    assert.equal(params.Url, 'https://service.cos.myqcloud.com/');
    markers.push(params.Query.marker);
    return { ListAllMyBucketsResult: { Buckets: { Bucket: { Name: `bucket-${markers.length}`, Location: 'ap-guangzhou' } }, IsTruncated: markers.length === 1, NextMarker: markers.length === 1 ? 'next-page' : '' } };
  };
  assert.deepEqual(await cos.count({}), { count: 2 });
  assert.deepEqual(markers, ['', 'next-page']);
});

test('COS 对象下载失败不覆盖已有文件且删除临时文件', async () => {
  const os = require('os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'tencent-cos-test-'));
  const destination = path.join(directory, 'existing.txt');
  fs.writeFileSync(destination, 'original');
  const cos = new TencentCos({});
  cos.client = () => ({});
  cos.call = async (_client, _method, params) => { params.Output.write('partial'); throw new Error('download failed'); };
  try {
    await assert.rejects(cos.download({}, { bucket: 'example-1250000000', region: 'ap-guangzhou', object_name: 'file' }, destination));
    assert.equal(fs.readFileSync(destination, 'utf8'), 'original');
    assert.deepEqual(fs.readdirSync(directory), ['existing.txt']);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('CDN 修改源站保留原 Host、私有鉴权、备用源站与复杂配置', async () => {
  let sent;
  const origin = { Origins: ['old.example.com'], OriginType: 'cos', ServerName: 'old.example.com', CosPrivateAccess: 'on', BackupOrigins: ['backup.example.com'], PathRules: [{ Path: '/api', Value: '/v1' }] };
  const instance = { isCurrent: () => true, clearAccountCache: () => {}, request: async (_a, _s, action, params, _r, write) => {
    if (action === 'DescribeDomainsConfig') return { Domains: [{ Domain: 'cdn.example.com', Origin: origin }] };
    assert.equal(write, true); sent = params; return { RequestId: 'write-1' };
  } };
  await new TencentEdge(instance).change({}, { domain: 'cdn.example.com', operation: 'origin', origin: 'new.example.com', protocol: 'https' });
  assert.deepEqual(sent.Origin, { ...origin, Origins: ['new.example.com'], OriginPullProtocol: 'https' });
});

test('CDN 多行源站逐条校验，允许换行并保留其他回源配置', async () => {
  let sent;
  const origin = { OriginType: 'ip', Origins: ['192.0.2.1', '192.0.2.2'], ServerName: 'origin.example.com', BackupOrigins: ['192.0.2.3'] };
  const edge = new TencentEdge({ isCurrent: () => true, clearAccountCache() {}, request: async (_a, _s, action, params) => {
    if (action === 'DescribeDomainsConfig') return { Domains: [{ Domain: 'cdn.example.com', Origin: origin }] };
    sent = params; return {};
  } });
  const data = { domain: 'cdn.example.com', operation: 'origin', origin: '192.0.2.1\r\n\n192.0.2.2\n', protocol: 'https' };
  await edge.change({}, data);
  assert.deepEqual(sent.Origin, { ...origin, OriginPullProtocol: 'https' });
  sent = null;
  await assert.rejects(edge.change({}, { ...data, origin: '192.0.2.1\n192.0.2.2\x00' }));
  await assert.rejects(edge.change({}, { ...data, origin: '\n \n' }));
  assert.equal(sent, null);
});

test('配置查询不向渲染进程返回证书私钥', async () => {
  const edge = new TencentEdge({ request: async () => ({ Domains: [{ Domain: 'cdn.example.com', Origin: {}, Https: { Switch: 'on', CertInfo: { CertId: 'ssl-test', PrivateKey: 'private-secret', Certificate: 'pem' } } }] }) });
  const result = await edge.config({}, { domain: 'cdn.example.com' });
  assert.equal(result.certificate_id, 'ssl-test');
  assert.doesNotMatch(JSON.stringify(result), /private-secret|pem/);
});

test('EdgeOne 修改跳转保留图片优化配置', async () => {
  let sent;
  const edge = new TencentEdge({ isCurrent: () => true, clearAccountCache: () => {}, request: async (_a, _s, action, params) => {
    if (action === 'DescribeAccelerationDomains') return { AccelerationDomains: [{ DomainName: 'cdn.example.com' }] };
    if (action === 'DescribeZoneSetting') return { ZoneSetting: { ImageOptimize: { Switch: 'on' }, ForceRedirect: { Switch: 'off' } } };
    sent = params; return {};
  } });
  await edge.change({}, { domain: 'cdn.example.com', zone_id: 'zone-test', operation: 'redirect', enabled: true, confirm_domain: 'cdn.example.com' });
  assert.deepEqual(sent.ImageOptimize, { Switch: 'on' });
  assert.equal(sent.ForceRedirect.Switch, 'on');
});

test('流量查询不把缺失采样值转换成零', async () => {
  const edge = new TencentEdge({ request: async () => ({ Data: [{ CdnData: [{ DetailData: [{ Time: '2026-10-25T00:00:00Z', Value: null }, { Time: '2026-10-25T01:00:00Z', Value: 0 }] }] }] }) });
  const result = await edge.traffic({}, { domain: 'cdn.example.com' });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].bytes, 0);
  assert.equal(result.data[0].requests, null);
  const eo = new TencentEdge({ request: async (_a, _s, _action, params) => { assert.deepEqual(params.Filters, [{ Key: 'domain', Operator: 'equals', Value: ['cdn.example.com'] }]); return { Data: [] }; } });
  await eo.traffic({}, { domain: 'cdn.example.com', zone_id: 'zone-test' });
});

test('DNSPod 解析写入保留线路、停用状态、权重和备注，并禁用请求重试', async () => {
  let sent;
  const dns = new TencentDomains({ isCurrent: () => true, clearAccountCache: () => {}, request: async (_a, _s, action, params, _r, write) => { assert.equal(action, 'ModifyRecord'); assert.equal(write, true); sent = params; return {}; } });
  await dns.change({}, { domain: 'example.com', operation: 'save', id: 42, name: 'www', type: 'A', value: '1.2.3.4', ttl: 600, line: '电信', line_id: '10=0', weight: 0, status: 'DISABLE', remark: '' });
  assert.equal(sent.RecordLineId, '10=0');
  assert.equal(sent.Weight, 0);
  assert.equal(sent.Status, 'DISABLE');
  assert.equal(sent.Remark, '');
});

test('EdgeOne 编辑无权重记录时保留 -1，并按独立 TTL/MX 范围校验', async () => {
  let sent;
  const dns = new TencentDomains({ isCurrent: () => true, clearAccountCache: () => {}, request: async (_a, _s, _action, params) => { sent = params; return {}; } });
  await dns.change({}, { zone_id: 'zone-test', operation: 'save', id: 'record-1', name: 'www.example.com', type: 'A', value: '1.2.3.4', ttl: 60, weight: -1, line: 'Default' });
  assert.equal(sent.DnsRecords[0].Weight, -1);
  await assert.rejects(dns.change({}, { zone_id: 'zone-test', operation: 'save', name: 'example.com', type: 'MX', value: 'mx.example.com', ttl: 1, priority: 10 }));
  await assert.rejects(dns.change({}, { zone_id: 'zone-test', operation: 'save', name: 'example.com', type: 'MX', value: 'mx.example.com', ttl: 60, priority: 51 }));
});

test('EdgeOne 默认线路兼容旧表单且不覆盖已配置线路，DNSPod 保留中文默认', async () => {
  const dns = new TencentDomains({});
  for (const type of ['A', 'AAAA', 'CNAME']) {
    const value = { A: '192.0.2.1', AAAA: '2001:db8::1', CNAME: 'origin.example.com' }[type];
    const data = { zone_id: 'zone-test', operation: 'save', name: 'www.example.com', type, value, ttl: 600 };
    assert.equal(dns.prepare({ ...data, line: '默认' }).params.Location, 'Default');
    assert.equal(dns.prepare({ ...data, line: 'Default' }).params.Location, 'Default');
    assert.equal(dns.prepare({ ...data, id: 'record-test', line: 'CN/CT' }).params.DnsRecords[0].Location, 'CN/CT');
  }
  assert.equal(dns.prepare({ domain: 'example.com', operation: 'save', name: 'www', type: 'A', value: '192.0.2.1', ttl: 600, line: '默认' }).params.RecordLine, '默认');
});

test('CommonClient 使用产品 API 版本及国际站 endpoint；写超时不重试', async () => {
  const { instance, account } = service();
  account.site = 'intl';
  await assert.rejects(instance.request(account, 'teo', 'ModifyHostsCertificate', {}, '', true));
  const client = clients.at(-1);
  assert.equal(client.endpoint, 'teo.intl.tencentcloudapi.com');
  assert.equal(client.version, '2022-09-01');
  assert.equal(client.calls, 1);
  await assert.rejects(instance.request(account, 'ssl', 'DescribeCertificates'));
  assert.equal(clients.at(-1).endpoint, 'ssl.intl.tencentcloudapi.com');
  assert.equal(clients.at(-1).version, '2019-12-05');
});

const record = (name = 'www') => ({ name, type: 'A', value: '192.0.2.1', ttl: 600, line: '默认' });
const batch = records => ({ domain: 'example.com', confirm_domain: 'example.com', operation: 'create', records });
test('批量解析提交前校验全部记录和重复项，拒绝半批格式错误写入', async () => {
  const { instance, account } = service(); let writes = 0;
  instance.request = async () => { writes++; return {}; };
  await assert.rejects(instance.resources.domains.batch(account, batch([record(), { ...record('api'), ttl: 0 }])));
  await assert.rejects(instance.resources.domains.batch(account, batch([record(), record('WWW')])));
  assert.equal(writes, 0);
});

test('批量解析不允许记录覆盖域名，超时不重试且停止后续提交', async () => {
  const { instance, account } = service(); const writes = [];
  instance.request = async (_a, product, action, params, _region, write) => {
    assert.equal(product, 'dnspod'); assert.equal(action, 'CreateRecord'); assert.equal(write, true);
    writes.push(params);
    if (writes.length === 2) throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT', requestId: 'timeout-id' });
    return { RequestId: 'ok-id' };
  };
  const result = await instance.resources.domains.batch(account, batch([{ ...record(), domain: 'other.example.com', zone_id: 'zone-other', id: 99 }, record('api'), record('cdn')]));
  assert.deepEqual(result.data.map(row => row.status), ['success', 'uncertain', 'skipped']);
  assert.equal(result.success, 1); assert.equal(writes.length, 2);
  assert.equal(writes[0].Domain, 'example.com'); assert.equal(writes[0].RecordId, undefined);
  assert.equal(result.data[1].request_id, 'timeout-id');
});

test('SDK HTTP 5xx 经多层错误转换后仍保留状态，批量写入标记待核实并停止', async () => {
  const HttpError = require('tencentcloud-sdk-nodejs-common/tencentcloud/common/exception/tencent_cloud_sdk_exception').default;
  const { instance, account } = service(); let calls = 0;
  const failure = Object.assign(new HttpError('Bad Gateway'), { httpCode: 502 });
  const normalized = errorOf(errorOf(failure, account), account);
  assert.equal(normalized.httpCode, 502); assert.equal(normalized.resource_status, 'unavailable');
  assert.equal(errorOf({ statusCode: 503, message: 'Service Unavailable' }).resource_status, 'unavailable');
  assert.equal(resourceStatus('504'), 'unavailable');
  instance.request = async () => { calls++; throw errorOf(failure, account); };
  const result = await instance.resources.domains.batch(account, batch([record(), record('api')]));
  assert.equal(calls, 1);
  assert.deepEqual(result.data.map(row => row.status), ['uncertain', 'skipped']);
  assert.equal(result.data[0].http_code, 502);
});

test('批量解析逐条返回业务错误；凭据变更后剩余记录不再提交', async () => {
  const { instance, account } = service(); let calls = 0;
  instance.request = async () => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('record exists'), { code: 'InvalidParameter.RecordExists' });
    account.secret_key = 'changed'; return {};
  };
  const result = await instance.resources.domains.batch({ ...account }, batch([record(), record('api'), record('cdn')]));
  assert.deepEqual(result.data.map(row => row.status), ['failed', 'success', 'skipped']);
  assert.equal(calls, 2);
});

test('相同域名的批量操作互斥，批量启停固定使用所选 ID', async () => {
  const { instance, account } = service(); let release;
  const gate = new Promise(resolve => { release = resolve; });
  instance.request = async (_a, _s, action, params) => {
    assert.equal(action, 'ModifyRecordStatus'); assert.equal(params.RecordId, 42); assert.equal(params.Status, 'DISABLE');
    await gate; return {};
  };
  const input = { ...batch([{ id: 42 }]), operation: 'disable' };
  const pending = instance.resources.domains.batch(account, input);
  await assert.rejects(instance.resources.domains.batch(account, input), /正在执行/);
  await assert.rejects(instance.resources.domains.change(account, { domain: 'example.com', operation: 'delete', id: 42, confirm_id: 42 }), /正在执行/);
  release(); await pending;
  assert.equal(instance.resources.domains.batches.size, 0);
});

test('证书选择仅返回公开元数据，泛域名只能覆盖一层且不能覆盖根域', async () => {
  let params;
  const edge = new TencentEdge({ request: async (_a, product, action, input) => {
    assert.equal(product, 'ssl'); assert.equal(action, 'DescribeCertificates'); params = input;
    return { TotalCount: 1, Certificates: [{ CertificateId: 'ssl-1', Domain: '*.example.com', SubjectAltName: ['example.net'], PrivateKey: 'never-return', Certificate: 'pem-secret' }] };
  } });
  const list = await edge.certificates({}, { domain: 'www.example.com', keyword: 'my cert' });
  assert.equal(params.CertificateType, 'SVR'); assert.deepEqual(params.CertificateStatus, [1]); assert.equal(params.Deployable, 1);
  assert.equal(params.SearchKey, 'my cert'); assert.equal(list.data[0].matches, true);
  assert.doesNotMatch(JSON.stringify(list), /never-return|pem-secret/);
  assert.equal((await edge.certificates({}, { domain: 'example.com' })).data[0].matches, false);
  assert.equal((await edge.certificates({}, { domain: 'a.b.example.com' })).data[0].matches, false);
  assert.equal((await edge.certificates({}, { domain: '*.example.com' })).data[0].matches, true);
});

test('CDN 按任务 ID 查询全部分页，末页失败不能误判整批成功', async () => {
  const inputs = [];
  const edge = new TencentEdge({ isCurrent: () => true, request: async (_a, _s, action, params) => {
    assert.equal(action, 'DescribePurgeTasks'); inputs.push(params);
    return { TotalCount: 101, PurgeLogs: Array.from({ length: params.Offset === 0 ? 100 : 1 }, (_, index) => ({ TaskId: 'task-1', Url: `https://cdn.example.com/${params.Offset + index}`, Status: params.Offset ? 'fail' : 'done' })) };
  } });
  const result = await edge.taskProgress({}, { domain: 'cdn.example.com', kind: 'directory', task_id: 'task-1' });
  assert.equal(inputs.length, 2); assert.equal(inputs[1].Offset, 100); assert.equal(inputs[0].StartTime, undefined);
  assert.equal(inputs[0].TaskId, 'task-1'); assert.equal(inputs[0].PurgeType, 'path'); assert.equal(inputs[0].Keyword, 'cdn.example.com');
  assert.equal(result.complete, true); assert.equal(result.success, 100); assert.equal(result.failed, 1);
});

test('EdgeOne 跟踪固定站点与 job-id，处理中、未知或空结果不判定完成', async () => {
  let status = 'processing', empty = false;
  const edge = new TencentEdge({ isCurrent: () => true, request: async (_a, product, action, params) => {
    assert.equal(product, 'teo'); assert.equal(action, 'DescribePrefetchTasks'); assert.equal(params.ZoneId, 'zone-test');
    assert.deepEqual(params.Filters, [{ Name: 'domains', Values: ['cdn.example.com'] }, { Name: 'job-id', Values: ['job-1'] }]);
    return { TotalCount: empty ? 0 : 1, Tasks: empty ? [] : [{ JobId: 'job-1', Status: status }] };
  } });
  const data = { domain: 'cdn.example.com', zone_id: 'zone-test', kind: 'prefetch', task_id: 'job-1' };
  assert.equal((await edge.taskProgress({}, data)).complete, false);
  status = 'new-status'; assert.equal((await edge.taskProgress({}, data)).unknown, 1);
  status = 'success'; assert.equal((await edge.taskProgress({}, data)).complete, true);
  empty = true; assert.equal((await edge.taskProgress({}, data)).complete, false);
});

test('批量粘贴保留 TXT 空格，校验重复与 TTL，并规范 EdgeOne 主机名', () => {
  const ts = require('../frontend/node_modules/typescript');
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../frontend/src/views/tencent/record-batch.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const target = { exports: {} }; vm.runInThisContext(`(function(module, exports) { ${code}\n})`)(target, target.exports);
  const parse = target.exports.parseBatchRecords, options = { domain: 'example.com', edge: false, ttl: 600, line: '默认', line_id: '' };
  const result = parse('@\tTXT\tv=spf1 include:example.net ~all\nwww\tA\t192.0.2.1', options);
  assert.deepEqual(result.errors, []); assert.equal(result.records[0].value, 'v=spf1 include:example.net ~all');
  assert.equal(parse('www\tA\t192.0.2.1\nWWW\tA\t192.0.2.1', options).errors.length, 1);
  assert.equal(parse('@\tMX\tmx.example.com\t1\t51', { ...options, edge: true }).errors.length, 1);
  assert.equal(parse('@\tA\t192.0.2.1', { ...options, edge: true }).records[0].name, 'example.com');
});

test('COS 上传下载超过五分钟仍保留 IPC 结果监听，普通查询仍会超时', async () => {
  const ts = require('../frontend/node_modules/typescript');
  const listeners = new Map(), timers = new Map(), sent = [];
  let nextTimer = 0;
  const ipc = {
    on: (channel, callback) => listeners.set(channel, callback),
    removeListener: channel => listeners.delete(channel),
    send: (route, data) => sent.push({ route, ...data }),
  };
  const routes = { tencent: Object.fromEntries(['cos_upload', 'cos_download', 'find'].map(action => [action, { path: action }])) };
  function loadFrontend(relative, requireModule) {
    const source = fs.readFileSync(path.resolve(__dirname, '../frontend/src', relative), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const target = { exports: {} };
    vm.runInNewContext(code, { module: target, exports: target.exports, require: requireModule, toRaw: value => value,
      setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
      clearTimeout: id => timers.delete(id) });
    return target.exports;
  }
  const http = loadFrontend('api/http.ts', name => name === '@utils/ipcRenderer' ? { ipc } : { default: routes });
  const api = loadFrontend('views/tencent/api.ts', () => http);
  const upload = api.request('cos_upload'), download = api.request('cos_download');
  const query = api.request('find').catch(error => error.message);
  assert.equal(timers.size, 1);
  for (const [id, timer] of timers) if (timer.delay <= 300001) { timers.delete(id); timer.callback(); }
  assert.equal(await query, '请求超时'); assert.equal(listeners.size, 2);
  for (const item of sent.filter(row => row.route !== 'find')) listeners.get(item.channel)({}, { status: true, data: { canceled: false } });
  assert.deepEqual(await upload, { canceled: false }); assert.deepEqual(await download, { canceled: false });
  assert.equal(listeners.size, 0); assert.equal(timers.size, 0);
});
