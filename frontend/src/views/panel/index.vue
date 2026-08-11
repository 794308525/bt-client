<template>
	<div class="panel px-[3.6rem] pt-[2.4rem]">
		<template v-if="isShow">
			<div class="panel__header flex justify-between items-center mb-[2.4rem]">
				<div class="panel-primary-actions flex items-center flex-shrink-0">
					<div class="panel-brand flex items-center">
						<img :src="LogoGreen" class="panel-brand__logo" :alt="pub.lang('堡塔')" />
						<div class="panel-brand__content">
							<div class="panel-brand__name">{{ pub.lang('堡塔多机管理') }}</div>
							<a
								class="panel-brand__site"
								href="https://www.bt.cn"
								target="_blank"
								rel="noopener noreferrer">
								{{ pub.lang('官方网站') }}
								<el-icon><TopRight /></el-icon>
							</a>
						</div>
					</div>
					<el-button type="primary" size="large" @click="addPanel">{{
						pub.lang('添加面板')
					}}</el-button>
					<el-button text class="panel-secondary-action" @click="importPanel">{{ pub.lang('导入') }}</el-button>
					<el-button text class="panel-secondary-action" @click="exportPanel">{{ pub.lang('导出') }}</el-button>
				</div>
				<div class="panel-toolbar flex items-center min-w-0">
					<div class="panel-control flex items-center">
						<span class="panel-control__label">{{ pub.lang('分组') }}</span>
						<div ref="groupSegmentRef" class="panel-segmented flex items-center">
							<el-radio-group
								:model-value="currentGroupID"
								@input="switchGroup"
								class="panel-segmented__group">
								<span
									class="panel-segmented__indicator"
									:style="groupIndicatorStyle" />
								<el-radio-button
									v-for="item in groupList"
									:label="item.group_name"
									:value="item.group_id">
									<span>{{ item.group_name }}</span>
									<span v-if="showGroupCount" class="panel-segmented__count">
										{{ item.panel_count || 0 }}
									</span>
								</el-radio-button>
							</el-radio-group>
							<el-tooltip
								class="box-item"
								effect="dark"
								:content="pub.lang('管理分组')"
								:enterable="false"
								placement="bottom">
								<el-button
									text
									:icon="Setting"
									class="panel-segmented__tool"
									@click="groupManageVisible = true" />
							</el-tooltip>
						</div>
					</div>
					<el-divider direction="vertical"></el-divider>
					<div class="panel-control flex items-center flex-shrink-0">
						<span class="panel-control__label">{{ pub.lang('排序') }}</span>
						<div ref="sortSegmentRef" class="panel-segmented flex items-center">
							<el-radio-group
								v-model="sortMode"
								class="panel-segmented__group">
								<span
									class="panel-segmented__indicator"
									:style="sortIndicatorStyle" />
								<el-radio-button
									v-for="item in sortOptions"
									:key="item.value"
									:label="item.label"
									:value="item.value" />
							</el-radio-group>
						</div>
					</div>
					<el-divider direction="vertical"></el-divider>
					<el-switch
						v-model="isShowIP"
						inline-prompt
						:active-text="pub.lang('隐藏IP')"
						:inactive-text="pub.lang('显示IP')"
						:active-action-icon="Hide"
						:inactive-action-icon="View"
						@change="isShowIP = !!isShowIP" />
					<el-divider direction="vertical"></el-divider>
					<el-tooltip :content="pub.lang('刷新')" :enterable="false" placement="bottom">
						<el-button
							text
							:icon="Refresh"
							class="panel-tool-icon mr-[.4rem]"
							@click="getPanelList()" />
					</el-tooltip>
					<div :class="['panel-search', { 'panel-search--active': isActive }]">
						<el-icon :size="24" class="mr-[1.6rem]">
							<svg width="24" height="24" viewBox="0 0 24 24" focusable="false" class="NMm5M">
								<path
									d="M20.49 19l-5.73-5.73C15.53 12.2 16 10.91 16 9.5A6.5 6.5 0 1 0 9.5 16c1.41 0 2.7-.47 3.77-1.24L19 20.49 20.49 19zM5 9.5C5 7.01 7.01 5 9.5 5S14 7.01 14 9.5 11.99 14 9.5 14 5 11.99 5 9.5z"></path>
							</svg>
						</el-icon>
						<el-input
							v-model="searchServic"
							:placeholder="pub.lang('搜索服务器IP/名称')"
							@keydown.enter="getPanelList()"
							@focus="isActive = true"
							@blur="isActive = false" />
					</div>
				</div>
			</div>
			<div class="panel__content">
				<el-scrollbar :height="mainHeight - 100">
					<el-row class="cardList w-full" :gutter="10">
						<TransitionGroup name="panel-card">
						<el-col
							v-for="(item, index) in showListArray"
							:key="item.panel_id"
							v-memo="[item.panel_id, item.panelInfo.isError, item.device_status, item.current_disk, draggedPanelID]"
							:xs="24"
							:sm="12"
							:md="8"
							:lg="6"
							:xl="4"
							class="mb-[1rem] panel-card-col"
							:class="{
								'panel-card-col--dragging': draggedPanelID === item.panel_id,
							}"
							@dragover.prevent="queuePanelMove(item.panel_id, $event)"
							@drop.stop.prevent="finishPanelDrag"
							@click="openPanelView(item, $event)">
							<el-card
								class="card-panel-item "
								:class="{
									isError: item.panelInfo.isError && item.device_status !== 'online',
									isWarning: item.panelInfo.isError && item.device_status === 'online',
									isNoOpen: !item.is_open,
								}">
								<template #header>
									<!-- <div class="card-panel-header flex justify-between items-center w-full"> -->
									<div class="flex flex-1 items-center min-w-0 pl-[.75rem] py-[.75rem]">
										<span
											class="panel-drag-handle mr-2 flex-shrink-0"
											:class="{ 'panel-drag-handle--disabled': !canDragSort }"
											:draggable="canDragSort"
											:title="dragHandleTitle"
											@click.stop
											@dragstart.stop="startPanelDrag(index, $event)"
											@dragend.stop="finishPanelDrag">
											<bt-icon name="sort" size="16" color="#939393" />
										</span>
										<div class="flex flex-1 flex-col min-w-0">
											<template v-if="isShowIP">
												<div class="flex items-center">
													<span class="truncate max-w-[200px]">{{ item.title }}</span>
													<span
														class="ml-2 text-[.8rem] py-[.2rem] px-[.4rem] rounded-[4px] flex-shrink-0"
														:class="[authType[item.ov].text, authType[item.ov].bg]"
														>{{ authType[item.ov].name }}</span
													>
												</div>
												<div class="text-[.9rem] text-gray-500 tracking-1px">
													[{{ getUrlLink(item.url) }}]
												</div>
											</template>
											<template v-else>
												<!-- 兼容标题是IP的情况 -->
												<span v-show="!checkIp(item.title)" class="truncate max-w-[200px]">{{ item.title }}</span>
											</template>
										</div>
									</div>
									<span
										class="panel-device-status flex-shrink-0"
										:class="`panel-device-status--${getDeviceStatusClass(item)}`">
										<i></i>{{ getDeviceStatusText(item) }}
									</span>
									<el-dropdown class="align-right cursor-pointer" trigger="click">
										<el-button :icon="Setting" size="small" class="card-btn-style text-primary" />
										<template #dropdown>
											<el-dropdown-menu>
												<el-dropdown-item
													v-if="item.is_open"
													:disabled="item.panelInfo.isError"
													@click="openPanelView(item)"
													>{{ pub.lang('打开') }}</el-dropdown-item
												>
												<el-dropdown-item @click="editPanelInfo(item)">{{
													pub.lang('编辑')
												}}</el-dropdown-item>
												<el-dropdown-item @click="removePanel(item)">{{
													pub.lang('删除')
												}}</el-dropdown-item>
											</el-dropdown-menu>
										</template>
									</el-dropdown>
									<!-- </div> -->
								</template>
								<template v-if="!item.panelInfo.isError">
									<div class="card-content">
										<div class="rows">
											<span class="label">{{ pub.lang('负载') }}：</span>
											<span class="value">{{ createLoadInfo(item.panelInfo.load) }}</span>
										</div>
										<div class="rows">
											<span class="label">{{ pub.lang('网络') }}：</span>
											<span class="value">
												<span class="mr-4">
													<el-icon color="#F7B851" :size="14"><Top /></el-icon>
													{{ getByteUnit(item.panelInfo.up) }}
												</span>
												<span>
													<el-icon color="#52A9FF" :size="14"><Bottom /></el-icon>
													{{ getByteUnit(item.panelInfo.down) }}
												</span>
											</span>
										</div>
										<div class="rows">
											<span class="label">CPU：</span>
											<span class="value"
												>{{ pub.lang('{}核', item.panelInfo.cpu[1]) }} ({{
													item.panelInfo.cpu[0]
												}}%)</span
											>
											<el-progress
												:percentage="Number(item.panelInfo.cpu[0])"
												:show-text="false"
												status="success" />
										</div>
										<div class="rows">
											<span class="label">{{ pub.lang('内存') }}：</span>
											<span class="value"
												>{{ item.panelInfo.mem.memRealUsed }} / {{ item.panelInfo.mem.memTotal }}MB
												({{ createMemoryInfo(item.panelInfo.mem) }}%)</span
											>
											<el-progress
												:percentage="createMemoryInfo(item.panelInfo.mem)"
												:show-text="false"
												status="success" />
										</div>
									</div>
									<div class="rows">
										<span class="label">
											<div class="flex">
												<span>{{ pub.lang('磁盘') }}：</span>
												<el-select
													v-model="item.current_disk"
													size="small"
													class="flex-1 disk-card-select"
													@click.native.stop
													@change="onChangeDiskPath($event, item)"
													placeholder=" ">
													<el-option
														v-for="(items, index) in item.panelInfo.disk"
														:key="index"
														:label="diskTitle(items)"
														:value="items.path"
														class="disk-card-option" />
												</el-select>
											</div>
										</span>
										<span class="value">
											<el-progress
												:percentage="diskProgress(item, item.current_disk)"
												:show-text="false"
												status="success" />
										</span>
									</div>
								</template>
								<template v-else>
									<div class="h-[14rem]">
										<span
											v-if="item.panelInfo.isError"
											:class="item.device_status === 'online' ? 'text-amber-500' : 'text-red-500'"
											>[{{ getDeviceStatusText(item) }}] {{ item.panelInfo.errorMsg }}</span
										>
									</div>
								</template>
							</el-card>
						</el-col>
						</TransitionGroup>
					</el-row>
				</el-scrollbar>
			</div>
		</template>
		<template v-else>
			<div class="welcome flex flex-col items-center justify-center" :style="{ height: '600px' }">
				<el-image :src="White" class="w-[20rem] h-[20rem]" />
				<span class="text-[1.6rem] my-4">{{ pub.lang('欢迎来到面板管理系统') }}</span>
				<div>
					<el-button type="primary" @click="addPanel">{{ pub.lang('点击添加面板') }}</el-button>
					<el-button @click="importPanel">{{ pub.lang('导入文件') }}</el-button>
				</div>
			</div>
		</template>

		<!-- 添加、编辑面板 -->
		<addPanelDialog @refresh="getPanelList" />
		<!-- 分组管理 -->
		<groupManageDialog @refresh="getPanelList" />
		<!-- 创建、编辑分组-->
		<AddGroup @refresh="getPanelList" />
		<!-- 安装并绑定-进度 -->
		<installLog @refresh="getPanelList" />
		<!-- 安装并绑定-结果 -->
		<installResults />
	</div>
