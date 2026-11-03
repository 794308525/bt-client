<template>
	<section>
		<el-tabs v-model="tab" @tab-change="changeTab">
			<el-tab-pane label="源站与 HTTPS" name="config">
				<el-button :loading="loading" :disabled="busy" @click="loadConfig">刷新配置</el-button>
				<div v-if="config" v-loading="loading" class="edge-settings">
					<section>
						<h3>源站配置</h3>
						<el-form label-width="95px" :disabled="busy || !config.origin_editable"
							><el-form-item label="源站类型"
								><span>{{ config.origin_type }}</span></el-form-item
							><el-form-item label="源站地址"
								><el-input
									v-model="form.origin"
									type="textarea"
									:rows="3"
									:placeholder="
										zoneId ? '单个 IP、域名或 COS 访问域名' : '每行一个 IP 或域名，可携带端口'
									" /></el-form-item
							><el-form-item label="回源协议"
								><el-select v-model="form.protocol"
									><el-option
										v-for="option in protocols"
										:key="option.value"
										:value="option.value"
										:label="option.label" /></el-select></el-form-item
							><el-form-item v-if="!zoneId || config.origin_type === 'IP_DOMAIN'" label="回源 Host"
								><el-input
									v-model="form.host_header"
									placeholder="留空使用默认回源 Host" /></el-form-item
						></el-form>
						<p v-if="!config.origin_editable" class="edge-note">
							该源站类型使用复杂配置，请前往腾讯云控制台修改。
						</p>
						<el-button
							type="primary"
							:loading="busy"
							:disabled="!config.origin_editable"
							@click="save('origin')"
							>保存源站</el-button
						>
					</section>
					<section>
						<h3>HTTPS 证书</h3>
						<p class="edge-note">
							当前证书：{{
								config.certificate_id || '未获取到 SSL 证书 ID'
							}}。可从当前账号证书列表选择，或填写腾讯云 SSL 证书 ID，再部署到本加速域名。
						</p>
						<div class="edge-inline">
							<el-input
								v-model="form.certificate_id"
								placeholder="腾讯云 SSL 证书 ID"
								:disabled="busy" /><el-button :disabled="busy" @click="certificateVisible = true"
								>选择证书</el-button
							><el-button type="primary" :loading="busy" @click="save('certificate')"
								>部署证书</el-button
							>
						</div>
					</section>
					<section>
						<h3>{{ zoneId ? '站点级强制 HTTPS' : '强制 HTTPS' }}</h3>
						<el-alert
							v-if="zoneId"
							title="此设置作用于当前 EdgeOne 站点全部域名；规则引擎中的独立规则可能覆盖站点设置。"
							type="info"
							:closable="false" /><el-alert
							v-if="config.redirect_error"
							:title="config.redirect_error"
							type="warning"
							:closable="false" />
						<div class="edge-inline">
							<el-switch
								v-model="form.enabled"
								:disabled="busy || !!config.redirect_error"
								active-text="开启"
								inactive-text="关闭" /><el-select
								v-model="form.redirect_code"
								:disabled="busy || !!config.redirect_error"
								class="redirect-code"
								><el-option :value="301" label="301 永久跳转" /><el-option
									:value="302"
									label="302 临时跳转" /></el-select
							><el-button
								type="primary"
								:loading="busy"
								:disabled="!!config.redirect_error"
								@click="save('redirect')"
								>保存跳转</el-button
							>
						</div>
					</section>
				</div>
			</el-tab-pane>
			<el-tab-pane label="刷新与预热" name="cache">
				<el-radio-group v-model="cacheKind" :disabled="busy" @change="changeCacheKind"
					><el-radio-button value="url">URL 刷新</el-radio-button
					><el-radio-button value="directory">目录刷新</el-radio-button
					><el-radio-button value="prefetch">URL 预热</el-radio-button></el-radio-group
				>
				<el-input
					v-model="targets"
					type="textarea"
					:rows="6"
					:disabled="busy"
					:placeholder="`每行一个完整地址，仅限 ${domain}；目录须以 / 结尾。`"
					class="target-input" />
				<el-button
					type="primary"
					:loading="busy"
					:disabled="!targets.trim() || trackedJobs.filter(job => job.active).length >= 5"
					@click="submitCache"
					>提交{{ cacheKind === 'prefetch' ? '预热' : '刷新' }}</el-button
				>
				<p class="edge-note">
					任务处理中每 8 秒更新一次；页面隐藏或切换后暂停，返回后继续。每次自动跟踪最多 15
					分钟，可手动继续查询。
				</p>
				<div v-for="job in trackedJobs" :key="job.id + job.kind" class="tracked-job">
					<div class="edge-inline">
						<strong>{{ cacheTypeName(job.kind) }} · {{ job.id }}</strong
						><el-tag
							:type="job.progress?.complete ? (job.progress.failed ? 'danger' : 'success') : 'info'"
							>{{
								job.progress?.complete
									? job.progress.failed
										? '部分或全部失败'
										: '全部成功'
									: job.active
										? '跟踪中'
										: '已暂停'
							}}</el-tag
						><el-button
							v-if="!job.active && !job.progress?.complete"
							link
							type="primary"
							@click="resumeJob(job)"
							>继续查询</el-button
						><el-button v-if="!job.active" link @click="removeJob(job)">移除</el-button>
					</div>
					<p v-if="job.progress" class="edge-note">
						已确认 {{ job.progress.checked }}/{{ job.progress.total }} 条 · 成功
						{{ job.progress.success }} · 失败 {{ job.progress.failed }} · 处理中
						{{ job.progress.running
						}}<span v-if="job.progress.partial"> · 结果未完整，尚不能确认整批完成</span>
					</p>
					<p v-if="job.error" class="task-error">{{ job.error }}</p>
					<p v-for="(failure, index) in job.progress?.errors || []" :key="index" class="task-error">
						{{ failure.target }}：{{ failure.message }}
					</p>
				</div>
				<div class="edge-task-heading">
					<h3>最近 48 小时任务</h3>
					<el-button :loading="taskLoading" @click="loadTasks">刷新记录</el-button>
				</div>
				<el-alert v-if="taskError" :title="taskError" type="warning" :closable="false" />
				<el-table :data="tasks" v-loading="taskLoading"
					><el-table-column
						prop="target"
						label="目标"
						min-width="230"
						show-overflow-tooltip /><el-table-column label="状态" width="105"
						><template #default="{ row }"
							>{{ taskStatusName(row.status)
							}}<span v-if="row.percent !== null"> {{ row.percent }}%</span></template
						></el-table-column
					><el-table-column prop="type" label="类型" width="110" /><el-table-column
						label="提交时间"
						width="180"
						><template #default="{ row }">{{ timeText(row.created_at) }}</template></el-table-column
					><el-table-column prop="message" label="失败原因" min-width="150" show-overflow-tooltip />
					<el-table-column label="操作" width="90"
						><template #default="{ row }"
							><el-button
								v-if="row.id && ['running', 'unknown'].includes(row.state)"
								link
								type="primary"
								:disabled="trackedJobs.filter(job => job.active).length >= 5"
								@click="trackJob(row.id, cacheKind)"
								>跟踪</el-button
							></template
						></el-table-column
					></el-table
				>
				<el-pagination
					v-model:current-page="taskPage"
					:page-size="20"
					:total="taskTotal"
					layout="total, prev, pager, next"
					class="edge-pagination"
					@current-change="loadTasks" />
			</el-tab-pane>
			<el-tab-pane label="访问流量" name="traffic">
				<div class="edge-inline">
					<el-radio-group v-model="days" :disabled="trafficLoading" @change="loadTraffic"
						><el-radio-button :value="1">近 24 小时</el-radio-button
						><el-radio-button :value="7">近 7 天</el-radio-button></el-radio-group
					><el-button :loading="trafficLoading" @click="loadTraffic">刷新流量</el-button>
				</div>
				<p class="edge-note">
					按小时查询，时间以北京时间显示；未返回的数据保留为空，不作为零流量。
				</p>
				<div v-if="traffic.length" class="traffic-total">
					<span
						>下行流量 <strong>{{ volume(totalBytes) }}</strong></span
					><span v-if="zoneId"
						>访问请求 <strong>{{ totalRequests?.toLocaleString() ?? '--' }}</strong></span
					>
				</div>
				<svg
					v-if="traffic.length > 1 && totalBytes !== null"
					class="edge-chart"
					viewBox="0 0 720 150"
					role="img"
					aria-label="每小时下行流量趋势">
					<path d="M 0 140 H 720" stroke="var(--el-border-color)" />
					<polyline
						:points="chartPoints"
						fill="none"
						stroke="var(--el-color-primary)"
						stroke-width="2" />
				</svg>
				<el-table
					:data="traffic"
					v-loading="trafficLoading"
					max-height="430"
					empty-text="所选时段未返回流量数据"
					><el-table-column label="时间" min-width="180"
						><template #default="{ row }">{{
							timeText(row.time / 1000)
						}}</template></el-table-column
					><el-table-column label="下行流量" min-width="150"
						><template #default="{ row }">{{ volume(row.bytes) }}</template></el-table-column
					><el-table-column v-if="zoneId" label="请求数" min-width="150"
						><template #default="{ row }">{{
							row.requests?.toLocaleString() ?? '--'
						}}</template></el-table-column
					></el-table
				>
			</el-tab-pane>
		</el-tabs>
		<CertificatePicker
			v-model="certificateVisible"
			:account-id="accountId"
			:domain="domain"
			@select="value => (form.certificate_id = value)" />
		<el-alert v-if="error" :title="error" type="error" :closable="false" class="edge-alert" />
		<el-alert v-if="note" :title="note" type="success" :closable="false" class="edge-alert" />
	</section>
