<template>
	<div class="aliyun-page">
		<div class="aliyun-header">
			<div class="aliyun-title">
				<div class="aliyun-title__icon">
					<bt-icon name="aliyun" size="24" />
				</div>
				<div>
					<h1>{{ pub.lang('阿里云账号') }}</h1>
					<p>{{ pub.lang('集中管理阿里云账号与云资源') }}</p>
				</div>
				<el-button type="primary" size="large" :icon="Plus" @click="openAccountDialog()">
					{{ pub.lang('添加账号') }}
				</el-button>
			</div>

			<div class="aliyun-toolbar">
				<div class="aliyun-control">
					<span class="aliyun-control__label">{{ pub.lang('分组') }}</span>
					<el-radio-group v-model="currentGroup" class="aliyun-segmented">
						<el-radio-button
							v-for="group in groupList"
							:key="group.group_id"
							:value="group.group_id">
							{{ group.group_name }}
							<span class="aliyun-segmented__count">{{ group.account_count || 0 }}</span>
						</el-radio-button>
					</el-radio-group>
					<el-tooltip :content="pub.lang('管理分组')" :enterable="false" placement="bottom">
						<el-button
							text
							:icon="Setting"
							class="aliyun-tool"
							@click="groupDialogVisible = true" />
					</el-tooltip>
				</div>

				<div class="aliyun-control">
					<span class="aliyun-control__label">{{ pub.lang('排序') }}</span>
					<el-radio-group v-model="sortMode" class="aliyun-segmented">
						<el-radio-button
							v-for="option in sortOptions"
							:key="option.value"
							:value="option.value">
							{{ option.label }}
						</el-radio-button>
					</el-radio-group>
				</div>

				<el-input
					v-model="searchKeyword"
					clearable
					:prefix-icon="Search"
					class="aliyun-search"
					:placeholder="pub.lang('搜索备注或 AccessKey ID')" />
			</div>
		</div>

		<div v-if="filteredAccounts.length" class="aliyun-grid">
			<el-card
				v-for="account in filteredAccounts"
				:key="account.account_id"
				class="aliyun-card"
				shadow="hover">
				<template #header>
					<div class="aliyun-card__header">
						<div class="aliyun-card__identity">
							<div class="aliyun-card__logo">
								<bt-icon name="aliyun" size="22" />
							</div>
							<div class="min-w-0">
								<div class="aliyun-card__remark" :title="account.remark">{{ account.remark }}</div>
								<div class="aliyun-card__key">{{ maskAccessKey(account.access_key_id) }}</div>
							</div>
						</div>
						<el-dropdown
							trigger="click"
							@command="command => handleAccountCommand(command, account)">
							<el-button text :icon="MoreFilled" class="aliyun-card__more" @click.stop />
							<template #dropdown>
								<el-dropdown-menu>
									<el-dropdown-item command="edit">{{ pub.lang('编辑') }}</el-dropdown-item>
									<el-dropdown-item command="remove" divided>{{
										pub.lang('删除')
									}}</el-dropdown-item>
								</el-dropdown-menu>
							</template>
						</el-dropdown>
					</div>
				</template>

				<div class="aliyun-balance">
					<span>{{ pub.lang('账号余额') }}</span>
					<strong>{{ formatBalance(account.balance) }}</strong>
				</div>
				<div class="aliyun-resource-list">
					<div class="aliyun-resource">
						<span class="aliyun-resource__value">{{ formatCount(account.server_count) }}</span>
						<span class="aliyun-resource__unit">{{ pub.lang('台服务器') }}</span>
					</div>
					<div class="aliyun-resource">
						<span class="aliyun-resource__value">{{ formatCount(account.domain_count) }}</span>
						<span class="aliyun-resource__unit">{{ pub.lang('条域名') }}</span>
					</div>
				</div>
				<div class="aliyun-card__footer">
					<span>{{ getGroupName(account.group_id) }}</span>
					<span>{{ pub.lang('资源数据待获取') }}</span>
				</div>
			</el-card>
		</div>

		<el-empty
			v-else
			:image-size="100"
			:description="
				searchKeyword ? pub.lang('没有匹配的阿里云账号') : pub.lang('暂未添加阿里云账号')
			">
			<el-button v-if="!searchKeyword" type="primary" @click="openAccountDialog()">
				{{ pub.lang('添加账号') }}
			</el-button>
		</el-empty>

		<el-dialog
			v-model="accountDialogVisible"
			width="480"
			align-center
			draggable
			:close-on-click-modal="false"
			:title="editingAccountId ? pub.lang('编辑阿里云账号') : pub.lang('添加阿里云账号')"
			@closed="resetAccountForm">
			<el-form
				ref="accountFormRef"
				:model="accountForm"
				:rules="accountRules"
				label-width="120px"
				size="large">
				<el-form-item :label="pub.lang('备注')" prop="remark">
					<el-input
						v-model="accountForm.remark"
						maxlength="40"
						show-word-limit
						:placeholder="pub.lang('例如：生产环境')" />
				</el-form-item>
				<el-form-item :label="pub.lang('AccessKey ID')" prop="access_key_id">
					<el-input v-model="accountForm.access_key_id" autocomplete="off" placeholder="LTAI..." />
				</el-form-item>
				<el-form-item :label="pub.lang('AccessKey Secret')" prop="access_key_secret">
					<el-input
						v-model="accountForm.access_key_secret"
						type="password"
						show-password
						autocomplete="new-password"
						:placeholder="
							editingAccountId ? pub.lang('留空表示不修改') : pub.lang('请输入 AccessKey Secret')
						" />
				</el-form-item>
				<el-form-item :label="pub.lang('分组')" prop="group_id">
					<el-select v-model="accountForm.group_id" class="w-full">
						<el-option
							v-for="group in accountGroupOptions"
							:key="group.group_id"
							:label="group.group_name"
							:value="group.group_id" />
					</el-select>
				</el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="accountDialogVisible = false">{{ pub.lang('取消') }}</el-button>
				<el-button type="primary" :loading="accountSaving" @click="saveAccount">
					{{ pub.lang('保存') }}
				</el-button>
			</template>
		</el-dialog>

		<el-dialog
			v-model="groupDialogVisible"
			width="420"
			align-center
			draggable
			:close-on-click-modal="false"
			:title="pub.lang('分组管理')">
			<div class="aliyun-group-add">
				<el-input
					v-model="newGroupName"
					size="large"
					maxlength="24"
					:placeholder="pub.lang('请输入分组名称')"
					@keydown.enter="addGroup" />
				<el-button size="large" type="primary" @click="addGroup">{{ pub.lang('添加') }}</el-button>
			</div>
			<div class="aliyun-group-list">
				<div v-for="group in accountGroupOptions" :key="group.group_id" class="aliyun-group-item">
					<div>
						<span>{{ group.group_name }}</span>
						<span class="aliyun-group-item__count">{{ group.account_count || 0 }}</span>
					</div>
					<div v-if="group.group_id !== 0">
						<el-button link type="primary" @click="editGroup(group)">{{
							pub.lang('编辑')
						}}</el-button>
						<el-button link type="danger" @click="removeGroup(group)">{{
							pub.lang('删除')
						}}</el-button>
					</div>
					<span v-else class="aliyun-group-item__fixed">{{ pub.lang('系统分组') }}</span>
				</div>
			</div>
		</el-dialog>
	</div>
