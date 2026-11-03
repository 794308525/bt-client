<template>
	<div class="product-status">
		<span>{{ resourceNames[product] }} · {{ resourceStatusName(summary?.status) }}</span>
		<small v-if="summary?.checked_at">{{ timeText(summary.checked_at) }}</small>
		<el-button link type="primary" :loading="busy" @click="$emit('refresh')">重新探测</el-button>
	</div>
	<el-alert
		v-if="summary?.error"
		:closable="false"
		:type="
			['not_opened', 'permission_denied', 'unsupported'].includes(summary.status)
				? 'info'
				: 'warning'
		"
		class="status-alert">
		<template #title>{{ summary.error.message }}</template>
		<div>
			{{ summary.error.action }} {{ summary.error.code
			}}<span v-if="summary.error.http_code"> · HTTP {{ summary.error.http_code }}</span
			><span v-if="summary.error.request_id"> · RequestId: {{ summary.error.request_id }}</span>
		</div>
		<div v-if="summary.success_at">
			上次成功：{{ timeText(summary.success_at)
			}}<span v-if="summary.count != null">，当时可见 {{ summary.count }} 个资源</span
			>；当前数量尚未确认。
		</div>
	</el-alert>
</template>
<script setup lang="ts">
import { resourceNames, resourceStatusName, timeText, type ResourceSummary } from './api'
defineProps<{ product: string; summary?: ResourceSummary; busy?: boolean }>()
defineEmits<{ (event: 'refresh'): void }>()
</script>
<style scoped>
.product-status {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 12px;
	margin: 12px 0;
	color: var(--el-text-color-secondary);
	font-size: 12px;
}
.status-alert {
	margin-bottom: 14px;
	overflow-wrap: anywhere;
}
</style>
