const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const utilsRoot = path.resolve(__dirname, '..', 'utils');
const clone = value => value === undefined ? undefined : structuredClone(value);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = 4000;

function decode(value) {
  return value && value.__gg === 2 ? value.value : value;
}

class MemoryDatabase {
  constructor(rows = []) {
    this.rows = rows.map(clone);
    this.online = true;
    this.failReads = false;
    this.beforeUpdate = null;
    this.updateCalls = [];
  }

  from(table) { return new Query(this, table); }

  async run(query) {
    if (!this.online) return { data: null, error: { code: 'OFFLINE', message: 'network unavailable' } };
    if (query.table !== 'gg_docs') return { data: null, error: { code: 'UNSUPPORTED_TABLE', message: query.table } };
    if (query.action === 'select') {
      if (this.failReads) return { data: null, error: { code: 'READ_FAILED', message: 'read failed' } };
      const rows = this.rows.filter(row => query.filters.every(([key, value]) => value === null ? row[key] == null : row[key] === value));
      return { data: clone(rows), error: null };
    }
    if (query.action === 'update') {
      this.updateCalls.push({ filters: clone(query.filters), values: clone(query.values) });
      if (this.beforeUpdate) await this.beforeUpdate(query);
      const matched = this.rows.filter(row => query.filters.every(([key, value]) => value === null ? row[key] == null : row[key] === value));
      matched.forEach(row => Object.assign(row, clone(query.values)));
      return { data: query.returnRows ? clone(matched) : null, error: null };
    }
    if (query.action === 'insert') {
      const incoming = Array.isArray(query.values) ? query.values : [query.values];
      for (const item of incoming) {
        if (this.rows.some(row => row.family_id === item.family_id && row.doc_key === item.doc_key)) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
      }
      this.rows.push(...incoming.map(clone));
      return { data: query.returnRows ? clone(incoming) : null, error: null };
    }
    if (query.action === 'upsert') {
      for (const item of Array.isArray(query.values) ? query.values : [query.values]) {
        const index = this.rows.findIndex(row => row.family_id === item.family_id && row.doc_key === item.doc_key);
        if (index < 0) this.rows.push(clone(item));
        else this.rows[index] = clone(item);
      }
      return { data: null, error: null };
    }
    if (query.action === 'delete') {
      const removed = [];
      this.rows = this.rows.filter(row => {
        if (!query.filters.every(([key, value]) => value === null ? row[key] == null : row[key] === value)) return true;
        removed.push(row);
        return false;
      });
      return { data: query.returnRows ? clone(removed) : null, error: null };
    }
    return { data: null, error: { code: 'UNSUPPORTED_QUERY', message: query.action } };
  }
}

class Query {
  constructor(database, table) {
    this.database = database;
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.returnRows = false;
  }
  select() { this.returnRows = true; return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  is(column, value) { this.filters.push([column, value]); return this; }
  update(values) { this.action = 'update'; this.values = clone(values); return this; }
  insert(values) { this.action = 'insert'; this.values = clone(values); return this; }
  upsert(values) { this.action = 'upsert'; this.values = clone(values); return this; }
  delete() { this.action = 'delete'; return this; }
  order() { return this; }
  limit() { return this; }
  then(resolve, reject) { return this.database.run(this).then(resolve, reject); }
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function makeIdentity(familyId = 'fam_test', status = 'active') {
  return status === 'active'
    ? { familyId, memberKey: 'papa', role: 'parent', name: '爸爸', uid: 'user-1', status }
    : { uid: 'user-1', status: 'none' };
}

function createHarness({ database = new MemoryDatabase(), storage = new Map(), identity = makeIdentity(), userId = 'user-1' } = {}) {
  const wx = {
    getStorageSync(key) { return storage.has(key) ? clone(storage.get(key)) : ''; },
    setStorageSync(key, value) { storage.set(key, clone(value)); },
    removeStorageSync(key) { storage.delete(key); },
  };

  let currentIdentity = identity;
  const cloudModule = {
    getCloud: () => ({ database }),
    ensureSession: async () => ({ user: { id: userId, name: 'Test' } }),
    getLastAuthError: () => '',
    describeCloudError: error => (error && error.message) || String(error),
  };
  const familyModule = {
    getIdentity: () => currentIdentity,
    refreshIdentity: async () => currentIdentity,
  };

  const holder = {};
  const loadModule = (filename, customRequire) => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      wx, module, exports: module.exports, require: customRequire,
    }, { filename });
    return module.exports;
  };
  const customRequire = request => {
    if (request === './cloud.js') return cloudModule;
    if (request === './family.js') return familyModule;
    if (request === './sync-merge.js' || request === './policy.js') return require(path.join(utilsRoot, request.slice(2)));
    if (request === './store.js') return holder.store;
    if (request === './cloudstore.js') return holder.sync;
    if (request === './constants.js' || request === './date.js') return require(path.join(utilsRoot, request.slice(2)));
    throw new Error(`Unexpected require ${request}`);
  };
  holder.sync = loadModule(path.join(utilsRoot, 'cloudstore.js'), customRequire);
  holder.store = loadModule(path.join(utilsRoot, 'store.js'), customRequire);
  const { store, sync } = holder;
  return {
    database, storage, wx, store, sync,
    setIdentity(value) { currentIdentity = value; },
    getIdentity() { return currentIdentity; },
  };
}

