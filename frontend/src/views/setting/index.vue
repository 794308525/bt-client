<template>
	<div class="setting-style">
		<el-tabs v-model="activeTab" class="setting-tabs">
			<el-tab-pane :label="pub.lang('设置')" name="setting">
				<div class="settings-content">
					<!-- 暂时隐藏宝塔账号绑定入口，保留原有绑定逻辑和数据。 -->
					<section v-if="false" class="setting-section" aria-labelledby="account-heading">
						<header class="setting-section__header">
							<h2 id="account-heading">{{ pub.lang('账号') }}</h2>
						</header>
						<div class="setting-row">
							<div class="setting-row__info">
								<h3>{{ pub.lang('宝塔账号') }}</h3>
								<p class="account-value">{{ account }}</p>
							</div>
							<div class="setting-row__actions">
								<el-button @click="handleUnbind">{{ pub.lang(info.username ? '解绑' : '绑定') }}</el-button>
							</div>
						</div>
					</section>

					<section class="setting-section" aria-labelledby="general-heading">
						<header class="setting-section__header">
							<h2 id="general-heading">{{ pub.lang('通用设置') }}</h2>
						</header>
						<div class="setting-row">
							<div class="setting-row__info">
								<h3>{{ pub.lang('免密登录') }}</h3>
								<p>{{ pub.lang('开启后，无需每次打开应用时输入管理密码。') }}</p>
							</div>
							<div class="setting-row__actions">
								<el-switch
									v-model="configData.not_password"
									:aria-label="pub.lang('免密登录')"
									@change="hanelNotPassword" />
								<el-button @click="handleEditManage">{{ pub.lang('修改管理密码') }}</el-button>
							</div>
						</div>
						<div class="setting-row">
							<div class="setting-row__info">
								<h3>{{ pub.lang('主题颜色') }}</h3>
							</div>
							<div class="setting-row__actions">
								<el-radio-group v-model="Theme" :aria-label="pub.lang('主题颜色')" @change="handleTheme">
									<el-radio value="lightMode">{{ pub.lang('明亮模式') }}</el-radio>
									<el-radio value="darkMode">{{ pub.lang('暗黑模式') }}</el-radio>
								</el-radio-group>
							</div>
						</div>
						<div class="setting-row">
							<div class="setting-row__info">
								<h3>{{ pub.lang('关闭按钮') }}</h3>
							</div>
							<div class="setting-row__actions">
								<el-radio-group
									v-model="configData.exit_action"
									:aria-label="pub.lang('关闭按钮')"
									@change="handleExit">
									<el-radio value="close">{{ pub.lang('最小化到系统托盘') }}</el-radio>
									<el-radio value="exit">{{ pub.lang('关闭应用') }}</el-radio>
								</el-radio-group>
							</div>
						</div>
						<div class="setting-row">
							<div class="setting-row__info">
								<h3>{{ pub.lang('系统语言') }}</h3>
							</div>
							<div class="setting-row__actions">
								<el-select
									v-model="languageType"
									class="language-select"
									:aria-label="pub.lang('系统语言')"
									@change="handleLang">
									<el-option
										v-for="item in languageList"
										:key="item.name"
										:label="item.title"
										:value="item.name" />
								</el-select>
							</div>
						</div>
					</section>

					<section class="setting-section" aria-labelledby="cache-heading">
						<header class="setting-section__header">
							<h2 id="cache-heading">{{ pub.lang('阿里云缓存') }}</h2>
						</header>
						<div class="cache-overview">
							<dl class="cache-stats">
								<div>
									<dt>{{ pub.lang('当前占用') }}</dt>
									<dd>{{ formatBytes(cacheInfo.used_bytes) }} <span>/ {{ cacheInfo.max_mb }} MB</span></dd>
								</div>
								<div>
									<dt>{{ pub.lang('缓存条目') }}</dt>
									<dd>{{ cacheInfo.entries }} <span>{{ pub.lang('条') }}</span></dd>
								</div>
								<div>
									<dt>{{ pub.lang('保留时间') }}</dt>
									<dd>{{ cacheInfo.retention_days }} <span>{{ pub.lang('天') }}</span></dd>
								</div>
							</dl>
							<el-progress :percentage="cacheUsagePercentage" :show-text="false" :stroke-width="6" />
							<p class="cache-note">{{ pub.lang('仅缓存 ESA 热门 URL 和 URL 用量的聚合结果，不保存原始日志、下载地址或 AccessKey。超过 7 天或容量上限时自动删除最旧数据。') }}</p>
						</div>
						<div class="setting-row">
							<div class="setting-row__info">
								<h3>{{ pub.lang('容量上限') }}</h3>
							</div>
							<div class="setting-row__actions">
								<div class="cache-limit">
									<el-input-number
										v-model="cacheLimitMb"
										:min="20"
										:max="2048"
										:step="50"
										:precision="0"
										:aria-label="pub.lang('容量上限（MB）')"
										controls-position="right" />
									<span>MB</span>
								</div>
								<el-button :loading="cacheSaving" @click="saveCacheLimit">{{ pub.lang('保存') }}</el-button>
								<el-button
									type="danger"
									plain
									:loading="cacheClearing"
									:disabled="!cacheInfo.entries"
									@click="clearAliyunCache">{{ pub.lang('清理缓存') }}</el-button>
							</div>
						</div>
					</section>

					<section class="setting-section" aria-labelledby="proxy-heading">
						<header class="setting-section__header">
							<h2 id="proxy-heading">{{ pub.lang('代理池') }}</h2>
							<el-button type="primary" @click="handleAddProxy">{{ pub.lang('添加代理') }}</el-button>
						</header>
						<div class="proxy-table">
							<el-table :data="proxyList" style="width: 100%" :max-height="280" :empty-text="pub.lang('暂无数据')">
								<el-table-column prop="proxy_name" :label="pub.lang('名称')" min-width="160" show-overflow-tooltip />
								<el-table-column prop="proxy_ip" :label="pub.lang('IP')" min-width="160" show-overflow-tooltip />
								<el-table-column prop="proxy_port" :label="pub.lang('端口')" width="80" />
								<el-table-column prop="proxy_type" :label="pub.lang('类型')" width="90">
									<template #default="{ row }">
										{{ row.proxy_type === 0 ? 'HTTP' : row.proxy_type === 1 ? 'HTTPS' : 'SOCKS5' }}
									</template>
								</el-table-column>
								<el-table-column :label="pub.lang('操作')" align="right" width="120">
									<template #default="{ row }">
										<el-button link size="small" type="primary" @click="editProxy(row)">{{ pub.lang('编辑') }}</el-button>
										<el-button link size="small" type="primary" @click="removeProxy(row)">{{ pub.lang('删除') }}</el-button>
									</template>
								</el-table-column>
							</el-table>
						</div>
					</section>
				</div>
			</el-tab-pane>
			<el-tab-pane :label="pub.lang('关于')" name="about" lazy>
				<About :version="configData.version" />
			</el-tab-pane>
			<el-tab-pane :label="pub.lang('更新记录')" name="changelog" lazy>
				<Changelog :version="configData.version" />
			</el-tab-pane>
		</el-tabs>

		<!-- 添加、编辑代理 -->
		<addProxy ref="proxyRef" @refresh="getProxyList" />
		<NotPassword ref="notpwRef" @close="configData.not_password = false" @refresh="getConfig" />
	</div>
