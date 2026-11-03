'use strict';

const { domainToASCII } = require('url');

function integer(value, label, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label}不正确`);
  return number;
}
function text(value, label, max = 1024) {
  const result = String(value == null ? '' : value).trim();
  if (!result || result.length > max || /[\x00-\x1f]/.test(result)) throw new Error(`${label}不正确`);
  return result;
}
function domain(value, wildcard = false) {
  const input = text(value, '域名', 253);
  const prefix = wildcard && input.startsWith('*.') ? '*.' : '';
  const result = domainToASCII(prefix ? input.slice(2) : input).toLowerCase();
  if (!result.includes('.') || result.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new Error('域名格式不正确');
  return prefix + result;
}
function zoneId(value) {
  const id = String(value || '');
  if (!/^zone-[a-zA-Z0-9]{1,64}$/.test(id)) throw new Error('EdgeOne 站点 ID 不正确');
  return id;
}
function page(data = {}, size = 20) {
  return { Offset: (integer(data.page || 1, '页码', 1, 100000) - 1) * size, Limit: size };
}
function listResult(result, field, totalField) {
  const total = Number(result[totalField]);
  const rows = total === 0 && result[field] == null ? [] : result[field];
  if (!Array.isArray(rows) || !Number.isSafeInteger(total) || total < 0) throw new Error('腾讯云资源列表返回格式无效，请刷新重试');
  return { data: rows, total };
}
function stripNulls(value) {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null).map(([key, item]) => [key, stripNulls(item)]));
  return value;
}
function recentRange(days = 1) {
  const end = new Date();
  return { StartTime: new Date(end.getTime() - days * 86400000).toISOString(), EndTime: end.toISOString() };
}

module.exports = { integer, text, domain, zoneId, page, listResult, stripNulls, recentRange };
