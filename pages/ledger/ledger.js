// 家庭记账：账本（默认）/ 看账 两个视图 + 记一笔全局动作弹层。
// 时间状态集中在 period；编辑从任意入口就地弹层，不跨视图跳转。
// 分类与成员维度来自 utils/ledger-categories.js；居住类（编码 2）恒为公共支出，UI 层同步禁用成员切换。
const ledger = require('../../utils/ledger.js');
const C = require('../../utils/ledger-categories.js');
const D = require('../../utils/date.js');

const toast = (title, icon) => { try { wx.showToast({ title, icon: icon || 'none' }); } catch (e) {} };

// —— 纯 UI 辅助：分类色标（6 档循环，按一级分类编码取色）与上一自然月 ——
const CAT_TONES = ['pink', 'purple', 'teal', 'amber', 'green', 'slate'];
const catTone = code => CAT_TONES[(Math.max(1, Number(code) || 1) - 1) % CAT_TONES.length];
const prevMonthKey = ym => {
  const y = Number(String(ym).slice(0, 4)), m = Number(String(ym).slice(5, 7));
  return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
};

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
    tab: 'book',                // book 账本 | view 看账
    viewMode: 'list',           // 看账分段：list 流水 | chart 占比
    period: { monthIndex: 0, year: 0, scope: 'month' }, // 统一时间状态
    showForm: false,            // 记一笔弹层开关
    returnTab: 'book',          // 关闭弹层后回哪个入口
    recent: [],                 // 账本首页：最近 5 笔
    topCats: [],                // 账本首页：分类 Top3
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
    rows: [],
    monthTotal: '0.00',
    monthCount: 0,
    sum: null,
    monthLabel: '',
    canPrev: false,             // 更早有没有记录，决定左右箭头是否置灰
    canNext: false,
    // 汇总范围：按月 / 按年（原培训费页的年度对比能力，合并后保留）
    yearLabel: '',
    yearView: null,
    canPrevYear: true,
    canNextYear: false,
    focusField: '',              // 当前聚焦的字段名，避免多个输入框同时高亮
    saving: false,               // UI：保存防重锁
    formError: '',               // UI：非金额字段错误提示（金额仍走 amountError）
    monthTrend: '',              // UI：明细 hero 的较上月趋势文案
    monthTrendDir: '',           // UI：up / down / ''
  },

  onLoad() {
    const today = D.today();
    this.setData({
      today,
      cat1Names: C.CATEGORIES.map(c => c.name),
      memberChips: C.MEMBERS.map(m => ({ id: m.id, name: m.name })),
      form: Object.assign({}, this.data.form, { date: today }),
      months: ledger.months(),
      'period.year': Number(today.slice(0, 4)),
    });
    this.syncCat2(0);
    this.refresh();
  },

  onShow() { this.refresh(); },

  refresh() {
    const currentYear = Number(D.today().slice(0, 4));
    const year = this.data.period.year || currentYear;
    const yearView = ledger.yearSummary(year);
    const ym = this.data.months[this.data.period.monthIndex] || D.today().slice(0, 7);
    const rows = ledger.listByMonth(ym).map(r => Object.assign({}, r, {
      cat1Name: C.cat1Name(r.cat1),
      cat2Name: C.cat2Name(r.cat2),
      memberName: C.memberName(r.member),
      amountText: ledger.moneyOf(r.amount),
      dayText: String(r.date).slice(5),
      catTone: catTone(r.cat1),
    }));
    const sum = ledger.summary(ym);
    // 纯 UI 计算：本月合计与上一自然月对比（金额仍走 ledger 的统计口径）
    let monthTrend = '', monthTrendDir = '';
    const prevSum = ledger.summary(prevMonthKey(ym));
    if (prevSum.total > 0 && sum.total > 0) {
      const d = sum.total - prevSum.total;
      if (Math.abs(d) >= 0.01) {
        monthTrendDir = d > 0 ? 'up' : 'down';
        monthTrend = '较上月' + (d > 0 ? '多花 ¥' : '少花 ¥') + ledger.moneyOf(Math.abs(d));
      } else {
        monthTrend = '与上月持平';
      }
    } else if (!prevSum.total) {
      monthTrend = '上月没有记账记录';
    }
    const monthLabel = ym ? ym.slice(0, 4) + '年' + Number(ym.slice(5)) + '月' : '';
    // 账本首页：最近 5 笔（跨月份，按日期倒序）与当月分类 Top3（只读 UI 派生，不改统计口径）
    const recent = ledger.listAll().slice().sort((a, b) => {
      const d = String(b.date).localeCompare(String(a.date));
      return d !== 0 ? d : String(b.created_at || '').localeCompare(String(a.created_at || ''));
    }).slice(0, 5).map(r => ({
      id: r.id,
      cat2Name: C.cat2Name(r.cat2),
      memberName: C.memberName(r.member),
      dayText: String(r.date).slice(5),
      amountText: ledger.moneyOf(r.amount),
      catTone: catTone(r.cat1),
    }));
    const topCats = (sum.cats || []).slice(0, 3).map(c => ({
      code: c.code, name: c.name, pct: c.pct, amountText: c.amountText,
    }));
    this.setData({
      rows,
      recent, topCats,
      monthTotal: sum.totalText,
      monthCount: sum.count,
      sum,
      monthLabel,
      canPrev: this.data.period.monthIndex < this.data.months.length - 1,
      canNext: this.data.period.monthIndex > 0,
      yearLabel: year + ' 年',
      yearView,
      canPrevYear: year > 2000,
      canNextYear: year < currentYear,
      monthTrend, monthTrendDir,
    });
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    const patch = { tab, showForm: false };
    if (tab === 'book') patch['period.monthIndex'] = 0; // 账本跟随当月
    this.setData(patch, () => this.refresh());
  },
  switchViewMode(e) {
    const viewMode = e.currentTarget.dataset.mode;
    if (viewMode === this.data.viewMode) return;
    this.setData({ viewMode }); // 时间不变，流水/占比共用同一 period
  },
  // 新增：从当前入口就地唤起弹层
  openForm() {
    const today = D.today();
    this.setData({
      showForm: true,
      returnTab: this.data.tab,
      editingId: '', formTitle: '记一笔支出', editingLabel: '',
      amountError: '', formError: '', focusField: '',
      form: { date: today, cat1: this.data.form.cat1, cat2: this.data.form.cat2,
              amount: '', note: '', member: 'public' },
    }, () => this.syncCat2(this.data.cat1Index));
  },
  closeForm() {
    this.setData({ showForm: false, focusField: '' });
    this.cancelEdit();
  },
  noop() {},

  // ---------- 表单 ----------
  onDateChange(e) { this.setData({ 'form.date': e.detail.value, formError: '' }); },

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
      formError: '',
    });
  },

  onCat2Change(e) {
    const idx = Number(e.detail.value);
    const cat1 = C.CATEGORIES[this.data.cat1Index];
    this.setData({ cat2Index: idx, 'form.cat2': cat1.children[idx].code, formError: '' });
  },

  pickMember(e) {
    if (this.data.publicOnly) { toast('居住类支出统一计入公共支出'); return; }
    this.setData({ 'form.member': e.currentTarget.dataset.id, formError: '' });
  },

  onAmountInput(e) {
    this.setData({ 'form.amount': e.detail.value, amountError: '', formError: '' });
  },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value, formError: '' }); },

  saveEntry() {
    if (this.data.saving) return;                    // UI 防重：同步上锁，连点第二次直接被拦
    this.data.saving = true;
    this.setData({ saving: true, formError: '' });
    try {
      const f = this.data.form;
      const wasEditing = !!this.data.editingId;
      const r = wasEditing ? ledger.update(this.data.editingId, f) : ledger.add(f);
      if (r.error) {
        // 金额是唯一由用户手输、最容易错的字段，错误就近显示在输入框下方
        if (r.error === 'BAD_AMOUNT') {
          this.setData({ amountError: '请填大于 0 的金额，最多两位小数' });
          return;
        }
        const msg = {
          BAD_DATE: '日期格式不对，请重新选择日期',
          BAD_CATEGORY: '请选择有效的分类',
          BAD_MEMBER: '请选择谁花的',
          NOT_FOUND: '这条记录已不存在，请刷新后重试',
        };
        this.setData({ formError: msg[r.error] || '保存失败，请检查填写内容' });
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
        formError: '',
        'form.amount': '',
        'form.note': '',
        months: ledger.months(),
        showForm: false,
        focusField: '',
      });
      this.refresh();
    } catch (e) {
      this.setData({ formError: '保存失败，请重试' });
      toast('保存失败');
    } finally {
      this.data.saving = false;
      this.setData({ saving: false });
    }
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
      showForm: true,
      returnTab: this.data.tab,
      editingId: id,
      formTitle: '编辑这笔支出',
      editingLabel: label,
      amountError: '', formError: '',
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
      editingId: '', formTitle: '记一笔支出', editingLabel: '', amountError: '', formError: '',
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
    if (scope === this.data.period.scope) return;
    this.setData({ 'period.scope': scope });
  },
  prevYear() {
    if (this.data.period.year <= 2000) { toast('已经没有更早的年份'); return; }
    this.setData({ 'period.year': this.data.period.year - 1 }, () => this.refresh());
  },
  nextYear() {
    const currentYear = Number(D.today().slice(0, 4));
    if (this.data.period.year >= currentYear) { toast('已经是最新年份'); return; }
    this.setData({ 'period.year': this.data.period.year + 1 }, () => this.refresh());
  },

  // ---------- 月份切换 ----------
  prevMonth() {
    const i = this.data.period.monthIndex;
    if (i >= this.data.months.length - 1) { toast('已经是更早的记录了'); return; }
    this.setData({ 'period.monthIndex': i + 1 });
    this.refresh();
  },
  nextMonth() {
    const i = this.data.period.monthIndex;
    if (i <= 0) { toast('已经是最新月份'); return; }
    this.setData({ 'period.monthIndex': i - 1 });
    this.refresh();
  },
});
