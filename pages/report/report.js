const stats = require('../../utils/stats.js');
const store = require('../../utils/store.js');
const D = require('../../utils/date.js');

const COLORS = { guoguo: '#F58AAE', papa: '#61DDAA', mama: '#F6BD16' };
const app = getApp();

Page({
  data: {
    // 一级视图：报表 / 对比（原独立「对比」tab 已并入本页）
    view: 'report',
    views: [
      { key: 'report', label: '报表' },
      { key: 'compare', label: '对比' },
    ],
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
    // 成员卡片：报表视图与对比视图共用同一份数据，避免两次计算
    memberCards: [],
    dimNames: ['完成率', '连续性', '目标达成', '广度与自主'],
    hasData: false,
    radarReady: false,
    sampleNote: '',
    loading: true,
    hasPrevData: false,
  },

  onLoad() { this.setData({ anchor: D.today() }); },
  onShow() {
    // 报表详情页等可通过 globalData 指定进入对比视图（switchTab 不支持 query 传参）
    if (app.globalData && app.globalData.reportView) {
      this.setData({ view: app.globalData.reportView });
      app.globalData.reportView = '';
    }
    this.build();
  },

  // 一级视图切换：切到对比时重绘雷达图（canvas 只在对比视图存在）
  switchView(e) {
    const view = e.currentTarget.dataset.view;
    if (!view || view === this.data.view) return;
    this.setData({ view }, () => {
      if (view === 'compare') this.renderRadar();
    });
  },

  setType(e) {
    this.setData({ type: e.currentTarget.dataset.key, anchor: D.today(), loading: true }, () => this.build());
  },

  build() {
    const type = this.data.type;
    const report = stats.buildReport(type, this.data.anchor);
    // 保存快照
    store.saveSnapshot({ type, key: report.key, generatedAt: report.generatedAt, totalDone: report.totalDone });

    const memberCards = store.getFamily().members.map(m => {
      const r = report.members[m.id] || {};
      const dims = r.dims;
      return {
        id: m.id, name: m.name, color: COLORS[m.id] || '#9aa0a6',
        index: dims ? dims.index : null,
        valid: !!r.valid,
        gap: dims ? dims.gap : null,
        delta: r.delta, trend: r.trend,
        effectiveDays: r.effectiveDays || 0,
        minDays: r.minDays || (type === 'week' ? 3 : (type === 'month' ? 10 : 90)),
        dims: dims ? [dims.completion, dims.continuity, dims.goal, dims.breadth] : [0, 0, 0, 0],
        advice: r.advice ? r.advice.texts : [],
        low: r.advice && r.advice.low ? r.advice.low.join('、') : '',
        rank: null,
      };
    });

    // 指数排行：仅有效样本参与，按指数从高到低
    const ranked = memberCards.filter(c => c.valid).slice().sort((a, b) => b.index - a.index);
    ranked.forEach((c, i) => { c.rank = i + 1; });

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
    const hasData = memberCards.some(c => c.valid);

    this.setData({
      report, memberCards, summaryCards, hasData,
      key: report.key, title: report.title,
      loading: false,
      canNext: anchorStart < curStart,
      canPrev: true,
      radarReady: false,
      sampleNote: invalid.length ? ('样本不足，暂不作结论（' + invalid.map(c => c.name + ' 有效打卡日 ' + c.effectiveDays + '/' + c.minDays + ' 天').join('；') + '）') : '',
    }, () => {
      if (this.data.view === 'compare') this.renderRadar();
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

  // ---- 对比视图：雷达图 ----
  renderRadar() {
    const valid = (this.data.memberCards || []).filter(m => m.valid);
    if (!valid.length) return;
    this.drawRadar(valid);
  },

  // 用 canvas 绘制四维雷达图
  drawRadar(validMembers) {
    const query = wx.createSelectorQuery();
    query.select('#radar').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0] || !res[0].node) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio || 2;
      const size = 260;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.scale(dpr, dpr);
      const cx = size / 2, cy = size / 2, R = 92;
      const N = 4;
      const angle = i => (Math.PI * 2 * i) / N - Math.PI / 2;

      ctx.clearRect(0, 0, size, size);
      // 网格
      for (let level = 1; level <= 4; level++) {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const r = R * level / 4;
          const x = cx + r * Math.cos(angle(i)), y = cy + r * Math.sin(angle(i));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = '#e5e8eb'; ctx.lineWidth = 1; ctx.stroke();
      }
      // 轴线
      for (let i = 0; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + R * Math.cos(angle(i)), cy + R * Math.sin(angle(i)));
        ctx.strokeStyle = '#e5e8eb'; ctx.stroke();
      }
      // 各成员多边形
      validMembers.forEach(m => {
        ctx.beginPath();
        m.dims.forEach((v, i) => {
          const r = R * Math.max(0, Math.min(100, v)) / 100;
          const x = cx + r * Math.cos(angle(i)), y = cy + r * Math.sin(angle(i));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = this.hexToRgba(m.color, 0.14); ctx.fill();
        ctx.strokeStyle = m.color; ctx.lineWidth = 2; ctx.stroke();
      });
      // 顶点标签
      ctx.fillStyle = '#646a73'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      const labels = ['完成率', '连续性', '目标达成', '广度'];
      labels.forEach((l, i) => {
        const x = cx + (R + 20) * Math.cos(angle(i));
        const y = cy + (R + 20) * Math.sin(angle(i)) + 4;
        ctx.fillText(l, x, y);
      });
      this.setData({ radarReady: true });
    });
  },

  hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  },

  goDetail() { wx.navigateTo({ url: '/pages/report-detail/report-detail?type=' + this.data.type + '&anchor=' + this.data.anchor }); },
});
