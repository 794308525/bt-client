<template>
	<div class="layout h-full">
		<div class="layout-tabs select-none" id="layout-tabs" ref="layoutTabs"><Tabs /></div>
		<div class="layout-right-main" ref="layoutBody"><Main /></div>
	</div>
</template>

<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import Tabs from './Tabs/index.vue'
import Main from './Main/index.vue'
import { useTheme } from '@/plugins/theme'
import { useSettingStore } from '@store/setting'

const layoutTabs = ref<HTMLElement>()
const layoutBody = ref<HTMLElement>() // 主视图区域

const useStore = useSettingStore()
const { mainWidth } = storeToRefs(useStore)
const { switchDark } = useTheme()

useResizeObserver(layoutTabs, entries => {
	const height = entries[0].target.getBoundingClientRect().height
	document.documentElement.style.setProperty('--app-titlebar-height', `${height}px`)
})

useResizeObserver(layoutBody, entries => {
	const entry = entries[0]
	const { width, height } = entry.contentRect
	const footer = document.getElementById('layout-tabs')
	const footerRect = footer?.getBoundingClientRect()
	const footerWidth = footerRect?.width || 0
	mainWidth.value = footerWidth
	// mainHeight.value = height // 2px为偏移和预留空间
	useStore.setMainHeight(height)
	// console.log(`Resize observed: height=${height}, width=${width}`)
})
onMounted(() => {
	switchDark()
})
onUnmounted(() => {
	document.documentElement.style.removeProperty('--app-titlebar-height')
})
</script>

<style scoped lang="scss">
.layout {
	display: flex;
	width: 100%;
	min-height: 100vh;
	max-height: 100vh;
	flex-direction: column;
	background-color: var(--el-bg-color);
	.layout-tabs {
		position: relative;
		z-index: 1;
		flex-shrink: 0;
	}
	.layout-right-main {
		flex: 1;
		min-height: 0;
		display: block;
		overflow: auto;
		position: relative;
		// 将页面弹窗的层级和固定定位限制在内容区，顶部页签保持可操作。
		z-index: 0;
		contain: layout;
	}
}
</style>
