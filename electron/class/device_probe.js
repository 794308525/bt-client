'use strict';

const net = require('net');
const http = require('http');
const https = require('https');
const { SocksClient } = require('socks');
const { pub } = require('./public.js');

const ONLINE_CACHE_TIME = 30 * 1000;
const UNKNOWN_CACHE_TIME = 60 * 1000;
const MAX_OFFLINE_CACHE_TIME = 5 * 60 * 1000;

/**
 * 低频设备可达性探测。面板 API 正常时不发起 TCP 请求，仅在网络级失败时补充探测。
 */
class DeviceProbe {
    constructor(options = {}) {
        this.timeout = options.timeout || 2500;
        this.maxConcurrent = options.maxConcurrent || 10;
        this.activeCount = 0;
        this.queue = [];
        this.states = new Map();
    }

    getKey(panel) {
        return String(panel.panel_id || panel.url);
    }

    getState(panel) {
        const key = this.getKey(panel);
        if (!this.states.has(key)) {
            this.states.set(key, {
                status: 'unknown',
                failures: 0,
                nextProbeAt: 0,
                inFlight: false,
                callbacks: [],
                version: 0
            });
        }
        return this.states.get(key);
    }

    /**
     * 清除指定面板的探测缓存，供用户主动重连时立即重新检测。
     */
    reset(panel) {
        const key = this.getKey(panel);
        const state = this.states.get(key);
        if (!state) return;
        if (!state.inFlight) {
            this.states.delete(key);
            return;
        }

        // 已有探测仍在进行时提升版本；当前任务结束后会为主动重连重新发起一次真实探测。
        state.version++;
        state.status = 'unknown';
        state.failures = 0;
        state.nextProbeAt = 0;
        state.callbacks = state.callbacks.filter((item) => item.version >= state.version);
    }

    markReachable(panel) {
        const state = this.getState(panel);
        state.version++;
        state.status = 'online';
        state.failures = 0;
        state.nextProbeAt = Date.now() + ONLINE_CACHE_TIME;
        // 新的 API 成功结果已经替代旧失败请求，不再回放旧探测回调。
        state.callbacks = state.callbacks.filter((item) => item.version >= state.version);
    }

    probe(panel, callback) {
        const state = this.getState(panel);
        const now = Date.now();

        if (!state.inFlight && state.nextProbeAt > now) {
            return setImmediate(() => callback(state.status));
        }

        state.callbacks.push({ callback: callback, version: state.version });
        if (state.inFlight) return;

        state.inFlight = true;
        this.queue.push({ panel: Object.assign({}, panel), state: state, version: state.version });
        this.drain();
    }

    drain() {
        while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
            const task = this.queue.shift();
            if (task.version !== task.state.version && task.state.status === 'online') {
                this.finish(task, 'online');
                continue;
            }
            this.activeCount++;
            this.connect(task.panel, (status) => {
                this.finish(task, status);
                this.activeCount--;
                this.drain();
            });
        }
    }

    finish(task, status) {
        const state = task.state;
        if (task.version !== state.version) {
            state.inFlight = false;
            state.callbacks = state.callbacks.filter((item) => item.version > task.version);
            if (state.callbacks.some((item) => item.version === state.version)) {
                state.inFlight = true;
                this.queue.push({ panel: task.panel, state: state, version: state.version });
            }
            return;
        }

        state.status = status;
        state.inFlight = false;
        if (status === 'online') {
            state.failures = 0;
            state.nextProbeAt = Date.now() + ONLINE_CACHE_TIME;
        } else if (status === 'offline') {
            state.failures++;
            const retryDelay = Math.min(
                ONLINE_CACHE_TIME * Math.pow(2, Math.max(0, state.failures - 1)),
                MAX_OFFLINE_CACHE_TIME
            );
            state.nextProbeAt = Date.now() + retryDelay;
        } else {
            state.nextProbeAt = Date.now() + UNKNOWN_CACHE_TIME;
        }

        const callbacks = state.callbacks.filter((item) => item.version === task.version);
        state.callbacks = state.callbacks.filter((item) => item.version !== task.version);
        callbacks.forEach((item) => item.callback(state.status));
    }

    connect(panel, callback) {
        let target;
        try {
            const panelUrl = new URL(panel.url);
            target = {
                host: panelUrl.hostname.replace(/^\[|\]$/g, ''),
                port: Number(panelUrl.port || (panelUrl.protocol === 'https:' ? 443 : 80))
            };
        } catch (error) {
            return callback('unknown');
        }

        let proxy = null;
        try {
            proxy = panel.proxy_id
                ? pub.M('proxy_info').where('proxy_id=?', panel.proxy_id).find()
                : null;
        } catch (error) {
            return callback('unknown');
        }

        if (!proxy) return this.connectDirect(target, callback);
        if (Number(proxy.proxy_type) === 2) return this.connectSocks(target, proxy, callback);
        if (Number(proxy.proxy_type) === 0 || Number(proxy.proxy_type) === 1) {
            return this.connectHttpProxy(target, proxy, callback);
        }
        return callback('unknown');
    }

    connectDirect(target, callback) {
        let settled = false;
        const socket = net.createConnection(target);
        const finish = (status) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            callback(status);
        };
        socket.setTimeout(this.timeout);
        socket.once('connect', () => finish('online'));
        socket.once('timeout', () => finish('offline'));
        socket.once('error', (error) => {
            const status = error && ['ENOTFOUND', 'EAI_AGAIN'].includes(error.code)
                ? 'unknown'
                : 'offline';
            finish(status);
        });
    }

    connectSocks(target, proxy, callback) {
        const options = {
            proxy: {
                host: proxy.proxy_ip,
                port: Number(proxy.proxy_port),
                type: 5,
                userId: proxy.proxy_username || undefined,
                password: proxy.proxy_password || undefined
            },
            command: 'connect',
            destination: target,
            timeout: this.timeout
        };

        SocksClient.createConnection(options, (error, info) => {
            if (error || !info || !info.socket) return callback('unknown');
            info.socket.destroy();
            callback('online');
        });
    }

    connectHttpProxy(target, proxy, callback) {
        const headers = {};
        if (proxy.proxy_username && proxy.proxy_password) {
            const credentials = Buffer.from(`${proxy.proxy_username}:${proxy.proxy_password}`).toString('base64');
            headers['Proxy-Authorization'] = `Basic ${credentials}`;
        }

        const transport = Number(proxy.proxy_type) === 1 ? https : http;
        const request = transport.request({
            host: proxy.proxy_ip,
            port: Number(proxy.proxy_port),
            method: 'CONNECT',
            path: `${target.host}:${target.port}`,
            headers: headers,
            timeout: this.timeout,
            rejectUnauthorized: false
        });

        let settled = false;
        const finish = (status) => {
            if (settled) return;
            settled = true;
            request.destroy();
            callback(status);
        };
        request.once('connect', (response, socket) => {
            socket.destroy();
            finish(response.statusCode === 200 ? 'online' : 'unknown');
        });
        request.once('timeout', () => finish('unknown'));
        request.once('error', () => finish('unknown'));
        request.end();
    }
}

module.exports = { DeviceProbe };
