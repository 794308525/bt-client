<template>
	<div class="traffic-analytics" v-loading="loading">
		<div class="traffic-toolbar">
			<div class="traffic-toolbar__filters">
				<el-radio-group v-model="range" size="small" @change="loadAnalytics()">
					<el-radio-button label="today">{{ pub.lang('今天') }}</el-radio-button>
					<el-radio-button label="yesterday">{{ pub.lang('昨天') }}</el-radio-button>
					<el-radio-button label="24h">{{ pub.lang('近 24 小时') }}</el-radio-button>
					<el-radio-button label="7d">7 {{ pub.lang('天') }}</el-radio-button>
					<el-radio-button label="30d">30 {{ pub.lang('天') }}</el-radio-button>
				</el-radio-group>
				<el-select v-if="product === 'cdn'" v-model="domainName" clearable filterable :placeholder="pub.lang('全部加速域名')" @change="loadAnalytics()">
					<el-option v-for="domain in domains" :key="domain" :label="domain" :value="domain" />
				</el-select>
			</div>
			<div class="traffic-toolbar__meta">
				<span v-if="data?.update_time">{{ data.cached ? pub.lang('缓存数据') : pub.lang('监控数据') }} · {{ formatTime(data.update_time) }}</span>
				<el-tooltip :content="pub.lang('阿里云监控数据可能延迟数分钟，不等同于账单计费口径')" placement="top"><el-icon><InfoFilled /></el-icon></el-tooltip>
				<el-button circle :icon="Refresh" :loading="loading" @click="loadAnalytics(true)" />
			</div>
		</div>

		<el-alert v-if="data?.partial" type="warning" :closable="false" show-icon class="traffic-partial" :title="`${data.errors.length} ${pub.lang('项监控指标获取失败，已展示其余可用数据')}`" />
		<div v-if="data?.alerts.length" class="traffic-alerts">
			<el-alert v-for="alert in data.alerts" :key="alert.message" :type="alert.level" :closable="false" show-icon :title="alert.message" />
		</div>

		<div class="traffic-metrics">
			<button v-for="metric in metricCards" :key="metric.key" type="button" class="traffic-metric" :class="{ active: activeMetric === metric.key, warning: metric.warning }" @click="selectMetric(metric.key)">
				<span>{{ metric.label }}</span>
				<strong>{{ metric.value }}</strong>
				<small>{{ metric.hint }}</small>
			</button>
		</div>

		<div class="traffic-content">
			<section class="traffic-chart-card">
				<header>
					<div><h4>{{ activeMetricLabel }}{{ pub.lang('趋势') }}</h4><p>{{ rangeText }} · {{ intervalText }}</p></div>
					<strong>{{ chartPeakText }}</strong>
				</header>
				<div v-if="chartPoints.length" class="traffic-chart">
					<div class="traffic-chart__axis"><span>{{ formatMetricValue(chartMax, activeMetric) }}</span><span>{{ formatMetricValue(chartMax / 2, activeMetric) }}</span><span>0</span></div>
					<div class="traffic-chart__plot" @mousemove="handleChartMove" @mouseleave="chartHoverIndex = null">
						<svg viewBox="0 0 900 220" preserveAspectRatio="none" role="img" :aria-label="activeMetricLabel">
							<defs><linearGradient :id="chartGradientId" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff6a00" stop-opacity=".24" /><stop offset="1" stop-color="#ff6a00" stop-opacity="0" /></linearGradient></defs>
							<line v-for="line in [0, 55, 110, 165, 220]" :key="line" x1="0" :y1="line" x2="900" :y2="line" class="traffic-chart__grid" />
							<polygon :points="chartArea" :fill="`url(#${chartGradientId})`" />
							<polyline :points="chartLine" class="traffic-chart__line" />
						</svg>
						<template v-if="chartHoverPoint">
							<span class="traffic-chart__crosshair traffic-chart__crosshair--x" :style="{ left: `${chartHoverPoint.x}%` }" />
							<span class="traffic-chart__crosshair traffic-chart__crosshair--y" :style="{ top: `${chartHoverPoint.y}%` }" />
							<span class="traffic-chart__point" :style="{ left: `${chartHoverPoint.x}%`, top: `${chartHoverPoint.y}%` }" />
							<div class="traffic-chart__tooltip" :class="{ 'is-left': chartHoverPoint.x > 68 }" :style="{ left: `${chartHoverPoint.x}%`, top: `${chartHoverPoint.tooltipY}%` }">
								<time>{{ formatHoverTime(chartHoverPoint.timestamp) }}</time>
								<span><i />{{ activeMetricLabel }}<strong>{{ formatMetricValue(chartHoverPoint.value, activeMetric) }}</strong></span>
							</div>
						</template>
					</div>
					<div class="traffic-chart__labels"><span v-for="label in chartLabels" :key="label">{{ label }}</span></div>
				</div>
				<el-empty v-else :image-size="64" :description="pub.lang('当前时间范围暂无监控数据')" />
			</section>

			<section class="traffic-ranking-card">
				<header><div><h4>{{ rankingTitle }}</h4><p>{{ rankingDescription }}</p></div></header>
				<el-tabs v-model="rankingType" class="traffic-ranking-tabs" @tab-change="handleRankingTypeChange">
					<el-tab-pane :label="pub.lang('域名')" name="domains" />
					<el-tab-pane :label="pub.lang('热门 URL')" name="urls" />
					<el-tab-pane :label="pub.lang('URL 用量')" name="url_traffic" />
					<el-tab-pane v-if="product === 'esa'" :label="pub.lang('地区')" name="regions" />
				</el-tabs>
				<div v-if="product === 'esa' && isUrlRanking" class="traffic-ranking-filter">
					<el-select v-model="domainName" filterable :placeholder="pub.lang('先选择域名')" @change="loadEsaUrlRankings()">
						<el-option v-for="domain in esaDomainOptions" :key="domain" :label="domain" :value="domain" />
					</el-select>
					<el-button :icon="Refresh" :loading="urlRankingLoading" :disabled="!domainName || urlRankingLoading" @click="loadEsaUrlRankings(true)" />
				</div>
				<div v-if="product === 'esa' && isUrlRanking && urlRankingLoading && urlRankingProgress" class="traffic-ranking-progress">
					<div class="traffic-ranking-progress__title">
						<strong>{{ urlRankingProgress.message || progressStageText }}</strong>
						<span>{{ progressPercentage }}%</span>
					</div>
					<el-progress :percentage="progressPercentage" :show-text="false" :stroke-width="6" />
					<div class="traffic-ranking-progress__meta">
						<span v-if="progressCountText">{{ progressCountText }}</span>
						<span>{{ pub.lang('已用') }} {{ formatDuration(urlRankingProgress.elapsed_ms) }}</span>
						<span v-if="progressRemainingMs > 0">{{ pub.lang('预计剩余') }} {{ formatDuration(progressRemainingMs) }}</span>
					</div>
				</div>
				<el-alert v-if="product === 'esa' && isUrlRanking && urlRankingMeta?.truncated" type="warning" :closable="false" show-icon class="traffic-ranking-notice" :title="pub.lang('日志数量较多，当前排行基于已处理的日志生成')" />
				<el-alert v-else-if="product === 'esa' && isUrlRanking && urlRankingMeta?.errors.length" type="warning" :closable="false" show-icon class="traffic-ranking-notice" :title="`${urlRankingMeta.errors.length} ${pub.lang('个日志文件获取失败，已展示其余数据')}`" />
				<div v-if="product === 'esa' && isUrlRanking && urlRankingMeta?.update_time" class="traffic-ranking-meta">{{ urlRankingMeta.cached ? pub.lang('缓存数据') : pub.lang('日志数据') }} · {{ formatTime(urlRankingMeta.update_time) }} · {{ pub.lang('已处理') }} {{ urlRankingMeta.log_count }}/{{ urlRankingMeta.total_log_count }} {{ pub.lang('份日志') }}</div>
				<div v-if="rankingRows.length" class="traffic-ranking">
					<div v-for="(row, index) in rankingRows" :key="`${row.name}-${index}`" class="traffic-ranking__row" :class="{ clickable: rankingType === 'domains' }" @click="selectRanking(row)">
						<em>{{ index + 1 }}</em>
						<div>
							<span class="traffic-ranking__name"><span :title="row.name">{{ row.name }}</span><el-button v-if="isUrlRanking" link :icon="CopyDocument" :title="copyRankingTitle" @click.stop="copyRankingUrl(row.name)" /></span>
							<i><b :style="{ width: `${rankingWidth(row.value)}%` }" /></i>
						</div>
						<strong>{{ formatRankingValue(row.value) }}</strong>
					</div>
				</div>
				<el-empty v-else-if="!urlRankingLoading" :image-size="58" :description="rankingEmptyText" />
			</section>
		</div>

		<details v-if="data?.errors.length" class="traffic-errors">
			<summary>{{ pub.lang('查看未获取的指标') }}（{{ data.errors.length }}）</summary>
			<p v-for="error in data.errors" :key="`${error.module}-${error.errorCode}`">{{ error.module }}：{{ error.message }}<template v-if="error.errorCode"> · {{ error.errorCode }}</template><template v-if="error.requestId"> · RequestId {{ error.requestId }}</template></p>
		</details>
	</div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { CopyDocument, InfoFilled, Refresh } from '@element-plus/icons-vue'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import { copyText, pub } from '@utils/tools'

