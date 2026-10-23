<template>
	<el-drawer :model-value="modelValue" :title="`${server?.name || ''} · ${pub.lang('近 30 天流量')}`" size="min(920px, 95vw)" @update:model-value="emit('update:modelValue', $event)">
		<div class="server-traffic-detail" v-loading="loading">
			<div class="traffic-heading">
				<div><span>{{ server?.instance_id }}</span><small>{{ pub.lang('公网出入流量 · 北京时间 · 包含今日') }}</small></div>
				<el-button :icon="Refresh" :loading="loading" @click="loadHistory(true)">{{ pub.lang('刷新') }}</el-button>
			</div>
			<el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
			<template v-if="data">
				<el-alert v-if="errorText" :title="errorText" type="warning" :closable="false" show-icon />
				<p class="traffic-caption">{{ pub.lang('根据阿里云监控平均速率估算累计流量，数据可能延迟，不等同于账单。') }}<template v-if="data.data_time"> {{ pub.lang('最新监控') }}：{{ formatTrafficTime(data.data_time) }}</template></p>
				<el-alert v-if="data.note" :title="data.note" type="info" :closable="false" />
				<div class="traffic-totals">
					<div><span>{{ pub.lang('入站合计') }}</span><strong class="inbound">{{ formatServerTraffic(total('in_bytes')) }}</strong></div>
					<div><span>{{ pub.lang('出站合计') }}</span><strong class="outbound">{{ formatServerTraffic(total('out_bytes')) }}</strong></div>
					<div><span>{{ pub.lang('有数据天数') }}</span><strong>{{ availableDays }} / {{ data.days.length }}</strong></div>
				</div>
				<p v-if="data.days.some(day => day.partial)" class="traffic-caption">{{ pub.lang('部分日期监控缺失，合计仅包含已返回的数据；缺失值显示为 --。') }}</p>
				<section v-if="availableDays" class="traffic-chart">
					<div class="traffic-legend"><span class="inbound">● {{ pub.lang('入站') }}</span><span class="outbound">● {{ pub.lang('出站') }}</span></div>
					<div class="traffic-chart-body">
						<div class="traffic-axis"><span>{{ formatServerTraffic(chartMax) }}</span><span>{{ formatServerTraffic(chartMax / 2) }}</span><span>0</span></div>
						<div class="traffic-plot" @mousemove="moveChart" @mouseleave="hoverIndex = null">
							<svg viewBox="0 0 1000 240" preserveAspectRatio="none" aria-label="每日入站和出站流量趋势">
								<line v-for="y in [15, 67.5, 120, 172.5, 225]" :key="y" x1="0" :y1="y" x2="1000" :y2="y" class="traffic-grid-line" />
								<path :d="chartPath('in_bytes')" class="traffic-line traffic-line--in" />
								<path :d="chartPath('out_bytes')" class="traffic-line traffic-line--out" />
								<template v-if="hoverDay && hoverIndex !== null">
									<line :x1="chartX(hoverIndex)" y1="0" :x2="chartX(hoverIndex)" y2="240" class="traffic-crosshair" />
								</template>
							</svg>
							<div v-if="hoverDay" class="traffic-tooltip" :style="{ left: `${Math.min(72, Math.max(0, (hoverIndex || 0) / Math.max(1, data.days.length - 1) * 100))}%` }">
								<strong>{{ hoverDay.date }}</strong><span class="inbound">{{ pub.lang('入站') }} {{ formatServerTraffic(hoverDay.in_bytes) }}</span><span class="outbound">{{ pub.lang('出站') }} {{ formatServerTraffic(hoverDay.out_bytes) }}</span>
							</div>
						</div>
					</div>
					<div class="traffic-date-labels"><span v-for="day in chartLabels" :key="day.date">{{ day.date.slice(5) }}</span></div>
				</section>
				<el-empty v-else :description="pub.lang('近 30 天暂无可用的公网流量监控数据')" :image-size="70" />
				<el-table :data="dailyRows" size="small" max-height="420" row-key="date">
					<el-table-column :label="pub.lang('日期')" min-width="130"><template #default="{ row }">{{ row.date }} <el-tag v-if="row.date === data.today.date" size="small">{{ pub.lang('今日') }}</el-tag></template></el-table-column>
					<el-table-column :label="pub.lang('入站流量')" min-width="130"><template #default="{ row }"><span class="inbound">{{ formatServerTraffic(row.in_bytes) }}</span></template></el-table-column>
					<el-table-column :label="pub.lang('出站流量')" min-width="130"><template #default="{ row }"><span class="outbound">{{ formatServerTraffic(row.out_bytes) }}</span></template></el-table-column>
					<el-table-column :label="pub.lang('数据状态')" min-width="130"><template #default="{ row }"><span class="traffic-caption">{{ row.in_bytes === null && row.out_bytes === null ? pub.lang('无数据') : row.partial ? pub.lang('数据不完整') : row.date === data.today.date ? pub.lang('持续累计中') : pub.lang('完整') }}</span></template></el-table-column>
				</el-table>
			</template>
		</div>
	</el-drawer>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { common, routes } from '@api/http'
import { pub } from '@utils/tools'
import { formatServerTraffic, formatTrafficTime, serverTrafficKey, type ServerTraffic, type TrafficServer } from '@utils/server-traffic'

