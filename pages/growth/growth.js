// 成长 tab 落地页：学习体系（今日计划预览 + 唯一内容库入口）+ 体重身高。
// 数据源统一 learning.js；旧 review / poem-library 页已不再引用。
const learning = require('../../utils/learning.js');
const extra = require('../../utils/extra.js');
const D = require('../../utils/date.js');
const app = getApp();

Page({
  data: {
    date: '',
    planLabel: '',
    stats: { poemLearn: 0, englishLearn: 0, due: 0 },
    libraryLabel: '',
    heightLatest: '',
    weightLatest: '',
    reviewItems: [],
    loading: true,
  },

  onShow() { this.build(); },

  build() {
    try {
      const plan = learning.todayPlan();
      const ov = learning.overview();
      const d = plan.date || D.today();

      // 体重/身高：取果果最近一条有值的月份
      const year = Number(d.slice(0, 4));
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
      const weights = extra.getWeights();
      const heightRows = weights.filter(w => w.member_id === 'guoguo' && w.height);
      if (heightRows.length) {
        const latest = heightRows.slice().sort((a, b) => String(b.ym).localeCompare(String(a.ym)))[0];
        heightLatest = latest.height + 'cm';
      }

      const reviewItems = (plan.review || []).slice(0, 3).map(x => ({
        id: x.id, label: x.label || x.primary || '待复习',
      }));

      this.setData({
        date: d,
        planLabel: '今天可以学：诗词 ' + plan.stats.poemLearn + ' 首 · 英语 ' + plan.stats.englishLearn + ' 卡',
        stats: plan.stats,
        libraryLabel: '诗词 ' + ov.library.poem + ' 首 · 英语 ' + ov.library.english + ' 卡 · 可新增',
        weightLatest,
        heightLatest,
        reviewItems,
        loading: false,
      });
    } catch (e) {
      this.setData({ loading: false });
    }
  },

  goLearn() {
    // switchTab 不支持 query，用 globalData 一次性信号定位 tab（参照 reportView）
    if (app && app.globalData) app.globalData.learnTab = 'today';
    wx.navigateTo({ url: '/pages/learn/learn' });
  },
  goLibrary() { wx.navigateTo({ url: '/pages/learn-library/learn-library' }); },
  goWeight() { wx.navigateTo({ url: '/pages/weight/weight' }); },
  goReview() {
    if (app && app.globalData) app.globalData.learnTab = 'today';
    wx.navigateTo({ url: '/pages/learn/learn' });
  },
});