interface AnalyticsPoint { timestamp: string; traffic?: number; bandwidth?: number; requests?: number; qps?: number; cache_hit_rate?: number; origin_traffic?: number }
interface RankingRow { name: string; value: number; requests?: number; traffic?: number; peak_bandwidth?: number }
interface AnalyticsData {
	product: 'cdn' | 'esa'
	range: { key: string; start_time: string; end_time: string; interval: number }
	summary: { traffic: number; requests: number; peak_bandwidth: number; peak_qps: number; cache_hit_rate: number | null; origin_traffic: number | null; origin_ratio: number | null; error_4xx_rate: number; error_5xx_rate: number; origin_5xx_rate: number }
	trend: AnalyticsPoint[]
	rankings: { domains: RankingRow[]; urls: RankingRow[]; url_traffic: RankingRow[]; regions: RankingRow[] }
	url_domains?: string[]
	alerts: Array<{ level: 'warning' | 'danger' | 'info'; message: string }>
	errors: Array<{ module: string; message: string; errorCode?: string; requestId?: string }>
	partial: boolean
	update_time: number
	cached: boolean
}
interface EsaUrlRankingData { urls: RankingRow[]; url_traffic: RankingRow[]; host: string; log_count: number; total_log_count: number; row_count: number; truncated: boolean; update_time: number; cached: boolean; errors: Array<{ message: string; errorCode?: string }> }
interface EsaUrlRankingProgress { stage: 'listing' | 'preparing' | 'processing' | 'ranking' | 'complete'; current: number; total: number; percentage: number; elapsed_ms: number; message?: string }

