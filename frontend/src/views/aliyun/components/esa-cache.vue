<template>
	<div class="cache-panel">
		<div class="cache-heading"><div><h3>{{ pub.lang('批量刷新缓存') }}</h3><p>{{ pub.lang('清理 ESA 边缘缓存，后续请求按缓存策略回源获取内容。') }}</p></div><el-radio-group v-model="type" :disabled="submitting" size="small"><el-radio-button value="file">{{ pub.lang('地址') }}</el-radio-button><el-radio-button value="directory">{{ pub.lang('目录') }}</el-radio-button></el-radio-group></div>
		<div v-loading="quotaLoading" class="quota-row"><span>{{ pub.lang('今日剩余') }} <strong>{{ quota?.remaining ?? pub.lang('未确认') }}</strong><template v-if="quota?.quota !== null && quota?.quota !== undefined"> / {{ quota.quota }}</template></span><span v-if="quota?.quota_30_day">{{ pub.lang('30 天剩余') }} <strong>{{ quota.remaining_30_day ?? pub.lang('未确认') }}</strong> / {{ quota.quota_30_day }}</span><el-button link type="primary" :disabled="quotaLoading || submitting" @click="loadQuota">{{ pub.lang('刷新额度') }}</el-button></div>
		<el-alert v-if="quotaError" :title="quotaError" type="warning" :closable="false" class="cache-alert" />
		<el-input v-model="content" type="textarea" :rows="7" :disabled="submitting" spellcheck="false" :placeholder="type === 'file' ? 'https://www.example.com/index.html\nhttps://www.example.com/style.css' : 'https://www.example.com/assets/\nhttps://www.example.com/images/'" class="cache-input" />
		<div class="input-summary"><span>{{ pub.lang('每行一条完整 HTTP/HTTPS 地址，去重后 {} 条；单次最多 {} 条、10 个域名。', entries.length, limit) }}<template v-if="type === 'directory'"> {{ pub.lang('目录以 / 结尾。') }}</template></span><el-button type="primary" :loading="submitting" :disabled="!canSubmit" @click="submit">{{ pub.lang('提交刷新') }}</el-button></div>
		<el-alert v-if="validationError || submitError" :title="validationError || submitError" type="error" :closable="false" class="cache-alert" />
		<div class="task-heading"><h3>{{ pub.lang('最近 48 小时刷新记录') }}</h3><el-button :icon="Refresh" :loading="taskLoading" :disabled="submitting" @click="loadTasks">{{ pub.lang('刷新记录') }}</el-button></div>
		<el-alert v-if="taskError" :title="taskError" type="error" :closable="false" class="cache-alert" />
		<el-table :data="tasks" v-loading="taskLoading" row-key="row_key" max-height="340">
			<el-table-column prop="content" :label="pub.lang('刷新对象')" min-width="230" show-overflow-tooltip />
			<el-table-column :label="pub.lang('状态')" width="110"><template #default="{ row }"><el-tag :type="row.status === 'Complete' ? 'success' : row.status === 'Failed' ? 'danger' : 'info'" size="small">{{ statusText(row.status) }}</el-tag></template></el-table-column>
			<el-table-column prop="progress" :label="pub.lang('进度')" width="85" />
			<el-table-column :label="pub.lang('提交时间')" width="175"><template #default="{ row }">{{ dateText(row.create_time) }}</template></el-table-column>
			<el-table-column prop="description" :label="pub.lang('失败原因')" min-width="160" show-overflow-tooltip />
		</el-table>
		<div class="cache-pagination"><el-pagination v-model:current-page="page" :page-size="20" :total="total" layout="total, prev, pager, next" @current-change="loadTasks" /></div>
	</div>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { common, routes } from '@api/http'
import { pub } from '@utils/tools'
import { useMessage } from '@utils/hooks/message'