</template>

<script lang="ts" setup>
import { useRouter } from 'vue-router'
import { ElMessageBox } from 'element-plus'
import { storeToRefs } from 'pinia'
import { useSettingStore } from '@/store/setting'
import { useUserStore } from '@/store/user'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import addProxy from './components/addProxy.vue'
import NotPassword from './components/notPassword.vue'
import About from './components/about.vue'
import Changelog from './components/changelog.vue'
import { useLanguage } from '@plugins/language'
import { useTheme } from '@/plugins/theme'
import { pub,formatTime } from '@utils/tools'

const router = useRouter()
const Message = useMessage() // 消息提示
const { switchDark } = useTheme()
const { setLanguage } = useLanguage()

const useStore = useSettingStore()
const useUStore = useUserStore()
const { dark } = storeToRefs(useStore)
const { info, isLogin } = storeToRefs(useUStore)
const Theme = ref('lightMode')
const activeTab = ref('setting')

const proxyRef = ref()
const languageList = ref(window.languageList.languages)
const languageType = ref(window.languageList.current)
const notpwRef = ref()
const panelInfo = ref({})
const proxyList = ref([])
const cacheSaving = ref(false)
const cacheClearing = ref(false)
const cacheLimitMb = ref(100)
const cacheInfo = reactive({ entries: 0, used_bytes: 0, max_bytes: 100 * 1024 * 1024, max_mb: 100, retention_days: 7 })
const cacheUsagePercentage = computed(() => cacheInfo.max_bytes ? Math.min(100, Math.round(cacheInfo.used_bytes / cacheInfo.max_bytes * 100)) : 0)
const configData: {
	exit_action: string
	not_password: boolean
	version: string
} = reactive({
	exit_action: 'close', // 关闭按钮
	not_password: false, // 免密登录
	version: '',
})

