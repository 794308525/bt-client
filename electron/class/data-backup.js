'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const zlib = require('zlib');
const { access } = require('./application-data');

const FORMAT = 'huanyu-devops-backup';
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 4096;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const databaseClass = () => require('better-sqlite3');

// 应用启动后统一使用共享路径；恢复必须早于框架和数据库初始化。
function dataPaths(appPath, userData, argv = process.argv) {
  if (access()) return access().paths;
  const envArg = argv.filter(arg => arg.startsWith('--env=')).pop();
  const development = ['--env=local', '--env=dev', '--env=development'].includes(envArg);
  return {
    dataDir: path.join(development ? appPath : userData, 'data'),
    stateDir: path.join(userData, 'backup-state', development ? `dev-${hash(appPath).slice(0, 12)}` : 'installed'),
  };
}

function privateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}

function safeName(name) {
  if (typeof name !== 'string' || !name || name.length > 512 || /[\\:\x00-\x1f*?"<>|]/.test(name)
      || path.posix.isAbsolute(name) || path.posix.normalize(name) !== name
      || name.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('备份包含不安全的文件路径');
  }
  return name;
}

function walkData(directory, prefix = '') {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('数据目录包含符号链接，无法安全备份');
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    safeName(name);
    if (entry.isDirectory()) result.push(...walkData(path.join(directory, entry.name), name));
    else if (entry.isFile() && !/-(wal|shm|journal)$/.test(name)) result.push(name);
    else if (!entry.isFile()) throw new Error('数据目录包含不支持的特殊文件');
  }
  return result.sort();
}

function checkDatabase(file, main = false) {
  const Database = databaseClass();
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    const checks = db.prepare('PRAGMA quick_check').all();
    if (!checks.length || checks.some(row => Object.values(row)[0] !== 'ok')) throw new Error('数据库完整性检查失败');
    if (main) {
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name);
      if (!tables.includes('panel_info') || !tables.includes('ssh_info')) throw new Error('不是寰宇运维或 bt-client 的数据库');
    }
  } finally { db.close(); }
}

function validatePayload(payload) {
  if (!payload || !Array.isArray(payload.files) || !payload.files.length || payload.files.length > MAX_FILES) {
    throw new Error('备份文件列表无效');
  }
  const names = new Set();
  let total = 0;
  const files = payload.files.map(entry => {
    const name = safeName(entry.name);
    if (names.has(name.toLowerCase())) throw new Error('备份包含重复文件');
    names.add(name.toLowerCase());
    if (typeof entry.content !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.content)) throw new Error('备份文件内容无效');
    const content = Buffer.from(entry.content, 'base64');
    total += content.length;
    if (total > MAX_BYTES || entry.size !== content.length || hash(content) !== entry.sha256) throw new Error('备份校验失败或数据超过 256 MB');
    return { ...entry, name, content };
  });
  const configFile = files.find(entry => entry.name === 'config.json');
  if (!configFile || !files.some(entry => entry.name === 'data.db')) throw new Error('备份缺少数据库或相关配置');
  let config;
  try { config = JSON.parse(configFile.content.toString('utf8')); } catch (_) { throw new Error('备份中的配置文件无效'); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('备份中的配置文件无效');
  if (config.password && !/^[a-f0-9]{32}$/i.test(config.password)) throw new Error('备份中的管理密码配置无效');
  if (config.not_password === true && config.password && config.password_hash !== config.password) throw new Error('备份中的解密配置不完整');
  if (typeof payload.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(payload.appVersion)) throw new Error('备份版本信息无效');
  if (payload.schemaRevision !== undefined && (!Number.isSafeInteger(payload.schemaRevision) || payload.schemaRevision < 0)) throw new Error('备份数据结构信息无效');
  return { metadata: { createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : '', appVersion: payload.appVersion, sourceLabel: typeof payload.sourceLabel === 'string' ? payload.sourceLabel : '', fileCount: files.length }, files };
}

