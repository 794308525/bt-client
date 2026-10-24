'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 数据结构调整时同步递增；不同结构的程序不得同时使用同一份数据。
const SCHEMA_REVISION = 1;
let current = null;
const heldLocks = new Set();
// 此模块也由渲染进程的预加载脚本引用，不能在加载时依赖受限的浏览器全局对象。
let pause;

function resolvePaths({ appData, isPackaged, mas = false }) {
  const sharedRoot = path.join(appData, 'bt-client');
  const development = !isPackaged && !mas;
  const runtimeDir = development ? path.join(appData, 'bt-client-dev') : sharedRoot;
  return {
    sharedRoot, runtimeDir, development, mas,
    dataDir: path.join(sharedRoot, 'data'),
    stateDir: path.join(sharedRoot, 'backup-state', 'installed'),
    coordinationDir: path.join(sharedRoot, 'data-access'),
  };
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporary, file);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

function lock(directory, action) {
  if (heldLocks.has(directory)) return action();
  fs.mkdirSync(path.dirname(directory), { recursive: true, mode: 0o700 });
  const started = Date.now();
  for (;;) {
    try { fs.mkdirSync(directory, { mode: 0o700 }); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let owner, previous;
      try {
        owner = readJson(path.join(directory, 'owner.json'), null);
        previous = fs.statSync(directory);
      } catch (readError) { if (readError.code === 'ENOENT') continue; throw readError; }
      // 先抢清理标记，避免两个进程同时回收同一把失效锁。
      const abandoned = owner ? !alive(owner.pid) : Date.now() - previous.mtimeMs > 15000;
      if (abandoned) {
        try {
          fs.mkdirSync(path.join(directory, 'reaping'));
          // 抢到清理标记后再核对，不能删除其他进程刚取得的新锁。
          const latest = fs.statSync(directory);
          const latestOwner = readJson(path.join(directory, 'owner.json'), null);
          if (latest.ino === previous.ino && latest.dev === previous.dev
              && (latestOwner ? !alive(latestOwner.pid) : !owner && Date.now() - previous.mtimeMs > 15000)) {
            fs.rmSync(directory, { recursive: true, force: true });
            continue;
          }
          fs.rmdirSync(path.join(directory, 'reaping'));
        } catch (cleanupError) { if (!['EEXIST', 'ENOENT'].includes(cleanupError.code)) throw cleanupError; }
      }
      if (Date.now() - started > 5000) throw new Error('另一版本正在写入数据，请稍后重试');
      if (process.type === 'renderer' || typeof SharedArrayBuffer !== 'function' || typeof Atomics === 'undefined') {
        throw new Error('另一版本正在写入数据，请稍后重试');
      }
      if (!pause) pause = new Int32Array(new SharedArrayBuffer(4));
      Atomics.wait(pause, 0, 0, 15);
    }
  }
  try {
    atomicJson(path.join(directory, 'owner.json'), { pid: process.pid });
    heldLocks.add(directory);
    return action();
  } finally {
    heldLocks.delete(directory);
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function updateJson(file, change) {
  const lockDir = current
    ? path.join(current.paths.coordinationDir, 'json-locks', crypto.createHash('sha256').update(path.resolve(file)).digest('hex'))
    : `${file}.lock`;
  return lock(lockDir, () => {
    const value = readJson(file);
    const result = change(value);
    atomicJson(file, value);
    return result;
  });
}

class DataAccess {
  constructor(paths, revision = SCHEMA_REVISION) {
    this.paths = paths;
    this.revision = revision;
    this.id = `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    this.sessionsDir = path.join(paths.coordinationDir, 'sessions');
    this.sessionFile = path.join(this.sessionsDir, `${this.id}.json`);
    this.maintenanceFile = path.join(paths.coordinationDir, 'maintenance.json');
    this.works = new Map();
  }

  gate(action) { return lock(path.join(this.paths.coordinationDir, 'gate'), action); }

  peers() {
    fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    const peers = [];
    for (const name of fs.readdirSync(this.sessionsDir).filter(name => name.endsWith('.json'))) {
      const file = path.join(this.sessionsDir, name);
      const session = readJson(file);
      if (!alive(session.pid)) { fs.unlinkSync(file); continue; }
      if (session.id !== this.id) peers.push(session);
    }
    // 老安装版没有会话登记，仍可从 Chromium 的单实例锁识别它。
    try {
      const link = fs.readlinkSync(path.join(this.paths.sharedRoot, 'SingletonLock'));
      const pid = Number(link.split('-').pop());
      if (pid !== process.pid && alive(pid) && !peers.some(peer => peer.pid === pid)) peers.push({ pid, legacy: true });
    } catch (error) { if (!['ENOENT', 'EINVAL'].includes(error.code)) throw error; }
    return peers;
  }

  checkMaintenance() {
    const owner = readJson(this.maintenanceFile, null);
    if (!owner) return;
    if (!alive(owner.pid)) { fs.unlinkSync(this.maintenanceFile); return; }
    if (owner.id !== this.id) throw new Error('另一版本正在恢复数据或修改密码，请完成后再启动');
  }

  enter(initialize) {
    return this.gate(() => {
      this.checkMaintenance();
      const peers = this.peers();
      if (peers.some(peer => peer.legacy)) throw new Error('正在运行的旧安装版尚不支持共享数据，请先退出旧版；同时运行需更新本地安装版');
      if (peers.some(peer => peer.revision !== this.revision)) throw new Error('两个版本的数据结构不兼容，请先退出另一版本再启动');
      if (peers.length && fs.existsSync(path.join(this.paths.stateDir, 'pending.json'))) throw new Error('有待恢复的数据，请先退出另一版本再启动');
      const schema = readJson(path.join(this.paths.coordinationDir, 'schema.json'), { revision: 0 });
      if (schema.revision > this.revision) throw new Error('数据已由更新版本升级，请升级当前程序');
      initialize(peers.length === 0);
      atomicJson(path.join(this.paths.coordinationDir, 'schema.json'), { revision: this.revision });
      atomicJson(this.sessionFile, { id: this.id, pid: process.pid, revision: this.revision });
    });
  }

  assertAlone() {
    if (this.peers().length) throw new Error('开发版和本地安装版正在共用数据，请先退出另一版本，再导入备份或修改管理密码');
    if (this.works.size) throw new Error('请先结束正在执行的任务，再导入备份或修改管理密码');
  }

  async exclusive(action) {
    this.gate(() => {
      this.checkMaintenance();
      if (fs.existsSync(this.maintenanceFile)) throw new Error('正在处理数据恢复或密码修改，请稍候');
      this.assertAlone();
      atomicJson(this.maintenanceFile, { id: this.id, pid: process.pid });
    });
    try { return await action(); }
    finally { this.gate(() => { if (readJson(this.maintenanceFile, {}).id === this.id) fs.unlinkSync(this.maintenanceFile); }); }
  }

  workFile(key) {
    const name = crypto.createHash('sha256').update(key).digest('hex');
    return path.join(this.paths.coordinationDir, 'work', `${name}.json`);
  }

  workOwner(key) {
    const file = this.workFile(key);
    const owner = readJson(file, null);
    if (owner && !alive(owner.pid)) { fs.unlinkSync(file); return null; }
    return owner;
  }

  claimWork(key) {
    this.gate(() => {
      this.checkMaintenance();
      if (fs.existsSync(this.maintenanceFile)) {
        const error = new Error('正在处理数据恢复或密码修改，请稍候');
        error.code = 'DATA_TASK_BUSY';
        throw error;
      }
      const owner = this.workOwner(key);
      if (owner && owner.id !== this.id) {
        const error = new Error('该任务正在另一版本中执行，请在启动任务的版本中操作');
        error.code = 'DATA_TASK_BUSY';
        throw error;
      }
      atomicJson(this.workFile(key), { id: this.id, pid: process.pid });
      this.works.set(key, (this.works.get(key) || 0) + 1);
    });
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.gate(() => {
        const count = (this.works.get(key) || 1) - 1;
        if (count) this.works.set(key, count);
        else {
          this.works.delete(key);
          if (this.workOwner(key)?.id === this.id) fs.unlinkSync(this.workFile(key));
        }
      });
    };
  }

  assertTaskOwner(key) {
    this.gate(() => {
      const owner = this.workOwner(key);
      if (owner && owner.id !== this.id) throw new Error('该任务正在另一版本中执行，请在启动任务的版本中操作');
    });
  }

  leave() {
    this.gate(() => {
      for (const key of this.works.keys()) if (this.workOwner(key)?.id === this.id) fs.unlinkSync(this.workFile(key));
      this.works.clear();
      if (fs.existsSync(this.sessionFile)) fs.unlinkSync(this.sessionFile);
      if (readJson(this.maintenanceFile, {}).id === this.id) fs.unlinkSync(this.maintenanceFile);
    });
  }
}

function configure(paths) {
  current = new DataAccess(paths);
  // Chromium 创建渲染进程时继承环境，预加载只读取路径，不登记另一份共享会话。
  process.env.BT_CLIENT_DATA_DIR = paths.dataDir;
  process.env.BT_CLIENT_RUNTIME_DIR = paths.runtimeDir;
  return current;
}
function processPaths() {
  if (current) return current.paths;
  const dataDir = process.env.BT_CLIENT_DATA_DIR, runtimeDir = process.env.BT_CLIENT_RUNTIME_DIR;
  return dataDir && runtimeDir ? { dataDir, runtimeDir } : null;
}
function access() { return current; }
const exclusive = action => current ? current.exclusive(action) : action();
const claimWork = key => current ? current.claimWork(key) : () => {};
const assertTaskOwner = key => { if (current) current.assertTaskOwner(key); };
function ifTaskIdle(key, action) {
  if (!current) return action();
  return current.gate(() => current.workOwner(key) || fs.existsSync(current.maintenanceFile) ? 0 : action());
}

module.exports = { resolvePaths, configure, access, processPaths, DataAccess, readJson, updateJson, atomicJson, exclusive, claimWork, assertTaskOwner, ifTaskIdle };
