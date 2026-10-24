<template>
	<div class="allowance-grid">
		<section v-for="section in sections" :key="section.key" class="allowance-card" :aria-label="section.title">
			<div class="allowance-heading"><button type="button" @click="detail = section.key">{{ section.title }} <span>›</span></button><el-button text circle :icon="Refresh" :loading="loading[section.key]" :aria-label="`刷新${section.title}`" @click="load(section.key, true)" /></div>
			<div v-loading="loading[section.key]" class="allowance-content">
				<template v-if="section.key === 'cdt'">
					<div v-for="pool in pools" :key="pool.key" class="allowance-pool" :style="{ '--allowance-remaining-color': pool.usage.color }"><div><span>{{ pool.label }}</span><strong class="allowance-remaining">{{ pool.remaining_bytes === null ? '余量待核对' : `余 ${formatServerTraffic(pool.remaining_bytes)} / ${formatServerTraffic(pool.total_bytes)}` }}</strong></div><el-progress v-if="pool.usage.percentage !== null" :percentage="pool.usage.percentage" :color="pool.usage.color" :show-text="false" :stroke-width="4" /><div v-else class="allowance-unknown-bar" /><small :title="[pool.reason, hint('cdt')].filter(Boolean).join('；')">{{ pool.remaining_bytes === null ? loading.cdt ? '正在查询消耗…' : pool.reason || stateText('cdt') : pool.state === 'exhausted' ? '免费额度已用尽' : pool.state === 'unused' ? '已出账口径：本月未使用' : `已用 ${formatServerTraffic(pool.used_bytes)}` }}</small></div>
				</template>
				<template v-else-if="section.key === 'packages' && data.packages?.items?.length">
					<div class="allowance-summary"><strong>{{ availablePackages.length }}</strong><span>个可用流量包</span><el-tag v-if="availablePackages.some(item => item.usage.percentage !== null && item.usage.percentage <= 20)" size="small" type="warning">余量待关注</el-tag></div>
					<div v-for="group in packageGroups.slice(0, 2)" :key="group.key" class="allowance-package-group" :style="{ '--allowance-remaining-color': group.usage.color }">
						<div class="allowance-package-row"><span :title="group.label">{{ group.label }}</span><strong class="allowance-remaining">{{ group.usage.percentage === null ? '余量待核对' : `余 ${formatServerTraffic(group.remaining)} / ${formatServerTraffic(group.total)}` }}</strong></div>
						<el-progress v-if="group.usage.percentage !== null" :percentage="group.usage.percentage" :stroke-width="5" :color="group.usage.color" :format="remainingPercentText" :title="`剩余 ${formatServerTraffic(group.remaining)} / 总量 ${formatServerTraffic(group.total)}，已用 ${formatServerTraffic(group.used)}`" />
						<template v-else><div class="allowance-unknown-bar" /><small>余量待核对，暂不计算剩余比例</small></template>
					</div>
					<div v-if="!packageGroups.length && unknownPackageCount" class="allowance-unknown-bar" />
					<p v-if="!packageGroups.length" class="allowance-package-empty" :class="{ danger: !unknownPackageCount && exhaustedPackageCount > 0 }">{{ unknownPackageCount ? '余量待核对，暂不计算剩余比例' : exhaustedPackageCount ? '当前流量包已用尽' : '暂无可用流量包' }}</p>
					<small>{{ unknownPackageCount ? `${unknownPackageCount} 个余量待核对，未计入汇总，` : '' }}{{ packageItems.some(item => item.pending) ? `另有 ${packageItems.filter(item => item.pending).length} 个待生效，` : '' }}{{ packageGroups.length > 2 ? `共 ${packageGroups.length} 类适用范围，` : '' }}<span :class="{ warning: availablePackages.some(item => item.expiring) }">{{ nearestExpiry ? `最近到期 ${formatDate(nearestExpiry)}` : availablePackages.length ? '按适用范围分别抵扣' : '点击标题查看套餐明细' }}</span></small>
				</template>
				<p v-else class="allowance-empty">{{ stateText(section.key) }}</p>
			</div>
			<div class="allowance-footer"><el-tooltip :content="hint(section.key)" :show-after="300"><span :class="{ warning: hasIssue(section.key) }">{{ hasIssue(section.key) ? stateText(section.key) : section.key === 'cdt' ? '已出账累计 · 非实时' : '当前账号 · 按包有效期' }}</span></el-tooltip><span>{{ section.key === 'cdt' ? '查询 ' : '' }}{{ timeText(section.key) }}</span></div>
		</section>
	</div>
	<el-drawer :model-value="!!detail" :title="sections.find(item => item.key === detail)?.title" size="min(1060px, 96vw)" @update:model-value="value => { if (!value) detail = '' }">
		<template v-if="detail">
			<div class="allowance-detail-heading"><span>{{ data[detail]?.month || currentMonth() }} · {{ timeText(detail) }} · 查询时间</span><el-button :icon="Refresh" :loading="loading[detail]" @click="load(detail, true)">刷新</el-button></div>
			<el-alert :title="hint(detail)" :type="hasIssue(detail) ? 'warning' : 'info'" :closable="false" show-icon />
			<template v-if="detail === 'cdt'">
				<div class="allowance-detail-pools"><div v-for="pool in pools" :key="pool.key" :style="{ '--allowance-remaining-color': pool.usage.color }"><strong>{{ pool.label }} · 每月 {{ formatServerTraffic(pool.total_bytes) }}</strong><p>已用 {{ formatServerTraffic(pool.used_bytes) }}　<span class="allowance-remaining">剩余 {{ formatServerTraffic(pool.remaining_bytes) }}</span></p><el-progress v-if="pool.usage.percentage !== null" :percentage="pool.usage.percentage" :color="pool.usage.color" :format="remainingPercentText" /><div v-else class="allowance-unknown-bar" /><small class="allowance-table-note">{{ pool.reason || stateText('cdt') }}</small></div></div>
				<p class="allowance-note">同一阿里云账号下符合条件的产品共享额度，每月重置。仅限已接入 CDT、按流量计费的 BGP 公网出流量，固定带宽不适用。中国内地和非中国内地分别计算。</p>
				<p class="allowance-note">免费消耗按已出账数据核对，账单通常延迟约 24 小时，不包含未结算用量；本月未发现已出账公网用量时按未使用显示。确认进入普通 BGP 收费阶梯时，对应地域免费余量按 0 计算。服务器监控流量不用于扣减免费额度，查询时间不代表用量统计截止时间。</p>
				<el-link href="https://cdt.console.aliyun.com/overview" target="_blank" rel="noopener noreferrer" type="primary">前往 CDT 控制台核对</el-link>
			</template>
			<template v-else-if="detail === 'packages'">
				<p class="allowance-note">顶部仅汇总已生效且尚有余量的流量包；本页保留接口返回的已用尽、待生效和余量待核对的包。各包按适用产品、区域、时段分别抵扣，余量不代表任意服务器均可使用。已到期或历史用尽的包可能不在查询范围内。</p>
				<el-table :data="packageItems" v-loading="loading.packages" row-key="instance_id" max-height="560">
					<el-table-column label="流量包 / 适用范围" min-width="230"><template #default="{ row }"><strong>{{ row.name }}</strong><small class="allowance-table-note">{{ row.region || '地域未提供' }} · {{ productNames(row.products) }}</small><small class="allowance-table-note">{{ row.instance_id }}</small></template></el-table-column>
					<el-table-column label="总量" min-width="110"><template #default="{ row }">{{ row.total_bytes === null ? row.total_label : formatServerTraffic(row.total_bytes) }}</template></el-table-column>
					<el-table-column label="已用 / 剩余" min-width="165"><template #default="{ row }"><div class="allowance-package-usage" :style="{ '--allowance-remaining-color': row.usage.color }"><span>{{ formatServerTraffic(row.used_bytes) }} / <span class="allowance-remaining">{{ row.remaining_bytes === null ? row.remaining_label : formatServerTraffic(row.remaining_bytes) }}</span></span><el-progress v-if="row.usage.percentage !== null" :percentage="row.usage.percentage" :show-text="false" :color="row.usage.color" :title="remainingPercentText(row.usage.percentage)" /><div v-else class="allowance-unknown-bar" :title="row.usage.label" /></div></template></el-table-column>
					<el-table-column label="生效 / 到期" min-width="165"><template #default="{ row }">{{ formatDate(row.effective_time) }}<small class="allowance-table-note">{{ formatDate(row.expiry_time) }}</small></template></el-table-column>
					<el-table-column label="状态" min-width="125"><template #default="{ row }"><div class="allowance-package-status"><el-tag effect="plain" :style="{ color: row.usage.color, borderColor: row.usage.color }">{{ row.usage.label }}</el-tag><el-tag v-if="!row.pending && row.expiring" type="warning" effect="plain">7 天内到期</el-tag></div></template></el-table-column>
				</el-table>
				<el-link href="https://billing-cost.console.aliyun.com/ri/summary" target="_blank" rel="noopener noreferrer" type="primary">前往阿里云资源包管理</el-link>
			</template>
		</template>
	</el-drawer>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { common, routes } from '@api/http'
