'use strict';

const net = require('net');
const https = require('https');
const { createHash } = require('crypto');
const { SocksProxyAgent } = require('socks-proxy-agent');
const Ecs = require('@alicloud/ecs20140526');
const Swas = require('@alicloud/swas-open20200601');

function inCidr(address, cidr) {
  try {
    const [base, suffix] = String(cidr).split('/');
    const version = net.isIP(base);
    if (!version) return null;
    if (version !== net.isIP(address)) return false;
    const bits = suffix === undefined ? version === 4 ? 32 : 128 : Number(suffix);
    if (!Number.isInteger(bits) || bits < 0 || bits > (version === 4 ? 32 : 128)) return null;
    const block = new net.BlockList();
    block.addSubnet(base, bits, version === 4 ? 'ipv4' : 'ipv6');
    return block.check(address, version === 4 ? 'ipv4' : 'ipv6');
  } catch { return null; }
}

function portMatches(range, port) {
  if (range === '-1/-1' || range === 'all') return true;
  const parts = String(range || '').split(/[/-]/).map(Number);
  if (!parts.length || parts.length > 2 || parts.some(value => !Number.isInteger(value) || value < 1 || value > 65535) || parts.length === 2 && parts[0] > parts[1]) return null;
  return port >= parts[0] && port <= (parts[1] || parts[0]);
}

function evaluateRules(rows, source, destination, port) {
  const matches = [];
  let unknown = false;
  for (const rule of rows) {
    if (rule.direction && rule.direction !== 'ingress') continue;
    const protocol = String(rule.ipProtocol || rule.ruleProtocol || '').toLowerCase();
    if (!protocol) { unknown = true; continue; }
    if (!['tcp', 'all', '6', 'tcp+udp'].includes(protocol)) continue;
    const ports = protocol === 'all' ? true : portMatches(rule.portRange || rule.port, port);
    if (ports === false) continue;
    if (rule.destCidrIp) {
      const dest = inCidr(destination, rule.destCidrIp);
      if (dest === false) continue;
      if (dest === null) { unknown = true; continue; }
    }
    if (rule.ipv6DestCidrIp || rule.ipv6SourceCidrIp) continue;
    if (ports === null || rule.sourcePrefixListId || rule.sourceGroupId || rule.destPrefixListId || rule.destGroupId || rule.portRangeListId || rule.sourcePortRange && !['1/65535', '-1/-1'].includes(rule.sourcePortRange)) { unknown = true; continue; }
    const match = inCidr(source, rule.sourceCidrIp || '');
    if (match === false) continue;
    if (match === null || !rule.sourceCidrIp) { unknown = true; continue; }
    const policy = String(rule.policy || '').toLowerCase();
    if (!['accept', 'drop'].includes(policy) || !Number.isInteger(Number(rule.priority || 1)) || Number(rule.priority || 1) < 1 || Number(rule.priority || 1) > 100) { unknown = true; continue; }
    matches.push({ ...rule, policy, rank: Number(rule.priority || 1) });
  }
  if (unknown) return { state: 'unknown', message: '包含前缀列表、端口列表、源安全组或其他复杂规则，无法可靠判断，请到控制台核对。' };
  matches.sort((a, b) => a.rank - b.rank || (a.policy === b.policy ? 0 : a.policy === 'drop' ? -1 : 1));
  const first = matches[0];
  return first ? { state: first.policy === 'accept' ? 'allowed' : 'denied', message: first.policy === 'accept' ? '云端规则已放行当前来源，请检查服务器 SSH 服务、系统防火墙和网络。' : '当前流量命中拒绝规则；不会自动覆盖拒绝策略。', matched_rule: first.securityGroupRuleId || first.ruleId || '' }
    : { state: 'missing', message: '未找到允许当前出口 IP 访问此 TCP 端口的规则。' };
}

function publicIpv4(ip) {
  return net.isIP(ip) === 4 && !['0.0.0.0/8', '10.0.0.0/8', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '224.0.0.0/4', '240.0.0.0/4'].some(range => inCidr(ip, range));
}

function echoIp(proxy) {
  let agent;
  if (proxy) {
    const url = new URL(`socks5h://${net.isIP(proxy.host) === 6 ? `[${proxy.host}]` : proxy.host}:${proxy.port}`);
    if (proxy.userId) url.username = proxy.userId;
    if (proxy.password) url.password = proxy.password;
    agent = new SocksProxyAgent(url);
  }
  return new Promise((resolve, reject) => {
    // 与 SSH 使用同一 SOCKS5 配置。仅查询出口 IP，不发送账号、实例或凭证。
    const request = https.get('https://api.ipify.org', { family: 4, agent, timeout: 7000 }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; if (data.length > 100) response.destroy(new Error('出口 IP 返回异常')); });
      response.on('error', reject);
      response.on('end', () => response.statusCode === 200 && publicIpv4(data.trim()) ? resolve(data.trim()) : reject(new Error('无法取得有效公网出口 IP')));
    });
    request.on('timeout', () => request.destroy(new Error('获取出口 IP 超时')));
    request.on('error', reject);
  }).finally(() => { if (agent) agent.destroy(); });
}

