'use strict';

// 仅导出 DNS 记录数据，不包含源站鉴权信息。
const columns = [
  ['记录 ID', 'record_id', 24], ['主机记录', 'record_name', 32], ['类型', 'type', 12],
  ['记录值', 'value', 48], ['TTL', 'ttl', 12], ['代理', 'proxied', 12],
  ['源站类型', 'source_type', 16], ['备注', 'comment', 32], ['优先级', 'priority', 12],
  ['权重', 'weight', 12], ['端口', 'port', 12], ['Flag', 'flag', 12], ['Tag', 'tag', 16],
  ['接入 CNAME', 'record_cname', 40], ['更新时间', 'update_time', 24], ['类型附加数据', 'record_data', 48],
];

function recordValues(record) {
  return columns.map(([, key]) => {
    if (key === 'proxied') return record.proxied ? '开启' : '关闭';
    if (key === 'record_data') return JSON.stringify(record.record_data || {});
    if (key === 'priority' && !['MX', 'SRV', 'URI'].includes(record.type)) return '';
    if (['weight', 'port'].includes(key) && !['SRV', 'URI'].includes(record.type)) return '';
    if (['flag', 'tag'].includes(key) && record.type !== 'CAA') return '';
    return String(record[key] ?? '');
  });
}

async function buildEsaRecordExport(records, format) {
  const rows = records.map(recordValues);
  if (format === 'txt') {
    // JSON 字符串保留制表符、换行和反斜杠，确保每条记录占一行。
    return Buffer.from([columns.map(([title]) => title).join('\t'), ...rows.map(row => row.map(value => JSON.stringify(value)).join('\t'))].join('\r\n') + '\r\n', 'utf8');
  }
  if (format !== 'xlsx') throw new Error('不支持的解析导出格式');
  if (rows.some(row => row.some(value => value.length > 32767))) throw new Error('记录内容超过 Excel 单元格长度限制，请使用 TXT 格式导出');
  const ExcelJS = require('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('ESA 解析记录', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns.map(([header, key, width]) => ({ header, key, width, style: { numFmt: '@' } }));
  rows.forEach(row => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

module.exports = { buildEsaRecordExport };
