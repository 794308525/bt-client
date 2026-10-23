<template>
	<el-dialog v-model="visible" :title="`连接服务器 · ${name}`" width="min(650px, 95vw)" :close-on-click-modal="false" :close-on-press-escape="stage !== 'authorizing'" :show-close="stage !== 'authorizing'" :before-close="beforeClose" destroy-on-close @closed="finishConnection">
		<el-alert v-if="busy" :title="stageText" type="info" :closable="false" show-icon />
		<el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="connect-alert" />
		<el-form label-width="100px" :disabled="busy" class="connect-form">
			<el-form-item label="连接地址"><el-select v-model="form.host" class="full"><el-option v-for="address in addresses" :key="address" :value="address" :label="address" /></el-select></el-form-item>
			<el-form-item label="SSH 端口"><el-input-number v-model="form.port" :min="1" :max="65535" :controls="false" /></el-form-item>
			<el-form-item label="用户名"><el-input v-model="form.username" placeholder="root / ecs-user / ubuntu" autocomplete="off" /></el-form-item>
			<el-form-item v-if="credentials.length" label="本地凭证"><el-select v-model="form.credential_id" class="full" @change="chooseCredential"><el-option label="输入新的密码 / 私钥" value="" /><el-option v-for="item in credentials" :key="item.id" :label="item.name" :value="item.id" /></el-select></el-form-item>
			<template v-if="!form.credential_id">
				<el-form-item label="认证方式"><el-radio-group v-model="form.auth_type"><el-radio :label="0">密码</el-radio><el-radio :label="1">SSH 私钥</el-radio></el-radio-group></el-form-item>
				<el-form-item v-if="form.auth_type === 0" label="密码"><el-input v-model="form.password" type="password" show-password autocomplete="new-password" /></el-form-item>
				<template v-else>
					<el-form-item label="SSH 私钥"><el-input v-model="form.private_key" type="textarea" :rows="4" placeholder="粘贴 SSH 私钥内容" /><label class="key-file">选择私钥文件<input type="file" @change="readKey" /></label></el-form-item>
					<el-form-item label="私钥口令"><el-input v-model="form.key_password" type="password" show-password placeholder="私钥有口令时填写" autocomplete="new-password" /></el-form-item>
				</template>
			</template>
			<el-form-item v-if="form.credential_id && form.auth_type === 1" label="私钥口令"><el-input v-model="form.key_password" type="password" show-password placeholder="已保存的私钥需要口令时填写" autocomplete="new-password" /></el-form-item>
			<el-form-item v-if="proxies.length" label="连接代理"><el-select v-model="form.proxy_id" class="full"><el-option label="直接连接" :value="0" /><el-option v-for="proxy in proxies" :key="proxy.id" :label="proxy.name" :value="proxy.id" /></el-select></el-form-item>
			<el-form-item><el-checkbox v-model="form.save">连接成功后，加密保存凭证到本机</el-checkbox></el-form-item>
		</el-form>
		<section v-if="fingerprint" class="connect-fingerprint"><strong>{{ fingerprintChanged ? '服务器主机指纹已变化' : '首次连接，确认主机指纹' }}</strong><code>{{ fingerprint }}</code><p>{{ fingerprintChanged ? '请核对是否重装或更换服务器。确认无误后才会发送登录凭证。' : '请与服务器主机指纹核对，确认后继续认证。' }}</p><el-button :disabled="busy" type="warning" @click="attempt(true, true)">确认此指纹并连接</el-button></section>
		<section v-if="network" class="connect-network">
			<strong>云端网络检查</strong><p>{{ network.message }}</p>
			<small v-if="network.source_ip">检测出口 IP：{{ network.source_ip }}{{ form.proxy_id ? '（通过所选代理）' : '' }}</small>
			<template v-if="network.state === 'missing' && network.plan_id">
				<el-form label-width="95px" :disabled="busy">
					<el-form-item label="目标规则"><span>{{ form.host }} · TCP/{{ network.port }}</span></el-form-item>
					<el-form-item label="规则位置"><el-select v-model="groupId" class="full"><el-option v-for="group in network.groups" :key="group.id" :value="group.id" :label="group.name" /></el-select></el-form-item>
					<el-form-item label="影响范围"><span>{{ network.groups.find(group => group.id === groupId)?.effect }}</span></el-form-item>
					<el-form-item label="允许来源"><el-radio-group v-model="allowScope"><el-radio label="self">仅本机出口 IP {{ network.source_ip }}/32</el-radio><el-radio label="any">任意 IP（0.0.0.0/0）</el-radio></el-radio-group></el-form-item>
				</el-form>
				<el-alert v-if="allowScope === 'any'" type="warning" :closable="false" title="此端口将允许任意公网 IPv4 地址访问。" show-icon />
				<p class="connect-caption">只新增所示 TCP 端口的入站规则。规则会保留，可在云控制台删除本次新增规则恢复原策略。</p>
				<el-button type="warning" :disabled="busy || !groupId" @click="authorize">确认放行并重试连接</el-button>
			</template>
		</section>
		<el-alert v-if="grant" type="info" :closable="false" class="connect-alert" :title="`已提交放行：TCP/${grant.port}，来源 ${grant.source}；规则 ${grant.rule_ids?.join('、') || '请在控制台核对'}。关闭窗口不会删除云端规则。`" />
		<template #footer><div class="connect-footer"><el-button v-if="failureKind === 'network'" :disabled="busy" @click="diagnose">重新检查云端规则</el-button><div><el-button :disabled="stage === 'authorizing'" @click="close">{{ busy ? '取消连接' : '取消' }}</el-button><el-button type="primary" :loading="busy" :disabled="busy || !!fingerprint" @click="attempt(false)">连接</el-button></div></div></template>
	</el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, reactive, ref, watch } from 'vue'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'

