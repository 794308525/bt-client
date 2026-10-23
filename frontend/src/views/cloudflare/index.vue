<template>
  <div class="cloudflare-page">
    <header class="cloudflare-header"><div class="cloudflare-logo"><bt-icon name="cloudflare" size="28" /></div><div><h1>{{ pub.lang('Cloudflare') }}</h1><p>{{ pub.lang('管理 Cloudflare 账号与站点') }}</p></div><el-button type="primary" :icon="Plus" @click="openDialog()">{{ pub.lang('添加账号') }}</el-button></header>
    <div class="cloudflare-grid">
      <el-card v-for="account in accounts" :key="account.account_id" class="cloudflare-card" shadow="hover" @click="openAccount(account)">
        <template #header><div class="card-header"><div><strong>{{ account.remark }}</strong><p>API Token · {{ pub.lang('已加密保存') }}</p></div><el-dropdown @command="command => command === 'edit' ? openDialog(account) : removeAccount(account)" @click.stop><el-button text :icon="MoreFilled" /><template #dropdown><el-dropdown-menu><el-dropdown-item command="edit">{{ pub.lang('编辑') }}</el-dropdown-item><el-dropdown-item command="remove" divided>{{ pub.lang('删除') }}</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></template>
        <div class="card-stat"><strong>{{ account.zone_count ?? '--' }}</strong><span>{{ pub.lang('站点') }}</span></div>
        <el-button text type="primary" @click.stop="openAccount(account)">{{ pub.lang('进入管理') }} →</el-button>
      </el-card>
    </div>
    <el-empty v-if="!loading && !accounts.length" :description="pub.lang('暂未添加 Cloudflare 账号')"><el-button type="primary" @click="openDialog()">{{ pub.lang('添加账号') }}</el-button></el-empty>
    <el-dialog v-model="dialogVisible" width="480px" :title="editingId ? pub.lang('编辑 Cloudflare 账号') : pub.lang('添加 Cloudflare 账号')" :close-on-click-modal="false" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top"><el-form-item :label="pub.lang('备注')" prop="remark"><el-input v-model="form.remark" maxlength="40" show-word-limit placeholder="例如：生产环境" /></el-form-item><el-form-item label="API Token" prop="api_token"><el-input v-model="form.api_token" type="password" show-password autocomplete="new-password" :placeholder="editingId ? pub.lang('留空表示不修改') : pub.lang('请输入 Cloudflare API Token')" /><div class="token-help"><span>{{ pub.lang('尚未创建 Token？') }}</span><el-link href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" type="primary">{{ pub.lang('获取 API Token') }}</el-link></div></el-form-item><el-form-item :label="pub.lang('Cloudflare Account ID（创建站点必填）')"><el-input v-model="form.cloudflare_account_id" maxlength="32" placeholder="32 位 Account ID" autocomplete="off" /><div class="field-help">{{ pub.lang('在 Cloudflare 账号主页复制；一个 Token 可按不同 Account ID 分别添加账号。') }}</div></el-form-item><el-alert type="info" :closable="false" :title="pub.lang('读取站点仅需 Zone:Read；创建站点还需 Account:Zone:Edit；完整站点管理还需 Zone:Edit、DNS:Read/DNS:Edit、Zone Settings:Edit、Cache Purge')" /></el-form>
      <template #footer><el-button @click="dialogVisible = false">{{ pub.lang('取消') }}</el-button><el-button type="primary" :loading="saving" @click="saveAccount">{{ pub.lang('保存') }}</el-button></template>
    </el-dialog>
  </div>
</template>
<script setup lang="ts">
import { MoreFilled, Plus } from '@element-plus/icons-vue'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import { pub } from '@utils/tools'
interface CloudflareAccount {
  account_id: number
  cloudflare_account_id: string
  remark: string
  zone_count: number
}

const Message = useMessage()
const router = useRouter()
const accounts = ref<CloudflareAccount[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const saving = ref(false)
const editingId = ref(0)
const formRef = ref<FormInstance>()
const form = reactive({ remark: '', api_token: '', cloudflare_account_id: '' })
const rules: FormRules = { remark: [{ required: true, message: pub.lang('请输入备注'), trigger: 'blur' }], api_token: [{ validator: (_r: any, value: string, cb: any) => { if (!editingId.value && !value) cb(new Error(pub.lang('请输入 API Token'))); else cb() }, trigger: 'blur' }] }
const request = (route: string, data: any = {}) => common.sendAsync({ route, data, timeout: 30000 }) as Promise<any>
async function load() { loading.value = true; try { const res = await request(routes.cloudflare.list.path); if (res?.status) accounts.value = res.data?.data || []; else Message.request(res) } catch { Message.error(pub.lang('账号列表加载失败')) } finally { loading.value = false } }
function openDialog(account?: CloudflareAccount) { editingId.value = account?.account_id || 0; form.remark = account?.remark || ''; form.api_token = ''; form.cloudflare_account_id = account?.cloudflare_account_id || ''; dialogVisible.value = true }
function resetForm() { editingId.value = 0; form.remark = ''; form.api_token = ''; form.cloudflare_account_id = '' }
async function saveAccount() { const valid = await formRef.value?.validate().catch(() => false); if (!valid) return; saving.value = true; try { const res = await request(routes.cloudflare.save.path, { account_id: editingId.value, remark: form.remark, api_token: form.api_token, cloudflare_account_id: form.cloudflare_account_id }); Message.request(res); if (res?.status) { dialogVisible.value = false; await load() } } catch { Message.error(pub.lang('保存失败')) } finally { saving.value = false } }
async function removeAccount(account: CloudflareAccount) { try { await ElMessageBox.confirm(pub.lang('确定删除 Cloudflare 账号“{}”吗？', account.remark), pub.lang('删除账号'), { type: 'warning' }) } catch { return } try { const res = await request(routes.cloudflare.remove.path, { account_id: account.account_id }); Message.request(res); if (res?.status) await load() } catch { Message.error(pub.lang('删除失败')) } }
function openAccount(account: CloudflareAccount) { router.push(`/cloudflare/${account.account_id}`) }
load()
</script>
<style scoped lang="scss">
.cloudflare-page { padding: 2rem; height: 100%; overflow: auto; background: var(--el-bg-color-page); }.cloudflare-header { display:flex; align-items:center; gap:1rem; margin-bottom:2rem; }.cloudflare-header .el-button { margin-left:auto; }.cloudflare-logo { width:3.2rem; height:3.2rem; display:grid; place-items:center; border-radius:.8rem; background:#f48120; color:#fff; }.cloudflare-header h1 { margin:0; font-size:1.8rem; }.cloudflare-header p,.card-header p { margin:.35rem 0 0; color:var(--el-text-color-secondary); }.cloudflare-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:1.2rem; }.cloudflare-card { cursor:pointer; }.card-header { display:flex; justify-content:space-between; align-items:flex-start; }.card-header strong { font-size:1.15rem; }.card-stat { display:flex; flex-direction:column; margin:1rem 0; }.card-stat strong { font-size:2rem; }.card-stat span { color:var(--el-text-color-secondary); }.token-help,.field-help { display:flex; align-items:center; gap:.5rem; width:100%; margin-top:.7rem; color:var(--el-text-color-secondary); font-size:1.2rem; }
</style>
