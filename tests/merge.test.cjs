const test=require('node:test'),assert=require('node:assert/strict');
const {merge}=require('../utils/sync-merge.js');
const policy=require('../utils/policy.js');
test('concurrent schedule edits preserve both fields and their effective-date history',()=>{const base={'G-READ':{1:1,2:1},'G-ENG':{1:1,2:1}};const a=policy.stageScheduleChange(base,'G-READ',1,0,'2026-11-25');const b=policy.stageScheduleChange(base,'G-ENG',2,0,'2026-11-25');const result=merge('gg_schedule',base,a,b);assert.equal(result['G-READ'][1],0);assert.equal(result['G-ENG'][2],0);const before=policy.getScheduleAt('2026-11-25',result),after=policy.getScheduleAt('2026-11-26',result);assert.equal(before['G-READ'][1],1);assert.equal(before['G-ENG'][2],1);assert.equal(after['G-READ'][1],0);assert.equal(after['G-ENG'][2],0);});
test('three-way merge preserves remote additions and explicit local deletion',()=>{const base=[{id:'a',amount:1},{id:'b',amount:2}];const local=[base[1]];const remote=[...base,{id:'c',amount:3}];assert.deepEqual(merge('gg_fees',base,local,remote).map(x=>x.id),['b','c']);});

test('ledger fee source merges legacy random IDs by src into a stable ID', () => {
  const base = [];
  const local = [{ id: 'device-a-random', src: 'fees:course-1', amount: 1200, updated_at: '2026-11-26T00:00:00.000Z' }];
  const remote = [{ id: 'device-b-random', src: 'fees:course-1', amount: 1300, updated_at: '2026-11-27T00:00:00.000Z' }];
  const result = merge('gg_ledger', base, local, remote);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'fee_fees%3Acourse-1');
  assert.equal(result[0].amount, 1300, 'newer updated_at wins');
});

test('ledger merge shortcut still normalizes and folds same-src rows', () => {
  const remote = [
    { id: 'random-a', src: 'fees:course-1', amount: 1200, updated_at: '2026-11-26T00:00:00.000Z' },
    { id: 'random-b', src: 'fees:course-1', amount: 1300, updated_at: '2026-11-27T00:00:00.000Z' },
  ];
  const result = merge('gg_ledger', [], [], remote);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, 'fee_fees%3Acourse-1');
  assert.equal(result[0].amount, 1300);
});

test('ledger fee deletion wins equal timestamps and survives an absent peer', () => {
  const active = { id: 'old-random', src: 'fees:course-1', amount: 1200, updated_at: '2026-11-27T00:00:00.000Z' };
  const deleted = Object.assign({}, active, { id: 'new-random', deleted_at: active.updated_at });
  const duplicate = merge('gg_ledger', [], [active], [deleted]);
  assert.equal(duplicate.length, 1);
  assert.ok(duplicate[0].deleted_at);
  assert.equal(duplicate[0].id, 'fee_fees%3Acourse-1');

  const survived = merge('gg_ledger', [active], [deleted], []);
  assert.equal(survived.length, 1);
  assert.ok(survived[0].deleted_at);

  const newerActive = Object.assign({}, active, { id: 'stale-device', updated_at: '2026-11-28T00:00:00.000Z' });
  const permanent = merge('gg_ledger', [], [deleted], [newerActive]);
  assert.equal(permanent.length, 1);
  assert.ok(permanent[0].deleted_at, 'a later automatic import cannot undo a prior deletion');
});