const props = defineProps<{ product: 'cdn' | 'esa'; accountId: number; siteId?: string; domains?: string[] }>()
const Message = useMessage()
const loading = ref(false)
const urlRankingLoading = ref(false)
const range = ref('today')
const domainName = ref('')
const activeMetric = ref('traffic')
const rankingType = ref('domains')
const chartHoverIndex = ref<number | null>(null)
const data = ref<AnalyticsData>()
const urlRankingData = ref<EsaUrlRankingData>()
const urlRankingProgress = ref<EsaUrlRankingProgress>()
let urlRankingRequestId = 0
const chartGradientId = `traffic-gradient-${Math.random().toString(36).slice(2)}`
const request = (path: string, payload: Record<string, unknown>) => common.sendAsync({ route: path, data: payload, timeout: 120000 }) as Promise<any>

const metricCards = computed(() => {
	const summary = data.value?.summary
	return [
		{ key: 'traffic', label: pub.lang('总流量'), value: formatBytes(summary?.traffic), hint: pub.lang('节点向客户端输出') },
		{ key: 'bandwidth', label: pub.lang('峰值带宽'), value: formatBps(summary?.peak_bandwidth), hint: pub.lang('时间范围内最高值') },
		{ key: 'requests', label: pub.lang('请求数'), value: formatCount(summary?.requests), hint: pub.lang('总访问请求') },
		{ key: 'qps', label: pub.lang('峰值 QPS'), value: formatNumber(summary?.peak_qps), hint: pub.lang('每秒请求峰值') },
		{ key: 'cache_hit_rate', label: pub.lang('缓存命中率'), value: formatPercent(summary?.cache_hit_rate), hint: summary?.cache_hit_rate !== null ? pub.lang('越高则回源压力越小') : pub.lang('当前产品未返回') },
		{ key: 'origin_traffic', label: pub.lang('回源流量'), value: summary?.origin_traffic === null ? '--' : formatBytes(summary?.origin_traffic), hint: summary?.origin_ratio === null ? pub.lang('当前产品未返回') : `${pub.lang('占总流量')} ${formatPercent(summary?.origin_ratio)}` },
		{ key: 'error_5xx_rate', label: '5xx ' + pub.lang('错误率'), value: formatPercent(summary?.error_5xx_rate), hint: `${pub.lang('源站')} 5xx ${formatPercent(summary?.origin_5xx_rate)}`, warning: Number(summary?.error_5xx_rate || 0) >= .5 },
	]
})
const trendMetricMap: Record<string, keyof AnalyticsPoint> = { traffic: 'traffic', bandwidth: 'bandwidth', requests: 'requests', qps: 'qps', cache_hit_rate: 'cache_hit_rate', origin_traffic: 'origin_traffic' }
const chartPoints = computed(() => {
	const field = trendMetricMap[activeMetric.value]
	return field ? (data.value?.trend || []).map(point => ({ timestamp: point.timestamp, value: Number(point[field] || 0) })) : []
})
const chartMax = computed(() => Math.max(1, ...chartPoints.value.map(point => point.value)))
const chartLine = computed(() => chartPoints.value.map((point, index, rows) => `${rows.length === 1 ? 450 : index / (rows.length - 1) * 900},${220 - point.value / chartMax.value * 205}`).join(' '))
const chartArea = computed(() => chartPoints.value.length ? `0,220 ${chartLine.value} 900,220` : '')
const chartHoverPoint = computed(() => {
	if (chartHoverIndex.value === null) return null
	const point = chartPoints.value[chartHoverIndex.value]
	if (!point) return null
	const x = chartPoints.value.length === 1 ? 50 : chartHoverIndex.value / (chartPoints.value.length - 1) * 100
	const y = (220 - point.value / chartMax.value * 205) / 220 * 100
	return { ...point, x, y, tooltipY: Math.min(86, Math.max(14, y)) }
})
const chartLabels = computed(() => {
	if (!chartPoints.value.length) return []
	const indexes = [0, Math.floor((chartPoints.value.length - 1) / 2), chartPoints.value.length - 1]
	return indexes.map(index => new Date(chartPoints.value[index].timestamp).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }))
})
const activeMetricLabel = computed(() => metricCards.value.find(item => item.key === activeMetric.value)?.label || '')
const chartPeakText = computed(() => `${pub.lang('峰值')} ${formatMetricValue(chartMax.value, activeMetric.value)}`)
const rangeText = computed(() => data.value ? `${new Date(data.value.range.start_time).toLocaleString()} — ${new Date(data.value.range.end_time).toLocaleString()}` : '')
const intervalText = computed(() => data.value?.range.interval === 300 ? pub.lang('5 分钟粒度') : data.value?.range.interval === 3600 ? pub.lang('1 小时粒度') : pub.lang('1 天粒度'))
const rankingRows = computed(() => props.product === 'esa' && isUrlRanking.value
	? (urlRankingData.value?.[rankingType.value as 'urls' | 'url_traffic'] || []).map(row => ({ ...row, value: rankingType.value === 'urls' ? Number(row.requests || 0) : Number(row.traffic || 0) }))
	: data.value?.rankings[rankingType.value as keyof AnalyticsData['rankings']] || [])
