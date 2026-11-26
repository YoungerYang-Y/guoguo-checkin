const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const D = require('../../utils/date.js');
const privacy = require('../../utils/privacy.js');
const family = require('../../utils/family.js');

Page({
  // 输入聚焦反馈：WXSS 无 :focus，只能由事件切换 class
  onFieldFocus() { if (!this.data.fieldFocus) this.setData({ fieldFocus: true }); },
  onFieldBlur() { if (this.data.fieldFocus) this.setData({ fieldFocus: false }); },
  data: {
    date: '',
    dateLabel: '',
    canPrev: true,
    canNext: false,
    isToday: true,
    summary: null,
    progress: 0,
    groups: [],
    loading: true,
    progressStyle: 'background: conic-gradient(#EC5B8C 0%, #F3E7ED 0%)',
    // 弹层
    sheet: null,          // 'session' | 'word' | 'metric' | 'note' | 'custom' | 'switch' | null
    sheetRow: null,
    sheetCtx: {},         // { memberId, code, isCustom, standard }
    sessionOptions: [2, 3],
    sessionChoice: 0,
    inputValue: '',
    inputValue2: '',
    inputNote: '',
    inputTheme: '',
    inputNoteLen: 0,
    inputThemeLen: 0,
    undoTimer: null,
    showUndo: false,
    lastUndo: null,
    // 代打卡确认
    confirmMember: '',
    confirmName: '',
    // 隐私指引同意
    showPrivacy: false,
    privacyPoints: privacy.POINTS,
    // 当前操作者（家庭内 member_key）与角色：本地预览默认 mama/admin，登录后由家庭身份覆盖
    operatorKey: 'mama',
    operatorRole: 'admin',
    operatorName: '妈妈',
  },

  onLoad(options) {
    store.initFamily();
    this.loadIdentity();
    const d = options && options.date ? options.date : D.today();
    this.setData({ date: d });
  },

  // 读取当前操作者身份：入家庭后按云端 member_key/role；未入家庭维持本机默认（兼容 H5 预览）
  loadIdentity() {
    const id = family.getIdentity();
    this.applyIdentity(id);
  },

  applyIdentity(id) {
    if (id && id.status === 'active' && id.memberKey) {
      const group = (this.data.groups || []).find(x => x.id === id.memberKey);
      this.setData({
        operatorKey: id.memberKey,
        operatorRole: id.role || 'parent',
        operatorName: (group && group.name) || id.name || '家人',
      });
    } else {
      this.resetOperator();
    }
  },

  resetOperator() {
    let hasAdoptedFamily = false;
    try { hasAdoptedFamily = !!wx.getStorageSync('gg_family_adopted'); } catch (e) {}
    this.setData({
      operatorKey: hasAdoptedFamily ? '' : 'mama',
      operatorRole: hasAdoptedFamily ? 'guest' : 'admin',
      operatorName: hasAdoptedFamily ? '' : '妈妈',
      confirmMember: '',
      confirmName: '',
      pending: null,
    });
  },

  onShow() {
    this.loadIdentity();
    const app = getApp();
    if (app && app.cloudReady && typeof app.cloudReady.then === 'function' && !this._identityRefreshPromise) {
      this._identityRefreshPromise = app.cloudReady
        .then(() => family.refreshIdentity())
        .then(id => this.applyIdentity(id))
        .catch(() => this.applyIdentity(family.getIdentity()))
        .finally(() => { this._identityRefreshPromise = null; });
    }
    // 日历页「查看/补卡」用 switchTab 进入，tabBar 跳转不能带参数，日期通过暂存值传递
    let pending = '';
    if (app && app.globalData && app.globalData.pendingCheckinDate) {
      pending = app.globalData.pendingCheckinDate;
      app.globalData.pendingCheckinDate = '';
    }
    if (!pending) {
      try { pending = wx.getStorageSync('gg_pending_checkin_date') || ''; } catch (e) {}
    }
    if (pending) { try { wx.removeStorageSync('gg_pending_checkin_date'); } catch (e) {} }
    if (/^\d{4}-\d{2}-\d{2}$/.test(pending) && pending <= D.today()) {
      this.setData({ date: pending }, () => this.refresh());
    } else {
      this.refresh();
    }
    // 首次使用或指引更新后，展示隐私指引同意弹层（本次启动内选「暂不」后不再重复打扰）
    if (!this._privacyDeclined && !privacy.hasAgreed()) {
      this.setData({ showPrivacy: true });
    } else {
      this.setData({ showPrivacy: false });
    }
    // 云端拉取覆盖本地后，刷新首屏以显示最新数据
    if (app.cloudReady && !this._cloudRefreshed) {
      app.cloudReady.then(() => {
        if (this.data && this.data.date !== undefined) {
          this._cloudRefreshed = true;
          this.refresh();
        }
      });
    }
  },

  refresh() {
    const date = this.data.date;
    const summary = stats.todaySummary(date);
    const groups = summary.groups.map(g => Object.assign({}, g, {
      accent: this.memberColor(g.id),
      rows: (g.rows || []).map(r => Object.assign({}, r, {
        noteShort: this.shortText(r.note, 28),
        themeShort: this.shortText(r.theme, 28),
      })),
    }));
    const wd = ['日', '一', '二', '三', '四', '五', '六'][D.parse(date).getDay()];
    const diff = D.diffDays(date, D.today());
    const dateLabel = (diff === 0 ? '今天' : diff === 1 ? '昨天' : D.parse(date).getMonth() + 1 + '月' + D.parse(date).getDate() + '日') + ' · 周' + wd;
    const progress = Math.round(summary.rate);
    this.setData({
      summary, groups, loading: false, dateLabel,
      progress: progress,
      progressStyle: 'background: conic-gradient(#EC5B8C ' + progress + '%, #F3E7ED ' + progress + '%)',
      isToday: date === D.today(),
      readOnly: !store.canBackfill(date),
      canNext: date < D.today(),
      canPrev: D.diffDays(D.addDays(date, -1), D.today()) <= 30,
    });
  },

  // 超出 7 天补卡期后只允许查看，不允许再写入/修改打卡
  canEditDate() {
    if (store.canBackfill(this.data.date)) return true;
    wx.showToast({ title: '超过 7 天补卡期，仅可查看', icon: 'none' });
    return false;
  },

  // 列表里只展示长文本的摘要，完整内容仍保存在记录中
  shortText(s, max) {
    const v = String(s || '').replace(/\s+/g, ' ').trim();
    return v.length > max ? v.slice(0, max) + '…' : v;
  },

  memberColor(id) {
    const map = { guoguo: { c: '#F58AAE', l: '#FFEDF4' }, papa: { c: '#61DDAA', l: '#E8F8F1' }, mama: { c: '#F6BD16', l: '#FFF6DC' } };
    return map[id] || map.guoguo;
  },

  changeDate(e) {
    const step = Number(e.currentTarget.dataset.step);
    const next = D.addDays(this.data.date, step);
    if (next > D.today()) return;
    this.setData({ date: next, loading: true }, () => this.refresh());
  },

  // 点击打卡行
  onRowTap(e) {
    const { member, code, kind, custom, standard } = e.currentTarget.dataset;
    const isCustom = custom === 'true' || custom === true;
    const done = this.isDone(member, code);
    if (done) {
      // 已完成：长按撤销，单击提示
      wx.showToast({ title: '长按 1 秒可撤销', icon: 'none' });
      return;
    }
    if (!this.canEditDate()) return;
    // 代打卡二次确认：只要是登录的家庭成员就能代签任何家人，与角色无关
    const currentOperator = this.data.operatorKey;
    if (member !== currentOperator) {
      if (!family.canProxy(family.getIdentity())) {
        wx.showToast({ title: '当前身份不能代签', icon: 'none' });
        return;
      }
      this.setData({ confirmMember: member, confirmName: this.memberName(member), pending: { code, kind, isCustom, standard } });
      return;
    }
    this.openForKind(member, code, kind, isCustom, standard);
  },

  memberName(id) {
    const g = this.data.groups.find(x => x.id === id);
    return g ? g.name : id;
  },

  confirmCheckin() {
    const { confirmMember: member, pending } = this.data;
    if (!pending || !this.canWriteMember(member)) return;
    this.setData({ confirmMember: '' });
    this.openForKind(member, pending.code, pending.kind, pending.isCustom, pending.standard);
  },
  cancelCheckin() { this.setData({ confirmMember: '' }); },

  canWriteMember(member) {
    const operator = this.data.operatorKey;
    // 统一判定：登录的家庭成员可写自己、可代签任何家人；不再按角色白名单区分
    if (!operator || !family.canProxy(family.getIdentity())) {
      wx.showToast({ title: '当前身份不能操作打卡', icon: 'none' });
      return false;
    }
    return true;
  },

  openForKind(member, code, kind, isCustom, standard) {
    this.setData({ sheetCtx: { memberId: member, code, isCustom, standard } });
    if (isCustom) {
      const t = store.getCustomTarget(code);
      this.setData({ sheet: 'custom', inputNote: '', inputNoteLen: 0, inputValue: '', sheetCtx: { memberId: member, code, isCustom, standard, name: t ? t.name : code } });
      return;
    }
    if (kind === 'session') {
      const rec = store.getRecord(member, code, this.data.date);
      this.setData({ sheet: 'session', sessionChoice: rec && rec.status === 1 && rec.session_count ? rec.session_count : 2 });
      return;
    }
    if (kind === 'word') {
      this.setData({ sheet: 'word', inputValue: '20' });
      return;
    }
    if (kind === 'metric') {
      this.setData({ sheet: 'metric', inputValue: '', inputValue2: '', inputNote: '', inputNoteLen: 0 });
      return;
    }
    if (kind === 'art' || kind === 'study') {
      this.setData({ sheet: 'metric', inputValue: '', inputValue2: '', inputTheme: '', inputThemeLen: 0, inputNote: '', inputNoteLen: 0 });
      return;
    }
    // 普通勾选
    this.doCheckin({});
  },

  onSessionChoose(e) {
    this.setData({ sessionChoice: Number(e.currentTarget.dataset.n) });
  },
  confirmSession() { this.doCheckin({ session_count: this.data.sessionChoice }); },
  onWordInput(e) { this.setData({ inputValue: e.detail.value }); },
  setWord15() { this.setData({ inputValue: '15' }); },
  setWord20() { this.setData({ inputValue: '20' }); },
  setWord25() { this.setData({ inputValue: '25' }); },
  setWord30() { this.setData({ inputValue: '30' }); },
  confirmWord() {
    const v = this.data.inputValue.trim();
    const num = v === '' ? 20 : Number(v);
    if (isNaN(num) || num < 0) { wx.showToast({ title: '请输入有效数量', icon: 'none' }); return; }
    this.doCheckin({ metric_value: num, unverified: v === '' });
  },
  onValueInput(e) { this.setData({ inputValue: e.detail.value }); },
  onValue2Input(e) { this.setData({ inputValue2: e.detail.value }); },
  onThemeInput(e) { const v = e.detail.value; this.setData({ inputTheme: v, inputThemeLen: v.length }); },
  onNoteInput(e) { const v = e.detail.value; this.setData({ inputNote: v, inputNoteLen: v.length }); },
  confirmMetric() {
    const patch = {};
    if (this.data.inputValue !== '') patch.metric_value = Number(this.data.inputValue) || 0;
    if (this.data.inputValue2 !== '') patch.metric_unit = this.data.inputValue2;
    if (this.data.inputTheme !== '') patch.theme = this.data.inputTheme.slice(0, 100);
    if (this.data.inputNote !== '') patch.note = this.data.inputNote.slice(0, 200);
    this.doCheckin(patch);
  },
  confirmCustom() {
    if (!this.canEditDate()) return;
    const { code, memberId } = this.data.sheetCtx;
    if (!this.canWriteMember(memberId)) return;
    const res = store.checkCustomTarget(code, memberId, this.data.date, true, this.data.inputNote.slice(0, 200));
    if (res.error) { wx.showToast({ title: '打卡失败，目标可能已归档', icon: 'none' }); return; }
    this.closeSheet();
    this.refresh();
    wx.showToast({ title: '已按标准完成', icon: 'success' });
  },

  doCheckin(patch) {
    if (!this.canEditDate()) { this.closeSheet(); return; }
    const { memberId, code } = this.data.sheetCtx;
    if (!this.canWriteMember(memberId)) { this.closeSheet(); return; }
    const isBackfill = this.data.date !== D.today();
    const result = store.saveRecord(Object.assign({
      member_id: memberId,
      item_code: code,
      biz_date: this.data.date,
      status: 1,
      source: isBackfill ? 2 : 1,
      operator: this.data.operatorKey,
    }, patch));
    if (result && result.error) { wx.showToast({ title: '保存失败，请检查身份或存储空间', icon: 'none' }); return; }
    this.closeSheet();
    this.refresh();
    wx.showToast({ title: '已保存', icon: 'success', duration: 600 });
  },

  // 长按撤销
  onRowLongPress(e) {
    const { member, code } = e.currentTarget.dataset;
    if (!this.isDone(member, code)) return;
    if (!this.canEditDate()) return;
    if (!this.canWriteMember(member)) return;
    wx.showModal({
      title: '撤销打卡',
      content: '确定撤销这一项吗？撤销后 3 秒内可恢复。',
      confirmText: '撤销', confirmColor: '#d93026',
      success: (res) => {
        if (!res.confirm) return;
        const rec = store.getRecord(member, code, this.data.date);
        const result = store.revokeRecord(member, code, this.data.date);
        if (result && result.error) { wx.showToast({ title: '撤销失败，请重试', icon: 'none' }); return; }
        this.setData({ showUndo: true, lastUndo: { member, code, rec, date: this.data.date } });
        this.refresh();
        const timer = setTimeout(() => this.setData({ showUndo: false, lastUndo: null }), 3000);
        this.setData({ undoTimer: timer });
      },
    });
  },
  undoRevoke() {
    const u = this.data.lastUndo;
    if (!u) return;
    if (!this.canWriteMember(u.member)) return;
    const result = store.saveRecord(Object.assign({}, u.rec, { status: 1, updated_at: new Date().toISOString() }));
    if (result && result.error) { wx.showToast({ title: '恢复失败，请重试', icon: 'none' }); return; }
    clearTimeout(this.data.undoTimer);
    this.setData({ showUndo: false, lastUndo: null });
    this.refresh();
    wx.showToast({ title: '已恢复', icon: 'success' });
  },

  isDone(member, code) {
    const g = this.data.groups.find(x => x.id === member);
    if (!g) return false;
    const rows = g.rows.concat(g.custom || []);
    const r = rows.find(x => x.code === code);
    return r ? r.done : false;
  },

  // 家长区一键完成
  finishAll(e) {
    if (!this.canEditDate()) return;
    const member = e.currentTarget.dataset.member;
    if (!this.canWriteMember(member)) return;
    const g = this.data.groups.find(x => x.id === member);
    if (!g) return;
    if (member !== this.data.operatorKey) {
      wx.showToast({ title: '代打卡需二次确认', icon: 'none' });
      return;
    }
    let failed = false;
    g.rows.forEach(r => {
      if (r.done) return;
      const patch = r.kind === 'word' ? { metric_value: 20 } : {};
      const result = store.saveRecord(Object.assign({ member_id: member, item_code: r.code, biz_date: this.data.date, status: 1, source: this.data.date === D.today() ? 1 : 2, operator: this.data.operatorKey }, patch));
      if (result && result.error) failed = true;
    });
    this.refresh();
    wx.showToast({ title: failed ? '部分未保存，请重试' : '本区已全部完成', icon: failed ? 'none' : 'success' });
  },

  openPrivacy() {
    this._privacyDeclined = true;
    this.setData({ showPrivacy: false });
    wx.navigateTo({ url: '/pages/privacy/privacy' });
  },
  agreePrivacy() { privacy.setAgreed(); this.setData({ showPrivacy: false }); },
  laterPrivacy() { this._privacyDeclined = true; this.setData({ showPrivacy: false }); },

  closeSheet() { this.setData({ sheet: null, sheetCtx: {}, inputNote: '', inputTheme: '', inputNoteLen: 0, inputThemeLen: 0, inputValue: '', inputValue2: '' }); },
  preventMove() {},

  goCalendar() { wx.switchTab({ url: '/pages/calendar/calendar' }); },
  goReport() {
    // 周日 20:00 后提示周报入口
    wx.switchTab({ url: '/pages/report/report' });
  },
  goAddTarget() {
    wx.navigateTo({ url: '/pages/target-edit/target-edit' });
  },
  onShareAppMessage() {
    // 绝不把可写首页/家庭码分享出去：有访客链接则分享只读快照，否则引导到家庭管理页
    let token = '';
    try { const t = wx.getStorageSync('gg_visitor_link'); token = t && t.token ? t.token : ''; } catch (e) {}
    if (token) {
      return { title: '果果家庭打卡 · 本周概览（只读）', path: '/pages/guest/guest?token=' + encodeURIComponent(token) };
    }
    return { title: '果果家庭打卡 · 一起坚持每一天', path: '/pages/family/family' };
  },
});