// 账号
const account = computed(() => {
	//将中间四位替换为*
	return (
		info.value.username.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') || pub.lang('[未绑定宝塔账号]')
	)
})
// 获取配置信息
const getConfig = () => {
	common.send(routes.index.get_config.path, {}, (result: any) => {
		const { exit_action, not_password, version } = result.data
		configData.exit_action = exit_action || 'close'
		configData.not_password = not_password || false
		configData.version = version
	})
}
// 设置免密登录
const hanelNotPassword = async (val: any) => {
	if (val) {
		notpwRef.value.acceptParams({ notpw: true })
	} else {
		const res: any = await setConfig('not_password', false)
		Message.request(res)
	}
}
// 修改管理密码
const handleEditManage = () => {
	notpwRef.value.acceptParams({ isEdit: true })
}
// 关闭按钮
const handleExit = async () => {
	const res: any = await setConfig('exit_action', configData.exit_action)
	Message.request(res)
}

// 配置保存
const setConfig = async (key: string, value: any) => {
	return await common.sendAsync({ route: routes.index.set_config.path, data: { key, value } })
}

const applyCacheInfo = (data: any) => {
	Object.assign(cacheInfo, data || {})
	cacheLimitMb.value = cacheInfo.max_mb || 100
}
const getCacheInfo = async () => {
	const result: any = await common.sendAsync({ route: routes.aliyun.cache_info.path, data: {} })
	if (result?.status) applyCacheInfo(result.data)
}
const saveCacheLimit = async () => {
	cacheSaving.value = true
	try {
		const result: any = await common.sendAsync({ route: routes.aliyun.cache_set_limit.path, data: { max_mb: cacheLimitMb.value } })
		Message.request(result)
		if (result?.status) applyCacheInfo(result.data)
	} finally { cacheSaving.value = false }
}
const clearAliyunCache = async () => {
	try {
		await ElMessageBox.confirm(pub.lang('确认清理全部阿里云 URL 分析缓存？账号和业务数据不会受到影响。'), pub.lang('清理缓存'), {
			confirmButtonText: pub.lang('确认'),
			cancelButtonText: pub.lang('取消'),
			type: 'warning',
		})
	} catch (_error) { return }
	cacheClearing.value = true
	try {
		const result: any = await common.sendAsync({ route: routes.aliyun.cache_clear.path, data: {} })
		Message.request(result)
		if (result?.status) applyCacheInfo(result.data)
	} finally { cacheClearing.value = false }
}
const formatBytes = (value: number) => {
	const bytes = Math.max(0, Number(value) || 0)
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / 1024 ** 2).toFixed(2)} MB`
}

// 获取代理列表
const getProxyList = () => {
	common.send(routes.proxy.getProxyList.path, {}, (result: any) => {
		proxyList.value = result.data
	})
}
// 添加代理
const handleAddProxy = () => {
	proxyRef.value.acceptParams({})
}
// 编辑代理
const editProxy = (row: any) => {
	proxyRef.value.acceptParams(row)
}
// 删除代理
const removeProxy = (row: any) => {
	ElMessageBox.confirm(
		pub.lang('是否将【{}】从列表中删除?', row.proxy_name),
		pub.lang('删除代理'),
		{
			confirmButtonText: pub.lang('确认'),
			cancelButtonText: pub.lang('取消'),
			type: 'warning',
		}
	).then(async () => {
		let res: any = await common.sendAsync({
			route: routes.proxy.delProxy.path,
			data: {
				proxy_id: row.proxy_id,
			},
		})
		Message.request(res)
		if (res.status) {
			getProxyList()
		}
	})
}

// 主题切换
const handleTheme = (command: any) => {
	dark.value = command === 'darkMode'
	Theme.value = command
	switchDark()
}

// 检查更新
const handelCheckUpdate = () => {
	console.log('检查更新')
	common.send(routes.index.check_update.path, {}, (result: any) => {
		console.log('result:', result)
	})
}

// 中英文切换
const handleLang = (command: any) => {
	setLanguage(command, true)
	window.location.reload()
}
// 解绑账号
const handleUnbind = () => {
	common.send(routes.user.unbind.path, {}, (result: any) => {
		if (result.status) {
			isLogin.value = false
			router.push({ path: '/login' })
		}
	})
}
onMounted(async () => {
	Theme.value = dark.value ? 'darkMode' : 'lightMode'
	await useUStore.getBindUser()
	// 获取代理列表
	getProxyList()
	getCacheInfo()

	// 获取配置信息
	getConfig()
})
</script>

<style scoped lang="scss">
.setting-style {
	max-width: 112rem;
	padding: 2.4rem 3.6rem 3.6rem;
	color: var(--el-text-color-primary);
}
.setting-tabs {
	:deep(.el-tabs__header) {
		height: 4rem;
		margin-bottom: 2.4rem;
	}
	:deep(.el-tabs__item) {
		height: 4rem !important;
		line-height: 4rem;
		font-size: 1.4rem;
	}
	:deep(.el-tabs__content) {
		padding: 0 !important;
		overflow: visible;
	}
}
.settings-content {
	display: grid;
	gap: 2rem;
}
.setting-section {
	min-width: 0;
	overflow: hidden;
	border: 1px solid var(--el-border-color);
	border-radius: 0.8rem;
	background: var(--el-bg-color);
}
.setting-section__header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 1.6rem;
	min-height: 5.6rem;
	padding: 1.2rem 2rem;
	background: var(--el-fill-color-light);

	h2 {
		margin: 0;
		font-size: 1.4rem;
		font-weight: 600;
		line-height: 2.4rem;
	}
}
.setting-row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 2.4rem;
	min-height: 6.8rem;
	padding: 1.6rem 2rem;
	border-top: 1px solid var(--el-border-color-lighter);
}
.setting-row__info {
	flex: 1;
	min-width: 0;

	h3 {
		margin: 0;
		font-size: 1.3rem;
		font-weight: 500;
		line-height: 2rem;
	}
	p {
		max-width: 44rem;
		margin: 0.4rem 0 0;
		color: var(--el-text-color-regular);
		font-size: 1.2rem;
		line-height: 1.7;
		overflow-wrap: anywhere;
	}
	.account-value {
		user-select: text;
	}
}
.setting-row__actions {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: flex-end;
	flex-wrap: wrap;
	gap: 0.8rem;
	max-width: 100%;

	:deep(.el-button + .el-button) {
		margin-left: 0;
	}
	:deep(.el-radio-group) {
		gap: 0.4rem 1.6rem;
	}
	:deep(.el-radio) {
		margin-right: 0;
	}
}
.language-select {
	width: 14rem;
}
.cache-overview {
	padding: 1.8rem 2rem;
	border-top: 1px solid var(--el-border-color-lighter);
}
.cache-stats {
	display: grid;
	grid-template-columns: repeat(3, minmax(0, 1fr));
	gap: 1.6rem;
	margin: 0 0 1.6rem;

	dt {
		color: var(--el-text-color-regular);
		font-size: 1.2rem;
		line-height: 2rem;
	}
	dd {
		margin: 0.6rem 0 0;
		font-size: 1.6rem;
		font-weight: 600;
		line-height: 2.4rem;
		overflow-wrap: anywhere;
	}
	span {
		color: var(--el-text-color-regular);
		font-size: 1.2rem;
		font-weight: 400;
	}
}
.cache-note {
	margin: 1.2rem 0 0;
	color: var(--el-text-color-regular);
	font-size: 1.2rem;
	line-height: 1.7;
}
.cache-limit {
	display: flex;
	align-items: center;
	gap: 0.8rem;

	.el-input-number {
		width: 14rem;
	}
}
.proxy-table {
	padding: 0 2rem 2rem;
}
@media (max-width: 800px) {
	.setting-style {
		padding: 1.6rem 2rem 2.4rem;
	}
	.setting-row {
		flex-direction: column;
		align-items: stretch;
		gap: 1.2rem;
	}
	.setting-row__actions {
		justify-content: flex-start;
	}
}
@media (max-width: 600px) {
	.cache-stats {
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;

		> div {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 1.6rem;
		}
		dd {
			margin: 0;
		}
	}
}
</style>
