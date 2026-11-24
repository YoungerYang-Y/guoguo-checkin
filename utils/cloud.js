// 云服务入口：初始化唯一 cloud 客户端，封装微信登录与会话门禁。
// 所有云能力（数据库等）共享此客户端实例；publicConfig 为公开配置，可随包发布。
const { createMiniProgramWorkBuddyCloud } = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
const { createDiagnosticWx } = require('./workbuddy-cloud-diagnostics');

// 来自工作区云服务的 publicConfig（公开配置，无权限）。
const publicConfig = {
  endpoint: 'https://mp-api.app.workbuddy.host',
  publishableKey: 'wbpk_vJmnuH74KKyI5dknVAgU86_jHUwmfYziC3SM8jTz2i8R9s0AHprzSeS',
  workBuddyOAuthClientId: 'cb_jq6QyEPkOkJXPcpz0JxS_wbapp_vJmnuH74KKyI5dknVAgU86',
};

// 最近一次登录失败的可读原因。H5 预览拿不到真实 wx.login code / 真实 AppID，
// 此时云端会话必然为空；保留具体原因，避免页面只显示笼统的「登录失败」。
let _lastAuthError = '';
function getLastAuthError() { return _lastAuthError; }
function authFail(message) {
  _lastAuthError = message;
  return { data: null, error: { message } };
}
function brief(v, max) {
  return String(v === undefined || v === null ? '' : v).slice(0, max || 120);
}

// 小程序必须在微信公众平台把云网关加入 request 合法域名，否则 wx.request 被微信直接拦截。
// 规范禁止改 endpoint 或手写 wx.request 绕过，只能把固定网关登记进白名单。
const DOMAIN_HINT = 'request 合法域名未配置：请在微信公众平台「开发管理 → 开发设置 → 服务器域名 → request 合法域名」添加 https://mp-api.app.workbuddy.host，保存后重新打开小程序';
function describeCloudError(e, prefix) {
  const msg = brief((e && (e.message || e.errMsg || e.error_description || e.code)) || e || '网络异常', 160);
  if (/not in domain list|domain list|url not in|request:fail|urlCheck/i.test(msg)) return DOMAIN_HINT;
  return (prefix || '') + msg;
}

let _cloud = null;
function getCloud() {
  if (!_cloud) {
    _cloud = createMiniProgramWorkBuddyCloud({
      endpoint: publicConfig.endpoint,
      publishableKey: publicConfig.publishableKey,
      workBuddyOAuthClientId: publicConfig.workBuddyOAuthClientId,
      wx: createDiagnosticWx(wx),
    });
  }
  return _cloud;
}

// 获取当前会话（无会话返回 null，不抛错）
async function getSession() {
  try {
    const res = await getCloud().auth.getSession();
    return res && !res.error && res.data ? res.data : null;
  } catch (e) {
    return null;
  }
}

// 微信静默登录：wx.login 换 session，云端会话用于识别当前用户身份。
// 注意：官方规范明确 H5 预览面板无法获得真实 wx.login code，也不能在该环境
// 用 mock / 匿名登录替代；此流程只能在微信客户端内（试用版/体验版/正式版）完成。
function signInWithWechat() {
  return new Promise((resolve) => {
    _lastAuthError = '';
    if (typeof wx === 'undefined' || !wx || typeof wx.login !== 'function') {
      resolve(authFail('当前环境不支持微信登录，请用微信扫码打开小程序'));
      return;
    }
    wx.login({
      success({ code }) {
        if (!code) {
          resolve(authFail('未获取到微信登录凭证，请在微信客户端中打开小程序'));
          return;
        }
        let appid = '';
        try { appid = wx.getAccountInfoSync().miniProgram.appId; } catch (e) {}
        if (!appid || appid === 'touristappid') {
          resolve(authFail('预览/游客态无真实 AppID，请用微信扫码打开小程序'));
          return;
        }
        getCloud().auth.signInWithWechat(code, appid)
          .then(res => {
            if (res && res.data && !res.error) { _lastAuthError = ''; resolve(res); return; }
            const e = res && res.error ? res.error : { message: '登录无响应' };
            resolve(authFail(describeCloudError(e, '微信登录失败：')));
          })
          .catch(e => resolve(authFail(describeCloudError(e, '微信登录失败：'))));
      },
      fail(err) {
        const raw = err && err.errMsg ? brief(err.errMsg, 80) : '';
        resolve(authFail('微信登录不可用（' + (raw || 'wx.login 调用失败') + '），请用微信扫码打开小程序'));
      },
    });
  });
}

// 确保已登录：先查已有会话，没有则静默微信登录。返回 session 或 null。
async function ensureSession() {
  const existing = await getSession();
  if (existing) { _lastAuthError = ''; return existing; }
  const res = await signInWithWechat();
  if (res && res.data && !res.error) return res.data;
  return null;
}

module.exports = {
  getCloud, publicConfig, getSession, signInWithWechat, ensureSession,
  getLastAuthError, describeCloudError, DOMAIN_HINT,
};
