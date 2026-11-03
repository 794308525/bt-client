import { common, routes } from '@api/http'

export interface TencentAccount {
	account_id: number
	group_id: number
	remark: string
	site: 'cn' | 'intl'
	secret_id: string
	balance: string
	balance_currency: string
	balance_refresh_time: number
	balance_error: string
	server_count: number
	cvm_count: number
	lighthouse_count: number
	server_refresh_time: number
	server_error: string
	resource_summary: Record<string, ResourceSummary>
	sort: number
}
export interface TencentGroup {
	group_id: number
	group_name: string
	account_count: number
}
export interface TencentServer {
	source: 'cvm' | 'lighthouse'
	instance_id: string
	name: string
	region_id: string
	region_name: string
	status: string
	os_name: string
	cpu: number | null
	memory_gb: number | null
	disk_gb: number | null
	bandwidth_mbps: number | null
	public_ips: string[]
	private_ips: string[]
	instance_type: string
	charge_type: string
	expired_time: string
	latest_operation_state: string
	pending?: {
		action: 'start' | 'stop'
		uncertain: boolean
		request_id: string
		time: number
	} | null
}
export interface TencentTraffic {
	server_key: string
	update_time: number
	summary: Record<string, { out_mb: number | null; partial: boolean }> | null
	days: Array<{ date: string; out_mb: number | null; partial: boolean }>
	packages: Array<{
		id: string
		total: number | null
		used: number | null
		remaining: number | null
		overflow: number | null
		start_time: string
		end_time: string
	}>
	errors: string[]
}
export interface TencentStatistics extends TencentTraffic {
	trend_period: number
	trend: Array<{ time: number; in_mbps: number | null; out_mbps: number | null }>
	note: string
}
export async function request<T = any>(
	action: keyof typeof routes.tencent,
	data: Record<string, unknown> = {}
): Promise<T> {
	const result: any = await common.sendAsync({
		route: routes.tencent[action].path,
		data,
		// 文件选择和持续传输不设总时限，网络停滞由 COS SDK 的超时处理。
		timeout: action === 'cos_upload' || action === 'cos_download' ? 0 : 300000,
	})
	if (!result?.status) {
		const error = new Error(result?.msg || '腾讯云请求失败')
		Object.assign(error, result?.data || {})
		throw error
	}
	return result.data as T
}
export interface ResourceSummary {
	status: string
	count?: number
	checked_at: number
	success_at?: number
	partial?: boolean
	error?: {
		message: string
		code: string
		http_code?: number
		request_id: string
		action: string
	} | null
}
export interface PageResult<T> {
	data: T[]
	total: number
}
export type ResourceAction =
	| 'domain_list'
	| 'record_list'
	| 'record_meta'
	| 'record_change'
	| 'record_batch'
	| 'cos_buckets'
	| 'cos_objects'
	| 'cos_remove'
	| 'cdn_list'
	| 'edge_zones'
	| 'edge_domains'
	| 'edge_plans'
	| 'edge_config'
	| 'edge_change'
	| 'ssl_list'
	| 'cache_submit'
	| 'cache_tasks'
	| 'cache_progress'
	| 'edge_traffic'
export function resourceRequest<T = any>(
	action: ResourceAction,
	data: Record<string, unknown> = {}
): Promise<T> {
	return request<T>('resources', { ...data, resource_action: action })
}
export const resourceNames: Record<string, string> = {
	domains: '域名',
	registration: '注册域名',
	cos: 'COS',
	cdn: 'CDN',
	edgeone: 'EdgeOne',
}
export const resourceStatusName = (status?: string) =>
	(
		({
			active: '可用',
			partial: '部分获取',
			not_opened: '未开通',
			permission_denied: '无权限',
			invalid_credentials: '密钥无效',
			authentication_error: '认证异常',
			rate_limited: '限流',
			quota_exceeded: '配额不足',
			disabled: '已停用',
			migrated: '已迁移/迁移中',
			verification_required: '待认证',
			unsupported: '暂不支持',
			network: '网络异常',
			timeout: '超时',
			unavailable: '服务异常',
			error: '获取失败',
		}) as Record<string, string>
	)[status || ''] || '待探测'
export const resourceCount = (summary?: ResourceSummary) =>
	summary?.status === 'active'
		? (summary.count ?? '--')
		: summary?.status === 'partial'
			? summary.count != null
				? `${summary.count}+`
				: '部分可用'
			: resourceStatusName(summary?.status)
export function cloudErrorText(error: unknown) {
	const data = error as {
		message?: string
		error_code?: string
		http_code?: number
		request_id?: string
		action?: string
	}
	return [
		data?.message || '请求失败',
		data?.action,
		data?.error_code,
		data?.http_code ? `HTTP ${data.http_code}` : '',
		data?.request_id ? `RequestId: ${data.request_id}` : '',
	]
		.filter(Boolean)
		.join(' · ')
}
export const serverKey = (server: TencentServer) =>
	`${server.source}:${server.region_id}:${server.instance_id}`
export const descriptor = (server: TencentServer) => ({
	source: server.source,
	region_id: server.region_id,
	instance_id: server.instance_id,
})
export const count = (value: number) => (value >= 0 ? String(value) : '--')
export const maskId = (value: string) =>
	value.length > 12 ? `${value.slice(0, 6)}····${value.slice(-4)}` : value
export const money = (account?: TencentAccount | null) =>
	account?.balance !== '' && account?.balance !== undefined
		? new Intl.NumberFormat('zh-CN', {
				style: 'currency',
				currency: account.balance_currency || 'CNY',
			}).format(Number(account.balance))
		: '--'
export function timeText(value?: string | number, dateOnly = false) {
	if (!value) return '--'
	const date = new Date(typeof value === 'number' ? value * 1000 : value)
	if (!Number.isFinite(date.getTime())) return '--'
	return new Intl.DateTimeFormat('zh-CN', {
		timeZone: 'Asia/Shanghai',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		...(dateOnly ? {} : { hour: '2-digit', minute: '2-digit', hour12: false }),
	}).format(date)
}
export function volume(value: number | null | undefined, unit: 'B' | 'MB' = 'B') {
	if (value === null || value === undefined || !Number.isFinite(value)) return '--'
	const units = unit === 'MB' ? ['MB', 'GB', 'TB', 'PB'] : ['B', 'KB', 'MB', 'GB', 'TB']
	let index = 0
	while (value >= 1024 && index < units.length - 1) {
		value /= 1024
		index++
	}
	return `${value.toFixed(2)} ${units[index]}`
}
const statusNames: Record<string, string> = {
	RUNNING: '运行中',
	STOPPED: '已关机',
	STARTING: '开机中',
	STOPPING: '关机中',
	REBOOTING: '重启中',
	PENDING: '创建中',
	TERMINATING: '销毁中',
	TERMINATED: '已销毁',
	UNKNOWN: '未知',
}
export const statusName = (status: string) => statusNames[status] || status
export const statusType = (status: string): 'success' | 'warning' | 'info' =>
	status === 'RUNNING' ? 'success' : status === 'STOPPED' ? 'info' : 'warning'
