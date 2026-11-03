<template>
	<section>
		<ResourceStatus
			:product="product"
			:summary="summary[product]"
			:busy="probing"
			@refresh="probe" />
		<el-alert
			v-if="product === 'cdn' && site === 'intl'"
			title="国际站新用户的 CDN 开通入口已转向 EdgeOne；此处管理已有 CDN 资源。"
			type="info"
			:closable="false"
			class="edge-alert" />
		<div v-if="zone" class="zone-heading">
			<el-button @click="back">返回站点</el-button><strong>{{ zone.name }}</strong
			><span>{{ zone.alias }} · {{ zone.type }} · {{ zone.area }}</span
			><el-button v-if="['full', 'dnsPodAccess'].includes(zone.type)" @click="dnsVisible = true">{{
				zone.type === 'dnsPodAccess' ? 'DNSPod 解析管理' : 'DNS 记录'
			}}</el-button
			><el-tooltip v-else content="CNAME 接入的 DNS 记录由原 DNS 服务商管理"
				><el-tag type="info">CNAME 接入</el-tag></el-tooltip
			>
		</div>
		<div class="edge-toolbar">
			<el-input
				v-model="keyword"
				clearable
				:placeholder="
					product === 'edgeone' && !zone
						? '搜索站点'
						: product === 'cdn'
							? '输入完整加速域名'
							: '搜索加速域名'
				"
				@keyup.enter="search"
				@clear="search" /><el-button @click="search">查询</el-button
			><el-button :loading="loading" @click="load">刷新列表</el-button
			><el-button v-if="product === 'edgeone'" @click="openPlans">查看套餐</el-button>
		</div>
		<el-alert v-if="error" :title="error" type="error" :closable="false" class="edge-alert" />
		<el-table
			v-if="product === 'edgeone' && !zone"
			:data="zones"
			v-loading="loading"
			empty-text="暂无可见 EdgeOne 站点">
			<el-table-column prop="name" label="站点" min-width="200" /><el-table-column
				prop="alias"
				label="别称"
				min-width="130" /><el-table-column label="接入方式" width="155"
				><template #default="{ row }">{{ zoneTypeLabel(row.type) }}</template></el-table-column
			><el-table-column prop="area" label="加速区域" width="115" /><el-table-column
				label="状态"
				min-width="120"
				><template #default="{ row }">{{
					row.paused ? '已暂停' : row.active_status || row.status
				}}</template></el-table-column
			><el-table-column label="操作" width="120"
				><template #default="{ row }"
					><el-button link type="primary" @click="enter(row)">管理站点</el-button></template
				></el-table-column
			>
		</el-table>
		<el-table v-else :data="domains" v-loading="loading" empty-text="暂无可见加速域名">
			<el-table-column prop="name" label="加速域名" min-width="210" /><el-table-column
				label="状态"
				width="100"
				><template #default="{ row }">{{ statusLabel(row.status) }}</template></el-table-column
			><el-table-column
				prop="cname"
				label="CNAME"
				min-width="240"
				show-overflow-tooltip /><el-table-column
				prop="origin"
				label="源站"
				min-width="220"
				show-overflow-tooltip /><el-table-column
				v-if="zone"
				prop="certificate_expiry"
				label="证书到期"
				min-width="180" /><el-table-column label="操作" width="170" fixed="right"
				><template #default="{ row }"
					><el-button link type="primary" @click="selected = row.name">配置与运维</el-button
					><el-button link :disabled="busy" @click="toggle(row)">{{
						row.status === 'offline' ? '启用' : '停用'
					}}</el-button></template
				></el-table-column
			>
		</el-table>
		<el-pagination
			v-model:current-page="page"
			:total="total"
			:page-size="20"
			layout="total, prev, pager, next"
			class="edge-pagination"
			@current-change="load" />
		<el-drawer
			:model-value="!!selected"
			:title="`${selected} · ${product === 'cdn' ? 'CDN' : 'EdgeOne'}`"
			size="min(1000px, 96vw)"
			:close-on-click-modal="false"
			@update:model-value="
				value => {
					if (!value) selected = ''
				}
			"
			><EdgeWorkbench
				v-if="selected"
				:key="selected"
				:account-id="accountId"
				:domain="selected"
				:zone-id="zone?.id"
				:active="active"
				@updated="load"
		/></el-drawer>
		<el-drawer
			v-model="dnsVisible"
			:title="`${zone?.name} · DNS 解析`"
			size="min(1100px, 96vw)"
			:close-on-click-modal="false"
			><RecordPanel
				v-if="dnsVisible && zone"
				:key="zone.id"
				:account-id="accountId"
				:domain="zone.name"
				:zone-id="zone.type === 'full' ? zone.id : undefined"
		/></el-drawer>
		<el-dialog v-model="plansVisible" title="EdgeOne 套餐" width="min(1000px, 95vw)" align-center
			><el-alert
				v-if="planError"
				:title="planError"
				type="warning"
				:closable="false"
				class="edge-alert" /><el-table :data="plans" v-loading="plansLoading"
				><el-table-column prop="PlanId" label="套餐 ID" min-width="210" /><el-table-column
					prop="PlanType"
					label="类型"
					width="145" /><el-table-column prop="Area" label="加速区域" width="125" /><el-table-column
					prop="Status"
					label="状态"
					width="120" /><el-table-column
					prop="ExpiredTime"
					label="到期时间"
					min-width="190" /></el-table
			><el-pagination
				v-model:current-page="planPage"
				:total="planTotal"
				:page-size="20"
				layout="total, prev, pager, next"
				class="edge-pagination"
				@current-change="loadPlans"
		/></el-dialog>
	</section>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import {
	cloudErrorText,
	request,
	resourceRequest,
	type PageResult,
	type ResourceSummary,
} from './api'
import ResourceStatus from './resource-status.vue'
import EdgeWorkbench from './edge-workbench.vue'
import RecordPanel from './record-panel.vue'
interface Zone {
	id: string
	name: string
	alias: string
	type: string
	area: string
	status: string
	active_status: string
	paused: boolean
}
interface Domain {
	name: string
	status: string
	cname: string
	origin: string
	certificate_expiry?: string
}
interface Plan {
	PlanId: string
	PlanType: string
	Area: string
	Status: string
	ExpiredTime: string
}
const props = defineProps<{
	accountId: number
	active?: boolean
	product: 'cdn' | 'edgeone'
	site: 'cn' | 'intl'
	summary: Record<string, ResourceSummary>
}>()
const emit = defineEmits<{ (event: 'updated'): void }>()
const zones = ref<Zone[]>([]),
	zone = ref<Zone>(),
	domains = ref<Domain[]>([]),
	selected = ref(''),
	dnsVisible = ref(false),
	keyword = ref(''),
	page = ref(1),
	total = ref(0),
	loading = ref(false),
	error = ref(''),
	busy = ref(false),
	probing = ref(false)
