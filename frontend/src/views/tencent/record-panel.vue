<template>
	<section>
		<div class="record-toolbar">
			<el-input
				v-model="keyword"
				clearable
				placeholder="搜索主机记录或记录值"
				@keyup.enter="search"
				:disabled="busy"
				@clear="search" /><el-button :disabled="busy" @click="search">查询</el-button
			><el-button type="primary" :disabled="busy" @click="open()">新增解析</el-button
			><el-button :disabled="busy" @click="openBatch('create')">批量新增</el-button
			><el-button :disabled="busy" :loading="loading" @click="load">刷新</el-button>
		</div>
		<div class="record-toolbar">
			<span>已选 {{ selected.length }} 条（当前页）</span
			><el-button :disabled="busy || !selected.length" @click="openBatch('enable')"
				>批量启用</el-button
			><el-button :disabled="busy || !selected.length" @click="openBatch('disable')"
				>批量停用</el-button
			><el-button
				type="danger"
				plain
				:disabled="busy || !selected.length"
				@click="openBatch('delete')"
				>批量删除</el-button
			>
		</div>
		<el-alert v-if="error" type="error" :title="error" :closable="false" class="record-alert" />
		<el-alert
			v-if="metaError"
			type="warning"
			:title="metaError"
			:closable="false"
			class="record-alert" />
		<el-table
			:data="rows"
			v-loading="loading"
			row-key="id"
			max-height="520"
			empty-text="暂无可见解析记录"
			@selection-change="value => (selected = value)">
			<el-table-column type="selection" width="45" :selectable="() => !busy" />
			<el-table-column prop="name" label="主机记录" min-width="150" show-overflow-tooltip />
			<el-table-column prop="type" label="类型" width="85" />
			<el-table-column prop="value" label="记录值" min-width="230" show-overflow-tooltip />
			<el-table-column v-if="!zoneId" prop="line" label="线路" width="100" />
			<el-table-column prop="ttl" label="TTL" width="80" />
			<el-table-column label="状态" width="90"
				><template #default="{ row }"
					><el-tag size="small" :type="enabled(row) ? 'success' : 'info'">{{
						enabled(row) ? '启用' : '停用'
					}}</el-tag></template
				></el-table-column
			>
			<el-table-column label="操作" width="185" fixed="right"
				><template #default="{ row }"
					><el-button link type="primary" :disabled="busy" @click="open(row)">编辑</el-button
					><el-button link :disabled="busy" @click="changeStatus(row)">{{
						enabled(row) ? '停用' : '启用'
					}}</el-button
					><el-button link type="danger" :disabled="busy" @click="remove(row)"
						>删除</el-button
					></template
				></el-table-column
			>
		</el-table>
		<el-pagination
			v-model:current-page="page"
			:total="total"
			:page-size="20"
			:disabled="busy"
			layout="total, prev, pager, next"
			class="record-pagination"
			@current-change="load" />
		<el-dialog
			v-model="visible"
			:title="form.id ? '编辑解析记录' : '新增解析记录'"
			width="560"
			align-center
			:close-on-click-modal="false"
			:close-on-press-escape="!busy"
			:show-close="!busy">
			<el-form ref="formRef" :model="form" :rules="rules" label-width="95px" :disabled="busy">
				<el-form-item label="域名"><el-input :model-value="domain" disabled /></el-form-item>
				<el-form-item label="主机记录" prop="name"
					><el-input
						v-model="form.name"
						:placeholder="zoneId ? '完整域名，或填写 www / @' : '@ / www'"
				/></el-form-item>
				<el-form-item label="类型"
					><el-select v-model="form.type" class="full"
						><el-option v-for="type in availableTypes" :key="type" :value="type" /></el-select
				></el-form-item>
				<el-form-item label="记录值" prop="value"
					><el-input v-model="form.value" type="textarea" :rows="3"
				/></el-form-item>
				<el-form-item v-if="!zoneId" label="线路"
					><el-select v-model="form.line" filterable class="full" @change="selectLine"
						><el-option
							v-for="line in availableLines"
							:key="line.LineId || line.Name"
							:label="line.Name"
							:value="line.Name" /></el-select
				></el-form-item>
				<el-form-item label="TTL"
					><el-input-number
						v-model="form.ttl"
						:min="zoneId ? 60 : 1"
						:max="zoneId ? 86400 : 604800"
				/></el-form-item>
				<el-form-item
					v-if="(zoneId ? ['MX'] : ['MX', 'HTTPS', 'SVCB']).includes(form.type)"
					label="优先级"
					><el-input-number v-model="form.priority" :min="0" :max="zoneId ? 50 : 65535"
				/></el-form-item>
				<el-form-item v-if="!zoneId" label="备注"
					><el-input v-model="form.remark" maxlength="200"
				/></el-form-item>
			</el-form>
			<el-alert v-if="saveError" :title="saveError" type="error" :closable="false" />
			<template #footer
				><el-button :disabled="busy" @click="visible = false">取消</el-button
				><el-button type="primary" :loading="busy" @click="save">保存</el-button></template
			>
		</el-dialog>
		<RecordBatch
			v-if="batchVisible"
			v-model="batchVisible"
			:account-id="accountId"
			:domain="domain"
			:zone-id="zoneId"
			:operation="batchOperation"
			:records="batchRecords"
			:lines="lines"
			@busy="value => (busy = value)"
			@updated="load" />
	</section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { cloudErrorText, resourceRequest, type PageResult } from './api'
