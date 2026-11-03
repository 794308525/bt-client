<template>
	<div class="panel-opening" v-loading="activePanel?.loading" :element-loading-text="activePanel?.loadingText">
		<el-empty v-if="activePanel?.error" :description="activePanel.error">
			<el-button type="primary" @click="retryPanel">{{ pub.lang('重试') }}</el-button>
		</el-empty>
	</div>
</template>

<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useSettingStore } from '@store/setting'
import { common, routes, ipc } from '@api/http'
import { pub } from '@utils/tools'

const useStore = useSettingStore()
import { useMessage } from '@utils/hooks/message'
const { mainWidth, mainHeight, panelList, panelActive, addPanel } = storeToRefs(useStore)
const route = useRoute()
const router = useRouter()

const Message = useMessage() // 消息提示
const xBounds = 0 // x轴偏移量
const yBounds = 40 // y轴偏移量
const activePanel = computed(() => panelList.value.find(item => item.key === panelActive.value))

// 获取当前key
const getCurrentRefKey = () => {
	const key = panelList.value.find((item: any) => item.key === panelActive.value)
	if (key) return key.key
}
// 显示视图
const showPanelView = () => {
	common.send(routes.window.show.path, { view_key: getCurrentRefKey(), pending: activePanel.value?.loading || !!activePanel.value?.error }, (res: any) => {
		// 设置位置
		panelViewBounds()
	})
}
// 设置视图位置
const panelViewBounds = () => {
	common.send(
		routes.window.set_bounds.path,
		{
			view_key: panelActive.value,
			bounds: { x: xBounds, y: yBounds, width: mainWidth.value, height: mainHeight.value },
		},
		(result: any) => {
			// console.log(result)
		}
	)
}

// Ctrl+1-9切换面板 / Ctrl+Tab切换面板
const onKeyEvents = () => {
	ipc.on('panel-switch', (event: any, result: any) => {
		if (result === 'next') {
			const index = panelList.value.findIndex((item: any) => item.key === panelActive.value)
			if (index === panelList.value.length - 1) {
				onPanelSwitch(0)
			} else {
				onPanelSwitch(index + 1)
			}
		} else if (Number(result) >= 1) {
			const index = parseInt(result) - 1
			if (panelList.value[index]) {
				onPanelSwitch(index)
			}
		}
	})
}

// 触发面板切换
const onPanelSwitch = (index: any) => {
	const currentTab = panelList.value[index]
	const key = currentTab.key
	panelActive.value = key
	showPanelView()
	if (route.path.indexOf('details') === -1) {
		router.push(`/details/${currentTab.id}&${key}`)
		return false
	}
}

// 创建面板
const createPanel = (item: any) => {
	addPanel.value = item // 添加面板tab
	panelActive.value = item.key // 激活当前面板
}
// 创建面板子视图
const createChildView = (item: any) => {
	return common.sendAsync({
		route: routes.window.create.path,
		data: {
			view_key: item.key,
			url: item.url,
			options: {},
			bounds: {
				x: xBounds,
				y: yBounds,
				width: mainWidth.value,
				height: mainHeight.value,
			},
			auto_resize: {
				width: true,
				height: true,
				horizontal: true,
				vertical: true,
			},
			proxy_id: item.proxy_id,
			show: router.currentRoute.value.name === 'details' && panelActive.value === item.key,
		},
		timeout: 25000,
	})
}

// 初始化面板
const initPanel = async () => {
	const id = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
	const key = String(Array.isArray(route.params.key) ? route.params.key[0] : route.params.key)

	const existingPanel = panelList.value.find(item => item.key === key)
	if (existingPanel) {
		panelActive.value = key
		showPanelView()
		return
	}

	const panel = reactive({
		id, key, url: '', label: pub.lang('正在连接面板'), proxy_id: 0,
		loading: true, loadingText: pub.lang('正在获取面板信息'), error: '',
		favico: () => ' ',
	})
	createPanel(panel)
	await nextTick()
	showPanelView()
	await openPanel(panel)
}

// 连接任务随页签保留；切换页面不取消，关闭页签后不再创建网页。
const openPanel = async (panel: any) => {
	const { id, key } = panel
	const isOpen = () => panelList.value.some(item => item.key === key)
	try {
		if (!isOpen()) return
		const info: any = await common.sendAsync({
			route: routes.panel.find.path,
			data: { panel_id: id },
			timeout: 5000,
		})
		if (!info?.status || !info.data) throw new Error(info?.msg || pub.lang('获取面板信息失败'))
		if (!isOpen()) return
		panel.label = info.data.title
		panel.proxy_id = info.data.proxy_id
		panel.loadingText = pub.lang('正在获取面板登录地址')

		const tokenResult: any = await common.sendAsync({
			route: routes.panel.get_tmp_token.path,
			data: { panel_id: id },
			timeout: 12000,
		})
		if (!tokenResult?.status || !tokenResult.data) {
			throw new Error(tokenResult?.msg || pub.lang('获取面板登录地址失败'))
		}
		if (!isOpen()) return
		panel.url = tokenResult.data
		panel.loadingText = pub.lang('正在加载面板页面')
		const createResult: any = await createChildView(panel)
		if (!createResult?.status || createResult.data?.view_key !== key) {
			throw new Error(createResult?.msg || pub.lang('面板窗口创建失败'))
		}

		if (!isOpen()) {
			common.sendAsync({
				route: routes.window.destroy.path,
				data: { view_key: key },
				timeout: 5000,
			}).catch(() => {})
			return
		}
	} catch (error: any) {
		if (!isOpen()) return
		common.sendAsync({ route: routes.window.destroy.path, data: { view_key: key }, timeout: 5000 }).catch(() => {})
		panel.error = error?.message || pub.lang('面板打开失败')
		if (panelActive.value === key && router.currentRoute.value.name === 'details') Message.error(panel.error)
	} finally {
		panel.loading = false
	}
}

const retryPanel = () => {
	const panel = activePanel.value
	if (!panel || panel.loading) return
	panel.error = ''
	panel.loading = true
	panel.loadingText = pub.lang('正在获取面板信息')
	openPanel(panel)
}

initPanel()
watch(
	() => route.params,
	() => {
		initPanel()
	}
)
onMounted(() => {
	// 监听快捷键
	onKeyEvents()
})

onBeforeUnmount(() => {
	ipc.removeAllListeners('panel-switch')
	if (router.currentRoute.value.name === 'details') return
	panelList.value.forEach(item => common.send(routes.window.hide.path, { view_key: item.key }))
	panelActive.value = ''
})
</script>

<style scoped>
.panel-opening {
	min-height: calc(100vh - var(--app-titlebar-height, 40px));
}
</style>
