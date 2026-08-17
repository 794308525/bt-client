<template>
	<div class="aliyun-detail" v-loading="accountLoading">
		<div class="detail-header">
			<div class="detail-header__identity">
				<el-button circle :icon="ArrowLeft" @click="router.push('/aliyun')" />
				<div class="detail-logo"><bt-icon name="aliyun" size="24" /></div>
				<div class="detail-header__name">
					<h1>{{ account?.remark || pub.lang('阿里云账号') }}</h1>
					<p>{{ maskAccessKey(account?.access_key_id || '') }}</p>
				</div>
			</div>
			<div class="detail-header__aside">
				<div class="balance-summary">
					<div class="summary-item__amount">
						<strong>{{ formatBalance(account?.balance, account?.balance_currency) }}</strong>
						<span v-if="resourceStatusText('balance')" class="summary-item__status">{{ resourceStatusText('balance') }}</span>
						<el-tooltip :content="pub.lang('刷新余额')" placement="top">
							<el-button text circle :icon="Refresh" :loading="balanceRefreshing" @click="refreshBalance" />
						</el-tooltip>
					</div>
					<small v-if="account?.balance_refresh_time" class="summary-item__updated">
						{{ formatTime(account.balance_refresh_time) }}
					</small>
				</div>
			</div>
		</div>

		<el-alert
			v-if="account?.resource_error"
			type="warning"
			:closable="false"
			class="detail-alert">
			<template #title>
				<span class="resource-error-title">
					<span>{{ account.resource_error }}</span>
					<el-tooltip :content="pub.lang('查看具体错误')" placement="top">
						<button type="button" class="resource-error-detail-trigger" :disabled="errorDetailLoading" @click.stop="showResourceErrorDetail">
							<el-icon><QuestionFilled /></el-icon>
						</button>
					</el-tooltip>
				</span>
			</template>
		</el-alert>

		<div class="resource-navigation">
			<div ref="resourceTabsRef" class="resource-navigation__items">
				<span class="resource-navigation__indicator" :style="resourceIndicatorStyle" />
				<button
					v-for="item in resourceTabItems"
					:key="item.name"
					type="button"
					class="resource-navigation__item"
					:class="{ active: activeTab === item.name }"
					@click="switchResourceTab(item.name)">
					<span>{{ item.label }}</span>
					<em v-if="item.status">{{ item.status }}</em>
					<strong v-else>{{ item.count }}</strong>
				</button>
			</div>
			<div class="resource-navigation__meta">
				<span v-if="account?.resource_refresh_time">{{ formatTime(account.resource_refresh_time) }}</span>
				<el-tooltip :content="pub.lang('刷新概览')" placement="top">
					<el-button circle :icon="Refresh" :loading="summaryRefreshing" @click="refreshSummary" />
				</el-tooltip>
			</div>
		</div>

		<el-tabs v-model="activeTab" class="resource-tabs" @tab-change="handleTabChange">
			<el-tab-pane name="servers" class="server-pane">
				<div class="resource-toolbar">
					<div class="resource-toolbar__filters">
						<el-input v-model="serverQuery.keyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索名称、实例 ID 或 IP')" />
						<el-select v-model="serverQuery.source" :placeholder="pub.lang('服务器类型')">
							<el-option :label="pub.lang('全部类型')" value="all" />
							<el-option label="ECS" value="ecs" />
							<el-option :label="pub.lang('轻量应用服务器')" value="swas" />
						</el-select>
						<el-select v-model="serverQuery.region" :placeholder="pub.lang('地域')">
							<el-option :label="pub.lang('全部地域')" value="all" />
							<el-option v-for="region in serverRegions" :key="region" :label="region" :value="region" />
						</el-select>
						<el-select v-model="serverQuery.status" :placeholder="pub.lang('状态')">
							<el-option :label="pub.lang('全部状态')" value="all" />
							<el-option v-for="status in serverStatuses" :key="status" :label="status" :value="status" />
						</el-select>
					</div>
					<div class="resource-toolbar__actions">
						<el-tooltip :content="showServerIp ? pub.lang('隐藏IP') : pub.lang('显示IP')" placement="top">
							<el-button :icon="showServerIp ? Hide : View" @click="showServerIp = !showServerIp" />
						</el-tooltip>
						<el-tooltip :content="pub.lang('刷新服务器')" placement="top">
							<el-button :icon="Refresh" :loading="serverLoading" @click="loadServers(true)" />
						</el-tooltip>
					</div>
				</div>

				<el-alert
					v-if="serverPartial"
					:title="pub.lang('部分地域获取失败，已展示其余可用数据')"
					type="warning"
					show-icon
					:closable="false"
					class="resource-alert" />
				<div class="server-table-wrap">
				<el-table :data="pagedServers" v-loading="serverLoading" row-key="instance_id" height="100%">
					<el-table-column :label="pub.lang('实例')" min-width="220">
						<template #default="{ row }">
							<div class="instance-name">{{ row.name }}</div>
							<div class="muted mono">{{ row.instance_id }}</div>
						</template>
					</el-table-column>
					<el-table-column :label="pub.lang('类型')" width="130">
						<template #default="{ row }"><el-tag>{{ row.source === 'ecs' ? 'ECS' : pub.lang('轻量') }}</el-tag></template>
					</el-table-column>
					<el-table-column prop="region_id" :label="pub.lang('地域')" width="150" />
					<el-table-column :label="pub.lang('IP 地址')" min-width="190">
						<template #default="{ row }">
							<template v-if="showServerIp">
								<div v-for="ip in row.public_ips" :key="`public-${ip}`" class="server-ip">
									<span>{{ ip }}</span>
									<el-tooltip :content="pub.lang('复制IP')" placement="top">
										<el-button link :icon="CopyDocument" class="server-ip__copy" @click.stop="copyServerIp(ip)" />
									</el-tooltip>
								</div>
								<div v-for="ip in row.private_ips" :key="`private-${ip}`" class="server-ip muted">
									<span>{{ ip }}</span>
									<el-tooltip :content="pub.lang('复制IP')" placement="top">
										<el-button link :icon="CopyDocument" class="server-ip__copy" @click.stop="copyServerIp(ip)" />
									</el-tooltip>
								</div>
								<span v-if="!row.public_ips.length && !row.private_ips.length">--</span>
							</template>
							<span v-else class="muted">{{ pub.lang('IP已隐藏') }}</span>
						</template>
					</el-table-column>
					<el-table-column :label="pub.lang('配置')" min-width="190">
						<template #default="{ row }">
							<el-tooltip
								v-if="row.instance_type"
								:content="`${pub.lang('实例规格')}：${row.instance_type}`"
								placement="top">
								<div class="server-spec">{{ formatComputeSpec(row) }}</div>
							</el-tooltip>
							<div v-else class="server-spec">{{ formatComputeSpec(row) }}</div>
							<div class="server-spec__secondary">{{ formatStorageSpec(row) }}</div>
						</template>
					</el-table-column>
					<el-table-column :label="pub.lang('系统')" min-width="160">
						<template #default="{ row }">{{ row.os_name || row.os_type || '--' }}</template>
					</el-table-column>
					<el-table-column prop="status" :label="pub.lang('状态')" width="110">
						<template #default="{ row }"><el-tag class="server-status" :type="serverStatusType(row.status)">{{ serverStatusName(row.status) }}</el-tag></template>
					</el-table-column>
					<el-table-column :label="pub.lang('到期时间')" width="140">
						<template #default="{ row }">{{ row.expired_time ? formatExpireDate(row.expired_time) : '--' }}</template>
					</el-table-column>
					<el-table-column :label="pub.lang('操作')" width="110" fixed="right">
						<template #default="{ row }">
							<el-button link type="primary" :icon="Monitor" :loading="openingServerId === row.instance_id" @click="openServer(row)">{{ pub.lang('终端') }}</el-button>
						</template>
					</el-table-column>
				</el-table>
				</div>
				<div class="pagination"><el-pagination v-model:current-page="serverPage" :page-size="20" layout="total, prev, pager, next" :total="filteredServers.length" /></div>
			</el-tab-pane>

			<el-tab-pane name="domains">
				<div class="dns-layout">
					<div class="domain-panel">
						<div class="domain-search">
							<el-input v-model="domainKeyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索域名')" @keydown.enter="loadDomains(1)" />
							<el-button :icon="Search" @click="loadDomains(1)" />
						</div>
						<div v-loading="domainLoading" class="domain-list">
							<div
								v-for="domain in domains"
								:key="domain.domain_id"
								class="domain-item"
								:class="{ active: selectedDomain?.domain_name === domain.domain_name }"
								@click="selectDomain(domain)">
								<strong>{{ domain.domain_name }}</strong>
								<span class="domain-item__meta">
									<em>{{ domain.record_count }} {{ pub.lang('条记录') }}</em>
									<em :class="{ expired: domainExpirationIsUrgent(domain) }">{{ domainExpireText(domain) }}</em>
								</span>
							</div>
							<el-empty v-if="!domainLoading && !domains.length" :image-size="60" :description="pub.lang('暂无域名')" />
						</div>
						<el-pagination size="small" v-model:current-page="domainPage" :page-size="30" layout="prev, pager, next" :total="domainTotal" @current-change="loadDomains" />
					</div>

					<div class="record-panel">
						<div class="record-toolbar">
							<div class="record-heading">
								<div class="record-heading__title">
									<h3>{{ selectedDomain?.domain_name || pub.lang('请选择域名') }}</h3>
									<el-tag v-if="selectedDomainInfo" size="small" :type="domainProviderTagType">{{ domainProviderName }}</el-tag>
								</div>
								<div v-if="selectedDomain" v-loading="domainInfoLoading" class="domain-dns">
									<span>DNS</span>
									<template v-if="selectedDomainInfo?.dns_servers.length">
										<code v-for="server in selectedDomainInfo.dns_servers" :key="server">{{ server }}</code>
									</template>
									<em v-else>--</em>
								</div>
							</div>
							<div class="record-toolbar__actions">
								<el-input v-model="recordKeyword" clearable :prefix-icon="Search" :placeholder="pub.lang(recordType === 'all' ? '搜索解析记录' : '搜索主机记录')" @keydown.enter="loadRecords(1)" />
								<el-select v-model="recordType" :placeholder="pub.lang('记录类型')" @change="loadRecords(1)">
									<el-option :label="pub.lang('全部类型')" value="all" />
									<el-option v-for="type in recordTypes" :key="type" :label="type" :value="type" />
								</el-select>
								<el-button :disabled="!selectedRecords.length || recordBatchLoading" @click="batchRecordAction('disable')">{{ pub.lang('批量暂停') }}</el-button>
								<el-button type="danger" plain :disabled="!selectedRecords.length || recordBatchLoading" @click="batchRecordAction('delete')">{{ pub.lang('批量删除') }}</el-button>
								<el-button :icon="Refresh" :disabled="!selectedDomain || !domainRecordsWritable" @click="loadRecords(recordPage)" />
								<el-button :icon="Clock" :disabled="!selectedDomain || !domainRecordsWritable" @click="openRecordLogs">{{ pub.lang('操作记录') }}</el-button>
								<el-button v-if="domainCanOpenEsa" @click="openSelectedDomainInEsa">{{ pub.lang('查看 ESA 站点') }}</el-button>
								<el-button type="primary" :icon="Plus" :disabled="!selectedDomain || !domainRecordsWritable" @click="openRecordDialog()">{{ pub.lang('新增解析') }}</el-button>
							</div>
						</div>
						<el-alert
							v-if="selectedDomainInfo && !domainRecordsWritable"
							:type="selectedDomainInfo.dns_provider === 'esa' ? 'warning' : 'info'"
							:closable="false"
							class="dns-provider-alert"
							:title="domainProviderTip" />
						<div class="record-table-wrap">
							<el-table :data="records" v-loading="recordLoading || recordBatchLoading" row-key="record_id" height="100%" @selection-change="selectedRecords = $event">
								<el-table-column type="selection" width="46" :selectable="isRecordSelectable" />
								<el-table-column prop="rr" label="RR" width="110" />
								<el-table-column prop="type" :label="pub.lang('类型')" width="90" />
								<el-table-column prop="value" :label="pub.lang('记录值')" min-width="180" show-overflow-tooltip />
								<el-table-column prop="ttl" label="TTL" width="90" />
								<el-table-column :label="pub.lang('线路')" width="130"><template #default="{ row }">{{ lineName(row.line) }}</template></el-table-column>
								<el-table-column :label="pub.lang('状态')" width="80">
									<template #default="{ row }">
										<el-tooltip :content="row.status === 'Enable' ? pub.lang('点击暂停') : pub.lang('点击启用')" placement="top">
											<el-switch
												v-model="row.status"
												active-value="Enable"
												inactive-value="Disable"
												:loading="recordStatusLoadingId === row.record_id"
												:disabled="row.locked || !domainRecordsWritable"
												:before-change="() => changeRecordStatus(row)" />
										</el-tooltip>
									</template>
								</el-table-column>
								<el-table-column :label="pub.lang('操作')" width="120" fixed="right">
									<template #default="{ row }">
										<el-button link type="primary" :disabled="row.locked || !domainRecordsWritable" @click="openRecordDialog(row)">{{ pub.lang('编辑') }}</el-button>
										<el-button link type="danger" :disabled="row.locked || !domainRecordsWritable" @click="removeRecord(row)">{{ pub.lang('删除') }}</el-button>
									</template>
								</el-table-column>
							</el-table>
						</div>
						<div class="pagination"><el-pagination v-model:current-page="recordPage" v-model:page-size="recordPageSize" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" :total="recordTotal" @current-change="loadRecords" @size-change="changeRecordPageSize" /></div>
					</div>
				</div>
			</el-tab-pane>

			<el-tab-pane name="esa">
				<div class="esa-layout">
					<aside class="esa-site-panel" v-loading="esaLoading">
						<div class="esa-site-search">
							<el-input v-model="esaQuery.keyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索 ESA 站点')" @keydown.enter="loadEsaSites(1)" />
							<el-button :icon="Refresh" :loading="esaLoading" @click="loadEsaSites(esaPage)" />
						</div>
						<el-select v-model="esaQuery.status" class="esa-status-filter" @change="loadEsaSites(1)">
							<el-option :label="pub.lang('全部状态')" value="all" />
							<el-option v-for="status in esaStatuses" :key="status" :label="cloudStatusName(status)" :value="status" />
						</el-select>
						<div class="esa-site-list">
							<button
								v-for="site in esaSites"
								:key="site.site_id"
								type="button"
								class="esa-site-item"
								:class="{ active: selectedEsaSite?.site_id === site.site_id }"
								@click="selectEsaSite(site)">
								<span class="esa-site-item__heading">
									<strong>{{ site.site_name }}</strong>
									<el-tag size="small" effect="plain" :type="cloudStatusType(site.status)">{{ cloudStatusName(site.status) }}</el-tag>
								</span>
								<span class="esa-site-item__meta">
									<em>{{ accessTypeName(site.access_type) }}</em>
									<em>{{ coverageName(site.coverage) }}</em>
								</span>
							</button>
							<el-empty v-if="!esaLoading && !esaSites.length" :image-size="64" :description="pub.lang('暂无 ESA 站点')" />
						</div>
						<div class="esa-site-pagination">
							<el-pagination v-model:current-page="esaPage" size="small" :page-size="50" layout="total, prev, next" :total="esaTotal" @current-change="loadEsaSites" />
						</div>
					</aside>

					<section class="esa-detail-panel">
						<template v-if="selectedEsaSite">
							<header class="esa-overview" v-loading="esaDetailLoading">
								<div class="esa-overview__identity">
									<div class="esa-overview__title">
										<h3>{{ esaDetail?.site_name || selectedEsaSite.site_name }}</h3>
										<el-tag size="small" :type="cloudStatusType(esaDetail?.status || selectedEsaSite.status)">{{ cloudStatusName(esaDetail?.status || selectedEsaSite.status) }}</el-tag>
									</div>
									<p>{{ esaPrimaryEndpoint }}</p>
								</div>
								<div class="esa-overview__facts">
									<div><span>{{ pub.lang('接入方式') }}</span><strong>{{ accessTypeName(esaDetail?.access_type || selectedEsaSite.access_type) }}</strong></div>
									<div><span>{{ pub.lang('覆盖区域') }}</span><strong>{{ coverageName(esaDetail?.coverage || selectedEsaSite.coverage) }}</strong></div>
									<div><span>{{ pub.lang('套餐') }}</span><strong>{{ esaPlanName }}</strong></div>
								</div>
							</header>

							<el-tabs v-model="esaDetailTab" class="esa-detail-tabs" @tab-change="handleEsaDetailTabChange">
								<el-tab-pane :label="pub.lang('流量分析')" name="analytics">
									<TrafficAnalytics v-if="selectedEsaSite" :account-id="accountId" product="esa" :site-id="selectedEsaSite.site_id" />
								</el-tab-pane>
								<el-tab-pane :label="pub.lang('解析记录')" name="records">
									<div class="esa-content-toolbar">
										<div class="esa-record-filters">
											<el-input v-model="esaRecordKeyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索主机记录或记录值')" @keydown.enter="loadEsaRecords(1)" />
											<el-select v-model="esaRecordType" @change="loadEsaRecords(1)">
												<el-option :label="pub.lang('全部类型')" value="all" />
												<el-option v-for="type in esaRecordTypes" :key="type" :label="type" :value="type" />
											</el-select>
										</div>
									<div class="esa-record-actions">
										<el-button :disabled="!selectedEsaRecords.length || esaRecordBatchLoading" @click="batchEsaRecordAction('disable_proxy')">{{ pub.lang('批量关闭代理') }}</el-button>
										<el-button type="danger" plain :disabled="!selectedEsaRecords.length || esaRecordBatchLoading" @click="batchEsaRecordAction('delete')">{{ pub.lang('批量删除') }}</el-button>
										<el-button :icon="Refresh" :loading="esaRecordLoading" @click="loadEsaRecords(esaRecordPage)" />
										<el-button type="primary" :icon="Plus" @click="openEsaRecordDialog()">{{ pub.lang('新增解析') }}</el-button>
									</div>
									</div>
									<div class="record-table-wrap">
									<el-table :data="esaRecords" v-loading="esaRecordLoading || esaRecordBatchLoading" row-key="record_id" height="100%" @selection-change="selectedEsaRecords = $event">
										<el-table-column type="selection" width="46" />
										<el-table-column prop="record_name" :label="pub.lang('主机记录')" min-width="180" show-overflow-tooltip />
										<el-table-column prop="type" :label="pub.lang('类型')" width="90" />
										<el-table-column prop="value" :label="pub.lang('记录值')" min-width="210" show-overflow-tooltip />
										<el-table-column :label="pub.lang('代理')" width="80">
											<template #default="{ row }">
												<el-tooltip :content="esaRecordCanProxy(row) ? (row.proxied ? pub.lang('点击关闭代理') : pub.lang('点击开启代理')) : pub.lang('该记录类型不支持代理')" placement="top">
													<el-switch v-model="row.proxied" active-color="#ff6a00" :loading="esaProxyLoadingId === row.record_id" :disabled="!esaRecordCanProxy(row)" :before-change="() => changeEsaRecordProxy(row)" />
												</el-tooltip>
											</template>
										</el-table-column>
										<el-table-column prop="ttl" label="TTL" width="90"><template #default="{ row }">{{ row.ttl || '--' }}</template></el-table-column>
										<el-table-column prop="comment" :label="pub.lang('备注')" min-width="140" show-overflow-tooltip />
										<el-table-column :label="pub.lang('操作')" width="120" fixed="right">
											<template #default="{ row }">
												<el-button link type="primary" :disabled="!esaRecordEditable(row)" @click="openEsaRecordDialog(row)">{{ pub.lang('编辑') }}</el-button>
												<el-button link type="danger" @click="removeEsaRecord(row)">{{ pub.lang('删除') }}</el-button>
											</template>
										</el-table-column>
									</el-table>
									</div>
									<div class="pagination"><el-pagination v-model:current-page="esaRecordPage" v-model:page-size="esaRecordPageSize" :page-sizes="[20, 50, 100]" layout="total, sizes, prev, pager, next" :total="esaRecordTotal" @current-change="loadEsaRecords" @size-change="changeEsaRecordPageSize" /></div>
								</el-tab-pane>

								<el-tab-pane :label="pub.lang('源站信息')" name="origins">
									<div class="esa-section-heading">
										<div><h4>{{ pub.lang('源站池') }}</h4><p>{{ pub.lang('查看当前站点实际回源目标与负载权重') }}</p></div>
										<el-button :icon="Refresh" :loading="esaOriginLoading" @click="loadEsaOrigins" />
									</div>
									<el-alert v-if="esaOrigins.partial" type="warning" :closable="false" class="esa-partial-alert" :title="pub.lang('部分源站信息获取失败，已展示可用数据')" />
									<el-table :data="esaOriginRows" v-loading="esaOriginLoading" row-key="row_key" max-height="260">
										<el-table-column prop="pool_name" :label="pub.lang('源站池')" min-width="140" show-overflow-tooltip />
										<el-table-column prop="address" :label="pub.lang('源站地址')" min-width="190" show-overflow-tooltip />
										<el-table-column prop="type" :label="pub.lang('类型')" width="100" />
										<el-table-column prop="weight" :label="pub.lang('权重')" width="80" />
										<el-table-column prop="host_header" label="Host Header" min-width="160" show-overflow-tooltip />
										<el-table-column :label="pub.lang('状态')" width="90"><template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? pub.lang('启用') : pub.lang('停用') }}</el-tag></template></el-table-column>
									</el-table>
									<div class="esa-section-heading esa-section-heading--sub"><div><h4>{{ pub.lang('回源规则') }}</h4><p>{{ pub.lang('协议、端口、回源 Host 与证书校验设置') }}</p></div></div>
									<el-table :data="esaOrigins.rules" v-loading="esaOriginLoading" row-key="config_id" max-height="250">
										<el-table-column prop="rule_name" :label="pub.lang('规则')" min-width="140"><template #default="{ row }">{{ row.rule_name || pub.lang('默认规则') }}</template></el-table-column>
										<el-table-column prop="origin_scheme" :label="pub.lang('回源协议')" width="100" />
										<el-table-column :label="pub.lang('端口')" width="130"><template #default="{ row }">{{ originPorts(row) }}</template></el-table-column>
										<el-table-column prop="origin_host" label="Host" min-width="150" show-overflow-tooltip />
										<el-table-column prop="origin_sni" label="SNI" min-width="140" show-overflow-tooltip />
										<el-table-column :label="pub.lang('证书校验')" width="100"><template #default="{ row }">{{ booleanSettingName(row.origin_verify) }}</template></el-table-column>
									</el-table>
								</el-tab-pane>

								<el-tab-pane :label="pub.lang('HTTPS 证书')" name="certificates">
									<div class="esa-content-toolbar">
										<div class="esa-https-summary">
											<el-tag :type="esaHttpsEnabled ? 'success' : 'info'">HTTPS {{ esaHttpsEnabled ? pub.lang('已开启') : pub.lang('未开启') }}</el-tag>
											<span>{{ esaTlsSummary }}</span>
										</div>
										<div class="esa-record-actions">
											<el-badge :value="esaDeployAttentionCount" :hidden="!esaDeployAttentionCount" :type="esaDeployFailedCount ? 'danger' : 'warning'">
												<el-button :icon="Clock" @click="esaDeployDrawerVisible = true">{{ pub.lang('部署任务') }}</el-button>
											</el-badge>
											<el-button type="primary" :icon="Plus" @click="openEsaCertificateApplyDialog">{{ pub.lang('申请证书') }}</el-button>
											<el-button :icon="Refresh" :loading="esaCertificateLoading" @click="refreshEsaCertificates" />
										</div>
									</div>
									<div class="esa-certificate-stats">
										<span><strong>{{ esaCertificateSummary.configured }}</strong>{{ pub.lang('条解析已覆盖') }}</span>
										<span v-if="esaCertificateSummary.applying"><strong>{{ esaCertificateSummary.applying }}</strong>{{ pub.lang('条申请中') }}</span>
										<span v-if="esaCertificateSummary.failed" class="danger"><strong>{{ esaCertificateSummary.failed }}</strong>{{ pub.lang('条申请失败') }}</span>
										<span v-if="esaCertificateSummary.none"><strong>{{ esaCertificateSummary.none }}</strong>{{ pub.lang('条未配置') }}</span>
									</div>
									<el-alert v-if="esaCertificatePartial" type="warning" :closable="false" class="esa-partial-alert" :title="pub.lang('部分域名证书或 HTTPS 配置获取失败，已展示可用数据')" />
									<el-table :data="esaCertificateGroups" v-loading="esaCertificateLoading" row-key="certificate_id" height="calc(100vh - 520px)">
										<el-table-column :label="pub.lang('证书')" min-width="210"><template #default="{ row }"><div class="instance-name">{{ row.name || row.common_name || '--' }}</div><div class="muted">{{ row.deploy_task ? pub.lang('自动申请任务') : (row.common_name || row.sans || '--') }}</div></template></el-table-column>
										<el-table-column :label="pub.lang('覆盖解析')" min-width="180"><template #default="{ row }"><el-tooltip :content="row.record_names.join('、')" placement="top"><span class="certificate-coverage">{{ certificateCoverageText(row) }}</span></el-tooltip></template></el-table-column>
										<el-table-column :label="pub.lang('证书状态')" width="110"><template #default="{ row }"><el-tag size="small" :type="certificateStatusType(row)">{{ certificateStatusName(row) }}</el-tag></template></el-table-column>
										<el-table-column :label="pub.lang('签发机构')" min-width="150" show-overflow-tooltip><template #default="{ row }">{{ row.deploy_task ? (row.deploy_task.provider || '--') : (row.issuer || '--') }}</template></el-table-column>
										<el-table-column :label="pub.lang('有效期至')" width="180"><template #default="{ row }"><template v-if="row.deploy_task"><div>{{ safeFormatDate(row.deploy_task.update_time * 1000) }}</div><el-tooltip v-if="row.deploy_task.last_error" :content="row.deploy_task.last_error" placement="top"><div class="esa-deploy-task__error">{{ row.deploy_task.last_error }}</div></el-tooltip><div v-else class="muted">{{ pub.lang('最近更新') }}</div></template><template v-else><div>{{ safeFormatDate(row.not_after) }}</div><div class="muted">{{ certificateRemainingText(row) }}</div></template></template></el-table-column>
									</el-table>
								</el-tab-pane>

								<el-tab-pane :label="pub.lang('站点信息')" name="site">
									<div class="esa-site-info" v-loading="esaDetailLoading">
										<dl><dt>{{ pub.lang('站点 ID') }}</dt><dd class="mono">{{ esaDetail?.site_id || selectedEsaSite.site_id }}</dd></dl>
										<dl><dt>{{ pub.lang('接入方式') }}</dt><dd>{{ accessTypeName(esaDetail?.access_type || selectedEsaSite.access_type) }}</dd></dl>
										<dl><dt>{{ pub.lang('覆盖区域') }}</dt><dd>{{ coverageName(esaDetail?.coverage || selectedEsaSite.coverage) }}</dd></dl>
										<dl><dt>{{ pub.lang('套餐') }}</dt><dd>{{ esaPlanName }}</dd></dl>
										<dl class="esa-site-info__wide"><dt>NameServer</dt><dd class="mono">{{ esaNameServers || '--' }}</dd></dl>
										<dl class="esa-site-info__wide"><dt>CNAME</dt><dd class="mono">{{ esaDetail?.cname_zone || selectedEsaSite.cname_zone || '--' }}</dd></dl>
										<dl><dt>{{ pub.lang('实例 ID') }}</dt><dd class="mono">{{ esaDetail?.instance_id || '--' }}</dd></dl>
										<dl><dt>{{ pub.lang('资源组') }}</dt><dd class="mono">{{ esaDetail?.resource_group_id || '--' }}</dd></dl>
										<dl><dt>{{ pub.lang('版本管理') }}</dt><dd>{{ esaDetail?.version_management ? pub.lang('已开启') : pub.lang('未开启') }}</dd></dl>
										<dl><dt>{{ pub.lang('创建时间') }}</dt><dd>{{ safeFormatDate(esaDetail?.create_time || selectedEsaSite.create_time) }}</dd></dl>
										<dl><dt>{{ pub.lang('更新时间') }}</dt><dd>{{ safeFormatDate(esaDetail?.update_time || selectedEsaSite.update_time) }}</dd></dl>
										<dl v-if="esaDetail?.offline_reason" class="esa-site-info__wide"><dt>{{ pub.lang('离线原因') }}</dt><dd>{{ esaDetail.offline_reason }}</dd></dl>
									</div>
								</el-tab-pane>
							</el-tabs>
						</template>
						<el-empty v-else :description="pub.lang('请从左侧选择 ESA 站点')" />
					</section>
				</div>
			</el-tab-pane>

			<el-tab-pane name="cdn" class="cdn-pane">
				<el-alert v-if="resourceStatusText('cdn')" :type="resourceStatusAlertType(currentResourceStatus('cdn'))" :closable="false" class="resource-alert" :title="pub.lang('CDN 服务状态：{}', resourceStatusText('cdn'))" />
				<div class="cdn-view-switch">
					<el-radio-group v-model="cdnViewMode" size="small">
						<el-radio-button label="analytics">{{ pub.lang('流量分析') }}</el-radio-button>
						<el-radio-button label="domains">{{ pub.lang('域名管理') }}</el-radio-button>
					</el-radio-group>
				</div>
				<TrafficAnalytics v-if="cdnViewMode === 'analytics'" class="cdn-analytics" :account-id="accountId" product="cdn" :domains="cdnDomainOptions" />
				<template v-else>
				<div class="resource-toolbar">
					<div class="resource-toolbar__filters">
						<el-input v-model="cdnQuery.keyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索 CDN 域名')" @keydown.enter="loadCdnDomains(1)" />
						<el-select v-model="cdnQuery.status" :placeholder="pub.lang('状态')">
							<el-option :label="pub.lang('全部状态')" value="all" />
							<el-option v-for="status in cdnStatuses" :key="status" :label="cloudStatusName(status)" :value="status" />
						</el-select>
						<el-button :icon="Search" @click="loadCdnDomains(1)">{{ pub.lang('查询') }}</el-button>
					</div>
					<div class="resource-toolbar__actions">
						<el-button :disabled="!selectedCdnDomains.length || cdnBatchLoading" @click="batchCdnDomainAction('start')">{{ pub.lang('批量启用') }}</el-button>
						<el-button :disabled="!selectedCdnDomains.length || cdnBatchLoading" @click="batchCdnDomainAction('stop')">{{ pub.lang('批量停用') }}</el-button>
						<el-tooltip :content="cdnBatchDeleteDisabledTip" placement="top" :disabled="!cdnBatchDeleteDisabledTip">
							<span><el-button type="danger" plain :disabled="!selectedCdnDomains.length || cdnBatchLoading || cdnBatchDeleteBlocked" @click="batchCdnDomainAction('delete')">{{ pub.lang('批量删除') }}</el-button></span>
						</el-tooltip>
						<el-button :icon="Refresh" :loading="cdnLoading" @click="loadCdnDomains(cdnPage)" />
						<el-button :icon="Clock" @click="openCdnOperationLogs">{{ pub.lang('操作记录') }}</el-button>
					</div>
				</div>
				<div class="cdn-table-wrap">
				<el-table :data="cdnDomains" v-loading="cdnLoading || cdnBatchLoading" row-key="domain_id" height="100%" @selection-change="selectedCdnDomains = $event">
					<el-table-column type="selection" width="46" />
					<el-table-column :label="pub.lang('加速域名')" min-width="220"><template #default="{ row }"><div class="instance-name">{{ row.domain_name }}</div><div v-if="row.description" class="muted">{{ row.description }}</div></template></el-table-column>
					<el-table-column prop="cname" label="CNAME" min-width="220" show-overflow-tooltip />
					<el-table-column :label="pub.lang('业务类型')" width="120"><template #default="{ row }">{{ cdnTypeName(row.cdn_type) }}</template></el-table-column>
					<el-table-column :label="pub.lang('覆盖区域')" width="130"><template #default="{ row }">{{ coverageName(row.coverage) }}</template></el-table-column>
					<el-table-column :label="pub.lang('接入状态')" width="120"><template #default="{ row }"><el-tooltip :content="row.access_error" :disabled="!row.access_error" placement="top"><el-tag :type="cdnAccessStatusType(row.access_status)">{{ cdnAccessStatusName(row.access_status) }}</el-tag></el-tooltip></template></el-table-column>
					<el-table-column label="HTTPS" width="90"><template #default="{ row }"><el-tag :type="row.ssl_enabled ? 'success' : 'info'">{{ row.ssl_enabled ? pub.lang('已开启') : pub.lang('未开启') }}</el-tag></template></el-table-column>
					<el-table-column :label="pub.lang('状态')" width="120"><template #default="{ row }"><el-tag :type="cloudStatusType(row.status)">{{ cloudStatusName(row.status) }}</el-tag></template></el-table-column>
					<el-table-column :label="pub.lang('更新时间')" width="180"><template #default="{ row }">{{ formatDate(row.update_time || row.create_time) }}</template></el-table-column>
					<el-table-column :label="pub.lang('操作')" width="130" fixed="right">
						<template #default="{ row }">
							<el-button link type="primary" @click="openCdnDomainDialog(row)">{{ pub.lang('修改源站') }}</el-button>
							<el-tooltip :content="pub.lang('请先停用后再删除')" placement="top" :disabled="row.status === 'offline'">
								<span><el-button link type="danger" :disabled="row.status !== 'offline'" @click="removeCdnDomain(row)">{{ pub.lang('删除') }}</el-button></span>
							</el-tooltip>
						</template>
					</el-table-column>
				</el-table>
				</div>
				<div class="pagination"><el-pagination v-model:current-page="cdnPage" :page-size="50" layout="total, prev, pager, next" :total="cdnTotal" @current-change="loadCdnDomains" /></div>
				</template>
			</el-tab-pane>

			<el-tab-pane name="oss" class="oss-pane">
				<div class="resource-toolbar">
					<div class="resource-toolbar__filters">
						<el-input v-model="ossKeyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索 Bucket 或地域')" @keydown.enter="loadOssBuckets(1)" />
						<el-button :icon="Search" @click="loadOssBuckets(1)">{{ pub.lang('查询') }}</el-button>
					</div>
					<div class="resource-toolbar__actions">
						<el-button :icon="Refresh" :loading="ossLoading" @click="loadOssBuckets(ossPage)" />
						<el-button type="primary" :icon="Plus" @click="openOssBucketDialog">{{ pub.lang('创建 Bucket') }}</el-button>
					</div>
				</div>
				<div v-loading="ossLoading" class="oss-bucket-scroll">
					<el-empty v-if="!ossLoading && !ossBuckets.length" :description="pub.lang('暂无 Bucket')" />
					<div v-else class="oss-bucket-grid">
						<article
							v-for="bucket in ossBuckets"
							:key="bucket.name"
							class="oss-bucket-card"
							role="button"
							tabindex="0"
							@click="openOssObjects(bucket)"
							@keydown.enter.self="openOssObjects(bucket)"
							@keydown.space.self.prevent="openOssObjects(bucket)">
							<div class="oss-bucket-card__header">
								<div class="oss-bucket-card__identity">
									<span class="oss-bucket-card__icon"><el-icon><FolderOpened /></el-icon></span>
									<div>
										<strong :title="bucket.name">{{ bucket.name }}</strong>
										<span>{{ bucket.region }}</span>
									</div>
								</div>
								<div class="oss-bucket-card__actions" @click.stop>
									<el-popover trigger="click" placement="bottom-end" :width="360">
										<template #reference>
											<el-button text circle :icon="InfoFilled" :title="pub.lang('Bucket 详情')" />
										</template>
										<div class="oss-bucket-detail">
											<div class="oss-bucket-detail__title">{{ bucket.name }}</div>
											<dl>
												<div class="oss-bucket-detail__endpoint">
													<dt>Endpoint</dt>
													<dd><code>{{ bucket.endpoint }}</code><el-button text circle :icon="CopyDocument" @click="copyOssEndpoint(bucket.endpoint)" /></dd>
												</div>
												<div><dt>{{ pub.lang('地域') }}</dt><dd>{{ bucket.region }}</dd></div>
												<div><dt>{{ pub.lang('存储类型') }}</dt><dd>{{ ossStorageClassName(bucket.storage_class) }}</dd></div>
												<div><dt>{{ pub.lang('创建时间') }}</dt><dd>{{ safeFormatDate(bucket.creation_time) }}</dd></div>
												<div><dt>{{ pub.lang('流量口径') }}</dt><dd>{{ pub.lang('公网流出（云监控计量）') }}</dd></div>
												<div><dt>{{ pub.lang('流量更新时间') }}</dt><dd>{{ bucket.traffic_update_time ? safeFormatDate(bucket.traffic_update_time * 1000) : '--' }}</dd></div>
											</dl>
											<p class="oss-bucket-detail__hint">{{ pub.lang('云监控计量数据通常会延迟数分钟。') }}</p>
										</div>
									</el-popover>
									<el-dropdown trigger="click" @command="command => handleOssBucketCommand(command, bucket)">
										<el-button text circle :icon="MoreFilled" />
										<template #dropdown>
											<el-dropdown-menu>
												<el-dropdown-item command="delete">{{ pub.lang('删除 Bucket') }}</el-dropdown-item>
											</el-dropdown-menu>
										</template>
									</el-dropdown>
								</div>
							</div>

							<div class="oss-bucket-card__metrics">
								<div>
									<span>{{ pub.lang('文件数量') }}</span>
									<el-tooltip v-if="bucket.stat_error" :content="bucket.stat_error" placement="top"><strong>--</strong></el-tooltip>
									<strong v-else>{{ bucket.object_count === null ? '--' : bucket.object_count.toLocaleString() }}</strong>
								</div>
								<div>
									<span>{{ pub.lang('占用空间') }}</span>
									<el-tooltip v-if="bucket.stat_error" :content="bucket.stat_error" placement="top"><strong>--</strong></el-tooltip>
									<strong v-else>{{ bucket.storage_size === null ? '--' : formatBytes(bucket.storage_size) }}</strong>
								</div>
							</div>
							<div class="oss-bucket-card__traffic">
								<div>
									<span>{{ pub.lang('今日流量') }}</span>
									<el-tooltip v-if="bucket.traffic_error" :content="bucket.traffic_error" placement="top"><strong>--</strong></el-tooltip>
									<strong v-else>{{ bucket.today_traffic === null ? '--' : formatBytes(bucket.today_traffic) }}</strong>
								</div>
								<div>
									<span>{{ pub.lang('昨日流量') }}</span>
									<el-tooltip v-if="bucket.traffic_error" :content="bucket.traffic_error" placement="top"><strong>--</strong></el-tooltip>
									<strong v-else>{{ bucket.yesterday_traffic === null ? '--' : formatBytes(bucket.yesterday_traffic) }}</strong>
								</div>
							</div>

							<div class="oss-bucket-card__footer">
								<span class="oss-bucket-card__enter">{{ pub.lang('进入对象管理') }} <el-icon><ArrowRight /></el-icon></span>
							</div>
						</article>
					</div>
				</div>
				<div class="pagination"><el-pagination v-model:current-page="ossPage" :page-size="20" layout="total, prev, pager, next" :total="ossTotal" @current-change="loadOssBuckets" /></div>
			</el-tab-pane>
		</el-tabs>

		<el-dialog v-model="recordDialogVisible" width="520" align-center :title="recordForm.record_id ? pub.lang('编辑解析记录') : pub.lang('新增解析记录')" :close-on-click-modal="false" @closed="resetRecordForm">
			<el-form ref="recordFormRef" :model="recordForm" :rules="recordRules" label-width="100px">
				<el-form-item :label="pub.lang('域名')"><el-input :model-value="selectedDomain?.domain_name" disabled /></el-form-item>
				<el-form-item label="RR" prop="rr"><el-input v-model="recordForm.rr" placeholder="@ / www" @input="removeRecordRrSpaces" /></el-form-item>
				<el-form-item :label="pub.lang('类型')" prop="type"><el-select v-model="recordForm.type" class="w-full"><el-option v-for="type in recordTypes" :key="type" :label="type" :value="type" /></el-select></el-form-item>
				<el-form-item v-if="!recordForm.record_id" :label="pub.lang('记录目标')"><el-select v-model="recordOssBucket" clearable filterable class="w-full" :loading="ossCandidateLoading" :placeholder="pub.lang('手动填写或选择 OSS Bucket')" @change="selectRecordOssBucket"><el-option v-for="bucket in ossCandidates" :key="bucket.name" :label="`${bucket.name} · ${bucket.region}`" :value="bucket.name" /></el-select></el-form-item>
				<el-form-item :label="pub.lang('记录值')" prop="value"><el-input v-model="recordForm.value" @input="removeRecordValueSpaces" /></el-form-item>
				<el-form-item label="TTL" prop="ttl"><el-input-number v-model="recordForm.ttl" :min="1" :max="86400" class="w-full" /></el-form-item>
				<el-form-item :label="pub.lang('线路')" prop="line"><el-select v-model="recordForm.line" filterable class="w-full"><el-option v-for="line in recordLines" :key="line.code" :label="line.name" :value="line.code" /></el-select></el-form-item>
				<el-form-item v-if="recordForm.type === 'MX'" :label="pub.lang('MX 优先级')" prop="priority"><el-input-number v-model="recordForm.priority" :min="1" :max="50" class="w-full" /></el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="recordDialogVisible = false">{{ pub.lang('取消') }}</el-button>
				<el-button type="primary" :loading="recordSaving" @click="saveRecord">{{ pub.lang('保存') }}</el-button>
			</template>
		</el-dialog>

		<el-dialog v-model="esaRecordDialogVisible" width="560" align-center :title="esaRecordForm.record_id ? pub.lang('编辑 ESA 解析记录') : pub.lang('新增 ESA 解析记录')" :close-on-click-modal="false" @closed="resetEsaRecordForm">
			<el-form ref="esaRecordFormRef" :model="esaRecordForm" :rules="esaRecordRules" label-width="105px">
				<el-form-item :label="pub.lang('主机记录')" prop="record_name">
					<el-input v-model="esaRecordForm.record_name" :disabled="!!esaRecordForm.record_id" :placeholder="pub.lang('@ 或 www')" @input="removeEsaRecordNameSpaces" @blur="normalizeEsaRecordNameInput">
						<template #append>{{ esaRecordNameSuffix }}</template>
					</el-input>
				</el-form-item>
				<el-form-item :label="pub.lang('类型')" prop="type"><el-select v-model="esaRecordForm.type" class="w-full" @change="handleEsaRecordTypeChange"><el-option v-for="type in esaEditableRecordTypes" :key="type" :label="type" :value="type" /></el-select></el-form-item>
				<el-form-item :label="pub.lang('记录值')" prop="value"><el-input v-model="esaRecordForm.value" @input="removeEsaRecordValueSpaces" /></el-form-item>
				<el-form-item label="TTL" prop="ttl"><el-input-number v-model="esaRecordForm.ttl" :min="1" :max="86400" class="w-full" /></el-form-item>
				<el-form-item v-if="['MX', 'SRV', 'URI'].includes(esaRecordForm.type)" :label="pub.lang('优先级')" prop="priority"><el-input-number v-model="esaRecordForm.priority" :min="0" :max="65535" class="w-full" /></el-form-item>
				<el-form-item v-if="['SRV', 'URI'].includes(esaRecordForm.type)" :label="pub.lang('权重')" prop="weight"><el-input-number v-model="esaRecordForm.weight" :min="0" :max="65535" class="w-full" /></el-form-item>
				<el-form-item v-if="esaRecordForm.type === 'SRV'" :label="pub.lang('端口')" prop="port"><el-input-number v-model="esaRecordForm.port" :min="0" :max="65535" class="w-full" /></el-form-item>
				<template v-if="esaRecordForm.type === 'CAA'">
					<el-form-item label="Flag" prop="flag"><el-input-number v-model="esaRecordForm.flag" :min="0" :max="255" class="w-full" /></el-form-item>
					<el-form-item label="Tag" prop="tag"><el-select v-model="esaRecordForm.tag" class="w-full"><el-option label="issue" value="issue" /><el-option label="issuewild" value="issuewild" /><el-option label="iodef" value="iodef" /></el-select></el-form-item>
				</template>
				<el-form-item v-if="esaRecordForm.type === 'CNAME'" :label="pub.lang('源站类型')"><el-select v-model="esaRecordForm.source_type" class="w-full" @change="handleEsaSourceTypeChange"><el-option :label="pub.lang('普通域名')" value="Domain" /><el-option label="OSS" value="OSS" /><el-option label="S3" value="S3" /><el-option label="LB" value="LB" /><el-option label="OP" value="OP" /></el-select></el-form-item>
				<el-form-item v-if="esaRecordForm.type === 'CNAME' && esaRecordForm.source_type === 'OSS'" label="OSS Bucket"><el-select v-model="esaOssBucket" filterable class="w-full" :loading="ossCandidateLoading" @change="selectEsaOssBucket"><el-option v-for="bucket in ossCandidates" :key="bucket.name" :label="`${bucket.name} · ${bucket.region}`" :value="bucket.name" /></el-select></el-form-item>
				<el-form-item v-if="esaRecordProxySupported" :label="pub.lang('代理加速')"><el-switch v-model="esaRecordForm.proxied" active-color="#ff6a00" /></el-form-item>
				<el-form-item v-if="esaRecordForm.proxied" :label="pub.lang('业务场景')"><el-select v-model="esaRecordForm.biz_name" class="w-full"><el-option :label="pub.lang('网页')" value="web" /><el-option label="API" value="api" /><el-option :label="pub.lang('图片视频')" value="image_video" /></el-select></el-form-item>
				<el-form-item :label="pub.lang('备注')"><el-input v-model="esaRecordForm.comment" maxlength="100" show-word-limit /></el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="esaRecordDialogVisible = false">{{ pub.lang('取消') }}</el-button>
				<el-button type="primary" :loading="esaRecordSaving" @click="saveEsaRecord">{{ pub.lang('保存') }}</el-button>
			</template>
		</el-dialog>

		<el-dialog v-model="esaCertificateApplyVisible" width="560" align-center :title="pub.lang('申请 ESA HTTPS 证书')" :close-on-click-modal="false">
			<el-form ref="esaCertificateApplyFormRef" :model="esaCertificateApplyForm" :rules="esaCertificateApplyRules" label-width="95px">
				<el-form-item :label="pub.lang('申请渠道')" prop="channel_id">
					<el-select v-model="esaCertificateApplyForm.channel_id" class="w-full" :loading="sslChannelLoading" @change="loadEsaApplyMeta">
						<el-option v-for="channel in enabledSslChannels" :key="channel.channel_id" :label="channel.channel_name" :value="channel.channel_id" />
					</el-select>
				</el-form-item>
				<el-form-item :label="pub.lang('证书类型')">
					<el-radio-group v-model="esaCertificateApplyForm.certificate_type">
						<el-radio value="single">{{ pub.lang('单域名') }}</el-radio>
						<el-radio value="wildcard">{{ pub.lang('通配符') }}</el-radio>
					</el-radio-group>
				</el-form-item>
				<el-form-item :label="pub.lang('申请域名')" prop="domain_prefix">
					<el-input v-model="esaCertificateApplyForm.domain_prefix" :placeholder="esaCertificateApplyForm.certificate_type === 'wildcard' ? pub.lang('留空表示站点全部一级子域名') : pub.lang('留空表示站点根域名，如 www')" @input="removeEsaCertificateDomainSpaces" @blur="normalizeEsaCertificateDomainInput">
						<template v-if="esaCertificateApplyForm.certificate_type === 'wildcard'" #prepend>*.</template>
						<template #append>.{{ esaSiteName }}</template>
					</el-input>
					<div class="certificate-domain-preview">{{ pub.lang('完整域名') }}：<strong>{{ esaApplyFullDomain }}</strong></div>
				</el-form-item>
				<el-form-item label="CA" prop="brand">
					<el-select v-model="esaCertificateApplyForm.brand" class="w-full" :loading="esaApplyMetaLoading">
						<el-option v-for="brand in esaApplyMeta?.brands || []" :key="brand.key" :label="`${brand.name} · ${brand.points} ${pub.lang('积分')}`" :value="brand.key" />
					</el-select>
				</el-form-item>
				<el-alert type="info" :closable="false" :title="pub.lang('提交后将自动添加 DNS 验证记录，并在签发成功后上传到当前 ESA 站点')" />
			</el-form>
			<template #footer>
				<el-button @click="esaCertificateApplyVisible = false">{{ pub.lang('取消') }}</el-button>
				<el-button type="primary" :loading="esaCertificateApplying" :disabled="!enabledSslChannels.length" @click="submitEsaCertificateApply">{{ pub.lang('申请并自动部署') }}</el-button>
			</template>
		</el-dialog>

		<el-drawer v-model="esaDeployDrawerVisible" size="760px" :title="`${esaSiteName} ${pub.lang('证书部署任务')}`">
			<div class="esa-deploy-drawer-toolbar">
				<span class="muted">{{ pub.lang('证书签发成功后将自动上传到当前 ESA 站点') }}</span>
				<el-button :icon="Refresh" @click="loadEsaDeployTasks()" />
			</div>
			<el-table :data="esaDeployTasks" row-key="task_id" height="calc(100vh - 150px)">
				<el-table-column :label="pub.lang('申请域名')" min-width="180"><template #default="{ row }"><div class="instance-name">{{ row.domain }}</div><div class="muted mono">{{ row.order_id || '--' }}</div></template></el-table-column>
				<el-table-column :label="pub.lang('状态')" width="110"><template #default="{ row }"><el-tag size="small" :type="esaDeployStatusType(row.status)">{{ esaDeployStatusName(row.status) }}</el-tag></template></el-table-column>
				<el-table-column :label="pub.lang('更新时间')" width="170"><template #default="{ row }">{{ safeFormatDate(row.update_time * 1000) }}</template></el-table-column>
				<el-table-column :label="pub.lang('错误信息')" min-width="190" show-overflow-tooltip><template #default="{ row }">{{ row.last_error || '--' }}</template></el-table-column>
				<el-table-column :label="pub.lang('操作')" width="75" fixed="right"><template #default="{ row }"><el-button v-if="row.status !== 'completed' && row.order_id" link type="primary" :loading="esaDeployRetryingId === row.task_id" @click="retryEsaDeployTask(row)">{{ pub.lang('重试') }}</el-button><span v-else>--</span></template></el-table-column>
			</el-table>
		</el-drawer>

		<el-dialog v-model="cdnDomainDialogVisible" width="680" align-center :title="pub.lang('修改 CDN 源站')" :close-on-click-modal="false">
			<el-form ref="cdnDomainFormRef" :model="cdnDomainForm" :rules="cdnDomainRules" label-width="90px">
				<el-form-item :label="pub.lang('加速域名')"><el-input v-model="cdnDomainForm.domain_name" disabled /></el-form-item>
				<el-form-item :label="pub.lang('源站')" prop="sources">
					<div class="cdn-source-list">
						<div v-for="(source, index) in cdnDomainForm.sources" :key="index" class="cdn-source-row">
							<el-select v-model="source.type" @change="handleCdnSourceTypeChange(source)"><el-option :label="pub.lang('IP 地址')" value="ipaddr" /><el-option :label="pub.lang('域名')" value="domain" /><el-option label="OSS" value="oss" /></el-select>
						<el-select v-if="source.type === 'oss'" v-model="source.content" filterable :loading="ossCandidateLoading" :placeholder="pub.lang('选择 OSS Bucket')"><el-option v-for="bucket in ossCandidates" :key="bucket.name" :label="`${bucket.name} · ${bucket.region}`" :value="bucket.endpoint" /></el-select>
						<el-input v-else v-model="source.content" :placeholder="pub.lang('源站地址')" />
							<el-input-number v-model="source.port" :min="1" :max="65535" controls-position="right" />
							<el-button type="danger" link :disabled="cdnDomainForm.sources.length === 1" @click="removeCdnSource(index)">{{ pub.lang('删除') }}</el-button>
						</div>
							<el-button plain :icon="Plus" @click="addCdnSource">{{ pub.lang('添加源站') }}</el-button>
					</div>
				</el-form-item>
			</el-form>
			<template #footer>
				<el-button @click="cdnDomainDialogVisible = false">{{ pub.lang('取消') }}</el-button>
				<el-button type="primary" :loading="cdnDomainSaving" @click="saveCdnDomain">{{ pub.lang('保存') }}</el-button>
			</template>
		</el-dialog>

		<el-dialog v-model="ossBucketDialogVisible" width="520" align-center :title="pub.lang('创建 OSS Bucket')" :close-on-click-modal="false">
			<el-form ref="ossBucketFormRef" :model="ossBucketForm" :rules="ossBucketRules" label-width="95px">
				<el-form-item label="Bucket" prop="name"><el-input v-model="ossBucketForm.name" maxlength="63" placeholder="example-bucket" /></el-form-item>
				<el-form-item :label="pub.lang('地域')" prop="region"><el-select v-model="ossBucketForm.region" filterable allow-create class="w-full"><el-option v-for="region in ossRegions" :key="region" :label="region" :value="region" /></el-select></el-form-item>
				<el-form-item :label="pub.lang('存储类型')"><el-select v-model="ossBucketForm.storage_class" class="w-full"><el-option :label="pub.lang('标准存储')" value="Standard" /><el-option :label="pub.lang('低频访问')" value="IA" /><el-option :label="pub.lang('归档存储')" value="Archive" /></el-select></el-form-item>
				<el-form-item :label="pub.lang('读写权限')"><el-select v-model="ossBucketForm.acl" class="w-full"><el-option :label="pub.lang('私有')" value="private" /><el-option :label="pub.lang('公共读')" value="public-read" /><el-option :label="pub.lang('公共读写')" value="public-read-write" /></el-select></el-form-item>
			</el-form>
			<template #footer><el-button @click="ossBucketDialogVisible = false">{{ pub.lang('取消') }}</el-button><el-button type="primary" :loading="ossBucketSaving" @click="saveOssBucket">{{ pub.lang('创建') }}</el-button></template>
		</el-dialog>

		<el-drawer v-model="cdnLogVisible" size="1000px" :title="pub.lang('CDN 操作记录')">
			<div class="record-log-toolbar">
				<el-select v-model="cdnLogDomain" clearable filterable :placeholder="pub.lang('全部 CDN 域名')" @change="reloadCdnOperationLogs">
					<el-option v-for="domain in cdnDomains" :key="domain.domain_name" :label="domain.domain_name" :value="domain.domain_name" />
				</el-select>
				<span class="muted">{{ pub.lang('数据来自阿里云操作审计，默认保留最近 7 天') }}</span>
				<el-button :icon="Refresh" :loading="cdnLogLoading" @click="reloadCdnOperationLogs" />
			</div>
			<el-table :data="cdnOperationLogs" v-loading="cdnLogLoading" row-key="event_id" height="calc(100vh - 190px)">
				<el-table-column :label="pub.lang('操作时间')" width="180"><template #default="{ row }">{{ safeFormatDate(row.event_time) }}</template></el-table-column>
				<el-table-column :label="pub.lang('动作')" width="190"><template #default="{ row }">{{ cdnOperationName(row.event_name) }}</template></el-table-column>
				<el-table-column :label="pub.lang('域名')" min-width="220"><template #default="{ row }">{{ row.domains.join(', ') || '--' }}</template></el-table-column>
				<el-table-column :label="pub.lang('操作者')" min-width="160"><template #default="{ row }"><div>{{ row.operator || '--' }}</div><div v-if="row.access_key_id" class="muted mono">{{ row.access_key_id }}</div></template></el-table-column>
				<el-table-column prop="source_ip" :label="pub.lang('来源 IP')" width="145" />
				<el-table-column :label="pub.lang('结果')" width="100"><template #default="{ row }"><el-tooltip :content="row.error_message || row.error_code" placement="top" :disabled="row.success"><el-tag :type="row.success ? 'success' : 'danger'">{{ row.success ? pub.lang('成功') : pub.lang('失败') }}</el-tag></el-tooltip></template></el-table-column>
			</el-table>
			<div class="cdn-log-pagination">
				<el-button :disabled="cdnLogPage === 1 || cdnLogLoading" @click="previousCdnLogPage">{{ pub.lang('上一页') }}</el-button>
				<span>{{ pub.lang(`第 ${cdnLogPage} 页`) }}</span>
				<el-button :disabled="!cdnLogNextToken || cdnLogLoading" @click="nextCdnLogPage">{{ pub.lang('下一页') }}</el-button>
			</div>
		</el-drawer>

		<el-drawer v-model="recordLogVisible" size="900px" :title="`${selectedDomain?.domain_name || ''} ${pub.lang('解析操作记录')}`">
			<div class="record-log-toolbar">
				<el-input v-model="recordLogKeyword" clearable :prefix-icon="Search" :placeholder="pub.lang('搜索操作记录')" @keydown.enter="loadRecordLogs(1)" />
				<el-button :icon="Refresh" :loading="recordLogLoading" @click="loadRecordLogs(recordLogPage)" />
			</div>
			<el-table :data="recordLogs" v-loading="recordLogLoading" row-key="action_timestamp" height="calc(100vh - 190px)">
				<el-table-column :label="pub.lang('操作时间')" width="180">
					<template #default="{ row }">{{ formatRecordLogTime(row) }}</template>
				</el-table-column>
				<el-table-column prop="action" :label="pub.lang('动作')" width="130" />
				<el-table-column prop="message" :label="pub.lang('操作内容')" min-width="380" show-overflow-tooltip />
				<el-table-column prop="client_ip" :label="pub.lang('来源 IP')" width="145" />
			</el-table>
			<div class="pagination">
				<el-pagination v-model:current-page="recordLogPage" :page-size="20" layout="total, prev, pager, next" :total="recordLogTotal" @current-change="loadRecordLogs" />
			</div>
		</el-drawer>
	</div>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { ArrowLeft, ArrowRight, Clock, CopyDocument, FolderOpened, Hide, InfoFilled, Monitor, MoreFilled, Plus, QuestionFilled, Refresh, Search, View } from '@element-plus/icons-vue'
