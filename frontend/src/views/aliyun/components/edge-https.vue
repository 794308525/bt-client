<template>
	<el-drawer v-model="visible" :size="680" :title="`${scope?.product.toUpperCase() || ''} HTTPS 配置 · ${scope?.name || ''}`" :before-close="beforeClose" :close-on-click-modal="!busy" :close-on-press-escape="!busy" @closed="!visible && reset()">
		<div v-loading="loading" class="https-content">
			<el-alert v-if="error" type="error" :closable="false" :title="error"><el-button link type="primary" @click="load">{{ pub.lang('重新读取') }}</el-button></el-alert>
			<template v-if="config && !error">
				<section class="https-section">
					<div class="section-heading"><div><h3>{{ pub.lang('HTTPS 证书') }}</h3><p>{{ scope?.product === 'esa' ? pub.lang('证书加入当前站点的证书池，由 ESA 匹配覆盖域名。') : pub.lang('上传证书后配置到当前加速域名，并开启 HTTPS。') }}</p></div><el-button :disabled="busy" @click="uploadVisible ? clearCertificate() : uploadVisible = true">{{ pub.lang(uploadVisible ? '收起上传' : '上传证书') }}</el-button></div>
					<div class="https-state"><span>{{ pub.lang('HTTPS 状态') }}</span><el-tag :type="config.https_enabled === true ? 'success' : 'info'">{{ pub.lang(config.https_enabled === null ? '未确认' : config.https_enabled ? '已开启' : '未开启') }}</el-tag><el-button link :icon="Refresh" :disabled="busy" @click="load">{{ pub.lang('刷新') }}</el-button></div>
					<el-table v-if="scope?.product === 'cdn' && config.certificates?.length" :data="config.certificates" size="small" class="certificate-table">
						<el-table-column prop="name" :label="pub.lang('证书名称')" min-width="160" show-overflow-tooltip />
						<el-table-column prop="issuer" :label="pub.lang('签发机构')" min-width="130" show-overflow-tooltip />
						<el-table-column :label="pub.lang('有效期至')" width="150"><template #default="{ row }">{{ dateText(row.not_after) }}</template></el-table-column>
					</el-table>
					<el-form v-if="uploadVisible" class="upload-form" label-position="top" :disabled="busy" @submit.prevent="upload">
						<el-form-item :label="pub.lang('证书名称（选填）')"><el-input v-model="certificate.name" maxlength="128" :placeholder="pub.lang('留空自动生成；支持字母、数字、点、下划线和连字符')" autocomplete="off" /></el-form-item>
						<el-form-item :label="pub.lang('PEM 证书链')" required><el-input v-model="certificate.certificate" type="textarea" :rows="6" placeholder="-----BEGIN CERTIFICATE-----" spellcheck="false" autocomplete="off" class="pem-input" /></el-form-item>
						<el-form-item :label="pub.lang('KEY 私钥')" required><el-input v-model="certificate.private_key" type="textarea" :rows="5" :placeholder="pub.lang('粘贴无密码保护的 PEM 私钥')" spellcheck="false" autocomplete="off" class="pem-input" /></el-form-item>
						<p class="form-note">{{ pub.lang('提交时，证书和私钥将发送至阿里云部署；本表单不额外保存私钥，关闭后清空。证书链中服务器证书应放在第一段。') }}</p>
						<el-alert v-if="uploadError" type="error" :title="uploadError" :closable="false" />
						<div class="form-actions"><el-button :disabled="busy" @click="clearCertificate">{{ pub.lang('取消') }}</el-button><el-button type="primary" native-type="submit" :loading="uploading" :disabled="busy || !certificate.certificate.trim() || !certificate.private_key.trim()">{{ pub.lang('上传并部署') }}</el-button></div>
					</el-form>
				</section>
				<section v-if="scope?.product === 'cdn'" class="https-section">
					<div class="section-heading"><div><h3>{{ pub.lang('强制 HTTPS') }}</h3><p>{{ pub.lang('将访问当前域名的 HTTP 请求跳转为 HTTPS。') }}</p></div></div>
					<el-alert v-if="config.notice" :title="config.notice" type="warning" :closable="false" />
					<el-alert v-if="!config.can_enable && !config.read_only" :title="pub.lang('开启前需要 HTTPS 已启用，且已配置有效证书。')" type="info" :closable="false" />
					<el-form label-width="110px" class="force-form" :disabled="busy || config.read_only">
						<el-form-item :label="pub.lang('强制 HTTPS')"><el-switch v-model="form.enabled" :disabled="config.enabled !== true && !config.can_enable" /><span class="switch-label">{{ pub.lang(form.enabled ? '开启' : '关闭') }}</span></el-form-item>
						<el-form-item :label="pub.lang('跳转状态码')"><el-select v-model="form.code" :disabled="!form.enabled" class="code-select"><el-option v-for="code in codes" :key="code" :label="`${code}${code === '301' ? ' · ' + pub.lang('默认') : ''}`" :value="code" /></el-select></el-form-item>
					</el-form>
					<el-alert v-if="form.enabled && config.http_conflict" type="warning" :closable="false" :title="pub.lang('当前存在强制 HTTP 配置，与强制 HTTPS 冲突。')">
						<span v-if="config.rule_count">{{ pub.lang('含条件规则，请先到阿里云控制台处理冲突。') }}</span>
						<el-checkbox v-else v-model="form.replace_http_force" :disabled="busy">{{ pub.lang('移除原强制 HTTP 配置，改为强制 HTTPS') }}</el-checkbox>
					</el-alert>
					<p class="form-note">{{ pub.lang('仅调整全局跳转设置，已有 HSTS 和条件规则继续生效。301 可能改变非 GET 请求的方法；308 保留请求方法和请求体。') }}<span v-if="config.rule_count"> {{ pub.lang('当前另有 {} 条条件规则，请注意各规则的适用范围。', config.rule_count) }}</span></p>
					<el-alert v-if="saveError" type="error" :title="saveError" :closable="false" />
					<div class="form-actions"><el-button type="primary" :loading="saving" :disabled="!canSave" @click="save">{{ pub.lang('保存 HTTPS 设置') }}</el-button></div>
				</section>
				<el-alert v-if="scope?.product === 'esa'" :title="pub.lang('访问协议请在解析记录列表中按域名选择：原样、HTTP → HTTPS、HTTPS → HTTP。')" type="info" :closable="false" />
			</template>
		</div>
		<template #footer><el-button :disabled="busy" @click="visible = false">{{ pub.lang('关闭') }}</el-button></template>
	</el-drawer>
