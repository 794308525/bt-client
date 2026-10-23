# 寰宇运维图标

- 原始标识：项目根目录 `huanyu_devops.png`，保留完整的正方形原图。
- 应用内标识：`frontend/src/assets/images/logo.png`，使用原图并通过样式显示圆角。
- 桌面图标源图：`public/images/logo.png`，使用 imagegen 制作的透明圆角版本。处理要求为保留原标识及蓝白配色，仅将外缘改为对称的透明圆角。
- 打包图标：本目录的 `icon.icns`、`icon.ico` 和各尺寸 PNG 已包含透明圆角；打包直接使用这些文件，圆角不依赖前端样式。窗口和托盘图标分别位于 `public/images/logo-32.png` 和 `public/images/tray.png`。
- 商店图标素材：`app-store-1024.png` 为 1024×1024、sRGB、不透明、未裁圆角的原图版本，供后续商店图标流程使用。不要以透明圆角版本替代系统裁切所需的正方形原图。

苹果当前建议提供正方形、未预先裁切的图标层，由系统应用最终圆角；现有 Electron 的 ICNS 另保留圆角外观以兼容旧版 macOS。图标素材准备不代表已完成 Mac App Store 构建或审核。

参考：[Apple App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)、[App Store Connect 添加 App 图标](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon)。
