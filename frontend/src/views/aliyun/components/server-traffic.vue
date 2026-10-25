<template>
	<el-dialog :model-value="modelValue" width="min(1180px, 96vw)" align-center destroy-on-close :close-on-click-modal="false" @update:model-value="emit('update:modelValue', $event)">
		<template #header>
			<div class="traffic-title"><strong>{{ server?.name || pub.lang('服务器') }} · {{ pub.lang('流量趋势') }}</strong><small>{{ server?.source === 'swas' ? pub.lang('轻量服务器') : 'ECS' }} · {{ server?.region_name || server?.region_id }} · {{ pub.lang('北京时间') }}</small></div>
		</template>
		<div class="server-traffic-detail">
			<div class="traffic-presets">
				<el-radio-group v-model="preset" size="small" :disabled="loading" @change="changePreset">
					<el-radio-button v-for="item in presets" :key="item.value" :label="item.value">{{ pub.lang(item.label) }}</el-radio-button>
				</el-radio-group>
				<el-button v-if="previousView" size="small" :disabled="loading" @click="goBack">{{ pub.lang('返回原区间') }}</el-button>
			</div>
			<div class="traffic-filters">
				<label class="traffic-range"><span>{{ pub.lang('时间区间') }}</span><el-date-picker v-model="dates" type="datetimerange" size="small" format="YYYY-MM-DD HH:mm" :start-placeholder="pub.lang('开始时间')" :end-placeholder="pub.lang('结束时间')" :disabled="loading" :disabled-date="futureDate" @change="changeFilters" /></label>
				<label class="traffic-interval"><span>{{ pub.lang('统计粒度') }}</span><el-select v-model="interval" size="small" :disabled="loading" @change="changeFilters"><el-option :label="pub.lang('自动')" value="auto" /><el-option v-for="value in allowedIntervals" :key="value" :value="value" :label="intervalLabel(value)" /></el-select></label>
				<div class="traffic-actions"><el-button type="primary" size="small" :loading="loading" :disabled="!!rangeError" @click="query()">{{ pub.lang('查询') }}</el-button><el-button :icon="Refresh" size="small" :disabled="loading || !!rangeError" :title="pub.lang('强制刷新监控数据')" @click="query(true)" /></div>
			</div>
			<div class="traffic-compare">
				<el-switch v-model="compareEnabled" size="small" :disabled="loading" :active-text="pub.lang('开启时间对比')" @change="queryOnChange" />
				<template v-if="compareEnabled">
					<el-select v-model="compareMode" size="small" :disabled="loading" class="traffic-compare-mode" @change="queryOnChange"><el-option v-for="item in compareOptions" :key="item.value" :value="item.value" :label="pub.lang(item.label)" /></el-select>
					<el-date-picker v-if="compareMode === 'custom'" v-model="compareStart" type="datetime" size="small" format="YYYY-MM-DD HH:mm" :placeholder="pub.lang('对比开始时间')" :disabled="loading" :disabled-date="futureDate" @change="queryOnChange" />
					<span v-if="comparisonRange" class="traffic-muted">{{ timeText(comparisonRange[0]) }} — {{ timeText(comparisonRange[1]) }}</span>
				</template>
			</div>
			<el-alert v-if="rangeError || error" :title="rangeError || error" type="error" :closable="false" show-icon />
			<el-alert v-if="dirty" :title="pub.lang('查询条件已调整，点击查询更新图表')" type="info" :closable="false" show-icon />
			<div v-loading="loading" :element-loading-text="pub.lang('正在读取监控数据…')" class="traffic-results">
				<template v-if="data">
					<el-alert v-if="errorText" :title="errorText" type="warning" :closable="false" show-icon />
					<p v-if="data.notes.length" class="traffic-notes">{{ data.notes.join('；') }}</p>
					<div class="traffic-totals">
						<div v-for="direction in directions" :key="direction.key"><span>{{ pub.lang(direction.label) }}</span><strong :class="direction.key === 'in_bytes' ? 'inbound' : 'outbound'">{{ formatServerTraffic(data.summary[direction.key]) }}</strong><small v-if="data.comparison">{{ pub.lang('对比') }} {{ formatServerTraffic(data.comparison.summary[direction.key]) }}<b>{{ changeText(data.summary[direction.key], data.comparison.summary[direction.key], data.comparable) }}</b></small></div>
						<div><span>{{ pub.lang('数据完整度') }}</span><strong>{{ percentage(data.summary.coverage) }}</strong><small v-if="data.comparison">{{ pub.lang('对比') }} {{ percentage(data.comparison.summary.coverage) }}</small><small v-else>{{ pub.lang('按入站、出站共同覆盖的采样时长统计') }}</small></div>
					</div>
					<div class="traffic-chart-heading">
						<div><strong>{{ intervalLabel(data.interval) }}{{ pub.lang('流量趋势') }}</strong><small>{{ timeText(data.range.start) }} — {{ timeText(data.range.end) }}</small></div>
						<div class="traffic-legend"><button v-for="line in series" :key="line.key" type="button" :class="{ muted: !visibility[line.key] }" :aria-pressed="visibility[line.key]" @click="visibility[line.key] = !visibility[line.key]"><i :style="{ borderColor: line.color, borderStyle: line.compared ? 'dashed' : 'solid' }" />{{ line.label }}</button></div>
					</div>
					<div v-if="hasData" class="traffic-chart">
						<div class="traffic-axis"><span>{{ formatServerTraffic(chartMax) }}</span><span>{{ formatServerTraffic(chartMax / 2) }}</span><span>0</span></div>
						<div class="traffic-plot" @mousemove="moveChart" @mouseleave="hoverIndex = null">
							<svg viewBox="0 0 1000 260" preserveAspectRatio="none" role="img" :aria-label="pub.lang('入站和出站流量趋势')">
								<line v-for="y in [12, 70, 128, 186, 244]" :key="y" x1="0" :y1="y" x2="1000" :y2="y" class="traffic-grid" />
								<path v-for="line in chartLines" :key="line.key" :d="line.path" fill="none" :stroke="line.color" :stroke-dasharray="line.compared ? '7 5' : undefined" stroke-width="2" vector-effect="non-scaling-stroke" />
								<line v-if="hoverIndex !== null" :x1="chartX(hoverIndex)" y1="0" :x2="chartX(hoverIndex)" y2="260" class="traffic-crosshair" />
							</svg>
							<div v-if="hoverIndex !== null && hoverPoint" class="traffic-tooltip" :class="{ 'is-left': hoverRatio > 65 }" :style="{ left: hoverRatio + '%' }">
								<strong>{{ timeText(hoverPoint.start) }} — {{ timeText(hoverPoint.end) }}</strong><small v-if="hoverComparison">{{ pub.lang('对比') }} {{ timeText(hoverComparison.start) }} — {{ timeText(hoverComparison.end) }}</small>
								<span v-for="line in series.filter(item => visibility[item.key])" :key="line.key"><i :style="{ background: line.color }" />{{ line.label }}<b>{{ formatServerTraffic(line.points[hoverIndex]?.[line.direction]) }}</b></span>
								<small v-if="hoverPoint.partial || hoverComparison?.partial">{{ pub.lang('此时段数据不完整，不计算变化比例') }}</small>
								<small v-else-if="hoverPoint.pending">{{ pub.lang('尚未结束的采样周期正在更新') }}</small>
							</div>
						</div>
					</div>
					<el-empty v-else :description="pub.lang('当前时段暂无可用监控数据')" :image-size="64" />
					<div v-if="hasData" class="traffic-date-labels"><span v-for="label in chartLabels" :key="label.index">{{ label.text }}</span></div>
					<p class="traffic-caption">{{ pub.lang('根据监控平均速率估算流量，缺失数据保留为空，不等同于账单。完整度按已完成采样周期计算。') }} {{ pub.lang('原始采样') }}：{{ intervalLabel(data.sampling_period) }}<template v-if="data.data_time"> · {{ pub.lang('最新监控') }} {{ timeText(data.data_time) }}</template><template v-if="data.cached"> · {{ pub.lang('缓存数据') }}</template></p>
					<p v-if="data.comparison" class="traffic-caption">{{ data.aligned ? pub.lang('已按双方可用监控时间对齐，截至') + ' ' + timeText(data.range.end) : pub.lang('缺少可对齐的历史数据，暂不计算变化比例') }}<template v-if="data.aligned && !data.comparable"> · {{ pub.lang('存在缺失采样，整体变化比例暂不可比较') }}</template></p>
					<el-collapse v-model="dailyOpen" class="traffic-daily">
						<el-collapse-item name="days">
							<template #title><strong>{{ pub.lang('每日汇总') }}</strong><span class="traffic-muted traffic-daily-hint">{{ pub.lang('点击日期查看当天小时趋势') }}</span></template>
							<el-table :data="dailyRows" size="small" max-height="280" row-key="start">
								<el-table-column :label="pub.lang('日期')" min-width="145"><template #default="{ row }"><el-button link type="primary" :disabled="loading || dirty" @click="drillDay(row)">{{ dateText(row.start) }}</el-button><small v-if="row.start > chinaMidnight(row.start) || row.end < chinaMidnight(row.start) + DAY" class="traffic-cell-note">{{ pub.lang('部分时段') }}</small></template></el-table-column>
								<el-table-column v-if="data.comparison" :label="pub.lang('对比时段')" min-width="190"><template #default="{ row }"><span v-if="row.comparison">{{ timeText(row.comparison.start) }}<br />— {{ timeText(row.comparison.end) }}</span><span v-else>--</span></template></el-table-column>
								<el-table-column v-for="direction in directions" :key="direction.key" :label="pub.lang(direction.label)" min-width="145"><template #default="{ row }"><span :class="direction.key === 'in_bytes' ? 'inbound' : 'outbound'">{{ formatServerTraffic(row[direction.key]) }}</span><small v-if="data.comparison" class="traffic-cell-note">{{ pub.lang('对比') }} {{ formatServerTraffic(row.comparison?.[direction.key]) }}</small></template></el-table-column>
								<template v-if="data.comparison"><el-table-column v-for="direction in directions" :key="direction.key + '-change'" :label="pub.lang(direction.key === 'in_bytes' ? '入站变化' : '出站变化')" min-width="145"><template #default="{ row }">{{ changeText(row[direction.key], row.comparison?.[direction.key], !!row.comparison && !row.partial && !row.comparison.partial && data.aligned) }}</template></el-table-column></template>
								<el-table-column :label="pub.lang('数据状态')" min-width="110"><template #default="{ row }">{{ row.in_bytes === null && row.out_bytes === null ? pub.lang('无数据') : row.partial ? pub.lang('数据不完整') : row.end < chinaMidnight(row.start) + DAY ? pub.lang('累计中') : pub.lang('完整') }}</template></el-table-column>
							</el-table>
						</el-collapse-item>
					</el-collapse>
				</template>
				<el-empty v-else-if="!loading && !error" :description="pub.lang('选择时间和粒度后查询流量趋势')" :image-size="64" />
			</div>
		</div>
	</el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import timezone from 'dayjs/plugin/timezone'
