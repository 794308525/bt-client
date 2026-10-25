'use strict';

const { createHash } = require('crypto');

function protocolRules(host) {
  const suffix = createHash('sha256').update(host).digest('hex').slice(0, 24);
  return {
    httpsName: `hy-protocol-${suffix}`,
    redirectName: `hy-http-redirect-${suffix}`,
    hostRule: `(http.host eq "${host}")`,
    redirectRule: `(http.host eq "${host}" and http.request.scheme eq "https")`,
    targetUrl: `concat("http://${host}", http.request.uri.path)`,
  };
}

const active = item => item.ruleEnable !== 'off';
const global = item => item.configType === 'global' || !item.rule && !item.ruleName;
const canonical = rule => String(rule || '').replace(/\s+/g, '').replace(/^\((.*)\)$/, '$1');
const sameRule = (left, right) => canonical(left) === canonical(right);

// 只识别明确的单域名条件；无法确定作用范围的表达式保守地视为可能匹配。
function mayMatchHost(rule, host) {
  const match = canonical(rule).match(/^http\.hosteq"([a-z0-9.-]+)"(?:andhttp\.request\.schemeeq"(?:http|https)")?$/i);
  return !match || match[1].toLowerCase() === host;
}

function ownedRules(host, context) {
  const names = protocolRules(host);
  const https = context.application.filter(item => item.ruleName === names.httpsName);
  const redirects = context.redirects.filter(item => item.ruleName === names.redirectName);
  const altered = https.length > 1 || redirects.length > 1
    || https.some(item => !sameRule(item.rule, names.hostRule) || !['on', 'off'].includes(item.httpsForce))
    || redirects.some(item => !sameRule(item.rule, names.redirectRule) || item.type !== 'dynamic' || item.targetUrl !== names.targetUrl || item.reserveQueryString !== 'on');
  return { https: https[0], redirect: redirects[0], altered };
}

function protocolState(host, context) {
  const state = { mode: '', read_only: false, notice: '', inherited: false, hsts: false, https_enabled: null };
  const blocked = notice => ({ ...state, read_only: true, notice });
  if (host.startsWith('*.')) return blocked('泛域名记录请在阿里云控制台配置协议规则');
  if (context.version_managed) return blocked('该站点已启用版本管理，请在阿里云控制台选择目标环境配置');
  const own = ownedRules(host, context);
  if (own.altered) return blocked('此域名的协议规则已被自定义修改，请先在阿里云控制台核对');
  const foreignHttps = context.application.filter(item => !global(item) && active(item) && item !== own.https && ['on', 'off'].includes(item.httpsForce) && mayMatchHost(item.rule, host));
  const foreignRedirect = context.redirects.filter(item => active(item) && item.targetUrl && item !== own.redirect && mayMatchHost(item.rule, host));
  if (foreignHttps.length || foreignRedirect.length) return blocked('此域名可能命中其他 HTTPS 或重定向规则，请在阿里云控制台核对');
  const globals = context.application.filter(global);
  if (globals.length > 1) return blocked('存在多条全局 HTTPS 配置，请先核对');
  const hostHttps = own.https && active(own.https) ? own.https : null;
  const forceHttps = (hostHttps?.httpsForce || globals[0]?.httpsForce) === 'on';
  const reverse = own.redirect && active(own.redirect);
  if (forceHttps && reverse) return blocked('域名同时存在两个方向的跳转规则，请先在阿里云控制台解除冲突');
  state.mode = reverse ? 'http' : forceHttps ? 'https' : 'original';
  state.inherited = !hostHttps && !reverse;
  state.hsts = context.application.some(item => active(item) && item.hsts === 'on' && (global(item) || mayMatchHost(item.rule, host)));
  const basicRules = context.basic.filter(item => !global(item) && active(item)).sort((a, b) => Number(a.sequence || 0) - Number(b.sequence || 0));
  const basic = basicRules.find(item => mayMatchHost(item.rule, host)) || context.basic.find(global);
  if (basic && (global(basic) || sameRule(basic.rule, protocolRules(host).hostRule))) state.https_enabled = basic.https === 'on';
  state.notice = state.inherited ? '当前继承站点配置；更改后仅对该域名生效' : '该域名的同名解析记录共享此配置';
  if (state.hsts) state.notice += '；存在 HSTS，不能切换为 HTTPS → HTTP';
  state.notice += '；原样不撤销源站跳转或浏览器已缓存的 HSTS';
  return state;
}

module.exports = { protocolRules, protocolState, ownedRules, sameRule };
