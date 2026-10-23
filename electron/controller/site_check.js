'use strict';

const { Controller } = require('ee-core');
const { pub } = require('../class/public.js');
const { siteInspector } = require('../service/site-inspector.js');

function sendError(event, channel, error) {
  return pub.send(event, channel, { status: false, msg: String(error && error.message || error || '请求失败') });
}

class SiteCheckController extends Controller {
  async profiles(args, event) {
    return pub.send_success(event, args.channel, siteInspector.profiles());
  }

  async start(args, event) {
    try { return pub.send_success(event, args.channel, await siteInspector.start(args.data || {})); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async list(args, event) {
    try { return pub.send_success(event, args.channel, siteInspector.listTasks(args.data || {})); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async detail(args, event) {
    try { return pub.send_success(event, args.channel, siteInspector.getTask(args.data && args.data.task_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async requests(args, event) {
    try { return pub.send_success(event, args.channel, siteInspector.listRequests(args.data || {})); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async request_detail(args, event) {
    try {
      const data = args.data || {};
      return pub.send_success(event, args.channel, siteInspector.getRequestDetail(data.request_id, data.task_id));
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async live(args, event) {
    try { return pub.send_success(event, args.channel, siteInspector.getLive(args.data && args.data.task_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async layout(args, event) {
    try {
      const data = args.data || {};
      return pub.send_success(event, args.channel, siteInspector.setLayout(data.task_id, data.split_ratio, data.dragging));
    } catch (error) { return sendError(event, args.channel, error); }
  }

  async stop(args, event) {
    try { return pub.send_success(event, args.channel, siteInspector.stop(args.data && args.data.task_id)); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async remove(args, event) {
    try { siteInspector.deleteTask(args.data && args.data.task_id); return pub.send_success_msg(event, args.channel, '删除成功'); }
    catch (error) { return sendError(event, args.channel, error); }
  }

  async retention(args, event) {
    try {
      const data = args.data || {};
      const days = data.days === undefined ? siteInspector.getRetentionDays() : siteInspector.setRetentionDays(data.days);
      return pub.send_success(event, args.channel, { days });
    } catch (error) { return sendError(event, args.channel, error); }
  }
}

SiteCheckController.toString = () => '[class SiteCheckController]';
module.exports = SiteCheckController;
