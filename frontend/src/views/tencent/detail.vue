<template>
	<div class="tencent-detail">
		<header class="page-header">
			<el-button circle :icon="ArrowLeft" @click="router.push('/tencent')" />
			<div class="brand"><bt-icon name="tencent" size="24" /></div>
			<div class="identity">
				<h1 :title="account?.remark">{{ account?.remark || pub.lang('腾讯云账号') }}</h1>
				<p>
					{{ maskId(account?.secret_id || '') }}
					<el-tag
						v-if="account"
						size="small"
						:type="account.site === 'intl' ? 'warning' : 'primary'"
						>{{ pub.lang(account.site === 'intl' ? '国际站' : '国内站') }}</el-tag
					>
				</p>
			</div>
			<div class="balance">
				<div class="balance-amount">
					<strong>{{ money(account) }}</strong>
					<el-button
						text
						circle
						:icon="Refresh"
						:loading="balanceLoading"
						:title="pub.lang('刷新余额')"
						@click="refreshBalance" />
				</div>
				<small>{{ pub.lang('余额更新') }} {{ timeText(account?.balance_refresh_time) }}</small>
			</div>
		</header>
		<el-alert
			v-if="account?.balance_error"
			:title="account.balance_error"
			type="warning"
			:closable="false"
			show-icon
			class="page-alert" />
		<el-alert
			v-if="error"
			:title="error"
			type="error"
			:closable="false"
			show-icon
			class="page-alert" />
		<section class="server-heading">
			<h2>
				{{ pub.lang('服务器') }} <small>{{ filtered.length }} / {{ servers.length }}</small>
			</h2>
			<el-tag v-if="partial" type="warning">{{ pub.lang('部分数据') }}</el-tag
			><span>{{ pub.lang('更新') }} {{ timeText(refreshTime) }}</span
			><el-button :icon="Refresh" :loading="loading" @click="loadServers(true)">{{
				pub.lang('刷新服务器')
			}}</el-button>
		</section>
		<el-alert v-if="failures.length" type="warning" :closable="false" class="page-alert"
			><template #title>{{ pub.lang('部分产品或地域获取失败，已保留其他可用数据') }}</template
			><el-collapse class="failure-details"
				><el-collapse-item :title="pub.lang('查看失败详情')"
					><p v-for="(failure, index) in failures" :key="index">
						{{ failure.source }} {{ failure.region_id }}：{{ failure.message
						}}<small v-if="failure.request_id"> · RequestId: {{ failure.request_id }}</small>
					</p></el-collapse-item
				></el-collapse
			></el-alert
		>
		<div class="toolbar">
			<div class="toolbar-filters">
				<el-input
					v-model="query.keyword"
					clearable
					:prefix-icon="Search"
					:placeholder="pub.lang('搜索名称、实例 ID 或 IP')" />
				<el-select v-model="query.source"
					><el-option :label="pub.lang('全部类型')" value="all" /><el-option
						label="CVM"
						value="cvm" /><el-option :label="pub.lang('轻量应用服务器')" value="lighthouse"
				/></el-select>
				<el-select v-model="query.region" filterable
					><el-option :label="pub.lang('全部地域')" value="all" /><el-option
						v-for="region in regions"
						:key="region.id"
						:label="region.name"
						:value="region.id"
				/></el-select>
				<el-select v-model="query.status"
					><el-option :label="pub.lang('全部状态')" value="all" /><el-option
						v-for="status in statuses"
						:key="status"
						:label="pub.lang(statusName(status))"
						:value="status"
				/></el-select>
			</div>
			<div class="toolbar-actions">
				<el-tooltip :content="pub.lang(showIp ? '隐藏 IP' : '显示 IP')"
					><el-button :icon="showIp ? Hide : View" @click="showIp = !showIp"
				/></el-tooltip>
			</div>
		</div>
		<div v-loading="loading" class="server-grid">
			<article v-for="server in paged" :key="serverKey(server)" class="server-card">
				<header>
					<el-icon class="server-icon"><Monitor /></el-icon>
					<div class="server-name">
						<strong :title="server.name">{{ server.name }}</strong
						><small>{{ server.instance_id }}</small>
					</div>
					<el-tag :type="statusType(server.status)" size="small" effect="plain">{{
						pub.lang(
							powerTasks[serverKey(server)]?.uncertain ? '状态待确认' : statusName(server.status)
						)
					}}</el-tag>
				</header>
				<div class="server-meta">
					<el-tag size="small" effect="plain">{{
						server.source === 'cvm' ? 'CVM' : pub.lang('轻量')
					}}</el-tag
					><span :title="server.region_id">{{ server.region_name }}</span
					><span class="os-name" :title="server.os_name">{{ server.os_name || '--' }}</span>
				</div>
				<div class="server-specs">
					<div :title="server.instance_type">
						<span>{{ pub.lang('配置') }}</span
						><strong
							>{{ server.cpu ?? '--' }} {{ pub.lang('核') }} /
							{{ server.memory_gb ?? '--' }} GB</strong
						>
					</div>
					<div>
						<span>{{ pub.lang('带宽') }}</span
						><strong>{{ server.bandwidth_mbps ?? '--' }} Mbps</strong>
					</div>
					<div>
						<span>{{ pub.lang('磁盘') }}</span
						><strong>{{ server.disk_gb ?? '--' }} GB</strong>
					</div>
				</div>
				<div v-if="showIp" class="server-ips">
					<div v-for="ip in server.public_ips" :key="`public-${ip}`">
						<span>{{ pub.lang('公网') }}</span
						><code>{{ ip }}</code
						><el-button
							link
							:icon="CopyDocument"
							:title="pub.lang('复制 IP')"
							@click="copyIp(ip)" />
					</div>
					<div v-for="ip in server.private_ips" :key="`private-${ip}`" class="muted">
						<span>{{ pub.lang('内网') }}</span
						><code>{{ ip }}</code
						><el-button
							link
							:icon="CopyDocument"
							:title="pub.lang('复制 IP')"
							@click="copyIp(ip)" />
					</div>
					<span v-if="!server.public_ips.length && !server.private_ips.length" class="muted">{{
						pub.lang('暂无 IP 地址')
					}}</span>
				</div>
				<TrafficCard
					:source="server.source"
					:data="traffic[serverKey(server)]"
					:loading="trafficLoading.has(serverKey(server))"
					:error="trafficErrors[serverKey(server)]"
					@open="openStatistics(server)" />
				<div v-if="powerTasks[serverKey(server)]" class="operation-note">
					{{ pub.lang(powerTasks[serverKey(server)].note)
					}}<el-button
						link
						type="primary"
						:loading="stateLoading.has(serverKey(server))"
						@click="checkState(server)"
						>{{ pub.lang('查询状态') }}</el-button
					>
				</div>
				<footer>
					<span class="server-expiry" :title="pub.lang(chargeName(server.charge_type))"
						>{{ pub.lang('到期') }} {{ timeText(server.expired_time, true) }}</span
					>
					<div class="server-actions">
						<el-button
							type="primary"
							plain
							size="small"
							:icon="Monitor"
							:disabled="server.status !== 'RUNNING'"
							@click="openServer(server)"
							>{{ pub.lang('终端') }}</el-button
						><el-button
							v-if="server.status === 'STOPPED'"
							type="success"
							plain
							size="small"
							:disabled="!!powerTasks[serverKey(server)]"
							@click="openPower(server, 'start')"
							>{{ pub.lang('开机') }}</el-button
						><el-button
							v-else
							class="power-stop"
							size="small"
							:disabled="server.status !== 'RUNNING' || !!powerTasks[serverKey(server)]"
							@click="openPower(server, 'stop')"
							>{{ pub.lang('关机') }}</el-button
						>
					</div>
				</footer>
			</article>
		</div>
		<el-empty
			v-if="!loading && !filtered.length && !error"
			:description="
				pub.lang(
					servers.length
						? '没有匹配的服务器'
						: partial
							? '当前未获得服务器数据，请查看失败详情'
							: '当前账号暂无服务器'
				)
			" />
		<div v-if="filtered.length > pageSize" class="pagination">
			<el-pagination
				v-model:current-page="page"
				:total="filtered.length"
				:page-size="pageSize"
				layout="total, prev, pager, next" />
		</div>

		<el-dialog
			v-model="powerVisible"
			:title="pub.lang(powerAction === 'start' ? '开机确认' : '关机确认')"
			width="470px"
			align-center
			:close-on-click-modal="false"
			:close-on-press-escape="!powerSubmitting"
			:show-close="!powerSubmitting">
			<template v-if="powerServer"
				><p>
					{{ account?.remark }} · {{ pub.lang(account?.site === 'intl' ? '国际站' : '国内站') }}
				</p>
				<div class="power-target">
					<strong>{{ powerServer.name }}</strong
					><code>{{ powerServer.instance_id }}</code
					><span>{{
						powerServer.public_ips.join(' / ') || powerServer.private_ips.join(' / ') || '--'
					}}</span
					><small>{{ powerServer.region_name }}</small>
				</div>
				<el-alert
					v-if="powerAction === 'stop'"
					type="warning"
					:closable="false"
					show-icon
					:title="pub.lang('正常关机会中断此服务器上的业务。')" />
				<p v-if="powerAction === 'stop'" class="muted">
					{{
						pub.lang(
							powerServer.source === 'cvm'
								? '使用正常关机，关机继续收费；本次不启用释放计算资源的关机不收费模式。'
								: '使用正常关机，套餐计费和到期时间不变。'
						)
					}}
				</p></template
			>
			<template #footer
				><el-button :disabled="powerSubmitting" @click="powerVisible = false">{{
					pub.lang('取消')
				}}</el-button
				><el-button
					:type="powerAction === 'stop' ? 'danger' : 'success'"
					:loading="powerSubmitting"
					@click="submitPower"
					>{{ pub.lang(powerAction === 'start' ? '确认开机' : '确认关机') }}</el-button
				></template
			>
		</el-dialog>
		<Statistics v-model="statisticsVisible" :account-id="accountId" :server="statisticsServer" />
		<ServerConnect
			ref="serverConnectRef"
			provider="tencent"
			:account-id="accountId"
			@connected="launchServerTerminal" />
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
	ArrowLeft,
	CopyDocument,
	Hide,
	Monitor,
	Refresh,
	Search,
	View,
} from '@element-plus/icons-vue'
import { copyText, pub } from '@utils/tools'
import { useMessage } from '@utils/hooks/message'
import { useXtermBase } from '@store/xterm'
import {
	request,
	descriptor,
	serverKey,
	maskId,
	money,
	timeText,
	statusName,
	statusType,
	type TencentAccount,
	type TencentServer,
	type TencentTraffic,
} from './api'
import Statistics from './statistics.vue'
import TrafficCard from './traffic-card.vue'
import ServerConnect from '../aliyun/components/server-connect.vue'