const props = defineProps<{ modelValue: boolean; accountId: number; server: TrafficServer | null }>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void; (event: 'refreshed', value: ServerTraffic): void }>()
const data = ref<ServerTraffic | null>(null)
const error = ref('')
const loading = ref(false)
const hoverIndex = ref<number | null>(null)
let requestId = 0
const errorText = computed(() => [...new Set(data.value?.errors.map(item => item.message) || [])].join('；'))
const dailyRows = computed(() => [...(data.value?.days || [])].reverse())
const availableDays = computed(() => data.value?.days.filter(day => day.in_bytes !== null || day.out_bytes !== null).length || 0)
const total = (direction: 'in_bytes' | 'out_bytes') => {
	const values = data.value?.days.map(day => day[direction]).filter((value): value is number => value !== null) || []
	return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}
const chartMax = computed(() => Math.max(1, ...(data.value?.days.flatMap(day => [day.in_bytes || 0, day.out_bytes || 0]) || [])) * 1.05)
const chartX = (index: number) => 15 + index / Math.max(1, (data.value?.days.length || 0) - 1) * 970
const chartPath = (direction: 'in_bytes' | 'out_bytes') => {
	let connected = false
	return (data.value?.days || []).map((day, index) => {
		const value = day[direction]
		if (value === null) { connected = false; return '' }
		const command = connected ? 'L' : 'M'
		connected = true
		// 单点也画出短线段，便于识别仅有一天的数据和真实零流量。
		const x = chartX(index)
		const y = 225 - value / chartMax.value * 210
		return `${command}${x},${y} l0.5,0`
	}).join(' ')
}
const chartLabels = computed(() => data.value?.days.filter((_day, index, rows) => index === 0 || index === rows.length - 1 || index % 6 === 0) || [])
const hoverDay = computed(() => hoverIndex.value === null ? null : data.value?.days[hoverIndex.value])
const moveChart = (event: MouseEvent) => {
	const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
	const ratio = Math.max(0, Math.min(1, ((event.clientX - rect.left) / rect.width * 1000 - 15) / 970))
	hoverIndex.value = Math.round(ratio * Math.max(0, (data.value?.days.length || 0) - 1))
}
const loadHistory = async (force = false) => {
	if (!props.server || !props.modelValue) return
	const id = ++requestId
	const key = serverTrafficKey(props.server)
	loading.value = true
	error.value = ''
	try {
		const result: any = await common.sendAsync({
			route: routes.aliyun.server_traffic.path,
			data: {
				account_id: props.accountId,
				servers: [{ source: props.server.source, region_id: props.server.region_id, instance_id: props.server.instance_id }],
				history: true,
				force,
			},
			timeout: 120000,
		})
		if (id !== requestId) return
		if (!result?.status) { error.value = result?.msg || pub.lang('流量查询失败，请重试'); return }
		data.value = result.data.traffic[key]
		if (data.value) emit('refreshed', data.value)
	} catch (exception) {
		if (id === requestId) error.value = exception instanceof Error ? exception.message : pub.lang('流量查询失败，请重试')
	} finally { if (id === requestId) loading.value = false }
}
watch(() => [props.modelValue, props.accountId, props.server && serverTrafficKey(props.server)], () => {
	requestId++
	data.value = null
	error.value = ''
	loading.value = false
	hoverIndex.value = null
	if (props.modelValue) loadHistory()
})
</script>

<style scoped lang="scss">
.server-traffic-detail { min-height: 20rem; color: var(--el-text-color-primary); }
.traffic-heading { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin-bottom: 1.4rem; span { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; } small { display: block; margin-top: .4rem; color: var(--el-text-color-secondary); } }
.traffic-caption { color: var(--el-text-color-secondary); font-size: 1.1rem; line-height: 1.7; }
.traffic-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1rem; margin: 1.8rem 0 1rem; div { display: flex; flex-direction: column; gap: .7rem; padding: 1.3rem; border-radius: .8rem; background: var(--el-fill-color-light); } span { color: var(--el-text-color-secondary); font-size: 1.15rem; } strong { font-size: 1.9rem; font-weight: 600; } }
.inbound { color: var(--el-color-primary); }
.outbound { color: var(--el-color-success); }
.traffic-chart { margin: 1.8rem 0 2rem; }
.traffic-legend { display: flex; justify-content: flex-end; gap: 1.8rem; margin-bottom: 1rem; font-size: 1.15rem; }
.traffic-chart-body { display: flex; height: 24rem; gap: 1rem; }
.traffic-axis { display: flex; width: 7.5rem; flex-shrink: 0; flex-direction: column; justify-content: space-between; padding: 1.5rem 0; color: var(--el-text-color-secondary); font-size: 1rem; text-align: right; }
.traffic-plot { position: relative; min-width: 0; flex: 1; svg { display: block; width: 100%; height: 100%; overflow: visible; } }
.traffic-grid-line { stroke: var(--el-border-color-lighter); stroke-dasharray: 4 4; }
.traffic-line { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linecap: round; &--in { stroke: var(--el-color-primary); } &--out { stroke: var(--el-color-success); } }
.traffic-crosshair { stroke: var(--el-text-color-placeholder); stroke-dasharray: 3 3; }
.traffic-tooltip { display: flex; position: absolute; top: 1rem; min-width: 13rem; padding: 1rem 1.2rem; border: 1px solid var(--el-border-color-light); border-radius: .6rem; flex-direction: column; gap: .4rem; background: var(--el-bg-color-overlay); box-shadow: var(--el-box-shadow-light); font-size: 1.1rem; pointer-events: none; }
.traffic-date-labels { display: flex; justify-content: space-between; margin: .8rem 0 0 8.5rem; color: var(--el-text-color-secondary); font-size: 1rem; }
@media (max-width: 600px) { .traffic-totals { gap: .5rem; div { padding: .8rem; } strong { font-size: 1.4rem; } } }
</style>
