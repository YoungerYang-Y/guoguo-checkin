const store = require('../../utils/store.js');
const D = require('../../utils/date.js');
const cloudstore = require('../../utils/cloudstore.js');
const privacy = require('../../utils/privacy.js');

const app = getApp();

const toast = (title, icon) => {
  try { wx.showToast({ title, icon: icon || 'none' }); } catch (e) {}
};

Page({
  data: {
    version: '',
    syncState: null,
    syncing: false,
    recordCount: 0,
    targetCount: 0,
    exportRange: 'month',
    ranges: [
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'year', label: '本年' },
      { key: 'all', label: '全部' },
    ],
    menuGroups: [
      { key: 'family', title: '家庭', items: [
        { key: 'family', text: '家庭管理（创建 / 加入 / 成员 / 访客链接）', path: '/pages/family/family' },
      ]},
      { key: 'data', title: '数据', items: [
        { key: 'settings', text: '设置（排期 / 目标 / 成员）', path: '/pages/settings/settings' },
        { key: 'targets', text: '自定义目标管理', path: '/pages/target-edit/target-edit?list=1' },
        { key: 'weight', text: '体重记录与年度曲线', path: '/pages/weight/weight' },
        { key: 'fees', text: '培训费与年度分析', path: '/pages/fees/fees' },
        { key: 'poems', text: '古诗记录与每周复习', path: '/pages/poems/poems' },
        { key: 'words', text: '单词句子与每周复习', path: '/pages/words/words' },
      ]},
      { key: 'about', title: '关于', items: [
        { key: 'about', text: '关于与版本', path: '' },
        { key: 'privacy', text: '用户隐私保护指引', path: '/pages/privacy/privacy' },
        { key: 'privacyStatus', text: '隐私同意状态', path: '' },
      ]},
    ],
  },

  onLoad() {
    this.setData({ version: app.globalData.version });
    // 等待启动引导完成，再刷新同步状态
    const ready = () => this.refreshSyncState();
    if (app.cloudReady && typeof app.cloudReady.then === 'function') app.cloudReady.then(ready);
    else ready();
    cloudstore.onStateChange(state => this.refreshSyncState(state));
  },
  onShow() {
    this.setData({
      recordCount: store.getRecords().filter(r => r.status === 1).length,
      targetCount: store.getCustomTargets().length,
    });
    this.refreshSyncState();
  },

  refreshSyncState(state) {
    const s = state || cloudstore.getState();
    let label, detail, dotClass, hint = '';
    if (!s.ready) {
      label = '正在连接云服务…'; detail = '首次启动同步中'; dotClass = 'dot-pending';
    } else if (s.loggedIn) {
      if (s.syncing) { label = '正在同步'; detail = '数据上传中…'; dotClass = 'dot-pending'; }
      else if (s.lastError) { label = '同步异常'; detail = s.lastError; dotClass = 'dot-error'; }
      else { label = '云端已同步'; detail = s.lastSync ? ('最近同步 ' + this.fmtTime(s.lastSync)) : '数据已保存到云端'; dotClass = 'dot-ok'; }
    } else {
      label = '本地模式'; detail = s.lastError || '未登录，数据仅保存在本机'; dotClass = 'dot-warn';
      hint = /合法域名|mp-api\.app\.workbuddy\.host/.test(s.lastError || '')
        ? '这是小程序后台的服务器域名配置问题：需管理员在微信公众平台添加 request 合法域名后重新打开小程序'
        : '预览面板是 H5 模拟环境，拿不到微信登录凭证，无法云端同步；用微信扫码打开小程序后会自动登录并同步，当前本机数据不会丢失';
    }
    this.setData({ syncState: { label, detail, dotClass, hint, loggedIn: s.loggedIn } , syncing: !!s.syncing });
  },

  fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const p = n => (n < 10 ? '0' : '') + n;
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  },

  async onSyncNow() {
    if (this.data.syncing) return;
    this.setData({ syncing: true });
    try { wx.showLoading({ title: '同步中…', mask: true }); } catch (e) {}
    try {
      await cloudstore.syncNow();
    } catch (e) {
      // 失败原因由状态卡片展示，不能让 loading 或按钮卡住
    } finally {
      try { wx.hideLoading(); } catch (e) {}
      this.setData({ syncing: false });
    }
    const s = cloudstore.getState();
    if (s.loggedIn && !s.lastError) toast('同步完成', 'success');
    else if (!s.loggedIn) toast('本地模式，数据已存本机');
    else toast('同步异常，请稍后重试');
    this.refreshSyncState();
  },

  setRange(e) { this.setData({ exportRange: e.currentTarget.dataset.key }); },

  exportCSV() {
    const r = this.data.exportRange;
    let start, end = D.today();
    if (r === 'week') start = D.weekStart(D.today());
    else if (r === 'month') start = D.monthStart(D.today());
    else if (r === 'year') start = D.yearStart(D.today());
    else start = '2000-01-01';
    const csv = store.exportCSV(start, end);
    try {
      const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
      const base = (wx.env && wx.env.USER_DATA_PATH) || 'wxfile://usr';
      const path = base + '/gg-checkin-' + r + '-' + D.today() + '.csv';
      if (!fs || typeof fs.writeFileSync !== 'function') throw new Error('NO_FS');
      // 加 BOM 以便 Excel 正确识别中文
      fs.writeFileSync(path, '\uFEFF' + csv, 'utf8');
      this.setData({ exportPath: path, exportReady: true, exportFallback: false });
      toast('已生成 CSV 文件', 'success');
    } catch (err) {
      // 预览环境无文件系统：把明细复制到剪贴板，导出功能仍然可用
      try { wx.setClipboardData({ data: csv }); } catch (e) {}
      this.setData({ exportPath: '', exportReady: true, exportFallback: true });
      toast('当前环境不支持写文件，已复制明细');
    }
  },

  copyExportPath() {
    if (this.data.exportFallback) { toast('明细已复制，无需复制路径'); return; }
    if (!this.data.exportPath) return;
    // 「复制路径」会写入剪切板，属于隐私接口；未同意指引前先询问
    if (!privacy.hasAgreed()) {
      wx.showModal({
        title: '需要先同意隐私指引',
        content: '「复制路径」会用到剪切板。请先阅读并同意《用户隐私保护指引》后再使用。',
        confirmText: '去查看',
        cancelText: '取消',
        success: (res) => { if (res.confirm) wx.navigateTo({ url: '/pages/privacy/privacy' }); },
      });
      return;
    }
    wx.setClipboardData({ data: this.data.exportPath, success: () => wx.showToast({ title: '路径已复制', icon: 'success' }) });
  },

  handleMenu(e) {
    const { key, path } = e.currentTarget.dataset;
    if (key === 'about') {
      wx.showModal({
        title: '果果家庭打卡',
        content: '版本 v' + this.data.version + '\n课程、学习与运动打卡及周/月/年报表分析\n登录微信后，家庭数据自动同步到云端，换设备也能查看。',
        showCancel: false,
      });
      return;
    }
    if (key === 'privacyStatus') {
      wx.showModal({
        title: '隐私同意状态',
        content: privacy.hasAgreed() ? '你已同意《用户隐私保护指引》 v' + privacy.VERSION + '。可在指引页底部撤回同意。' : '尚未同意《用户隐私保护指引》，涉及剪切板的功能暂不可用。',
        showCancel: false,
      });
      return;
    }
    if (path) wx.navigateTo({ url: path });
  },

  onShareAppMessage() {
    // 分享默认指向访客只读快照，绝不把可写首页/家庭码分享出去
    let token = '';
    try { const t = wx.getStorageSync('gg_visitor_link'); token = t && t.token ? t.token : ''; } catch (e) {}
    if (token) {
      return {
        title: '果果家庭打卡 · 本周概览（只读）',
        path: '/pages/guest/guest?token=' + encodeURIComponent(token),
      };
    }
    return {
      title: '果果家庭打卡 · 一起坚持每一天',
      path: '/pages/family/family',
    };
  },
});
