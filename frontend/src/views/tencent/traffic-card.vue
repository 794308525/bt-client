<template>
	<el-tooltip :content="hint" placement="top" :show-after="400">
		<button type="button" class="traffic-card" @click="emit('open')">
			<div class="traffic-heading">
				<span class="traffic-title">{{
					pub.lang(source === 'cvm' ? '公网出站' : '套餐流量')
				}}</span>
				<span class="traffic-status">{{ status }}</span>
				<span class="traffic-link">{{ pub.lang('统计') }} ›</span>
			</div>
			<div class="traffic-grid">
				<div v-for="row in rows" :key="row.key" class="traffic-item">
					<span>{{ pub.lang(row.label) }}</span>
					<strong
						>{{ volume(row.value, source === 'cvm' ? 'MB' : 'B')
						}}{{ row.value !== null && row.partial ? ' *' : '' }}</strong
					>
				</div>
			</div>
		</button>
	</el-tooltip>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { pub } from '@utils/tools'
import { timeText, volume, type TencentServer, type TencentTraffic } from './api'

const props = defineProps<{
	source: TencentServer['source']
	data?: TencentTraffic
	loading?: boolean
	error?: string
}>()
const emit = defineEmits<{ (event: 'open'): void }>()
const periods = [
	{ key: 'today', label: '今日' },
	{ key: 'yesterday', label: '昨日' },
	{ key: 'this_month', label: '本月' },
	{ key: 'last_month', label: '上月' },
]
const activePackages = computed(() => {
	const now = Date.now()
	return (props.data?.packages || []).filter(pack => {
		const start = Date.parse(pack.start_time)
		const end = Date.parse(pack.end_time)
		return start <= now && now < end
	})
})
const rows = computed(() => {
	if (props.source === 'cvm')
		return periods.map(period => ({
			...period,
			value: props.data?.summary?.[period.key]?.out_mb ?? null,
			partial: props.data?.summary?.[period.key]?.partial || false,
		}))
	return (
		[
			{ key: 'used', label: '已用' },
			{ key: 'remaining', label: '剩余' },
			{ key: 'total', label: '总量' },
			{ key: 'overflow', label: '超额' },
		] as const
	).map(row => {
		const values = activePackages.value.map(pack => pack[row.key])
		return {
			...row,
			value:
				values.length && values.every(value => value !== null)
					? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
					: null,
			partial: false,
		}
	})
})
const errors = computed(() => [props.error, ...(props.data?.errors || [])].filter(Boolean))
const status = computed(() => {
	if (props.loading) return pub.lang('更新中…')
	if (errors.value.length) return pub.lang('查询失败')
	if (!props.data) return pub.lang('等待查询…')
	if (rows.value.every(row => row.value === null))
		return pub.lang(props.source === 'cvm' ? '暂无监控数据' : '暂无当前周期用量')
	if (rows.value.some(row => row.partial || row.value === null)) return pub.lang('数据不完整')
	return pub.lang('已更新')
})
const hint = computed(() => {
	const note = pub.lang(
		props.source === 'cvm'
			? '仅统计公网出站流量，按北京时间汇总。* 表示监控数据不完整。'
			: '按当前生效套餐周期汇总，套餐周期可能跨自然月。'
	)
	const cycles =
		props.source === 'lighthouse'
			? activePackages.value.map(
					pack => `${timeText(pack.start_time)} — ${timeText(pack.end_time)}`
				)
			: []
	return [
		note,
		...cycles,
		...errors.value,
		props.data ? `${pub.lang('查询时间')} ${timeText(props.data.update_time)}` : '',
	]
		.filter(Boolean)
		.join('；')
})
</script>

<style scoped lang="scss">
.traffic-card {
	display: block;
	width: 100%;
	margin: 0;
	padding: 0.6rem 0.8rem;
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 0.6rem;
	color: var(--el-text-color-primary);
	font: inherit;
	text-align: left;
	background: var(--el-fill-color-extra-light);
	cursor: pointer;
	transition:
		border-color 0.15s,
		background 0.15s;
	&:hover,
	&:focus-visible {
		border-color: var(--el-color-primary-light-5);
		background: var(--el-color-primary-light-9);
	}
}
.traffic-heading {
	display: flex;
	align-items: center;
	gap: 0.6rem;
	margin-bottom: 0.3rem;
	color: var(--el-text-color-secondary);
	font-size: 1rem;
	line-height: 1.4;
}
.traffic-title,
.traffic-link {
	flex-shrink: 0;
}
.traffic-status {
	min-width: 0;
	margin-left: auto;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	color: var(--el-text-color-placeholder);
}
.traffic-link {
	color: var(--el-color-primary);
}
.traffic-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0.2rem 1.2rem;
}
.traffic-item {
	display: flex;
	min-width: 0;
	align-items: baseline;
	justify-content: space-between;
	gap: 0.4rem;
	font-size: 1.05rem;
	line-height: 1.45;
	span {
		flex-shrink: 0;
		color: var(--el-text-color-secondary);
	}
	strong {
		color: var(--el-color-success);
		font-size: 1.1rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
}
</style>