import { useMessage } from '@utils/hooks/message'
import RecordBatch from './record-batch.vue'
import type { BatchRecord } from './record-batch'
interface DnsRecord {
	id: string | number
	name: string
	type: string
	value: string
	ttl: number
	line?: string
	line_id?: string
	priority?: number
	weight?: number
	status: string
	remark?: string
}
interface RecordForm {
	id: string | number
	name: string
	type: string
	value: string
	ttl: number
	line: string
	line_id: string
	priority: number
	weight?: number
	status: string
	remark: string
}
const props = defineProps<{ accountId: number; domain: string; zoneId?: string }>()
const Message = useMessage()
const rows = ref<DnsRecord[]>([]),
	page = ref(1),
	total = ref(0),
	keyword = ref(''),
	loading = ref(false),
	busy = ref(false),
	visible = ref(false),
	error = ref(''),
	metaError = ref(''),
	saveError = ref('')
const types = ref<string[]>([]),
	lines = ref<Array<{ Name: string; LineId: string }>>([])
const formRef = ref<FormInstance>()
const selected = ref<DnsRecord[]>([]),
	batchRecords = ref<BatchRecord[]>([]),
	batchVisible = ref(false),
	batchOperation = ref<'create' | 'enable' | 'disable' | 'delete'>('create')
const defaults = (): RecordForm => ({
	id: '',
	name: '@',
	type: 'A',
	value: '',
	ttl: 600,
	line: props.zoneId ? 'Default' : '默认',
	line_id: '',
	priority: 10,
	weight: undefined,
	status: 'ENABLE',
	remark: '',
})
const form = reactive<RecordForm>(defaults())
const rules: FormRules = {
	name: [{ required: true, message: '请输入主机记录', trigger: 'blur' }],
	value: [{ required: true, message: '请输入记录值', trigger: 'blur' }],
}
const availableTypes = computed(() => [
	...new Set([
		...(types.value.length ? types.value : ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'NS', 'SRV', 'CAA']),
		form.type,
	]),
])
const availableLines = computed(() => [
	...lines.value,
	...(!lines.value.some(item => item.Name === form.line)
		? [{ Name: form.line, LineId: form.line_id }]
		: []),
])
let generation = 0,
	listRequest = 0
