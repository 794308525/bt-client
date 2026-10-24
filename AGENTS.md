# 寰宇运维开发与打包约定

## 项目定位

- 项目展示名称为“寰宇运维”，基于堡塔多机管理（bt-client）二次开发，属于非官方维护版本；保留原项目来源、版权和许可说明。
- 宝塔官网展示链接统一使用 `https://www.bt.cn/u/XbfWPO`；原项目与本版本源码链接继续指向各自仓库，不替换接口、下载或文档地址。
- Cloudflare 暂时隐藏导航入口和功能介绍，保留代码及已有数据，未经明确要求不删除。
- 为兼容现有数据，内部包名、协议和 `bt-client` 用户数据目录保持不变，不随展示名称修改。普通安装包保留原应用标识；Mac App Store 版单独使用描述文件登记的 `cn.iiar.devops`，数据位于系统沙盒中。

## 基本规则

- 默认使用当前操作系统和当前 CPU 架构打包。例如 macOS ARM64 就打 macOS ARM64。
- 只有用户明确指定时才打其他平台或架构，不默认做跨平台打包。
- 每次正式发布前先升级 `package.json` 版本号，避免新旧安装包同名导致误判。
- 不把开发数据库打进安装包。项目 `data/` 和用户数据目录必须保持独立。

## 更新记录维护

- 完成用户可见的功能新增、行为调整或重要修复时，同步维护 `frontend/src/views/setting/changelog.ts`，设置页“更新记录”直接读取此文件，不另建重复日志。仅内部重构和例行检查不单独记录。
- 未发布变更合并到顶部 `version: 'unreleased'` 条目，日期填写最近修改日。同类改动合并，每个版本通常 2～5 条，每条一句话，写用户能感知的变化，不写开发过程、文件清单或测试流水账。
- 正式发布时，将待发布条目归档为 `package.json` 中的实际版本并填写真实发布日期，按新到旧保留历史；不为记录日志自行升级版本，不编造历史版本、发布日期或发布链接。
- 功能范围或与原版的差异发生变化时，同时核对“关于”页介绍，保留项目来源和许可说明。

## 运行开发版

```bash
npm run dev
```

- 开发地址默认为 `http://localhost:8080/`。
- 修改主进程、依赖或打包配置后，重启开发版，不要只刷新页面。
- 重启前确认旧的 Electron/Vite 进程已退出，避免新代码仍由旧主进程加载。
- 开发版只用于功能验收，不以开发版数据库作为安装包数据。

## 打包缓存与依赖准备

- macOS 默认打包入口已经内置资源准备，不要在每次打包前例行执行 `npm run clean`、`npm run build-frontend`、`npm run encrypt` 或 `electron-rebuild`，否则会主动破坏缓存并重复耗时。
- `npm run prepare-package` 会校验阿里云 CLI，并同时检查以下输入指纹和实际产物哈希：
  - Electron 版本、目标平台/架构、`better-sqlite3`、`node-pty`、`cpu-features` 与 `@electron/rebuild` 版本；
  - 前端源码与 `public/dist`；
  - Electron 主进程源码、加密工具版本与 `public/electron`。
- 只有输入变化、产物缺失或产物哈希不一致时才重编原生依赖、重建前端或重新加密。缓存记录位于 `node_modules/.cache/bt-client/package-build-state.json`，不得打进安装包，也不要无故删除。
- Electron Builder 在 macOS 缓存打包入口中使用 `npmRebuild=false`，因为原生依赖已由准备脚本按目标架构校验；不要绕过 `prepare-package` 后直接复用此选项。
- 需要强制刷新全部构建资源时使用 `npm run build-m-full`。该命令会清理加密产物并忽略构建缓存，适用于正式发布、Electron 或构建工具升级、缓存异常排查，不用于普通重复打包。
- 依赖完整且 `package.json` 未变更时，不要例行执行 `npm ci`；它会先删除可用依赖，再重新下载 Electron 和 GitHub 依赖，容易受代理阻断。只有依赖缺失或依赖声明变更时才重新安装。
- 需要下载 Electron 时优先使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；已有本机缓存时先校验 SHA256 并复用缓存。不要使用 `--ignore-scripts`，部分原生依赖（如 `cpu-features`）需要在安装时生成自身的构建文件。
- 不支持的 CLI 平台或架构不要强行打包；跨平台打包应在对应目标系统执行，不能复用当前系统的原生依赖缓存。

## 正式打包

- 默认打包当前环境：在 macOS 使用缓存感知的 `npm run build-m`，Windows 使用 `npm run build-w`，Linux 使用 `npm run build-l`。
- macOS 正式发布或明确要求全量打包时使用 `npm run build-m-full`；普通安装包验收和连续修改后的重复出包使用 `npm run build-m`。
- macOS 默认只生成 DMG 安装包，不生成 ZIP 和 ZIP blockmap；用户明确要求时才额外压缩。
- 明确要求 Mac App Store 上架包时，正式发布使用 `npm run build-mas-full`，重复出包使用 `npm run build-mas`；最低系统为 macOS 12.0，生成当前架构的签名 PKG，产物位于 `out/app-store/mas-当前架构/`。必须使用 MAS Electron，不能拿普通 DMG 改后缀。
- `build-m-arm64` 也必须先通过 `prepare-package`，不得改回只打包、不检查前端和主进程产物的旧流程。
- Windows 和 Linux 尚未接入当前 macOS 缓存打包入口；在对应系统打包时仍按各自脚本执行原生依赖和资源检查。
- 打包产物在 `out/`，交付前检查文件名中的系统、版本和架构。

## 签名与公证

- 普通 DMG 的 `builder.json` 继续禁用签名，不配置 `afterSign`；没有 Developer ID 和公证凭据时，交付标注“未签名/未公证”。
- Mac App Store 使用 `build/builder.mas.js`，团队 `9LHTAY9957`；钥匙串需具备 Apple Distribution 应用签名私钥和 Mac Installer Distribution 安装包签名私钥，并提供匹配的发布描述文件。缺失时应停止，不能交付未签名商店包。
- `苹果证书/` 只用于本地签名，已从 Git 和安装包排除；不得提交或输出私钥、P12 密码和凭据文本。描述文件仅由签名工具嵌入应用指定位置。
- 商店版启用 App Sandbox，停用应用内自动更新，由 Mac App Store 分发更新。MAS 上架包不走 Developer ID 公证流程，发布证书签名的应用不能作为本地开发版直接运行；运行验收需另备同团队的开发证书和开发描述文件。
- 交付前核对应用和 PKG 签名、描述文件、Bundle ID、版本与架构，并检查包内无开发数据或证书原件。打包不等于上传或审核通过，未经用户要求不上传提交。

## 安装包交付前检查

- 不要删除用户原有数据。安装前备份对应平台的 `bt-client` 用户数据目录，尤其是 `data/data.db`。
- 安装包不应包含开发目录的 `data/`、`logs/`、发布证书原件、`node_gyp_bins` 编译工具、SQLite 测试扩展或未经校验的 CLI。
- 至少执行：

  ```bash
  node --check electron/service/aliyun.js
  node --check electron/controller/aliyun.js
  git diff --check
  ```

- 如涉及前端或打包配置，再执行 `npm run build --prefix frontend`。
- 打包成功只表示产物生成，不代表已完成真实账号、终端、升级和多平台安装验收。
