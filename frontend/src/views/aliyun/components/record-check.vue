<template>
	<el-dialog v-model="visible" width="min(1180px, 96vw)" :title="`解析检测 · ${scope?.name || ''}`" :close-on-click-modal="false" :close-on-press-escape="!deleting" :show-close="!deleting" :before-close="beforeClose" destroy-on-close>
		<el-alert type="info" :closable="false" title="检测当前域名或站点的全部记录，包含其他分页。网站直连记录目标；仅当网站和常用端口均未响应时列为疑似失效。防火墙、非标准端口和本机网络也可能导致失败，请核对后再删除。" />
		<div class="check-progress">
			<div><strong>{{ stageText }}</strong><span>{{ job?.state === 'loading' ? `已读取 ${job.loaded} / ${job.total} 条` : `已检测 ${job?.checked || 0} / ${job?.total || 0} 条` }}</span></div>
			<el-progress :percentage="percentage" :status="job?.state === 'completed' ? 'success' : undefined" />
			<small>网站：HTTP / HTTPS；TCP 端口：80、443、22、3389。403、404、5xx、证书错误会单独展示，不直接作为删除依据。</small>
		</div>
		<el-alert v-if="error || job?.error" type="error" :closable="false" :title="error || job?.error" />
		<div class="check-toolbar">
			<div class="check-counts"><span v-for="state in ['reachable', 'warning', 'suspect', 'unknown', 'skipped', 'deleted']" :key="state">{{ stateName(state) }} <b>{{ job?.counts?.[state] || 0 }}</b></span></div>
			<el-select v-model="filter" class="check-filter" @change="resultPage = 1; table?.clearSelection()"><el-option label="全部结果" value="all" /><el-option v-for="state in ['suspect', 'warning', 'reachable', 'unknown', 'skipped', 'deleted', 'changed']" :key="state" :label="stateName(state)" :value="state" /></el-select>
		</div>
		<el-table ref="table" :data="displayRows" row-key="record_id" max-height="420" v-loading="starting" @selection-change="handleSelectionChange" @select="handleSelect" @select-all="confirmActiveSelection">
			<el-table-column type="selection" width="44" :selectable="canDelete" />
			<el-table-column type="expand" width="36"><template #default="{ row }"><div class="check-endpoints"><p v-if="!row.endpoints?.length">{{ row.reason }}</p><div v-for="endpoint in row.endpoints" :key="endpoint.address"><strong>{{ endpoint.address }}</strong><p>端口：{{ portText(endpoint.ports) }}</p><p>网站：{{ webText(endpoint.web) }}</p></div></div></template></el-table-column>
			<el-table-column prop="hostname" label="主机记录" min-width="170" show-overflow-tooltip />
			<el-table-column prop="type" label="类型" width="90" />
			<el-table-column prop="value" label="记录值" min-width="155" show-overflow-tooltip />
			<el-table-column label="结果" width="110"><template #default="{ row }"><el-tag :type="stateType(row.status)">{{ stateName(row.status) }}</el-tag></template></el-table-column>
			<el-table-column prop="website" label="网站访问" min-width="175" show-overflow-tooltip />
			<el-table-column prop="ports" label="端口连通" min-width="155" show-overflow-tooltip />
			<el-table-column label="说明" min-width="210" show-overflow-tooltip><template #default="{ row }">{{ row.delete_error ? `删除失败：${row.delete_error}` : row.locked ? `${row.reason}（记录已锁定）` : row.reason }}</template></el-table-column>
		</el-table>
		<el-pagination v-if="filteredRows.length > 100" v-model:current-page="resultPage" class="check-pagination" :page-size="100" :total="filteredRows.length" layout="total, prev, pager, next" @current-change="table?.clearSelection()" />
		<template #footer>
			<div class="check-footer"><span>已勾选 {{ selected.length }} 条，每次最多删除 100 条</span><div>
				<el-button v-if="error && job && running" @click="poll(generation)">重试获取进度</el-button>
				<el-button v-if="running" :loading="stopping" :disabled="starting" @click="stop">停止检测</el-button>
				<el-button v-else :disabled="deleting || selectionConfirming" @click="start">重新检测</el-button>
				<el-button :disabled="running || deleting || selectionConfirming || !displayRows.some(row => row.status === 'suspect' && !row.locked)" @click="selectSuspects">勾选疑似失效</el-button>
				<el-button type="danger" :loading="deleting" :disabled="running || selectionConfirming || !selected.length" @click="removeSelected">删除勾选记录</el-button>
				<el-button :disabled="deleting" @click="close">关闭</el-button>
			</div></div>
		</template>
	</el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'

