const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = v => structuredClone(v);

// 用一个内存 store 同时喂 ledger.js 与 ledger-migrate.js，验证迁移的真实行为
function harness({ fees = [], failWrite = false } = {}) {
  const mem = new Map([['gg_fees', clone(fees)], ['gg_ledger', []]]);
  const store = {
    KEYS: { LEDGER: 'gg_ledger', FEES: 'gg_fees' },
    read(k, d) { return mem.has(k) ? clone(mem.get(k)) : d; },
    write(k, v) {
      if (failWrite && k === 'gg_ledger') return { data: null, error: 'WRITE_FAIL' };
      mem.set(k, clone(v));
      return { data: v, error: null };
    },
  };
  const ctx = vm.createContext({ console, Date, Math, JSON, isFinite, Number, String, Array, Object });

  function load(file, resolve) {
    const module = { exports: {} };
    const code = fs.readFileSync(file, 'utf8');
    const fn = vm.runInContext('(function(module, exports, require){' + code + '\n})', ctx, { filename: file });
    fn(module, module.exports, resolve);
    return module.exports;
  }

  const cats = require(path.join(root, 'utils', 'ledger-categories.js'));
  const ledger = load(path.join(root, 'utils', 'ledger.js'), name => {
    if (name === './store.js') return store;
    if (name === './ledger-categories.js') return cats;
    if (name === './date.js') return { today: () => '2026-11-26' };
    throw new Error('unexpected ' + name);
  });
  const migrate = load(path.join(root, 'utils', 'ledger-migrate.js'), name => {
    if (name === './store.js') return store;
    if (name === './ledger.js') return ledger;
    throw new Error('unexpected ' + name);
  });
  return { ledger, migrate, mem };
}

const FEES = [
  { id: 'f_swim', ym: '2026-03', category: 'swim', amount: 1200, note: '12 课时', created_at: '2026-03-05T10:00:00Z' },
  { id: 'f_books', ym: '2026-05', category: 'books', amount: 180, note: '', created_at: '2026-05-08T10:00:00Z' },
  { id: 'f_art', ym: '2025-09', category: 'art', amount: 600, note: '秋季班', created_at: '2025-09-02T10:00:00Z' },
];

test('迁移：培训费按分类落到育儿教育，成员固定果果，日期落月初', () => {
  const { ledger } = harness({ fees: FEES, failWrite: false });
  const { migrate } = harness({ fees: FEES });
  const r = migrate.migrateFees();
  assert.equal(r.total, 3);
  assert.equal(r.migrated, 3);
  const rows = migrate.isMigrated();
  assert.equal(rows, true, '完成后写标记');
});

test('迁移结果字段正确：兴趣班 / 教材绘本 / 备注保留原分类名', () => {
  const { migrate, ledger } = (() => {
    const h = harness({ fees: FEES });
    return h;
  })();
  migrate.migrateFees();
  const all = ledger.listAll();
  assert.equal(all.length, 3);
  const swim = all.find(r => r.src === 'fees:f_swim');
  assert.equal(swim.date, '2026-03-01', '只有月份时落到 1 号');
  assert.equal(swim.cat1, '4');
  assert.equal(swim.cat2, '4-02', '课程类归兴趣班');
  assert.equal(swim.member, 'guoguo');
  assert.equal(swim.note, '游泳 · 12 课时', '原分类名与备注都要保留');
  const books = all.find(r => r.src === 'fees:f_books');
  assert.equal(books.cat2, '4-03', '书籍购买归教材绘本');
  assert.equal(books.note, '书籍购买');
});

test('迁移幂等：重复执行不会产生重复账', () => {
  const h = harness({ fees: FEES });
  h.migrate.migrateFees();
  const first = h.ledger.listAll().length;
  const r2 = h.migrate.migrateFees();
  assert.equal(r2.migrated, 0, '第二次一条都不新增');
  assert.equal(h.ledger.listAll().length, first);
});

test('迁移容错：月份缺失的记录跳过，其余照常导入', () => {
  const fees = FEES.concat([{ id: 'f_bad', ym: '', category: 'swim', amount: 100 }]);
  const h = harness({ fees });
  const r = h.migrate.migrateFees();
  assert.equal(r.migrated, 3);
  assert.equal(r.skipped, 1, '坏记录被跳过而不是整批失败');
  assert.equal(h.ledger.listAll().length, 3);
});

test('迁移失败不写完成标记，下次启动可重试', () => {
  const h = harness({ fees: FEES, failWrite: true });
  const r = h.migrate.migrateFees();
  assert.equal(r.migrated, 0);
  assert.ok(r.error, '返回错误');
  assert.equal(h.migrate.isMigrated(), false, '不能标记完成，否则数据就真丢了');
});

test('没有培训费时不报错，并标记完成避免每次启动重算', () => {
  const h = harness({ fees: [] });
  const r = h.migrate.migrateFees();
  assert.equal(r.migrated, 0);
  assert.equal(h.migrate.isMigrated(), true);
});

test('年度汇总：合计、按月、按分类与去年同比', () => {
  const h = harness({ fees: [] });
  h.ledger.bulkAdd([
    { date: '2026-03-01', cat2: '4-02', amount: 1200, member: 'guoguo' },
    { date: '2026-03-15', cat2: '1-01', amount: 30, member: 'papa' },
    { date: '2026-07-08', cat2: '2-04', amount: 300, member: 'papa' },
    { date: '2025-05-01', cat2: '4-02', amount: 1000, member: 'guoguo' },
  ]);
  const y = h.ledger.yearSummary(2026);
  assert.equal(y.totalText, '1,530.00');
  assert.equal(y.count, 3);
  assert.equal(y.months.length, 2, '只统计有记录的月份');
  assert.equal(y.months[0].label, '3月');
  assert.equal(y.cats[0].name, '育儿教育', '按分类倒序');
  assert.equal(y.cats[0].amountText, '1,200.00');
  assert.equal(y.hasPrev, true);
  assert.equal(y.prevTotalText, '1,000.00');
  assert.equal(y.diffWord, '增加');
  assert.equal(y.diffText, '530.00');
  assert.equal(y.diffPct, 53);
});

test('年度汇总：去年没有记录时不给同比百分比（避免「增长 100%」误导）', () => {
  const h = harness({ fees: [] });
  h.ledger.bulkAdd([{ date: '2026-01-05', cat2: '1-05', amount: 200, member: 'mama' }]);
  const y = h.ledger.yearSummary(2026);
  assert.equal(y.hasPrev, false);
  assert.equal(y.diffPct, 0);
});
