const test = require('node:test');
const assert = require('node:assert/strict');

const storage = new Map();
global.wx = {
  getStorageSync(key) { return storage.has(key) ? storage.get(key) : ''; },
  setStorageSync(key, value) { storage.set(key, value); },
  removeStorageSync(key) { storage.delete(key); },
};

const D = require('../utils/date.js');
const policy = require('../utils/policy.js');
const store = require('../utils/store.js');
const stats = require('../utils/stats.js');
const { defaultSchedule, DEFAULT_WEEKLY_TARGETS } = require('../utils/constants.js');

function reset() {
  storage.clear();
  store.initFamily();
}

function customTarget(overrides) {
  return Object.assign({
    target_id: 'test-target', name: '自定义目标', member_ids: ['guoguo'], member_id: 'guoguo',
    cycle_type: 'weekly', cycle_value: 2, standard_note: '完成两次', count_mode: 0,
    start_date: '2020-01-01', end_date: '', status: 1,
  }, overrides);
}

test('跨年 ISO 周号使用 ISO 年第一周的周一作为基准', () => {
  assert.equal(D.periodKey('week', '2026-01-01'), '2026-W01');
  assert.equal(D.periodKey('week', '2027-01-01'), '2026-W53');
  assert.equal(D.periodKey('week', '2024-12-30'), '2025-W01');
});

test('排期从次日生效，历史日期仍读取旧快照', () => {
  const today = D.today();
  const tomorrow = D.addDays(today, 1);
  const base = defaultSchedule();
  base['G-READ'] = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1 };
  const staged = policy.stageScheduleChange(base, 'G-READ', D.weekday(tomorrow), 0, today);
  assert.equal(policy.getScheduleAt(today, staged)['G-READ'][D.weekday(tomorrow)], 1);
  assert.equal(policy.getScheduleAt(tomorrow, staged)['G-READ'][D.weekday(tomorrow)], 0);

  reset();
  storage.set('gg_schedule', staged);
  assert.equal(stats.requiredItems('guoguo', today).some(item => item.code === 'G-READ'), true);
  assert.equal(stats.requiredItems('guoguo', tomorrow).some(item => item.code === 'G-READ'), false);
});

test('周目标下周生效，并按报告覆盖天数汇总', () => {
  const today = D.today();
  const base = Object.assign({}, DEFAULT_WEEKLY_TARGETS);
  const staged = policy.stageTargetChange(base, 'G-ART', 9, today);
  const nextWeek = D.addDays(D.weekStart(today), 7);
  assert.equal(policy.getTargetsAt(today, staged)['G-ART'], base['G-ART']);
  assert.equal(policy.getTargetsAt(nextWeek, staged)['G-ART'], 9);
  assert.equal(stats.periodTargetTotals(D.weekDates(nextWeek), staged)['G-ART'], 9);
});

test('当前报表统计排除未来日期，但保留趋势格', t => {
  reset();
  const today = D.today();
  const nextDay = D.addDays(today, 1);
  if (nextDay.slice(0, 7) !== today.slice(0, 7)) return t.skip('本月最后一天没有未来日期');
  store.saveRecord({ member_id: 'guoguo', item_code: 'G-SWIM', biz_date: nextDay, status: 1 });
  const report = stats.buildReport('month', today);
  assert.equal(report.totalDone, 0);
  assert.equal(report.members.guoguo.detail.doneTotal, 0);
  assert.equal(report.trend.find(row => row.date === nextDay).total, 1);
});

test('自定义周目标按月年周期累计，按生效日过滤并保留归档前历史', () => {
  reset();
  const records = [];
  const weekly = customTarget({ target_id: 'weekly', name: '每周运动' });
  const shortWeekly = customTarget({
    target_id: 'short-weekly', name: '短周期周目标', start_date: '2025-01-01', end_date: '2025-01-12',
  });
  const dailyStart = D.addDays(D.today(), -3);
  const daily = customTarget({
    target_id: 'daily', name: '每日阅读', cycle_type: 'daily', cycle_value: 1,
    start_date: dailyStart,
  });
  const archived = customTarget({
    target_id: 'archived', name: '已归档目标',
    __history: [
      { effectiveFrom: '0000-01-01', value: customTarget({ target_id: 'archived', name: '已归档目标' }) },
      { effectiveFrom: '2026-01-01', value: customTarget({ target_id: 'archived', name: '已归档目标', status: 2 }) },
    ],
  });
  storage.set('gg_custom', [weekly, shortWeekly, daily, archived]);
  for (const [targetId, day] of [
    ['weekly', '2025-01-06'], ['weekly', '2025-01-13'],
    ['short-weekly', '2025-01-06'], ['short-weekly', '2025-01-07'],
    ['short-weekly', '2025-01-08'], ['short-weekly', '2025-01-09'],
    ['daily', D.addDays(dailyStart, -1)], ['daily', D.addDays(dailyStart, 1)],
  ]) {
    records.push({ member_id: 'guoguo', item_code: targetId, biz_date: day, status: 1, record_id: targetId + day });
  }
  storage.set('gg_records', records);

  const year = stats.buildReport('year', '2025-01-01').members.guoguo.detail.custom;
  const archivedRow = year.find(row => row.target_id === 'archived');
  const weeklyRow = year.find(row => row.target_id === 'weekly');
  const shortWeeklyRow = year.find(row => row.target_id === 'short-weekly');
  assert.ok(archivedRow, 'archived targets remain visible in periods before archival');
  assert.ok(weeklyRow.need > 100, 'weekly target repeats throughout the year');
  assert.equal(weeklyRow.actual, 2);
  assert.equal(weeklyRow.achieved, false);
  assert.equal(shortWeeklyRow.need, 3.4);
  assert.equal(shortWeeklyRow.actual, 4);
  assert.equal(shortWeeklyRow.achieved, false, 'overage in one cycle cannot offset a missed cycle');

  const month = stats.buildReport('month', D.monthStart(D.today())).members.guoguo.detail.custom;
  const dailyRow = month.find(row => row.target_id === 'daily');
  const firstActiveDay = [D.monthStart(D.today()), dailyStart].sort().pop();
  assert.equal(dailyRow.need, D.datesBetween(firstActiveDay, D.today()).length);
  assert.equal(dailyRow.actual, 1, 'records before target start are excluded');
});

test('周期最长连续天数取周期内最大连续段', () => {
  reset();
  const week = D.weekDates(D.today());
  const schedule = {};
  for (let dow = 1; dow <= 7; dow++) schedule['G-READ'] = Object.assign(schedule['G-READ'] || {}, { [dow]: 1 });
  storage.set('gg_schedule', schedule);
  week.slice(0, 3).forEach(date => store.saveRecord({ member_id: 'guoguo', item_code: 'G-READ', biz_date: date, status: 1 }));
  assert.equal(stats.longestStreak('guoguo', week), 3);
});
