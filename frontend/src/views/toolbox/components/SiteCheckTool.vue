<template>
  <section class="tool-module">
    <div class="tool-heading"><div><h2>站点检测</h2><p>新窗口左侧实际打开页面，右侧实时显示并排序全部已加载请求。</p></div><el-select v-model="retentionDays" class="retention" @change="saveRetention"><el-option label="保存 7 天" :value="7" /><el-option label="保存 30 天" :value="30" /><el-option label="保存 90 天" :value="90" /><el-option label="保存 180 天" :value="180" /><el-option label="永久保存" :value="0" /></el-select></div>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="新建检测" name="create">
        <div class="start-card"><el-form label-position="top"><div class="form-grid"><el-form-item label="站点 URL" required><el-input v-model="form.url" placeholder="example.com 或 https://example.com" /></el-form-item><el-form-item label="访问协议"><el-select v-model="form.protocol"><el-option label="自动探测（先 HTTPS）" value="auto" /><el-option label="HTTPS" value="https" /><el-option label="HTTP" value="http" /></el-select></el-form-item><el-form-item label="浏览器环境"><el-select v-model="form.device_key"><el-option v-for="profile in profiles" :key="profile.key" :label="profile.name" :value="profile.key" /></el-select></el-form-item><el-form-item label="最长检测时间（秒）"><el-input-number v-model="form.timeout_seconds" :min="1" :precision="0" /></el-form-item></div><el-alert type="info" :closable="false" title="不带协议时会先尝试 HTTPS，无法打开则自动尝试 HTTP；填写完整 URL 时严格按填写的协议打开。每次检测使用全新的无缓存、无 Cookie 会话。" /><el-button class="start-button" type="primary" :loading="starting" @click="start">打开检测窗口并开始记录</el-button></el-form></div>
      </el-tab-pane>
      <el-tab-pane label="检测记录" name="history">
        <div class="toolbar"><div><el-input v-model="query.keyword" clearable placeholder="搜索 URL" @keyup.enter="loadTasks" /><el-select v-model="query.status" @change="resetAndLoad"><el-option label="全部状态" value="all" /><el-option label="检测中" value="running" /><el-option label="已完成" value="completed" /><el-option label="已停止" value="stopped" /><el-option label="失败" value="failed" /></el-select></div><el-button @click="loadTasks">刷新</el-button></div>
        <el-table :data="tasks" v-loading="loading" class="history-table"><el-table-column label="目标站点" min-width="260"><template #default="{ row }"><strong>{{ row.final_url || row.input_url }}</strong><div class="muted">{{ row.device_name }}</div></template></el-table-column><el-table-column label="请求 / 失败" width="135"><template #default="{ row }">{{ row.request_count || 0 }} / {{ row.failed_count || 0 }}</template></el-table-column><el-table-column label="加载时间" width="120"><template #default="{ row }">{{ ms(row.load_ms) }}</template></el-table-column><el-table-column label="传输大小" width="125"><template #default="{ row }">{{ bytes(row.total_transfer_size) }}</template></el-table-column><el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusName(row.status) }}</el-tag></template></el-table-column><el-table-column label="创建时间" width="175"><template #default="{ row }">{{ date(row.created_at) }}</template></el-table-column><el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="openDetail(row)">明细</el-button><el-button v-if="row.status === 'running'" link type="danger" @click="stop(row.task_id)">停止</el-button><el-button link type="danger" @click="remove(row.task_id)">删除</el-button></template></el-table-column></el-table>
        <div class="pagination"><el-pagination v-model:current-page="query.page" :page-size="query.page_size" layout="total, prev, pager, next" :total="taskTotal" @current-change="loadTasks" /></div>
      </el-tab-pane>
    </el-tabs>

    <el-drawer v-model="detailVisible" size="78%" :title="selectedTask ? `请求明细 · ${selectedTask.final_url || selectedTask.input_url}` : '请求明细'" destroy-on-close>
      <template v-if="selectedTask">
        <el-descriptions :column="4" border>
          <el-descriptions-item label="设备">{{ selectedTask.device_name }}</el-descriptions-item>
          <el-descriptions-item label="状态"><el-tag :type="statusType(selectedTask.status)">{{ statusName(selectedTask.status) }}</el-tag></el-descriptions-item>
          <el-descriptions-item label="请求 / 失败">{{ selectedTask.request_count || 0 }} / {{ selectedTask.failed_count || 0 }}</el-descriptions-item>
          <el-descriptions-item label="传输 / 解压大小">{{ bytes(selectedTask.total_transfer_size) }} / {{ bytes(selectedTask.total_decoded_size) }}</el-descriptions-item>
        </el-descriptions>
        <div class="request-toolbar">
          <el-input v-model="requestQuery.keyword" clearable placeholder="过滤域名或请求 URL" @keyup.enter="loadRequests" />
          <el-select v-model="requestQuery.resource_type" @change="resetRequests">
            <el-option label="全部类型" value="all" />
            <el-option v-for="item in requestCategories" :key="item.resource_type" :label="`${item.resource_type} (${item.total})`" :value="item.resource_type" />
          </el-select>
          <el-input-number v-model="requestQuery.min_duration_ms" :min="0" controls-position="right" placeholder="最小耗时 ms" @change="resetRequests" />
          <el-input-number v-model="requestQuery.min_transfer_size" :min="0" controls-position="right" placeholder="最小大小 B" @change="resetRequests" />
          <el-select v-model="requestQuery.sort_by" @change="loadRequests"><el-option label="开始顺序" value="sequence" /><el-option label="耗时" value="duration_ms" /><el-option label="传输大小" value="transfer_size" /><el-option label="状态码" value="status_code" /><el-option label="资源类型" value="resource_type" /></el-select>
          <el-button @click="toggleSort">{{ requestQuery.sort_order === 'ASC' ? '升序' : '降序' }}</el-button>
        </div>
        <el-table :data="requests" v-loading="requestsLoading" max-height="560" @row-click="openPacket">
          <el-table-column prop="sequence" label="#" width="60" />
          <el-table-column label="请求" min-width="310"><template #default="{ row }"><div class="url-text" :title="row.url">{{ row.url }}</div><div class="muted">{{ row.method }} · {{ row.host }}</div></template></el-table-column>
          <el-table-column prop="resource_type" label="分类" width="105" />
          <el-table-column label="状态" width="90"><template #default="{ row }"><span :class="{ error: Number(row.status_code) !== 200 || row.error_text }">{{ row.status_code || row.error_text || '--' }}</span></template></el-table-column>
          <el-table-column label="耗时" width="105"><template #default="{ row }">{{ ms(row.duration_ms) }}</template></el-table-column>
          <el-table-column label="TTFB" width="95"><template #default="{ row }">{{ ms(row.ttfb_ms) }}</template></el-table-column>
          <el-table-column label="传输大小" width="110"><template #default="{ row }">{{ bytes(row.transfer_size) }}</template></el-table-column>
          <el-table-column label="操作" width="82" fixed="right"><template #default="{ row }"><el-button link type="primary" @click.stop="openPacket(row)">详情</el-button></template></el-table-column>
        </el-table>
        <div class="pagination"><el-pagination v-model:current-page="requestQuery.page" :page-size="requestQuery.page_size" layout="total, prev, pager, next" :total="requestTotal" @current-change="loadRequests" /></div>
      </template>
    </el-drawer>

    <el-dialog v-model="packetVisible" width="78vw" top="7vh" :title="packetRequest?.url || '请求详情'" append-to-body destroy-on-close>
      <div v-loading="packetLoading" class="packet-dialog">
        <el-descriptions v-if="packetRequest" :column="4" border size="small">
          <el-descriptions-item label="方法">{{ packetRequest.method || '--' }}</el-descriptions-item><el-descriptions-item label="分类">{{ packetRequest.resource_type || '--' }}</el-descriptions-item><el-descriptions-item label="状态">{{ packetRequest.status_code || packetRequest.error_text || '--' }}</el-descriptions-item><el-descriptions-item label="总耗时">{{ ms(packetRequest.duration_ms) }}</el-descriptions-item>
        </el-descriptions>
        <el-tabs v-model="packetTab">
          <el-tab-pane label="Headers" name="headers"><h4>Request Headers</h4><pre>{{ pretty(packetDetail?.request_headers) || packetDetail?.request_headers_status || '无请求头' }}</pre><h4>Response Headers</h4><pre>{{ pretty(packetDetail?.response_headers) || packetDetail?.response_headers_status || '无响应头' }}</pre></el-tab-pane>
          <el-tab-pane label="Payload" name="payload"><el-alert v-if="packetDetail?.request_body_base64" title="内容以 Base64 保存" type="info" :closable="false" /><pre>{{ packetDetail?.request_body || packetDetail?.request_body_status || '该请求没有发包正文' }}</pre></el-tab-pane>
          <el-tab-pane label="Response" name="response"><el-alert v-if="packetDetail?.response_body_base64" title="二进制内容以 Base64 保存" type="info" :closable="false" /><pre>{{ packetDetail?.response_body || packetDetail?.capture_error || packetDetail?.response_body_status || packetDetail?.capture_status || '未取得返回正文' }}</pre></el-tab-pane>
          <el-tab-pane label="Timing" name="timing"><pre>{{ pretty(packetDetail?.timing_json) || pretty(packetRequest) }}</pre></el-tab-pane>
        </el-tabs>
      </div>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'

