<template>
	<div class="flex flex-1 min-w-0">
		<div class="tabs-container flex-1 min-w-0" @click="handleClick">
			<div class="flex">
				<tabsMenu
					ref="tabChrome"
					class="w-full"
					:tabs="panelList"
					v-model="panelActive"
					@click="showPanelView"
					@remove="deletePanel"
					@refresh="refreshPanel"
					@contextmenu="openMenu" />
			</div>
		</div>
		
		<el-tooltip :content="pub.lang('设置')" placement="bottom">
			<button
				type="button"
				class="titlebar-action settings-button"
				:class="{ active: route.path === '/setting' }"
				:aria-label="pub.lang('设置')"
				:aria-current="route.path === '/setting' ? 'page' : undefined"
				@click="router.push('/setting')">
				<el-icon :size="16"><Setting /></el-icon>
			</button>
		</el-tooltip>
		<!-- 下载进度 -->
		<el-tooltip :content="endTips || pub.lang('下载列表')" placement="bottom">
			<button
				v-show="noXtermRouter"
				type="button"
				class="titlebar-action download-button"
				:aria-label="pub.lang('下载列表')"
				@click="openDownLoadView">
				<el-progress
					v-if="status === 'download'"
					type="circle"
					:percentage="downloadFile.percent"
					status="success"
					color="#409eff"
					:stroke-width="2"
					:width="22">
					<el-icon :size="12"><Download /></el-icon>
				</el-progress>
				<el-icon v-else :size="16"><Download /></el-icon>
			</button>
		</el-tooltip>
	</div>
</template>

<script setup lang="ts">
import tabsMenu from '@/components/TabsMenu/index.vue'
import { storeToRefs } from 'pinia'
import { useSettingStore } from '@store/setting'
import { useRoute, useRouter } from 'vue-router'
import { common, routes, ipc } from '@api/http'
import { Download, Setting } from '@element-plus/icons-vue'
import { pub } from '@utils/tools'

const route = useRoute()
const router = useRouter()
const useStore = useSettingStore()

const { mainWidth, mainHeight, panelList, panelActive, addPanel,hideProIcon } = storeToRefs(useStore)
const tabChrome = ref()

const status = ref('')
const noXtermRouter = ref(true)
const downloadFile = ref<{ percent?: number }>({})
const endTips = ref('')
const showLoginPopover = ref(false)

const openMenu = (event: MouseEvent, tab: any) => {
	common.send(routes.window.set_tab_context_menu.path, {
		key: tab.key,
		type: 'rightClick',
	})
}
// 面板刷新图标事件
const refreshPanel = (tab: any,index:number) => {
	common.send(routes.window.refresh_panel.path, { view_key: tab.key })
}

// 监听面板内的文件下载
const downloadListener = () => {
	ipc.on('download-progress', (event: any, arg: any) => {
		status.value = 'download' // 下载中
		downloadFile.value = arg // 下载进度
		if (arg.percent === 100 || arg.total === 0 || arg.percent < 0) {
			downloadEnd()
			endTips.value = arg.percent < 0 ? '下载失败' : '下载已完成'
		}
	})
}
// 下载完成
const downloadEnd = () => {
	status.value = 'end' // 下载完成
	downloadFile.value = {}
}
// 打开下载列表
const openDownLoadView = () => {
	common.send(routes.window.open_download_window.path, {}, (res: any) => {})
}

// 跳转到登录页面
const goToLogin = () => {
	showLoginPopover.value = false
	router.push('/login')
}
downloadListener()
// 添加面板
watch(
	() => addPanel.value,
	val => {
		// val不是空对象
		if (Object.keys(val).length) {
			tabChrome.value.addTab(val)
			addPanel.value = {}
		}
	}
)
// 显示视图
const showPanelView = (event?: Event, tab?: any, index?: number) => {
	if (route.path.indexOf('details') === -1) {
		router.push(`/details/${tab.id}&${tab.key}`)
		return false
	}
	common.send(routes.window.show.path, { view_key: panelActive.value }, (res: any) => {})
	panelViewBounds()
}
// 设置视图位置
const panelViewBounds = () => {
	common.send(
		routes.window.set_bounds.path,
		{
			view_key: panelActive.value,
			bounds: { x: 0, y: 40, width: mainWidth.value, height: mainHeight.value },
		},
		(result: any) => {
			// console.log(result)
		}
	)
}
// 处理标签底部点击不会触发自身点击事件
const handleClick = (event: Event) => {
	// 如果点击的元素是tabs-item，但不含active类名
	if (
		event.target &&
		(event.target as HTMLElement).classList.contains('tabs-item') &&
		!(event.target as HTMLElement).classList.contains('active')
	) {
		// 获取当前event处于tabs-item的索引
		const target = event.target as HTMLElement;
		const parent = target.parentNode as HTMLElement;
		if (parent && parent.children) {
			const index = Array.from(parent.children).indexOf(target);
			// 获取当前索引对应的key
			const key = panelList.value[index].key
			// 设置当前激活的面板
			panelActive.value = key
			showPanelView(event, panelList.value[index], index)
		}
	}
}

// 监听宽度变化 [调整面板视图位置]
watch(
	() => mainWidth.value,
	val => {
		if (route.path.indexOf('details') === -1) return
		panelViewBounds()
	}
)
watch(
	() => route.path,
	val => {
		if (val.indexOf('xterm') > -1) {
			noXtermRouter.value = false
		} else {
			noXtermRouter.value = true
		}
	}
)
// 处理面板复制
const handlePanelDuplicate = () => {
	ipc.on('duplicate-panel', (event: any, key: string) => {
		const current = panelList.value.find(panel => panel.key === key)
		if (current) {
			// 找到要复制的面板
			router.push({
				name: 'details',
				params: { id:current.id,key:new Date().getTime() },
			})
		}
  })
}

// 处理面板关闭
const handlePanelClose = () => {
  ipc.on('close-panel', (event: any, key: string) => {
    tabChrome.value.removeTab(key)
  })
}

// 关闭面板
const deletePanel = (tab: any, index: number) => {
	// 关闭选择项
	common.send(routes.window.destroy.path, { view_key: tab.key }, (result: any) => {
		// 激活项不为空
		if (panelActive.value) {
			showPanelView()
		} else {
			router.push(`/home`) // 跳转到面板列表
		}
	})
}
onMounted(() => {
	if (route.path == '/xterm') {
		noXtermRouter.value = false
	}
  handlePanelDuplicate() // 添加复制面板监听
  handlePanelClose()     // 添加关闭面板监听
})
// 在组件卸载时移除事件监听
onUnmounted(() => {
  ipc.removeAllListeners('duplicate-panel')
  ipc.removeAllListeners('close-panel')
})
</script>

<style lang="sass" scoped>
.titlebar-action
	display: flex
	align-items: center
	justify-content: center
	align-self: center
	flex-shrink: 0
	width: var(--titlebar-control-width)
	height: var(--titlebar-height)
	margin: 0
	padding: 0
	border: none
	border-radius: 0
	background: transparent
	color: #000
	line-height: 0
	cursor: pointer
	-webkit-app-region: no-drag
	&:hover, &.active
		background-color: #a8c7fa
	&.active
		color: #409eff
	&:focus-visible
		outline: 2px solid #409eff
		outline-offset: -2px
:deep(.el-progress)
	.el-progress__text
		display: flex
		align-items: center
		justify-content: center
		left: 0
</style>
