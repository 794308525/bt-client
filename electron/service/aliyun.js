'use strict';

const Ecs = require('@alicloud/ecs20140526');
const AliDns = require('@alicloud/alidns20150109');
const Bss = require('@alicloud/bssopenapi20171214');
const Cdn = require('@alicloud/cdn20180510');
const Cms = require('@alicloud/cms20190101');
const Domain = require('@alicloud/domain20180129');
const ActionTrail = require('@alicloud/actiontrail20200706');
const Swas = require('@alicloud/swas-open20200601');
const Esa = require('@alicloud/esa20240910');
const OSS = require('ali-oss');
const Log = require('ee-core/log');
const https = require('https');
const zlib = require('zlib');
const { pub } = require('../class/public.js');

const SUMMARY_TTL = 5 * 60;
const OSS_TRAFFIC_TTL = 5 * 60;
const TRAFFIC_ANALYTICS_TTL = 5 * 60;
const ESA_URL_RANKING_LIVE_TTL = 10 * 60;
const ESA_URL_RANKING_HISTORY_TTL = 30 * 60;
const ESA_URL_CACHE_RETENTION = 7 * 24 * 60 * 60;
const ESA_URL_CACHE_DEFAULT_MB = 100;
const ESA_URL_CACHE_MIN_MB = 20;
const ESA_URL_CACHE_MAX_MB = 2048;
const ESA_LOG_DOWNLOAD_CONCURRENCY = 2;
const ESA_LOG_MAX_FILES = 500;
const ESA_LOG_MAX_COMPRESSED_BYTES = 64 * 1024 * 1024;
const ESA_LOG_MAX_FILE_BYTES = 8 * 1024 * 1024;
const ESA_LOG_MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const ESA_ANALYTICS_MIN_INTERVAL = 1200;
const ESA_ANALYTICS_RETRY_COUNT = 1;
const REGION_TTL = 24 * 60 * 60;
const SUMMARY_CONCURRENCY = 2;
const MAX_ACCOUNT_REQUEST_CONCURRENCY = 4;
const MAX_REGION_CONCURRENCY = 3;
const READ_RETRY_COUNT = 2;
const SWAS_BOOTSTRAP_REGION = 'cn-hangzhou';

const listCache = new Map();
const regionCache = new Map();
const resourceRegionCache = new Map();
const summaryRequests = new Map();
const esaUrlRankingRequests = new Map();
const esaTrafficRequests = new Map();
const runSummaryTask = createLimiter(SUMMARY_CONCURRENCY);
const runEsaLogDownload = createLimiter(ESA_LOG_DOWNLOAD_CONCURRENCY);
const runEsaAnalyticsTask = createLimiter(1);
let esaAnalyticsNextRequestAt = 0;

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
  'QuotaCheckFailed.Function': '当前 ESA 套餐不支持该监控查询（例如 30 天历史数据），请缩短查询范围；如需更长时间的数据分析，请升级套餐或联系阿里云客户经理',
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

const OSS_ERROR_MESSAGES = {
  AccessDenied: '当前 AccessKey 无权访问 OSS，请检查 RAM 权限',
  UserDisable: '当前阿里云账号的 OSS 服务已被停用，请检查账号欠费和 OSS 服务状态；如仍无法恢复，请携带 RequestId 联系阿里云技术支持',
  NoSuchBucket: '指定的 OSS Bucket 不存在或已被删除',
  NoSuchKey: '指定的 OSS 对象不存在或已被删除',
  BucketAlreadyExists: 'Bucket 名称已被占用，请更换名称',
  BucketAlreadyOwnedByYou: '当前账号已经拥有该 Bucket',
  BucketNotEmpty: 'Bucket 不为空，请先删除其中的对象后再删除 Bucket',
  InvalidBucketName: 'Bucket 名称不正确，请使用 3–63 位小写字母、数字或中划线',
  TooManyBuckets: 'OSS Bucket 数量已达到账号上限',
};

const COMMON_ERROR_MESSAGES = {
  InvalidAccessKeyId: 'AccessKey ID 无效，请检查后重试',
  'InvalidAccessKeyId.NotFound': 'AccessKey ID 不存在或已被删除',
  InvalidAccessKeySecret: 'AccessKey Secret 不正确，请检查后重试',
  SignatureDoesNotMatch: 'AccessKey Secret 不正确，或请求签名校验失败',
  MissingAccessKeyId: '请先配置 AccessKey ID',
  AccessDenied: '当前 AccessKey 没有访问该功能的 RAM 权限',
  AccessForbidden: '当前 AccessKey 没有访问该功能的 RAM 权限',
  Forbidden: '当前 AccessKey 没有访问该功能的 RAM 权限',
  NoPermission: '当前 AccessKey 没有访问该功能的 RAM 权限',
  PermissionDenied: '当前 AccessKey 没有访问该功能的 RAM 权限',
  Unauthorized: '当前 AccessKey 未通过授权校验',
  ServiceNotOpen: '当前账号尚未开通该服务',
  ServiceNotOpened: '当前账号尚未开通该服务',
  ServiceNotActivated: '当前账号尚未开通该服务',
  ProductNotActivated: '当前账号尚未开通该产品',
  UserDisable: '当前账号的该服务已被停用，请检查欠费和服务状态',
  AccountDisabled: '当前阿里云账号已被停用，请检查账号状态',
  Overdue: '当前阿里云账号可能已欠费，请先检查账户余额',
  Arrearage: '当前阿里云账号可能已欠费，请先检查账户余额',
  QuotaExceeded: '当前资源或操作数量已达到账号配额',
  QuotaExceed: '当前资源或操作数量已达到账号配额',
  Throttling: '阿里云接口请求过于频繁，请稍后重试',
  'Throttling.User': '当前账号的接口请求过于频繁，请稍后重试',
  RequestLimitExceeded: '阿里云接口请求过于频繁，请稍后重试',
  TooManyRequests: '阿里云接口请求过于频繁，请稍后重试',
  RequestTimeout: '连接阿里云接口超时，请稍后重试',
  ServiceUnavailable: '阿里云服务暂时不可用，请稍后重试',
  InternalError: '阿里云服务内部异常，请稍后重试',
  InternalException: '阿里云服务内部异常，请稍后重试',
};

// 各产品常见业务错误。保留阿里云错误码和原始详情，便于定位未覆盖的新错误。
const SERVICE_ERROR_MESSAGES = {
  balance: {
    InsufficientBalance: '阿里云账号余额不足，无法完成本次查询，请检查账户欠费状态',
    Forbidden: '当前 AccessKey 无权查询账号余额，请授予 BSS 余额查询权限',
    'Forbidden.Action': '当前 AccessKey 无权查询账号余额，请授予 BSS 余额查询权限',
  },
  server: {
    'InvalidInstanceId.NotFound': '指定服务器实例不存在，或当前地域/账号无权访问',
    'InvalidRegionId.NotFound': '服务器地域不存在或当前账号暂不支持该地域',
    'Forbidden.Instance': '当前 AccessKey 无权查询服务器实例，请检查 ECS/轻量服务器权限',
    'Forbidden.Action': '当前 AccessKey 无权查询服务器列表，请检查 ECS/轻量服务器权限',
    ForbiddenOperation: '当前 AccessKey 无权执行该服务器操作，请检查 RAM 权限',
    IncorrectInstanceStatus: '服务器当前状态不支持此操作，请稍后刷新状态',
    InsufficientBalance: '阿里云账号余额不足，服务器相关功能可能受限',
  },
  domain: {
    InvalidDomainName: '域名格式不正确，请检查域名后重试',
    'InvalidDomainName.NotFound': '指定域名不存在，或当前账号无权访问',
    DomainNotFound: '指定域名不存在，或当前账号无权访问',
    'Forbidden.Action': '当前 AccessKey 无权查询域名，请检查阿里云域名或 DNS 权限',
    QuotaExceeded: '域名查询或操作已达到账号配额，请稍后重试或联系阿里云支持',
    DomainNotBelongToUser: '该域名不属于当前账号，无法管理其解析',
    DomainRecordNotBelongToUser: '该解析记录不属于当前账号，请刷新列表后重试',
    DomainRecordDuplicate: '已存在相同的解析记录，无需重复添加',
    DomainRecordLocked: '该解析记录已被锁定，暂时无法修改或删除',
    InvalidRR: '主机记录格式不正确，请检查后重试',
    InvalidValue: '解析记录值格式不正确，请检查后重试',
    InvalidTTL: 'TTL 超出当前 DNS 套餐允许的范围',
    RecordForbidden: '该解析记录当前不允许操作，请检查域名状态',
    DomainForbidden: '该域名已被暂停解析，请先在阿里云控制台处理',
  },
  esa: {
    'InvalidSite.NotFound': '指定 ESA 站点不存在，或当前账号无权访问',
    SiteNotFound: '指定 ESA 站点不存在，或当前账号无权访问',
    'Forbidden.Action': '当前 AccessKey 无权访问 ESA，请授予对应的 ESA 权限',
    ServiceNotFound: '当前账号尚未开通 ESA 服务',
    UserDisable: '当前阿里云账号的 ESA 服务已被停用，请检查账号欠费和服务状态',
  },
  cdn: {
    CdnServiceNotFound: '当前账号尚未开通 CDN 服务',
    'InvalidDomain.NotFound': '指定 CDN 域名不存在，或不属于当前账号',
    InvalidDomain: 'CDN 域名格式不正确，请检查域名后重试',
    DomainNotFound: '指定 CDN 域名不存在，或不属于当前账号',
    DomainStatusInvalid: 'CDN 域名当前状态不支持此操作，请刷新后重试',
    QuotaExceeded: 'CDN 资源数量已达到账号配额，请升级套餐或删除无用资源',
    InsufficientBalance: '阿里云账号余额不足，CDN 当前操作无法完成，请先处理欠费',
    'Forbidden.Action': '当前 AccessKey 无权操作 CDN，请检查 RAM 权限',
    UserDisable: '当前阿里云账号的 CDN 服务已被停用，请检查账号欠费和 CDN 服务状态',
    'InvalidDomain.AlreadyExist': '该域名已接入 CDN，无需重复添加',
    'InvalidDomain.Offline': '该 CDN 域名已停用，请先启用后再操作',
    DomainOverLimit: 'CDN 域名数量已达到账号上限',
    InvalidSources: 'CDN 源站配置不正确，请检查源站地址和端口',
  },
  oss: OSS_ERROR_MESSAGES,
};

const DEFAULT_RESOURCE_STATUS = {
  balance: 'unknown',
  server: 'unknown',
  domain: 'unknown',
  esa: 'unknown',
  cdn: 'unknown',
  oss: 'unknown',
};

const SERVICE_NAMES = {
  balance: '账号余额',
  server: '服务器',
  domain: '域名解析',
  esa: 'ESA',
  cdn: 'CDN',
  oss: 'OSS',
};