</template>
<script setup lang="ts">
import {
	computed,
	onActivated,
	onBeforeUnmount,
	onDeactivated,
	onMounted,
	reactive,
	ref,
	watch,
} from 'vue'
import { ElMessageBox } from 'element-plus'
import { cloudErrorText, resourceRequest, timeText, volume, type PageResult } from './api'
import CertificatePicker from './certificate-picker.vue'
interface Config {
	origin: string
	host_header: string
	origin_type: string
	protocol: string
	origin_editable: boolean
	certificate_id: string
	force_redirect: { Switch: string; RedirectType?: string; RedirectStatusCode?: number }
	redirect_error: string
}
interface Task {
	id: string
	target: string
	status: string
	type: string
	created_at: string
	message: string
	state: 'success' | 'failed' | 'running' | 'unknown'
	percent: number | null
}
interface TaskProgress {
	task_id: string
	total: number
	checked: number
	success: number
	failed: number
	running: number
	unknown: number
	complete: boolean
	partial: boolean
	errors: Array<{ target: string; message: string }>
}
interface TrackedJob {
	id: string
	kind: string
	active: boolean
	started: number
	progress?: TaskProgress
	error: string
}
interface Traffic {
	time: number
	bytes: number | null
	requests: number | null
}
const props = defineProps<{
	accountId: number
	domain: string
	zoneId?: string
	active?: boolean
}>()
const emit = defineEmits<{ (event: 'updated'): void }>()
const tab = ref('config'),
	loading = ref(false),
	busy = ref(false),
	error = ref(''),
	note = ref(''),
	config = ref<Config>()
