// 诗词库：只读内容库，与古诗复习记录完全隔离。
// 支持按篇名 / 首句 / 画面线索 / 正文检索，点开看讲解与原文来源。
const lib = require('../../utils/poem-library.js');

function toast(title) { try { wx.showToast({ title, icon: 'none' }); } catch (e) {} }

Page({
  data: {
    keyword: '',
    focusField: '',
    view: 'list',          // list | detail
    list: [],
    libTotal: lib.all().length,
    total: lib.all().length,
    detail: null,
  },

  onLoad() { this.refresh(''); },

  onFieldFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (ds.field && this.data.focusField !== ds.field) this.setData({ focusField: ds.field });
  },
  onFieldBlur() { if (this.data.focusField) this.setData({ focusField: '' }); },

  onKeywordInput(e) { this.refresh(e.detail.value || ''); },
  clearKeyword() { this.refresh(''); },

  refresh(keyword) {
    const list = lib.search(keyword).map(p => Object.assign({}, p, {
      first: lib.firstLine(p),
    }));
    this.setData({ keyword: keyword || '', list, total: list.length, libTotal: lib.all().length });
  },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    const p = lib.byId(id);
    if (!p) { toast('未找到这首诗'); return; }
    this.setData({
      view: 'detail',
      detail: Object.assign({}, p, {
        first: lib.firstLine(p),
        contentLines: String(p.content || '').split('\n').filter(Boolean),
      }),
    });
    try { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch (e) {}
  },
  backToList() {
    this.setData({ view: 'list', detail: null });
    try { wx.pageScrollTo({ scrollTop: 0, duration: 0 }); } catch (e) {}
  },
});