</template>

<script setup lang="ts">
defineOptions({
	name: 'Home',
})
import { usePanelBase } from '@store/panel'
import { Setting, Refresh, Hide, View, TopRight } from '@element-plus/icons-vue'
import { useSettingStore } from '@store/setting'
import { ElMessageBox } from 'element-plus'
import { useMessage } from '@utils/hooks/message'
import { useRouter } from 'vue-router'
import addPanelDialog from './components/AddPanel/index.vue'
import groupManageDialog from './components/GroupManage/index.vue'
import installLog from './components/AddPanel/installLog.vue'
import installResults from './components/AddPanel/installResults.vue'
import AddGroup from '@views/panel/components/AddGroup/index.vue'
import White from '@/assets/images/logo-white.svg'
import LogoGreen from '@/assets/images/logo-green.svg'
import { pub, getByteUnit } from '@utils/tools'
import { record_disk, set_panel_sort, type Panel_Params } from './controller'
import { checkIp } from '@utils/is'

import { common, routes, ipc } from '@api/http'

const router = useRouter()
const Message = useMessage() // 消息提示

const useStore = useSettingStore()
const { mainHeight } = storeToRefs(useStore)

const {
	isShowIP,
	showGroupCount,
	groupList,
	groupManageVisible,
	currentGroupID,
	addPanelVisible,
	isEdit,
	panelParams,
} = storeToRefs(usePanelBase())

