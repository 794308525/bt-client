import { common, routes } from '@api/http'

/**
 * @description 保存设置页面的配置
 * @param {string} key 键
 * @param {any} value 值
 */
export async function saveConfig(key: string, value: any) {
	return await common.sendAsync({
		route: routes.index.set_config.path,
		data: {
			key,
			value,
		},
	})
}
