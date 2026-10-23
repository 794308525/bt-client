<template>
	<div class="allowance-grid">
		<section v-for="section in sections" :key="section.key" class="allowance-card" :aria-label="section.title">
			<div class="allowance-heading"><button type="button" @click="detail = section.key">{{ section.title }} <span>›</span></button><el-button text circle :icon="Refresh" :loading="loading[section.key]" :aria-label="`刷新${section.title}`" @click="load(section.key, true)" /></div>
			<div v-loading="loading[section.key]" class="allowance-content">
				<template v-if="section.key === 'cdt'">
					<div v-for="pool in pools" :key="pool.key" class="allowance-pool"><div><span>{{ pool.label }}</span><strong>{{ formatServerTraffic(pool.used_bytes) }} / {{ formatServerTraffic(pool.total_bytes) }}</strong></div><el-progress v-if="pool.used_bytes !== null" :percentage="percent(pool.used_bytes, pool.total_bytes)" :show-text="false" :stroke-width="4" :status="progressStatus(pool.used_bytes, pool.total_bytes)" /><div v-else class="allowance-unknown-bar" /><small :title="hint('cdt')">{{ pool.used_bytes === null ? loading.cdt ? '正在查询消耗…' : stateText('cdt') : `剩余 ${formatServerTraffic(pool.remaining_bytes)}` }}</small></div>
				</template>
				<template v-else-if="section.key === 'packages' && data.packages?.items?.length">
					<div class="allowance-summary"><strong>{{ packageItems.filter(item => !item.pending).length }}</strong><span>个有效流量包</span><el-tag v-if="packageItems.some(item => !item.pending && (item.low || item.expiring))" size="small" type="warning">余量 / 到期待关注</el-tag></div>
					<div v-for="group in packageGroups.slice(0, 2)" :key="group.key" class="allowance-package-group">
						<div class="allowance-package-row"><span :title="group.label">{{ group.label }}</span><strong>{{ group.remaining === null ? '余量待核对' : `余 ${formatServerTraffic(group.remaining)}` }}</strong></div>
						<el-progress v-if="group.total && group.used !== null" :percentage="percent(group.used, group.total)" :stroke-width="5" :status="progressStatus(group.used, group.total)" :format="value => `已用 ${value}%`" :title="`已用 ${formatServerTraffic(group.used)} / 总量 ${formatServerTraffic(group.total)}`" />
						<small v-else>总量或已用数据不足，暂不计算消耗比例</small>
					</div>
					<small>{{ packageItems.some(item => item.pending) ? `另有 ${packageItems.filter(item => item.pending).length} 个待生效，` : '' }}{{ packageGroups.length > 2 ? `共 ${packageGroups.length} 类适用范围，` : '' }}{{ nearestExpiry ? `最近到期 ${formatDate(nearestExpiry)}` : '按适用范围分别抵扣' }}</small>
				</template>
				<template v-else-if="section.key === 'swas' && swasItems.length">
					<div class="allowance-summary"><strong>{{ swasItems.length }}</strong><span>台轻量服务器</span><el-tag v-if="swasUnknown" size="small" type="info">{{ swasUnknown }} 台待核对</el-tag></div>
					<div class="allowance-swas-counts"><span>接近用尽 <b :class="{ warning: swasLow > 0 }">{{ swasLow }}</b></span><span>已超额 <b :class="{ danger: swasOverflow > 0 }">{{ swasOverflow }}</b></span></div>
					<small>每台实例独立计算套餐额度</small>
				</template>
				<p v-else class="allowance-empty">{{ stateText(section.key) }}</p>
			</div>
			<div class="allowance-footer"><el-tooltip :content="hint(section.key)" :show-after="300"><span :class="{ warning: hasIssue(section.key) }">{{ hasIssue(section.key) ? stateText(section.key) : section.key === 'cdt' ? '当前账号共享 · 账单统计' : section.key === 'packages' ? '当前账号 · 按包有效期' : '当月出网流量' }}</span></el-tooltip><span>{{ timeText(section.key) }}</span></div>
		</section>
	</div>
	<el-drawer :model-value="!!detail" :title="sections.find(item => item.key === detail)?.title" size="min(1060px, 96vw)" @update:model-value="value => { if (!value) detail = '' }">
		<template v-if="detail">
			<div class="allowance-detail-heading"><span>{{ data[detail]?.month || currentMonth() }} · {{ timeText(detail) }} · 查询时间</span><el-button :icon="Refresh" :loading="loading[detail]" @click="load(detail, true)">刷新</el-button></div>
			<el-alert :title="hint(detail)" :type="hasIssue(detail) ? 'warning' : 'info'" :closable="false" show-icon />
			<template v-if="detail === 'cdt'">
				<div class="allowance-detail-pools"><div v-for="pool in pools" :key="pool.key"><strong>{{ pool.label }} · 每月 {{ formatServerTraffic(pool.total_bytes) }}</strong><p>已用 {{ formatServerTraffic(pool.used_bytes) }}　剩余 {{ formatServerTraffic(pool.remaining_bytes) }}</p><el-progress v-if="pool.used_bytes !== null" :percentage="percent(pool.used_bytes, pool.total_bytes)" :status="progressStatus(pool.used_bytes, pool.total_bytes)" /></div></div>
				<p class="allowance-note">同一阿里云账号下符合条件的产品共享额度，每月重置。仅限已接入 CDT、按流量计费的 BGP 公网出流量，固定带宽不适用。中国内地和非中国内地分别计算。</p>
				<p class="allowance-note">免费消耗按已出账数据核对，不包含未结算用量；服务器卡片中的监控估算不用于扣减免费额度。</p>
				<el-link href="https://cdt.console.aliyun.com/overview" target="_blank" rel="noopener noreferrer" type="primary">前往 CDT 控制台核对</el-link>
			</template>
			<template v-else-if="detail === 'packages'">
				<p class="allowance-note">仅展示接口返回的有效服务器 / CDT 流量包。各包按适用产品、区域、时段分别抵扣，余量不代表任意服务器均可使用。已到期或历史用尽的包可能不在查询范围内。</p>
				<el-table :data="packageItems" v-loading="loading.packages" row-key="instance_id" max-height="560">
					<el-table-column label="流量包 / 适用范围" min-width="230"><template #default="{ row }"><strong>{{ row.name }}</strong><small class="allowance-table-note">{{ row.region || '地域未提供' }} · {{ productNames(row.products) }}</small><small class="allowance-table-note">{{ row.instance_id }}</small></template></el-table-column>
					<el-table-column label="总量" min-width="110"><template #default="{ row }">{{ row.total_bytes === null ? row.total_label : formatServerTraffic(row.total_bytes) }}</template></el-table-column>
					<el-table-column label="已用 / 剩余" min-width="165"><template #default="{ row }"><span>{{ formatServerTraffic(row.used_bytes) }} / {{ row.remaining_bytes === null ? row.remaining_label : formatServerTraffic(row.remaining_bytes) }}</span><el-progress v-if="row.used_bytes !== null" :percentage="percent(row.used_bytes, row.total_bytes)" :show-text="false" :status="progressStatus(row.used_bytes, row.total_bytes)" /></template></el-table-column>
					<el-table-column label="生效 / 到期" min-width="165"><template #default="{ row }">{{ formatDate(row.effective_time) }}<small class="allowance-table-note">{{ formatDate(row.expiry_time) }}</small></template></el-table-column>
					<el-table-column label="状态" min-width="125"><template #default="{ row }"><el-tag :type="row.pending ? 'info' : row.remaining_bytes === 0 ? 'danger' : row.low || row.expiring ? 'warning' : 'success'">{{ row.pending ? '待生效' : row.remaining_bytes === 0 ? '已用尽' : row.low ? '余量 ≤ 20%' : row.expiring ? '7 天内到期' : '有效' }}</el-tag></template></el-table-column>
				</el-table>
				<el-link href="https://billing-cost.console.aliyun.com/ri/summary" target="_blank" rel="noopener noreferrer" type="primary">前往阿里云资源包管理</el-link>
			</template>
			<template v-else>
				<p class="allowance-note">只统计出网流量，接近用尽按剩余 ≤ 20% 提醒；超额流量按接口返回单独展示。</p>
				<el-alert v-if="data.swas?.failures?.length" :title="data.swas.failures.map(item => `${item.region || '地域列表'}：${item.message}`).join('；')" type="warning" :closable="false" />
				<el-table :data="swasItems" v-loading="loading.swas" :row-key="row => `${row.region_id}:${row.instance_id}`" max-height="560">
					<el-table-column label="实例" min-width="210"><template #default="{ row }"><strong>{{ row.name }}</strong><small class="allowance-table-note">{{ row.instance_id }}</small><small class="allowance-table-note">{{ row.region }}</small></template></el-table-column>
					<el-table-column label="套餐总额" min-width="115"><template #default="{ row }">{{ formatServerTraffic(row.total_bytes) }}</template></el-table-column>
					<el-table-column label="已用 / 剩余" min-width="170"><template #default="{ row }">{{ formatServerTraffic(row.used_bytes) }} / {{ formatServerTraffic(row.remaining_bytes) }}<el-progress v-if="row.total_bytes && row.used_bytes !== null" :percentage="percent(row.used_bytes, row.total_bytes)" :show-text="false" :status="progressStatus(row.used_bytes, row.total_bytes)" /></template></el-table-column>
					<el-table-column label="超额流量" min-width="115"><template #default="{ row }"><span :class="{ danger: row.overflow_bytes > 0 }">{{ formatServerTraffic(row.overflow_bytes) }}</span></template></el-table-column>
					<el-table-column label="状态" min-width="125"><template #default="{ row }"><el-tag :type="row.missing ? 'info' : row.overflow_bytes > 0 ? 'danger' : row.low ? 'warning' : 'success'">{{ row.missing ? '数据待核对' : row.overflow_bytes > 0 ? '已超额' : row.low ? '余量 ≤ 20%' : row.total_bytes === 0 ? '无固定额度' : '正常' }}</el-tag></template></el-table-column>
				</el-table>
			</template>
		</template>
	</el-drawer>
