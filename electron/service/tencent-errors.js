'use strict';

function resourceStatus(code = '', message = '', httpCode = 0) {
  // 业务错误必须先于公共前缀判断，例如 CDN 停服、限频都可能使用 UnauthorizedOperation。
  if (/CdnUserNotExists$/.test(code)) return 'not_opened';
  if (/CdnUserIsSuspended$|AccountIsolated|ServiceIsolated/.test(code)) return 'disabled';
  if (/ProductUpdating$|ProductUpgraded$/.test(code)) return 'migrated';
  if (/CdnUserAuthWait$|NotRealNamed|UnrealName/.test(code)) return 'verification_required';
  if (/RequestLimitExceeded|OperationTooOften|SlowDown/.test(code)) return 'rate_limited';
  if (/LimitExceeded|QuotaExceeded/.test(code)) return 'quota_exceeded';
  if (/UnauthorizedOperation|AccessDenied|NoPermission|Forbidden/.test(code)) return 'permission_denied';
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|AuthFailure\.(SecretIdNotFound|SignatureFailure|InvalidSecretId|TokenFailure)/.test(code)) return 'invalid_credentials';
  if (/RequestTimeTooSkewed|AuthFailure\.(SignatureExpire|InvalidAuthorization)/.test(code)) return 'authentication_error';
  if (/ServiceNotOpened|ServiceNotActivated|UserNotSubscribed/.test(code)) return 'not_opened';
  if (/UnsupportedOperation|UnsupportedRegion/.test(code)) return 'unsupported';
  const statusCode = Number(httpCode || (/^\d{3}$/.test(code) ? code : 0));
  if (statusCode === 408) return 'timeout';
  if (statusCode === 429) return 'rate_limited';
  if (statusCode >= 500 && statusCode <= 599) return 'unavailable';
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(`${code} ${message}`)) return 'timeout';
  if (/^(ENOTFOUND|ECONN[A-Z_]*|EAI_AGAIN)$/i.test(code) || /\b(?:ENOTFOUND|ECONN[A-Z_]*|EAI_AGAIN)\b|network|fetch failed/i.test(message)) return 'network';
  if (/InternalError|ServiceUnavailable/.test(code)) return 'unavailable';
  return 'error';
}

function errorOf(error, account) {
  const code = String(error && (error.code || error.Code) || 'TencentCloudError').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 120);
  let message = String(error && (error.message || error.Message) || '腾讯云请求失败');
  for (const value of account ? [account.secret_id, account.secret_key] : []) {
    if (value) message = message.split(value).join('[已隐藏]');
  }
  message = message.replace(/AKID[a-zA-Z0-9]+/g, '[已隐藏]').replace(/[\r\n<>]/g, ' ').slice(0, 600);
  const httpCode = Number(error && (error.httpCode || error.statusCode));
  const status = error && error.resource_status || resourceStatus(code, message, httpCode);
  const translations = {
    invalid_credentials: '密钥无效或签名校验失败，请检查账号站点及 SecretId、SecretKey',
    authentication_error: '请求认证失败，请检查系统时间、账号站点和凭据状态',
    permission_denied: '当前密钥无权执行此操作，请检查对应产品及资源的 CAM 授权',
    not_opened: '当前账号尚未开通此服务', disabled: '服务已停用或隔离，请检查账号及套餐状态',
    migrated: '此资源正在迁移或已升级至 EdgeOne，请前往 EdgeOne 管理',
    verification_required: '账号尚未完成产品要求的认证，请在腾讯云控制台处理',
    rate_limited: '接口请求过于频繁，请稍后重试', quota_exceeded: '当前资源或操作已达到配额上限',
    timeout: '腾讯云请求超时，请稍后刷新确认结果', network: '腾讯云网络连接异常，请检查网络后重试',
  };
  const result = new Error(translations[status] || message);
  result.code = code;
  if (Number.isInteger(httpCode) && httpCode >= 100 && httpCode <= 599) result.httpCode = httpCode;
  result.resource_status = status;
  result.requestId = String(error && (error.requestId || error.RequestId || error.headers && error.headers['x-cos-request-id']) || '').slice(0, 120);
  result.action = String(error && error.action || '').slice(0, 100);
  return result;
}

function parseSummary(value) {
  try {
    const data = typeof value === 'string' ? JSON.parse(value) : value;
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch (_) { return {}; }
}

module.exports = { errorOf, resourceStatus, parseSummary };