</template>

<script setup lang="ts">
import { MoreFilled, Plus, Search, Setting } from '@element-plus/icons-vue'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import { pub } from '@utils/tools'

interface AliyunGroup {
	group_id: number
	group_name: string
	account_count: number
}

interface AliyunAccount {
	account_id: number
	group_id: number
	remark: string
	access_key_id: string
	balance: string
	server_count: number
	domain_count: number
	sort: number
	addtime: number
	update_time: number
}

type SortMode = 'default' | 'latest' | 'earliest'

defineOptions({ name: 'Aliyun' })

const Message = useMessage()
const accountList = ref<AliyunAccount[]>([])
const groupList = ref<AliyunGroup[]>([
	{ group_id: -1, group_name: pub.lang('全部'), account_count: 0 },
	{ group_id: 0, group_name: pub.lang('默认'), account_count: 0 },
])
const currentGroup = ref(-1)
const searchKeyword = ref('')
const sortMode = ref<SortMode>('default')
const sortOptions: Array<{ label: string; value: SortMode }> = [
	{ label: pub.lang('默认排序'), value: 'default' },
	{ label: pub.lang('最新添加'), value: 'latest' },
	{ label: pub.lang('最早添加'), value: 'earliest' },
]

const accountDialogVisible = ref(false)
const accountSaving = ref(false)
const editingAccountId = ref(0)
const accountFormRef = ref<FormInstance>()
const createAccountForm = () => ({
	remark: '',
	access_key_id: '',
	access_key_secret: '',
	group_id: 0,
})
const accountForm = reactive(createAccountForm())
const accountRules = computed<FormRules>(() => ({
	remark: [{ required: true, message: pub.lang('请输入备注'), trigger: 'blur' }],
	access_key_id: [{ required: true, message: pub.lang('请输入 AccessKey ID'), trigger: 'blur' }],
	access_key_secret: [
		{
			validator: (_rule, value, callback) => {
				if (!editingAccountId.value && !value)
					callback(new Error(pub.lang('请输入 AccessKey Secret')))
				else callback()
			},
			trigger: 'blur',
		},
	],
}))