const isActive = ref(false)
const searchServic = ref('')
const firstLoad = ref(true)
const allPanelList = ref([]) as any
const sortMode = ref<'default' | 'latest' | 'earliest'>('default')
const sortOptions = [
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
	const group = segmentRef.value?.querySelector<HTMLElement>('.panel-segmented__group')
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

watch(
	[currentGroupID, groupList, showGroupCount],
	() => updateSegmentIndicator(groupSegmentRef, groupIndicatorStyle),
	{ flush: 'post' }
)
watch(sortMode, () => updateSegmentIndicator(sortSegmentRef, sortIndicatorStyle), { flush: 'post' })
const draggedPanelID = ref<number | null>(null)
let dragOrderChanged = false
let dragMoveFrame: number | null = null
let pendingDragMove: {
	targetID: number
	clientX: number
	clientY: number
	targetElement: HTMLElement
} | null = null
let lastPanelMove = { from: -1, to: -1, time: 0 }

const authType = [
	{ name: pub.lang('免费版'), bg: 'bg-[#e7e7e7]', text: 'text-[#909399]' },
	{ name: pub.lang('专业版'), bg: 'bg-[#fbe239]', text: 'text-[#b68115]' },
	{ name: pub.lang('企业版'), bg: 'bg-[#474745]', text: 'text-[#d1ad68]' },
	{ name: pub.lang('获取中'), bg: 'bg-[#e7e7e7]', text: 'text-[#909399]' },
]
const diskTitle = computed(() => (item: any) => {
	return `[${item.path}] ${item.size[1]} / ${item.size[0]} (${item.size[3]})`
})
const diskProgress = (item: any, path: string) => {
	if (item.isError || typeof item.panelInfo.disk === 'undefined') return 0
	let diskSize = item.panelInfo.disk.find((items: any) => items.path === path)
	if (typeof diskSize === 'undefined') return 0
	return Number(diskSize.size[3].replace('%', ''))
}

const getDeviceStatusText = (item: any) => {
	if (item.device_status === 'online') {
		return item.panelInfo.isError ? pub.lang('设备在线 / 面板异常') : pub.lang('在线')
	}
	if (item.device_status === 'offline') return pub.lang('设备不可达')
	return item.panelInfo.isError ? pub.lang('连接异常') : pub.lang('检测中')
}
const getDeviceStatusClass = (item: any) => {
	if (item.device_status === 'online' && item.panelInfo.isError) return 'warning'
	return item.device_status || 'unknown'
}

const isShow = computed(() => {
	let status = true
	if (allPanelList.value.length > 0 || searchServic.value !== '') {
		status = true
	} else if (allPanelList.value.length === 0 && currentGroupID.value === -1 && isRquest.value) {
		status = false
	}
	return status
})

const canDragSort = computed(() => sortMode.value === 'default' && searchServic.value === '')
const dragHandleTitle = computed(() => {
	if (sortMode.value !== 'default') return pub.lang('切换到默认排序后可拖动')
	if (searchServic.value !== '') return pub.lang('清空搜索后可拖动')
	return pub.lang('拖动排序')
})

// Computed property for showListArray
const showListArray = computed(() => {
	let list = allPanelList.value
	if (searchServic.value !== '') {
		list = allPanelList.value.filter(
			(item: any) =>
				item.title.includes(searchServic.value) || item.url.includes(searchServic.value)
		)
	}
	if (sortMode.value === 'latest') {
		return [...list].sort((a: any, b: any) => Number(b.addtime) - Number(a.addtime))
	}
	if (sortMode.value === 'earliest') {
		return [...list].sort((a: any, b: any) => Number(a.addtime) - Number(b.addtime))
	}
	return list
})

const startPanelDrag = (index: number, event: DragEvent) => {
	if (!canDragSort.value) {
		event.preventDefault()
		return
	}
	draggedPanelID.value = showListArray.value[index].panel_id
	dragOrderChanged = false
	if (event.dataTransfer) {
		event.dataTransfer.effectAllowed = 'move'
		event.dataTransfer.setData('text/plain', String(draggedPanelID.value))
		const handle = event.currentTarget as HTMLElement
		const card = handle.closest('.panel-card-col') as HTMLElement | null
		if (card) {
			const rect = card.getBoundingClientRect()
			event.dataTransfer.setDragImage(
				card,
				Math.max(0, event.clientX - rect.left),
				Math.max(0, event.clientY - rect.top)
			)
		}
	}
}

const queuePanelMove = (targetID: number, event: DragEvent) => {
	if (!canDragSort.value || draggedPanelID.value === null) return
	pendingDragMove = {
		targetID,
		clientX: event.clientX,
		clientY: event.clientY,
		targetElement: event.currentTarget as HTMLElement,
	}
	if (dragMoveFrame !== null) return
	dragMoveFrame = requestAnimationFrame(() => {
		const move = pendingDragMove
		dragMoveFrame = null
		pendingDragMove = null
		if (move) movePanel(move)
	})
}

const movePanel = ({ targetID, clientX, clientY, targetElement }: NonNullable<typeof pendingDragMove>) => {
	if (!canDragSort.value || draggedPanelID.value === null || targetID === draggedPanelID.value) return
	const currentIndex = allPanelList.value.findIndex(
		(item: any) => item.panel_id === draggedPanelID.value
	)
	const targetIndex = allPanelList.value.findIndex((item: any) => item.panel_id === targetID)
	if (currentIndex < 0 || targetIndex < 0 || currentIndex === targetIndex) return

	const now = performance.now()
	if (
		now - lastPanelMove.time < 180 &&
		currentIndex === lastPanelMove.to &&
		targetIndex === lastPanelMove.from
	) {
		return
	}

	const targetRect = targetElement.getBoundingClientRect()
	const draggedElement = document.querySelector('.panel-card-col--dragging') as HTMLElement | null
	const draggedRect = draggedElement?.getBoundingClientRect()
	const isSameRow = draggedRect
		? Math.abs(targetRect.top - draggedRect.top) < Math.min(targetRect.height, draggedRect.height) / 2
		: true
	const pointerPosition = isSameRow ? clientX : clientY
	const targetMiddle = isSameRow
		? targetRect.left + targetRect.width / 2
		: targetRect.top + targetRect.height / 2
	const isMovingForward = currentIndex < targetIndex

	if ((isMovingForward && pointerPosition < targetMiddle) || (!isMovingForward && pointerPosition > targetMiddle)) {
		return
	}

	const [draggedPanel] = allPanelList.value.splice(currentIndex, 1)
	allPanelList.value.splice(targetIndex, 0, draggedPanel)
	dragOrderChanged = true
	lastPanelMove = { from: currentIndex, to: targetIndex, time: now }
}

const finishPanelDrag = () => {
	const finalMove = pendingDragMove
	if (dragMoveFrame !== null) {
		cancelAnimationFrame(dragMoveFrame)
		dragMoveFrame = null
	}
	pendingDragMove = null
	if (finalMove) movePanel(finalMove)
	if (dragOrderChanged) {
		set_panel_sort(allPanelList.value.map((item: any) => item.panel_id))
	}
	dragOrderChanged = false
	lastPanelMove = { from: -1, to: -1, time: 0 }
	draggedPanelID.value = null
}

// 获取链接
const getUrlLink = (url: string) => {
	if (!url) return ''
	// 过滤https/ http,返回剩余部分
	const reg = /(http|https):\/\/([\w.]+\/?)\S*/
	return url.replace(reg, '$2')
}
// 设置磁盘路径
const onChangeDiskPath = (val: any, item: any) => {
	record_disk({ panel_id: item.panel_id, disk_path: val })
}

// 添加面板
const addPanel = () => {
	isEdit.value = false
	addPanelVisible.value = true
}

// 编辑面板
const editPanelInfo = (item: Panel_Params) => {
	panelParams.value = Object.assign({},{
		title: item.title,
		panel_id: item.panel_id,
		auth_type: item.auth_type,
		url: item.url,
		group_id: item.group_id,
		proxy_id: item.proxy_id || -1,
		api_token:''
	},{
		token: item.auth_type !== 1 ? item.api_token : '',
	})
	isEdit.value = true
	addPanelVisible.value = true
}
// 打开面板
const openPanelView = (item: any, ev?: any) => {
	if (ev) {
		const targetName = ev.target.localName
		const isButtonOrIcon = targetName === 'button' || targetName === 'path' || targetName === 'svg'

		if (!item.is_open || item.panelInfo.isError) {
			if (!isButtonOrIcon) {
				if (item.panelInfo.isError) {
					Message.error(pub.lang('无法连接到面板，请检查网络或服务状态'))
				}
			}
			return
		}

		if (isButtonOrIcon) {
			return
		}
	}
	router.push({
		name: 'details',
		params: { id: item.panel_id,key:new Date().getTime() },
	})
}
// 删除面板
const removePanel = (item: any) => {
	ElMessageBox.confirm(pub.lang('是否将【{}】从列表中删除?', item.title), pub.lang('删除面板'), {
		confirmButtonText: pub.lang('确认'),
		cancelButtonText: pub.lang('取消'),
		type: 'warning',
	}).then(() => {
		common.send(routes.panel.remove.path, { panel_id: item.panel_id }, (res: any) => {
			if (res.status) {
				getPanelList()
			}
		})
	})
}
const isRquest = ref(false)
const getPanelList = async (Gid?: number) => {
	isRquest.value = false
	try {
		if (Gid === currentGroupID.value) currentGroupID.value = -1 //当前分组被删除恢复至全部
		const res: any = await common.sendAsync({
			route: routes.panel.list.path,
			data: { limit: 9999, group_id: currentGroupID.value },
		})
		allPanelList.value = res.data.data.map((item: any) => {
			const existingPanel = allPanelList.value.find((panel: any) => panel.panel_id === item.panel_id)
			// Initialize with default panelInfo structure
			let defaultPanelInfo = {
				load: { one: 0, five: 0, fifteen: 0 },
				cpu: [0, 0, 0, 0, 0, 0],
				mem: { memRealUsed: 0, memTotal: 0 },
				up: 0,
				down: 0,
				isError: false,
				errorMsg: '',
			};
			item.device_status = existingPanel?.device_status || 'unknown'
			item.panel_status = existingPanel?.panel_status || 'unknown'

			// If status is 1, it means connection error, so set isError to true and add error message
			if (item.status === 1) {
				item.panelInfo = { ...defaultPanelInfo, isError: true, errorMsg: pub.lang('连接失败：') };
			} else {
				// Try to preserve existing live panelInfo if available and not in an error state
				if (existingPanel && !existingPanel.panelInfo.isError) {
					item.panelInfo = existingPanel.panelInfo;
				} else {
					// Otherwise, initialize with default values
					item.panelInfo = defaultPanelInfo;
				}
			}

			item.ov = cutAuthStatus(item.ov)
			return item
		})
		groupList.value = res.data.groups
		if (firstLoad.value) {
			firstLoad.value = false
		}
	} finally {
		isRquest.value = true
	}
}
// 授权状态异常处理
const cutAuthStatus = (val: any) => {
	// 数字类型
	if (typeof val === 'number') {
		if (val === -1) return 3
		return val
	} else {
		if(val === null) getPanelList()  //检测到存在null，刷新当前列表
		return 3
	}
}
// 切换分组
const switchGroup = (val: any) => {
	currentGroupID.value = val.target._value
	getPanelList()
}
// 负载状态
const updateBuffer = new Map(); // 用于暂存面板更新的 Map
let updateTimer: ReturnType<typeof setTimeout> | null = null; // 去抖动计时器
const UPDATE_DEBOUNCE_TIME = 100; // 去抖动时间，单位毫秒

// 新增用于分批处理的队列和标志
const processingQueue: Array<any> = []; // 用于分批处理的队列
let animationFrameRequested = false; // 标记是否已请求下一帧动画
const BATCH_SIZE = 10; // 每次处理的面板数量

const processUpdatesInBatches = () => {
    if (processingQueue.length === 0) {
        animationFrameRequested = false; // 没有更多更新需要处理，重置标志
        return;
    }

    // 每次处理一小批更新
    const updatesToProcess = processingQueue.splice(0, BATCH_SIZE);

    updatesToProcess.forEach((bufferedResult) => {
        // 找到对应的面板并更新其信息
        const item = allPanelList.value.find((panel: any) => panel.panel_id === bufferedResult.panel_id);
        if (item) {
			item.device_status = bufferedResult.device_status || item.device_status || 'unknown';
			item.panel_status = bufferedResult.panel_status || item.panel_status || 'unknown';
            item.panelInfo = bufferedResult.data.msg
                ? Object.assign({}, { isError: true, errorMsg: bufferedResult.data.msg })
                : bufferedResult.data;
            item.is_open = bufferedResult.is_open;
            if (item.current_disk === '' && typeof bufferedResult.data.msg === 'undefined') {
                item.current_disk = bufferedResult.data.disk[0].path;
            }
            if (bufferedResult.ov === -1 && typeof bufferedResult.data.msg === 'undefined') {
                item.ov = 0; // 获取授权异常且数据库中没有授权状态
            } else {
                item.ov = cutAuthStatus(bufferedResult.ov);
            }
            // 如果服务器名等于url则更新列表信息(ps:后端接口已处理)
            const urlMatch = item.url.match(/\/\/(.*?):/);
            if (urlMatch && urlMatch[1] && item.title === urlMatch[1] && typeof item.panelInfo.isError === 'undefined') {
                item.title = bufferedResult.data.title;
            }
            if (item.ov > 0) item.is_open = true;
        }
    });

    // 如果队列中还有剩余项，请求下一帧动画继续处理
    if (processingQueue.length > 0) {
        requestAnimationFrame(processUpdatesInBatches);
    } else {
        animationFrameRequested = false; // 所有更新处理完毕
    }
};

const loadStatusSync = () => {
	const any_channel = 'panel_loads_recv'
	ipc.on(any_channel, (event: any, result: any) => {
		if (result.protocol_changed) {
			const changedPanel = allPanelList.value.find(
				(panel: any) => panel.panel_id === result.panel_id
			)
			if (changedPanel) changedPanel.url = result.protocol_changed.url
			if (result.protocol_changed.protocol === 'http') {
				Message.warn(result.protocol_changed.msg)
			} else {
				Message.success(result.protocol_changed.msg)
			}
		}
		// console.log(111); // 移除调试日志
		// 存储最新的结果到缓冲区，如果同一 panel_id 有多个更新，只保留最新的
		updateBuffer.set(result.panel_id, result);

		// 清除任何现有的计时器
		if (updateTimer) {
			clearTimeout(updateTimer);
		}

		// 设置一个新的计时器，在短时间延迟后处理更新
		updateTimer = setTimeout(() => {
			// 将所有缓冲的更新移动到处理队列
			updateBuffer.forEach((bufferedResult) => {
				processingQueue.push(bufferedResult);
			});
			updateBuffer.clear(); // 处理完成后清空缓冲区

			// 如果尚未请求动画帧，则请求一个并开始分批处理
			if (!animationFrameRequested) {
				animationFrameRequested = true;
				requestAnimationFrame(processUpdatesInBatches);
			}
			updateTimer = null; // 重置计时器
		}, UPDATE_DEBOUNCE_TIME);
	});
	let pdata = { any_channel: any_channel }
	common.send(routes.panel.start_load.path, pdata, (result: any) => {})
}
/**
 * @description 生成负载加载参数
 * @param  load 负载数据
 * @returns void
 */
const createLoadInfo = (load: any) => {
	const { one, five, fifteen } = load
	return `${one.toFixed(2)} / ${five.toFixed(2)} / ${fifteen.toFixed(2)}`
}

/**
 * @description 生成内存参数
 * @returns void
 */
const createMemoryInfo = (memory: any) => {
	const { memRealUsed, memTotal } = memory
	if (memTotal === 0) return 0
	return Math.round((memRealUsed / memTotal) * 1000) / 10
}

// 导出面板
const exportPanel = () => {
	common.send(routes.panel.export.path, {}, (res: any) => {
		Message.request(res)
	})
}
// 导入面板
const importPanel = () => {
	common.send(routes.panel.import.path, {}, (res: any) => {
		Message.request(res)
		if (res.status) {
			getPanelList()
		}
	})
}

// 初始化
onMounted(() => {
	getPanelList()
	// 监听请求负载状态
	loadStatusSync()
	updateSegmentIndicator(groupSegmentRef, groupIndicatorStyle)
	updateSegmentIndicator(sortSegmentRef, sortIndicatorStyle)
})
onUnmounted(() => {
	// 关闭负载状态
	common.send(routes.panel.stop_load.path, {}, (result: any) => {})
	// 关闭事件
	ipc.removeAllListeners('panel_loads_recv')
})
</script>
<style lang="scss" scoped>
:deep(.el-card) {
	cursor: pointer;
	border-radius: 10px;
	.el-card__header {
		background-color: #fcfcfd;
		// font-weight: 500;
		color: #000;
		border-top-left-radius: 10px;
		border-top-right-radius: 10px;
	}
	.el-card__body {
		padding: 0.5rem 1.2rem 1.2rem;
		.rows {
			line-height: 2;
		}
	}
}
:deep(.el-progress.is-success) {
	.el-progress-bar__inner {
		background-color: #20a53a !important;
	}
}
.welcome {
	text-align: center;
	color: #bdbdbd;
}
.panel__header {
	gap: 2.4rem;
}
.panel-primary-actions {
	.panel-brand {
		margin-right: 1.6rem;
		padding-right: 1.6rem;
		border-right: 1px solid var(--el-border-color-lighter);
	}

	.panel-brand__logo {
		width: 2.8rem;
		height: 3rem;
		margin-right: 0.9rem;
		object-fit: contain;
	}

	.panel-brand__content {
		display: flex;
		flex-direction: column;
		line-height: 1.2;
	}

	.panel-brand__name {
		color: var(--el-text-color-primary);
		font-size: 1.4rem;
		font-weight: 600;
		white-space: nowrap;
	}

	.panel-brand__site {
		display: inline-flex;
		align-items: center;
		width: fit-content;
		margin-top: 0.3rem;
		color: var(--el-text-color-secondary);
		font-size: 1.1rem;
		text-decoration: none;

		.el-icon {
			margin-left: 0.3rem;
		}

		&:hover {
			color: var(--el-color-primary);
		}
	}

	.panel-secondary-action {
		color: var(--el-text-color-regular);

		&:hover {
			color: var(--el-color-primary);
			background-color: var(--el-color-primary-light-9);
		}
	}
}
.panel-toolbar {
	gap: 0.4rem;
}
.panel-control {
	gap: 0.8rem;
}
.panel-control__label {
	color: var(--el-text-color-primary);
	font-size: 1.3rem;
	font-weight: 600;
	white-space: nowrap;
}
.panel-segmented {
	box-sizing: border-box;
	height: 3.4rem;
	padding: 0.3rem;
	border: 1px solid var(--el-border-color);
	border-radius: 999px;
	background-color: transparent;

	.panel-segmented__group {
		position: relative;
		height: 2.6rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background-color: transparent;
		gap: 0.2rem;
	}

	.panel-segmented__indicator {
		position: absolute;
		top: 0;
		left: 0;
		z-index: 0;
		height: 2.6rem;
		border-radius: 999px;
		background-color: #20a43a;
		box-shadow: 0 2px 5px rgba(14, 102, 32, 0.28);
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
		background-color: transparent;
		box-shadow: none !important;
		transition: color 0.15s ease;
	}

	:deep(.el-radio-button__inner:hover) {
		color: #20a43a;
		background-color: transparent;
	}

	:deep(.el-radio-button.is-active .el-radio-button__inner) {
		color: #ffffff !important;
		font-weight: 600;
		background-color: transparent !important;
		box-shadow: none !important;
	}

	.panel-segmented__count {
		margin-left: 0.4rem;
		font-size: 1.1rem;
		font-variant-numeric: tabular-nums;
		opacity: 0.58;
	}

	:deep(.el-radio-button.is-active) .panel-segmented__count {
		opacity: 0.86;
	}
}
.panel-segmented__tool {
	width: 2.6rem;
	height: 2.6rem;
	margin-left: 0.2rem;
	padding: 0;
	border: 0;
	border-radius: 50%;
	color: var(--el-text-color-regular);

	&:hover {
		color: #20a43a;
		background-color: var(--el-bg-color);
	}
}
.panel-tool-icon {
	width: 3.2rem;
	height: 3.2rem;
	padding: 0;
	color: var(--el-text-color-secondary);

	&:hover {
		color: var(--el-color-primary);
		background-color: var(--el-color-primary-light-9);
	}
}
.panel-search {
	background-color: #f2f2f2;
	border-radius: 8px;
	display: flex;
	align-items: center;
	padding-left: 1rem;
	:deep(.el-input) {
		width: 28rem;
		height: 3.8rem;
		.el-input__wrapper {
			background-color: #f2f2f2;
			padding-left: 0;
			padding-right: 0;
			box-shadow: 0 0 0 0px var(--el-input-border-color, var(--el-border-color)) inset;
			input {
				font-size: 1.6rem;
				&::placeholder {
					color: #000;
					font-weight: 500;
				}
			}
		}
	}
	&--active {
		background-color: white;
		box-shadow:
			rgba(65, 69, 73, 0.3) 0 1px 1px 0,
			rgba(65, 69, 73, 0.15) 0 1px 3px 1px;
		:deep(.el-input) {
			.el-input__wrapper {
				background-color: white;
			}
		}
	}
}
.panel__content {
	.el-scrollbar {
		:deep(.el-scrollbar__wrap) {
			overflow-x: hidden;
		}
	}
	.el-row {
		padding: 5px;
	}
}
.card-panel-item {
	box-shadow: rgba(0, 0, 0, 0.08) 0px 2px 12px;
	// transition: all 0.3s ease;
	// &:hover {
	// 	transform: translateY(-5px);
	// 	box-shadow: rgba(0, 0, 0, 0.12) 0px 8px 24px;
	// }
	&.isNoOpen {
		opacity: 0.5;
	}
	&.isError {
		background: #fcf1ef;
		cursor: not-allowed !important;
		box-shadow:
			rgba(252, 241, 239, 0.3) 0 1px 2px 0,
			rgba(252, 241, 239, 0.15) 0 2px 6px 2px;
		:deep(.el-card__header) {
			background-color: #fcf1ef;
		}
		:deep(.el-progress-bar__outer) {
			background-color: #fde8e8;
		}
	}
	&.isWarning {
		background: var(--el-color-warning-light-9);
		cursor: not-allowed !important;
		box-shadow: 0 1px 2px rgba(230, 162, 60, 0.14), 0 2px 6px rgba(230, 162, 60, 0.1);
		:deep(.el-card__header) {
			background-color: var(--el-color-warning-light-9);
		}
	}
	:deep(.disk-card-select) {
		.el-select__wrapper {
			padding: 0;
			height: 1rem;
			font-size: 1.2rem;
			box-shadow: none;
			.el-input__inner {
				padding: 0;
			}
		}
	}
	.card-btn-style{
		font-size: 1.6rem;
	}
}
.panel-device-status {
	display: inline-flex;
	align-items: center;
	margin-right: 0.8rem;
	padding: 0.25rem 0.65rem;
	border-radius: 999px;
	font-size: 1rem;
	white-space: nowrap;

	i {
		width: 0.55rem;
		height: 0.55rem;
		margin-right: 0.4rem;
		border-radius: 50%;
		background-color: currentColor;
	}

	&--online {
		color: var(--el-color-success);
		background-color: var(--el-color-success-light-9);
	}

	&--warning {
		color: var(--el-color-warning);
		background-color: var(--el-color-warning-light-9);
	}

	&--offline {
		color: var(--el-color-danger);
		background-color: var(--el-color-danger-light-9);
	}

	&--unknown {
		color: var(--el-text-color-secondary);
		background-color: var(--el-fill-color-light);
	}
}
.panel-card-col {
	transition: opacity 0.15s ease;

	&--dragging {
		opacity: 0.25;
	}
}
.panel-card-move {
	transition: transform 0.2s ease;
}
.panel-drag-handle {
	display: inline-flex;
	align-items: center;
	cursor: grab;

	&:active {
		cursor: grabbing;
	}

	&--disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}
}
.disk-card-option {
	height: 2rem;
	line-height: 2rem;
	font-size: 1.2rem;
	padding: 0 10px 0 10px;
}
</style>
