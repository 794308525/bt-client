<template>
	<section class="backup-section" aria-labelledby="backup-heading">
		<header><h2 id="backup-heading">{{ pub.lang('数据备份与恢复') }}</h2></header>
		<div class="backup-row">
			<div class="backup-description">
				<h3>{{ pub.lang('完整数据备份') }}</h3>
				<p>{{ pub.lang('包含面板、服务器、云账号、代理、管理配置和本地记录。导出文件使用独立的备份密码保护，请妥善保管。') }}</p>
			</div>
			<div class="backup-actions">
				<el-button type="primary" plain :disabled="busy" @click="showExport">{{ pub.lang('导出备份') }}</el-button>
				<el-button :loading="choosing" :disabled="busy" @click="chooseImport">{{ pub.lang('导入备份') }}</el-button>
			</div>
		</div>
		<div class="backup-note">
			<p>{{ pub.lang('导入会替换全部本地数据并重启，沿用备份中的管理密码及免密设置。导入前会自动保存一份当前数据，请先退出共用数据的其他版本。') }}</p>
			<p>{{ pub.lang('不包含浏览器缓存、下载目录及应用外部文件。') }}</p>
			<el-button link type="primary" :disabled="busy" @click="openBackups">{{ pub.lang('查看导入前备份') }}</el-button>
		</div>

		<el-dialog v-model="exportVisible" :title="pub.lang('导出完整数据备份')" width="460px" append-to-body :close-on-click-modal="false" :close-on-press-escape="!exporting" :show-close="!exporting" @closed="clearPasswords">
			<p class="dialog-description">{{ pub.lang('备份可能包含账号、密钥和操作记录。此密码用于保护备份文件，与应用管理密码相互独立；遗忘后无法恢复。') }}</p>
			<el-form label-position="top" @submit.prevent="exportBackup">
				<el-form-item :label="pub.lang('备份密码')"><el-input v-model="password" type="password" show-password :maxlength="256" autocomplete="new-password" :disabled="exporting" :placeholder="pub.lang('至少 8 位')" /></el-form-item>
				<el-form-item :label="pub.lang('确认备份密码')"><el-input v-model="confirmation" type="password" show-password :maxlength="256" autocomplete="new-password" :disabled="exporting" @keyup.enter="exportBackup" /></el-form-item>
			</el-form>
			<template #footer><el-button :disabled="exporting" @click="exportVisible = false">{{ pub.lang('取消') }}</el-button><el-button type="primary" :loading="exporting" @click="exportBackup">{{ pub.lang('选择位置并导出') }}</el-button></template>
		</el-dialog>

		<el-dialog v-model="importVisible" :title="pub.lang('解锁备份文件')" width="460px" append-to-body :close-on-click-modal="false" :close-on-press-escape="!importing" :show-close="!importing" @closed="clearPasswords">
			<p class="dialog-description backup-filename">{{ selectedFile }}</p>
			<el-form label-position="top" @submit.prevent="restoreBackup">
				<el-form-item :label="pub.lang('备份密码')"><el-input v-model="password" type="password" show-password :maxlength="256" autocomplete="off" :disabled="importing" :placeholder="pub.lang('输入导出时设置的备份密码')" @keyup.enter="restoreBackup" /></el-form-item>
			</el-form>
			<template #footer><el-button :disabled="importing" @click="importVisible = false">{{ pub.lang('取消') }}</el-button><el-button type="primary" :loading="importing" @click="restoreBackup">{{ pub.lang('校验并继续') }}</el-button></template>
		</el-dialog>
	</section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { common, routes } from '@api/http'
import { pub } from '@utils/tools'
import { useMessage } from '@utils/hooks/message'

const Message = useMessage()
const exportVisible = ref(false)
const importVisible = ref(false)
const exporting = ref(false)
const importing = ref(false)
const choosing = ref(false)
const restarting = ref(false)
const password = ref('')
const confirmation = ref('')
const selectedFile = ref('')
const token = ref('')
const busy = computed(() => exporting.value || importing.value || choosing.value || restarting.value)
const clearPasswords = () => { password.value = ''; confirmation.value = '' }
const showExport = () => { clearPasswords(); exportVisible.value = true }

const exportBackup = async () => {
	if (exporting.value) return
	if (password.value.length < 8 || password.value.length > 256) return Message.error(pub.lang('备份密码长度应为 8～256 位'))
	if (password.value !== confirmation.value) return Message.error(pub.lang('两次输入的备份密码不一致'))
	exporting.value = true
	try {
		const result: any = await common.sendAsync({ route: routes.backup.export_data.path, data: { password: password.value } })
		if (!result?.status) return Message.request(result)
		if (result.data.canceled) return
		exportVisible.value = false
		Message.success(pub.lang('完整数据备份已导出'))
	} catch (_) { Message.error(pub.lang('导出失败，请重试')) }
	finally { exporting.value = false }
}

const chooseImport = async () => {
	choosing.value = true
	clearPasswords()
	try {
		const result: any = await common.sendAsync({ route: routes.backup.choose_import.path, data: {} })
		if (!result?.status) return Message.request(result)
		if (result.data.canceled) return
		token.value = result.data.token
		selectedFile.value = result.data.fileName
		if (result.data.encrypted) importVisible.value = true
		else await restoreBackup()
	} catch (_) { Message.error(pub.lang('无法选择备份文件，请重试')) }
	finally { choosing.value = false }
}

const restoreBackup = async () => {
	if (importing.value) return
	importing.value = true
	try {
		const result: any = await common.sendAsync({ route: routes.backup.import_data.path, data: { token: token.value, password: password.value } })
		if (!result?.status) return Message.request(result)
		if (result.data.canceled) return
		restarting.value = true
		importVisible.value = false
		clearPasswords()
		Message.success(pub.lang('已自动备份当前数据，正在重启并导入'))
	} catch (_) { Message.error(pub.lang('导入失败，请重试')) }
	finally { importing.value = false }
}

const openBackups = async () => {
	try {
		const result: any = await common.sendAsync({ route: routes.backup.open_backups.path, data: {} })
		if (!result?.status) Message.request(result)
	} catch (_) { Message.error(pub.lang('无法打开自动备份目录')) }
}
</script>

<style scoped lang="scss">
.backup-section { min-width: 0; overflow: hidden; border: 1px solid var(--el-border-color); border-radius: 0.8rem; background: var(--el-bg-color); }
header { display: flex; align-items: center; min-height: 5.6rem; padding: 1.2rem 2rem; background: var(--el-fill-color-light); }
h2 { margin: 0; font-size: 1.4rem; font-weight: 600; line-height: 2.4rem; }
.backup-row { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1.6rem; padding: 1.6rem 2rem; border-top: 1px solid var(--el-border-color-lighter); }
.backup-description { flex: 1; min-width: 22rem; }
h3 { margin: 0; font-size: 1.3rem; font-weight: 500; line-height: 2rem; }
p { margin: 0.4rem 0 0; color: var(--el-text-color-regular); font-size: 1.2rem; line-height: 1.7; }
.backup-description p { max-width: 48rem; }
.backup-actions { display: flex; gap: 0.8rem; flex-wrap: wrap; :deep(.el-button + .el-button) { margin-left: 0; } }
.backup-note { padding: 0 2rem 1.6rem; }
.dialog-description { margin: 0 0 1.6rem; }
.backup-filename { overflow-wrap: anywhere; }
</style>