import { formatServerTraffic, formatTrafficTime } from '@utils/server-traffic'

type Section = 'cdt' | 'packages'
interface Pool { key: string; label: string; total_bytes: number; used_bytes: number | null; remaining_bytes: number | null; state?: string; reason?: string }
interface Package { instance_id: string; name: string; scope_key: string; scope_label: string; products: string[]; region: string; total_bytes: number | null; used_bytes: number | null; remaining_bytes: number | null; total_label: string; remaining_label: string; expiry_time: string; effective_time: string; pending: boolean; low: boolean; expiring: boolean }
interface Result { section: Section; status: string; month: string; update_time: number; message?: string; request_id?: string; has_bills?: boolean; reasons?: string[]; pools?: Pool[]; items?: any[]; failures?: Array<{ region: string; message: string }> }
const props = defineProps<{ accountId: number; active: boolean }>()
const sections: Array<{ key: Section; title: string }> = [{ key: 'cdt', title: 'CDT 本月免费额度' }, { key: 'packages', title: '流量套餐包' }]
const data = reactive<Partial<Record<Section, Result>>>({})
const loading = reactive<Record<Section, boolean>>({ cdt: false, packages: false })
const detail = ref<Section | ''>('')
const requestIds = { cdt: 0, packages: 0 }
const requestMonths = { cdt: '', packages: '' }
let pageActive = true
let timer: ReturnType<typeof setInterval> | undefined
const currentMonth = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
const pools = computed(() => ((data.cdt?.pools || [{ key: 'mainland', label: '中国内地', total_bytes: 20 * 1024 ** 3, used_bytes: null, remaining_bytes: null }, { key: 'overseas', label: '非中国内地', total_bytes: 200 * 1024 ** 3, used_bytes: null, remaining_bytes: null }]) as Pool[]).map(pool => ({ ...pool, usage: packageUsage(pool.remaining_bytes, pool.total_bytes) })))
const packageUsage = (remaining: number | null, total: number | null, pending = false) => {
	if (pending || total === null || remaining === null || !Number.isFinite(total) || !Number.isFinite(remaining) || total <= 0 || remaining < 0 || remaining > total) {
		return { percentage: null, color: 'var(--el-text-color-placeholder)', label: pending ? '待生效' : '余量待核对' }
	}
	const ratio = remaining / total
	return {
		percentage: ratio * 100,
		color: ratio > .5 ? '#20a53a' : ratio > .2 ? 'var(--el-color-primary)' : ratio > .05 ? 'var(--el-color-warning)' : 'var(--el-color-danger)',
		label: remaining === 0 ? '已用尽' : ratio <= .05 ? '余量 ≤ 5%' : ratio <= .2 ? '余量 ≤ 20%' : '有效',
	}
}
const remainingPercentText = (percentage: number) => {
	if (percentage === 0) return '已用尽'
	if (percentage < 1) return '剩余 <1%'
	if (percentage > 99 && percentage < 100) return '剩余 >99%'
	return `剩余 ${Number(percentage.toFixed(1))}%`
}
const packageItems = computed(() => ((data.packages?.items || []) as Package[]).map(item => ({ ...item, usage: packageUsage(item.remaining_bytes, item.total_bytes, item.pending) })))
const availablePackages = computed(() => packageItems.value.filter(item => !item.pending && item.usage.percentage !== null && item.usage.percentage > 0))
const unknownPackageCount = computed(() => packageItems.value.filter(item => !item.pending && item.usage.percentage === null).length)
const exhaustedPackageCount = computed(() => packageItems.value.filter(item => !item.pending && item.usage.percentage === 0).length)
const packageGroups = computed(() => {
	const groups = new Map<string, { key: string; label: string; remaining: number | null; total: number | null; used: number | null }>()
	for (const item of availablePackages.value) {
		const remaining = item.remaining_bytes
		const group = groups.get(item.scope_key)
		if (!group) groups.set(item.scope_key, { key: item.scope_key, label: item.scope_label, remaining, total: item.total_bytes, used: item.used_bytes })
		else {
			group.remaining = group.remaining !== null && remaining !== null ? group.remaining + remaining : null
			group.total = group.total !== null && item.total_bytes !== null ? group.total + item.total_bytes : null
			group.used = group.used !== null && item.used_bytes !== null ? group.used + item.used_bytes : null
		}
	}
	return [...groups.values()].map(group => ({ ...group, usage: packageUsage(group.remaining, group.total) }))
})
const nearestExpiry = computed(() => availablePackages.value.find(item => item.expiry_time)?.expiry_time)
const hasIssue = (key: Section) => !!data[key] && !['active', 'empty'].includes(data[key]!.status)
const stateText = (key: Section) => {
	const result = data[key]
	if (!result) return loading[key] ? '查询中…' : '待查询'
	if (key === 'cdt' && result.status === 'unverified') return result.reasons?.[0] || (result.has_bills ? '账单字段暂不支持统计' : '本月暂无账单')
	return ({ active: '', empty: '暂无有效流量包', unverified: '消耗暂无法核对', permission_denied: '缺少读取权限', not_opened: '服务未开通', partial: '部分数据待核对', network: '网络异常', timeout: '查询超时' } as Record<string, string>)[result.status] ?? '查询失败'
}
const hint = (key: Section) => {
	const result = data[key]
	return [result?.message || (key === 'cdt' ? '免费额度按账号共享，消耗需根据完整账单核对。' : '按阿里云资源包接口查询有效流量包，余量可能存在更新延迟。'), result?.request_id ? `RequestId：${result.request_id}` : ''].filter(Boolean).join('；')
}
const timeText = (key: Section) => data[key]?.update_time ? formatTrafficTime(data[key]!.update_time * 1000) : '--'
const formatDate = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '--'
const productNames = (products: string[]) => products.map(value => ({ ecs: 'ECS', eip: 'EIP', slb: '负载均衡', cbwp: '共享带宽', cdt: 'CDT', flowpack: '共享流量' } as Record<string, string>)[value] || value).join('、') || '适用产品待确认'
const load = async (key: Section, force = false) => {
	if (!props.active || !pageActive || document.hidden) return
	const month = currentMonth()
	if (loading[key] && requestMonths[key] === month) return
	const previous = data[key]
	if (!force && previous?.month === month && Date.now() / 1000 - previous.update_time < 300) return
	if (previous?.month !== month) delete data[key]
	const id = ++requestIds[key]
	requestMonths[key] = month
	loading[key] = true
	try {
		const result: any = await common.sendAsync({ route: routes.aliyun.server_allowance.path, data: { account_id: props.accountId, section: key, force }, timeout: 180000 })
		if (id !== requestIds[key] || !pageActive || currentMonth() !== month) return
		if (!result?.status) throw new Error(result?.msg || '查询失败，请重试')
		if (result.data?.month !== month) throw new Error('查询期间已跨月，请刷新重试')
		data[key] = result.data
	} catch (error) {
		if (id === requestIds[key] && pageActive && currentMonth() === month) data[key] = { section: key, status: 'error', month, update_time: Math.floor(Date.now() / 1000), message: error instanceof Error ? error.message : '查询失败，请重试' }
	} finally { if (id === requestIds[key]) loading[key] = false }
}
const refresh = () => { if (props.active && pageActive) sections.forEach(section => load(section.key)) }
const activate = () => { pageActive = true; if (!timer) timer = setInterval(refresh, 60000); document.addEventListener('visibilitychange', refresh); refresh() }
const deactivate = () => { pageActive = false; clearInterval(timer); timer = undefined; document.removeEventListener('visibilitychange', refresh); detail.value = ''; sections.forEach(({ key }) => { requestIds[key]++; loading[key] = false }) }
watch(() => [props.accountId, props.active], ([accountId], [previousAccountId] = []) => {
	if (accountId !== previousAccountId) sections.forEach(({ key }) => { requestIds[key]++; loading[key] = false; delete data[key] })
	refresh()
}, { immediate: true })
onActivated(activate)
onDeactivated(deactivate)
onBeforeUnmount(deactivate)
// 首次挂载也启动跨月检查；KeepAlive 再激活时复用同一个定时器。
activate()
</script>

