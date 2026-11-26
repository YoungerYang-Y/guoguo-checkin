const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = value => value === undefined ? undefined : structuredClone(value);

function loadGrowth({ poems = {}, words = {}, weights = [], feesTotal = '¥0', navigate = [] } = {}) {
  const source = fs.readFileSync(path.join(root, 'pages/growth/growth.js'), 'utf8');
  let definition;
  const review = {
    overview: module => module === 'poems'
      ? Object.assign({ weekLabel: '第 46 周', learnedThisWeek: 3, pending: 2, passed: 1, failed: 0, bankCount: 4 }, poems)
      : Object.assign({ weekLabel: '第 46 周', learnedThisWeek: 5, pending: 1, passed: 2, failed: 0, bankCount: 7 }, words),
    weeklyReview: module => ({
      weekLabel: '第 46 周',
      items: module === 'poems'
        ? [{ id: 'p1', label: '静夜思', state: 'pending' }]
        : [{ id: 'w1', label: 'apple', state: 'failed' }, { id: 'w2', label: 'Good morning', state: 'pending' }],
    }),
  };
  const extra = {
    weightTable: () => Array.from({ length: 12 }, (_, i) => ({
      ym: '2026-' + String(i + 1).padStart(2, '0'),
      values: [{ memberId: 'guoguo', value: i === 10 ? 32.5 : null }],
    })),
    getWeights: () => weights,
    monthAnalysis: () => ({ totalText: feesTotal }),
  };
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    wx: { navigateTo: o => navigate.push(o) },
    require(name) {
      if (name === '../../utils/review.js') return review;
      if (name === '../../utils/extra.js') return extra;
      if (name === '../../utils/date.js') return { today: () => '2026-11-26' };
      throw new Error('unexpected module ' + name);
    },
    Date, Math, String, Number, Array, Object, Error, RegExp,
  }, { filename: path.join(root, 'pages/growth/growth.js') });
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(values) { Object.assign(this.data, values); },
  });
}

test('成长页汇总古诗/单词/待复习数字', () => {
  const page = loadGrowth();
  page.build();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.poem.learned, 3);
  assert.equal(page.data.word.learned, 5);
  assert.equal(page.data.poem.pending + page.data.word.pending, 3);
  assert.equal(page.data.weekLabel, '第 46 周');
});

test('成长页取果果最近体重与身高', () => {
  const page = loadGrowth({ weights: [
    { member_id: 'guoguo', ym: '2026-10', weight: 32.5, height: 128 },
    { member_id: 'guoguo', ym: '2026-11', weight: 33.1, height: 130 },
  ] });
  page.build();
  assert.equal(page.data.weightLatest, '32.5kg');
  assert.equal(page.data.heightLatest, '130cm');
});

test('成长页待复习列表最多 3 条且带模块标记', () => {
  const page = loadGrowth();
  page.build();
  assert.equal(page.data.reviewItems.length, 3);
  assert.equal(page.data.reviewItems[0].module, 'poems');
  assert.equal(page.data.reviewItems[1].module, 'words');
  assert.equal(page.data.reviewItems[2].module, 'words');
  assert.equal(page.data.reviewItems[0].label, '静夜思');
});

test('成长页四个入口跳转二级页，待复习直达复习 tab', () => {
  const navigate = [];
  const page = loadGrowth({ navigate });
  page.goPoems(); page.goWords(); page.goWeight(); page.goFees();
  page.goReview({ currentTarget: { dataset: { module: 'poems' } } });
  page.goReview({ currentTarget: { dataset: { module: 'words' } } });
  const urls = navigate.map(x => x.url);
  assert.equal(urls.length, 6);
  assert.equal(urls[0], '/pages/poems/poems');
  assert.equal(urls[1], '/pages/words/words');
  assert.equal(urls[2], '/pages/weight/weight');
  assert.equal(urls[3], '/pages/fees/fees');
  assert.equal(urls[4], '/pages/poems/poems?tab=review');
  assert.equal(urls[5], '/pages/words/words?tab=review');
});

test('某模块读取失败不拖垮落地页', () => {
  const source = fs.readFileSync(path.join(root, 'pages/growth/growth.js'), 'utf8');
  let definition;
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    wx: {},
    require(name) {
      if (name === '../../utils/review.js') return { overview: () => { throw new Error('boom'); } };
      if (name === '../../utils/extra.js') return {};
      if (name === '../../utils/date.js') return { today: () => '2026-11-26' };
      throw new Error('unexpected module ' + name);
    },
    Date, Math, String, Number, Array, Object, Error, RegExp,
  });
  const page = Object.assign({}, definition, { data: clone(definition.data), setData(v) { Object.assign(this.data, v); } });
  page.build();
  assert.equal(page.data.loading, false, '入口仍可用');
});