function encodeBackup(payload, password = '') {
  validatePayload(payload);
  const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(payload)));
  if (compressed.length > MAX_BYTES) throw new Error('备份超过 256 MB');
  const envelope = { format: FORMAT, formatVersion: 1, encrypted: Boolean(password) };
  if (password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Error('备份密码长度应为 8～256 位');
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = crypto.scryptSync(password, salt, 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    envelope.salt = salt.toString('base64');
    envelope.iv = iv.toString('base64');
    envelope.data = Buffer.concat([cipher.update(compressed), cipher.final()]).toString('base64');
    envelope.tag = cipher.getAuthTag().toString('base64');
    key.fill(0);
  } else envelope.data = compressed.toString('base64');
  return Buffer.from(JSON.stringify(envelope));
}

function readEnvelope(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES * 1.5) throw new Error('备份文件过大或不是普通文件');
  let envelope;
  try { envelope = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { throw new Error('无法识别备份文件'); }
  if (envelope.format !== FORMAT || envelope.formatVersion !== 1 || typeof envelope.encrypted !== 'boolean' || typeof envelope.data !== 'string') {
    throw new Error('不是支持的寰宇运维完整备份文件');
  }
  return envelope;
}

function decodeBackup(envelope, password = '') {
  if (!envelope || envelope.format !== FORMAT || envelope.formatVersion !== 1 || typeof envelope.encrypted !== 'boolean' || typeof envelope.data !== 'string') throw new Error('备份文件格式无效');
  if (typeof password !== 'string' || password.length > 256) throw new Error('备份密码格式无效');
  let packed = Buffer.from(envelope.data, 'base64');
  if (envelope.encrypted) {
    if (!password) throw new Error('请输入备份文件的密码');
    const salt = Buffer.from(envelope.salt || '', 'base64');
    const iv = Buffer.from(envelope.iv || '', 'base64');
    const tag = Buffer.from(envelope.tag || '', 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error('备份加密信息损坏');
    const key = crypto.scryptSync(password, salt, 32);
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(tag);
      packed = Buffer.concat([decipher.update(packed), decipher.final()]);
    } catch (_) { throw new Error('备份密码不正确，或文件已损坏'); }
    finally { key.fill(0); }
  }
  let payload;
  try { payload = JSON.parse(zlib.gunzipSync(packed, { maxOutputLength: MAX_BYTES * 1.5 }).toString('utf8')); }
  catch (_) { throw new Error('备份内容损坏或超过 256 MB'); }
  return { payload, ...validatePayload(payload) };
}