const Message = useMessage()
const request = (route: string, data: Record<string, any> = {}) => common.sendAsync({ route, data, timeout: 120000 }) as Promise<any>
const activeTab = ref('create')
const fallbackProfiles = [
  { key: 'desktop', name: 'PC（桌面浏览器）' },
  { key: 'iphone_x', name: 'iPhone X' },
  { key: 'iphone_14', name: 'iPhone 14' },
  { key: 'pixel_7', name: 'Pixel 7（Android Chrome）' },
]
const profiles = ref<any[]>(fallbackProfiles)
const retentionDays = ref(90)
const starting = ref(false)
const loading = ref(false)
const tasks = ref<any[]>([])
const taskTotal = ref(0)
const detailVisible = ref(false)
const selectedTask = ref<any>()
const requests = ref<any[]>([])
const requestTotal = ref(0)
const requestsLoading = ref(false)
const requestCategories = ref<any[]>([])
const packetVisible = ref(false)
const packetLoading = ref(false)
const packetRequest = ref<any>()
const packetDetail = ref<any>()
const packetTab = ref('headers')
const form = reactive({ url: '', protocol: 'auto', device_key: 'iphone_x', timeout_seconds: 60 })
const query = reactive({ keyword: '', status: 'all', page: 1, page_size: 20 })
const requestQuery = reactive({ keyword: '', resource_type: 'all', min_duration_ms: undefined as number | undefined, min_transfer_size: undefined as number | undefined, sort_by: 'sequence', sort_order: 'ASC', page: 1, page_size: 50 })
const resultOrMessage = (result: any) => { if (!result?.status) { Message.request(result); return null } return result.data }
const showRequestError = (error: unknown, action: string) => Message.error(`${action}失败：${error instanceof Error ? error.message : '请检查主进程日志'}`)
const loadProfiles = async () => { try { const data = resultOrMessage(await request(routes.site_check.profiles.path)); if (data) profiles.value = data } catch (error) { showRequestError(error, '加载机型') } }
const loadRetention = async () => { try { const data = resultOrMessage(await request(routes.site_check.retention.path)); if (data) retentionDays.value = data.days } catch (error) { showRequestError(error, '加载保存时间') } }
const saveRetention = async () => { try { const data = resultOrMessage(await request(routes.site_check.retention.path, { days: retentionDays.value })); if (data) { retentionDays.value = data.days; Message.success('保存时间已更新') } } catch (error) { showRequestError(error, '保存时间') } }
const loadTasks = async () => { loading.value = true; try { const data = resultOrMessage(await request(routes.site_check.list.path, query)); if (data) { tasks.value = data.data || []; taskTotal.value = data.total || 0 } } catch (error) { showRequestError(error, '加载检测记录') } finally { loading.value = false } }
const resetAndLoad = () => { query.page = 1; loadTasks() }
const start = async () => { if (!form.url.trim()) return Message.warn('请输入站点 URL'); starting.value = true; try { const data = resultOrMessage(await request(routes.site_check.start.path, form)); if (data) { Message.success('检测窗口已打开'); activeTab.value = 'history'; await loadTasks() } } catch (error) { showRequestError(error, '启动站点检测') } finally { starting.value = false } }
const stop = async (taskId: number) => { const data = resultOrMessage(await request(routes.site_check.stop.path, { task_id: taskId })); if (data) { Message.success('检测已停止并保存'); await loadTasks(); if (selectedTask.value?.task_id === taskId) { selectedTask.value = data; await loadRequests() } } }
const remove = async (taskId: number) => { try { await ElMessageBox.confirm('删除后将一并删除该检测的全部请求明细，是否继续？', '删除记录', { type: 'warning' }) } catch { return } const result = await request(routes.site_check.remove.path, { task_id: taskId }); if (result?.status) { Message.success('已删除'); detailVisible.value = false; await loadTasks() } else Message.request(result) }
const openDetail = async (row: any) => { const data = resultOrMessage(await request(routes.site_check.detail.path, { task_id: row.task_id })); if (!data) return; selectedTask.value = data; Object.assign(requestQuery, { keyword: '', resource_type: 'all', min_duration_ms: undefined, min_transfer_size: undefined, sort_by: 'sequence', sort_order: 'ASC', page: 1 }); detailVisible.value = true; await loadRequests() }
const loadRequests = async () => { if (!selectedTask.value) return; requestsLoading.value = true; try { const data = resultOrMessage(await request(routes.site_check.requests.path, { ...requestQuery, task_id: selectedTask.value.task_id })); if (data) { requests.value = data.data || []; requestTotal.value = data.total || 0; requestCategories.value = data.categories || [] } } finally { requestsLoading.value = false } }
const openPacket = async (row: any) => { if (!selectedTask.value || !row?.request_id) return; packetVisible.value = true; packetLoading.value = true; packetRequest.value = row; packetDetail.value = undefined; packetTab.value = 'headers'; try { const data = resultOrMessage(await request(routes.site_check.request_detail.path, { task_id: selectedTask.value.task_id, request_id: row.request_id })); if (data) { packetRequest.value = data.request || row; packetDetail.value = data.detail || {} } } catch (error) { showRequestError(error, '读取请求详情') } finally { packetLoading.value = false } }
const resetRequests = () => { requestQuery.page = 1; loadRequests() }
const toggleSort = () => { requestQuery.sort_order = requestQuery.sort_order === 'ASC' ? 'DESC' : 'ASC'; loadRequests() }
const ms = (value: any) => `${Number(value || 0).toFixed(Number(value || 0) % 1 ? 1 : 0)} ms`
const bytes = (value: any) => { const n = Number(value || 0); return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB` }
const pretty = (value: any) => { if (value === undefined || value === null || value === '') return ''; try { return JSON.stringify(typeof value === 'string' ? JSON.parse(value) : value, null, 2) } catch { return String(value) } }
const date = (value: any) => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', { hour12: false }) : '--'
const statusName = (value: string) => ({ pending: '等待中', running: '检测中', completed: '已完成', stopped: '已停止', failed: '失败', interrupted: '已中断' } as Record<string, string>)[value] || value
const statusType = (value: string) => value === 'completed' ? 'success' : value === 'running' ? 'warning' : ['failed', 'interrupted'].includes(value) ? 'danger' : 'info'
onMounted(async () => { await Promise.all([loadProfiles(), loadRetention(), loadTasks()]) })
</script>

<style scoped lang="scss">
.tool-module { min-width: 0; }.tool-heading, .toolbar { display: flex; align-items: center; }.tool-heading { justify-content: space-between; gap: 1.2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--el-border-color-lighter); h2 { margin: 0 0 .5rem; font-size: 1.8rem; } p { margin: 0; color: var(--el-text-color-secondary); font-size: 1.2rem; } }.retention { width: 14rem; }.start-card { margin-top: 1.7rem; padding: 1.8rem; border: 1px solid var(--el-border-color-light); border-radius: 1rem; }.form-grid { display: grid; grid-template-columns: 2fr repeat(3, 1fr); gap: 1.2rem; }.start-button { margin-top: 1.5rem; }.toolbar { justify-content: space-between; gap: 1rem; margin: 1.4rem 0; > div { display: flex; gap: 1rem; } .el-input { width: 30rem; } .el-select { width: 13rem; } }.history-table { min-height: 36rem; }.pagination { display: flex; justify-content: flex-end; margin-top: 1.5rem; }.muted { color: var(--el-text-color-secondary); font-size: 1.15rem; }.request-toolbar { display: grid; grid-template-columns: minmax(20rem, 1.6fr) 12rem 13rem 13rem 12rem auto; gap: .8rem; margin: 1.5rem 0; }.url-text { overflow: hidden; color: var(--el-color-primary); text-overflow: ellipsis; white-space: nowrap; }.error { color: var(--el-color-danger); }.packet-dialog { min-height: 45rem; h4 { margin: 1.2rem 0 .6rem; } pre { max-height: 48vh; margin: 0; padding: 1.2rem; overflow: auto; border: 1px solid var(--el-border-color-light); border-radius: .6rem; background: var(--el-fill-color-light); font: 1.2rem/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; } } @media (max-width: 1100px) { .form-grid { grid-template-columns: 1fr; }.request-toolbar { grid-template-columns: 1fr 1fr; } }
</style>
