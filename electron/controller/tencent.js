'use strict';

const { Controller } = require('ee-core');
const { pub } = require('../class/public.js');
const { tencentService, errorOf } = require('../service/tencent');
const { tencentSshService } = require('../service/tencent-ssh');
const { dialog, BrowserWindow } = require('electron');
const path = require('path');
const { bucketScope, objectKey } = require('../service/tencent-cos');

function sendError(event, channel, error) {
  const normalized = errorOf(error);
  return pub.send(event, channel, { status: false, msg: normalized.message,
    data: { error_code: normalized.code, http_code: normalized.httpCode, request_id: normalized.requestId, resource_status: normalized.resource_status, action: normalized.action } });
}
const dataOf = args => args.data || {};
function nameOf(value, label, limit) {
  const name = String(value || '').trim();
  if (!name || name.length > limit) throw new Error(`${label}不能为空且不能超过 ${limit} 个字符`);
  return name;
}

class TencentController extends Controller {
  async list(args, event) {
    try {
      const accounts = pub.M('tencent_account')
        .field('account_id,group_id,remark,site,secret_id,balance,balance_currency,balance_refresh_time,balance_error,server_count,cvm_count,lighthouse_count,server_refresh_time,server_error,resource_summary,sort,addtime,update_time')
        .order('sort DESC, account_id DESC').select().map(account => tencentService.safeAccount(account));
      const groups = [{ group_id: -1, group_name: '全部' }, { group_id: 0, group_name: '默认' }, ...pub.M('tencent_group').order('group_id ASC').select()]
        .map(group => ({ ...group, account_count: accounts.filter(account => group.group_id === -1 || account.group_id === group.group_id).length }));
      return pub.send_success(event, args.channel, { data: accounts, groups });
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async find(args, event) {
    try { return pub.send_success(event, args.channel, tencentService.safeAccount(tencentService.getAccount(dataOf(args).account_id))); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  // 仅由用户主动查看凭据或编辑账号时调用，不并入账号列表和概览。
  async credentials(args, event) {
    try {
      const account = tencentService.getAccount(dataOf(args).account_id);
      return pub.send_success(event, args.channel, { secret_id: account.secret_id, secret_key: account.secret_key });
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async save(args, event) {
    try {
      const data = dataOf(args);
      const id = Number(data.account_id) || 0;
      const current = id ? pub.M('tencent_account').where('account_id=?', id).find() : null;
      if (id && !current) throw new Error('指定腾讯云账号不存在');
      const remark = nameOf(data.remark, '备注', 40);
      const site = String(data.site || '');
      if (!['cn', 'intl'].includes(site)) throw new Error('请选择国内站或国际站');
      const secretId = String(data.secret_id || '').trim();
      const secretKey = String(data.secret_key || '').trim() || current && current.secret_key;
      if (!/^[a-zA-Z0-9]{16,128}$/.test(secretId)) throw new Error('SecretId 格式不正确');
      if (!secretKey || !/^[a-zA-Z0-9]{16,128}$/.test(secretKey)) throw new Error('SecretKey 格式不正确');
      const groupId = Number(data.group_id) || 0;
      if (groupId !== 0 && !pub.M('tencent_group').where('group_id=?', groupId).find()) throw new Error('所选分组不存在');
      if (pub.M('tencent_account').select().some(account => account.account_id !== id && account.site === site && account.secret_id === secretId)) throw new Error('同一站点下已添加该 SecretId');
      const changed = !current || current.site !== site || current.secret_id !== secretId || current.secret_key !== secretKey;
      const now = pub.time();
      const fields = { remark, site, group_id: groupId, secret_id: secretId, secret_key: secretKey, update_time: now };
      if (changed) Object.assign(fields, { balance: '', balance_currency: site === 'intl' ? 'USD' : 'CNY', balance_refresh_time: 0,
        balance_error: '', server_count: -1, cvm_count: -1, lighthouse_count: -1, server_refresh_time: 0, server_error: '', resource_summary: '{}' });
      const result = id ? pub.M('tencent_account').where('account_id=?', id).update(fields)
        : pub.M('tencent_account').insert({ ...fields, sort: pub.M('tencent_account').count() + 1, addtime: now });
      if (!result) throw new Error('账号保存失败');
      if (id) tencentService.clearAccountCache(id);
      if (id && changed) tencentSshService.cancelAccount(id);
      return pub.send(event, args.channel, { status: true, msg: '保存成功' });
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async remove(args, event) {
    try {
      const id = Number(dataOf(args).account_id) || 0;
      if (!pub.M('tencent_account').where('account_id=?', id).find()) throw new Error('指定腾讯云账号不存在');
      if (!pub.M('tencent_account').where('account_id=?', id).delete()) throw new Error('账号删除失败');
      tencentService.clearAccountCache(id);
      tencentSshService.cancelAccount(id);
      pub.M('tencent_ssh_credential').where('account_id=?', id).delete();
      return pub.send_success_msg(event, args.channel, '删除成功');
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async set_sort(args, event) {
    try {
      const ids = dataOf(args).account_ids;
      const current = pub.M('tencent_account').field('account_id').select().map(account => account.account_id);
      if (!Array.isArray(ids) || ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(id => !current.includes(id))) throw new Error('账号列表已变化，请刷新后重新排序');
      ids.forEach((id, index) => pub.M('tencent_account').where('account_id=?', id).update({ sort: ids.length - index }));
      return pub.send_success_msg(event, args.channel, '排序已保存');
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async add_group(args, event) { return this.saveGroup(args, event, false); }
  async modify_group(args, event) { return this.saveGroup(args, event, true); }
  async saveGroup(args, event, editing) {
    try {
      const data = dataOf(args);
      const name = nameOf(data.group_name, '分组名称', 24);
      const id = editing ? Number(data.group_id) || 0 : 0;
      if (editing && (!id || !pub.M('tencent_group').where('group_id=?', id).find())) throw new Error('分组不存在');
      if (pub.M('tencent_group').select().some(group => group.group_id !== id && group.group_name === name)) throw new Error('分组名称已存在');
      const result = editing ? pub.M('tencent_group').where('group_id=?', id).update({ group_name: name }) : pub.M('tencent_group').insert({ group_name: name });
      if (!result) throw new Error('分组保存失败');
      return pub.send_success_msg(event, args.channel, '分组已保存');
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async remove_group(args, event) {
    try {
      const id = Number(dataOf(args).group_id) || 0;
      if (id <= 0 || !pub.M('tencent_group').where('group_id=?', id).find()) throw new Error('分组不存在');
      pub.M('tencent_account').where('group_id=?', id).update({ group_id: 0 });
      if (!pub.M('tencent_group').where('group_id=?', id).delete()) throw new Error('分组删除失败');
      return pub.send_success_msg(event, args.channel, '分组已删除，账号移入默认分组');
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async run(args, event, handler) {
    try { return pub.send_success(event, args.channel, await handler(dataOf(args))); }
    catch (error) { return sendError(event, args.channel, error); }
  }
  async refresh_balance(args, event) { return this.run(args, event, data => tencentService.refreshBalance(data.account_id)); }
  async refresh_summary(args, event) { return this.run(args, event, data => tencentService.refreshSummary(data.account_id, data.force === true)); }
  async probe_resources(args, event) { return this.run(args, event, data => tencentService.resources.probe(data.account_id, data.force === true, data.product)); }
  async resources(args, event) { return this.run(args, event, data => tencentService.resources.run(data.account_id, data.resource_action, data)); }
  async cos_upload(args, event) {
    return this.run(args, event, async data => {
      const account = tencentService.getAccount(data.account_id);
      const scope = bucketScope(data);
      const prefix = objectKey(data.prefix, true);
      const parent = BrowserWindow.fromWebContents(event.sender);
      const selected = await dialog.showOpenDialog(parent, { title: '选择上传到 COS 的文件', properties: ['openFile', 'multiSelections'] });
      if (selected.canceled || !selected.filePaths.length) return { canceled: true };
      const confirm = await dialog.showMessageBox(parent, { type: 'question', title: '确认上传至 COS', message: `上传 ${selected.filePaths.length} 个文件至 ${scope.Bucket}`, detail: `账号：${account.remark}\n目录：${prefix || '/'}\n同名文件将被覆盖。`, buttons: ['取消', '上传'], defaultId: 0, cancelId: 0 });
      if (confirm.response !== 1) return { canceled: true };
      if (!tencentService.isCurrent(account)) throw new Error('账号凭据已变更，请重新选择上传目标');
      return { canceled: false, ...await tencentService.resources.cos.upload(account, data, selected.filePaths) };
    });
  }
  async cos_download(args, event) {
    return this.run(args, event, async data => {
      const account = tencentService.getAccount(data.account_id);
      bucketScope(data);
      const name = objectKey(data.object_name);
      const selected = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), { title: '保存 COS 文件', defaultPath: path.basename(name) || 'download' });
      if (selected.canceled || !selected.filePath) return { canceled: true };
      if (!tencentService.isCurrent(account)) throw new Error('账号凭据已变更，请重新选择下载目标');
      await tencentService.resources.cos.download(account, data, path.resolve(selected.filePath));
      return { canceled: false };
    });
  }
  async server_list(args, event) { return this.run(args, event, data => tencentService.listServers(data.account_id, data.force === true)); }
  async server_traffic(args, event) { return this.run(args, event, data => tencentService.traffic(data.account_id, data, data.force === true)); }
  async server_statistics(args, event) { return this.run(args, event, data => tencentService.statistics(data.account_id, data, Number(data.days || 1), data.force === true)); }
  async server_state(args, event) { return this.run(args, event, data => tencentService.serverState(data.account_id, data)); }
  async ssh_prepare(args, event) { return this.run(args, event, data => tencentSshService.prepare(event.sender, data)); }
  async ssh_connect(args, event) { return this.run(args, event, data => tencentSshService.connect(event.sender.id, data)); }
  async ssh_diagnose(args, event) { return this.run(args, event, data => tencentSshService.diagnose(event.sender.id, data)); }
  async ssh_authorize(args, event) { return this.run(args, event, data => tencentSshService.authorize(event.sender.id, data)); }
  async ssh_cancel(args, event) {
    tencentSshService.cancel(event.sender.id, dataOf(args).job_id);
    return pub.send_success(event, args.channel, {});
  }
  async server_power(args, event) { return this.run(args, event, data => tencentService.power(data.account_id, data, data.action, data.confirm_instance_id)); }
}

module.exports = TencentController;
