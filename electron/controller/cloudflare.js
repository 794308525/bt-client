'use strict';

const { Controller } = require('ee-core');
const { pub } = require('../class/public.js');
const { cloudflareService, safeError } = require('../service/cloudflare.js');

const ZONE_ID_RE = /^[a-f0-9]{32}$/i;
const RECORD_ID_RE = /^[a-f0-9]{32}$/i;
const CLOUDFLARE_ACCOUNT_ID_RE = /^[a-f0-9]{32}$/i;
const RECORD_TYPES = new Set(['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'CAA', 'NS', 'SRV']);
const PROXY_TYPES = new Set(['A', 'AAAA', 'CNAME']);

function sendError(event, channel, error) {
  const normalized = safeError(error);
  return pub.send(event, channel, { status: false, msg: normalized.message, data: { status: 'error' } });
}

function dataOf(args) { return args && args.data && typeof args.data === 'object' ? args.data : {}; }
function positiveInt(value, fallback, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}
function idOf(value, label) {
  const id = String(value || '').trim();
  if (!ZONE_ID_RE.test(id)) throw new Error(`${label}格式不正确`);
  return id;
}
function recordIdOf(value) {
  const id = String(value || '').trim();
  if (!RECORD_ID_RE.test(id)) throw new Error('DNS 记录 ID 格式不正确');
  return id;
}
function cloudflareAccountIdOf(value, required = false) {
  const id = String(value || '').trim();
  if (!id && !required) return '';
  if (!CLOUDFLARE_ACCOUNT_ID_RE.test(id)) throw new Error('Cloudflare Account ID 格式不正确');
  return id;
}
function rootDomainOf(value) {
  const domain = String(value || '').trim().toLowerCase().replace(/\.$/, '');
  if (domain.length < 3 || domain.length > 253 || domain.includes('..') || domain.includes('*') ||
      !domain.includes('.') || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
    throw new Error('请输入合法的站点根域名（例如 example.com）');
  }
  return domain;
}
function textOf(value, label, max, required = true) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  if (required && !text) throw new Error(`${label}不能为空`);
  if (text.length > max) throw new Error(`${label}不能超过${max}个字符`);
  return text;
}
function boolOf(value) { return value === true; }
function dnsPayloadOf(input, partial = false) {
  const data = input && typeof input === 'object' ? input : {};
  const payload = {};
  if (!partial || data.type !== undefined) {
    const type = textOf(data.type, '记录类型', 10).toUpperCase();
    if (!RECORD_TYPES.has(type)) throw new Error('不支持的 DNS 记录类型');
    payload.type = type;
  }
  if (!partial || data.name !== undefined) payload.name = textOf(data.name, '记录名称', 255);
  if (!partial || data.content !== undefined) payload.content = textOf(data.content, '记录内容', 4096);
  if (data.ttl !== undefined || !partial) {
    const ttl = Number(data.ttl);
    if (ttl !== 1 && (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400)) throw new Error('TTL 必须为自动（1）或 60-86400 秒');
    payload.ttl = ttl;
  }
  const type = payload.type || String(data.type || '').toUpperCase();
  if (data.proxied !== undefined) {
    if (data.proxied === true && !PROXY_TYPES.has(type)) throw new Error('只有 A、AAAA、CNAME 记录支持代理');
    payload.proxied = boolOf(data.proxied);
  } else if (!partial) payload.proxied = false;
  if (data.priority !== undefined && data.priority !== null && data.priority !== '') {
    const priority = Number(data.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 65535) throw new Error('优先级必须为 0-65535');
    if (!['MX', 'SRV'].includes(type)) throw new Error('只有 MX、SRV 记录支持优先级');
    payload.priority = priority;
  }
  return payload;
}
function scanReviewPayload(data) {
  const action = String(data.action || '').trim().toLowerCase();
  if (!['accept', 'reject'].includes(action)) throw new Error('扫描审阅操作只能是 accept 或 reject');
  if (!Array.isArray(data.records) || data.records.length < 1 || data.records.length > 100) throw new Error('请明确选择要处理的扫描建议');
  if (action === 'accept') return { accepts: data.records.map(record => dnsPayloadOf(record, false)) };
  return { rejects: data.records.map(record => ({ id: recordIdOf(record && record.id) })) };
}

class CloudflareController extends Controller {
  async list(args, event) {
    const accounts = pub.M('cloudflare_account')
      .field('account_id, cloudflare_account_id, remark, sort, zone_count, addtime, update_time')
      .order('sort DESC, account_id DESC').select()
      .map(account => cloudflareService.safeAccount(account));
    return pub.send_success(event, args.channel, { data: accounts });
  }

  async find(args, event) {
    try { return pub.send_success(event, args.channel, cloudflareService.safeAccount(cloudflareService.getAccount(args.data.account_id))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async save(args, event) {
    const data = args.data || {};
    const id = Number(data.account_id) || 0;
    const remark = pub.trim(String(data.remark || ''));
    const token = pub.trim(String(data.api_token || ''));
    if (!remark) return pub.send_error_msg(event, args.channel, '备注不能为空');
    if (remark.length > 40) return pub.send_error_msg(event, args.channel, '备注不能超过40个字符');
    if (!id && !token) return pub.send_error_msg(event, args.channel, 'API Token 不能为空');
    try {
      const cloudflareAccountId = cloudflareAccountIdOf(data.cloudflare_account_id);
      const current = id ? cloudflareService.getAccount(id) : null;
      const effectiveToken = token || current.api_token;
      const tokenCheck = await cloudflareService.verifyToken(effectiveToken);
      const zoneCount = Number(tokenCheck.resultInfo.total_count);
      const validZoneCount = Number.isInteger(zoneCount) && zoneCount >= 0 ? zoneCount : -1;
      const duplicate = pub.M('cloudflare_account').select().find(row => row.remark === remark && row.account_id !== id);
      if (duplicate) return pub.send_error_msg(event, args.channel, '该备注已存在');
      const now = pub.time();
      if (id) {
        const update = { remark, cloudflare_account_id: cloudflareAccountId, zone_count: validZoneCount, update_time: now };
        if (token) update.api_token = token;
        return pub.M('cloudflare_account').where('account_id=?', id).update(update)
          ? pub.send_success_msg(event, args.channel, '保存成功') : pub.send_error_msg(event, args.channel, '保存失败');
      }
      const inserted = pub.M('cloudflare_account').insert({ remark, api_token: token, cloudflare_account_id: cloudflareAccountId, sort: pub.M('cloudflare_account').count() + 1, zone_count: validZoneCount, addtime: now, update_time: now });
      return inserted ? pub.send_success_msg(event, args.channel, '添加成功') : pub.send_error_msg(event, args.channel, '添加失败');
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async remove(args, event) {
    const id = Number(args.data && args.data.account_id) || 0;
    if (!id || !pub.M('cloudflare_account').where('account_id=?', id).find()) return pub.send_error_msg(event, args.channel, '指定 Cloudflare 账号不存在');
    return pub.M('cloudflare_account').where('account_id=?', id).delete() ? pub.send_success_msg(event, args.channel, '删除成功') : pub.send_error_msg(event, args.channel, '删除失败');
  }

  async zones(args, event) {
    try { return pub.send_success(event, args.channel, await cloudflareService.listZones(dataOf(args).account_id, dataOf(args))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async zone_find(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.zoneFind(data.account_id, idOf(data.zone_id, '站点 ID'))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async zone_create(args, event) {
    try {
      const data = dataOf(args);
      const account = cloudflareService.getAccount(data.account_id);
      const cloudflareAccountId = cloudflareAccountIdOf(account.cloudflare_account_id, true);
      return pub.send_success(event, args.channel, await cloudflareService.zoneCreate(data.account_id, rootDomainOf(data.name), cloudflareAccountId));
    }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async zone_remove(args, event) {
    try {
      const data = dataOf(args);
      const zoneId = idOf(data.zone_id, '站点 ID');
      const zone = await cloudflareService.zoneFind(data.account_id, zoneId);
      const name = zone && zone.result && zone.result.name;
      if (!name || String(data.confirm_zone_name || '').trim().toLowerCase() !== String(name).toLowerCase()) throw new Error('请输入与站点完全一致的域名以确认删除');
      return pub.send_success(event, args.channel, await cloudflareService.zoneDelete(data.account_id, zoneId));
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async zone_activation_check(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.zoneActivationCheck(data.account_id, idOf(data.zone_id, '站点 ID'))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async dns_list(args, event) {
    try {
      const data = dataOf(args);
      const options = { page: positiveInt(data.page, 1, 100000), per_page: positiveInt(data.per_page, 50, 100) };
      if (data.search !== undefined) options.search = textOf(data.search, '搜索关键词', 255, false);
      if (data.name !== undefined) options.name = textOf(data.name, '搜索名称', 255, false);
      if (data.content !== undefined) options.content = textOf(data.content, '搜索内容', 4096, false);
      if (data.type !== undefined && data.type !== '') {
        options.type = textOf(data.type, '记录类型', 10).toUpperCase();
        if (!RECORD_TYPES.has(options.type)) throw new Error('不支持的 DNS 记录类型');
      }
      if (data.proxied !== undefined) options.proxied = data.proxied === true ? 'true' : data.proxied === false ? 'false' : undefined;
      return pub.send_success(event, args.channel, await cloudflareService.listDnsRecords(data.account_id, idOf(data.zone_id, '站点 ID'), options));
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async dns_create(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.createDnsRecord(data.account_id, idOf(data.zone_id, '站点 ID'), dnsPayloadOf(data))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async dns_update(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.updateDnsRecord(data.account_id, idOf(data.zone_id, '站点 ID'), recordIdOf(data.record_id), dnsPayloadOf(data, true))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async dns_remove(args, event) {
    try {
      const data = dataOf(args);
      const zoneId = idOf(data.zone_id, '站点 ID');
      const recordId = recordIdOf(data.record_id);
      const record = await cloudflareService.findDnsRecord(data.account_id, zoneId, recordId);
      const remote = record && record.result;
      if (!remote || textOf(data.confirm_record_name, 'DNS 记录名称', 255) !== String(remote.name || '')) throw new Error('请输入与 DNS 记录名称完全一致的确认值');
      return pub.send_success(event, args.channel, await cloudflareService.removeDnsRecord(data.account_id, zoneId, recordId));
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async dns_scan_trigger(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.triggerDnsScan(data.account_id, idOf(data.zone_id, '站点 ID'))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async dns_scan_list(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.listDnsScan(data.account_id, idOf(data.zone_id, '站点 ID'))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async dns_scan_review(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.reviewDnsScan(data.account_id, idOf(data.zone_id, '站点 ID'), scanReviewPayload(data))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async development_mode_get(args, event) {
    try { const data = dataOf(args); return pub.send_success(event, args.channel, await cloudflareService.getDevelopmentMode(data.account_id, idOf(data.zone_id, '站点 ID'))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async development_mode_set(args, event) {
    try {
      const data = dataOf(args);
      const value = String(data.value || '').toLowerCase();
      if (!['on', 'off'].includes(value)) throw new Error('开发模式只能设置为开启或关闭');
      return pub.send_success(event, args.channel, await cloudflareService.setDevelopmentMode(data.account_id, idOf(data.zone_id, '站点 ID'), value));
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async cache_purge(args, event) {
    try {
      const data = dataOf(args);
      const zoneId = idOf(data.zone_id, '站点 ID');
      const mode = String(data.mode || '').toLowerCase();
      let payload;
      if (mode === 'all') {
        const zone = await cloudflareService.zoneFind(data.account_id, zoneId);
        const name = zone && zone.result && zone.result.name;
        if (!name || textOf(data.confirm_zone_name, '站点域名', 253) !== String(name)) throw new Error('请输入与站点完全一致的域名以确认清理全站缓存');
        payload = { purge_everything: true };
      } else if (mode === 'url') {
        const value = textOf(data.url, 'URL', 2048);
        let parsed;
        try { parsed = new URL(value); } catch (_) { throw new Error('请输入合法的 URL'); }
        if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) throw new Error('仅支持 http 或 https URL');
        payload = { files: [parsed.toString()] };
      } else throw new Error('缓存清理模式不正确');
      return pub.send_success(event, args.channel, await cloudflareService.purgeCache(data.account_id, zoneId, payload));
    } catch (error) { return sendError(event, args.channel, error); }
  }
}

CloudflareController.toString = () => '[class CloudflareController]';
module.exports = CloudflareController;
