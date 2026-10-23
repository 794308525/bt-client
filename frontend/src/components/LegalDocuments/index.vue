<template>
	<div class="legal-documents">
		<nav class="legal-links" :aria-label="pub.lang('法律与隐私')">
			<el-button link type="primary" @click="openDocument('privacy')">{{ pub.lang('隐私政策') }}</el-button>
			<span aria-hidden="true">·</span>
			<el-button link type="primary" @click="openDocument('terms')">{{ pub.lang('使用条款') }}</el-button>
		</nav>
		<el-dialog
			v-model="visible"
			:title="pub.lang('寰宇运维') + ' · ' + pub.lang(document.title)"
			width="min(88rem, calc(100vw - 3.2rem))"
			align-center
			append-to-body
			destroy-on-close>
			<div class="legal-reader" tabindex="0" :aria-label="pub.lang(document.title)">
				<nav class="legal-reader__switch" :aria-label="pub.lang('文档切换')">
					<el-button :type="activeDocument === 'privacy' ? 'primary' : 'default'" plain @click="activeDocument = 'privacy'">{{ pub.lang('隐私政策') }}</el-button>
					<el-button :type="activeDocument === 'terms' ? 'primary' : 'default'" plain @click="activeDocument = 'terms'">{{ pub.lang('使用条款') }}</el-button>
				</nav>
				<dl class="legal-metadata">
					<div><dt>{{ pub.lang('维护主体') }}</dt><dd>{{ legalMetadata.provider }}</dd></div>
					<div><dt>{{ pub.lang('联系邮箱') }}</dt><dd><a :href="'mailto:' + legalMetadata.email" target="_blank" rel="noopener noreferrer">{{ legalMetadata.email }}</a></dd></div>
					<div><dt>{{ pub.lang('生效日期') }}</dt><dd><time :datetime="legalMetadata.effectiveDate">{{ legalMetadata.effectiveDate }}</time></dd></div>
					<div><dt>{{ pub.lang('更新日期') }}</dt><dd><time :datetime="legalMetadata.updatedDate">{{ legalMetadata.updatedDate }}</time></dd></div>
				</dl>
				<p class="legal-intro">{{ pub.lang(document.intro) }}</p>
				<section v-for="section in document.sections" :key="section.title" class="legal-section">
					<h3>{{ pub.lang(section.title) }}</h3>
					<p v-for="paragraph in section.paragraphs" :key="paragraph">{{ pub.lang(paragraph) }}</p>
					<ul v-if="section.items?.length">
						<li v-for="item in section.items" :key="item">{{ pub.lang(item) }}</li>
					</ul>
				</section>
			</div>
			<template #footer>
				<el-button @click="visible = false">{{ pub.lang('关闭') }}</el-button>
			</template>
		</el-dialog>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { pub } from '@utils/tools'
import { legalDocuments, legalMetadata, type LegalDocumentId } from '@/content/legal'

const visible = ref(false)
const activeDocument = ref<LegalDocumentId>('privacy')
const document = computed(() => legalDocuments[activeDocument.value])

const openDocument = (id: LegalDocumentId) => {
	activeDocument.value = id
	visible.value = true
}
</script>

<style scoped lang="scss">
.legal-links {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-wrap: wrap;
	gap: 0.8rem;
	color: var(--el-text-color-placeholder);

	:deep(.el-button + .el-button) {
		margin-left: 0;
	}
}
.legal-reader {
	max-height: 64vh;
	padding: 0 1.2rem 0 0.2rem;
	overflow-y: auto;
	color: var(--el-text-color-primary);
	font-size: 1.3rem;
	line-height: 1.9;
	text-align: left;
	overflow-wrap: anywhere;
	user-select: text;
}
.legal-reader__switch {
	display: flex;
	flex-wrap: wrap;
	gap: 0.8rem;
	margin-bottom: 1.6rem;

	:deep(.el-button + .el-button) {
		margin-left: 0;
	}
}
.legal-metadata {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1rem 2rem;
	margin: 0;
	padding: 1.6rem;
	border: 1px solid var(--el-border-color);
	border-radius: 0.6rem;
	background: var(--el-fill-color-light);

	dt {
		color: var(--el-text-color-secondary);
		font-size: 1.2rem;
	}
	dd {
		margin: 0.2rem 0 0;
	}
	a {
		color: var(--el-color-primary);
		text-decoration: underline;
	}
}
.legal-intro {
	margin: 1.8rem 0;
}
.legal-section {
	margin-top: 2rem;

	h3 {
		margin: 0 0 0.8rem;
		font-size: 1.4rem;
		font-weight: 600;
	}
	p {
		margin: 0.8rem 0;
		color: var(--el-text-color-regular);
	}
	ul {
		display: grid;
		gap: 0.8rem;
		margin: 1rem 0;
		padding-left: 2rem;
		list-style: disc;
		color: var(--el-text-color-regular);
	}
}
@media (max-width: 600px) {
	.legal-metadata {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
