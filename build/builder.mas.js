'use strict';

const base = require('../electron/config/builder.json');

module.exports = {
  ...base,
  // 商店版须与 Apple 描述文件一致；普通 DMG 保留原应用标识。
  appId: 'cn.iiar.devops',
  npmRebuild: false,
  directories: {
    ...base.directories,
    output: 'out/app-store',
  },
  mac: {
    ...base.mac,
    target: ['mas'],
    minimumSystemVersion: '12.0',
    category: 'public.app-category.developer-tools',
    extendInfo: {
      ElectronTeamID: '9LHTAY9957',
    },
  },
  mas: {
    identity: 'yu cao',
    type: 'distribution',
    provisioningProfile: '苹果证书/寰宇运维-发布.provisionprofile',
    entitlements: 'build/entitlements.mas.plist',
    entitlementsInherit: 'build/entitlements.mas.inherit.plist',
    hardenedRuntime: false,
    gatekeeperAssess: false,
    artifactName: '${productName}-mas-${version}-${arch}.${ext}',
  },
};
