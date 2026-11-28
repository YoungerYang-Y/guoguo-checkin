// 内容库页：诗词 20 首 + 英语 50 卡，统一列表/详情/录入/编辑。
// 全局唯一库入口（从 growth 进入）；learn 页录入弹层内嵌搜索，不重复开库入口。
// 详情操作：加入学习、重新学习（mastered 后）、编辑、删除（软删）。管理档才可见增删改。
const learning = require('../../utils/learning.js');
const contentSeed = require('../../utils/content-seed.js');

const TYPE_FILTERS = [
  { key: '', label: '全部' },
  { key: 'poem', label: '诗词' },
  { key: 'english', label: '英语' },
];

Page({
  data: {
    view: 'list',
    typeFilter: '',
    keyword: '',
    tag: '',
    tags: [],
    visibleTags: [],       // UI：折叠后可见标签
    tagsExpanded: false,   // UI：标签展开态
    hasMoreTags: false,
    list: [],
    total: 0,
    detail: null,
    canManage: true,
    canEdit: true,
    showDeleted: false,      // N7：管理档可查看/恢复软删内容
    focusField: '',
    loading: true,

    typeFilters: TYPE_FILTERS,
    // 录入/编辑表单
    showForm: false,
    formMode: 'add',          // add | edit
    formId: '',
    formType: 'poem',
    formPrimary: '',
    formSecondary: '',
    formBody: '',
    formTag: '',
    formError: '',        // UI 状态：必填校验失败时行内提示，不改变业务判断
    saving: false,        // UI 状态：保存中防重复提交
  },

  onLoad(options) {
    const id = options && options.id ? decodeURIComponent(options.id) : '';
    if (id) this.openById(id);
    else this.build();
  },

  onShow() { if (this.data.view === 'list') this.build(); },

  build() {
    try {
      // N7：回收站视图列出软删内容，关键词仅在正常视图生效
      const list = this.data.showDeleted
        ? learning.libraryDeleted()
        : learning.library({ type: this.data.typeFilter, keyword: this.data.keyword, tag: this.data.tag });
      const allTags = this.data.typeFilter ? contentSeed.tags(this.data.typeFilter) : contentSeed.tags();
      this.setData({
        list: list, total: list.length,
        tags: allTags,
        visibleTags: this.data.tagsExpanded ? allTags : allTags.slice(0, 6),
        hasMoreTags: allTags.length > 6,
        canManage: learning.canManageContent(),
        canEdit: learning.canRecord(),
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false, canManage: false, canEdit: false });
    }
  },

  // N7：回收站切换与恢复（管理档）
  toggleDeleted() {
    if (!this.data.canManage) { wx.showToast({ title: '仅管理员可管理回收站', icon: 'none' }); return; }
    this.setData({ showDeleted: !this.data.showDeleted }, () => this.build());
  },
  restoreItem(e) {
    if (!this.data.canManage) return;
    const id = e.currentTarget.dataset.id;
    const r = learning.restoreContent(id);
    if (r.error) { wx.showToast({ title: r.error === 'FORBIDDEN' ? '无管理权限' : '恢复失败', icon: 'none' }); return; }
    wx.showToast({ title: '已恢复' });
    this.build();
  },

  setTypeFilter(e) {
    this.setData({ typeFilter: e.currentTarget.dataset.type || '', tag: '' }, () => this.build());
  },
  toggleTags() { this.setData({ tagsExpanded: !this.data.tagsExpanded }, () => this.build()); },
  setTag(e) {
    this.setData({ tag: e.currentTarget.dataset.tag || '' }, () => this.build());
  },
  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value || '' }, () => this.build());
  },
  clearKeyword() { this.setData({ keyword: '' }, () => this.build()); },
  onFieldFocus(e) {
    const ds = (e && e.currentTarget && e.currentTarget.dataset) || {};
    if (ds.field && this.data.focusField !== ds.field) this.setData({ focusField: ds.field });
  },
  onFieldBlur() { if (this.data.focusField) this.setData({ focusField: '' }); },

  openDetail(e) {
    const id = e.currentTarget.dataset.id;
    this.openById(id);
  },
  openById(id) {
    try {
      const item = learning.contentById(id);
      if (!item) { wx.showToast({ title: '内容不存在', icon: 'none' }); return; }
      const detail = decorate(item);
      this.setData({ view: 'detail', detail: detail, canManage: learning.canManageContent(), canEdit: learning.canRecord() });
    } catch (e) {}
  },
  backToList() { this.setData({ view: 'list', detail: null }, () => this.build()); },

  addToLearn(e) {
    if (!this.data.canEdit) { wx.showToast({ title: '当前为只读模式', icon: 'none' }); return; }
    const id = e.currentTarget.dataset.id || (this.data.detail && this.data.detail.id);
    const r = learning.record({ ids: [id], kind: 'learn', result: 'pass', operator: this.operatorName() });
    if (r.error) { wx.showToast({ title: '加入失败', icon: 'none' }); return; }
    wx.showToast({ title: '已加入今日记录' });
    if (this.data.view === 'detail') this.openById(id);
    else this.build();
  },
  restartLearn(e) {
    if (!this.data.canEdit) return;
    const id = e.currentTarget.dataset.id || (this.data.detail && this.data.detail.id);
    const r = learning.restartContent(id);
    if (r.error) { wx.showToast({ title: '重新学习失败', icon: 'none' }); return; }
    wx.showToast({ title: '已拉回学习' });
    this.openById(id);
  },

  openForm(e) {
    if (!this.data.canManage) { wx.showToast({ title: '仅管理员可编辑内容库', icon: 'none' }); return; }
    const item = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id
      ? learning.contentById(e.currentTarget.dataset.id) : null;
    this.setData({
      showForm: true, formMode: item ? 'edit' : 'add',
      formId: item ? item.id : '', formType: item ? item.type : (this.data.typeFilter || 'poem'),
      formPrimary: item ? item.primary : '',
      formSecondary: item ? item.secondary : '',
      formBody: item ? item.body : '',
      formTag: item && item.meta ? (item.meta.tag || '') : '',
      focusField: '', formError: '',
    });
  },
  closeForm() { this.setData({ showForm: false, focusField: '', formError: '' }); },
  noop() {},
  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    if (!field) return;
    const patch = { [field]: e.detail.value || '' };
    if (field === 'formPrimary' && this.data.formError) patch.formError = '';
    this.setData(patch);
  },
  setFormType(e) { this.setData({ formType: e.currentTarget.dataset.type || 'poem' }); },

  saveForm() {
    if (this.data.saving) return;                    // UI 防重：同步上锁，连点第二次直接被拦
    this.data.saving = true;
    this.setData({ saving: true });
    try {
      const d = this.data;
      const primary = String(d.formPrimary || '').trim();
      if (!primary) {
        this.setData({ formError: d.formType === 'poem' ? '请填写诗词名' : '请填写英文句子' });
        wx.showToast({ title: '请填写标题', icon: 'none' });
        return;
      }
      const entry = {
        id: d.formMode === 'edit' ? d.formId : undefined,
        type: d.formType, primary: primary, secondary: d.formSecondary, body: d.formBody,
        meta: d.formTag ? { tag: d.formTag, tags: [d.formTag] } : {},
      };
      const r = learning.upsertContent(entry);
      if (r.error) { wx.showToast({ title: r.error === 'FORBIDDEN' ? '无编辑权限' : '保存失败', icon: 'none' }); return; }
      wx.showToast({ title: '已保存' });
      this.setData({ showForm: false, focusField: '', formError: '', saving: false });
      if (this.data.view === 'detail') this.openById(r.data.id);
      else this.build();
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.data.saving = false;
      if (this.data.showForm) this.setData({ saving: false });
    }
  },

  removeContent(e) {
    if (!this.data.canManage) return;
    const id = e.currentTarget.dataset.id || (this.data.detail && this.data.detail.id);
    wx.showModal({
      title: '确认删除', content: '删除后内容不再出现在库和计划中，学习记录保留。',
      success: res => {
        if (!res.confirm) return;
        const r = learning.removeContent(id);
        if (r.error) { wx.showToast({ title: '删除失败', icon: 'none' }); return; }
        wx.showToast({ title: '已删除' });
        this.backToList();
      },
    });
  },

  operatorName() {
    try {
      const fam = require('../../utils/family.js');
      const id = fam.getIdentity();
      if (id && id.memberKey) return fam.identityLabel(id.memberKey);
    } catch (e) {}
    return '家人';
  },
});

// 把正文按行拆开便于 WXML 展示；英语卡按字段拼接展示列表。
function decorate(item) {
  const m = item.meta || {};
  const lines = String(item.body || '').split('\n').filter(x => x.trim());
  const authorLine = item.type === 'poem'
    ? [m.dynasty, item.secondary].filter(Boolean).join(' · ')
    : (m.title || '');
  const filled = v => !!(v && String(v).trim());
  const out = Object.assign({}, item, {
    lines: lines,
    typeLabel: item.type === 'poem' ? '诗词' : '英语',
    authorLine: authorLine,
    // UI 状态：字段是否有内容，避免详情渲染空区块（不改变 item 本身）
    has: {
      lines: lines.length > 0,
      authorLine: filled(authorLine),
      explain: filled(m.explain), highlight: filled(m.highlight),
      question: filled(m.question), background: filled(m.background),
      clues: Array.isArray(m.clues) && m.clues.length > 0,
      source: filled(m.source),
      scene: filled(m.scene) || filled(item.body),
      reply: filled(m.reply), alt: filled(m.alt), prompt: filled(m.prompt),
    },
  });
  return out;
}
