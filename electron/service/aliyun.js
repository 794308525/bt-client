'use strict';

const Ecs = require('@alicloud/ecs20140526');
const AliDns = require('@alicloud/alidns20150109');
const Bss = require('@alicloud/bssopenapi20171214');
const Cdn = require('@alicloud/cdn20180510');
const Domain = require('@alicloud/domain20180129');
const ActionTrail = require('@alicloud/actiontrail20200706');
const Swas = require('@alicloud/swas-open20200601');
const Esa = require('@alicloud/esa20240910');
const { pub } = require('../class/public.js');

const SUMMARY_TTL = 5 * 60;
const REGION_TTL = 24 * 60 * 60;
const MAX_REGION_CONCURRENCY = 4;
const SWAS_BOOTSTRAP_REGION = 'cn-hangzhou';

const listCache = new Map();
const regionCache = new Map();

// 阿里云 ESA 2024-09-10 Create/Update/Delete/Get/ListRecord 官方错误码。
// 使用精确错误码翻译，避免用英文关键字猜测导致提示不准确；详情和 RequestId 仍会保留供排查。
const ESA_RECORD_ERROR_MESSAGES = {
  'Certificate.Duplicated': '该证书已上传到当前 ESA 站点，无需重复上传',
  'InvalidCertificate.NotFound': '指定的 ESA 证书不存在或已被删除',
  'InvalidSSLPub': '证书内容格式不正确，请重新签发后再试',
  'InvalidSSLPri': '证书私钥格式不正确，请重新签发后再试',
  'CertificateDomainNotMatchSite': '证书域名与当前 ESA 站点不匹配',
  'CertificateNotMatchPrivateKey': '证书与私钥不匹配，请重新签发后再试',
  'CertQuotaCheckFailed': '当前 ESA 站点的证书数量已达到上限',
  'Instance.NotOnline': '当前 ESA 套餐已欠费或未上线，请续费后重试',
  'InternalException': 'ESA 服务调用失败，请稍后重试；持续失败时请联系阿里云技术支持',
  'InvalidParameter.CnameSiteRecordNoProxied': '当前站点使用 CNAME 接入，解析记录必须开启代理加速',
  'InvalidParameter.CnameSiteRecordUnsupport': '当前站点使用 CNAME 接入，仅支持 A/AAAA 和 CNAME 记录',
  'InvalidParameter.InvalidBiz': '业务场景为空或不正确，请重新选择后重试',
  'InvalidParameter.InvalidDSRecordName': '请先添加或导入同名 NS 记录，再添加 DS 记录',
  'InvalidParameter.InvalidHostPolicy': '回源 Host 参数不正确，请检查后重试',
  'InvalidParameter.InvalidRecordName': '主机记录格式不正确，请按域名格式检查后重试',
  'InvalidParameter.InvalidRecordNameSuffix': '主机记录格式不正确：除根域名记录外，主机记录必须以当前 ESA 站点域名结尾',
  'InvalidParameter.PrivateIpAsSourceUnsupported': '记录值不能使用内网 IP，请更换为可访问的公网地址',
  'InvalidParameter.RecordCommentExceedLimit': '解析记录备注不能超过 50 个字符',
  'InvalidParameter.RecordData': '解析记录内容不正确，请检查记录类型和值',
  'InvalidParameter.RecordNameExceedLimit': '主机记录名称不能超过 200 个字符',
  'InvalidParameter.SourceIpInBlacklist': '记录值中的 IP 不受支持或已被限制，请更换后重试',
  'NoPermission': '当前 AccessKey 无权操作 ESA 解析记录，请授予 AliyunESAFullAccess 或对应的自定义权限',
  'QuotaExceed.RecordCount': '解析记录数量已达到套餐上限，请删除部分记录或升级套餐后重试',
  'QuotaExceed.WildCardRecord': '泛域名解析记录数量已达到套餐上限，请删除部分泛域名记录或升级额度后重试',
  'Record.AorAAAARecordValueContainInvalidIP': 'A/AAAA 记录值包含无效 IP，请检查后重试',
  'Record.AorAAAARecordValueIPExceedLimit': 'A/AAAA 记录值数量超限：一个主机记录最多支持 8 个 IPv4 和 4 个 IPv6 地址',
  'Record.CAARecordFlagExceedLimit': 'CAA 记录的 Flag 参数超出允许范围',
  'Record.CAARecordTagExceedLimit': 'CAA 记录的 Tag 仅支持 issue、issuewild 或 iodef',
  'Record.CERTRecordAlgorithmExceedLimit': 'CERT 记录的 Algorithm 参数超出允许范围',
  'Record.CERTRecordKeyTagExceedLimit': 'CERT 记录的 KeyTag 参数超出允许范围',
  'Record.CERTRecordTypeExceedLimit': 'CERT 记录的 Type 参数超出允许范围',
  'Record.CNameRecordValueCannotEqualExistedIPASource': '该 CNAME 记录值已被四层应用用作源站，请调整后重试',
  'Record.CNameRecordValueCannotEqualExistedPoolSource': '该 CNAME 记录值已被源地址池用作源站，请调整后重试',
  'Record.CNameRecordValueCannotEqualExistedRecordSource': '该 CNAME 记录值已被其他解析记录用作源站，请调整后重试',
  'Record.CNameRecordValueCannotEqualHostRecord': 'CNAME 记录值不能与主机记录相同，请调整后重试',
  'Record.CNameRecordValueCannotEqualOtherExistedIPARecord': 'CNAME 记录值不能与已有四层代理记录名称相同',
  'Record.CNameRecordValueCannotEqualOtherExistedRecord': 'CNAME 记录值不能与已有 CNAME 记录名称相同',
  'Record.CNameRecordValueExceedLimit': 'CNAME 记录值不能超过 253 个字符',
  'Record.CNameRecordValueInvalidDomainUnderline': 'CNAME 记录值格式不正确：仅 DNS 模式下可以使用规定位置的下划线',
  'Record.CNameRecordValueInvalidRecordDomain': 'CNAME 记录值格式不正确：开启代理时请使用合法域名，不能包含下划线',
  'Record.Conflict': '当前解析记录与已有记录冲突，请检查主机记录、类型和值',
  'Record.EmptyRecordValue': '解析记录值不能为空',
  'Record.InvalidCertEncodeWithCERTRecord': 'CERT 记录的证书值不是有效的 Base64 编码',
  'Record.InvalidFingerprintWithSSHFPRecord': 'SSHFP 记录的指纹不是有效的十六进制编码',
  'Record.InvalidHTTPURLValueWithCAARecordTag': 'CAA 记录的 iodef 值必须是合法的 HTTP 或 HTTPS 地址',
  'Record.InvalidIodefDataWithCAARecordTag': 'CAA 记录的 iodef 值格式不正确，请填写合法邮箱或 URL',
  'Record.InvalidIssueDataWithCAARecordTag': 'CAA 记录的 issue/issuewild 值必须是合法域名，可使用分号分隔参数',
  'Record.InvalidMailAddressWithCAARecordTag': 'CAA 记录的 mailto: 后必须填写合法邮箱地址',
  'Record.InvalidSmimeaEncodeWithSMIMEARecord': 'SMIMEA 记录的证书值不是有效的 Base64 编码',
  'Record.InvalidTslaEncodeWithTSLARecord': 'TLSA 记录的证书值不是有效的十六进制编码',
  'Record.InvalidURLWithURIRecord': 'URI 记录值必须是合法的 URL 地址',
  'Record.NoRecordNameConflictWithNSRecord': '该主机记录名称与已有 NS 记录冲突',
  'Record.NoResource': 'ESA 无法为该解析记录分配资源，请稍后重试或提交阿里云工单',
  'Record.NotFound': '该 ESA 解析记录不存在或已被删除，请刷新列表后重试',
  'Record.NSRecordCannotEqualSiteName': 'NS 记录不能与 ESA 站点域名完全相同',
  'Record.OSSSourceInvalidAuthType': 'OSS 源站鉴权类型不受支持',
  'Record.ParseJSONRecordValueFailed': '解析记录值中的 JSON 格式不正确，请检查后重试',
  'Record.PoolSourceNotExistPool': '选择的源地址池不存在，请刷新后重新选择',
  'Record.ProtectedAsCustomHostnameSource': '该记录正被自定义主机名用作源站，移除相关引用后才能删除',
  'Record.ProxiedAsCustomHostnameSource': '该记录正被自定义主机名用作源站，移除相关引用后才能关闭代理',
  'Record.RecordMatchingTypeExceedLimit': '记录的 MatchingType 参数超出允许范围',
  'Record.RecordNameConflictForSpecifiedRecordType': '同一主机记录不能同时存在 A/AAAA 与 CNAME 记录',
  'Record.RecordNameConflictWithIPAName': '主机记录名称与已有四层代理记录重名',
  'Record.RecordNameConflictWithLBName': '主机记录名称与已有负载均衡记录重名',
  'Record.RecordNameConflictWithNSRecord': 'NS 记录名称不能与其他类型的解析记录重名',
  'Record.RecordNameConflictWithPoolName': '主机记录名称与已有源地址池重名',
  'Record.RecordNameConflictWithSameRecordType': '已存在主机记录、类型和值均相同的解析记录',
  'Record.RecordNameInBlacklist': '该主机记录名称已被限制，无法添加',
  'Record.RecordPriorityExceedLimit': '解析记录优先级超出允许范围',
  'Record.RecordSelectorExceedLimit': '记录的 Selector 参数超出允许范围',
  'Record.RecordUsageExceedLimit': '记录的 Usage 参数超出允许范围',
  'Record.RecordValueContainSourceInBlacklist': '解析记录值包含受限源站地址，请更换后重试或提交阿里云工单',
  'Record.RecordWeightExceedLimit': '解析记录权重超出允许范围',
  'Record.Reserved': '该解析记录正在执行其他操作，请稍后重试',
  'Record.S3SourceInvalidAuthRegion': 'S3 源站所在地域不受支持',
  'Record.S3SourceInvalidAuthType': 'S3 源站鉴权类型不受支持',
  'Record.S3SourceInvalidAuthVersion': 'S3 源站签名算法版本不受支持',
  'Record.ServiceBusy': '该解析记录正在配置中，请稍后重试',
  'Record.SourceAccessKeyExceedLimit': '源站 AccessKey 长度超出允许范围',
  'Record.SourceEmptyAK': '源站 AccessKey 不能为空',
  'Record.SourceEmptyAuthConf': '源站鉴权信息不能为空',
  'Record.SourceEmptySecretKey': '源站 SecretKey 不能为空',
  'Record.SourceSecretKeyExceedLimit': '源站 SecretKey 长度超出允许范围',
  'Record.SRVRecordInvalidRecordName': 'SRV 主机记录格式不正确，请使用“_服务._协议.域名”格式',
  'Record.SRVRecordPortExceedLimit': 'SRV 记录端口超出允许范围',
  'Record.SSHFPRecordAlgorithmExceedLimit': 'SSHFP 记录的 Algorithm 参数超出允许范围',
  'Record.TTLExceedLimit': 'TTL 超出允许范围，请填写 1 或 30–86400 之间的整数',
  'Record.TXTRecordValueExceedLimit': 'TXT 记录值不能超过 450 个字符',
  'Record.TypeExceedLimitWithSSHFPRecord': 'SSHFP 记录的 Type 参数超出允许范围',
  'Record.UnmatchedRecordNameContainDoubleConsecutiveDot': '主机记录不能包含连续的点号',
  'Record.UnmatchedRecordNameForbidStarSev': 'SRV 主机记录不能使用通配符',
  'Record.UnmatchedRecordNameInvalidATChar': '@ 只能单独表示根域名，不能与其他字符组合使用',
  'Record.UnmatchedRecordNameInvalidNamePrefixSuffix': '主机记录不能以点号或中划线开头、结尾',
  'Record.UnmatchedRecordNameInvalidStartSymbol': '通配符 * 只能位于主机记录开头，且后面必须紧跟点号',
  'Record.UnmatchedRecordNameInvalidUnderLine': '主机记录中的下划线位置不合法；仅部分记录类型在 DNS 模式下支持以下划线开头',
  'Record.UnmatchedRecordNameOnlyContainSymbol': '主机记录不能只包含符号，请至少加入一个字母或数字',
  'Record.UnmatchedRecordNameOnlyRangeChars': '主机记录包含非法字符，仅支持字母、数字、中划线、下划线、点号、通配符和 @',
  'Record.UnmatchedRecordNameSeperateStringTooLarge': '主机记录中由点号分隔的每一段不能超过 63 个字符',
  'Record.UnsupportedSourceType': '当前源站类型不受支持',
  'Record.UnsupportedType': '当前解析记录类型不受支持',
  'Record.ValidProxiedForSpecifedRecordType': '只有 A/AAAA 和 CNAME 记录支持开启代理加速',
  'Record.WildcardConflictForSpecifiedRecordType': 'A/AAAA、CNAME 记录不能同时存在 all 与星号通配符记录',
  'SameNameRecordExceedLimit': '同名解析记录数量已达到上限，请删除部分记录后重试',
  'ServiceInvokeFailed': 'ESA 服务调用失败，请稍后重试；持续失败时请联系阿里云技术支持',
  'Site.ServiceBusy': '当前 ESA 站点正在配置中，请稍后重试',
  'SourceCircleExist': '主机记录与源站形成回环，请修改主机记录或源站地址后重试',
};

