const store = require('../../utils/store.js');
const D = require('../../utils/date.js');
const family = require('../../utils/family.js');

const CYCLE_TYPES = [
  { key: 'daily', label: '每日' },
  { key: 'weekly', label: '每周 N 次' },
  { key: 'monthly', label: '每月 N 次' },
  { key: 'once', label: '一次性' },
];

function toast(title) { try { wx.showToast({ title, icon: 'none' }); } catch (e) {} }

Page({
  // 输入聚焦反馈：WXSS 无 :focus，只能由事件切换 class
  onFieldFocus() { if (!this.data.fieldFocus) this.setData({ fieldFocus: true }); },
  onFieldBlur() { if (this.data.fieldFocus) this.setData({ fieldFocus: false }); },
  data: {
    mode: 'create',
    members: [],
    memberChips: [],
    cycleTypes: CYCLE_TYPES,
    list: [],
    form: {
      name: '', member_ids: ['guoguo'], cycle_type: 'daily', cycle_value: 1,
      standard_note: '', count_mode: 0, start_date: '', end_date: '',
    },
    showCountValue: false,
    editingId: '',
    selectedMemberLabel: '果果',
    selectedMemberCount: 1,
  },

  onLoad(options) {
    this.setData({ mode: options && options.list === '1' ? 'list' : 'create' });
  },
  onShow() {
    store.initFamily();
    const members = store.getFamily().members;
    const identity = family.getIdentity();
    const fam = require('../../utils/family.js');
    const can = typeof fam.isManager === 'function' ? fam.isManager(identity)
      : !!(identity && identity.status === 'active' && ['creator', 'admin'].indexOf(identity.role) >= 0);
    this._memberOnly = identity && identity.status === 'active' && !can ? identity.memberKey : '';
    const ids = this._memberOnly && !this.data.editingId ? [this._memberOnly] : (this.data.form.member_ids || ['guoguo']);
    this.setData({ 'form.member_ids': ids });
    this.setData({
      members,
      memberChips: members.map(m => Object.assign({}, m, { on: ids.indexOf(m.id) >= 0 })),
      selectedMemberLabel: this.memberLabel(ids, members),
      selectedMemberCount: ids.length,
      list: store.getCustomTargets().map(t => Object.assign({}, t, {
        memberNames: store.targetMemberIds(t).map(id => (members.find(m => m.id === id) || {}).name || id).join('、'),
        memberCount: store.targetMemberIds(t).length,
        canEdit: store.canEditTarget(t),
        cycleLabel: (CYCLE_TYPES.find(c => c.key === t.cycle_type) || {}).label || t.cycle_type,
      })),
      'form.start_date': this.data.form.start_date || D.today(),
    });
  },

  memberLabel(ids, members) {
    const list = members || this.data.members || [];
    return list.filter(m => ids.indexOf(m.id) >= 0).map(m => m.name).join('、') || '未选择';
  },
  syncMemberChips(ids) {
    const list = this.data.members || [];
    this.setData({
      memberChips: list.map(m => Object.assign({}, m, { on: ids.indexOf(m.id) >= 0 })),
      selectedMemberLabel: this.memberLabel(ids, list),
      selectedMemberCount: ids.length,
    });
  },

  setMode(mode) { this.setData({ mode }); },
  cancelAutoBack() { if (this._backTimer) { clearTimeout(this._backTimer); this._backTimer = null; } },
  switchToCreate() {
    this.cancelAutoBack();
    const ids = [this._memberOnly || 'guoguo'];
    this.setData({
      mode: 'create', editingId: '', showCountValue: false,
      form: { name: '', member_ids: ids, cycle_type: 'daily', cycle_value: 1, standard_note: '', count_mode: 0, start_date: D.today(), end_date: '' },
    });
    this.syncMemberChips(ids);
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },
  selectMember(e) {
    const id = e.currentTarget.dataset.id;
    if (this._memberOnly && id !== this._memberOnly) { toast('成员只能为自己管理目标'); return; }
    const ids = (this.data.form.member_ids || []).slice();
    const i = ids.indexOf(id);
    if (i >= 0) {
      if (ids.length === 1) { toast('至少保留一位成员'); return; }
      ids.splice(i, 1);
    } else ids.push(id);
    this.setData({ 'form.member_ids': ids });
    this.syncMemberChips(ids);
  },
  selectCycle(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ 'form.cycle_type': key, showCountValue: key === 'weekly' || key === 'monthly' });
  },
  selectCountMode(e) { this.setData({ 'form.count_mode': Number(e.currentTarget.dataset.v) }); },
  onCountInput(e) { this.setData({ 'form.cycle_value': e.detail.value }); },
  onStartDate(e) { this.setData({ 'form.start_date': e.detail.value }); },
  onEndDate(e) { this.setData({ 'form.end_date': e.detail.value }); },

  save() {
    const f = this.data.form;
    const ids = (f.member_ids || []).slice();
    if (!f.name || !f.name.trim()) { toast('请填写目标名称'); return; }
    if (f.name.trim().length > 10) { toast('名称不超过 10 字'); return; }
    if (!ids.length) { toast('请至少选择一位成员'); return; }
    if (!f.standard_note || !f.standard_note.trim()) { toast('请填写可判定的完成标准'); return; }
    if (f.standard_note.trim().length > 50) { toast('标准不超过 50 字'); return; }
    let value = f.cycle_value;
    if (this.data.showCountValue) {
      value = Number(value);
      if (!value || value < 1) { toast('次数需大于 0'); return; }
    } else value = 1;

    const label = this.memberLabel(ids);
    const payload = {
      name: f.name.trim(), member_ids: ids,
      cycle_type: f.cycle_type, cycle_value: value,
      standard_note: f.standard_note.trim(), count_mode: f.count_mode,
      start_date: f.start_date, end_date: f.end_date,
    };

    if (this.data.editingId) {
      const res = store.updateCustomTarget(this.data.editingId, payload);
      if (res.error) { toast(res.error === 'FORBIDDEN' ? '只能修改自己创建的目标' : '保存失败'); return; }
      try { wx.showToast({ title: '已更新 · ' + label, icon: 'success' }); } catch (e) {}
    } else {
      const res = store.createCustomTarget(payload);
      const errMap = {
        FORBIDDEN: '成员只能为自己创建目标',
        NO_MEMBER: '请至少选择一位成员',
        TARGET_LIMIT: '每位成员最多 10 个进行中目标',
        DUPLICATE_NAME: '所选成员中已有同名目标',
        EMPTY_STANDARD: '请填写可判定的完成标准',
      };
      if (res.error) { toast(errMap[res.error] || '保存失败'); return; }
      try { wx.showToast({ title: '已创建 · ' + label, icon: 'success' }); } catch (e) {}
    }
    this.setData({ mode: 'list', editingId: '' });
    this.onShow();
    // 保存后立即回到打卡首页：首页 onShow 会重新拉取目标，所选成员的打卡区马上出现该目标
    this._backTimer = setTimeout(() => {
      wx.switchTab({
        url: '/pages/index/index',
        fail: () => { toast('请从底部「今日打卡」返回'); },
      });
    }, 650);
  },

  editTarget(e) {
    this.cancelAutoBack();
    const id = e.currentTarget.dataset.id;
    const t = store.getCustomTarget(id);
    if (!t) return;
    if (!store.canEditTarget(t)) { toast('只能修改自己创建的目标'); return; }
    const ids = store.targetMemberIds(t);
    this.setData({
      mode: 'create', editingId: id, showCountValue: t.cycle_type === 'weekly' || t.cycle_type === 'monthly',
      form: {
        name: t.name, member_ids: ids, cycle_type: t.cycle_type, cycle_value: t.cycle_value,
        standard_note: t.standard_note, count_mode: t.count_mode, start_date: t.start_date, end_date: t.end_date,
      },
    });
    this.syncMemberChips(ids);
  },
  archiveTarget(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '归档目标', content: '归档从下一周期生效，历史记录与报表保留。确定吗？',
      success: (res) => {
        if (!res.confirm) return;
        const result = store.archiveCustomTarget(id);
        if (result.error) { toast(result.error === 'FORBIDDEN' ? '只能管理自己创建的目标' : '归档失败'); return; }
        this.onShow();
        toast('已安排下周期归档');
      },
    });
  },

  goIndex() { wx.switchTab({ url: '/pages/index/index' }); },
});
