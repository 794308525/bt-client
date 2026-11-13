'use strict';

// 使用 Electron 自带 Node 和临时数据库运行：ELECTRON_RUN_AS_NODE=1 <Electron> test/password-startup.test.js
const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const electron = { app: { exit: code => { electron.exitCode = code; }, getVersion: () => '1.2.21' }, dialog: { showErrorBox: () => { electron.dialogShown = true; } } };
const originalLoad = Module._load;
Module._load = function (name, parent, isMain) {
  if (name === 'ee-core') return { Controller: class {}, Service: class {} };
  if (name === 'electron-updater') return { autoUpdater: {} };
  if (name === 'electron') return electron;
  return originalLoad.call(this, name, parent, isMain);
};

const { configure, resolvePaths, atomicJson, exclusive } = require('../electron/class/application-data');
const { recoverPasswordChange, writePasswordJournal, removeLegacyPassword } = require('../electron/class/password-change');
const { captureData } = require('../electron/class/data-backup');
const { Sqlite } = require('../electron/class/sqlite');
const { pub } = require('../electron/class/public');
const IndexController = require('../electron/controller/index');
const UserService = require('../electron/service/user');
pub.lang = text => text;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bt-password-test-'));
const paths = resolvePaths({ appData: root, isPackaged: true });
fs.mkdirSync(paths.runtimeDir, { recursive: true });
configure(paths);
let response;
const event = { sender: { send: (_channel, result) => { response = result; } } };
const controller = new IndexController();
const args = data => ({ channel: 'test', data });

(async () => {
  try {
    const originalGetMac = pub.get_mac;
    pub.get_mac = () => { throw new Error('不应读取网卡'); };
    try { assert.deepEqual(new UserService().get_bind_info(), {}); }
    finally { pub.get_mac = originalGetMac; }
    assert.equal(fs.existsSync(path.join(paths.dataDir, 'user.json')), false);
    await controller.has_password(args({}), event);
    assert.equal(response.status, false);
    assert.equal(pub.C('password'), undefined);

    await controller.set_password(args({ password: 'first-password' }), event);
    assert.equal(response.status, true);
    assert.equal(pub.C('not_password'), false);
    assert.equal(pub.C('password_setup_skipped'), false);
    assert.equal(pub.C('init_password'), undefined);
    pub.C('init_password', 'legacy');
    removeLegacyPassword(paths);
    assert.equal(pub.C('init_password'), undefined);
    await controller.get_config(args({}), event);
    assert.equal(Object.hasOwn ? Object.hasOwn(response.data, 'password') : Object.prototype.hasOwnProperty.call(response.data, 'password'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(response.data, 'password_salt'), false);

    // 在隔离数据库中重置为空安装状态，验证跳过后继续设置密码。
    fs.unlinkSync(path.join(paths.dataDir, 'config.json'));
    global.password_hash = undefined;
    await controller.skip_password.call({}, args({}), event);
    assert.equal(response.status, true);
    assert.equal(pub.C('not_password'), true);
    assert.equal(pub.C('password_setup_skipped'), true);
    assert.equal(pub.C('password_hash'), global.password_hash);
    pub.M('panel_info').insert({ title: 'example', password: 'secret-value' });

    await controller.set_password(args({ password: 'chosen-password' }), event);
    assert.equal(response.status, true);
    assert.equal(pub.C('not_password'), false);
    assert.equal(pub.C('password_setup_skipped'), false);
    assert.equal(pub.M('panel_info').find().password, 'secret-value');
    assert.equal(pub.C('password'), pub.md5(pub.md5('chosen-password') + pub.C('password_salt')));
    assert.equal(pub.C('init_password'), undefined);

    const configBefore = pub.config_get();
    const hashBefore = global.password_hash;
    const originalUpdate = Sqlite.prototype.update;
    Sqlite.prototype.update = function () { throw new Error('模拟数据库写入失败'); };
    try { await controller.set_password(args({ password: 'another-password' }), event); }
    finally { Sqlite.prototype.update = originalUpdate; }
    assert.equal(response.status, false);
    assert.deepEqual(pub.config_get(), configBefore);
    assert.equal(global.password_hash, hashBefore);
    assert.equal(pub.M('panel_info').find().password, 'secret-value');

    // 提交后配置写入失败时，阻止继续操作并退出，重启恢复后保留新密码及数据。
    const originalRename = fs.renameSync;
    fs.renameSync = function (from, to) {
      if (to === path.join(paths.dataDir, 'config.json')) throw new Error('模拟配置写入失败');
      return originalRename.apply(this, arguments);
    };
    try { await controller.set_password(args({ password: 'recovered-password' }), event); }
    finally { fs.renameSync = originalRename; }
    assert.equal(electron.exitCode, 1);
    assert.equal(electron.dialogShown, true);
    assert.throws(() => new Sqlite(), /密码设置尚未恢复/);
    await assert.rejects(exclusive(() => true), /密码设置尚未恢复/);
    await assert.rejects(captureData(paths.dataDir, '1.2.21'), /密码设置尚未恢复/);
    recoverPasswordChange(paths);
    assert.equal(pub.C('password'), pub.md5(pub.md5('recovered-password') + pub.C('password_salt')));
    assert.equal(pub.M('panel_info').find().password, 'secret-value');

    // 模拟数据库提交后进程中断，启动恢复必须采用已提交的新配置。
    const recoveredConfig = pub.config_get();
    const next = { ...recoveredConfig, password_setup_skipped: true };
    const id = 'committed-test';
    const db = new Sqlite();
    writePasswordJournal(paths, { id, previous: recoveredConfig, next });
    db.DB_OBJ.prepare('DELETE FROM password_change_state').run();
    db.DB_OBJ.prepare('INSERT INTO password_change_state (id) VALUES (?)').run(id);
    db.close();
    recoverPasswordChange(paths);
    assert.equal(pub.C('password_setup_skipped'), true);

    // 模拟事务提交前中断，恢复旧配置。
    atomicJson(path.join(paths.dataDir, 'config.json'), next);
    writePasswordJournal(paths, { id: 'uncommitted-test', previous: recoveredConfig, next });
    recoverPasswordChange(paths);
    assert.deepEqual(pub.config_get(), recoveredConfig);
    console.log('密码初始化、加密数据迁移和中断恢复验证通过');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
