<template>
	<el-drawer
		:model-value="modelValue"
		:title="`${server?.name || ''} · ${pub.lang('服务器统计')}`"
		size="min(920px, 95vw)"
		@update:model-value="emit('update:modelValue', $event)">
		<div v-loading="loading" class="statistics">
			<div class="statistics-heading">
				<div>
					<code>{{ server?.instance_id }}</code
					><small>{{ pub.lang('公网统计 · 北京时间') }}</small>
				</div>
				<el-button :icon="Refresh" :loading="loading" @click="load(true)">{{
					pub.lang('刷新')
				}}</el-button>
			</div>
			<el-alert
				v-if="error"
				:title="error"
				type="error"
				:closable="false"
				show-icon
				class="statistics-alert" />
			<template v-if="data">
				<el-alert
					v-for="(message, index) in data.errors"
					:key="index"
					:title="message"
					type="warning"
					:closable="false"
					class="statistics-alert" />
				<template v-if="server?.source === 'cvm'">
					<h3>{{ pub.lang('累计出站流量') }}</h3>
					<div class="summary-grid">
						<div v-for="period in periods" :key="period.key">
							<span>{{ pub.lang(period.label) }}</span
							><strong>{{ volume(data.summary?.[period.key]?.out_mb, 'MB') }}</strong
							><small v-if="data.summary?.[period.key]?.partial">{{
								pub.lang('数据不完整')
							}}</small>
						</div>
					</div>
					<p class="caption">
						{{
							pub.lang('累计使用腾讯云官方出站流量求和指标；入站累计暂无可靠指标，展示为带宽趋势。')
						}}
					</p>
				</template>
				<template v-else>
					<h3>{{ pub.lang('轻量流量套餐') }}</h3>
					<article v-for="pack in data.packages" :key="pack.id" class="traffic-package">
						<p>{{ timeText(pack.start_time) }} — {{ timeText(pack.end_time) }}</p>
						<div class="summary-grid">
							<div>
								<span>{{ pub.lang('总量') }}</span
								><strong>{{ volume(pack.total) }}</strong>
							</div>
							<div>
								<span>{{ pub.lang('已用') }}</span
								><strong>{{ volume(pack.used) }}</strong>
							</div>
							<div>
								<span>{{ pub.lang('剩余') }}</span
								><strong>{{ volume(pack.remaining) }}</strong>
							</div>
							<div>
								<span>{{ pub.lang('超额') }}</span
								><strong>{{ volume(pack.overflow) }}</strong>
							</div>
						</div>
						<el-progress
							v-if="pack.total && pack.used !== null"
							:percentage="Math.min(100, Math.round((pack.used / pack.total) * 100))"
							:status="pack.remaining === 0 ? 'exception' : undefined" />
					</article>
					<el-empty
						v-if="!data.packages.length"
						:description="pub.lang('腾讯云暂未返回流量套餐用量')"
						:image-size="60" />
					<p class="caption">
						{{
							pub.lang(
								'套餐用量按腾讯云返回的套餐周期展示；周期可能跨自然月。历史每日累计缺少可靠指标时不换算。'
							)
						}}
					</p>
				</template>

				<section class="trend-section">
					<div class="trend-heading">
						<h3>{{ pub.lang('出入带宽趋势') }}</h3>
						<el-radio-group v-model="days" size="small" :disabled="loading"
							><el-radio-button :value="1">{{ pub.lang('近 24 小时') }}</el-radio-button
							><el-radio-button :value="7">{{ pub.lang('近 7 天') }}</el-radio-button
							><el-radio-button :value="30">{{
								pub.lang('近 30 天')
							}}</el-radio-button></el-radio-group
						>
					</div>
					<p class="caption">
						{{ pub.lang('显示每 {} 分钟采样周期的峰值带宽，单位 Mbps。', data.trend_period / 60) }}
					</p>
					<div v-if="data.trend.length" class="trend-chart">
						<div class="legend">
							<span class="inbound">● {{ pub.lang('入站') }}</span
							><span class="outbound">● {{ pub.lang('出站') }}</span>
						</div>
						<div class="chart-body">
							<div class="chart-axis">
								<span>{{ chartMax.toFixed(2) }}</span
								><span>{{ (chartMax / 2).toFixed(2) }}</span
								><span>0</span>
							</div>
							<svg
								viewBox="0 0 1000 240"
								preserveAspectRatio="none"
								role="img"
								:aria-label="pub.lang('公网入站及出站峰值带宽趋势图，单位 Mbps')">
								<line
									v-for="y in [10, 65, 120, 175, 230]"
									:key="y"
									x1="0"
									:y1="y"
									x2="1000"
									:y2="y"
									class="grid-line" />
								<path :d="chartPath('in_mbps')" class="trend-line inbound-line" />
								<path :d="chartPath('out_mbps')" class="trend-line outbound-line" />
							</svg>
						</div>
						<div class="chart-labels">
							<span>{{ timeText(data.trend[0].time / 1000) }}</span
							><span>{{ timeText(data.trend[data.trend.length - 1].time / 1000) }}</span>
						</div>
					</div>
					<el-empty v-else :description="pub.lang('暂无可用的公网带宽监控数据')" :image-size="60" />
				</section>
				<el-collapse
					><el-collapse-item :title="pub.lang('查看带宽采样明细')" name="samples"
						><el-table :data="data.trend.slice().reverse()" size="small" max-height="320"
							><el-table-column :label="pub.lang('采样时间')" min-width="160"
								><template #default="{ row }">{{
									timeText(row.time / 1000)
								}}</template></el-table-column
							><el-table-column :label="pub.lang('入站峰值 Mbps')" min-width="140"
								><template #default="{ row }">{{
									row.in_mbps === null ? '--' : row.in_mbps.toFixed(3)
								}}</template></el-table-column
							><el-table-column :label="pub.lang('出站峰值 Mbps')" min-width="140"
								><template #default="{ row }">{{
									row.out_mbps === null ? '--' : row.out_mbps.toFixed(3)
								}}</template></el-table-column
							></el-table
						></el-collapse-item
					></el-collapse
				>
				<template v-if="server?.source === 'cvm' && data.days.length"
					><h3>{{ pub.lang('近 30 天每日出站') }}</h3>
					<el-table :data="data.days.slice().reverse()" size="small" max-height="380"
						><el-table-column
							prop="date"
							:label="pub.lang('日期')"
							min-width="140" /><el-table-column :label="pub.lang('出站流量')" min-width="140"
							><template #default="{ row }">{{
								volume(row.out_mb, 'MB')
							}}</template></el-table-column
						><el-table-column :label="pub.lang('数据状态')" min-width="130"
							><template #default="{ row }">{{
								pub.lang(row.out_mb === null ? '暂无数据' : row.partial ? '数据不完整' : '完整')
							}}</template></el-table-column
						></el-table
					></template
				>
				<p class="caption">{{ pub.lang(data.note) }}</p>
				<p class="caption">{{ pub.lang('查询时间') }} {{ timeText(data.update_time) }}</p>
			</template>
		</div>
	</el-drawer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { pub } from '@utils/tools'
