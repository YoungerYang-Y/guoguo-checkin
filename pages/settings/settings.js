const store = require('../../utils/store.js');
const { ITEMS, GUOGUO_ITEMS, PARENT_ITEMS } = require('../../utils/constants.js');
const family = require('../../utils/family.js');

const DOWS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

Page({
  data: {
    dows: DOWS,
    scheduleRows: [],
    targetRows: [],
    members: [],
    remindTime: '20:30',
    remindEnabled: false,
    weekRemind: true,
    editNameId: '',
    editNameValue: '',
    canManage: true,   // 是否管理员：H5 预览无身份时默认可管理，入家庭后按角色判定
  },

  onShow() {
    const id = family.getIdentity();
    this.setData({ canManage: !(id && id.status === 'active') || id.role === 'admin' });
    this.build();
  },

  requireAdmin() {
    if (this.data.canManage) return true;
    wx.showToast({ title: '仅管理员可修改排期/目标', icon: 'none' });
    return false;
  },

  build() {
    const sched = store.getSchedule();
    const targets = store.getTargets();
    const settings = store.getSettings();
    const scheduleRows = GUOGUO_ITEMS.concat(PARENT_ITEMS).map(code => ({
      code, name: ITEMS[code].name,
      days: [1, 2, 3, 4, 5, 6, 7].map(d => ({ d, label: DOWS[d - 1], on: !!sched[code][d] })),
    }));
    const targetCodes = ['G-ART', 'G-MEMBER', 'G-SKATE', 'G-SWIM', 'P-AI', 'P-WORD', 'P-SWIM'];
    const targetRows = targetCodes.map(code => ({ code, name: ITEMS[code].name, value: targets[code], unit: code === 'G-MEMBER' ? '节' : (code === 'P-WORD' ? '天' : '次') }));
    this.setData({
      scheduleRows, targetRows,
      members: store.getFamily().members,
      remindTime: settings.remindTime,
      remindEnabled: settings.remindEnabled,
      weekRemind: settings.weekRemind,
    });
  },

  toggleRequired(e) {
    if (!this.requireAdmin()) return;
    const { code, d } = e.currentTarget.dataset;
    const row = this.data.scheduleRows.find(r => r.code === code);
    const day = row.days.find(x => x.d === d);
    store.setRequired(code, d, day.on ? 0 : 1);
    this.build();
    wx.showToast({ title: '排期已更新（不影响历史报表）', icon: 'none' });
  },

  onTargetInput(e) {
    const code = e.currentTarget.dataset.code;
    const value = e.detail.value;
    const rows = this.data.targetRows.map(r => r.code === code ? Object.assign({}, r, { value }) : r);
    this.setData({ targetRows: rows });
  },
  saveTarget(e) {
    if (!this.requireAdmin()) return;
    const code = e.currentTarget.dataset.code;
    const row = this.data.targetRows.find(r => r.code === code);
    store.setTarget(code, row.value);
    wx.showToast({ title: '目标已从下周期生效', icon: 'success' });
  },

  onRemindTime(e) { this.setData({ remindTime: e.detail.value }); },
  saveSettings() {
    store.setSettings({ remindTime: this.data.remindTime, remindEnabled: this.data.remindEnabled, weekRemind: this.data.weekRemind });
    wx.showToast({ title: '提醒设置已保存', icon: 'success' });
  },
  toggleRemind() { this.setData({ remindEnabled: !this.data.remindEnabled }); },
  toggleWeekRemind() { this.setData({ weekRemind: !this.data.weekRemind }); },

  editName(e) {
    const { id, name } = e.currentTarget.dataset;
    this.setData({ editNameId: id, editNameValue: name });
  },
  onNameInput(e) { this.setData({ editNameValue: e.detail.value }); },
  saveName() {
    if (!this.data.editNameValue.trim()) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return; }
    store.updateMemberName(this.data.editNameId, this.data.editNameValue.trim());
    this.setData({ editNameId: '' });
    this.build();
    wx.showToast({ title: '昵称已更新', icon: 'success' });
  },
  cancelName() { this.setData({ editNameId: '' }); },

  goCustomTargets() { wx.navigateTo({ url: '/pages/target-edit/target-edit?list=1' }); },

  resetData() {
    if (!this.requireAdmin()) return;
    wx.showModal({
      title: '清空所有数据',
      content: '将删除全部打卡记录、排期与目标，且不可恢复。确定继续吗？',
      confirmText: '清空', confirmColor: '#d93026',
      success: (res) => {
        if (!res.confirm) return;
        store.resetAll();
        this.build();
        wx.showToast({ title: '已清空', icon: 'success' });
      },
    });
  },
});