interface PowerTask {
	action: 'start' | 'stop'
	uncertain: boolean
	note: string
	attempts: number
}
interface ServerResult {
	data: TencentServer[]
	failures: Array<{ source: string; region_id: string; message: string; request_id?: string }>
	partial: boolean
	server_refresh_time: number
	server_count: number
	cvm_count: number
	lighthouse_count: number
}
const route = useRoute()
const router = useRouter()
const Message = useMessage()
const xtermStore = useXtermBase()
const serverConnectRef = ref<{ open: (server: TencentServer) => Promise<void> }>()
const accountId = computed(() => Number(route.params.accountId))
const account = ref<TencentAccount | null>(null)
const servers = ref<TencentServer[]>([])
const loading = ref(false)
const balanceLoading = ref(false)
const error = ref('')
const partial = ref(false)
const failures = ref<ServerResult['failures']>([])
const refreshTime = ref(0)
const query = reactive({ keyword: '', source: 'all', region: 'all', status: 'all' })
const showIp = ref(true)
const page = ref(1)
const pageSize = 12
const regions = computed(() =>
	Array.from(
		new Map(
			servers.value.map(server => [
				server.region_id,
				{ id: server.region_id, name: server.region_name },
			])
		).values()
	)
)
const statuses = computed(() => [...new Set(servers.value.map(server => server.status))])
const filtered = computed(() => {
	const keyword = query.keyword.trim().toLowerCase()
	return servers.value.filter(
		server =>
			(query.source === 'all' || server.source === query.source) &&
			(query.region === 'all' || server.region_id === query.region) &&
			(query.status === 'all' || server.status === query.status) &&
			`${server.name} ${server.instance_id} ${server.public_ips.join(' ')} ${server.private_ips.join(' ')}`
				.toLowerCase()
				.includes(keyword)
	)
})
const paged = computed(() =>
	filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize)
)
watch(query, () => {
	page.value = 1
})
watch(
	() => filtered.value.length,
	length => {
		page.value = Math.min(page.value, Math.max(1, Math.ceil(length / pageSize)))
	}
)
const statisticsVisible = ref(false)
const statisticsServer = ref<TencentServer | null>(null)
const powerVisible = ref(false)
const powerServer = ref<TencentServer | null>(null)
const powerAction = ref<'start' | 'stop'>('start')
const powerSubmitting = ref(false)
const powerTasks = reactive<Record<string, PowerTask>>({})
const stateLoading = reactive(new Set<string>())
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const traffic = reactive<Record<string, TencentTraffic>>({})
const trafficErrors = reactive<Record<string, string>>({})
const trafficLoading = reactive(new Set<string>())
let trafficQueue: Array<{ server: TencentServer; force: boolean }> = []
let trafficJobs = 0
let generation = 0
let disposed = false
const showError = (exception: unknown) =>
	Message.error(exception instanceof Error ? exception.message : pub.lang('请求失败'))
