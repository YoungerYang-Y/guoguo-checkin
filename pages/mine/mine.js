const store = require('../../utils/store.js');
const cloudstore = require('../../utils/cloudstore.js');
const privacy = require('../../utils/privacy.js');
const family = require('../../utils/family.js');

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
    memberCount: '—',
    menuGroups: [
      { key: 'records', title: '学习与成长', items: [
        { key: 'weight', text: '体重与身高', path: '/pages/weight/weight' },
        { key: 'fees', text: '培训费', path: '/pages/fees/fees' },
        { key: 'poems', text: '古诗与每周复习', path: '/pages/poems/poems' },
        { key: 'words', text: '单词句子与每周复习', path: '/pages/words/words' },
      ]},
      { key: 'data', title: '设置与数据', items: [
        { key: 'settings', text: '排期、周目标与提醒', path: '/pages/settings/settings' },
        { key: 'targets', text: '自定义目标管理', path: '/pages/target-edit/target-edit?list=1' },
        { key: 'export', text: '导出打卡明细', path: '/pages/export/export' },
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
    const ready = () => { this.refreshSyncState(); this.refreshCounts(); this.loadMemberCount(); };
    if (app.cloudReady && typeof app.cloudReady.then === 'function') app.cloudReady.then(ready);
    else ready();
    cloudstore.onStateChange(state => { this.refreshSyncState(state); this.refreshCounts(); });
  },
  onShow() {
    this.refreshCounts();
    this.refreshSyncState();
    this.loadMemberCount();
  },

  refreshCounts() {
    this.setData({
      recordCount: store.getRecords().filter(r => r.status === 1).length,
      targetCount: store.getCustomTargets().filter(t => t.status === 1).length,
    });
  },

  refreshSyncState(state) {
    const s = state || cloudstore.getState();
    let label, detail, dotClass, hint = '';
    if (!s.ready) {
      label = '正在连接云服务…'; detail = '首次启动同步中'; dotClass = 'dot-pending';
    } else if (s.loggedIn && !s.familyId) {
      label = s.lastError && !/^尚未加入家庭/.test(s.lastError) ? '连接待恢复' : '本机保存';
      detail = s.lastError || '加入家庭后可与家人同步数据'; dotClass = 'dot-warn';
    } else if (s.loggedIn) {
      if (s.syncing) { label = '正在同步'; detail = '数据上传中…'; dotClass = 'dot-pending'; }
      else if (s.lastError) { label = '同步异常'; detail = s.lastError; dotClass = 'dot-error'; }
      else if (s.dirty) { label = '等待同步'; detail = '本机有尚未上传的修改'; dotClass = 'dot-pending'; }
      else { label = '云端已同步'; detail = s.lastSync ? ('最近同步 ' + this.fmtTime(s.lastSync)) : '数据已保存到云端'; dotClass = 'dot-ok'; }
    } else {
      label = '本地模式'; detail = s.lastError || '未登录，数据仅保存在本机'; dotClass = 'dot-warn';
      hint = '当前记录已保存在本机，可以继续使用。连接成功并加入家庭后，再与家人同步。';
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
    if (s.loggedIn && s.familyId && !s.lastError) toast('同步完成', 'success');
    else if (s.loggedIn && !s.familyId) toast('请先在家庭管理中创建或加入家庭');
    else if (!s.loggedIn) toast('本地模式，数据已存本机');
    else toast('同步异常，请稍后重试');
    this.refreshSyncState();
    this.refreshCounts();
    this.loadMemberCount();
  },

  // 这里只统计已绑定微信身份的 active 账号，不把本地三个档案当作登录成员
  async loadMemberCount() {
    const id = family.getIdentity();
    if (!id || id.status !== 'active' || !id.familyId) {
      this.setData({ memberCount: '—' });
      return;
    }
    try {
      const list = await family.listMembers();
      const active = list.filter(m => m && m.status === 'active' && m.uid).length;
      this.setData({ memberCount: active });
    } catch (e) {}
  },

  goFamily() {
    wx.navigateTo({ url: '/pages/family/family' });
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
    // 右上角转发的快捷入口：指向访客只读快照，绝不把可写首页/家庭码分享出去。
    // 显式的邀请/访客分享按钮统一收口在家庭管理页，避免入口冗余。
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