const groupDialogVisible = ref(false)
const newGroupName = ref('')

const accountGroupOptions = computed(() => groupList.value.filter(group => group.group_id !== -1))
const filteredAccounts = computed(() => {
	const keyword = searchKeyword.value.trim().toLowerCase()
	let list = accountList.value.filter(account => {
		if (currentGroup.value !== -1 && account.group_id !== currentGroup.value) return false
		if (!keyword) return true
		return (
			account.remark.toLowerCase().includes(keyword) ||
			account.access_key_id.toLowerCase().includes(keyword)
		)
	})

	if (sortMode.value === 'latest') list = [...list].sort((a, b) => b.addtime - a.addtime)
	if (sortMode.value === 'earliest') list = [...list].sort((a, b) => a.addtime - b.addtime)
	return list
})

const request = (route: string, data: Record<string, unknown> = {}) => {
	return new Promise<any>(resolve => common.send(route, data, resolve))
}

const getAccountList = async () => {
	const result = await request(routes.aliyun.list.path)
	if (!result?.status) return Message.request(result)
	accountList.value = result.data.data || []
	groupList.value = result.data.groups || []
	if (!groupList.value.some(group => group.group_id === currentGroup.value)) currentGroup.value = -1
}

const openAccountDialog = (account?: AliyunAccount) => {
	resetAccountForm()
	if (account) {
		editingAccountId.value = account.account_id
		accountForm.remark = account.remark
		accountForm.access_key_id = account.access_key_id
		accountForm.group_id = account.group_id
	}
	accountDialogVisible.value = true
}

const resetAccountForm = () => {
	editingAccountId.value = 0
	Object.assign(accountForm, createAccountForm())
	accountFormRef.value?.clearValidate()
}

const saveAccount = async () => {
	if (!accountFormRef.value) return
	const valid = await accountFormRef.value.validate().catch(() => false)
	if (!valid) return

	accountSaving.value = true
	try {
		const result = await request(routes.aliyun.save.path, {
			account_id: editingAccountId.value,
			...accountForm,
		})
		Message.request(result)
		if (!result?.status) return
		accountDialogVisible.value = false
		await getAccountList()
	} finally {
		accountSaving.value = false
	}
}

const handleAccountCommand = (command: string, account: AliyunAccount) => {
	if (command === 'edit') openAccountDialog(account)
	if (command === 'remove') removeAccount(account)
}

