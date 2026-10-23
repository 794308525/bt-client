'use strict';

const net = require('net');
const { randomBytes } = require('crypto');
const Ecs = require('@alicloud/ecs20140526');
const Swas = require('@alicloud/swas-open20200601');
const { pub } = require('../class/public');
const { aliyunService, normalizeError } = require('./aliyun');
const { CloudSshSession } = require('./cloud-ssh-session');
const { AliyunSshNetwork, evaluateRules } = require('./aliyun-ssh-network');

const id = () => randomBytes(24).toString('hex');

class ServerSshService {
  constructor(service = aliyunService, options = {}) {
    this.service = service;
    this.Session = options.Session || CloudSshSession;
    this.network = options.network || new AliyunSshNetwork(service);
    this.db = options.db || (table => pub.M(table));
    this.credentialTable = options.credentialTable || 'aliyun_ssh_credential';
    this.sources = options.sources || ['ecs', 'swas'];
    this.provider = options.provider || 'aliyun';
    this.providerName = options.providerName || '阿里云';
    this.normalizeError = options.normalizeError || normalizeError;
    this.jobs = new Map();
    this.owners = new Set();
    this.sessions = new Set();
    this.cleanupTimer = setInterval(() => {
      for (const [key, job] of this.jobs) if (Date.now() - job.time > 5 * 60000 && !job.busy) this.cancel(job.owner, key);
    }, 30000);
    this.cleanupTimer.unref?.();
  }

  scope(job) { return [job.account_id, job.source, job.region_id, job.instance_id]; }
  credentialQuery(job) { return this.db(this.credentialTable).where('account_id=? and source=? and region_id=? and instance_id=?', this.scope(job)); }
  get(owner, jobId) {
    const job = this.jobs.get(String(jobId));
    if (!job || job.owner !== owner || Date.now() - job.time > 5 * 60000) throw new Error('连接请求已失效，请重新点击终端');
    job.time = Date.now();
    return job;
  }
  check(job, generation) { if (this.jobs.get(job.id) !== job || job.generation !== generation) throw Object.assign(new Error('连接操作已取消'), { kind: 'cancelled' }); }

  async target(job) {
    const account = this.service.getAccount(job.account_id);
    let server, raw;
    if (job.source === 'ecs') {
      const { ecs } = this.service.createClients(account, job.region_id);
      const response = await this.service.request(() => ecs.describeInstances(new Ecs.DescribeInstancesRequest({ regionId: job.region_id, instanceIds: JSON.stringify([job.instance_id]), pageSize: 10, pageNumber: 1 })));
      raw = response.body?.instances?.instance?.find(item => item.instanceId === job.instance_id);
      if (raw) server = this.service.normalizeEcsInstance(raw, job.region_id);
    } else {
      const swas = this.service.createSwasClient(account, job.region_id);
      const response = await this.service.request(() => swas.listInstances(new Swas.ListInstancesRequest({ regionId: job.region_id, instanceIds: JSON.stringify([job.instance_id]), pageSize: 100, pageNumber: 1 })));
      raw = response.body?.instances?.find(item => item.instanceId === job.instance_id);
      if (raw) server = this.service.normalizeSwasInstance(raw, job.region_id);
    }
    if (!server) throw new Error('实例不存在、已释放或当前账号无权读取');
    if (String(server.os_type).toLowerCase() === 'windows') throw new Error('Windows 实例请使用 RDP 或 Workbench，本流程用于 Linux SSH');
    if (String(server.status).toLowerCase() !== 'running') throw new Error('实例未运行，无法建立 SSH 连接');
    return { ...server, raw, addresses: [...new Set([...server.public_ips, ...server.private_ips])].filter(value => net.isIP(value)) };
  }