</template>

<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import { Refresh } from '@element-plus/icons-vue'
import { common, routes } from '@api/http'
import { formatServerTraffic, formatTrafficTime } from '@utils/server-traffic'

type Section = 'cdt' | 'packages' | 'swas'
interface Pool { key: string; label: string; total_bytes: number; used_bytes: number | null; remaining_bytes: number | null }
interface Package { instance_id: string; name: string; scope_key: string; scope_label: string; products: string[]; region: string; total_bytes: number | null; used_bytes: number | null; remaining_bytes: number | null; total_label: string; remaining_label: string; expiry_time: string; effective_time: string; pending: boolean; low: boolean; expiring: boolean }
interface Swas { instance_id: string; name: string; region: string; region_id: string; total_bytes: number | null; used_bytes: number | null; remaining_bytes: number | null; overflow_bytes: number | null; low: boolean; missing: boolean }
interface Result { section: Section; status: string; month: string; update_time: number; message?: string; request_id?: string; has_bills?: boolean; reasons?: string[]; pools?: Pool[]; items?: any[]; failures?: Array<{ region: string; message: string }> }
const props = defineProps<{ accountId: number; active: boolean; serverRevision: number; serverError: string }>()
const sections: Array<{ key: Section; title: string }> = [{ key: 'cdt', title: 'CDT 本月免费额度' }, { key: 'packages', title: '流量套餐包' }, { key: 'swas', title: '轻量服务器套餐' }]
const data = reactive<Partial<Record<Section, Result>>>({})
const loading = reactive<Record<Section, boolean>>({ cdt: false, packages: false, swas: false })
const detail = ref<Section | ''>('')
const requestIds = { cdt: 0, packages: 0, swas: 0 }
const requestMonths = { cdt: '', packages: '', swas: '' }
let pageActive = true
let timer: ReturnType<typeof setInterval> | undefined
const currentMonth = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 7)
const pools = computed<Pool[]>(() => data.cdt?.pools || [{ key: 'mainland', label: '中国内地', total_bytes: 20 * 1024 ** 3, used_bytes: null, remaining_bytes: null }, { key: 'overseas', label: '非中国内地', total_bytes: 200 * 1024 ** 3, used_bytes: null, remaining_bytes: null }])
const packageItems = computed(() => (data.packages?.items || []) as Package[])
const swasItems = computed(() => (data.swas?.items || []) as Swas[])
const packageGroups = computed(() => {
	const groups = new Map<string, { key: string; label: string; remaining: number | null; total: number | null; used: number | null }>()
	for (const item of packageItems.value) {
		if (item.pending) continue
		const group = groups.get(item.scope_key)
		if (!group) groups.set(item.scope_key, { key: item.scope_key, label: item.scope_label, remaining: item.remaining_bytes, total: item.total_bytes, used: item.used_bytes })
		else {
			group.remaining = group.remaining !== null && item.remaining_bytes !== null ? group.remaining + item.remaining_bytes : null
			group.total = group.total !== null && item.total_bytes !== null ? group.total + item.total_bytes : null
			group.used = group.used !== null && item.used_bytes !== null ? group.used + item.used_bytes : null
		}
	}
	return [...groups.values()]
})
const nearestExpiry = computed(() => packageItems.value.find(item => item.expiry_time)?.expiry_time)
const swasUnknown = computed(() => swasItems.value.filter(item => item.missing).length)
const swasLow = computed(() => swasItems.value.filter(item => item.low && !item.missing && !item.overflow_bytes).length)
const swasOverflow = computed(() => swasItems.value.filter(item => item.overflow_bytes !== null && item.overflow_bytes > 0).length)
const percent = (used: number | null, total: number | null) => total && used !== null ? Math.min(100, Math.max(0, Math.round(used / total * 100))) : 0
const progressStatus = (used: number | null, total: number | null) => total && used !== null && used / total >= .95 ? 'exception' : total && used !== null && used / total >= .8 ? 'warning' : undefined
const hasIssue = (key: Section) => !!data[key] && !['active', 'empty'].includes(data[key]!.status)
const stateText = (key: Section) => {
	const result = data[key]
	if (!result) return loading[key] ? '查询中…' : key === 'swas' && !props.serverRevision ? '等待服务器列表' : '待查询'
	if (key === 'cdt' && result.status === 'unverified') return result.reasons?.[0] || (result.has_bills ? '账单字段暂不支持统计' : '本月暂无账单')
	return ({ active: '', empty: key === 'packages' ? '暂无有效流量包' : '暂无轻量服务器', unverified: '消耗暂无法核对', permission_denied: '缺少读取权限', not_opened: '服务未开通', partial: '部分数据待核对', network: '网络异常', timeout: '查询超时' } as Record<string, string>)[result.status] ?? '查询失败'
}
const hint = (key: Section) => {
	const result = data[key]
	return [result?.message || (key === 'cdt' ? '免费额度按账号共享，消耗需根据完整账单核对。' : key === 'packages' ? '按阿里云资源包接口查询有效流量包，余量可能存在更新延迟。' : '套餐流量按实例独立计算，不能跨实例共享。'), result?.request_id ? `RequestId：${result.request_id}` : ''].filter(Boolean).join('；')
}
const timeText = (key: Section) => data[key]?.update_time ? formatTrafficTime(data[key]!.update_time) : '--'
const formatDate = (value: string) => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value)) : '--'
const productNames = (products: string[]) => products.map(value => ({ ecs: 'ECS', eip: 'EIP', slb: '负载均衡', cbwp: '共享带宽', cdt: 'CDT', flowpack: '共享流量' } as Record<string, string>)[value] || value).join('、') || '适用产品待确认'
const load = async (key: Section, force = false) => {
	if (!props.active || !pageActive || document.hidden || key === 'swas' && !props.serverRevision) return
	const month = currentMonth()
	if (loading[key] && requestMonths[key] === month) return
	if (key === 'swas' && props.serverError) {
		data.swas = { section: key, status: 'error', month, update_time: Math.floor(Date.now() / 1000), message: `无法读取轻量服务器列表：${props.serverError}。请先刷新服务器列表。` }
		return
	}
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
watch(() => props.serverRevision, (value, old) => { if (value > 0 && value !== old) load('swas', old > 0) })
onActivated(activate)
onDeactivated(deactivate)
onBeforeUnmount(deactivate)
// 首次挂载也启动跨月检查；KeepAlive 再激活时复用同一个定时器。
activate()
</script>

<style scoped lang="scss">
.allowance-grid { display: grid; grid-template-columns: repeat(3, minmax(23rem, 1fr)); flex: 0 0 auto; gap: 1rem; margin-bottom: 1.2rem; padding-bottom: .2rem; overflow-x: auto; }
.allowance-card { min-width: 0; padding: .9rem 1.2rem .7rem; border: 1px solid var(--el-border-color-lighter); border-radius: .8rem; background: var(--el-bg-color); }
.allowance-heading, .allowance-footer, .allowance-pool > div, .allowance-summary, .allowance-package-row, .allowance-detail-heading { display: flex; align-items: center; justify-content: space-between; gap: .6rem; }
.allowance-heading { margin-bottom: .4rem; button:not(.el-button) { padding: 0; border: 0; background: none; color: var(--el-text-color-primary); font: inherit; font-size: 1.2rem; font-weight: 600; text-align: left; cursor: pointer; span { margin-left: .3rem; color: var(--el-text-color-secondary); } } .el-button { width: 2.2rem; height: 2.2rem; } }
.allowance-content { min-height: 8.5rem; small { font-size: 1rem; color: var(--el-text-color-secondary); } }
.allowance-pool { margin-bottom: .5rem; > div { margin-bottom: .25rem; font-size: 1.05rem; } strong { font-size: 1.1rem; font-weight: 600; } small { display: block; overflow: hidden; margin-top: .2rem; text-overflow: ellipsis; white-space: nowrap; } }
.allowance-unknown-bar { height: 4px; border-radius: 2px; background: var(--el-fill-color-dark); }
.allowance-summary { justify-content: flex-start; margin: .7rem 0; font-size: 1.1rem; strong { font-size: 1.9rem; font-weight: 600; } .el-tag { margin-left: auto; } }
.allowance-package-row { margin: .4rem 0; font-size: 1.05rem; span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { flex-shrink: 0; font-weight: 500; } }
.allowance-package-group { margin-bottom: .6rem; :deep(.el-progress__text) { min-width: 5.8rem; font-size: 1rem !important; } }
.allowance-swas-counts { display: flex; gap: 2rem; margin: 1rem 0; font-size: 1.1rem; b { margin-left: .4rem; } }
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