const removeAccount = async (account: AliyunAccount) => {
	try {
		await ElMessageBox.confirm(
			pub.lang('确定删除阿里云账号“{}”吗？', account.remark),
			pub.lang('删除账号'),
			{ type: 'warning' }
		)
	} catch {
		return
	}
	const result = await request(routes.aliyun.remove.path, { account_id: account.account_id })
	Message.request(result)
	if (result?.status) await getAccountList()
}

const addGroup = async () => {
	const groupName = newGroupName.value.trim()
	if (!groupName) return Message.warn(pub.lang('请输入分组名称'))
	const result = await request(routes.aliyun.add_group.path, { group_name: groupName })
	Message.request(result)
	if (!result?.status) return
	newGroupName.value = ''
	await getAccountList()
}

const editGroup = async (group: AliyunGroup) => {
	let result
	try {
		result = await ElMessageBox.prompt(pub.lang('请输入新的分组名称'), pub.lang('编辑分组'), {
			inputValue: group.group_name,
			inputValidator: value => !!value.trim() || pub.lang('分组名称不能为空'),
		})
	} catch {
		return
	}
	const response = await request(routes.aliyun.modify_group.path, {
		group_id: group.group_id,
		group_name: result.value.trim(),
	})
	Message.request(response)
	if (response?.status) await getAccountList()
}

const removeGroup = async (group: AliyunGroup) => {
	try {
		await ElMessageBox.confirm(
			pub.lang('删除分组后，该组账号将移至默认分组。确定继续吗？'),
			pub.lang('删除分组'),
			{ type: 'warning' }
		)
	} catch {
		return
	}
	const result = await request(routes.aliyun.remove_group.path, { group_id: group.group_id })
	Message.request(result)
	if (result?.status) await getAccountList()
}

const maskAccessKey = (accessKey: string) => {
	if (!accessKey) return '--'
	if (accessKey.length <= 8) return `${accessKey.slice(0, 3)}****`
	return `${accessKey.slice(0, 5)}****${accessKey.slice(-4)}`
}

const formatBalance = (balance: string) => {
	if (balance === '' || balance === null || balance === undefined) return pub.lang('待获取')
	return `¥ ${balance}`
}

const formatCount = (count: number) => (Number(count) >= 0 ? Number(count) : '--')
const getGroupName = (groupId: number) => {
	return groupList.value.find(group => group.group_id === groupId)?.group_name || pub.lang('默认')
}

onMounted(getAccountList)
</script>

<style scoped lang="scss">
.aliyun-page {
	min-height: 100%;
	padding: 2.4rem 3.6rem 3.6rem;
	color: var(--el-text-color-primary);
}

.aliyun-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 2rem;
	margin-bottom: 2.4rem;
}

.aliyun-title,
.aliyun-toolbar,
.aliyun-control,
.aliyun-card__header,
.aliyun-card__identity,
.aliyun-resource-list,
.aliyun-card__footer,
.aliyun-group-add,
.aliyun-group-item {
	display: flex;
	align-items: center;
}

