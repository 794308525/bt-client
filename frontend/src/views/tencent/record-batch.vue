<template>
	<el-dialog
		:model-value="modelValue"
		:title="`批量${operationName}解析 · ${domain}`"
		width="min(1000px, 95vw)"
		align-center
		:close-on-click-modal="false"
		:close-on-press-escape="!busy"
		:show-close="!busy"
		@update:model-value="close">
		<template v-if="operation === 'create'">
			<p class="batch-note">
				从 Excel 复制或粘贴制表符分隔的内容，每行一条，最多 100
				条。列顺序：主机记录、类型、记录值、TTL（选填）、优先级（选填）、备注（选填，仅
				DNSPod）。TXT 记录值中的空格会保留。
			</p>
			<el-input
				v-model="input"
				type="textarea"
				:rows="6"
				:disabled="busy || submitted"
				:placeholder="'www\tA\t192.0.2.1\t600\n@\tMX\tmx.example.com\t600\t10'" />
			<div class="batch-toolbar">
				<span>默认 TTL</span
				><el-input-number
					v-model="ttl"
					:min="zoneId ? 60 : 1"
					:max="zoneId ? 86400 : 604800"
					:disabled="busy || submitted" />
				<template v-if="!zoneId"
					><span>线路</span
					><el-select v-model="line" :disabled="busy || submitted" style="width: 160px"
						><el-option
							v-for="item in availableLines"
							:key="item.LineId || item.Name"
							:label="item.Name"
							:value="item.Name" /></el-select
				></template>
			</div>
			<el-alert
				v-if="parsed.errors.length && input"
				:title="parsed.errors.join('；')"
				type="error"
				:closable="false" />
		</template>
		<p class="batch-note">
			{{
				operation === 'create'
					? '预览下方记录后提交。'
					: `仅操作当前勾选的 ${records.length} 条记录。`
			}}逐条执行，遇到网络、权限或配额异常会停止后续提交；结果待核实的记录请先刷新列表检查。
		</p>
		<el-alert v-if="error" :title="error" type="error" :closable="false" />
		<el-alert
			v-if="submitted"
			:title="`本批 ${preview.length} 条，确认成功 ${successCount} 条；其余结果见下表。再次操作前请刷新列表核对。`"
			:type="successCount === preview.length ? 'success' : 'warning'"
			:closable="false" />
		<el-table :data="preview" max-height="340" row-key="index">
			<el-table-column label="#" type="index" width="50" />
			<el-table-column prop="name" label="主机记录" min-width="130" show-overflow-tooltip />
			<el-table-column prop="type" label="类型" width="80" />
			<el-table-column prop="value" label="记录值" min-width="190" show-overflow-tooltip />
			<el-table-column v-if="operation === 'create'" prop="ttl" label="TTL" width="80" />
			<el-table-column
				v-if="operation === 'create' && !zoneId"
				prop="line"
				label="线路"
				width="100" />
			<el-table-column v-if="submitted" label="结果" min-width="220"
				><template #default="{ row }"
					><el-tag :type="row.result?.status === 'success' ? 'success' : 'warning'" size="small">{{
						resultName(row.result?.status)
					}}</el-tag>
					<div class="batch-result">{{ resultText(row.result) }}</div></template
				></el-table-column
			>
		</el-table>
		<template #footer
			><el-button :disabled="busy" @click="close(false)">{{
				submitted ? '关闭' : '取消'
			}}</el-button
			><el-button
				v-if="!submitted"
				:type="operation === 'delete' ? 'danger' : 'primary'"
				:disabled="!preview.length || !!parsed.errors.length"
				:loading="busy"
				@click="submit"
				>确认{{ operationName }} {{ preview.length }} 条</el-button
			></template
		>
	</el-dialog>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { cloudErrorText, resourceRequest } from './api'
import { parseBatchRecords, type BatchRecord } from './record-batch'
interface Result {
	index: number
	status: string
	message?: string
	error_code?: string
	http_code?: number
	request_id?: string
	action?: string
}
const props = defineProps<{
	modelValue: boolean
	accountId: number
	domain: string
	zoneId?: string
	operation: 'create' | 'enable' | 'disable' | 'delete'
	records: BatchRecord[]
	lines: Array<{ Name: string; LineId: string }>
}>()
const emit = defineEmits<{
	(event: 'update:modelValue', value: boolean): void
	(event: 'busy', value: boolean): void
	(event: 'updated'): void
}>()
const input = ref(''),
	ttl = ref(600),
	line = ref('默认'),
	busy = ref(false),
	error = ref(''),
	submitted = ref(false),
	results = ref<Result[]>([]),
	snapshot = ref<BatchRecord[]>([])
