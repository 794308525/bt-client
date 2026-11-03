<template>
	<el-dialog
		:model-value="modelValue"
		title="选择腾讯云 SSL 证书"
		width="min(1000px, 95vw)"
		align-center
		:close-on-click-modal="false"
		@update:model-value="value => emit('update:modelValue', value)">
		<p class="certificate-note">
			当前加速域名：{{
				domain
			}}。列表展示已签发、可部署的服务器证书，仅可选择覆盖当前域名的证书。列举证书需要
			ssl:DescribeCertificates 权限；无列表权限时可返回手填证书 ID。
		</p>
		<div class="certificate-toolbar">
			<el-input
				v-model="keyword"
				clearable
				placeholder="搜索证书 ID、备注或证书域名"
				@keyup.enter="search"
				@clear="search" /><el-button :loading="loading" @click="search">查询</el-button>
		</div>
		<el-alert v-if="error" :title="error" type="error" :closable="false" />
		<el-table
			:data="rows"
			v-loading="loading"
			max-height="420"
			empty-text="未找到可见且可部署的服务器证书">
			<el-table-column prop="id" label="证书 ID" min-width="120" />
			<el-table-column prop="alias" label="备注" min-width="110" show-overflow-tooltip />
			<el-table-column label="覆盖域名" min-width="240"
				><template #default="{ row }"
					><span>{{ row.names.join('、') || row.domain }}</span></template
				></el-table-column
			>
			<el-table-column prop="end_time" label="到期时间" min-width="170" />
			<el-table-column label="操作" width="130" fixed="right"
				><template #default="{ row }"
					><el-button link type="primary" :disabled="!row.matches" @click="select(row)">{{
						row.matches ? '选择此证书' : '不覆盖此域名'
					}}</el-button></template
				></el-table-column
			>
		</el-table>
		<el-pagination
			v-model:current-page="page"
			:total="total"
			:page-size="20"
			layout="total, prev, pager, next"
			class="certificate-pagination"
			@current-change="load" />
		<template #footer
			><el-button @click="emit('update:modelValue', false)">取消</el-button></template
		>
	</el-dialog>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { cloudErrorText, resourceRequest, type PageResult } from './api'
interface Certificate {
	id: string
	domain: string
	alias: string
	names: string[]
	end_time: string
	matches: boolean
}
const props = defineProps<{ modelValue: boolean; accountId: number; domain: string }>()
const emit = defineEmits<{
	(event: 'update:modelValue', value: boolean): void
	(event: 'select', value: string): void
}>()
const keyword = ref(''),
	page = ref(1),
	total = ref(0),
	loading = ref(false),
	error = ref(''),
	rows = ref<Certificate[]>([])
let sequence = 0
async function load() {
	if (!props.modelValue) return
	const current = ++sequence
	loading.value = true
	error.value = ''
	try {
		const result = await resourceRequest<PageResult<Certificate>>('ssl_list', {
			account_id: props.accountId,
			domain: props.domain,
			keyword: keyword.value,
			page: page.value,
		})
		if (current === sequence) {
			rows.value = result.data
			total.value = result.total
		}
	} catch (exception) {
		if (current === sequence) {
			rows.value = []
			total.value = 0
			error.value = cloudErrorText(exception)
		}
	} finally {
		if (current === sequence) loading.value = false
	}
}
function search() {
	page.value = 1
	void load()
}
function select(row: Certificate) {
	if (!row.matches) return
	emit('select', row.id)
	emit('update:modelValue', false)
}
watch(
	() => [props.modelValue, props.accountId, props.domain],
	() => {
		sequence++
		rows.value = []
		total.value = 0
		keyword.value = ''
		page.value = 1
		error.value = ''
		loading.value = false
		if (props.modelValue) void load()
	},
	{ immediate: true }
)
onBeforeUnmount(() => {
	sequence++
})
</script>
<style scoped>
.certificate-note {
	color: var(--el-text-color-secondary);
	line-height: 1.8;
	font-size: 12px;
}
.certificate-toolbar {
	display: flex;
	gap: 10px;
	margin: 14px 0;
}
.certificate-toolbar .el-input {
	max-width: 360px;
}
.certificate-pagination {
	margin-top: 16px;
	justify-content: flex-end;
}
</style>