import {
	request,
	descriptor,
	serverKey,
	volume,
	timeText,
	type TencentServer,
	type TencentStatistics,
} from './api'

const props = defineProps<{
	modelValue: boolean
	accountId: number
	server: TencentServer | null
}>()
const emit = defineEmits<{ (event: 'update:modelValue', value: boolean): void }>()
const data = ref<TencentStatistics | null>(null)
const loading = ref(false)
const error = ref('')
const days = ref(1)
const periods = [
	{ key: 'today', label: '今日' },
	{ key: 'yesterday', label: '昨日' },
	{ key: 'this_month', label: '本月' },
	{ key: 'last_month', label: '上月' },
]
let requestId = 0
const chartMax = computed(
	() =>
		Math.max(
			1,
			...(data.value?.trend || []).flatMap(row => [row.in_mbps || 0, row.out_mbps || 0])
		) * 1.05
)
function chartPath(direction: 'in_mbps' | 'out_mbps') {
	const rows = data.value?.trend || []
	if (!rows.length) return ''
	const start = rows[0].time
	const duration = Math.max(1, rows[rows.length - 1].time - start)
	let connected = false
	let previous = 0
	return rows
		.map(row => {
			const value = row[direction]
			if (value === null) {
				connected = false
				return ''
			}
			const gap = row.time - previous > (data.value?.trend_period || 300) * 1500
			const command = connected && !gap ? 'L' : 'M'
			connected = true
			previous = row.time
			return `${command}${(((row.time - start) / duration) * 1000).toFixed(2)},${(230 - (value / chartMax.value) * 220).toFixed(2)}`
		})
		.join(' ')
}
async function load(force = false) {
	if (!props.modelValue || !props.server) return
	const id = ++requestId
	loading.value = true
	error.value = ''
	try {
		const result = await request<TencentStatistics>('server_statistics', {
			account_id: props.accountId,
			...descriptor(props.server),
			days: days.value,
			force,
		})
		if (id === requestId) data.value = result
	} catch (exception) {
		if (id === requestId)
			error.value = exception instanceof Error ? exception.message : pub.lang('统计查询失败')
	} finally {
		if (id === requestId) loading.value = false
	}
}
watch(
	() => [props.modelValue, props.accountId, props.server && serverKey(props.server)],
	() => {
		requestId++
		data.value = null
		error.value = ''
		loading.value = false
		days.value = 1
		if (props.modelValue) void load()
	}
)
watch(days, () => {
	data.value = null
	void load()
})
onBeforeUnmount(() => {
	requestId++
})
</script>