class AliyunServiceError extends Error {
  constructor(message, code = 'AliyunError', requestId = '', detail = '') {
    super(message);
    this.name = 'AliyunServiceError';
    this.code = code;
    this.requestId = requestId;
    this.detail = detail;
  }
}

function sanitizeErrorDetail(value) {
  return String(value || '')
    .replace(/(AccessKeyId|AccessKeySecret|SecurityToken|Signature|Password|Secret)([=:\s]+)([^\s,&}]+)/gi, '$1$2***')
    .slice(0, 2000);
}

function getBody(response) {
  return response && response.body ? response.body : {};
}

function getRequestId(error) {
  return error && (error.requestId || (error.data && error.data.RequestId) || (error.data && error.data.requestId)) || '';
}

function getErrorCode(error, sourceMessage) {
  const dataCode = error && error.data && (error.data.Code || error.data.code);
  const messageCode = String(sourceMessage || '').match(/^([A-Za-z][A-Za-z0-9._-]+):\s*code\b/i);
  return String(error && error.code || dataCode || (messageCode && messageCode[1]) || error && error.name || 'AliyunError');
}

function normalizeError(error) {
  if (error instanceof AliyunServiceError) return error;
  const sourceMessage = String(error && error.message || '阿里云接口请求失败');
  const code = getErrorCode(error, sourceMessage);
  const requestId = getRequestId(error);
  const detail = sanitizeErrorDetail([
    sourceMessage,
    error && error.data && typeof error.data === 'object'
      ? JSON.stringify({ code: error.data.Code || error.data.code, message: error.data.Message || error.data.message, requestId })
      : '',
  ].filter(Boolean).join('\n'));
  const lower = `${code} ${sourceMessage}`.toLowerCase();
  let message = ESA_RECORD_ERROR_MESSAGES[code] || sourceMessage;

  if (ESA_RECORD_ERROR_MESSAGES[code]) {
    // 精确错误码翻译优先于后面的通用网络、权限等判断。
  } else if (lower.includes('invalidaccesskey') || lower.includes('signaturedoesnotmatch')) {
    message = 'AccessKey 无效或 AccessKey Secret 不正确';
  } else if (lower.includes('forbidden') || lower.includes('unauthorized') || lower.includes('no permission')) {
    message = '当前 AccessKey 没有此功能所需的 RAM 权限';
  } else if (lower.includes('throttl') || lower.includes('flow control')) {
    message = '阿里云接口请求过于频繁，请稍后重试';
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
    message = '连接阿里云接口超时，请检查网络后重试';
  } else if (lower.includes('network') || lower.includes('enotfound') || lower.includes('econn')) {
    message = '无法连接阿里云接口，请检查网络后重试';
  }

  return new AliyunServiceError(message, code, requestId, detail);
}

async function mapLimit(items, limit, handler) {
  const result = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await handler(items[index], index);
    }
  });
  await Promise.all(workers);
  return result;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function normalizeNameServers(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return unique(values.map(item => String(item || '').trim().toLowerCase().replace(/\.$/, '')).filter(Boolean));
}

function isAliDnsNameServer(value) {
  return /(^|\.)(alidns\.com|hichina\.com)$/.test(String(value || '').toLowerCase());
}

function isEsaNameServer(value) {
  return /(^|\.)ialicdn\.com$/.test(String(value || '').toLowerCase());
}

function normalizeRecordStatus(status) {
  const value = String(status || '').toUpperCase();
  if (value === 'ENABLE') return 'Enable';
  if (value === 'DISABLE') return 'Disable';
  return String(status || '');
}

function isCdnNotOpenedError(error) {
  const code = String(error && (error.code || error.name) || '').toLowerCase();
  const message = String(error && error.message || '').toLowerCase();
  return code === 'cdnservicenotfound' || message.includes('does not open cdn service');
}

class AliyunService {
  updateResourceCount(accountId, field, value) {
    if (!['server_count', 'domain_count', 'esa_count', 'cdn_count'].includes(field)) return;
    pub.M('aliyun_account').where('account_id=?', Number(accountId) || 0).update({
      [field]: Math.max(0, Number(value) || 0),
    });
  }

  getAccount(accountId) {
    const account = pub.M('aliyun_account').where('account_id=?', Number(accountId) || 0).find();
    if (!account) throw new AliyunServiceError('指定阿里云账号不存在', 'AccountNotFound');
    if (!account.access_key_id || !account.access_key_secret) {
      throw new AliyunServiceError('阿里云账号的 AccessKey 信息不完整', 'InvalidAccessKey');
    }
    return account;
  }

  createConfig(account, regionId = 'cn-hangzhou') {
    return {
      accessKeyId: account.access_key_id,
      accessKeySecret: account.access_key_secret,
      regionId,
      connectTimeout: 10000,
      readTimeout: 20000,
    };
  }

  createClients(account, regionId = 'cn-hangzhou') {
    const config = this.createConfig(account, regionId);
    return {
      bss: new Bss.default(config),
      cdn: new Cdn.default(config),
      actionTrail: new ActionTrail.default({ ...config, endpoint: 'actiontrail.cn-hangzhou.aliyuncs.com' }),
      domain: new Domain.default({ ...config, endpoint: 'domain.aliyuncs.com' }),
      dns: new AliDns.default({ ...config, endpoint: 'alidns.cn-hangzhou.aliyuncs.com' }),
      ecs: new Ecs.default(config),
      esa: new Esa.default(config),
    };
  }

