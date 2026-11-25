const extra = require('../../utils/extra.js');
const D = require('../../utils/date.js');

function toast(title) { try { wx.showToast({ title, icon: 'none' }); } catch (e) {} }

Page({
  // 输入聚焦反馈：WXSS 无 :focus，只能由事件切换 class
  onFieldFocus() { if (!this.data.fieldFocus) this.setData({ fieldFocus: true }); },
  onFieldBlur() { if (this.data.fieldFocus) this.setData({ fieldFocus: false }); },
  data: {
    tab: 'add',
    year: Number(D.today().slice(0, 4)),
    years: [],
    monthKeys: [], monthLabels: [], monthIndex: 0, ym: '',
    categoryNames: extra.FEE_CATEGORIES.map(c => c.name),
    categoryKeys: extra.FEE_CATEGORIES.map(c => c.key),
    categoryIndex: 0,
    form: { amount: '', note: '' },
    month: { totalText: '0', rows: [], list: [], count: 0 },
    yearData: { totalText: '0', prevTotalText: '0', diffLabel: '—', diffText: '0', diffWord: '增加', months: [], categories: [], count: 0 },
    totals: { rows: [], sumText: '0' },
    ageData: null,
    birthYm: '', birthInput: '',
    pieStyle: '', yearPieStyle: '',
    recent: [],
  },

  onLoad() {
    const now = D.today();
    const y = Number(now.slice(0, 4)), m = Number(now.slice(5, 7));
    const keys = [], labels = [];
    for (let i = 0; i < 36; i++) {
      let yy = y, mm = m - i;
      while (mm <= 0) { mm += 12; yy--; }
      keys.push(extra.ymOf(yy, mm));
      labels.push(yy + ' 年 ' + mm + ' 月');
    }
    const s = extra.getExtraSettings();
    this.setData({
      monthKeys: keys, monthLabels: labels, monthIndex: 0, ym: keys[0],
      birthYm: s.guoguoBirth || '', birthInput: s.guoguoBirth || '',
    });
    this.refresh();
  },
  onShow() { if (this.data.monthKeys.length) this.refresh(); },

  refresh() {
    const years = extra.feeYears();
    let year = this.data.year;
    if (years.indexOf(year) < 0) year = years[years.length - 1];
    const ym = this.data.monthKeys[this.data.monthIndex];
    const month = extra.monthAnalysis(ym);
    const yearData = extra.yearAnalysis(year);
    const totals = extra.yearTotals();
    const ageData = extra.ageTotals(this.data.birthYm);
    const recent = month.list.map(f => {
      const c = extra.catOf(f.category);
      return { id: f.id, ym: f.ym, name: c.name, color: c.color, amountText: extra.money(f.amount), note: f.note };
    });
    this.setData({
      years, year, ym, month, yearData, totals, ageData, recent,
      pieStyle: extra.pieGradient(month.rows),
      yearPieStyle: extra.pieGradient(yearData.categories),
    });
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  prevMonth() {
    const i = this.data.monthIndex;
    if (i < this.data.monthKeys.length - 1) this.setData({ monthIndex: i + 1 }, () => this.refresh());
  },
  nextMonth() {
    const i = this.data.monthIndex;
    if (i > 0) this.setData({ monthIndex: i - 1 }, () => this.refresh());
  },
  prevYear() {
    const i = this.data.years.indexOf(this.data.year);
    if (i > 0) this.setData({ year: this.data.years[i - 1] }, () => this.refresh());
  },
  nextYear() {
    const i = this.data.years.indexOf(this.data.year);
    if (i >= 0 && i < this.data.years.length - 1) this.setData({ year: this.data.years[i + 1] }, () => this.refresh());
  },

  onMonthChange(e) {
    const i = Number(e.detail.value);
    this.setData({ monthIndex: i, ym: this.data.monthKeys[i] }, () => this.refresh());
  },
  onCategoryChange(e) { this.setData({ categoryIndex: Number(e.detail.value) }); },
  onAmountInput(e) { this.setData({ 'form.amount': e.detail.value }); },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value }); },

  saveFee() {
    const r = extra.addFee({
      ym: this.data.ym,
      category: this.data.categoryKeys[this.data.categoryIndex],
      amount: this.data.form.amount,
      note: this.data.form.note,
    });
    if (r.error) {
      toast(r.error === 'BAD_AMOUNT' ? '请输入有效金额' : '保存失败，请检查月份与类别');
      return;
    }
    this.setData({ 'form.amount': '', 'form.note': '' });
    toast('已记一笔');
    this.refresh();
  },
  removeFee(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录', content: '确定删除这笔培训费吗？',
      success: (res) => {
        if (!res.confirm) return;
        extra.removeFee(id);
        toast('已删除');
        this.refresh();
      },
    });
  },

  onBirthInput(e) { this.setData({ birthInput: e.detail.value }); },
  saveBirth() {
    const v = this.data.birthInput.trim();
    if (!/^\d{4}-\d{2}$/.test(v)) { toast('请按 YYYY-MM 填写，如 2019-05'); return; }
    const m = Number(v.slice(5, 7));
    if (m < 1 || m > 12) { toast('月份需在 01-12 之间'); return; }
    const r = extra.setGuoguoBirth(v);
    if (r.error) { toast('保存失败'); return; }
    this.setData({ birthYm: v });
    toast('已保存');
    this.refresh();
  },
});
