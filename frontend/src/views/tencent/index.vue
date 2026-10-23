<template>
	<div v-loading="loading" class="tencent-page">
		<header class="page-header">
			<div class="page-title">
				<div class="brand"><bt-icon name="tencent" size="24" /></div>
				<div class="title-text">
					<h1>{{ pub.lang('腾讯云账号') }}</h1>
					<p>{{ pub.lang('管理国内站、国际站账号与云服务器') }}</p>
				</div>
				<el-button :icon="Refresh" :loading="refreshingAll" @click="refreshAll(true)">{{
					pub.lang('刷新全部')
				}}</el-button
				><el-button type="primary" size="large" :icon="Plus" @click="openDialog()">{{
					pub.lang('添加账号')
				}}</el-button>
			</div>
			<div class="toolbar">
				<div class="control">
					<span class="control-label">{{ pub.lang('分组') }}</span>
					<div class="segmented">
						<el-radio-group v-model="groupId"
							><el-radio-button
								v-for="group in groups"
								:key="group.group_id"
								:value="group.group_id"
								>{{ group.group_name
								}}<span class="group-count">{{ group.account_count }}</span></el-radio-button
							></el-radio-group
						>
						<el-tooltip :content="pub.lang('管理分组')"
							><el-button text class="group-settings" :icon="Setting" @click="groupDialog = true"
						/></el-tooltip>
					</div>
				</div>
				<div class="control">
					<span class="control-label">{{ pub.lang('站点') }}</span>
					<div class="segmented">
						<el-radio-group v-model="siteFilter">
							<el-radio-button value="all">{{ pub.lang('全部') }}</el-radio-button>
							<el-radio-button value="cn">{{ pub.lang('国内站') }}</el-radio-button>
							<el-radio-button value="intl">{{ pub.lang('国际站') }}</el-radio-button>
						</el-radio-group>
					</div>
				</div>
				<div class="control">
					<span class="control-label">{{ pub.lang('排序') }}</span>
					<div class="segmented">
						<el-radio-group v-model="sortMode">
							<el-radio-button value="default">{{ pub.lang('默认') }}</el-radio-button>
							<el-radio-button value="remark">{{ pub.lang('备注') }}</el-radio-button>
							<el-radio-button value="balance" :title="pub.lang('按余额排序（同币种）')">{{
								pub.lang('余额')
							}}</el-radio-button>
						</el-radio-group>
					</div>
				</div>
				<el-input
					v-model="keyword"
					class="account-search"
					clearable
					:prefix-icon="Search"
					:placeholder="pub.lang('搜索备注或 SecretId')" />
			</div>
		</header>
		<div class="account-grid">
			<el-card
				v-for="account in filtered"
				:key="account.account_id"
				class="account-card"
				:class="{ 'account-card--dragging': draggedId === account.account_id }"
				shadow="hover"
				@click="openAccount(account)"
				@dragover.prevent
				@drop.prevent="dropAccount(account.account_id)">
				<template #header>
					<div class="card-heading">
						<div class="card-identity">
							<span
								class="drag-handle"
								:class="{ 'drag-handle--disabled': !canSort }"
								:draggable="canSort"
								:title="pub.lang('默认排序下可拖动调整顺序')"
								@click.stop
								@dragstart.stop="draggedId = account.account_id"
								@dragend.stop="draggedId = 0">
								<bt-icon name="sort" size="16" />
							</span>
							<div class="account-logo"><bt-icon name="tencent" size="22" /></div>
							<div class="account-name">
								<strong :title="account.remark">{{ account.remark }}</strong>
							</div>
						</div>
						<div class="card-actions" @click.stop>
							<el-tooltip :content="pub.lang('编辑账号')" placement="top">
								<el-button
									text
									:icon="EditPen"
									:aria-label="pub.lang('编辑账号')"
									@click="openDialog(account)" />
							</el-tooltip>
							<el-tooltip :content="pub.lang('删除账号')" placement="top">
								<el-button
									text
									:icon="Delete"
									:aria-label="pub.lang('删除账号')"
									@click="accountCommand('remove', account)" />
							</el-tooltip>
						</div>
					</div>
				</template>
				<div class="account-credentials">
					<CloudCredential
						label="SecretId"
						:value="account.secret_id"
						:reset-key="credentialReset" />
					<CloudCredential
						label="SecretKey"
						:load-value="() => readSecret(account.account_id)"
						:reset-key="credentialReset" />
				</div>
				<div class="balance">
					<strong>{{ money(account) }}</strong>
					<span class="balance-meta">
						<span>{{ pub.lang('余额') }} · {{ account.balance_currency }}</span>
						<el-tooltip :content="pub.lang('刷新账号')" placement="top">
							<el-button
								text
								circle
								class="balance-refresh"
								:icon="Refresh"
								:loading="refreshing.has(account.account_id)"
								:aria-label="pub.lang('刷新账号')"
								@click.stop="refreshAccount(account, true)" />
						</el-tooltip>
						<small :title="timeText(account.balance_refresh_time)">{{
							formatRefreshTime(account.balance_refresh_time)
						}}</small>
						<el-tooltip
							v-if="account.balance_error || account.server_error"
							:content="[account.balance_error, account.server_error].filter(Boolean).join('；')"
							placement="top">
							<em>{{ pub.lang(account.balance_error ? '余额异常' : '部分数据') }}</em>
						</el-tooltip>
					</span>
				</div>
				<div class="resource-counts">
					<div>
						<span>{{ pub.lang('服务器') }}</span>
						<strong>{{ count(account.server_count) }}</strong>
					</div>
					<div>
						<span>CVM</span>
						<strong>{{ count(account.cvm_count) }}</strong>
					</div>
					<div>
						<span>{{ pub.lang('轻量') }}</span>
						<strong>{{ count(account.lighthouse_count) }}</strong>
					</div>
					<div>
						<span>{{ pub.lang('站点') }}</span>
						<strong class="site-value">{{
							pub.lang(account.site === 'intl' ? '国际站' : '国内站')
						}}</strong>
					</div>
				</div>
			</el-card>
		</div>
		<el-empty
			v-if="!loading && !filtered.length"
			:description="pub.lang(accounts.length ? '没有匹配的账号' : '暂未添加腾讯云账号')"
			><el-button v-if="!accounts.length" type="primary" @click="openDialog()">{{
				pub.lang('添加账号')
			}}</el-button></el-empty
		>

		<el-dialog
			v-model="dialogVisible"
			:title="pub.lang(editingId ? '编辑腾讯云账号' : '添加腾讯云账号')"
			width="480px"
			align-center
			draggable
			:close-on-click-modal="false"
			@close="clearCredentialValues"
			@closed="resetForm">
			<el-form
				v-loading="credentialsLoading"
				ref="formRef"
				:model="form"
				:rules="rules"
				label-width="120px"
				size="large">
				<el-form-item :label="pub.lang('备注')" prop="remark"
					><el-input
						v-model="form.remark"
						maxlength="40"
						show-word-limit
						:placeholder="pub.lang('例如：生产环境')"
				/></el-form-item>
				<el-form-item :label="pub.lang('账号站点')" prop="site"
					><el-radio-group v-model="form.site"
						><el-radio-button value="cn">{{ pub.lang('国内站 · CNY') }}</el-radio-button
						><el-radio-button value="intl">{{
							pub.lang('国际站 · USD')
						}}</el-radio-button></el-radio-group
					><small class="field-note">{{
						pub.lang('按账号注册站点选择，服务器所在地域可包含国内及海外。')
					}}</small></el-form-item
				>
				<el-form-item label="SecretId" prop="secret_id"
					><el-input
						:key="'id-' + dialogVisible + '-' + editingId"
						v-model="form.secret_id"
						type="password"
						show-password
						autocomplete="off"
						placeholder="AKID…"
				/></el-form-item>
				<el-form-item label="SecretKey" prop="secret_key"
					><el-input
						:key="'key-' + dialogVisible + '-' + editingId"
						v-model="form.secret_key"
						type="password"
						show-password
						autocomplete="new-password"
						:placeholder="pub.lang(editingId ? '留空表示不修改' : '请输入 SecretKey')"
				/></el-form-item>
				<el-form-item :label="pub.lang('分组')"
					><el-select v-model="form.group_id" class="full-width"
						><el-option
							v-for="group in groups.filter(group => group.group_id >= 0)"
							:key="group.group_id"
							:value="group.group_id"
							:label="group.group_name" /></el-select
				></el-form-item>
			</el-form>
			<el-collapse
				><el-collapse-item :title="pub.lang('所需权限与密钥获取')" name="permissions"
					><p>
						{{
							pub.lang(
								'使用子账号密钥，授予余额、地域、实例及监控查询权限；开关机需单独授予启动/关闭实例权限。'
							)
						}}
					</p>
					<p class="permission-text">
						finance:DescribeAccountBalance<br />region:DescribeRegions<br />cvm:DescribeInstances /
						StartInstances / StopInstances<br />lighthouse:DescribeRegions / DescribeInstances /
						DescribeInstancesTrafficPackages / StartInstances / StopInstances<br />monitor:GetMonitorData
						<br />vpc:DescribeSecurityGroupPolicies / CreateSecurityGroupPolicies
						<br />lighthouse:DescribeFirewallRules / CreateFirewallRules
					</p>
					<p class="field-note">
						{{
							pub.lang(
								'终端使用服务器的 SSH 密码或私钥。网络诊断需要规则查询权限，确认放行时才需要新增规则权限。'
							)
						}}
					</p>
					<el-link
						:href="
							form.site === 'intl'
								? 'https://console.tencentcloud.com/cam/capi'
								: 'https://console.cloud.tencent.com/cam/capi'
						"
						target="_blank"
						type="primary"
						>{{ pub.lang('前往腾讯云获取密钥') }}</el-link
					></el-collapse-item
				></el-collapse
			>
			<template #footer
				><el-button @click="dialogVisible = false">{{ pub.lang('取消') }}</el-button
				><el-button
					type="primary"
					:loading="saving"
					:disabled="credentialsLoading"
					@click="saveAccount"
					>{{ pub.lang('保存') }}</el-button
				></template
			>
		</el-dialog>

		<el-dialog
			v-model="groupDialog"
			:title="pub.lang('腾讯云分组管理')"
			width="420px"
			align-center
			draggable
			:close-on-click-modal="false">
			<div class="group-add">
				<el-input
					v-model="groupName"
					maxlength="24"
					:placeholder="pub.lang('新分组名称')"
					@keyup.enter="addGroup" /><el-button
					type="primary"
					:loading="groupBusy"
					@click="addGroup"
					>{{ pub.lang('添加') }}</el-button
				>
			</div>
			<div
				v-for="group in groups.filter(group => group.group_id > 0)"
				:key="group.group_id"
				class="group-row">
				<span>{{ group.group_name }} ({{ group.account_count }})</span
				><el-button link :disabled="groupBusy" @click="renameGroup(group)">{{
					pub.lang('重命名')
				}}</el-button
				><el-button link type="danger" :disabled="groupBusy" @click="removeGroup(group)">{{
					pub.lang('删除')
				}}</el-button>
			</div>
			<el-empty
				v-if="!groups.some(group => group.group_id > 0)"
				:description="pub.lang('暂无自定义分组')"
				:image-size="60" />
		</el-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Delete, EditPen, Plus, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { pub } from '@utils/tools'
