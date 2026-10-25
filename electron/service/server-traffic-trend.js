'use strict';

const DAY = 86400000;
const CHINA_OFFSET = 8 * 3600000;

function invalid(message) {
  const error = new Error(message);
  error.code = 'InvalidTrafficRange';
  throw error;
}

function timestamp(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d{13}$/.test(value)) return Number(value);
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

function normalizeTrendRange(options, profile, now = Date.now()) {
  const start = timestamp(options.start_time);
  const end = timestamp(options.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) invalid('请选择有效的开始和结束时间');
  if (end > now + 60000) invalid('结束时间不能晚于当前时间');
  if (end - start > 31 * DAY) invalid('单个时间区间最多查询 31 天');
  const span = end - start;
  const interval = options.interval === 'auto' || options.interval === undefined
    ? span <= 6 * 3600000 ? 60 : span <= 3 * DAY ? 300 : span <= 14 * DAY ? 3600 : 86400
    : Number(options.interval);
  if (![...profile.periods, 3600, 86400].includes(interval)) invalid('当前服务器不支持该采样粒度，请重新选择');
  const period = Math.max(...profile.periods.filter(value => value <= interval));
  if (!Number.isFinite(period)) invalid('当前监控指标没有可用的查询周期');
  if (Math.ceil(span / (period * 1000)) > 20160) invalid('当前粒度的数据量过大，请缩短时间区间或选择更粗的粒度');
  const historyDays = profile.source === 'swas' ? 30 : period === 60 ? 31 : 91;
  const checkHistory = value => {
    if (value < now - historyDays * DAY) invalid(`当前粒度最多查询最近 ${historyDays} 天，请调整时间区间或粒度`);
  };
  checkHistory(start);
  let comparison = null;
  if (options.comparison?.mode && options.comparison.mode !== 'off') {
    const mode = options.comparison.mode;
    const compareStart = mode === 'previous' ? start - span : mode === 'day' ? start - DAY
      : mode === 'week' ? start - 7 * DAY : mode === 'custom' ? timestamp(options.comparison.start_time) : NaN;
    if (!Number.isFinite(compareStart) || compareStart < 0) invalid('请选择有效的对比开始时间');
    const compareEnd = compareStart + span;
    if (compareEnd > now + 60000) invalid('对比结束时间不能晚于当前时间');
    if (compareStart === start) invalid('对比时段不能与当前时段完全相同');
    checkHistory(compareStart);
    comparison = { start: compareStart, end: compareEnd };
  }
  return { start, end, interval, period, history_days: historyDays, comparison };
}

function pointTime(point) {
  let value = Number(point.timestamp ?? point.Timestamp);
  if (value > 0 && value < 1e12) value *= 1000;
  return value;
}

function latestTime(points, range) {
  return points.reduce((latest, point) => {
    if (!point || typeof point !== 'object') return latest;
    const time = pointTime(point);
    const value = point.Average ?? point.average ?? point.Value ?? point.value;
    return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && time > range.start && time <= range.end
      ? Math.max(latest, time) : latest;
  }, 0);
}

