//1.创建store
import { defineStore } from 'pinia'
import { common, routes } from '@api/http'
//2.第一个参数是id,传入一个字符串，第二个参数是是对象
export const useUserStore = defineStore('userStore', {
	state: () => {
		return {
			isLogin: false, // 是否登录
			info: {
				username: '', // 用户名
			}, // 用户信息
			isSetAdminPassword: false, // 是否设置管理密码
			passwordIsRight: false, // 密码是否正确
			lockScreen: false, //锁定屏幕
			routerHistory: '',
		}
	},
	getters: {},
	actions: {
		// 获取绑定用户
		async getBindUser() {
			try {
				const res: any = await common.sendAsync({ route: routes.user.get_user_info.path, data: {}, timeout: 5000 })
				this.isLogin = res.status
				this.info = res.status ? res.data : { username: '' }
				return res
			} catch (_) {
				this.isLogin = false
				this.info = { username: '' }
				return { status: false }
			}
		},
		//管理密码是否正确
		updateLockScreen(value: boolean) {
			this.passwordIsRight = value
		},
		// 获取管理密码状态
		async getAdminPassword() {
			const res: any = await common.sendAsync({ route: routes.index.has_password.path, data: {}, timeout: 10000 })
			if (typeof res?.status !== 'boolean') throw new Error('无法读取管理密码状态')
			this.isSetAdminPassword = res.status
			return res
		},
		// 是否免管理密码
		async isFreeAdminPassword() {
			const res: any = await common.sendAsync({ route: routes.index.get_config.path, data: {}, timeout: 10000 })
			if (!res?.status || !res.data) throw new Error('无法读取应用设置')
			if (res.data.not_password) this.passwordIsRight = true
			return res.data
		},
		// 登录时判断
		// isLoginStatus() {
		// 	return new Promise((resolve, reject) => {
		// 		resolve(this.isLogin)
		// 	})
		// },
	},
	persist: {
		paths: ['routerHistory'],
	},
})
