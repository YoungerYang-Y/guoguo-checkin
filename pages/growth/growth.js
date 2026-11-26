// 成长 tab 落地页：四大模块的汇总视角 + 统一入口。
// 数据全部取自现有模块（review / extra / date），不新造数据结构；四个二级页保持原样。
const review = require('../../utils/review.js');
const extra = require('../../utils/extra.js');
const ledger = require('../../utils/ledger.js');
const D = require('../../utils/date.js');

Page({
  data: {
    weekLabel: '',
    poem: { learned: 0, pending: 0, bank: 0 },
    word: { learned: 0, pending: 0, bank: 0 },
    heightLatest: '',
    weightLatest: '',
    feeYear: '',
    feeTotal: '',
    reviewItems: [],
    loading: true,
  },

  onShow() { this.build(); },

  build() {
    try {
      const poems = review.overview('poems');
      const words = review.overview('words');

      // 体重/身高：取果果最近一条有值的月份（weightTable 返回按月份 1-12）
      const year = Number(D.today().slice(0, 4));
      const table = extra.weightTable(year);
      let weightLatest = '';
      let heightLatest = '';
      for (let i = table.length - 1; i >= 0; i--) {
        const row = table[i];
        const guoguo = row.values.find(v => v.memberId === 'guoguo');
        if (guoguo && guoguo.value !== null && guoguo.value !== undefined && !weightLatest) {
          weightLatest = guoguo.value + 'kg';
        }
      }
      // 身高存在 gg_weights 的 height 字段，weightTable 只取 weight；有值时一并展示
      const weights = extra.getWeights();
      const heightRows = weights.filter(w => w.member_id === 'guoguo' && w.height);
      if (heightRows.length) {
        const latest = heightRows.slice().sort((a, b) => String(b.ym).localeCompare(String(a.ym)))[0];
        heightLatest = latest.height + 'cm';
      }

      // 培训支出：培训费已并入家庭记账，这里只读记账的年度汇总（育儿教育 = 分类 4）
      const yearView = ledger.yearSummary(year);
      const edu = yearView.cats.find(c => c.code === '4');

      // 本周待复习：合并古诗/单词，最多 3 条
      const pr = review.weeklyReview('poems');
      const wr = review.weeklyReview('words');
      const reviewItems = []
        .concat(pr.items.filter(x => x.state === 'pending' || x.state === 'failed').map(x => ({
          id: x.id, module: 'poems', label: x.label || x.title || x.text || '古诗',
        })))
        .concat(wr.items.filter(x => x.state === 'pending' || x.state === 'failed').map(x => ({
          id: x.id, module: 'words', label: x.label || x.title || x.text || '单词',
        })))
        .slice(0, 3);

      this.setData({
        weekLabel: poems.weekLabel || wr.weekLabel || '',
        poem: { learned: poems.learnedThisWeek, pending: poems.pending, bank: poems.bankCount },
        word: { learned: words.learnedThisWeek, pending: words.pending, bank: words.bankCount },
        weightLatest,
        heightLatest,
        feeYear: year + ' 年',
        feeTotal: edu ? '¥' + edu.amountText : '¥0.00',
        reviewItems,
        loading: false,
      });
    } catch (e) {
      // 任何一个模块读失败都不拖垮落地页，入口仍然可用
      this.setData({ loading: false });
    }
  },

  goPoems() { wx.navigateTo({ url: '/pages/poems/poems' }); },
  goWords() { wx.navigateTo({ url: '/pages/words/words' }); },
  goWeight() { wx.navigateTo({ url: '/pages/weight/weight' }); },
  // 培训支出已并入记账：切到记账 tab 并直接落在「汇总 · 按年」
  goLedger() {
    const app = getApp();
    if (app && app.globalData) app.globalData.ledgerView = 'year';
    wx.switchTab({ url: '/pages/ledger/ledger' });
  },
  goReview(e) {
    const module = e.currentTarget.dataset.module;
    const url = module === 'poems' ? '/pages/poems/poems' : '/pages/words/words';
    wx.navigateTo({ url: url + '?tab=review' });
  },
});
