<template>
	<div class="toolbox-page">
		<header class="toolbox-header">
			<div class="toolbox-header__icon"><bt-icon name="toolbox" size="24" /></div>
			<div><h1>{{ pub.lang('工具箱') }}</h1><p>{{ pub.lang('常用运维工具集合') }}</p></div>
		</header>

		<div class="toolbox-layout">
			<aside class="toolbox-sidebar">
				<div class="toolbox-sidebar__title">{{ pub.lang('工具') }}</div>
				<button class="toolbox-menu-item active" type="button">
					<span class="toolbox-menu-item__icon"><el-icon><Lock /></el-icon></span>
					<span>{{ pub.lang('SSL 证书') }}</span>
				</button>
			</aside>

			<main class="toolbox-content">
				<div class="toolbox-content__heading">
					<div><h2>{{ pub.lang('SSL 证书') }}</h2><p>{{ pub.lang('统一申请、管理和下载多渠道证书') }}</p></div>
				</div>

				<el-tabs v-model="activeSection" class="ssl-tabs" @tab-change="handleSectionChange">
					<el-tab-pane :label="pub.lang('证书管理')" name="manage">
						<div class="ssl-toolbar">
							<div class="ssl-toolbar__filters">
								<el-input v-model="certificateKeyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索域名或订单号')" />
								<el-select v-model="certificateChannel" :placeholder="pub.lang('全部渠道')" @change="loadCertificates">
									<el-option :label="pub.lang('全部渠道')" :value="0" />
									<el-option v-for="channel in enabledChannels" :key="channel.channel_id" :label="channel.channel_name" :value="channel.channel_id" />
								</el-select>
								<el-select v-model="certificateStatus"><el-option :label="pub.lang('全部状态')" value="all" /><el-option v-for="status in certificateStatuses" :key="status" :label="statusName(status)" :value="status" /></el-select>
							</div>
							<el-button :icon="Refresh" :loading="certificateLoading" @click="loadCertificates">{{ pub.lang('刷新') }}</el-button>
						</div>
						<el-alert v-if="!enabledChannels.length" type="info" :closable="false" :title="pub.lang('请先在渠道设置中添加并启用证书渠道')" />
						<el-table v-else :data="pagedCertificates" v-loading="certificateLoading" row-key="certificate_key" class="ssl-table">
							<el-table-column :label="pub.lang('域名')" min-width="210"><template #default="{ row }"><div class="primary-text">{{ row.domain }}</div><div class="mono muted">{{ row.order_id }}</div></template></el-table-column>
							<el-table-column :label="pub.lang('渠道')" width="120"><template #default="{ row }">{{ row.channel_name }}</template></el-table-column>
							<el-table-column label="CA" width="140"><template #default="{ row }">{{ row.brand_name || row.brand || '--' }}</template></el-table-column>
							<el-table-column :label="pub.lang('验证方式')" width="110"><template #default="{ row }">{{ validateName(row.validate) }}</template></el-table-column>
							<el-table-column :label="pub.lang('状态')" width="120"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusName(row.status) }}</el-tag></template></el-table-column>
							<el-table-column :label="pub.lang('到期时间')" width="175"><template #default="{ row }"><div>{{ formatDate(row.expires_at) }}</div><div class="muted">{{ remainingText(row.expires_at) }}</div></template></el-table-column>
							<el-table-column :label="pub.lang('操作')" width="255" fixed="right"><template #default="{ row }">
								<el-button link type="primary" @click="showCertificateDetail(row)">{{ pub.lang('详情') }}</el-button>
								<el-button v-if="row.status === 'pending_validation'" link type="primary" @click="showChallenge(row)">{{ pub.lang('验证') }}</el-button>
								<el-button v-if="row.status === 'issued'" link type="primary" @click="downloadCertificate(row)">{{ pub.lang('下载') }}</el-button>
								<el-button v-if="row.status === 'issued'" link type="primary" @click="showCertificateContent(row)">{{ pub.lang('证书内容') }}</el-button>
								<el-button v-if="row.status === 'pending_validation'" link type="danger" @click="cancelCertificate(row)">{{ pub.lang('取消') }}</el-button>
								<el-button v-else link type="danger" @click="deleteCertificate(row)">{{ pub.lang('删除') }}</el-button>
							</template></el-table-column>
						</el-table>
						<div v-if="filteredCertificates.length" class="pagination"><el-pagination v-model:current-page="certificatePage" :page-size="20" layout="total, prev, pager, next" :total="filteredCertificates.length" /></div>
					</el-tab-pane>

					<el-tab-pane :label="pub.lang('申请证书')" name="apply">
						<div class="apply-layout">
							<section class="apply-card">
								<div class="section-title"><span>1</span><div><h3>{{ pub.lang('选择渠道') }}</h3><p>{{ pub.lang('不同渠道支持的 CA 和验证方式可能不同') }}</p></div></div>
								<el-select v-model="applyForm.channel_id" class="w-full" :placeholder="pub.lang('请选择申请渠道')" @change="loadMeta">
									<el-option v-for="channel in enabledChannels" :key="channel.channel_id" :label="channel.channel_name" :value="channel.channel_id"><span>{{ channel.channel_name }}</span><span class="option-note">{{ channel.provider }}</span></el-option>
								</el-select>
							</section>
							<section class="apply-card" :class="{ disabled: !applyMeta }">
								<div class="section-title"><span>2</span><div><h3>{{ pub.lang('填写申请信息') }}</h3><p>{{ pub.lang('创建订单后需要完成域名权属验证') }}</p></div></div>
								<el-form ref="applyFormRef" :model="applyForm" :rules="applyRules" label-position="top">
									<el-form-item :label="pub.lang('域名')" prop="domain"><el-input v-model="applyForm.domain" placeholder="example.com" /></el-form-item>
									<div class="form-grid">
										<el-form-item label="CA" prop="brand"><el-select v-model="applyForm.brand" class="w-full"><el-option v-for="brand in applyMeta?.brands || []" :key="brand.key" :label="`${brand.name} · ${brand.points} 积分`" :value="brand.key" /></el-select></el-form-item>
										<el-form-item :label="pub.lang('验证方式')" prop="validate"><el-select v-model="applyForm.validate" class="w-full"><el-option v-for="method in applyMeta?.validate_methods || []" :key="method.key" :label="method.name" :value="method.key" /></el-select></el-form-item>
									</div>
									<div v-if="selectedBrand" class="apply-summary"><div><span>{{ pub.lang('有效期') }}</span><strong>{{ applyMeta?.fixed_days || 90 }} {{ pub.lang('天') }}</strong></div><div><span>{{ pub.lang('预计消耗') }}</span><strong>{{ selectedBrand.points }} {{ pub.lang('积分') }}</strong></div><p>{{ selectedBrand.description }}</p></div>
									<el-button type="primary" size="large" :loading="applyLoading" :disabled="!applyMeta" @click="submitApplication">{{ pub.lang('创建申请') }}</el-button>
								</el-form>
							</section>
						</div>
					</el-tab-pane>

					<el-tab-pane :label="pub.lang('渠道设置')" name="channels">
						<div class="channel-heading"><div><h3>{{ pub.lang('申请渠道') }}</h3><p>{{ pub.lang('SecretKey 仅保存在本机并由主进程使用') }}</p></div><el-button type="primary" :icon="Plus" @click="openChannelDialog()">{{ pub.lang('添加渠道') }}</el-button></div>
						<div v-if="channels.length" class="channel-list">
							<div v-for="channel in channels" :key="channel.channel_id" class="channel-card">
								<div class="channel-card__logo">{{ channel.provider.slice(0, 1).toUpperCase() }}</div>
								<div class="channel-card__main"><div class="channel-card__name"><strong>{{ channel.channel_name }}</strong><el-tag size="small" :type="channelStatusType(channel.status)">{{ channelStatusName(channel.status) }}</el-tag><el-tag v-if="!channel.enabled" size="small" type="info">{{ pub.lang('已停用') }}</el-tag></div><div class="muted">{{ channel.provider }} · {{ channel.secret_masked || pub.lang('未配置密钥') }}</div><div v-if="channel.last_error" class="channel-error">{{ channel.last_error }}</div></div>
								<div class="channel-card__actions"><el-button :loading="testingChannel === channel.channel_id" @click="testChannel(channel)">{{ pub.lang('连接测试') }}</el-button><el-button @click="openChannelDialog(channel)">{{ pub.lang('编辑') }}</el-button><el-button type="danger" plain @click="removeChannel(channel)">{{ pub.lang('删除') }}</el-button></div>
							</div>
						</div>
						<el-empty v-else :description="pub.lang('暂未配置证书渠道')" />
					</el-tab-pane>
				</el-tabs>
			</main>
		</div>

		<el-dialog v-model="channelDialogVisible" width="520" :title="channelForm.channel_id ? pub.lang('编辑渠道') : pub.lang('添加渠道')" :close-on-click-modal="false">
			<el-form ref="channelFormRef" :model="channelForm" :rules="channelRules" label-position="top">
				<el-form-item :label="pub.lang('渠道类型')"><el-select v-model="channelForm.provider" class="w-full" disabled><el-option label="xinssl" value="xinssl" /></el-select></el-form-item>
				<el-form-item :label="pub.lang('渠道名称')" prop="channel_name"><el-input v-model="channelForm.channel_name" /></el-form-item>
				<el-form-item label="SecretKey" :prop="channelForm.channel_id ? '' : 'secret_key'"><el-input v-model="channelForm.secret_key" type="password" show-password :placeholder="channelForm.channel_id ? pub.lang('留空表示不修改') : pub.lang('请输入 SecretKey')" /></el-form-item>
				<el-form-item :label="pub.lang('启用渠道')"><el-switch v-model="channelForm.enabled" /></el-form-item>
			</el-form>
			<template #footer><el-button @click="channelDialogVisible = false">{{ pub.lang('取消') }}</el-button><el-button type="primary" :loading="channelSaving" @click="saveChannel">{{ pub.lang('保存') }}</el-button></template>
		</el-dialog>

		<el-dialog v-model="detailDialogVisible" width="720" :title="pub.lang('证书详情')">
			<el-descriptions v-if="currentCertificate" :column="2" border><el-descriptions-item :label="pub.lang('域名')">{{ currentCertificate.domain }}</el-descriptions-item><el-descriptions-item :label="pub.lang('状态')"><el-tag :type="statusType(currentCertificate.status)">{{ statusName(currentCertificate.status) }}</el-tag></el-descriptions-item><el-descriptions-item :label="pub.lang('订单号')">{{ currentCertificate.order_id }}</el-descriptions-item><el-descriptions-item label="CA">{{ currentCertificate.brand_name || currentCertificate.brand }}</el-descriptions-item><el-descriptions-item :label="pub.lang('验证方式')">{{ validateName(currentCertificate.validate) }}</el-descriptions-item><el-descriptions-item :label="pub.lang('积分消耗')">{{ currentCertificate.points_cost ?? '--' }}</el-descriptions-item><el-descriptions-item :label="pub.lang('创建时间')">{{ formatDate(currentCertificate.created_at) }}</el-descriptions-item><el-descriptions-item :label="pub.lang('到期时间')">{{ formatDate(currentCertificate.expires_at) }}</el-descriptions-item></el-descriptions>
		</el-dialog>

		<el-dialog v-model="challengeDialogVisible" width="820" :title="pub.lang('域名权属验证')" :close-on-click-modal="false">
			<el-alert type="info" :closable="false" :title="pub.lang('完成下方验证配置后，点击“检测并签发”')" />
			<el-table :data="challengeRecords" class="challenge-table"><el-table-column :label="pub.lang('类型')" prop="auth_type" width="80" /><el-table-column :label="pub.lang('主机记录')" min-width="210"><template #default="{ row }"><span class="mono">{{ row.host_full || row.host_record }}</span><el-button link type="primary" :icon="CopyDocument" @click="copyText(row.host_full || row.host_record)" /></template></el-table-column><el-table-column :label="pub.lang('记录值')" min-width="300"><template #default="{ row }"><span class="mono break-all">{{ row.value }}</span><el-button link type="primary" :icon="CopyDocument" @click="copyText(row.value)" /></template></el-table-column></el-table>
			<template #footer><el-button @click="challengeDialogVisible = false">{{ pub.lang('关闭') }}</el-button><el-button type="primary" :loading="verifyLoading" @click="verifyCurrentCertificate">{{ pub.lang('检测并签发') }}</el-button></template>
		</el-dialog>

		<el-dialog v-model="contentDialogVisible" width="860" :title="pub.lang('证书内容')">
			<el-alert type="warning" :closable="false" :title="pub.lang('私钥属于敏感信息，请勿发送给他人')" />
			<el-tabs>
				<el-tab-pane v-for="item in certificateContentTabs" :key="item.key" :label="item.label">
					<div class="secret-block"><el-button size="small" class="secret-block__copy" @click="copyText(item.value)">{{ pub.lang('复制') }}</el-button><pre>{{ item.value || '--' }}</pre></div>
				</el-tab-pane>
			</el-tabs>
		</el-dialog>
	</div>