const rankingTitle = computed(() => ({ domains: pub.lang('域名流量排行'), urls: pub.lang('热门 URL 排行'), url_traffic: pub.lang('URL 用量排行'), regions: pub.lang('地区请求排行') }[rankingType.value] || ''))
const rankingDescription = computed(() => props.product === 'esa' && isUrlRanking.value
	? (domainName.value ? `${domainName.value} · ${pub.lang('离线访问日志可能延迟生成')}` : pub.lang('请先选择域名，再查看完整 URL 排行'))
	: pub.lang('快速定位主要用量来源'))
const rankingMax = computed(() => Math.max(1, ...rankingRows.value.map(row => row.value)))
const isUrlRanking = computed(() => rankingType.value === 'urls' || rankingType.value === 'url_traffic')
const esaDomainOptions = computed(() => data.value?.url_domains || (data.value?.rankings.domains || []).map(item => item.name).filter(name => name && name !== '--'))
const urlRankingMeta = computed(() => urlRankingData.value)
const progressPercentage = computed(() => Math.min(100, Math.max(0, Math.round(Number(urlRankingProgress.value?.percentage || 0)))))
const progressStageText = computed(() => ({
	listing: pub.lang('正在获取 ESA 日志清单'),
	preparing: pub.lang('正在准备日志'),
	processing: pub.lang('正在处理日志'),
	ranking: pub.lang('正在生成 URL 排行'),
	complete: pub.lang('URL 排行已生成'),
}[urlRankingProgress.value?.stage || 'listing']))
const progressCountText = computed(() => {
	const progress = urlRankingProgress.value
	if (!progress || progress.total <= 0) return ''
	if (progress.stage === 'listing') return `${pub.lang('日志清单')} ${progress.current}/${progress.total}`
	if (progress.stage === 'preparing') return `${pub.lang('待处理')} ${progress.total} ${pub.lang('份日志')}`
	return `${pub.lang('已处理')} ${progress.current}/${progress.total} ${pub.lang('份日志')}`
})
const progressRemainingMs = computed(() => {
	const progress = urlRankingProgress.value
	if (!progress || progress.stage !== 'processing' || progress.current <= 0 || progress.total <= progress.current) return 0
	return Math.max(0, Math.round(progress.elapsed_ms / progress.current * (progress.total - progress.current)))
})
const rankingEmptyText = computed(() => props.product === 'esa' && isUrlRanking.value && !domainName.value ? pub.lang('请先选择域名') : pub.lang('暂无排行数据'))
const copyRankingTitle = computed(() => pub.lang('复制 URL'))
const rankingWidth = (value: number) => Math.max(2, Number(value || 0) / rankingMax.value * 100)
const formatRankingValue = (value: number) => ['urls', 'regions'].includes(rankingType.value) ? formatCount(value) : formatBytes(value)
const copyRankingUrl = (value: string) => copyText({ value, success: pub.lang('URL 复制成功') })
const handleChartMove = (event: MouseEvent) => {
	const element = event.currentTarget as HTMLElement
	const rect = element.getBoundingClientRect()
	if (!rect.width || !chartPoints.value.length) return
	const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
	chartHoverIndex.value = Math.round(ratio * (chartPoints.value.length - 1))
}