import { useMessage } from '@utils/hooks/message'
import CloudCredential from '@/components/CloudCredential/index.vue'
import { request, money, count, timeText, type TencentAccount, type TencentGroup } from './api'

const router = useRouter()
const Message = useMessage()
const accounts = ref<TencentAccount[]>([])
const groups = ref<TencentGroup[]>([])
const loading = ref(false)
const refreshing = reactive(new Set<number>())
const refreshingAll = ref(false)
const groupId = ref(-1)
const siteFilter = ref('all')
const sortMode = ref('default')
const keyword = ref('')
const draggedId = ref(0)
const canSort = computed(
	() =>
		sortMode.value === 'default' &&
		!keyword.value &&
		siteFilter.value === 'all' &&
		groupId.value === -1
)
const filtered = computed(() => {
	const search = keyword.value.trim().toLowerCase()
	const list = accounts.value.filter(
		account =>
			(groupId.value === -1 || account.group_id === groupId.value) &&
			(siteFilter.value === 'all' || account.site === siteFilter.value) &&
			`${account.remark} ${account.secret_id}`.toLowerCase().includes(search)
	)
	if (sortMode.value === 'remark') list.sort((a, b) => a.remark.localeCompare(b.remark, 'zh-CN'))
	if (sortMode.value === 'balance')
		list.sort(
			(a, b) =>
				a.balance_currency.localeCompare(b.balance_currency) ||
				Number(b.balance || '-Infinity') - Number(a.balance || '-Infinity')
		)
	return list
})
const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref(0)
const credentialsLoading = ref(false)
const credentialReset = ref(0)
let credentialRequestId = 0
const formRef = ref<FormInstance>()
const form = reactive({ remark: '', site: 'cn', secret_id: '', secret_key: '', group_id: 0 })
const rules: FormRules = {
	remark: [{ required: true, message: pub.lang('请输入备注'), trigger: 'blur' }],
	secret_id: [{ required: true, message: pub.lang('请输入 SecretId'), trigger: 'blur' }],
	secret_key: [
		{
			validator: (_rule, value, callback) =>
				!editingId.value && !value ? callback(new Error(pub.lang('请输入 SecretKey'))) : callback(),
			trigger: 'blur',
		},
	],
}
const groupDialog = ref(false)
const groupName = ref('')
const groupBusy = ref(false)
let disposed = false
const showError = (error: unknown) =>
	Message.error(error instanceof Error ? error.message : pub.lang('请求失败'))

