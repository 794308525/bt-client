<template>
	<section>
		<ResourceStatus product="cos" :summary="summary.cos" :busy="probing" @refresh="probe" />
		<template v-if="!bucket">
			<div class="cos-toolbar">
				<el-button :loading="loading" @click="loadBuckets()">刷新存储桶</el-button>
			</div>
			<el-alert v-if="error" :title="error" type="warning" :closable="false" class="cos-alert" />
			<el-table
				:data="buckets"
				v-loading="loading"
				empty-text="暂无可见存储桶；也可填写指定 Bucket 直接访问">
				<el-table-column prop="name" label="Bucket" min-width="250" /><el-table-column
					prop="region"
					label="地域"
					width="180" /><el-table-column label="创建时间" min-width="200"
					><template #default="{ row }">{{ timeText(row.created_at) }}</template></el-table-column
				><el-table-column label="操作" width="110"
					><template #default="{ row }"
						><el-button link type="primary" @click="enter(row)">文件管理</el-button></template
					></el-table-column
				>
			</el-table>
			<div class="cos-pagination">
				<el-button :disabled="loading || !bucketHistory.length" @click="previousBuckets"
					>上一页</el-button
				><el-button :disabled="loading || !bucketNext" @click="nextBuckets">下一页</el-button>
			</div>
			<div class="manual-bucket">
				<h3>访问指定存储桶</h3>
				<p>仅有指定桶权限、无法列举全部桶时，可填写完整名称与地域。</p>
				<div class="cos-toolbar">
					<el-input v-model="manual.name" placeholder="example-1250000000" /><el-input
						v-model="manual.region"
						placeholder="地域，例如 ap-guangzhou" /><el-button type="primary" @click="enter(manual)"
						>打开</el-button
					>
				</div>
			</div>
		</template>
		<template v-else>
			<div class="cos-heading">
				<el-button :disabled="busy" @click="leave">返回存储桶</el-button
				><strong>{{ bucket.name }}</strong
				><span>{{ bucket.region }}</span>
			</div>
			<div class="cos-toolbar">
				<el-input
					v-model="prefixInput"
					clearable
					placeholder="目录前缀，留空为根目录"
					:disabled="busy"
					@keyup.enter="searchObjects" /><el-button :disabled="busy" @click="searchObjects"
					>打开目录</el-button
				><el-button :disabled="busy || !prefix" @click="parentFolder">上级目录</el-button
				><el-button type="primary" :loading="busy" @click="upload">上传文件</el-button
				><el-button type="danger" :disabled="busy || !selected.length" @click="remove"
					>删除所选</el-button
				><el-button :disabled="busy" :loading="loading" @click="loadObjects()">刷新</el-button>
			</div>
			<p class="cos-note">
				当前目录：/{{ prefix }} · 当前页面文件 {{ objects.length }} 个；对象的历史版本和删除标记请到
				COS 控制台查看。
			</p>
			<el-alert v-if="error" :title="error" type="error" :closable="false" class="cos-alert" />
			<el-alert
				v-if="resultNote"
				:title="resultNote"
				:type="failed ? 'warning' : 'success'"
				:closable="false"
				class="cos-alert" />
			<el-table
				ref="tableRef"
				:data="entries"
				v-loading="loading"
				row-key="name"
				empty-text="当前目录暂无可见文件"
				@selection-change="rows => (selected = rows.filter(row => !row.folder))">
				<el-table-column type="selection" width="45" :selectable="row => !row.folder && !busy" />
				<el-table-column label="名称" min-width="280"
					><template #default="{ row }"
						><el-button
							v-if="row.folder"
							link
							type="primary"
							:disabled="busy"
							@click="openFolder(row.name)"
							>📁 {{ row.name.slice(prefix.length) }}</el-button
						><span v-else>{{ row.name.slice(prefix.length) || row.name }}</span></template
					></el-table-column
				>
				<el-table-column label="大小" width="130"
					><template #default="{ row }">{{
						row.folder ? '--' : volume(row.size)
					}}</template></el-table-column
				>
				<el-table-column label="更新时间" width="185"
					><template #default="{ row }">{{ timeText(row.updated_at) }}</template></el-table-column
				>
				<el-table-column prop="storage_class" label="存储类型" width="150" />
				<el-table-column label="操作" width="100"
					><template #default="{ row }"
						><el-button
							v-if="!row.folder"
							link
							type="primary"
							:disabled="busy"
							@click="download(row)"
							>下载</el-button
						></template
					></el-table-column
				>
			</el-table>
			<div class="cos-pagination">
				<el-button :disabled="loading || busy || !objectHistory.length" @click="previousObjects"
					>上一页</el-button
				><el-button :disabled="loading || busy || !objectNext" @click="nextObjects"
					>下一页</el-button
				>
			</div>
		</template>
	</section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessageBox, type TableInstance } from 'element-plus'
