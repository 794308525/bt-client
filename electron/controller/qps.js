'use strict';

const { Controller } = require('ee-core');
const { pub } = require('../class/public.js');
const { qpsTaskManager } = require('../service/qps-task-manager.js');

function sendError(event, channel, error) {
  return pub.send(event, channel, { status: false, msg: String(error && error.message || error || '请求失败') });
}

class QpsController extends Controller {
  async create(args, event) {
    try { return pub.send_success(event, args.channel, qpsTaskManager.createTask(args.data || {})); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async list(args, event) {
    try { return pub.send_success(event, args.channel, qpsTaskManager.listTasks(args.data || {})); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async detail(args, event) {
    try {
      const data = args.data || {};
      return pub.send_success(event, args.channel, qpsTaskManager.getTask(data.task_id, data.with_samples !== false, data.after_sample_id));
    }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async stop(args, event) {
    try { return pub.send_success(event, args.channel, await qpsTaskManager.stopTask(args.data && args.data.task_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async remove(args, event) {
    try { qpsTaskManager.deleteTask(args.data && args.data.task_id); return pub.send_success_msg(event, args.channel, '删除成功'); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async retry(args, event) {
    try { return pub.send_success(event, args.channel, qpsTaskManager.retryTask(args.data && args.data.task_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async retention(args, event) {
    try {
      const data = args.data || {};
      const days = data.days === undefined ? qpsTaskManager.getRetentionDays() : qpsTaskManager.setRetentionDays(data.days);
      return pub.send_success(event, args.channel, { days });
    } catch (error) { return sendError(event, args.channel, error); }
  }
}

QpsController.toString = () => '[class QpsController]';
module.exports = QpsController;
