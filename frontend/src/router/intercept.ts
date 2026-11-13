/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Router } from 'vue-router'
import { storeToRefs } from 'pinia'
import { ElMessage } from 'element-plus'
import { pub } from '@/utils/tools'

const whiteList = ['/login', '/lock'] // 定义白名单  所有不受权限控制的页面
const history = ['/home', '/setting', '/xterm', '/aliyun', '/tencent', '/cloudflare', '/toolbox']

export default (router: Router) => {
	router.beforeEach(async (to, _from, next) => {
		// 遍历所有.el-overlay,检测属性style.display是否为none，否则不允许跳转
		const overlays = document.querySelectorAll('.el-overlay')
		let isOverlay = false
		overlays.forEach((item: any) => {
			if (item.style.display !== 'none') {
				isOverlay = true
			}
		})
		if (isOverlay && _from.path !== '/lock') {
			return next(false)
		}

		const { useUserStore } = await import('@/store/user')
		const userStores = useUserStore()
		const userStore = storeToRefs(userStores)
		//  首先判断是否登录
		if (
			// userStore.isLogin.value &&
			userStore.isSetAdminPassword.value &&
			userStore.passwordIsRight.value
		) {
			if (to.path === '/lock') {
				next(userStore.routerHistory.value || '/home')
			} else {
				userStore.routerHistory.value = history.includes(to.path) || to.path.startsWith('/aliyun/') || to.path.startsWith('/tencent/') || to.path.startsWith('/cloudflare/') ? to.path : '/home'
				next()
			}
		} else if (whiteList.includes(to.path)) {
			next()
		} else {
			try {
				const password: any = await userStores.getAdminPassword()
				if (!password.status) return next('/lock')
				const config: any = await userStores.isFreeAdminPassword()
				if (config.not_password) {
					userStore.routerHistory.value = history.includes(to.path) || to.path.startsWith('/aliyun/') || to.path.startsWith('/tencent/') || to.path.startsWith('/cloudflare/') ? to.path : '/home'
					return next()
				}
				next('/lock')
			} catch (_) {
				ElMessage.error(pub.lang('应用初始化失败，请重新打开应用后重试'))
				next(false)
			}
			// let _status = await userStores.isLoginStatus()
			// if (_status) {
			// } else {
			// 	next('/login')
			// }
		}
	})
}
