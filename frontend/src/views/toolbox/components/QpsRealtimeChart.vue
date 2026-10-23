<template>
  <section class="qps-trend">
    <header class="qps-trend__header">
      <div>
        <h3>{{ title }}</h3>
        <p>{{ rows.length ? `已接收 ${rows.length} 个秒级样本 · ${phaseName(latest?.phase)}` : '等待首个样本' }}</p>
      </div>
      <span v-if="running" class="live-state"><i />实时更新</span>
      <span v-else class="saved-state">数据已保存</span>
    </header>

    <div v-if="rows.length" class="qps-metrics" aria-label="实时关键指标">
      <div><span>目标 QPS</span><strong>{{ number(latest?.target_qps) }}</strong><em>QPS</em></div>
      <div><span>完成 QPS</span><strong>{{ number(latest?.actual_qps) }}</strong><em>QPS</em></div>
      <div><span>HTTP 200 成功率</span><strong>{{ percent(successRate) }}</strong><em>本秒</em></div>
      <div class="qps-metrics__latency"><span>P95 延迟</span><strong>{{ number(latest?.p95_latency_ms) }}</strong><em>ms</em></div>
    </div>

    <template v-if="rows.length">
      <div class="qps-trend__toolbar">
        <div class="qps-trend__switch" role="tablist" aria-label="趋势维度">
          <button :class="{ active: chartMode === 'throughput' }" type="button" @click="chartMode = 'throughput'">吞吐</button>
          <button :class="{ active: chartMode === 'latency' }" type="button" @click="chartMode = 'latency'">延迟</button>
        </div>
        <div class="qps-trend__legend">
          <template v-if="chartMode === 'throughput'"><span><i class="legend-target" />目标</span><span><i class="legend-success" />HTTP 200</span><span><i class="legend-completed" />完成</span></template>
          <template v-else><span><i class="legend-average" />平均延迟</span><span><i class="legend-p95" />P95 延迟</span></template>
        </div>
      </div>
      <div ref="canvasShell" class="qps-trend__canvas" @mousemove="handleMove" @mouseleave="hoverIndex = null">
        <canvas ref="canvas" aria-label="QPS 实时趋势图" />
        <div v-if="hover" class="qps-trend__tooltip" :class="{ right: hover.xPercent > 70 }" :style="{ left: `${hover.xPercent}%`, top: `${hover.yPercent}%` }">
          <strong>第 {{ hover.row.second_offset }} 秒 · {{ phaseName(hover.row.phase) }}</strong>
          <template v-if="chartMode === 'throughput'"><span>目标 <b>{{ number(hover.row.target_qps) }} QPS</b></span><span>发出 <b>{{ number(hover.row.issued_count) }} QPS</b></span><span>HTTP 200 <b>{{ number(hover.row.success_qps) }} QPS</b></span><span>完成 <b>{{ number(hover.row.actual_qps) }} QPS</b></span></template>
          <template v-else><span>平均延迟 <b>{{ number(hover.row.avg_latency_ms) }} ms</b></span><span>P95 延迟 <b>{{ number(hover.row.p95_latency_ms) }} ms</b></span></template>
        </div>
      </div>
    </template>
    <el-empty v-else :image-size="48" description="测试开始后，此处每秒更新" />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

type Sample = Record<string, any>
type ChartMode = 'throughput' | 'latency'
type Series = { field: string; color: string; dash?: number[]; width?: number }

const props = withDefaults(defineProps<{ samples?: Sample[]; running?: boolean; title?: string; durationSeconds?: number }>(), {
  samples: () => [], running: false, title: '实时趋势', durationSeconds: 0,
})

const canvas = ref<HTMLCanvasElement>()
const canvasShell = ref<HTMLElement>()
const chartMode = ref<ChartMode>('throughput')
const hoverIndex = ref<number | null>(null)
let resizeObserver: ResizeObserver | undefined
let frameId = 0
const rows = computed(() => (props.samples || []).map(row => ({
  ...row,
  second_offset: Number(row.second_offset || 0), target_qps: Number(row.target_qps || 0), issued_count: Number(row.issued_count || 0), success_qps: Number(row.success_qps || 0), actual_qps: Number(row.actual_qps || 0), avg_latency_ms: Number(row.avg_latency_ms || 0), p95_latency_ms: Number(row.p95_latency_ms || 0),
})))
const latest = computed(() => rows.value.at(-1))
const timelineSeconds = computed(() => Math.max(1, Number(props.durationSeconds || 0), Number(latest.value?.second_offset || 0)))
const successRate = computed(() => Number(latest.value?.success_qps || 0) / Math.max(1, Number(latest.value?.issued_count || 0)))
const hover = computed(() => {
  if (hoverIndex.value === null) return null
  const row = rows.value[hoverIndex.value]
  if (!row) return null
  const values = chartMode.value === 'throughput' ? [row.target_qps, row.success_qps, row.actual_qps] : [row.avg_latency_ms, row.p95_latency_ms]
  const max = chartMaximum(valuesForMode(chartMode.value))
  const xPercent = Math.min(100, Math.max(0, row.second_offset / timelineSeconds.value * 100))
  const yPercent = Math.min(82, Math.max(14, 88 - Math.max(...values) / Math.max(1, max) * 70))
  return { row, xPercent, yPercent }
})

