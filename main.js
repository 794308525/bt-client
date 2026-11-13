const { app, dialog } = require('electron');
const fs = require('fs');

const sourceRoot = app.isPackaged ? './public/electron' : './electron';
const { resolvePaths, configure } = require(`${sourceRoot}/class/application-data`);
// 商店版 appData 已由系统映射到沙盒，不访问沙盒外的数据。
const paths = resolvePaths({ appData: app.getPath('appData'), isPackaged: app.isPackaged, mas: process.mas });
fs.mkdirSync(paths.runtimeDir, { recursive: true, mode: 0o700 });
app.setPath('userData', paths.runtimeDir);
if (paths.development) app.setName('寰宇运维（开发版）');

// 在恢复数据及加载服务之前取得本版本的单实例锁。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
const coordinator = configure(paths);
const Ps = require('ee-core/ps');
Ps.getRootDir = () => paths.runtimeDir;
const { applyPendingRestore } = require(`${sourceRoot}/class/data-backup`);
const { recoverPasswordChange, removeLegacyPassword } = require(`${sourceRoot}/class/password-change`);
let canStart = true;
if (gotLock) {
  try {
    coordinator.enter(alone => {
      if (alone) recoverPasswordChange(paths);
      if (alone) applyPendingRestore(paths);
      if (alone) removeLegacyPassword(paths);
      const { Sqlite } = require(`${sourceRoot}/class/sqlite`);
      new Sqlite({ initializeSchema: alone }).close();
    });
  } catch (error) {
    canStart = false;
    app.whenReady().then(() => {
      dialog.showErrorBox('暂时无法打开数据', `${error.message}\n\n原数据和备份已保留。`);
      app.exit(1);
    });
  }
  let left = false;
  const leave = () => {
    if (left) return;
    left = true;
    try { coordinator.leave(); } catch (_) { /* 异常退出留下的会话会在下次启动时回收。 */ }
  };
  app.once('quit', leave);
  process.once('exit', leave);
}
if (gotLock && canStart) {
  const { ElectronEgg } = require('ee-core');
  new ElectronEgg();
  // 第二次启动当前版本仍唤起已有窗口。
  app.on('second-instance', () => {
    const win = require('ee-core/electron').mainWindow;
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
}