  async prepare(sender, args) {
    if (!this.sources.includes(args.source) || !/^[a-z0-9-]{2,50}$/.test(args.region_id || '') || !/^[\w-]{2,128}$/.test(args.instance_id || '')) throw new Error('服务器参数不正确');
    if (this.jobs.size >= 20) throw new Error('待连接请求过多，请关闭其他连接窗口后重试');
    const job = { id: id(), owner: sender.id, account_id: Number(args.account_id), source: args.source, region_id: args.region_id, instance_id: args.instance_id, generation: 0, time: Date.now(), state: 'preparing' };
    this.jobs.set(job.id, job);
    if (!this.owners.has(sender.id)) {
      this.owners.add(sender.id);
      sender.once('destroyed', () => { for (const [key, value] of this.jobs) if (value.owner === sender.id) this.cancel(sender.id, key); for (const session of this.sessions) if (session.owner === sender.id) session.disconnect(); this.owners.delete(sender.id); });
    }
    try {
      const target = await this.target(job);
      this.check(job, 0);
      if (!target.addresses.length) throw new Error('实例没有可连接 IP，请先配置公网地址或可达的内网通道');
      job.target = target;
      job.saved = this.credentialQuery(job).find();
      const candidates = this.db('ssh_info').where(`host in (${target.addresses.map(() => '?').join(',')})`, target.addresses).limit(20).select().filter(item => item.os_type !== 'Windows');
      job.candidates = new Map(candidates.map(item => [`ssh:${item.ssh_id}`, item]));
      const proxies = this.db('proxy_info').select().filter(item => Number(item.proxy_type) === 2).map(item => ({ id: item.proxy_id, name: item.proxy_name || item.proxy_ip }));
      const saved = job.saved;
      const usable = saved && ![saved.username, saved.password, saved.private_key].some(value => String(value || '').startsWith('BTx:'));
      const savedHost = usable && target.addresses.includes(saved.host) ? saved.host : target.public_ips[0] || target.addresses[0];
      job.state = 'credentials';
      return { job_id: job.id, name: target.name, addresses: target.addresses, proxies, credentials: [ ...(usable ? [{ id: 'saved', name: '此实例上次成功的凭证', username: saved.username, port: saved.port, host: savedHost, auth_type: saved.auth_type, proxy_id: saved.proxy_id }] : []), ...candidates.map(item => ({ id: `ssh:${item.ssh_id}`, name: `本地 SSH：${item.title || item.host}`, username: item.username, port: item.port, host: item.host, auth_type: item.auth_type, proxy_id: item.proxy_id })) ], defaults: { host: savedHost, port: usable ? saved.port : 22, username: usable ? saved.username : 'root', auth_type: usable ? saved.auth_type : 0, proxy_id: usable ? saved.proxy_id : 0, credential_id: usable ? 'saved' : '' } };
    } catch (error) { this.cancel(sender.id, job.id); throw error; }
  }

  config(job, args) {
    const base = args.credential_id === 'saved' ? job.saved : job.candidates.get(String(args.credential_id));
    if (args.credential_id && !base) throw new Error('所选本地凭证已失效');
    const config = { ...base, host: String(args.host || ''), port: Number(args.port), username: String(args.username || '').trim(), auth_type: Number(base ? base.auth_type : args.auth_type), proxy_id: Number(args.proxy_id) || 0 };
    if (!base) { config.password = String(args.password || ''); config.private_key = String(args.private_key || ''); config.key_password = String(args.key_password || ''); config.host_fingerprint = ''; }
    else if (args.key_password) config.key_password = String(args.key_password);
    if (!job.target.addresses.includes(config.host) || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || !/^[a-zA-Z0-9_.@-]{1,64}$/.test(config.username)) throw new Error('连接地址、端口或用户名不正确');
    if (![0, 1].includes(config.auth_type) || !(config.auth_type === 1 ? config.private_key : config.password)) throw new Error('请填写密码或 SSH 私钥');
    if (String(config.password || '').startsWith('BTx:') || String(config.private_key || '').startsWith('BTx:')) throw new Error('本地凭证尚未解锁，请解锁应用后重试');
    if (String(config.private_key || '').length > 65536 || String(config.password || '').length > 4096 || String(config.key_password || '').length > 4096) throw new Error('凭证内容过长');
    if (config.proxy_id) {
      const proxy = this.db('proxy_info').where('proxy_id=?', config.proxy_id).find();
      if (!proxy || Number(proxy.proxy_type) !== 2) throw new Error('所选 SOCKS5 代理不存在');
      if ([proxy.proxy_username, proxy.proxy_password].some(value => String(value || '').startsWith('BTx:'))) throw new Error('本地代理凭证尚未解锁');
      config.proxy = { host: proxy.proxy_ip, port: Number(proxy.proxy_port), type: 5, userId: proxy.proxy_username || undefined, password: proxy.proxy_password || undefined };
    } else config.proxy = undefined;
    return config;
  }