interface Scope { provider: 'dns' | 'esa'; name: string; domain_name?: string; site_id?: string }
interface PortResult { port: number; open: boolean; error?: string }
interface WebResult { protocol: string; status_code?: number; error?: string }
interface CheckRow { record_id: string; hostname: string; type: string; value: string; locked?: boolean; status: string; reason: string; website?: string; ports?: string; delete_error?: string; endpoints: Array<{ address: string; ports: PortResult[]; web: WebResult[] }> }
interface CheckJob { id: string; scope: Scope; state: string; total: number; loaded: number; checked: number; version: number; error: string; counts: Record<string, number>; results: CheckRow[] }
const props = defineProps<{ accountId: number }>()
const emit = defineEmits<{ (event: 'deleted', scope: Scope): void }>()
const Message = useMessage()
const visible = ref(false)
const scope = ref<Scope>()
const job = ref<CheckJob>()
const rows = ref<CheckRow[]>([])
const selected = ref<CheckRow[]>([])
const starting = ref(false)
const stopping = ref(false)
const deleting = ref(false)
const selectionConfirming = ref(false)
const error = ref('')
const filter = ref('all')
const resultPage = ref(1)
const table = ref<{ clearSelection(): void; toggleRowSelection(row: CheckRow, selected: boolean): void }>()
let generation = 0
let timer: ReturnType<typeof setTimeout> | undefined
let pollingGeneration: number | undefined
let selectionRequestId = 0
const confirmedActiveIds = new Set<string>()
const request = (route: string, data: Record<string, unknown>, timeout = 30000) => common.sendAsync({ route, data: { ...data, account_id: props.accountId }, timeout }) as Promise<any>
const running = computed(() => starting.value || ['loading', 'running'].includes(job.value?.state || ''))
const percentage = computed(() => job.value?.state === 'completed' ? 100 : job.value?.total && job.value.state !== 'loading' ? Math.floor(job.value.checked / job.value.total * 100) : 0)
const stageText = computed(() => starting.value ? '正在创建检测任务' : ({ loading: '正在读取全部解析记录', running: '正在检测', completed: '检测完成', cancelled: '已停止，保留已完成结果', failed: '检测失败' } as Record<string, string>)[job.value?.state || 'failed'])
const filteredRows = computed(() => rows.value.filter(row => filter.value === 'all' || row.status === filter.value))
const displayRows = computed(() => filteredRows.value.slice((resultPage.value - 1) * 100, resultPage.value * 100))
watch(() => filteredRows.value.length, total => { resultPage.value = Math.min(resultPage.value, Math.max(1, Math.ceil(total / 100))) })
const stateName = (state: string) => ({ reachable: '可访问', warning: '需核对', suspect: '疑似失效', unknown: '无法判断', skipped: '已跳过', deleted: '已删除', changed: '记录已变化' } as Record<string, string>)[state] || state
const stateType = (state: string) => state === 'reachable' ? 'success' : state === 'suspect' ? 'danger' : state === 'warning' ? 'warning' : 'info'
const portText = (ports: PortResult[]) => ports.map(port => `${port.port} ${port.open ? '可连接' : port.error || '未连接'}`).join('；')
const webText = (web: WebResult[]) => web.length ? web.map(item => `${item.protocol} ${item.status_code || item.error || '无响应'}`).join('；') : '主机名不适合网站检测'
const canDelete = (row: CheckRow) => !running.value && !deleting.value && ['reachable', 'warning', 'suspect', 'unknown', 'skipped'].includes(row.status) && !row.locked
const needsSelectionConfirmation = (row: CheckRow) => ['reachable', 'warning'].includes(row.status)
const handleSelectionChange = (selection: CheckRow[]) => {
	selected.value = selection
	const ids = new Set(selection.map(row => row.record_id))
	for (const id of confirmedActiveIds) if (!ids.has(id)) confirmedActiveIds.delete(id)
}
const confirmActiveSelection = async (selection: CheckRow[]) => {
	const activeRows = selection.filter(row => needsSelectionConfirmation(row) && !confirmedActiveIds.has(row.record_id))
	if (!activeRows.length) return
	const id = generation
	const requestId = ++selectionRequestId
	selectionConfirming.value = true
	const names = activeRows.slice(0, 3).map(row => row.hostname).join('、')
	try {
		await ElMessageBox.confirm(`勾选的 ${activeRows.length} 条记录已有网站响应或可连接端口（${names}${activeRows.length > 3 ? '等' : ''}），可能仍在使用。确定仍要勾选吗？`, '确认勾选可访问记录', { type: 'warning', confirmButtonText: '仍然勾选', cancelButtonText: '取消' })
		if (id !== generation || !visible.value) return
		const ids = new Set(selected.value.map(row => row.record_id))
		activeRows.forEach(row => { if (ids.has(row.record_id)) confirmedActiveIds.add(row.record_id) })
	} catch {
		if (id === generation && visible.value) activeRows.forEach(row => table.value?.toggleRowSelection(row, false))
	} finally { if (requestId === selectionRequestId) selectionConfirming.value = false }
}
const handleSelect = (selection: CheckRow[], row: CheckRow) => {
	if (selection.some(item => item.record_id === row.record_id)) return confirmActiveSelection([row])
}
const apply = (data: CheckJob) => {
	const merged = new Map(rows.value.map(row => [row.record_id, row]))
	data.results.forEach(row => merged.set(row.record_id, row))
	rows.value = [...merged.values()]
	job.value = data
}
const cancelJob = (id: string) => request(routes.aliyun.record_check_stop.path, { job_id: id }).catch(() => {})
const stop = async () => {
	if (!job.value || stopping.value) return
	const id = ++generation
	clearTimeout(timer)
	stopping.value = true
	try { const result = await request(routes.aliyun.record_check_stop.path, { job_id: job.value.id }); if (id !== generation) return; if (result?.status) apply(result.data); else error.value = result?.msg || '停止失败' }
	catch (exception) { if (id === generation) error.value = exception instanceof Error ? exception.message : '停止失败' }
	finally { stopping.value = false }
}
const poll = async (id: number) => {
	if (id !== generation || !visible.value || !job.value || pollingGeneration === id) return
	clearTimeout(timer)
	pollingGeneration = id
	try {
		const result = await request(routes.aliyun.record_check_status.path, { job_id: job.value.id, after: job.value.version })
		if (id !== generation || !visible.value) return
		if (!result?.status) throw new Error(result?.msg || '读取进度失败')
		error.value = ''
		apply(result.data)
		if (running.value) timer = setTimeout(() => poll(id), 1000)
	} catch (exception) { if (id === generation) error.value = exception instanceof Error ? exception.message : '读取进度失败' }
	finally { if (pollingGeneration === id) pollingGeneration = undefined }
}
const start = async () => {
	if (!scope.value || deleting.value || selectionConfirming.value) return
	const id = ++generation
	clearTimeout(timer)
	if (job.value && running.value) await cancelJob(job.value.id)
	if (id !== generation || !visible.value) return
	job.value = undefined; rows.value = []; selected.value = []; confirmedActiveIds.clear(); filter.value = 'all'; resultPage.value = 1; error.value = ''; starting.value = true
	try {
		const result = await request(routes.aliyun.record_check_start.path, { ...scope.value, site_name: scope.value.name })
		if (id !== generation || !visible.value) { if (result?.status) await cancelJob(result.data.id); return }
		if (!result?.status) throw new Error(result?.msg || '检测启动失败')
		apply(result.data)
		timer = setTimeout(() => poll(id), 300)
	} catch (exception) { if (id === generation) error.value = exception instanceof Error ? exception.message : '检测启动失败' }
	finally { if (id === generation) starting.value = false }
}
const dispose = () => { generation++; selectionRequestId++; selectionConfirming.value = false; confirmedActiveIds.clear(); clearTimeout(timer); if (job.value && running.value) cancelJob(job.value.id); visible.value = false }
const close = () => { if (!deleting.value) dispose() }
const beforeClose = (done: () => void) => { if (!deleting.value) { dispose(); done() } }
const selectSuspects = () => { table.value?.clearSelection(); displayRows.value.filter(row => row.status === 'suspect' && canDelete(row)).slice(0, 100).forEach(row => table.value?.toggleRowSelection(row, true)) }
const removeSelected = async () => {
	if (!job.value || !scope.value || running.value || deleting.value || selectionConfirming.value) return
	const selectedRows = selected.value.filter(canDelete)
	const ids = selectedRows.map(row => row.record_id)
	if (!ids.length) return
	if (ids.length > 100) return Message.warn('每次最多删除 100 条，请减少勾选数量')
	const id = generation
	const targetJob = job.value.id
	const targetScope = { ...scope.value }
	const activeCount = selectedRows.filter(needsSelectionConfirmation).length
	try { await ElMessageBox.confirm(`确定删除勾选的 ${ids.length} 条解析记录吗？${activeCount ? `其中 ${activeCount} 条已有服务响应。` : ''}删除后可能立即影响域名访问。`, '删除勾选解析', { type: 'warning', confirmButtonText: '确认删除' }) } catch { return }
	if (id !== generation || !visible.value) return
	deleting.value = true; error.value = ''
	try {
		const result = await request(routes.aliyun.record_check_delete.path, { job_id: targetJob, record_ids: ids }, 0)
		if (!result?.status) throw new Error(result?.msg || '删除失败')
		apply(result.data.job)
		selected.value = []; confirmedActiveIds.clear(); table.value?.clearSelection()
		if (result.data.failure_count) Message.warn(`删除成功 ${result.data.success_count} 条，失败 ${result.data.failure_count} 条，请查看行内说明`)
		else Message.success(`已删除 ${result.data.success_count} 条解析记录`)
		if (result.data.success_count) emit('deleted', targetScope)
	} catch (exception) { error.value = exception instanceof Error ? exception.message : '删除失败' }
	finally { deleting.value = false }
}
const open = (value: Scope) => { if (deleting.value || selectionConfirming.value) return; scope.value = { ...value }; visible.value = true; start() }
onBeforeUnmount(dispose)
onDeactivated(dispose)
defineExpose({ open })
</script>

<style scoped lang="scss">
.check-progress { margin: 1.4rem 0; > div:first-child { display: flex; justify-content: space-between; margin-bottom: .7rem; } small { display: block; margin-top: .6rem; color: var(--el-text-color-secondary); } }
.check-toolbar, .check-footer { display: flex; justify-content: space-between; align-items: center; gap: 1rem; margin: 1.2rem 0; }
.check-counts { display: flex; flex-wrap: wrap; gap: 1.2rem; color: var(--el-text-color-secondary); b { color: var(--el-text-color-primary); margin-left: .3rem; } }
.check-filter { width: 15rem; flex-shrink: 0; }
.check-pagination { justify-content: flex-end; margin-top: 1rem; }
.check-footer { margin-bottom: 0; flex-wrap: wrap; > span { color: var(--el-text-color-secondary); } }
.check-endpoints { padding: .5rem 4rem; overflow-wrap: anywhere; > div { margin-bottom: 1rem; } p { margin: .4rem 0; color: var(--el-text-color-secondary); } }
</style>
