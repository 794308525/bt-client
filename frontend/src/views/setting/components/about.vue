<template>
	<section class="about-page">
		<header class="about-header">
			<img :src="AppLogo" class="about-logo" :alt="pub.lang('寰宇运维')" />
			<div class="about-header__content">
				<div class="about-title">
					<h1>{{ pub.lang('寰宇运维') }}</h1>
					<el-tag v-if="version" effect="plain" size="small">v{{ version }}</el-tag>
				</div>
				<p class="about-subtitle">{{ pub.lang('基于堡塔多机管理的二次开发版') }}</p>
				<p class="about-summary">{{ pub.lang('集中管理宝塔面板、SSH 连接与多云资源，将常用运维操作整合到一个桌面客户端。') }}</p>
			</div>
		</header>

		<section class="about-section" aria-labelledby="about-features-heading">
			<h2 id="about-features-heading">{{ pub.lang('本版本的扩展与调整') }}</h2>
			<p class="about-section__intro">{{ pub.lang('在原有面板管理、SSH 终端和代理功能基础上，扩展云资源管理与运维工具。') }}</p>
			<div class="about-features">
				<article class="about-feature">
					<h3>{{ pub.lang('阿里云资源管理') }}</h3>
					<p>{{ pub.lang('管理服务器、ESA/CDN、OSS 与域名解析，支持监控查看和 SSH 连接。') }}</p>
				</article>
				<article class="about-feature">
					<h3>{{ pub.lang('腾讯云资源管理') }}</h3>
					<p>{{ pub.lang('集中管理腾讯云国内站、国际站账号与云服务器。') }}</p>
				</article>
				<article class="about-feature">
					<h3>{{ pub.lang('运维工具箱') }}</h3>
					<p>{{ pub.lang('提供 SSL 证书申请与管理、QPS 压测和站点检测，集中处理常用运维任务。') }}</p>
				</article>
				<article class="about-feature">
					<h3>{{ pub.lang('使用方式调整') }}</h3>
					<p>{{ pub.lang('停用原版安装统计和宝塔账号云端数据同步，隐藏账号绑定入口，保留本地管理密码。') }}</p>
				</article>
			</div>
		</section>

		<section class="about-section" aria-labelledby="about-support-heading">
			<h2 id="about-support-heading">{{ pub.lang('联系与支持') }}</h2>
			<div class="about-support">
				<el-image
					class="about-support__qr"
					:src="WechatSupportQr"
					:alt="pub.lang('客服微信二维码')"
					:preview-src-list="[WechatSupportQr]"
					fit="contain"
					preview-teleported
					hide-on-click-modal />
				<div class="about-support__content">
					<h3>{{ pub.lang('客服微信') }}</h3>
					<p>{{ pub.lang('微信扫一扫，添加客服，反馈问题或咨询使用。') }}</p>
					<p class="about-note">{{ pub.lang('点击二维码可放大查看。') }}</p>
					<p>
						{{ pub.lang('官方网站') }}：
						<a class="about-link" href="https://iiar.cn/?r=huanyu_dev_ops" target="_blank" rel="noopener noreferrer">https://iiar.cn</a>
					</p>
				</div>
			</div>
		</section>
		<section class="about-section" aria-labelledby="about-project-heading">
			<h2 id="about-project-heading">{{ pub.lang('项目来源与许可') }}</h2>
			<p class="about-section__intro">{{ pub.lang('寰宇运维基于堡塔多机管理（bt-client）二次开发，属于非官方维护版本。') }}</p>
			<dl class="about-info">
				<div class="about-info__row">
					<dt>{{ pub.lang('宝塔官网') }}</dt>
					<dd>
						<a
							class="about-link"
							href="https://www.bt.cn/u/XbfWPO"
							target="_blank"
							rel="noopener noreferrer">https://www.bt.cn/u/XbfWPO</a>
					</dd>
				</div>
				<div class="about-info__row">
					<dt>{{ pub.lang('原项目来源') }}</dt>
					<dd>
						<a
							class="about-link"
							href="https://github.com/aaPanel/bt-client"
							target="_blank"
							rel="noopener noreferrer">https://github.com/aaPanel/bt-client</a>
					</dd>
				</div>
				<div class="about-info__row">
					<dt>{{ pub.lang('本版本源码') }}</dt>
					<dd>
						<a
							class="about-link"
							href="https://github.com/794308525/bt-client"
							target="_blank"
							rel="noopener noreferrer">https://github.com/794308525/bt-client</a>
					</dd>
				</div>
				<div class="about-info__row">
					<dt>{{ pub.lang('开源许可') }}</dt>
					<dd>
						<div class="about-license">
							<span>AGPL-3.0</span>
							<el-button link type="primary" @click="licenseVisible = true">{{ pub.lang('查看许可证全文') }}</el-button>
						</div>
						<p class="about-note">{{ pub.lang('原有版权及免责说明请参阅许可证全文。') }}</p>
					</dd>
				</div>
			</dl>
		</section>
		<section class="about-section" aria-labelledby="about-legal-heading">
			<h2 id="about-legal-heading">{{ pub.lang('法律与隐私') }}</h2>
			<p class="about-section__intro">{{ pub.lang('了解数据保存、外部服务通信及软件使用说明。文档可在应用内离线阅读。') }}</p>
			<LegalDocuments class="about-legal" />
		</section>
		<p class="about-credits">{{ pub.lang('感谢 Electron、Vue 3、Element Plus 等开源项目。') }}</p>

		<el-dialog
			v-model="licenseVisible"
			:title="pub.lang('AGPL-3.0 许可证全文')"
			width="min(86rem, calc(100vw - 4rem))"
			align-center
			append-to-body
			destroy-on-close>
			<pre class="license-text" tabindex="0" :aria-label="pub.lang('许可证全文')">{{ licenseText }}</pre>
			<template #footer>
				<el-button @click="licenseVisible = false">{{ pub.lang('关闭') }}</el-button>
			</template>
		</el-dialog>
	</section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { pub } from '@utils/tools'
