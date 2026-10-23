export interface TrafficServer {
	source: 'ecs' | 'swas'
	region_id: string
	instance_id: string
	name: string
}

export interface TrafficDay {
	date: string
	in_bytes: number | null
	out_bytes: number | null
	partial: boolean
	data_time: number
}

export interface ServerTraffic {
	days: TrafficDay[]
	today: TrafficDay
	yesterday: TrafficDay
	this_month?: TrafficMonth
	last_month?: TrafficMonth
	update_time: number
	data_time: number
	errors: Array<{ direction: 'in' | 'out'; message: string; code: string; request_id: string }>
	source: string
	note: string
}

export interface TrafficMonth {
	month: string
	in_bytes: number | null
	out_bytes: number | null
	partial: boolean
	data_time: number
}

export const serverTrafficKey = (server: TrafficServer) => `${server.source}:${server.region_id}:${server.instance_id}`

export const formatServerTraffic = (value?: number | null) => {
	if (value === null || value === undefined || !Number.isFinite(value) || value < 0) return '--'
	const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
	const index = value > 0 ? Math.max(0, Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)) : 0
	return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 2)} ${units[index]}`
}

export const formatTrafficTime = (timestamp: number) => timestamp
	? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(timestamp)
	: '--'
