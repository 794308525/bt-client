'use strict';

const fs = require('fs');
const path = require('path');
const { pub } = require('../class/public.js');
const { sslService, SslServiceError, normalizeSslError } = require('./ssl.js');
const { aliyunService } = require('./aliyun.js');

const POLL_INTERVAL = 60 * 1000;
const MAX_CONSECUTIVE_RETRIES = 10;
const ACTIVE_STATUSES = ['creating', 'dns_created', 'verifying', 'waiting_issue', 'uploading'];
const FAILED_ORDER_STATUSES = ['failed', 'cancelled', 'canceled', 'revoked', 'expired', 'rejected'];
const TRANSIENT_ERROR_CODES = new Set([
  'InternalException', 'Record.NoResource', 'Record.Reserved', 'Record.ServiceBusy',
  'RequestTimeout', 'ServiceUnavailable', 'Throttling', 'TooManyRequests',
]);
const FATAL_ERROR_CODES = new Set([
  'ChannelNotFound', 'ChannelDisabled', 'ProviderNotSupported', 'SecretKeyRequired',
  'MissingOrderId', 'InvalidOrderId', 'UnsupportedChallengeType',
  'InvalidCertificatePrivateKey', 'DomainNotBelongToSite', 'InvalidSSLPub', 'InvalidSSLPri',
  'CertificateDomainNotMatchSite', 'CertificateNotMatchPrivateKey', 'CertQuotaCheckFailed',
  'NoPermission', 'Forbidden', 'AccessDenied', 'Unauthorized',
  'InvalidAccessKeyId.NotFound', 'SignatureDoesNotMatch', 'SameNameRecordExceedLimit',
]);

class SslDeployService {
  constructor() {
    this.timer = null;
    this.processing = false;
    this.processingTaskIds = new Set();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.processPendingTasks(), POLL_INTERVAL);
    if (this.timer.unref) this.timer.unref();
    setTimeout(() => this.processPendingTasks(), 5000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  log(event, data = {}) {
    try {
      const logDir = path.join(pub.get_data_path(), 'logs');
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
      const logFile = path.join(logDir, 'ssl-deploy.log');
      if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) {
        fs.renameSync(logFile, `${logFile}.1`);
      }
      const allowed = ['task_id', 'account_id', 'site_id', 'order_id', 'domain', 'stage', 'status', 'error_code', 'request_id', 'keys', 'challenge_count', 'certificate_count'];
      const safeData = {};
      allowed.forEach(key => {
        if (data[key] !== undefined && data[key] !== '') safeData[key] = data[key];
      });
      fs.appendFileSync(logFile, `${JSON.stringify({ time: new Date().toISOString(), event, ...safeData })}\n`, { mode: 0o600 });
    } catch (_) {
      // 日志失败不能打断证书部署。
    }
  }

