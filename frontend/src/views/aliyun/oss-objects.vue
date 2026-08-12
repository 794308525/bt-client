<template>
	<div class="oss-objects-page">
		<header class="page-header">
			<div class="page-identity">
				<el-button circle :icon="ArrowLeft" @click="goBack" />
				<div>
					<h1>{{ bucket }}</h1>
					<p><span>{{ region }}</span><code>{{ bucketEndpoint }}</code></p>
				</div>
			</div>
			<div class="header-actions">
				<div class="view-switch" role="group" :aria-label="pub.lang('显示方式')">
					<button type="button" :class="{ active: viewMode === 'list' }" :title="pub.lang('列表视图')" @click="viewMode = 'list'"><List /></button>
					<button type="button" :class="{ active: viewMode === 'grid' }" :title="pub.lang('图标视图')" @click="viewMode = 'grid'"><Grid /></button>
				</div>
				<el-button :icon="Refresh" :loading="loading" @click="loadObjects(true)" />
				<el-button type="primary" :icon="Upload" :loading="uploading" @click="uploadObjects">{{ pub.lang('上传') }}</el-button>
			</div>
		</header>

		<div class="object-toolbar">
			<div class="object-breadcrumb">
				<el-button v-if="prefix" link :icon="ArrowUp" :title="pub.lang('返回上级目录')" @click="goParent" />
				<button type="button" class="breadcrumb-root" @click="goRoot">{{ bucket }}</button>
				<template v-for="part in prefixParts" :key="part.path">
					<span>/</span><button type="button" @click="goPath(part.path)">{{ part.name }}</button>
				</template>
			</div>
			<el-input v-model="prefix" clearable :prefix-icon="Search" :placeholder="pub.lang('按对象名称前缀筛选')" @keydown.enter="loadObjects(true)" />
			<el-button :icon="Search" @click="loadObjects(true)">{{ pub.lang('查询') }}</el-button>
			<span class="selection-summary">{{ selectedNames.length ? pub.lang(`已选 ${selectedNames.length} 项`) : pub.lang('未选择对象') }}</span>
			<el-button type="danger" plain :disabled="!selectedNames.length" @click="removeSelected">{{ pub.lang('删除') }}</el-button>
		</div>

		<section v-loading="loading" class="object-content">
			<el-table v-if="viewMode === 'list'" ref="tableRef" :data="objects" row-key="name" height="100%" :default-sort="tableDefaultSort" @row-click="handleRowClick" @sort-change="handleTableSort" @selection-change="setTableSelection">
				<el-table-column type="selection" width="46" />
				<el-table-column :label="pub.lang('名称')" min-width="360">
					<template #default="{ row }">
						<div class="file-name-cell" :class="{ 'is-directory': row.is_directory }">
							<img v-if="hasPreview(row)" :src="row.preview_url" alt="" loading="lazy" @error="markPreviewFailed(row.name)" />
							<component :is="fileIcon(row)" v-else />
							<span>{{ displayName(row) }}</span>
						</div>
					</template>
				</el-table-column>
				<el-table-column prop="size" :label="pub.lang('大小')" width="120" sortable="custom"><template #default="{ row }">{{ row.is_directory ? '--' : formatBytes(row.size) }}</template></el-table-column>
				<el-table-column :label="pub.lang('存储类型')" width="130"><template #default="{ row }">{{ row.storage_class || '--' }}</template></el-table-column>
				<el-table-column prop="last_modified" :label="pub.lang('最后修改')" width="180" sortable="custom"><template #default="{ row }">{{ formatDate(row.last_modified) }}</template></el-table-column>
				<el-table-column :label="pub.lang('操作')" width="90" fixed="right"><template #default="{ row }"><el-button v-if="!row.is_directory" link type="primary" :loading="downloadingName === row.name" @click="downloadObject(row)">{{ pub.lang('下载') }}</el-button></template></el-table-column>
			</el-table>

			<div v-else-if="objects.length" class="object-grid">
				<article v-for="object in objects" :key="object.name" class="object-tile" :class="{ selected: selectedNameSet.has(object.name) }" @click="handleObjectClick(object)">
					<div class="tile-preview">
						<img v-if="hasPreview(object)" :src="object.preview_url" :alt="object.name" loading="lazy" @error="markPreviewFailed(object.name)" />
						<component :is="fileIcon(object)" v-else />
						<el-checkbox :model-value="selectedNameSet.has(object.name)" @click.stop @change="toggleObject(object)" />
					</div>
					<div class="tile-info">
					<strong :title="object.name">{{ displayName(object) }}</strong>
						<span :title="object.name">{{ parentPath(object.name) }}</span>
						<footer><em>{{ object.is_directory ? pub.lang('目录') : formatBytes(object.size) }}</em><el-button v-if="!object.is_directory" link :icon="Download" :loading="downloadingName === object.name" :title="pub.lang('下载')" @click.stop="downloadObject(object)" /></footer>
					</div>
				</article>
			</div>
			<el-empty v-else-if="!loading" :description="pub.lang('暂无 OSS 对象')" />
		</section>

		<footer class="page-pagination">
			<span>{{ pub.lang(`第 ${page} 页`) }}</span>
			<el-pagination v-if="isSorted" v-model:current-page="page" :page-size="pageSize" layout="total, prev, pager, next" :total="totalObjects" @current-change="loadObjects" />
			<template v-else>
				<el-button :disabled="page === 1 || loading" @click="previousPage">{{ pub.lang('上一页') }}</el-button>
				<el-button :disabled="!nextMarker || loading" @click="nextPage">{{ pub.lang('下一页') }}</el-button>
			</template>
		</footer>
	</div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { ArrowLeft, Download, Document, Film, Folder, Grid, Headset, List, Picture, Refresh, Search, Tickets, Upload } from '@element-plus/icons-vue'