</template>

<script setup lang="ts">
import { CopyDocument, Lock, Plus, Refresh, Search } from '@element-plus/icons-vue'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import { pub } from '@utils/tools'

interface Channel { channel_id: number; provider: string; channel_name: string; enabled: boolean; status: string; secret_masked: string; has_secret: boolean; website: string; last_check_time: number; last_error: string }
interface Brand { key: string; name: string; points: number; description: string }
interface ApplyMeta { fixed_days: number; brands: Brand[]; validate_methods: Array<{ key: string; name: string; description: string }> }
interface Certificate { certificate_key: string; channel_id: number; channel_name: string; provider: string; order_id: string; domain: string; brand: string; brand_name: string; validate: string; status: string; status_raw: string; points_cost: number; has_bundle: boolean; message: string; created_at: string; expires_at: string; challenge?: Challenge[] }
interface Challenge { auth_type: string; host_record: string; host_full: string; value: string; domain: string; validated: string; hint: string }

const Message = useMessage()
const request = (route: string, data: Record<string, unknown> = {}) => common.sendAsync({ route, data, timeout: 120000 }) as Promise<any>
const activeSection = ref('manage')
const channels = ref<Channel[]>([])
const enabledChannels = computed(() => channels.value.filter(item => item.enabled))
const channelDialogVisible = ref(false)
const channelSaving = ref(false)
const testingChannel = ref(0)
const channelFormRef = ref<FormInstance>()
const channelForm = reactive({ channel_id: 0, provider: 'xinssl', channel_name: 'xinssl', secret_key: '', enabled: true })
const channelRules: FormRules = { channel_name: [{ required: true, message: pub.lang('请输入渠道名称'), trigger: 'blur' }], secret_key: [{ required: true, message: pub.lang('请输入 SecretKey'), trigger: 'blur' }] }

