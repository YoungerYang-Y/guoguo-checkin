const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = value => value === undefined ? undefined : structuredClone(value);

// 成长页已切到 learning.js；这里注入最小 mock，只验证页面聚合与跳转。
function loadGrowth({ plan = {}, ov = {}, weights = [], navigate = [], fail = false } = {}) {
  const source = fs.readFileSync(path.join(root, 'pages/growth/growth.js'), 'utf8');
  let definition;
  const learning = {
    todayPlan: () => fail ? (() => { throw new Error('boom'); })() : Object.assign({
      date: '2026-11-28',
      stats: { poemLearn: 1, englishLearn: 2, due: 3 },
      review: [
        { id: 'p1', label: '静夜思' },
        { id: 'w1', label: 'apple' },
        { id: 'w2', label: 'Good morning' },
      ],
    }, plan),
    overview: () => Object.assign({ library: { poem: 20, english: 50 } }, ov),
  };
  const extra = {
    weightTable: () => Array.from({ length: 12 }, (_, i) => ({
      ym: '2026-' + String(i + 1).padStart(2, '0'),
      values: [{ memberId: 'guoguo', value: i === 10 ? 32.5 : null }],
    })),
    getWeights: () => weights,
  };
  vm.runInNewContext(source, {
    Page(value) { definition = value; },
    wx: { navigateTo: o => navigate.push(o) },
    require(name) {
      if (name === '../../utils/learning.js') return learning;
      if (name === '../../utils/extra.js') return extra;
      if (name === '../../utils/date.js') return { today: () => '2026-11-28' };
      throw new Error('unexpected module ' + name);
    },
    getApp: () => ({ globalData: {} }),
    Date, Math, String, Number, Array, Object, Error, RegExp,
  }, { filename: path.join(root, 'pages/growth/growth.js') });
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(values) { Object.assign(this.data, values); },
  });
}

test('成长页汇总今日计划：新学诗词/英语与待复习数', () => {
  const page = loadGrowth();
  page.build();
  assert.equal(page.data.loading, false);
  assert.equal(page.data.stats.poemLearn, 1);
  assert.equal(page.data.stats.englishLearn, 2);
  assert.equal(page.data.stats.due, 3);
  assert.match(page.data.planLabel, /诗词 1 首.*英语 2 卡/);
  assert.match(page.data.libraryLabel, /诗词 20 首.*英语 50 卡/);
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

test('成长页待复习预览最多 3 条且只保留 id/label', () => {
  const page = loadGrowth();
  page.build();
  assert.equal(page.data.reviewItems.length, 3);
  assert.equal(page.data.reviewItems[0].id, 'p1');
  assert.equal(page.data.reviewItems[0].label, '静夜思');
  assert.deepEqual(Object.keys(page.data.reviewItems[0]).sort(), ['id', 'label']);
});

test('成长页入口跳转：今日学习/内容库/体重/复习，无旧页与记账跳转', () => {
  const navigate = [];
  const page = loadGrowth({ navigate });
  page.goLearn(); page.goLibrary(); page.goWeight(); page.goReview();
  const urls = navigate.map(x => x.url);
  assert.equal(urls.length, 4);
  assert.deepEqual(urls, [
    '/pages/learn/learn',
    '/pages/learn-library/learn-library',
    '/pages/weight/weight',
    '/pages/learn/learn',
  ]);
  ['goPoems', 'goPoemLibrary', 'goWords', 'goLedger'].forEach(k =>
    assert.equal(typeof page[k], 'undefined', '已移除入口 ' + k));
});

test('学习引擎读取失败不拖垮落地页', () => {
  const page = loadGrowth({ fail: true });
  page.build();
  assert.equal(page.data.loading, false, '入口仍可用');
});
