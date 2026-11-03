<template>
	<section>
		<el-radio-group v-model="kind" class="domain-kind" @change="search"
			><el-radio-button value="dns">DNSPod 解析</el-radio-button
			><el-radio-button value="registered">注册域名</el-radio-button></el-radio-group
		>
		<ResourceStatus
			:product="kind === 'dns' ? 'domains' : 'registration'"
			:summary="summary[kind === 'dns' ? 'domains' : 'registration']"
			:busy="loading"
			@refresh="load" />
		<div class="domain-toolbar">
			<el-input
				v-if="kind === 'dns'"
				v-model="keyword"
				clearable
				placeholder="搜索域名"
				@keyup.enter="search"
				@clear="search" /><el-button v-if="kind === 'dns'" @click="search">查询</el-button
			><el-button :loading="loading" @click="load">刷新列表</el-button>
		</div>
		<el-alert v-if="error" type="error" :closable="false" :title="error" class="domain-alert" />
		<el-table :data="rows" v-loading="loading" empty-text="暂无可见域名">
			<el-table-column label="域名" min-width="240"
				><template #default="{ row }">{{ row.Name || row.DomainName }}</template></el-table-column
			>
			<el-table-column v-if="kind === 'dns'" label="状态" width="130"
				><template #default="{ row }"
					>{{ row.Status }}<small v-if="row.DNSStatus"> · {{ row.DNSStatus }}</small></template
				></el-table-column
			>
			<el-table-column v-if="kind === 'dns'" prop="Grade" label="解析套餐" width="150" />
			<el-table-column
				v-if="kind === 'dns'"
				prop="Remark"
				label="备注"
				min-width="150"
				show-overflow-tooltip />
			<el-table-column v-if="kind === 'registered'" label="到期时间" min-width="180"
				><template #default="{ row }">{{ row.ExpirationDate || '--' }}</template></el-table-column
			>
			<el-table-column v-if="kind === 'registered'" label="自动续费" width="110"
				><template #default="{ row }">{{
					row.AutoRenew === 1 ? '已开启' : '未开启'
				}}</template></el-table-column
			>
			<el-table-column label="操作" width="120" fixed="right"
				><template #default="{ row }"
					><el-button link type="primary" @click="selected = row.Name || row.DomainName"
						>解析管理</el-button
					></template
				></el-table-column
			>
		</el-table>
		<el-pagination
			v-model:current-page="page"
			:total="total"
			:page-size="20"
			layout="total, prev, pager, next"
			class="domain-pagination"
			@current-change="load" />
		<el-drawer
			:model-value="!!selected"
			:title="`${selected} · DNSPod 解析`"
			size="min(1100px, 96vw)"
			:close-on-click-modal="false"
			@update:model-value="
				value => {
					if (!value) selected = ''
				}
			"
			><RecordPanel v-if="selected" :key="selected" :account-id="accountId" :domain="selected"
		/></el-drawer>
	</section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { cloudErrorText, resourceRequest, type PageResult, type ResourceSummary } from './api'
import ResourceStatus from './resource-status.vue'
import RecordPanel from './record-panel.vue'
interface DomainRow {
	Name?: string
	DomainName?: string
	Status?: string
	DNSStatus?: string
	Grade?: string
	Remark?: string
	ExpirationDate?: string
	AutoRenew?: number
}
const props = defineProps<{ accountId: number; summary: Record<string, ResourceSummary> }>()
const emit = defineEmits<{ (event: 'updated'): void }>()
const kind = ref('dns'),
	keyword = ref(''),
	page = ref(1),
	total = ref(0),
	rows = ref<DomainRow[]>([]),
	loading = ref(false),
	error = ref(''),
	selected = ref('')
let sequence = 0
async function load() {
	const id = ++sequence
	loading.value = true
	error.value = ''
	try {
		const result = await resourceRequest<PageResult<DomainRow>>('domain_list', {
			account_id: props.accountId,
			kind: kind.value,
			keyword: kind.value === 'dns' ? keyword.value : '',
			page: page.value,
		})
		if (id === sequence) {
			rows.value = result.data
			total.value = result.total
		}
	} catch (exception) {
		if (id === sequence) error.value = cloudErrorText(exception)
	} finally {
		if (id === sequence) {
			loading.value = false
			emit('updated')
		}
	}
}
function search() {
	page.value = 1
	rows.value = []
	total.value = 0
	void load()
}
watch(
	() => props.accountId,
	() => {
		selected.value = ''
		search()
	},
	{ immediate: true }
)
onBeforeUnmount(() => {
	sequence++
})
</script>
<style scoped>
.domain-kind {
	margin: 14px 0;
}
.domain-toolbar {
	display: flex;
	gap: 10px;
	margin: 12px 0;
}
.domain-toolbar .el-input {
	max-width: 300px;
}
.domain-alert {
	margin-bottom: 14px;
}
.domain-pagination {
	justify-content: flex-end;
	margin-top: 18px;
}
</style>
