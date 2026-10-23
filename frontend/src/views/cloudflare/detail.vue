<template>
  <div class="cloudflare-detail">
    <header class="page-header">
      <el-button circle :icon="ArrowLeft" @click="router.push('/cloudflare')" />
      <div>
        <h1>{{ account?.remark || pub.lang('Cloudflare 账号') }}</h1>
        <p>{{ pub.lang('站点管理') }}</p>
      </div>
      <el-button :icon="Refresh" :loading="loading" @click="loadZones">{{ pub.lang('刷新') }}</el-button>
      <el-button type="primary" :icon="Plus" @click="openCreateDialog">{{ pub.lang('添加站点') }}</el-button>
    </header>

    <el-alert v-if="error" type="error" :closable="false" :title="error" class="page-alert" />
    <el-alert v-else type="info" :closable="false" :title="pub.lang('新增站点后，需在域名注册商后台将名称服务器改为 Cloudflare 分配的地址，程序会在站点详情中显示。')" class="page-alert" />

    <div class="toolbar">
      <el-input v-model="keyword" clearable :placeholder="pub.lang('按域名搜索')" @keyup.enter="searchZones" @clear="searchZones" />
      <el-button @click="searchZones">{{ pub.lang('搜索') }}</el-button>
    </div>
    <el-table v-loading="loading" :data="zones" stripe @row-click="openZone">
      <el-table-column prop="name" :label="pub.lang('站点')" min-width="190" />
      <el-table-column prop="status" :label="pub.lang('状态')" width="120">
        <template #default="{ row }"><el-tag :type="row.status === 'active' ? 'success' : row.status === 'pending' ? 'warning' : 'info'">{{ row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column :label="pub.lang('名称服务器')" min-width="260">
        <template #default="{ row }"><span class="muted">{{ Array.isArray(row.name_servers) && row.name_servers.length ? row.name_servers.join(' · ') : '—' }}</span></template>
      </el-table-column>
      <el-table-column :label="pub.lang('套餐')" width="130"><template #default="{ row }">{{ row.plan?.name || '—' }}</template></el-table-column>
      <el-table-column :label="pub.lang('操作')" width="150" fixed="right">
        <template #default="{ row }"><el-button text type="primary" @click.stop="openZone(row)">{{ pub.lang('管理') }}</el-button><el-button text type="danger" @click.stop="removeZone(row)">{{ pub.lang('删除') }}</el-button></template>
      </el-table-column>
    </el-table>
    <el-empty v-if="!loading && !zones.length && !error" :description="pub.lang('暂无站点')" />
    <div v-if="total > pageSize" class="pagination"><el-pagination v-model:current-page="page" :page-size="pageSize" :total="total" layout="total, prev, pager, next" @current-change="loadZones" /></div>

    <el-dialog v-model="createVisible" width="460px" :title="pub.lang('添加 Cloudflare 站点')" @closed="newDomain = ''">
      <el-form label-position="top"><el-form-item :label="pub.lang('根域名')"><el-input v-model="newDomain" placeholder="example.com" /></el-form-item></el-form>
      <el-alert type="warning" :closable="false" :title="pub.lang('仅创建完整接入站点。提交后请先核对 DNS 记录，再到域名注册商后台改名称服务器。')" />
      <template #footer><el-button @click="createVisible = false">{{ pub.lang('取消') }}</el-button><el-button type="primary" :loading="creating" @click="createZone">{{ pub.lang('创建') }}</el-button></template>
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
const account = ref<any>()
const zones = ref<any[]>([])
const keyword = ref('')
const loading = ref(false)
const creating = ref(false)
const createVisible = ref(false)
const newDomain = ref('')
const error = ref('')
const page = ref(1)
const pageSize = 50
const total = ref(0)
const request = (path: string, data: any = {}) => common.sendAsync({ route: path, data, timeout: 30000 }) as Promise<any>

async function loadZones() {
  loading.value = true; error.value = ''
  try {
    const [accountRes, zonesRes] = await Promise.all([
      request(routes.cloudflare.find.path, { account_id: accountId.value }),
      request(routes.cloudflare.zones.path, { account_id: accountId.value, page: page.value, per_page: pageSize, name: keyword.value.trim() })
    ])
    if (!accountRes?.status) throw new Error(accountRes?.msg || pub.lang('账号不存在'))
    account.value = accountRes.data
    if (!zonesRes?.status) throw new Error(zonesRes?.msg || pub.lang('站点加载失败'))
    zones.value = zonesRes.data?.data || []
    total.value = Number(zonesRes.data?.result_info?.total_count) || zones.value.length
  } catch (e: any) { error.value = e?.message || pub.lang('站点加载失败') } finally { loading.value = false }
}
function searchZones() { page.value = 1; loadZones() }
function openZone(zone: any) { if (zone?.id) router.push(`/cloudflare/${accountId.value}/zone/${zone.id}`) }
function openCreateDialog() {
  if (!account.value?.cloudflare_account_id) return Message.warn(pub.lang('请先编辑账号并填写 Cloudflare Account ID'))
  createVisible.value = true
}
async function createZone() {
  if (!newDomain.value.trim()) return Message.warn(pub.lang('请输入根域名'))
  creating.value = true
  try {
    const res = await request(routes.cloudflare.zone_create.path, { account_id: accountId.value, name: newDomain.value.trim() })
    Message.request(res)
    if (res?.status) { createVisible.value = false; await loadZones(); openZone(res.data?.result) }
  } catch { Message.error(pub.lang('创建站点失败')) } finally { creating.value = false }
}
async function removeZone(zone: any) {
  let value = ''
  try { ({ value } = await ElMessageBox.prompt(pub.lang('此操作会从 Cloudflare 删除站点及其设置。请输入域名“{}”确认。', zone.name), pub.lang('删除站点'), { inputPlaceholder: zone.name, type: 'error', confirmButtonText: pub.lang('删除') })) } catch { return }
  try { const res = await request(routes.cloudflare.zone_remove.path, { account_id: accountId.value, zone_id: zone.id, confirm_zone_name: value }); Message.request(res); if (res?.status) await loadZones() } catch { Message.error(pub.lang('删除站点失败')) }
}
loadZones()
</script>

<style scoped lang="scss">
.cloudflare-detail { padding: 2rem; height: 100%; overflow: auto; background: var(--el-bg-color-page); }
.page-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
.page-header h1 { margin: 0; font-size: 1.7rem; }.page-header p { margin: .3rem 0; color: var(--el-text-color-secondary); }
.page-header .el-button:nth-last-child(2) { margin-left: auto; }.page-alert { margin-bottom: 1.2rem; }.toolbar { display: flex; gap: .8rem; max-width: 440px; margin: 0 0 1rem auto; }.pagination { display: flex; justify-content: flex-end; margin-top: 1.6rem; }.muted { color: var(--el-text-color-secondary); }
</style>
