const store = require('../../utils/store.js');
const { ITEMS, GUOGUO_ITEMS, PARENT_ITEMS } = require('../../utils/constants.js');

const DOWS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DOW_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

// 行式摘要：把 7 天的开关压成一句人话，代替原来的 7×N 小方格矩阵
function summarize(days) {
  const on = days.filter(d => d.on).map(d => d.d);
  if (!on.length) return '全周选修';
  if (on.length === 7) return '每天必修';
  return '周' + on.map(d => DOW_SHORT[d - 1]).join('、') + ' 必修';
}

Page({
  // 输入聚焦反馈：WXSS 无 :focus，只能由事件切换 class
  onFieldFocus() { if (!this.data.fieldFocus) this.setData({ fieldFocus: true }); },
  onFieldBlur() { if (this.data.fieldFocus) this.setData({ fieldFocus: false }); },
  data: {
    scheduleRows: [],
    targetRows: [],
    members: [],
    remindTime: '20:30',
    remindEnabled: false,
    weekRemind: true,
    editNameId: '',
    editNameValue: '',
    schedCode: '',          // 正在编辑排期的打卡项
    schedName: '',
    schedDays: [],
    canManage: true,   // 是否管理员：H5 预览无身份时默认可管理，入家庭后按角色判定
  },

  onShow() {
    this.setData({ canManage: store.canManage() });
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
    const scheduleRows = GUOGUO_ITEMS.concat(PARENT_ITEMS).map(code => {
      const days = [1, 2, 3, 4, 5, 6, 7].map(d => ({ d, label: DOWS[d - 1], on: !!sched[code][d] }));
      return {
        code,
        name: ITEMS[code].name,
        days,
        summary: summarize(days),
        onCount: days.filter(d => d.on).length,
      };
    });
    const targetCodes = ['G-ART', 'G-MEMBER', 'G-SKATE', 'G-SWIM', 'P-AI', 'P-WORD', 'P-SWIM'];
    const targetRows = targetCodes.map(code => ({ code, name: ITEMS[code].name, value: targets[code], unit: code === 'G-MEMBER' ? '节' : (code === 'P-WORD' ? '天' : '次') }));
    this.setData({
      scheduleRows, targetRows,
      members: store.getFamily().members.map(m => Object.assign({}, m, {
        roleLabel: m.role === 'admin' ? '管理员' : '成员',
      })),
      remindTime: settings.remindTime,
      remindEnabled: settings.remindEnabled,
      weekRemind: settings.weekRemind,
    });
  },

  // 打开某项的逐天排期弹层
  openSchedule(e) {
    if (!this.requireAdmin()) return;
    const code = e.currentTarget.dataset.code;
    const row = this.data.scheduleRows.find(r => r.code === code);
    if (!row) return;
    this.setData({
      schedCode: code,
      schedName: row.name,
      schedDays: row.days.map(d => Object.assign({}, d)),
    });
  },
  closeSchedule() { this.setData({ schedCode: '', schedName: '', schedDays: [] }); },

  // 弹层内逐天切换：改完立即写库并同步行摘要，不关弹层，方便连续勾选
  toggleSchedDay(e) {
    const d = Number(e.currentTarget.dataset.d);
    const day = this.data.schedDays.find(x => x.d === d);
    if (!day) return;
    const code = this.data.schedCode;
    const result = store.setRequired(code, d, day.on ? 0 : 1);
    if (result.error) { wx.showToast({ title: '保存失败，请检查身份', icon: 'none' }); return; }
    // 以写入后的真实排期为准回填，避免本地状态和存储不一致
    const sched = store.getSchedule();
    const days = this.data.schedDays.map(x => ({ d: x.d, label: x.label, on: !!sched[code][x.d] }));
    const scheduleRows = this.data.scheduleRows.map(r => (r.code === code
      ? Object.assign({}, r, { days, summary: summarize(days), onCount: days.filter(x => x.on).length })
      : r));
    this.setData({ schedDays: days, scheduleRows });
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
    const result = store.setTarget(code, row.value);
    if (result.error) { wx.showToast({ title: '保存失败，请检查身份', icon: 'none' }); return; }
    wx.showToast({ title: '目标下周起生效', icon: 'success' });
  },

  onRemindTime(e) { this.setData({ remindTime: e.detail.value }); },
  saveSettings() {
    if (!this.requireAdmin()) return;
    const result = store.setSettings({ remindTime: this.data.remindTime, remindEnabled: this.data.remindEnabled, weekRemind: this.data.weekRemind });
    if (result.error) { wx.showToast({ title: '保存失败，请检查身份', icon: 'none' }); return; }
    wx.showToast({ title: '提醒设置已保存', icon: 'success' });
  },
  toggleRemind() { this.setData({ remindEnabled: !this.data.remindEnabled }); },
  toggleWeekRemind() { this.setData({ weekRemind: !this.data.weekRemind }); },

  editName(e) {
    if (!this.requireAdmin()) return;
    const { id, name } = e.currentTarget.dataset;
    this.setData({ editNameId: id, editNameValue: name });
  },
  onNameInput(e) { this.setData({ editNameValue: e.detail.value }); },
  saveName() {
    if (!this.requireAdmin()) return;
    if (!this.data.editNameValue.trim()) { wx.showToast({ title: '昵称不能为空', icon: 'none' }); return; }
    const result = store.updateMemberName(this.data.editNameId, this.data.editNameValue.trim());
    if (result.error) { wx.showToast({ title: '改名失败，请检查身份', icon: 'none' }); return; }
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
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '清空中…', mask: true });
        try {
          const result = await store.resetAll();
          this.build();
          wx.showToast({ title: result.cleanupPending ? '已清空，待同步' : '已清空', icon: result.cleanupPending ? 'none' : 'success' });
        } catch (e) {
          wx.showToast({ title: (e && e.message) || '清空失败，请重试', icon: 'none' });
        } finally { wx.hideLoading(); }
      },
    });
  },
});