function row(familyId, docKey, value, updatedAt = '2026-11-25T00:00:00.000Z', epoch = 'legacy') {
  return {
    family_id: familyId,
    doc_key: docKey,
    doc_value: { __gg: 2, epoch, value: clone(value) },
    updated_at: updatedAt,
  };
}

function cloudValue(database, familyId, docKey, epoch) {
  const found = database.rows.find(item => item.family_id === familyId && item.doc_key === docKey);
  if (!found) return undefined;
  const decoded = decode(found.doc_value);
  if (found.doc_value && found.doc_value.__gg === 2 && epoch !== undefined && found.doc_value.epoch !== epoch) return undefined;
  return decoded;
}

async function waitFor(predicate, label) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    if (predicate()) return;
    await sleep(5);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitIdle(harness, label = 'sync idle') {
  await waitFor(() => {
    const state = harness.sync.getState();
    return !state.syncing && !state.dirty;
  }, label);
  await sleep(10);
  const state = harness.sync.getState();
  assert.equal(state.syncing, false, `${label}: still syncing after settle`);
  assert.equal(state.dirty, false, `${label}: dirty after settle`);
}

async function startActive(harness, familyId = 'fam_test') {
  harness.wx.setStorageSync('gg_family_adopted', familyId);
  await harness.sync.bootstrap();
  await waitIdle(harness, 'bootstrap');
}

async function writeRecord(store, code, date = '2026-11-24', extra = {}) {
  const result = store.saveRecord(Object.assign({
    member_id: 'guoguo', item_code: code, biz_date: date,
  }, extra));
  assert.equal(result.error, null);
  return result.data;
}

test('a second record edit during an in-flight records CAS is retained', async () => {
  const old = { record_id: 'rec_old', member_id: 'papa', item_code: 'walk', biz_date: '2026-11-23', updated_at: '2026-11-23T10:00:00.000Z' };
  const database = new MemoryDatabase([row('fam_test', 'gg_records', [old])]);
  const harness = createHarness({ database });
  await startActive(harness);

  const entered = deferred();
  const release = deferred();
  let held = false;
  database.beforeUpdate = async query => {
    if (!held && query.filters.some(([key, value]) => key === 'doc_key' && value === 'gg_records')) {
      held = true;
      entered.resolve();
      await release.promise;
    }
  };
  await writeRecord(harness.store, 'read');
  await entered.promise;
  await writeRecord(harness.store, 'write');
  release.resolve();
  await waitIdle(harness, 'records CAS retry');

  const local = harness.wx.getStorageSync('gg_records');
  const remote = cloudValue(database, 'fam_test', 'gg_records');
  for (const records of [local, remote]) {
    assert.ok(records.some(record => record.item_code === 'read'));
    assert.ok(records.some(record => record.item_code === 'write'));
    assert.ok(records.some(record => record.record_id === 'rec_old'));
  }
});

test('a write to records cannot overwrite a newer unrelated weights document', async () => {
  const database = new MemoryDatabase([
    row('fam_test', 'gg_weights', [{ id: 'w1', value: 20 }]),
    row('fam_test', 'gg_records', []),
  ]);
  const clientA = createHarness({ database, storage: new Map(), userId: 'user-A' });
  await startActive(clientA);
  const bStorage = new Map();
  const clientB2 = createHarness({ database, storage: bStorage, userId: 'user-B' });
  await startActive(clientB2);

  clientA.store.write('gg_weights', [{ id: 'w1', value: 20 }, { id: 'w2', value: 21 }]);
  await waitIdle(clientA, 'client A weights write');
  await writeRecord(clientB2.store, 'read');
  await waitIdle(clientB2, 'client B records write');

  assert.deepEqual(cloudValue(database, 'fam_test', 'gg_weights').map(item => item.id), ['w1', 'w2']);
});

