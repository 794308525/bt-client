'use strict';

const { Client, utils } = require('ssh2');
const { createHash } = require('crypto');
const { SocksClient } = require('socks');

function sshFailure(error) {
  if (error.kind) return error;
  const kind = error.level === 'client-authentication' ? 'authentication'
    : ['ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND'].includes(error.code) || ['client-socket', 'client-timeout'].includes(error.level) ? 'network' : 'ssh';
  return Object.assign(new Error(kind === 'authentication' ? 'SSH 认证失败，请核对用户名和密码 / 私钥' : kind === 'network' ? `SSH 网络连接失败（${error.code || error.level || '超时'}）` : 'SSH 握手或 Shell 创建失败，请检查服务器 SSH 服务'), { kind });
}

class CloudSshSession {
  constructor() {
    this.client = new Client();
    this.stream = null;
    this.closed = false;
    this.ready = false;
    this.buffer = [];
    this.bufferSize = 0;
    this.destination = null;
  }

  async connect(config) {
    if (config.auth_type === 1) {
      const parsed = utils.parseKey(config.private_key, config.key_password || undefined);
      if (parsed instanceof Error) throw Object.assign(new Error('私钥格式不正确，或私钥口令缺失 / 错误'), { kind: 'credentials' });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let offered = '';
      const fail = error => {
        if (settled) { this.closeMessage(error.message); return; }
        settled = true;
        clearTimeout(timer);
        reject(error);
        this.disconnect();
      };
      this.cancelConnect = () => fail(Object.assign(new Error('连接已取消'), { kind: 'cancelled' }));
      const timer = setTimeout(() => fail(Object.assign(new Error('SSH 连接超时，请检查端口、网络和 SSH 服务'), { kind: 'network' })), 25000);
      this.client.on('error', error => fail(offered && offered !== config.host_fingerprint
        ? Object.assign(new Error(config.host_fingerprint ? '服务器主机指纹已变化，请核对是否重装或更换了服务器' : '首次连接，请确认服务器主机指纹'), { kind: 'fingerprint', fingerprint: offered, changed: !!config.host_fingerprint })
        : sshFailure(error)));
      this.client.on('close', () => {
        if (!settled) fail(Object.assign(new Error('SSH 连接在认证完成前关闭'), { kind: 'network' }));
        else this.closeMessage('SSH 连接已关闭，请从服务器卡片重新连接');
      });
      this.client.on('ready', () => this.client.shell({ term: 'xterm-256color', cols: 100, rows: 30 }, (error, stream) => {
        if (error) return fail(Object.assign(new Error('认证通过，但服务器拒绝创建终端 Shell'), { kind: 'shell' }));
        if (this.closed) { stream.destroy(); return; }
        this.stream = stream;
        stream.on('data', chunk => {
          if (this.destination) this.send(chunk);
          else { this.buffer.push(Buffer.from(chunk)); this.bufferSize += chunk.length; if (this.bufferSize >= 256 * 1024) stream.pause(); }
        });
        stream.on('error', () => this.closeMessage('终端数据通道异常'));
        stream.on('close', () => this.disconnect());
        this.ready = true;
        settled = true;
        clearTimeout(timer);
        resolve(this);
      }));
      const options = {
        host: config.host, port: config.port, username: config.username,
        readyTimeout: 20000, keepaliveInterval: 20000, keepaliveCountMax: 3,
        hostVerifier: (key, callback) => { offered = `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`; callback(offered === config.host_fingerprint); },
        ...(config.auth_type === 1 ? { privateKey: config.private_key, passphrase: config.key_password || undefined } : { password: config.password }),
      };
      const begin = async () => {
        if (config.proxy) {
          let result;
          try { result = await SocksClient.createConnection({ proxy: config.proxy, command: 'connect', destination: { host: config.host, port: config.port }, timeout: 15000 }); }
          catch { throw Object.assign(new Error('SOCKS5 代理连接失败，请检查代理配置和网络'), { kind: 'proxy' }); }
          if (this.closed) { result.socket.destroy(); return; }
          this.proxySocket = result.socket;
          options.sock = result.socket;
        }
        if (!this.closed) this.client.connect(options);
      };
      begin().catch(error => fail(sshFailure(error)));
    });
  }

  send(data) {
    const target = this.destination;
    if (target && !target.sender.isDestroyed()) target.sender.send(target.channel, data);
  }

  attach(channel, sender) {
    if (!this.ready || this.closed) throw new Error('已建立的连接已经断开，请重新连接');
    this.destination = { channel, sender };
    this.send({ type: 'cloud-ssh-ready' });
    this.buffer.forEach(chunk => this.send(chunk));
    this.buffer = [];
    this.bufferSize = 0;
    this.stream.resume();
    return this;
  }

  resize(cols, rows) { if (this.stream) this.stream.setWindow(Math.max(1, rows || 30), Math.max(1, cols || 100), 0, 0); }
  write(data) { if (!this.closed && this.stream) this.stream.write(data); else this.send({ msg: '连接已断开，请从服务器卡片重新连接' }); }
  closeMessage(message) { if (this.destination) this.send({ msg: message }); this.disconnect(); }
  disconnect() {
    if (this.closed) return;
    this.closed = true;
    if (!this.ready && this.cancelConnect) this.cancelConnect();
    if (this.stream) this.stream.destroy();
    this.client.destroy();
    if (this.proxySocket) this.proxySocket.destroy();
    this.buffer = [];
    if (this.onClose) this.onClose();
  }
}

module.exports = { CloudSshSession, sshFailure };
