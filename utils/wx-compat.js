// H5 预览面板只模拟了部分微信原生 API，缺失的 API 会让整段交互直接抛错中断。
// 这里在启动时补齐「缺失」的实现（已有实现一律不覆盖），保证预览里交互可完整走完。
// 真机 / 微信开发者工具中这些 API 都存在，本模块不会产生任何行为变化。
function fill(name, fn) {
  try {
    if (typeof wx[name] !== 'function') wx[name] = fn;
  } catch (e) {}
}

function install() {
  // 每次调用都重新检查（fill 自身幂等）：wx 尚未注入或在预览中被替换过也能补齐
  if (typeof wx === 'undefined' || !wx) return;
  const noop = function () {};

  // 加载中：页面自身已有「同步中」状态，缺失时静默跳过即可
  fill('showLoading', noop);
  fill('hideLoading', noop);
  fill('hideToast', noop);

  // 轻提示：缺失时只写日志，不用弹窗打断连续点击
  fill('showToast', function (o) {
    try { console.log('[toast]', (o && o.title) || ''); } catch (e) {}
  });

  // 模态确认：浏览器 confirm 兜底，保持 success({confirm}) 回调签名
  fill('showModal', function (o) {
    const opts = o || {};
    let confirm = false;
    try {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function' && opts.showCancel !== false) {
        confirm = !!window.confirm(opts.content || opts.title || '确认操作？');
      } else if (typeof window !== 'undefined' && typeof window.alert === 'function') {
        window.alert(opts.content || opts.title || '');
        confirm = true;
      }
    } catch (e) {}
    try { if (typeof opts.success === 'function') opts.success({ confirm, cancel: !confirm }); } catch (e) {}
    try { if (typeof opts.complete === 'function') opts.complete({}); } catch (e) {}
  });

  // 文件系统：内存版，保证「导出 CSV」流程不因缺少 API 而中断
  const mem = {};
  fill('getFileSystemManager', function () {
    return {
      writeFileSync: function (p, data) { mem[p] = String(data); },
      saveFileSync: function (src, dest) {
        mem[dest] = mem[src] !== undefined ? mem[src] : String(src);
        return dest;
      },
      readFileSync: function (p) {
        if (!(p in mem)) throw new Error('ENOENT');
        return mem[p];
      },
      accessSync: function (p) { if (!(p in mem)) throw new Error('ENOENT'); },
    };
  });
  try {
    if (!wx.env || typeof wx.env !== 'object') wx.env = {};
    if (!wx.env.USER_DATA_PATH) wx.env.USER_DATA_PATH = 'wxfile://usr';
  } catch (e) {}

  // 剪贴板：优先浏览器 API，否则把内容展示出来供手动复制
  fill('setClipboardData', function (o) {
    const opts = o || {};
    const data = String(opts.data || '');
    let delegated = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(data).then(
          function () { if (typeof opts.success === 'function') opts.success({}); },
          function () { if (typeof opts.fail === 'function') opts.fail({ errMsg: 'clipboard denied' }); }
        );
        delegated = true;
      }
    } catch (e) {}
    if (!delegated) {
      try {
        if (typeof wx.showModal === 'function') {
          wx.showModal({ title: '可手动复制', content: data, showCancel: false });
        }
      } catch (e) {}
      try { if (typeof opts.success === 'function') opts.success({}); } catch (e) {}
    }
    try { if (typeof opts.complete === 'function') opts.complete({}); } catch (e) {}
  });

  // 拍照/选图：H5 预览无法调起相机，明确失败让页面提示改用批量粘贴
  fill('chooseMedia', function (o) {
    const opts = o || {};
    try { if (typeof opts.fail === 'function') opts.fail({ errMsg: 'chooseMedia:fail 当前预览环境不支持拍照' }); } catch (e) {}
    try { if (typeof opts.complete === 'function') opts.complete({}); } catch (e) {}
  });
}

module.exports = { install };
