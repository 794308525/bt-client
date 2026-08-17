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
				<el-button :icon="Refresh" :loading="refreshingAll" @click="refreshAllAccounts">
					{{ pub.lang('刷新全部') }}
				</el-button>
				<el-button type="primary" size="large" :icon="Plus" @click="openAccountDialog()">
					{{ pub.lang('添加账号') }}
				</el-button>
			</div>

			<div class="aliyun-toolbar">
				<div class="aliyun-control">
					<span class="aliyun-control__label">{{ pub.lang('分组') }}</span>
					<div ref="groupSegmentRef" class="aliyun-segmented">
						<el-radio-group v-model="currentGroup" class="aliyun-segmented__group">
							<span class="aliyun-segmented__indicator" :style="groupIndicatorStyle" />
							<el-radio-button
								v-for="group in groupList"
								:key="group.group_id"
								:value="group.group_id">
								{{ group.group_name }}
								<span class="aliyun-segmented__count">{{ group.account_count || 0 }}</span>
							</el-radio-button>
						</el-radio-group>
						<el-tooltip :content="pub.lang('管理分组')" :enterable="false" placement="bottom">
							<el-button text :icon="Setting" class="aliyun-segmented__tool" @click="groupDialogVisible = true" />
						</el-tooltip>
					</div>
				</div>
				<el-divider direction="vertical" />
				<div class="aliyun-control">
					<span class="aliyun-control__label">{{ pub.lang('排序') }}</span>
					<div ref="sortSegmentRef" class="aliyun-segmented">
						<el-radio-group v-model="sortMode" class="aliyun-segmented__group">
							<span class="aliyun-segmented__indicator" :style="sortIndicatorStyle" />
							<el-radio-button
								v-for="option in sortOptions"
								:key="option.value"
								:value="option.value">
								{{ option.label }}
							</el-radio-button>
						</el-radio-group>
					</div>
				</div>
				<el-divider direction="vertical" />
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
				:data-account-id="account.account_id"
				class="aliyun-card"
				:class="{ 'aliyun-card--dragging': draggedAccountId === account.account_id }"
				@dragover.prevent="queueAccountMove(account.account_id, $event)"
				@drop.stop.prevent="finishAccountDrag"
				@click="openAccountDetail(account)"
				shadow="hover">
				<template #header>
					<div class="aliyun-card__header">
						<div class="aliyun-card__identity">
							<span
								class="aliyun-card__drag-handle"
								:class="{ 'aliyun-card__drag-handle--disabled': !canDragSort }"
								:draggable="canDragSort"
								:title="dragHandleTitle"
								@click.stop
								@dragstart.stop="startAccountDrag(account.account_id, $event)"
								@dragend.stop="finishAccountDrag">
								<bt-icon name="sort" size="16" color="#939393" />
							</span>
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
							<el-button text :icon="MoreFilled" :loading="refreshingAccounts.has(account.account_id)" class="aliyun-card__more" @click.stop />
							<template #dropdown>
								<el-dropdown-menu>
									<el-dropdown-item command="edit">{{ pub.lang('编辑') }}</el-dropdown-item>
									<el-dropdown-item command="remove" divided>{{ pub.lang('删除') }}</el-dropdown-item>
								</el-dropdown-menu>
							</template>
						</el-dropdown>
					</div>
				</template>

				<div class="aliyun-balance">
					<strong>{{ formatBalance(account.balance) }}</strong>
					<span>
						{{ pub.lang('余额') }}
						<el-button
							text
							circle
							:icon="Refresh"
							:loading="refreshingAccounts.has(account.account_id)"
							class="aliyun-balance__refresh"
							:title="pub.lang('刷新')"
							@click.stop="refreshAccount(account, true)" />
						<small>{{ formatRefreshTime(account.resource_refresh_time) }}</small>
						<em v-if="resourceStatusText(account, 'balance')">{{ resourceStatusText(account, 'balance') }}</em>
					</span>
				</div>
				<div class="aliyun-resource-list">
					<div class="aliyun-resource">
						<span class="aliyun-resource__unit">{{ pub.lang('服务器') }}</span>
						<span class="aliyun-resource__value" :class="{ 'aliyun-resource__value--status': resourceStatusText(account, 'server') }">{{ resourceStatusText(account, 'server') || formatCount(account.server_count) }}</span>
					</div>
					<div class="aliyun-resource">
						<span class="aliyun-resource__unit">{{ pub.lang('域名') }}</span>
						<span class="aliyun-resource__value" :class="{ 'aliyun-resource__value--status': resourceStatusText(account, 'domain') }">{{ resourceStatusText(account, 'domain') || formatCount(account.domain_count) }}</span>
					</div>
					<div class="aliyun-resource">
						<span class="aliyun-resource__unit">ESA</span>
						<span class="aliyun-resource__value" :class="{ 'aliyun-resource__value--status': resourceStatusText(account, 'esa') }">{{ resourceStatusText(account, 'esa') || formatCount(account.esa_count) }}</span>
					</div>
					<div class="aliyun-resource">
						<span class="aliyun-resource__unit">CDN</span>
						<span class="aliyun-resource__value" :class="{ 'aliyun-resource__value--status': resourceStatusText(account, 'cdn') }">{{ resourceStatusText(account, 'cdn') || formatCount(account.cdn_count) }}</span>
					</div>
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
					<el-input
						v-model="accountForm.access_key_id"
						type="password"
						show-password
						autocomplete="off"
						placeholder="LTAI..." />
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
import { MoreFilled, Plus, Refresh, Search, Setting } from '@element-plus/icons-vue'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { common, ipc, routes } from '@api/http'
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
	esa_count: number
	cdn_count: number
	cdn_status: 'active' | 'not_opened' | 'unknown'
	sort: number
	addtime: number
	update_time: number
	balance_currency: string
	resource_refresh_time: number
	resource_error: string
	resource_status: ResourceStatus
}