const certificates = ref<Certificate[]>([])
const certificateLoading = ref(false)
const certificateKeyword = ref('')
const certificateChannel = ref(0)
const certificateStatus = ref('all')
const certificatePage = ref(1)
const certificateStatuses = computed(() => Array.from(new Set(certificates.value.map(item => item.status).filter(Boolean))))
const filteredCertificates = computed(() => { const keyword = certificateKeyword.value.trim().toLowerCase(); return certificates.value.filter(item => (!keyword || `${item.domain} ${item.order_id}`.toLowerCase().includes(keyword)) && (certificateStatus.value === 'all' || item.status === certificateStatus.value)) })
const pagedCertificates = computed(() => filteredCertificates.value.slice((certificatePage.value - 1) * 20, certificatePage.value * 20))

const applyFormRef = ref<FormInstance>()
const applyLoading = ref(false)
const applyMeta = ref<ApplyMeta>()
const applyForm = reactive({ channel_id: 0, domain: '', brand: '', validate: '', days: 90 })
const selectedBrand = computed(() => applyMeta.value?.brands.find(item => item.key === applyForm.brand))
const applyRules: FormRules = { domain: [{ required: true, message: pub.lang('请输入域名'), trigger: 'blur' }], brand: [{ required: true, message: pub.lang('请选择 CA'), trigger: 'change' }], validate: [{ required: true, message: pub.lang('请选择验证方式'), trigger: 'change' }] }

