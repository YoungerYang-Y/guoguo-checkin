const review = require('../../utils/review.js');
const ocr = require('../../utils/ocr.js');

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
    form: { text: '', type: 'word', note: '' },
    batch: '',
    photo: '',
    tempPath: '',
    recognizing: false,
    recognizedCount: 0,
    scanHint: '',
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
    this.setData({
      week,
      weekIndex: Math.max(0, this.data.weekKeys.indexOf(week)),
      learned: review.weekItems('word', review.currentWeek()),
      reviewData: review.weeklyReview('word', week),
      bank: review.reviewBank('word'),
      overview: review.overview('word'),
    });
  },

  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.tab }); },
  onWeekChange(e) {
    const i = Number(e.detail.value);
    this.setData({ weekIndex: i, week: this.data.weekKeys[i] }, () => this.refresh());
  },
  onFieldInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },
  onBatchInput(e) { this.setData({ batch: e.detail.value }); },
  selectType(e) { this.setData({ 'form.type': e.currentTarget.dataset.type }); },

  // 拍照/选图：照片作为本周学习资料留存；点「识别图片内容」交给视觉模型自动读出单词句子
  choosePhoto() {
    const that = this;
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sourceType: ['camera', 'album'],
      success(res) {
        const f = res && res.tempFiles && res.tempFiles[0];
        const temp = f && (f.tempFilePath || f.path);
        if (!temp) return;
        let saved = temp;
        try {
          const fs = wx.getFileSystemManager();
          const dest = ((wx.env && wx.env.USER_DATA_PATH) || 'wxfile://usr') + '/words-' + Date.now() + '.jpg';
          if (typeof fs.saveFileSync === 'function') saved = fs.saveFileSync(temp, dest) || dest;
        } catch (e) {}
        that.setData({
          photo: saved,
          tempPath: temp,
          recognizedCount: 0,
          scanHint: '照片已保存。点击下方「识别图片内容」可自动读出单词和句子（需在微信客户端登录）。',
        });
      },
      fail() {
        that.setData({ scanHint: '当前预览环境无法调起相机；在微信真机中可拍照并识别，也可直接批量粘贴录入。' });
      },
    });
  },
  clearPhoto() {
    this.setData({ photo: '', tempPath: '', scanHint: '', recognizedCount: 0 });
  },

  // 把本地图片读成 base64；预览环境的内存文件系统没有真实二进制，直接降级
  readImageBase64(path) {
    return new Promise((resolve, reject) => {
      try {
        const fs = wx.getFileSystemManager();
        if (typeof fs.readFile === 'function') {
          fs.readFile({
            filePath: path, encoding: 'base64',
            success: res => {
              if (res && res.data && String(res.data).length > 64) resolve(String(res.data));
              else reject(new Error('无法读取图片内容'));
            },
            fail: () => reject(new Error('无法读取图片内容')),
          });
          return;
        }
        if (typeof fs.readFileSync === 'function') {
          const data = fs.readFileSync(path, 'base64');
          if (typeof data === 'string' && data.length > 64 && !/^wxfile|^\/|^file:|^https?:/.test(data)) {
            resolve(data);
          } else {
            reject(new Error('当前预览环境没有真实图片数据，请在微信真机中使用识别，或改用批量粘贴'));
          }
          return;
        }
        reject(new Error('当前环境不支持读取图片'));
      } catch (e) { reject(e); }
    });
  },

  async recognize() {
    if (!this.data.photo) { toast('请先拍照或选图'); return; }
    if (this.data.recognizing) return;
    this.setData({ recognizing: true, scanHint: '正在识别图片，请稍候…' });
    try {
      const base64 = await this.readImageBase64(this.data.tempPath || this.data.photo);
      const res = await ocr.recognize(base64, 'image/jpeg');
      const lines = res.items.map(i => i.text).join('\n');
      this.setData({
        batch: lines,
        recognizedCount: res.items.length,
        scanHint: '识别到 ' + res.items.length + ' 条，已填入下方批量录入，可修改后再保存。',
      });
      toast('识别完成', 'success');
    } catch (e) {
      this.setData({ scanHint: (e && e.message) || '识别失败，可改用批量粘贴录入' });
      toast('识别失败，可改用批量粘贴');
    } finally {
      this.setData({ recognizing: false });
    }
  },

  guessType(line) {
    return /[\s,.!?，。！？;；]/.test(line) ? 'sentence' : 'word';
  },
  saveBatch() {
    const raw = this.data.batch || '';
    const lines = raw.split(/[\n\r;；]+/).map(s => s.trim()).filter(Boolean);
    if (!lines.length) { toast('请先粘贴或输入单词、句子'); return; }
    const entries = lines.map(line => ({
      text: line, type: this.guessType(line),
      note: this.data.form.note, image: this.data.photo,
    }));
    const r = review.addBatch('word', entries);
    this.setData({ batch: '' });
    toast('已录入 ' + r.added + ' 条' + (r.skipped ? '，跳过重复 ' + r.skipped + ' 条' : ''), 'success');
    this.refresh();
  },
  saveOne() {
    const f = this.data.form;
    const r = review.add('word', { text: f.text, type: f.type, note: f.note, image: this.data.photo });
    if (r.error === 'DUPLICATE') { toast('本周已录入这条内容'); return; }
    if (r.error) { toast('请填写单词或句子'); return; }
    this.setData({ 'form.text': '', 'form.note': '' });
    toast('已加入本周', 'success');
    this.refresh();
  },
  remove(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录', content: '确定删除这条学习内容吗？',
      success: (res) => {
        if (!res.confirm) return;
        review.remove('word', id);
        toast('已删除');
        this.refresh();
      },
    });
  },
  mark(e) {
    const ds = e.currentTarget.dataset;
    const ok = ds.ok === '1' || ds.ok === true;
    const week = ds.bank ? review.currentWeek() : this.data.week;
    const r = review.markReview('word', ds.id, week, ok);
    if (r.error) { toast('操作失败'); return; }
    toast(ok ? '已标记能完整背诵' : '未通过，已自动进入复习库');
    this.refresh();
  },
});
