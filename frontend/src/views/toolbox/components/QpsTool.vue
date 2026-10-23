<template>
  <section class="tool-module">
    <div class="tool-heading"><div><h2>QPS 测试</h2><p>从本机按目标速率发起 HTTP/HTTPS 请求；仅 HTTP 200 计为成功。</p></div><el-select v-model="retentionDays" class="retention" @change="saveRetention"><el-option label="保存 7 天" :value="7" /><el-option label="保存 30 天" :value="30" /><el-option label="保存 90 天" :value="90" /><el-option label="保存 180 天" :value="180" /><el-option label="永久保存" :value="0" /></el-select></div>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="发起测试" name="create">
        <template v-if="!runningTask || configVisible">
        <div v-if="form.mode === 'fixed'" class="preset-row"><span>推荐档位</span><el-button v-for="preset in presets" :key="preset.key" :type="form.preset === preset.key ? 'primary' : 'default'" @click="applyPreset(preset)">{{ preset.name }}</el-button></div>
        <el-alert v-if="form.mode === 'fixed'" type="warning" :closable="false" title="请仅对拥有明确测试授权的目标发压。" />
        <el-alert v-else type="warning" :closable="false" title="极限模式会逐级加压、寻找失败上界，再对最高通过值做长时稳定确认。结果仅代表本机、当前网络和请求配置下的稳定 QPS。" />
        <el-form class="form-card" label-position="top">
          <div class="form-grid"><el-form-item label="任务名称（可选）"><el-input v-model="form.name" placeholder="例如：首页 GET 压测" /></el-form-item><el-form-item label="目标 URL" required><el-input v-model="form.url" placeholder="https://example.com/api" /></el-form-item></div>
          <div class="form-grid four"><el-form-item label="模式"><el-radio-group v-model="form.mode"><el-radio-button label="fixed">固定</el-radio-button><el-radio-button label="extreme">极限</el-radio-button></el-radio-group></el-form-item><el-form-item label="请求方法"><el-select v-model="form.method"><el-option label="GET" value="GET" /><el-option label="POST" value="POST" /><el-option label="PUT" value="PUT" /><el-option label="DELETE" value="DELETE" /><el-option label="PATCH" value="PATCH" /></el-select></el-form-item><el-form-item label="最大并发"><el-input-number v-model="form.concurrency" :min="1" :precision="0" /></el-form-item><el-form-item v-if="form.mode === 'fixed'" label="目标 QPS"><el-input-number v-model="form.target_qps" :min="1" :precision="0" /></el-form-item><el-form-item v-if="form.mode === 'fixed'" label="持续时间（秒）"><el-input-number v-model="form.duration_seconds" :min="1" :precision="0" /></el-form-item></div>
          <template v-if="form.mode === 'extreme'">
            <div class="form-grid four extreme-fields"><el-form-item label="最大 QPS（0=无用户上限）"><el-input-number v-model="form.max_qps" :min="0" :precision="0" /></el-form-item><el-form-item label="初始 QPS"><el-input-number v-model="form.extreme_initial_qps" :min="1" :precision="0" /></el-form-item><el-form-item label="增长倍率"><el-input-number v-model="form.extreme_growth_factor" :min="1.01" :step="0.1" :precision="2" /></el-form-item><el-form-item label="预热 / 测量 / 确认（秒）"><div class="duration-inline"><el-input-number v-model="form.extreme_warmup_seconds" :min="0" :precision="0" /><el-input-number v-model="form.extreme_measure_seconds" :min="1" :precision="0" /><el-input-number v-model="form.extreme_confirm_seconds" :min="1" :precision="0" /></div></el-form-item></div>
            <div class="form-grid four extreme-fields"><el-form-item label="允许错误率（%）"><el-input-number v-model="maxErrorPercent" :min="0" :max="100" :step="0.1" :precision="1" /></el-form-item><el-form-item label="最低成功 QPS 达成率（%）"><el-input-number v-model="minSuccessPercent" :min="1" :max="100" :step="1" :precision="1" /></el-form-item><el-form-item label="最低真实发出率（%）"><el-input-number v-model="minIssuedPercent" :min="1" :max="100" :step="1" :precision="1" /></el-form-item><el-form-item label="P95 延迟上限（ms）"><el-input-number v-model="form.extreme_p95_limit_ms" :min="1" :max="1000" :precision="0" /></el-form-item></div>
            <p class="extreme-note">引擎保护：最多 20 个阶段、30 分钟；发压器或并发上限受限时会单独标记，不会误报为站点极限。</p>
          </template>
          <div class="form-grid four"><el-form-item label="单请求超时（毫秒）"><el-input-number v-model="form.timeout_ms" :min="1" :precision="0" /></el-form-item><el-form-item label="保持连接"><el-switch v-model="form.keep_alive" /></el-form-item><el-form-item label="跟随同源重定向（最多 5 次）"><el-switch v-model="form.follow_redirects" /></el-form-item><el-form-item label="忽略 TLS 证书错误"><el-switch v-model="form.ignore_tls_errors" /></el-form-item></div>
          <div class="form-grid"><el-form-item label="请求头（原样保存，JSON 对象）"><el-input v-model="form.request_headers" type="textarea" :rows="5" placeholder='{"Authorization":"Bearer ..."}' /></el-form-item><el-form-item label="请求体（原样保存）"><el-input v-model="form.request_body" type="textarea" :rows="5" placeholder="POST/PUT 请求体" /></el-form-item></div>
          <el-button type="primary" :loading="creating" @click="createTask">开始 QPS 测试</el-button>
        </el-form>
        </template>
        <section v-if="runningTask" class="monitor-session">
          <header class="monitor-session__header">
            <div><div class="monitor-session__title"><strong>{{ runningTask.name || runningTask.url }}</strong><el-tag size="small" :type="statusType(runningTask.status)">{{ statusName(runningTask.status) }}</el-tag><el-tag size="small" effect="plain">{{ runningTask.mode === 'extreme' ? '极限模式' : '固定 QPS' }}</el-tag></div><p>{{ runningTask.method }} · 并发 {{ runningTask.concurrency }} · {{ runningTask.url }}</p></div>
            <div class="monitor-session__actions"><el-button plain @click="configVisible = !configVisible">{{ configVisible ? '收起配置' : '新建任务' }}</el-button><el-button v-if="runningTask.status === 'running'" type="danger" plain @click="stopTask(runningTask.task_id)">停止</el-button></div>
          </header>
          <div class="monitor-session__facts"><span>已发起 <b>{{ runningTask.runtime?.issued_count ?? runningTask.issued_count ?? 0 }}</b></span><span>活动请求 <b>{{ runningTask.runtime?.active_count || 0 }}</b></span><span>成功 / 失败 <b>{{ runningTask.success_count || 0 }} / {{ runningTask.failed_count || 0 }}</b></span><span v-if="runningTask.mode === 'extreme'">稳定区间 <b>{{ runningTask.runtime?.lower_qps ?? runningTask.lower_qps ?? 0 }} / {{ runningTask.runtime?.upper_qps ?? runningTask.upper_qps ?? '--' }}</b></span></div>
          <div v-if="runningTask.mode === 'extreme'" class="phase-track"><div class="phase-track__label">第 {{ runningTask.runtime?.stage ?? runningTask.current_stage ?? 0 }} 阶段 · 候选 {{ runningTask.runtime?.target_qps ?? runningTask.current_target_qps ?? 0 }} QPS</div><ol><li :class="{ active: ['warmup', 'warmup_drain'].includes(runningTask.runtime?.phase || runningTask.current_phase) }">预热</li><li :class="{ active: (runningTask.runtime?.phase || runningTask.current_phase) === 'measure' }">测量</li><li :class="{ active: (runningTask.runtime?.phase || runningTask.current_phase) === 'confirm' }">确认</li><li :class="{ active: (runningTask.runtime?.phase || runningTask.current_phase) === 'drain' }">排空</li></ol><p v-if="runningTask.limit_reason || runningTask.runtime?.limit_reason">{{ runningTask.runtime?.limit_reason || runningTask.limit_reason }}</p></div>
          <QpsRealtimeChart :samples="liveSamples" :duration-seconds="trendDuration" :running="runningTask.status === 'running'" :title="runningTask.mode === 'extreme' ? '极限稳定趋势' : '实时压测趋势'" />
        </section>
      </el-tab-pane>
      <el-tab-pane label="测试记录" name="history">
        <div class="toolbar"><div><el-input v-model="query.keyword" clearable placeholder="搜索任务名称或 URL" @keyup.enter="loadHistory" /><el-select v-model="query.status" @change="resetAndLoad"><el-option label="全部状态" value="all" /><el-option label="运行中" value="running" /><el-option label="已完成" value="completed" /><el-option label="已停止" value="stopped" /><el-option label="失败/中断" value="failed" /></el-select></div><el-button @click="loadHistory">刷新</el-button></div>
        <el-table :data="history" v-loading="loading" class="history-table">
          <el-table-column label="目标" min-width="260"><template #default="{ row }"><strong>{{ row.name || row.url }}</strong><div class="muted mono">{{ row.name ? row.url : '' }}</div></template></el-table-column>
          <el-table-column label="模式 / 配置" min-width="185"><template #default="{ row }"><el-tag size="small">{{ row.mode === 'extreme' ? '极限' : '固定' }}</el-tag> {{ row.mode === 'extreme' ? `初始 ${row.extreme_initial_qps}` : `${row.target_qps}` }} QPS · 并发 {{ row.concurrency }}<div class="muted">{{ row.mode === 'extreme' ? `下界 ${row.lower_qps || 0} / 上界 ${row.upper_qps || '--'}` : `${row.duration_seconds} 秒` }}</div></template></el-table-column>
          <el-table-column label="结果" min-width="180"><template #default="{ row }"><template v-if="row.mode === 'extreme'"><strong>{{ row.final_stable_qps ? `${row.final_stable_qps} 稳定 QPS` : '未确认稳定值' }}</strong><div class="muted">{{ limitName(row.limit_kind) }}</div></template><template v-else>{{ row.actual_qps || 0 }} 实际 QPS<div class="muted">成功 {{ row.success_count || 0 }} / 失败 {{ row.failed_count || 0 }}</div></template></template></el-table-column>
          <el-table-column label="平均 / P95" width="145"><template #default="{ row }">{{ ms(row.avg_latency_ms) }} / {{ ms(row.p95_latency_ms) }}</template></el-table-column>
          <el-table-column label="状态" width="100"><template #default="{ row }"><el-tag :type="statusType(row.status)">{{ statusName(row.status) }}</el-tag></template></el-table-column>
          <el-table-column label="创建时间" width="175"><template #default="{ row }">{{ date(row.created_at) }}</template></el-table-column>
          <el-table-column label="操作" width="180" fixed="right"><template #default="{ row }"><el-button link type="primary" @click="showDetail(row.task_id)">详情</el-button><el-button v-if="row.status === 'running'" link type="danger" @click="stopTask(row.task_id)">停止</el-button><el-button v-else link type="primary" @click="retryTask(row.task_id)">重跑</el-button><el-button link type="danger" @click="removeTask(row.task_id)">删除</el-button></template></el-table-column>
        </el-table>
        <div class="pagination"><el-pagination v-model:current-page="query.page" :page-size="query.page_size" layout="total, prev, pager, next" :total="total" @current-change="loadHistory" /></div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="detailVisible" width="92%" title="QPS 测试详情">
      <template v-if="detail">
        <el-descriptions :column="4" border><el-descriptions-item label="目标" :span="2">{{ detail.url }}</el-descriptions-item><el-descriptions-item label="模式">{{ detail.mode === 'extreme' ? '极限' : '固定' }}</el-descriptions-item><el-descriptions-item label="状态"><el-tag :type="statusType(detail.status)">{{ statusName(detail.status) }}</el-tag></el-descriptions-item><el-descriptions-item label="实际 QPS">{{ detail.actual_qps || 0 }}</el-descriptions-item><el-descriptions-item label="成功 / 失败">{{ detail.success_count || 0 }} / {{ detail.failed_count || 0 }}</el-descriptions-item><el-descriptions-item label="已确认稳定 QPS">{{ detail.mode === 'extreme' ? (detail.final_stable_qps || '未确认') : '--' }}</el-descriptions-item><el-descriptions-item label="稳定下界 / 失败上界">{{ detail.mode === 'extreme' ? `${detail.lower_qps || 0} / ${detail.upper_qps || '--'}` : '--' }}</el-descriptions-item><el-descriptions-item label="平均 / P95">{{ ms(detail.avg_latency_ms) }} / {{ ms(detail.p95_latency_ms) }}</el-descriptions-item><el-descriptions-item label="总流量">{{ bytes(detail.total_bytes) }}</el-descriptions-item><el-descriptions-item v-if="detail.mode === 'extreme'" label="结果类型">{{ limitName(detail.limit_kind) }}</el-descriptions-item><el-descriptions-item v-if="detail.mode === 'extreme'" label="结果说明" :span="2">{{ detail.limit_reason || '--' }}</el-descriptions-item></el-descriptions>
        <el-collapse class="detail-collapse"><el-collapse-item title="完整请求配置（未脱敏）"><pre>{{ JSON.stringify({ method: detail.method, headers: detail.request_headers, body: detail.request_body }, null, 2) }}</pre></el-collapse-item><el-collapse-item title="状态码与错误"><pre>{{ JSON.stringify({ status_codes: detail.status_codes, errors: detail.error_summary }, null, 2) }}</pre></el-collapse-item></el-collapse>
        <QpsRealtimeChart :samples="detail.samples || []" :running="detail.status === 'running'" title="完整测试趋势" />
        <template v-if="detail.mode === 'extreme'"><h4>加压与稳定确认阶段</h4><el-table :data="detail.stages || []" max-height="320"><el-table-column prop="stage_no" label="#" width="55" /><el-table-column label="类型" width="90"><template #default="{ row }">{{ stageKindName(row.kind) }}</template></el-table-column><el-table-column prop="target_qps" label="候选 QPS" width="100" /><el-table-column prop="success_qps" label="成功 QPS" width="100" /><el-table-column label="发出率" width="95"><template #default="{ row }">{{ percent(row.issued_rate) }}</template></el-table-column><el-table-column label="错误率" width="95"><template #default="{ row }">{{ percent(row.error_rate) }}</template></el-table-column><el-table-column label="P95" width="90"><template #default="{ row }">{{ ms(row.p95_latency_ms) }}</template></el-table-column><el-table-column label="结果" width="100"><template #default="{ row }">{{ stageStatusName(row.status) }}</template></el-table-column><el-table-column prop="limit_reason" label="判定说明" min-width="260" /></el-table></template>
        <h4>秒样本</h4><el-table :data="detail.samples || []" max-height="300"><el-table-column prop="second_offset" label="秒" width="70" /><el-table-column label="阶段" width="105"><template #default="{ row }">{{ phaseName(row.phase) }}</template></el-table-column><el-table-column prop="target_qps" label="目标" /><el-table-column prop="issued_count" label="真实发出" /><el-table-column prop="success_qps" label="成功 QPS" /><el-table-column label="发出率"><template #default="{ row }">{{ percent(row.issued_rate) }}</template></el-table-column><el-table-column prop="actual_qps" label="完成 QPS" /><el-table-column label="平均 / P95"><template #default="{ row }">{{ ms(row.avg_latency_ms) }} / {{ ms(row.p95_latency_ms) }}</template></el-table-column></el-table>
      </template>
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import { ElMessageBox } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import QpsRealtimeChart from './QpsRealtimeChart.vue'

