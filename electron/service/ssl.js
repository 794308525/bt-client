'use strict';

const request = require('request');
const { pub } = require('../class/public.js');

const PROVIDERS = {
  xinssl: {
    name: 'xinssl',
    website: 'https://xinssl.com/',
    baseUrl: 'https://xinssl.com/api/open/v1',
    authType: 'bearer',
  },
};

class SslServiceError extends Error {
  constructor(message, code = 'SslServiceError', detail = '') {
    super(message);
    this.name = 'SslServiceError';
    this.code = code;
    this.detail = String(detail || '').slice(0, 2000);
  }
}

function normalizeSslError(error) {
  if (error instanceof SslServiceError) return error;
  const code = String(error && (error.code || error.name) || 'SslServiceError');
  const sourceMessage = String(error && error.message || '证书渠道接口请求失败');
  const lower = `${code} ${sourceMessage}`.toLowerCase();
  let message = sourceMessage;
  if (lower.includes('timeout')) message = '连接证书渠道超时，请稍后重试';
  else if (lower.includes('econn') || lower.includes('enotfound') || lower.includes('network')) message = '无法连接证书渠道，请检查网络';
  return new SslServiceError(message, code, sourceMessage);
}

function maskSecret(value) {
  const secret = String(value || '');
  if (!secret) return '';
  if (secret.length <= 10) return `${secret.slice(0, 2)}****${secret.slice(-2)}`;
  return `${secret.slice(0, 6)}****${secret.slice(-4)}`;
}

class SslService {
  listProviders() {
    return Object.entries(PROVIDERS).map(([provider, config]) => ({
      provider,
      name: config.name,
      website: config.website,
      auth_type: config.authType,
    }));
  }

  safeChannel(channel) {
    return {
      channel_id: Number(channel.channel_id),
      provider: channel.provider,
      channel_name: channel.channel_name,
      enabled: Number(channel.enabled) === 1,
      status: channel.status || 'unknown',
      secret_masked: maskSecret(channel.secret_key),
      has_secret: Boolean(channel.secret_key),
      website: (PROVIDERS[channel.provider] || {}).website || '',
      last_check_time: Number(channel.last_check_time || 0),
      last_error: channel.last_error || '',
      addtime: Number(channel.addtime || 0),
      update_time: Number(channel.update_time || 0),
    };
  }

  listChannels(enabledOnly = false) {
    let channels = pub.M('ssl_channel').order('channel_id ASC').select();
    if (enabledOnly) channels = channels.filter(item => Number(item.enabled) === 1);
    return channels.map(item => this.safeChannel(item));
  }

  getChannel(channelId, requireEnabled = true) {
    const channel = pub.M('ssl_channel').where('channel_id=?', Number(channelId) || 0).find();
    if (!channel) throw new SslServiceError('指定证书渠道不存在', 'ChannelNotFound');
    if (requireEnabled && Number(channel.enabled) !== 1) throw new SslServiceError('该证书渠道已停用', 'ChannelDisabled');
    if (!PROVIDERS[channel.provider]) throw new SslServiceError('暂不支持该证书渠道', 'ProviderNotSupported');
    if (!channel.secret_key) throw new SslServiceError('请先配置渠道 SecretKey', 'SecretKeyRequired');
    return channel;
  }

  saveChannel(data = {}) {
    const channelId = Number(data.channel_id) || 0;
    const provider = String(data.provider || 'xinssl').trim().toLowerCase();
    const config = PROVIDERS[provider];
    if (!config) throw new SslServiceError('暂不支持该证书渠道', 'ProviderNotSupported');
    const channelName = String(data.channel_name || config.name).trim();
    const secretKey = String(data.secret_key || '').trim();
    if (!channelName) throw new SslServiceError('渠道名称不能为空', 'ChannelNameRequired');
    if (channelName.length > 40) throw new SslServiceError('渠道名称不能超过 40 个字符', 'ChannelNameTooLong');
    if (!channelId && !secretKey) throw new SslServiceError('SecretKey 不能为空', 'SecretKeyRequired');
    const now = pub.time();
    if (channelId) {
      if (!pub.M('ssl_channel').where('channel_id=?', channelId).find()) throw new SslServiceError('指定证书渠道不存在', 'ChannelNotFound');
      const update = { provider, channel_name: channelName, enabled: data.enabled === false ? 0 : 1, update_time: now };
      if (secretKey) update.secret_key = secretKey;
      pub.M('ssl_channel').where('channel_id=?', channelId).update(update);
      return channelId;
    }
    return pub.M('ssl_channel').insert({
      provider,
      channel_name: channelName,
      secret_key: secretKey,
      enabled: data.enabled === false ? 0 : 1,
      status: 'unknown',
      last_check_time: 0,
      last_error: '',
      addtime: now,
      update_time: now,
    });
  }

  removeChannel(channelId) {
    const id = Number(channelId) || 0;
    if (!pub.M('ssl_channel').where('channel_id=?', id).find()) throw new SslServiceError('指定证书渠道不存在', 'ChannelNotFound');
    return pub.M('ssl_channel').where('channel_id=?', id).delete();
  }