<style scoped lang="scss">
.allowance-grid { display: grid; grid-template-columns: repeat(2, minmax(23rem, 1fr)); flex: 0 0 auto; gap: 1rem; margin-bottom: 1.2rem; padding-bottom: .2rem; overflow-x: auto; }
.allowance-card { min-width: 0; padding: .9rem 1.2rem .7rem; border: 1px solid var(--el-border-color-lighter); border-radius: .8rem; background: var(--el-bg-color); }
.allowance-heading, .allowance-footer, .allowance-pool > div, .allowance-summary, .allowance-package-row, .allowance-detail-heading { display: flex; align-items: center; justify-content: space-between; gap: .6rem; }
.allowance-heading { margin-bottom: .4rem; button:not(.el-button) { padding: 0; border: 0; background: none; color: var(--el-text-color-primary); font: inherit; font-size: 1.2rem; font-weight: 600; text-align: left; cursor: pointer; span { margin-left: .3rem; color: var(--el-text-color-secondary); } } .el-button { width: 2.2rem; height: 2.2rem; } }
.allowance-content { min-height: 8.5rem; small { font-size: 1rem; color: var(--el-text-color-secondary); } }
.allowance-pool { margin-bottom: .5rem; > div { margin-bottom: .25rem; font-size: 1.05rem; } strong { font-size: 1.1rem; font-weight: 600; } small { display: block; overflow: hidden; margin-top: .2rem; text-overflow: ellipsis; white-space: nowrap; } }
.allowance-unknown-bar { height: 4px; border-radius: 2px; background: var(--el-fill-color-dark); }
.allowance-summary { justify-content: flex-start; margin: .7rem 0; font-size: 1.1rem; strong { font-size: 1.9rem; font-weight: 600; } .el-tag { margin-left: auto; } }
.allowance-package-row { margin: .4rem 0; font-size: 1.05rem; span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { flex-shrink: 0; font-weight: 500; } }
.allowance-remaining { color: var(--allowance-remaining-color); }
.allowance-package-group { margin-bottom: .6rem; :deep(.el-progress__text) { min-width: 6.4rem; color: var(--allowance-remaining-color); font-size: 1rem !important; } }
.allowance-package-usage { .el-progress, .allowance-unknown-bar { margin-top: .4rem; } }
.allowance-package-status { display: flex; flex-wrap: wrap; gap: .4rem; }
.allowance-package-empty { margin: .8rem 0; color: var(--el-text-color-secondary); font-size: 1.1rem; }
.allowance-empty { padding-top: 2rem; margin: 0; color: var(--el-text-color-secondary); font-size: 1.15rem; }
.allowance-footer { margin-top: .6rem; padding-top: .5rem; border-top: 1px solid var(--el-border-color-lighter); color: var(--el-text-color-secondary); font-size: 1rem; > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } > span:last-child { flex-shrink: 0; } }
.allowance-detail-heading { margin-bottom: 1.2rem; font-size: 1.15rem; color: var(--el-text-color-secondary); }
.allowance-detail-pools { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin: 1.6rem 0; > div { padding: 1.5rem; border: 1px solid var(--el-border-color-lighter); border-radius: .8rem; } }
.allowance-table-note { display: block; margin-top: .3rem; color: var(--el-text-color-secondary); font-size: 1.05rem; overflow-wrap: anywhere; }
.allowance-note { margin: 1.4rem 0; color: var(--el-text-color-secondary); font-size: 1.2rem; line-height: 1.7; }
.allowance-card .warning, .warning { color: var(--el-color-warning); }
.danger { color: var(--el-color-danger); }
.el-link { margin-top: 1.4rem; }
</style>