import { ElMessageBox, type FormInstance, type FormRules } from 'element-plus'
import { common, ipc, routes } from '@api/http'
import { useMessage } from '@utils/hooks/message'
import { copyText, pub } from '@utils/tools'
import { useXtermBase } from '@store/xterm'
import TrafficAnalytics from './components/traffic-analytics.vue'

defineOptions({ name: 'AliyunDetail' })

interface AliyunAccount {
	account_id: number
	remark: string
	access_key_id: string
	balance: string
	balance_currency: string
	balance_refresh_time: number
	server_count: number
	domain_count: number
	esa_count: number
	cdn_count: number
	cdn_status: 'active' | 'not_opened' | 'unknown'
	oss_count: number
	resource_refresh_time: number
	resource_error: string
	resource_error_detail: string
	resource_status: ResourceStatus
}
type ResourceStatusKey = 'balance' | 'server' | 'domain' | 'esa' | 'cdn' | 'oss'
type ResourceStatus = Partial<Record<ResourceStatusKey, string>>
interface CloudServer {
	source: 'ecs' | 'swas'
	instance_id: string
	name: string
	region_id: string
	status: string
	os_type: string
	os_name: string
	public_ips: string[]
	private_ips: string[]
	cpu_cores: number
	memory_gb: number
	bandwidth_mbps: number
	disk_gb: number | null
	monthly_traffic_gb: number | null
	instance_type: string
	charge_type: string
	expired_time: string
}
interface DomainItem { domain_id: string; domain_name: string; record_count: number; version_name: string; instance_end_time: string; instance_expired: boolean; expiration_date: string; expiration_days: number | null }
interface DomainInfo { domain_name: string; dns_servers: string[]; dns_provider: 'alidns' | 'esa' | 'external' | 'unknown'; esa_in_current_account?: boolean; esa_site_id: string; esa_site_name: string }
interface RecordItem { record_id: string; rr: string; type: string; value: string; ttl: number; line: string; priority: number; status: string; locked: boolean }
interface RecordLine { code: string; name: string }
interface RecordLog { action: string; action_time: string; action_timestamp: number; client_ip: string; message: string }
interface EsaSite { site_id: string; site_name: string; access_type: string; coverage: string; status: string; cname_zone: string; name_servers: string | string[]; plan_name: string; plan_spec_name: string; create_time: string; update_time: string }
interface EsaSiteDetail extends EsaSite { instance_id: string; resource_group_id: string; offline_reason: string; version_management: boolean }
interface EsaRecord { record_id: string; record_name: string; type: string; value: string; priority: number; weight: number; port: number; flag: number; tag: string; ttl: number; proxied: boolean; record_cname: string; source_type: string; host_policy: string; http_ports: string; https_ports: string; comment: string; update_time: string }
interface EsaOrigin { origin_id: string; name: string; address: string; type: string; enabled: boolean; weight: number; host_header: string }
interface EsaOriginPool { pool_id: string; name: string; enabled: boolean; record_name: string; origins: EsaOrigin[] }
interface EsaOriginRule { config_id: string; config_type: string; rule_name: string; rule_enable: string; rule: string; origin_scheme: string; origin_host: string; origin_http_port: string; origin_https_port: string; origin_sni: string; origin_verify: string }
interface EsaOrigins { pools: EsaOriginPool[]; rules: EsaOriginRule[]; partial: boolean; errors: Array<{ module: string; message: string }> }
interface EsaCertificate { certificate_id: string; name: string; common_name: string; sans: string; type: string; status: string; issuer: string; not_before: string; not_after: string; public_key_algorithm: string; signature_algorithm: string; update_time: string }
interface EsaCertificateGroup extends EsaCertificate { record_names: string[]; deploy_task?: EsaDeployTask }
interface EsaCertificateRecord { record_name: string; status: string; applying_count: number; certificates: EsaCertificate[]; error: string }
interface EsaHttpsBasic { config_id: string; config_type: string; rule_name: string; https: string; http2: string; http3: string; tls10: string; tls11: string; tls12: string; tls13: string; ocsp_stapling: string; ciphersuite_group: string }
interface EsaHttpsApplication { config_id: string; config_type: string; rule_name: string; https_force: string; https_force_code: string; hsts: string; hsts_max_age: string; hsts_include_subdomains: string }
interface SslChannel { channel_id: number; provider: string; channel_name: string; enabled: boolean }
interface SslApplyMeta { fixed_days: number; brands: Array<{ key: string; name: string; points: number; description: string }>; validate_methods: Array<{ key: string; name: string; description: string }> }
interface EsaDeployTask { task_id: number; account_id: number; site_id: string; channel_id: number; provider: string; order_id: string; domain: string; brand: string; status: string; esa_certificate_id: string; last_error: string; retry_count: number; addtime: number; update_time: number }
interface CdnSource { type: string; content: string; port: number; priority: number; weight: number }
interface CdnDomain { domain_id: string; domain_name: string; cname: string; cdn_type: string; coverage: string; status: string; access_status: string; access_error: string; ssl_enabled: boolean; description: string; sources: CdnSource[]; create_time: string; update_time: string }
interface CdnOperationLog { event_id: string; event_name: string; event_time: string; domains: string[]; operator: string; access_key_id: string; source_ip: string; region_id: string; request_id: string; success: boolean; error_code: string; error_message: string }
interface OssBucket { name: string; region: string; endpoint: string; creation_time: string; storage_class: string; object_count: number | null; storage_size: number | null; stat_error: string; today_traffic: number | null; yesterday_traffic: number | null; traffic_error: string; traffic_update_time: number }