<style scoped lang="scss">
.statistics {
	min-height: 22rem;
	color: var(--el-text-color-primary);
}
.statistics-heading {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
	margin-bottom: 1.5rem;
	> div {
		min-width: 0;
	}
	code {
		font-size: 1.2rem;
		overflow-wrap: anywhere;
	}
	> .el-button {
		flex-shrink: 0;
	}
	small {
		display: block;
		margin-top: 0.3rem;
		color: var(--el-text-color-secondary);
		font-size: 1.1rem;
	}
}
.statistics-alert {
	margin-bottom: 1rem;
}
h3 {
	font-size: 1.4rem;
	font-weight: 600;
	margin: 1.7rem 0 1rem;
}
.summary-grid {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 1rem;
	> div {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 1.2rem;
		background: var(--el-fill-color-light);
		border-radius: 0.8rem;
	}
	span {
		color: var(--el-text-color-secondary);
		font-size: 1.1rem;
	}
	strong {
		font-size: 1.9rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		overflow-wrap: anywhere;
	}
	small {
		color: var(--el-color-warning);
	}
}
.caption {
	color: var(--el-text-color-secondary);
	font-size: 1.1rem;
	line-height: 1.7;
}
.traffic-package {
	margin-bottom: 1.5rem;
	p {
		color: var(--el-text-color-secondary);
		font-size: 1.1rem;
	}
	.el-progress {
		margin-top: 1rem;
	}
}
.trend-heading {
	display: flex;
	gap: 1rem;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
}
.trend-section {
	margin: 2rem 0 1rem;
}
.legend {
	display: flex;
	justify-content: flex-end;
	gap: 1.5rem;
	font-size: 1.1rem;
	margin-bottom: 1rem;
}
.inbound {
	color: var(--el-color-primary);
}
.outbound {
	color: var(--el-color-success);
}
.chart-body {
	display: flex;
	gap: 1rem;
	height: 24rem;
}
.chart-axis {
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	width: 6rem;
	padding: 1rem 0;
	text-align: right;
	font-size: 1rem;
	color: var(--el-text-color-secondary);
}
.chart-body svg {
	width: 100%;
	flex: 1;
	min-width: 0;
	overflow: visible;
}
.grid-line {
	stroke: var(--el-border-color-lighter);
	stroke-dasharray: 4 4;
}
.trend-line {
	fill: none;
	stroke-width: 2;
	vector-effect: non-scaling-stroke;
}
.inbound-line {
	stroke: var(--el-color-primary);
}
.outbound-line {
	stroke: var(--el-color-success);
}
.chart-labels {
	display: flex;
	justify-content: space-between;
	margin: 1rem 0 0 7rem;
	font-size: 1rem;
	color: var(--el-text-color-secondary);
}
@media (max-width: 600px) {
	.summary-grid {
		grid-template-columns: repeat(2, 1fr);
	}
	.trend-heading .el-radio-group {
		width: 100%;
	}
}
</style>
