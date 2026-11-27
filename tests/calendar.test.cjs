const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

test('calendar selected-member summary uses current family display names', () => {
  let definition;
  const store = {
    getFamily: () => ({ members: [
      { id: 'guoguo', name: '小果' },
      { id: 'papa', name: '爸爸（改名）' },
      { id: 'mama', name: '妈妈（改名）' },
    ] }),
    canBackfill: () => true,
  };
  const stats = {
    dayStat: () => ({ isFull: false, hasAny: false, backfillCount: 0, doneTotal: 0, doneRequired: 0, required: 0 }),
  };
  const date = {
    today: () => '2026-11-27',
    weekday: value => new Date(value + 'T00:00:00').getDay() || 7,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/calendar/calendar.js'), 'utf8'), {
    Page(value) { definition = value; },
    getApp: () => ({}), wx: {},
    require(name) {
      if (name === '../../utils/store.js') return store;
      if (name === '../../utils/stats.js') return stats;
      if (name === '../../utils/date.js') return date;
      throw new Error('unexpected module ' + name);
    },
    Date, Math, Number, String, Array, Object,
  }, { filename: path.join(root, 'pages/calendar/calendar.js') });

  const page = Object.assign({}, definition, {
    data: structuredClone(definition.data),
    setData(values, callback) { Object.assign(this.data, values); if (callback) callback(); },
  });
  page.onLoad();
  page.build();
  assert.deepEqual(Array.from(page.data.selectedStat.members, member => member.name), [
    '小果', '爸爸（改名）', '妈妈（改名）',
  ]);
});