function formatRefreshTime(time: number) {
	if (!time) return pub.lang('待获取')
	const seconds = Math.max(0, Math.floor(Date.now() / 1000) - time)
	if (seconds < 60) return pub.lang('刚刚更新')
	if (seconds < 3600) return pub.lang('{} 分钟前', Math.floor(seconds / 60))
	if (seconds < 86400) return pub.lang('{} 小时前', Math.floor(seconds / 3600))
	return pub.lang('{} 天前', Math.floor(seconds / 86400))
}

async function load() {
	const result = await request<{ data: TencentAccount[]; groups: TencentGroup[] }>('list')
	if (disposed) return
	accounts.value = result.data
	credentialReset.value++
	groups.value = result.groups
	if (!groups.value.some(group => group.group_id === groupId.value)) groupId.value = -1
}
async function refreshAccount(account: TencentAccount, force = false) {
	if (refreshing.has(account.account_id)) return
	refreshing.add(account.account_id)
	try {
		const updated = await request<TencentAccount>('refresh_summary', {
			account_id: account.account_id,
			force,
		})
		const index = accounts.value.findIndex(item => item.account_id === account.account_id)
		if (!disposed && index >= 0) accounts.value[index] = updated
	} catch (error) {
		if (!disposed) showError(error)
	} finally {
		refreshing.delete(account.account_id)
	}
}
async function refreshAll(force = false) {
	if (refreshingAll.value) return
	refreshingAll.value = true
	const queue = accounts.value.filter(
		account =>
			force ||
			Date.now() / 1000 - Math.min(account.balance_refresh_time, account.server_refresh_time) > 300
	)
	try {
		await Promise.all(
			[0, 1].map(async () => {
				while (queue.length && !disposed) {
					const account = queue.shift()
					if (account) await refreshAccount(account, force)
				}
			})
		)
	} finally {
		refreshingAll.value = false
	}
}
const readCredentials = (accountId: number) =>
	request<{ secret_id: string; secret_key: string }>('credentials', { account_id: accountId })