  async call(channel, method, pathname, options = {}) {
    const config = PROVIDERS[channel.provider];
    const url = new URL(pathname.replace(/^\//, ''), `${config.baseUrl}/`);
    if (url.origin !== 'https://xinssl.com' || !url.pathname.startsWith('/api/open/v1/')) {
      throw new SslServiceError('证书渠道接口地址不正确', 'InvalidProviderEndpoint');
    }
    return new Promise((resolve, reject) => {
      request({
        method,
        url: url.toString(),
        headers: {
          Authorization: `Bearer ${channel.secret_key}`,
          Accept: options.binary ? 'application/octet-stream' : 'application/json',
          'User-Agent': 'BT-Client/SSL',
        },
        qs: options.qs,
        body: options.body,
        json: !options.binary,
        encoding: options.binary ? null : undefined,
        timeout: 30000,
        rejectUnauthorized: true,
      }, (error, response, body) => {
        if (error) return reject(normalizeSslError(error));
        const statusCode = Number(response && response.statusCode || 0);
        if (statusCode < 200 || statusCode >= 300) {
          const apiMessage = body && typeof body === 'object' ? (body.detail || body.message) : String(body || '');
          const message = statusCode === 401 || statusCode === 403
            ? 'SecretKey 无效或无权访问'
            : (apiMessage || `证书渠道返回 HTTP ${statusCode}`);
          return reject(new SslServiceError(message, `HTTP_${statusCode}`, apiMessage));
        }
        if (options.binary) return resolve({ data: body, headers: response.headers || {} });
        if (!body || typeof body !== 'object') return reject(new SslServiceError('证书渠道返回数据格式不正确', 'InvalidProviderResponse'));
        if (Number(body.code) !== 0) return reject(new SslServiceError(body.message || body.detail || '证书渠道操作失败', String(body.code || 'ProviderError'), body.detail || ''));
        resolve(body.data);
      });
    });
  }

  async testChannel(channelId) {
    const channel = this.getChannel(channelId, false);
    try {
      const meta = await this.call(channel, 'GET', 'meta');
      pub.M('ssl_channel').where('channel_id=?', channel.channel_id).update({ status: 'online', last_check_time: pub.time(), last_error: '' });
      return { channel: this.safeChannel({ ...channel, status: 'online', last_check_time: pub.time(), last_error: '' }), meta };
    } catch (error) {
      const normalized = normalizeSslError(error);
      pub.M('ssl_channel').where('channel_id=?', channel.channel_id).update({ status: 'error', last_check_time: pub.time(), last_error: normalized.message });
      throw normalized;
    }
  }

  async getMeta(channelId) {
    return this.call(this.getChannel(channelId), 'GET', 'meta');
  }

  async listCertificates(channelId, options = {}) {
    const channel = this.getChannel(channelId);
    const data = await this.call(channel, 'GET', 'ssl/orders', { qs: {
      page: Math.max(1, Number(options.page) || 1),
      page_size: Math.min(100, Math.max(1, Number(options.page_size) || 20)),
    } });
    return { ...data, channel_id: channel.channel_id, channel_name: channel.channel_name, provider: channel.provider };
  }

  async createCertificate(channelId, data = {}) {
    const domain = String(data.domain || '').trim().toLowerCase();
    if (!/^(\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(domain)) throw new SslServiceError('请输入正确的域名', 'InvalidDomain');
    const brand = String(data.brand || '').trim();
    const validate = String(data.validate || '').trim();
    if (!brand || !validate) throw new SslServiceError('请选择 CA 品牌和验证方式', 'InvalidCertificateOptions');
    return this.call(this.getChannel(channelId), 'POST', 'ssl/orders', { body: {
      brand,
      domain,
      validate,
      days: Math.max(1, Number(data.days) || 90),
    } });
  }

  normalizeOrderId(orderId) {
    const value = String(orderId || '').trim();
    if (!/^[a-zA-Z0-9_-]{6,100}$/.test(value)) throw new SslServiceError('证书订单号不正确', 'InvalidOrderId');
    return value;
  }

  getCertificateDetail(channelId, orderId) {
    return this.call(this.getChannel(channelId), 'GET', `ssl/orders/${encodeURIComponent(this.normalizeOrderId(orderId))}`);
  }

  getChallenge(channelId, orderId) {
    return this.call(this.getChannel(channelId), 'GET', `ssl/orders/${encodeURIComponent(this.normalizeOrderId(orderId))}/challenge`);
  }

  verifyCertificate(channelId, orderId) {
    return this.call(this.getChannel(channelId), 'POST', `ssl/orders/${encodeURIComponent(this.normalizeOrderId(orderId))}/verify`);
  }

  getCertificateContent(channelId, orderId) {
    return this.call(this.getChannel(channelId), 'GET', `ssl/orders/${encodeURIComponent(this.normalizeOrderId(orderId))}/certificate`);
  }

  downloadCertificate(channelId, orderId) {
    return this.call(this.getChannel(channelId), 'GET', `ssl/orders/${encodeURIComponent(this.normalizeOrderId(orderId))}/download`, { binary: true });
  }

  cancelCertificate(channelId, orderId) {
    return this.call(this.getChannel(channelId), 'POST', `ssl/orders/${encodeURIComponent(this.normalizeOrderId(orderId))}/cancel`);
  }

  deleteCertificate(channelId, orderId) {
    return this.call(this.getChannel(channelId), 'DELETE', `ssl/orders/${encodeURIComponent(this.normalizeOrderId(orderId))}`);
  }
}

const sslService = new SslService();

module.exports = { sslService, SslServiceError, normalizeSslError };