interface Quota { quota: number | null; remaining: number | null; quota_30_day: number | null; remaining_30_day: number | null }
interface Task { row_key: string; content: string; status: string; progress: string; description: string; create_time: string }
const props = defineProps<{ accountId: number; siteId: string; siteName: string }>()
const Message = useMessage()
const type = ref<'file' | 'directory'>('file')
const content = ref('')
const quota = ref<Quota>()
const quotaLoading = ref(false)
const quotaError = ref('')
const tasks = ref<Task[]>([])
const page = ref(1)
const total = ref(0)
const taskLoading = ref(false)
const taskError = ref('')
const submitting = ref(false)
const submitError = ref('')
const limit = computed(() => type.value === 'file' ? 1000 : 100)
const entries = computed(() => [...new Set(content.value.split(/\r?\n/).map(item => item.trim()).filter(Boolean))])
const validationError = computed(() => {
	if (entries.value.length > limit.value) return pub.lang('超过单次提交上限，请减少数量')
	const hosts = new Set<string>()
	for (const [index, entry] of entries.value.entries()) {
		let url: URL
		try { url = new URL(entry) } catch { return pub.lang('第 {} 行不是有效 URL', index + 1) }
		if (!/^https?:\/\//i.test(entry) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || /[\s*\\]/.test(entry)) return pub.lang('第 {} 行请填写不含通配符、凭据或片段的完整 HTTP/HTTPS 地址', index + 1)
		const siteName = props.siteName.toLowerCase()
		if (url.hostname !== siteName && !url.hostname.endsWith(`.${siteName}`)) return pub.lang('第 {} 行不属于当前站点', index + 1)
		if (type.value === 'directory' && (!entry.endsWith('/') || url.search)) return pub.lang('第 {} 行目录须以 / 结尾且不能包含查询参数', index + 1)
		hosts.add(url.hostname)
	}
	if (hosts.size > 10) return pub.lang('单次最多包含 10 个不同域名')
	if (quota.value?.remaining !== null && quota.value?.remaining !== undefined && entries.value.length > quota.value.remaining || quota.value?.remaining_30_day !== null && quota.value?.remaining_30_day !== undefined && entries.value.length > quota.value.remaining_30_day) return pub.lang('剩余刷新额度不足，请减少数量')
	return ''
})
const canSubmit = computed(() => entries.value.length && !validationError.value && !submitting.value && !quotaLoading.value)
let generation = 0
let taskRequest = 0
let quotaRequest = 0
let timer: ReturnType<typeof setTimeout> | undefined
let polls = 0
const request = (route: string, data: Record<string, unknown> = {}) => common.sendAsync({ route, data: { account_id: props.accountId, site_id: props.siteId, type: type.value, ...data }, timeout: 70000 }) as Promise<any>
const errorText = (error: unknown) => error instanceof Error ? error.message : pub.lang('请求失败，请重试')
const statusText = (status: string) => pub.lang(({ Complete: '已完成', Refreshing: '刷新中', Failed: '失败' } as Record<string, string>)[status] || status || '未知')
const dateText = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : value || '--'
const loadQuota = async () => {
	const id = generation, query = ++quotaRequest
	quotaLoading.value = true
	quotaError.value = ''
	try {
		const result = await request(routes.aliyun.esa_cache_quota.path)
		if (id !== generation || query !== quotaRequest) return
		if (!result?.status) throw new Error(result?.msg || pub.lang('刷新额度读取失败'))
		quota.value = result.data
	} catch (error) { if (id === generation && query === quotaRequest) { quota.value = undefined; quotaError.value = errorText(error) } }
	finally { if (id === generation && query === quotaRequest) quotaLoading.value = false }
}
const loadTasks = async () => {
	clearTimeout(timer)
	const id = generation, query = ++taskRequest
	taskLoading.value = true
	taskError.value = ''
	try {
		const result = await request(routes.aliyun.esa_cache_tasks.path, { page: page.value })
		if (id !== generation || query !== taskRequest) return
		if (!result?.status) throw new Error(result?.msg || pub.lang('刷新记录读取失败'))
		tasks.value = result.data.data || []
		total.value = result.data.total || 0
		if (page.value === 1 && tasks.value.some(task => task.status === 'Refreshing') && polls++ < 15) timer = setTimeout(loadTasks, 8000)
	} catch (error) { if (id === generation && query === taskRequest) taskError.value = errorText(error) }
	finally { if (id === generation && query === taskRequest) taskLoading.value = false }
}
const submit = async () => {
	if (!canSubmit.value) return
	const id = generation
	submitting.value = true
	submitError.value = ''
	try {
		const result = await request(routes.aliyun.esa_cache_purge.path, { content: content.value })
		if (id !== generation) return
		if (!result?.status) throw new Error(result?.msg || pub.lang('提交刷新失败'))
		Message.success(pub.lang('已提交 {} 条刷新任务，任务编号：{}', result.data.count, result.data.task_id || '--'))
		content.value = ''
		page.value = 1
		polls = 0
		await Promise.all([loadQuota(), loadTasks()])
	} catch (error) { if (id === generation) submitError.value = `${errorText(error)}${errorText(error).includes('超时') ? '；请先查询刷新记录，避免重复提交。' : ''}` }
	finally { if (id === generation) submitting.value = false }
}
watch([() => props.siteId, type], () => { ++generation; clearTimeout(timer); polls = 0; quota.value = undefined; tasks.value = []; total.value = 0; page.value = 1; submitError.value = ''; loadQuota(); loadTasks() }, { immediate: true })
onBeforeUnmount(() => { ++generation; clearTimeout(timer) })
</script>

<style scoped lang="scss">
.cache-panel { min-height: 0; padding: 4px 0 16px; overflow: auto; }
.cache-heading, .task-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; h3 { margin: 0; font-size: 15px; } }
.cache-heading { margin-bottom: 16px; p { margin: 8px 0 0; font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.6; } }
.quota-row { display: flex; align-items: center; flex-wrap: wrap; gap: 12px 22px; min-height: 32px; padding: 10px 14px; margin-bottom: 14px; border-radius: 6px; background: var(--el-fill-color-light); color: var(--el-text-color-secondary); font-size: 12px; strong { margin-left: 8px; color: var(--el-text-color-primary); } }
.cache-input :deep(textarea) { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; line-height: 1.7; }
.input-summary { display: flex; align-items: center; justify-content: space-between; gap: 18px; margin: 12px 0; span { font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.7; } }
.cache-alert { margin: 12px 0; }
.task-heading { margin: 28px 0 14px; }
.cache-pagination { display: flex; justify-content: flex-end; margin-top: 14px; }
@media (max-width: 850px) { .cache-heading { align-items: flex-start; flex-direction: column; } .input-summary { align-items: flex-start; flex-direction: column; } }
</style>