const route = useRoute()
const router = useRouter()
const Message = useMessage()
const xtermStore = useXtermBase()
const accountId = Number(route.params.accountId)
const request = (path: string, data: Record<string, unknown> = {}) => common.sendAsync({ route: path, data, timeout: 120000 }) as Promise<any>

const account = ref<AliyunAccount>()
const accountLoading = ref(false)
const summaryRefreshing = ref(false)
const balanceRefreshing = ref(false)
const activeTab = ref(['servers', 'domains', 'esa', 'cdn', 'oss'].includes(String(route.query.tab)) ? String(route.query.tab) : 'servers')
const resourceTabsRef = ref<HTMLElement>()
const resourceIndicatorStyle = ref({ width: '0px', transform: 'translateX(0px)' })
const currentResourceStatus = (key: ResourceStatusKey) => {
	const currentStatus = account.value?.resource_status?.[key]
	return key === 'cdn' && (!currentStatus || currentStatus === 'unknown') ? account.value?.cdn_status : currentStatus
}
const resourceStatusText = (key: ResourceStatusKey) => ({
	not_opened: pub.lang('未开通'),
	disabled: pub.lang('已停用'),
	overdue: pub.lang('已欠费'),
	permission_denied: pub.lang('无权限'),
	invalid_credentials: pub.lang('密钥无效'),
	rate_limited: pub.lang('已限流'),
	quota_exceeded: pub.lang('配额不足'),
	unavailable: pub.lang('服务异常'),
	partial: pub.lang('部分获取'),
	timeout: pub.lang('超时'),
	network: pub.lang('网络异常'),
	error: pub.lang('获取失败'),
} as Record<string, string>)[String(currentResourceStatus(key) || '')] || ''
const resourceStatusAlertType = (status?: string) => ['not_opened', 'permission_denied'].includes(String(status || '')) ? 'info' : 'warning'
const resourceTabItems = computed(() => [
	{ name: 'servers', label: pub.lang('服务器'), count: formatCount(account.value?.server_count), status: resourceStatusText('server') },
	{ name: 'domains', label: pub.lang('域名解析'), count: formatCount(account.value?.domain_count), status: resourceStatusText('domain') },
	{ name: 'esa', label: 'ESA', count: formatCount(account.value?.esa_count), status: resourceStatusText('esa') },
	{ name: 'cdn', label: 'CDN', count: formatCount(account.value?.cdn_count), status: resourceStatusText('cdn') },
	{ name: 'oss', label: 'OSS', count: formatCount(account.value?.oss_count), status: resourceStatusText('oss') },
])
const updateResourceIndicator = () => nextTick(() => {
	const container = resourceTabsRef.value
	const active = container?.querySelector<HTMLElement>('.resource-navigation__item.active')
	if (!container || !active) return
	resourceIndicatorStyle.value = {
		width: `${active.offsetWidth}px`,
		transform: `translateX(${active.offsetLeft}px)`,
	}
})
const switchResourceTab = (name: string) => {
	activeTab.value = name
	updateResourceIndicator()
	handleTabChange(name)
}