import {
	cloudErrorText,
	request,
	resourceRequest,
	timeText,
	volume,
	type ResourceSummary,
} from './api'
import ResourceStatus from './resource-status.vue'
interface Bucket {
	name: string
	region: string
	created_at?: string
}
interface CosObject {
	name: string
	size: number
	updated_at: string
	storage_class: string
	folder?: boolean
}
interface OperationResult {
	canceled?: boolean
	success_count: number
	failure_count: number
	data: Array<{ name: string; success: boolean; message?: string }>
}
const props = defineProps<{ accountId: number; summary: Record<string, ResourceSummary> }>()
const emit = defineEmits<{ (event: 'updated'): void }>()
const buckets = ref<Bucket[]>([]),
	bucket = ref<Bucket>(),
	objects = ref<CosObject[]>([]),
	folders = ref<string[]>([]),
	selected = ref<CosObject[]>([])
const loading = ref(false),
	busy = ref(false),
	probing = ref(false),
	error = ref(''),
	resultNote = ref(''),
	failed = ref(false),
	prefix = ref(''),
	prefixInput = ref('')
const bucketMarker = ref(''),
	bucketNext = ref(''),
	bucketHistory = ref<string[]>([]),
	objectMarker = ref(''),
	objectNext = ref(''),
	objectHistory = ref<string[]>([])
const manual = reactive({ name: '', region: '' }),
	tableRef = ref<TableInstance>()
const entries = computed(() => [
	...folders.value.map(name => ({
		name,
		folder: true,
		size: 0,
		updated_at: '',
		storage_class: '',
	})),
	...objects.value,
])
let sequence = 0,
	generation = 0