const certificateVisible = ref(false),
	trackedJobs = ref<TrackedJob[]>([]),
	taskError = ref('')
const form = reactive({
	origin: '',
	host_header: '',
	protocol: '',
	certificate_id: '',
	enabled: false,
	redirect_code: 301,
})
const cacheKind = ref('url'),
	targets = ref(''),
	tasks = ref<Task[]>([]),
	taskPage = ref(1),
	taskTotal = ref(0),
	taskLoading = ref(false)
const traffic = ref<Traffic[]>([]),
	trafficLoading = ref(false),
	days = ref(1)
const protocols = computed(() => [
	{ value: props.zoneId ? 'FOLLOW' : 'follow', label: '协议跟随' },
	{ value: props.zoneId ? 'HTTP' : 'http', label: 'HTTP' },
	{ value: props.zoneId ? 'HTTPS' : 'https', label: 'HTTPS' },
])
const totalBytes = computed(() =>
	traffic.value.some(row => row.bytes !== null)
		? traffic.value.reduce((sum, row) => sum + (row.bytes || 0), 0)
		: null
)
const totalRequests = computed(() =>
	traffic.value.some(row => row.requests !== null)
		? traffic.value.reduce((sum, row) => sum + (row.requests || 0), 0)
		: null
)
const chartPoints = computed(() => {
	const max = Math.max(...traffic.value.map(row => row.bytes || 0), 1)
	return traffic.value
		.filter(row => row.bytes !== null)
		.map(
			row =>
				`${((row.time - traffic.value[0].time) / Math.max(traffic.value.at(-1)!.time - traffic.value[0].time, 1)) * 720},${140 - ((row.bytes || 0) / max) * 130}`
		)
		.join(' ')
})
let generation = 0,
	configSequence = 0,
	taskSequence = 0,
	trafficSequence = 0
