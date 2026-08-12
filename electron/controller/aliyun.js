'use strict';

const { Controller } = require('ee-core');
const { pub } = require('../class/public.js');

class AliyunController extends Controller {
  constructor(ctx) {
    super(ctx);
    this.TABLE = 'aliyun_account';
  }

  /**
   * 获取阿里云账号和分组。出于安全考虑，列表不返回 AccessKey Secret。
   */
  async list(args, event) {
    const groups = [
      { group_id: -1, group_name: pub.lang('全部') },
      { group_id: 0, group_name: pub.lang('默认') }
    ].concat(pub.M('aliyun_group').order('group_id ASC').select());

    const accounts = pub.M(this.TABLE)
      .field('account_id, group_id, remark, access_key_id, balance, server_count, domain_count, sort, addtime, update_time')
      .order('sort DESC, account_id DESC')
      .select();

    const countMap = {};
    accounts.forEach(account => {
      countMap[account.group_id] = (countMap[account.group_id] || 0) + 1;
    });

    const resultGroups = groups.map(group => ({
      ...group,
      account_count: group.group_id === -1
        ? accounts.length
        : (countMap[group.group_id] || 0)
    }));

    return pub.send_success(event, args.channel, {
      groups: resultGroups,
      data: accounts
    });
  }

  /**
   * 新增或修改阿里云账号。修改时 AccessKey Secret 留空表示保持不变。
   */
  async save(args, event) {
    const channel = args.channel;
    const data = args.data || {};
    const accountId = Number(data.account_id) || 0;
    const remark = pub.trim(String(data.remark || ''));
    const accessKeyId = pub.trim(String(data.access_key_id || ''));
    const accessKeySecret = pub.trim(String(data.access_key_secret || ''));
    const groupId = Number(data.group_id) || 0;

    if (!remark) return pub.send_error_msg(event, channel, pub.lang('备注不能为空'));
    if (remark.length > 40) return pub.send_error_msg(event, channel, pub.lang('备注不能超过40个字符'));
    if (!accessKeyId) return pub.send_error_msg(event, channel, pub.lang('AccessKey ID不能为空'));
    if (!accountId && !accessKeySecret) {
      return pub.send_error_msg(event, channel, pub.lang('AccessKey Secret不能为空'));
    }
    if (groupId > 0 && !pub.M('aliyun_group').where('group_id=?', groupId).find()) {
      return pub.send_error_msg(event, channel, pub.lang('指定分组不存在'));
    }

    const duplicated = pub.M(this.TABLE).select().find(account => {
      return account.access_key_id === accessKeyId && account.account_id !== accountId;
    });
    if (duplicated) return pub.send_error_msg(event, channel, pub.lang('该 AccessKey ID 已存在'));

    const now = pub.time();
    if (accountId) {
      if (!pub.M(this.TABLE).where('account_id=?', accountId).find()) {
        return pub.send_error_msg(event, channel, pub.lang('指定阿里云账号不存在'));
      }
      const updateData = {
        remark,
        access_key_id: accessKeyId,
        group_id: groupId,
        update_time: now
      };
      if (accessKeySecret) updateData.access_key_secret = accessKeySecret;

      const updated = pub.M(this.TABLE).where('account_id=?', accountId).update(updateData);
      return updated
        ? pub.send_success_msg(event, channel, pub.lang('保存成功'))
        : pub.send_error_msg(event, channel, pub.lang('保存失败'));
    }

    const accountCount = pub.M(this.TABLE).count();
    const inserted = pub.M(this.TABLE).insert({
      group_id: groupId,
      remark,
      access_key_id: accessKeyId,
      access_key_secret: accessKeySecret,
      balance: '',
      server_count: -1,
      domain_count: -1,
      sort: accountCount + 1,
      addtime: now,
      update_time: now
    });

    return inserted
      ? pub.send_success_msg(event, channel, pub.lang('添加成功'))
      : pub.send_error_msg(event, channel, pub.lang('添加失败'));
  }

  async remove(args, event) {
    const accountId = Number(args.data.account_id) || 0;
    if (!accountId || !pub.M(this.TABLE).where('account_id=?', accountId).find()) {
      return pub.send_error_msg(event, args.channel, pub.lang('指定阿里云账号不存在'));
    }
    const removed = pub.M(this.TABLE).where('account_id=?', accountId).delete();
    return removed
      ? pub.send_success_msg(event, args.channel, pub.lang('删除成功'))
      : pub.send_error_msg(event, args.channel, pub.lang('删除失败'));
  }

  async add_group(args, event) {
    const groupName = pub.trim(String(args.data.group_name || ''));
    if (!groupName) return pub.send_error_msg(event, args.channel, pub.lang('分组名称不能为空'));
    if (groupName.length > 24) {
      return pub.send_error_msg(event, args.channel, pub.lang('分组名称不能超过24个字符'));
    }
    if (pub.M('aliyun_group').where('group_name=?', groupName).count()) {
      return pub.send_error_msg(event, args.channel, pub.lang('分组名称已存在'));
    }
    const inserted = pub.M('aliyun_group').insert({ group_name: groupName });
    return inserted
      ? pub.send_success_msg(event, args.channel, pub.lang('添加分组成功'))
      : pub.send_error_msg(event, args.channel, pub.lang('添加分组失败'));
  }

  async modify_group(args, event) {
    const groupId = Number(args.data.group_id) || 0;
    const groupName = pub.trim(String(args.data.group_name || ''));
    if (!groupId) return pub.send_error_msg(event, args.channel, pub.lang('默认分组不能修改'));
    if (!groupName) return pub.send_error_msg(event, args.channel, pub.lang('分组名称不能为空'));
    if (groupName.length > 24) {
      return pub.send_error_msg(event, args.channel, pub.lang('分组名称不能超过24个字符'));
    }
    if (pub.M('aliyun_group').where('group_name=? and group_id!=?', [groupName, groupId]).count()) {
      return pub.send_error_msg(event, args.channel, pub.lang('分组名称已存在'));
    }
    const updated = pub.M('aliyun_group').where('group_id=?', groupId).update({ group_name: groupName });
    return updated
      ? pub.send_success_msg(event, args.channel, pub.lang('修改分组成功'))
      : pub.send_error_msg(event, args.channel, pub.lang('修改分组失败'));
  }

  async remove_group(args, event) {
    const groupId = Number(args.data.group_id) || 0;
    if (!groupId) return pub.send_error_msg(event, args.channel, pub.lang('默认分组不能删除'));
    const removed = pub.M('aliyun_group').where('group_id=?', groupId).delete();
    if (!removed) return pub.send_error_msg(event, args.channel, pub.lang('删除分组失败'));

    pub.M(this.TABLE).where('group_id=?', groupId).update({ group_id: 0 });
    return pub.send_success_msg(event, args.channel, pub.lang('删除分组成功'));
  }
}

AliyunController.toString = () => '[class AliyunController]';
module.exports = AliyunController;
