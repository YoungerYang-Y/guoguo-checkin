const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const D = require('../../utils/date.js');

Page({
  data: {
    anchor: '',
    title: '',
    weeks: [],
    selected: '',
    selectedStat: null,
    canPrev: true,
    legend: [
      { cls: 'full', text: '全勤' },
      { cls: 'partial', text: '部分完成' },
      { cls: 'none', text: '未打卡' },
      { cls: 'future', text: '未来' },
    ],
  },

  onLoad() {
    this.setData({ anchor: D.today(), selected: D.today() });
  },
  onShow() { this.build(); },

  build() {
    const anchor = this.data.anchor;
    const y = Number(anchor.slice(0, 4)), m = Number(anchor.slice(5, 7));
    this.setData({ title: y + ' 年 ' + m + ' 月' });
    const first = y + '-' + (m < 10 ? '0' + m : m) + '-01';
    const startDow = D.weekday(first); // 1=周一
    const lastDay = new Date(y, m, 0).getDate();
    const today = D.today();

    const days = [];
    // 前置空格（每个格子都必须有唯一 key，否则 WXML 会复用同一个节点，整月只显示一格）
    for (let i = 1; i < startDow; i++) days.push({ empty: true, key: 'e' + i });
    for (let d = 1; d <= lastDay; d++) {
      const date = y + '-' + (m < 10 ? '0' + m : m) + '-' + (d < 10 ? '0' + d : d);
      const s = stats.dayStat('guoguo', date);
      const pf = stats.dayStat('papa', date);
      const mf = stats.dayStat('mama', date);
      let cls = 'none';
      if (date > today) cls = 'future';
      else if (s.isFull && pf.isFull && mf.isFull) cls = 'full';
      else if (s.hasAny || pf.hasAny || mf.hasAny) cls = 'partial';
      days.push({ empty: false, key: date, date, day: d, cls, hasBackfill: (s.backfillCount + pf.backfillCount + mf.backfillCount) > 0, isToday: date === today });
    }
    // 只把「末行」补满 7 格，不新增空行：末行格子不足时 flex:1 会把少数日期撑满整行（拉宽甚至居中）。
    // 补齐后每行严格 7 格，行高由 WXSS 固定，整月网格不产生断层。
    const totalCells = Math.ceil(days.length / 7) * 7;
    while (days.length < totalCells) days.push({ empty: true, key: 'b' + days.length });
    const cells = days.slice(0, totalCells);
    // 按 7 天分组：每行也要带唯一 key
    const weeks = [];
    for (let i = 0; i < totalCells; i += 7) {
      weeks.push({ key: 'w' + (i / 7), days: cells.slice(i, i + 7) });
    }
    this.setData({ weeks });

    // 选中日期统计
    const sel = this.data.selected;
    const gs = stats.dayStat('guoguo', sel), ps = stats.dayStat('papa', sel), ms = stats.dayStat('mama', sel);
    this.setData({
      canPrev: anchor > '2020-01',
      selectedStat: {
        date: sel,
        total: gs.doneTotal + ps.doneTotal + ms.doneTotal,
        full: [gs, ps, ms].filter(x => x.isFull).length,
        backfill: gs.backfillCount + ps.backfillCount + ms.backfillCount,
        canBackfill: store.canBackfill(sel),
        isFuture: sel > today,
        members: [
          { name: '果果', done: gs.doneRequired, req: gs.required, full: gs.isFull, color: '#F58AAE' },
          { name: '爸爸', done: ps.doneRequired, req: ps.required, full: ps.isFull, color: '#61DDAA' },
          { name: '妈妈', done: ms.doneRequired, req: ms.required, full: ms.isFull, color: '#F6BD16' },
        ],
      },
    });
  },

  prevMonth() {
    const y = Number(this.data.anchor.slice(0, 4)), m = Number(this.data.anchor.slice(5, 7));
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    this.setData({ anchor: py + '-' + (pm < 10 ? '0' + pm : pm) + '-01' }, () => this.build());
  },
  nextMonth() {
    const y = Number(this.data.anchor.slice(0, 4)), m = Number(this.data.anchor.slice(5, 7));
    const nm = m === 12 ? 1 : m + 1, ny = m === 12 ? y + 1 : y;
    const nextAnchor = ny + '-' + (nm < 10 ? '0' + nm : nm) + '-01';
    if (nextAnchor.slice(0, 7) > D.today().slice(0, 7)) return;
    this.setData({ anchor: nextAnchor }, () => this.build());
  },
  selectDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date) return;
    this.setData({ selected: date }, () => this.build());
  },
  goReport() { wx.navigateTo({ url: '/pages/report/report' }); },

  goCheckin() {
    const date = this.data.selected || D.today();
    // 首页是 tabBar 页面，navigateTo 无法跳转且不能带 query；
    // 先暂存日期，再用 switchTab 切换，由首页 onShow 读取。
    const app = getApp();
    if (app && app.globalData) app.globalData.pendingCheckinDate = date;
    try { wx.setStorageSync('gg_pending_checkin_date', date); } catch (e) {}
    wx.switchTab({
      url: '/pages/index/index',
      fail: () => wx.showToast({ title: '打开打卡页失败，请重试', icon: 'none' }),
    });
  },
});