let pollTimer: ReturnType<typeof setTimeout> | undefined,
	pollEpoch = 0,
	pollRunning = false,
	pageActive = true,
	historyUntil = 0,
	trackingKey = ''
const cacheTypeName = (kind: string) =>
	(({ url: 'URL 刷新', directory: '目录刷新', prefetch: 'URL 预热' }) as Record<string, string>)[
		kind
	] || kind
const taskStatusName = (status: string) =>
	(
		({
			done: '成功',
			success: '成功',
			process: '处理中',
			processing: '处理中',
			fail: '失败',
			failed: '失败',
			timeout: '超时',
			canceled: '已取消',
			invalid: '无效',
		}) as Record<string, string>
	)[status] ||
	status ||
	'未知'
const canPoll = () =>
	pageActive && props.active !== false && !document.hidden && tab.value === 'cache'
function saveTrackedJobs() {
	if (!trackingKey) return
	try {
		sessionStorage.setItem(
			trackingKey,
			JSON.stringify(
				trackedJobs.value
					.filter(job => !job.progress?.complete)
					.map(({ id, kind, active, started }) => ({ id, kind, active, started }))
			)
		)
	} catch {
		/* 存储不可用时仍可在当前页面跟踪。 */
	}
}
function restoreTrackedJobs(): TrackedJob[] {
	try {
		const value = JSON.parse(sessionStorage.getItem(trackingKey) || '[]')
		return Array.isArray(value)
			? value
					.filter(
						job =>
							job &&
							typeof job.id === 'string' &&
							/^[a-zA-Z0-9_-]{1,160}$/.test(job.id) &&
							['url', 'directory', 'prefetch'].includes(job.kind) &&
							Number.isFinite(job.started) &&
							Date.now() - job.started < 48 * 3600000
					)
					.slice(-10)
					.map(job => ({
						id: job.id,
						kind: job.kind,
						started: job.started,
						active: job.active === true,
						error: job.active === true ? '' : '上次自动跟踪已暂停，可继续查询。',
					}))
			: []
	} catch {
		return []
	}
}
const hasPendingRows = () =>
	tasks.value.some(row => row.state === 'running' || row.state === 'unknown')