const scope = () => ({
	account_id: props.accountId,
	bucket: bucket.value?.name,
	region: bucket.value?.region,
	prefix: prefix.value,
})
async function probe() {
	probing.value = true
	try {
		await request('probe_resources', { account_id: props.accountId, product: 'cos', force: true })
		emit('updated')
	} catch (exception) {
		error.value = cloudErrorText(exception)
	} finally {
		probing.value = false
	}
}
async function loadBuckets(marker = bucketMarker.value) {
	const id = ++sequence
	loading.value = true
	error.value = ''
	try {
		const result = await resourceRequest<{ data: Bucket[]; next_marker: string }>('cos_buckets', {
			account_id: props.accountId,
			marker,
		})
		if (id === sequence) {
			buckets.value = result.data
			bucketMarker.value = marker
			bucketNext.value = result.next_marker
		}
	} catch (exception) {
		if (id === sequence) error.value = cloudErrorText(exception)
	} finally {
		if (id === sequence) loading.value = false
	}
}
function nextBuckets() {
	bucketHistory.value.push(bucketMarker.value)
	void loadBuckets(bucketNext.value)
}
function previousBuckets() {
	void loadBuckets(bucketHistory.value.pop() || '')
}
function enter(row: Bucket) {
	if (!row.name.trim() || !row.region.trim()) {
		error.value = '请填写完整 Bucket 名称和地域'
		return
	}
	bucket.value = { ...row, name: row.name.trim(), region: row.region.trim() }
	prefix.value = ''
	prefixInput.value = ''
	objects.value = []
	folders.value = []
	objectMarker.value = ''
	objectHistory.value = []
	resultNote.value = ''
	void loadObjects('')
}
function leave() {
	if (busy.value) return
	sequence++
	bucket.value = undefined
	error.value = ''
	loading.value = false
	selected.value = []
}
async function loadObjects(marker = objectMarker.value) {
	const id = ++sequence
	loading.value = true
	error.value = ''
	selected.value = []
	tableRef.value?.clearSelection()
	try {
		const result = await resourceRequest<{
			data: CosObject[]
			folders: string[]
			next_marker: string
		}>('cos_objects', { ...scope(), marker })
		if (id === sequence) {
			objects.value = result.data
			folders.value = result.folders
			objectMarker.value = marker
			objectNext.value = result.next_marker
			emit('updated')
		}
	} catch (exception) {
		if (id === sequence) error.value = cloudErrorText(exception)
	} finally {
		if (id === sequence) loading.value = false
	}
}
function searchObjects() {
	if (busy.value) return
	prefix.value =
		prefixInput.value && !prefixInput.value.endsWith('/')
			? prefixInput.value + '/'
			: prefixInput.value
	prefixInput.value = prefix.value
	objectHistory.value = []
	void loadObjects('')
}
function openFolder(value: string) {
	prefixInput.value = value
	searchObjects()
}
function parentFolder() {
	openFolder(
		prefix.value.replace(/\/$/, '').split('/').slice(0, -1).join('/') +
			(prefix.value.replace(/\/$/, '').includes('/') ? '/' : '')
	)
}
function nextObjects() {
	objectHistory.value.push(objectMarker.value)
	void loadObjects(objectNext.value)
}
function previousObjects() {
	void loadObjects(objectHistory.value.pop() || '')
}
function showResult(result: OperationResult) {
	failed.value = result.failure_count > 0
	resultNote.value = `成功 ${result.success_count} 个，失败 ${result.failure_count} 个。${result.data
		.filter(row => !row.success)
		.map(row => `${row.name}：${row.message}`)
		.join('；')}`
}
async function upload() {
	if (busy.value) return
	const current = generation
	busy.value = true
	error.value = ''
	resultNote.value = ''
	try {
		const result = await request<OperationResult>('cos_upload', scope())
		if (current === generation && !result.canceled) {
			showResult(result)
			await loadObjects()
		}
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
async function download(row: CosObject) {
	if (busy.value) return
	const current = generation
	busy.value = true
	error.value = ''
	resultNote.value = ''
	try {
		const result = await request<{ canceled: boolean }>('cos_download', {
			...scope(),
			object_name: row.name,
		})
		if (current === generation && !result.canceled) {
			failed.value = false
			resultNote.value = '文件已保存到所选位置。'
		}
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
async function remove() {
	if (busy.value || !selected.value.length) return
	const current = generation
	const payload = {
		...scope(),
		object_names: selected.value.map(row => row.name),
		confirm_bucket: bucket.value!.name,
	}
	try {
		await ElMessageBox.confirm(
			`确认从 ${bucket.value!.name} 删除所选 ${selected.value.length} 个文件？此操作不清理历史版本。`,
			'删除 COS 文件',
			{ type: 'warning', confirmButtonText: '确认删除' }
		)
	} catch {
		return
	}
	if (current !== generation) return
	busy.value = true
	error.value = ''
	resultNote.value = ''
	try {
		const result = await resourceRequest<OperationResult>('cos_remove', payload)
		if (current === generation) {
			showResult(result)
			await loadObjects()
		}
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
watch(
	() => props.accountId,
	() => {
		generation++
		bucket.value = undefined
		buckets.value = []
		bucketMarker.value = ''
		bucketNext.value = ''
		bucketHistory.value = []
		busy.value = false
		void loadBuckets('')
	},
	{ immediate: true }
)
onBeforeUnmount(() => {
	generation++
	sequence++
})
</script>
<style scoped>
.cos-toolbar,
.cos-heading {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	margin: 14px 0;
}
.cos-toolbar .el-input {
	width: 280px;
}
.cos-alert {
	margin: 12px 0;
	overflow-wrap: anywhere;
}
.cos-pagination {
	display: flex;
	justify-content: flex-end;
	gap: 10px;
	margin-top: 16px;
}
.cos-note,
.cos-heading span,
.manual-bucket p {
	color: var(--el-text-color-secondary);
	font-size: 12px;
}
.manual-bucket {
	padding: 16px;
	margin-top: 24px;
	border: 1px solid var(--el-border-color-light);
	border-radius: 8px;
}
.manual-bucket h3 {
	margin: 0 0 10px;
	font-size: 14px;
}
</style>
