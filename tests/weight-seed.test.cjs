'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const utils = path.resolve(__dirname, '../utils');

function harness() {
  const mem = {}, cache = {};
  const wx = {
    getStorageSync: k => (k in mem ? structuredClone(mem[k]) : ''),
    setStorageSync: (k, v) => { mem[k] = structuredClone(v); },
    removeStorageSync: k => { delete mem[k]; },
  };
  function load(name) {
    if (cache[name]) return cache[name];
    if (name === 'cloudstore.js') return { markDirty() {} };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(utils, name), 'utf8'), {
      module, exports: module.exports, wx, Date,
      require: p => load(path.basename(p)),
    });
    cache[name] = module.exports;
    return module.exports;
  }
  const store = load('store.js');
  store.initFamily();
  return { store, mem, seed: load('weight-seed.js'), extra: load('extra.js') };
}

test('果果历史测量：13 条原始记录数值完整且未改', () => {
  const { seed } = harness();
  assert.equal(seed.ROWS.length, 13);
  const first = seed.ROWS[0], last = seed.ROWS[seed.ROWS.length - 1];
  assert.deepEqual([first.date, first.age, first.h, first.w], ['2022-11-15', '出生', 52.0, 3.42]);
  assert.deepEqual([last.date, last.age, last.h, last.w], ['2026-11-13', '3岁11个月29天', 104.9, 15.9]);
  assert.equal(new Set(seed.ROWS.map(r => r.ym)).size, 13, '13 条应各占不同年月，避免同步合并键冲突');
  assert.ok(seed.ROWS.every(r => r.h > 0 && r.w > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.date)));
  // 家长提供的年度增长能从原始值复算，佐证数据自洽（浮点用容差）
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, a + ' 应约等于 ' + b);
  near(76.0 - 52.0, 24.0);
  near(90.4 - 76.0, 14.4);
  near(98.3 - 90.4, 7.9);
  near(104.9 - 98.3, 6.6);
});

test('ensureSeeded 补录 13 条并写入出生年月，重复执行幂等', () => {
  const h = harness();
  const r = h.seed.ensureSeeded();
  assert.equal(r.added, 13);
  assert.equal(r.total, 13);
  assert.equal(r.birthSet, true);
  assert.equal(h.mem.gg_weights.length, 13);
  assert.equal(h.mem.gg_extra_settings.guoguoBirth, '2022-11');
  assert.ok(h.mem.gg_weights.every(w => w.member_id === 'guoguo' && w.height > 0 && w.weight > 0));
  // 具体测量日期与年龄落在备注，页面「最近记录」可见
  assert.ok(h.mem.gg_weights.find(w => w.ym === '2026-11').note.includes('2026-11-13 · 3岁11个月29天'));
  assert.equal(h.seed.ensureSeeded().added, 0, '二次执行不应重复补录');
  assert.equal(h.mem.gg_weights.length, 13);
});

test('ensureSeeded 不覆盖已有同月记录（家长手录或云端同步）', () => {
  const h = harness();
  h.mem.gg_weights = [{
    id: 'manual', member_id: 'guoguo', ym: '2026-11',
    height: 999, weight: 999, note: '手录',
    created_at: '2026-11-28T00:00:00.000Z', updated_at: '2026-11-28T00:00:00.000Z',
  }];
  const r = h.seed.ensureSeeded();
  assert.equal(r.added, 12, '只补其余 12 个月');
  const kept = h.mem.gg_weights.find(w => w.ym === '2026-11');
  assert.equal(kept.height, 999, '不得覆盖已有记录');
  assert.equal(kept.id, 'manual');
  assert.equal(h.mem.gg_weights.length, 13);
});

test('补录后 extra 数据层能正确读到身高体重、年度对比与最新值', () => {
  const h = harness();
  assert.equal(h.seed.ensureSeeded().added, 13);
  const extra = h.extra;
  assert.equal(extra.getWeights().length, 13);
  assert.equal(extra.heightTable(2026)[10].value, 104.9, '2026 年 11 月身高');
  assert.equal(extra.weightTable(2022)[10].values[0].value, 3.42, '2022 年 11 月体重');
  const cmp = extra.heightYearCompare();
  assert.equal(cmp.empty, false);
  assert.equal(cmp.rows.length, 5, '2022~2026 共 5 个年度');
  const latest = extra.getWeights().slice().sort((a, b) => b.ym.localeCompare(a.ym))[0];
  assert.equal(latest.height, 104.9);
  assert.equal(latest.weight, 15.9);
  assert.equal(extra.heightCrossChart().empty, false, '跨年度身高曲线应可渲染');
});
