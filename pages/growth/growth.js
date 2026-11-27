// 成长 tab 落地页：三个模块的汇总视角 + 统一入口。
// 数据全部取自现有模块（review / extra / date），不新造数据结构；三个二级页保持原样。
const review = require('../../utils/review.js');
const extra = require('../../utils/extra.js');
const D = require('../../utils/date.js');

Page({
  data: {
    weekLabel: '',
    poem: { learned: 0, pending: 0, bank: 0 },
    word: { learned: 0, pending: 0, bank: 0 },
    heightLatest: '',
    weightLatest: '',
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
  goReview(e) {
    const module = e.currentTarget.dataset.module;
    const url = module === 'poems' ? '/pages/poems/poems' : '/pages/words/words';
    wx.navigateTo({ url: url + '?tab=review' });
  },
});