const availableLines = computed(() =>
	props.lines.some(item => item.Name === '默认')
		? props.lines
		: [{ Name: '默认', LineId: '' }, ...props.lines]
)
const parsed = computed(() =>
	props.operation === 'create'
		? parseBatchRecords(input.value, {
				domain: props.domain,
				edge: !!props.zoneId,
				ttl: ttl.value,
				line: line.value,
				line_id: availableLines.value.find(item => item.Name === line.value)?.LineId || '',
			})
		: { records: props.records, errors: [] }
)
const preview = computed(() =>
	(submitted.value ? snapshot.value : parsed.value.records).map((row, index) => ({
		...row,
		index,
		result: results.value[index],
	}))
)
const successCount = computed(() => results.value.filter(row => row.status === 'success').length)
const operationName = computed(
	() => ({ create: '新增', enable: '启用', disable: '停用', delete: '删除' })[props.operation]
)
const resultName = (status?: string) =>
	(
		({ success: '成功', failed: '失败', uncertain: '待核实', skipped: '未提交' }) as Record<
			string,
			string
		>
	)[status || ''] || '待核实'
const resultText = (row?: Result) =>
	row
		? [
				row.message,
				row.action,
				row.error_code,
				row.http_code ? `HTTP ${row.http_code}` : '',
				row.request_id ? `RequestId: ${row.request_id}` : '',
			]
				.filter(Boolean)
				.join(' · ')
		: '未取得执行结果，请刷新解析列表核实'
let generation = 0
function close(value: boolean) {
	if (!busy.value) emit('update:modelValue', value)
}
async function submit() {
	if (busy.value || submitted.value || parsed.value.errors.length || !preview.value.length) return
	const current = generation,
		records = parsed.value.records.map(row => ({ ...row })),
		payload = {
			account_id: props.accountId,
			domain: props.domain,
			zone_id: props.zoneId,
			confirm_domain: props.domain,
			operation: props.operation,
			records,
		}
	try {
		await ElMessageBox.confirm(
			`确认对 ${props.domain} 批量${operationName.value} ${records.length} 条解析？${props.operation === 'delete' || props.operation === 'disable' ? '可能立即影响域名访问。' : ''}`,
			'确认批量操作',
			{ type: 'warning', confirmButtonText: `确认${operationName.value}` }
		)
	} catch {
		return
	}
	if (current !== generation || busy.value || submitted.value) return
	busy.value = true
	emit('busy', true)
	error.value = ''
	snapshot.value = records
	try {
		const result = await resourceRequest<{ data: Result[] }>('record_batch', payload)
		if (current !== generation) return
		results.value = result.data
		submitted.value = true
		emit('updated')
	} catch (exception) {
		if (current !== generation) return
		error.value = `${cloudErrorText(exception)}；请刷新解析列表核对，避免重复提交。`
		// IPC 超时也可能已有部分记录生效，锁定本批，重新打开前先核对列表。
		submitted.value = true
		emit('updated')
	} finally {
		if (current === generation) {
			busy.value = false
			emit('busy', false)
		}
	}
}
watch(
	() => [props.modelValue, props.accountId, props.domain, props.zoneId],
	() => {
		generation++
		input.value = ''
		ttl.value = 600
		line.value = '默认'
		error.value = ''
		submitted.value = false
		results.value = []
		snapshot.value = []
		busy.value = false
		emit('busy', false)
	}
)
onBeforeUnmount(() => {
	generation++
})
</script>
<style scoped>
.batch-note {
	color: var(--el-text-color-secondary);
	font-size: 12px;
	line-height: 1.8;
}
.batch-toolbar {
	display: flex;
	gap: 10px;
	align-items: center;
	flex-wrap: wrap;
	margin: 14px 0;
}
.batch-result {
	font-size: 12px;
	line-height: 1.7;
	overflow-wrap: anywhere;
	margin-top: 5px;
}
</style>