test('resetAll advances the epoch so prior cloud records do not return', async () => {
  const old = { record_id: 'rec_old', member_id: 'guoguo', item_code: 'read', biz_date: '2026-11-23', updated_at: '2026-11-23T10:00:00.000Z' };
  const database = new MemoryDatabase([
    row('fam_test', 'gg_records', [old]),
    row('fam_test', 'gg_family', { familyId: 'fam_test', members: [] }),
  ]);
  const harness = createHarness({ database, identity: Object.assign(makeIdentity(), { role: 'admin' }) });
  await startActive(harness);
  await harness.store.resetAll();
  await waitIdle(harness, 'reset sync');
  await harness.sync.syncNow();

  const visible = harness.wx.getStorageSync('gg_records') || [];
  assert.equal(visible.some(record => record.record_id === 'rec_old'), false);
  assert.ok(database.rows.some(item => item.family_id === 'fam_test' && item.doc_key === 'gg_reset_state'));
});

test('a pending member manual sync adopts remote family data instead of uploading local data', async () => {
  const database = new MemoryDatabase([row('fam_new', 'gg_records', [])]);
  const harness = createHarness({ database, identity: makeIdentity('', 'none') });
  harness.store.initFamily();
  await writeRecord(harness.store, 'private-old');
  await harness.sync.bootstrap();

  harness.setIdentity(makeIdentity('fam_new'));
  await harness.sync.syncNow();
  await waitIdle(harness, 'approved member sync');

  assert.equal((cloudValue(database, 'fam_new', 'gg_records') || []).some(record => record.item_code === 'private-old'), false);
  assert.equal((harness.wx.getStorageSync('gg_records') || []).some(record => record.item_code === 'private-old'), false);
});

test('two clients resolve a same-document CAS conflict without losing either record', async () => {
  const old = { record_id: 'rec_old', member_id: 'papa', item_code: 'walk', biz_date: '2026-11-23', updated_at: '2026-11-23T10:00:00.000Z' };
  const database = new MemoryDatabase([row('fam_test', 'gg_records', [old])]);
  const a = createHarness({ database, userId: 'user-A' });
  await startActive(a);
  const storageB = new Map();
  const b = createHarness({ database, storage: storageB, userId: 'user-B' });
  await startActive(b);

  const bothEntered = deferred();
  const release = deferred();
  let enteredCount = 0;
  database.beforeUpdate = async query => {
    if (query.filters.some(([key, value]) => key === 'doc_key' && value === 'gg_records') && enteredCount < 2) {
      enteredCount++;
      if (enteredCount === 2) bothEntered.resolve();
      await release.promise;
    }
  };
  await writeRecord(a.store, 'read');
  await writeRecord(b.store, 'write');
  await bothEntered.promise;
  release.resolve();
  await Promise.all([waitIdle(a, 'client A CAS'), waitIdle(b, 'client B CAS')]);

  const records = cloudValue(database, 'fam_test', 'gg_records');
  assert.ok(records.some(record => record.item_code === 'read'));
  assert.ok(records.some(record => record.item_code === 'write'));
  assert.ok(records.some(record => record.record_id === 'rec_old'));
});

test('a failed upload preserves dirty state and pending work for retry', async () => {
  const database = new MemoryDatabase([row('fam_test', 'gg_records', [])]);
  const harness = createHarness({ database });
  await startActive(harness);
  database.online = false;
  await writeRecord(harness.store, 'offline-write');
  await waitFor(() => !harness.sync.getState().syncing && !!harness.sync.getState().lastError, 'offline failure');
  const pending = harness.wx.getStorageSync('gg_pending_keys') || [];
  assert.ok(pending.includes('gg_records'), 'failed key must remain pending');

  database.online = true;
  await harness.sync.syncNow();
  await waitIdle(harness, 'retry after reconnect');
  assert.ok(cloudValue(database, 'fam_test', 'gg_records').some(record => record.item_code === 'offline-write'));
  assert.deepEqual(harness.wx.getStorageSync('gg_pending_keys'), []);
});