const selectMetric = (key: string) => {
	if (!trendMetricMap[key]) return
	activeMetric.value = key
}
const selectRanking = (row: RankingRow) => {
	if (rankingType.value !== 'domains' || !row.name) return
	if (props.product === 'esa') {
		domainName.value = row.name
		rankingType.value = 'urls'
		loadEsaUrlRankings()
		return
	}
	if (row.name === domainName.value) return
	domainName.value = row.name
	loadAnalytics()
}
const loadEsaUrlRankings = async (force = false) => {
	if (props.product !== 'esa' || !props.siteId || !domainName.value) {
		urlRankingRequestId += 1
		urlRankingData.value = undefined
		urlRankingProgress.value = undefined
		urlRankingLoading.value = false
		return
	}
	const requestId = ++urlRankingRequestId
	const requestedDomain = domainName.value
	urlRankingLoading.value = true
	urlRankingProgress.value = undefined
	try {
		const result = await common.sendAsync({
			route: routes.aliyun.esa_url_rankings.path,
			data: { account_id: props.accountId, site_id: props.siteId, domain_name: requestedDomain, range: range.value, force },
			timeout: 10 * 60 * 1000,
			onProgress: progress => {
				if (requestId === urlRankingRequestId && requestedDomain === domainName.value) urlRankingProgress.value = progress
			},
		}) as any
		if (requestId !== urlRankingRequestId || requestedDomain !== domainName.value) return
		if (!result?.status) {
			urlRankingData.value = undefined
			return Message.request(result)
		}
		urlRankingData.value = result.data
	} finally {
		if (requestId === urlRankingRequestId) {
			urlRankingLoading.value = false
			urlRankingProgress.value = undefined
		}
	}
}
const handleRankingTypeChange = () => {
	if (props.product === 'esa' && isUrlRanking.value && domainName.value && !urlRankingLoading.value && urlRankingData.value?.host !== domainName.value) loadEsaUrlRankings()
}
const loadAnalytics = async (force = false) => {
	if (props.product === 'esa' && !props.siteId) return
	loading.value = true
	try {
		const route = props.product === 'esa' ? routes.aliyun.esa_traffic_analytics.path : routes.aliyun.cdn_traffic_analytics.path
		const result = await request(route, { account_id: props.accountId, site_id: props.siteId, domain_name: props.product === 'cdn' ? domainName.value : '', range: range.value, force })
		if (!result?.status) return Message.request(result)
		data.value = result.data
		if (props.product === 'esa') {
			const options = esaDomainOptions.value
			if (!options.includes(domainName.value)) domainName.value = ''
			urlRankingData.value = undefined
			if (isUrlRanking.value && domainName.value) await loadEsaUrlRankings(force)
		}
		if (!trendMetricMap[activeMetric.value]) activeMetric.value = 'traffic'
	} finally { loading.value = false }
}