const currentCertificate = ref<Certificate>()
const detailDialogVisible = ref(false)
const challengeDialogVisible = ref(false)
const challengeRecords = ref<Challenge[]>([])
const verifyLoading = ref(false)
const contentDialogVisible = ref(false)
const certificateContent = reactive({ certificate: '', certificate_bundle: '', private_key: '' })
const certificateContentTabs = computed(() => [
	{ key: 'certificate', label: pub.lang('证书'), value: certificateContent.certificate },
	{ key: 'certificate_bundle', label: pub.lang('证书链'), value: certificateContent.certificate_bundle },
	{ key: 'private_key', label: pub.lang('私钥'), value: certificateContent.private_key },
])

const loadChannels = async () => { const result = await request(routes.ssl.channel_list.path); if (!result?.status) return Message.request(result); channels.value = result.data || []; if (!applyForm.channel_id && enabledChannels.value.length) { applyForm.channel_id = enabledChannels.value[0].channel_id; loadMeta() } }
const openChannelDialog = (channel?: Channel) => { Object.assign(channelForm, channel ? { channel_id: channel.channel_id, provider: channel.provider, channel_name: channel.channel_name, secret_key: '', enabled: channel.enabled } : { channel_id: 0, provider: 'xinssl', channel_name: 'xinssl', secret_key: '', enabled: true }); channelDialogVisible.value = true }
const saveChannel = async () => { if (!await channelFormRef.value?.validate().catch(() => false)) return; channelSaving.value = true; try { const result = await request(routes.ssl.channel_save.path, { ...channelForm }); if (!result?.status) return Message.request(result); Message.success(pub.lang('保存成功')); channelDialogVisible.value = false; await loadChannels(); await loadCertificates() } finally { channelSaving.value = false } }
const testChannel = async (channel: Channel) => { testingChannel.value = channel.channel_id; try { const result = await request(routes.ssl.channel_test.path, { channel_id: channel.channel_id }); if (!result?.status) return Message.request(result); Message.success(pub.lang('连接成功')); await loadChannels() } finally { testingChannel.value = 0 } }
const removeChannel = async (channel: Channel) => { try { await ElMessageBox.confirm(pub.lang(`确定删除渠道“${channel.channel_name}”吗？`), pub.lang('删除渠道'), { type: 'warning' }) } catch { return }; const result = await request(routes.ssl.channel_remove.path, { channel_id: channel.channel_id }); if (!result?.status) return Message.request(result); Message.success(pub.lang('删除成功')); await loadChannels(); await loadCertificates() }