const copyIp = (ip: string) => copyText({ value: ip, success: pub.lang('IP 已复制') })
const chargeNames: Record<string, string> = {
	PREPAID: '包年包月',
	POSTPAID_BY_HOUR: '按量计费',
	CDHPAID: '专用宿主机',
}
const chargeName = (type: string) => chargeNames[type] || type || '--'

function queueTraffic(force = false) {
	const previous = new Map(trafficQueue.map(job => [serverKey(job.server), job.force]))
	trafficQueue = paged.value
		.filter(server => {
			const key = serverKey(server)
			return (
				!trafficLoading.has(key) &&
				(force ||
					previous.get(key) ||
					!traffic[key] ||
					Date.now() / 1000 - traffic[key].update_time >= 300)
			)
		})
		.map(server => ({ server, force: force || previous.get(serverKey(server)) || false }))
	pumpTraffic()
}
function pumpTraffic() {
	// 换页只保留当前页待查询项；在途请求继续占用并发名额，避免快速翻页放大请求量。
	while (!disposed && trafficJobs < 2 && trafficQueue.length) {
		const job = trafficQueue.shift()!
		const key = serverKey(job.server)
		const current = generation
		const id = accountId.value
		trafficJobs++
		trafficLoading.add(key)
		delete trafficErrors[key]
		void request<TencentTraffic>('server_traffic', {
			account_id: id,
			...descriptor(job.server),
			force: job.force,
		})
			.then(result => {
				if (current === generation && !disposed) traffic[key] = result
			})
			.catch(exception => {
				if (current === generation && !disposed)
					trafficErrors[key] =
						exception instanceof Error ? exception.message : pub.lang('流量查询失败')
			})
			.finally(() => {
				trafficJobs--
				if (current === generation) trafficLoading.delete(key)
				pumpTraffic()
			})
	}
}
watch(paged, () => queueTraffic())

