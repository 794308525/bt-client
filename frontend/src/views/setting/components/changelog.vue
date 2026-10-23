<template>
	<section class="changelog-page">
		<header class="changelog-header">
			<h1>{{ pub.lang('更新记录') }}</h1>
			<el-tag v-if="version" effect="plain" size="small">{{ pub.lang('当前版本') }} v{{ version }}</el-tag>
		</header>
		<p class="changelog-intro">{{ pub.lang('简要记录功能新增、体验优化和重要修复。') }}</p>
		<div class="changelog-list">
			<article v-for="entry in changelog" :key="entry.version" class="changelog-entry">
				<header class="changelog-entry__header">
					<h2>{{ entry.version === 'unreleased' ? pub.lang('待发布') : 'v' + entry.version }}</h2>
					<time :datetime="entry.date">{{ entry.date }}</time>
				</header>
				<ul class="changelog-entry__changes">
					<li v-for="change in entry.changes" :key="change">{{ pub.lang(change) }}</li>
				</ul>
			</article>
		</div>
	</section>
</template>

<script setup lang="ts">
import { pub } from '@utils/tools'
import { changelog } from '../changelog'

defineProps<{ version: string }>()
</script>

<style scoped lang="scss">
.changelog-page {
	width: min(96rem, 100%);
	color: var(--el-text-color-primary);
	user-select: text;
}
.changelog-header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 1.2rem;

	h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 600;
		line-height: 1.5;
	}
}
.changelog-intro {
	margin: 0.6rem 0 0;
	color: var(--el-text-color-regular);
	font-size: 1.2rem;
	line-height: 1.7;
}
.changelog-list {
	display: grid;
	gap: 1.6rem;
	margin-top: 2rem;
}
.changelog-entry {
	min-width: 0;
	padding: 1.8rem 2rem;
	border: 1px solid var(--el-border-color);
	border-left: 3px solid var(--el-color-primary);
	border-radius: 0.8rem;
	background: var(--el-bg-color);
}
.changelog-entry__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	flex-wrap: wrap;
	gap: 0.8rem 1.6rem;

	h2 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
	}
	time {
		color: var(--el-text-color-regular);
		font-size: 1.2rem;
	}
}
.changelog-entry__changes {
	display: grid;
	gap: 0.6rem;
	margin: 1.2rem 0 0;
	padding-left: 1.8rem;
	list-style: disc;
	color: var(--el-text-color-regular);
	font-size: 1.3rem;
	line-height: 1.8;
	overflow-wrap: anywhere;
}
</style>