  save(job) {
    const table = this.credentialQuery(job);
    if (table.getAesKey().length !== 16) { table.close?.(); throw new Error('应用加密密钥不可用，凭证未保存，本次连接仍可继续'); }
    const previous = table.find();
    const c = job.config;
    const record = { account_id: job.account_id, source: job.source, region_id: job.region_id, instance_id: job.instance_id, host: c.host, port: c.port, username: c.username, auth_type: c.auth_type, password: c.auth_type === 0 ? c.password : '', private_key: c.auth_type === 1 ? c.private_key : '', key_password: c.auth_type === 1 ? c.key_password || '' : '', host_fingerprint: c.host_fingerprint, proxy_id: c.proxy_id, update_time: Math.floor(Date.now() / 1000) };
    const result = previous ? this.credentialQuery(job).update(record) : this.db(this.credentialTable).insert(record);
    if (!result) throw new Error('凭证保存失败，本次连接仍可继续');
  }

  async connect(owner, args) {
    const job = this.get(owner, args.job_id);
    if (job.busy) throw new Error('连接操作正在进行，请稍候');
    job.busy = true;
    const generation = ++job.generation;
    job.plan = null;
    try {
      if (job.session) job.session.disconnect();
      job.target = await this.target(job);
      this.check(job, generation);
      if (!args.reuse_attempt) job.config = this.config(job, args);
      if (!job.config || !job.target.addresses.includes(job.config.host)) throw new Error('实例地址已变化，请重新输入连接信息');
      if (args.accept_fingerprint === true) {
        if (!args.reuse_attempt || job.state !== 'failed' || job.failure !== 'fingerprint' || !job.offeredFingerprint) throw new Error('主机指纹确认已失效');
        job.config.host_fingerprint = job.offeredFingerprint;
      }
      job.offeredFingerprint = '';
      job.save = args.save === true;
      const session = job.session = new this.Session();
      session.owner = owner;
      this.sessions.add(session);
      session.onClose = () => this.sessions.delete(session);
      job.state = 'connecting';
      await session.connect(job.config);
      this.check(job, generation);
      if (session.closed) throw new Error('终端在完成连接前关闭，请重试');
      let saveError = '';
      if (job.save) { try { this.save(job); } catch (error) { saveError = error.message; } }
      job.state = 'ready';
      job.ticket = id();
      return { state: 'ready', ticket: job.ticket, save_error: saveError, host: job.config.host, username: job.config.username, title: job.target.name, transport: 'cloud-ssh', cloud_provider: this.provider, os_type: 'Linux', grant: job.grant };
    } catch (error) {
      this.check(job, generation);
      if (job.session) job.session.disconnect();
      job.state = 'failed';
      job.failure = error.kind || 'error';
      if (error.fingerprint) job.offeredFingerprint = error.fingerprint;
      return { state: 'failed', kind: job.failure, message: error.kind ? error.message : this.normalizeError(error).message, fingerprint: error.fingerprint || '', fingerprint_changed: !!error.changed, grant: job.grant };
    } finally { job.busy = false; }
  }

  async diagnose(owner, args) {
    const job = this.get(owner, args.job_id);
    if (job.busy || job.state !== 'failed' || job.failure !== 'network') throw new Error('仅网络连接失败时可检查安全组');
    job.busy = true;
    const generation = job.generation;
    try {
      job.target = await this.target(job);
      this.check(job, generation);
      if (!job.target.addresses.includes(job.config.host)) throw new Error('实例地址已变化，请重新连接');
      const result = await this.network.inspect(this.service.getAccount(job.account_id), { ...job.target, host: job.config.host }, job.config);
      this.check(job, generation);
      const token = id();
      job.plan = result.state === 'missing' ? { ...result, id: token, time: Date.now() } : null;
      return { ...result, fingerprint: undefined, plan_id: job.plan ? token : '', grant: job.grant };
    } finally { job.busy = false; }
  }

