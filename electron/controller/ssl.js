'use strict';

const fs = require('fs');
const path = require('path');
const { dialog } = require('electron');
const Electron = require('ee-core/electron');
const { Controller } = require('ee-core');
const { pub } = require('../class/public.js');
const { sslService, normalizeSslError } = require('../service/ssl.js');
const { sslDeployService } = require('../service/ssl-deploy.js');

function sendError(event, channel, error) {
  const normalized = normalizeSslError(error);
  return pub.send(event, channel, {
    status: false,
    msg: normalized.message,
    data: { errorCode: normalized.code, requestId: error && error.requestId || '', detail: normalized.detail || '' },
  });
}

class SslController extends Controller {
  async providers(args, event) {
    return pub.send_success(event, args.channel, sslService.listProviders());
  }

  async channel_list(args, event) {
    return pub.send_success(event, args.channel, sslService.listChannels(args.data && args.data.enabled_only === true));
  }

  async channel_save(args, event) {
    try {
      const channelId = sslService.saveChannel(args.data || {});
      return pub.send_success(event, args.channel, { channel_id: channelId });
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async channel_remove(args, event) {
    try {
      sslService.removeChannel(args.data.channel_id);
      return pub.send_success_msg(event, args.channel, pub.lang('删除成功'));
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async channel_test(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.testChannel(args.data.channel_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async meta(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.getMeta(args.data.channel_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_list(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.listCertificates(args.data.channel_id, args.data)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_create(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.createCertificate(args.data.channel_id, args.data)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_detail(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.getCertificateDetail(args.data.channel_id, args.data.order_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_challenge(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.getChallenge(args.data.channel_id, args.data.order_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_verify(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.verifyCertificate(args.data.channel_id, args.data.order_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_content(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.getCertificateContent(args.data.channel_id, args.data.order_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_download(args, event) {
    try {
      const orderId = String(args.data.order_id || '').replace(/[^a-zA-Z0-9_-]/g, '');
      const result = await sslService.downloadCertificate(args.data.channel_id, orderId);
      const selected = await dialog.showSaveDialog(Electron.mainWindow, {
        title: pub.lang('保存证书包'),
        defaultPath: `${orderId || 'certificate'}.zip`,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
      });
      if (selected.canceled || !selected.filePath) return pub.send_success(event, args.channel, { canceled: true });
      const resolvedPath = path.resolve(selected.filePath);
      if (path.extname(resolvedPath).toLowerCase() !== '.zip') throw new Error('证书包保存路径不正确');
      fs.writeFileSync(resolvedPath, result.data, { mode: 0o600 });
      return pub.send_success(event, args.channel, { canceled: false, path: selected.filePath });
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_cancel(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.cancelCertificate(args.data.channel_id, args.data.order_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async certificate_delete(args, event) {
    try { return pub.send_success(event, args.channel, await sslService.deleteCertificate(args.data.channel_id, args.data.order_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async esa_apply_create(args, event) {
    try { return pub.send_success(event, args.channel, await sslDeployService.createTask(args.data || {})); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async esa_apply_list(args, event) {
    try { return pub.send_success(event, args.channel, sslDeployService.listTasks(args.data || {})); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async esa_apply_retry(args, event) {
    try { return pub.send_success(event, args.channel, await sslDeployService.retryTask(args.data && args.data.task_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }
}

SslController.toString = () => '[class SslController]';
module.exports = SslController;
