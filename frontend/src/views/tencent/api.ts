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
		timeout: 300000,
	})
	if (!result?.status) throw new Error(result?.msg || '腾讯云请求失败')
	return result.data as T
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