type ResourceStatusKey = 'balance' | 'server' | 'domain' | 'esa' | 'cdn' | 'oss'
type ResourceStatus = Partial<Record<ResourceStatusKey, string>>

type SortMode = 'default' | 'latest' | 'earliest'

defineOptions({ name: 'Aliyun' })

const Message = useMessage()
const router = useRouter()
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
const groupSegmentRef = ref<HTMLElement | null>(null)
const sortSegmentRef = ref<HTMLElement | null>(null)
const groupIndicatorStyle = ref<Record<string, string>>({ opacity: '0', width: '0px' })
const sortIndicatorStyle = ref<Record<string, string>>({ opacity: '0', width: '0px' })

const updateSegmentIndicator = async (
	segmentRef: typeof groupSegmentRef,
	indicatorStyle: typeof groupIndicatorStyle
) => {
	await nextTick()
	const group = segmentRef.value?.querySelector<HTMLElement>('.aliyun-segmented__group')
	const activeItem = group?.querySelector<HTMLElement>('.el-radio-button.is-active')
	if (!activeItem) {
		indicatorStyle.value = { opacity: '0', width: '0px' }
		return
	}
	indicatorStyle.value = {
		opacity: '1',
		width: `${activeItem.offsetWidth}px`,
		transform: `translate3d(${activeItem.offsetLeft}px, 0, 0)`,
	}
}

watch([currentGroup, groupList], () => updateSegmentIndicator(groupSegmentRef, groupIndicatorStyle), { flush: 'post' })
watch(sortMode, () => updateSegmentIndicator(sortSegmentRef, sortIndicatorStyle), { flush: 'post' })

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
const refreshingAccounts = reactive(new Set<number>())
const refreshingAll = ref(false)
const draggedAccountId = ref<number | null>(null)
let dragOrderChanged = false
let dragMoveFrame: number | null = null
let pendingDragMove: {
	targetId: number
	clientX: number
	clientY: number
	targetElement: HTMLElement
} | null = null
let lastAccountMove = { from: -1, to: -1, time: 0 }
let dragAnimations: Animation[] = []

