<template>
	<div></div>
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
let openAttempt = 0

// 获取当前key
const getCurrentRefKey = () => {
	const key = panelList.value.find((item: any) => item.key === panelActive.value)
	if (key) return key.key
}
// 显示视图
const showPanelView = () => {
	common.send(routes.window.show.path, { view_key: getCurrentRefKey() }, (res: any) => {
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
		router.push(`/details/${currentTab.id}&${index}`)
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
		},
		timeout: 25000,
	})
}

const restorePreviousPanel = (previousActiveKey: string) => {
	const previousPanel = panelList.value.find((item: any) => item.key === previousActiveKey)
	if (!previousPanel) return router.replace('/home')
	panelActive.value = previousPanel.key
	return router.replace({
		name: 'details',
		params: { id: previousPanel.id, key: previousPanel.key },
	})
}

// 初始化面板
const initPanel = async () => {
	const id = Array.isArray(route.params.id) ? route.params.id[0] : route.params.id
	const key = String(Array.isArray(route.params.key) ? route.params.key[0] : route.params.key)

	// 情况一：key是否已经存在（当处于其他路由切换回details时）
	if(panelList.value.length > 0 && panelList.value.find((item: any) => item.key === key)){
		panelActive.value = key
		showPanelView()
		return
	}

	const attempt = ++openAttempt
	const previousActiveKey = panelActive.value
	const load = Message.load(pub.lang('正在创建面板应用'))
	try {
		const info: any = await common.sendAsync({
			route: routes.panel.find.path,
			data: { panel_id: id },
			timeout: 5000,
		})
		if (!info?.status || !info.data) throw new Error(info?.msg || pub.lang('获取面板信息失败'))
		if (attempt !== openAttempt) return

		const tokenResult: any = await common.sendAsync({
			route: routes.panel.get_tmp_token.path,
			data: { panel_id: id },
			timeout: 12000,
		})
		if (!tokenResult?.status || !tokenResult.data) {
			throw new Error(tokenResult?.msg || pub.lang('获取面板登录地址失败'))
		}
		if (attempt !== openAttempt) return

		const panel = {
			id,
			url: tokenResult.data,
			label: info.data.title,
			proxy_id: info.data.proxy_id,
			key,
			favico: () => ' ',
		}
		const createResult: any = await createChildView(panel)
		if (!createResult?.status || createResult.data?.view_key !== key) {
			throw new Error(createResult?.msg || pub.lang('面板窗口创建失败'))
		}

		if (attempt !== openAttempt) {
			common.sendAsync({
				route: routes.window.destroy.path,
				data: { view_key: key },
				timeout: 5000,
			}).catch(() => {})
			return
		}
		createPanel(panel)
	} catch (error: any) {
		if (attempt !== openAttempt) return
		Message.error(error?.message || pub.lang('面板打开失败'))
		await restorePreviousPanel(previousActiveKey)
	} finally {
		load.close()
	}
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
	openAttempt++
	ipc.removeAllListeners('panel-switch')
	common.send(routes.window.list.path, {}, (res: any) => {
		res.data.forEach((item: any) => {
			common.send(routes.window.hide.path, { view_key: item }, (result: any) => {
				panelActive.value = ''
			})
		})
	})
})
</script>
