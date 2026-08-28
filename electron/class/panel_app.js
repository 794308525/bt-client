const { pub } = require('./public.js');

// 通过APP接口连接面板
class PanelApp {

    constructor(url, token, panel) {
        let token_data = pub.parse_token(token);
        this.URL = url;
        this.TOKEN = token_data ? token_data.app_token : '';
        this.KEY = token_data ? token_data.app_key : '';
        this.CLIENT_BRAND = 'PC-Client';
        this.CLIENT_MODEL = pub.get_os();
        this.REQUEST_TOKEN = token_data ? token_data.request_token : '';
        this.token_error = token_data ? null : new Error('Invalid APP token');
        this.panel = panel;
    }

    /**
     * @name 构造请求参数
     * @param {object} data
     * @returns {object}
     */
    get_param(data) {
        if (this.token_error) return null;
        if (!data || typeof data !== 'object' || Array.isArray(data)) data = {};
        data.request_time = pub.time();
        data.request_token = pub.md5(data.request_time + pub.md5(this.REQUEST_TOKEN));
        let pdata = {
            client_bind_token: this.TOKEN,
            form_data: pub.aes_encrypt_ecb(JSON.stringify(data), this.KEY)
        }
        return pdata;
    }

    /**
     * @name 请求绑定面板
     * @param {*} callback 
     */
    bind(callback) {
        if (this.token_error) return callback(null, this.token_error);
        let pdata = {
            bind_token: this.TOKEN,
            client_brand: this.CLIENT_BRAND,
            client_model: this.CLIENT_MODEL
        }
        let url = this.URL + '/check_bind';
        pub.http_post(url, pdata, function (res, err) {
            if (err) {
                return callback(null, err);
            }
            if (!res || res.body === undefined || res.body === null || res.body === '') {
                return callback(null, new Error('Empty response'));
            }
            callback(res.body, null);
        });
    }

    /**
     * @name 获取绑定状态
     * @param {*} callback 
     */
    get_bind_status(callback) {
        if (this.token_error) return callback(null, this.token_error);
        let pdata = {
            bind_token: this.TOKEN
        }

        let url = this.URL + '/get_app_bind_status';
        pub.http_post(url, pdata, function (res, err) {
            if (err) {
                return callback(null, err);
            }
            if (!res || res.body === undefined || res.body === null || res.body === '') {
                return callback(null, new Error('Empty response'));
            }
            callback(res.body, null);
        });
    }

    /**
     * @name 获取服务器负载
     * @param {*} callback (res, error)
     */
    get_network(callback) {
        if (this.token_error) return callback(null, this.token_error);
        let that = this;
        let pdata = this.get_param({});
        let url = this.URL + '/system?action=GetNetWork';
        pub.httpPostProxy(url, pdata, this.panel && this.panel.proxy_id || 0, function (res, err) {
            if (err) {
                return callback(null, err);
            }

            if (!res) {
                return callback(null, new Error('Empty response'));
            }

            if (res.statusCode !== 200) {
                const response_body = res.body;
                const response_text = typeof response_body === 'string' ? response_body : '';
                const protocol_mismatch = /plain HTTP request.*HTTPS|HTTP request.*HTTPS server|wrong version number|unknown protocol/i.test(response_text);
                const response_error = new Error(res.statusMessage || `HTTP ${res.statusCode}`);
                response_error.statusCode = res.statusCode;
                response_error.responseBody = response_body;
                response_error.code = protocol_mismatch
                    ? 'PANEL_PROTOCOL_MISMATCH'
                    : (res.statusCode >= 300 && res.statusCode < 400 ? 'PANEL_HTTP_REDIRECT' : 'PANEL_HTTP_STATUS');
                return callback(null, response_error);
            }

            if (res.body === undefined || res.body === null || res.body === '') {
                return callback(null, new Error('Empty response'));
            }

            if (typeof res.body === 'object') {
                if (res.body.status === false || res.body.msg) {
                    return callback(null, new Error(res.body.msg || 'Invalid response'));
                }
                return callback(null, new Error('Invalid response'));
            }

            if (typeof res.body !== 'string') {
                return callback(null, new Error('Invalid response'));
            }

            if (res.body.trim()[0] == '{') {
                let res_body;
                try {
                    res_body = JSON.parse(res.body);
                } catch (e) {
                    return callback(null, e);
                }
                // pub.debug(res_body);
                err = new Error(res_body.msg || 'Invalid response');
                return callback(null, err);
            }

            let data;
            try {
                let de_crypt_data = pub.aes_decrypt_ecb(res.body, that.KEY);
                data = JSON.parse(de_crypt_data);
            } catch (e) {
                return callback(null, e);
            }
            if (data.status && data.data) data = data.data;
            callback(data, err);
        }, 6000);
    }


    /**
     * @name 获取server_id
     * @param {object} callback 回调函数 function(server_id){}
     */
    get_server_id(callback) {
        if (this.token_error) return callback('', this.token_error);
        let that = this;
        let uri = this.URL + '/plugin?action=get_soft_list';
        let data = this.get_param({ p: 1, type: 8, force: 0, query: '', row: 1 });
        pub.httpPostProxy(uri, data, this.panel && this.panel.proxy_id || 0,function (res, err) {
            let server_id = '';
            if (err) {
                return callback(server_id, err);
            }
            if (!res || res.body === undefined || res.body === null || res.body === '') {
                return callback(server_id, new Error('Empty response'));
            }

            if (typeof res.body === 'object') {
                pub.debug(res.body);
                return callback(res.body.serverid || server_id);
            }
            if (typeof res.body !== 'string') {
                return callback(server_id, new Error('Invalid response'));
            }

            if (res.body.trim()[0] == '{') {
                let res_body;
                try {
                    res_body = JSON.parse(res.body);
                } catch (e) {
                    return callback(server_id, e);
                }
                pub.debug(res_body);
                return callback(server_id, new Error(res_body.msg || 'Invalid response'));
            }

            let de_crypt_data = '';
            try {
                de_crypt_data = pub.aes_decrypt_ecb(res.body, that.KEY);
                if (!de_crypt_data) throw new Error('Empty decrypted response');
                de_crypt_data = JSON.parse(de_crypt_data);
            } catch (e) {
                return callback(server_id, e);
            }
            let data = de_crypt_data;

            if (data.serverid) {
                server_id = data.serverid;
            }
            callback(server_id, null);
        });
    }

    /**
     * @name 获取临时登录地址
     * @param {object} callback 回调函数 function(response, error){}
     */
    get_tmp_token(callback) {
        if (this.token_error) return callback(null, this.token_error);
        let that = this;
        let pdata = this.get_param({});
        let uri = this.URL + '/config?action=get_tmp_token';
        pub.httpPostProxy(uri, pdata, that.panel && that.panel.proxy_id || 0, function (res, err) {
            if (err) {
                return callback(null, err);
            }

            if (!res || res.body === undefined || res.body === null || res.body === '') {
                return callback(null, new Error('Empty response'));
            }

            let data;
            try {
                const decrypted = pub.aes_decrypt_ecb(res.body, that.KEY);
                if (!decrypted) throw new Error('Empty decrypted response');
                data = JSON.parse(decrypted);
            } catch (e) {
                return callback(null, e);
            }
            if (data.status && data.msg) {
                data = that.URL + "/login?tmp_token=" + data.msg;
            }
            callback(data, err);
        }, 6000);
    }
}

module.exports = { PanelApp };
