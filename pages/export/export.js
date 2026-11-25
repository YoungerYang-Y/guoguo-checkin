const store = require('../../utils/store.js');
const D = require('../../utils/date.js');
const privacy = require('../../utils/privacy.js');

const toast = title => wx.showToast({ title, icon: 'none' });

Page({
  data: {
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
  },

  onShow() { this.updateRange(true); },

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
    this._csv = '';
    this.setData({
      start, end, rangeLabel: range === 'all' ? '全部打卡记录（截至今天）' : start + ' 至 ' + end,
      recordCount: records.length, exportReady: false, exportPath: '', exportFallback: false, manualContent: '',
    });
  },

  exportCSV() {
    this.updateRange();
    if (!this.data.recordCount) { toast('所选范围没有打卡记录'); return; }
    this._csv = store.exportCSV(this.data.start, this.data.end);
    try {
      const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
      if (!fs || fs.isMemoryOnly || typeof fs.writeFileSync !== 'function') throw new Error('NO_FILE_SYSTEM');
      const base = wx.env && wx.env.USER_DATA_PATH;
      if (!base) throw new Error('NO_FILE_PATH');
      const path = base + '/gg-checkin-' + this.data.exportRange + '-' + this.data.end + '.csv';
      fs.writeFileSync(path, '\uFEFF' + this._csv, 'utf8');
      this.setData({ exportPath: path, exportReady: true, exportFallback: false });
      toast('CSV 文件已生成');
    } catch (e) {
      // 生成失败时提供原有的复制明细方式，复制成功前不宣称已复制。
      this.setData({ exportReady: true, exportPath: '', exportFallback: true });
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
    const data = fallback ? this._csv : this.data.exportPath;
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
            toast(fallback ? 'CSV 明细已复制' : '文件路径已复制');
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
