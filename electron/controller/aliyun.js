'use strict';

const { Controller } = require('ee-core');
const { dialog } = require('electron');
const Electron = require('ee-core/electron');
const path = require('path');
const { pub } = require('../class/public.js');
const { aliyunService, normalizeError } = require('../service/aliyun.js');

function sendAliyunError(event, channel, error) {
  const normalized = normalizeError(error);
  return pub.send(event, channel, {
    status: false,
    msg: normalized.message,
    data: {
      errorCode: normalized.code,
      requestId: normalized.requestId || '',
      detail: normalized.detail || '',
      service: normalized.service || '',
      status: normalized.status || 'error',
    },
  });
}

class AliyunController extends Controller {
  constructor(ctx) {
    super(ctx);
    this.TABLE = 'aliyun_account';
    aliyunService.cleanupEsaUrlRankingCache();
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
      .field('account_id, group_id, remark, access_key_id, balance, balance_currency, balance_refresh_time, server_count, domain_count, esa_count, cdn_count, cdn_status, oss_count, resource_status, sort, addtime, update_time, resource_refresh_time, resource_error, resource_error_detail')
      .order('sort DESC, account_id DESC')
      .select()
      .map(account => aliyunService.safeAccount(account));

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

  async find(args, event) {
    try {
      return pub.send_success(event, args.channel, aliyunService.safeAccount(
        aliyunService.getAccount(args.data.account_id)
      ));
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cache_info(args, event) {
    try {
      return pub.send_success(event, args.channel, aliyunService.getEsaUrlCacheInfo());
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cache_set_limit(args, event) {
    try {
      const data = aliyunService.setEsaUrlCacheLimit(args.data.max_mb);
      return pub.send(event, args.channel, { status: true, msg: pub.lang('缓存上限已保存'), data });
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cache_clear(args, event) {
    try {
      const data = aliyunService.clearEsaUrlCache();
      return pub.send(event, args.channel, { status: true, msg: pub.lang('阿里云 URL 分析缓存已清理'), data });
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
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
      aliyunService.clearAccountCache(accountId);
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
      balance_currency: 'CNY',
      balance_refresh_time: 0,
      server_count: -1,
      domain_count: -1,
      esa_count: -1,
      cdn_count: -1,
      cdn_status: 'unknown',
      oss_count: -1,
      resource_status: '{}',
      resource_refresh_time: 0,
      resource_error: '',
      resource_error_detail: '',
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
    aliyunService.clearAccountCache(accountId);
    aliyunService.clearEsaUrlRankingDiskCache(accountId);
    return removed
      ? pub.send_success_msg(event, args.channel, pub.lang('删除成功'))
      : pub.send_error_msg(event, args.channel, pub.lang('删除失败'));
  }

  /**
   * 保存阿里云账号默认展示顺序。
   */
  async set_sort(args, event) {
    const accountIds = Array.isArray(args.data.account_ids)
      ? [...new Set(args.data.account_ids.map(Number).filter(id => Number.isInteger(id) && id > 0))]
      : [];
    if (!accountIds.length) {
      return pub.send_error_msg(event, args.channel, pub.lang('排序数据不能为空'));
    }

    const currentList = pub.M(this.TABLE).order('sort DESC, account_id DESC').select();
    const currentIds = new Set(currentList.map(account => Number(account.account_id)));
    const orderedIds = accountIds.filter(accountId => currentIds.has(accountId));
    if (!orderedIds.length) {
      return pub.send_error_msg(event, args.channel, pub.lang('排序账号不存在'));
    }

    const orderedIdSet = new Set(orderedIds);
    const queue = [...orderedIds];
    const mergedIds = currentList.map(account => {
      const accountId = Number(account.account_id);
      return orderedIdSet.has(accountId) ? queue.shift() : accountId;
    });
    const total = mergedIds.length;
    mergedIds.forEach((accountId, index) => {
      pub.M(this.TABLE).where('account_id=?', accountId).update({ sort: total - index });
    });

    return pub.send_success_msg(event, args.channel, pub.lang('排序已保存'));
  }

  async refresh_account_summary(args, event) {
    try {
      const data = await aliyunService.refreshSummary(args.data.account_id, args.data.force === true);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async refresh_balance(args, event) {
    try {
      const data = await aliyunService.refreshBalance(args.data.account_id);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async server_list(args, event) {
    try {
      const data = await aliyunService.listServers(args.data.account_id, args.data.force === true);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async domain_list(args, event) {
    try {
      const data = await aliyunService.listDomains(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async domain_info(args, event) {
    try {
      const data = await aliyunService.getDomainInfo(args.data.account_id, args.data.domain_name);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_site_list(args, event) {
    try {
      const data = await aliyunService.listEsaSites(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_site_detail(args, event) {
    try {
      const data = await aliyunService.getEsaSiteDetail(args.data.account_id, args.data.site_id);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_record_list(args, event) {
    try {
      const data = await aliyunService.listEsaRecords(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_record_add(args, event) {
    try {
      const data = await aliyunService.addEsaRecord(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_record_update(args, event) {
    try {
      const data = await aliyunService.updateEsaRecord(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_record_delete(args, event) {
    try {
      const data = await aliyunService.deleteEsaRecord(args.data.account_id, args.data.record_id);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_record_set_proxy(args, event) {
    try {
      const data = await aliyunService.setEsaRecordProxy(args.data.account_id, args.data.record_id, args.data.proxied === true);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_record_batch_action(args, event) {
    try {
      const data = await aliyunService.batchEsaRecordAction(args.data.account_id, args.data.record_ids, args.data.action);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_origin_list(args, event) {
    try {
      const data = await aliyunService.listEsaOrigins(args.data.account_id, args.data.site_id);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_certificate_list(args, event) {
    try {
      const data = await aliyunService.listEsaCertificates(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_traffic_analytics(args, event) {
    try {
      const data = await aliyunService.getEsaTrafficAnalytics(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async esa_url_rankings(args, event) {
    try {
      const sendProgress = progress => {
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send(args.channel, { __ipc_progress: true, data: progress });
        }
      };
      const data = await aliyunService.getEsaUrlRankingAnalytics(args.data.account_id, args.data, sendProgress);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cdn_domain_list(args, event) {
    try {
      const data = await aliyunService.listCdnDomains(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cdn_domain_update(args, event) {
    try {
      const data = await aliyunService.updateCdnDomain(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cdn_domain_delete(args, event) {
    try {
      const data = await aliyunService.deleteCdnDomain(args.data.account_id, args.data.domain_name);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cdn_domain_batch_action(args, event) {
    try {
      const data = await aliyunService.batchCdnDomainAction(args.data.account_id, args.data.domain_names, args.data.action);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cdn_operation_logs(args, event) {
    try {
      const data = await aliyunService.listCdnOperationLogs(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async cdn_traffic_analytics(args, event) {
    try {
      const data = await aliyunService.getCdnTrafficAnalytics(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async sms_sign_list(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.listSmsSigns(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async sms_sign_detail(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.getSmsSign(args.data.account_id, args.data.sign_name)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async sms_template_list(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.listSmsTemplates(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async sms_template_detail(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.getSmsTemplate(args.data.account_id, args.data.template_code)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async sms_send_statistics(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.querySmsSendStatistics(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async sms_send_details(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.querySmsSendDetails(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async oss_bucket_list(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.listOssBuckets(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async oss_bucket_create(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.createOssBucket(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async oss_bucket_delete(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.deleteOssBucket(args.data.account_id, args.data.bucket, args.data.region)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async oss_object_list(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.listOssObjects(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async oss_object_upload(args, event) {
    try {
      const selected = await dialog.showOpenDialog(Electron.mainWindow, {
        title: pub.lang('选择要上传到 OSS 的文件'),
        properties: ['openFile', 'multiSelections'],
      });
      if (selected.canceled || !selected.filePaths.length) return pub.send_success(event, args.channel, { canceled: true, data: [] });
      const data = await aliyunService.uploadOssObjects(args.data.account_id, args.data, selected.filePaths);
      return pub.send_success(event, args.channel, { canceled: false, data });
    } catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async oss_object_download(args, event) {
    try {
      const objectName = String(args.data.object_name || '');
      const selected = await dialog.showSaveDialog(Electron.mainWindow, {
        title: pub.lang('保存 OSS 文件'),
        defaultPath: path.basename(objectName) || 'download',
      });
      if (selected.canceled || !selected.filePath) return pub.send_success(event, args.channel, { canceled: true });
      await aliyunService.downloadOssObject(args.data.account_id, args.data, path.resolve(selected.filePath));
      return pub.send_success(event, args.channel, { canceled: false, path: selected.filePath });
    } catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async oss_object_delete(args, event) {
    try { return pub.send_success(event, args.channel, await aliyunService.deleteOssObjects(args.data.account_id, args.data)); }
    catch (error) { return sendAliyunError(event, args.channel, error); }
  }

  async record_list(args, event) {
    try {
      const data = await aliyunService.listRecords(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async record_lines(args, event) {
    try {
      const data = await aliyunService.listRecordLines(args.data.account_id, args.data.domain_name);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async record_logs(args, event) {
    try {
      const data = await aliyunService.listRecordLogs(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async record_add(args, event) {
    try {
      const data = await aliyunService.addRecord(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async record_update(args, event) {
    try {
      const data = await aliyunService.updateRecord(args.data.account_id, args.data);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async record_delete(args, event) {
    try {
      const data = await aliyunService.deleteRecord(args.data.account_id, args.data.record_id);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async record_set_status(args, event) {
    try {
      const data = await aliyunService.setRecordStatus(
        args.data.account_id,
        args.data.record_id,
        args.data.status
      );
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async record_batch_action(args, event) {
    try {
      const data = await aliyunService.batchRecordAction(args.data.account_id, args.data.record_ids, args.data.action);
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async open_terminal(args, event) {
    try {
      const data = await aliyunService.prepareEcsTerminal(
        args.data.account_id,
        args.data.instance_id,
        args.data.region_id,
        args.data.title
      );
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
  }

  async open_swas_workbench(args, event) {
    try {
      const data = await aliyunService.openSwasWorkbench(
        args.data.account_id,
        args.data.instance_id,
        args.data.region_id
      );
      return pub.send_success(event, args.channel, data);
    } catch (error) {
      return sendAliyunError(event, args.channel, error);
    }
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
