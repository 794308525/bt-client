<template>
	<div class="pt-[2.4rem] px-[3.6rem] setting-style">
		<h1>{{ pub.lang('设置') }}</h1>
		<el-divider></el-divider>
		<el-form label-width="auto" size="large">
			<el-form-item :label="pub.lang('账号')">
				<el-input v-model="account" class="!w-[28rem] mr-4" disabled />
				<el-button type="primary" @click="handleUnbind">{{
					pub.lang(info.username ? '解绑' : '绑定')
				}}</el-button>
			</el-form-item>
			<el-form-item :label="pub.lang('同步至云端')">
				<el-switch v-model="configData.sync_cloud" @change="hanelCloudSync" />
				<el-button size="small" @click="handleSyncPassword" class="ml-8">{{
					pub.lang('同步密码')
				}}</el-button>
				<el-button
					size="small"
					:disabled="!configData.sync_cloud"
					@click="handle_sync"
					class="ml-8"
					>{{ pub.lang('手动同步') }}</el-button
				>
				<span class="ml-8 help-text-color">{{
					pub.lang('*开启同步后，同一账号及同步密码的其他设备将自动接收本设备的增量数据')
				}}</span>
			</el-form-item>
			<el-form-item :label="pub.lang('免密登录')">
				<el-switch v-model="configData.not_password" @change="hanelNotPassword" />
				<el-button size="small" @click="handleEditManage" class="ml-8">{{
					pub.lang('修改管理密码')
				}}</el-button>
				<span class="ml-8 help-text-color">{{
					pub.lang('*开启免密登录后，无需每次打开应用时输入管理密码')
				}}</span>
			</el-form-item>
			<el-form-item :label="pub.lang('主题颜色')">
				<el-radio-group v-model="Theme" @change="handleTheme">
					<el-radio value="lightMode">{{ pub.lang('明亮模式') }}</el-radio>
					<el-radio value="darkMode">{{ pub.lang('暗黑模式') }}</el-radio>
				</el-radio-group>
			</el-form-item>
			<el-form-item :label="pub.lang('关闭按钮')">
				<el-radio-group v-model="configData.exit_action" @change="handleExit">
					<el-radio value="close">{{ pub.lang('最小化到系统托盘') }}</el-radio>
					<el-radio value="exit">{{ pub.lang('关闭应用') }}</el-radio>
				</el-radio-group>
			</el-form-item>
			<el-form-item :label="pub.lang('当前版本')">
				<span>{{ configData.version }}</span>
				<!-- <el-button class="ml-8" size="small" @click="handelCheckUpdate">{{ pub.lang('检查更新') }}</el-button> -->
			</el-form-item>
			<el-form-item :label="pub.lang('系统语言')">
				<el-select v-model="languageType" style="width: 10rem" @change="handleLang">
					<el-option
						v-for="item in languageList"
						:key="item.name"
						:label="item.title"
						:value="item.name"></el-option>
				</el-select>
			</el-form-item>
		</el-form>
		<h1 class="mt-[4rem]">{{ pub.lang('阿里云缓存') }}</h1>
		<el-divider></el-divider>
		<div class="aliyun-cache">
			<div class="aliyun-cache__summary">
				<div><span>{{ pub.lang('当前占用') }}</span><strong>{{ formatBytes(cacheInfo.used_bytes) }} / {{ cacheInfo.max_mb }} MB</strong></div>
				<div><span>{{ pub.lang('缓存条目') }}</span><strong>{{ cacheInfo.entries }} {{ pub.lang('条') }}</strong></div>
				<div><span>{{ pub.lang('保留时间') }}</span><strong>{{ cacheInfo.retention_days }} {{ pub.lang('天') }}</strong></div>
			</div>
			<el-progress :percentage="cacheUsagePercentage" :show-text="false" :stroke-width="8" />
			<div class="aliyun-cache__actions">
				<span>{{ pub.lang('容量上限') }}</span>
				<el-input-number v-model="cacheLimitMb" :min="20" :max="2048" :step="50" :precision="0" controls-position="right" />
				<span>MB</span>
				<el-button :loading="cacheSaving" @click="saveCacheLimit">{{ pub.lang('保存') }}</el-button>
				<el-button type="danger" plain :loading="cacheClearing" :disabled="!cacheInfo.entries" @click="clearAliyunCache">{{ pub.lang('清理缓存') }}</el-button>
			</div>
			<p>{{ pub.lang('仅缓存 ESA 热门 URL 和 URL 用量的聚合结果，不保存原始日志、下载地址或 AccessKey。超过 7 天或容量上限时自动删除最旧数据。') }}</p>
		</div>
		<h1 class="mt-[4rem]">{{ pub.lang('代理池') }}</h1>
		<el-divider></el-divider>
		<el-button type="primary" size="large" @click="handleAddProxy" class="mb-[2rem]">{{
			pub.lang('添加代理')
		}}</el-button>

		<el-table
			:data="proxyList"
			style="width: 650px"
			height="280"
			:empty-text="pub.lang('暂无数据')">
			<el-table-column prop="proxy_name" :label="pub.lang('名称')"></el-table-column>
			<el-table-column prop="proxy_ip" :label="pub.lang('IP')" width="120"></el-table-column>
			<el-table-column prop="proxy_port" :label="pub.lang('端口')" width="80"></el-table-column>
			<el-table-column prop="proxy_type" :label="pub.lang('类型')" width="80">
				<template #default="{ row }">
					{{ row.proxy_type === 0 ? 'HTTP' : row.proxy_type === 1 ? 'HTTPS' : 'SOCKS5' }}
				</template>
			</el-table-column>
			<el-table-column :label="pub.lang('操作')" align="right" width="120">
				<template #default="{ row }">
					<el-button link size="small" type="primary" @click="editProxy(row)">{{
						pub.lang('编辑')
					}}</el-button>
					<el-button link size="small" type="primary" @click="removeProxy(row)">{{
						pub.lang('删除')
					}}</el-button>
				</template>
			</el-table-column>
		</el-table>

		<!-- 添加、编辑代理 -->
		<addProxy ref="proxyRef" @refresh="getProxyList" />
		<NotPassword ref="notpwRef" @close="configData.not_password = false" @refresh="getConfig" />
		<SyncPassword ref="syncpwRef" @refresh="getConfig" />
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
import SyncPassword from './components/syncPassword.vue'
import { useLanguage } from '@plugins/language'
import { useTheme } from '@/plugins/theme'
import { pub,formatTime } from '@utils/tools'
import { handle_sync } from './controller'