const accountGroupOptions = computed(() => groupList.value.filter(group => group.group_id !== -1))
const canDragSort = computed(
	() => sortMode.value === 'default' && searchKeyword.value.trim() === ''
)
const dragHandleTitle = computed(() => {
	if (sortMode.value !== 'default') return pub.lang('切换到默认排序后可拖动')
	if (searchKeyword.value.trim()) return pub.lang('清空搜索后可拖动')
	return pub.lang('拖动排序')
})
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
	return common.sendAsync({ route, data, timeout: 120000 }) as Promise<any>
}

const getAccountList = async () => {
	const result = await request(routes.aliyun.list.path)
	if (!result?.status) return Message.request(result)
	accountList.value = result.data.data || []
	groupList.value = result.data.groups || []
	if (!groupList.value.some(group => group.group_id === currentGroup.value)) currentGroup.value = -1
	const now = Math.floor(Date.now() / 1000)
	accountList.value
		.filter(account => !account.resource_refresh_time || now - account.resource_refresh_time >= 300)
		.forEach(account => refreshAccount(account, false))
}

const openAccountDetail = (account: AliyunAccount) => router.push(`/aliyun/${account.account_id}`)

const getVisibleAccountRects = () => {
	const positions = new Map<string, DOMRect>()
	document.querySelectorAll<HTMLElement>('.aliyun-grid > .aliyun-card').forEach(card => {
		positions.set(card.dataset.accountId || '', card.getBoundingClientRect())
	})
	return positions
}

const animateAccountDrag = async (previousPositions: Map<string, DOMRect>) => {
	await nextTick()
	dragAnimations.forEach(animation => animation.cancel())
	dragAnimations = []
	document.querySelectorAll<HTMLElement>('.aliyun-grid > .aliyun-card').forEach(card => {
		const previousRect = previousPositions.get(card.dataset.accountId || '')
		if (!previousRect) return
		const currentRect = card.getBoundingClientRect()
		const offsetX = previousRect.left - currentRect.left
		const offsetY = previousRect.top - currentRect.top
		if (!offsetX && !offsetY) return
		dragAnimations.push(
			card.animate(
				[
					{ transform: `translate3d(${offsetX}px, ${offsetY}px, 0)` },
					{ transform: 'translate3d(0, 0, 0)' },
				],
				{ duration: 160, easing: 'cubic-bezier(0.2, 0, 0, 1)' }
			)
		)
	})
}

const startAccountDrag = (accountId: number, event: DragEvent) => {
	if (!canDragSort.value) {
		event.preventDefault()
		return
	}
	draggedAccountId.value = accountId
	dragOrderChanged = false
	if (!event.dataTransfer) return
	event.dataTransfer.effectAllowed = 'move'
	event.dataTransfer.setData('text/plain', String(accountId))
	const card = (event.currentTarget as HTMLElement).closest('.aliyun-card') as HTMLElement | null
	if (!card) return
	const rect = card.getBoundingClientRect()
	event.dataTransfer.setDragImage(
		card,
		Math.max(0, event.clientX - rect.left),
		Math.max(0, event.clientY - rect.top)
	)
}

const queueAccountMove = (targetId: number, event: DragEvent) => {
	if (!canDragSort.value || draggedAccountId.value === null) return
	pendingDragMove = {
		targetId,
		clientX: event.clientX,
		clientY: event.clientY,
		targetElement: event.currentTarget as HTMLElement,
	}
	if (dragMoveFrame !== null) return
	dragMoveFrame = requestAnimationFrame(() => {
		const move = pendingDragMove
		dragMoveFrame = null
		pendingDragMove = null
		if (move) moveAccount(move)
	})
}