const loadCertificates = async () => { const targets = certificateChannel.value ? enabledChannels.value.filter(item => item.channel_id === certificateChannel.value) : enabledChannels.value; certificateLoading.value = true; try { const results = await Promise.all(targets.map(channel => request(routes.ssl.certificate_list.path, { channel_id: channel.channel_id, page: 1, page_size: 100 }))); const failed = results.find(item => !item?.status); if (failed) Message.request(failed); certificates.value = results.filter(item => item?.status).flatMap(result => (result.data.items || []).map((item: Certificate) => ({ ...item, channel_id: result.data.channel_id, channel_name: result.data.channel_name, provider: result.data.provider, certificate_key: `${result.data.channel_id}:${item.order_id}` }))); certificatePage.value = 1 } finally { certificateLoading.value = false } }
const loadMeta = async () => { applyMeta.value = undefined; applyForm.brand = ''; applyForm.validate = ''; if (!applyForm.channel_id) return; const result = await request(routes.ssl.meta.path, { channel_id: applyForm.channel_id }); if (!result?.status) return Message.request(result); applyMeta.value = result.data; applyForm.days = result.data.fixed_days || 90; applyForm.brand = result.data.brands?.[0]?.key || ''; applyForm.validate = result.data.validate_methods?.[0]?.key || '' }
const submitApplication = async () => { if (!applyForm.channel_id) return Message.warn(pub.lang('请先选择渠道')); if (!await applyFormRef.value?.validate().catch(() => false)) return; applyLoading.value = true; try { const result = await request(routes.ssl.certificate_create.path, { ...applyForm }); if (!result?.status) return Message.request(result); Message.success(pub.lang('证书申请已创建')); currentCertificate.value = { ...result.data, channel_id: applyForm.channel_id, channel_name: enabledChannels.value.find(item => item.channel_id === applyForm.channel_id)?.channel_name || '', certificate_key: `${applyForm.channel_id}:${result.data.order_id}` }; challengeRecords.value = result.data.challenge || []; challengeDialogVisible.value = true; applyForm.domain = ''; await loadCertificates() } finally { applyLoading.value = false } }

