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
  onFieldFocus() { if (!this.data.fieldFocus) this.setData({ fieldFocus: true }); },
  onFieldBlur() { if (this.data.fieldFocus) this.setData({ fieldFocus: false }); },

  data: {
    tab: 'add',                 // add | list | summary
    today: '',
    // 表单
    form: { date: '', cat1: '1', cat2: '1-01', amount: '', note: '', member: 'public' },
    editingId: '',
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
    fieldFocus: false,
  },

  onLoad() {
    const today = D.today();
    this.setData({
      today,
      cat1Names: C.CATEGORIES.map(c => c.name),
      memberChips: C.MEMBERS.map(m => ({ id: m.id, name: m.name })),
      form: Object.assign({}, this.data.form, { date: today }),
      months: ledger.months(),
    });
    this.syncCat2(0);
    this.refresh();
  },

  onShow() { this.refresh(); },

  refresh() {
    const ym = this.data.months[this.data.monthIndex] || D.today().slice(0, 7);
    const rows = ledger.listByMonth(ym).map(r => Object.assign({}, r, {
      cat1Name: C.cat1Name(r.cat1),
      cat2Name: C.cat2Name(r.cat2),
      memberName: C.memberName(r.member),
      amountText: Number(r.amount).toFixed(2),
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

  onAmountInput(e) { this.setData({ 'form.amount': e.detail.value }); },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value }); },

  saveEntry() {
    const f = this.data.form;
    if (this.data.editingId) {
      const r = ledger.update(this.data.editingId, f);
      if (r.error) { toast(ERR[r.error] || '保存失败'); return; }
      toast('已保存修改', 'success');
    } else {
      const r = ledger.add(f);
      if (r.error) { toast(ERR[r.error] || '保存失败'); return; }
      toast('已记账', 'success');
    }
    // 清空金额与备注，保留日期/分类/成员，方便连续记同类支出
    this.setData({
      editingId: '',
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
    this.setData({
      tab: 'add',
      editingId: id,
      cat1Index: cat1Idx,
      cat2Index: cat2Idx,
      cat2Names: cat1.children.map(c => c.name),
      publicOnly: C.isPublicOnly(cat1.code),
      form: {
        date: rec.date, cat1: rec.cat1, cat2: rec.cat2,
        amount: String(rec.amount), note: rec.note || '', member: rec.member,
      },
    });
  },

  cancelEdit() {
    this.setData({ editingId: '', 'form.amount': '', 'form.note': '' });
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
