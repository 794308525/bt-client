<template>
	<el-dialog
		v-model="dialogVisible"
		align-center
		class="bt-dialog"
		width="360"
		@close="closeDialog"
		draggable
		:show-close="!saving"
		:close-on-press-escape="!saving"
		:close-on-click-modal="false">
		<template #header>
			<div>
				<span class="text-1.4rem leading-[1.8rem] text-grey-333 truncate">{{ title }}</span>
			</div>
		</template>
		<el-form :model="form" @submit.prevent>
			<el-form-item :label="pub.lang('管理密码')">
				<el-input
					v-model="form.password"
					:type="isEdit && showPassword ? 'text' : 'password'"
					:show-password="!isEdit"
					@keydown.enter.prevent="handleSubmit"
					:placeholder="pub.lang('请输入管理密码')" />
			</el-form-item>
			<el-form-item v-if="isEdit" :label="pub.lang('确认管理密码')">
				<el-input v-model="form.confirmPassword" :type="showPassword ? 'text' : 'password'"
					:placeholder="pub.lang('确认管理密码')" @keydown.enter.prevent="handleSubmit" />
			</el-form-item>
			<el-checkbox v-if="isEdit" v-model="showPassword">{{ pub.lang('显示密码') }}</el-checkbox>
		</el-form>
		<template #footer>
			<div class="dialog-footer">
				<el-button :disabled="saving" @click="closeDialog">{{ pub.lang('取消') }}</el-button>
				<el-button type="primary" :loading="saving" @click="handleSubmit">
					{{ pub.lang('确定') }}
				</el-button>
			</div>
		</template>
	</el-dialog>
</template>

<script setup lang="ts">
import { useMessage } from '@utils/hooks/message'
import { common, routes } from '@/api/http'
import { pub } from '@/utils/tools'

const emit = defineEmits(['refresh', 'close'])

const Message = useMessage() // 消息提示
const dialogVisible = ref(false)
const isEdit = ref(false)
const showPassword = ref(true)
const saving = ref(false)
const form = reactive({
	password: '',
	confirmPassword: '',
})

const isFirstSetup = ref(false)
const title = computed(() => (isEdit.value ? pub.lang(isFirstSetup.value ? '设置管理密码' : '修改管理密码') : pub.lang('确认管理密码')))

const handleSubmit = () => {
	if (saving.value) return
	if (!form.password) return Message.warn(pub.lang('密码不能为空'))
	if (isEdit.value && form.password.length < 8) return Message.warn(pub.lang('密码长度不能小于8位'))
	if (isEdit.value && form.password !== form.confirmPassword) return Message.warn(pub.lang('两次输入密码不一致'))
	let params: any = { password: form.password },
		api = routes.index.set_password.path
	if (!isEdit.value) {
		params.not_password = true
		api = routes.index.not_password.path
	}
	saving.value = true
	common.send(api, params, (res: any) => {
		saving.value = false
		Message.request(res)
		if (res.status) {
			emit('refresh')
			dialogVisible.value = false
		}
	})
}

const acceptParams = (params: any) => {
	dialogVisible.value = true
	isEdit.value = params.isEdit
	isFirstSetup.value = params.isFirstSetup === true
	form.password = ''
	form.confirmPassword = ''
	showPassword.value = true
}
const closeDialog = () => {
	if (!isEdit.value) emit('close')
	dialogVisible.value = false
}

defineExpose({
	acceptParams,
})
</script>