const moveAccount = ({ targetId, clientX, clientY, targetElement }: NonNullable<typeof pendingDragMove>) => {
	if (!canDragSort.value || draggedAccountId.value === null || targetId === draggedAccountId.value) return
	const visibleAccounts = filteredAccounts.value
	const currentIndex = visibleAccounts.findIndex(item => item.account_id === draggedAccountId.value)
	const targetIndex = visibleAccounts.findIndex(item => item.account_id === targetId)
	if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return

	const now = performance.now()
	if (
		now - lastAccountMove.time < 180 &&
		currentIndex === lastAccountMove.to &&
		targetIndex === lastAccountMove.from
	) return

	const targetRect = targetElement.getBoundingClientRect()
	const draggedElement = document.querySelector('.aliyun-card--dragging') as HTMLElement | null
	const draggedRect = draggedElement?.getBoundingClientRect()
	const isSameRow = draggedRect
		? Math.abs(targetRect.top - draggedRect.top) < Math.min(targetRect.height, draggedRect.height) / 2
		: true
	const pointerPosition = isSameRow ? clientX : clientY
	const targetMiddle = isSameRow
		? targetRect.left + targetRect.width / 2
		: targetRect.top + targetRect.height / 2
	const isMovingForward = currentIndex < targetIndex
	if (
		(isMovingForward && pointerPosition < targetMiddle) ||
		(!isMovingForward && pointerPosition > targetMiddle)
	) return

	const previousPositions = getVisibleAccountRects()
	const reorderedAccounts = [...visibleAccounts]
	const [draggedAccount] = reorderedAccounts.splice(currentIndex, 1)
	reorderedAccounts.splice(targetIndex, 0, draggedAccount)
	const visibleIds = new Set(reorderedAccounts.map(item => item.account_id))
	let reorderedIndex = 0
	accountList.value = accountList.value.map(account =>
		visibleIds.has(account.account_id) ? reorderedAccounts[reorderedIndex++] : account
	)
	void animateAccountDrag(previousPositions)
	dragOrderChanged = true
	lastAccountMove = { from: currentIndex, to: targetIndex, time: now }
}

const finishAccountDrag = async () => {
	const finalMove = pendingDragMove
	if (dragMoveFrame !== null) {
		cancelAnimationFrame(dragMoveFrame)
		dragMoveFrame = null
	}
	pendingDragMove = null
	if (finalMove) moveAccount(finalMove)
	const shouldSave = dragOrderChanged
	dragOrderChanged = false
	lastAccountMove = { from: -1, to: -1, time: 0 }
	draggedAccountId.value = null
	if (shouldSave) {
		const result = await request(routes.aliyun.set_sort.path, {
			account_ids: accountList.value.map(account => account.account_id),
		})
		if (!result?.status) Message.request(result)
	}
}

const refreshAccount = async (account: AliyunAccount, force: boolean) => {
	if (refreshingAccounts.has(account.account_id)) return
	refreshingAccounts.add(account.account_id)
	try {
		const result = await request(routes.aliyun.refresh_account_summary.path, {
			account_id: account.account_id,
			force,
		})
		if (!result?.status) {
			if (force) Message.request(result)
			return
		}
		const index = accountList.value.findIndex(item => item.account_id === account.account_id)
		if (index !== -1) accountList.value[index] = result.data
	} finally {
		refreshingAccounts.delete(account.account_id)
	}
}