const plansVisible = ref(false),
	plans = ref<Plan[]>([]),
	plansLoading = ref(false),
	planError = ref(''),
	planPage = ref(1),
	planTotal = ref(0)
let sequence = 0,
	generation = 0,
	planSequence = 0
const statusLabel = (status: string) =>
	(
		({
			online: '已启用',
			offline: '已停用',
			process: '部署中',
			processing: '部署中',
			closing: '停用中',
			init: '待激活',
		}) as Record<string, string>
	)[status] || status
const zoneTypeLabel = (type: string) =>
	(
		({
			full: 'NS 接入',
			partial: 'CNAME 接入',
			dnsPodAccess: 'DNSPod 托管',
			partialComposite: '无域名接入',
		}) as Record<string, string>
	)[type] || type
async function load() {
	const id = ++sequence,
		current = generation
	loading.value = true
	error.value = ''
	const isZoneList = props.product === 'edgeone' && !zone.value
	try {
		const result = await resourceRequest<PageResult<Zone | Domain>>(
			isZoneList ? 'edge_zones' : props.product === 'cdn' ? 'cdn_list' : 'edge_domains',
			{
				account_id: props.accountId,
				...(zone.value ? { zone_id: zone.value.id } : {}),
				page: page.value,
				keyword: keyword.value,
			}
		)
		if (id === sequence && current === generation) {
			if (isZoneList) zones.value = result.data as Zone[]
			else domains.value = result.data as Domain[]
			total.value = result.total
		}
	} catch (exception) {
		if (id === sequence && current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (id === sequence && current === generation) {
			loading.value = false
			emit('updated')
		}
	}
}
function search() {
	page.value = 1
	void load()
}
function enter(row: Zone) {
	zone.value = row
	keyword.value = ''
	domains.value = []
	total.value = 0
	search()
}
function back() {
	zone.value = undefined
	keyword.value = ''
	total.value = 0
	search()
}
async function probe() {
	const current = generation
	probing.value = true
	try {
		await request('probe_resources', {
			account_id: props.accountId,
			product: props.product,
			force: true,
		})
		if (current === generation) {
			emit('updated')
			await load()
		}
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) probing.value = false
	}
}
async function toggle(row: Domain) {
	if (busy.value || !['online', 'offline'].includes(row.status)) {
		error.value = '请等待域名部署完成后再切换状态'
		return
	}
	const current = generation
	const payload = {
		account_id: props.accountId,
		domain: row.name,
		...(zone.value ? { zone_id: zone.value.id } : {}),
		operation: 'status',
		status: row.status === 'offline' ? 'online' : 'offline',
		confirm_domain: row.name,
	}
	try {
		await ElMessageBox.confirm(
			`确认${row.status === 'offline' ? '启用' : '停用'} ${row.name}？${row.status !== 'offline' ? '停用会中断该域名的加速服务。' : ''}`,
			'修改加速状态',
			{ type: 'warning' }
		)
	} catch {
		return
	}
	if (current !== generation) return
	busy.value = true
	error.value = ''
	try {
		await resourceRequest('edge_change', payload)
		if (current === generation) await load()
	} catch (exception) {
		if (current === generation) error.value = cloudErrorText(exception)
	} finally {
		if (current === generation) busy.value = false
	}
}
async function loadPlans() {
	const id = ++planSequence,
		current = generation
	plansLoading.value = true
	planError.value = ''
	try {
		const result = await resourceRequest<PageResult<Plan>>('edge_plans', {
			account_id: props.accountId,
			page: planPage.value,
		})
		if (id === planSequence && current === generation) {
			plans.value = result.data
			planTotal.value = result.total
		}
	} catch (exception) {
		if (id === planSequence && current === generation) planError.value = cloudErrorText(exception)
	} finally {
		if (id === planSequence && current === generation) plansLoading.value = false
	}
}
function openPlans() {
	plansVisible.value = true
	planPage.value = 1
	void loadPlans()
}
watch(
	() => [props.accountId, props.product],
	() => {
		generation++
		zone.value = undefined
		selected.value = ''
		dnsVisible.value = false
		plansVisible.value = false
		keyword.value = ''
		zones.value = []
		domains.value = []
		page.value = 1
		total.value = 0
		void load()
	},
	{ immediate: true }
)
onBeforeUnmount(() => {
	generation++
})
</script>
<style scoped>
.edge-toolbar,
.zone-heading {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 10px;
	margin: 14px 0;
}
.edge-toolbar .el-input {
	max-width: 320px;
}
.zone-heading span {
	color: var(--el-text-color-secondary);
	font-size: 12px;
}
.edge-alert {
	margin: 14px 0;
}
.edge-pagination {
	justify-content: flex-end;
	margin-top: 18px;
}
</style>