.aliyun-title {
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

.aliyun-title__icon,
.aliyun-card__logo {
	display: flex;
	align-items: center;
	justify-content: center;
	color: #ff6a00;
	background: rgba(255, 106, 0, 0.11);
}

.aliyun-title__icon {
	width: 4.4rem;
	height: 4.4rem;
	border-radius: 1.2rem;
}

.aliyun-toolbar {
	justify-content: flex-end;
	gap: 1.2rem;
	min-width: 0;
}

.aliyun-control {
	gap: 0.7rem;
}

.aliyun-control__label {
	font-size: 1.3rem;
	font-weight: 600;
	white-space: nowrap;
}

.aliyun-segmented {
	box-sizing: border-box;
	height: 3.6rem;
	padding: 0.3rem;
	border: 1px solid var(--el-border-color);
	border-radius: 999px;
	background: transparent;

	:deep(.el-radio-button__inner) {
		height: 2.8rem;
		padding: 0 1rem;
		border: 0 !important;
		border-radius: 999px !important;
		color: var(--el-text-color-regular);
		line-height: 2.8rem;
		background: transparent;
		box-shadow: none !important;
	}

	:deep(.el-radio-button.is-active .el-radio-button__inner) {
		color: #fff;
		font-weight: 600;
		background: #ff6a00;
	}
}

.aliyun-segmented__count {
	margin-left: 0.35rem;
	font-size: 1.1rem;
	opacity: 0.7;
}

.aliyun-tool {
	width: 3.2rem;
	height: 3.2rem;
	padding: 0;
}

.aliyun-search {
	width: 24rem;

	:deep(.el-input__wrapper) {
		border-radius: 0.8rem;
	}
}

.aliyun-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(29rem, 1fr));
	gap: 1.6rem;
}

.aliyun-card {
	border-radius: 1.2rem;
	cursor: default;

	:deep(.el-card__header) {
		padding: 1.5rem 1.8rem;
	}

	:deep(.el-card__body) {
		padding: 1.8rem;
	}
}

.aliyun-card__header {
	justify-content: space-between;
	gap: 1rem;
}

.aliyun-card__identity {
	min-width: 0;
	gap: 1rem;
}

.aliyun-card__logo {
	width: 3.8rem;
	height: 3.8rem;
	flex-shrink: 0;
	border-radius: 1rem;
}

.aliyun-card__remark {
	overflow: hidden;
	font-size: 1.5rem;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.aliyun-card__key {
	margin-top: 0.3rem;
	color: var(--el-text-color-secondary);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 1.15rem;
}

.aliyun-card__more {
	width: 3rem;
	height: 3rem;
	padding: 0;
}

.aliyun-balance {
	display: flex;
	align-items: baseline;
	justify-content: space-between;
	padding-bottom: 1.6rem;
	border-bottom: 1px solid var(--el-border-color-lighter);

	span {
		color: var(--el-text-color-secondary);
		font-size: 1.25rem;
	}

	strong {
		color: #ff6a00;
		font-size: 2rem;
		font-weight: 650;
	}
}

.aliyun-resource-list {
	padding: 1.6rem 0;
}

.aliyun-resource {
	flex: 1;
	text-align: center;

	& + & {
		border-left: 1px solid var(--el-border-color-lighter);
	}
}

.aliyun-resource__value {
	font-size: 2rem;
	font-weight: 650;
}

.aliyun-resource__unit {
	margin-left: 0.4rem;
	color: var(--el-text-color-secondary);
	font-size: 1.2rem;
}

.aliyun-card__footer {
	justify-content: space-between;
	padding-top: 1.2rem;
	border-top: 1px solid var(--el-border-color-lighter);
	color: var(--el-text-color-placeholder);
	font-size: 1.15rem;
}

.aliyun-group-add {
	gap: 0.8rem;
	margin-bottom: 1.6rem;
}

.aliyun-group-list {
	max-height: 30rem;
	overflow: auto;
	border-top: 1px solid var(--el-border-color-lighter);
}

.aliyun-group-item {
	justify-content: space-between;
	min-height: 5.2rem;
	border-bottom: 1px solid var(--el-border-color-lighter);
}

.aliyun-group-item__count {
	margin-left: 0.6rem;
	padding: 0.1rem 0.6rem;
	border-radius: 999px;
	color: var(--el-text-color-secondary);
	font-size: 1.1rem;
	background: var(--el-fill-color-light);
}

.aliyun-group-item__fixed {
	color: var(--el-text-color-placeholder);
	font-size: 1.2rem;
}

@media (max-width: 1200px) {
	.aliyun-header {
		align-items: flex-start;
		flex-direction: column;
	}

	.aliyun-toolbar {
		width: 100%;
		justify-content: flex-start;
		flex-wrap: wrap;
	}
}
</style>
