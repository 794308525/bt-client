# bt-client 开发与打包约定

## 基本规则

- 默认使用当前操作系统和当前 CPU 架构打包。例如 macOS ARM64 就打 macOS ARM64。
- 只有用户明确指定时才打其他平台或架构，不默认做跨平台打包。
- 每次正式发布前先升级 `package.json` 版本号，避免新旧安装包同名导致误判。
- 不把开发数据库打进安装包。项目 `data/` 和用户数据目录必须保持独立。

## 运行开发版

```bash
npm run dev
```

- 开发地址默认为 `http://localhost:8080/`。
- 修改主进程、依赖或打包配置后，重启开发版，不要只刷新页面。
- 重启前确认旧的 Electron/Vite 进程已退出，避免新代码仍由旧主进程加载。
- 开发版只用于功能验收，不以开发版数据库作为安装包数据。

## 打包前的必要操作

1. 先检查 `node_modules` 和 Electron 运行时。依赖完整且 `package.json` 未变更时，不要例行执行 `npm ci`；它会先删除可用依赖，再重新下载 Electron 和 GitHub 依赖，容易受代理阻断。
   只有依赖缺失或依赖声明变更时才重新安装。需要下载 Electron 时优先使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；已有本机缓存时先校验 SHA256 并复用缓存。
   不要使用 `--ignore-scripts`；部分原生依赖（如 `cpu-features`）需要在安装时生成自身的构建文件。
2. 执行 `npm run clean`，避免沿用上次的 `frontend/dist`、加密产物或 `out/`。
3. 针对当前 Electron 版本重编译原生依赖：

   ```bash
   npx electron-rebuild -f --only better-sqlite3,node-pty
   ```

   不要使用不带 `--only` 的全量重编译，避免把 SSH 等无关依赖的构建问题带入打包。`electron-builder` 打包时可能仍会自动检查其他原生依赖，这不代表业务代码失败。

4. 重新构建前端并执行生产加密：

   ```bash
   npm run build-frontend
   npm run encrypt
   ```

5. 阿里云 ECS 终端依赖必须先下载并校验对应平台的 CLI：

   ```bash
   npm run download-aliyun-cli
   ```

   指定其他平台时使用 `--target=darwin-arm64`、`--target=darwin-x64`、`--target=win32-x64` 或 `--target=linux-arm64`。不支持的架构不要强行打包。

## 正式打包

- 默认打包当前环境：在 macOS 使用 `npm run build-m`，Windows 使用 `npm run build-w`，Linux 使用 `npm run build-l`。
- macOS 默认只生成 DMG 安装包，不生成 ZIP 和 ZIP blockmap；用户明确要求时才额外压缩。
- 不要默认使用只打包、不重建前端的架构脚本（如 `build-m-arm64` 、`build-w-64` 、`build-l-64`），避免安装包内仍是旧界面。
- 需要指定平台时，先完成上述清理、前端构建、加密和原生依赖重建，再执行对应的 `electron-builder` 命令。
- 打包产物在 `out/`，交付前检查文件名中的系统、版本和架构。

## 签名与公证

- 当前没有配置发布证书和 Apple 公证凭据，不要伪造签名或公证。打包时跳过签名和 notarization，并在交付说明中标注“未签名/未公证”。
- macOS 打包前如发现 `afterSign` 指向不存在或不可用的公证脚本，应使用临时 builder 配置去掉 `afterSign`，不要因此临时新增虚假凭据。
- 有签名凭据后才能执行公证；没有凭据时不要将公证失败误报为代码或功能失败。
- 临时配置只能用于本次打包，打包后立即删除，不要修改仓库正式 `builder.json`。

## 安装包交付前检查

- 不要删除用户原有数据。安装前备份对应平台的 `bt-client` 用户数据目录，尤其是 `data/data.db`。
- 安装包不应包含开发目录的 `data/`、`logs/` 或未经校验的 CLI。
- 至少执行：

  ```bash
  node --check electron/service/aliyun.js
  node --check electron/controller/aliyun.js
  git diff --check
  ```

- 如涉及前端或打包配置，再执行 `npm run build --prefix frontend`。
- 打包成功只表示产物生成，不代表已完成真实账号、终端、升级和多平台安装验收。
