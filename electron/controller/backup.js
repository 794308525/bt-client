'use strict';

const { Controller } = require('ee-core');
const { app, dialog, shell } = require('electron');
const Electron = require('ee-core/electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pub } = require('../class/public');
const { dataPaths, captureData, encodeBackup, readEnvelope, decodeBackup, prepareRestore } = require('../class/data-backup');
const { access, exclusive } = require('../class/application-data');

let busy = false;
let selection = null;

class BackupController extends Controller {
  async execute(args, event, action) {
    if (!Electron.mainWindow || event.sender.id !== Electron.mainWindow.webContents.id || !global.password_hash) {
      return pub.send_error_msg(event, args.channel, pub.lang('请先在主窗口解锁应用'));
    }
    if (busy) return pub.send_error_msg(event, args.channel, pub.lang('正在处理备份，请稍候'));
    busy = true;
    try {
      const result = await action(dataPaths(app.getAppPath(), app.getPath('userData')));
      return pub.send_success(event, args.channel, result);
    } catch (error) {
      return pub.send_error_msg(event, args.channel, error.message || pub.lang('备份操作失败'));
    } finally { busy = false; }
  }

  async export_data(args, event) {
    return this.execute(args, event, async paths => {
      const password = args.data.password;
      if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Error('备份密码长度应为 8～256 位');
      const result = await dialog.showSaveDialog(Electron.mainWindow, {
        title: pub.lang('导出完整数据备份'),
        defaultPath: `寰宇运维-${app.getVersion()}-${new Date().toISOString().slice(0, 10)}.hybackup`,
        filters: [{ name: '寰宇运维数据备份', extensions: ['hybackup'] }],
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const payload = await captureData(paths.dataDir, app.getVersion());
      const body = encodeBackup(payload, password);
      // 保存面板在沙盒中授予所选文件的访问权，完整编码后再写入该文件。
      fs.writeFileSync(result.filePath, body, { mode: 0o600 });
      return { filePath: result.filePath, fileCount: payload.files.length };
    });
  }

  async choose_import(args, event) {
    return this.execute(args, event, async () => {
      selection = null;
      const result = await dialog.showOpenDialog(Electron.mainWindow, {
        title: pub.lang('选择完整数据备份'),
        properties: ['openFile'],
        filters: [{ name: '寰宇运维数据备份', extensions: ['hybackup'] }],
      });
      if (result.canceled || !result.filePaths.length) return { canceled: true };
      const envelope = readEnvelope(result.filePaths[0]);
      const token = crypto.randomBytes(16).toString('hex');
      selection = { token, envelope, sender: event.sender.id, expires: Date.now() + 5 * 60 * 1000 };
      return { token, encrypted: envelope.encrypted, fileName: path.basename(result.filePaths[0]) };
    });
  }

  async import_data(args, event) {
    return this.execute(args, event, async paths => {
      if (!selection || selection.token !== args.data.token || selection.sender !== event.sender.id || selection.expires < Date.now()) {
        throw new Error('请选择备份文件；已选择的文件五分钟后失效');
      }
      const decoded = decodeBackup(selection.envelope, args.data.password || '');
      if (access() && Number(decoded.payload.schemaRevision || 0) > access().revision) throw new Error('备份的数据结构来自更新版本，请先升级应用');
      const backupVersion = decoded.metadata.appVersion.match(/^\d+\.\d+\.\d+$/);
      if (!backupVersion) throw new Error('备份版本信息无效');
      const compare = (a, b) => {
        const left = a.split('.').map(Number), right = b.split('.').map(Number);
        for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] - right[i]; }
        return 0;
      };
      if (compare(decoded.metadata.appVersion, app.getVersion()) > 0) throw new Error('备份来自更新版本，请先升级应用');
      const created = new Date(decoded.metadata.createdAt);
      const result = await dialog.showMessageBox(Electron.mainWindow, {
        type: 'warning',
        title: pub.lang('导入完整数据备份'),
        message: pub.lang('确认替换当前全部本地数据并重启？'),
        detail: `备份版本：${decoded.metadata.appVersion}\n备份时间：${Number.isNaN(created.getTime()) ? '未知' : created.toLocaleString()}\n\n这次操作是完整替换，不会合并。导入前会自动保存当前数据的备份。恢复后沿用备份中的管理密码及免密设置。请先结束终端连接和正在执行的任务。`,
        buttons: [pub.lang('取消'), pub.lang('备份并导入')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1) return { canceled: true };
      const prepared = await exclusive(() => prepareRestore(paths, decoded, app.getVersion()));
      selection = null;
      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 500);
      return { ...prepared, restarting: true };
    });
  }

  async open_backups(args, event) {
    return this.execute(args, event, async paths => {
      fs.mkdirSync(paths.stateDir, { recursive: true, mode: 0o700 });
      const error = await shell.openPath(paths.stateDir);
      if (error) throw new Error('无法打开自动备份目录');
      return {};
    });
  }
}

BackupController.toString = () => '[class BackupController]';
module.exports = BackupController;
