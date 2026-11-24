const stats = require('../../utils/stats.js');
const store = require('../../utils/store.js');
const D = require('../../utils/date.js');

Page({
  data: {
    type: 'week',
    types: [
      { key: 'week', label: '周报' },
      { key: 'month', label: '月报' },
      { key: 'year', label: '年报' },
    ],
    anchor: '',
    key: '',
    title: '',
    canPrev: true,
    canNext: false,
    report: null,
    summaryCards: [],
    memberCards: [],
    sampleNote: '',
    loading: true,
    hasPrevData: false,
  },

  onLoad() { this.setData({ anchor: D.today() }); },
  onShow() { this.build(); },

  setType(e) {
    this.setData({ type: e.currentTarget.dataset.key, anchor: D.today(), loading: true }, () => this.build());
  },

  build() {
    const type = this.data.type;
    const report = stats.buildReport(type, this.data.anchor);
    // 保存快照
    store.saveSnapshot({ type, key: report.key, generatedAt: report.generatedAt, totalDone: report.totalDone });

    const memberCards = store.getFamily().members.map(m => {
      const r = report.members[m.id];
      return {
        id: m.id, name: m.name,
        index: r.dims ? r.dims.index : null,
        valid: r.valid,
        delta: r.delta, trend: r.trend,
        effectiveDays: r.effectiveDays || 0, minDays: r.minDays || (type === 'week' ? 3 : (type === 'month' ? 10 : 90)),
      };
    });
    const summaryCards = [
      { label: '完成项总数', value: report.totalDone, unit: '项' },
      { label: '果果全勤天数', value: report.fullDays, unit: '天' },
      { label: '补卡比例', value: report.backfillRate, unit: '%' },
      { label: '有效打卡日', value: report.members.guoguo.effectiveDays, unit: '天' },
    ];
    const invalid = memberCards.filter(c => !c.valid);
    // 当前周期不允许再向后翻
    const curStart = type === 'week' ? D.weekStart(D.today()) : (type === 'month' ? D.monthStart(D.today()) : D.yearStart(D.today()));
    const anchorStart = type === 'week' ? D.weekStart(this.data.anchor) : (type === 'month' ? D.monthStart(this.data.anchor) : D.yearStart(this.data.anchor));
    this.setData({
      report, memberCards, summaryCards,
      key: report.key, title: report.title,
      loading: false,
      canNext: anchorStart < curStart,
      canPrev: true,
      sampleNote: invalid.length ? ('样本不足，暂不作结论（' + invalid.map(c => c.name + ' 有效打卡日 ' + c.effectiveDays + '/' + c.minDays + ' 天').join('；') + '）') : '',
    });
  },

  prevPeriod() {
    const t = this.data.type, a = this.data.anchor;
    let next;
    if (t === 'week') next = D.addDays(a, -7);
    else if (t === 'month') {
      const y = Number(a.slice(0,4)), m = Number(a.slice(5,7));
      const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y-1 : y;
      next = py + '-' + (pm<10?'0'+pm:pm) + '-01';
    } else next = String(Number(a.slice(0,4)) - 1) + '-01-01';
    this.setData({ anchor: next, loading: true }, () => this.build());
  },
  nextPeriod() {
    if (!this.data.canNext) return;
    const t = this.data.type, a = this.data.anchor;
    let next;
    if (t === 'week') next = D.addDays(a, 7);
    else if (t === 'month') {
      const y = Number(a.slice(0,4)), m = Number(a.slice(5,7));
      const nm = m === 12 ? 1 : m+1, ny = m === 12 ? y+1 : y;
      next = ny + '-' + (nm<10?'0'+nm:nm) + '-01';
    } else next = String(Number(a.slice(0,4)) + 1) + '-01-01';
    this.setData({ anchor: next, loading: true }, () => this.build());
  },

  goDetail() { wx.navigateTo({ url: '/pages/report-detail/report-detail?type=' + this.data.type + '&anchor=' + this.data.anchor }); },
  goCompare() { wx.switchTab({ url: '/pages/compare/compare' }); },
});
