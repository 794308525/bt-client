'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { CLI_MANIFEST, executableName } = require('../../electron/service/aliyun-cli.js');

const root = path.resolve(__dirname, '../extraResources/aliyun-cli');
const supportedKeys = Object.keys(CLI_MANIFEST).filter(key => !CLI_MANIFEST[key].unsupported);

function parseTargets() {
  const values = process.argv.slice(2)
    .flatMap(value => value.replace(/^--target=/, '').split(','))
    .map(value => value.trim())
    .filter(Boolean);
  if (!values.length) return [`${process.platform}-${process.arch}`];
  if (values.includes('all')) return supportedKeys;
  for (const key of values) {
    if (!CLI_MANIFEST[key]) throw new Error(`未知的阿里云 CLI 目标平台：${key}`);
    if (CLI_MANIFEST[key].unsupported) throw new Error(`目标平台 ${key} 的官方 CLI 架构不匹配，已禁用该平台能力`);
  }
  return Array.from(new Set(values));
}

function download(url, target) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        return download(response.headers.location, target).then(resolve, reject);
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`下载 CLI 失败：HTTP ${response.statusCode}`));
      }
      const stream = fs.createWriteStream(target, { mode: 0o755 });
      response.pipe(stream);
      stream.on('finish', () => stream.close(resolve));
      stream.on('error', error => {
        fs.rmSync(target, { force: true });
        reject(error);
      });
    });
    request.on('error', reject);
  });
}

function readBinaryInfo(file) {
  const data = fs.readFileSync(file);
  if (data.length < 64) throw new Error('CLI 文件过小，无法识别二进制格式');

  if (data[0] === 0x7f && data.toString('ascii', 1, 4) === 'ELF') {
    const littleEndian = data[5] === 1;
    const machine = littleEndian ? data.readUInt16LE(18) : data.readUInt16BE(18);
    return { platform: 'linux', arch: { 3: 'ia32', 62: 'x64', 183: 'arm64' }[machine] || `unknown-${machine}` };
  }

  const magic = data.readUInt32BE(0);
  if (magic === 0xcffaedfe || magic === 0xfeedfacf) {
    const littleEndian = magic === 0xcffaedfe;
    const cpuType = littleEndian ? data.readUInt32LE(4) : data.readUInt32BE(4);
    return { platform: 'darwin', arch: { 0x01000007: 'x64', 0x0100000c: 'arm64' }[cpuType] || `unknown-${cpuType}` };
  }

  if (data.toString('ascii', 0, 2) === 'MZ') {
    const headerOffset = data.readUInt32LE(0x3c);
    if (headerOffset + 6 > data.length || data.toString('ascii', headerOffset, headerOffset + 4) !== 'PE\0\0') {
      throw new Error('Windows CLI 的 PE 头无效');
    }
    const machine = data.readUInt16LE(headerOffset + 4);
    return { platform: 'win32', arch: { 0x014c: 'ia32', 0x8664: 'x64', 0xaa64: 'arm64' }[machine] || `unknown-${machine}` };
  }

  throw new Error('无法识别 CLI 二进制格式');
}

function verifyArchitecture(key, file) {
  const info = readBinaryInfo(file);
  const [platform, arch] = key.split('-');
  if (info.platform !== platform || info.arch !== arch) {
    fs.rmSync(file, { force: true });
    throw new Error(`${key} CLI 架构校验失败：实际为 ${info.platform}-${info.arch}`);
  }
}

async function main() {
  const targets = parseTargets();
  if (fs.existsSync(root)) {
    for (const entry of fs.readdirSync(root)) {
      if (!targets.includes(entry)) fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    }
  }
  for (const key of targets) {
    const item = CLI_MANIFEST[key];
    const dir = path.join(root, key);
    const file = path.join(dir, executableName(key));
    fs.mkdirSync(dir, { recursive: true });
    const exists = fs.existsSync(file);
    if (!exists) {
      process.stdout.write(`下载阿里云会话 CLI ${item.version || ''}：${key}\n`);
      await download(item.url, file);
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    if (actual !== item.sha256) {
      fs.rmSync(file, { force: true });
      throw new Error(`${key} CLI SHA256 校验失败：${actual}`);
    }
    verifyArchitecture(key, file);
    if (!key.startsWith('win32-')) fs.chmodSync(file, 0o755);
    process.stdout.write(`阿里云会话 CLI 校验通过：${key}\n`);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
