// 家庭记账：记一笔 / 明细 / 汇总 三个视图。
// 分类与成员维度来自 utils/ledger-categories.js；居住类（编码 2）恒为公共支出，UI 层同步禁用成员切换。
const ledger = require('../../utils/ledger.js');
const C = require('../../utils/ledger-categories.js');
const D = require('../../utils/date.js');

const toast = (title, icon) => { try { wx.showToast({ title, icon: icon || 'none' }); } catch (e) {} };

const ERR = {
  BAD_DATE: '日期格式不对', BAD_CATEGORY: '请选择分类', BAD_AMOUNT: '金额需大于 0',
  BAD_MEMBER: '请选择成员', NOT_FOUND: '记录不存在',
};

Page({
  // 聚焦态按字段区分：一个布尔管多个输入框会让「聚焦金额时备注也高亮」
  onFieldFocus(e) {
    const field = (e.currentTarget.dataset && e.currentTarget.dataset.field) || '';
    if (field && this.data.focusField !== field) this.setData({ focusField: field });
  },
  onFieldBlur() { if (this.data.focusField) this.setData({ focusField: '' }); },

  data: {
    tab: 'add',                 // add | list | summary
    today: '',
    // 表单
    form: { date: '', cat1: '1', cat2: '1-01', amount: '', note: '', member: 'public' },
    editingId: '',
    formTitle: '记一笔支出',      // 编辑态显示「编辑：11-26 中餐 ¥35.50」，给用户一个视觉锚点
    editingLabel: '',
    amountError: '',            // 金额内联错误，取代只弹 toast
    publicOnly: false,
    cat1Names: [],
    cat2Names: [],
    cat1Index: 0,
    cat2Index: 0,
    cat1Hint: '',               // 一级分类的记账口径提示（餐次/买菜/外卖怎么分）
    memberChips: [],
    // 明细 / 汇总
    months: [],
    monthIndex: 0,
    rows: [],
    monthTotal: '0.00',
    monthCount: 0,
    sum: null,
    monthLabel: '',
    canPrev: false,             // 更早有没有记录，决定左右箭头是否置灰
    canNext: false,
    // 汇总范围：按月 / 按年（原培训费页的年度对比能力，合并后保留）
    scope: 'month',
    year: 0,
    yearLabel: '',
    yearView: null,
    canPrevYear: true,
    canNextYear: false,
    focusField: '',              // 当前聚焦的字段名，避免多个输入框同时高亮
  },

  onLoad() {
    const today = D.today();
    this.setData({
      today,
      cat1Names: C.CATEGORIES.map(c => c.name),
      memberChips: C.MEMBERS.map(m => ({ id: m.id, name: m.name })),
      form: Object.assign({}, this.data.form, { date: today }),
      months: ledger.months(),
      year: Number(today.slice(0, 4)),
    });
    this.syncCat2(0);
    this.refresh();
  },

  onShow() {
    // switchTab 不支持 query：成长页等入口用 globalData 指定落在「汇总 · 按年」
    const app = getApp();
    if (app && app.globalData && app.globalData.ledgerView) {
      const wantYear = app.globalData.ledgerView === 'year';
      app.globalData.ledgerView = '';
      if (wantYear) this.setData({ tab: 'summary', scope: 'year' });
    }
    this.refresh();
  },

  refresh() {
    const currentYear = Number(D.today().slice(0, 4));
    const year = this.data.year || currentYear;
    const yearView = ledger.yearSummary(year);
    const ym = this.data.months[this.data.monthIndex] || D.today().slice(0, 7);
    const rows = ledger.listByMonth(ym).map(r => Object.assign({}, r, {
      cat1Name: C.cat1Name(r.cat1),
      cat2Name: C.cat2Name(r.cat2),
      memberName: C.memberName(r.member),
      amountText: ledger.moneyOf(r.amount),
      dayText: String(r.date).slice(5),
    }));
    const sum = ledger.summary(ym);
    const monthLabel = ym ? ym.slice(0, 4) + '年' + Number(ym.slice(5)) + '月' : '';
    this.setData({
      rows,
      monthTotal: sum.totalText,
      monthCount: sum.count,
      sum,
      monthLabel,
      canPrev: this.data.monthIndex < this.data.months.length - 1,
      canNext: this.data.monthIndex > 0,
      year,
      yearLabel: year + ' 年',
      yearView,
      canPrevYear: year > 2000,
      canNextYear: year < currentYear,
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab });
    if (tab !== 'add') this.refresh();
  },

  // ---------- 表单 ----------
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }); },

  onCat1Change(e) {
    const idx = Number(e.detail.value);
    this.syncCat2(idx);
  },

  // 一级分类切换后，二级重置为该类第一个，并同步「是否仅公共」状态
  syncCat2(cat1Idx) {
    const cat1 = C.CATEGORIES[cat1Idx];
    if (!cat1) return;
    const publicOnly = C.isPublicOnly(cat1.code);
    this.setData({
      cat1Index: cat1Idx,
      cat2Names: cat1.children.map(c => c.name),
      cat2Index: 0,
      cat1Hint: cat1.hint || '',
      publicOnly,
      'form.cat1': cat1.code,
      'form.cat2': cat1.children[0].code,
      'form.member': publicOnly ? 'public' : this.data.form.member,
    });
  },

  onCat2Change(e) {
    const idx = Number(e.detail.value);
    const cat1 = C.CATEGORIES[this.data.cat1Index];
    this.setData({ cat2Index: idx, 'form.cat2': cat1.children[idx].code });
  },

  pickMember(e) {
    if (this.data.publicOnly) { toast('居住类支出统一计入公共支出'); return; }
    this.setData({ 'form.member': e.currentTarget.dataset.id });
  },

  onAmountInput(e) {
    this.setData({ 'form.amount': e.detail.value, amountError: '' });
  },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value }); },

  saveEntry() {
    const f = this.data.form;
    const wasEditing = !!this.data.editingId;
    const r = wasEditing ? ledger.update(this.data.editingId, f) : ledger.add(f);
    if (r.error) {
      // 金额是唯一由用户手输、最容易错的字段，错误就近显示在输入框下方
      if (r.error === 'BAD_AMOUNT') {
        this.setData({ amountError: '请填大于 0 的金额，最多两位小数' });
        return;
      }
      toast(ERR[r.error] || '保存失败');
      return;
    }
    toast(wasEditing ? '已保存修改' : '已记账', 'success');
    // 清空金额与备注，保留日期/分类/成员，方便连续记同类支出
    this.setData({
      editingId: '',
      formTitle: '记一笔支出',
      editingLabel: '',
      amountError: '',
      'form.amount': '',
      'form.note': '',
      months: ledger.months(),
      monthIndex: 0,
    });
    this.refresh();
  },

  // 点明细进入编辑
  editRow(e) {
    const id = e.currentTarget.dataset.id;
    const rec = ledger.getRecord(id);
    if (!rec) { toast('记录不存在'); return; }
    const cat1Idx = Math.max(0, C.CATEGORIES.findIndex(c => c.code === rec.cat1));
    const cat1 = C.CATEGORIES[cat1Idx];
    const cat2Idx = Math.max(0, cat1.children.findIndex(c => c.code === rec.cat2));
    const label = rec.date.slice(5) + ' ' + C.cat2Name(rec.cat2) + ' ¥' + ledger.moneyOf(rec.amount);
    this.setData({
      tab: 'add',
      editingId: id,
      formTitle: '编辑这笔支出',
      editingLabel: label,
      amountError: '',
      cat1Index: cat1Idx,
      cat2Index: cat2Idx,
      cat2Names: cat1.children.map(c => c.name),
      cat1Hint: cat1.hint || '',
      publicOnly: C.isPublicOnly(cat1.code),
      form: {
        date: rec.date, cat1: rec.cat1, cat2: rec.cat2,
        amount: String(rec.amount), note: rec.note || '', member: rec.member,
      },
    });
  },

  cancelEdit() {
    this.setData({
      editingId: '', formTitle: '记一笔支出', editingLabel: '', amountError: '',
      'form.amount': '', 'form.note': '',
    });
  },

  removeRow(e) {
    const id = e.currentTarget.dataset.id;
    const rec = ledger.getRecord(id);
    if (!rec) return;
    wx.showModal({
      title: '删除这笔记录',
      content: rec.date + ' ' + C.cat2Name(rec.cat2) + ' ¥' + Number(rec.amount).toFixed(2),
      confirmText: '删除', confirmColor: '#d93026',
      success: (res) => {
        if (!res.confirm) return;
        const r = ledger.remove(id);
        if (r.error) { toast('删除失败'); return; }
        if (this.data.editingId === id) this.cancelEdit();
        toast('已删除', 'success');
        this.refresh();
      },
    });
  },

  // ---------- 汇总范围：按月 / 按年 ----------
  switchScope(e) {
    const scope = e.currentTarget.dataset.scope;
    if (scope === this.data.scope) return;
    this.setData({ scope });
  },
  prevYear() {
    if (this.data.year <= 2000) { toast('已经没有更早的年份'); return; }
    this.setData({ year: this.data.year - 1 }, () => this.refresh());
  },
  nextYear() {
    const currentYear = Number(D.today().slice(0, 4));
    if (this.data.year >= currentYear) { toast('已经是最新年份'); return; }
    this.setData({ year: this.data.year + 1 }, () => this.refresh());
  },

  // ---------- 月份切换 ----------
  prevMonth() {
    const i = this.data.monthIndex;
    if (i >= this.data.months.length - 1) { toast('已经是更早的记录了'); return; }
    this.setData({ monthIndex: i + 1 });
    this.refresh();
  },
  nextMonth() {
    const i = this.data.monthIndex;
    if (i <= 0) { toast('已经是最新月份'); return; }
    this.setData({ monthIndex: i - 1 });
    this.refresh();
  },
});