const servers = ref<CloudServer[]>([])
const serverLoading = ref(false)
const serverLoaded = ref(false)
const serverPartial = ref(false)
const showServerIp = ref(false)
const openingServerId = ref('')
const serverPage = ref(1)
const serverQuery = reactive({ keyword: '', source: 'all', region: 'all', status: 'all' })
const serverRegions = computed(() => Array.from(new Set(servers.value.map(item => item.region_id))).sort())
const serverStatuses = computed(() => Array.from(new Set(servers.value.map(item => item.status).filter(Boolean))).sort())
const filteredServers = computed(() => {
	const keyword = serverQuery.keyword.trim().toLowerCase()
	return servers.value.filter(item => {
		if (serverQuery.source !== 'all' && item.source !== serverQuery.source) return false
		if (serverQuery.region !== 'all' && item.region_id !== serverQuery.region) return false
		if (serverQuery.status !== 'all' && item.status !== serverQuery.status) return false
		if (!keyword) return true
		return [item.name, item.instance_id, ...item.public_ips, ...item.private_ips].some(value => String(value).toLowerCase().includes(keyword))
	})
})
const pagedServers = computed(() => filteredServers.value.slice((serverPage.value - 1) * 20, serverPage.value * 20))
watch(serverQuery, () => { serverPage.value = 1 }, { deep: true })

const domains = ref<DomainItem[]>([])
const domainLoading = ref(false)
const domainLoaded = ref(false)
const domainKeyword = ref('')
const domainPage = ref(1)
const domainTotal = ref(0)
const selectedDomain = ref<DomainItem>()
const selectedDomainInfo = ref<DomainInfo>()
const domainInfoLoading = ref(false)
const domainRecordsWritable = computed(() => selectedDomainInfo.value?.dns_provider === 'alidns')
const domainCanOpenEsa = computed(() => selectedDomainInfo.value?.dns_provider === 'esa'
	&& !!selectedDomainInfo.value.esa_site_id)
const domainProviderName = computed(() => ({
	alidns: pub.lang('阿里云 DNS'),
	esa: 'ESA DNS',
	external: pub.lang('外部 DNS'),
	unknown: pub.lang('未知 DNS'),
}[selectedDomainInfo.value?.dns_provider || 'unknown']))
const domainProviderTagType = computed(() => ({ alidns: 'success', esa: 'warning', external: 'info', unknown: 'info' }[selectedDomainInfo.value?.dns_provider || 'unknown']))
const domainProviderTip = computed(() => selectedDomainInfo.value?.dns_provider === 'esa'
	? domainCanOpenEsa.value
		? pub.lang('当前权威 DNS 由本账号的 ESA 托管，请前往对应 ESA 站点管理解析。')
		: pub.lang('当前权威 DNS 由 ESA 托管，但对应站点不在当前账号中，无法从这里跳转。')
	: pub.lang('当前权威 DNS 不在阿里云 DNS，此处解析记录仅供查看，修改不会对公网解析生效。'))
const records = ref<RecordItem[]>([])
const recordLoading = ref(false)
const recordKeyword = ref('')
const recordType = ref('all')
const recordPage = ref(1)
const recordPageSize = ref(20)
const recordTotal = ref(0)
const selectedRecords = ref<RecordItem[]>([])
const recordBatchLoading = ref(false)
const recordStatusLoadingId = ref('')
const recordLines = ref<RecordLine[]>([{ code: 'default', name: pub.lang('默认') }])
const recordTypes = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR']
const recordDialogVisible = ref(false)
const recordSaving = ref(false)
const recordLogVisible = ref(false)
const recordLogLoading = ref(false)
const recordLogKeyword = ref('')
const recordLogPage = ref(1)
const recordLogTotal = ref(0)
const recordLogs = ref<RecordLog[]>([])
const recordFormRef = ref<FormInstance>()
const createRecordForm = () => ({ record_id: '', rr: '@', type: 'A', value: '', ttl: 600, line: 'default', priority: 10 })
const recordForm = reactive(createRecordForm())
const recordOssBucket = ref('')
const removeRecordRrSpaces = () => { recordForm.rr = String(recordForm.rr || '').replace(/\s+/g, '') }
const removeRecordValueSpaces = () => { recordForm.value = String(recordForm.value || '').replace(/\s+/g, '') }
const recordRules = computed<FormRules>(() => ({
	rr: [{ required: true, message: pub.lang('请输入主机记录'), trigger: 'blur' }],
	type: [{ required: true, message: pub.lang('请选择记录类型'), trigger: 'change' }],
	value: [{ required: true, message: pub.lang('请输入记录值'), trigger: 'blur' }],
	priority: [{ validator: (_rule, value, callback) => recordForm.type !== 'MX' || (Number.isInteger(value) && value >= 1 && value <= 50) ? callback() : callback(new Error(pub.lang('MX 优先级必须为 1 到 50'))), trigger: 'change' }],
}))

