'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '../..');
const cacheDir = path.join(projectRoot, 'node_modules/.cache/bt-client');
const stateFile = path.join(cacheDir, 'package-build-state.json');
const force = process.argv.includes('--force');
const targetArg = process.argv.find(item => item.startsWith('--target='));
const target = targetArg ? targetArg.slice('--target='.length) : `${process.platform}-${process.arch}`;
const targetMatch = target.match(/^(darwin|win32|linux)-(x64|arm64|ia32|armv7l)$/);

if (!targetMatch) {
  throw new Error(`不支持的打包目标：${target}`);
}

const targetPlatform = targetMatch[1];
const targetArch = targetMatch[2];
if (targetPlatform !== process.platform) {
  throw new Error(`原生依赖不能在 ${process.platform} 上为 ${targetPlatform} 安全重编，请在目标系统执行打包`);
}

function normalize(file) {
  return file.split(path.sep).join('/');
}

function collectFiles(root, options = {}) {
  if (!fs.existsSync(root)) return [];
  const excludedDirectories = new Set(options.excludedDirectories || []);
  const excludedFiles = new Set(options.excludedFiles || []);
  const files = [];

  function walk(current) {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relativePath = normalize(path.relative(root, fullPath));
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(relativePath) && !excludedDirectories.has(entry.name)) walk(fullPath);
        continue;
      }
      if (excludedFiles.has(relativePath)) continue;
      if (!options.filter || options.filter(relativePath)) files.push(fullPath);
    }
  }

  walk(root);
  return files;
}

function hashFiles(files, base = projectRoot) {
  if (!files.length) return '';
  const hash = crypto.createHash('sha256');
  for (const file of files.slice().sort()) {
    hash.update(normalize(path.relative(base, file)));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function hashDirectory(directory, options) {
  return hashFiles(collectFiles(directory, options), directory);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败，退出码：${result.status}`);
}

function runNpm(script) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  run(npm, ['run', script]);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  } catch (_) {
    return {};
  }
}

function saveState(state) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const temporaryFile = `${stateFile}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporaryFile, stateFile);
}

function packageFingerprint(name) {
  const packageFile = path.join(projectRoot, 'node_modules', name, 'package.json');
  if (!fs.existsSync(packageFile)) throw new Error(`缺少依赖：${name}`);
  const data = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
  return { name, version: data.version, packageHash: hashFiles([packageFile]) };
}

function fileHashes(relativeFiles) {
  const result = {};
  for (const relativeFile of relativeFiles) {
    const file = path.join(projectRoot, relativeFile);
    if (!fs.existsSync(file)) return null;
    result[normalize(relativeFile)] = hashFiles([file], projectRoot);
  }
  return result;
}

function sameHashes(left, right) {
  if (!left || !right) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => left[key] === right[key]);
}

function prepareNativeDependencies(state) {
  const nativeModules = ['better-sqlite3', 'node-pty'];
  const nativeOutputs = [
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/node-pty/build/Release/pty.node',
  ];
  const electronVersion = packageFingerprint('electron').version;
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({
    schema: 1,
    target,
    electronVersion,
    rebuild: packageFingerprint('@electron/rebuild'),
    modules: [...nativeModules, 'cpu-features'].map(packageFingerprint),
  })).digest('hex');
  const outputHashes = fileHashes(nativeOutputs);
  const cacheHit = !force
    && state.native
    && state.native.fingerprint === fingerprint
    && sameHashes(state.native.outputs, outputHashes);

  if (cacheHit) {
    console.log(`[package] 原生依赖缓存命中：Electron ${electronVersion} / ${target}`);
    return;
  }

  console.log(`[package] 重编原生依赖：Electron ${electronVersion} / ${target}`);
  const executable = path.join(projectRoot, 'node_modules/.bin', process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild');
  run(executable, ['-f', '--only', nativeModules.join(','), '--arch', targetArch]);
  const rebuiltHashes = fileHashes(nativeOutputs);
  if (!rebuiltHashes) throw new Error('原生依赖重编完成，但未找到预期的 .node 产物');
  state.native = { fingerprint, outputs: rebuiltHashes };
  saveState(state);
}

function prepareFrontend(state) {
  const frontendRoot = path.join(projectRoot, 'frontend');
  const inputHash = hashDirectory(frontendRoot, { excludedDirectories: ['node_modules', 'dist'] });
  const publicDist = path.join(projectRoot, 'public/dist');
  const outputHash = hashDirectory(publicDist);
  const cacheHit = !force
    && inputHash
    && outputHash
    && state.frontend
    && state.frontend.inputHash === inputHash
    && state.frontend.outputHash === outputHash;

  if (cacheHit) {
    console.log('[package] 前端产物缓存命中');
    return;
  }

  console.log('[package] 前端源码已变化，执行生产构建');
  runNpm('build-frontend');
  const builtOutputHash = hashDirectory(publicDist);
  if (!builtOutputHash || !fs.existsSync(path.join(publicDist, 'index.html'))) {
    throw new Error('前端构建完成，但 public/dist 产物不完整');
  }
  state.frontend = { inputHash, outputHash: builtOutputHash };
  saveState(state);
}

function encryptedInputs() {
  const electronRoot = path.join(projectRoot, 'electron');
  return collectFiles(electronRoot, {
    filter: relativeFile => /\.(js|json)$/.test(relativeFile),
    excludedFiles: [
      'config/encrypt.js',
      'config/nodemon.json',
      'config/builder.json',
      'config/bin.json',
    ],
  });
}

function encryptionOutputsReady(inputs) {
  return inputs.every(input => {
    const relativeFile = path.relative(projectRoot, input);
    return fs.existsSync(path.join(projectRoot, 'public', relativeFile));
  });
}

function prepareEncryption(state) {
  const inputs = encryptedInputs();
  const toolFiles = [
    path.join(projectRoot, 'node_modules/ee-bin/package.json'),
    path.join(projectRoot, 'node_modules/javascript-obfuscator/package.json'),
  ];
  const inputHash = hashFiles([...inputs, ...toolFiles]);
  const publicElectron = path.join(projectRoot, 'public/electron');
  const outputHash = hashDirectory(publicElectron);
  const cacheHit = !force
    && outputHash
    && encryptionOutputsReady(inputs)
    && state.encryption
    && state.encryption.inputHash === inputHash
    && state.encryption.outputHash === outputHash;

  if (cacheHit) {
    console.log('[package] 主进程加密产物缓存命中');
    return;
  }

  console.log('[package] 主进程源码已变化，执行生产加密');
  runNpm('encrypt');
  const encryptedOutputHash = hashDirectory(publicElectron);
  if (!encryptedOutputHash || !encryptionOutputsReady(inputs)) {
    throw new Error('生产加密完成，但 public/electron 产物不完整');
  }
  state.encryption = { inputHash, outputHash: encryptedOutputHash };
  saveState(state);
}

function main() {
  const state = loadState();
  console.log(`[package] 准备 ${target} 安装包${force ? '（强制全量）' : ''}`);
  run(process.execPath, [path.join(projectRoot, 'build/scripts/download-aliyun-cli.js'), `--target=${target}`]);
  prepareNativeDependencies(state);
  prepareFrontend(state);
  prepareEncryption(state);
  console.log('[package] 打包资源准备完成');
}

try {
  main();
} catch (error) {
  console.error(`[package] ${error.message}`);
  process.exitCode = 1;
}
