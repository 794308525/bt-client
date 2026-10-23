'use strict';

const net = require('net');
const { ServerSshService } = require('./server-ssh');
const { tencentService, validateServer, normalizeInstance, errorOf } = require('./tencent');
const { TencentSshNetwork } = require('./tencent-ssh-network');

class TencentSshService extends ServerSshService {
  constructor(service = tencentService, options = {}) {
    super(service, { ...options, network: options.network || new TencentSshNetwork(service), credentialTable: 'tencent_ssh_credential',
      sources: ['cvm', 'lighthouse'], provider: 'tencent', providerName: '腾讯云', normalizeError: errorOf });
  }

  async target(job) {
    const target = validateServer(job);
    const account = this.service.getAccount(job.account_id);
    const result = await this.service.request(account, target.source, 'DescribeInstances', { InstanceIds: [target.instance_id] }, target.region_id);
    const raw = (result.InstanceSet || []).find(item => item.InstanceId === target.instance_id);
    if (!raw) throw new Error('实例不存在、已释放或当前账号无权读取');
    const server = normalizeInstance(raw, target.source, { region_id: target.region_id, name: target.region_id });
    if (/windows/i.test(`${raw.OsName || ''} ${raw.Platform || ''} ${raw.OSType || ''}`)) throw new Error('Windows 实例请使用远程桌面或腾讯云控制台，本流程用于 Linux SSH');
    if (server.status !== 'RUNNING') throw new Error('实例未运行，无法建立 SSH 连接');
    return { ...server, os_type: 'Linux', raw, addresses: [...new Set([...server.public_ips, ...server.private_ips])].filter(value => net.isIP(value)) };
  }
}

module.exports = { tencentSshService: new TencentSshService(), TencentSshService };