function pausePolling() {
	if (pollTimer) clearTimeout(pollTimer)
	pollTimer = undefined
	pollEpoch++
}
function schedulePoll(delay = 8000) {
	if (pollTimer) clearTimeout(pollTimer)
	pollTimer = undefined
	if (
		canPoll() &&
		(trackedJobs.value.some(job => job.active) ||
			(!taskError.value && hasPendingRows() && Date.now() < historyUntil))
	)
		pollTimer = setTimeout(pollTasks, delay)
}
async function pollTasks() {
	pollTimer = undefined
	if (!canPoll()) return
	if (pollRunning) {
		schedulePoll()
		return
	}
	pollRunning = true
	const current = generation,
		epoch = pollEpoch
	try {
		for (const job of trackedJobs.value.filter(item => item.active)) {
			if (current !== generation || epoch !== pollEpoch || !canPoll()) return
			if (Date.now() - job.started >= 15 * 60 * 1000) {
				job.active = false
				job.error = '自动跟踪已暂停，任务可能仍在执行，可点击继续查询。'
				continue
			}
			try {
				const progress = await resourceRequest<TaskProgress>('cache_progress', {
					...scope(),
					kind: job.kind,
					task_id: job.id,
				})
				if (current !== generation || epoch !== pollEpoch) return
				job.progress = progress
				if (progress.complete) job.active = false
			} catch (exception) {
				if (current !== generation || epoch !== pollEpoch) return
				job.active = false
				job.error = `${cloudErrorText(exception)}；自动查询已暂停。`
			}
		}
		if (current === generation && epoch === pollEpoch && canPoll() && !taskError.value)
			await fetchTasks(true)
	} finally {
		pollRunning = false
		if (current === generation) saveTrackedJobs()
		schedulePoll()
	}
}
function resumeJob(job: TrackedJob) {
	if (trackedJobs.value.filter(item => item.active).length >= 5) return
	job.active = true
	job.started = Date.now()
	job.error = ''
	saveTrackedJobs()
	schedulePoll(0)
}
function trackJob(id: string, kind: string) {
	const existing = trackedJobs.value.find(job => job.id === id && job.kind === kind)
	if (existing) {
		if (!existing.active && !existing.progress?.complete) resumeJob(existing)
		return
	}
	if (trackedJobs.value.filter(job => job.active).length >= 5) return
	trackedJobs.value = [
		...trackedJobs.value.slice(-9),
		{ id, kind, active: true, started: Date.now(), error: '' },
	]
	saveTrackedJobs()
	schedulePoll(0)
}
function removeJob(job: TrackedJob) {
	trackedJobs.value = trackedJobs.value.filter(item => item !== job)
	saveTrackedJobs()
}
function visibilityChanged() {
	if (document.hidden) pausePolling()
	else schedulePoll(0)
}
const scope = () => ({
	account_id: props.accountId,
	domain: props.domain,
	...(props.zoneId ? { zone_id: props.zoneId } : {}),
})
async function loadConfig() {
	const id = ++configSequence,
		current = generation
	loading.value = true
	error.value = ''
	try {
		const result = await resourceRequest<Config>('edge_config', scope())
		if (id === configSequence && current === generation) {
			config.value = result
			Object.assign(form, {
				origin: result.origin,
				host_header: result.host_header,
				protocol: result.protocol || (props.zoneId ? 'FOLLOW' : 'follow'),
				certificate_id: result.certificate_id,
				enabled:
					result.force_redirect.Switch === 'on' &&
					(!result.force_redirect.RedirectType || result.force_redirect.RedirectType === 'https'),
				redirect_code: result.force_redirect.RedirectStatusCode || 301,
			})
		}
	} catch (exception) {
		if (id === configSequence && current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (id === configSequence && current === generation) loading.value = false
	}
}
async function save(operation: 'origin' | 'certificate' | 'redirect') {
	if (busy.value || loading.value) return
	const current = generation
	const payload = { ...scope(), ...form, operation, confirm_domain: props.domain }
	try {
		await ElMessageBox.confirm(
			operation === 'redirect' && props.zoneId
				? '此操作将修改当前 EdgeOne 站点全部域名的强制 HTTPS 设置，确认保存？'
				: `确认修改 ${props.domain} 的${operation === 'origin' ? '源站' : operation === 'certificate' ? 'HTTPS 证书' : '强制 HTTPS 设置'}？`,
			'确认修改',
			{ type: 'warning' }
		)
	} catch {
		return
	}
	if (current !== generation || busy.value) return
	busy.value = true
	error.value = ''
	note.value = ''
	try {
		const result = await resourceRequest<{ request_id: string }>('edge_change', payload)
		if (current !== generation) return
		note.value = `修改已提交，配置下发需要一定时间。${result.request_id ? 'RequestId: ' + result.request_id : ''}`
		emit('updated')
		await loadConfig()
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
async function fetchTasks(silent = false) {
	const id = ++taskSequence,
		current = generation
	if (!silent) taskLoading.value = true
	taskError.value = ''
	try {
		const result = await resourceRequest<PageResult<Task>>('cache_tasks', {
			...scope(),
			kind: cacheKind.value,
			page: taskPage.value,
		})
		if (id === taskSequence && current === generation) {
			tasks.value = result.data
			taskTotal.value = result.total
		}
	} catch (exception) {
		if (id === taskSequence && current === generation) taskError.value = cloudErrorText(exception)
	} finally {
		if (id === taskSequence && current === generation) taskLoading.value = false
	}
}
async function loadTasks() {
	historyUntil = Date.now() + 15 * 60 * 1000
	await fetchTasks()
	schedulePoll()
}
function changeCacheKind() {
	pausePolling()
	taskSequence++
	taskLoading.value = false
	taskPage.value = 1
	tasks.value = []
	taskTotal.value = 0
	void loadTasks()
}
async function submitCache() {
	if (busy.value || trackedJobs.value.filter(job => job.active).length >= 5) return
	const current = generation,
		payload = { ...scope(), kind: cacheKind.value, targets: targets.value }
	try {
		await ElMessageBox.confirm(
			`向 ${props.domain} 提交${cacheKind.value === 'prefetch' ? '预热' : '刷新'}任务？预热可能产生回源流量。`,
			'确认提交',
			{ type: 'warning' }
		)
	} catch {
		return
	}
	if (
		current !== generation ||
		busy.value ||
		trackedJobs.value.filter(job => job.active).length >= 5
	)
		return
	busy.value = true
	error.value = ''
	note.value = ''
	try {
		const result = await resourceRequest<{ task_id: string; request_id: string }>(
			'cache_submit',
			payload
		)
		if (current !== generation) return
		note.value = `任务已提交：${result.task_id || result.request_id}。`
		if (result.task_id) trackJob(result.task_id, payload.kind)
		taskPage.value = 1
		await loadTasks()
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
async function loadTraffic() {
	const id = ++trafficSequence,
		current = generation
	trafficLoading.value = true
	error.value = ''
	try {
		const result = await resourceRequest<{ data: Traffic[] }>('edge_traffic', {
			...scope(),
			days: days.value,
		})
		if (id === trafficSequence && current === generation) traffic.value = result.data
	} catch (exception) {
		if (id === trafficSequence && current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (id === trafficSequence && current === generation) trafficLoading.value = false
	}
}
function changeTab() {
	pausePolling()
	error.value = ''
	note.value = ''
	if (tab.value === 'cache') void loadTasks()
	if (tab.value === 'traffic') void loadTraffic()
}
watch(
	() => [props.accountId, props.domain, props.zoneId],
	() => {
		saveTrackedJobs()
		generation++
		pausePolling()
		taskSequence++
		tab.value = 'config'
		certificateVisible.value = false
		trackingKey = `tencent-cache-jobs:${props.accountId}:${props.zoneId || 'cdn'}:${props.domain}`
		trackedJobs.value = restoreTrackedJobs()
		taskError.value = ''
		taskLoading.value = false
		taskPage.value = 1
		taskTotal.value = 0
		config.value = undefined
		busy.value = false
		tasks.value = []
		traffic.value = []
		note.value = ''
		void loadConfig()
	},
	{ immediate: true }
)
watch(
	() => props.active,
	value => {
		if (value === false) pausePolling()
		else schedulePoll(0)
	}
)
onMounted(() => {
	document.addEventListener('visibilitychange', visibilityChanged)
})
onActivated(() => {
	pageActive = true
	schedulePoll(0)
})
onDeactivated(() => {
	pageActive = false
	pausePolling()
})
onBeforeUnmount(() => {
	saveTrackedJobs()
	pageActive = false
	pausePolling()
	document.removeEventListener('visibilitychange', visibilityChanged)
	generation++
})
</script>
<style scoped>
.edge-settings section {
	padding: 18px 0;
	border-bottom: 1px solid var(--el-border-color-lighter);
}
.tracked-job {
	border: 1px solid var(--el-border-color-lighter);
	padding: 0 14px 10px;
	margin-top: 12px;
	overflow-wrap: anywhere;
}
.task-error {
	color: var(--el-color-danger);
	font-size: 12px;
	overflow-wrap: anywhere;
}
.edge-settings h3,
.edge-task-heading h3 {
	font-size: 14px;
	margin: 0 0 15px;
}
.edge-inline,
.edge-task-heading {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
	margin: 16px 0;
}
.edge-inline .el-input {
	max-width: 320px;
}
.redirect-code {
	width: 160px;
}
.edge-note {
	color: var(--el-text-color-secondary);
	font-size: 12px;
	line-height: 1.8;
}
.edge-alert {
	margin-top: 15px;
	overflow-wrap: anywhere;
}
.target-input {
	margin: 16px 0;
}
.edge-task-heading {
	justify-content: space-between;
	margin-top: 28px;
}
.edge-task-heading h3 {
	margin: 0;
}
.edge-pagination {
	justify-content: flex-end;
	margin-top: 16px;
}
.traffic-total {
	display: flex;
	gap: 24px;
	margin: 20px 0;
}
.traffic-total strong {
	margin-left: 10px;
	font-size: 20px;
}
.edge-chart {
	width: 100%;
	max-height: 180px;
	margin-bottom: 20px;
}
</style>