const showCertificateDetail = async (certificate: Certificate) => { const result = await request(routes.ssl.certificate_detail.path, { channel_id: certificate.channel_id, order_id: certificate.order_id }); if (!result?.status) return Message.request(result); currentCertificate.value = { ...certificate, ...result.data }; detailDialogVisible.value = true }
const showChallenge = async (certificate: Certificate) => { const result = await request(routes.ssl.certificate_challenge.path, { channel_id: certificate.channel_id, order_id: certificate.order_id }); if (!result?.status) return Message.request(result); currentCertificate.value = certificate; challengeRecords.value = result.data.records || result.data.challenge || []; challengeDialogVisible.value = true }
const verifyCurrentCertificate = async () => { if (!currentCertificate.value) return; verifyLoading.value = true; try { const result = await request(routes.ssl.certificate_verify.path, { channel_id: currentCertificate.value.channel_id, order_id: currentCertificate.value.order_id }); if (!result?.status) return Message.request(result); if (result.data.status === 'issued') { Message.success(pub.lang('证书已签发')); challengeDialogVisible.value = false } else Message.warn(pub.lang('验证已提交，请稍后再试')); await loadCertificates() } finally { verifyLoading.value = false } }
const showCertificateContent = async (certificate: Certificate) => { const result = await request(routes.ssl.certificate_content.path, { channel_id: certificate.channel_id, order_id: certificate.order_id }); if (!result?.status) return Message.request(result); Object.assign(certificateContent, { certificate: result.data.certificate || '', certificate_bundle: result.data.certificate_bundle || '', private_key: result.data.private_key || '' }); contentDialogVisible.value = true }
const downloadCertificate = async (certificate: Certificate) => { const result = await request(routes.ssl.certificate_download.path, { channel_id: certificate.channel_id, order_id: certificate.order_id }); if (!result?.status) return Message.request(result); if (!result.data.canceled) Message.success(pub.lang('证书包已保存')) }
const cancelCertificate = async (certificate: Certificate) => { try { await ElMessageBox.confirm(pub.lang('取消未签发申请后，渠道将退回积分。是否继续？'), pub.lang('取消申请'), { type: 'warning' }) } catch { return }; const result = await request(routes.ssl.certificate_cancel.path, { channel_id: certificate.channel_id, order_id: certificate.order_id }); if (!result?.status) return Message.request(result); Message.success(pub.lang('申请已取消')); await loadCertificates() }
const deleteCertificate = async (certificate: Certificate) => { try { await ElMessageBox.confirm(pub.lang('删除后不退回积分，且不代表证书已被 CA 吊销。是否继续？'), pub.lang('删除证书'), { type: 'warning' }) } catch { return }; const result = await request(routes.ssl.certificate_delete.path, { channel_id: certificate.channel_id, order_id: certificate.order_id }); if (!result?.status) return Message.request(result); Message.success(pub.lang('删除成功')); await loadCertificates() }