import { useStorage } from '@vueuse/core'
import { ElMessageBox, type TableInstance } from 'element-plus'
import { common, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import { pub } from '@utils/tools'

interface OssObject { name: string; size: number; is_directory: boolean; last_modified: string; etag: string; storage_class: string; preview_url: string }

const route = useRoute()
const router = useRouter()
const Message = useMessage()
const accountId = Number(route.params.accountId)
const bucket = decodeURIComponent(String(route.params.bucket || ''))
const region = String(route.query.region || '')
const request = (path: string, data: Record<string, unknown> = {}) => common.sendAsync({ route: path, data, timeout: 120000 }) as Promise<any>

const objects = ref<OssObject[]>([])
const pageSize = 40
const sortMode = useStorage<'name' | 'size_desc' | 'size_asc' | 'modified_desc' | 'modified_asc'>('aliyun-oss-object-sort', 'name')
const totalObjects = ref(0)
const loading = ref(false)
const uploading = ref(false)
const downloadingName = ref('')
const prefix = ref('')
const page = ref(1)
const nextMarker = ref('')
const markers = ref<string[]>([''])
const selectedNames = ref<string[]>([])
const failedPreviewNames = ref(new Set<string>())
const viewMode = useStorage<'list' | 'grid'>('aliyun-oss-object-view-v2', 'grid')
const tableRef = ref<TableInstance>()
const selectedNameSet = computed(() => new Set(selectedNames.value))
const bucketEndpoint = computed(() => bucket && region ? `${bucket}.${region}.aliyuncs.com` : '--')
const isSorted = computed(() => sortMode.value !== 'name')
const tableDefaultSort = computed(() => {
	if (sortMode.value.startsWith('size')) return { prop: 'size', order: sortMode.value.endsWith('_asc') ? 'ascending' : 'descending' }
	if (sortMode.value.startsWith('modified')) return { prop: 'last_modified', order: sortMode.value.endsWith('_asc') ? 'ascending' : 'descending' }
	return { prop: '', order: null }
})
const isDirectory = (object: OssObject) => object.is_directory || object.name.endsWith('/')
const displayName = (object: OssObject) => object.name.split('/').filter(Boolean).pop() || pub.lang('根目录')
const prefixParts = computed(() => {
	const parts = prefix.value.split('/').filter(Boolean)
	return parts.map((name, index) => ({ name, path: `${parts.slice(0, index + 1).join('/')}/` }))
})

const loadObjects = async (reset = false) => {
	if (!accountId || !bucket || !region) return Message.error(pub.lang('OSS Bucket 参数不完整'))
	if (reset) { page.value = 1; markers.value = [''] }
	loading.value = true
	try {
		const result = await request(routes.aliyun.oss_object_list.path, { account_id: accountId, bucket, region, prefix: prefix.value, marker: isSorted.value ? '' : (markers.value[page.value - 1] || ''), page: page.value, page_size: pageSize, sort: sortMode.value })
		if (!result?.status) return Message.request(result)
		objects.value = result.data.data || []
		totalObjects.value = Number(result.data.total || 0)
		selectedNames.value = []
		nextMarker.value = result.data.next_marker || ''
		if (nextMarker.value) markers.value[page.value] = nextMarker.value
	} finally { loading.value = false }
}
const goRoot = () => { prefix.value = ''; loadObjects(true) }
const goPath = (path: string) => { prefix.value = path; loadObjects(true) }
const goParent = () => {
	const parts = prefix.value.split('/').filter(Boolean)
	parts.pop()
	prefix.value = parts.length ? `${parts.join('/')}/` : ''
	loadObjects(true)
}
const openDirectory = (object: OssObject) => { if (isDirectory(object)) { prefix.value = object.name; loadObjects(true) } }
const handleRowClick = (object: OssObject) => { if (isDirectory(object)) openDirectory(object) }
const handleObjectClick = (object: OssObject) => { isDirectory(object) ? openDirectory(object) : toggleObject(object) }
const handleTableSort = ({ prop, order }: { prop: string; order: 'ascending' | 'descending' | null }) => {
	if (!order) sortMode.value = 'name'
	else if (prop === 'size') sortMode.value = order === 'ascending' ? 'size_asc' : 'size_desc'
	else if (prop === 'last_modified') sortMode.value = order === 'ascending' ? 'modified_asc' : 'modified_desc'
	else sortMode.value = 'name'
	loadObjects(true)
}
const previousPage = () => { if (!isSorted.value && page.value > 1) { page.value -= 1; loadObjects() } }
const nextPage = () => { if (!isSorted.value && nextMarker.value) { page.value += 1; loadObjects() } }
const setTableSelection = (rows: OssObject[]) => { selectedNames.value = rows.map(item => item.name) }
const toggleObject = (object: OssObject) => {
	selectedNames.value = selectedNameSet.value.has(object.name)
		? selectedNames.value.filter(name => name !== object.name)
		: [...selectedNames.value, object.name]
}
const syncTableSelection = () => nextTick(() => {
	if (viewMode.value !== 'list' || !tableRef.value) return
	objects.value.forEach(object => tableRef.value?.toggleRowSelection(object, selectedNameSet.value.has(object.name)))
})
watch(viewMode, syncTableSelection)
const uploadObjects = async () => {
	uploading.value = true
	try {
		const result = await request(routes.aliyun.oss_object_upload.path, { account_id: accountId, bucket, region, prefix: prefix.value })
		if (!result?.status) return Message.request(result)
		if (!result.data?.canceled) { Message.success(pub.lang('上传成功')); await loadObjects(true) }
	} finally { uploading.value = false }
}
const downloadObject = async (object: OssObject) => {
	downloadingName.value = object.name
	try {
		const result = await request(routes.aliyun.oss_object_download.path, { account_id: accountId, bucket, region, object_name: object.name })
		if (!result?.status) return Message.request(result)
		if (!result.data?.canceled) Message.success(pub.lang('下载完成'))
	} finally { downloadingName.value = '' }
}
const removeSelected = async () => {
	if (!selectedNames.value.length) return
	try { await ElMessageBox.confirm(pub.lang(`确定删除选中的 ${selectedNames.value.length} 个 OSS 对象吗？`), pub.lang('删除 OSS 对象'), { type: 'warning' }) }
	catch { return }
	const result = await request(routes.aliyun.oss_object_delete.path, { account_id: accountId, bucket, region, object_names: selectedNames.value })
	if (!result?.status) return Message.request(result)
	result.data.failure_count ? Message.warn(pub.lang(`删除成功 ${result.data.success_count} 项，失败 ${result.data.failure_count} 项`)) : Message.success(pub.lang(`已删除 ${result.data.success_count} 项`))
	await loadObjects(true)
}
const imageExt = /\.(?:avif|bmp|gif|ico|jfif|jpe?g|pjp|pjpeg|png|svg|webp)$/i
const fileIcon = (object: OssObject): Component => {
	if (isDirectory(object)) return Folder
	if (imageExt.test(object.name)) return Picture
	if (/\.(?:mp4|mkv|mov|avi|webm|m4v)$/i.test(object.name)) return Film
	if (/\.(?:mp3|wav|flac|aac|m4a|ogg)$/i.test(object.name)) return Headset
	if (/\.(?:zip|rar|7z|tar|gz|bz2)$/i.test(object.name)) return Tickets
	return Document
}
const fileName = (name: string) => name.split('/').filter(Boolean).pop() || name
const parentPath = (name: string) => { const parts = name.split('/'); parts.pop(); return parts.join('/') || pub.lang('根目录') }
const formatBytes = (size: number) => { const value = Number(size || 0); if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(1)} GB` }
const formatDate = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? value || '--' : date.toLocaleString() }
const hasPreview = (object: OssObject) => !!object.preview_url && !failedPreviewNames.value.has(object.name)
const markPreviewFailed = (name: string) => { failedPreviewNames.value = new Set([...failedPreviewNames.value, name]) }
const goBack = () => router.push({ path: `/aliyun/${accountId}`, query: { tab: 'oss' } })

onMounted(() => loadObjects(true))
</script>

<style scoped lang="scss">
.oss-objects-page { display: flex; height: 100%; min-height: 0; padding: 2rem 3.6rem 2.6rem; color: var(--el-text-color-primary); flex-direction: column; }
.page-header, .page-identity, .header-actions, .object-toolbar, .view-switch, .page-pagination { display: flex; align-items: center; }
.page-header { flex: 0 0 auto; justify-content: space-between; gap: 2rem; padding-bottom: 1.4rem; border-bottom: 1px solid var(--el-border-color-lighter); }
.page-identity { min-width: 0; gap: 1.2rem; h1 { overflow: hidden; margin: 0; font-size: 1.8rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; } p { display: flex; min-width: 0; gap: .8rem; margin: .35rem 0 0; color: var(--el-text-color-secondary); font-size: 1.08rem; } code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.header-actions { flex: 0 0 auto; gap: .7rem; }
.view-switch { position: relative; padding: .3rem; border: 1px solid var(--el-border-color-light); border-radius: .7rem; background: var(--el-fill-color-lighter); button { display: grid; width: 3rem; height: 2.8rem; padding: .6rem; border: 0; border-radius: .5rem; color: var(--el-text-color-secondary); background: transparent; cursor: pointer; place-items: center; transition: .18s; } button.active { color: var(--el-color-primary); background: var(--el-bg-color); box-shadow: 0 1px 3px rgba(0, 0, 0, .08); } svg { width: 100%; height: 100%; } }
.object-toolbar { flex: 0 0 auto; gap: .8rem; padding: 1.4rem 0 1rem; flex-wrap: wrap; .el-input { width: min(42rem, 45vw); } }
.object-breadcrumb { display: flex; width: 100%; min-width: 0; align-items: center; gap: .35rem; overflow: auto; color: var(--el-text-color-secondary); font-size: 1.05rem; white-space: nowrap; button { padding: 0; border: 0; color: var(--el-color-primary); background: transparent; cursor: pointer; } .breadcrumb-root { font-weight: 600; } }
.selection-summary { margin-left: auto; color: var(--el-text-color-secondary); font-size: 1.1rem; white-space: nowrap; }
.object-content { min-height: 0; flex: 1; }
.file-name-cell { display: flex; min-width: 0; align-items: center; gap: .8rem; img, svg { width: 3.2rem; height: 3.2rem; flex: 0 0 auto; border-radius: .35rem; object-fit: cover; } svg { padding: .45rem; color: var(--el-text-color-secondary); background: var(--el-fill-color-light); } span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } &.is-directory { color: var(--el-color-primary); cursor: pointer; } }
.object-grid { display: grid; height: 100%; overflow-y: auto; align-content: start; padding: .2rem .2rem 1rem; grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr)); gap: 1rem; }
.object-tile { min-width: 0; overflow: hidden; border: 1px solid var(--el-border-color-lighter); border-radius: .7rem; background: var(--el-bg-color); cursor: pointer; transition: border-color .18s, box-shadow .18s, transform .18s; &:hover { border-color: var(--el-border-color); box-shadow: 0 5px 14px rgba(0, 0, 0, .07); transform: translateY(-1px); } &.selected { border-color: var(--el-color-primary); box-shadow: inset 0 0 0 1px var(--el-color-primary-light-7); } }
.tile-preview { display: grid; height: 12.5rem; position: relative; overflow: hidden; color: var(--el-text-color-placeholder); background: var(--el-fill-color-light); place-items: center; img { width: 100%; height: 100%; object-fit: cover; } > svg { width: 4.8rem; height: 4.8rem; } .el-checkbox { position: absolute; top: .8rem; right: .8rem; padding: .25rem .45rem; border-radius: .4rem; background: rgba(255, 255, 255, .88); } }
.tile-info { min-width: 0; padding: .9rem 1rem; strong, span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { font-size: 1.15rem; font-weight: 600; } > span { margin-top: .3rem; color: var(--el-text-color-secondary); font-size: 1rem; } footer { display: flex; min-height: 2.4rem; align-items: center; justify-content: space-between; margin-top: .6rem; color: var(--el-text-color-secondary); } em { font-size: 1.02rem; font-style: normal; } }
.page-pagination { flex: 0 0 auto; justify-content: flex-end; gap: .8rem; padding-top: 1.2rem; color: var(--el-text-color-secondary); font-size: 1.1rem; }
@media (max-width: 760px) { .oss-objects-page { padding: 1.4rem; } .page-header { align-items: flex-start; flex-direction: column; } .header-actions { align-self: flex-end; } .object-toolbar { flex-wrap: wrap; .el-input { width: 100%; } } .selection-summary { margin-left: 0; } .object-grid { grid-template-columns: repeat(auto-fill, minmax(13.5rem, 1fr)); } }
</style>
