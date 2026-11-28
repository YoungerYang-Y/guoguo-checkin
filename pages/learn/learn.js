// 今日学习页：两个 tab（今日 / 记录）。
// 今日 = 分类型新学配额 + 到期复习 + 今日已录；记录 = 按日期倒序日志 + 撤销。
// 数据来源统一 learning.js；录入弹层内嵌库搜索，不跳转外部页面（库入口全局只在 growth）。
const learning = require('../../utils/learning.js');
const contentSeed = require('../../utils/content-seed.js');
const app = getApp();

const KIND_LABEL = { poem: '诗词', english: '英语' };
const RESULT_OPTIONS = [
  { key: 'pass', label: '通过' },
  { key: 'fuzzy', label: '模糊' },
  { key: 'fail', label: '没记住' },
];

Page({
  data: {
    tab: 'today',
    date: '',
    learn: [],
    review: [],
    stats: { poemLearn: 0, englishLearn: 0, due: 0 },
    todayLogs: [],
    canEdit: true,
    loading: true,

    // 录入弹层
    showRecord: false,
    source: 'library',        // library | temp
    recType: 'poem',
    recKind: 'learn',         // learn | review
    recResult: 'pass',
    addToLibrary: true,
    selected: [],             // [{id, label, type}]
    libKeyword: '',
    libResults: [],
    tempPrimary: '',
    tempSecondary: '',
    tempBody: '',
    focusField: '',          // P2-1：字段聚焦状态，初始声明
    resultOptions: RESULT_OPTIONS,
    kindLabel: KIND_LABEL,
  },

  onShow() {
    // growth → learn 用 globalData 一次性信号定位 tab（switchTab 不支持 query）
    const target = app && app.globalData && app.globalData.learnTab;
    if (target) {
      app.globalData.learnTab = '';
      this.setData({ tab: target });
    }
    this.build();
  },

  build() {
    try {
      const plan = learning.todayPlan();
      const logs = learning.logsByDate(plan.date);
      this.setData({
        date: plan.date,
        learn: plan.learn || [],
        review: plan.review || [],
        stats: plan.stats || { poemLearn: 0, englishLearn: 0, due: 0 },
        todayLogs: logs,
        canEdit: learning.canRecord(),
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false, canEdit: false });
    }
  },

  switchTab(e) {
    const tab = (e.currentTarget.dataset && e.currentTarget.dataset.tab) || 'today';
    this.setData({ tab: tab });
  },

  // P2-3：内容库入口全局只在 growth 一处，learn 页不再重复放按钮。

  // ---------- 录入弹层 ----------
  openRecord() {
    if (!this.data.canEdit) {
      wx.showToast({ title: '当前为只读模式', icon: 'none' });
      return;
    }
    this.setData({
      showRecord: true, source: 'library', recType: this.data.recType,
      recKind: 'learn', recResult: 'pass', addToLibrary: true,
      selected: [], libKeyword: '', libResults: [],
      tempPrimary: '', tempSecondary: '', tempBody: '', focusField: '',
    }, () => this.searchLibrary());
  },
  closeRecord() {
    this.setData({ showRecord: false, focusField: '' });
  },
  // 阻止弹层内点击穿透
  noop() {},

  setSource(e) {
    this.setData({ source: e.currentTarget.dataset.source || 'library' });
  },
  setType(e) {
    this.setData({ recType: e.currentTarget.dataset.type || 'poem', selected: [], libKeyword: '' }, () => this.searchLibrary());
  },
  setKind(e) {
    this.setData({ recKind: e.currentTarget.dataset.kind || 'learn' });
  },
  setResult(e) {
    this.setData({ recResult: e.currentTarget.dataset.result || 'pass' });
  },
  toggleAddToLibrary(e) {
    // P2-2：显式解析布尔，避免 dataset 传字符串 "false" 时被 !! 误判为 true
    const v = e.currentTarget.dataset.value;
    this.setData({ addToLibrary: v === true || v === 'true' });
  },

  onKeywordInput(e) {
    this.setData({ libKeyword: e.detail.value || '' }, () => this.searchLibrary());
  },
  searchLibrary() {
    const list = learning.library({ type: this.data.recType, keyword: this.data.libKeyword });
    const picked = this.data.selected;
    const marked = list.slice(0, 30).map(x => Object.assign({}, x, { selected: picked.some(y => y.id === x.id) }));
    this.setData({ libResults: marked });
  },
  toggleSelect(e) {
    const id = e.currentTarget.dataset.id;
    const label = e.currentTarget.dataset.label || '';
    const selected = this.data.selected.slice();
    const idx = selected.findIndex(x => x.id === id);
    if (idx >= 0) selected.splice(idx, 1);
    else selected.push({ id: id, label: label, type: this.data.recType });
    const libResults = this.data.libResults.map(x =>
      x.id === id ? Object.assign({}, x, { selected: idx < 0 }) : x);
    this.setData({ selected: selected, libResults: libResults });
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    this.setData({ [field]: e.detail.value || '' });
  },
  onFieldFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (ds.field && this.data.focusField !== ds.field) this.setData({ focusField: ds.field });
  },
  onFieldBlur() { if (this.data.focusField) this.setData({ focusField: '' }); },

  saveRecord() {
    const d = this.data;
    const operator = this.operatorName();
    let payload;
    if (d.source === 'temp') {
      const primary = String(d.tempPrimary || '').trim();
      if (!primary) { wx.showToast({ title: '请填写标题', icon: 'none' }); return; }
      payload = {
        temp: [{ type: d.recType, primary: primary, secondary: d.tempSecondary, body: d.tempBody }],
        kind: d.recKind, result: d.recResult, operator: operator,
        addToLibrary: d.addToLibrary,
      };
    } else {
      if (!d.selected.length) { wx.showToast({ title: '请先选择内容', icon: 'none' }); return; }
      payload = {
        ids: d.selected.map(x => x.id),
        kind: d.recKind, result: d.recResult, operator: operator,
        addToLibrary: false,
      };
    }
    const r = learning.record(payload);
    if (r.error) {
      wx.showToast({ title: r.error === 'FORBIDDEN' ? '当前为只读模式' : '保存失败，请重试', icon: 'none' });
      return;
    }
    wx.showToast({ title: '已记录' });
    this.setData({ showRecord: false, focusField: '' });
    this.build();
  },

  operatorName() {
    try {
      const id = require('../../utils/family.js').getIdentity();
      if (id && id.memberKey) return require('../../utils/family.js').identityLabel(id.memberKey);
    } catch (e) {}
    return '家人';
  },

  // 今日条目：直接标记一次（默认通过）
  // N4：按列表来源区分动作——新学记 learn、复习记 review，口径不再污染。
  quickPass(e) {
    if (!this.data.canEdit) return;
    const ds = e.currentTarget.dataset || {};
    const id = ds.id;
    if (!id) return;
    const kind = ds.kind === 'learn' ? 'learn' : 'review';
    const r = learning.record({ ids: [id], kind: kind, result: 'pass', operator: this.operatorName() });
    if (r.error) { wx.showToast({ title: '记录失败', icon: 'none' }); return; }
    wx.showToast({ title: '已标记通过' });
    this.build();
  },

  undoLog(e) {
    if (!this.data.canEdit) return;
    const id = e.currentTarget.dataset.id;
    const r = learning.undoLog(id);
    if (r.error === 'STALE_LOG') {
      wx.showModal({ title: '这条记录已不是最新', content: '已标记为撤销，但不会覆盖更新的学习进度。', showCancel: false });
      this.build();
      return;
    }
    if (r.error) { wx.showToast({ title: '撤销失败', icon: 'none' }); return; }
    wx.showToast({ title: '已撤销' });
    this.build();
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/learn-library/learn-library?id=' + encodeURIComponent(id) });
  },
});