const valuesForMode = (mode: ChartMode) => rows.value.flatMap(row => mode === 'throughput' ? [row.target_qps, row.success_qps, row.actual_qps] : [row.avg_latency_ms, row.p95_latency_ms])
const chartMaximum = (values: number[]) => {
  const value = Math.max(1, ...values)
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalized = value / magnitude
  return (normalized <= 1 ? 1 : normalized <= 1.25 ? 1.25 : normalized <= 1.5 ? 1.5 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude
}
const chartSeries = (): Series[] => chartMode.value === 'throughput'
  ? [{ field: 'target_qps', color: '#3b82f6', dash: [6, 4], width: 1.8 }, { field: 'success_qps', color: '#16a36a', width: 2.6 }, { field: 'actual_qps', color: '#64748b', width: 1.5 }]
  : [{ field: 'avg_latency_ms', color: '#7c3aed', width: 2 }, { field: 'p95_latency_ms', color: '#ef4444', width: 2.6 }]
const render = () => {
  const element = canvas.value
  const shell = canvasShell.value
  if (!element || !shell || !rows.value.length) return
  const rect = shell.getBoundingClientRect()
  const width = Math.max(260, Math.floor(rect.width))
  const height = Math.max(180, Math.floor(rect.height))
  const ratio = Math.max(1, window.devicePixelRatio || 1)
  if (element.width !== width * ratio || element.height !== height * ratio) { element.width = width * ratio; element.height = height * ratio }
  const context = element.getContext('2d')
  if (!context) return
  context.setTransform(ratio, 0, 0, ratio, 0, 0)
  context.clearRect(0, 0, width, height)
  const padding = { top: 18, right: 18, bottom: 30, left: 46 }
  const plotWidth = Math.max(1, width - padding.left - padding.right)
  const plotHeight = Math.max(1, height - padding.top - padding.bottom)
  const series = chartSeries()
  const maximum = chartMaximum(valuesForMode(chartMode.value))
  const x = (index: number) => padding.left + Math.min(1, Math.max(0, rows.value[index].second_offset / timelineSeconds.value)) * plotWidth
  const y = (value: number) => padding.top + plotHeight - Math.max(0, value) / maximum * plotHeight

  context.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
  context.fillStyle = '#94a3b8'
  context.textAlign = 'right'
  for (let index = 0; index < 4; index += 1) {
    const ratioY = index / 3
    const lineY = padding.top + plotHeight * ratioY
    const value = maximum * (1 - ratioY)
    context.setLineDash([3, 4])
    context.strokeStyle = '#e8eef5'
    context.lineWidth = 1
    context.beginPath(); context.moveTo(padding.left, lineY); context.lineTo(width - padding.right, lineY); context.stroke()
    context.setLineDash([])
    context.fillText(compact(value), padding.left - 8, lineY + 4)
  }

  const labelSeconds = [0, timelineSeconds.value / 2, timelineSeconds.value]
  context.textAlign = 'center'
  labelSeconds.forEach(seconds => context.fillText(`${compact(seconds)}s`, padding.left + seconds / timelineSeconds.value * plotWidth, height - 8))
  series.forEach(item => {
    context.strokeStyle = item.color
    context.lineWidth = item.width || 2
    context.lineCap = 'round'
    context.lineJoin = 'round'
    context.setLineDash(item.dash || [])
    context.beginPath()
    rows.value.forEach((row, index) => { const pointX = x(index); const pointY = y(Number(row[item.field] || 0)); if (!index) context.moveTo(pointX, pointY); else context.lineTo(pointX, pointY) })
    context.stroke()
  })
  context.setLineDash([])

  const finalSeries = series[series.length - 1]
  const finalY = y(Number(latest.value?.[finalSeries.field] || 0))
  const finalX = x(rows.value.length - 1)
  context.fillStyle = finalSeries.color
  context.beginPath(); context.arc(finalX, finalY, 4.5, 0, Math.PI * 2); context.fill()
  context.strokeStyle = '#fff'; context.lineWidth = 2; context.stroke()
  if (hoverIndex.value !== null) {
    const hoverX = x(hoverIndex.value)
    context.strokeStyle = '#94a3b8'; context.lineWidth = 1; context.setLineDash([3, 3])
    context.beginPath(); context.moveTo(hoverX, padding.top); context.lineTo(hoverX, padding.top + plotHeight); context.stroke(); context.setLineDash([])
  }
}
const scheduleRender = () => {
  cancelAnimationFrame(frameId)
  frameId = requestAnimationFrame(render)
}
const handleMove = (event: MouseEvent) => {
  const element = canvasShell.value
  if (!element || !rows.value.length) return
  const rect = element.getBoundingClientRect()
  const targetSecond = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * timelineSeconds.value
  hoverIndex.value = rows.value.reduce((closest, row, index) => Math.abs(row.second_offset - targetSecond) < Math.abs(rows.value[closest].second_offset - targetSecond) ? index : closest, 0)
}
const compact = (value: number) => new Intl.NumberFormat('zh-CN', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
const number = (value: any) => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })
const percent = (value: number) => `${Math.min(100, Math.max(0, Number(value || 0) * 100)).toFixed(1)}%`
const phaseName = (value: string) => ({ fixed: '固定发压', warmup: '预热', warmup_drain: '预热排空', measure: '测量', confirm: '稳定确认', drain: '排空请求' } as Record<string, string>)[value] || value || '准备中'