</template>

<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue'
import { common, routes } from '@api/http'
import { pub } from '@utils/tools'
import { useMessage } from '@utils/hooks/message'

interface Scope { product: 'esa' | 'cdn'; name: string; site_id?: string; domain_name?: string }
interface HttpsConfig { enabled: boolean | null; https_enabled: boolean | null; can_enable: boolean; code: string; read_only: boolean; notice?: string; rule_count: number; http_conflict?: boolean; certificates?: Array<{ name: string; issuer: string; not_after: string }> }
const props = defineProps<{ accountId: number }>()
const emit = defineEmits<{ (event: 'changed', scope: Scope): void }>()
const Message = useMessage()
const visible = ref(false)
const scope = ref<Scope>()
const config = ref<HttpsConfig>()
const loading = ref(false)
const saving = ref(false)
const uploading = ref(false)
const error = ref('')
const saveError = ref('')
const uploadError = ref('')
const uploadVisible = ref(false)
const form = reactive({ enabled: false, code: '301', replace_http_force: false })
const certificate = reactive({ name: '', certificate: '', private_key: '' })
const busy = computed(() => loading.value || saving.value || uploading.value)
const codes = computed(() => scope.value?.product === 'esa' ? ['301', '302', '307', '308'] : ['301', '308'])
const canSave = computed(() => config.value && !busy.value && !config.value.read_only && codes.value.includes(form.code) && (!form.enabled || config.value.can_enable) && (!form.enabled || !config.value.http_conflict || form.replace_http_force && !config.value.rule_count))
let generation = 0
const request = (operation: 'https_get' | 'https_set' | 'certificate_upload', data: Record<string, unknown> = {}) => {
	const route = routes.aliyun[`${scope.value!.product}_${operation}` as keyof typeof routes.aliyun]
	return common.sendAsync({ route: route.path, data: { account_id: props.accountId, site_id: scope.value!.site_id, domain_name: scope.value!.domain_name, ...data }, timeout: 70000 }) as Promise<any>
}
const message = (exception: unknown) => exception instanceof Error ? exception.message : pub.lang('操作失败，请重试')
const dateText = (value: string) => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('zh-CN') : value || '--'
const clearCertificate = () => { Object.assign(certificate, { name: '', certificate: '', private_key: '' }); uploadVisible.value = false; uploadError.value = '' }
const reset = () => { ++generation; clearCertificate(); config.value = undefined; error.value = ''; saveError.value = '' }
const beforeClose = (done: () => void) => { if (!busy.value) done() }
const load = async () => {
	if (!scope.value) return
	const id = ++generation
	loading.value = true
	error.value = ''
	try {
		const result = await request('https_get')
		if (id !== generation || !visible.value) return
		if (!result?.status) throw new Error(result?.msg || pub.lang('HTTPS 配置读取失败'))
		config.value = result.data
		Object.assign(form, { enabled: result.data.enabled === true, code: result.data.code || '301', replace_http_force: false })
	} catch (exception) { if (id === generation) error.value = message(exception) }
	finally { if (id === generation) loading.value = false }
}
const open = (target: Scope, uploadFirst = false) => {
	if (busy.value) return
	reset()
	scope.value = { ...target }
	uploadVisible.value = uploadFirst
	visible.value = true
	load()
}
const upload = async () => {
	if (busy.value || !scope.value) return
	const id = generation
	const target = { ...scope.value }
	uploading.value = true
	uploadError.value = ''
	try {
		const result = await request('certificate_upload', { ...certificate })
		if (id !== generation) return
		if (!result?.status) throw new Error(result?.msg || pub.lang('证书上传失败'))
		Message.success(pub.lang('证书已上传：{}', result.data.name))
		clearCertificate()
		emit('changed', target)
		await load()
	} catch (exception) { if (id === generation) uploadError.value = `${message(exception)}${message(exception).includes('超时') ? '；请先刷新证书核对结果，再决定是否重新提交。' : ''}` }
	finally { uploading.value = false }
}
const save = async () => {
	if (!canSave.value || !scope.value) return
	const id = generation
	const target = { ...scope.value }
	saving.value = true
	saveError.value = ''
	try {
		const result = await request('https_set', { ...form })
		if (id !== generation) return
		if (!result?.status) throw new Error(result?.msg || pub.lang('HTTPS 设置保存失败'))
		Message.success(pub.lang('设置已提交，请等待阿里云下发生效'))
		emit('changed', target)
		await load()
	} catch (exception) { if (id === generation) saveError.value = message(exception) }
	finally { saving.value = false }
}
onBeforeUnmount(() => { ++generation; clearCertificate() })
defineExpose({ open })
</script>

<style scoped lang="scss">
.https-content { min-height: 160px; }
.https-section { padding: 0 0 24px; & + & { padding-top: 24px; border-top: 1px solid var(--el-border-color-lighter); } }
.section-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; h3 { margin: 0 0 8px; font-size: 16px; } p { margin: 0; color: var(--el-text-color-secondary); line-height: 1.6; font-size: 13px; } }
.https-state { display: flex; align-items: center; gap: 12px; font-size: 13px; }
.certificate-table { margin-top: 16px; }
.upload-form { margin-top: 20px; padding: 18px; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-fill-color-extra-light); }
.pem-input :deep(textarea) { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
.form-note { margin: 14px 0; font-size: 12px; color: var(--el-text-color-secondary); line-height: 1.8; }
.force-form { margin-top: 20px; }
.switch-label { margin-left: 12px; color: var(--el-text-color-secondary); font-size: 13px; }
.code-select { width: 180px; }
.form-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
</style>