// 时间戳代表采样周期的结束时刻；跨小时、跨北京时间零点的区间按实际时长拆分。
// 比较区间可使用相对本期平移后的桶边界，避免把不同时刻的日汇总直接相减。
function aggregateBuckets(points, range, period, interval, bytesPerUnit = 1 / 8, origin) {
  const size = interval * 1000;
  const base = origin ?? Math.floor((range.start + CHINA_OFFSET) / size) * size - CHINA_OFFSET;
  const buckets = Array.from({ length: Math.ceil((range.end - base) / size) }, (_, index) => ({
    start: Math.max(range.start, base + index * size),
    end: Math.min(range.end, base + (index + 1) * size),
    bytes: null,
    intervals: [],
    data_time: 0,
  }));
  const seen = new Set();
  let latestSample = 0;
  for (const point of points) {
    if (!point || typeof point !== 'object') continue;
    const time = pointTime(point);
    const raw = point.Average ?? point.average ?? point.Value ?? point.value;
    if (raw === null || raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (!Number.isFinite(time) || !Number.isFinite(value) || value < 0) continue;
    const key = `${time}:${point.instanceId || point.InstanceId || ''}:${point.ip || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const start = Math.max(range.start, time - period * 1000);
    const end = Math.min(range.end, time);
    if (start < end) latestSample = Math.max(latestSample, time);
    for (let cursor = start; cursor < end;) {
      const index = Math.floor((cursor - base) / size);
      const bucket = buckets[index];
      if (!bucket) break;
      const next = Math.min(end, bucket.end);
      if (next <= cursor) break;
      bucket.bytes = (bucket.bytes ?? 0) + value * (next - cursor) / 1000 * bytesPerUnit;
      bucket.intervals.push([cursor, next]);
      bucket.data_time = Math.max(bucket.data_time, time);
      cursor = next;
    }
  }
  return buckets.map(bucket => {
    let covered = 0;
    let lastEnd = 0;
    const segments = [];
    for (const [start, end] of bucket.intervals.sort((a, b) => a[0] - b[0])) {
      covered += Math.max(0, end - Math.max(lastEnd, start));
      if (segments.length && start <= lastEnd) segments[segments.length - 1][1] = Math.max(lastEnd, end);
      else segments.push([start, end]);
      lastEnd = Math.max(lastEnd, end);
    }
    const { intervals, ...result } = bucket;
    const completedEnd = latestSample >= range.end ? range.end : Math.floor(range.end / (period * 1000)) * period * 1000;
    const expected = Math.max(0, Math.min(bucket.end, completedEnd) - bucket.start);
    return { ...result, covered, expected, segments, partial: covered < expected, pending: bucket.end > completedEnd };
  });
}

function combineBuckets(inbound, outbound) {
  return inbound.map((point, index) => {
    let covered = 0;
    let left = 0;
    let right = 0;
    const other = outbound[index];
    while (left < point.segments.length && right < other.segments.length) {
      const a = point.segments[left];
      const b = other.segments[right];
      covered += Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
      if (a[1] < b[1]) left++;
      else right++;
    }
    return {
      start: point.start,
      end: point.end,
      in_bytes: point.bytes,
      out_bytes: other.bytes,
      partial: point.partial || other.partial,
      covered,
      expected: Math.max(point.expected, other.expected),
      pending: point.pending || other.pending,
      data_time: Math.max(point.data_time, other.data_time),
    };
  });
}

function buildView(directions, range, period, interval, bytesPerUnit = 1 / 8, alignment) {
  const base = duration => Math.floor(((alignment?.start ?? range.start) + CHINA_OFFSET) / duration) * duration - CHINA_OFFSET
    + (alignment ? range.start - alignment.start : 0);
  const build = bucketInterval => combineBuckets(...directions.map(points => aggregateBuckets(points, range, period, bucketInterval, bytesPerUnit, base(bucketInterval * 1000))));
  const points = build(interval);
  const days = build(86400);
  const sum = field => {
    const values = points.map(point => point[field]).filter(value => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    range,
    points,
    days,
    summary: {
      in_bytes: sum('in_bytes'),
      out_bytes: sum('out_bytes'),
      coverage: Math.min(1, points.reduce((total, point) => total + point.covered, 0) / Math.max(1, points.reduce((total, point) => total + point.expected, 0))),
      partial: points.some(point => point.partial),
    },
    data_time: Math.max(0, ...points.map(point => point.data_time)),
  };
}

function buildTrend(current, previous, range, bytesPerUnit = 1 / 8) {
  let effective = { start: range.start, end: range.end };
  let compareRange = range.comparison && { ...range.comparison };
  let aligned = false;
  if (previous && compareRange) {
    const currentEnd = Math.min(...current.map(points => latestTime(points, effective)));
    const previousEnd = Math.min(...previous.map(points => latestTime(points, compareRange)));
    const end = Math.min(range.end, currentEnd, range.start + previousEnd - compareRange.start);
    if (currentEnd && previousEnd && end > range.start) {
      effective.end = end;
      compareRange.end = compareRange.start + end - range.start;
      aligned = true;
    }
  }
  const main = buildView(current, effective, range.period, range.interval, bytesPerUnit);
  const comparison = previous && compareRange ? buildView(previous, compareRange, range.period, range.interval, bytesPerUnit, effective) : null;
  return {
    ...main,
    query_range: { start: range.start, end: range.end },
    interval: range.interval,
    sampling_period: range.period,
    comparison,
    aligned,
    comparable: !!comparison && aligned && !main.summary.partial && !comparison.summary.partial,
  };
}

module.exports = { normalizeTrendRange, aggregateBuckets, buildTrend };