const readSecret = async (accountId: number) => (await readCredentials(accountId)).secret_key
function clearCredentialValues() {
	credentialRequestId++
	credentialReset.value++
	credentialsLoading.value = false
	form.secret_key = ''
}
async function openDialog(account?: TencentAccount) {
	resetForm()
	editingId.value = account?.account_id || 0
	Object.assign(form, {
		remark: account?.remark || '',
		site: account?.site || 'cn',
		secret_id: account?.secret_id || '',
		secret_key: '',
		group_id: account?.group_id || 0,
	})
	dialogVisible.value = true
	if (!account) return
	const id = ++credentialRequestId
	credentialsLoading.value = true
	try {
		const credentials = await readCredentials(account.account_id)
		if (id === credentialRequestId && dialogVisible.value) {
			form.secret_id = credentials.secret_id
			form.secret_key = credentials.secret_key
		}
	} catch (error) {
		if (id === credentialRequestId && dialogVisible.value) showError(error)
	} finally {
		if (id === credentialRequestId) credentialsLoading.value = false
	}
}
function resetForm() {
	clearCredentialValues()
	Object.assign(form, { remark: '', site: 'cn', secret_id: '', secret_key: '', group_id: 0 })
	editingId.value = 0
	formRef.value?.clearValidate()
}
async function saveAccount() {
	if (credentialsLoading.value) return
	if (!(await formRef.value?.validate().catch(() => false))) return
	saving.value = true
	try {
		await request('save', { ...form, account_id: editingId.value })
		dialogVisible.value = false
		Message.success(pub.lang('保存成功'))
		await load()
		void refreshAll()
	} catch (error) {
		showError(error)
	} finally {
		saving.value = false
	}
}
async function accountCommand(command: string, account: TencentAccount) {
	if (command === 'edit') return openDialog(account)
	try {
		await ElMessageBox.confirm(
			pub.lang('确定删除账号“{}”？云服务器将保留。', account.remark),
			pub.lang('删除账号'),
			{ type: 'warning' }
		)
	} catch {
		return
	}
	try {
		await request('remove', { account_id: account.account_id })
		await load()
		Message.success(pub.lang('账号已删除'))
	} catch (error) {
		showError(error)
	}
}
function openAccount(account: TencentAccount) {
	router.push(`/tencent/${account.account_id}`)
}
async function dropAccount(id: number) {
	if (!canSort.value || !draggedId.value || id === draggedId.value) return
	const before = [...accounts.value]
	const from = accounts.value.findIndex(account => account.account_id === draggedId.value)
	const to = accounts.value.findIndex(account => account.account_id === id)
	draggedId.value = 0
	if (from < 0 || to < 0) return
	accounts.value.splice(to, 0, accounts.value.splice(from, 1)[0])
	try {
		await request('set_sort', { account_ids: accounts.value.map(account => account.account_id) })
	} catch (error) {
		accounts.value = before
		showError(error)
	}
}
async function addGroup() {
	if (!groupName.value.trim() || groupBusy.value) return
	groupBusy.value = true
	try {
		await request('add_group', { group_name: groupName.value })
		groupName.value = ''
		await load()
	} catch (error) {
		showError(error)
	} finally {
		groupBusy.value = false
	}
}
async function renameGroup(group: TencentGroup) {
	let name = ''
	try {
		;({ value: name } = await ElMessageBox.prompt(
			pub.lang('请输入分组名称'),
			pub.lang('重命名分组'),
			{
				inputValue: group.group_name,
				inputPattern: /^.{1,24}$/,
				inputErrorMessage: pub.lang('请输入 1–24 个字符'),
			}
		))
	} catch {
		return
	}
	groupBusy.value = true
	try {
		await request('modify_group', { group_id: group.group_id, group_name: name })
		await load()
	} catch (error) {
		showError(error)
	} finally {
		groupBusy.value = false
	}
}
async function removeGroup(group: TencentGroup) {
	try {
		await ElMessageBox.confirm(
			pub.lang('删除分组“{}”后，账号将移入默认分组。', group.group_name),
			pub.lang('删除分组'),
			{ type: 'warning' }
		)
	} catch {
		return
	}
	groupBusy.value = true
	try {
		await request('remove_group', { group_id: group.group_id })
		await load()
	} catch (error) {
		showError(error)
	} finally {
		groupBusy.value = false
	}
}
onMounted(async () => {
	loading.value = true
	try {
		await load()
		void refreshAll()
	} catch (error) {
		showError(error)
	} finally {
		loading.value = false
	}
})
onBeforeUnmount(() => {
	disposed = true
	clearCredentialValues()
})
</script>

