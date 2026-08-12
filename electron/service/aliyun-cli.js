'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CLI_MANIFEST = {
  'darwin-arm64': {
    url: 'https://aliyun-client-assist.oss-accelerate.aliyuncs.com/session-manager/mac_arm64/ali-instance-cli',
    sha256: 'c990b3fa836180c5c364322f3f56471a24657a5626ebfade2ab4700a826cad3a',
    version: '1.4.0.86',
  },
  'darwin-x64': {
    url: 'https://aliyun-client-assist.oss-accelerate.aliyuncs.com/session-manager/mac/ali-instance-cli',
    sha256: '9efd106a38c5c166eaa512927bdb0d9763a2a0e52960592a95c076d8ad304b19',
    version: '1.4.0.86',
  },
  'win32-x64': {
    url: 'https://aliyun-client-assist.oss-accelerate.aliyuncs.com/session-manager/windows/ali-instance-cli.exe',
    sha256: '5adb04d6348fd6d40dd3a245430539370b15fe9156d61afcd9c9863fb8d43803',
    version: '1.4.0.86',
  },
  'win32-arm64': { unsupported: true },
  'win32-ia32': { unsupported: true },
  'linux-arm64': {
    url: 'https://aliyun-client-assist.oss-cn-beijing.aliyuncs.com/session-manager/linux_arm/ali-instance-cli',
    sha256: '9458365b92ff50343f5b991f90f79e036430b562cab951f1e45cede2b6e0adfc',
    version: '1.4.0.86',
  },
  // 阿里云当前 linux 下载地址返回 i386 ELF，不能伪装成 x64。
  'linux-x64': {
    url: 'https://aliyun-client-assist.oss-accelerate.aliyuncs.com/session-manager/linux/ali-instance-cli',
    sha256: '57e88a9e3b15e2d76a609c2d902a083e6f199afb0937b23181c79babc9df6ae9',
    unsupported: true,
  },
  'linux-ia32': { unsupported: true },
  'linux-armv7l': { unsupported: true },
};

const TEMP_PREFIX = 'bt-client-aliyun-';
const tempRoots = new Set();

function platformKey() {
  return `${process.platform}-${process.arch}`;
}

function executableName(key = platformKey()) {
  return key.startsWith('win32-') ? 'ali-instance-cli.exe' : 'ali-instance-cli';
}

function resourceRoots() {
  return Array.from(new Set([
    process.resourcesPath && path.join(process.resourcesPath, 'aliyun-cli'),
    process.resourcesPath && path.join(process.resourcesPath, 'extraResources', 'aliyun-cli'),
    path.join(process.cwd(), 'build', 'extraResources', 'aliyun-cli'),
  ].filter(Boolean)));
}

function getCliPath() {
  const key = platformKey();
  const manifest = CLI_MANIFEST[key];
  if (!manifest || manifest.unsupported) {
    throw new Error(`当前平台 ${key} 暂不提供可运行的阿里云会话 CLI`);
  }
  const file = resourceRoots()
    .map(root => path.join(root, key, executableName(key)))
    .find(item => fs.existsSync(item));
  if (!file) throw new Error('阿里云会话 CLI 未打入当前安装包，请重新构建安装包');
  const actual = sha256(file);
  if (actual !== manifest.sha256) {
    throw new Error('阿里云会话 CLI 校验失败，请重新构建安装包');
  }
  return file;
}

function writePrivateFile(file, content) {
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, content, { mode: 0o600 });
  fs.chmodSync(temp, 0o600);
  fs.renameSync(temp, file);
  fs.chmodSync(file, 0o600);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function cleanupStale() {
  const root = os.tmpdir();
  for (const name of fs.readdirSync(root)) {
    if (!name.startsWith(TEMP_PREFIX)) continue;
    const file = path.join(root, name);
    try { fs.rmSync(file, { recursive: true, force: true }); } catch (_error) { /* ignore stale temp */ }
  }
}

class AliyunCliSession {
  constructor(options) {
    this.channel = options.channel;
    this.event = options.event;
    this.process = null;
    this.tempHome = '';
    this.sensitiveValues = [];
  }

  send(data) {
    let output = String(data);
    for (const value of this.sensitiveValues) {
      if (value) output = output.split(value).join('[已隐藏]');
    }
    if (this.event && this.event.sender && !this.event.sender.isDestroyed()) this.event.sender.send(this.channel, output);
  }

  start(options) {
    this.sensitiveValues = [String(options.accessKeyId || ''), String(options.accessKeySecret || '')].filter(Boolean);
    try {
      const pty = require('node-pty');
      const cliPath = getCliPath();
      this.tempHome = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
      fs.chmodSync(this.tempHome, 0o700);
      tempRoots.add(this.tempHome);
      const configDir = path.join(this.tempHome, '.aliyun');
      fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(configDir, 0o700);
      const configPath = path.join(configDir, 'config.json');
      writePrivateFile(configPath, JSON.stringify({
        current: 'bt-temp',
        profiles: [{
          name: 'bt-temp',
          mode: 'AK',
          access_key_id: options.accessKeyId,
          access_key_secret: options.accessKeySecret,
          region_id: options.regionId,
          output_format: 'json',
          language: 'zh',
          site: 'china',
        }],
        meta_path: '',
      }));
      const env = { ...process.env, HOME: this.tempHome, USERPROFILE: this.tempHome };
      this.process = pty.spawn(cliPath, [
        'session',
        '--profile', 'bt-temp',
        '--config-path', configPath,
        '--region', options.regionId,
        '--instance', options.instanceId,
        '--idle-timeout', '3600',
      ], {
        name: 'xterm-256color',
        cols: Number(options.cols) || 120,
        rows: Number(options.rows) || 32,
        cwd: this.tempHome,
        env,
        useConpty: process.platform === 'win32',
      });
      this.process.onData(data => this.send(data));
      this.process.onExit(({ exitCode }) => {
        this.send(`\r\n阿里云会话已关闭（退出码 ${exitCode}）\r\n`);
        this.cleanup();
      });
      return this;
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  write(data) { if (this.process) this.process.write(String(data)); }
  resize(cols, rows) {
    if (this.process && cols > 0 && rows > 0) this.process.resize(Number(cols), Number(rows));
  }
  disconnect() { this.cleanup(); }
  cleanup() {
    if (this.process) {
      try { this.process.kill(); } catch (_error) { /* already exited */ }
      this.process = null;
    }
    if (this.tempHome) {
      tempRoots.delete(this.tempHome);
      try { fs.rmSync(this.tempHome, { recursive: true, force: true }); } catch (_error) { /* best effort */ }
      this.tempHome = '';
    }
    this.sensitiveValues = [];
  }
}

cleanupStale();
process.once('exit', () => tempRoots.forEach(root => { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_error) {} }));

module.exports = { AliyunCliSession, CLI_MANIFEST, executableName, getCliPath, cleanupStale, sha256 };