const esaSites = ref<EsaSite[]>([])
const esaLoading = ref(false)
const esaLoaded = ref(false)
const esaPage = ref(1)
const esaTotal = ref(0)
const esaQuery = reactive({ keyword: '', status: 'all' })
const esaStatuses = ['active', 'pending', 'offline', 'moved']
const selectedEsaSite = ref<EsaSite>()
const pendingEsaSiteId = ref('')
const esaDetail = ref<EsaSiteDetail>()
const esaDetailLoading = ref(false)
const esaDetailTab = ref('analytics')
const esaRecords = ref<EsaRecord[]>([])
const esaRecordLoading = ref(false)
const esaRecordLoaded = ref(false)
const esaRecordKeyword = ref('')
const esaRecordType = ref('all')
const esaRecordPage = ref(1)
const esaRecordPageSize = ref(20)
const esaRecordTotal = ref(0)
const selectedEsaRecords = ref<EsaRecord[]>([])
const esaRecordBatchLoading = ref(false)
const esaProxyLoadingId = ref('')
const esaRecordTypes = ['A/AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR', 'CERT', 'SSHFP', 'TLSA', 'URI']
const esaEditableRecordTypes = ['A/AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'URI']
const esaRecordDialogVisible = ref(false)
const esaRecordSaving = ref(false)
const esaRecordFormRef = ref<FormInstance>()
const createEsaRecordForm = () => ({ record_id: '', record_name: '', type: 'A/AAAA', value: '', ttl: 1, proxied: false, priority: 10, weight: 0, port: 80, flag: 0, tag: 'issue', source_type: 'Domain', host_policy: 'follow_hostname', biz_name: 'web', comment: '' })
const esaRecordForm = reactive(createEsaRecordForm())
const esaOssBucket = ref('')
const esaRecordProxySupported = computed(() => ['A/AAAA', 'CNAME'].includes(esaRecordForm.type))
const esaSiteName = computed(() => String(selectedEsaSite.value?.site_name || '').trim().toLowerCase().replace(/^\.+|\.+$/g, ''))
const esaRecordNameSuffix = computed(() => esaSiteName.value ? `.${esaSiteName.value}` : '')
const removeEsaRecordNameSpaces = () => { esaRecordForm.record_name = String(esaRecordForm.record_name || '').replace(/\s+/g, '') }
const removeEsaRecordValueSpaces = () => { esaRecordForm.value = String(esaRecordForm.value || '').replace(/\s+/g, '') }
const normalizeEsaRecordNameInput = () => {
	const value = String(esaRecordForm.record_name || '').replace(/\s+/g, '').toLowerCase().replace(/\.$/, '')
	const suffix = esaSiteName.value ? `.${esaSiteName.value}` : ''
	if (value === esaSiteName.value) esaRecordForm.record_name = '@'
	else if (suffix && value.endsWith(suffix)) esaRecordForm.record_name = value.slice(0, -suffix.length) || '@'
	else esaRecordForm.record_name = value
}
const esaFullRecordName = () => {
	normalizeEsaRecordNameInput()
	if (!esaSiteName.value) return esaRecordForm.record_name
	return esaRecordForm.record_name === '@' ? esaSiteName.value : `${esaRecordForm.record_name}.${esaSiteName.value}`
}
const esaRecordRules = computed<FormRules>(() => ({
	record_name: [{ required: true, message: pub.lang('请输入记录名称'), trigger: 'blur' }],
	type: [{ required: true, message: pub.lang('请选择记录类型'), trigger: 'change' }],
	value: [{ required: true, message: pub.lang('请输入记录值'), trigger: 'blur' }],
	ttl: [{ validator: (_rule, value, callback) => Number(value) === 1 || (Number.isInteger(value) && value >= 30 && value <= 86400) ? callback() : callback(new Error(pub.lang('TTL 必须为 1，或 30 到 86400'))), trigger: 'change' }],
}))
const esaOrigins = reactive<EsaOrigins>({ pools: [], rules: [], partial: false, errors: [] })
const esaOriginLoading = ref(false)
const esaOriginLoaded = ref(false)
const esaCertificateRecords = ref<EsaCertificateRecord[]>([])
const esaHttpsBasic = ref<EsaHttpsBasic[]>([])
const esaHttpsApplication = ref<EsaHttpsApplication[]>([])
const esaCertificatePartial = ref(false)
const esaCertificateLoading = ref(false)
const esaCertificateLoaded = ref(false)
const esaCertificatePage = ref(1)
const esaCertificateTotal = ref(0)
const esaCertificateApplyVisible = ref(false)
const esaCertificateApplying = ref(false)
const esaCertificateApplyFormRef = ref<FormInstance>()
const sslChannels = ref<SslChannel[]>([])
const sslChannelLoading = ref(false)
const esaApplyMeta = ref<SslApplyMeta>()
const esaApplyMetaLoading = ref(false)
const esaDeployTasks = ref<EsaDeployTask[]>([])
const esaDeployRetryingId = ref(0)
const esaDeployDrawerVisible = ref(false)
const esaDeployPollingTimer = ref<ReturnType<typeof setInterval>>()
const esaDeployFailedCount = computed(() => esaDeployTasks.value.filter(task => task.status === 'failed').length)
const esaDeployAttentionCount = computed(() => esaDeployTasks.value.filter(task => !['completed'].includes(task.status)).length)
const esaCertificateApplyForm = reactive<{ channel_id: number; certificate_type: 'single' | 'wildcard'; domain_prefix: string; brand: string; days: number }>({ channel_id: 0, certificate_type: 'single', domain_prefix: '', brand: '', days: 90 })
const enabledSslChannels = computed(() => sslChannels.value.filter(channel => channel.enabled))
const removeEsaCertificateDomainSpaces = () => {
	esaCertificateApplyForm.domain_prefix = String(esaCertificateApplyForm.domain_prefix || '').replace(/\s+/g, '')
}
const normalizeEsaCertificateDomainInput = () => {
	let value = String(esaCertificateApplyForm.domain_prefix || '').replace(/\s+/g, '').toLowerCase().replace(/\.$/, '')
	const suffix = esaSiteName.value ? `.${esaSiteName.value}` : ''
	value = value.replace(/^\*\./, '')
	if (value === '@' || value === esaSiteName.value) value = ''
	else if (suffix && value.endsWith(suffix)) value = value.slice(0, -suffix.length)
	esaCertificateApplyForm.domain_prefix = value
}
const esaApplyFullDomain = computed(() => {
	const prefix = String(esaCertificateApplyForm.domain_prefix || '').replace(/\s+/g, '')
	const baseDomain = prefix ? `${prefix}.${esaSiteName.value}` : esaSiteName.value
	return esaCertificateApplyForm.certificate_type === 'wildcard' ? `*.${baseDomain}` : baseDomain
})
const esaCertificateApplyRules = computed<FormRules>(() => ({
	channel_id: [{ required: true, message: pub.lang('请选择申请渠道'), trigger: 'change' }],
	domain_prefix: [{ validator: (_rule, value, callback) => {
		const prefix = String(value || '').replace(/\s+/g, '')
		return !prefix || /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(prefix)
			? callback()
			: callback(new Error(pub.lang('请输入正确的域名前缀')))
	}, trigger: 'blur' }],
	brand: [{ required: true, message: pub.lang('请选择 CA 品牌'), trigger: 'change' }],
}))
const esaOriginRows = computed(() => esaOrigins.pools.flatMap(pool => pool.origins.map(origin => ({
	...origin,
	row_key: `${pool.pool_id}-${origin.origin_id}`,
	pool_name: pool.name || pool.record_name || '--',
}))))
const esaNameServers = computed(() => normalizeDisplayList(esaDetail.value?.name_servers || selectedEsaSite.value?.name_servers))
const esaPrimaryEndpoint = computed(() => esaNameServers.value || esaDetail.value?.cname_zone || selectedEsaSite.value?.cname_zone || pub.lang('暂无接入地址'))
const esaPlanName = computed(() => esaDetail.value?.plan_name || esaDetail.value?.plan_spec_name || selectedEsaSite.value?.plan_name || selectedEsaSite.value?.plan_spec_name || '--')
const esaCertificateGroups = computed<EsaCertificateGroup[]>(() => {
	const groups = new Map<string, EsaCertificateGroup>()
	esaCertificateRecords.value.forEach(record => {
		record.certificates.forEach(certificate => {
			const key = certificate.certificate_id || [certificate.common_name, certificate.not_after, certificate.issuer].join('|')
			const current = groups.get(key)
			if (current) {
				if (!current.record_names.includes(record.record_name)) current.record_names.push(record.record_name)
			} else {
				groups.set(key, { ...certificate, certificate_id: key, record_names: [record.record_name] })
			}
		})
	})
	const taskRows: EsaCertificateGroup[] = esaDeployTasks.value
		.filter(task => task.status !== 'completed')
		.map(task => ({
			certificate_id: `deploy-task-${task.task_id}`,
			name: task.domain,
			common_name: task.domain,
			sans: '',
			type: 'automatic',
			status: task.status,
			issuer: task.provider,
			not_before: '',
			not_after: '',
			public_key_algorithm: '',
			signature_algorithm: '',
			update_time: String(task.update_time),
			record_names: [task.domain],
			deploy_task: task,
		}))
	return [...taskRows, ...Array.from(groups.values()).sort((a, b) => b.record_names.length - a.record_names.length)]
})
const esaCertificateSummary = computed(() => esaCertificateRecords.value.reduce((summary, record) => {
	const key = ['configured', 'applying', 'failed'].includes(record.status) ? record.status : 'none'
	summary[key as keyof typeof summary] += 1
	return summary
}, {
	configured: 0,
	applying: esaDeployTasks.value.filter(task => !['completed', 'failed'].includes(task.status)).length,
	failed: esaDeployTasks.value.filter(task => task.status === 'failed').length,
	none: 0,
}))
const esaHttpsEnabled = computed(() => esaHttpsBasic.value.some(item => item.config_type === 'global' && item.https === 'on') || esaHttpsBasic.value.some(item => item.https === 'on'))
const esaTlsSummary = computed(() => {
	const globalConfig = esaHttpsBasic.value.find(item => item.config_type === 'global') || esaHttpsBasic.value[0]
	if (!globalConfig) return pub.lang('暂无 HTTPS 基础配置信息')
	const protocols = [['tls10', 'TLS 1.0'], ['tls11', 'TLS 1.1'], ['tls12', 'TLS 1.2'], ['tls13', 'TLS 1.3']]
		.filter(([field]) => globalConfig[field as keyof EsaHttpsBasic] === 'on')
		.map(([, label]) => label)
	const extras = [globalConfig.http2 === 'on' && 'HTTP/2', globalConfig.http3 === 'on' && 'HTTP/3'].filter(Boolean)
	return [...protocols, ...extras].join(' · ') || pub.lang('未启用 TLS 协议')
})

const cdnDomains = ref<CdnDomain[]>([])
const cdnViewMode = ref<'analytics' | 'domains'>('analytics')
const cdnLoading = ref(false)
const cdnLoaded = ref(false)
const cdnPage = ref(1)
const cdnTotal = ref(0)
const cdnQuery = reactive({ keyword: '', status: 'all' })
const cdnStatuses = ['online', 'offline', 'configuring', 'configure_failed', 'checking', 'check_failed', 'stopping', 'deleting']
const selectedCdnDomains = ref<CdnDomain[]>([])
const cdnBatchLoading = ref(false)
const cdnBatchDeleteBlocked = computed(() => selectedCdnDomains.value.some(domain => domain.status !== 'offline'))
const cdnBatchDeleteDisabledTip = computed(() => cdnBatchDeleteBlocked.value ? pub.lang('选中项中包含未停用域名，请先停用后再删除') : '')
const cdnDomainDialogVisible = ref(false)
const cdnDomainSaving = ref(false)
const cdnDomainFormRef = ref<FormInstance>()
const cdnDomainForm = reactive<{ domain_name: string; sources: CdnSource[] }>({ domain_name: '', sources: [] })
const cdnDomainRules = computed<FormRules>(() => ({
	sources: [{ validator: (_rule, value: CdnSource[], callback) => value?.length && value.every(source => source.type && source.content.trim() && Number.isInteger(source.port) && source.port >= 1 && source.port <= 65535) ? callback() : callback(new Error(pub.lang('请填写完整且有效的源站信息'))), trigger: 'change' }],
}))
const cdnLogVisible = ref(false)
const cdnLogLoading = ref(false)
const cdnLogDomain = ref('')
const cdnOperationLogs = ref<CdnOperationLog[]>([])
const cdnLogPage = ref(1)
const cdnLogNextToken = ref('')
const cdnLogTokens = ref<string[]>([''])
const cdnDomainOptions = computed(() => cdnDomains.value.map(domain => domain.domain_name))

const ossBuckets = ref<OssBucket[]>([])
const ossCandidates = ref<OssBucket[]>([])
const ossLoading = ref(false)
const ossCandidateLoading = ref(false)
const ossLoaded = ref(false)
const ossKeyword = ref('')
const ossPage = ref(1)
const ossTotal = ref(0)
const ossBucketDialogVisible = ref(false)
const ossBucketSaving = ref(false)
const ossBucketFormRef = ref<FormInstance>()
const ossBucketForm = reactive({ name: '', region: 'oss-cn-hangzhou', storage_class: 'Standard', acl: 'private' })
const ossBucketRules = computed<FormRules>(() => ({
	name: [{ pattern: /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, message: pub.lang('Bucket 名称必须为 3–63 位小写字母、数字或中划线'), trigger: 'blur' }],
	region: [{ pattern: /^oss-[a-z0-9-]+$/, message: pub.lang('请输入正确的 OSS 地域'), trigger: 'change' }],
}))
const ossRegions = computed(() => Array.from(new Set(['oss-cn-hangzhou', 'oss-cn-shanghai', 'oss-cn-beijing', 'oss-cn-shenzhen', 'oss-cn-hongkong', ...ossCandidates.value.map(item => item.region)])))

const loadAccount = async () => {
	accountLoading.value = true
	try {
		const result = await request(routes.aliyun.find.path, { account_id: accountId })
		if (!result?.status) return Message.request(result)
		account.value = result.data
	} finally { accountLoading.value = false }
}
const setResourceStatus = (key: ResourceStatusKey, status: string) => {
	if (!account.value) return
	account.value.resource_status ||= {}
	account.value.resource_status[key] = status
}
const applyResourceErrorStatus = (key: ResourceStatusKey, result: any) => {
	if (result?.data?.status) setResourceStatus(key, result.data.status)
}
const loadOssBuckets = async (page = ossPage.value, candidateOnly = false) => {
	if (candidateOnly) ossCandidateLoading.value = true
	else ossLoading.value = true
	try {
		const result = await request(routes.aliyun.oss_bucket_list.path, {
			account_id: accountId,
			page: candidateOnly ? 1 : page,
			page_size: candidateOnly ? 100 : 20,
			keyword: candidateOnly ? '' : ossKeyword.value,
			include_stat: !candidateOnly,
		})
		if (!result?.status) {
			applyResourceErrorStatus('oss', result)
			return Message.request(result)
		}
		setResourceStatus('oss', 'active')
		if (candidateOnly) ossCandidates.value = result.data.data || []
		else {
			ossPage.value = page
			ossBuckets.value = result.data.data || []
			ossTotal.value = result.data.total || 0
			ossLoaded.value = true
			if (account.value && !ossKeyword.value.trim()) account.value.oss_count = ossTotal.value
			if (!ossCandidates.value.length) ossCandidates.value = result.data.data || []
		}
	} finally {
		if (candidateOnly) ossCandidateLoading.value = false
		else ossLoading.value = false
	}
}
const ensureOssCandidates = () => ossCandidates.value.length ? Promise.resolve() : loadOssBuckets(1, true)
const getOssCandidate = (name: string) => ossCandidates.value.find(item => item.name === name)
const selectRecordOssBucket = (name: string) => {
	const bucket = getOssCandidate(name)
	if (!bucket) return
	recordForm.type = 'CNAME'
	recordForm.value = bucket.endpoint
}
const selectEsaOssBucket = (name: string) => {
	const bucket = getOssCandidate(name)
	if (bucket) esaRecordForm.value = bucket.endpoint
}
const handleEsaSourceTypeChange = () => {
	if (esaRecordForm.source_type !== 'OSS') esaOssBucket.value = ''
	else ensureOssCandidates()
}
const openOssBucketDialog = () => {
	Object.assign(ossBucketForm, { name: '', region: 'oss-cn-hangzhou', storage_class: 'Standard', acl: 'private' })
	ossBucketFormRef.value?.clearValidate()
	ossBucketDialogVisible.value = true
}
const saveOssBucket = async () => {
	if (!ossBucketFormRef.value || !await ossBucketFormRef.value.validate().catch(() => false)) return
	ossBucketSaving.value = true
	try {
		const result = await request(routes.aliyun.oss_bucket_create.path, { account_id: accountId, ...ossBucketForm })
		Message.request(result)
		if (!result?.status) return
		ossBucketDialogVisible.value = false
		ossCandidates.value = []
		await loadOssBuckets(1)
	} finally { ossBucketSaving.value = false }
}
const removeOssBucket = async (bucket: OssBucket) => {
	try { await ElMessageBox.confirm(pub.lang(`确定删除 Bucket ${bucket.name} 吗？Bucket 必须为空。`), pub.lang('删除 OSS Bucket'), { type: 'warning' }) }
	catch { return }
	const result = await request(routes.aliyun.oss_bucket_delete.path, { account_id: accountId, bucket: bucket.name, region: bucket.region })
	Message.request(result)
	if (!result?.status) return
	ossCandidates.value = []
	await loadOssBuckets(Math.min(ossPage.value, Math.max(1, Math.ceil(Math.max(0, ossTotal.value - 1) / 20))))
}
const handleOssBucketCommand = (command: string, bucket: OssBucket) => {
	if (command === 'delete') removeOssBucket(bucket)
}
const copyOssEndpoint = (endpoint: string) => copyText({ value: endpoint, success: pub.lang('Endpoint 复制成功') })
const openOssObjects = (bucket: OssBucket) => {
	router.push({
		path: `/aliyun/${accountId}/oss/${encodeURIComponent(bucket.name)}`,
		query: { region: bucket.region },
	})
}
const refreshSummary = async () => {
	summaryRefreshing.value = true
	try {
		const result = await request(routes.aliyun.refresh_account_summary.path, { account_id: accountId, force: true })
		Message.request(result)
		if (result?.status) account.value = result.data
	} finally { summaryRefreshing.value = false }
}
const refreshBalance = async () => {
	if (!account.value || balanceRefreshing.value) return
	balanceRefreshing.value = true
	try {
		const result = await request(routes.aliyun.refresh_balance.path, { account_id: accountId })
		if (!result?.status) {
			applyResourceErrorStatus('balance', result)
			return Message.request(result)
		}
		account.value.balance = result.data.balance
		account.value.balance_currency = result.data.balance_currency
		account.value.balance_refresh_time = result.data.balance_refresh_time
		setResourceStatus('balance', 'active')
		Message.success(pub.lang('余额已刷新'))
	} finally { balanceRefreshing.value = false }
}
const loadServers = async (force = false) => {
	serverLoading.value = true
	try {
		const result = await request(routes.aliyun.server_list.path, { account_id: accountId, force })
		if (!result?.status) {
			applyResourceErrorStatus('server', result)
			return Message.request(result)
		}
		servers.value = result.data.data || []
		serverPartial.value = !!result.data.partial
		setResourceStatus('server', serverPartial.value ? 'partial' : 'active')
		if (account.value && result.data.count_complete !== false) account.value.server_count = servers.value.length
		serverLoaded.value = true
	} finally { serverLoading.value = false }
}
const openServer = async (server: CloudServer) => {
	openingServerId.value = server.instance_id
	try {
		if (server.source === 'swas') {
			const result = await request(routes.aliyun.open_swas_workbench.path, { account_id: accountId, instance_id: server.instance_id, region_id: server.region_id })
			Message.request(result)
			return
		}
		const result = await request(routes.aliyun.open_terminal.path, { account_id: accountId, instance_id: server.instance_id, region_id: server.region_id, title: server.name })
		if (!result?.status) return Message.request(result)
		xtermStore.queueLaunch(result.data)
		await router.push('/xterm')
	} finally { openingServerId.value = '' }
}

const loadDomains = async (page = domainPage.value) => {
	domainPage.value = page
	domainLoading.value = true
	try {
		const result = await request(routes.aliyun.domain_list.path, { account_id: accountId, page, page_size: 30, keyword: domainKeyword.value })
		if (!result?.status) {
			applyResourceErrorStatus('domain', result)
			return Message.request(result)
		}
		setResourceStatus('domain', 'active')
		domains.value = result.data.data || []
		domainTotal.value = result.data.total || 0
		if (account.value && !domainKeyword.value.trim()) account.value.domain_count = domainTotal.value
		domainLoaded.value = true
		if (!selectedDomain.value || !domains.value.some(item => item.domain_name === selectedDomain.value?.domain_name)) {
			selectedDomain.value = domains.value[0]
			if (selectedDomain.value) await selectDomain(selectedDomain.value)
		}
	} finally { domainLoading.value = false }
}
const loadEsaSites = async (page = esaPage.value) => {
	esaPage.value = page
	esaLoading.value = true
	try {
		const result = await request(routes.aliyun.esa_site_list.path, {
			account_id: accountId,
			page,
			page_size: 50,
			keyword: esaQuery.keyword,
			status: esaQuery.status,
		})
		if (!result?.status) {
			applyResourceErrorStatus('esa', result)
			return Message.request(result)
		}
		setResourceStatus('esa', 'active')
		esaSites.value = result.data.data || []
		esaTotal.value = result.data.total || 0
		if (account.value && !esaQuery.keyword.trim() && (!esaQuery.status || esaQuery.status === 'all')) account.value.esa_count = esaTotal.value
		esaLoaded.value = true
		const targetId = pendingEsaSiteId.value
		const currentId = selectedEsaSite.value?.site_id
		const nextSite = esaSites.value.find(item => item.site_id === targetId)
			|| esaSites.value.find(item => item.site_id === currentId)
			|| esaSites.value[0]
		pendingEsaSiteId.value = ''
		if (nextSite && nextSite.site_id !== currentId) await selectEsaSite(nextSite)
		if (!nextSite) {
			selectedEsaSite.value = undefined
			esaDetail.value = undefined
		}
	} finally { esaLoading.value = false }
}
const loadEsaSiteDetail = async (siteId = selectedEsaSite.value?.site_id) => {
	if (!siteId) return
	esaDetailLoading.value = true
	try {
		const result = await request(routes.aliyun.esa_site_detail.path, { account_id: accountId, site_id: siteId })
		if (!result?.status) {
			applyResourceErrorStatus('esa', result)
			return Message.request(result)
		}
		if (selectedEsaSite.value?.site_id === siteId) esaDetail.value = result.data
	} finally { esaDetailLoading.value = false }
}
const loadEsaRecords = async (page = esaRecordPage.value) => {
	const siteId = selectedEsaSite.value?.site_id
	if (!siteId) return
	esaRecordPage.value = page
	esaRecordLoading.value = true
	try {
		const result = await request(routes.aliyun.esa_record_list.path, {
			account_id: accountId,
			site_id: siteId,
			page,
			page_size: esaRecordPageSize.value,
			keyword: esaRecordKeyword.value,
			type: esaRecordType.value,
		})
		if (!result?.status) return Message.request(result)
		if (selectedEsaSite.value?.site_id !== siteId) return
		esaRecords.value = result.data.data || []
		esaRecordTotal.value = result.data.total || 0
		esaRecordLoaded.value = true
	} finally { esaRecordLoading.value = false }
}
const loadEsaOrigins = async () => {
	const siteId = selectedEsaSite.value?.site_id
	if (!siteId) return
	esaOriginLoading.value = true
	try {
		const result = await request(routes.aliyun.esa_origin_list.path, { account_id: accountId, site_id: siteId })
		if (!result?.status) return Message.request(result)
		if (selectedEsaSite.value?.site_id !== siteId) return
		esaOrigins.pools = result.data.pools || []
		esaOrigins.rules = result.data.rules || []
		esaOrigins.partial = !!result.data.partial
		esaOrigins.errors = result.data.errors || []
		esaOriginLoaded.value = true
	} finally { esaOriginLoading.value = false }
}
const loadEsaCertificates = async (page = esaCertificatePage.value) => {
	const siteId = selectedEsaSite.value?.site_id
	if (!siteId) return
	esaCertificatePage.value = page
	esaCertificateLoading.value = true
	try {
		const result = await request(routes.aliyun.esa_certificate_list.path, {
			account_id: accountId,
			site_id: siteId,
		})
		if (!result?.status) return Message.request(result)
		if (selectedEsaSite.value?.site_id !== siteId) return
		esaCertificateRecords.value = result.data.records || []
		esaHttpsBasic.value = result.data.https_basic || []
		esaHttpsApplication.value = result.data.https_application || []
		esaCertificatePartial.value = !!result.data.partial
		esaCertificateTotal.value = result.data.total || 0
		esaCertificateLoaded.value = true
	} finally { esaCertificateLoading.value = false }
}
const loadEsaDeployTasks = async (silent = false) => {
	const siteId = selectedEsaSite.value?.site_id
	if (!siteId) return
	const previousCompleted = new Set(esaDeployTasks.value.filter(task => task.status === 'completed').map(task => task.task_id))
	const result = await request(routes.ssl.esa_apply_list.path, { account_id: accountId, site_id: siteId })
	if (!result?.status) {
		if (!silent) Message.request(result)
		return
	}
	if (selectedEsaSite.value?.site_id !== siteId) return
	esaDeployTasks.value = result.data || []
	if (silent && esaDeployTasks.value.some(task => task.status === 'completed' && !previousCompleted.has(task.task_id))) {
		await loadEsaCertificates(1)
	}
}
const refreshEsaCertificates = () => Promise.all([loadEsaCertificates(esaCertificatePage.value), loadEsaDeployTasks()])
const loadEsaApplyMeta = async () => {
	esaApplyMeta.value = undefined
	esaCertificateApplyForm.brand = ''
	if (!esaCertificateApplyForm.channel_id) return
	esaApplyMetaLoading.value = true
	try {
		const result = await request(routes.ssl.meta.path, { channel_id: esaCertificateApplyForm.channel_id })
		if (!result?.status) return Message.request(result)
		esaApplyMeta.value = result.data
		esaCertificateApplyForm.days = result.data.fixed_days || 90
		esaCertificateApplyForm.brand = result.data.brands?.[0]?.key || ''
		if (!result.data.validate_methods?.some((method: { key: string }) => method.key === 'dns')) {
			Message.error(pub.lang('当前渠道不支持 DNS 自动验证'))
		}
	} finally { esaApplyMetaLoading.value = false }
}
const openEsaCertificateApplyDialog = async () => {
	if (!selectedEsaSite.value) return
	esaCertificateApplyVisible.value = true
	esaCertificateApplyForm.certificate_type = 'single'
	esaCertificateApplyForm.domain_prefix = ''
	sslChannelLoading.value = true
	try {
		const result = await request(routes.ssl.channel_list.path, { enabled_only: true })
		if (!result?.status) return Message.request(result)
		sslChannels.value = result.data || []
		if (!enabledSslChannels.value.length) return Message.warn(pub.lang('请先在工具箱中添加并启用证书申请渠道'))
		esaCertificateApplyForm.channel_id = enabledSslChannels.value[0].channel_id
		await loadEsaApplyMeta()
	} finally { sslChannelLoading.value = false }
}
const submitEsaCertificateApply = async () => {
	if (!selectedEsaSite.value || !esaCertificateApplyFormRef.value) return
	normalizeEsaCertificateDomainInput()
	await esaCertificateApplyFormRef.value.validate()
	if (!esaApplyMeta.value?.validate_methods?.some(method => method.key === 'dns')) return Message.error(pub.lang('当前渠道不支持 DNS 自动验证'))
	esaCertificateApplying.value = true
	try {
		const result = await request(routes.ssl.esa_apply_create.path, {
			account_id: accountId,
			site_id: selectedEsaSite.value.site_id,
			site_name: esaSiteName.value,
			channel_id: esaCertificateApplyForm.channel_id,
			domain: esaApplyFullDomain.value,
			brand: esaCertificateApplyForm.brand,
			days: esaCertificateApplyForm.days,
		})
		if (!result?.status) return Message.request(result)
		esaCertificateApplyVisible.value = false
		Message.success(pub.lang('证书申请已提交，DNS 验证记录已自动写入'))
		await Promise.all([loadEsaDeployTasks(), loadEsaRecords(1)])
	} finally { esaCertificateApplying.value = false }
}
const retryEsaDeployTask = async (task: EsaDeployTask) => {
	esaDeployRetryingId.value = task.task_id
	try {
		const result = await request(routes.ssl.esa_apply_retry.path, { task_id: task.task_id })
		Message.request(result)
		if (result?.status) await loadEsaDeployTasks()
	} finally { esaDeployRetryingId.value = 0 }
}
const selectEsaSite = async (site: EsaSite) => {
	selectedEsaSite.value = site
	esaDetail.value = undefined
	esaDetailTab.value = 'analytics'
	esaRecords.value = []
	esaRecordKeyword.value = ''
	esaRecordType.value = 'all'
	esaRecordPage.value = 1
	esaRecordTotal.value = 0
	esaRecordLoaded.value = false
	esaOrigins.pools = []
	esaOrigins.rules = []
	esaOrigins.partial = false
	esaOrigins.errors = []
	esaOriginLoaded.value = false
	esaCertificateRecords.value = []
	esaHttpsBasic.value = []
	esaHttpsApplication.value = []
	esaCertificatePartial.value = false
	esaCertificatePage.value = 1
	esaCertificateTotal.value = 0
	esaCertificateLoaded.value = false
	esaDeployTasks.value = []
	await Promise.all([loadEsaSiteDetail(site.site_id), loadEsaRecords(1)])
}
const handleEsaDetailTabChange = (name: string | number) => {
	if (name === 'records' && !esaRecordLoaded.value) loadEsaRecords(1)
	if (name === 'origins' && !esaOriginLoaded.value) loadEsaOrigins()
	if (name === 'certificates' && !esaCertificateLoaded.value) Promise.all([loadEsaCertificates(1), loadEsaDeployTasks()])
}
const loadCdnDomains = async (page = cdnPage.value) => {
	cdnPage.value = page
	cdnLoading.value = true
	try {
		const result = await request(routes.aliyun.cdn_domain_list.path, {
			account_id: accountId,
			page,
			page_size: 50,
			keyword: cdnQuery.keyword,
			status: cdnQuery.status,
		})
		if (!result?.status) {
			applyResourceErrorStatus('cdn', result)
			return Message.request(result)
		}
		cdnDomains.value = result.data.data || []
		cdnTotal.value = result.data.total || 0
		if (account.value) {
			if (!cdnQuery.keyword.trim() && (!cdnQuery.status || cdnQuery.status === 'all')) account.value.cdn_count = cdnTotal.value
			if (result.data.status) {
				account.value.cdn_status = result.data.status
				setResourceStatus('cdn', result.data.status)
			}
		}
		cdnLoaded.value = true
	} finally { cdnLoading.value = false }
}
const createCdnSource = (): CdnSource => ({ type: 'ipaddr', content: '', port: 80, priority: 20, weight: 10 })
const openCdnDomainDialog = (domain: CdnDomain) => {
	cdnDomainForm.domain_name = domain.domain_name
	cdnDomainForm.sources = domain.sources.length ? domain.sources.map(source => ({ ...source })) : [createCdnSource()]
	cdnDomainDialogVisible.value = true
	if (cdnDomainForm.sources.some(source => source.type === 'oss')) ensureOssCandidates()
}
const handleCdnSourceTypeChange = (source: CdnSource) => {
	source.content = ''
	if (source.type === 'oss') ensureOssCandidates()
}
const addCdnSource = () => cdnDomainForm.sources.push(createCdnSource())
const removeCdnSource = (index: number) => {
	if (cdnDomainForm.sources.length > 1) cdnDomainForm.sources.splice(index, 1)
}
const saveCdnDomain = async () => {
	if (!cdnDomainFormRef.value || !await cdnDomainFormRef.value.validate().catch(() => false)) return
	cdnDomainSaving.value = true
	try {
		const result = await request(routes.aliyun.cdn_domain_update.path, { account_id: accountId, domain_name: cdnDomainForm.domain_name, sources: cdnDomainForm.sources })
		Message.request(result)
		if (!result?.status) return
		cdnDomainDialogVisible.value = false
		await loadCdnDomains(cdnPage.value)
	} finally { cdnDomainSaving.value = false }
}
const removeCdnDomain = async (domain: CdnDomain) => {
	if (domain.status !== 'offline') return Message.warn(pub.lang('运行中的 CDN 域名不能删除，请先停用'))
	try {
		await ElMessageBox.confirm(pub.lang(`确定删除 CDN 域名 ${domain.domain_name} 吗？删除后将停止 CDN 服务。`), pub.lang('删除 CDN 域名'), { type: 'warning' })
	} catch { return }
	const result = await request(routes.aliyun.cdn_domain_delete.path, { account_id: accountId, domain_name: domain.domain_name })
	Message.request(result)
	if (!result?.status) return
	await loadCdnDomains(Math.min(cdnPage.value, Math.max(1, Math.ceil(Math.max(0, cdnTotal.value - 1) / 50))))
}
const batchCdnDomainAction = async (action: 'start' | 'stop' | 'delete') => {
	if (!selectedCdnDomains.value.length) return
	if (action === 'delete' && cdnBatchDeleteBlocked.value) return Message.warn(pub.lang('选中项中包含未停用域名，请先停用后再删除'))
	const domains = action === 'start'
		? selectedCdnDomains.value.filter(domain => domain.status !== 'online')
		: action === 'stop'
			? selectedCdnDomains.value.filter(domain => domain.status === 'online')
			: selectedCdnDomains.value
	if (!domains.length) return Message.warn(pub.lang(action === 'start' ? '选中的域名均已启用' : '选中的域名均未启用'))
	if (action === 'delete') {
		try {
			await ElMessageBox.confirm(pub.lang(`确定删除选中的 ${domains.length} 个 CDN 域名吗？该操作不可恢复。`), pub.lang('批量删除 CDN 域名'), { type: 'warning' })
		} catch { return }
	}
	cdnBatchLoading.value = true
	try {
		const result = await request(routes.aliyun.cdn_domain_batch_action.path, { account_id: accountId, domain_names: domains.map(domain => domain.domain_name), action })
		if (!result?.status) return Message.request(result)
		showBatchResult(result.data, action === 'start' ? pub.lang('启用') : action === 'stop' ? pub.lang('停用') : pub.lang('删除'), pub.lang('个 CDN 域名'))
		selectedCdnDomains.value = []
		const remainingTotal = action === 'delete' ? Math.max(0, cdnTotal.value - result.data.success_count) : cdnTotal.value
		await loadCdnDomains(Math.min(cdnPage.value, Math.max(1, Math.ceil(remainingTotal / 50))))
	} finally { cdnBatchLoading.value = false }
}
const loadCdnOperationLogs = async (page = cdnLogPage.value) => {
	cdnLogPage.value = page
	cdnLogLoading.value = true
	try {
		const result = await request(routes.aliyun.cdn_operation_logs.path, {
			account_id: accountId,
			domain_name: cdnLogDomain.value,
			page_size: 20,
			next_token: cdnLogTokens.value[page - 1] || '',
		})
		if (!result?.status) return Message.request(result)
		cdnOperationLogs.value = result.data.data || []
		cdnLogNextToken.value = result.data.next_token || ''
		if (cdnLogNextToken.value) cdnLogTokens.value[page] = cdnLogNextToken.value
	} finally { cdnLogLoading.value = false }
}
const reloadCdnOperationLogs = () => {
	cdnLogTokens.value = ['']
	cdnLogNextToken.value = ''
	loadCdnOperationLogs(1)
}
const openCdnOperationLogs = () => {
	cdnLogDomain.value = ''
	cdnLogVisible.value = true
	reloadCdnOperationLogs()
}
const previousCdnLogPage = () => cdnLogPage.value > 1 && loadCdnOperationLogs(cdnLogPage.value - 1)
const nextCdnLogPage = () => cdnLogNextToken.value && loadCdnOperationLogs(cdnLogPage.value + 1)
const selectDomain = async (domain: DomainItem) => {
	selectedDomain.value = domain
	selectedDomainInfo.value = undefined
	records.value = []
	recordTotal.value = 0
	recordKeyword.value = ''
	recordType.value = 'all'
	recordPage.value = 1
	domainInfoLoading.value = true
	try {
		const result = await request(routes.aliyun.domain_info.path, { account_id: accountId, domain_name: domain.domain_name })
		if (!result?.status) return Message.request(result)
		if (selectedDomain.value?.domain_name !== domain.domain_name) return
		selectedDomainInfo.value = result.data
		if (result.data.dns_provider === 'alidns') await Promise.all([loadRecords(1), loadRecordLines()])
	} finally { domainInfoLoading.value = false }
}
const openSelectedDomainInEsa = () => {
	if (!selectedDomain.value || !domainCanOpenEsa.value) return
	esaQuery.keyword = selectedDomain.value.domain_name
	esaQuery.status = 'all'
	pendingEsaSiteId.value = selectedDomainInfo.value?.esa_site_id || ''
	esaLoaded.value = false
	switchResourceTab('esa')
}
const loadRecords = async (page = recordPage.value) => {
	if (!selectedDomain.value) return
	recordPage.value = page
	recordLoading.value = true
	try {
		const result = await request(routes.aliyun.record_list.path, { account_id: accountId, domain_name: selectedDomain.value.domain_name, page, page_size: recordPageSize.value, keyword: recordKeyword.value, type: recordType.value })
		if (!result?.status) return Message.request(result)
		records.value = result.data.data || []
		recordTotal.value = result.data.total || 0
	} finally { recordLoading.value = false }
}
const loadRecordLines = async () => {
	if (!selectedDomain.value) return
	const result = await request(routes.aliyun.record_lines.path, { account_id: accountId, domain_name: selectedDomain.value.domain_name })
	if (result?.status && result.data?.length) recordLines.value = result.data
}
const loadRecordLogs = async (page = recordLogPage.value) => {
	if (!selectedDomain.value) return
	recordLogPage.value = page
	recordLogLoading.value = true
	try {
		const result = await request(routes.aliyun.record_logs.path, {
			account_id: accountId,
			domain_name: selectedDomain.value.domain_name,
			page,
			page_size: 20,
			keyword: recordLogKeyword.value,
		})
		if (!result?.status) return Message.request(result)
		recordLogs.value = result.data.data || []
		recordLogTotal.value = result.data.total || 0
	} finally { recordLogLoading.value = false }
}
const openRecordLogs = () => {
	recordLogKeyword.value = ''
	recordLogPage.value = 1
	recordLogVisible.value = true
	loadRecordLogs(1)
}
const openRecordDialog = (record?: RecordItem) => {
	resetRecordForm()
	if (record) Object.assign(recordForm, record)
	else { recordOssBucket.value = ''; ensureOssCandidates() }
	recordDialogVisible.value = true
}
const resetRecordForm = () => { Object.assign(recordForm, createRecordForm()); recordFormRef.value?.clearValidate() }
const saveRecord = async () => {
	if (!selectedDomain.value || !recordFormRef.value) return
	if (!await recordFormRef.value.validate().catch(() => false)) return
	recordSaving.value = true
	try {
		const path = recordForm.record_id ? routes.aliyun.record_update.path : routes.aliyun.record_add.path
		const result = await request(path, { account_id: accountId, domain_name: selectedDomain.value.domain_name, ...recordForm })
		Message.request(result)
		if (!result?.status) return
		recordDialogVisible.value = false
		await loadRecords(recordPage.value)
	} finally { recordSaving.value = false }
}
const changeRecordStatus = async (record: RecordItem) => {
	const status = record.status === 'Enable' ? 'Disable' : 'Enable'
	recordStatusLoadingId.value = record.record_id
	try {
		const result = await request(routes.aliyun.record_set_status.path, { account_id: accountId, record_id: record.record_id, status })
		Message.request(result)
		return !!result?.status
	} finally {
		recordStatusLoadingId.value = ''
	}
}
const removeRecord = async (record: RecordItem) => {
	try {
		await ElMessageBox.confirm(pub.lang('删除后该域名解析可能立即受影响，确定删除这条记录吗？'), pub.lang('删除解析记录'), { type: 'warning' })
	} catch { return }
	const result = await request(routes.aliyun.record_delete.path, { account_id: accountId, record_id: record.record_id })
	Message.request(result)
	if (result?.status) await loadRecords(recordPage.value)
}
const isRecordSelectable = (record: RecordItem) => !record.locked && domainRecordsWritable.value
const changeRecordPageSize = () => loadRecords(1)
const changeEsaRecordPageSize = () => loadEsaRecords(1)
const esaRecordEditable = (record: EsaRecord) => esaEditableRecordTypes.includes(record.type)
const esaRecordCanProxy = (record: EsaRecord) => ['A/AAAA', 'CNAME'].includes(record.type)
const resetEsaRecordForm = () => {
	Object.assign(esaRecordForm, createEsaRecordForm())
	esaRecordFormRef.value?.clearValidate()
}
const handleEsaRecordTypeChange = () => {
	if (!esaRecordProxySupported.value) esaRecordForm.proxied = false
}
const openEsaRecordDialog = (record?: EsaRecord) => {
	resetEsaRecordForm()
	if (record) Object.assign(esaRecordForm, {
		record_id: record.record_id,
		record_name: record.record_name === esaSiteName.value
			? '@'
			: record.record_name.replace(new RegExp(`\\.${esaSiteName.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), ''),
		type: record.type,
		value: record.value,
		ttl: record.ttl || 300,
		proxied: record.proxied,
		priority: record.priority,
		weight: record.weight,
		port: record.port,
		flag: record.flag,
		tag: record.tag || 'issue',
		source_type: record.source_type || 'Domain',
		host_policy: record.host_policy || 'follow_hostname',
		comment: record.comment || '',
	})
	if (!record) { esaOssBucket.value = ''; ensureOssCandidates() }
	else if (esaRecordForm.source_type === 'OSS') ensureOssCandidates()
	esaRecordDialogVisible.value = true
}
const saveEsaRecord = async () => {
	if (!selectedEsaSite.value || !esaRecordFormRef.value) return
	if (!await esaRecordFormRef.value.validate().catch(() => false)) return
	esaRecordSaving.value = true
	try {
		const path = esaRecordForm.record_id ? routes.aliyun.esa_record_update.path : routes.aliyun.esa_record_add.path
		const result = await request(path, { account_id: accountId, site_id: selectedEsaSite.value.site_id, site_name: esaSiteName.value, ...esaRecordForm, record_name: esaFullRecordName() })
		Message.request(result)
		if (!result?.status) return
		esaRecordDialogVisible.value = false
		await loadEsaRecords(esaRecordForm.record_id ? esaRecordPage.value : 1)
	} finally { esaRecordSaving.value = false }
}
const removeEsaRecord = async (record: EsaRecord) => {
	try {
		await ElMessageBox.confirm(pub.lang('删除后该域名解析可能立即受影响，确定删除这条 ESA 解析记录吗？'), pub.lang('删除 ESA 解析记录'), { type: 'warning' })
	} catch { return }
	const result = await request(routes.aliyun.esa_record_delete.path, { account_id: accountId, record_id: record.record_id })
	Message.request(result)
	if (!result?.status) return
	const remainingTotal = Math.max(0, esaRecordTotal.value - 1)
	await loadEsaRecords(Math.min(esaRecordPage.value, Math.max(1, Math.ceil(remainingTotal / esaRecordPageSize.value))))
}
const changeEsaRecordProxy = async (record: EsaRecord) => {
	esaProxyLoadingId.value = record.record_id
	try {
		const result = await request(routes.aliyun.esa_record_set_proxy.path, { account_id: accountId, record_id: record.record_id, proxied: !record.proxied })
		Message.request(result)
		return !!result?.status
	} finally { esaProxyLoadingId.value = '' }
}
const showBatchResult = (result: { success_count: number; failure_count: number }, actionName: string, unit = pub.lang('条解析记录')) => {
	if (result.failure_count) Message.warn(pub.lang(`${actionName}成功 ${result.success_count} ${unit}，失败 ${result.failure_count} ${unit}`))
	else Message.success(pub.lang(`已${actionName} ${result.success_count} ${unit}`))
}
const batchRecordAction = async (action: 'disable' | 'delete') => {
	const recordsToChange = selectedRecords.value.filter(record => !record.locked)
	if (!recordsToChange.length) return
	if (action === 'delete') {
		try {
			await ElMessageBox.confirm(pub.lang(`确定删除选中的 ${recordsToChange.length} 条解析记录吗？删除后可能立即影响域名访问。`), pub.lang('批量删除解析'), { type: 'warning' })
		} catch { return }
	}
	recordBatchLoading.value = true
	try {
		const result = await request(routes.aliyun.record_batch_action.path, { account_id: accountId, record_ids: recordsToChange.map(record => record.record_id), action })
		if (!result?.status) return Message.request(result)
		showBatchResult(result.data, action === 'delete' ? pub.lang('删除') : pub.lang('暂停'))
		selectedRecords.value = []
		const remainingTotal = action === 'delete' ? Math.max(0, recordTotal.value - result.data.success_count) : recordTotal.value
		const targetPage = Math.min(recordPage.value, Math.max(1, Math.ceil(remainingTotal / recordPageSize.value)))
		await loadRecords(targetPage)
	} finally { recordBatchLoading.value = false }
}
const batchEsaRecordAction = async (action: 'disable_proxy' | 'delete') => {
	if (!selectedEsaRecords.value.length) return
	if (action === 'delete') {
		try {
			await ElMessageBox.confirm(pub.lang(`确定删除选中的 ${selectedEsaRecords.value.length} 条 ESA 解析记录吗？删除后可能立即影响域名访问。`), pub.lang('批量删除 ESA 解析'), { type: 'warning' })
		} catch { return }
	}
	esaRecordBatchLoading.value = true
	try {
		const result = await request(routes.aliyun.esa_record_batch_action.path, { account_id: accountId, record_ids: selectedEsaRecords.value.map(record => record.record_id), action })
		if (!result?.status) return Message.request(result)
		showBatchResult(result.data, action === 'delete' ? pub.lang('删除') : pub.lang('关闭代理'))
		selectedEsaRecords.value = []
		const remainingTotal = action === 'delete' ? Math.max(0, esaRecordTotal.value - result.data.success_count) : esaRecordTotal.value
		const targetPage = Math.min(esaRecordPage.value, Math.max(1, Math.ceil(remainingTotal / esaRecordPageSize.value)))
		await loadEsaRecords(targetPage)
	} finally { esaRecordBatchLoading.value = false }
}
const handleTabChange = (name: string | number) => {
	if (route.query.tab !== name) router.replace({ query: { ...route.query, tab: String(name) } })
	updateResourceIndicator()
	if (name === 'servers' && !serverLoaded.value) loadServers()
	if (name === 'domains' && !domainLoaded.value) loadDomains(1)
	if (name === 'esa' && !esaLoaded.value) loadEsaSites(1)
	if (name === 'cdn' && !cdnLoaded.value) loadCdnDomains(1)
	if (name === 'oss' && !ossLoaded.value) loadOssBuckets(1)
}

const lineName = (code: string) => recordLines.value.find(item => item.code === code)?.name || code
const maskAccessKey = (value: string) => value ? `${value.slice(0, 5)}****${value.slice(-4)}` : '--'
const formatCount = (value?: number) => Number(value) >= 0 ? Number(value) : '--'
const formatBalance = (value?: string, currency = 'CNY') => value === '' || value === undefined ? pub.lang('待获取') : `${currency === 'CNY' ? '¥' : currency} ${value}`
const formatTime = (time: number) => new Date(time * 1000).toLocaleString()
const formatDate = (value: string) => safeFormatDate(value)
const formatExpireDate = (value: string) => new Date(value).toLocaleDateString()
const serverStatusName = (status: string) => ({ Running: pub.lang('运行中'), Stopped: pub.lang('已停止'), Starting: pub.lang('启动中'), Stopping: pub.lang('停止中') }[status] || status || '--')
const serverStatusType = (status: string) => status === 'Running' ? 'success' : ['Starting', 'Stopping'].includes(status) ? 'warning' : 'info'
const coverageName = (coverage: string) => ({ domestic: pub.lang('中国大陆'), global: pub.lang('全球'), overseas: pub.lang('全球（不含中国大陆）') }[coverage] || coverage || '--')
const accessTypeName = (accessType: string) => ({ NS: pub.lang('NS 接入'), CNAME: pub.lang('CNAME 接入'), ns: pub.lang('NS 接入'), cname: pub.lang('CNAME 接入') }[accessType] || accessType || '--')
const normalizeDisplayList = (value?: string | string[]) => Array.isArray(value) ? value.filter(Boolean).join(' · ') : String(value || '').replace(/[,;\s]+/g, ' · ')
const safeFormatDate = (value?: string | number) => {
	if (!value) return '--'
	const time = new Date(value)
	return Number.isNaN(time.getTime()) ? value : time.toLocaleString()
}
const domainExpirationIsUrgent = (domain: DomainItem) => domain.expiration_days !== null && domain.expiration_days <= 30
const domainExpireText = (domain: DomainItem) => domain.expiration_date
	? `${pub.lang('到期')} ${new Date(domain.expiration_date).toLocaleDateString()}`
	: pub.lang('到期时间未知')
const booleanSettingName = (value: unknown) => ['true', 'on', 'enable', 'enabled', '1'].includes(String(value).toLowerCase()) ? pub.lang('开启') : ['false', 'off', 'disable', 'disabled', '0'].includes(String(value).toLowerCase()) ? pub.lang('关闭') : String(value || '--')
const originPorts = (rule: EsaOriginRule) => [rule.origin_http_port && `HTTP ${rule.origin_http_port}`, rule.origin_https_port && `HTTPS ${rule.origin_https_port}`].filter(Boolean).join(' / ') || '--'
const certificateRemainingDays = (certificate: EsaCertificate) => {
	const expiresAt = new Date(certificate.not_after).getTime()
	return Number.isFinite(expiresAt) ? Math.ceil((expiresAt - Date.now()) / 86400000) : null
}
const certificateStatusType = (certificate: EsaCertificate) => {
	const deployTask = (certificate as EsaCertificateGroup).deploy_task
	if (deployTask) return esaDeployStatusType(deployTask.status)
	const days = certificateRemainingDays(certificate)
	const status = String(certificate.status || '').toLowerCase()
	if ((days !== null && days < 0) || ['expired', 'applyfailed', 'failed'].includes(status)) return 'danger'
	if ((days !== null && days <= 30) || ['expiring', 'pending', 'applying'].includes(status)) return 'warning'
	if (['ok', 'issued', 'active', 'enabled', 'success'].includes(status)) return 'success'
	return 'info'
}
const esaDeployStatusName = (status: string) => ({
	creating: pub.lang('正在申请'),
	dns_created: pub.lang('DNS 已写入'),
	verifying: pub.lang('正在验证'),
	waiting_issue: pub.lang('等待签发'),
	uploading: pub.lang('正在上传'),
	completed: pub.lang('部署完成'),
	failed: pub.lang('部署失败'),
}[status] || status || '--')
const esaDeployStatusType = (status: string) => {
	if (status === 'completed') return 'success'
	if (status === 'failed') return 'danger'
	return 'warning'
}
const certificateStatusName = (certificate: EsaCertificate) => {
	const deployTask = (certificate as EsaCertificateGroup).deploy_task
	if (deployTask) return esaDeployStatusName(deployTask.status)
	const days = certificateRemainingDays(certificate)
	if (days !== null && days < 0) return pub.lang('已过期')
	if (days !== null && days <= 30) return pub.lang('即将过期')
	return ({ OK: pub.lang('正常'), Issued: pub.lang('已签发'), Active: pub.lang('正常'), Expired: pub.lang('已过期'), Expiring: pub.lang('即将过期'), ApplyFailed: pub.lang('申请失败') }[certificate.status] || certificate.status || pub.lang('未配置'))
}
const certificateRemainingText = (certificate: EsaCertificate) => {
	const days = certificateRemainingDays(certificate)
	if (days === null) return '--'
	if (days < 0) return pub.lang(`已过期 ${Math.abs(days)} 天`)
	return pub.lang(`剩余 ${days} 天`)
}
const certificateCoverageText = (certificate: EsaCertificateGroup) => {
	if (certificate.deploy_task) return certificate.deploy_task.domain
	const wildcard = [certificate.common_name, ...String(certificate.sans || '').split(',')].find(name => name.trim().startsWith('*.' ))?.trim()
	if (wildcard) return `${wildcard} · ${pub.lang(`覆盖 ${certificate.record_names.length} 条解析`)}`
	if (certificate.record_names.length === 1) return certificate.record_names[0]
	return pub.lang(`覆盖 ${certificate.record_names.length} 条解析`)
}
const cdnTypeName = (type: string) => ({ web: pub.lang('图片小文件'), download: pub.lang('大文件下载'), video: pub.lang('音视频点播') }[type] || type || '--')
const cdnAccessStatusName = (status: string) => ({
	connected: pub.lang('已接入'),
	not_connected: pub.lang('未接入'),
	timeout: pub.lang('检测超时'),
}[status] || pub.lang('未知'))
const cdnAccessStatusType = (status: string) => ({ connected: 'success', not_connected: 'danger', timeout: 'warning' }[status] || 'info')
const cdnOperationName = (name: string) => ({
	AddCdnDomain: pub.lang('添加 CDN 域名'),
	ModifyCdnDomain: pub.lang('修改源站'),
	BatchUpdateCdnDomain: pub.lang('批量修改源站'),
	StartCdnDomain: pub.lang('启用 CDN 域名'),
	BatchStartCdnDomain: pub.lang('批量启用 CDN 域名'),
	StopCdnDomain: pub.lang('停用 CDN 域名'),
	BatchStopCdnDomain: pub.lang('批量停用 CDN 域名'),
	DeleteCdnDomain: pub.lang('删除 CDN 域名'),
}[name] || name || '--')
const cloudStatusName = (status: string) => ({
	active: pub.lang('已启用'), pending: pub.lang('待配置'), moved: pub.lang('已迁移'),
	online: pub.lang('运行中'), offline: pub.lang('已停用'), configuring: pub.lang('配置中'),
	configure_failed: pub.lang('配置失败'), checking: pub.lang('审核中'), check_failed: pub.lang('审核失败'),
	stopping: pub.lang('停用中'), deleting: pub.lang('删除中'),
}[status] || status || '--')
const cloudStatusType = (status: string) => {
	if (['active', 'online'].includes(status)) return 'success'
	if (['pending', 'configuring', 'checking', 'stopping'].includes(status)) return 'warning'
	if (['offline', 'configure_failed', 'check_failed'].includes(status)) return 'danger'
	return 'info'
}
const errorDetailLoading = ref(false)
const showResourceErrorDetail = async () => {
	if (!account.value || errorDetailLoading.value) return
	errorDetailLoading.value = true
	try {
		const current = await request(routes.aliyun.find.path, { account_id: accountId })
		if (!current?.status) return Message.request(current)
		account.value = current.data
		if (account.value.resource_error && !account.value.resource_error_detail) {
			const result = await request(routes.aliyun.refresh_account_summary.path, { account_id: accountId, force: true })
			if (!result?.status) return Message.request(result)
			account.value = result.data
		}
	} finally { errorDetailLoading.value = false }
	const detail = account.value.resource_error_detail
	if (!account.value.resource_error) return Message.success(pub.lang('当前阿里云接口连接正常'))
	if (!detail) return Message.warn(pub.lang('本次探测未返回可用的详细错误信息'))
	ElMessageBox.alert(
		h('pre', { class: 'aliyun-error-detail' }, detail),
		pub.lang('阿里云接口错误详情'),
		{ confirmButtonText: pub.lang('知道了') }
	)
}
const formatRecordLogTime = (record: RecordLog) => {
	const time = record.action_time
		? new Date(record.action_time)
		: new Date(record.action_timestamp < 1e12 ? record.action_timestamp * 1000 : record.action_timestamp)
	return Number.isNaN(time.getTime()) ? '--' : time.toLocaleString()
}
const copyServerIp = (ip: string) => copyText({ value: ip, success: pub.lang('IP复制成功') })
const formatNumber = (value: number) => Number.isInteger(value) ? String(value) : Number(value).toFixed(1)
const formatComputeSpec = (server: CloudServer) => {
	const cpu = server.cpu_cores > 0 ? `${formatNumber(server.cpu_cores)} ${pub.lang('核')}` : '--'
	const memory = server.memory_gb > 0 ? `${formatNumber(server.memory_gb)} GB` : '--'
	return `${cpu} / ${memory}`
}
const formatStorageSpec = (server: CloudServer) => {
	const bandwidth = `${pub.lang('带宽')} ${formatNumber(server.bandwidth_mbps || 0)} Mbps`
	const disk = server.disk_gb === null ? `${pub.lang('磁盘')} --` : `${pub.lang('磁盘')} ${formatNumber(server.disk_gb)} GB`
	return `${bandwidth} / ${disk}`
}
const ossStorageClassName = (value: string) => ({ Standard: pub.lang('标准存储'), IA: pub.lang('低频访问'), Archive: pub.lang('归档存储'), ColdArchive: pub.lang('冷归档'), DeepColdArchive: pub.lang('深度冷归档') }[value] || value || '--')
const formatBytes = (size: number | null) => {
	const value = Number(size || 0)
	if (value < 1024) return `${value} B`
	if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
	if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
	return `${(value / 1024 ** 3).toFixed(1)} GB`
}

const refreshCurrentPage = () => {
	const resourceRefresh = activeTab.value === 'domains'
		? loadDomains(domainPage.value)
		: activeTab.value === 'esa'
			? loadEsaSites(esaPage.value)
			: activeTab.value === 'cdn'
				? loadCdnDomains(cdnPage.value)
				: activeTab.value === 'oss'
					? loadOssBuckets(ossPage.value)
					: loadServers(true)
	return Promise.all([refreshSummary(), resourceRefresh])
}
const handleRefreshShortcut = (event: KeyboardEvent) => {
	if (
		event.key.toLowerCase() !== 'r' ||
		(!event.ctrlKey && !event.metaKey) ||
		event.altKey ||
		event.shiftKey
	) return
	event.preventDefault()
	event.stopPropagation()
	refreshCurrentPage()
}
const handleIpcRefresh = () => refreshCurrentPage()

const activatePageListeners = () => {
	window.addEventListener('keydown', handleRefreshShortcut, true)
	ipc.on('aliyun-refresh', handleIpcRefresh)
	if (!esaDeployPollingTimer.value) {
		esaDeployPollingTimer.value = setInterval(() => {
			if (activeTab.value === 'esa' && esaDetailTab.value === 'certificates' && esaDeployTasks.value.some(task => !['completed', 'failed'].includes(task.status))) {
				loadEsaDeployTasks(true)
			}
		}, 30000)
	}
}
const deactivatePageListeners = () => {
	window.removeEventListener('keydown', handleRefreshShortcut, true)
	ipc.removeListener('aliyun-refresh', handleIpcRefresh)
	if (esaDeployPollingTimer.value) {
		clearInterval(esaDeployPollingTimer.value)
		esaDeployPollingTimer.value = undefined
	}
}

onMounted(async () => {
	if (activeTab.value === 'servers') await Promise.all([loadAccount(), loadServers()])
	else {
		await loadAccount()
		await handleTabChange(activeTab.value)
	}
	updateResourceIndicator()
})
onActivated(activatePageListeners)
onDeactivated(deactivatePageListeners)
onBeforeUnmount(deactivatePageListeners)
</script>

<style scoped lang="scss">
.aliyun-detail { min-height: 100%; padding: 2rem 3.6rem 3.6rem; color: var(--el-text-color-primary); }
.detail-header, .detail-header__identity, .detail-header__aside, .resource-navigation, .resource-navigation__items, .resource-navigation__item, .resource-navigation__meta, .resource-toolbar, .resource-toolbar__filters, .resource-toolbar__actions, .record-toolbar, .record-toolbar__actions, .record-log-toolbar, .domain-search { display: flex; align-items: center; }
.detail-header { min-height: 6.8rem; justify-content: space-between; gap: 2rem; padding-bottom: 1.4rem; }
.detail-header__identity { min-width: 0; gap: 1.2rem; }
.detail-header__name { min-width: 0; h1 { overflow: hidden; margin: 0; font-size: 1.8rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; } p { margin: .3rem 0 0; color: var(--el-text-color-secondary); font-size: 1.15rem; } }
.detail-header__identity, .detail-header__aside { flex: 0 0 auto; }
.detail-header__aside { gap: 2rem; }
.detail-logo { display: flex; align-items: center; justify-content: center; width: 4.4rem; height: 4.4rem; border-radius: 1rem; color: #ff6a00; background: rgba(255, 106, 0, .11); }
.detail-alert { margin: 1.2rem 0 0; }
.resource-error-title { display: inline-flex; align-items: center; gap: .35rem; }
.resource-error-detail-trigger { display: inline-flex; align-items: center; justify-content: center; width: 2rem; height: 2rem; padding: 0; border: 0; color: var(--el-color-warning); font-size: 1.4rem; background: transparent; cursor: pointer; position: relative; z-index: 1; &:disabled { cursor: wait; opacity: .6; } }
:global(.aliyun-error-detail) { max-width: 70rem; max-height: 42rem; overflow: auto; margin: 0; color: var(--el-text-color-primary); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 1.2rem; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
.resource-alert { margin-top: 1.2rem; }
.balance-summary { min-width: 15rem; }
.summary-item__amount { display: flex; align-items: center; gap: .35rem; white-space: nowrap; strong { min-width: 0; color: #ff6a00; font-size: 2.25rem; font-weight: 650; letter-spacing: 0; } .el-button { flex: 0 0 auto; } }
.summary-item__status { margin: 0 .2rem; color: var(--el-color-warning); font-size: 1.05rem; }
.summary-item__updated { margin-top: .2rem; color: var(--el-text-color-secondary); font-size: 1.1rem; white-space: nowrap; }
.resource-navigation { justify-content: space-between; gap: 2rem; margin-bottom: 1.6rem; padding: .7rem 0; border-top: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter); }
.resource-navigation__items { position: relative; gap: .2rem; padding: .3rem; border: 1px solid var(--el-border-color-light); border-radius: .8rem; background: var(--el-fill-color-lighter); }
.resource-navigation__indicator { position: absolute; top: .3rem; bottom: .3rem; left: 0; z-index: 0; border-radius: .6rem; background: rgba(255, 106, 0, .12); box-shadow: inset 0 0 0 1px rgba(255, 106, 0, .08); transition: width .24s ease, transform .24s ease; }
.resource-navigation__item { position: relative; z-index: 1; justify-content: center; gap: .65rem; height: 3.6rem; padding: 0 1.8rem; border: 0; color: var(--el-text-color-regular); font-size: 1.3rem; white-space: nowrap; background: transparent; cursor: pointer; transition: color .2s ease; strong { color: var(--el-text-color-secondary); font-size: 1.15rem; font-weight: 600; } em { color: var(--el-text-color-placeholder); font-size: 1.05rem; font-style: normal; font-weight: 400; } &:hover, &.active { color: #ff6a00; } &.active { font-weight: 600; } &.active strong { color: #ff6a00; } }
.resource-navigation__meta { flex: 0 0 auto; gap: .8rem; color: var(--el-text-color-secondary); font-size: 1.1rem; white-space: nowrap; }
.resource-tabs { :deep(.el-tabs__header) { display: none; } }
.server-pane { display: flex; height: calc(100vh - 23rem); min-height: 36rem; flex-direction: column; }
.server-table-wrap { min-height: 0; flex: 1; }
.cdn-pane { display: flex; height: calc(100vh - 23rem); min-height: 36rem; flex-direction: column; }
.cdn-view-switch { display: flex; justify-content: flex-start; margin-bottom: 1rem; }
.cdn-analytics { min-height: 0; overflow-y: auto; padding-right: .2rem; flex: 1; }
.cdn-table-wrap { min-height: 0; flex: 1; }
.oss-pane { display: flex; height: calc(100vh - 23rem); min-height: 36rem; flex-direction: column; }
.oss-bucket-scroll { min-height: 0; overflow-y: auto; flex: 1; }
.oss-bucket-grid { display: grid; padding: .2rem .2rem 1rem; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.2rem; }
.oss-bucket-card { min-width: 0; padding: 1.5rem; border: 1px solid var(--el-border-color-lighter); border-radius: .8rem; background: var(--el-bg-color); cursor: pointer; transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease; &:hover, &:focus-visible { border-color: var(--el-color-primary-light-5); box-shadow: 0 .5rem 1.5rem rgba(31, 45, 61, .08); transform: translateY(-1px); outline: 0; } }
.oss-bucket-card__header, .oss-bucket-card__identity, .oss-bucket-card__actions, .oss-bucket-card__metrics, .oss-bucket-card__traffic, .oss-bucket-card__footer, .oss-bucket-card__enter { display: flex; align-items: center; }
.oss-bucket-card__header { min-width: 0; justify-content: space-between; gap: 1rem; }
.oss-bucket-card__identity { min-width: 0; gap: 1rem; flex: 1; > div { min-width: 0; } strong, span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } strong { font-size: 1.4rem; font-weight: 650; } span { margin-top: .3rem; color: var(--el-text-color-secondary); font-size: 1.05rem; } }
.oss-bucket-card__icon { display: flex !important; width: 3.8rem; height: 3.8rem; align-items: center; justify-content: center; margin: 0 !important; border-radius: .8rem; color: var(--el-color-primary); font-family: inherit !important; font-size: 1.8rem !important; background: var(--el-color-primary-light-9); flex: 0 0 auto; }
.oss-bucket-card__actions { gap: .1rem; flex: 0 0 auto; }
.oss-bucket-card__metrics { margin-top: 1.5rem; padding: 1.25rem 0; border-top: 1px solid var(--el-border-color-lighter); border-bottom: 1px solid var(--el-border-color-lighter); > div { min-width: 0; flex: 1; } > div + div { padding-left: 1.8rem; border-left: 1px solid var(--el-border-color-lighter); } span, strong { display: block; } span { color: var(--el-text-color-secondary); font-size: 1.05rem; } strong { margin-top: .35rem; font-size: 1.7rem; font-weight: 650; } }
.oss-bucket-card__traffic { padding-top: .9rem; gap: 1.8rem; > div { min-width: 0; flex: 1; } span { color: var(--el-text-color-placeholder); font-size: 1rem; } strong { margin-left: .55rem; color: var(--el-text-color-regular); font-size: 1.1rem; font-weight: 600; } }
.oss-bucket-card__footer { justify-content: flex-end; padding-top: 1rem; font-size: 1.05rem; }
.oss-bucket-card__enter { gap: .25rem; color: var(--el-color-primary); font-weight: 500; white-space: nowrap; .el-icon { font-size: 1.1rem; transition: transform .18s ease; } }
.oss-bucket-card:hover .oss-bucket-card__enter .el-icon { transform: translateX(.2rem); }
:global(.oss-bucket-detail__title) { padding-bottom: .9rem; border-bottom: 1px solid var(--el-border-color-lighter); font-size: 1.3rem; font-weight: 650; }
:global(.oss-bucket-detail dl) { display: grid; margin: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 1.6rem; }
:global(.oss-bucket-detail dl > div) { min-width: 0; padding-top: 1rem; }
:global(.oss-bucket-detail dt) { color: var(--el-text-color-secondary); font-size: 1.02rem; }
:global(.oss-bucket-detail dd) { min-width: 0; margin: .35rem 0 0; color: var(--el-text-color-primary); font-size: 1.1rem; }
:global(.oss-bucket-detail__endpoint) { grid-column: 1 / -1; }
:global(.oss-bucket-detail__endpoint dd) { display: flex; min-width: 0; align-items: center; gap: .4rem; }
:global(.oss-bucket-detail__endpoint code) { min-width: 0; overflow: hidden; padding: .3rem .5rem; border-radius: .4rem; color: var(--el-text-color-regular); background: var(--el-fill-color-light); text-overflow: ellipsis; white-space: nowrap; flex: 1; }
:global(.oss-bucket-detail__hint) { margin: 1rem 0 0; color: var(--el-text-color-placeholder); font-size: 1rem; }
.resource-toolbar { justify-content: space-between; gap: 1.6rem; margin-bottom: 1rem; }
.resource-toolbar__filters { min-width: 0; gap: .8rem; .el-input { width: 30rem; } .el-select { width: 15rem; } }
.resource-toolbar__actions { flex: 0 0 auto; gap: .6rem; }
.instance-name { font-weight: 600; line-height: 1.35; }
.server-ip { display: flex; align-items: center; gap: .35rem; min-height: 2.2rem; }
.server-ip__copy { opacity: .58; transition: opacity .15s; &:hover { opacity: 1; } }
.server-spec { font-weight: 600; }
.server-spec__secondary { margin-top: .25rem; color: var(--el-text-color-secondary); font-size: 1.15rem; }
.server-status.el-tag--success { border-color: rgba(52, 168, 83, .22); color: #2f9e57; background: rgba(52, 168, 83, .1); }
.resource-tabs :deep(.el-table th.el-table__cell) { height: 4.2rem; padding: .6rem 0; color: var(--el-text-color-secondary); font-size: 1.15rem; font-weight: 500; background: transparent; }
.resource-tabs :deep(.el-table td.el-table__cell) { padding: .9rem 0; }
.resource-tabs :deep(.el-table .cell) { line-height: 1.45; }
.muted { color: var(--el-text-color-secondary); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.pagination { display: flex; justify-content: flex-end; padding-top: 1.4rem; }
.dns-layout { display: grid; height: calc(100vh - 23rem); min-height: 36rem; grid-template-columns: 26rem minmax(0, 1fr); gap: 1.6rem; }
.domain-panel { display: flex; min-height: 0; padding-right: 1.6rem; border-right: 1px solid var(--el-border-color-light); flex-direction: column; }
.record-panel { display: flex; min-width: 0; min-height: 0; flex-direction: column; }
.record-table-wrap { min-height: 0; flex: 1; }
.domain-search { gap: .6rem; }
.domain-list { min-height: 0; margin: 1rem 0; overflow-x: hidden; overflow-y: auto; flex: 1; }
.domain-item { padding: 1rem 1.2rem; border-radius: .8rem; cursor: pointer; transition: .2s; strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } &:hover { background: var(--el-fill-color-light); } &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); } }
.domain-item__meta { display: flex; min-width: 0; justify-content: space-between; gap: .8rem; margin-top: .3rem; color: var(--el-text-color-secondary); font-size: 1.05rem; white-space: nowrap; em { min-width: 0; overflow: hidden; font-style: normal; text-overflow: ellipsis; } em:last-child { flex: 0 0 auto; } .expired { color: var(--el-color-danger); } }
.esa-layout { display: grid; height: calc(100vh - 23rem); min-height: 42rem; grid-template-columns: 28rem minmax(0, 1fr); gap: 1.8rem; }
.esa-site-panel { display: flex; min-height: 0; padding-right: 1.8rem; border-right: 1px solid var(--el-border-color-light); flex-direction: column; }
.esa-site-search { display: flex; gap: .6rem; .el-input { min-width: 0; flex: 1; } }
.esa-status-filter { width: 100%; margin-top: .8rem; }
.esa-site-list { min-height: 0; margin: 1rem 0; overflow-x: hidden; overflow-y: auto; flex: 1; }
.esa-site-item { display: block; width: 100%; padding: 1rem 1.1rem; border: 0; border-radius: .7rem; color: var(--el-text-color-primary); text-align: left; background: transparent; cursor: pointer; transition: color .18s ease, background .18s ease; &:hover { background: var(--el-fill-color-light); } &.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); } }
.esa-site-item__heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: .8rem; strong { min-width: 0; overflow: hidden; font-size: 1.25rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; } .el-tag { flex: 0 0 auto; } }
.esa-site-item__meta { display: flex; gap: .6rem; margin-top: .45rem; color: var(--el-text-color-secondary); font-size: 1.08rem; em { font-style: normal; } em + em::before { margin-right: .6rem; color: var(--el-border-color); content: '/'; } }
.esa-site-pagination { flex: 0 0 auto; padding-top: .8rem; border-top: 1px solid var(--el-border-color-lighter); }
.esa-detail-panel { min-width: 0; min-height: 0; overflow: hidden; }
.esa-overview { display: flex; min-height: 6.8rem; align-items: flex-start; justify-content: space-between; gap: 2rem; padding: .2rem 0 1.3rem; border-bottom: 1px solid var(--el-border-color-lighter); }
.esa-overview__identity { min-width: 0; flex: 1; p { overflow: hidden; margin: .55rem 0 0; color: var(--el-text-color-secondary); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 1.08rem; text-overflow: ellipsis; white-space: nowrap; } }
.esa-overview__title { display: flex; min-width: 0; align-items: center; gap: .8rem; h3 { overflow: hidden; margin: 0; font-size: 1.7rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; } }
.esa-overview__facts { display: flex; flex: 0 0 auto; gap: 2.6rem; div { display: flex; min-width: 8rem; flex-direction: column; gap: .35rem; } span { color: var(--el-text-color-secondary); font-size: 1.05rem; } strong { max-width: 15rem; overflow: hidden; font-size: 1.18rem; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; } }
.esa-detail-tabs { height: calc(100% - 8rem); padding-top: .35rem; :deep(.el-tabs__content) { height: calc(100% - 4.6rem); overflow: hidden; } :deep(.el-tab-pane) { display: flex; height: 100%; min-height: 0; flex-direction: column; } }
.esa-detail-tabs :deep(.el-tabs__header) { display: flex; }
.esa-content-toolbar { display: flex; justify-content: space-between; gap: .8rem; margin-bottom: 1rem; .el-input { max-width: 30rem; } &--end { justify-content: flex-end; min-height: 3.2rem; } }
.esa-record-filters, .esa-record-actions { display: flex; align-items: center; gap: .8rem; }
.esa-record-filters { min-width: 0; flex: 1; .el-input { width: 28rem; } .el-select { width: 12rem; } }
.esa-record-actions { flex: 0 0 auto; }
.cdn-source-list { display: flex; width: 100%; flex-direction: column; gap: .8rem; }
.cdn-source-row { display: grid; align-items: center; grid-template-columns: 11rem minmax(0, 1fr) 12rem auto; gap: .8rem; }
.cdn-log-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 1rem; padding-top: 1.2rem; color: var(--el-text-color-secondary); }
.esa-https-summary { display: flex; min-width: 0; align-items: center; gap: .8rem; color: var(--el-text-color-secondary); font-size: 1.08rem; span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } }
.esa-certificate-stats { display: flex; gap: 1.8rem; margin: -.15rem 0 1rem; color: var(--el-text-color-secondary); font-size: 1.08rem; span { display: inline-flex; align-items: baseline; gap: .3rem; } strong { color: var(--el-text-color-primary); font-size: 1.25rem; font-weight: 650; } .danger strong { color: var(--el-color-danger); } }
.esa-deploy-task__error { overflow: hidden; color: var(--el-color-danger); font-size: 1.05rem; text-overflow: ellipsis; white-space: nowrap; }
.esa-deploy-drawer-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; }
.certificate-domain-preview { margin-top: .4rem; color: var(--el-text-color-secondary); font-size: 1.05rem; line-height: 1.5; strong { color: var(--el-text-color-regular); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; } }
.certificate-coverage { display: block; overflow: hidden; color: var(--el-text-color-regular); text-overflow: ellipsis; white-space: nowrap; cursor: default; }
.esa-section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1rem; h4 { margin: 0; font-size: 1.35rem; font-weight: 600; } p { margin: .25rem 0 0; color: var(--el-text-color-secondary); font-size: 1.08rem; } &--sub { margin-top: 1.8rem; padding-top: 1.5rem; border-top: 1px solid var(--el-border-color-lighter); } }
.esa-partial-alert { margin-bottom: 1rem; }
.esa-site-info { display: grid; padding-top: .8rem; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 3.2rem; }
.esa-site-info dl { display: grid; min-width: 0; margin: 0; padding: 1.25rem 0; border-bottom: 1px solid var(--el-border-color-lighter); grid-template-columns: 10rem minmax(0, 1fr); gap: 1.2rem; dt { color: var(--el-text-color-secondary); font-size: 1.1rem; } dd { min-width: 0; overflow: hidden; margin: 0; color: var(--el-text-color-primary); text-overflow: ellipsis; white-space: nowrap; } }
.esa-site-info__wide { grid-column: 1 / -1; }
.record-toolbar { align-items: flex-start; justify-content: space-between; gap: 1.5rem; margin-bottom: 1.2rem; h3 { margin: 0; font-size: 1.6rem; } }
.record-heading { min-width: 0; }
.record-heading__title { display: flex; align-items: center; gap: .7rem; }
.domain-dns { display: flex; min-height: 2rem; align-items: center; gap: .6rem; margin-top: .45rem; color: var(--el-text-color-secondary); font-size: 1.1rem; flex-wrap: wrap; span { font-weight: 600; } code { padding: .1rem .45rem; border-radius: .35rem; color: var(--el-text-color-regular); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--el-fill-color-light); } em { font-style: normal; } }
.dns-provider-alert { margin: -.2rem 0 1rem; }
.record-toolbar__actions { gap: .8rem; .el-input { width: 22rem; } .el-select { width: 12rem; } }
.record-log-toolbar { gap: .8rem; margin-bottom: 1.2rem; .el-input { flex: 1; } }
@media (max-width: 1280px) { .resource-navigation__item { padding: 0 1.3rem; } .oss-bucket-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 1100px) { .detail-header { flex-wrap: wrap; } .detail-header__aside { margin-left: 5.6rem; } .resource-navigation { align-items: flex-start; flex-direction: column; gap: .8rem; } .resource-navigation__meta { align-self: flex-end; } .dns-layout { grid-template-columns: 22rem minmax(0, 1fr); } .esa-layout { grid-template-columns: 23rem minmax(0, 1fr); } .esa-overview { flex-direction: column; gap: 1rem; } .esa-overview__facts { width: 100%; } .resource-toolbar, .resource-toolbar__filters { flex-wrap: wrap; } .record-toolbar { align-items: flex-start; flex-direction: column; } }
</style>