const copyText = async (value: string) => { if (!value) return; await navigator.clipboard.writeText(value); Message.success(pub.lang('已复制')) }
const formatDate = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '--'
const remainingText = (value: string) => { if (!value) return '--'; const days = Math.ceil((new Date(value).getTime() - Date.now()) / 86400000); return days < 0 ? pub.lang(`已过期 ${Math.abs(days)} 天`) : pub.lang(`剩余 ${days} 天`) }
const statusName = (status: string) => ({ issued: pub.lang('已签发'), pending_validation: pub.lang('待验证'), validating: pub.lang('验证中'), processing: pub.lang('签发中'), failed: pub.lang('失败'), cancelled: pub.lang('已取消'), expired: pub.lang('已过期') }[status] || status || '--')
const statusType = (status: string) => status === 'issued' ? 'success' : ['failed', 'expired'].includes(status) ? 'danger' : ['pending_validation', 'validating', 'processing'].includes(status) ? 'warning' : 'info'
const validateName = (validate: string) => ({ dns: 'DNS', file_http: 'HTTP' }[validate] || validate || '--')
const channelStatusName = (status: string) => ({ online: pub.lang('正常'), error: pub.lang('异常'), unknown: pub.lang('未检测') }[status] || status)
const channelStatusType = (status: string) => status === 'online' ? 'success' : status === 'error' ? 'danger' : 'info'
const handleSectionChange = (name: string | number) => { if (name === 'manage') loadCertificates(); if (name === 'apply' && applyForm.channel_id) loadMeta() }

onMounted(async () => { await loadChannels(); await loadCertificates() })
</script>

