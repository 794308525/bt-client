'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { atomicJson, readJson, updateJson } = require('./application-data');
const passwordKeys = ['password', 'password_salt', 'not_password', 'password_hash', 'init_password', 'password_setup_skipped'];

function passwordConfig(config) {
  const result = {};
  for (const key of passwordKeys) if (Object.prototype.hasOwnProperty.call(config, key)) result[key] = config[key];
  return result;
}

function applyPasswordConfig(config, values) {
  for (const key of passwordKeys) delete config[key];
  Object.assign(config, passwordConfig(values));
}

function journalPath(paths) {
  return path.join(paths.coordinationDir, 'password-change.json');
}

function writePasswordJournal(paths, journal) {
  atomicJson(journalPath(paths), journal);
}

function removePasswordJournal(paths) {
  fs.unlinkSync(journalPath(paths));
}

function removeLegacyPassword(paths) {
  const file = path.join(paths.dataDir, 'config.json');
  if (!fs.existsSync(file) || !Object.prototype.hasOwnProperty.call(readJson(file), 'init_password')) return;
  updateJson(file, config => { delete config.init_password; });
}

// 数据库提交和配置写入不能共用事务；启动时根据数据库中的提交标记恢复对应配置。
function recoverPasswordChange(paths) {
  const journal = readJson(journalPath(paths), null);
  if (!journal) return;
  if (!journal.id || !journal.previous || !journal.next) throw new Error('密码修改恢复记录无效');
  let committed = false;
  const dbFile = path.join(paths.dataDir, 'data.db');
  if (fs.existsSync(dbFile)) {
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try {
      const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='password_change_state'").get();
      if (table) committed = !!db.prepare('SELECT id FROM password_change_state WHERE id = ?').get(journal.id);
    } finally { db.close(); }
  }
  updateJson(path.join(paths.dataDir, 'config.json'), config => {
    applyPasswordConfig(config, committed ? journal.next : journal.previous);
  });
  removePasswordJournal(paths);
}

module.exports = { passwordConfig, applyPasswordConfig, writePasswordJournal, removePasswordJournal, recoverPasswordChange, removeLegacyPassword };
