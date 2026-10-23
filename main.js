const { app } = require('electron');
const fs = require('fs');
const path = require('path');

// 展示名称变更后仍使用原数据目录，保留已有账号、配置和数据库。
const userDataPath = path.join(app.getPath('appData'), 'bt-client');
fs.mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

const { ElectronEgg } = require('ee-core');
new ElectronEgg();