import { common, routes } from '@api/http'
import { pub } from '@utils/tools'
import { formatServerTraffic, serverTrafficKey, type TrafficBucket, type TrafficServer, type ServerTrafficTrend } from '@utils/server-traffic'

dayjs.extend(utc)
dayjs.extend(timezone)
const props = defineProps<{ modelValue: boolean; accountId: number; server: TrafficServer | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const DAY = 86400000
const chinaMidnight = (value: number) => Math.floor((value + 8 * 3600000) / DAY) * DAY - 8 * 3600000
const toPicker = (value: number) => new Date(dayjs(value).tz('Asia/Shanghai').format('YYYY-MM-DDTHH:mm:ss'))
const fromPicker = (value: Date) => dayjs.tz(dayjs(value).format('YYYY-MM-DD HH:mm:ss'), 'Asia/Shanghai').valueOf()
const timeText = (value: number) => dayjs(value).tz('Asia/Shanghai').format('MM-DD HH:mm')
const dateText = (value: number) => dayjs(value).tz('Asia/Shanghai').format('YYYY-MM-DD')
const futureDate = (value: Date) => fromPicker(value) > Date.now()
const percentage = (value: number) => (value * 100).toFixed(1) + '%'
const intervalLabel = (value: number) => pub.lang(({ 60: '1 分钟', 300: '5 分钟', 900: '15 分钟', 3600: '按小时', 86400: '按天' } as Record<number, string>)[value] || String(value) + ' 秒')
const directions = [{ key: 'in_bytes', label: '入站流量' }, { key: 'out_bytes', label: '出站流量' }] as const
const presets = [{ value: '1h', label: '近1小时' }, { value: '6h', label: '近6小时' }, { value: '24h', label: '近24小时' }, { value: 'today', label: '今天' }, { value: 'yesterday', label: '昨天' }, { value: '7d', label: '近7天·小时' }, { value: '30d', label: '近30天·每日' }]
const compareOptions = [{ value: 'previous', label: '上一等长时段' }, { value: 'day', label: '前一天同时间段' }, { value: 'week', label: '上周同时间段' }, { value: 'custom', label: '自定义开始时间' }]
const data = ref<ServerTrafficTrend | null>(null)
const dates = ref<[Date, Date] | null>(null)
const interval = ref<number | 'auto'>(3600)
const preset = ref('7d')
const compareEnabled = ref(false)
const compareMode = ref('previous')
const compareStart = ref<Date | null>(null)
const loading = ref(false)
const error = ref('')
const dailyOpen = ref(['days'])
const hoverIndex = ref<number | null>(null)
const visibility = ref<Record<string, boolean>>({ in: true, out: true, compareIn: true, compareOut: true })
let requestId = 0
const signatureAtQuery = ref('')
interface PreviousView { dates: [Date, Date]; interval: number | 'auto'; preset: string; compareEnabled: boolean; compareMode: string; compareStart: Date | null }
const previousView = ref<PreviousView | null>(null)
const bounds = computed(() => dates.value?.length === 2 ? dates.value.map(fromPicker) as [number, number] : null)
const nativePeriods = computed(() => data.value?.capabilities.periods || (props.server?.source === 'swas' ? [60, 300, 900] : props.server?.eip_id ? [60, 300] : [60, 300, 3600]))
const allowedIntervals = computed(() => [...new Set([...nativePeriods.value, 3600, 86400])].sort((a, b) => a - b))
const comparisonRange = computed(() => {
	if (!compareEnabled.value || !bounds.value) return null
	const [start, end] = bounds.value, span = end - start
	const value = compareMode.value === 'previous' ? start - span : compareMode.value === 'day' ? start - DAY : compareMode.value === 'week' ? start - 7 * DAY : compareStart.value ? fromPicker(compareStart.value) : NaN
	return Number.isFinite(value) ? [value, value + span] as [number, number] : null
})
const rangeError = computed(() => {
	if (!bounds.value || bounds.value.some(value => !Number.isFinite(value))) return pub.lang('请选择时间区间')
	const [start, end] = bounds.value
	if (end <= start) return pub.lang('结束时间必须晚于开始时间')
	if (end > Date.now() + 60000) return pub.lang('结束时间不能晚于当前时间')
	if (end - start > 31 * DAY) return pub.lang('单个时间区间最多查询31天')
	const chosen = interval.value === 'auto' ? end - start <= 6 * 3600000 ? 60 : end - start <= 3 * DAY ? 300 : end - start <= 14 * DAY ? 3600 : 86400 : interval.value
	const sample = Math.max(...nativePeriods.value.filter(value => value <= chosen))
	const history = props.server?.source === 'swas' ? 30 : sample === 60 ? 31 : 91
	if (start < Date.now() - history * DAY) return pub.lang('当前粒度最多查询最近' + history + '天')
	if ((end - start) / (sample * 1000) > 20160) return pub.lang('当前粒度的数据量过大，请缩短区间或选择更粗粒度')
	if (compareEnabled.value) {
		if (!comparisonRange.value) return pub.lang('请选择对比开始时间')
		if (comparisonRange.value[0] < Date.now() - history * DAY) return pub.lang('对比时段超出最近' + history + '天的监控保留范围')
		if (comparisonRange.value[1] > Date.now() + 60000) return pub.lang('对比结束时间不能晚于当前时间')
		if (comparisonRange.value[0] === start) return pub.lang('对比时段不能与当前时段完全相同')
	}
	return ''
})
const signature = computed(() => JSON.stringify([bounds.value, interval.value, compareEnabled.value, compareMode.value, comparisonRange.value]))
const dirty = computed(() => !!data.value && signature.value !== signatureAtQuery.value)
const errorText = computed(() => [...new Set(data.value?.errors.map(item => (item.comparison ? pub.lang('对比时段') + '：' : '') + item.message) || [])].join('；'))
const dailyRows = computed(() => (data.value?.days || []).map((row, index) => ({ ...row, comparison: data.value?.comparison?.days[index] })).reverse())
const changeText = (value: number | null | undefined, base: number | null | undefined, comparable: boolean) => {
	if (!comparable || value == null || base == null) return '--'
	const delta = value - base
	const text = (delta > 0 ? '+' : delta < 0 ? '−' : '') + formatServerTraffic(Math.abs(delta))
	return base === 0 ? text + ' · ' + pub.lang('基准为零') : text + ' (' + (delta > 0 ? '+' : '') + (delta / base * 100).toFixed(1) + '%)'
}
const series = computed(() => {
	const current = data.value?.points || []
	const lines = [{ key: 'in', label: pub.lang(data.value?.comparison ? '本期入站' : '入站'), direction: 'in_bytes' as 'in_bytes' | 'out_bytes', color: '#409eff', compared: false, points: current }, { key: 'out', label: pub.lang(data.value?.comparison ? '本期出站' : '出站'), direction: 'out_bytes' as 'in_bytes' | 'out_bytes', color: '#67c23a', compared: false, points: current }]
	if (data.value?.comparison) lines.push({ key: 'compareIn', label: pub.lang('对比入站'), direction: 'in_bytes', color: '#409eff', compared: true, points: data.value.comparison.points }, { key: 'compareOut', label: pub.lang('对比出站'), direction: 'out_bytes', color: '#67c23a', compared: true, points: data.value.comparison.points })
	return lines
})
const hasData = computed(() => series.value.some(line => line.points.some(point => point[line.direction] !== null)))
const chartMax = computed(() => {
	let max = 1
	for (const line of series.value) if (visibility.value[line.key]) for (const point of line.points) max = Math.max(max, point[line.direction] || 0)
	return max * 1.05
})
const chartX = (index: number) => 8 + index / Math.max(1, (data.value?.points.length || 0) - 1) * 984
const chartLines = computed(() => series.value.filter(line => visibility.value[line.key]).map(line => {
	let connected = false
	const path = line.points.map((point, index) => {
		const value = point[line.direction]
		if (value === null) { connected = false; return '' }
		const command = connected ? 'L' : 'M'
		connected = true
		return command + chartX(index).toFixed(2) + ',' + (244 - value / chartMax.value * 232).toFixed(2) + 'l0.5,0'
	}).join(' ')
	return { ...line, path }
}))
const chartLabels = computed(() => {
	const rows = data.value?.points || []
	const indices = [...new Set([0, 1, 2, 3, 4].map(value => Math.round(value / 4 * (rows.length - 1))))].filter(index => rows[index])
	return indices.map(index => ({ index, text: data.value?.interval === 86400 ? dayjs(rows[index].start).tz('Asia/Shanghai').format('MM-DD') : timeText(rows[index].start) }))
})
const hoverPoint = computed(() => hoverIndex.value === null ? null : data.value?.points[hoverIndex.value])
const hoverComparison = computed(() => hoverIndex.value === null ? null : data.value?.comparison?.points[hoverIndex.value])
const hoverRatio = computed(() => (hoverIndex.value || 0) / Math.max(1, (data.value?.points.length || 0) - 1) * 100)
const moveChart = (event: MouseEvent) => {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, ((event.clientX - rect.left) / rect.width * 1000 - 8) / 984))
	hoverIndex.value = Math.round(ratio * Math.max(0, (data.value?.points.length || 0) - 1))
}
const selectPreset = (value: string | number | boolean) => {
	const key = String(value), end = Math.floor(Date.now() / 60000) * 60000, today = chinaMidnight(end)
	let start = end - DAY, finish = end
	if (key === '1h') start = end - 3600000
	if (key === '6h') start = end - 6 * 3600000
	if (key === 'today') start = today
	if (key === 'yesterday') { start = today - DAY; finish = today }
	if (key === '7d') start = today - 6 * DAY
	if (key === '30d') start = today - 29 * DAY
	dates.value = [toPicker(start), toPicker(finish)]
	interval.value = key === '7d' ? 3600 : key === '30d' ? 86400 : 'auto'
}
const query = async (force = false) => {
	if (!props.server || !props.modelValue || loading.value) return
	if (rangeError.value || !bounds.value) { error.value = rangeError.value; return }
	const id = ++requestId, querySignature = signature.value
	loading.value = true
	error.value = ''
	hoverIndex.value = null
	try {
		const result: any = await common.sendAsync({
			route: routes.aliyun.server_traffic_trend.path,
			data: { account_id: props.accountId, server: { source: props.server.source, instance_id: props.server.instance_id, region_id: props.server.region_id }, start_time: bounds.value[0], end_time: bounds.value[1], interval: interval.value, comparison: compareEnabled.value ? { mode: compareMode.value, start_time: comparisonRange.value?.[0] } : undefined, force },
			timeout: 180000,
		})
		if (id !== requestId || !props.modelValue) return
		if (!result?.status) { error.value = result?.msg || pub.lang('流量查询失败，请重试'); return }
		data.value = result.data
		signatureAtQuery.value = querySignature
	} catch (exception) {
		if (id === requestId) error.value = exception instanceof Error ? exception.message : pub.lang('流量查询失败，请重试')
	} finally { if (id === requestId) loading.value = false }
}
const queryOnChange = async () => { await nextTick(); await query() }
const changePreset = async (value: string | number | boolean) => { selectPreset(value); await queryOnChange() }
const changeFilters = async () => { preset.value = 'custom'; await queryOnChange() }
const drillDay = async (row: TrafficBucket & { comparison?: TrafficBucket }) => {
	if (!dates.value || loading.value || dirty.value) return
	if (!previousView.value) previousView.value = { dates: [...dates.value], interval: interval.value, preset: preset.value, compareEnabled: compareEnabled.value, compareMode: compareMode.value, compareStart: compareStart.value }
	dates.value = [toPicker(row.start), toPicker(row.end)]
	interval.value = 3600
	preset.value = 'custom'
	if (compareEnabled.value && row.comparison) { compareMode.value = 'custom'; compareStart.value = toPicker(row.comparison.start) }
	await query()
}
const goBack = async () => {
	const previous = previousView.value
	if (!previous) return
	dates.value = previous.dates
	interval.value = previous.interval
	preset.value = previous.preset
	compareEnabled.value = previous.compareEnabled
	compareMode.value = previous.compareMode
	compareStart.value = previous.compareStart
	previousView.value = null
	await query()
}
watch(() => [props.modelValue, props.accountId, props.server && serverTrafficKey(props.server)], () => {
	requestId++
	data.value = null
	error.value = ''
	loading.value = false
	hoverIndex.value = null
	previousView.value = null
	signatureAtQuery.value = ''
	if (props.modelValue) {
		preset.value = '7d'
		selectPreset('7d')
		compareEnabled.value = false
		compareMode.value = 'previous'
		compareStart.value = null
		visibility.value = { in: true, out: true, compareIn: true, compareOut: true }
		query()
	}
}, { immediate: true })
onBeforeUnmount(() => { requestId++ })
onDeactivated(() => { requestId++; emit('update:modelValue', false) })
</script>