<style scoped lang="scss">
.toolbox-page { min-height: 100%; padding: 2rem 3.6rem 3.6rem; color: var(--el-text-color-primary); }
.toolbox-header { display: flex; align-items: center; gap: 1.2rem; margin-bottom: 2rem; h1 { margin: 0 0 .3rem; font-size: 2rem; font-weight: 650; } p { margin: 0; color: var(--el-text-color-secondary); font-size: 1.2rem; } }
.toolbox-header__icon { display: grid; place-items: center; width: 4.4rem; height: 4.4rem; border-radius: 1.2rem; background: var(--el-color-primary-light-9); color: var(--el-color-primary); }
.toolbox-layout { display: grid; grid-template-columns: 20rem minmax(0, 1fr); min-height: 64rem; border: 1px solid var(--el-border-color-light); border-radius: 1.2rem; overflow: hidden; background: var(--el-bg-color); }
.toolbox-sidebar { padding: 1.6rem 1.2rem; border-right: 1px solid var(--el-border-color-light); background: var(--el-fill-color-extra-light); }
.toolbox-sidebar__title { padding: 0 1rem 1rem; color: var(--el-text-color-secondary); font-size: 1.1rem; }
.toolbox-menu-item { display: flex; align-items: center; gap: 1rem; width: 100%; height: 4rem; padding: 0 1rem; border: 0; border-radius: .8rem; background: transparent; color: var(--el-text-color-regular); font-size: 1.3rem; cursor: pointer; &.active { background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 600; } }
.toolbox-menu-item__icon { display: grid; place-items: center; font-size: 1.7rem; }
.toolbox-content { min-width: 0; padding: 2.4rem; }
.toolbox-content__heading { padding-bottom: 1.4rem; border-bottom: 1px solid var(--el-border-color-lighter); h2 { margin: 0 0 .5rem; font-size: 1.8rem; } p { margin: 0; color: var(--el-text-color-secondary); font-size: 1.2rem; } }
.ssl-tabs { margin-top: .4rem; :deep(.el-tabs__header) { margin-bottom: 2rem; } :deep(.el-tabs__item) { height: 4.8rem; padding: 0 2rem; font-size: 1.3rem; } }
.ssl-toolbar, .ssl-toolbar__filters, .channel-heading, .channel-card, .channel-card__name, .channel-card__actions { display: flex; align-items: center; }
.ssl-toolbar { justify-content: space-between; gap: 1.2rem; margin-bottom: 1.6rem; }
.ssl-toolbar__filters { gap: 1rem; flex: 1; .el-input { max-width: 30rem; } .el-select { width: 16rem; } }
.ssl-table { min-height: 38rem; }.primary-text { font-weight: 600; }.mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }.muted { color: var(--el-text-color-secondary); font-size: 1.15rem; }.pagination { display: flex; justify-content: flex-end; margin-top: 1.6rem; }
.apply-layout { display: grid; grid-template-columns: minmax(24rem, .75fr) minmax(42rem, 1.25fr); gap: 1.6rem; align-items: start; }.apply-card { padding: 2rem; border: 1px solid var(--el-border-color-light); border-radius: 1rem; background: var(--el-bg-color); &.disabled { opacity: .68; } }.section-title { display: flex; gap: 1.2rem; margin-bottom: 2rem; > span { display: grid; flex: 0 0 2.8rem; place-items: center; height: 2.8rem; border-radius: 50%; background: var(--el-color-primary-light-9); color: var(--el-color-primary); font-weight: 700; } h3 { margin: 0 0 .35rem; font-size: 1.5rem; } p { margin: 0; color: var(--el-text-color-secondary); font-size: 1.15rem; } }.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1.2rem; }.apply-summary { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.8rem; padding: 1.4rem; border-radius: .8rem; background: var(--el-fill-color-lighter); div { display: flex; justify-content: space-between; } span { color: var(--el-text-color-secondary); } p { grid-column: 1 / -1; margin: 0; color: var(--el-text-color-secondary); } }.option-note { float: right; margin-left: 2rem; color: var(--el-text-color-secondary); }
.channel-heading { justify-content: space-between; margin-bottom: 1.6rem; h3 { margin: 0 0 .4rem; font-size: 1.5rem; } p { margin: 0; color: var(--el-text-color-secondary); } }.channel-list { display: grid; gap: 1rem; }.channel-card { gap: 1.4rem; padding: 1.5rem; border: 1px solid var(--el-border-color-light); border-radius: 1rem; }.channel-card__logo { display: grid; place-items: center; width: 4.2rem; height: 4.2rem; border-radius: 1rem; background: #fff1ee; color: #ff6a36; font-size: 1.8rem; font-weight: 700; }.channel-card__main { flex: 1; min-width: 0; }.channel-card__name { gap: .7rem; margin-bottom: .45rem; font-size: 1.4rem; }.channel-card__actions { gap: .7rem; }.channel-error { margin-top: .35rem; color: var(--el-color-danger); font-size: 1.1rem; }
.challenge-table { margin-top: 1.6rem; }.break-all { word-break: break-all; }.w-full { width: 100%; }
.secret-block { position: relative; pre { max-height: 40rem; margin: 0; padding: 1.5rem; overflow: auto; border-radius: .8rem; background: var(--el-fill-color-lighter); color: var(--el-text-color-primary); white-space: pre-wrap; word-break: break-all; } }.secret-block__copy { position: absolute; top: .8rem; right: .8rem; z-index: 1; }
@media (max-width: 1050px) { .toolbox-page { padding-right: 2rem; padding-left: 2rem; }.toolbox-layout { grid-template-columns: 16rem minmax(0, 1fr); }.apply-layout { grid-template-columns: 1fr; }.channel-card { align-items: flex-start; flex-wrap: wrap; }.channel-card__actions { width: 100%; justify-content: flex-end; } }
</style>