  getSwasEndpoint(regionId, endpoint = '') {
    const normalizedRegionId = String(regionId || '').trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(normalizedRegionId)) {
      throw new AliyunServiceError('轻量服务器地域信息不正确', 'InvalidSwasRegion');
    }
    const normalizedEndpoint = String(endpoint || `swas.${normalizedRegionId}.aliyuncs.com`)
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/$/, '');
    if (normalizedEndpoint !== `swas.${normalizedRegionId}.aliyuncs.com`) {
      throw new AliyunServiceError('轻量服务器接口地址不正确', 'InvalidSwasEndpoint');
    }
    return normalizedEndpoint;
  }

  createSwasClient(account, regionId, endpoint = '') {
    const config = this.createConfig(account, regionId);
    return new Swas.default({
      ...config,
      endpoint: this.getSwasEndpoint(regionId, endpoint),
    });
  }

  async request(handler) {
    try {
      return await handler();
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async queryBalance(account) {
    const { bss } = this.createClients(account);
    const body = getBody(await this.request(() => bss.queryAccountBalance()));
    if (body.success === false) {
      throw new AliyunServiceError(body.message || '查询账号余额失败', body.code || 'BalanceQueryFailed', body.requestId);
    }
    return {
      balance: body.data && body.data.availableAmount || '',
      currency: body.data && body.data.currency || 'CNY',
      requestId: body.requestId || '',
    };
  }

  async refreshBalance(accountId) {
    const account = this.getAccount(accountId);
    const result = await this.queryBalance(account);
    const refreshTime = Math.floor(Date.now() / 1000);
    pub.M('aliyun_account').where('account_id=?', account.account_id).update({
      balance: result.balance,
      balance_currency: result.currency,
      balance_refresh_time: refreshTime,
    });
    return {
      balance: result.balance,
      balance_currency: result.currency,
      balance_refresh_time: refreshTime,
      requestId: result.requestId,
    };
  }

  async getRegions(account, source) {
    const key = `${account.account_id}:${source}`;
    const cached = regionCache.get(key);
    const now = Math.floor(Date.now() / 1000);
    if (cached && now - cached.time < REGION_TTL) return cached.data;

    let regions = [];
    if (source === 'ecs') {
      const clients = this.createClients(account);
      const response = await this.request(() => clients.ecs.describeRegions(new Ecs.DescribeRegionsRequest({
        acceptLanguage: 'zh-CN',
        resourceType: 'instance',
      })));
      regions = ((getBody(response).regions || {}).region || []).map(item => ({
        region_id: item.regionId,
        name: item.localName || item.regionId,
      }));
    } else {
      const swas = this.createSwasClient(account, SWAS_BOOTSTRAP_REGION);
      const response = await this.request(() => swas.listRegions(new Swas.ListRegionsRequest({
        acceptLanguage: 'zh-CN',
      })));
      regions = (getBody(response).regions || []).map(item => ({
        region_id: item.regionId,
        name: item.localName || item.regionId,
        endpoint: item.regionEndpoint || '',
      }));
    }

    regions = regions.filter(item => item.region_id);
    regionCache.set(key, { time: now, data: regions });
    return regions;
  }

  async getResourceCount(account, source) {
    const regions = await this.getRegions(account, source);
    const failures = [];
    let count = 0;
    await mapLimit(regions, MAX_REGION_CONCURRENCY, async region => {
      try {
        if (source === 'ecs') {
          const clients = this.createClients(account, region.region_id);
          const response = await this.request(() => clients.ecs.describeInstances(new Ecs.DescribeInstancesRequest({
            regionId: region.region_id,
            pageNumber: 1,
            pageSize: 1,
          })));
          count += Number(getBody(response).totalCount || 0);
        } else {
          const swas = this.createSwasClient(account, region.region_id, region.endpoint);
          const response = await this.request(() => swas.listInstances(new Swas.ListInstancesRequest({
            regionId: region.region_id,
            pageNumber: 1,
            pageSize: 1,
          })));
          count += Number(getBody(response).totalCount || 0);
        }
      } catch (error) {
        const normalized = normalizeError(error);
        failures.push({ region_id: region.region_id, errorCode: normalized.code, message: normalized.message, requestId: normalized.requestId, detail: normalized.detail });
      }
    });
    if (regions.length && failures.length === regions.length) throw new AliyunServiceError(failures[0].message, failures[0].errorCode, failures[0].requestId, failures[0].detail);
    return { count, failures };
  }

  async getDomainCount(account) {
    const { dns } = this.createClients(account);
    const response = await this.request(() => dns.describeDomains(new AliDns.DescribeDomainsRequest({
      pageNumber: 1,
      pageSize: 1,
      lang: 'zh',
    })));
    return Number(getBody(response).totalCount || 0);
  }

  async getEsaCount(account) {
    const { esa } = this.createClients(account);
    const response = await this.request(() => esa.listSites(new Esa.ListSitesRequest({
      pageNumber: 1,
      pageSize: 1,
    })));
    return Number(getBody(response).totalCount || 0);
  }

  async getCdnCount(account) {
    const { cdn } = this.createClients(account);
    try {
      const response = await this.request(() => cdn.describeUserDomains(new Cdn.DescribeUserDomainsRequest({
        pageNumber: 1,
        pageSize: 1,
        checkDomainShow: true,
      })));
      return { count: Number(getBody(response).totalCount || 0), status: 'active' };
    } catch (error) {
      if (isCdnNotOpenedError(error)) return { count: 0, status: 'not_opened' };
      throw error;
    }
  }

  async refreshSummary(accountId, force = false) {
    const account = this.getAccount(accountId);
    const now = Math.floor(Date.now() / 1000);
    if (!force && account.resource_refresh_time && now - Number(account.resource_refresh_time) < SUMMARY_TTL) {
      return this.safeAccount(account);
    }

    const [balanceResult, domainResult, esaResult, cdnResult, ecsResult, swasResult] = await Promise.allSettled([
      this.queryBalance(account),
      this.getDomainCount(account),
      this.getEsaCount(account),
      this.getCdnCount(account),
      this.getResourceCount(account, 'ecs'),
      this.getResourceCount(account, 'swas'),
    ]);
    const update = { resource_refresh_time: now };
    const errors = [];
    const addError = (source, error) => {
      const normalized = normalizeError(error);
      errors.push({
        source,
        message: normalized.message,
        code: normalized.code,
        requestId: normalized.requestId,
        detail: normalized.detail,
      });
    };

    if (balanceResult.status === 'fulfilled') {
      update.balance = balanceResult.value.balance;
      update.balance_currency = balanceResult.value.currency;
      update.balance_refresh_time = now;
    } else addError('账号余额', balanceResult.reason);

    if (domainResult.status === 'fulfilled') update.domain_count = domainResult.value;
    else addError('域名解析', domainResult.reason);

    if (esaResult.status === 'fulfilled') update.esa_count = esaResult.value;
    else addError('ESA', esaResult.reason);

    if (cdnResult.status === 'fulfilled') {
      update.cdn_count = cdnResult.value.count;
      update.cdn_status = cdnResult.value.status;
    }
    else addError('CDN', cdnResult.reason);

    let serverCount = 0;
    let hasServerResult = false;
    for (const [source, result] of [['ECS', ecsResult], ['轻量服务器', swasResult]]) {
      if (result.status === 'fulfilled') {
        hasServerResult = true;
        serverCount += result.value.count;
        result.value.failures.forEach(item => addError(
          item.region_id ? `${source}（${item.region_id}）` : source,
          new AliyunServiceError(item.message, item.errorCode, item.requestId, item.detail)
        ));
      } else addError(source, result.reason);
    }
    if (hasServerResult) update.server_count = serverCount;
    update.resource_error = errors.map(item => item.message).filter((item, index, all) => all.indexOf(item) === index).join('；');
    update.resource_error_detail = errors.map(item => {
      const lines = [
        item.source ? `接口：${item.source}` : '',
        item.message,
        item.code ? `错误码：${item.code}` : '',
        item.requestId ? `RequestId：${item.requestId}` : '',
        item.detail ? `详情：${item.detail}` : '',
      ];
      return lines.filter(Boolean).join('\n');
    }).filter((item, index, all) => item && all.indexOf(item) === index).join('\n\n');

    pub.M('aliyun_account').where('account_id=?', account.account_id).update(update);
    return this.safeAccount(pub.M('aliyun_account').where('account_id=?', account.account_id).find());
  }

  safeAccount(account) {
    if (!account) return null;
    return {
      account_id: account.account_id,
      group_id: account.group_id,
      remark: account.remark,
      access_key_id: account.access_key_id,
      balance: account.balance,
      balance_currency: account.balance_currency || 'CNY',
      balance_refresh_time: Number(account.balance_refresh_time || 0),
      server_count: Number(account.server_count),
      domain_count: Number(account.domain_count),
      esa_count: Number(account.esa_count),
      cdn_count: Number(account.cdn_count),
      cdn_status: account.cdn_status || 'unknown',
      sort: Number(account.sort),
      addtime: Number(account.addtime),
      update_time: Number(account.update_time),
      resource_refresh_time: Number(account.resource_refresh_time || 0),
      resource_error: account.resource_error || '',
      resource_error_detail: account.resource_error_detail || '',
    };
  }

  normalizeEcsInstance(instance, regionId) {
    return {
      source: 'ecs',
      instance_id: instance.instanceId,
      name: instance.instanceName || instance.instanceId,
      region_id: instance.regionId || regionId,
      status: instance.status || '',
      os_type: instance.OSType || '',
      os_name: instance.OSName || instance.OSNameEn || '',
      public_ips: unique([
        ...((instance.publicIpAddress || {}).ipAddress || []),
        instance.eipAddress && instance.eipAddress.ipAddress,
      ]),
      private_ips: unique([
        ...((instance.innerIpAddress || {}).ipAddress || []),
        ...((instance.vpcAttributes || {}).privateIpAddress || {}).ipAddress || [],
      ]),
      cpu_cores: Number(instance.cpu || 0),
      memory_gb: Number(instance.memory || 0) / 1024,
      bandwidth_mbps: Math.max(
        Number(instance.internetMaxBandwidthOut || 0),
        Number(instance.eipAddress && instance.eipAddress.bandwidth || 0)
      ),
      disk_gb: null,
      monthly_traffic_gb: null,
      instance_type: instance.instanceType || '',
      charge_type: instance.instanceChargeType || '',
      expired_time: instance.expiredTime || '',
    };
  }

  normalizeSwasInstance(instance, regionId) {
    const resourceSpec = instance.resourceSpec || {};
    const disks = Array.isArray(instance.disks) ? instance.disks : [];
    const networkAttributes = Array.isArray(instance.networkAttributes) ? instance.networkAttributes : [];
    const diskSize = disks.length
      ? disks.reduce((total, disk) => total + Number(disk.size || 0), 0)
      : Number(resourceSpec.diskSize || 0);
    return {
      source: 'swas',
      instance_id: instance.instanceId,
      name: instance.instanceName || instance.instanceId,
      region_id: instance.regionId || regionId,
      status: instance.status || '',
      os_type: instance.image && instance.image.osType || '',
      os_name: instance.image && (instance.image.imageName || instance.image.osName) || '',
      public_ips: unique([instance.publicIpAddress]),
      private_ips: unique([instance.innerIpAddress]),
      cpu_cores: Number(resourceSpec.cpu || 0),
      memory_gb: Number(resourceSpec.memory || 0),
      bandwidth_mbps: Number(resourceSpec.bandwidth || (networkAttributes[0] && networkAttributes[0].peakBandwidth) || 0),
      disk_gb: diskSize || null,
      monthly_traffic_gb: Number(resourceSpec.flow || 0) || null,
      instance_type: instance.planId || '',
      charge_type: instance.chargeType || '',
      expired_time: instance.expiredTime || '',
    };
  }

  async getEcsDiskTotals(clients, regionId) {
    const totals = new Map();
    let page = 1;
    let total = 0;
    let loaded = 0;
    do {
      const body = getBody(await this.request(() => clients.ecs.describeDisks(new Ecs.DescribeDisksRequest({
        regionId,
        pageNumber: page,
        pageSize: 100,
      }))));
      const disks = ((body.disks || {}).disk || []);
      disks.forEach(disk => {
        if (!disk.instanceId) return;
        totals.set(disk.instanceId, (totals.get(disk.instanceId) || 0) + Number(disk.size || 0));
      });
      loaded += disks.length;
      total = Number(body.totalCount || 0);
      page += 1;
    } while (loaded < total);
    return totals;
  }

  async fetchRegionInstances(account, source, region) {
    const clients = source === 'ecs' ? this.createClients(account, region.region_id) : null;
    const swas = source === 'swas'
      ? this.createSwasClient(account, region.region_id, region.endpoint)
      : null;
    const items = [];
    const failures = [];
    let page = 1;
    let total = 0;
    do {
      let body;
      if (source === 'ecs') {
        body = getBody(await this.request(() => clients.ecs.describeInstances(new Ecs.DescribeInstancesRequest({
          regionId: region.region_id,
          pageNumber: page,
          pageSize: 100,
        }))));
        items.push(...(((body.instances || {}).instance || []).map(item => this.normalizeEcsInstance(item, region.region_id))));
      } else {
        body = getBody(await this.request(() => swas.listInstances(new Swas.ListInstancesRequest({
          regionId: region.region_id,
          pageNumber: page,
          pageSize: 100,
        }))));
        items.push(...((body.instances || []).map(item => this.normalizeSwasInstance(item, region.region_id))));
      }
      total = Number(body.totalCount || 0);
      page += 1;
    } while (items.length < total);
    if (source === 'ecs' && items.length) {
      try {
        const diskTotals = await this.getEcsDiskTotals(clients, region.region_id);
        items.forEach(item => {
          item.disk_gb = diskTotals.has(item.instance_id) ? diskTotals.get(item.instance_id) : null;
        });
      } catch (error) {
        const normalized = normalizeError(error);
        failures.push({
          source: 'ecs-disk',
          region_id: region.region_id,
          errorCode: normalized.code,
          message: `磁盘配置获取失败：${normalized.message}`,
          requestId: normalized.requestId,
          detail: normalized.detail,
        });
      }
    }
    return { items, failures };
  }

  async listServers(accountId, force = false) {
    const cacheKey = `servers:${accountId}`;
    const cached = listCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);
    if (!force && cached && now - cached.time < SUMMARY_TTL) {
      if (cached.data.count_complete) this.updateResourceCount(accountId, 'server_count', cached.data.data.length);
      return cached.data;
    }
    const account = this.getAccount(accountId);
    const sourceResults = await Promise.allSettled(['ecs', 'swas'].map(async source => ({
      source,
      regions: await this.getRegions(account, source),
    })));
    const tasks = [];
    const failures = [];
    sourceResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        result.value.regions.forEach(region => tasks.push({ source: result.value.source, region }));
      } else {
        const error = normalizeError(result.reason);
        failures.push({ source: index === 0 ? 'ecs' : 'swas', region_id: '', errorCode: error.code, message: error.message, requestId: error.requestId, detail: error.detail });
      }
    });

    const taskResults = await mapLimit(tasks, MAX_REGION_CONCURRENCY, async task => {
      try {
        const result = await this.fetchRegionInstances(account, task.source, task.region);
        failures.push(...result.failures);
        return result.items;
      } catch (error) {
        const normalized = normalizeError(error);
        failures.push({ source: task.source, region_id: task.region.region_id, errorCode: normalized.code, message: normalized.message, requestId: normalized.requestId, detail: normalized.detail });
        return [];
      }
    });
    const data = {
      data: taskResults.flat(),
      partial: failures.length > 0,
      count_complete: failures.every(item => item.source === 'ecs-disk'),
      failures,
      refresh_time: now,
    };
    if (!data.data.length && failures.length) throw new AliyunServiceError(failures[0].message, failures[0].errorCode, failures[0].requestId, failures[0].detail);
    listCache.set(cacheKey, { time: now, data });
    if (data.count_complete) this.updateResourceCount(accountId, 'server_count', data.data.length);
    return data;
  }

  async listDomains(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const { dns } = this.createClients(account);
    const response = await this.request(() => dns.describeDomains(new AliDns.DescribeDomainsRequest({
      pageNumber: Math.max(1, Number(options.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(options.page_size) || 50)),
      keyWord: String(options.keyword || ''),
      searchMode: 'LIKE',
      lang: 'zh',
    })));
    const body = getBody(response);
    const registrationMap = await this.getRegisteredDomainMap(account);
    const result = {
      data: ((body.domains || {}).domain || []).map(item => {
        const registration = registrationMap.get(String(item.domainName || '').toLowerCase()) || {};
        return {
          domain_id: item.domainId,
          domain_name: item.domainName,
          group_name: item.groupName || '',
          record_count: Number(item.recordCount || 0),
          version_name: item.versionName || '',
          instance_end_time: item.instanceEndTime || '',
          instance_expired: !!item.instanceExpired,
          expiration_date: registration.expiration_date || '',
          expiration_days: Number.isFinite(registration.expiration_days) ? registration.expiration_days : null,
        };
      }),
      total: Number(body.totalCount || 0),
      page: Number(body.pageNumber || options.page || 1),
      page_size: Number(body.pageSize || options.page_size || 50),
      requestId: body.requestId || '',
    };
    if (!String(options.keyword || '').trim()) this.updateResourceCount(accountId, 'domain_count', result.total);
    return result;
  }

  async getRegisteredDomainMap(account) {
    const cacheKey = `registered-domains:${account.account_id}`;
    const cached = listCache.get(cacheKey);
    const now = Math.floor(Date.now() / 1000);
    if (cached && now - cached.time < SUMMARY_TTL) return cached.data;
    const result = new Map();
    try {
      const { domain } = this.createClients(account);
      for (let pageNum = 1; pageNum <= 100; pageNum++) {
        const body = getBody(await this.request(() => domain.queryDomainList(new Domain.QueryDomainListRequest({
          pageNum,
          pageSize: 100,
          lang: 'zh',
          orderKeyType: 'ExpirationDate',
          orderByType: 'ASC',
        }))));
        const domains = ((body.data || {}).domain || []);
        domains.forEach(item => {
          const name = String(item.domainName || '').trim().toLowerCase();
          if (!name) return;
          result.set(name, {
            expiration_date: item.expirationDate || (item.expirationDateLong ? new Date(Number(item.expirationDateLong)).toISOString() : ''),
            expiration_days: Number(item.expirationCurrDateDiff),
          });
        });
        if (!body.nextPage || !domains.length) break;
      }
    } catch (_error) {
      // 域名可能不在当前账号，或 AccessKey 未授予域名查询权限；不影响解析列表。
    }
    listCache.set(cacheKey, { time: now, data: result });
    return result;
  }

  async getDomainInfo(accountId, domainName) {
    const normalizedDomainName = String(domainName || '').trim().toLowerCase();
    if (!normalizedDomainName) throw new AliyunServiceError('请选择域名', 'DomainRequired');
    const account = this.getAccount(accountId);
    const { dns, esa } = this.createClients(account);
    const [dnsResponse, esaResponse] = await Promise.all([
      this.request(() => dns.describeDomainNs(new AliDns.DescribeDomainNsRequest({
        domainName: normalizedDomainName,
        lang: 'zh',
      }))),
      this.request(() => esa.listSites(new Esa.ListSitesRequest({
        pageNumber: 1,
        pageSize: 500,
        siteName: normalizedDomainName,
        siteSearchType: 'fuzzy',
      }))).catch(() => null),
    ]);
    const dnsBody = getBody(dnsResponse);
    const dnsServers = normalizeNameServers((dnsBody.dnsServers || {}).dnsServer || []);
    const esaSites = getBody(esaResponse).sites || [];
    const esaSite = esaSites.find(item => String(item.siteName || '').trim().toLowerCase() === normalizedDomainName);
    const esaInCurrentAccount = !!(esaSite && esaSite.siteId);
    const esaNameServers = normalizeNameServers(esaSite && esaSite.nameServerList);
    const isEsaDns = dnsServers.length > 0 && (
      dnsServers.every(isEsaNameServer)
      || (!!esaSite
        && String(esaSite.accessType || '').toUpperCase() === 'NS'
        && esaNameServers.length > 0
        && esaNameServers.every(item => dnsServers.includes(item)))
    );
    const provider = isEsaDns
      ? 'esa'
      : dnsServers.length && dnsServers.every(isAliDnsNameServer)
        ? 'alidns'
        : dnsServers.length ? 'external' : 'unknown';

    return {
      domain_name: dnsBody.domainName || normalizedDomainName,
      dns_servers: dnsServers,
      dns_provider: provider,
      esa_in_current_account: isEsaDns && esaInCurrentAccount,
      esa_site_id: isEsaDns && esaInCurrentAccount ? String(esaSite.siteId) : '',
      esa_site_name: isEsaDns && esaInCurrentAccount ? esaSite.siteName || '' : '',
      requestId: dnsBody.requestId || '',
    };
  }

  async listEsaSites(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const keyword = String(options.keyword || '').trim();
    const request = {
      pageNumber: Math.max(1, Number(options.page) || 1),
      pageSize: Math.min(500, Math.max(1, Number(options.page_size) || 50)),
    };
    if (keyword) {
      request.siteName = keyword;
      request.siteSearchType = 'fuzzy';
    }
    if (options.status && options.status !== 'all') request.status = String(options.status);
    const body = getBody(await this.request(() => esa.listSites(new Esa.ListSitesRequest(request))));
    const result = {
      data: (body.sites || []).map(item => ({
        site_id: String(item.siteId || ''),
        site_name: item.siteName || '',
        access_type: item.accessType || '',
        coverage: item.coverage || '',
        status: item.status || '',
        cname_zone: item.cnameZone || '',
        name_servers: item.nameServerList || '',
        plan_name: item.planName || '',
        plan_spec_name: item.planSpecName || '',
        offline_reason: item.offlineReason || '',
        create_time: item.createTime || '',
        update_time: item.updateTime || '',
      })),
      total: Number(body.totalCount || 0),
      page: Number(body.pageNumber || request.pageNumber),
      page_size: Number(body.pageSize || request.pageSize),
      requestId: body.requestId || '',
    };
    if (!keyword && (!options.status || options.status === 'all')) this.updateResourceCount(accountId, 'esa_count', result.total);
    return result;
  }

  normalizeEsaSiteId(siteId) {
    const value = Number(siteId);
    if (!Number.isFinite(value) || value <= 0) {
      throw new AliyunServiceError('ESA 站点 ID 不正确', 'InvalidEsaSiteId');
    }
    return value;
  }

  async getEsaSiteDetail(accountId, siteId) {
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const body = getBody(await this.request(() => esa.getSite(new Esa.GetSiteRequest({
      siteId: this.normalizeEsaSiteId(siteId),
    }))));
    const site = body.siteModel || {};
    return {
      site_id: String(site.siteId || siteId),
      site_name: site.siteName || '',
      access_type: site.accessType || '',
      coverage: site.coverage || '',
      status: site.status || '',
      cname_zone: site.cnameZone || '',
      name_servers: normalizeNameServers(site.nameServerList),
      plan_name: site.planName || '',
      plan_spec_name: site.planSpecName || '',
      instance_id: site.instanceId || '',
      resource_group_id: site.resourceGroupId || '',
      offline_reason: site.offlineReason || '',
      verify_code: site.verifyCode || '',
      version_management: !!site.versionManagement,
      create_time: site.createTime || '',
      update_time: site.updateTime || '',
      requestId: body.requestId || '',
    };
  }

  async listEsaRecords(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const request = {
      siteId: this.normalizeEsaSiteId(options.site_id),
      pageNumber: Math.max(1, Number(options.page) || 1),
      pageSize: Math.min(500, Math.max(1, Number(options.page_size) || 20)),
    };
    const keyword = String(options.keyword || '').trim();
    if (keyword) {
      request.recordName = keyword;
      request.recordMatchType = 'fuzzy';
    }
    if (options.type && options.type !== 'all') request.type = String(options.type);
    const body = getBody(await this.request(() => esa.listRecords(new Esa.ListRecordsRequest(request))));
    return {
      data: (body.records || []).map(item => ({
        record_id: String(item.recordId || ''),
        record_name: item.recordName || '',
        type: item.recordType || '',
        value: item.data && item.data.value || '',
        priority: Number(item.data && item.data.priority || 0),
        weight: Number(item.data && item.data.weight || 0),
        port: Number(item.data && item.data.port || 0),
        flag: Number(item.data && item.data.flag || 0),
        tag: item.data && item.data.tag || '',
        ttl: Number(item.ttl || 0),
        proxied: !!item.proxied,
        record_cname: item.recordCname || '',
        source_type: item.recordSourceType || '',
        host_policy: item.hostPolicy || '',
        http_ports: item.httpPorts || '',
        https_ports: item.httpsPorts || '',
        comment: item.comment || '',
        update_time: item.updateTime || item.createTime || '',
      })),
      total: Number(body.totalCount || 0),
      page: Number(body.pageNumber || request.pageNumber),
      page_size: Number(body.pageSize || request.pageSize),
      requestId: body.requestId || '',
    };
  }

  normalizeEsaRecordData(data, currentData = {}) {
    const type = String(data.type || '').trim().toUpperCase();
    const supportedTypes = ['A/AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'URI'];
    if (!supportedTypes.includes(type)) throw new AliyunServiceError('当前记录类型暂不支持在客户端编辑', 'UnsupportedRecordType');
    let value = String(data.value || '').replace(/\s+/g, '');
    if (['CNAME', 'NS', 'MX', 'SRV'].includes(type)) value = value.toLowerCase();
    if (!value) throw new AliyunServiceError('记录值不能为空', 'RecordValueRequired');
    const result = { ...currentData, value };
    const setInteger = (field, min, max, required = false) => {
      if (!required && (data[field] === '' || data[field] === undefined || data[field] === null)) return;
      const value = Number(data[field]);
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new AliyunServiceError(`${field} 必须是 ${min} 到 ${max} 之间的整数`, 'InvalidRecordData');
      }
      result[field] = value;
    };
    if (type === 'MX') setInteger('priority', 0, 65535, true);
    if (type === 'SRV' || type === 'URI') {
      setInteger('priority', 0, 65535, true);
      setInteger('weight', 0, 65535, true);
    }
    if (type === 'SRV') setInteger('port', 0, 65535, true);
    if (type === 'CAA') {
      setInteger('flag', 0, 255, true);
      const tag = String(data.tag || '').trim();
      if (!['issue', 'issuewild', 'iodef'].includes(tag)) throw new AliyunServiceError('CAA 标签不正确', 'InvalidRecordData');
      result.tag = tag;
    }
    return result;
  }

  normalizeEsaRecordOptions(data, currentRecord = {}) {
    const type = String(data.type || currentRecord.recordType || '').trim().toUpperCase();
    const currentType = String(currentRecord.recordType || '').trim().toUpperCase();
    const ttl = Number(data.ttl === undefined ? currentRecord.ttl : data.ttl);
    if (!Number.isInteger(ttl) || (ttl !== 1 && (ttl < 30 || ttl > 86400))) {
      throw new AliyunServiceError('TTL 必须为 1，或 30 到 86400 之间的整数', 'InvalidTtl');
    }
    const canProxy = ['A/AAAA', 'CNAME'].includes(type);
    const proxied = canProxy && data.proxied === true;
    return {
      type,
      data: this.normalizeEsaRecordData({ ...data, type }, type === currentType ? currentRecord.data || {} : {}),
      ttl,
      proxied,
      sourceType: type === 'CNAME' && (proxied || data.dns_only !== true) ? String(data.source_type || currentRecord.recordSourceType || 'Domain') : undefined,
      hostPolicy: type === 'CNAME' && (proxied || data.dns_only !== true) ? String(data.host_policy || currentRecord.hostPolicy || 'follow_hostname') : undefined,
      httpPorts: currentRecord.httpPorts,
      httpsPorts: currentRecord.httpsPorts,
      bizName: proxied ? String(data.biz_name || currentRecord.bizName || 'web') : undefined,
      comment: String(data.comment === undefined ? currentRecord.comment || '' : data.comment).trim().slice(0, 100),
      authConf: currentRecord.authConf,
    };
  }

  async getEsaRecord(account, recordId) {
    const { esa } = this.createClients(account);
    const id = Number(recordId);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AliyunServiceError('ESA 解析记录 ID 不正确', 'InvalidRecordId');
    const body = getBody(await this.request(() => esa.getRecord(new Esa.GetRecordRequest({ recordId: id }))));
    const record = body.recordModel || {};
    if (!record.recordId) throw new AliyunServiceError('ESA 解析记录不存在', 'RecordNotFound', body.requestId);
    return { esa, record, requestId: body.requestId || '' };
  }

  async addEsaRecord(accountId, data) {
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const siteId = this.normalizeEsaSiteId(data.site_id);
    const siteName = String(data.site_name || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
    let recordName = String(data.record_name || '').replace(/\s+/g, '').toLowerCase().replace(/\.$/, '');
    if (siteName && recordName === '@') recordName = siteName;
    else if (siteName && recordName !== siteName && !recordName.endsWith(`.${siteName}`)) recordName = `${recordName}.${siteName}`;
    if (!recordName) throw new AliyunServiceError('主机记录不能为空', 'RecordNameRequired');
    const request = this.normalizeEsaRecordOptions(data);
    delete request.authConf;
    const body = getBody(await this.request(() => esa.createRecord(new Esa.CreateRecordRequest({ siteId, recordName, ...request }))));
    this.clearAccountCache(accountId);
    return { record_id: String(body.recordId || ''), requestId: body.requestId || '' };
  }

  async updateEsaRecord(accountId, data) {
    const account = this.getAccount(accountId);
    const { esa, record } = await this.getEsaRecord(account, data.record_id);
    const request = this.normalizeEsaRecordOptions(data, record);
    const body = getBody(await this.request(() => esa.updateRecord(new Esa.UpdateRecordRequest({
      recordId: Number(record.recordId),
      ...request,
    }))));
    this.clearAccountCache(accountId);
    return { record_id: String(record.recordId), requestId: body.requestId || '' };
  }

  async deleteEsaRecord(accountId, recordId) {
    const account = this.getAccount(accountId);
    const { esa, record } = await this.getEsaRecord(account, recordId);
    const body = getBody(await this.request(() => esa.deleteRecord(new Esa.DeleteRecordRequest({ recordId: Number(record.recordId) }))));
    this.clearAccountCache(accountId);
    return { record_id: String(record.recordId), requestId: body.requestId || '' };
  }

  async setEsaRecordProxy(accountId, recordId, proxied) {
    const account = this.getAccount(accountId);
    const { esa, record } = await this.getEsaRecord(account, recordId);
    if (!['A/AAAA', 'CNAME'].includes(String(record.recordType || '').toUpperCase())) {
      throw new AliyunServiceError('只有 A/AAAA 和 CNAME 记录支持代理加速', 'ProxyUnsupported');
    }
    const request = this.normalizeEsaRecordOptions({
      type: record.recordType,
      value: record.data && record.data.value,
      ttl: record.ttl,
      proxied: proxied === true,
    }, record);
    const body = getBody(await this.request(() => esa.updateRecord(new Esa.UpdateRecordRequest({ recordId: Number(record.recordId), ...request }))));
    return { record_id: String(record.recordId), proxied: proxied === true, requestId: body.requestId || '' };
  }

  async listEsaOrigins(accountId, siteId) {
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const normalizedSiteId = this.normalizeEsaSiteId(siteId);
    const results = await Promise.allSettled([
      this.request(() => esa.listOriginPools(new Esa.ListOriginPoolsRequest({
        siteId: normalizedSiteId,
        pageNumber: 1,
        pageSize: 500,
      }))),
      this.request(() => esa.listOriginRules(new Esa.ListOriginRulesRequest({
        siteId: normalizedSiteId,
        pageNumber: 1,
        pageSize: 500,
      }))),
    ]);
    const poolBody = results[0].status === 'fulfilled' ? getBody(results[0].value) : {};
    const ruleBody = results[1].status === 'fulfilled' ? getBody(results[1].value) : {};
    const errors = [];
    if (results[0].status === 'rejected') {
      const error = normalizeError(results[0].reason);
      errors.push({ module: 'origin_pools', message: error.message, errorCode: error.code, requestId: error.requestId });
    }
    if (results[1].status === 'rejected') {
      const error = normalizeError(results[1].reason);
      errors.push({ module: 'origin_rules', message: error.message, errorCode: error.code, requestId: error.requestId });
    }
    return {
      pools: (poolBody.originPools || []).map(pool => ({
        pool_id: String(pool.id || ''),
        name: pool.name || '',
        enabled: !!pool.enabled,
        record_name: pool.recordName || '',
        origins: (pool.origins || []).map(origin => ({
          origin_id: String(origin.id || ''),
          name: origin.name || '',
          address: origin.address || '',
          type: origin.type || '',
          enabled: !!origin.enabled,
          weight: Number(origin.weight || 0),
          host_header: (() => {
            const header = origin.header && (origin.header.Host || origin.header.host);
            return Array.isArray(header) ? header.join(', ') : header || '';
          })(),
        })),
      })),
      rules: (ruleBody.configs || []).map(rule => ({
        config_id: String(rule.configId || ''),
        config_type: rule.configType || '',
        rule_name: rule.ruleName || '',
        rule_enable: rule.ruleEnable || '',
        rule: rule.rule || '',
        origin_scheme: rule.originScheme || '',
        origin_host: rule.originHost || '',
        origin_http_port: rule.originHttpPort || '',
        origin_https_port: rule.originHttpsPort || '',
        origin_sni: rule.originSni || '',
        origin_verify: rule.originVerify || '',
      })),
      errors,
      partial: errors.length > 0,
      requestId: poolBody.requestId || ruleBody.requestId || '',
    };
  }

  async listEsaCertificates(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const siteId = this.normalizeEsaSiteId(options.site_id);
    const keyword = String(options.keyword || '').trim();
    const recordBody = getBody(await this.request(() => esa.listRecords(new Esa.ListRecordsRequest({
      siteId,
      pageNumber: 1,
      pageSize: 500,
      ...(keyword ? { recordName: keyword, recordMatchType: 'fuzzy' } : {}),
    }))));
    const recordNames = Array.from(new Set((recordBody.records || [])
      .map(item => String(item.recordName || '').trim())
      .filter(Boolean)));
    const recordNameBatches = [];
    for (let index = 0; index < recordNames.length; index += 20) {
      recordNameBatches.push(recordNames.slice(index, index + 20));
    }
    const certificateResults = await Promise.allSettled(recordNameBatches.map(batch => this.request(() =>
      esa.listCertificatesByRecord(new Esa.ListCertificatesByRecordRequest({
        siteId,
        recordName: batch.join(','),
        detail: true,
        validOnly: false,
      }))
    )));
    const httpsResults = await Promise.allSettled([
      this.request(() => esa.listHttpsBasicConfigurations(new Esa.ListHttpsBasicConfigurationsRequest({
        siteId,
        pageNumber: 1,
        pageSize: 500,
      }))),
      this.request(() => esa.listHttpsApplicationConfigurations(new Esa.ListHttpsApplicationConfigurationsRequest({
        siteId,
        pageNumber: 1,
        pageSize: 500,
      }))),
    ]);
    const certificateMatches = new Map();
    certificateResults.forEach((batchResult, index) => {
      if (batchResult.status !== 'fulfilled') return;
      const body = getBody(batchResult.value);
      (body.result || []).forEach(item => {
        certificateMatches.set(String(item.recordName || '').trim().toLowerCase(), item);
      });
      // 单条批次响应可能省略 RecordName，保留兼容处理。
      if (recordNameBatches[index].length === 1 && (body.result || []).length === 1) {
        certificateMatches.set(recordNameBatches[index][0].toLowerCase(), body.result[0]);
      }
    });
    const records = recordNames.map(recordName => {
      const result = certificateMatches.get(recordName.toLowerCase()) || {};
      return {
        record_name: result.recordName || recordName,
        status: result.status || 'none',
        applying_count: Number(result.applylingCount || 0),
        certificates: (result.certificates || []).map(item => ({
          certificate_id: item.id || '',
          name: item.name || '',
          common_name: item.commonName || '',
          sans: item.SAN || '',
          type: item.type || '',
          status: item.status || '',
          issuer: item.issuerCN || item.issuer || '',
          not_before: item.notBefore || '',
          not_after: item.notAfter || '',
          public_key_algorithm: item.pubAlg || '',
          signature_algorithm: item.sigAlg || '',
          update_time: item.updateTime || item.createTime || '',
        })),
        error: '',
      };
    });
    const basicBody = httpsResults[0].status === 'fulfilled' ? getBody(httpsResults[0].value) : {};
    const applicationBody = httpsResults[1].status === 'fulfilled' ? getBody(httpsResults[1].value) : {};
    const errors = certificateResults
      .map((result, index) => result.status === 'rejected' ? { module: recordNameBatches[index].join(', '), ...normalizeError(result.reason) } : null)
      .filter(Boolean);
    if (httpsResults[0].status === 'rejected') errors.push({ module: 'https_basic', ...normalizeError(httpsResults[0].reason) });
    if (httpsResults[1].status === 'rejected') errors.push({ module: 'https_application', ...normalizeError(httpsResults[1].reason) });
    return {
      records,
      https_basic: (basicBody.configs || []).map(item => ({
        config_id: String(item.configId || ''),
        config_type: item.configType || '',
        rule_name: item.ruleName || '',
        https: item.https || '',
        http2: item.http2 || '',
        http3: item.http3 || '',
        tls10: item.tls10 || '',
        tls11: item.tls11 || '',
        tls12: item.tls12 || '',
        tls13: item.tls13 || '',
        ocsp_stapling: item.ocspStapling || '',
        ciphersuite_group: item.ciphersuiteGroup || '',
      })),
      https_application: (applicationBody.configs || []).map(item => ({
        config_id: String(item.configId || ''),
        config_type: item.configType || '',
        rule_name: item.ruleName || '',
        https_force: item.httpsForce || '',
        https_force_code: item.httpsForceCode || '',
        hsts: item.hsts || '',
        hsts_max_age: item.hstsMaxAge || '',
        hsts_include_subdomains: item.hstsIncludeSubdomains || '',
      })),
      total: records.length,
      partial: errors.length > 0,
      errors,
      requestId: recordBody.requestId || basicBody.requestId || applicationBody.requestId || '',
    };
  }

  async uploadEsaCertificate(accountId, data = {}) {
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const siteId = this.normalizeEsaSiteId(data.site_id);
    const name = String(data.name || '').trim().slice(0, 128);
    const certificate = String(data.certificate || '').trim();
    const privateKey = String(data.private_key || '').trim();
    if (!name) throw new AliyunServiceError('证书名称不能为空', 'CertificateNameRequired');
    if (!certificate.includes('-----BEGIN CERTIFICATE-----')) {
      throw new AliyunServiceError('证书内容不完整', 'InvalidCertificateContent');
    }
    if (!/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(privateKey)) {
      throw new AliyunServiceError('证书私钥不完整', 'InvalidCertificatePrivateKey');
    }
    const body = getBody(await this.request(() => esa.setCertificate(new Esa.SetCertificateRequest({
      siteId,
      name,
      type: 'upload',
      certificate,
      privateKey,
    }))));
    this.clearAccountCache(accountId);
    return { certificate_id: String(body.id || ''), requestId: body.requestId || '' };
  }

  async listCdnDomains(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const { cdn } = this.createClients(account);
    const keyword = String(options.keyword || '').trim();
    const request = {
      pageNumber: Math.max(1, Number(options.page) || 1),
      pageSize: Math.min(500, Math.max(1, Number(options.page_size) || 50)),
      checkDomainShow: true,
    };
    if (keyword) {
      request.domainName = keyword;
      request.domainSearchType = 'fuzzy_match';
    }
    if (options.status && options.status !== 'all') request.domainStatus = String(options.status);
    let body;
    try {
      body = getBody(await this.request(() => cdn.describeUserDomains(new Cdn.DescribeUserDomainsRequest(request))));
    } catch (error) {
      if (isCdnNotOpenedError(error)) {
        this.updateResourceCount(accountId, 'cdn_count', 0);
        return { data: [], total: 0, page: request.pageNumber, page_size: request.pageSize, status: 'not_opened', requestId: getRequestId(error) };
      }
      throw error;
    }
    const domains = (((body.domains || {}).pageData) || []).map(item => ({
        domain_id: String(item.domainId || ''),
        domain_name: item.domainName || '',
        cname: item.cname || '',
        cdn_type: item.cdnType || '',
        coverage: item.coverage || '',
        status: item.domainStatus || '',
        ssl_enabled: String(item.sslProtocol || '').toLowerCase() === 'on',
        description: item.description || '',
        sources: (((item.sources || {}).source) || []).map(source => ({
          type: source.type || '',
          content: source.content || '',
          port: Number(source.port || 0),
          priority: Number(source.priority || 20),
          weight: Number(source.weight || 10),
        })),
        create_time: item.gmtCreated || '',
        update_time: item.gmtModified || '',
      }));
    let cnameChecks = [];
    if (domains.length) {
      const domainBatches = [];
      const domainNames = domains.map(item => item.domain_name);
      for (let index = 0; index < domainNames.length; index += 30) {
        domainBatches.push(domainNames.slice(index, index + 30));
      }
      const cnameResults = await Promise.allSettled(domainBatches.map(names => this.request(() => cdn.describeDomainCname(new Cdn.DescribeDomainCnameRequest({
        domainName: names.join(','),
      })))));
      cnameChecks = cnameResults.flatMap(result => result.status === 'fulfilled'
        ? (((getBody(result.value).cnameDatas || {}).data) || [])
        : []);
    }
    const cnameCheckMap = new Map(cnameChecks.map(item => [String(item.domain || '').toLowerCase(), item]));
    domains.forEach(domain => {
      const check = cnameCheckMap.get(domain.domain_name.toLowerCase());
      const passed = String((check && check.passed) || '').toLowerCase();
      domain.access_status = passed === 'true' ? 'connected' : (passed === 'false' ? 'not_connected' : (passed === 'timeout' ? 'timeout' : 'unknown'));
      domain.access_error = check && check.errMsg || '';
    });
    const result = {
      data: domains,
      total: Number(body.totalCount || 0),
      page: Number(body.pageNumber || request.pageNumber),
      page_size: Number(body.pageSize || request.pageSize),
      status: 'active',
      requestId: body.requestId || '',
    };
    if (!keyword && (!options.status || options.status === 'all')) this.updateResourceCount(accountId, 'cdn_count', result.total);
    return result;
  }

  normalizeCdnDomainName(domainName) {
    const value = String(domainName || '').trim().toLowerCase();
    if (!value || value.length > 253 || !/^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)) {
      throw new AliyunServiceError('CDN 域名格式不正确', 'InvalidDomainName');
    }
    return value;
  }

  normalizeCdnDomainNames(domainNames) {
    const names = unique((Array.isArray(domainNames) ? domainNames : []).map(item => this.normalizeCdnDomainName(item)));
    if (!names.length) throw new AliyunServiceError('请先选择 CDN 域名', 'DomainRequired');
    if (names.length > 50) throw new AliyunServiceError('单次最多操作 50 个 CDN 域名', 'TooManyDomains');
    return names;
  }

  normalizeCdnSources(sources) {
    const rows = Array.isArray(sources) ? sources : [];
    if (!rows.length) throw new AliyunServiceError('至少需要一个源站', 'SourceRequired');
    if (rows.length > 20) throw new AliyunServiceError('单个域名最多配置 20 个源站', 'TooManySources');
    return rows.map(source => {
      const type = String(source.type || '').trim();
      const content = String(source.content || '').trim();
      const port = Number(source.port || 80);
      const priority = Number(source.priority === undefined ? 20 : source.priority);
      const weight = Number(source.weight === undefined ? 10 : source.weight);
      if (!['ipaddr', 'domain', 'oss'].includes(type)) throw new AliyunServiceError('源站类型不正确', 'InvalidSourceType');
      if (!content) throw new AliyunServiceError('源站地址不能为空', 'SourceRequired');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AliyunServiceError('源站端口必须为 1 到 65535', 'InvalidSourcePort');
      if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new AliyunServiceError('源站优先级必须为 0 到 100', 'InvalidSourcePriority');
      if (!Number.isInteger(weight) || weight < 0 || weight > 100) throw new AliyunServiceError('源站权重必须为 0 到 100', 'InvalidSourceWeight');
      return { type, content, port, priority: String(priority), weight: String(weight) };
    });
  }

  async updateCdnDomain(accountId, data) {
    const account = this.getAccount(accountId);
    const { cdn } = this.createClients(account);
    const domainName = this.normalizeCdnDomainName(data.domain_name);
    const sources = this.normalizeCdnSources(data.sources);
    const body = getBody(await this.request(() => cdn.modifyCdnDomain(new Cdn.ModifyCdnDomainRequest({
      domainName,
      sources: JSON.stringify(sources),
    }))));
    return { domain_name: domainName, requestId: body.requestId || '' };
  }

  async ensureCdnDomainDeletable(cdn, domainName) {
    const body = getBody(await this.request(() => cdn.describeCdnDomainDetail(new Cdn.DescribeCdnDomainDetailRequest({ domainName }))));
    const detail = body.getDomainDetailModel || {};
    if (String(detail.domainStatus || '').toLowerCase() !== 'offline') {
      throw new AliyunServiceError('运行中的 CDN 域名不能删除，请先停用后再删除', 'CdnDomainMustBeOffline', body.requestId);
    }
  }

  async deleteCdnDomain(accountId, domainName) {
    const account = this.getAccount(accountId);
    const { cdn } = this.createClients(account);
    const normalizedName = this.normalizeCdnDomainName(domainName);
    await this.ensureCdnDomainDeletable(cdn, normalizedName);
    const body = getBody(await this.request(() => cdn.deleteCdnDomain(new Cdn.DeleteCdnDomainRequest({ domainName: normalizedName }))));
    this.clearAccountCache(accountId);
    return { domain_name: normalizedName, requestId: body.requestId || '' };
  }

  async batchCdnDomainAction(accountId, domainNames, action) {
    const names = this.normalizeCdnDomainNames(domainNames);
    if (!['start', 'stop', 'delete'].includes(action)) throw new AliyunServiceError('不支持的 CDN 批量操作', 'InvalidBatchAction');
    const account = this.getAccount(accountId);
    const { cdn } = this.createClients(account);
    if (action !== 'delete') {
      const Request = action === 'start' ? Cdn.BatchStartCdnDomainRequest : Cdn.BatchStopCdnDomainRequest;
      const method = action === 'start' ? 'batchStartCdnDomain' : 'batchStopCdnDomain';
      const body = getBody(await this.request(() => cdn[method](new Request({ domainNames: names.join(',') }))));
      return { success_count: names.length, failure_count: 0, failures: [], requestId: body.requestId || '' };
    }
    const results = await mapLimit(names, MAX_REGION_CONCURRENCY, async domainName => {
      try {
        await this.ensureCdnDomainDeletable(cdn, domainName);
        await this.request(() => cdn.deleteCdnDomain(new Cdn.DeleteCdnDomainRequest({ domainName })));
        return { domain_name: domainName, success: true };
      } catch (error) {
        const normalized = normalizeError(error);
        return { domain_name: domainName, success: false, message: normalized.message, errorCode: normalized.code, requestId: normalized.requestId };
      }
    });
    this.clearAccountCache(accountId);
    return {
      success_count: results.filter(item => item.success).length,
      failure_count: results.filter(item => !item.success).length,
      failures: results.filter(item => !item.success),
    };
  }

  async listCdnOperationLogs(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const { actionTrail } = this.createClients(account);
    const domainName = String(options.domain_name || '').trim().toLowerCase();
    if (domainName) this.normalizeCdnDomainName(domainName);
    const lookupAttribute = [new ActionTrail.LookupEventsRequestLookupAttribute({ key: 'EventRW', value: 'Write' })];
    lookupAttribute.push(new ActionTrail.LookupEventsRequestLookupAttribute({
      key: domainName ? 'ResourceName' : 'ServiceName',
      value: domainName || 'Cdn',
    }));
    const request = {
      direction: 'BACKWARD',
      maxResults: String(Math.min(50, Math.max(1, Number(options.page_size) || 20))),
      lookupAttribute,
    };
    const nextToken = String(options.next_token || '').trim();
    if (nextToken) request.nextToken = nextToken;
    const body = getBody(await this.request(() => actionTrail.lookupEvents(new ActionTrail.LookupEventsRequest(request))));
    return {
      data: (body.events || []).filter(event => !domainName || String(event.serviceName || '').toLowerCase() === 'cdn').map(event => {
        let eventData = event;
        const rawEventJson = event.eventJson || event.EventJson;
        if (typeof rawEventJson === 'string') {
          try {
            const parsedEvent = JSON.parse(rawEventJson);
            if (parsedEvent && typeof parsedEvent === 'object' && !Array.isArray(parsedEvent)) {
              eventData = { ...event, ...parsedEvent };
            }
          } catch (_error) {}
        }
        const rawRequestParameters = eventData.requestParameters || eventData.RequestParameters;
        let requestParameters = rawRequestParameters && typeof rawRequestParameters === 'object' ? rawRequestParameters : {};
        if (typeof rawRequestParameters === 'string') {
          try { requestParameters = JSON.parse(rawRequestParameters); } catch (_error) { requestParameters = {}; }
        }
        const resources = Array.isArray(eventData.referencedResources)
          ? eventData.referencedResources
          : (Array.isArray(eventData.ReferencedResources) ? eventData.ReferencedResources : []);
        const resourceNames = unique([
          requestParameters.domainName,
          requestParameters.DomainName,
          ...(String(requestParameters.domainNames || requestParameters.DomainNames || '').split(',')),
          eventData.resourceName,
          eventData.ResourceName,
          ...resources.map(item => item && (item.resourceName || item.ResourceName || item.name || item.Name)),
        ].map(item => String(item || '').trim()));
        const identity = eventData.userIdentity && typeof eventData.userIdentity === 'object' ? eventData.userIdentity : {};
        return {
          event_id: eventData.eventId || '',
          event_name: eventData.eventName || '',
          event_time: eventData.eventTime || '',
          domains: resourceNames,
          operator: identity.userName || identity.principalId || identity.accountId || identity.type || '',
          access_key_id: identity.accessKeyId ? `${String(identity.accessKeyId).slice(0, 5)}****${String(identity.accessKeyId).slice(-4)}` : '',
          source_ip: eventData.sourceIpAddress || '',
          region_id: eventData.regionId || '',
          request_id: eventData.requestId || '',
          success: !eventData.errorCode,
          error_code: eventData.errorCode || '',
          error_message: eventData.errorMessage || '',
        };
      }),
      next_token: body.nextToken || '',
      requestId: body.requestId || '',
    };
  }

  async listRecords(accountId, options = {}) {
    const domainName = String(options.domain_name || '').trim();
    if (!domainName) throw new AliyunServiceError('请选择域名', 'DomainRequired');
    const account = this.getAccount(accountId);
    const { dns } = this.createClients(account);
    const request = {
      domainName,
      pageNumber: Math.max(1, Number(options.page) || 1),
      pageSize: Math.min(500, Math.max(1, Number(options.page_size) || 20)),
      lang: 'zh',
    };
    const keyword = String(options.keyword || '').trim();
    const type = options.type && options.type !== 'all' ? String(options.type) : '';
    if (type) {
      request.type = type;
      request.searchMode = 'ADVANCED';
      if (keyword) request.RRKeyWord = keyword;
    } else if (keyword) {
      request.keyWord = keyword;
    }
    const response = await this.request(() => dns.describeDomainRecords(new AliDns.DescribeDomainRecordsRequest(request)));
    const body = getBody(response);
    return {
      data: ((body.domainRecords || {}).record || []).map(item => ({
        record_id: item.recordId,
        domain_name: item.domainName,
        rr: item.RR,
        type: item.type,
        value: item.value,
        ttl: Number(item.TTL || 0),
        line: item.line || 'default',
        priority: Number(item.priority || 0),
        status: normalizeRecordStatus(item.status),
        locked: !!item.locked,
      })),
      total: Number(body.totalCount || 0),
      page: Number(body.pageNumber || options.page || 1),
      page_size: Number(body.pageSize || options.page_size || 20),
      requestId: body.requestId || '',
    };
  }

  async listRecordLines(accountId, domainName) {
    const account = this.getAccount(accountId);
    const { dns } = this.createClients(account);
    const response = await this.request(() => dns.describeSupportLines(new AliDns.DescribeSupportLinesRequest({
      domainName: String(domainName || ''),
      lang: 'zh',
    })));
    return ((getBody(response).recordLines || {}).recordLine || []).map(item => ({
      code: item.lineCode || item.lineName || 'default',
      name: item.lineDisplayName || item.lineName || item.lineCode || '默认',
    }));
  }

  async listRecordLogs(accountId, options = {}) {
    const domainName = String(options.domain_name || '').trim();
    if (!domainName) throw new AliyunServiceError('请选择域名', 'DomainRequired');
    const account = this.getAccount(accountId);
    const { dns } = this.createClients(account);
    const response = await this.request(() => dns.describeRecordLogs(new AliDns.DescribeRecordLogsRequest({
      domainName,
      pageNumber: Math.max(1, Number(options.page) || 1),
      pageSize: Math.min(100, Math.max(1, Number(options.page_size) || 20)),
      keyWord: String(options.keyword || ''),
      lang: 'zh',
    })));
    const body = getBody(response);
    return {
      data: ((body.recordLogs || {}).recordLog || []).map(item => ({
        action: item.action || '',
        action_time: item.actionTime || '',
        action_timestamp: Number(item.actionTimestamp || 0),
        client_ip: item.clientIp || '',
        message: item.message || '',
      })),
      total: Number(body.totalCount || 0),
      page: Number(body.pageNumber || options.page || 1),
      page_size: Number(body.pageSize || options.page_size || 20),
      requestId: body.requestId || '',
    };
  }

  validateRecord(data, requireId = false) {
    const result = {
      domainName: String(data.domain_name || '').trim(),
      recordId: String(data.record_id || '').trim(),
      RR: String(data.rr || '').replace(/\s+/g, ''),
      type: String(data.type || '').trim().toUpperCase(),
      value: String(data.value || '').replace(/\s+/g, ''),
      TTL: Number(data.ttl) || 600,
      line: String(data.line || 'default'),
      lang: 'zh',
    };
    if (!result.domainName || !result.RR || !result.type || !result.value) {
      throw new AliyunServiceError('域名、主机记录、记录类型和记录值不能为空', 'InvalidRecord');
    }
    if (requireId && !result.recordId) throw new AliyunServiceError('解析记录 ID 不能为空', 'RecordIdRequired');
    if (result.type === 'MX') {
      result.priority = Number(data.priority);
      if (!Number.isInteger(result.priority) || result.priority < 1 || result.priority > 50) {
        throw new AliyunServiceError('MX 优先级必须是 1 到 50 之间的整数', 'InvalidPriority');
      }
    }
    return result;
  }

  async addRecord(accountId, data) {
    const account = this.getAccount(accountId);
    const record = this.validateRecord(data);
    delete record.recordId;
    const body = getBody(await this.request(() => this.createClients(account).dns.addDomainRecord(new AliDns.AddDomainRecordRequest(record))));
    this.clearAccountCache(accountId);
    return { record_id: body.recordId, requestId: body.requestId || '' };
  }

  async updateRecord(accountId, data) {
    const account = this.getAccount(accountId);
    const record = this.validateRecord(data, true);
    delete record.domainName;
    const body = getBody(await this.request(() => this.createClients(account).dns.updateDomainRecord(new AliDns.UpdateDomainRecordRequest(record))));
    this.clearAccountCache(accountId);
    return { record_id: body.recordId, requestId: body.requestId || '' };
  }

  async deleteRecord(accountId, recordId) {
    const account = this.getAccount(accountId);
    const id = String(recordId || '').trim();
    if (!id) throw new AliyunServiceError('解析记录 ID 不能为空', 'RecordIdRequired');
    const body = getBody(await this.request(() => this.createClients(account).dns.deleteDomainRecord(new AliDns.DeleteDomainRecordRequest({ recordId: id, lang: 'zh' }))));
    this.clearAccountCache(accountId);
    return { record_id: body.recordId, requestId: body.requestId || '' };
  }

  async setRecordStatus(accountId, recordId, status) {
    const account = this.getAccount(accountId);
    const id = String(recordId || '').trim();
    if (!id) throw new AliyunServiceError('解析记录 ID 不能为空', 'RecordIdRequired');
    const normalizedStatus = normalizeRecordStatus(status);
    if (!['Enable', 'Disable'].includes(normalizedStatus)) throw new AliyunServiceError('解析状态不正确', 'InvalidStatus');
    const body = getBody(await this.request(() => this.createClients(account).dns.setDomainRecordStatus(new AliDns.SetDomainRecordStatusRequest({
      recordId: id,
      status: normalizedStatus,
      lang: 'zh',
    }))));
    this.clearAccountCache(accountId);
    return { record_id: body.recordId, status: normalizeRecordStatus(body.status || normalizedStatus), requestId: body.requestId || '' };
  }

  normalizeRecordIds(recordIds) {
    const ids = unique((Array.isArray(recordIds) ? recordIds : []).map(item => String(item || '').trim()));
    if (!ids.length) throw new AliyunServiceError('请先选择解析记录', 'RecordRequired');
    if (ids.length > 100) throw new AliyunServiceError('单次最多操作 100 条解析记录', 'TooManyRecords');
    return ids;
  }

  async batchRecordAction(accountId, recordIds, action) {
    const ids = this.normalizeRecordIds(recordIds);
    if (!['disable', 'delete'].includes(action)) throw new AliyunServiceError('不支持的批量操作', 'InvalidBatchAction');
    const results = await mapLimit(ids, MAX_REGION_CONCURRENCY, async recordId => {
      try {
        if (action === 'disable') await this.setRecordStatus(accountId, recordId, 'Disable');
        else await this.deleteRecord(accountId, recordId);
        return { record_id: recordId, success: true };
      } catch (error) {
        const normalized = normalizeError(error);
        return { record_id: recordId, success: false, message: normalized.message, errorCode: normalized.code, requestId: normalized.requestId };
      }
    });
    return {
      success_count: results.filter(item => item.success).length,
      failure_count: results.filter(item => !item.success).length,
      failures: results.filter(item => !item.success),
    };
  }

  async batchEsaRecordAction(accountId, recordIds, action) {
    const ids = this.normalizeRecordIds(recordIds);
    if (!['disable_proxy', 'delete'].includes(action)) throw new AliyunServiceError('不支持的批量操作', 'InvalidBatchAction');
    const results = await mapLimit(ids, MAX_REGION_CONCURRENCY, async recordId => {
      try {
        if (action === 'delete') await this.deleteEsaRecord(accountId, recordId);
        else await this.setEsaRecordProxy(accountId, recordId, false);
        return { record_id: recordId, success: true };
      } catch (error) {
        const normalized = normalizeError(error);
        return { record_id: recordId, success: false, message: normalized.message, errorCode: normalized.code, requestId: normalized.requestId };
      }
    });
    return {
      success_count: results.filter(item => item.success).length,
      failure_count: results.filter(item => !item.success).length,
      failures: results.filter(item => !item.success),
    };
  }

  async prepareEcsTerminal(accountId, instanceId, regionId, title) {
    const account = this.getAccount(accountId);
    if (!instanceId || !regionId) throw new AliyunServiceError('实例 ID 和地域不能为空', 'InvalidInstance');
    return {
      transport: 'aliyun-session',
      account_id: account.account_id,
      instance_id: String(instanceId),
      region_id: String(regionId),
      title: String(title || instanceId),
      host: String(instanceId),
      os_type: 'Linux',
      source: 'aliyun-ecs',
    };
  }

  async preflightEcsTerminal(accountId, instanceId, regionId) {
    const account = this.getAccount(accountId);
    const { ecs } = this.createClients(account, regionId);
    const instanceBody = getBody(await this.request(() => ecs.describeInstances(new Ecs.DescribeInstancesRequest({
      regionId,
      instanceIds: JSON.stringify([instanceId]),
      pageNumber: 1,
      pageSize: 10,
    }))));
    const instance = ((instanceBody.instances || {}).instance || [])[0];
    if (!instance) throw new AliyunServiceError('指定 ECS 实例不存在或当前 AccessKey 无权访问', 'InstanceNotFound', instanceBody.requestId);
    if (instance.status !== 'Running') throw new AliyunServiceError('ECS 实例未处于运行状态，无法打开会话终端', 'InstanceNotRunning', instanceBody.requestId);

    const assistantBody = getBody(await this.request(() => ecs.describeCloudAssistantStatus(new Ecs.DescribeCloudAssistantStatusRequest({
      regionId,
      instanceId: [instanceId],
    }))));
    const assistant = ((assistantBody.instanceCloudAssistantStatusSet || {}).instanceCloudAssistantStatus || [])[0];
    const assistantStatus = String(assistant && assistant.cloudAssistantStatus || '').toLowerCase();
    if (!assistant || !['true', 'online'].includes(assistantStatus)) {
      throw new AliyunServiceError('云助手 Agent 未安装或不在线，请先在阿里云控制台处理', 'CloudAssistantOffline', assistantBody.requestId);
    }
    if (assistant.supportSessionManager === false) {
      throw new AliyunServiceError('当前云助手 Agent 版本不支持会话管理，请先升级 Agent', 'SessionManagerUnsupported', assistantBody.requestId);
    }

    const settingsBody = getBody(await this.request(() => ecs.describeCloudAssistantSettings(new Ecs.DescribeCloudAssistantSettingsRequest({
      regionId,
      settingType: ['SessionManagerConfig'],
    }))));
    if (!settingsBody.sessionManagerConfig || settingsBody.sessionManagerConfig.sessionManagerEnabled !== true) {
      throw new AliyunServiceError('阿里云会话管理尚未开启，请前往 ECS 云助手设置中开启', 'SessionManagerDisabled', settingsBody.requestId);
    }
    return { instance, assistant };
  }

  async openSwasWorkbench(accountId, instanceId, regionId) {
    const account = this.getAccount(accountId);
    const { shell } = require('electron');
    const regions = await this.getRegions(account, 'swas');
    const region = regions.find(item => item.region_id === String(regionId));
    const swas = this.createSwasClient(account, regionId, region && region.endpoint);
    const body = getBody(await this.request(() => swas.loginInstance(new Swas.LoginInstanceRequest({
      instanceId: String(instanceId || ''),
      regionId: String(regionId || ''),
    }))));
    let url;
    try {
      url = new URL(body.redirectUrl);
    } catch (_error) {
      throw new AliyunServiceError('阿里云返回的 Workbench 地址无效', 'InvalidWorkbenchUrl', body.requestId);
    }
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || (host !== 'ecs-workbench.aliyun.com' && !host.endsWith('.ecs-workbench.aliyun.com'))) {
      throw new AliyunServiceError('已阻止打开非阿里云官方的 Workbench 地址', 'UnsafeWorkbenchUrl', body.requestId);
    }
    await shell.openExternal(url.toString());
    return { opened: true, requestId: body.requestId || '' };
  }

  clearAccountCache(accountId) {
    listCache.delete(`servers:${accountId}`);
    listCache.delete(`registered-domains:${accountId}`);
    for (const key of regionCache.keys()) {
      if (key.startsWith(`${accountId}:`)) regionCache.delete(key);
    }
  }
}

module.exports = {
  aliyunService: new AliyunService(),
  AliyunServiceError,
  normalizeError,
  SUMMARY_TTL,
};