const router = useRouter()
const Message = useMessage() // 消息提示
const { switchDark } = useTheme()
const { setLanguage } = useLanguage()

const useStore = useSettingStore()
const useUStore = useUserStore()
const { dark } = storeToRefs(useStore)
const { info, isLogin } = storeToRefs(useUStore)
const Theme = ref('lightMode')

const proxyRef = ref()
const languageList = ref(window.languageList.languages)
const languageType = ref(window.languageList.current)
const notpwRef = ref()
const syncpwRef = ref()
const panelInfo = ref({})
const proxyList = ref([])
const cacheSaving = ref(false)
const cacheClearing = ref(false)
const cacheLimitMb = ref(100)
const cacheInfo = reactive({ entries: 0, used_bytes: 0, max_bytes: 100 * 1024 * 1024, max_mb: 100, retention_days: 7 })
const cacheUsagePercentage = computed(() => cacheInfo.max_bytes ? Math.min(100, Math.round(cacheInfo.used_bytes / cacheInfo.max_bytes * 100)) : 0)
const configData: {
	sync_cloud: boolean
	exit_action: string
	not_password: boolean
	sync_password: string
	version: string
} = reactive({
	sync_cloud: false, // 同步至云端
	sync_password: '', // 同步密码
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
		const { sync_cloud, sync_password, exit_action, not_password, version } = result.data
		configData.sync_cloud = (sync_cloud && sync_password != '') || false
		configData.sync_password = sync_password
		configData.exit_action = exit_action || 'close'
		configData.not_password = not_password || false
		configData.version = version
	})
}
// 同步至云端
const hanelCloudSync = async () => {
	if (!isLogin.value) {
		Message.error(pub.lang('请绑定宝塔账号后再开启同步至云端'))
		configData.sync_cloud = false
		return
	}
	if (!configData.sync_password) {
		configData.sync_cloud = false
		syncpwRef.value.acceptParams()
		return
	}
	const res: any = await setConfig('sync_cloud', configData.sync_cloud)
	Message.request(res)
	if (!res.status) {
		configData.sync_cloud = !configData.sync_cloud
	}
}
// 同步密码
const handleSyncPassword = () => {
	syncpwRef.value.acceptParams()
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
.aliyun-cache { width: min(72rem, 100%); padding: 1.4rem 1.6rem; border: 1px solid var(--el-border-color-lighter); border-radius: .8rem; background: var(--el-bg-color); }
.aliyun-cache__summary { display: grid; margin-bottom: 1.2rem; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.2rem; div { display: flex; flex-direction: column; gap: .35rem; } span { color: var(--el-text-color-secondary); } strong { font-size: 1.2rem; font-weight: 600; } }
.aliyun-cache__actions { display: flex; margin-top: 1.2rem; align-items: center; gap: .8rem; .el-input-number { width: 15rem; } }
.aliyun-cache > p { margin: 1rem 0 0; color: var(--el-text-color-placeholder); font-size: 1rem; }
// .setting-style {
// :deep(.el-from) {
// 	.el-form .el-form-item__label {
// 		font-size: inherit !important;
// 	}
// }
// }
</style>
