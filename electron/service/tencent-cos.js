'use strict';

const COS = require('cos-nodejs-sdk-v5');
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { finished } = require('stream/promises');
const { errorOf } = require('./tencent-errors');

function bucketScope(data) {
  const Bucket = String(data.bucket || '');
  const Region = String(data.region || '');
  if (!/^[a-z0-9][a-z0-9-]{0,60}-\d{5,20}$/.test(Bucket) || !/^[a-z]{2}-[a-z0-9-]{2,40}$/.test(Region)) throw new Error('请填写完整的 Bucket 名称（含 APPID 后缀）和地域');
  return { Bucket, Region };
}
function objectKey(value, empty = false) {
  const key = String(value == null ? '' : value);
  if ((!empty && !key) || Buffer.byteLength(key) > 850 || /[\x00-\x1f]/.test(key)) throw new Error('COS 对象路径不正确');
  return key;
}
class TencentCos {
  constructor(service) { this.service = service; }
  client(account) {
    return new COS({ SecretId: account.secret_id, SecretKey: account.secret_key, Protocol: 'https:', Timeout: 60000, FileParallelLimit: 2, ChunkParallelLimit: 2, ChunkRetryTimes: 0 });
  }
  call(client, method, params, account) {
    return new Promise((resolve, reject) => client[method](params, (error, result) => {
      if (error) {
        const normalized = errorOf(error, account);
        normalized.action = `cos:${({ request: 'GetService', getBucket: 'GetBucket', getObject: 'GetObject', deleteObject: 'DeleteObject', uploadFile: 'PutObject' })[method] || method}`;
        reject(normalized);
      } else resolve(result);
    }));
  }
  async buckets(account, data = {}) {
    // SDK 的 getService 会丢弃 IsTruncated/NextMarker，使用公开 request 接口保留分页信息。
    const result = await this.call(this.client(account), 'request', { Method: 'GET', Url: 'https://service.cos.myqcloud.com/', Query: { 'max-keys': data.probe ? 2000 : 100, marker: String(data.marker || '') } }, account);
    const root = result.ListAllMyBucketsResult;
    if (!root || typeof root !== 'object') throw new Error('COS 存储桶列表返回格式无效');
    const items = root.Buckets && root.Buckets.Bucket || [];
    const buckets = Array.isArray(items) ? items : [items];
    const truncated = String(root.IsTruncated) === 'true';
    if (truncated && !root.NextMarker) throw new Error('COS 分页标记缺失，无法确认存储桶数量');
    return { data: buckets.map(row => ({ name: row.Name, region: row.Location, created_at: row.CreationDate })), next_marker: truncated ? String(root.NextMarker) : '' };
  }
  async count(account) {
    let count = 0, marker = '';
    const seen = new Set();
    do {
      const result = await this.buckets(account, { marker, probe: true });
      count += result.data.length;
      marker = result.next_marker;
      if (marker && seen.has(marker)) throw new Error('COS 分页标记重复，无法确认完整数量');
      seen.add(marker);
      if (count >= 10000 && marker) return { count, partial: true };
    } while (marker);
    return { count };
  }
  async objects(account, data) {
    const result = await this.call(this.client(account), 'getBucket', { ...bucketScope(data), Prefix: objectKey(data.prefix, true), Marker: objectKey(data.marker, true), Delimiter: '/', MaxKeys: 100 }, account);
    const truncated = String(result.IsTruncated) === 'true';
    if (truncated && !result.NextMarker) throw new Error('COS 对象分页标记缺失，请刷新重试');
    return { data: (result.Contents || []).map(row => ({ name: row.Key, size: Number(row.Size), updated_at: row.LastModified, storage_class: row.StorageClass })),
      folders: (result.CommonPrefixes || []).map(row => row.Prefix), next_marker: truncated ? result.NextMarker : '' };
  }
  async upload(account, data, files) {
    const scope = bucketScope(data), prefix = objectKey(data.prefix, true);
    if (prefix && !prefix.endsWith('/')) throw new Error('上传目录须以 / 结尾');
    const client = this.client(account), results = [];
    for (const file of files) {
      const key = objectKey(prefix + path.basename(file));
      try {
        if (!this.service.isCurrent(account)) throw new Error('账号凭据已变更，上传已停止');
        await this.call(client, 'uploadFile', { ...scope, Key: key, FilePath: file }, account);
        results.push({ name: key, success: true });
      } catch (error) { results.push({ name: key, success: false, message: errorOf(error, account).message }); }
    }
    return { data: results, success_count: results.filter(row => row.success).length, failure_count: results.filter(row => !row.success).length };
  }
  async download(account, data, destination) {
    const temporary = `${destination}.${randomBytes(8).toString('hex')}.part`;
    const output = fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 });
    // 先挂流错误监听，下载完成前不覆盖用户选择的目标文件。
    const completion = finished(output);
    completion.catch(() => {});
    try {
      await this.call(this.client(account), 'getObject', { ...bucketScope(data), Key: objectKey(data.object_name), Output: output }, account);
      await completion;
      await fs.promises.rename(temporary, destination);
      return { canceled: false };
    } catch (error) {
      output.destroy();
      await completion.catch(() => {});
      await fs.promises.unlink(temporary).catch(() => {});
      throw error;
    }
  }
  async remove(account, data) {
    const scope = bucketScope(data);
    if (!Array.isArray(data.object_names) || !data.object_names.length || data.object_names.length > 100) throw new Error('请勾选 1～100 个文件');
    const keys = [...new Set(data.object_names.map(value => objectKey(value)))];
    if (data.confirm_bucket !== scope.Bucket) throw new Error('删除目标尚未确认');
    const client = this.client(account), results = [];
    for (const key of keys) {
      try {
        if (!this.service.isCurrent(account)) throw new Error('账号凭据已变更，删除已停止');
        await this.call(client, 'deleteObject', { ...scope, Key: key }, account);
        results.push({ name: key, success: true });
      } catch (error) { results.push({ name: key, success: false, message: errorOf(error, account).message }); }
    }
    return { data: results, success_count: results.filter(row => row.success).length, failure_count: results.filter(row => !row.success).length };
  }
}
module.exports = { TencentCos, bucketScope, objectKey };