<style scoped lang="scss">
@use '../../styles/cloud-layout' as cloud;

.tencent-page {
	min-height: 100%;
	padding: 2.4rem 3.6rem 3.6rem;
	color: var(--el-text-color-primary);
}
.page-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 2rem;
	margin-bottom: 2.4rem;
}
.page-title {
	display: flex;
	align-items: center;
	flex-shrink: 0;
	gap: 1.2rem;

	h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 650;
		line-height: 1.35;
	}
	p {
		margin: 0.2rem 0 0;
		color: var(--el-text-color-secondary);
		font-size: 1.2rem;
	}
	.el-button {
		margin-left: 0.8rem;
	}
}
.brand,
.account-logo {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	color: var(--el-color-primary);
	background: var(--el-color-primary-light-9);
}
.brand {
	width: 4.4rem;
	height: 4.4rem;
	border-radius: 1.2rem;
}
.toolbar {
	display: flex;
	min-width: 0;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 1.2rem;
	margin-left: auto;
}
.control {
	display: flex;
	min-width: 0;
	align-items: center;
	gap: 0.8rem;
}
.control-label {
	flex-shrink: 0;
	font-size: 1.3rem;
	font-weight: 600;
	white-space: nowrap;
}
.segmented {
	display: flex;
	min-width: 0;
	height: 3.4rem;
	align-items: center;
	padding: 0.3rem;
	border: 1px solid var(--el-border-color);
	border-radius: 999px;

	.el-radio-group {
		display: flex;
		flex-wrap: nowrap;
		gap: 0.2rem;
		overflow-x: auto;
	}
	:deep(.el-radio-button__inner) {
		height: 2.6rem;
		padding: 0 1.1rem;
		border: 0 !important;
		border-radius: 999px !important;
		color: var(--el-text-color-regular);
		line-height: 2.6rem;
		background: transparent;
		box-shadow: none !important;
	}
	:deep(.el-radio-button.is-active .el-radio-button__inner) {
		color: #fff !important;
		font-weight: 600;
		background: var(--el-color-primary) !important;
	}
	:deep(.el-radio-button__original:focus-visible + .el-radio-button__inner) {
		outline: 2px solid var(--el-color-primary);
		outline-offset: -2px;
	}
}
.group-count {
	margin-left: 0.35rem;
	font-size: 1.1rem;
	opacity: 0.7;
}
.group-settings {
	width: 2.6rem;
	height: 2.6rem;
	flex-shrink: 0;
	margin-left: 0.2rem;
	padding: 0;
	border-radius: 50%;
	color: var(--el-text-color-regular);
}
.account-search {
	width: 24rem;
	:deep(.el-input__wrapper) {
		border-radius: 0.8rem;
	}
}
.account-grid {
	@include cloud.account-grid;
}
.account-card {
	@include cloud.account-card;

	min-width: 0;
	&--dragging {
		opacity: 0.25;
	}
}
.card-heading {
	display: flex;
	width: 100%;
	min-width: 0;
	align-items: center;
	justify-content: space-between;
	gap: 1rem;
}
.card-identity {
	display: flex;
	min-width: 0;
	flex: 1;
	align-items: center;
	gap: 1rem;
}
.drag-handle {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	cursor: grab;
	color: var(--el-text-color-secondary);

	&:active {
		cursor: grabbing;
	}
	&--disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
}
.account-logo {
	width: 3.4rem;
	height: 3.4rem;
	border-radius: 0.8rem;
}
.card-actions {
	display: flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 0.2rem;
	margin-left: auto;

	.el-button {
		width: 2.8rem;
		height: 2.8rem;
		margin: 0;
		padding: 0;
		color: var(--el-text-color-secondary);
	}
}
.account-name {
	min-width: 0;
	flex: 1;
	strong {
		display: block;
		overflow: hidden;
		font-size: 1.45rem;
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}
.account-credentials {
	padding: 0.2rem 0 0.6rem;
}
.balance {
	display: flex;
	min-width: 0;
	align-items: flex-start;
	padding: 0.8rem 0 1.1rem;
	flex-direction: column;

	strong {
		max-width: 100%;
		overflow: hidden;
		color: var(--el-color-primary);
		font-size: 2.05rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
}
.balance-meta {
	max-width: 100%;
	margin-top: 0.15rem;
	color: var(--el-text-color-secondary);
	font-size: 1.25rem;
	white-space: nowrap;

	small {
		min-width: 0;
		margin-left: 0.6rem;
		overflow: hidden;
		color: var(--el-text-color-placeholder);
		font-size: 1.1rem;
		text-overflow: ellipsis;
	}
	em {
		flex-shrink: 0;
		margin-left: 0.55rem;
		color: var(--el-color-warning);
		font-size: 1.1rem;
		font-style: normal;
	}
}
.balance-refresh {
	width: 2.2rem;
	height: 2.2rem;
	flex-shrink: 0;
	margin-left: 0.15rem;
	padding: 0;
	vertical-align: middle;
}
.resource-counts {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1rem 2.4rem;
	align-items: center;
	padding: 1.1rem 0;
	border-top: 1px solid var(--el-border-color-lighter);

	> div {
		display: grid;
		min-width: 0;
		grid-template-columns: 4.2rem minmax(0, 1fr);
		align-items: center;
		column-gap: 0.8rem;
	}
	span {
		color: var(--el-text-color-secondary);
		font-size: 1.1rem;
	}
	strong {
		font-size: 1.65rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.site-value {
		font-size: 1.25rem;
		font-weight: 500;
		white-space: nowrap;
	}
}
.field-note {
	display: block;
	width: 100%;
	margin-top: 0.5rem;
	color: var(--el-text-color-secondary);
	font-size: 1.1rem;
	line-height: 1.7;
}
.permission-text {
	font-family: monospace;
	font-size: 1.1rem;
	overflow-wrap: anywhere;
}
.full-width {
	width: 100%;
}
.group-add,
.group-row {
	display: flex;
	align-items: center;
	gap: 0.8rem;
}
.group-add {
	margin-bottom: 1.6rem;
}
.group-row {
	min-height: 5.2rem;
	border-bottom: 1px solid var(--el-border-color-lighter);
	span {
		margin-right: auto;
	}
}
@media (max-width: 1200px) {
	.page-header {
		align-items: flex-start;
		flex-direction: column;
	}
	.toolbar {
		width: 100%;
		margin-left: 0;
		justify-content: flex-start;
	}
}
@media (max-width: 600px) {
	.page-title {
		flex-wrap: wrap;
		flex-shrink: 1;
	}
	.title-text {
		min-width: 0;
	}
	.account-search {
		width: 100%;
	}
}
</style>