function parseResourceStatus(value) {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return { ...DEFAULT_RESOURCE_STATUS, ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch (_error) {
    return { ...DEFAULT_RESOURCE_STATUS };
  }
}

class AliyunServiceError extends Error {
  constructor(message, code = 'AliyunError', requestId = '', detail = '') {
    super(message);
    this.name = 'AliyunServiceError';
    this.code = code;
    this.requestId = requestId;
    this.detail = detail;
    this.status = getResourceStatus(code, message);
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

function getResourceStatus(code, sourceMessage = '') {
  const lower = `${code || ''} ${sourceMessage || ''}`.toLowerCase();
  if (/invalidaccesskey|invalid.*secret|signaturedoesnotmatch|signature.*invalid/.test(lower)) return 'invalid_credentials';
  if (/not.?opened|not.?open|not.?activated|service.*not.?found|servicenotfound|productnotfound|does not open|not enabled/.test(lower)) return 'not_opened';
  if (/userdisable|user.?disabled|account.?disabled|service.?disable|product.?disable|disabled/.test(lower)) return 'disabled';
  if (/overdue|arrearage|insufficientbalance|insufficient.?balance|balance.*insufficient|欠费/.test(lower)) return 'overdue';
  if (/accessdenied|accessforbidden|forbidden|unauthorized|nopermission|no permission|permissiondenied|无权|权限/.test(lower)) return 'permission_denied';
  if (/throttl|flow control|rate.?limit|requestlimitexceeded|too.?many.?requests/.test(lower)) return 'rate_limited';
  if (/quotaexceed|quota.*exceed|overlimit|too.?many|配额|上限/.test(lower)) return 'quota_exceeded';
  if (/timeout|timed out/.test(lower)) return 'timeout';
  if (/network|enotfound|econn|eai_again/.test(lower)) return 'network';
  if (/serviceunavailable|internalerror|internalexception|serviceinvokefailed|service.?busy/.test(lower)) return 'unavailable';
  return 'error';
}

function getServiceErrorMessage(service, code, fallback) {
  const serviceMessages = SERVICE_ERROR_MESSAGES[service] || {};
  if (serviceMessages[code]) return serviceMessages[code];
  if (COMMON_ERROR_MESSAGES[code]) {
    return getStatusErrorMessage(service, getResourceStatus(code, COMMON_ERROR_MESSAGES[code])) || COMMON_ERROR_MESSAGES[code];
  }
  const baseCode = String(code || '').split('.')[0];
  if (serviceMessages[baseCode]) return serviceMessages[baseCode];
  if (COMMON_ERROR_MESSAGES[baseCode]) {
    return getStatusErrorMessage(service, getResourceStatus(code, COMMON_ERROR_MESSAGES[baseCode])) || COMMON_ERROR_MESSAGES[baseCode];
  }
  return fallback;
}

function getStatusErrorMessage(service, status) {
  const name = SERVICE_NAMES[service] || '当前功能';
  if (status === 'not_opened') return `当前账号尚未开通${name}服务`;
  if (status === 'disabled') return `当前账号的${name}服务已被停用，请检查账号欠费和服务状态`;
  if (status === 'overdue') return `当前账号可能已欠费，${name}服务暂不可用，请先检查账户余额和服务状态`;
  if (status === 'permission_denied') return `当前 AccessKey 无权访问${name}，请检查 RAM 权限`;
  if (status === 'invalid_credentials') return `AccessKey 或 AccessKey Secret 不正确，无法访问${name}`;
  if (status === 'quota_exceeded') return `${name}资源或操作数量已达到账号配额`;
  if (status === 'rate_limited') return `${name}接口请求过于频繁，请稍后重试`;
  if (status === 'timeout') return `连接${name}接口超时，请检查网络后重试`;
  if (status === 'network') return `无法连接${name}接口，请检查网络后重试`;
  if (status === 'unavailable') return `${name}服务暂时不可用，请稍后重试`;
  return '';
}

function normalizeError(error, service = '') {
  if (error instanceof AliyunServiceError) {
    const effectiveService = service || error.service || '';
    const serviceMessage = getServiceErrorMessage(effectiveService, error.code, '');
    if (serviceMessage) error.message = serviceMessage;
    error.service = effectiveService;
    error.status = getResourceStatus(error.code, error.message);
    if (!serviceMessage) error.message = getStatusErrorMessage(effectiveService, error.status) || error.message;
    return error;
  }
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
  const exactMessage = service === 'esa'
    ? (ESA_RECORD_ERROR_MESSAGES[code] || getServiceErrorMessage(service, code, ''))
    : service
      ? getServiceErrorMessage(service, code, '')
      : (ESA_RECORD_ERROR_MESSAGES[code] || OSS_ERROR_MESSAGES[code] || '');
  let message = exactMessage || sourceMessage;

  if (exactMessage) {
    // 精确错误码翻译优先于后面的通用网络、权限等判断。
  } else if (lower.includes('invalidaccesskey') || lower.includes('signaturedoesnotmatch')) {
    message = 'AccessKey 无效或 AccessKey Secret 不正确';
  } else if (lower.includes('forbidden') || lower.includes('unauthorized') || lower.includes('no permission') || lower.includes('nopermission') || lower.includes('accessdenied')) {
    message = '当前 AccessKey 没有此功能所需的 RAM 权限';
  } else if (lower.includes('throttl') || lower.includes('flow control')) {
    message = '阿里云接口请求过于频繁，请稍后重试';
  } else if (lower.includes('timeout') || lower.includes('timed out')) {
    message = '连接阿里云接口超时，请检查网络后重试';
  } else if (lower.includes('network') || lower.includes('enotfound') || lower.includes('econn')) {
    message = '无法连接阿里云接口，请检查网络后重试';
  }

  const normalized = new AliyunServiceError(message, code, requestId, detail);
  normalized.service = service;
  normalized.status = getResourceStatus(code, sourceMessage);
  if (!exactMessage) normalized.message = getStatusErrorMessage(service, normalized.status) || normalized.message;
  return normalized;
}

function createLimiter(limit) {
  const queue = [];
  let active = 0;
  const runNext = () => {
    while (active < limit && queue.length) {
      const task = queue.shift();
      active += 1;
      Promise.resolve()
        .then(task.handler)
        .then(task.resolve, task.reject)
        .finally(() => {
          active -= 1;
          runNext();
        });
    }
  };
  return handler => new Promise((resolve, reject) => {
    queue.push({ handler, resolve, reject });
    runNext();
  });
}

function isRetryableError(error) {
  return ['rate_limited', 'timeout', 'network', 'unavailable'].includes(error && error.status);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function paceEsaAnalyticsRequest(handler) {
  return runEsaAnalyticsTask(async () => {
    const delay = esaAnalyticsNextRequestAt - Date.now();
    if (delay > 0) await wait(delay);
    try {
      return await handler();
    } finally {
      esaAnalyticsNextRequestAt = Date.now() + ESA_ANALYTICS_MIN_INTERVAL;
    }
  });
}

function downloadHttpsBuffer(url, maxBytes = ESA_LOG_MAX_FILE_BYTES, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 3) return reject(new AliyunServiceError('访问 ESA 日志下载地址失败', 'EsaLogTooManyRedirects'));
    let target;
    try {
      target = new URL(/^https:\/\//i.test(String(url || '')) ? String(url) : `https://${url}`);
    } catch (_error) {
      return reject(new AliyunServiceError('ESA 日志下载地址不正确', 'InvalidEsaLogUrl'));
    }
    if (target.protocol !== 'https:' || !target.hostname.toLowerCase().endsWith('.aliyuncs.com')) {
      return reject(new AliyunServiceError('已阻止访问非阿里云官方的 ESA 日志地址', 'UnsafeEsaLogUrl'));
    }
    const request = https.get(target, { timeout: 20000 }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        let redirectUrl;
        try {
          redirectUrl = new URL(response.headers.location, target).toString();
        } catch (_error) {
          return reject(new AliyunServiceError('ESA 日志跳转地址不正确', 'InvalidEsaLogRedirect'));
        }
        downloadHttpsBuffer(redirectUrl, maxBytes, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new AliyunServiceError(`ESA 日志下载失败（HTTP ${response.statusCode || 0}）`, 'EsaLogDownloadFailed'));
        return;
      }
      const declaredLength = Number(response.headers['content-length'] || 0);
      if (declaredLength > maxBytes) {
        response.resume();
        reject(new AliyunServiceError('ESA 日志文件超过单文件处理上限', 'EsaLogFileTooLarge'));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy(new AliyunServiceError('ESA 日志文件超过单文件处理上限', 'EsaLogFileTooLarge'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new AliyunServiceError('下载 ESA 日志超时，请稍后重试', 'EsaLogDownloadTimeout')));
    request.on('error', reject);
  });
}

function forEachEsaLogRow(buffer, handler) {
  let content;
  try {
    content = zlib.gunzipSync(buffer, { maxOutputLength: ESA_LOG_MAX_UNCOMPRESSED_BYTES }).toString('utf8');
  } catch (_error) {
    if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
      throw new AliyunServiceError('ESA 日志解压失败或超过处理上限', 'EsaLogDecompressFailed');
    }
    if (buffer.length > ESA_LOG_MAX_UNCOMPRESSED_BYTES) {
      throw new AliyunServiceError('ESA 日志文件超过处理上限', 'EsaLogContentTooLarge');
    }
    content = buffer.toString('utf8');
  }
  String(content || '').split(/\r?\n/).forEach(line => {
    if (!line) return;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') handler(row);
    } catch (_error) {
      // 单行损坏不影响同一日志文件的其他记录。
    }
  });
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function isoTime(value) {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function normalizeAnalyticsRange(options = {}) {
  const ranges = { today: 1, yesterday: 1, '24h': 1, '7d': 7, '30d': 30 };
  const range = Object.prototype.hasOwnProperty.call(ranges, options.range) ? options.range : 'today';
  const now = Date.now();
  const chinaOffset = 8 * 60 * 60 * 1000;
  const todayStart = Math.floor((now + chinaOffset) / 86400000) * 86400000 - chinaOffset;
  let start = now - 86400000;
  let end = now;
  if (range === 'today') start = todayStart;
  if (range === 'yesterday') {
    start = todayStart - 86400000;
    end = todayStart;
  }
  if (range === '7d') start = now - 7 * 86400000;
  if (range === '30d') start = now - 30 * 86400000;
  if (options.start_time && options.end_time) {
    const customStart = new Date(options.start_time).getTime();
    const customEnd = new Date(options.end_time).getTime();
    if (!Number.isFinite(customStart) || !Number.isFinite(customEnd) || customEnd <= customStart) {
      throw new AliyunServiceError('查询时间范围不正确', 'InvalidAnalyticsRange');
    }
    if (customEnd - customStart > 31 * 86400000) {
      throw new AliyunServiceError('单次最多查询 31 天数据', 'AnalyticsRangeTooLarge');
    }
    start = customStart;
    end = customEnd;
  }
  const span = end - start;
  const interval = span <= 3 * 86400000 ? 300 : span <= 14 * 86400000 ? 3600 : 86400;
  return { range, start, end, startTime: isoTime(start), endTime: isoTime(end), interval: String(interval) };
}

function analyticsCacheRangeKey(range, options = {}) {
  return options.start_time && options.end_time
    ? `${range.startTime}:${range.endTime}`
    : range.range;
}

function mergeAnalyticsSeries(seriesMap) {
  const timestamps = unique(Object.values(seriesMap).flatMap(points => (points || []).map(point => point.timestamp))).sort();
  const indexes = Object.fromEntries(Object.entries(seriesMap).map(([key, points]) => [key, new Map((points || []).map(point => [point.timestamp, point.value]))]));
  return timestamps.map(timestamp => ({
    timestamp,
    ...Object.fromEntries(Object.keys(seriesMap).map(key => [key, finiteNumber(indexes[key].get(timestamp))])),
  }));
}

function summarizeHttpCodes(rows) {
  let total = 0;
  let errors4xx = 0;
  let errors5xx = 0;
  (rows || []).forEach(row => {
    const codes = row && row.value && row.value.codeProportionData || [];
    codes.forEach(item => {
      const count = finiteNumber(item.count);
      total += count;
      if (String(item.code || '').startsWith('4')) errors4xx += count;
      if (String(item.code || '').startsWith('5')) errors5xx += count;
    });
  });
  return {
    total,
    error_4xx_rate: total ? errors4xx / total * 100 : 0,
    error_5xx_rate: total ? errors5xx / total * 100 : 0,
  };
}

function buildAnalyticsAlerts(summary) {
  const alerts = [];
  if (summary.error_5xx_rate >= 2) alerts.push({ level: 'danger', message: `5xx 错误率 ${summary.error_5xx_rate.toFixed(2)}%，建议优先检查源站和回源配置` });
  else if (summary.error_5xx_rate >= 0.5) alerts.push({ level: 'warning', message: `5xx 错误率 ${summary.error_5xx_rate.toFixed(2)}%，建议关注源站稳定性` });
  if (summary.error_4xx_rate >= 10) alerts.push({ level: 'warning', message: `4xx 错误率 ${summary.error_4xx_rate.toFixed(2)}%，建议检查热门 URL 和防护规则` });
  if (summary.cache_hit_rate !== null && summary.cache_hit_rate < 70) alerts.push({ level: 'warning', message: `缓存命中率仅 ${summary.cache_hit_rate.toFixed(2)}%，回源压力可能偏高` });
  if (summary.origin_ratio !== null && summary.origin_ratio > 50) alerts.push({ level: 'warning', message: `回源流量占比 ${summary.origin_ratio.toFixed(2)}%，建议检查缓存策略` });
  return alerts;
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
  getEsaUrlCacheLimitMb() {
    const configured = Number(pub.config_get('aliyun_cache_max_mb'));
    if (!Number.isFinite(configured)) return ESA_URL_CACHE_DEFAULT_MB;
    return Math.min(ESA_URL_CACHE_MAX_MB, Math.max(ESA_URL_CACHE_MIN_MB, Math.round(configured)));
  }

  esaUrlRankingTtl(range) {
    return ['today', '24h'].includes(range.range) ? ESA_URL_RANKING_LIVE_TTL : ESA_URL_RANKING_HISTORY_TTL;
  }

  cleanupEsaUrlRankingCache(now = Math.floor(Date.now() / 1000)) {
    const maxBytes = this.getEsaUrlCacheLimitMb() * 1024 * 1024;
    const memoryRows = [];
    for (const [key, value] of listCache.entries()) {
      if (!key.startsWith('esa-url-rankings:')) continue;
      if (now - Number(value.time || 0) >= ESA_URL_CACHE_RETENTION) {
        listCache.delete(key);
        continue;
      }
      memoryRows.push({ key, time: Number(value.time) || 0, size: Buffer.byteLength(JSON.stringify(value.data || {}), 'utf8') });
    }
    memoryRows.sort((a, b) => b.time - a.time);
    let memoryBytes = 0;
    memoryRows.forEach(row => {
      memoryBytes += row.size;
      if (memoryBytes > maxBytes) listCache.delete(row.key);
    });

    const cacheTable = pub.M('aliyun_esa_url_cache');
    cacheTable.where('update_time<?', now - ESA_URL_CACHE_RETENTION).delete();
    const rows = pub.M('aliyun_esa_url_cache')
      .field('cache_id, data_size')
      .order('update_time DESC, cache_id DESC')
      .select();
    let totalBytes = 0;
    const expiredIds = [];
    rows.forEach(row => {
      totalBytes += Math.max(0, Number(row.data_size) || 0);
      if (totalBytes > maxBytes) expiredIds.push(Number(row.cache_id));
    });
    if (expiredIds.length) {
      pub.M('aliyun_esa_url_cache').where(`cache_id IN (${expiredIds.map(() => '?').join(',')})`, expiredIds).delete();
    }
  }

  readEsaUrlRankingCache(cacheKey, ttl, now) {
    const row = pub.M('aliyun_esa_url_cache').where('cache_key=?', cacheKey).find();
    if (!row || now - Number(row.update_time || 0) >= ttl) return null;
    try {
      const data = JSON.parse(String(row.cache_data || '{}'));
      return data && typeof data === 'object' ? { ...data, cached: true } : null;
    } catch (_error) {
      pub.M('aliyun_esa_url_cache').where('cache_id=?', row.cache_id).delete();
      return null;
    }
  }

  writeEsaUrlRankingCache(cacheKey, accountId, data) {
    const cacheData = JSON.stringify(data);
    const now = Math.floor(Date.now() / 1000);
    pub.M('aliyun_esa_url_cache').exec(
      `INSERT INTO aliyun_esa_url_cache (cache_key, account_id, cache_data, data_size, update_time)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET account_id=excluded.account_id, cache_data=excluded.cache_data, data_size=excluded.data_size, update_time=excluded.update_time`,
      [cacheKey, Number(accountId) || 0, cacheData, Buffer.byteLength(cacheData, 'utf8'), now]
    );
    this.cleanupEsaUrlRankingCache(now);
  }

  clearEsaUrlRankingDiskCache(accountId) {
    pub.M('aliyun_esa_url_cache').where('account_id=?', Number(accountId) || 0).delete();
  }

  getEsaUrlCacheInfo() {
    this.cleanupEsaUrlRankingCache();
    const summary = pub.M('aliyun_esa_url_cache').query(
      'SELECT COUNT(*) AS entries, COALESCE(SUM(data_size), 0) AS used_bytes, MIN(update_time) AS oldest_time, MAX(update_time) AS newest_time FROM aliyun_esa_url_cache',
      []
    )[0] || {};
    const maxMb = this.getEsaUrlCacheLimitMb();
    return {
      entries: Number(summary.entries) || 0,
      used_bytes: Number(summary.used_bytes) || 0,
      max_bytes: maxMb * 1024 * 1024,
      max_mb: maxMb,
      retention_days: ESA_URL_CACHE_RETENTION / 86400,
      oldest_time: Number(summary.oldest_time) || 0,
      newest_time: Number(summary.newest_time) || 0,
    };
  }

  setEsaUrlCacheLimit(value) {
    const maxMb = Number(value);
    if (!Number.isInteger(maxMb) || maxMb < ESA_URL_CACHE_MIN_MB || maxMb > ESA_URL_CACHE_MAX_MB) {
      throw new AliyunServiceError(`缓存上限必须是 ${ESA_URL_CACHE_MIN_MB}–${ESA_URL_CACHE_MAX_MB} MB 的整数`, 'InvalidCacheLimit');
    }
    pub.config_set('aliyun_cache_max_mb', maxMb);
    this.cleanupEsaUrlRankingCache();
    return this.getEsaUrlCacheInfo();
  }

  clearEsaUrlCache() {
    for (const key of listCache.keys()) {
      if (key.startsWith('esa-url-rankings:')) listCache.delete(key);
    }
    const removed = pub.M('aliyun_esa_url_cache').where('1=1').delete();
    return { ...this.getEsaUrlCacheInfo(), removed };
  }

  updateResourceStatus(accountId, resourceKey, status) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_RESOURCE_STATUS, resourceKey)) return;
    const normalizedAccountId = Number(accountId) || 0;
    const account = pub.M('aliyun_account').where('account_id=?', normalizedAccountId).field('resource_status').find();
    if (!account) return;
    pub.M('aliyun_account').where('account_id=?', normalizedAccountId).update({
      resource_status: JSON.stringify({ ...parseResourceStatus(account.resource_status), [resourceKey]: status }),
    });
  }

  updateResourceCount(accountId, field, value, status = 'active') {
    if (!['server_count', 'domain_count', 'esa_count', 'cdn_count', 'oss_count'].includes(field)) return;
    const normalizedAccountId = Number(accountId) || 0;
    const account = pub.M('aliyun_account').where('account_id=?', normalizedAccountId).field('resource_status').find();
    if (!account) return;
    const resourceKey = field.replace(/_count$/, '');
    pub.M('aliyun_account').where('account_id=?', normalizedAccountId).update({
      [field]: Math.max(0, Number(value) || 0),
      resource_status: JSON.stringify({ ...parseResourceStatus(account.resource_status), [resourceKey]: status }),
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

  createCmsClient(account) {
    return new Cms.default({
      ...this.createConfig(account),
      endpoint: 'metrics.cn-hangzhou.aliyuncs.com',
    });
  }

  normalizeOssRegion(region) {
    const value = String(region || '').trim().toLowerCase();
    if (!/^oss-[a-z0-9-]+$/.test(value)) throw new AliyunServiceError('OSS 地域不正确', 'InvalidOssRegion');
    return value;
  }

  normalizeOssBucketName(bucket) {
    const value = String(bucket || '').trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(value)) {
      throw new AliyunServiceError('Bucket 名称必须为 3–63 位小写字母、数字或中划线', 'InvalidBucketName');
    }
    return value;
  }

  normalizeOssObjectName(name) {
    const value = String(name || '').replace(/^\/+/, '');
    if (!value || Buffer.byteLength(value) > 1023 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new AliyunServiceError('OSS 对象名称不正确', 'InvalidObjectName');
    }
    return value;
  }

  createOssClient(account, options = {}) {
    const region = this.normalizeOssRegion(options.region || 'oss-cn-hangzhou');
    const bucket = options.bucket ? this.normalizeOssBucketName(options.bucket) : undefined;
    return new OSS({
      accessKeyId: account.access_key_id,
      accessKeySecret: account.access_key_secret,
      region,
      bucket,
      secure: true,
      timeout: 30000,
    });
  }

  ossBucketView(bucket) {
    const name = this.normalizeOssBucketName(bucket.name);
    const region = this.normalizeOssRegion(bucket.region);
    return {
      name,
      region,
      creation_time: bucket.creationDate || '',
      storage_class: bucket.storageClass || bucket.StorageClass || '',
      endpoint: `${name}.${region}.aliyuncs.com`,
    };
  }

  async fetchOssBuckets(account) {
    const client = this.createOssClient(account);
    const buckets = [];
    let marker = '';
    do {
      const result = await this.request(
        () => client.listBuckets({ marker, 'max-keys': 100 }),
        'oss',
        { retries: READ_RETRY_COUNT }
      );
      buckets.push(...(result.buckets || []).map(item => this.ossBucketView(item)));
      marker = result.isTruncated && result.nextMarker ? String(result.nextMarker) : '';
    } while (marker && buckets.length < 1000);
    return buckets;
  }

  async getOssCount(account) {
    return (await this.fetchOssBuckets(account)).length;
  }

  getChinaDayRange() {
    const now = Date.now();
    const chinaOffset = 8 * 60 * 60 * 1000;
    const todayStart = Math.floor((now + chinaOffset) / 86400000) * 86400000 - chinaOffset;
    return {
      yesterdayStart: todayStart - 86400000,
      todayStart,
      now,
    };
  }

  async getOssBucketTraffic(accountId, account, buckets) {
    const names = unique((buckets || []).map(bucket => bucket.name));
    const cacheKey = `oss-traffic:${accountId}:${names.slice().sort().join(',')}`;
    const now = Math.floor(Date.now() / 1000);
    const cached = listCache.get(cacheKey);
    if (cached && now - cached.time < OSS_TRAFFIC_TTL) return cached.data;

    if (!names.length) return { traffic: {}, update_time: now, error: '' };

    try {
      const cms = this.createCmsClient(account);
      const range = this.getChinaDayRange();
      const batches = [];
      for (let index = 0; index < names.length; index += 50) batches.push(names.slice(index, index + 50));
      const batchPoints = await mapLimit(batches, 2, async batch => {
        let nextToken = '';
        const points = [];
        do {
          const body = getBody(await this.request(() => cms.describeMetricList(new Cms.DescribeMetricListRequest({
            namespace: 'acs_oss_dashboard',
            metricName: 'MeteringInternetTX',
            dimensions: JSON.stringify(batch.map(BucketName => ({ BucketName }))),
            startTime: String(range.yesterdayStart - 1),
            endTime: String(range.now),
            period: '3600',
            length: '1440',
            nextToken: nextToken || undefined,
          })), 'oss'));
          if (body.success === false || (body.code && String(body.code) !== '200')) {
            throw new AliyunServiceError(body.message || 'OSS 流量查询失败', body.code || 'OssTrafficError', body.requestId || '');
          }
          try {
            const pagePoints = JSON.parse(body.datapoints || '[]');
            if (Array.isArray(pagePoints)) points.push(...pagePoints);
          } catch (_error) {
            throw new AliyunServiceError('阿里云返回的 OSS 流量数据格式不正确', 'InvalidOssTrafficData', body.requestId || '');
          }
          nextToken = String(body.nextToken || '');
        } while (nextToken);
        return points;
      });
      const points = batchPoints.flat();

      const traffic = Object.fromEntries(names.map(name => [name, { today: 0, yesterday: 0 }]));
      points.forEach(point => {
        const bucketName = String(point.BucketName || point.bucketName || '');
        const timestamp = Number(point.timestamp || 0);
        const value = Number(point.Value ?? point.value);
        if (!traffic[bucketName] || !Number.isFinite(timestamp) || !Number.isFinite(value) || value < 0) return;
        if (timestamp >= range.todayStart && timestamp <= range.now) traffic[bucketName].today += value;
        else if (timestamp >= range.yesterdayStart && timestamp < range.todayStart) traffic[bucketName].yesterday += value;
      });
      const data = { traffic, update_time: now, error: '' };
      listCache.set(cacheKey, { time: now, data });
      return data;
    } catch (error) {
      const normalized = normalizeError(error, 'oss');
      return { traffic: {}, update_time: 0, error: normalized.message };
    }
  }

  async listOssBuckets(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const keyword = String(options.keyword || '').trim().toLowerCase();
    const page = Math.max(1, Number(options.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(options.page_size) || 20));
    const buckets = (await this.fetchOssBuckets(account))
      .filter(item => !keyword || item.name.includes(keyword) || item.region.includes(keyword));
    const pageBuckets = buckets.slice((page - 1) * pageSize, page * pageSize);
    const trafficResult = options.include_stat === false
      ? { traffic: {}, update_time: 0, error: '' }
      : await this.getOssBucketTraffic(accountId, account, pageBuckets);
    const data = options.include_stat === false ? pageBuckets : await mapLimit(pageBuckets, MAX_REGION_CONCURRENCY, async bucket => {
      const traffic = trafficResult.traffic[bucket.name];
      try {
        const client = this.createOssClient(account, { bucket: bucket.name, region: bucket.region });
        const result = await this.request(() => client.getBucketStat(bucket.name), 'oss');
        return {
          ...bucket,
          object_count: Number(result.stat && result.stat.ObjectCount || 0),
          storage_size: Number(result.stat && result.stat.Storage || 0),
          stat_error: '',
          today_traffic: traffic ? traffic.today : null,
          yesterday_traffic: traffic ? traffic.yesterday : null,
          traffic_error: trafficResult.error,
          traffic_update_time: trafficResult.update_time,
        };
      } catch (error) {
        const normalized = normalizeError(error, 'oss');
        return {
          ...bucket,
          object_count: null,
          storage_size: null,
          stat_error: normalized.message,
          today_traffic: traffic ? traffic.today : null,
          yesterday_traffic: traffic ? traffic.yesterday : null,
          traffic_error: trafficResult.error,
          traffic_update_time: trafficResult.update_time,
        };
      }
    });
    if (!keyword) this.updateResourceCount(accountId, 'oss_count', buckets.length);
    return {
      data,
      total: buckets.length,
      page,
      page_size: pageSize,
    };
  }

  async createOssBucket(accountId, data = {}) {
    const account = this.getAccount(accountId);
    const name = this.normalizeOssBucketName(data.name);
    const region = this.normalizeOssRegion(data.region);
    const storageClass = String(data.storage_class || 'Standard');
    const acl = String(data.acl || 'private');
    if (!['Standard', 'IA', 'Archive', 'ColdArchive', 'DeepColdArchive'].includes(storageClass)) {
      throw new AliyunServiceError('OSS 存储类型不正确', 'InvalidStorageClass');
    }
    if (!['private', 'public-read', 'public-read-write'].includes(acl)) {
      throw new AliyunServiceError('OSS 访问权限不正确', 'InvalidBucketAcl');
    }
    const client = this.createOssClient(account, { region });
    await this.request(() => client.putBucket(name, { storageClass, acl }), 'oss');
    this.clearAccountCache(accountId);
    return this.ossBucketView({ name, region, storageClass, creationDate: new Date().toISOString() });
  }

  async deleteOssBucket(accountId, bucket, region) {
    const account = this.getAccount(accountId);
    const name = this.normalizeOssBucketName(bucket);
    const client = this.createOssClient(account, { bucket: name, region });
    await this.request(() => client.deleteBucket(name), 'oss');
    this.clearAccountCache(accountId);
    return { name };
  }

  async listOssObjects(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const bucket = this.normalizeOssBucketName(options.bucket);
    const region = this.normalizeOssRegion(options.region);
    const prefix = String(options.prefix || '').replace(/^\/+/, '').slice(0, 1023);
    const marker = String(options.marker || '').slice(0, 1023);
    const pageSize = Math.min(100, Math.max(1, Number(options.page_size) || 20));
    const page = Math.max(1, Number(options.page) || 1);
    const sort = ['size_desc', 'size_asc', 'modified_desc', 'modified_asc'].includes(String(options.sort))
      ? String(options.sort)
      : 'name';
    const client = this.createOssClient(account, { bucket, region });
    const imagePattern = /\.(?:avif|bmp|gif|ico|jfif|jpe?g|pjp|pjpeg|png|svg|webp)$/i;
    const objectView = item => {
      const name = String(item.name || '');
      const isDirectory = name.endsWith('/');
      return {
        name,
        size: isDirectory ? 0 : Number(item.size || 0),
        is_directory: isDirectory,
        last_modified: item.lastModified || '',
        etag: String(item.etag || '').replace(/^"|"$/g, ''),
        storage_class: item.storageClass || item.type || '',
        preview_url: !isDirectory && imagePattern.test(name)
          ? client.signatureUrl(name, { expires: 300 })
          : '',
      };
    };
    const directoryView = name => ({
      name: String(name),
      size: 0,
      is_directory: true,
      last_modified: '',
      etag: '',
      storage_class: '',
      preview_url: '',
    });
    const mergePage = result => {
      const directories = (result.prefixes || []).map(directoryView);
      const directoryNames = new Set(directories.map(item => item.name));
      return [...directories, ...(result.objects || []).map(objectView).filter(item => !directoryNames.has(item.name))];
    };

    if (sort === 'name') {
      const result = await this.request(() => client.list({ prefix, marker, delimiter: '/', 'max-keys': pageSize }), 'oss');
      return {
        data: mergePage(result),
        next_marker: result.isTruncated ? String(result.nextMarker || '') : '',
        total: null,
        page,
        sort,
        prefix,
        page_size: pageSize,
      };
    }

    const allItems = [];
    let scanMarker = '';
    do {
      const result = await this.request(() => client.list({ prefix, marker: scanMarker, delimiter: '/', 'max-keys': 1000 }), 'oss');
      allItems.push(...mergePage(result));
      scanMarker = result.isTruncated && result.nextMarker ? String(result.nextMarker) : '';
    } while (scanMarker);
    const uniqueItems = Array.from(new Map(allItems.map(item => [item.name, item])).values());
    const timeValue = item => {
      const value = new Date(item.last_modified || '').getTime();
      return Number.isNaN(value) ? 0 : value;
    };
    uniqueItems.sort((left, right) => {
      if (left.is_directory !== right.is_directory) return left.is_directory ? -1 : 1;
      if (left.is_directory) return left.name.localeCompare(right.name);
      const leftValue = sort.startsWith('size') ? left.size : timeValue(left);
      const rightValue = sort.startsWith('size') ? right.size : timeValue(right);
      const difference = leftValue - rightValue;
      return difference ? (sort.endsWith('_asc') ? difference : -difference) : left.name.localeCompare(right.name);
    });
    const offset = (page - 1) * pageSize;
    return {
      data: uniqueItems.slice(offset, offset + pageSize),
      next_marker: '',
      total: uniqueItems.length,
      page,
      sort,
      prefix,
      page_size: pageSize,
    };
  }

  async uploadOssObjects(accountId, data, filePaths) {
    const account = this.getAccount(accountId);
    const bucket = this.normalizeOssBucketName(data.bucket);
    const region = this.normalizeOssRegion(data.region);
    const prefix = String(data.prefix || '').replace(/^\/+|\/+$/g, '');
    const client = this.createOssClient(account, { bucket, region });
    const results = [];
    for (const file of filePaths) {
      const objectName = this.normalizeOssObjectName([prefix, require('path').basename(file)].filter(Boolean).join('/'));
      await this.request(() => client.put(objectName, file), 'oss');
      results.push({ name: objectName });
    }
    return results;
  }

  async downloadOssObject(accountId, data, destination) {
    const account = this.getAccount(accountId);
    const bucket = this.normalizeOssBucketName(data.bucket);
    const region = this.normalizeOssRegion(data.region);
    const objectName = this.normalizeOssObjectName(data.object_name);
    const client = this.createOssClient(account, { bucket, region });
    await this.request(() => client.get(objectName, destination), 'oss');
    return { name: objectName };
  }

  async deleteOssObjects(accountId, data = {}) {
    const account = this.getAccount(accountId);
    const bucket = this.normalizeOssBucketName(data.bucket);
    const region = this.normalizeOssRegion(data.region);
    const names = unique((Array.isArray(data.object_names) ? data.object_names : []).map(item => this.normalizeOssObjectName(item)));
    if (!names.length) throw new AliyunServiceError('请先选择 OSS 对象', 'ObjectRequired');
    if (names.length > 100) throw new AliyunServiceError('单次最多删除 100 个 OSS 对象', 'TooManyObjects');
    const client = this.createOssClient(account, { bucket, region });
    const results = await mapLimit(names, MAX_REGION_CONCURRENCY, async name => {
      try {
        await this.request(() => client.delete(name), 'oss');
        return { name, success: true };
      } catch (error) {
        const normalized = normalizeError(error, 'oss');
        return { name, success: false, message: normalized.message, errorCode: normalized.code, requestId: normalized.requestId };
      }
    });
    return {
      success_count: results.filter(item => item.success).length,
      failure_count: results.filter(item => !item.success).length,
      failures: results.filter(item => !item.success),
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

  async request(handler, service = '', options = {}) {
    const retries = Math.max(0, Number(options.retries) || 0);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await handler();
      } catch (error) {
        const normalized = normalizeError(error, service);
        if (attempt >= retries || !isRetryableError(normalized)) throw normalized;
        const delay = 350 * (2 ** attempt) + Math.floor(Math.random() * 200);
        await wait(delay);
      }
    }
  }

  async queryBalance(account) {
    const { bss } = this.createClients(account);
    const body = getBody(await this.request(() => bss.queryAccountBalance(), 'balance', { retries: READ_RETRY_COUNT }));
    if (body.success === false) {
      throw normalizeError(new AliyunServiceError(body.message || '查询账号余额失败', body.code || 'BalanceQueryFailed', body.requestId, body.message || ''), 'balance');
    }
    return {
      balance: body.data && body.data.availableAmount || '',
      currency: body.data && body.data.currency || 'CNY',
      requestId: body.requestId || '',
    };
  }

  async refreshBalance(accountId) {
    const account = this.getAccount(accountId);
    try {
      const result = await this.queryBalance(account);
      const refreshTime = Math.floor(Date.now() / 1000);
      const latestAccount = pub.M('aliyun_account').where('account_id=?', account.account_id).field('resource_status').find();
      pub.M('aliyun_account').where('account_id=?', account.account_id).update({
        balance: result.balance,
        balance_currency: result.currency,
        balance_refresh_time: refreshTime,
        resource_status: JSON.stringify({ ...parseResourceStatus(latestAccount && latestAccount.resource_status), balance: 'active' }),
      });
      return {
        balance: result.balance,
        balance_currency: result.currency,
        balance_refresh_time: refreshTime,
        requestId: result.requestId,
      };
    } catch (error) {
      const normalized = normalizeError(error, 'balance');
      this.updateResourceStatus(account.account_id, 'balance', normalized.status);
      throw normalized;
    }
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
      })), 'server', { retries: READ_RETRY_COUNT });
      regions = ((getBody(response).regions || {}).region || []).map(item => ({
        region_id: item.regionId,
        name: item.localName || item.regionId,
      }));
    } else {
      const swas = this.createSwasClient(account, SWAS_BOOTSTRAP_REGION);
      const response = await this.request(() => swas.listRegions(new Swas.ListRegionsRequest({
        acceptLanguage: 'zh-CN',
      })), 'server', { retries: READ_RETRY_COUNT });
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

  async getResourceCount(account, source, runTask = handler => handler()) {
    const regions = await runTask(() => this.getRegions(account, source));
    const failures = [];
    let count = 0;
    await mapLimit(regions, MAX_REGION_CONCURRENCY, region => runTask(async () => {
      try {
        if (source === 'ecs') {
          const clients = this.createClients(account, region.region_id);
          const response = await this.request(() => clients.ecs.describeInstances(new Ecs.DescribeInstancesRequest({
            regionId: region.region_id,
            pageNumber: 1,
            pageSize: 1,
          })), 'server', { retries: READ_RETRY_COUNT });
          const regionCount = Number(getBody(response).totalCount || 0);
          count += regionCount;
          resourceRegionCache.set(`${account.account_id}:${source}:${region.region_id}`, {
            time: Math.floor(Date.now() / 1000),
            count: regionCount,
          });
        } else {
          const swas = this.createSwasClient(account, region.region_id, region.endpoint);
          const response = await this.request(() => swas.listInstances(new Swas.ListInstancesRequest({
            regionId: region.region_id,
            pageNumber: 1,
            pageSize: 1,
          })), 'server', { retries: READ_RETRY_COUNT });
          const regionCount = Number(getBody(response).totalCount || 0);
          count += regionCount;
          resourceRegionCache.set(`${account.account_id}:${source}:${region.region_id}`, {
            time: Math.floor(Date.now() / 1000),
            count: regionCount,
          });
        }
      } catch (error) {
        const normalized = normalizeError(error, 'server');
        failures.push({ region_id: region.region_id, errorCode: normalized.code, message: normalized.message, requestId: normalized.requestId, detail: normalized.detail });
      }
    }));
    if (regions.length && failures.length === regions.length) throw new AliyunServiceError(failures[0].message, failures[0].errorCode, failures[0].requestId, failures[0].detail);
    return { count, failures };
  }

  async getDomainCount(account) {
    const { dns } = this.createClients(account);
    const response = await this.request(() => dns.describeDomains(new AliDns.DescribeDomainsRequest({
      pageNumber: 1,
      pageSize: 1,
      lang: 'zh',
    })), 'domain', { retries: READ_RETRY_COUNT });
    return Number(getBody(response).totalCount || 0);
  }

  async getEsaCount(account) {
    const { esa } = this.createClients(account);
    const response = await this.request(() => esa.listSites(new Esa.ListSitesRequest({
      pageNumber: 1,
      pageSize: 1,
    })), 'esa', { retries: READ_RETRY_COUNT });
    return Number(getBody(response).totalCount || 0);
  }

  async getCdnCount(account) {
    const { cdn } = this.createClients(account);
    try {
      const response = await this.request(() => cdn.describeUserDomains(new Cdn.DescribeUserDomainsRequest({
        pageNumber: 1,
        pageSize: 1,
        checkDomainShow: true,
      })), 'cdn', { retries: READ_RETRY_COUNT });
      return { count: Number(getBody(response).totalCount || 0), status: 'active' };
    } catch (error) {
      if (isCdnNotOpenedError(error)) return { count: 0, status: 'not_opened' };
      throw error;
    }
  }

  async refreshSummary(accountId, force = false) {
    const normalizedAccountId = Number(accountId) || 0;
    const existingRequest = summaryRequests.get(normalizedAccountId);
    if (existingRequest) return existingRequest;

    const request = runSummaryTask(() => this.refreshSummaryNow(normalizedAccountId, force));
    const trackedRequest = request.finally(() => {
      if (summaryRequests.get(normalizedAccountId) === trackedRequest) {
        summaryRequests.delete(normalizedAccountId);
      }
    });
    summaryRequests.set(normalizedAccountId, trackedRequest);
    return trackedRequest;
  }

  async refreshSummaryNow(accountId, force = false) {
    const account = this.getAccount(accountId);
    const now = Math.floor(Date.now() / 1000);
    if (!force && account.resource_refresh_time && now - Number(account.resource_refresh_time) < SUMMARY_TTL) {
      return this.safeAccount(account);
    }

    const runAccountTask = createLimiter(MAX_ACCOUNT_REQUEST_CONCURRENCY);
    const [balanceResult, domainResult, esaResult, cdnResult, ossResult, ecsResult, swasResult] = await Promise.allSettled([
      runAccountTask(() => this.queryBalance(account)),
      runAccountTask(() => this.getDomainCount(account)),
      runAccountTask(() => this.getEsaCount(account)),
      runAccountTask(() => this.getCdnCount(account)),
      runAccountTask(() => this.getOssCount(account)),
      this.getResourceCount(account, 'ecs', runAccountTask),
      this.getResourceCount(account, 'swas', runAccountTask),
    ]);
    const update = { resource_refresh_time: now };
    const resourceStatus = parseResourceStatus(account.resource_status);
    const errors = [];
    const addError = (source, error, resourceKey, updateStatus = true) => {
      const normalized = normalizeError(error, resourceKey || '');
      if (resourceKey && updateStatus) resourceStatus[resourceKey] = normalized.status;
      errors.push({
        source,
        message: normalized.message,
        code: normalized.code,
        requestId: normalized.requestId,
        detail: normalized.detail,
      });
    };

    if (balanceResult.status === 'fulfilled') {
      resourceStatus.balance = 'active';
      update.balance = balanceResult.value.balance;
      update.balance_currency = balanceResult.value.currency;
      update.balance_refresh_time = now;
    } else addError('账号余额', balanceResult.reason, 'balance');

    if (domainResult.status === 'fulfilled') {
      resourceStatus.domain = 'active';
      update.domain_count = domainResult.value;
    } else addError('域名解析', domainResult.reason, 'domain');

    if (esaResult.status === 'fulfilled') {
      resourceStatus.esa = 'active';
      update.esa_count = esaResult.value;
    } else addError('ESA', esaResult.reason, 'esa');

    if (cdnResult.status === 'fulfilled') {
      update.cdn_count = cdnResult.value.count;
      update.cdn_status = cdnResult.value.status;
      resourceStatus.cdn = cdnResult.value.status;
    }
    else addError('CDN', cdnResult.reason, 'cdn');

    if (ossResult.status === 'fulfilled') {
      resourceStatus.oss = 'active';
      update.oss_count = ossResult.value;
    } else addError('OSS', ossResult.reason, 'oss');

    let serverCount = 0;
    let hasServerResult = false;
    let serverComplete = true;
    let firstServerError = null;
    for (const [source, result] of [['ECS', ecsResult], ['轻量服务器', swasResult]]) {
      if (result.status === 'fulfilled') {
        hasServerResult = true;
        serverCount += result.value.count;
        if (result.value.failures.length) serverComplete = false;
        result.value.failures.forEach(item => {
          const error = new AliyunServiceError(item.message, item.errorCode, item.requestId, item.detail);
          firstServerError = firstServerError || error;
          addError(item.region_id ? `${source}（${item.region_id}）` : source, error, 'server', false);
        });
      } else {
        serverComplete = false;
        firstServerError = firstServerError || result.reason;
        addError(source, result.reason, 'server', false);
      }
    }
    if (hasServerResult && serverComplete) {
      resourceStatus.server = 'active';
      update.server_count = serverCount;
    } else if (hasServerResult) {
      resourceStatus.server = 'partial';
    } else if (firstServerError) {
      resourceStatus.server = normalizeError(firstServerError, 'server').status;
    }
    update.resource_status = JSON.stringify(resourceStatus);
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
      oss_count: Number(account.oss_count),
      resource_status: parseResourceStatus(account.resource_status),
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
      })), 'server'));
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
        })), 'server'));
        items.push(...(((body.instances || {}).instance || []).map(item => this.normalizeEcsInstance(item, region.region_id))));
      } else {
        body = getBody(await this.request(() => swas.listInstances(new Swas.ListInstancesRequest({
          regionId: region.region_id,
          pageNumber: page,
          pageSize: 100,
        })), 'server'));
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
        const normalized = normalizeError(error, 'server');
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
      const status = cached.data.partial ? 'partial' : 'active';
      if (cached.data.count_complete) this.updateResourceCount(accountId, 'server_count', cached.data.data.length, status);
      else this.updateResourceStatus(accountId, 'server', status);
      return cached.data;
    }
    const account = this.getAccount(accountId);
    const sourceResults = await Promise.allSettled(['ecs', 'swas'].map(async source => ({
      source,
      regions: await this.getRegions(account, source),
    })));
    const tasks = [];
    const failures = [];
    let successfulQueries = 0;
    sourceResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        const allRegions = result.value.regions;
        const now = Math.floor(Date.now() / 1000);
        const regionStats = allRegions.map(region => resourceRegionCache.get(
          `${account.account_id}:${result.value.source}:${region.region_id}`
        ));
        const hasFreshRegionStats = !force && regionStats.length === allRegions.length &&
          regionStats.every(item => item && now - item.time < SUMMARY_TTL);
        const targetRegions = hasFreshRegionStats
          ? allRegions.filter((_region, regionIndex) => regionStats[regionIndex].count > 0)
          : allRegions;
        if (!targetRegions.length) successfulQueries += 1;
        targetRegions.forEach(region => tasks.push({ source: result.value.source, region }));
      } else {
        const error = normalizeError(result.reason, 'server');
        failures.push({ source: index === 0 ? 'ecs' : 'swas', region_id: '', errorCode: error.code, message: error.message, requestId: error.requestId, detail: error.detail });
      }
    });

    const taskResults = await mapLimit(tasks, MAX_REGION_CONCURRENCY, async task => {
      try {
        const result = await this.fetchRegionInstances(account, task.source, task.region);
        resourceRegionCache.set(`${account.account_id}:${task.source}:${task.region.region_id}`, {
          time: Math.floor(Date.now() / 1000),
          count: result.items.length,
        });
        successfulQueries += 1;
        failures.push(...result.failures);
        return result.items;
      } catch (error) {
        const normalized = normalizeError(error, 'server');
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
    if (!successfulQueries && failures.length) {
      const firstFailure = failures[0];
      const error = new AliyunServiceError(firstFailure.message, firstFailure.errorCode, firstFailure.requestId, firstFailure.detail);
      error.service = 'server';
      this.updateResourceStatus(accountId, 'server', error.status);
      throw error;
    }
    listCache.set(cacheKey, { time: now, data });
    const status = data.partial ? 'partial' : 'active';
    if (data.count_complete) this.updateResourceCount(accountId, 'server_count', data.data.length, status);
    else this.updateResourceStatus(accountId, 'server', status);
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
    })), 'domain');
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
        })), 'domain'));
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
      })), 'domain'),
      this.request(() => esa.listSites(new Esa.ListSitesRequest({
        pageNumber: 1,
        pageSize: 500,
        siteName: normalizedDomainName,
        siteSearchType: 'fuzzy',
      })), 'esa').catch(() => null),
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
    const body = getBody(await this.request(() => esa.listSites(new Esa.ListSitesRequest(request)), 'esa'));
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
    })), 'esa'));
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
    const body = getBody(await this.request(() => esa.listRecords(new Esa.ListRecordsRequest(request)), 'esa'));
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
    const body = getBody(await this.request(() => esa.getRecord(new Esa.GetRecordRequest({ recordId: id })), 'esa'));
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
    const body = getBody(await this.request(() => esa.createRecord(new Esa.CreateRecordRequest({ siteId, recordName, ...request })), 'esa'));
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
    })), 'esa'));
    this.clearAccountCache(accountId);
    return { record_id: String(record.recordId), requestId: body.requestId || '' };
  }

  async deleteEsaRecord(accountId, recordId) {
    const account = this.getAccount(accountId);
    const { esa, record } = await this.getEsaRecord(account, recordId);
    const body = getBody(await this.request(() => esa.deleteRecord(new Esa.DeleteRecordRequest({ recordId: Number(record.recordId) })), 'esa'));
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
    const body = getBody(await this.request(() => esa.updateRecord(new Esa.UpdateRecordRequest({ recordId: Number(record.recordId), ...request })), 'esa'));
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
      })), 'esa'),
      this.request(() => esa.listOriginRules(new Esa.ListOriginRulesRequest({
        siteId: normalizedSiteId,
        pageNumber: 1,
        pageSize: 500,
      })), 'esa'),
    ]);
    const poolBody = results[0].status === 'fulfilled' ? getBody(results[0].value) : {};
    const ruleBody = results[1].status === 'fulfilled' ? getBody(results[1].value) : {};
    const errors = [];
    if (results[0].status === 'rejected') {
      const error = normalizeError(results[0].reason, 'esa');
      errors.push({ module: 'origin_pools', message: error.message, errorCode: error.code, requestId: error.requestId });
    }
    if (results[1].status === 'rejected') {
      const error = normalizeError(results[1].reason, 'esa');
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
    })), 'esa'));
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
      })), 'esa'
    )));
    const httpsResults = await Promise.allSettled([
      this.request(() => esa.listHttpsBasicConfigurations(new Esa.ListHttpsBasicConfigurationsRequest({
        siteId,
        pageNumber: 1,
        pageSize: 500,
      })), 'esa'),
      this.request(() => esa.listHttpsApplicationConfigurations(new Esa.ListHttpsApplicationConfigurationsRequest({
        siteId,
        pageNumber: 1,
        pageSize: 500,
      })), 'esa'),
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
      .map((result, index) => result.status === 'rejected' ? { module: recordNameBatches[index].join(', '), ...normalizeError(result.reason, 'esa') } : null)
      .filter(Boolean);
    if (httpsResults[0].status === 'rejected') errors.push({ module: 'https_basic', ...normalizeError(httpsResults[0].reason, 'esa') });
    if (httpsResults[1].status === 'rejected') errors.push({ module: 'https_application', ...normalizeError(httpsResults[1].reason, 'esa') });
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
    })), 'esa'));
    this.clearAccountCache(accountId);
    return { certificate_id: String(body.id || ''), requestId: body.requestId || '' };
  }

  async getEsaUrlRankings(accountId, siteId, host, range, onProgress) {
    const startedAt = Date.now();
    const reportProgress = progress => {
      if (typeof onProgress !== 'function') return;
      try {
        onProgress({ ...progress, elapsed_ms: Date.now() - startedAt });
      } catch (_error) {
        // 前端窗口关闭时忽略进度通知失败，不影响日志处理。
      }
    };
    const account = this.getAccount(accountId);
    const { esa } = this.createClients(account);
    const selectedHost = String(host || '').trim().toLowerCase();
    if (!selectedHost) return { urls: [], url_traffic: [], host: '', log_count: 0, total_log_count: 0, truncated: false, update_time: 0 };

    const logInfos = [];
    let pageNumber = 1;
    let totalLogCount = 0;
    let requestId = '';
    reportProgress({ stage: 'listing', current: 0, total: 0, percentage: 3, message: '正在获取 ESA 日志清单' });
    while (logInfos.length < ESA_LOG_MAX_FILES) {
      const body = getBody(await this.request(() => esa.describeSiteLogs(new Esa.DescribeSiteLogsRequest({
        siteId: Number(siteId),
        startTime: range.startTime,
        endTime: range.endTime,
        pageNumber,
        pageSize: Math.min(1000, ESA_LOG_MAX_FILES),
      })), 'esa', { retries: READ_RETRY_COUNT }));
      requestId = requestId || body.requestId || '';
      const detail = (body.siteLogDetails || [])[0] || {};
      const infos = Array.isArray(detail.logInfos) ? detail.logInfos : [];
      const pageInfo = detail.pageInfos || {};
      totalLogCount = Math.max(totalLogCount, Number(pageInfo.totalCount || detail.logCount || 0));
      logInfos.push(...infos.filter(item => item && item.logPath));
      reportProgress({
        stage: 'listing',
        current: logInfos.length,
        total: totalLogCount || logInfos.length,
        percentage: Math.min(10, totalLogCount ? 3 + Math.round(logInfos.length / totalLogCount * 7) : 8),
        message: '正在获取 ESA 日志清单',
      });
      if (!infos.length || logInfos.length >= totalLogCount || infos.length < ESA_LOG_MAX_FILES) break;
      pageNumber += 1;
    }

    const candidates = logInfos.slice(0, ESA_LOG_MAX_FILES).filter(item => {
      const size = Number(item.logSize || 0);
      return !size || size <= ESA_LOG_MAX_FILE_BYTES;
    });
    let selectedBytes = 0;
    const selectedInfos = [];
    let truncated = candidates.length < logInfos.length || logInfos.length > ESA_LOG_MAX_FILES || totalLogCount > logInfos.length;
    for (const info of candidates) {
      const size = Number(info.logSize || 0);
      if (size && selectedBytes + size > ESA_LOG_MAX_COMPRESSED_BYTES) {
        truncated = true;
        continue;
      }
      selectedBytes += size;
      selectedInfos.push(info);
    }
    reportProgress({
      stage: 'preparing',
      current: 0,
      total: selectedInfos.length,
      percentage: 10,
      message: selectedInfos.length ? `已准备 ${selectedInfos.length} 份日志，准备开始处理` : '当前时间范围没有可用日志',
    });
    const errors = [];
    const byUrl = new Map();
    let rowCount = 0;
    let completedFiles = 0;
    await Promise.all(selectedInfos.map(info => runEsaLogDownload(async () => {
      try {
        const buffer = await downloadHttpsBuffer(info.logPath);
        forEachEsaLogRow(buffer, row => {
          rowCount += 1;
          const rowHost = String(row.ClientRequestHost || '').trim().toLowerCase();
          if (!rowHost || rowHost !== selectedHost) return;
          const requestUri = String(row.ClientRequestURI || '/').trim() || '/';
          let url;
          try {
            const scheme = String(row.ClientRequestScheme || 'https').trim().toLowerCase() === 'http' ? 'http' : 'https';
            url = new URL(requestUri, `${scheme}://${rowHost}`).toString();
          } catch (_error) {
            return;
          }
          const item = byUrl.get(url) || { name: url, requests: 0, traffic: 0 };
          item.requests += 1;
          item.traffic += Math.max(0, finiteNumber(row.EdgeResponseBytes, finiteNumber(row.EdgeResponseBodyBytes)));
          byUrl.set(url, item);
        });
      } catch (error) {
        const normalized = normalizeError(error, 'esa');
        errors.push({ message: normalized.message, errorCode: normalized.code, requestId: normalized.requestId || '' });
        Log.warn(`[aliyun][esa-traffic-log] ${JSON.stringify({ accountId: Number(accountId), siteId: Number(siteId), host: selectedHost, logName: String(info.logName || '').slice(0, 180), errorCode: normalized.code, message: normalized.message })}`);
      } finally {
        completedFiles += 1;
        const total = selectedInfos.length || 1;
        reportProgress({
          stage: 'processing',
          current: completedFiles,
          total: selectedInfos.length,
          percentage: Math.min(95, 10 + Math.round(completedFiles / total * 85)),
          message: `正在处理日志 ${completedFiles}/${selectedInfos.length}`,
        });
      }
    })));
    reportProgress({ stage: 'ranking', current: selectedInfos.length, total: selectedInfos.length, percentage: 98, message: '正在生成 URL 排行' });
    const values = Array.from(byUrl.values());
    if (selectedInfos.length && errors.length === selectedInfos.length) {
      throw new AliyunServiceError('所有 ESA 离线日志均下载失败，请稍后重试', errors[0].errorCode || 'EsaLogDownloadFailed', errors[0].requestId || '', errors[0].message || '');
    }
    const result = {
      urls: values.slice().sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)).slice(0, 10),
      url_traffic: values.slice().sort((a, b) => b.traffic - a.traffic || a.name.localeCompare(b.name)).slice(0, 10),
      host: selectedHost,
      log_count: selectedInfos.length,
      total_log_count: totalLogCount || logInfos.length,
      row_count: rowCount,
      truncated,
      errors,
      requestId,
      update_time: Math.floor(Date.now() / 1000),
    };
    reportProgress({ stage: 'complete', current: selectedInfos.length, total: selectedInfos.length, percentage: 100, message: '已完成 URL 排行' });
    return result;
  }

  async getEsaUrlRankingAnalytics(accountId, options = {}, onProgress) {
    const siteId = this.normalizeEsaSiteId(options.site_id);
    const host = String(options.domain_name || '').trim().toLowerCase();
    if (!host || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) {
      throw new AliyunServiceError('请选择要查看 URL 排行的域名', 'EsaUrlRankingDomainRequired');
    }
    const range = normalizeAnalyticsRange(options);
    const cacheKey = `esa-url-rankings:${accountId}:${siteId}:${host}:${analyticsCacheRangeKey(range, options)}`;
    const now = Math.floor(Date.now() / 1000);
    const cacheTtl = this.esaUrlRankingTtl(range);
    if (options.force === true) listCache.delete(cacheKey);
    const cached = listCache.get(cacheKey);
    if (cached && now - cached.time < cacheTtl) return { ...cached.data, cached: true };
    if (options.force !== true) {
      this.cleanupEsaUrlRankingCache(now);
      const diskCached = this.readEsaUrlRankingCache(cacheKey, cacheTtl, now);
      if (diskCached) {
        listCache.set(cacheKey, { time: Number(diskCached.update_time) || now, data: diskCached });
        return diskCached;
      }
    }
    const existingRequest = esaUrlRankingRequests.get(cacheKey);
    if (existingRequest) return existingRequest;
    const request = this.getEsaUrlRankings(accountId, siteId, host, range, onProgress)
      .then(data => {
        const result = { ...data, range: { key: range.range, start_time: range.startTime, end_time: range.endTime }, cached: false };
        listCache.set(cacheKey, { time: Math.floor(Date.now() / 1000), data: result });
        this.writeEsaUrlRankingCache(cacheKey, accountId, result);
        return result;
      })
      .catch(error => {
        const normalized = normalizeError(error, 'esa');
        Log.warn(`[aliyun][esa-traffic] ${JSON.stringify({ accountId: Number(accountId), siteId, host, endpoint: 'DescribeSiteLogs', errorCode: normalized.code, requestId: normalized.requestId || '', message: normalized.message })}`);
        throw normalized;
      });
    const trackedRequest = request.finally(() => {
      if (esaUrlRankingRequests.get(cacheKey) === trackedRequest) esaUrlRankingRequests.delete(cacheKey);
    });
    esaUrlRankingRequests.set(cacheKey, trackedRequest);
    return trackedRequest;
  }

  async getEsaTrafficAnalytics(accountId, options = {}) {
    const siteId = this.normalizeEsaSiteId(options.site_id);
    const range = normalizeAnalyticsRange(options);
    const cacheKey = `traffic-analytics:esa:${accountId}:${siteId}:${analyticsCacheRangeKey(range, options)}:${range.interval}`;
    const now = Math.floor(Date.now() / 1000);
    if (options.force === true) listCache.delete(cacheKey);
    const cached = listCache.get(cacheKey);
    if (cached && now - cached.time < TRAFFIC_ANALYTICS_TTL) return { ...cached.data, cached: true };
    const existingRequest = esaTrafficRequests.get(cacheKey);
    if (existingRequest) return existingRequest;
    const request = this.fetchEsaTrafficAnalytics(accountId, siteId, range)
      .then(data => {
        listCache.set(cacheKey, { time: Math.floor(Date.now() / 1000), data });
        return data;
      });
    const trackedRequest = request.finally(() => {
      if (esaTrafficRequests.get(cacheKey) === trackedRequest) esaTrafficRequests.delete(cacheKey);
    });
    esaTrafficRequests.set(cacheKey, trackedRequest);
    return trackedRequest;
  }

  async fetchEsaTrafficAnalytics(accountId, siteId, range) {
    const account = this.getAccount(accountId);
    const now = Math.floor(Date.now() / 1000);
    const { esa } = this.createClients(account);
    const common = {
      siteId,
      startTime: range.startTime,
      endTime: range.endTime,
      interval: range.interval,
    };
    const timeSeriesMetrics = [
      { name: 'traffic', module: '总流量与带宽', fieldName: 'Traffic', dimension: 'ALL' },
      { name: 'requests', module: '请求数与 QPS', fieldName: 'Requests', dimension: 'ALL' },
      { name: 'cache', module: '缓存命中率', fieldName: 'Requests', dimension: 'EdgeCacheStatus' },
      { name: 'edge_status', module: '边缘状态码', fieldName: 'Requests', dimension: 'EdgeResponseStatusCode' },
      { name: 'origin_status', module: '源站状态码', fieldName: 'Requests', dimension: 'OriginResponseStatusCode' },
    ];
    const topMetrics = [
      { name: 'domains', module: '域名流量排行', fieldName: 'Traffic', dimension: 'ClientRequestHost' },
      { name: 'regions', module: '地区请求排行', fieldName: 'Requests', dimension: 'ClientCountryCode' },
    ];
    const timeSeriesGroups = [
      { name: 'summary', module: '总流量、带宽、请求数与 QPS', metrics: timeSeriesMetrics.filter(metric => ['traffic', 'requests'].includes(metric.name)) },
      { name: 'cache', module: '缓存命中率', metrics: timeSeriesMetrics.filter(metric => metric.name === 'cache') },
      { name: 'edge_status', module: '边缘状态码', metrics: timeSeriesMetrics.filter(metric => metric.name === 'edge_status') },
      { name: 'origin_status', module: '源站状态码', metrics: timeSeriesMetrics.filter(metric => metric.name === 'origin_status') },
    ];
    const tasks = [
      ...timeSeriesGroups.map(group => ({
        name: group.name,
        module: group.module,
        type: 'time_series',
        handler: () => esa.describeSiteTimeSeriesData(new Esa.DescribeSiteTimeSeriesDataRequest({
          ...common,
          fields: group.metrics.map(metric => new Esa.DescribeSiteTimeSeriesDataRequestFields({
            fieldName: metric.fieldName,
            dimension: [metric.dimension],
          })),
        })),
      })),
      {
        name: 'top',
        module: '流量排行指标',
        type: 'top',
        handler: () => esa.describeSiteTopData(new Esa.DescribeSiteTopDataRequest({
          ...common,
          limit: '100',
          fields: topMetrics.map(metric => new Esa.DescribeSiteTopDataRequestFields({
            fieldName: metric.fieldName,
            dimension: [metric.dimension],
          })),
        })),
      },
    ];
    const taskResults = [];
    for (const task of tasks) {
      try {
        let body;
        for (let attempt = 0; attempt <= ESA_ANALYTICS_RETRY_COUNT; attempt += 1) {
          try {
            body = getBody(await paceEsaAnalyticsRequest(() => this.request(task.handler, 'esa')));
            break;
          } catch (error) {
            if (attempt >= ESA_ANALYTICS_RETRY_COUNT || !['rate_limited', 'timeout', 'network', 'unavailable'].includes(error && error.status)) throw error;
          }
        }
        taskResults.push({ ...task, body });
      } catch (error) {
        const normalized = normalizeError(error, 'esa');
        const failure = {
          accountId: Number(accountId),
          siteId,
          range: range.range,
          endpoint: task.type === 'time_series' ? 'DescribeSiteTimeSeriesData' : 'DescribeSiteTopData',
          module: task.module,
          errorCode: normalized.code,
          requestId: normalized.requestId || '',
          message: normalized.message,
          detail: normalized.detail || '',
        };
        Log.warn(`[aliyun][esa-traffic] ${JSON.stringify(failure)}`);
        taskResults.push({ ...task, error: normalized });
      }
    }
    const available = taskResults.filter(result => result.body);
    if (!available.length) throw taskResults[0].error;
    const errors = taskResults.filter(result => result.error).map(result => ({
      module: result.module,
      endpoint: result.type === 'time_series' ? 'DescribeSiteTimeSeriesData' : 'DescribeSiteTopData',
      message: result.error.message,
      errorCode: result.error.code,
      requestId: result.error.requestId,
    }));
    const body = name => taskResults.find(result => result.name === name)?.body || {};
    const timeBodies = taskResults.filter(result => result.type === 'time_series' && result.body).map(result => result.body);
    const rows = timeBodies.flatMap(item => item.data || []);
    const findRows = (field, dimension) => rows.filter(item => item.fieldName === field && item.dimensionName === dimension);
    const toPoints = dataRows => {
      const points = new Map();
      dataRows.forEach(item => (item.detailData || []).forEach(point => {
        const timestamp = point.timeStamp || '';
        points.set(timestamp, (points.get(timestamp) || 0) + finiteNumber(point.value));
      }));
      return Array.from(points, ([timestamp, value]) => ({ timestamp, value })).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    };
    const traffic = toPoints(findRows('Traffic', 'ALL'));
    const requests = toPoints(findRows('Requests', 'ALL'));
    const cacheRows = findRows('Requests', 'EdgeCacheStatus');
    const edgeStatusRows = findRows('Requests', 'EdgeResponseStatusCode');
    const originStatusRows = findRows('Requests', 'OriginResponseStatusCode');
    const sumRows = dataRows => dataRows.reduce((total, item) => total + (item.detailData || []).reduce((sum, point) => sum + finiteNumber(point.value), 0), 0);
    const trafficTotal = traffic.reduce((sum, point) => sum + point.value, 0);
    const requestTotal = requests.reduce((sum, point) => sum + point.value, 0);
    const cacheTotal = sumRows(cacheRows);
    const cacheHits = sumRows(cacheRows.filter(item => /hit/i.test(String(item.dimensionValue || '')) && !/miss/i.test(String(item.dimensionValue || ''))));
    const statusRate = (dataRows, prefix) => {
      const total = sumRows(dataRows);
      return total ? sumRows(dataRows.filter(item => String(item.dimensionValue || '').startsWith(prefix))) / total * 100 : 0;
    };
    const interval = finiteNumber(timeBodies.find(item => item.interval)?.interval, finiteNumber(range.interval, 300));
    const trend = mergeAnalyticsSeries({ traffic, requests }).map(point => ({
      ...point,
      bandwidth: point.traffic * 8 / interval,
      qps: point.requests / interval,
    }));
    const summary = {
      traffic: trafficTotal,
      requests: requestTotal,
      peak_bandwidth: Math.max(0, ...trend.map(point => point.bandwidth)),
      peak_qps: Math.max(0, ...trend.map(point => point.qps)),
      cache_hit_rate: cacheTotal ? cacheHits / cacheTotal * 100 : null,
      origin_traffic: null,
      origin_ratio: null,
      error_4xx_rate: statusRate(edgeStatusRows, '4'),
      error_5xx_rate: statusRate(edgeStatusRows, '5'),
      origin_5xx_rate: statusRate(originStatusRows, '5'),
    };
    const rankingRows = (name, limit = 10) => {
      const task = topMetrics.find(item => item.name === name);
      const item = (body('top').data || []).find(row => row.fieldName === task.fieldName && row.dimensionName === task.dimension) || {};
      return (item.detailData || [])
        .map(row => ({ name: String(row.dimensionValue || '--'), value: finiteNumber(row.value) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, limit);
    };
    const data = {
      product: 'esa',
      range: { key: range.range, start_time: range.startTime, end_time: range.endTime, interval },
      summary,
      trend,
      rankings: {
        domains: rankingRows('domains', 10),
        urls: [],
        url_traffic: [],
        regions: rankingRows('regions'),
      },
      url_domains: rankingRows('domains', 100).map(item => item.name).filter(name => name && name !== '--'),
      alerts: buildAnalyticsAlerts(summary),
      errors,
      partial: errors.length > 0,
      update_time: now,
      sampling_rate: finiteNumber(available.map(item => item.body.samplingRate).find(Boolean), 100),
      requestId: available.map(item => item.body.requestId).find(Boolean) || '',
      cached: false,
    };
    return data;
  }

  cdnPoints(body, container, list) {
    return ((((body || {})[container] || {})[list]) || []).map(item => ({
      timestamp: item.timeStamp || '',
      value: finiteNumber(item.value),
      count: finiteNumber(item.accValue),
    })).filter(item => item.timestamp);
  }

  async getCdnTrafficAnalytics(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const { cdn } = this.createClients(account);
    const range = normalizeAnalyticsRange(options);
    const domainName = options.domain_name ? this.normalizeCdnDomainName(options.domain_name) : '';
    const cacheKey = `traffic-analytics:cdn:${accountId}:${domainName || 'all'}:${range.startTime}:${range.endTime}:${range.interval}`;
    const now = Math.floor(Date.now() / 1000);
    if (options.force === true) listCache.delete(cacheKey);
    const cached = listCache.get(cacheKey);
    if (cached && now - cached.time < TRAFFIC_ANALYTICS_TTL) return { ...cached.data, cached: true };
    const request = { domainName: domainName || undefined, startTime: range.startTime, endTime: range.endTime, interval: range.interval };
    const tasks = [
      ['traffic', () => cdn.describeDomainTrafficData(new Cdn.DescribeDomainTrafficDataRequest(request))],
      ['bandwidth', () => cdn.describeDomainBpsData(new Cdn.DescribeDomainBpsDataRequest(request))],
      ['qps', () => cdn.describeDomainQpsData(new Cdn.DescribeDomainQpsDataRequest(request))],
      ['cache', () => cdn.describeDomainReqHitRateData(new Cdn.DescribeDomainReqHitRateDataRequest(request))],
      ['origin', () => cdn.describeDomainSrcTrafficData(new Cdn.DescribeDomainSrcTrafficDataRequest(request))],
      ['edge_status', () => cdn.describeDomainHttpCodeData(new Cdn.DescribeDomainHttpCodeDataRequest(request))],
      ['origin_status', () => cdn.describeDomainSrcHttpCodeData(new Cdn.DescribeDomainSrcHttpCodeDataRequest(request))],
      ...(domainName
        ? [
          ['ranking_urls', () => cdn.describeDomainTopUrlVisit(new Cdn.DescribeDomainTopUrlVisitRequest({ domainName, startTime: range.startTime, endTime: range.endTime, sortBy: 'visit' }))],
          ['ranking_url_traffic', () => cdn.describeDomainTopUrlVisit(new Cdn.DescribeDomainTopUrlVisitRequest({ domainName, startTime: range.startTime, endTime: range.endTime, sortBy: 'traf' }))],
        ]
        : [['ranking_domains', () => cdn.describeTopDomainsByFlow(new Cdn.DescribeTopDomainsByFlowRequest({ startTime: range.startTime, endTime: range.endTime, limit: 10 }))]]),
    ];
    const taskResults = await mapLimit(tasks, 3, async ([name, handler]) => {
      try {
        return { name, body: getBody(await this.request(handler, 'cdn', { retries: READ_RETRY_COUNT })) };
      } catch (error) {
        return { name, error: normalizeError(error, 'cdn') };
      }
    });
    const available = taskResults.filter(item => item.body);
    if (!available.length) throw taskResults[0].error;
    const body = name => taskResults.find(item => item.name === name)?.body || {};
    const errors = taskResults.filter(item => item.error).map(item => ({
      module: item.name,
      message: item.error.message,
      errorCode: item.error.code,
      requestId: item.error.requestId,
    }));
    const traffic = this.cdnPoints(body('traffic'), 'trafficDataPerInterval', 'dataModule');
    const bandwidth = this.cdnPoints(body('bandwidth'), 'bpsDataPerInterval', 'dataModule');
    const qps = this.cdnPoints(body('qps'), 'qpsDataInterval', 'dataModule');
    const cache = this.cdnPoints(body('cache'), 'reqHitRateInterval', 'dataModule');
    const origin = this.cdnPoints(body('origin'), 'srcTrafficDataPerInterval', 'dataModule');
    const edgeStatus = summarizeHttpCodes(((body('edge_status').httpCodeData || {}).usageData) || []);
    const originStatus = summarizeHttpCodes(((body('origin_status').httpCodeData || {}).usageData) || []);
    const sum = points => points.reduce((total, point) => total + point.value, 0);
    const average = points => points.length ? sum(points) / points.length : null;
    const trafficTotal = sum(traffic);
    const originTotal = sum(origin);
    const summary = {
      traffic: trafficTotal,
      requests: qps.reduce((total, point) => total + (point.count || point.value * finiteNumber(range.interval, 300)), 0),
      peak_bandwidth: Math.max(0, ...bandwidth.map(point => point.value)),
      peak_qps: Math.max(0, ...qps.map(point => point.value)),
      cache_hit_rate: average(cache),
      origin_traffic: originTotal,
      origin_ratio: trafficTotal ? originTotal / trafficTotal * 100 : null,
      error_4xx_rate: edgeStatus.error_4xx_rate,
      error_5xx_rate: edgeStatus.error_5xx_rate,
      origin_5xx_rate: originStatus.error_5xx_rate,
    };
    const mapUrlRanking = (name, valueField) => ((((body(name).allUrlList || {}).urlList) || []).map(item => ({
      name: item.urlDetail || '--',
      value: finiteNumber(item[valueField]),
      requests: finiteNumber(item.visitData),
      traffic: finiteNumber(item.flow),
    })).sort((a, b) => b.value - a.value).slice(0, 10));
    const rankings = domainName
      ? {
        domains: [{ name: domainName, value: trafficTotal }],
        urls: mapUrlRanking('ranking_urls', 'visitData'),
        url_traffic: mapUrlRanking('ranking_url_traffic', 'flow'),
        regions: [],
      }
      : {
        domains: ((((body('ranking_domains').topDomains || {}).topDomain) || []).map(item => ({ name: item.domainName || '--', value: finiteNumber(item.totalTraffic), requests: finiteNumber(item.totalAccess), peak_bandwidth: finiteNumber(item.maxBps) }))),
        urls: [],
        url_traffic: [],
        regions: [],
      };
    const data = {
      product: 'cdn',
      domain_name: domainName,
      range: { key: range.range, start_time: range.startTime, end_time: range.endTime, interval: finiteNumber(range.interval, 300) },
      summary,
      trend: mergeAnalyticsSeries({ traffic, bandwidth, qps, cache_hit_rate: cache, origin_traffic: origin }),
      rankings,
      alerts: buildAnalyticsAlerts(summary),
      errors,
      partial: errors.length > 0,
      update_time: now,
      sampling_rate: 100,
      requestId: available.map(item => item.body.requestId).find(Boolean) || '',
      cached: false,
    };
    listCache.set(cacheKey, { time: now, data });
    return data;
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
      body = getBody(await this.request(() => cdn.describeUserDomains(new Cdn.DescribeUserDomainsRequest(request)), 'cdn'));
    } catch (error) {
      if (isCdnNotOpenedError(error)) {
        this.updateResourceCount(accountId, 'cdn_count', 0, 'not_opened');
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
      })), 'cdn')));
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
    })), 'cdn'));
    return { domain_name: domainName, requestId: body.requestId || '' };
  }

  async ensureCdnDomainDeletable(cdn, domainName) {
    const body = getBody(await this.request(() => cdn.describeCdnDomainDetail(new Cdn.DescribeCdnDomainDetailRequest({ domainName })), 'cdn'));
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
    const body = getBody(await this.request(() => cdn.deleteCdnDomain(new Cdn.DeleteCdnDomainRequest({ domainName: normalizedName })), 'cdn'));
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
      const body = getBody(await this.request(() => cdn[method](new Request({ domainNames: names.join(',') })), 'cdn'));
      return { success_count: names.length, failure_count: 0, failures: [], requestId: body.requestId || '' };
    }
    const results = await mapLimit(names, MAX_REGION_CONCURRENCY, async domainName => {
      try {
        await this.ensureCdnDomainDeletable(cdn, domainName);
        await this.request(() => cdn.deleteCdnDomain(new Cdn.DeleteCdnDomainRequest({ domainName })), 'cdn');
        return { domain_name: domainName, success: true };
      } catch (error) {
        const normalized = normalizeError(error, 'cdn');
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
    const body = getBody(await this.request(() => actionTrail.lookupEvents(new ActionTrail.LookupEventsRequest(request)), 'cdn'));
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
    const response = await this.request(() => dns.describeDomainRecords(new AliDns.DescribeDomainRecordsRequest(request)), 'domain');
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
    })), 'domain');
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
    })), 'domain');
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
    const body = getBody(await this.request(() => this.createClients(account).dns.addDomainRecord(new AliDns.AddDomainRecordRequest(record)), 'domain'));
    this.clearAccountCache(accountId);
    return { record_id: body.recordId, requestId: body.requestId || '' };
  }

  async updateRecord(accountId, data) {
    const account = this.getAccount(accountId);
    const record = this.validateRecord(data, true);
    delete record.domainName;
    const body = getBody(await this.request(() => this.createClients(account).dns.updateDomainRecord(new AliDns.UpdateDomainRecordRequest(record)), 'domain'));
    this.clearAccountCache(accountId);
    return { record_id: body.recordId, requestId: body.requestId || '' };
  }

  async deleteRecord(accountId, recordId) {
    const account = this.getAccount(accountId);
    const id = String(recordId || '').trim();
    if (!id) throw new AliyunServiceError('解析记录 ID 不能为空', 'RecordIdRequired');
    const body = getBody(await this.request(() => this.createClients(account).dns.deleteDomainRecord(new AliDns.DeleteDomainRecordRequest({ recordId: id, lang: 'zh' })), 'domain'));
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
    })), 'domain'));
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
        const normalized = normalizeError(error, 'domain');
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
        const normalized = normalizeError(error, 'esa');
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
    })), 'server'));
    const instance = ((instanceBody.instances || {}).instance || [])[0];
    if (!instance) throw new AliyunServiceError('指定 ECS 实例不存在或当前 AccessKey 无权访问', 'InstanceNotFound', instanceBody.requestId);
    if (instance.status !== 'Running') throw new AliyunServiceError('ECS 实例未处于运行状态，无法打开会话终端', 'InstanceNotRunning', instanceBody.requestId);

    const assistantBody = getBody(await this.request(() => ecs.describeCloudAssistantStatus(new Ecs.DescribeCloudAssistantStatusRequest({
      regionId,
      instanceId: [instanceId],
    })), 'server'));
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
    })), 'server'));
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
    })), 'server'));
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
    for (const key of listCache.keys()) {
      if (key.startsWith(`oss-traffic:${accountId}:`)) listCache.delete(key);
      if (key.startsWith(`traffic-analytics:esa:${accountId}:`) || key.startsWith(`esa-url-rankings:${accountId}:`)) listCache.delete(key);
    }
    for (const key of regionCache.keys()) {
      if (key.startsWith(`${accountId}:`)) regionCache.delete(key);
    }
    for (const key of resourceRegionCache.keys()) {
      if (key.startsWith(`${accountId}:`)) resourceRegionCache.delete(key);
    }
  }
}

module.exports = {
  aliyunService: new AliyunService(),
  AliyunServiceError,
  normalizeError,
  SUMMARY_TTL,
};