const scope = () => ({
	account_id: props.accountId,
	domain: props.domain,
	...(props.zoneId ? { zone_id: props.zoneId } : {}),
})
const enabled = (row: DnsRecord) => ['ENABLE', 'enable', 'enabled', 'active'].includes(row.status)
async function load() {
	const id = ++listRequest,
		current = generation
	loading.value = true
	selected.value = []
	error.value = ''
	try {
		const result = await resourceRequest<PageResult<DnsRecord>>('record_list', {
			...scope(),
			page: page.value,
			keyword: keyword.value,
		})
		if (id === listRequest && current === generation) {
			rows.value = result.data
			total.value = result.total
		}
	} catch (exception) {
		if (id === listRequest && current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (id === listRequest && current === generation) loading.value = false
	}
}
function search() {
	page.value = 1
	void load()
}
function selectLine() {
	form.line_id = lines.value.find(item => item.Name === form.line)?.LineId || ''
}
function open(row?: DnsRecord) {
	if (busy.value) return
	Object.assign(form, defaults(), row || {}, {
		line: row?.line || (props.zoneId ? 'Default' : '默认'),
		line_id: row?.line_id || '',
		priority: row?.priority ?? 10,
		remark: row?.remark || '',
	})
	saveError.value = ''
	visible.value = true
	formRef.value?.clearValidate()
}
function openBatch(operation: 'create' | 'enable' | 'disable' | 'delete') {
	if (busy.value) return
	batchOperation.value = operation
	batchRecords.value = selected.value.map(row => ({ ...row }))
	batchVisible.value = true
}
async function save() {
	if (busy.value || !(await formRef.value?.validate().catch(() => false))) return
	const current = generation
	busy.value = true
	saveError.value = ''
	let name = form.name.trim()
	if (props.zoneId)
		name =
			name === '@'
				? props.domain
				: name === props.domain || name.endsWith(`.${props.domain}`)
					? name
					: `${name}.${props.domain}`
	try {
		await resourceRequest('record_change', { ...scope(), ...form, name, operation: 'save' })
		if (current !== generation) return
		visible.value = false
		Message.success('解析记录已保存')
		await load()
	} catch (exception) {
		if (current === generation) saveError.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
async function changeStatus(row: DnsRecord) {
	const current = generation
	try {
		await ElMessageBox.confirm(
			`确认${enabled(row) ? '停用' : '启用'} ${row.name} 的 ${row.type} 记录？`,
			'修改解析状态',
			{ type: 'warning' }
		)
	} catch {
		return
	}
	if (current !== generation) return
	await mutate({ id: row.id, operation: 'status', status: enabled(row) ? 'DISABLE' : 'ENABLE' })
}
async function remove(row: DnsRecord) {
	const current = generation
	try {
		await ElMessageBox.confirm(
			`确认删除 ${row.name} 的 ${row.type} 记录（${row.value}）？可能立即影响域名访问。`,
			'删除解析记录',
			{ type: 'warning', confirmButtonText: '确认删除' }
		)
	} catch {
		return
	}
	if (current !== generation) return
	await mutate({ id: row.id, confirm_id: row.id, operation: 'delete' })
}
async function mutate(data: Record<string, unknown>) {
	if (busy.value) return
	const current = generation
	busy.value = true
	error.value = ''
	try {
		await resourceRequest('record_change', { ...scope(), ...data })
		if (current === generation) {
			Message.success('操作已提交')
			await load()
		}
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
watch(
	() => [props.accountId, props.domain, props.zoneId],
	async () => {
		const current = ++generation
		page.value = 1
		rows.value = []
		total.value = 0
		visible.value = false
		batchVisible.value = false
		busy.value = false
		metaError.value = ''
		types.value = []
		lines.value = []
		void load()
		try {
			const result = await resourceRequest<{
				types: string[]
				lines: Array<{ Name: string; LineId: string }>
				errors: string[]
			}>('record_meta', scope())
			if (current === generation) {
				types.value = result.types
				lines.value = result.lines
				metaError.value = result.errors.join('；')
			}
		} catch (exception) {
			if (current === generation)
				metaError.value = `套餐与线路信息未完整获取：${cloudErrorText(exception)}`
		}
	},
	{ immediate: true }
)
onBeforeUnmount(() => {
	generation++
})
</script>
<style scoped>
.record-toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
	margin-bottom: 14px;
}
.record-toolbar .el-input {
	width: 260px;
}
.record-alert {
	margin-bottom: 12px;
}
.record-pagination {
	margin-top: 15px;
	justify-content: flex-end;
}
.full {
	width: 100%;
}
</style>
