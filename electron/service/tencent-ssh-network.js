'use strict';

const { createHash } = require('crypto');
const { inCidr, publicIpv4, echoIp } = require('./aliyun-ssh-network');

function portMatches(value, port) {
  if (String(value).toLowerCase() === 'all') return true;
  const ranges = String(value || '').split(',').map(part => part.trim().split('-').map(Number));
  if (!ranges.length || ranges.some(parts => !parts.length || parts.length > 2 || parts.some(n => !Number.isInteger(n) || n < 1 || n > 65535) || parts.length === 2 && parts[0] > parts[1])) return null;
  return ranges.some(parts => port >= parts[0] && port <= (parts[1] ?? parts[0]));
}

function evaluateRules(snapshot, source, port) {
  if (snapshot.unsupported) return { state: 'unknown', message: snapshot.unsupported };
  const matches = [];
  for (const rule of snapshot.rows) {
    if (rule.Ipv6CidrBlock) continue;
    if ([rule.ServiceTemplate, rule.AddressTemplate].some(value => value && Object.values(value).some(Boolean)) || rule.SecurityGroupId) {
      return { state: 'unknown', message: '包含地址模板、协议模板或源安全组，请在腾讯云控制台核对规则。' };
    }
    const protocol = String(rule.Protocol || '').toUpperCase();
    if (!protocol) return { state: 'unknown', message: '规则协议未完整返回，请在腾讯云控制台核对。' };
    if (!['TCP', 'ALL', '6'].includes(protocol)) continue;
    const ports = protocol === 'ALL' ? true : portMatches(rule.Port, port);
    if (ports === false) continue;
    const cidr = rule.CidrBlock || (snapshot.source === 'lighthouse' ? '0.0.0.0/0' : '');
    const address = inCidr(source, cidr);
    if (address === false) continue;
    const action = String(rule.Action || (snapshot.source === 'lighthouse' ? 'ACCEPT' : '')).toUpperCase();
    if (ports === null || address === null || !['ACCEPT', 'DROP'].includes(action)) return { state: 'unknown', message: '规则来源、端口或策略无法可靠识别，请在腾讯云控制台核对。' };
    matches.push({ ...rule, action });
  }
  let first;
  if (snapshot.source === 'cvm') {
    if (snapshot.rows.some(rule => !Number.isInteger(rule.PolicyIndex) || rule.PolicyIndex < 0) || new Set(snapshot.rows.map(rule => rule.PolicyIndex)).size !== snapshot.rows.length) return { state: 'unknown', message: '安全组规则顺序未完整返回，请在腾讯云控制台核对。' };
    first = matches.sort((a, b) => a.PolicyIndex - b.PolicyIndex)[0];
  } else {
    // 轻量返回的规则不含优先级；重叠的允许 / 拒绝规则交由用户在控制台核对。
    if (new Set(matches.map(rule => rule.action)).size > 1) return { state: 'unknown', message: '此端口同时匹配允许和拒绝规则，请在腾讯云控制台核对，不会覆盖现有策略。' };
    first = matches[0];
  }
  if (!first) return { state: 'missing', message: '未找到允许当前出口 IP 访问此 TCP 端口的规则。' };
  return { state: first.action === 'ACCEPT' ? 'allowed' : 'denied', message: first.action === 'ACCEPT'
    ? '云端规则已放行当前来源，请检查服务器 SSH 服务、系统防火墙和网络。'
    : '当前流量命中拒绝规则，请在腾讯云控制台核对；不会自动覆盖拒绝策略。' };
}

class TencentSshNetwork {
  constructor(service, options = {}) { this.service = service; this.echoIp = options.echoIp || echoIp; }

