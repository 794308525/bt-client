// 引用IPC通信库
import { ipc } from '@utils/ipcRenderer'
// 引用后端路由
import routes from '*electron.route.js'

interface AsyncProps {
	route: string
	data: any
	timeout?: number
	onProgress?: (data: any) => void
}
class IpcCommon {
	private requestId = 0

	time() {
		return Math.round(new Date().getTime() / 1000)
	}

	send(route: string, data: any, callback?: any) {
		let channel = route
		ipc.removeAllListeners(channel)
		ipc.on(channel, (event: any, result: any) => {
			// console.log(channel, result, 'ipcData')
			if (result && callback) {
				callback(result)
			}
		})
		let pdata = {
			channel: channel,
			data: toRaw(data),
		}

		ipc.send(channel, pdata)
	}

	//异步发送
	sendAsync({ route, data, timeout, onProgress }: AsyncProps) {
		return new Promise((resolve, reject) => {
			const channel = `${route}:reply:${Date.now()}:${++this.requestId}`
			let timer: ReturnType<typeof setTimeout> | null = null
			const onResult = (event: any, result: any) => {
				if (!result) return
				if (result.__ipc_progress === true) {
					onProgress?.(result.data)
					return
				}
				if (timer) clearTimeout(timer)
				ipc.removeListener(channel, onResult)
				resolve(result)
			}
			ipc.on(channel, onResult)
			if (timeout && timeout > 0) {
				timer = setTimeout(() => {
					ipc.removeListener(channel, onResult)
					reject(new Error('请求超时'))
				}, timeout)
			}
			let pdata = {
				channel: channel,
				data: toRaw(data),
			}
			ipc.send(route, pdata)
		})
	}
}

const common = new IpcCommon()
export { common, routes, ipc }