const refreshAllAccounts = async () => {
	if (refreshingAll.value) return
	refreshingAll.value = true
	try {
		await Promise.all(accountList.value.map(account => refreshAccount(account, true)))
	} finally {
		refreshingAll.value = false
	}
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
	if (command === 'refresh') refreshAccount(account, true)
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

const formatRefreshTime = (time: number) => {
	if (!time) return pub.lang('资源数据待获取')
	const seconds = Math.max(0, Math.floor(Date.now() / 1000) - time)
	if (seconds < 60) return pub.lang('刚刚更新')
	if (seconds < 3600) return pub.lang('{} 分钟前', Math.floor(seconds / 60))
	if (seconds < 86400) return pub.lang('{} 小时前', Math.floor(seconds / 3600))
	return pub.lang('{} 天前', Math.floor(seconds / 86400))
}

const formatCount = (count: number) => (Number(count) >= 0 ? Number(count) : '--')
const resourceStatusText = (account: AliyunAccount, key: ResourceStatusKey) => {
	const currentStatus = account.resource_status?.[key]
	const status = key === 'cdn' && (!currentStatus || currentStatus === 'unknown') ? account.cdn_status : currentStatus
	return ({
		not_opened: pub.lang('未开通'),
		disabled: pub.lang('已停用'),
		overdue: pub.lang('已欠费'),
		permission_denied: pub.lang('无权限'),
		invalid_credentials: pub.lang('密钥无效'),
		rate_limited: pub.lang('已限流'),
		quota_exceeded: pub.lang('配额不足'),
		unavailable: pub.lang('服务异常'),
		partial: pub.lang('部分获取'),
		timeout: pub.lang('超时'),
		network: pub.lang('网络异常'),
		error: pub.lang('获取失败'),
	} as Record<string, string>)[String(status || '')] || ''
}
const refreshCurrentPage = () => refreshAllAccounts()
const handleRefreshShortcut = (event: KeyboardEvent) => {
	if (
		event.key.toLowerCase() !== 'r' ||
		(!event.ctrlKey && !event.metaKey) ||
		event.altKey ||
		event.shiftKey
	) return
	event.preventDefault()
	event.stopPropagation()
	refreshCurrentPage()
}
const handleIpcRefresh = () => refreshCurrentPage()

onMounted(() => {
	window.addEventListener('keydown', handleRefreshShortcut, true)
	ipc.on('aliyun-refresh', handleIpcRefresh)
	getAccountList()
	updateSegmentIndicator(groupSegmentRef, groupIndicatorStyle)
	updateSegmentIndicator(sortSegmentRef, sortIndicatorStyle)
})
onBeforeUnmount(() => {
	window.removeEventListener('keydown', handleRefreshShortcut, true)
	ipc.removeListener('aliyun-refresh', handleIpcRefresh)
	if (dragMoveFrame !== null) cancelAnimationFrame(dragMoveFrame)
	dragAnimations.forEach(animation => animation.cancel())
})
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
	gap: 0.4rem;
	min-width: 0;
}

.aliyun-control {
	gap: 0.8rem;
}

.aliyun-control__label {
	font-size: 1.3rem;
	font-weight: 600;
	white-space: nowrap;
}

.aliyun-segmented {
	display: flex;
	align-items: center;
	box-sizing: border-box;
	height: 3.4rem;
	padding: 0.3rem;
	border: 1px solid var(--el-border-color);
	border-radius: 999px;
	background: transparent;

	.aliyun-segmented__group {
		position: relative;
		display: flex;
		height: 2.6rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: transparent;
		gap: 0.2rem;
	}

	.aliyun-segmented__indicator {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 0;
		height: 2.6rem;
		border-radius: 999px;
		background-color: #ff6a00;
		box-shadow: 0 2px 5px rgba(204, 74, 0, 0.28);
		pointer-events: none;
		transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1),
			width 0.18s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.12s ease;
	}

	:deep(.el-radio-button) {
		z-index: 1;
	}

	:deep(.el-radio-button__inner) {
		height: 2.6rem;
		padding: 0 1.1rem;
		border: 0 !important;
		outline: 0 !important;
		border-radius: 999px !important;
		color: var(--el-text-color-regular);
		line-height: 2.6rem;
		background: transparent;
		box-shadow: none !important;
		transition: color 0.15s ease;
	}

	:deep(.el-radio-button__inner:hover) {
		color: #ff6a00;
		background: transparent;
	}

	:deep(.el-radio-button.is-active .el-radio-button__inner) {
		color: #fff !important;
		font-weight: 600;
		background: transparent !important;
		box-shadow: none !important;
	}
}

