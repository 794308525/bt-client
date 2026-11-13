'use strict';
const { Controller } = require('ee-core');
const { pub } = require("../class/public.js");
const path = require('path');
const fs = require('fs');
const Services = require('ee-core/services');
const autoUpdater = process.mas ? null : require('electron-updater').autoUpdater;
const { exclusive, updateJson, processPaths } = require('../class/application-data');
const { passwordConfig, applyPasswordConfig, writePasswordJournal, removePasswordJournal } = require('../class/password-change');
const { Sqlite } = require('../class/sqlite');
const crypto = require('crypto');
const { app, dialog } = require('electron');


class IndexController extends Controller {
    
    constructor(ctx) {
        super(ctx);
    }

    /**
     * @name 获取当前语言和支持的语言列表
     * @param {Object} args 参数
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async get_languages(args,event) {
        let channel = args.channel;
        let filename = path.resolve(pub.get_language_path(), 'settings.json');
        let body = pub.read_file(filename)
        if(!body){
            body = `{
                "name": "zh",
                "google": "zh-cn",
                "title": "简体中文",
                "cn": "简体中文"
            },
            {
                "name": "en",
                "google": "en",
                "title": "English",
                "cn": "英语"
            }`
        }
        let current = pub.get_language();

        let data = {
            languages: JSON.parse(body),
            current: current
        };

        return pub.send_success(event,channel,data)
    }


    /**
     * @name 设置当前语言
     * @param {Object} args 参数
     * {
     *      language: string, // 语言
     * }
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async set_language(args,event) {
        let channel = args.channel;
        let language = args.data.language;
        pub.C('language',language)
        pub.write_log(pub.lang('设置语言为: {}',language))

        // 清除缓存
        pub.cache_del('language')
        pub.cache_del('languages')
        pub.cache_del('lang_data')
        pub.cache_del('client_lang')

        return pub.send_success_msg(event,channel,pub.lang('设置成功'))
    }

    /**
     * @name 获取客户端语言包
     * @param {Object} args 参数
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async get_client_language(args,event) {
        let channel = args.channel;
        let language = pub.get_language();
        let filename = path.resolve(pub.get_language_path(), language+'/client.json');
        if(!pub.is_file(filename)){
            filename = path.resolve(pub.get_language_path(),'zh/client.json');
        }
        let body = pub.read_file(filename)
        if (!body) {
            body = '{}'
        }
        return pub.send_success(event,channel,JSON.parse(body))
    }

    /**
     * @name 获取服务端语言包
     * @param {Object} args 参数
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async get_server_language(args,event) {
        let channel = args.channel;
        let language = pub.get_language();
        let filename = path.resolve(pub.get_language_path(), language+'/server.json');
        if(!pub.is_file(filename)){
            filename = path.resolve(pub.get_language_path(), 'zh/server.json');
        }
        let body = pub.read_file(filename)
        if(!body) body = '{}'
        return pub.send_success(event,channel,JSON.parse(body))
    }


    /**
     * @name 判断是否配置管理密码
     * @param {Object} args 参数
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async has_password(args,event) {
        let channel = args.channel;
        let password = pub.C('password');
        if(password){
            return pub.send_success_msg(event,channel,pub.lang('已设置管理密码'))
        }else{
            return pub.send_error_msg(event,channel,pub.lang('未设置管理密码'))
        }
    }

    async skip_password(args, event) {
        return IndexController.prototype.set_password.call(this, { ...args, data: { skip: true } }, event);
    }

    /**
     * @name 设置管理密码
     * @param {Object} args 参数
     * {
     *      password: string, // 密码
     * }
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async set_password(args,event) {
      try { return await exclusive(async () => {
            let channel = args.channel;
            const skip = args.data.skip === true;
            const existingPassword = pub.C('password');
            if (skip && existingPassword) return pub.send_error_msg(event, channel, pub.lang('管理密码已经设置'));
            if (existingPassword && !global.password_hash) return pub.send_error_msg(event, channel, pub.lang('请先解锁应用'));
            let password = skip ? crypto.randomBytes(24).toString('hex') : args.data.password;
            if(!password){
                return pub.send_error_msg(event,channel,pub.lang('密码不能为空'))
            }
            if(password.length < 8){
                return pub.send_error_msg(event,channel,pub.lang('密码长度不能小于8位'))
            }
            let salt = pub.C('password_salt') || crypto.randomBytes(16).toString('hex');
            let password_hash = pub.md5(pub.md5(password)+salt)
            const configFile = path.join(pub.get_data_path(), 'config.json');
            const previousConfig = pub.config_get();
            const previousHash = global.password_hash;
            const nextConfig = { ...previousConfig, password_salt: salt, password: password_hash, password_setup_skipped: skip };
            delete nextConfig.init_password;
            if (!existingPassword || previousConfig.password_setup_skipped === true) {
                nextConfig.not_password = skip;
                nextConfig.password_hash = skip ? password_hash : '';
            } else if (nextConfig.not_password === true) {
                nextConfig.password_hash = password_hash;
            } else {
                nextConfig.password_hash = '';
            }
            const tables = ['panel_info', 'ssh_info', 'proxy_info', 'aliyun_account', 'aliyun_ssh_credential',
                'tencent_ssh_credential', 'tencent_account', 'cloudflare_account', 'ssl_channel',
                'site_check_request_detail', 'qps_test_task'];
            const paths = processPaths();
            if (!paths || !paths.coordinationDir) throw new Error('无法确定数据目录');
            if (fs.existsSync(path.join(paths.coordinationDir, 'password-change.json'))) throw new Error('密码设置尚未恢复，请重新打开应用');
            const db = new Sqlite();
            const changeId = crypto.randomBytes(16).toString('hex');
            let committed = false;
            db.NOT_CLONE = true;
            try {
                writePasswordJournal(paths, { id: changeId, previous: passwordConfig(previousConfig), next: passwordConfig(nextConfig) });
                db.DB_OBJ.transaction(() => {
                    for (const table of tables) {
                        global.password_hash = previousHash;
                        const rows = db.table(table).select();
                        global.password_hash = password_hash;
                        for (const row of rows) {
                            const id = Object.keys(row)[0];
                            db.table(table).where(id + '=?', row[id]).update(row);
                        }
                    }
                    db.DB_OBJ.exec('CREATE TABLE IF NOT EXISTS password_change_state (id TEXT PRIMARY KEY)');
                    db.DB_OBJ.prepare('DELETE FROM password_change_state').run();
                    db.DB_OBJ.prepare('INSERT INTO password_change_state (id) VALUES (?)').run(changeId);
                })();
                committed = true;
                updateJson(configFile, config => {
                    applyPasswordConfig(config, nextConfig);
                });
                removePasswordJournal(paths);
            } catch (error) {
                global.password_hash = committed ? password_hash : previousHash;
                if (committed) {
                    const recoveryError = new Error('密码设置尚未完成，请重新打开应用以恢复数据');
                    recoveryError.code = 'PASSWORD_RECOVERY_REQUIRED';
                    throw recoveryError;
                }
                try { removePasswordJournal(paths); } catch (_) { /* 写入失败或启动时恢复。 */ }
                throw error;
            } finally {
                db.NOT_CLONE = false;
                db.close();
            }
            global.password_hash = password_hash;
        
            return pub.send_success_msg(event,channel,pub.lang('管理密码设置成功'))
      }); } catch (error) {
          if (error.code === 'PASSWORD_RECOVERY_REQUIRED') {
              try { dialog.showErrorBox(pub.lang('密码设置尚未完成'), pub.lang(error.message)); }
              finally { app.exit(1); }
              return;
          }
          return pub.send_error_msg(event, args.channel, pub.lang(error.message));
      }
    }


    /**
     * @name 设置免密码登录
     * @param {Object} args 参数
     * @param {Object} event 事件
     */
    async not_password(args,event) {
      try { return await exclusive(async () => {
            let channel = args.channel;
            let password = args.data.password;
            let not_password = args.data.not_password


            if(!password){
                return pub.send_error_msg(event,channel,pub.lang('密码不能为空'))
            }
            // 验证密码
            let salt = pub.C('password_salt');
            let password_hash = pub.md5(pub.md5(password)+salt)
            let password_db = pub.C('password');
            if(password_hash != password_db){
                return pub.send_error_msg(event,channel,pub.lang('密码错误'))
            }

            if(!not_password){
                // 取消免密码登录
                pub.C('not_password',false);
                pub.C('password_hash','');
            }else{
                // 设置免密码登录
                pub.C('password_hash',password_hash);
                pub.C('not_password',true);
            }

            return pub.send_success_msg(event,channel,pub.lang('设置成功'))
      }); } catch (error) { return pub.send_error_msg(event, args.channel, error.message); }
    }

    /**
     * @name 设置同步密码
     * @param {Object} args 参数
     * {
     *     password: string, // 密码
     * }
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async set_sync_password(args,event) {
        let channel = args.channel;
        return pub.send_error_msg(event,channel,pub.lang('宝塔账号数据同步功能已停用'));
    }


    /**
     * @name 验证管理密码
     * @param {Object} args 参数
     * {
     *      password: string, // 密码
     * }
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async check_password(args,event) {
        let channel = args.channel;
        let password = args.data.password;
        if(!password){
            return pub.send_error_msg(event,channel,pub.lang('密码不能为空'))
        }

        let salt = pub.C('password_salt');
        let password_hash = pub.md5(pub.md5(password)+salt)
        let password_db = pub.C('password');
        if(password_hash != password_db){
            return pub.send_error_msg(event,channel,pub.lang('密码错误'))
        }

        global.password_hash = password_hash;
        global.socks.syncProxy(); // 同步代理池
        Services.get('user').getPanelOv(); // 同步面板信息

        return pub.send_success_msg(event,channel,pub.lang('密码正确'))
		}
		/**
		 * @name 手动同步
		 * @param {Object} args 参数
		 * @param {Object} event 事件
		 * @returns {Object} 返回结果
		 */
		async manual_sync(args, event) { 
			let channel = args.channel;
			return pub.send_error_msg(event, channel, pub.lang('宝塔账号数据同步功能已停用'));
		}

    /**
     * @name 获取配置信息
     * @param {Object} args 参数
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async get_config(args,event) {
        let channel = args.channel;
        let data = pub.config_get();
        if (!data) {
            data = {
                max_common_use:10,
                language:"zh",
                exit_action:"exit"
            }
        }

        if(data.exit_action == undefined){
            data.exit_action = "exit";
        }

        if(data.not_password == undefined){
            data.not_password = false;
        }

        // 不再向前端提供已停用的同步设置及密码。
        delete data.sync_cloud;
        delete data.sync_password;
        delete data.password;
        delete data.password_salt;
        delete data.password_hash;
        delete data.init_password;

        data.version = pub.getVersion();

        return pub.send_success(event,channel,data)
    }

    /**
     * @name 设置配置信息
     * @param {Object} args 参数
     * {
     *     key: string, // 键
     *    value: string, // 值
     * }
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async set_config(args,event) {
        let channel = args.channel;
        let key = args.data.key;
        let value = args.data.value;
        if(key === 'sync_cloud' || key === 'sync_password'){
            return pub.send_error_msg(event,channel,pub.lang('宝塔账号数据同步功能已停用'));
        }
        if (['password', 'password_salt', 'password_hash', 'not_password', 'init_password', 'password_setup_skipped'].includes(key)) {
            return pub.send_error_msg(event,channel,pub.lang('请通过管理密码入口修改认证设置'));
        }
        try { pub.config_set(key,value); }
        catch (error) { return pub.send_error_msg(event,channel,error.message); }
        return pub.send_success_msg(event,channel,pub.lang('设置成功'))
    }


    /**
     * @name 检查更新
     * @param {Object} args 参数
     * @param {Object} event 事件
     * @returns {Object} 返回结果
     */
    async check_update(args,event) {
        let channel = args.channel;
        if (process.mas) {
            return pub.send_success_msg(event,channel,pub.lang('请通过 Mac App Store 获取应用更新'));
        }
        autoUpdater.checkForUpdates();

        const status = {
            error: -1,
            available: 1,
            noAvailable: 2,
            downloading: 3,
            downloaded: 4,
          }
        autoUpdater.on('update-available', (info) => {
            info.status = status.available;
            info.desc = pub.lang('有可用更新');
            pub.send_success(event,channel,info)
            
          })

        autoUpdater.on('update-not-available', (info) => {
            info.status = status.noAvailable;
            info.desc = pub.lang('没有可用更新');
            pub.send_success(event,channel,info)
        })

    }
}

IndexController.toString = () => '[class IndexController]';
module.exports = IndexController;