watch([rows, chartMode, hoverIndex], () => nextTick(scheduleRender), { deep: true })
onMounted(() => { if (canvasShell.value) resizeObserver = new ResizeObserver(scheduleRender); if (canvasShell.value) resizeObserver.observe(canvasShell.value); nextTick(scheduleRender) })
onBeforeUnmount(() => { resizeObserver?.disconnect(); cancelAnimationFrame(frameId) })
</script>

<style scoped lang="scss">
.qps-trend { margin-top: 1rem; padding: 1.25rem; border: 1px solid var(--el-border-color-light); border-radius: .85rem; background: var(--el-bg-color); }.qps-trend__header { display: flex; min-height: 3.2rem; align-items: flex-start; justify-content: space-between; gap: 1rem; h3 { margin: 0 0 .25rem; font-size: 1.25rem; font-weight: 650; } p { margin: 0; color: var(--el-text-color-secondary); font-size: .95rem; } }.live-state, .saved-state { display: inline-flex; align-items: center; gap: .4rem; color: var(--el-color-primary); font-size: .95rem; white-space: nowrap; }.live-state i { width: .55rem; height: .55rem; border-radius: 50%; background: var(--el-color-primary); box-shadow: 0 0 0 .25rem var(--el-color-primary-light-8); }.saved-state { color: var(--el-text-color-secondary); }
.qps-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 1rem; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: .65rem; > div { min-width: 0; padding: .7rem .85rem; border-right: 1px solid var(--el-border-color-lighter); &:last-child { border-right: 0; } span, strong, em { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } span { display: block; color: var(--el-text-color-secondary); font-size: .88rem; } strong { display: inline-block; margin-top: .25rem; color: var(--el-text-color-primary); font-size: 1.3rem; font-weight: 650; font-variant-numeric: tabular-nums; } em { margin-left: .3rem; color: var(--el-text-color-placeholder); font-size: .82rem; font-style: normal; } &.qps-metrics__latency strong { color: var(--el-color-danger); } } }
.qps-trend__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .7rem; }.qps-trend__switch { display: inline-flex; padding: .2rem; border-radius: .5rem; background: var(--el-fill-color-light); button { height: 2.2rem; padding: 0 .95rem; border: 0; border-radius: .38rem; color: var(--el-text-color-secondary); background: transparent; font-size: .92rem; cursor: pointer; &.active { color: var(--el-color-primary); background: var(--el-bg-color); box-shadow: 0 1px 3px rgba(15, 23, 42, .1); } } }.qps-trend__legend { display: flex; align-items: center; flex-wrap: wrap; justify-content: flex-end; gap: .8rem; color: var(--el-text-color-secondary); font-size: .88rem; span { display: inline-flex; align-items: center; gap: .3rem; } i { display: inline-block; width: 1.35rem; height: .18rem; border-radius: 1rem; } .legend-target { background: #3b82f6; }.legend-success { background: #16a36a; }.legend-completed { background: #64748b; }.legend-average { background: #7c3aed; }.legend-p95 { background: #ef4444; } }
.qps-trend__canvas { position: relative; height: 23rem; border: 1px solid var(--el-border-color-lighter); border-radius: .65rem; background: linear-gradient(180deg, rgba(59, 130, 246, .025), transparent 55%); cursor: crosshair; canvas { display: block; width: 100%; height: 100%; } }.qps-trend__tooltip { position: absolute; z-index: 2; display: grid; gap: .25rem; min-width: 13rem; padding: .65rem .8rem; pointer-events: none; border: 1px solid rgba(148, 163, 184, .35); border-radius: .55rem; color: #cbd5e1; background: rgba(15, 23, 42, .94); box-shadow: 0 .5rem 1.5rem rgba(15, 23, 42, .2); transform: translate(.8rem, -50%); font-size: .9rem; &.right { transform: translate(calc(-100% - .8rem), -50%); } strong { margin-bottom: .15rem; color: #fff; } span { display: flex; justify-content: space-between; gap: 1rem; } b { color: #fff; font-variant-numeric: tabular-nums; } }
@media (max-width: 900px) { .qps-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); > div:nth-child(2) { border-right: 0; } > div:nth-child(-n + 2) { border-bottom: 1px solid var(--el-border-color-lighter); } }.qps-trend__toolbar { align-items: flex-start; flex-direction: column; }.qps-trend__legend { justify-content: flex-start; }.qps-trend__canvas { height: 20rem; } }
</style>
