'use strict';
const { Service } = require('ee-core');
const { pub } = require("../class/public.js");

class UserService extends Service {

    constructor(ctx) {
        super(ctx);
        this.panelOvPromise = null;
    }

    /**
     * @name 获取客户端唯一标识 - client_id
     * @param {object} args 
     * @param {object} event 
     */
    get_client_id(args, event) {
        let client_id_file = pub.get_data_path() + '/user.json';
        let client_id = "";
        if (pub.is_file(client_id_file)) {
            let f_body = pub.read_file(client_id_file);
            let f_json = JSON.parse(f_body);
            if (f_json.client_id && f_json.client_id.length == 32) {
                return f_json.client_id;
            }
        }

        let pdata = {
            'mac': pub.get_mac(),
            'ip': pub.get_ip(),
            'time': pub.time()
        }

        client_id = pub.md5(JSON.stringify(pdata));
        pdata.client_id = client_id;
        pub.write_file(client_id_file, JSON.stringify(pdata));
        return client_id;
    }

    /**
     * @name 获取绑定信息
     * @returns {object}
     */
    get_bind_info() {
        let client_id_file = pub.get_data_path() + '/user.json';
        if (!pub.is_file(client_id_file)) {
            this.get_client_id();
        }
        let f_body = pub.read_file(client_id_file);
        let f_json = JSON.parse(f_body);
        return f_json;
    }


    /**
     * @name 解除绑定
     * @return {boolean}
     */
    unbind() {
        let bind_info = this.get_bind_info();
        if (bind_info.token) delete bind_info.token;
        if (bind_info.secret_key) delete bind_info.secret_key;
        if (bind_info.username) delete bind_info.username;
        if (bind_info.uid) delete bind_info.uid;
        if (bind_info.nickname) delete bind_info.nickname;
        if (bind_info.bind_time) delete bind_info.bind_time;
        if (bind_info.cid) delete bind_info.cid;
        let client_id_file = pub.get_data_path() + '/user.json';
        pub.write_file(client_id_file, JSON.stringify(bind_info));
        return true;
    }



    /**
     * @name 判断用户是否绑定
     * @return {boolean}
     */
    is_bind() {
        let bind_info = this.get_bind_info();
        if (bind_info.token && bind_info.secret_key) {
            return true;
        }
        return false;
    }

    // 宝塔账号云端数据同步已停用，保留旧调用入口以兼容本地面板和SSH操作。
    async syncPanelToCloud() {
        return false;
    }

    async syncPanelFromCloud() {
        return false;
    }

    async removePanelToCloud(url) {
        return false;
    }

    async syncSshToCloud() {
        return false;
    }

    async syncSshFromCloud() {
        return false;
    }

    async removeSshToCloud(host, port) {
        return false;
    }

    /**
     * @name 获取面板付费信息
     * @return {object}
     */
    async getPanelOv() {
        if (this.panelOvPromise) return this.panelOvPromise;
        let url = 'https://dj.bt.cn/index/get_panel_ov';

        this.panelOvPromise = new Promise((resolve) => {
            // 获取server_id列表，按 ID 聚合，避免每台面板重复请求同一信息。
            let panel_list = pub.M('panel_info').select();
            let server_id_set = new Set();
            for (let i = 0; i < panel_list.length; i++) {
                if (panel_list[i].server_id) server_id_set.add(String(panel_list[i].server_id));
            }
            let server_id_str = Array.from(server_id_set).join(',');
            if (!server_id_str) return resolve(false);

            // 发送数据
            pub.http_post(url, { server_id_list: server_id_str }, function (response, error) {
            if (error || !response || typeof response !== 'object'
                || response.body === undefined || response.body === null || response.body === '') {
                return resolve(false);
            }
            let data = response.body;
            if (typeof data == 'string') {
                try {
                    data = JSON.parse(data);
                } catch (e) {
                    pub.debug('getPanelOv-Error: ', e.message);
                    return resolve(false);
                }
            }

            if (!data || typeof data !== 'object' || Array.isArray(data) || data.status == false
                || !data.data || typeof data.data !== 'object' || Array.isArray(data.data)) {
                return resolve(false);
            }

            // 更新面板信息
            for (let i = 0; i < panel_list.length; i++) {
                if (!panel_list[i].server_id) continue;
                let server_id = panel_list[i].server_id;
                if (Object.prototype.hasOwnProperty.call(data.data, server_id)) {
                    panel_list[i].ov = data.data[server_id];
                    pub.M('panel_info').where('panel_id=?', panel_list[i].panel_id).update({ ov: data.data[server_id] });
                    if (Array.isArray(global.PanelList)) {
                        global.PanelList.forEach((panel) => {
                            if (panel.panel_id === panel_list[i].panel_id) panel.ov = data.data[server_id];
                        });
                    }
                }
            }
            resolve(true);
            });
        }).finally(() => {
            this.panelOvPromise = null;
        });
        return this.panelOvPromise;
    }


    /**
     * @name 设置用户信息
     * @param {object} data 用户信息
     * @return bool
     */
    set_user_info(data) {
        let client_id_file = pub.get_data_path() + '/user.json';
        if (!pub.is_file(client_id_file)) {
            pub.log('user.json not found', client_id_file);
            return false;
        }
        let f_body = pub.read_file(client_id_file);
        let f_json = JSON.parse(f_body);

        let keys = Object.keys(data)
        for (let i = 0; i < keys.length; i++) {
            f_json[keys[i]] = data[keys[i]];
        }
        pub.write_file(client_id_file, JSON.stringify(f_json));
        return true;
    }

}

UserService.toString = () => '[class UserService]';
module.exports = UserService;