<style scoped lang="scss">
.traffic-title { display: flex; flex-direction: column; gap: 5px; padding-right: 30px; strong { font-size: 17px; line-height: 1.5; } small { color: var(--el-text-color-secondary); font-size: 12px; } }
.server-traffic-detail { max-height: calc(88vh - 100px); overflow: auto; padding: 0 4px 4px 0; color: var(--el-text-color-primary); }
.traffic-presets { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 10px; padding: 3px; :deep(.el-radio-group) { display: flex; flex-wrap: wrap; row-gap: 7px; } }
.traffic-filters { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; label { display: flex; align-items: center; gap: 8px; > span { flex-shrink: 0; white-space: nowrap; color: var(--el-text-color-regular); font-size: 12px; } } }
.traffic-range { flex: 0 1 430px; min-width: 0; max-width: 100%; :deep(.el-date-editor) { flex: 1; min-width: 0; width: 365px; box-sizing: border-box; } }
.traffic-interval { flex-shrink: 0; :deep(.el-select) { width: 110px; } }
.traffic-actions { display: flex; }
.traffic-compare { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; min-height: 28px; padding: 6px 0; :deep(.el-date-editor) { width: 190px; } }
.traffic-compare-mode { width: 165px; }
.traffic-muted, .traffic-caption, .traffic-notes { color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.7; }
.traffic-results { min-height: 200px; }
.traffic-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 8px 0 14px; > div { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 8px; padding: 9px 12px; background: var(--el-fill-color-light); border-radius: 6px; min-width: 0; } span { font-size: 12px; color: var(--el-text-color-secondary); } small { grid-column: 1 / -1; font-size: 11px; line-height: 1.5; color: var(--el-text-color-secondary); } strong { font-size: 20px; line-height: 1.2; font-weight: 600; } b { margin-left: 8px; font-weight: 400; } }
.inbound { color: var(--el-color-primary); }
.outbound { color: var(--el-color-success); }
.traffic-chart-heading { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; > div:first-child { display: flex; flex-direction: column; gap: 5px; } strong { font-size: 14px; } small { color: var(--el-text-color-secondary); font-size: 12px; } }
.traffic-legend { display: flex; flex-wrap: wrap; gap: 12px; button { display: inline-flex; align-items: center; gap: 5px; color: var(--el-text-color-regular); font: inherit; font-size: 12px; border: 0; padding: 3px 0; background: transparent; cursor: pointer; } i { width: 20px; border-top-width: 2px; } .muted { opacity: .4; text-decoration: line-through; } }
.traffic-chart { display: flex; height: 280px; gap: 12px; }
.traffic-axis { display: flex; flex: 0 0 78px; flex-direction: column; justify-content: space-between; padding: 12px 0 16px; text-align: right; color: var(--el-text-color-secondary); font-size: 11px; }
.traffic-plot { position: relative; flex: 1; min-width: 0; svg { width: 100%; height: 100%; display: block; } }
.traffic-grid { stroke: var(--el-border-color-lighter); stroke-dasharray: 4 4; }
.traffic-crosshair { stroke: var(--el-text-color-placeholder); stroke-dasharray: 3 3; }
.traffic-tooltip { position: absolute; top: 4px; z-index: 2; min-width: 230px; display: flex; flex-direction: column; gap: 7px; padding: 12px; border: 1px solid var(--el-border-color-light); border-radius: 6px; box-shadow: var(--el-box-shadow-light); background: var(--el-bg-color-overlay); font-size: 12px; pointer-events: none; &.is-left { transform: translateX(-100%); } > strong { font-size: 12px; } small { color: var(--el-text-color-secondary); } span { display: flex; align-items: center; gap: 6px; } b { margin-left: auto; padding-left: 12px; font-weight: 500; } i { width: 7px; height: 7px; border-radius: 50%; } }
.traffic-date-labels { display: flex; justify-content: space-between; margin: 7px 0 12px 90px; gap: 5px; color: var(--el-text-color-secondary); font-size: 11px; }
.traffic-caption { margin: 7px 0; }
.traffic-cell-note { display: block; color: var(--el-text-color-secondary); font-size: 11px; }
.traffic-daily { margin-top: 12px; :deep(.el-collapse-item__header) { gap: 15px; } }
@media (max-width: 760px) { .traffic-range { flex-basis: 100%; } .traffic-totals { gap: 7px; > div { display: flex; flex-direction: column; align-items: flex-start; padding: 8px 10px; } strong { font-size: 18px; } } .traffic-chart { height: 230px; } .traffic-axis { flex-basis: 65px; } .traffic-date-labels { margin-left: 77px; font-size: 10px; } .traffic-daily-hint { display: none; } }
</style>