function responseBody(response) {
  const body = response && response.body;
  if (!body || body.success === false) throw new Error('阿里云网络接口返回失败');
  return body;
}

class AliyunSshNetwork {
  constructor(service) { this.service = service; }

  async rules(account, target) {
    if (target.source === 'swas') {
      const client = this.service.createSwasClient(account, target.region_id);
      const rows = [];
      let total;
      for (let page = 1; page <= 20; page++) {
        const body = responseBody(await this.service.request(() => client.listFirewallRules(new Swas.ListFirewallRulesRequest({ regionId: target.region_id, instanceId: target.instance_id, pageNumber: page, pageSize: 100 }))));
        if (!Array.isArray(body.firewallRules) || !Number.isInteger(body.totalCount)) throw new Error('防火墙规则未完整返回');
        if (total !== undefined && total !== body.totalCount) throw new Error('查询期间防火墙规则发生变化');
        total = body.totalCount;
        rows.push(...body.firewallRules);
        if (rows.length === total) return { rows, groups: [{ id: target.instance_id, name: '当前轻量服务器防火墙', effect: '仅此实例' }], destination: target.host };
        if (!body.firewallRules.length || rows.length > total) break;
      }
      throw new Error('防火墙规则分页不完整');
    }
    const { ecs } = this.service.createClients(account, target.region_id);
    const instance = target.raw;
    const interfaces = (instance.networkInterfaces || {}).networkInterface || [];
    const primary = interfaces.find(item => String(item.type).toLowerCase() === 'primary');
    const destination = primary && primary.primaryIpAddress || ((instance.vpcAttributes || {}).privateIpAddress || {}).ipAddress?.[0];
    const ids = (instance.securityGroupIds || {}).securityGroupId || [];
    if (instance.instanceNetworkType !== 'vpc' || !destination || !ids.length) throw new Error('无法可靠确定目标网卡；当前仅支持 VPC 主网卡的安全组诊断');
    const groups = [];
    const rows = [];
    for (const id of ids) {
      let nextToken;
      const seen = new Set();
      for (let page = 0; page < 20; page++) {
        const body = responseBody(await this.service.request(() => ecs.describeSecurityGroupAttribute(new Ecs.DescribeSecurityGroupAttributeRequest({ regionId: target.region_id, securityGroupId: id, direction: 'ingress', nicType: 'intranet', maxResults: 100, nextToken }))));
        const permissions = body.permissions && body.permissions.permission;
        if (!Array.isArray(permissions)) throw new Error('安全组规则未完整返回');
        if (!nextToken) groups.push({ id, name: body.securityGroupName || id, effect: `仅目标内网地址 ${destination}/32（通过目的地址限制）` });
        rows.push(...permissions.map(rule => ({ ...rule, group_id: id })));
        nextToken = body.nextToken;
        if (!nextToken) break;
        if (seen.has(nextToken) || page === 19) throw new Error('安全组分页异常，请刷新重试');
        seen.add(nextToken);
      }
    }
    return { rows, groups, destination };
  }

  async inspect(account, target, config) {
    if (!publicIpv4(config.host)) return { state: 'unknown', message: '当前连接为内网或 IPv6 地址，无法可靠确定实际来源；请手动检查云端规则和路由。', groups: [] };
    const source = await echoIp(config.proxy);
    const snapshot = await this.rules(account, target);
    const result = evaluateRules(snapshot.rows, source, snapshot.destination, config.port);
    return { ...result, source_ip: source, groups: snapshot.groups, port: config.port, destination: snapshot.destination, fingerprint: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') };
  }

  async authorize(account, target, plan, groupId, scope, token) {
    const source = scope === 'self' ? `${plan.source_ip}/32` : '0.0.0.0/0';
    if (!['self', 'any'].includes(scope) || !plan.groups.some(group => group.id === groupId)) throw new Error('授权范围或安全组不正确');
    if (target.source === 'swas') {
      const client = this.service.createSwasClient(account, target.region_id);
      const body = responseBody(await this.service.request(() => client.createFirewallRules(new Swas.CreateFirewallRulesRequest({ regionId: target.region_id, instanceId: target.instance_id, clientToken: token, firewallRules: [{ ruleProtocol: 'TCP', port: `${plan.port}/${plan.port}`, sourceCidrIp: source, remark: 'bt-client SSH 用户确认放行' }] }))));
      return { source, group_id: groupId, rule_ids: body.firewallRuleIds || [] };
    }
    const { ecs } = this.service.createClients(account, target.region_id);
    const body = responseBody(await this.service.request(() => ecs.authorizeSecurityGroup(new Ecs.AuthorizeSecurityGroupRequest({ regionId: target.region_id, securityGroupId: groupId, clientToken: token, permissions: [{ ipProtocol: 'TCP', portRange: `${plan.port}/${plan.port}`, sourceCidrIp: source, destCidrIp: `${plan.destination}/32`, policy: 'accept', priority: '100', nicType: 'intranet', description: 'bt-client SSH 用户确认放行' }] }))));
    return { source, group_id: groupId, rule_ids: (body.securityGroupRuleIds || {}).securityGroupRuleId || [] };
  }
}

module.exports = { AliyunSshNetwork, evaluateRules, inCidr, portMatches, publicIpv4, echoIp };
