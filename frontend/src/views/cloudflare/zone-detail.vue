<template>
  <div class="zone-detail">
    <header class="page-header">
      <el-button circle :icon="ArrowLeft" @click="router.push(`/cloudflare/${accountId}`)" />
      <div>
        <h1>{{ zone?.name || pub.lang('Cloudflare 站点') }}</h1>
        <p>{{ pub.lang('站点配置、DNS 与缓存') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="refreshAll">{{ pub.lang('刷新') }}</el-button>
    </header>
    <el-alert v-if="error" type="error" :closable="false" :title="error" class="page-alert" />

    <el-tabs v-model="activeTab" class="zone-tabs">
      <el-tab-pane :label="pub.lang('概览')" name="overview">
        <el-skeleton v-if="loading && !zone" :rows="5" animated />
        <template v-else-if="zone">
          <el-alert v-if="zone.status !== 'active'" type="warning" :closable="false" class="page-alert" :title="pub.lang('站点尚未激活：请在域名注册商后台更新名称服务器，完成后返回这里刷新状态。')" />
          <el-descriptions :column="2" border>
            <el-descriptions-item :label="pub.lang('状态')"><el-tag :type="zone.status === 'active' ? 'success' : 'warning'">{{ zone.status }}</el-tag></el-descriptions-item>
            <el-descriptions-item :label="pub.lang('套餐')">{{ zone.plan?.name || '—' }}</el-descriptions-item>
            <el-descriptions-item :label="pub.lang('创建时间')">{{ zone.created_on || '—' }}</el-descriptions-item>
            <el-descriptions-item :label="pub.lang('原注册商')">{{ zone.original_registrar || '—' }}</el-descriptions-item>
            <el-descriptions-item :label="pub.lang('Cloudflare 名称服务器')" :span="2">
              <div class="ns-list"><template v-if="zone.name_servers?.length"><el-tag v-for="server in zone.name_servers" :key="server" effect="plain">{{ server }}</el-tag><el-button text type="primary" @click="copyText(zone.name_servers.join('\n'))">{{ pub.lang('复制') }}</el-button></template><span v-else>—</span></div>
            </el-descriptions-item>
            <el-descriptions-item v-if="zone.original_name_servers?.length" :label="pub.lang('原名称服务器')" :span="2"><span>{{ zone.original_name_servers.join(' · ') }}</span></el-descriptions-item>
          </el-descriptions>
          <div class="overview-actions"><el-button :loading="activating" @click="activationCheck">{{ pub.lang('检查激活状态') }}</el-button></div>

          <section class="setting-card">
            <div><h3>{{ pub.lang('开发模式') }}</h3><p>{{ pub.lang('临时绕过缓存，Cloudflare 会在 3 小时后自动关闭。') }}</p></div>
            <el-switch v-model="developmentMode" :loading="developmentLoading" :before-change="changeDevelopmentMode" />
          </section>
          <section class="setting-card cache-card">
            <div><h3>{{ pub.lang('缓存清理') }}</h3><p>{{ pub.lang('可仅清理一个 URL，或在确认后清理全站缓存。') }}</p></div>
            <div class="cache-actions"><el-input v-model="purgeUrl" placeholder="https://example.com/path" clearable /><el-button :loading="purging" @click="purgeUrlCache">{{ pub.lang('清理 URL 缓存') }}</el-button><el-button type="danger" plain :loading="purging" @click="purgeAllCache">{{ pub.lang('清理全站缓存') }}</el-button></div>
          </section>
        </template>
      </el-tab-pane>

      <el-tab-pane :label="pub.lang('DNS 记录')" name="dns">
        <div class="dns-toolbar"><el-input v-model="dnsKeyword" clearable :placeholder="pub.lang('按记录名或内容搜索')" @keyup.enter="searchDns" @clear="searchDns" /><el-button :icon="Refresh" :loading="dnsLoading" @click="loadDns" /><el-button type="primary" :icon="Plus" @click="openRecordDialog()">{{ pub.lang('新增记录') }}</el-button></div>
        <el-table v-loading="dnsLoading" :data="records" row-key="id" stripe>
          <el-table-column prop="type" :label="pub.lang('类型')" width="90" />
          <el-table-column prop="name" :label="pub.lang('名称')" min-width="180" show-overflow-tooltip />
          <el-table-column prop="content" :label="pub.lang('内容')" min-width="230" show-overflow-tooltip />
          <el-table-column prop="ttl" label="TTL" width="90"><template #default="{ row }">{{ row.ttl === 1 ? pub.lang('自动') : row.ttl }}</template></el-table-column>
          <el-table-column :label="pub.lang('代理')" width="100"><template #default="{ row }"><el-switch v-if="recordCanProxy(row)" v-model="row.proxied" :loading="proxyLoadingId === row.id" :before-change="() => toggleProxy(row)" /><span v-else class="muted">—</span></template></el-table-column>
          <el-table-column :label="pub.lang('操作')" width="130" fixed="right"><template #default="{ row }"><el-button text type="primary" @click="openRecordDialog(row)">{{ pub.lang('编辑') }}</el-button><el-button text type="danger" @click="removeRecord(row)">{{ pub.lang('删除') }}</el-button></template></el-table-column>
        </el-table>
        <el-empty v-if="!dnsLoading && !records.length" :description="pub.lang('暂无 DNS 记录')" />
        <div v-if="dnsTotal > dnsPageSize" class="pagination"><el-pagination v-model:current-page="dnsPage" :page-size="dnsPageSize" :total="dnsTotal" layout="total, prev, pager, next" @current-change="loadDns" /></div>
      </el-tab-pane>

      <el-tab-pane :label="pub.lang('DNS 扫描')" name="scan">
        <el-alert type="info" :closable="false" :title="pub.lang('扫描只发现建议记录；接受或拒绝前均需由您选择，程序不会自动写入 DNS。')" class="page-alert" />
        <div class="scan-toolbar"><el-button type="primary" :loading="scanLoading" @click="triggerScan">{{ pub.lang('触发扫描') }}</el-button><el-button :loading="scanLoading" @click="loadScan">{{ pub.lang('刷新建议') }}</el-button><el-button :disabled="!selectedScan.length || scanLoading" @click="reviewScan('accept')">{{ pub.lang('接受所选') }}</el-button><el-button type="danger" plain :disabled="!selectedScan.length || scanLoading" @click="reviewScan('reject')">{{ pub.lang('拒绝所选') }}</el-button></div>
        <el-table v-loading="scanLoading" :data="scanRecords" row-key="id" stripe @selection-change="selectedScan = $event"><el-table-column type="selection" width="50" /><el-table-column prop="type" :label="pub.lang('类型')" width="90" /><el-table-column prop="name" :label="pub.lang('名称')" min-width="200" /><el-table-column prop="content" :label="pub.lang('内容')" min-width="250" /><el-table-column prop="ttl" label="TTL" width="90" /></el-table>
        <el-empty v-if="!scanLoading && !scanRecords.length" :description="pub.lang('暂无扫描建议')" />
      </el-tab-pane>

      <el-tab-pane :label="pub.lang('危险操作')" name="danger">
        <el-alert type="error" :closable="false" :title="pub.lang('删除站点会删除 Cloudflare 内该站点的配置。操作不可恢复，且不影响域名注册商处的域名所有权。')" class="page-alert" />
        <el-button type="danger" :loading="deletingZone" @click="removeZone">{{ pub.lang('删除站点') }}</el-button>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="recordDialogVisible" width="540px" :title="recordForm.id ? pub.lang('编辑 DNS 记录') : pub.lang('新增 DNS 记录')" :close-on-click-modal="false" @closed="resetRecordForm">
      <el-form label-position="top"><el-form-item :label="pub.lang('类型')"><el-select v-model="recordForm.type" :disabled="!!recordForm.id" class="full-width"><el-option v-for="type in recordTypes" :key="type" :label="type" :value="type" /></el-select></el-form-item><el-form-item :label="pub.lang('名称')"><el-input v-model="recordForm.name" placeholder="www.example.com 或 example.com" /></el-form-item><el-form-item :label="pub.lang('内容')"><el-input v-model="recordForm.content" type="textarea" :rows="3" /></el-form-item><div class="form-row"><el-form-item label="TTL"><el-input-number v-model="recordForm.ttl" :min="1" :max="86400" class="full-width" /></el-form-item><el-form-item v-if="priorityTypes.includes(recordForm.type)" :label="pub.lang('优先级')"><el-input-number v-model="recordForm.priority" :min="0" :max="65535" class="full-width" /></el-form-item></div><el-form-item v-if="proxyTypes.includes(recordForm.type)" :label="pub.lang('代理')"><el-switch v-model="recordForm.proxied" /></el-form-item></el-form>
      <template #footer><el-button @click="recordDialogVisible = false">{{ pub.lang('取消') }}</el-button><el-button type="primary" :loading="recordSaving" @click="saveRecord">{{ pub.lang('保存') }}</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ArrowLeft, Plus, Refresh } from '@element-plus/icons-vue'
import { ElMessageBox } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import { pub } from '@utils/tools'

const route = useRoute()
const router = useRouter()
const Message = useMessage()
const accountId = computed(() => Number(route.params.accountId))
const zoneId = computed(() => String(route.params.zoneId || ''))
const activeTab = ref('overview')
const zone = ref<any>()
const loading = ref(false)
const error = ref('')
const activating = ref(false)
const developmentMode = ref(false)
const developmentLoading = ref(false)
const purgeUrl = ref('')
const purging = ref(false)
const records = ref<any[]>([])
const dnsKeyword = ref('')
const dnsLoading = ref(false)
const dnsPage = ref(1)
const dnsPageSize = 50
const dnsTotal = ref(0)
const proxyLoadingId = ref('')
const scanRecords = ref<any[]>([])
const selectedScan = ref<any[]>([])
const scanLoading = ref(false)
const deletingZone = ref(false)
const recordDialogVisible = ref(false)
const recordSaving = ref(false)
const recordTypes = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'CAA', 'NS', 'SRV']
const proxyTypes = ['A', 'AAAA', 'CNAME']
const priorityTypes = ['MX', 'SRV']
const emptyRecord = () => ({ id: '', type: 'A', name: '', content: '', ttl: 1, priority: 0, proxied: false })
const recordForm = reactive(emptyRecord())
const request = (path: string, data: any = {}) => common.sendAsync({ route: path, data, timeout: 30000 }) as Promise<any>

async function loadZone() {
  const res = await request(routes.cloudflare.zone_find.path, { account_id: accountId.value, zone_id: zoneId.value })
  if (!res?.status) throw new Error(res?.msg || pub.lang('站点加载失败'))
  zone.value = res.data?.result
}
async function loadDevelopmentMode() {
  developmentLoading.value = true
  try { const res = await request(routes.cloudflare.development_mode_get.path, { account_id: accountId.value, zone_id: zoneId.value }); if (res?.status) developmentMode.value = res.data?.result?.value === 'on' } catch { /* Zone:Read token may not include settings permission. */ } finally { developmentLoading.value = false }
}
async function loadDns() {
  dnsLoading.value = true
  try {
    const res = await request(routes.cloudflare.dns_list.path, { account_id: accountId.value, zone_id: zoneId.value, page: dnsPage.value, per_page: dnsPageSize, search: dnsKeyword.value.trim() })
    if (!res?.status) return Message.request(res)
    records.value = res.data?.data || []
    dnsTotal.value = Number(res.data?.result_info?.total_count) || records.value.length
  } catch { Message.error(pub.lang('DNS 记录加载失败')) } finally { dnsLoading.value = false }
}
async function refreshAll() {
  loading.value = true; error.value = ''
  try { await loadZone(); await Promise.all([loadDevelopmentMode(), loadDns()]) } catch (e: any) { error.value = e?.message || pub.lang('站点加载失败') } finally { loading.value = false }
}
function searchDns() { dnsPage.value = 1; loadDns() }
function recordCanProxy(record: any) { return Boolean(record?.proxiable) && proxyTypes.includes(record?.type) }
async function activationCheck() {
  activating.value = true
  try { const res = await request(routes.cloudflare.zone_activation_check.path, { account_id: accountId.value, zone_id: zoneId.value }); Message.request(res); if (res?.status) await loadZone() } catch { Message.error(pub.lang('激活状态检查失败')) } finally { activating.value = false }
}
async function changeDevelopmentMode() {
  const next = !developmentMode.value
  developmentLoading.value = true
  try { const res = await request(routes.cloudflare.development_mode_set.path, { account_id: accountId.value, zone_id: zoneId.value, value: next ? 'on' : 'off' }); Message.request(res); return Boolean(res?.status) } catch { Message.error(pub.lang('开发模式更新失败')); return false } finally { developmentLoading.value = false }
}
async function purgeUrlCache() {
  if (!purgeUrl.value.trim()) return Message.warn(pub.lang('请输入要清理的 URL'))
  purging.value = true
  try { const res = await request(routes.cloudflare.cache_purge.path, { account_id: accountId.value, zone_id: zoneId.value, mode: 'url', url: purgeUrl.value.trim() }); Message.request(res); if (res?.status) purgeUrl.value = '' } catch { Message.error(pub.lang('缓存清理失败')) } finally { purging.value = false }
}
async function purgeAllCache() {
  let value = ''
  try { ({ value } = await ElMessageBox.prompt(pub.lang('请输入域名“{}”确认清理全站缓存。', zone.value?.name), pub.lang('清理全站缓存'), { inputPlaceholder: zone.value?.name, type: 'warning', confirmButtonText: pub.lang('清理') })) } catch { return }
  purging.value = true
  try { const res = await request(routes.cloudflare.cache_purge.path, { account_id: accountId.value, zone_id: zoneId.value, mode: 'all', confirm_zone_name: value }); Message.request(res) } catch { Message.error(pub.lang('缓存清理失败')) } finally { purging.value = false }
}
function resetRecordForm() { Object.assign(recordForm, emptyRecord()) }
function openRecordDialog(record?: any) { Object.assign(recordForm, record ? { id: record.id, type: record.type, name: record.name, content: record.content, ttl: record.ttl, priority: record.priority ?? 0, proxied: Boolean(record.proxied) } : emptyRecord()); recordDialogVisible.value = true }
async function saveRecord() {
  if (!recordForm.name.trim() || !recordForm.content.trim()) return Message.warn(pub.lang('请填写记录名称和内容'))
  recordSaving.value = true
  const data: any = { account_id: accountId.value, zone_id: zoneId.value, record_id: recordForm.id, type: recordForm.type, name: recordForm.name.trim(), content: recordForm.content.trim(), ttl: recordForm.ttl, proxied: proxyTypes.includes(recordForm.type) ? recordForm.proxied : false }
  if (priorityTypes.includes(recordForm.type)) data.priority = recordForm.priority
  try { const res = await request((recordForm.id ? routes.cloudflare.dns_update : routes.cloudflare.dns_create).path, data); Message.request(res); if (res?.status) { recordDialogVisible.value = false; await loadDns() } } catch { Message.error(pub.lang('DNS 记录保存失败')) } finally { recordSaving.value = false }
}
async function toggleProxy(record: any) {
  proxyLoadingId.value = record.id
  try { const res = await request(routes.cloudflare.dns_update.path, { account_id: accountId.value, zone_id: zoneId.value, record_id: record.id, type: record.type, proxied: !record.proxied }); Message.request(res); return Boolean(res?.status) } catch { Message.error(pub.lang('代理状态更新失败')); return false } finally { proxyLoadingId.value = '' }
}
async function removeRecord(record: any) {
  let value = ''
  try { ({ value } = await ElMessageBox.prompt(pub.lang('请输入记录名称“{}”确认删除。', record.name), pub.lang('删除 DNS 记录'), { inputPlaceholder: record.name, type: 'warning', confirmButtonText: pub.lang('删除') })) } catch { return }
  try { const res = await request(routes.cloudflare.dns_remove.path, { account_id: accountId.value, zone_id: zoneId.value, record_id: record.id, confirm_record_name: value }); Message.request(res); if (res?.status) await loadDns() } catch { Message.error(pub.lang('删除 DNS 记录失败')) }
}
async function triggerScan() {
  scanLoading.value = true
  try { const res = await request(routes.cloudflare.dns_scan_trigger.path, { account_id: accountId.value, zone_id: zoneId.value }); Message.request(res); if (res?.status) { Message.success(pub.lang('扫描已开始，请稍后刷新建议')); await loadScan() } } catch { Message.error(pub.lang('DNS 扫描启动失败')) } finally { scanLoading.value = false }
}
async function loadScan() {
  scanLoading.value = true
  try { const res = await request(routes.cloudflare.dns_scan_list.path, { account_id: accountId.value, zone_id: zoneId.value }); if (!res?.status) return Message.request(res); scanRecords.value = res.data?.result || []; selectedScan.value = [] } catch { Message.error(pub.lang('扫描建议加载失败')) } finally { scanLoading.value = false }
}
async function reviewScan(action: 'accept' | 'reject') {
  const selectedRecords = JSON.parse(JSON.stringify(selectedScan.value))
  const actionText = action === 'accept' ? pub.lang('接受') : pub.lang('拒绝')
  try { await ElMessageBox.confirm(pub.lang('确认{}已选择的 {} 条扫描建议吗？', actionText, selectedRecords.length), pub.lang('审阅 DNS 扫描建议'), { type: 'warning' }) } catch { return }
  scanLoading.value = true
  try { const res = await request(routes.cloudflare.dns_scan_review.path, { account_id: accountId.value, zone_id: zoneId.value, action, records: selectedRecords }); Message.request(res); if (res?.status) { await Promise.all([loadScan(), loadDns()]) } } catch { Message.error(pub.lang('扫描建议处理失败')) } finally { scanLoading.value = false }
}
async function copyText(value: string) { try { await navigator.clipboard.writeText(value); Message.success(pub.lang('已复制')) } catch { Message.error(pub.lang('复制失败')) } }
async function removeZone() {
  let value = ''
  try { ({ value } = await ElMessageBox.prompt(pub.lang('此操作不可恢复。请输入域名“{}”确认删除。', zone.value?.name), pub.lang('删除站点'), { inputPlaceholder: zone.value?.name, type: 'error', confirmButtonText: pub.lang('删除') })) } catch { return }
  deletingZone.value = true
  try { const res = await request(routes.cloudflare.zone_remove.path, { account_id: accountId.value, zone_id: zoneId.value, confirm_zone_name: value }); Message.request(res); if (res?.status) router.replace(`/cloudflare/${accountId.value}`) } catch { Message.error(pub.lang('删除站点失败')) } finally { deletingZone.value = false }
}
refreshAll()
</script>

<style scoped lang="scss">
.zone-detail { padding: 2rem; height: 100%; overflow: auto; background: var(--el-bg-color-page); }.page-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }.page-header h1 { margin: 0; font-size: 1.7rem; }.page-header p { margin: .3rem 0; color: var(--el-text-color-secondary); }.page-header .el-button:last-child { margin-left: auto; }.page-alert { margin-bottom: 1.2rem; }.ns-list { display: flex; flex-wrap: wrap; align-items: center; gap: .6rem; }.overview-actions { display: flex; justify-content: flex-end; margin: 1.2rem 0; }.setting-card { display: flex; align-items: center; justify-content: space-between; gap: 2rem; margin-top: 1.2rem; padding: 1.4rem; border: 1px solid var(--el-border-color); border-radius: .6rem; background: var(--el-bg-color); }.setting-card h3 { margin: 0 0 .4rem; }.setting-card p { margin: 0; color: var(--el-text-color-secondary); }.cache-actions { display: flex; width: min(620px, 60%); gap: .8rem; }.dns-toolbar,.scan-toolbar { display: flex; justify-content: flex-end; gap: .8rem; margin-bottom: 1rem; }.dns-toolbar .el-input { max-width: 340px; }.pagination { display: flex; justify-content: flex-end; margin-top: 1.4rem; }.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }.full-width { width: 100%; }.muted { color: var(--el-text-color-secondary); } @media (max-width: 850px) { .cache-card,.setting-card { align-items: flex-start; flex-direction: column; }.cache-actions { width: 100%; flex-wrap: wrap; }.cache-actions .el-input { width: 100%; }.dns-toolbar { justify-content: stretch; flex-wrap: wrap; }.dns-toolbar .el-input { max-width: none; flex: 1; } }
</style>