async function captureData(dataDir, appVersion, sourceLabel = '寰宇运维') {
  const assertPasswordReady = () => {
    const paths = access()?.paths;
    if (paths?.coordinationDir && fs.existsSync(path.join(paths.coordinationDir, 'password-change.json'))) {
      throw new Error('密码设置尚未恢复，请重新打开应用');
    }
  };
  assertPasswordReady();
  if (!fs.existsSync(path.join(dataDir, 'data.db')) || !fs.existsSync(path.join(dataDir, 'config.json'))) throw new Error('当前数据尚未初始化，无法创建完整备份');
  const names = walkData(dataDir);
  if (names.length > MAX_FILES) throw new Error('数据文件过多');
  if (names.reduce((size, name) => size + fs.statSync(path.join(dataDir, name)).size, 0) > MAX_BYTES) throw new Error('数据超过 256 MB，请先清理历史记录或录像');
  const fixedFiles = new Map(names.filter(name => !name.endsWith('.db')).map(name => [name, fs.readFileSync(path.join(dataDir, name))]));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'huanyu-data-snapshot-'));
  const files = [];
  let total = 0;
  try {
    for (const name of names) {
      let content = fixedFiles.get(name);
      if (name.endsWith('.db')) {
        const snapshot = path.join(temporary, name);
        privateDirectory(path.dirname(snapshot));
        const Database = databaseClass();
        const db = new Database(path.join(dataDir, name), { readonly: true, fileMustExist: true });
        try { await db.backup(snapshot); } finally { db.close(); }
        fs.chmodSync(snapshot, 0o600);
        checkDatabase(snapshot, name === 'data.db');
        content = fs.readFileSync(snapshot);
      }
      total += content.length;
      if (total > MAX_BYTES) throw new Error('数据超过 256 MB，请先清理历史记录或录像');
      files.push({ name, size: content.length, sha256: hash(content), content: content.toString('base64') });
    }
    for (const [name, content] of fixedFiles) {
      if (!fs.existsSync(path.join(dataDir, name)) || !content.equals(fs.readFileSync(path.join(dataDir, name)))) throw new Error('备份期间配置或文件发生变化，请停止相关操作后重试');
    }
    assertPasswordReady();
    const payload = { createdAt: new Date().toISOString(), appVersion, schemaRevision: access()?.revision || 0, sourceLabel, files };
    validatePayload(payload);
    return payload;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

function writeData(directory, decoded) {
  privateDirectory(directory);
  for (const entry of decoded.files) {
    const target = path.join(directory, entry.name);
    privateDirectory(path.dirname(target));
    fs.writeFileSync(target, entry.content, { mode: 0o600, flag: 'wx' });
  }
  for (const entry of decoded.files.filter(file => file.name.endsWith('.db'))) checkDatabase(path.join(directory, entry.name), entry.name === 'data.db');
}

async function prepareRestore(paths, decoded, appVersion) {
  privateDirectory(paths.stateDir);
  const pending = path.join(paths.stateDir, 'pending.json');
  if (fs.existsSync(pending)) throw new Error('已有待恢复的数据，请先重启应用');
  const job = crypto.randomBytes(12).toString('hex');
  const jobDir = path.join(paths.stateDir, job);
  privateDirectory(jobDir);
  try {
    writeData(path.join(jobDir, 'incoming'), decoded);
    const current = await captureData(paths.dataDir, appVersion, '导入前自动备份');
    const backupPath = path.join(paths.stateDir, `导入前备份-${new Date().toISOString().replace(/[:.]/g, '-')}.hybackup`);
    fs.writeFileSync(backupPath, encodeBackup(current), { mode: 0o600, flag: 'wx' });
    // 只保存校验清单；待恢复文件始终位于应用自己的目录，不依赖外部文件授权。
    atomicJson(path.join(jobDir, 'manifest.json'), decoded.payload.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })));
    atomicJson(pending, { job });
    return { backupPath };
  } catch (error) {
    fs.rmSync(jobDir, { recursive: true, force: true });
    throw error;
  }
}

function verifyStaged(directory, manifest) {
  if (!Array.isArray(manifest) || !manifest.length || manifest.length > MAX_FILES) throw new Error('恢复校验清单无效');
  for (const entry of manifest) {
    const file = path.join(directory, safeName(entry.name));
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error('恢复文件不能是符号链接');
    const data = fs.readFileSync(file);
    if (data.length !== entry.size || hash(data) !== entry.sha256) throw new Error('待恢复文件校验失败');
  }
  checkDatabase(path.join(directory, 'data.db'), true);
}

function applyPendingRestore(paths) {
  const pending = path.join(paths.stateDir, 'pending.json');
  if (!fs.existsSync(pending)) return false;
  const { job } = JSON.parse(fs.readFileSync(pending, 'utf8'));
  if (!/^[a-f0-9]{24}$/.test(job)) throw new Error('待恢复任务无效');
  const jobDir = path.join(paths.stateDir, job);
  const incoming = path.join(jobDir, 'incoming');
  const previous = path.join(jobDir, 'previous');
  const manifest = JSON.parse(fs.readFileSync(path.join(jobDir, 'manifest.json'), 'utf8'));
  // 上次若在目录切换后意外退出，验证完成状态后继续收尾。
  if (!fs.existsSync(incoming)) {
    verifyStaged(paths.dataDir, manifest);
    fs.unlinkSync(pending);
    return true;
  }
  verifyStaged(incoming, manifest);
  let movedPrevious = fs.existsSync(previous);
  try {
    if (fs.existsSync(paths.dataDir)) {
      if (movedPrevious) throw new Error('数据目录切换状态异常，已保留所有数据');
      fs.renameSync(paths.dataDir, previous);
      movedPrevious = true;
    }
    fs.renameSync(incoming, paths.dataDir);
  } catch (error) {
    if (!fs.existsSync(paths.dataDir) && movedPrevious) fs.renameSync(previous, paths.dataDir);
    throw error;
  }
  fs.unlinkSync(pending);
  return true;
}

module.exports = { dataPaths, encodeBackup, readEnvelope, decodeBackup, captureData, prepareRestore, applyPendingRestore };
