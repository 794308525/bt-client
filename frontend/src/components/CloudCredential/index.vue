<template>
	<div class="cloud-credential" @click.stop>
		<span class="credential-label">{{ label }}</span>
		<code class="credential-value">{{ displayedValue }}</code>
		<el-tooltip :content="actionLabel" placement="top">
			<el-button
				text
				circle
				:icon="visible ? Hide : View"
				:loading="loading"
				:aria-label="actionLabel"
				:aria-pressed="visible"
				@click="toggle" />
		</el-tooltip>
	</div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Hide, View } from '@element-plus/icons-vue'
import { useMessage } from '@utils/hooks/message'
import { pub } from '@utils/tools'

const props = withDefaults(
	defineProps<{
		label: string
		value?: string
		loadValue?: () => Promise<string>
		resetKey?: number
	}>(),
	{ value: '', resetKey: 0 }
)
const Message = useMessage()
const visible = ref(false)
const loading = ref(false)
const revealedValue = ref('')
let requestId = 0
const actionLabel = computed(() => pub.lang(visible.value ? '隐藏 {}' : '查看 {}', props.label))
const displayedValue = computed(() => {
	if (visible.value) return revealedValue.value
	return props.value.length > 8
		? `${props.value.slice(0, 4)}••••••••${props.value.slice(-4)}`
		: '••••••••••••'
})
function hide() {
	requestId++
	visible.value = false
	loading.value = false
	revealedValue.value = ''
}
async function toggle() {
	if (visible.value) return hide()
	if (loading.value) return
	const id = ++requestId
	loading.value = true
	try {
		const value = props.value || (await props.loadValue?.())
		if (id !== requestId) return
		if (!value) throw new Error(pub.lang('凭据暂不可用'))
		revealedValue.value = value
		visible.value = true
	} catch (error) {
		if (id === requestId)
			Message.error(error instanceof Error ? error.message : pub.lang('凭据读取失败'))
	} finally {
		if (id === requestId) loading.value = false
	}
}
watch(() => [props.value, props.resetKey], hide, { flush: 'sync' })
onBeforeUnmount(hide)
</script>

<style scoped lang="scss">
.cloud-credential {
	display: grid;
	grid-template-columns: 9.6rem minmax(0, 1fr) 2.4rem;
	min-width: 0;
	align-items: center;
	gap: 0.6rem;
	min-height: 2.6rem;
}
.credential-label {
	color: var(--el-text-color-secondary);
	font-size: 1.05rem;
	white-space: nowrap;
}
.credential-value {
	min-width: 0;
	overflow-wrap: anywhere;
	font-size: 1.1rem;
	line-height: 1.6;
}
.el-button {
	width: 2.4rem;
	height: 2.4rem;
	padding: 0;
	margin: 0;
	color: var(--el-text-color-secondary);
}
</style>