  normalizeDomain(domain, siteName) {
    const site = String(siteName || '').replace(/\s+/g, '').toLowerCase().replace(/^\.+|\.+$/g, '');
    let value = String(domain || '').replace(/\s+/g, '').toLowerCase().replace(/\.$/, '');
    if (!site) throw new SslServiceError('ESA 站点域名不正确', 'InvalidSiteName');
    if (value === '@' || !value) value = site;
    else if (value === '*') value = `*.${site}`;
    else if (value !== site && !value.endsWith(`.${site}`)) value = `${value}.${site}`;
    const bare = value.replace(/^\*\./, '');
    if (bare !== site && !bare.endsWith(`.${site}`)) {
      throw new SslServiceError('申请域名必须属于当前 ESA 站点', 'DomainNotBelongToSite');
    }
    if (!/^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value)) {
      throw new SslServiceError('请输入正确的证书域名', 'InvalidDomain');
    }
    return { domain: value, site };
  }

  normalizeChallenges(source, domain) {
    const list = Array.isArray(source)
      ? source
      : (source && Array.isArray(source.challenge)
          ? source.challenge
          : (source && Array.isArray(source.challenges) ? source.challenges : []));
    return list.map(item => {
      const challengeDomain = String(item.domain || domain || '').replace(/\s+/g, '').toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
      const relativeName = String(item.record_name || item.host_record || '').replace(/\s+/g, '').replace(/\.$/, '');
      const recordName = String(item.host_full || '').replace(/\s+/g, '').replace(/\.$/, '')
        || (relativeName && challengeDomain && relativeName !== challengeDomain && !relativeName.endsWith(`.${challengeDomain}`)
          ? `${relativeName}.${challengeDomain}`
          : relativeName);
      return {
        type: String(item.auth_type || item.type || 'TXT').trim().toUpperCase(),
        record_name: recordName,
        value: String(item.value || item.record_value || '').trim(),
        domain: challengeDomain,
        record_id: '',
      };
    }).filter(item => item.record_name && item.value);
  }

  taskView(task) {
    return {
      task_id: Number(task.task_id),
      account_id: Number(task.account_id),
      site_id: String(task.site_id || ''),
      site_name: task.site_name || '',
      channel_id: Number(task.channel_id),
      provider: task.provider || '',
      order_id: task.order_id || '',
      domain: task.domain || '',
      brand: task.brand || '',
      status: task.status || '',
      esa_certificate_id: task.esa_certificate_id || '',
      last_error: task.last_error || '',
      retry_count: Number(task.retry_count || 0),
      addtime: Number(task.addtime || 0),
      update_time: Number(task.update_time || 0),
    };
  }

  extractCertificateMaterial(content) {
    const certificates = [];
    let privateKey = '';
    const visited = new Set();
    const walk = (value, depth = 0) => {
      if (depth > 5 || value === null || value === undefined) return;
      if (typeof value === 'string') {
        const text = value.trim();
        if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(text)) privateKey ||= text;
        const blocks = text.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
        certificates.push(...blocks.map(item => item.trim()));
        return;
      }
      if (typeof value !== 'object' || visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) value.forEach(item => walk(item, depth + 1));
      else Object.values(value).forEach(item => walk(item, depth + 1));
    };
    walk(content);
    return {
      certificate: Array.from(new Set(certificates)).join('\n'),
      privateKey,
      rootKeys: content && typeof content === 'object' ? Object.keys(content) : [],
      certificateCount: certificates.length,
    };
  }

  listTasks(options = {}) {
    const accountId = Number(options.account_id) || 0;
    const siteId = String(options.site_id || '').trim();
    let rows = pub.M('ssl_deploy_task').where('account_id=?', accountId).order('task_id DESC').select();
    if (siteId) rows = rows.filter(item => String(item.site_id) === siteId);
    return rows.slice(0, 50).map(item => this.taskView(item));
  }

  updateTask(taskId, data) {
    pub.M('ssl_deploy_task').where('task_id=?', Number(taskId)).update({ ...data, update_time: pub.time() });
  }

  async ensureChallengeRecord(task, challenge) {
    if (!['TXT', 'CNAME'].includes(challenge.type)) {
      throw new SslServiceError(`暂不支持自动写入 ${challenge.type} 验证记录`, 'UnsupportedChallengeType');
    }
    const normalizeValue = value => {
      const result = String(value || '').trim().replace(/\.$/, '');
      return ['CNAME', 'NS', 'MX', 'SRV'].includes(challenge.type) ? result.toLowerCase() : result;
    };
    const findExisting = async () => {
      const existing = await aliyunService.listEsaRecords(task.account_id, {
        site_id: task.site_id,
        page: 1,
        page_size: 500,
        keyword: challenge.record_name,
        type: challenge.type,
      });
      const exactRecords = existing.data.filter(item =>
        String(item.record_name).toLowerCase() === challenge.record_name.toLowerCase() &&
        String(item.type).toUpperCase() === challenge.type &&
        normalizeValue(item.value) === normalizeValue(challenge.value)
      );
      const savedRecordId = String(challenge.record_id || '');
      return exactRecords.find(item => String(item.record_id) === savedRecordId) || exactRecords[0];
    };
    const matched = await findExisting();
    if (matched) return matched.record_id;
    challenge.record_id = '';
    try {
      const result = await aliyunService.addEsaRecord(task.account_id, {
        site_id: task.site_id,
        site_name: task.site_name,
        record_name: challenge.record_name,
        type: challenge.type,
        value: challenge.value,
        ttl: 300,
        proxied: false,
        dns_only: true,
        comment: 'SSL 自动验证',
      });
      return result.record_id;
    } catch (error) {
      // 另一个任务可能刚创建了同一条验证记录，再查一次后直接复用。
      const code = String(error && error.code || '');
      if (['Record.RecordNameConflictWithSameRecordType', 'Record.Conflict'].includes(code)) {
        const concurrentRecord = await findExisting();
        if (concurrentRecord) return concurrentRecord.record_id;
      }
      throw error;
    }
  }

  isFatalError(error) {
    const code = String(error && error.code || '');
    if (TRANSIENT_ERROR_CODES.has(code) || /^(?:Throttling|TooManyRequests)(?:\.|$)/.test(code) ||
      /^HTTP_5\d\d$/.test(code) || ['HTTP_408', 'HTTP_425', 'HTTP_429'].includes(code)) return false;
    if (FATAL_ERROR_CODES.has(code)) return true;
    return /^HTTP_4\d\d$/.test(code) ||
      /(?:AccessDenied|Forbidden|NoPermission|Unauthorized|NotFound)/i.test(code) ||
      /^(?:InvalidParameter\.|QuotaExceed\.)/.test(code) ||
      (code.startsWith('Record.') && !TRANSIENT_ERROR_CODES.has(code));
  }

  async ensureTaskChallenges(task, suppliedChallenges) {
    let challenges = suppliedChallenges || [];
    if (!challenges.length) {
      try { challenges = JSON.parse(task.challenge_json || '[]'); } catch (_) { challenges = []; }
    }
    if (!challenges.length) {
      const challengeResult = await sslService.getChallenge(task.channel_id, task.order_id);
      challenges = this.normalizeChallenges(challengeResult, task.domain);
      this.log('challenge_response', {
        task_id: task.task_id,
        account_id: task.account_id,
        site_id: task.site_id,
        order_id: task.order_id,
        domain: task.domain,
        stage: 'challenge',
        keys: Object.keys(challengeResult || {}),
        challenge_count: challenges.length,
      });
    }
    if (!challenges.length) throw new SslServiceError('证书渠道暂未返回 DNS 验证记录，请稍后重试', 'MissingDnsChallenge');
    this.updateTask(task.task_id, { order_id: task.order_id, challenge_json: JSON.stringify(challenges) });
    const recordIds = [];
    for (const challenge of challenges) {
      challenge.record_id = await this.ensureChallengeRecord(task, challenge);
      recordIds.push(challenge.record_id);
      this.updateTask(task.task_id, {
        challenge_json: JSON.stringify(challenges),
        challenge_record_ids: JSON.stringify(recordIds),
      });
    }
    return challenges;
  }

  async createTask(data = {}) {
    const accountId = Number(data.account_id) || 0;
    const siteId = String(data.site_id || '').trim();
    const channelId = Number(data.channel_id) || 0;
    if (!accountId || !siteId || !channelId) throw new SslServiceError('证书申请参数不完整', 'InvalidDeployTask');
    const normalized = this.normalizeDomain(data.domain, data.site_name);
    const channel = sslService.getChannel(channelId);
    const now = pub.time();
    const duplicateTask = pub.M('ssl_deploy_task').where(
      'account_id=? AND site_id=? AND domain=? AND status IN (?,?,?,?,?)',
      [accountId, siteId, normalized.domain, ...ACTIVE_STATUSES],
    )
      .order('task_id DESC').find();
    if (duplicateTask) {
      throw new SslServiceError('该域名已有正在执行的证书申请，请勿重复提交', 'DeployTaskAlreadyRunning');
    }
    const taskId = pub.M('ssl_deploy_task').insert({
      account_id: accountId,
      site_id: siteId,
      site_name: normalized.site,
      channel_id: channelId,
      provider: channel.provider,
      order_id: '',
      domain: normalized.domain,
      brand: String(data.brand || '').trim(),
      status: 'creating',
      challenge_json: '[]',
      challenge_record_ids: '[]',
      esa_certificate_id: '',
      last_error: '',
      retry_count: 0,
      next_check_time: now,
      addtime: now,
      update_time: now,
    });
    const task = pub.M('ssl_deploy_task').where('task_id=?', taskId).find();
    try {
      const created = await sslService.createCertificate(channelId, {
        domain: normalized.domain,
        brand: data.brand,
        validate: 'dns',
        days: data.days,
      });
      const orderId = String(created && (created.order_id || created.orderId) || '').trim();
      if (!orderId) throw new SslServiceError('证书渠道未返回订单号', 'MissingOrderId');
      task.order_id = orderId;
      this.updateTask(taskId, { order_id: orderId, status: 'creating', next_check_time: now + 60 });
      let challenges = this.normalizeChallenges(created, normalized.domain);
      challenges = await this.ensureTaskChallenges(task, challenges);
      this.updateTask(taskId, {
        order_id: orderId,
        status: 'dns_created',
        challenge_json: JSON.stringify(challenges),
        last_error: '',
        next_check_time: now + 30,
      });
      this.log('dns_created', { task_id: taskId, account_id: accountId, site_id: siteId, order_id: orderId, domain: normalized.domain, stage: 'dns', status: 'dns_created', challenge_count: challenges.length });
      try {
        await sslService.verifyCertificate(channelId, orderId);
        this.updateTask(taskId, { status: 'waiting_issue', next_check_time: now + 30 });
      } catch (error) {
        const normalizedError = normalizeSslError(error);
        this.updateTask(taskId, { status: 'verifying', last_error: normalizedError.message, next_check_time: now + 60 });
      }
      return this.taskView(pub.M('ssl_deploy_task').where('task_id=?', taskId).find());
    } catch (error) {
      const normalizedError = error && error.name === 'AliyunServiceError' ? error : normalizeSslError(error);
      const canResume = Boolean(task.order_id);
      const fatal = !canResume || this.isFatalError(normalizedError);
      this.updateTask(taskId, {
        order_id: task.order_id || '',
        status: fatal ? 'failed' : 'creating',
        last_error: normalizedError.message,
        retry_count: 1,
        next_check_time: fatal ? 0 : now + 60,
      });
      this.log('create_failed', { task_id: taskId, account_id: accountId, site_id: siteId, order_id: task.order_id, domain: normalized.domain, stage: 'create', status: fatal ? 'failed' : 'retrying', error_code: normalizedError.code, request_id: normalizedError.requestId });
      throw normalizedError;
    }
  }

  async retryTask(taskId) {
    const task = pub.M('ssl_deploy_task').where('task_id=?', Number(taskId) || 0).find();
    if (!task) throw new SslServiceError('证书部署任务不存在', 'DeployTaskNotFound');
    if (task.status === 'completed') return this.taskView(task);
    if (this.processingTaskIds.has(Number(task.task_id))) {
      throw new SslServiceError('证书部署任务正在执行，请稍后刷新', 'DeployTaskBusy');
    }
    this.updateTask(task.task_id, { status: task.order_id ? 'waiting_issue' : 'failed', last_error: '', retry_count: 0, next_check_time: pub.time() });
    if (task.order_id) await this.processTask({ ...task, status: 'waiting_issue', next_check_time: 0 });
    return this.taskView(pub.M('ssl_deploy_task').where('task_id=?', task.task_id).find());
  }

  async processTask(task) {
    const taskId = Number(task.task_id);
    if (this.processingTaskIds.has(taskId)) return;
    this.processingTaskIds.add(taskId);
    const now = pub.time();
    try {
      if (!task.order_id) throw new SslServiceError('任务缺少证书订单号，请重新申请', 'MissingOrderId');
      const detail = await sslService.getCertificateDetail(task.channel_id, task.order_id);
      const orderStatus = String(detail && detail.status || '').trim().toLowerCase();
      this.log('order_checked', { task_id: task.task_id, account_id: task.account_id, site_id: task.site_id, order_id: task.order_id, domain: task.domain, stage: 'poll', status: orderStatus, keys: Object.keys(detail || {}) });
      if (FAILED_ORDER_STATUSES.includes(orderStatus)) {
        this.updateTask(task.task_id, { status: 'failed', last_error: String(detail.message || `证书申请已${orderStatus}`), next_check_time: 0 });
        return;
      }
      if (!['issued', 'completed', 'success'].includes(orderStatus)) {
        await this.ensureTaskChallenges(task);
        try { await sslService.verifyCertificate(task.channel_id, task.order_id); } catch (_) {}
        this.updateTask(task.task_id, { status: 'waiting_issue', last_error: '', retry_count: 0, next_check_time: now + 60 });
        return;
      }
      this.updateTask(task.task_id, { status: 'uploading', last_error: '', next_check_time: now + 300 });
      const content = await sslService.getCertificateContent(task.channel_id, task.order_id);
      const material = this.extractCertificateMaterial(content);
      const certificate = material.certificate;
      const privateKey = material.privateKey;
      this.log('certificate_material', {
        task_id: task.task_id,
        account_id: task.account_id,
        site_id: task.site_id,
        order_id: task.order_id,
        domain: task.domain,
        stage: 'certificate',
        keys: material.rootKeys,
        certificate_count: material.certificateCount,
        status: privateKey ? 'private_key_found' : 'private_key_missing',
      });
      if (!certificate || !privateKey) throw new SslServiceError('证书渠道返回的证书或私钥不完整', 'InvalidCertificateContent');
      const result = await aliyunService.uploadEsaCertificate(task.account_id, {
        site_id: task.site_id,
        name: `${task.domain}-${task.order_id}`.slice(0, 128),
        certificate,
        private_key: privateKey,
      });
      this.updateTask(task.task_id, { status: 'completed', esa_certificate_id: result.certificate_id, last_error: '', retry_count: 0, next_check_time: 0 });
      this.log('completed', { task_id: task.task_id, account_id: task.account_id, site_id: task.site_id, order_id: task.order_id, domain: task.domain, stage: 'upload', status: 'completed', request_id: result.requestId });
    } catch (error) {
      const normalizedError = error && error.name === 'AliyunServiceError' ? error : normalizeSslError(error);
      if (normalizedError.code === 'Certificate.Duplicated') {
        this.updateTask(task.task_id, { status: 'completed', last_error: '', retry_count: 0, next_check_time: 0 });
        this.log('already_uploaded', { task_id: task.task_id, account_id: task.account_id, site_id: task.site_id, order_id: task.order_id, domain: task.domain, stage: 'upload', status: 'completed', error_code: normalizedError.code, request_id: normalizedError.requestId });
        return;
      }
      const retryCount = Number(task.retry_count || 0) + 1;
      const retryLimitReached = retryCount >= MAX_CONSECUTIVE_RETRIES;
      const fatal = this.isFatalError(normalizedError) || retryLimitReached;
      const lastError = retryLimitReached
        ? `${normalizedError.message}（已连续重试 ${retryCount} 次，请检查后手动重试）`
        : normalizedError.message;
      this.updateTask(task.task_id, {
        status: fatal ? 'failed' : (task.status === 'uploading' ? 'uploading' : 'waiting_issue'),
        last_error: lastError,
        retry_count: retryCount,
        next_check_time: fatal ? 0 : now + Math.min(900, 60 * Math.max(1, retryCount)),
      });
      this.log('process_error', { task_id: task.task_id, account_id: task.account_id, site_id: task.site_id, order_id: task.order_id, domain: task.domain, stage: task.status, status: fatal ? 'failed' : 'retrying', error_code: normalizedError.code, request_id: normalizedError.requestId });
    } finally {
      this.processingTaskIds.delete(taskId);
    }
  }

  async processPendingTasks() {
    if (this.processing || !global.password_hash) return;
    this.processing = true;
    try {
      const now = pub.time();
      const tasks = pub.M('ssl_deploy_task').order('task_id ASC').select()
        .filter(item => ACTIVE_STATUSES.includes(item.status) && Number(item.next_check_time || 0) <= now);
      for (const task of tasks) await this.processTask(task);
    } finally {
      this.processing = false;
    }
  }
}

const sslDeployService = new SslDeployService();

module.exports = { sslDeployService };