interface Server { source: 'ecs' | 'swas' | 'cvm' | 'lighthouse'; instance_id: string; region_id: string; name: string }
interface Credential { id: string; name: string; host: string; username: string; port: number; auth_type: number; proxy_id: number }
interface Network { state: string; message: string; source_ip?: string; port?: number; plan_id?: string; groups: Array<{ id: string; name: string; effect: string }> }
const props = withDefaults(defineProps<{ accountId: number; provider?: 'aliyun' | 'tencent' }>(), { provider: 'aliyun' })
const emit = defineEmits<{ (event: 'connected', value: Record<string, unknown>): void }>()
const Message = useMessage()
const visible = ref(false), name = ref(''), jobId = ref(''), stage = ref(''), error = ref(''), fingerprint = ref(''), fingerprintChanged = ref(false), failureKind = ref('')
const addresses = ref<string[]>([]), proxies = ref<Array<{ id: number; name: string }>>([]), credentials = ref<Credential[]>([])
const network = ref<Network>(), grant = ref<any>(), groupId = ref(''), allowScope = ref<'self' | 'any'>('self')
const form = reactive({ host: '', port: 22, username: 'root', auth_type: 0, password: '', private_key: '', key_password: '', proxy_id: 0, credential_id: '', save: true })
let generation = 0, transferred = false
let pendingConnection: Record<string, unknown> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let stopWaiting: (() => void) | undefined
const busy = computed(() => !!stage.value)
const stageText = computed(() => ({ preparing: '正在读取实例及本地凭证…', connecting: '正在建立 SSH 连接并创建终端…', diagnosing: '正在查询出口 IP 和云端网络规则…', authorizing: '正在提交授权并回查规则…', waiting: '等待规则生效，稍后重试连接…' } as Record<string, string>)[stage.value] || '')
const call = async (key: string, data: Record<string, unknown>) => {
	const result: any = await common.sendAsync({ route: (routes[props.provider] as any)[key].path, data: { account_id: props.accountId, ...data }, timeout: 90000 })
	if (!result?.status) throw new Error(result?.msg || '操作失败，请重试')
	return result.data
}
const cancel = (id: string) => { if (id) call('ssh_cancel', { job_id: id }).catch(() => {}) }
const resetSecrets = () => { form.password = ''; form.private_key = ''; form.key_password = '' }
const chooseCredential = (value: string) => {
	const item = credentials.value.find(item => item.id === value)
	if (item) Object.assign(form, { host: item.host, port: item.port, username: item.username, auth_type: item.auth_type, proxy_id: item.proxy_id })
	resetSecrets()
}
const diagnose = async () => {
	const id = generation
	stage.value = 'diagnosing'; network.value = undefined
	try {
		const result = await call('ssh_diagnose', { job_id: jobId.value })
		if (id !== generation) return
		network.value = result
		grant.value = result.grant || grant.value
		groupId.value = result.groups?.[0]?.id || ''
		allowScope.value = 'self'
	} catch (exception) { if (id === generation) error.value = exception instanceof Error ? exception.message : '查询云端规则失败' }
	finally { if (id === generation) stage.value = '' }
}
const attempt = async (reuse = false, acceptFingerprint = false, inspectFailure = true): Promise<string> => {
	if (!jobId.value) return 'error'
	const id = generation
	stage.value = 'connecting'; error.value = ''; network.value = undefined
	try {
		const result = await call('ssh_connect', { job_id: jobId.value, ...(!reuse ? { ...form } : { reuse_attempt: true, save: form.save }), accept_fingerprint: acceptFingerprint })
		if (id !== generation) return 'cancelled'
		grant.value = result.grant || grant.value
		if (result.state === 'ready') {
			if (result.save_error) Message.error(result.save_error)
			pendingConnection = { ...result, job_id: jobId.value }
			visible.value = false; stage.value = ''
			resetSecrets()
			return 'ready'
		}
		failureKind.value = result.kind
		error.value = result.message
		fingerprint.value = result.fingerprint || ''; fingerprintChanged.value = !!result.fingerprint_changed
		if (result.kind === 'authentication') { form.credential_id = ''; form.password = ''; form.key_password = '' }
		if (result.kind === 'network' && inspectFailure) await diagnose()
		return result.kind || 'error'
	} catch (exception) { if (id === generation) error.value = exception instanceof Error ? exception.message : '连接失败'; return 'error' }
	finally { if (id === generation) stage.value = '' }
}
const waitRetry = () => new Promise<void>(resolve => { stopWaiting = resolve; retryTimer = setTimeout(() => { stopWaiting = undefined; resolve() }, 3000) })
const authorize = async () => {
	if (!network.value?.plan_id || busy.value) return
	const id = generation
	stage.value = 'authorizing'; error.value = ''
	try {
		const result = await call('ssh_authorize', { job_id: jobId.value, plan_id: network.value.plan_id, group_id: groupId.value, scope: allowScope.value, confirmed: true })
		if (id !== generation) return
		grant.value = result.grant || grant.value
		network.value = undefined
		if (result.state !== 'authorized') { error.value = result.message; return }
		for (let attemptIndex = 0; attemptIndex < 3; attemptIndex++) {
			stage.value = 'waiting'; await waitRetry()
			if (id !== generation) return
			const kind = await attempt(true, false, false)
			if (kind !== 'network') return
		}
		if (id === generation) await diagnose()
	} catch (exception) { if (id === generation) error.value = exception instanceof Error ? exception.message : '授权失败，请重新检查规则' }
	finally { if (id === generation) stage.value = '' }
}
const readKey = async (event: Event) => {
	const input = event.target as HTMLInputElement, file = input.files?.[0]
	const id = generation
	if (!file) return
	try { if (file.size > 65536) throw new Error('私钥文件不能超过 64 KB'); const text = await file.text(); if (id === generation && visible.value) form.private_key = text }
	catch (exception) { if (id === generation && visible.value) error.value = exception instanceof Error ? exception.message : '私钥文件读取失败' }
	finally { input.value = '' }
}
const dispose = () => {
	generation++; clearTimeout(retryTimer); stopWaiting?.(); stopWaiting = undefined
	if (!transferred) cancel(jobId.value)
	pendingConnection = undefined
	jobId.value = ''; stage.value = ''; visible.value = false; resetSecrets()
}
const finishConnection = () => {
	if (!pendingConnection || visible.value) return
	const connection = pendingConnection
	pendingConnection = undefined; transferred = true
	emit('connected', connection)
}
const close = () => { if (stage.value !== 'authorizing') dispose() }
const beforeClose = (done: () => void) => { if (stage.value === 'authorizing') return; dispose(); done() }
const open = async (server: Server) => {
	if (stage.value === 'authorizing') return
	dispose(); transferred = false
	const id = generation
	name.value = server.name; visible.value = true; stage.value = 'preparing'; error.value = ''; fingerprint.value = ''; failureKind.value = ''; network.value = undefined; grant.value = undefined
	addresses.value = []; credentials.value = []; proxies.value = []
	Object.assign(form, { host: '', port: 22, username: 'root', auth_type: 0, proxy_id: 0, credential_id: '', save: true })
	try {
		// 只传实例标识，避免服务器对象中的响应式数组进入 IPC。
		const result = await call('ssh_prepare', { source: server.source, instance_id: server.instance_id, region_id: server.region_id })
		if (id !== generation) { cancel(result.job_id); return }
		jobId.value = result.job_id; addresses.value = result.addresses; credentials.value = result.credentials; proxies.value = result.proxies
		Object.assign(form, result.defaults); stage.value = ''
		if (form.credential_id === 'saved') await attempt(false)
	} catch (exception) { if (id === generation) error.value = exception instanceof Error ? exception.message : '无法读取服务器连接信息' }
	finally { if (id === generation) stage.value = '' }
}
watch(() => [form.host, form.port, form.username, form.proxy_id, form.credential_id, form.auth_type, form.password, form.private_key, form.key_password], () => { if (!busy.value) { network.value = undefined; fingerprint.value = ''; failureKind.value = '' } }, { flush: 'sync' })
onDeactivated(dispose)
onBeforeUnmount(dispose)
watch(() => [props.accountId, props.provider], dispose)
defineExpose({ open })
</script>

<style scoped lang="scss">
.connect-form { margin-top: 1.5rem; }
.full { width: 100%; }
.connect-alert { margin-top: 1rem; }
.connect-network, .connect-fingerprint { margin-top: 1rem; padding: 1.2rem; border: 1px solid var(--el-border-color); border-radius: .6rem; p { line-height: 1.6; } small { display: block; margin-bottom: 1rem; color: var(--el-text-color-secondary); } code { display: block; margin-top: 1rem; overflow-wrap: anywhere; } }
.connect-network .el-radio-group { display: flex; align-items: flex-start; flex-direction: column; }
.connect-caption { color: var(--el-text-color-secondary); font-size: 1.15rem; }
.connect-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; > div { margin-left: auto; } }
.key-file { display: block; color: var(--el-color-primary); cursor: pointer; input { display: none; } }
</style>