async function refreshBalance() {
	if (balanceLoading.value) return
	const current = generation
	balanceLoading.value = true
	try {
		const result = await request('refresh_balance', { account_id: accountId.value })
		if (current === generation && account.value) Object.assign(account.value, result)
	} catch (exception) {
		if (current === generation) {
			showError(exception)
			if (account.value)
				account.value.balance_error =
					exception instanceof Error ? exception.message : pub.lang('余额查询失败')
		}
	} finally {
		if (current === generation) balanceLoading.value = false
	}
}
async function loadServers(force = false) {
	if (loading.value) return
	const current = generation
	loading.value = true
	error.value = ''
	try {
		const result = await request<ServerResult>('server_list', {
			account_id: accountId.value,
			force,
		})
		if (current !== generation || disposed) return
		servers.value = result.data
		partial.value = result.partial
		failures.value = result.failures
		refreshTime.value = result.server_refresh_time
		queueTraffic(force)
		if (account.value)
			Object.assign(account.value, {
				server_count: result.server_count,
				cvm_count: result.cvm_count,
				lighthouse_count: result.lighthouse_count,
			})
		for (const server of servers.value) {
			const key = serverKey(server)
			const pending = server.pending
			if ((pending || ['STARTING', 'STOPPING'].includes(server.status)) && !powerTasks[key]) {
				powerTasks[key] = {
					action: pending?.action || (server.status === 'STARTING' ? 'start' : 'stop'),
					uncertain: !!pending?.uncertain,
					note: '正在确认实例状态…',
					attempts: 0,
				}
				scheduleState(server)
			}
		}
	} catch (exception) {
		if (current === generation)
			error.value = exception instanceof Error ? exception.message : pub.lang('服务器查询失败')
	} finally {
		if (current === generation) loading.value = false
	}
}
function openStatistics(server: TencentServer) {
	statisticsServer.value = server
	statisticsVisible.value = true
}
function openServer(server: TencentServer) {
	void serverConnectRef.value?.open(server)
}
async function launchServerTerminal(data: Record<string, unknown>) {
	xtermStore.queueLaunch(data)
	try {
		const failure = await router.push('/xterm')
		if (failure || router.currentRoute.value.path !== '/xterm') throw new Error('终端页面未打开')
	} catch {
		xtermStore.consumeLaunch()
		await request('ssh_cancel', { job_id: data.job_id }).catch(() => {})
		Message.error(pub.lang('终端页面打开失败，请重新连接'))
	}
}
function openPower(server: TencentServer, action: 'start' | 'stop') {
	powerServer.value = server
	powerAction.value = action
	powerVisible.value = true
}
async function submitPower() {
	const server = powerServer.value
	if (!server || powerSubmitting.value) return
	const current = generation
	const action = powerAction.value
	const key = serverKey(server)
	powerSubmitting.value = true
	powerTasks[key] = { action, uncertain: false, note: '正在提交操作…', attempts: 0 }
	try {
		const result = await request('server_power', {
			account_id: accountId.value,
			...descriptor(server),
			action,
			confirm_instance_id: server.instance_id,
		})
		if (current !== generation || disposed) return
		server.status = result.status
		powerTasks[key].note = '请求已受理，正在等待实例状态更新…'
		powerVisible.value = false
		Message.success(pub.lang('请求已受理'))
		scheduleState(server)
	} catch (exception) {
		if (current !== generation || disposed) return
		showError(exception)
		// IPC 或网络超时可能已受理，统一回查，不重复下发。
		powerTasks[key].uncertain = true
		powerTasks[key].note = '操作尚未确认，正在查询实际状态…'
		powerVisible.value = false
		scheduleState(server)
	} finally {
		if (current === generation) powerSubmitting.value = false
	}
}
function scheduleState(server: TencentServer) {
	const key = serverKey(server)
	const previous = timers.get(key)
	if (previous) clearTimeout(previous)
	timers.set(
		key,
		setTimeout(() => {
			timers.delete(key)
			void checkState(server)
		}, 3000)
	)
}
async function checkState(server: TencentServer) {
	const key = serverKey(server)
	if (stateLoading.has(key) || disposed) return
	const current = generation
	stateLoading.add(key)
	const previous = timers.get(key)
	if (previous) {
		clearTimeout(previous)
		timers.delete(key)
	}
	try {
		const result = await request('server_state', {
			account_id: accountId.value,
			...descriptor(server),
		})
		if (current !== generation || disposed) return
		const row = servers.value.find(item => serverKey(item) === key)
		if (row) Object.assign(row, result)
		const task = powerTasks[key]
		if (!task) return
		if (
			result.operation_failed ||
			(!result.pending && ['RUNNING', 'STOPPED'].includes(result.status))
		) {
			delete powerTasks[key]
			if (result.operation_failed) Message.error(pub.lang('腾讯云返回操作失败，请核对实例状态'))
			else Message.success(pub.lang('当前实例状态：{}', statusName(result.status)))
			return
		}
		task.attempts++
		if (task.attempts < 40) scheduleState(row || server)
		else {
			task.uncertain = true
			task.note = '状态更新耗时较长，请手动查询状态'
		}
	} catch (exception) {
		if (current !== generation || disposed) return
		const task = powerTasks[key]
		if (task) {
			task.uncertain = true
			task.attempts++
			task.note = '状态查询暂时失败，可手动重试'
			if (task.attempts < 10) scheduleState(server)
		}
	} finally {
		stateLoading.delete(key)
	}
}
function clearTimers() {
	timers.forEach(timer => clearTimeout(timer))
	timers.clear()
}
watch(
	accountId,
	async id => {
		generation++
		const current = generation
		clearTimers()
		Object.keys(powerTasks).forEach(key => delete powerTasks[key])
		stateLoading.clear()
		trafficQueue = []
		Object.keys(traffic).forEach(key => delete traffic[key])
		Object.keys(trafficErrors).forEach(key => delete trafficErrors[key])
		trafficLoading.clear()
		account.value = null
		servers.value = []
		failures.value = []
		partial.value = false
		error.value = ''
		refreshTime.value = 0
		loading.value = false
		balanceLoading.value = false
		powerVisible.value = false
		statisticsVisible.value = false
		Object.assign(query, { keyword: '', source: 'all', region: 'all', status: 'all' })
		try {
			const result = await request<TencentAccount>('find', { account_id: id })
			if (current !== generation || disposed) return
			account.value = result
			void loadServers()
			if (Date.now() / 1000 - result.balance_refresh_time > 300) void refreshBalance()
		} catch (exception) {
			if (current === generation)
				error.value = exception instanceof Error ? exception.message : pub.lang('账号加载失败')
		}
	},
	{ immediate: true }
)
onBeforeUnmount(() => {
	disposed = true
	generation++
	trafficQueue = []
	clearTimers()
})
</script>

