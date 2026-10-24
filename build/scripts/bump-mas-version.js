'use strict';

const fs = require('fs');
const path = require('path');

function releaseDate() {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

function nextVersion(version) {
  if (typeof version !== 'string' || !/^[1-9]\d{0,3}\.\d{1,2}\.\d{1,2}$/.test(version)) {
    throw new Error('商店版本号须使用有效的三段数字，例如 1.2.19');
  }
  let [major, minor, patch] = version.split('.').map(Number);
  patch += 1;
  if (patch > 99) { minor += 1; patch = 0; }
  if (minor > 99) { major += 1; minor = 0; }
  if (major > 9999) throw new Error('商店版本号超出支持范围');
  return `${major}.${minor}.${patch}`;
}

function bumpMasVersion(root, date = releaseDate()) {
  const packageFile = path.join(root, 'package.json');
  const packageText = fs.readFileSync(packageFile, 'utf8');
  const metadata = JSON.parse(packageText);
  const previousVersion = metadata.version;
  const version = nextVersion(previousVersion);
  metadata.version = version;
  const updates = [{ file: packageFile, text: `${JSON.stringify(metadata, null, 2)}\n` }];

  const lockFile = path.join(root, 'package-lock.json');
  if (fs.existsSync(lockFile)) {
    const lock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
    lock.version = version;
    if (lock.packages && lock.packages['']) lock.packages[''].version = version;
    updates.push({ file: lockFile, text: `${JSON.stringify(lock, null, 2)}\n` });
  }

  const changelogFile = path.join(root, 'frontend/src/views/setting/changelog.ts');
  const changelog = fs.readFileSync(changelogFile, 'utf8');
  const pending = /(version:\s*['"])unreleased(['"]\s*,\s*date:\s*['"])[^'"]*(['"])/;
  if (/version:\s*['"]unreleased['"]/.test(changelog) && !pending.test(changelog)) {
    throw new Error('待发布更新记录缺少日期，请先修正 changelog.ts');
  }
  const archived = changelog.replace(pending, (_, start, middle, end) => `${start}${version}${middle}${date}${end}`);
  if (archived !== changelog) updates.push({ file: changelogFile, text: archived });

  // 先读完并校验全部输入，再原子替换各文件，避免写入半个 JSON。
  for (const { file, text } of updates) {
    const temporary = `${file}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, text);
      fs.renameSync(temporary, file);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }
  return { previousVersion, version, changelogUpdated: archived !== changelog };
}

if (require.main === module) {
  try {
    const result = bumpMasVersion(path.resolve(__dirname, '../..'));
    console.log(`[mas] 商店打包版本：${result.previousVersion} → ${result.version}`);
    if (result.changelogUpdated) console.log('[mas] 待发布更新记录已归档');
  } catch (error) {
    console.error(`[mas] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { bumpMasVersion, nextVersion };
