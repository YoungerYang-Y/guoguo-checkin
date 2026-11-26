const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = v => v === undefined ? undefined : structuredClone(v);

// 用内存 Map 模拟 store，只实现 ledger.js 用到的 read/write/KEYS
function loadLedger(seed = []) {
  const mem = new Map();
  mem.set('gg_ledger', clone(seed));
  const store = {
    KEYS: { LEDGER: 'gg_ledger' },
    read(key, def) { return mem.has(key) ? clone(mem.get(key)) : def; },
    write(key, val) { mem.set(key, clone(val)); return { data: val, error: null }; },
  };
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports,
    require(name) {
      if (name === './store.js') return store;
      if (name === './ledger-categories.js') return require(path.join(root, 'utils/ledger-categories.js'));
      if (name === './date.js') return { today: () => '2026-11-26' };
      throw new Error('unexpected ' + name);
    },
    Date, Math, String, Number, Array, Object, Error, RegExp, isFinite,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/ledger.js'), 'utf8'), sandbox,
    { filename: path.join(root, 'utils/ledger.js') });
  return { ledger: module.exports, mem };
}

test('记账：新增一条正常记录', () => {
  const { ledger } = loadLedger();
  const r = ledger.add({ date: '2026-11-26', cat2: '1-02', amount: 35.5, member: 'mama', note: '买菜' });
  assert.equal(r.error, null);
  assert.equal(r.data.cat1, '1');
  assert.equal(r.data.ym, '2026-11');
  assert.equal(r.data.amount, 35.5);
  assert.equal(r.data.member, 'mama');
  assert.equal(ledger.listAll().length, 1);
});

test('记账：居住类强制计入公共支出，忽略传入成员', () => {
  const { ledger } = loadLedger();
  const r = ledger.add({ date: '2026-11-01', cat2: '2-02', amount: 5800, member: 'papa' });
  assert.equal(r.error, null);
  assert.equal(r.data.member, 'public', '房贷属于公共支出');
  assert.equal(r.data.cat1, '2');
});

test('记账：金额非法一律拒绝（0 / 负数 / 非数字）', () => {
  const { ledger } = loadLedger();
  for (const amount of [0, -10, 'abc', '', null]) {
    const r = ledger.add({ date: '2026-11-26', cat2: '1-01', amount, member: 'papa' });
    assert.equal(r.error, 'BAD_AMOUNT', String(amount));
  }
  assert.equal(ledger.listAll().length, 0);
});

test('记账：分类与日期必须合法', () => {
  const { ledger } = loadLedger();
  assert.equal(ledger.add({ date: '2026-11-26', cat2: '99-99', amount: 10 }).error, 'BAD_CATEGORY');
  assert.equal(ledger.add({ date: '2026/11/26', cat2: '1-01', amount: 10 }).error, 'BAD_DATE');
  assert.equal(ledger.add({ date: '2026-11-26', cat2: '1-01', amount: 10, member: 'nobody' }).error, 'BAD_MEMBER');
});

test('记账：浮点累加不产生精度误差', () => {
  const { ledger } = loadLedger();
  [0.1, 0.2, 0.3].forEach(a => ledger.add({ date: '2026-11-26', cat2: '1-01', amount: a, member: 'papa' }));
  const sum = ledger.summary('2026-11');
  assert.equal(sum.totalText, '0.60', '按分累加避免 0.1+0.2=0.30000000000000004');
});

test('汇总：按成员与分类分组，占比合计约等于 100%', () => {
  const { ledger } = loadLedger();
  ledger.add({ date: '2026-11-26', cat2: '1-02', amount: 300, member: 'mama' });
  ledger.add({ date: '2026-11-26', cat2: '4-02', amount: 700, member: 'guoguo' });
  ledger.add({ date: '2026-11-26', cat2: '2-04', amount: 1000, member: 'papa' });
  const sum = ledger.summary('2026-11');
  assert.equal(sum.totalText, '2000.00');
  assert.equal(sum.count, 3);
  const mama = sum.members.find(m => m.id === 'mama');
  assert.equal(mama.amountText, '300.00');
  assert.equal(mama.pct, 15);
  const pub = sum.members.find(m => m.id === 'public');
  assert.equal(pub.amountText, '1000.00', '居住类归到公共');
  assert.equal(sum.cats[0].code, '2', '分类按金额倒序');
  assert.equal(sum.cats[0].pct, 50);
});

test('汇总：待整理占比超过 5% 能被识别', () => {
  const { ledger } = loadLedger();
  ledger.add({ date: '2026-11-26', cat2: '13-01', amount: 100, member: 'papa' });
  ledger.add({ date: '2026-11-26', cat2: '1-01', amount: 900, member: 'mama' });
  const sum = ledger.summary('2026-11');
  assert.equal(sum.pendingPct, 10, '待整理 100/1000 = 10%');
});

test('编辑与删除：改分类后居住属性同步生效', () => {
  const { ledger } = loadLedger();
  const r = ledger.add({ date: '2026-11-26', cat2: '1-01', amount: 50, member: 'papa' });
  const id = r.data.id;
  const up = ledger.update(id, { cat2: '2-03', amount: 120 });
  assert.equal(up.error, null);
  assert.equal(up.data.cat1, '2');
  assert.equal(up.data.member, 'public', '改成居住类后成员被强制为公共');
  assert.equal(ledger.remove(id).error, null);
  assert.equal(ledger.listAll().length, 0);
  assert.equal(ledger.remove(id).error, 'NOT_FOUND');
});

test('明细：按月过滤并按日期倒序', () => {
  const { ledger } = loadLedger();
  ledger.add({ date: '2026-11-05', cat2: '1-01', amount: 10, member: 'papa' });
  ledger.add({ date: '2026-11-20', cat2: '1-02', amount: 20, member: 'papa' });
  ledger.add({ date: '2026-10-30', cat2: '1-03', amount: 30, member: 'papa' });
  const rows = ledger.listByMonth('2026-11');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, '2026-11-20', '最近的日期在前');
  assert.equal(ledger.months()[0], '2026-11', '默认含本月，倒序');
});

test('分类表：13 个一级、71 个二级，居住为公共专属', () => {
  const C = require(path.join(root, 'utils/ledger-categories.js'));
  assert.equal(C.CATEGORIES.length, 13);
  const total = C.CATEGORIES.reduce((n, c) => n + c.children.length, 0);
  assert.equal(total, 71);
  assert.equal(C.isPublicOnly('2'), true);
  assert.equal(C.isPublicOnly('1'), false);
  assert.equal(C.findCat2('2-02').name, '房贷');
  assert.equal(C.cat1Name('2'), '居住');
});