  async authorize(owner, args) {
    const job = this.get(owner, args.job_id);
    const plan = job.plan;
    if (job.busy || args.confirmed !== true || !plan || plan.id !== args.plan_id || Date.now() - plan.time > 3 * 60000 || !['self', 'any'].includes(args.scope)) throw new Error('授权确认已失效，请重新检查安全组');
    job.busy = true;
    const generation = job.generation;
    job.plan = null;
    try {
      job.target = await this.target(job);
      this.check(job, generation);
      if (!job.target.addresses.includes(job.config.host)) throw new Error('实例地址已变化，请重新确认');
      const account = this.service.getAccount(job.account_id);
      const target = { ...job.target, host: job.config.host };
      const fresh = await this.network.inspect(account, target, job.config);
      this.check(job, generation);
      if (fresh.fingerprint !== plan.fingerprint || fresh.source_ip !== plan.source_ip || fresh.state !== 'missing') throw new Error('来源 IP 或云端规则已变化，请重新检查并确认');
      const grant = await this.network.authorize(account, target, plan, args.group_id, args.scope, plan.id);
      job.grant = { ...grant, port: job.config.port };
      pub.write_log(1, `${this.providerName} SSH 放行：${job.instance_id} TCP/${job.config.port} 来源 ${grant.source} 规则 ${grant.rule_ids.join(',') || '请在控制台核对'}`);
      this.check(job, generation);
      let verified = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt) await new Promise(resolve => setTimeout(resolve, 1000));
        this.check(job, generation);
        const snapshot = await this.network.rules(account, target);
        this.check(job, generation);
        const verify = this.network.verifyGrant
          ? this.network.verifyGrant(snapshot, plan, args.group_id, job.grant)
          : evaluateRules(snapshot.rows, plan.source_ip, snapshot.destination, job.config.port);
        if (verify.rule_ids) job.grant.rule_ids = verify.rule_ids;
        else if (!job.grant.rule_ids.length) job.grant.rule_ids = snapshot.rows.filter(rule => rule.group_id === args.group_id && rule.sourceCidrIp === job.grant.source && rule.destCidrIp === `${plan.destination}/32` && rule.portRange === `${job.config.port}/${job.config.port}` && String(rule.policy).toLowerCase() === 'accept' && rule.description === 'bt-client SSH 用户确认放行').map(rule => rule.securityGroupRuleId).filter(Boolean);
        if (verify.state === 'allowed') { verified = true; break; }
        if (verify.state !== 'missing') break;
      }
      if (job.grant.rule_ids.length) pub.write_log(1, `${this.providerName} SSH 放行规则回查：${job.instance_id} ${job.grant.rule_ids.join(',')}`);
      if (!verified) throw new Error('授权请求已提交，但回查尚未确认生效。请稍后重新检查；不会重复添加规则。');
      return { state: 'authorized', grant: job.grant, message: '规则已回查，等待 3 秒后重试连接。可在云控制台删除本次新增规则恢复原策略。' };
    } catch (error) {
      this.check(job, generation);
      return { state: 'uncertain', grant: job.grant, message: `${this.normalizeError(error).message}。请重新检查规则，暂不重复提交授权。` };
    } finally { job.busy = false; }
  }

  consume(owner, ticket, channel, sender) {
    const job = [...this.jobs.values()].find(item => item.owner === owner && item.ticket === ticket && item.state === 'ready' && Date.now() - item.time <= 5 * 60000);
    if (!job) throw new Error('终端连接凭证已失效，请重新连接');
    job.ticket = '';
    const session = job.session;
    session.attach(channel, sender);
    this.jobs.delete(job.id);
    job.config = null;
    return session;
  }

  cancel(owner, jobId) {
    const job = this.jobs.get(String(jobId));
    if (!job || job.owner !== owner) return;
    job.generation++;
    if (job.session) job.session.disconnect();
    job.config = null;
    this.jobs.delete(job.id);
  }
  cancelAccount(accountId) { for (const job of this.jobs.values()) if (job.account_id === accountId) this.cancel(job.owner, job.id); }
  stopAll() { for (const job of this.jobs.values()) this.cancel(job.owner, job.id); for (const session of this.sessions) session.disconnect(); }
}

module.exports = { serverSshService: new ServerSshService(), ServerSshService };