const Message = useMessage()
const request = (route: string, data: Record<string, any> = {}) => common.sendAsync({ route, data, timeout: 120000 }) as Promise<any>
const activeTab = ref('create')
const retentionDays = ref(90)
const creating = ref(false)
const loading = ref(false)
const history = ref<any[]>([])
const total = ref(0)
const detailVisible = ref(false)
const detail = ref<any>()
const runningTask = ref<any>()
const configVisible = ref(true)
const liveSamples = ref<any[]>([])
let pollTimer: ReturnType<typeof setInterval> | undefined
let pollingRunning = false
const form = reactive({ name: '', url: '', mode: 'fixed', method: 'GET', preset: 'recommended', request_headers: '{}', request_body: '', target_qps: 20, concurrency: 20, duration_seconds: 60, timeout_ms: 10000, keep_alive: true, follow_redirects: true, ignore_tls_errors: false, max_qps: 0, extreme_initial_qps: 10, extreme_growth_factor: 1.5, extreme_warmup_seconds: 10, extreme_measure_seconds: 30, extreme_confirm_seconds: 300, extreme_max_error_rate: 0.01, extreme_min_success_rate: 0.95, extreme_min_issued_rate: 0.98, extreme_p95_limit_ms: 1000 })
const maxErrorPercent = computed({ get: () => form.extreme_max_error_rate * 100, set: value => { form.extreme_max_error_rate = Number(value || 0) / 100 } })
const minSuccessPercent = computed({ get: () => form.extreme_min_success_rate * 100, set: value => { form.extreme_min_success_rate = Number(value || 0) / 100 } })
const minIssuedPercent = computed({ get: () => form.extreme_min_issued_rate * 100, set: value => { form.extreme_min_issued_rate = Number(value || 0) / 100 } })
const query = reactive({ keyword: '', status: 'all', page: 1, page_size: 20 })
const presets = [
  { key: 'connectivity', name: '连通性验证', target_qps: 5, concurrency: 5, duration_seconds: 30 },
  { key: 'recommended', name: '推荐轻量', target_qps: 20, concurrency: 20, duration_seconds: 60 },
  { key: 'regular', name: '常规压测', target_qps: 50, concurrency: 50, duration_seconds: 300 },
  { key: 'custom', name: '自定义', target_qps: form.target_qps, concurrency: form.concurrency, duration_seconds: form.duration_seconds },
]
const applyPreset = (preset: any) => { form.preset = preset.key; if (preset.key !== 'custom') Object.assign(form, { target_qps: preset.target_qps, concurrency: preset.concurrency, duration_seconds: preset.duration_seconds }) }
const resultOrMessage = (result: any) => { if (!result?.status) { Message.request(result); return null } return result.data }
const percent = (value: any) => `${(Number(value || 0) * 100).toFixed(1)}%`
const loadRetention = async () => { const data = resultOrMessage(await request(routes.qps.retention.path)); if (data) retentionDays.value = data.days }
const saveRetention = async () => { const data = resultOrMessage(await request(routes.qps.retention.path, { days: retentionDays.value })); if (data) { retentionDays.value = data.days; Message.success('保存时间已更新') } }
const loadHistory = async () => { loading.value = true; try { const data = resultOrMessage(await request(routes.qps.list.path, query)); if (data) { history.value = data.data || []; total.value = data.total || 0 } } finally { loading.value = false } }
const resetAndLoad = () => { query.page = 1; loadHistory() }
const mergeLiveSamples = (samples: any[] = []) => {
  if (!samples.length) return
  const lastId = Number(liveSamples.value[liveSamples.value.length - 1]?.sample_id || 0)
  if (samples.every(sample => Number(sample.sample_id) > lastId)) {
    liveSamples.value = liveSamples.value.concat(samples)
    return
  }
  const merged = new Map(liveSamples.value.map(sample => [Number(sample.sample_id), sample]))
  samples.forEach(sample => merged.set(Number(sample.sample_id), sample))
  liveSamples.value = Array.from(merged.values()).sort((a, b) => Number(a.sample_id) - Number(b.sample_id))
}
const lastLiveSampleId = computed(() => Number(liveSamples.value[liveSamples.value.length - 1]?.sample_id || 0))
const trendDuration = computed(() => {
  const task = runningTask.value
  const elapsed = Number(liveSamples.value[liveSamples.value.length - 1]?.second_offset || 0)
  if (!task || task.status !== 'running') return Math.max(1, elapsed)
  return task.mode === 'extreme' ? Math.max(1800, elapsed) : Math.max(1, Number(task.duration_seconds || 0), elapsed)
})
const pollRunning = async () => { if (!runningTask.value || pollingRunning) return; pollingRunning = true; try { const data = resultOrMessage(await request(routes.qps.detail.path, { task_id: runningTask.value.task_id, with_samples: true, after_sample_id: lastLiveSampleId.value })); if (!data) return; mergeLiveSamples(data.samples || []); runningTask.value = data; if (data.status !== 'running') { clearInterval(pollTimer); pollTimer = undefined; await loadHistory() } } finally { pollingRunning = false } }
const createTask = async () => { if (!form.url.trim()) return Message.warn('请输入目标 URL'); const description = form.mode === 'extreme' ? `极限模式，初始 ${form.extreme_initial_qps} QPS、并发 ${form.concurrency}，最大 QPS ${form.max_qps || '无上限'}` : `${form.target_qps} QPS、并发 ${form.concurrency} 持续 ${form.duration_seconds} 秒`; try { await ElMessageBox.confirm(`将按${description}向目标发压。请确认您拥有测试授权。`, '确认开始 QPS 测试', { type: 'warning', confirmButtonText: '我已获得授权，开始测试' }) } catch { return } creating.value = true; try { const data = resultOrMessage(await request(routes.qps.create.path, form)); if (!data) return; liveSamples.value = []; mergeLiveSamples(data.samples || []); runningTask.value = data; configVisible.value = false; activeTab.value = 'create'; Message.success('QPS 测试已开始'); if (!pollTimer) pollTimer = setInterval(pollRunning, 1000); await loadHistory() } finally { creating.value = false } }
const stopTask = async (taskId: number) => { const data = resultOrMessage(await request(routes.qps.stop.path, { task_id: taskId })); if (data && runningTask.value?.task_id === taskId) { mergeLiveSamples(data.samples || []); runningTask.value = data } await loadHistory() }
const retryTask = async (taskId: number) => { const data = resultOrMessage(await request(routes.qps.retry.path, { task_id: taskId })); if (data) { liveSamples.value = []; mergeLiveSamples(data.samples || []); runningTask.value = data; configVisible.value = false; activeTab.value = 'create'; if (!pollTimer) pollTimer = setInterval(pollRunning, 1000) } }
const removeTask = async (taskId: number) => { try { await ElMessageBox.confirm('删除后无法恢复此任务和每秒统计记录，是否继续？', '删除记录', { type: 'warning' }) } catch { return } const result = await request(routes.qps.remove.path, { task_id: taskId }); if (result?.status) { Message.success('已删除'); await loadHistory() } else Message.request(result) }
const showDetail = async (taskId: number) => { const data = resultOrMessage(await request(routes.qps.detail.path, { task_id: taskId })); if (data) { detail.value = data; detailVisible.value = true } }
const ms = (value: any) => `${Number(value || 0).toFixed(Number(value || 0) % 1 ? 1 : 0)} ms`
const bytes = (value: any) => { const n = Number(value || 0); return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(2)} MB` }
const date = (value: any) => value ? new Date(Number(value) * 1000).toLocaleString('zh-CN', { hour12: false }) : '--'
const statusName = (value: string) => ({ pending: '等待中', running: '运行中', completed: '已完成', stopped: '已停止', failed: '失败', interrupted: '已中断' } as Record<string, string>)[value] || value
const statusType = (value: string) => value === 'completed' ? 'success' : value === 'running' ? 'warning' : ['failed', 'interrupted'].includes(value) ? 'danger' : 'info'
const phaseName = (value: string) => ({ fixed: '固定发压', warmup: '预热', warmup_drain: '预热排空', measure: '测量', confirm: '稳定确认', drain: '等待在途请求' } as Record<string, string>)[value] || value || '--'
const limitName = (value: string) => ({ site: '站点稳定边界', user_limit: '已达用户上限', concurrency_limited: '最大并发受限', generator_limited: '本机发压器受限', engine_guard: '引擎保护停止', no_stable: '未找到稳定值' } as Record<string, string>)[value] || (value ? value : '待判定')
const stageKindName = (value: string) => ({ probe: '逐级加压', search: '区间搜索', confirm: '稳定确认' } as Record<string, string>)[value] || value || '--'
const stageStatusName = (value: string) => ({ running: '运行中', passed: '通过', confirmed: '已确认', site_failed: '站点阈值失败', limited: '发压受限', stopped: '已停止' } as Record<string, string>)[value] || value || '--'
onMounted(async () => { await Promise.all([loadRetention(), loadHistory()]) })
onBeforeUnmount(() => { if (pollTimer) clearInterval(pollTimer) })
</script>

<style scoped lang="scss">
.tool-module { min-width: 0; }.tool-heading, .toolbar, .preset-row { display: flex; align-items: center; }.tool-heading { justify-content: space-between; gap: 1.2rem; padding-bottom: 1.5rem; border-bottom: 1px solid var(--el-border-color-lighter); h2 { margin: 0 0 .5rem; font-size: 1.8rem; } p { margin: 0; color: var(--el-text-color-secondary); font-size: 1.2rem; } }.retention { width: 14rem; }.preset-row { gap: .8rem; flex-wrap: wrap; margin: 1.8rem 0 1rem; > span { color: var(--el-text-color-secondary); } }.form-card { margin-top: 1.4rem; padding: 1.8rem; border: 1px solid var(--el-border-color-light); border-radius: 1rem; }.form-grid { display: grid; grid-template-columns: 1fr 2fr; gap: 1.2rem; &.four { grid-template-columns: repeat(4, minmax(0, 1fr)); } }.duration-inline { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: .5rem; width: 100%; :deep(.el-input-number) { width: 100%; } }.extreme-note { margin: -.4rem 0 1.2rem; color: var(--el-text-color-secondary); }
.monitor-session { margin-top: 1.2rem; }.monitor-session__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; padding: 1rem 1.15rem; border: 1px solid var(--el-border-color-light); border-radius: .75rem; background: var(--el-bg-color); }.monitor-session__title, .monitor-session__actions, .monitor-session__facts { display: flex; align-items: center; }.monitor-session__title { gap: .55rem; strong { max-width: 42rem; overflow: hidden; font-size: 1.2rem; text-overflow: ellipsis; white-space: nowrap; } }.monitor-session__header p { max-width: 70rem; margin: .4rem 0 0; overflow: hidden; color: var(--el-text-color-secondary); font-size: .95rem; text-overflow: ellipsis; white-space: nowrap; }.monitor-session__actions { flex: 0 0 auto; gap: .7rem; }.monitor-session__facts { gap: 1.6rem; padding: .85rem 1.15rem; color: var(--el-text-color-secondary); font-size: .95rem; flex-wrap: wrap; b { margin-left: .2rem; color: var(--el-text-color-primary); font-variant-numeric: tabular-nums; } }.phase-track { padding: .85rem 1.15rem; border: 1px solid var(--el-border-color-lighter); border-radius: .7rem; background: var(--el-fill-color-extra-light); }.phase-track__label { margin-bottom: .7rem; color: var(--el-text-color-regular); font-size: .95rem; font-weight: 600; }.phase-track ol { display: grid; grid-template-columns: repeat(4, 1fr); gap: .65rem; margin: 0; padding: 0; list-style: none; }.phase-track li { position: relative; padding: .5rem .65rem .5rem 1.55rem; border-radius: .45rem; color: var(--el-text-color-secondary); background: var(--el-fill-color); font-size: .9rem; &::before { position: absolute; top: 50%; left: .65rem; width: .45rem; height: .45rem; border-radius: 50%; background: var(--el-text-color-placeholder); content: ''; transform: translateY(-50%); } &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); font-weight: 600; &::before { background: var(--el-color-primary); box-shadow: 0 0 0 .22rem var(--el-color-primary-light-7); } } }.phase-track p { margin: .7rem 0 0; color: var(--el-color-warning-dark-2); font-size: .9rem; }
.toolbar { justify-content: space-between; gap: 1rem; margin: 1.4rem 0; > div { display: flex; gap: 1rem; } .el-input { width: 28rem; } .el-select { width: 13rem; } }.history-table { min-height: 36rem; }.pagination { display: flex; justify-content: flex-end; margin-top: 1.5rem; }.muted { color: var(--el-text-color-secondary); font-size: 1.15rem; }.mono, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }.detail-collapse { margin: 1.5rem 0; } pre { max-height: 18rem; margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-all; } @media (max-width: 1100px) { .form-grid, .form-grid.four { grid-template-columns: 1fr 1fr; }.monitor-session__header { align-items: stretch; flex-direction: column; }.monitor-session__actions { justify-content: flex-end; }.phase-track ol { grid-template-columns: 1fr 1fr; } }
</style>