  async rules(account, target) {
    if (target.source === 'lighthouse') {
      const rows = [];
      let total, version;
      for (let offset = 0; offset < 2000; offset += 100) {
        const body = await this.service.request(account, 'lighthouse', 'DescribeFirewallRules', { InstanceId: target.instance_id, Offset: offset, Limit: 100 }, target.region_id);
        if (!Array.isArray(body.FirewallRuleSet) || !Number.isInteger(body.TotalCount) || body.TotalCount < 0 || !Number.isInteger(body.FirewallVersion) || body.FirewallVersion < 0) throw new Error('轻量防火墙规则未完整返回');
        if (total !== undefined && (total !== body.TotalCount || version !== body.FirewallVersion)) throw new Error('查询期间防火墙规则发生变化，请重新检查');
        total = body.TotalCount; version = body.FirewallVersion;
        rows.push(...body.FirewallRuleSet.map(rule => ({ ...rule, group_id: target.instance_id })));
        if (rows.length === total) return { source: target.source, rows, version, destination: target.host, groups: [{ id: target.instance_id, name: '当前轻量服务器防火墙', effect: '仅此实例' }] };
        if (!body.FirewallRuleSet.length || rows.length > total) break;
      }
      throw new Error('轻量防火墙分页不完整，请重新检查');
    }
    const ids = target.raw.SecurityGroupIds;
    if (!Array.isArray(ids) || !ids.length || ids.some(value => !/^sg-[a-zA-Z0-9]+$/.test(value))) throw new Error('无法确定实例绑定的安全组，请在腾讯云控制台核对');
    const groups = ids.map(id => ({ id, name: id, effect: '此安全组关联的所有实例均受影响，不限于当前服务器' }));
    if (ids.length !== 1) return { source: target.source, rows: [], groups, destination: target.host, unsupported: '实例绑定了多个安全组，需结合绑定顺序判断。请在腾讯云控制台检查 SSH 端口，不自动修改共享规则。' };
    const body = await this.service.request(account, 'vpc', 'DescribeSecurityGroupPolicies', { SecurityGroupId: ids[0] }, target.region_id);
    const policies = body.SecurityGroupPolicySet;
    if (!policies || !Array.isArray(policies.Ingress) || policies.Version == null || !/^\d+$/.test(String(policies.Version))) throw new Error('安全组规则或版本未完整返回');
    return { source: target.source, rows: policies.Ingress.map(rule => ({ ...rule, group_id: ids[0] })), groups, version: String(policies.Version), destination: target.host };
  }

  async inspect(account, target, config) {
    if (!publicIpv4(config.host) || !target.public_ips.includes(config.host)) return { state: 'unknown', message: '当前连接为内网或 IPv6 地址，无法可靠确定实际来源，请手动检查云端规则和路由。', groups: [] };
    const source = await this.echoIp(config.proxy);
    const snapshot = await this.rules(account, target);
    return { ...evaluateRules(snapshot, source, config.port), source_ip: source, port: config.port, groups: snapshot.groups, version: snapshot.version,
      destination: snapshot.destination, fingerprint: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
  }

  async authorize(account, target, plan, groupId, scope, token) {
    if (!['self', 'any'].includes(scope) || !plan.groups.some(group => group.id === groupId) || !publicIpv4(plan.source_ip) || !Number.isInteger(plan.port) || plan.port < 1 || plan.port > 65535) throw new Error('授权来源、端口或规则位置不正确');
    const source = scope === 'self' ? `${plan.source_ip}/32` : '0.0.0.0/0';
    const description = `bt-client SSH ${String(token).slice(0, 20)}`;
    let result;
    if (target.source === 'lighthouse') {
      if (groupId !== target.instance_id || !Number.isInteger(plan.version)) throw new Error('轻量防火墙确认已失效');
      result = await this.service.request(account, 'lighthouse', 'CreateFirewallRules', { InstanceId: target.instance_id, FirewallVersion: plan.version,
        FirewallRules: [{ Protocol: 'TCP', Port: String(plan.port), CidrBlock: source, Action: 'ACCEPT', FirewallRuleDescription: description }] }, target.region_id, true);
    } else {
      if (target.raw.SecurityGroupIds?.length !== 1 || target.raw.SecurityGroupIds[0] !== groupId || !/^\d+$/.test(String(plan.version))) throw new Error('安全组确认已失效');
      // 追加规则并携带版本，不覆盖、不重排其他规则；写请求不会自动重试。
      result = await this.service.request(account, 'vpc', 'CreateSecurityGroupPolicies', { SecurityGroupId: groupId,
        SecurityGroupPolicySet: { Version: String(plan.version), Ingress: [{ Protocol: 'TCP', Port: String(plan.port), CidrBlock: source, Action: 'ACCEPT', PolicyDescription: description }] } }, target.region_id, true);
    }
    return { source, group_id: groupId, rule_ids: [], description, request_id: result.RequestId || '' };
  }

  verifyGrant(snapshot, plan, groupId, grant) {
    const added = snapshot.rows.filter(rule => rule.group_id === groupId && String(rule.Protocol).toUpperCase() === 'TCP'
      && rule.Port === String(plan.port) && rule.CidrBlock === grant.source && String(rule.Action).toUpperCase() === 'ACCEPT'
      && (rule.PolicyDescription || rule.FirewallRuleDescription) === grant.description);
    const result = evaluateRules(snapshot, plan.source_ip, plan.port);
    return { ...result, state: added.length ? result.state : 'unknown', rule_ids: added.map(rule => snapshot.source === 'cvm'
      ? `${groupId} 入站索引 ${rule.PolicyIndex}（${grant.description}）` : `${groupId} TCP/${plan.port}（${grant.description}）`) };
  }
}

module.exports = { TencentSshNetwork, evaluateRules, portMatches };