test('offline local changes survive app restart and upload on bootstrap', async () => {
  const database = new MemoryDatabase([row('fam_test', 'gg_records', [])]);
  const storage = new Map();
  const first = createHarness({ database, storage });
  await startActive(first);
  database.online = false;
  await writeRecord(first.store, 'offline-restart');
  await waitFor(() => !first.sync.getState().syncing && !!first.sync.getState().lastError, 'offline write failure');
  assert.ok((first.wx.getStorageSync('gg_pending_keys') || []).includes('gg_records'));

  database.online = true;
  const restarted = createHarness({ database, storage });
  await restarted.sync.bootstrap();
  await waitIdle(restarted, 'restart bootstrap');
  assert.ok(cloudValue(database, 'fam_test', 'gg_records').some(record => record.item_code === 'offline-restart'));
});

test('an old device reconnecting after reset discards its prior epoch cache', async () => {
  const old = { record_id: 'rec_old', member_id: 'papa', item_code: 'old-device', biz_date: '2026-11-23', updated_at: '2026-11-23T10:00:00.000Z' };
  const database = new MemoryDatabase([row('fam_test', 'gg_records', [old])]);
  const a = createHarness({ database, identity: Object.assign(makeIdentity(), { role: 'admin' }), userId: 'user-A' });
  await startActive(a);
  const oldStorage = new Map();
  const b = createHarness({ database, storage: oldStorage, userId: 'user-B' });
  await startActive(b);

  database.online = false;
  await writeRecord(b.store, 'offline-stale');
  await waitFor(() => !b.sync.getState().syncing && !!b.sync.getState().lastError, 'old device offline');
  database.online = true;

  await a.store.resetAll();
  await waitIdle(a, 'family reset');
  await b.sync.syncNow();
  await waitIdle(b, 'old device reconnect');

  const local = b.wx.getStorageSync('gg_records') || [];
  const remote = cloudValue(database, 'fam_test', 'gg_records');
  for (const records of [local, remote]) {
    assert.equal(records.some(record => record.item_code === 'old-device'), false);
    assert.equal(records.some(record => record.item_code === 'offline-stale'), false);
  }
});

test('first membership adoption does not erase local data when initial cloud pull fails', async () => {
  const database = new MemoryDatabase([row('fam_new', 'gg_records', [])]);
  const harness = createHarness({ database, identity: makeIdentity('', 'none') });
  harness.store.initFamily();
  await writeRecord(harness.store, 'keep-until-pull-succeeds');
  await harness.sync.bootstrap();
  harness.setIdentity(makeIdentity('fam_new'));
  database.failReads = true;

  try { await harness.sync.refreshMembership(); } catch (error) {}
  const local = harness.wx.getStorageSync('gg_records') || [];
  assert.ok(local.some(record => record.item_code === 'keep-until-pull-succeeds'));
});

test('joining after a successful pull replaces local cache with the family records', async () => {
  const familyRecord = { record_id: 'rec_family', member_id: 'guoguo', item_code: 'family-only', biz_date: '2026-11-23', updated_at: '2026-11-23T10:00:00.000Z' };
  const database = new MemoryDatabase([row('fam_new', 'gg_records', [familyRecord])]);
  const harness = createHarness({ database, identity: makeIdentity('', 'none') });
  harness.store.initFamily();
  await writeRecord(harness.store, 'private-old');
  await harness.sync.bootstrap();
  harness.setIdentity(makeIdentity('fam_new'));

  await harness.sync.refreshMembership();
  await waitIdle(harness, 'first membership adoption');
  const local = harness.wx.getStorageSync('gg_records') || [];
  assert.ok(local.some(record => record.record_id === 'rec_family'));
  assert.equal(local.some(record => record.item_code === 'private-old'), false);
});

test('records from two devices deduplicate by business key, preferring the newer edit', async () => {
  const database = new MemoryDatabase([row('fam_test', 'gg_records', [])]);
  const a = createHarness({ database, userId: 'user-A' });
  await startActive(a);
  const b = createHarness({ database, storage: new Map(), userId: 'user-B' });
  await startActive(b);

  await writeRecord(a.store, 'same-item', '2026-11-24', {
    record_id: 'rec_older', updated_at: '2026-11-24T10:00:00.000Z', note: 'older',
  });
  await waitIdle(a, 'older business record');
  await writeRecord(b.store, 'same-item', '2026-11-24', {
    record_id: 'rec_newer', updated_at: '2026-11-24T11:00:00.000Z', note: 'newer',
  });
  await waitIdle(b, 'newer business record');

  const records = cloudValue(database, 'fam_test', 'gg_records')
    .filter(record => record.member_id === 'guoguo' && record.item_code === 'same-item' && record.biz_date === '2026-11-24');
  assert.equal(records.length, 1);
  assert.equal(records[0].record_id, 'rec_newer');
  assert.equal(records[0].note, 'newer');
});