const formatBytes = (value?: number | null) => {
	if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--'
	const number = Number(value)
	if (number < 1024) return `${number.toFixed(0)} B`
	if (number < 1024 ** 2) return `${(number / 1024).toFixed(1)} KB`
	if (number < 1024 ** 3) return `${(number / 1024 ** 2).toFixed(1)} MB`
	if (number < 1024 ** 4) return `${(number / 1024 ** 3).toFixed(2)} GB`
	return `${(number / 1024 ** 4).toFixed(2)} TB`
}
const formatBps = (value?: number | null) => {
	if (value === null || value === undefined || !Number.isFinite(Number(value))) return '--'
	const number = Number(value)
	if (number < 1000) return `${number.toFixed(0)} bps`
	if (number < 1000 ** 2) return `${(number / 1000).toFixed(1)} Kbps`
	if (number < 1000 ** 3) return `${(number / 1000 ** 2).toFixed(1)} Mbps`
	return `${(number / 1000 ** 3).toFixed(2)} Gbps`
}
const formatNumber = (value?: number | null) => value === null || value === undefined ? '--' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(Number(value))
const formatCount = (value?: number | null) => value === null || value === undefined ? '--' : new Intl.NumberFormat('zh-CN', { notation: Number(value) >= 100000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(Number(value))
const formatPercent = (value?: number | null) => value === null || value === undefined ? '--' : `${Number(value).toFixed(2)}%`
const formatMetricValue = (value: number, metric: string) => metric === 'traffic' || metric === 'origin_traffic' ? formatBytes(value) : metric === 'bandwidth' ? formatBps(value) : metric === 'cache_hit_rate' || metric === 'error_5xx_rate' ? formatPercent(value) : formatNumber(value)
const formatTime = (value: number) => new Date(value * 1000).toLocaleString()
const formatHoverTime = (value: string) => new Date(value).toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
const formatDuration = (value?: number) => {
	const seconds = Math.max(0, Math.round(Number(value || 0) / 1000))
	if (seconds < 60) return `${seconds} ${pub.lang('秒')}`
	const minutes = Math.floor(seconds / 60)
	const rest = seconds % 60
	return rest ? `${minutes} ${pub.lang('分')} ${rest} ${pub.lang('秒')}` : `${minutes} ${pub.lang('分')}`
}

watch(() => props.siteId, () => { data.value = undefined; urlRankingData.value = undefined; urlRankingProgress.value = undefined; domainName.value = ''; rankingType.value = 'domains'; chartHoverIndex.value = null; loadAnalytics() })
onMounted(() => loadAnalytics())
defineExpose({ refresh: () => loadAnalytics(true) })
</script>

<style scoped lang="scss">
.traffic-analytics { min-height: 100%; }
.traffic-toolbar, .traffic-toolbar__filters, .traffic-toolbar__meta { display: flex; align-items: center; }
.traffic-toolbar { justify-content: space-between; gap: 1.2rem; margin-bottom: 1.2rem; }
.traffic-toolbar__filters { min-width: 0; gap: 1rem; .el-select { width: 24rem; } }
.traffic-toolbar__meta { gap: .55rem; color: var(--el-text-color-secondary); font-size: 1.05rem; white-space: nowrap; .el-icon { color: var(--el-text-color-placeholder); cursor: help; } }
.traffic-partial { margin-bottom: 1rem; }
.traffic-alerts { display: grid; margin-bottom: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .8rem; }
.traffic-metrics { display: grid; margin-bottom: 1.2rem; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: .8rem; }
.traffic-metric { min-width: 0; padding: 1.15rem 1.2rem; border: 1px solid var(--el-border-color-lighter); border-radius: .75rem; color: var(--el-text-color-primary); text-align: left; background: var(--el-bg-color); cursor: pointer; transition: border-color .18s, background .18s, transform .18s; span, strong, small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } span { color: var(--el-text-color-secondary); font-size: 1.05rem; } strong { margin-top: .45rem; font-size: 1.55rem; font-weight: 650; } small { margin-top: .35rem; color: var(--el-text-color-placeholder); font-size: .95rem; } &:hover { border-color: var(--el-color-primary-light-5); transform: translateY(-1px); } &.active { border-color: rgba(255, 106, 0, .35); background: rgba(255, 106, 0, .055); } &.warning strong { color: var(--el-color-danger); } }
.traffic-content { display: grid; grid-template-columns: minmax(0, 1.65fr) minmax(30rem, .85fr); gap: 1.2rem; }
.traffic-chart-card, .traffic-ranking-card { min-width: 0; padding: 1.35rem 1.5rem; border: 1px solid var(--el-border-color-lighter); border-radius: .8rem; background: var(--el-bg-color); }
.traffic-chart-card > header, .traffic-ranking-card > header { display: flex; min-height: 4rem; align-items: flex-start; justify-content: space-between; gap: 1rem; h4 { margin: 0; font-size: 1.3rem; font-weight: 650; } p { margin: .3rem 0 0; color: var(--el-text-color-secondary); font-size: .98rem; } > strong { color: #ff6a00; font-size: 1.25rem; font-weight: 650; } }
.traffic-chart { position: relative; height: 26rem; padding: 1rem 0 2.4rem 5.6rem; }
.traffic-chart__plot { position: relative; width: 100%; height: 100%; cursor: crosshair; svg { display: block; width: 100%; height: 100%; overflow: visible; } }
.traffic-chart__axis { position: absolute; top: 1rem; bottom: 2.4rem; left: 0; display: flex; width: 5rem; justify-content: space-between; color: var(--el-text-color-placeholder); font-size: .9rem; text-align: right; flex-direction: column; }
.traffic-chart__grid { stroke: var(--el-border-color-lighter); stroke-width: 1; vector-effect: non-scaling-stroke; }
.traffic-chart__line { fill: none; stroke: #ff6a00; stroke-width: 2.2; stroke-linejoin: round; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.traffic-chart__crosshair, .traffic-chart__point, .traffic-chart__tooltip { position: absolute; z-index: 2; pointer-events: none; }
.traffic-chart__crosshair { background: var(--el-border-color); &--x { top: 0; bottom: 0; width: 1px; } &--y { right: 0; left: 0; height: 1px; } }
.traffic-chart__point { width: .8rem; height: .8rem; border: 2px solid var(--el-bg-color); border-radius: 50%; background: #ff6a00; box-shadow: 0 0 0 1px #ff6a00; transform: translate(-50%, -50%); }
.traffic-chart__tooltip { min-width: 15rem; padding: .75rem .9rem; border: 1px solid var(--el-border-color-light); border-radius: .6rem; color: var(--el-text-color-primary); background: var(--el-bg-color-overlay); box-shadow: var(--el-box-shadow-light); transform: translate(1rem, -50%); time { display: block; margin-bottom: .45rem; color: var(--el-text-color-secondary); font-size: .92rem; } span { display: flex; align-items: center; gap: .5rem; font-size: 1rem; i { width: .65rem; height: .65rem; border-radius: 50%; background: #ff6a00; } strong { margin-left: auto; font-weight: 650; white-space: nowrap; } } &.is-left { transform: translate(calc(-100% - 1rem), -50%); } }
.traffic-chart__labels { position: absolute; right: 0; bottom: 0; left: 5.6rem; display: flex; justify-content: space-between; color: var(--el-text-color-placeholder); font-size: .9rem; }
.traffic-ranking-tabs { margin-top: .2rem; :deep(.el-tabs__header) { margin-bottom: .6rem; } }
.traffic-ranking-filter { display: flex; margin-bottom: .9rem; align-items: center; gap: .7rem; .el-select { min-width: 0; flex: 1; } .el-button { flex: 0 0 auto; } }
.traffic-ranking-progress { margin-bottom: .9rem; padding: .9rem 1rem; border: 1px solid var(--el-border-color-lighter); border-radius: .6rem; background: var(--el-fill-color-extra-light); }
.traffic-ranking-progress__title, .traffic-ranking-progress__meta { display: flex; align-items: center; justify-content: space-between; gap: .8rem; }
.traffic-ranking-progress__title { margin-bottom: .65rem; font-size: .98rem; strong { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; } span { color: var(--el-color-primary); font-variant-numeric: tabular-nums; } }
.traffic-ranking-progress__meta { margin-top: .55rem; justify-content: flex-start; color: var(--el-text-color-placeholder); font-size: .88rem; span { white-space: nowrap; } }
.traffic-ranking-notice { margin-bottom: .9rem; }
.traffic-ranking-meta { margin: -.15rem 0 .85rem; color: var(--el-text-color-placeholder); font-size: .92rem; }
.traffic-ranking { display: flex; flex-direction: column; gap: .85rem; }
.traffic-ranking__row { display: grid; min-width: 0; align-items: center; grid-template-columns: 2.2rem minmax(0, 1fr) auto; gap: .8rem; > em { color: var(--el-text-color-placeholder); font-size: 1rem; font-style: normal; text-align: center; } > div { min-width: 0; .traffic-ranking__name { display: flex; min-width: 0; align-items: center; font-size: 1.05rem; white-space: nowrap; > span { overflow: hidden; text-overflow: ellipsis; } .el-button { width: 2.2rem; min-width: 2.2rem; height: 2.2rem; margin-left: .2rem; padding: 0; } } i { display: block; height: .35rem; margin-top: .38rem; overflow: hidden; border-radius: 1rem; background: var(--el-fill-color); b { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #ff9a42, #ff6a00); } } } > strong { font-size: 1rem; font-weight: 600; white-space: nowrap; } &.clickable { cursor: pointer; &:hover { background: var(--el-fill-color-light); } } }
.traffic-errors { margin-top: 1rem; color: var(--el-text-color-secondary); font-size: 1rem; summary { cursor: pointer; } p { margin: .55rem 0 0 1.4rem; } }
@media (max-width: 1450px) { .traffic-metrics { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .traffic-toolbar { align-items: flex-start; flex-direction: column; } .traffic-content { grid-template-columns: 1fr; } .traffic-alerts { grid-template-columns: 1fr; } }
</style>
