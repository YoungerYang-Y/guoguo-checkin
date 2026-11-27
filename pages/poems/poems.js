const review = require('../../utils/review.js');
const poemData = require('../../utils/poems-data.js');

function toast(title, icon) { try { wx.showToast({ title, icon: icon || 'none' }); } catch (e) {} }

Page({
  // 聚焦态按字段区分：一个布尔管多个输入框会让「聚焦 A 时 B 也高亮」
  onFieldFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (ds.field && this.data.focusField !== ds.field) this.setData({ focusField: ds.field });
  },
  onFieldBlur() { if (this.data.focusField) this.setData({ focusField: '' }); },
  data: {
    focusField: '',        // 当前聚焦的字段名，避免多输入框串色
    tab: 'add',
    week: '',
    weekKeys: [],
    weekLabels: [],
    weekIndex: 0,
    form: { title: '', author: '', content: '', note: '' },
    matchHint: '',
    expandedIds: [],
    learned: [],
    reviewData: { items: [], total: 0, pending: 0, passed: 0, failed: 0, scopeLabel: '', weekLabel: '' },
    bank: { items: [], total: 0 },
    overview: { weekLabel: '', bankCount: 0 },
  },

  onLoad(options) {
    if (options && options.tab === 'review') this.setData({ tab: 'review' });
    const opts = review.weekOptions(8);
    this.setData({
      weekKeys: opts.map(o => o.key),
      weekLabels: opts.map(o => o.label),
      week: review.currentWeek(),
      weekIndex: 0,
    });
    this.refresh();
  },
  onShow() { if (this.data.weekKeys.length) this.refresh(); },

  refresh() {
    const week = this.data.week || review.currentWeek();
    const opened = this.data.expandedIds || [];
    const decorate = list => list.map(x => Object.assign({}, x, { expanded: opened.indexOf(x.id) >= 0 }));
    const rv = review.weeklyReview('poem', week);
    const bank = review.reviewBank('poem');
    this.setData({
      week,
      weekIndex: Math.max(0, this.data.weekKeys.indexOf(week)),
      learned: decorate(review.weekItems('poem', review.currentWeek())),
      reviewData: Object.assign({}, rv, { items: decorate(rv.items) }),
      bank: Object.assign({}, bank, { items: decorate(bank.items) }),
      overview: review.overview('poem'),
    });
  },

  autoFill() {
    const f = this.data.form;
    const hit = poemData.findPoem(f.title, f.author);
    if (hit) {
      const patch = { matchHint: '已匹配《' + hit.title + '》· ' + hit.author + '，请核对课本版本' };
      if (!this._contentEdited) patch['form.content'] = hit.content;
      this.setData(patch);
    } else if (String(f.title || '').trim()) {
      this.setData({ matchHint: '诗库暂未收录，可手动粘贴诗文内容' });
    } else {
      this.setData({ matchHint: '' });
    }
  },
  toggleContent(e) {
    const id = e.currentTarget.dataset.id;
    const ids = (this.data.expandedIds || []).slice();
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1); else ids.push(id);
    this.setData({ expandedIds: ids });
    this.refresh();
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  onWeekChange(e) {
    const i = Number(e.detail.value);
    this.setData({ weekIndex: i, week: this.data.weekKeys[i] }, () => this.refresh());
  },
  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
    if (field === 'content') { this._contentEdited = true; return; }
    if (field === 'title' || field === 'author') this.autoFill();
  },

  save() {
    const f = this.data.form;
    const r = review.add('poem', { title: f.title, author: f.author, note: f.note, content: f.content });
    if (r.error === 'DUPLICATE') { toast('本周已录入这首古诗'); return; }
    if (r.error) { toast('请填写古诗名称'); return; }
    this._contentEdited = false;
    this.setData({ 'form.title': '', 'form.author': '', 'form.content': '', 'form.note': '', matchHint: '', tab: 'add' });
    toast('已加入本周古诗', 'success');
    this.refresh();
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录', content: '确定删除这首古诗吗？',
      success: (res) => {
        if (!res.confirm) return;
        review.remove('poem', id);
        toast('已删除');
        this.refresh();
      },
    });
  },
  mark(e) {
    const ds = e.currentTarget.dataset;
    const ok = ds.ok === '1' || ds.ok === true;
    const week = ds.bank ? review.currentWeek() : this.data.week;
    const r = review.markReview('poem', ds.id, week, ok);
    if (r.error) { toast('操作失败'); return; }
    toast(ok ? '已标记能完整背诵' : '未通过，已自动进入复习库');
    this.refresh();
  },
});