<style scoped lang="scss">
@use '../../styles/cloud-layout' as cloud;

.tencent-detail {
	min-height: 100%;
	padding: 2rem 3.6rem 3.6rem;
	color: var(--el-text-color-primary);
}
.page-header {
	display: flex;
	min-height: 6.8rem;
	align-items: center;
	gap: 1.2rem;
	padding-bottom: 1.4rem;

	> .el-button {
		flex-shrink: 0;
	}
}
.brand {
	display: flex;
	width: 4.4rem;
	height: 4.4rem;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	border-radius: 1rem;
	color: var(--el-color-primary);
	background: var(--el-color-primary-light-9);
}
.identity {
	min-width: 0;
	flex: 1;
	h1 {
		overflow: hidden;
		margin: 0;
		font-size: 1.8rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	p {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		margin: 0.3rem 0 0;
		color: var(--el-text-color-secondary);
		font-size: 1.15rem;
	}
}
.balance {
	min-width: 15rem;
	flex-shrink: 0;

	small {
		display: block;
		margin-top: 0.2rem;
		color: var(--el-text-color-secondary);
		font-size: 1.1rem;
		white-space: nowrap;
	}
}
.balance-amount {
	display: flex;
	align-items: center;
	gap: 0.35rem;
	white-space: nowrap;

	strong {
		color: var(--el-color-primary);
		font-size: 2.25rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.el-button {
		flex-shrink: 0;
	}
}
.page-alert {
	margin: 1.2rem 0;
}
.failure-details {
	margin-top: 0.5rem;
	p {
		font-size: 1.1rem;
		overflow-wrap: anywhere;
	}
}
.server-heading {
	display: flex;
	align-items: center;
	gap: 0.8rem;
	margin-bottom: 1.6rem;
	padding: 0.7rem 0;
	border-top: 1px solid var(--el-border-color-lighter);
	border-bottom: 1px solid var(--el-border-color-lighter);

	h2 {
		display: flex;
		height: 3.6rem;
		align-items: center;
		gap: 0.65rem;
		margin: 0;
		padding: 0 1.8rem;
		border-radius: 0.6rem;
		color: var(--el-color-primary);
		font-size: 1.3rem;
		font-weight: 600;
		background: var(--el-color-primary-light-9);
	}
	small {
		font-size: 1.15rem;
		font-weight: 600;
		white-space: nowrap;
	}
	> span:not(.el-tag) {
		margin-left: auto;
		color: var(--el-text-color-secondary);
		font-size: 1.1rem;
	}
}
.toolbar {
	display: flex;
	justify-content: space-between;
	align-items: center;
	flex-wrap: wrap;
	gap: 1.6rem;
	margin-bottom: 1rem;
}
.toolbar-filters {
	display: flex;
	min-width: 0;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.8rem;

	.el-input {
		width: 30rem;
	}
	.el-select {
		width: 15rem;
	}
}
.toolbar-actions {
	display: flex;
	align-items: center;
	gap: 0.6rem;
}
.server-grid {
	@include cloud.server-grid;

	min-height: 8rem;
}
.server-card {
	@include cloud.server-card;

	> header {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 0.8rem;
		> .el-tag {
			flex-shrink: 0;
		}
	}
}
.server-icon {
	display: flex;
	width: 3rem;
	height: 3rem;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	border-radius: 0.6rem;
	color: var(--el-color-primary);
	font-size: 1.7rem;
	background: var(--el-color-primary-light-9);
}
.server-name {
	min-width: 0;
	flex: 1;
	strong,
	small {
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	strong {
		font-size: 1.35rem;
		font-weight: 650;
	}
	small {
		margin-top: 0.2rem;
		color: var(--el-text-color-secondary);
		font-size: 1rem;
	}
}
.server-meta {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 0.6rem;
	color: var(--el-text-color-secondary);
	font-size: 1.05rem;

	> .el-tag,
	> span:not(.os-name) {
		flex-shrink: 0;
	}
	.os-name {
		min-width: 0;
		overflow: hidden;
		padding-left: 0.6rem;
		border-left: 1px solid var(--el-border-color-light);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}
.server-specs {
	display: grid;
	grid-template-columns: 1.3fr 1fr 1fr;
	gap: 0.7rem;
	padding: 0.4rem 0;
	border-top: 1px solid var(--el-border-color-lighter);

	> div {
		display: flex;
		min-width: 0;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	span {
		color: var(--el-text-color-secondary);
		font-size: 1rem;
	}
	strong {
		font-size: 1.1rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
}
.server-ips {
	font-size: 1.05rem;
	> div {
		display: flex;
		min-height: 1.9rem;
		align-items: center;
		gap: 0.35rem;
	}
	span {
		min-width: 2.6rem;
		color: var(--el-text-color-secondary);
		font-size: 1rem;
	}
	code {
		min-width: 0;
		font-size: inherit;
		overflow-wrap: anywhere;
	}
	.el-button {
		flex-shrink: 0;
		padding: 0.1rem;
		opacity: 0.58;
	}
}
.server-card > footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 0.6rem;
	margin-top: auto;
	padding-top: 0.2rem;
	color: var(--el-text-color-secondary);
	font-size: 1rem;

	.el-button {
		margin: 0;
	}
}
.server-expiry {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.server-actions {
	display: flex;
	flex-shrink: 0;
	gap: 0.6rem;
}
.power-stop:not(:disabled) {
	color: var(--el-color-danger);
	border-color: var(--el-color-danger-light-7);
	&:hover {
		background: var(--el-color-danger-light-9);
	}
}
.muted {
	color: var(--el-text-color-secondary);
}
.pagination {
	display: flex;
	justify-content: flex-end;
	margin-top: 1.5rem;
}
.operation-note {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0.6rem;
	color: var(--el-color-warning);
	font-size: 1rem;
}
.power-target {
	display: flex;
	flex-direction: column;
	gap: 0.8rem;
	margin: 1rem 0 1.5rem;
	padding: 1.5rem;
	border-radius: 0.8rem;
	background: var(--el-fill-color-light);
	overflow-wrap: anywhere;
}
@media (max-width: 800px) {
	.page-header {
		flex-wrap: wrap;
	}
	.balance {
		width: 100%;
	}
	.toolbar-filters,
	.toolbar-filters .el-input {
		width: 100%;
	}
	.server-heading {
		flex-wrap: wrap;
	}
}
</style>
