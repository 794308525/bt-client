'use strict';

const https = require('https');
const { pub } = require('../class/public.js');

const HOST = 'api.cloudflare.com';
const TIMEOUT = 15000;
const MAX_BODY_SIZE = 1024 * 1024;

function safeError(error) {
  const message = String(error && error.message || 'Cloudflare 请求失败')
    .replace(/[\r\n]/g, ' ')
    .replace(/Bearer\s+\S+/ig, 'Bearer [redacted]')
    .replace(/(api[_ -]?token|authorization)[=:]\s*[^\s,;&]+/ig, '$1=[redacted]')
    .slice(0, 180);
  return new Error(message || 'Cloudflare 请求失败');
}

function normalizePage(value, fallback = 1) {
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : fallback;
}

function normalizePageSize(value, fallback = 20) {
  const size = Number(value);
  return Number.isInteger(size) && size >= 5 && size <= 50 ? size : fallback;
}

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      if (error) reject(safeError(error));
      else resolve(result);
    };
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = https.request({ hostname: HOST, path, method, timeout: TIMEOUT,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
      } }, res => {
      let body = '';
      let bodySize = 0;
      res.once('error', error => finish(error));
      res.once('aborted', () => finish(new Error('Cloudflare 响应连接中断')));
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (settled) return;
        bodySize += Buffer.byteLength(chunk);
        if (bodySize > MAX_BODY_SIZE) {
          const error = new Error('Cloudflare 返回数据过大');
          finish(error);
          req.destroy(error);
          return;
        }
        body += chunk;
      });
      res.on('end', () => {
        if (settled) return;
        let parsed;
        try { parsed = JSON.parse(body || '{}'); } catch (_) { return finish(new Error('Cloudflare 返回数据格式错误')); }
        if (res.statusCode < 200 || res.statusCode >= 300 || parsed.success !== true) {
          const first = Array.isArray(parsed.errors) ? parsed.errors[0] : null;
          const err = new Error(first && first.message ? first.message : `Cloudflare 请求失败（${res.statusCode}）`);
          err.status = res.statusCode;
          return finish(err);
        }
        finish(null, { result: parsed.result, resultInfo: parsed.result_info || {} });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Cloudflare 请求超时')));
    req.on('error', error => finish(error));
    req.end(payload || undefined);
  });
}

class CloudflareService {
  getAccount(accountId) {
    const account = pub.M('cloudflare_account').where('account_id=?', Number(accountId) || 0).find();
    if (!account) throw new Error('指定 Cloudflare 账号不存在');
    return account;
  }

  safeAccount(account) {
    if (!account) return account;
    const { api_token: _token, ...safe } = account;
    return safe;
  }

  async verifyToken(token) {
    if (!token) throw new Error('API Token 不能为空');
    return request('GET', '/client/v4/zones?per_page=5&page=1', token);
  }

  async listZones(accountId, options = {}) {
    const account = this.getAccount(accountId);
    const page = normalizePage(options.page);
    const perPage = normalizePageSize(options.per_page);
    const query = new URLSearchParams({ page: String(page), per_page: String(perPage) });
    const name = String(options.name || '').trim();
    if (name) query.set('name', name);
    const response = await request('GET', '/client/v4/zones?' + query.toString(), account.api_token);
    const zones = Array.isArray(response.result) ? response.result : [];
    const total = Number(response.resultInfo.total_count);
    if (!name && Number.isInteger(total) && total >= 0) {
      pub.M('cloudflare_account').where('account_id=?', account.account_id).update({ zone_count: total });
    }
    return { data: zones, result_info: response.resultInfo };
  }

  async zoneFind(accountId, zoneId) {
    const account = this.getAccount(accountId);
    return request('GET', `/client/v4/zones/${zoneId}`, account.api_token);
  }

  async zoneCreate(accountId, name, cloudflareAccountId) {
    const account = this.getAccount(accountId);
    return request('POST', '/client/v4/zones', account.api_token, { name, type: 'full', account: { id: cloudflareAccountId } });
  }

  async zoneDelete(accountId, zoneId) {
    const account = this.getAccount(accountId);
    return request('DELETE', `/client/v4/zones/${zoneId}`, account.api_token);
  }

  async zoneActivationCheck(accountId, zoneId) {
    const account = this.getAccount(accountId);
    return request('PUT', `/client/v4/zones/${zoneId}/activation_check`, account.api_token);
  }

  async listDnsRecords(accountId, zoneId, options = {}) {
    const account = this.getAccount(accountId);
    const query = new URLSearchParams({
      page: String(normalizePage(options.page)),
      per_page: String(normalizePageSize(options.per_page, 50))
    });
    const search = String(options.search || '').trim();
    if (search) query.set('search', search);
    for (const key of ['name', 'type', 'content', 'proxied']) {
      if (options[key] !== undefined && options[key] !== '') query.set(key, String(options[key]));
    }
    const response = await request('GET', `/client/v4/zones/${zoneId}/dns_records?${query}`, account.api_token);
    return { data: Array.isArray(response.result) ? response.result : [], result_info: response.resultInfo };
  }

  async createDnsRecord(accountId, zoneId, payload) {
    const account = this.getAccount(accountId);
    return request('POST', `/client/v4/zones/${zoneId}/dns_records`, account.api_token, payload);
  }

  async updateDnsRecord(accountId, zoneId, recordId, payload) {
    const account = this.getAccount(accountId);
    return request('PATCH', `/client/v4/zones/${zoneId}/dns_records/${recordId}`, account.api_token, payload);
  }

  async findDnsRecord(accountId, zoneId, recordId) {
    const account = this.getAccount(accountId);
    return request('GET', `/client/v4/zones/${zoneId}/dns_records/${recordId}`, account.api_token);
  }

  async removeDnsRecord(accountId, zoneId, recordId) {
    const account = this.getAccount(accountId);
    return request('DELETE', `/client/v4/zones/${zoneId}/dns_records/${recordId}`, account.api_token);
  }

  async triggerDnsScan(accountId, zoneId) {
    const account = this.getAccount(accountId);
    return request('POST', `/client/v4/zones/${zoneId}/dns_records/scan/trigger`, account.api_token);
  }

  async listDnsScan(accountId, zoneId) {
    const account = this.getAccount(accountId);
    return request('GET', `/client/v4/zones/${zoneId}/dns_records/scan/review`, account.api_token);
  }

  async reviewDnsScan(accountId, zoneId, payload) {
    const account = this.getAccount(accountId);
    return request('POST', `/client/v4/zones/${zoneId}/dns_records/scan/review`, account.api_token, payload);
  }

  async getDevelopmentMode(accountId, zoneId) {
    const account = this.getAccount(accountId);
    return request('GET', `/client/v4/zones/${zoneId}/settings/development_mode`, account.api_token);
  }

  async setDevelopmentMode(accountId, zoneId, value) {
    const account = this.getAccount(accountId);
    return request('PATCH', `/client/v4/zones/${zoneId}/settings/development_mode`, account.api_token, { value });
  }

  async purgeCache(accountId, zoneId, payload) {
    const account = this.getAccount(accountId);
    return request('POST', `/client/v4/zones/${zoneId}/purge_cache`, account.api_token, payload);
  }
}

module.exports = { cloudflareService: new CloudflareService(), safeError, normalizePage, normalizePageSize };