.aliyun-segmented__count {
	margin-left: 0.35rem;
	font-size: 1.1rem;
	opacity: 0.7;
}

.aliyun-segmented__tool {
	width: 2.6rem;
	height: 2.6rem;
	margin-left: 0.2rem;
	padding: 0;
	border: 0;
	border-radius: 50%;
	color: var(--el-text-color-regular);

	&:hover {
		color: #ff6a00;
		background-color: var(--el-bg-color);
	}
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
	border-radius: 0.8rem;
	cursor: pointer;
	transition: border-color 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;

	&--dragging {
		opacity: 0.25;
	}

	:deep(.el-card__header) {
		padding: 1.25rem 1.5rem;
		border-bottom: 0;
	}

	:deep(.el-card__body) {
		padding: 0 1.5rem 1.25rem;
	}
}

.aliyun-card__header {
	width: 100%;
	justify-content: space-between;
	gap: 1rem;
}

.aliyun-card__identity {
	min-width: 0;
	flex: 1;
	gap: 1rem;
}

.aliyun-card__drag-handle {
	display: inline-flex;
	align-items: center;
	flex: 0 0 auto;
	cursor: grab;

	&:active {
		cursor: grabbing;
	}

	&--disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
}

.aliyun-card__logo {
	width: 3.4rem;
	height: 3.4rem;
	flex-shrink: 0;
	border-radius: 0.8rem;
}

.aliyun-card__remark {
	overflow: hidden;
	font-size: 1.45rem;
	font-weight: 600;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.aliyun-card__key {
	margin-top: 0.15rem;
	color: var(--el-text-color-secondary);
	font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	font-size: 1.15rem;
}

.aliyun-card__more {
	flex: 0 0 auto;
	width: 3rem;
	height: 3rem;
	padding: 0;
	border: 1px solid var(--el-border-color);
	border-radius: 0.5rem;
	background: transparent;
	color: var(--el-text-color-regular);
}

.aliyun-balance {
	display: flex;
	align-items: flex-start;
	padding: 0.8rem 0 1.1rem;
	flex-direction: column;

	span {
		margin-top: 0.15rem;
		color: var(--el-text-color-secondary);
		font-size: 1.25rem;
		white-space: nowrap;

		small {
			margin-left: 0.6rem;
			color: var(--el-text-color-placeholder);
			font-size: 1.1rem;
		}

		em {
			margin-left: 0.55rem;
			color: var(--el-color-warning);
			font-size: 1.1rem;
			font-style: normal;
		}
	}

	.aliyun-balance__refresh {
		width: 2.2rem;
		height: 2.2rem;
		margin-left: 0.15rem;
		padding: 0;
		vertical-align: middle;
	}

	strong {
		color: #ff6a00;
		font-size: 2.05rem;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
}

.aliyun-resource-list {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1rem 2.4rem;
	padding: 1.1rem 0;
	border-top: 1px solid var(--el-border-color-lighter);
}

.aliyun-resource {
	display: grid;
	grid-template-columns: 4.2rem minmax(0, 1fr);
	align-items: center;
	min-width: 0;
	column-gap: 0.8rem;

	.aliyun-resource__unit {
		margin: 0;
		font-size: 1.1rem;
	}

	.aliyun-resource__value {
		margin: 0;
		font-size: 1.65rem;
	}
}

.aliyun-resource__value {
	font-size: 2.1rem;
	font-weight: 650;
	font-variant-numeric: tabular-nums;
}

.aliyun-resource__value--status {
	color: var(--el-text-color-placeholder);
	font-size: 1.25rem !important;
	font-weight: 500;
}

.aliyun-resource__unit {
	margin-left: 0.4rem;
	color: var(--el-text-color-secondary);
	font-size: 1.2rem;
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
