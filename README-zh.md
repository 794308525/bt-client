# 寰宇运维

[English](README.md) | 中文说明

寰宇运维是基于[堡塔多机管理（bt-client）](https://github.com/aaPanel/bt-client)二次开发的非官方维护版本，用于集中管理宝塔面板、SSH 连接、阿里云和腾讯云资源，并提供常用运维工具。[本版本源码](https://github.com/794308525/bt-client)。

## ✨ 主要特性

- 🚀 **一键装面板并绑定** - 快速安装宝塔面板并自动绑定，即装即用
- 😍 **避免每次密码登录** - 保存SSH连接信息，无需重复输入密码
- 👍 **内置高效SSH终端** - 支持多标签SSH终端，操作便捷
- 🔒 **支持代理访问** - 内置代理池功能，支持通过代理访问服务器
- 🖥️ **多端支持** - 支持 Windows、macOS、Linux 多平台运行
- 📊 **统一面板管理** - 在一个界面中管理多个宝塔面板

## 🔧 技术栈

- **前端**: Vue 3 + TypeScript + Element Plus
- **桌面端**: Electron
- **构建工具**: Vite + UnoCSS
- **终端组件**: Xterm.js
- **数据库**: SQLite3

## 💻 系统要求

- **Windows**: Windows 7/8/10/11
- **macOS**: macOS 10.12+ (支持 Intel 和 Apple Silicon M1/M2)
- **Linux**: Ubuntu 18.04+ / 其他主流Linux发行版

## 🚀 快速开始

### 环境准备

确保您的系统已安装以下软件：

- Node.js (v16.0.0 或更高版本)
- npm 或 yarn

### 安装依赖

```bash
# 安装根目录依赖
npm install

# 安装前端依赖
cd frontend
npm install
cd ..
```

### 开发调试

```bash
# 启动完整开发环境（前端 + Electron）
npm run dev

# 仅启动前端开发服务器
npm run dev-frontend

# 仅启动 Electron 开发环境
npm run dev-electron

# 热重载模式（推荐开发时使用）
npm run reload

# 重建 SQLite3 模块
npm run re-sqlite
```

### 构建打包

```bash
# 构建 macOS 版本
npm run build-m

# 构建 Linux 版本
npm run build-l

# 构建 Windows 版本
npm run build-w
```

### 其他命令

```bash
# 清理构建文件
npm run clean

# 生成应用图标
npm run icon

# 代码加密
npm run encrypt

# 测试模式启动
npm run test
```

## 📁 项目结构

```
bt-client/
├── electron/           # Electron 主进程代码
│   ├── class/         # 核心功能类
│   ├── controller/    # 控制器
│   ├── service/       # 业务服务层
│   └── config/        # 配置文件
├── frontend/          # Vue.js 前端代码
│   ├── src/
│   │   ├── components/  # 公共组件
│   │   ├── views/      # 页面视图
│   │   ├── store/      # Pinia 状态管理
│   │   └── utils/      # 工具函数
└── public/            # 静态资源
```

## 🤝 贡献指南

1. Fork 本仓库
2. 创建您的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交您的更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 打开一个 Pull Request

## 📄 许可证

本项目基于 AGPL 3.0 许可证开源。详见 [LICENSE](LICENSE) 文件。

## 🔗 相关链接

- [宝塔官网](https://www.bt.cn/u/XbfWPO)
- [产品页面](https://www.bt.cn/new/product_pc.html)
- [使用文档](https://www.bt.cn/bbs)