import LegalDocuments from '@/components/LegalDocuments/index.vue'
import AppLogo from '@/assets/images/logo.png'
import WechatSupportQr from '@/assets/images/wechat-support.jpg'
import licenseText from '../../../../../LICENSE?raw'

defineProps<{ version: string }>()

const licenseVisible = ref(false)
</script>

<style scoped lang="scss">
.about-page {
	width: min(96rem, 100%);
	color: var(--el-text-color-primary);
	line-height: 1.7;
}
.about-header {
	display: flex;
	align-items: flex-start;
	gap: 1.6rem;
	padding: 2rem;
	border: 1px solid var(--el-border-color);
	border-radius: 0.8rem;
	background: var(--el-fill-color-light);
}
.about-logo {
	flex-shrink: 0;
	width: 4.8rem;
	height: 4.8rem;
	border-radius: 22%;
}
.about-header__content {
	min-width: 0;
}
.about-title {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 1rem;

	h1 {
		margin: 0;
		font-size: 2rem;
		font-weight: 600;
		line-height: 1.5;
	}
}
.about-subtitle {
	margin: 0.4rem 0 0;
	color: var(--el-text-color-regular);
	font-size: 1.2rem;
}
.about-summary {
	max-width: 72rem;
	margin: 1rem 0 0;
	font-size: 1.3rem;
}
.about-section {
	margin-top: 2.8rem;

	h2 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 600;
	}
}
.about-section__intro {
	margin: 0.6rem 0 1.4rem;
	color: var(--el-text-color-regular);
	font-size: 1.2rem;
}
.about-features {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 1.2rem;
}
.about-feature {
	min-width: 0;
	padding: 1.6rem;
	border: 1px solid var(--el-border-color);
	border-radius: 0.8rem;

	h3 {
		margin: 0;
		font-size: 1.3rem;
		font-weight: 500;
	}
	p {
		margin: 0.6rem 0 0;
		color: var(--el-text-color-regular);
		font-size: 1.2rem;
	}
}
.about-info {
	margin: 0;
	border: 1px solid var(--el-border-color);
	border-radius: 0.8rem;
}
.about-info__row {
	display: grid;
	grid-template-columns: 10rem minmax(0, 1fr);
	gap: 1.6rem;
	padding: 1.4rem 1.6rem;
	font-size: 1.3rem;

	& + & {
		border-top: 1px solid var(--el-border-color-lighter);
	}
	dt {
		color: var(--el-text-color-regular);
	}
	dd {
		min-width: 0;
		margin: 0;
		overflow-wrap: anywhere;
		user-select: text;
	}
}
.about-link {
	color: var(--el-color-primary);
	text-decoration: none;

	&:hover,
	&:focus-visible {
		text-decoration: underline;
	}
}
.about-license {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 1.2rem;
}
.about-note,
.about-credits {
	color: var(--el-text-color-regular);
	font-size: 1.2rem;
}
.about-note {
	margin: 0.6rem 0 0;
}
.about-credits {
	margin: 2rem 0 0;
}
.about-legal :deep(.legal-links) {
	justify-content: flex-start;
}
.about-support {
	display: flex;
	align-items: center;
	gap: 2.4rem;
	margin-top: 1.4rem;
	padding: 2rem;
	border: 1px solid var(--el-border-color);
	border-radius: 0.8rem;
}
.about-support__qr {
	flex-shrink: 0;
	width: 20rem;
	max-width: 100%;
	height: 20rem;
	border: 1px solid var(--el-border-color-lighter);
	border-radius: 0.6rem;
	background: #fff;
	cursor: zoom-in;
}
.about-support__content {
	min-width: 0;
	font-size: 1.3rem;

	h3 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 500;
	}
	p {
		margin: 0.8rem 0 0;
		color: var(--el-text-color-regular);
	}
}
.license-text {
	max-height: 55vh;
	margin: 0;
	padding: 1.6rem;
	overflow: auto;
	border: 1px solid var(--el-border-color);
	border-radius: 0.4rem;
	background: var(--el-fill-color-light);
	color: var(--el-text-color-primary);
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: 1.2rem;
	line-height: 1.6;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	user-select: text;
}
@media (max-width: 680px) {
	.about-features {
		grid-template-columns: minmax(0, 1fr);
	}
}
@media (max-width: 520px) {
	.about-header {
		flex-direction: column;
	}
	.about-support {
		flex-direction: column;
		align-items: flex-start;
		gap: 1.6rem;
	}
	.about-info__row {
		grid-template-columns: minmax(0, 1fr);
		gap: 0.4rem;
	}
}
</style>
