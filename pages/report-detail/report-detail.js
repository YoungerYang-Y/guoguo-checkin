const stats = require('../../utils/stats.js');
const store = require('../../utils/store.js');
const D = require('../../utils/date.js');
const { ITEMS, GUOGUO_ITEMS, PARENT_ITEMS } = require('../../utils/constants.js');

Page({
  data: {
    type: 'week', anchor: '',
    report: null, loading: true,
    ggDetailRows: [], parentDetails: [],
    trend: [], trendMax: 1,
    advices: [],
    customBlocks: [],
    highlights: [],
    typeLabel: '',
    sections: [],
  },

  onLoad(options) {
    this.setData({ type: options.type || 'week', anchor: options.anchor || D.today() });
  },
  onShow() { this.build(); },

  build() {
    const { type, anchor } = this.data;
    const report = stats.buildReport(type, anchor);
    const targets = store.getTargets();
    const memberName = id => (store.getFamily().members.find(m => m.id === id) || {}).name || id;

    // 果果明细行
    const gg = report.members.guoguo;
    const ggDetailRows = GUOGUO_ITEMS.map(code => {
      const cnt = gg.detail.counts[code] || 0;
      let extra = '';
      if (code === 'G-MEMBER') extra = '共 ' + gg.detail.sessions + ' 节';
      if (code === 'G-ART') extra = targets['G-ART'] + ' 次/周';
      if (code === 'G-SKATE') extra = targets['G-SKATE'] + ' 次/周';
      if (code === 'G-SWIM') extra = targets['G-SWIM'] + ' 次/周';
      return { label: ITEMS[code].name, value: cnt, unit: '次', extra, category: ITEMS[code].category || '' };
    });

    // 家长明细
    const parentDetails = ['papa', 'mama'].map(id => {
      const d = report.members[id].detail;
      return {
        id, name: memberName(id),
        aiDays: d.counts['P-AI'] || 0, aiTarget: targets['P-AI'],
        wordDays: d.wordDays, wordTarget: targets['P-WORD'], wordTotal: d.wordTotal,
        swimTimes: d.counts['P-SWIM'] || 0, swimTarget: targets['P-SWIM'],
        themes: d.themes, streak: d.longestStreak,
      };
    });

    // 趋势图
    const trend = report.trend;
    const trendMax = Math.max(1, ...trend.map(t => t.total));

    // 四维得分与建议（组织成数组，便于 WXML 遍历）
    const advices = [];
    ['guoguo', 'papa', 'mama'].forEach(id => {
      const m = report.members[id];
      if (!m.dims) return;
      advices.push({
        id, name: memberName(id),
        index: m.dims.index, gap: m.dims.gap,
        dims: [
          { name: '完成率', v: m.dims.completion },
          { name: '连续性', v: m.dims.continuity },
          { name: '目标达成', v: m.dims.goal },
          { name: '广度', v: m.dims.breadth },
        ],
        texts: m.advice.texts,
        low: m.advice.low,
      });
    });

    // 自定义目标区
    const customBlocks = ['guoguo', 'papa', 'mama'].map(id => ({
      name: memberName(id), rows: report.members[id].detail.custom,
    })).filter(b => b.rows.length > 0);

    const typeLabel = type === 'week' ? '周报' : (type === 'month' ? '月报' : '年报');
    this.setData({
      report, loading: false, ggDetailRows, parentDetails, trend, trendMax,
      advices, customBlocks, typeLabel,
      sections: ['概览', '果果明细', '家长明细', '趋势', '进步空间与建议'],
    });
  },

  goCompare() { wx.switchTab({ url: '/pages/compare/compare' }); },
  onShareAppMessage() {
    return { title: '果果家庭 · ' + this.data.typeLabel, path: '/pages/report/report' };
  },
});
