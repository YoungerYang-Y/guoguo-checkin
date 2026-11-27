const store = require('../../utils/store.js');
const D = require('../../utils/date.js');
const privacy = require('../../utils/privacy.js');

const toast = title => wx.showToast({ title, icon: 'none' });

Page({
  data: {
    // 双模式：backup = 全量 JSON 备份（默认）；csv = 打卡明细 CSV（Excel 查看）
    mode: 'backup',
    modes: [
      { key: 'backup', label: '完整备份' },
      { key: 'csv', label: '打卡明细' },
    ],
    exportRange: 'month',
    ranges: [
      { key: 'week', label: '本周' },
      { key: 'month', label: '本月' },
      { key: 'year', label: '本年' },
      { key: 'all', label: '全部' },
    ],
    start: '', end: '', rangeLabel: '', recordCount: 0,
    exportReady: false, exportPath: '', exportFallback: false,
    copying: false,
    manualContent: '',
    fileName: '',
  },

  onShow() { this.updateRange(true); },

  setMode(e) {
    const key = e.currentTarget.dataset.key;
    if (!this.data.modes.some(m => m.key === key) || key === this.data.mode) return;
    this.setData({ mode: key, exportReady: false, exportPath: '', exportFallback: false, manualContent: '' });
  },

  setRange(e) {
    const key = e.currentTarget.dataset.key;
    if (!this.data.ranges.some(r => r.key === key)) return;
    this.setData({ exportRange: key });
    this.updateRange();
  },

  updateRange(preserveResult) {
    const range = this.data.exportRange;
    const end = D.today();
    const start = range === 'week' ? D.weekStart(end)
      : range === 'month' ? D.monthStart(end)
        : range === 'year' ? D.yearStart(end) : '2000-01-01';
    const records = store.getRecords().filter(r => r.status === 1 && r.biz_date >= start && r.biz_date <= end);
    const signature = JSON.stringify(records);
    // 从隐私指引返回时保留已经生成的结果，数据或日期有变化才失效。
    if (preserveResult && this.data.start === start && this.data.end === end && this._recordSignature === signature) return;
    this._recordSignature = signature;
    this._content = '';
    this.setData({
      start, end, rangeLabel: range === 'all' ? '全部打卡记录（截至今天）' : start + ' 至 ' + end,
      recordCount: records.length, exportReady: false, exportPath: '', exportFallback: false, manualContent: '',
    });
  },

  exportData() {
    this.updateRange();
    const backup = this.data.mode === 'backup';
    let content;
    let fileName;
    if (backup) {
      content = store.exportAll();
      fileName = 'gg-backup-' + this.data.end + '.json';
    } else {
      if (!this.data.recordCount) { toast('所选范围没有打卡记录'); return; }
      content = store.exportCSV(this.data.start, this.data.end);
      fileName = 'gg-checkin-' + this.data.exportRange + '-' + this.data.end + '.csv';
    }
    this._content = content;
    try {
      const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
      if (!fs || fs.isMemoryOnly || typeof fs.writeFileSync !== 'function') throw new Error('NO_FILE_SYSTEM');
      const base = wx.env && wx.env.USER_DATA_PATH;
      if (!base) throw new Error('NO_FILE_PATH');
      const path = base + '/' + fileName;
      // BOM 让 Excel 正确识别 CSV 中文；JSON 不加 BOM，避免部分解析器报错。
      fs.writeFileSync(path, (backup ? '' : '\uFEFF') + content, 'utf8');
      this.setData({ exportPath: path, fileName, exportReady: true, exportFallback: false });
      toast(backup ? '备份文件已生成' : 'CSV 文件已生成');
    } catch (e) {
      // 生成失败时提供复制内容方式，复制成功前不宣称已复制。
      this.setData({ exportReady: true, fileName, exportPath: '', exportFallback: true });
    }
  },

  copyExport() {
    if (this.data.copying || !this.data.exportReady) return;
    if (!privacy.hasAgreed()) {
      wx.showModal({
        title: '需要先同意隐私指引',
        content: '复制导出内容会写入剪切板，请先阅读并同意《用户隐私保护指引》。',
        confirmText: '去查看', cancelText: '取消',
        success: res => { if (res.confirm) wx.navigateTo({ url: '/pages/privacy/privacy' }); },
      });
      return;
    }
    const fallback = this.data.exportFallback;
    const data = fallback ? this._content : this.data.exportPath;
    if (!data) return;
    this.setData({ copying: true });
    try {
      wx.setClipboardData({
        data,
        success: result => {
          if (result && result.manual) {
            this.setData({ manualContent: data });
            toast('可长按下方内容复制');
          } else {
            toast(fallback ? (this.data.mode === 'backup' ? '备份内容已复制' : 'CSV 明细已复制') : '文件路径已复制');
          }
        },
        fail: () => toast('复制失败，请重试'),
        complete: () => this.setData({ copying: false }),
      });
    } catch (e) {
      this.setData({ copying: false });
      toast('当前环境无法复制');
    }
  },
});
