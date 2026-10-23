'use strict';

const DAY_MS = 86400000;
const CHINA_OFFSET = 8 * 3600000;

function serverTrafficKey(server) {
  return `${server.source}:${server.region_id}:${server.instance_id}`;
}

function trafficRange(days, now = Date.now()) {
  const today = Math.floor((now + CHINA_OFFSET) / DAY_MS) * DAY_MS - CHINA_OFFSET;
  return { start: today - (days - 1) * DAY_MS, end: now, today, days };
}

function trafficMonthRange(now = Date.now()) {
  const chinaNow = new Date(now + CHINA_OFFSET);
  const year = chinaNow.getUTCFullYear();
  const month = chinaNow.getUTCMonth();
  const monthStart = Date.UTC(year, month, 1) - CHINA_OFFSET;
  const start = Date.UTC(year, month - 1, 1) - CHINA_OFFSET;
  const today = trafficRange(1, now).today;
  return { start, end: now, today, days: (today - start) / DAY_MS + 1, monthStart };
}

function dateLabel(timestamp) {
  return new Date(timestamp + CHINA_OFFSET).toISOString().slice(0, 10);
}

function summarizeTrafficMonths(days, range) {
  const summarize = month => {
    const rows = days.filter(day => day.date.startsWith(`${month}-`));
    const sum = direction => {
      const values = rows.map(day => day[direction]).filter(value => value !== null);
      return values.length ? values.reduce((total, value) => total + value, 0) : null;
    };
    return {
      month,
      in_bytes: sum('in_bytes'),
      out_bytes: sum('out_bytes'),
      partial: !rows.length || rows.some(day => day.partial),
      data_time: Math.max(0, ...rows.map(day => day.data_time)),
    };
  };
  return { this_month: summarize(dateLabel(range.monthStart).slice(0, 7)), last_month: summarize(dateLabel(range.start).slice(0, 7)) };
}

// 云监控速率点按周期结束时间归属；跨北京时间零点的周期按实际时长拆分。
// 缺失点保留为空，不插值，也不把无数据当成零流量。
function aggregateTraffic(points, range, period, bytesPerUnit = 1 / 8) {
  const periodMs = period * 1000;
  const days = Array.from({ length: range.days }, (_, index) => ({
    date: dateLabel(range.start + index * DAY_MS),
    bytes: null,
    latest: 0,
    intervals: [],
  }));
  const seen = new Set();
  for (const point of points) {
    if (!point || typeof point !== 'object') continue;
    const rawTimestamp = point.timestamp ?? point.Timestamp;
    let timestamp = Number(rawTimestamp);
    if (timestamp > 0 && timestamp < 1e12) timestamp *= 1000;
    const rawValue = point.Average ?? point.average ?? point.Value ?? point.value;
    if (rawValue === null || rawValue === undefined || rawValue === '') continue;
    const value = Number(rawValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value) || value < 0) continue;
    const pointKey = `${timestamp}:${point.instanceId || ''}:${point.ip || ''}`;
    if (seen.has(pointKey)) continue;
    seen.add(pointKey);
    const start = Math.max(range.start, timestamp - periodMs);
    const end = Math.min(range.end, timestamp);
    if (start >= end || timestamp > range.end) continue;
    for (let cursor = start; cursor < end;) {
      const index = Math.floor((cursor - range.start) / DAY_MS);
      const next = Math.min(end, range.start + (index + 1) * DAY_MS);
      const day = days[index];
      day.bytes = (day.bytes ?? 0) + value * (next - cursor) / 1000 * bytesPerUnit;
      day.latest = Math.max(day.latest, timestamp);
      day.intervals.push([cursor, next]);
      cursor = next;
    }
  }
  return days.map((day, index) => {
    // 多个公网 IP 的采样覆盖时间取并集，避免重复计算完整度。
    const intervals = day.intervals.sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let end = 0;
    for (const interval of intervals) {
      covered += Math.max(0, interval[1] - Math.max(end, interval[0]));
      end = Math.max(end, interval[1]);
    }
    const expected = Math.max(0, Math.min(DAY_MS, Math.floor((range.end - range.start - index * DAY_MS) / periodMs) * periodMs));
    return { date: day.date, bytes: day.bytes === null ? null : Math.round(day.bytes), latest: day.latest, partial: day.bytes !== null && covered < expected };
  });
}

function combineTraffic(inbound, outbound) {
  return inbound.map((day, index) => ({
    date: day.date,
    in_bytes: day.bytes,
    out_bytes: outbound[index].bytes,
    partial: day.partial || outbound[index].partial || day.bytes === null || outbound[index].bytes === null,
    data_time: Math.max(day.latest, outbound[index].latest),
  }));
}

module.exports = { serverTrafficKey, trafficRange, trafficMonthRange, summarizeTrafficMonths, aggregateTraffic, combineTraffic };
