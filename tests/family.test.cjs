const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = value => value === undefined ? undefined : structuredClone(value);

class Database {
  constructor(rows = []) { this.rows = structuredClone(rows); this.calls = []; }
  from(table) { return new Query(this, table); }
  async run(query) {
    this.calls.push({ table: query.table, action: query.action, filters: clone(query.filters), values: clone(query.values) });
    const matches = row => query.filters.every(([op, key, value]) => op === 'neq' ? row[key] !== value : row[key] === value);
    if (query.action === 'select') return { data: clone(this.rows.filter(matches)), error: null };
    if (query.action === 'insert') {
      const values = Array.isArray(query.values) ? query.values : [query.values];
      this.rows.push(...clone(values));
      return { data: query.returnRows ? clone(values) : null, error: null };
    }
    if (query.action === 'update') {
      const rows = this.rows.filter(matches);
      rows.forEach(row => Object.assign(row, clone(query.values)));
      return { data: query.returnRows ? clone(rows) : null, error: null };
    }
    return { data: null, error: null };
  }
}

class Query {
  constructor(database, table) { this.database = database; this.table = table; this.action = 'select'; this.filters = []; this.returnRows = false; }
  select() { this.returnRows = true; return this; }
  eq(key, value) { this.filters.push(['eq', key, value]); return this; }
  neq(key, value) { this.filters.push(['neq', key, value]); return this; }
  update(values) { this.action = 'update'; this.values = clone(values); return this; }
  insert(values) { this.action = 'insert'; this.values = clone(values); return this; }
  then(resolve, reject) { return this.database.run(this).then(resolve, reject); }
}

function loadFamily({ rows = [], identity = null, session = { user: { id: 'u1' } } } = {}) {
  const db = new Database(rows);
  const storage = new Map();
  if (identity) storage.set('gg_my_identity', clone(identity));
  const wx = {
    getStorageSync(key) { return storage.has(key) ? clone(storage.get(key)) : ''; },
    setStorageSync(key, value) { storage.set(key, clone(value)); },
    removeStorageSync(key) { storage.delete(key); },
  };
  const cloud = { getCloud: () => ({ database: db }), ensureSession: async () => session };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/family.js'), 'utf8'), {
    module, exports: module.exports, wx, require: name => name === './cloud.js' ? cloud : require(name),
    Date, Math, String, Number, Array, Object, Error, RegExp,
  }, { filename: path.join(root, 'utils/family.js') });
  return { family: module.exports, db, storage };
}

function pageHarness({ cloudReady, cloudState, refreshMembership, getIdentity, membership }) {
  const source = fs.readFileSync(path.join(root, 'pages/family/family.js'), 'utf8');
  let definition;
  const family = {
    resolveInvite: async () => ({ valid: false }),
    getIdentity,
    getMyMembership: async () => membership,
    listMembers: async () => [],
    getCachedInvite: () => null,
    createInviteLink: async () => ({ token: 'inv_test', expiresAt: '' }),
    isAdmin: id => !!(id && id.status === 'active' && id.role === 'admin'),
    normalizeRole: r => (r === 'admin' ? 'admin' : 'member'),
    ROLE_LABELS: { admin: '管理员', member: '成员' },
    getFamilyName: async () => '测试家庭',
  };
  const cloudstore = {
    refreshMembership,
    getState: () => cloudState,
  };
  vm.runInNewContext(source, {
    Page(value) { definition = value; }, getApp: () => ({ cloudReady }),
    wx: { showToast() {}, showModal() {}, getStorageSync: () => '', setStorageSync() {} },
    require(name) {
      if (name === '../../utils/family.js') return family;
      if (name === '../../utils/cloudstore.js') return cloudstore;
      if (name === '../../utils/store.js') return { getFamily: () => ({ members: [] }) };
      if (name === '../../utils/stats.js') return {};
      if (name === '../../utils/date.js') return { today: () => '2026-11-25', addDays: () => '2026-11-24' };
      throw new Error(`unexpected module ${name}`);
    },
    Date, Math, String, Number, Array, Object, Error, RegExp,
  }, { filename: path.join(root, 'pages/family/family.js') });
  const page = Object.assign({}, definition, {
    data: clone(definition.data),
    setData(values) { Object.assign(this.data, values); },
  });
  return page;
}

function indexHarness({ adopted = false } = {}) {
  const source = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8');
  let definition;
  const family = { getIdentity: () => null, refreshIdentity: async () => null };
  vm.runInNewContext(source, {
    Page(value) { definition = value; }, getApp: () => ({}),
    wx: { getStorageSync: key => key === 'gg_family_adopted' && adopted ? 'fam_cached' : '', showToast() {} },
    require(name) {
      if (name === '../../utils/family.js') return family;
      if (name === '../../utils/store.js') return {};
      if (name === '../../utils/stats.js') return {};
      if (name === '../../utils/date.js') return {};
      if (name === '../../utils/privacy.js') return {};
      throw new Error(`unexpected module ${name}`);
    },
    Date, Math, String, Number, Array, Object, Error, RegExp,
  }, { filename: path.join(root, 'pages/index/index.js') });
  return Object.assign({}, definition, {
    data: clone(definition.data),
    setData(values) { Object.assign(this.data, values); },
  });
}

test('family page waits for cloud startup and coalesces onLoad/onShow membership refresh', async () => {
  let releaseCloud;
  const cloudReady = new Promise(resolve => { releaseCloud = resolve; });
  let identity = null;
  let refreshCalls = 0;
  const page = pageHarness({
    cloudReady,
    cloudState: { loggedIn: true },
    refreshMembership: async () => {
      refreshCalls++;
      identity = { familyId: 'fam_joined', memberKey: 'papa', role: 'parent', name: '爸爸', uid: 'u1', status: 'active' };
      return { loggedIn: true, familyId: 'fam_joined' };
    },
    getIdentity: () => identity,
    membership: { family_id: 'fam_joined', status: 'active' },
  });
  page.onLoad({});
  const first = page._refreshPromise;
  page.onShow();
  assert.equal(page._refreshPromise, first);
  await Promise.resolve();
  assert.equal(refreshCalls, 0);
  releaseCloud();
  await first;
  assert.equal(refreshCalls, 1);
  assert.equal(page.data.status, 'active');
  assert.equal(page.data.identity.familyId, 'fam_joined');
});

test('family page does not show stale active identity as successful when cloud refresh reports an error', async () => {
  const page = pageHarness({
    cloudReady: Promise.resolve(),
    cloudState: { loggedIn: true, familyId: 'fam_old', lastError: '身份刷新失败' },
    refreshMembership: async () => ({ loggedIn: true, familyId: 'fam_old', lastError: '身份刷新失败' }),
    getIdentity: () => ({ familyId: 'fam_old', memberKey: 'mama', role: 'admin', status: 'active' }),
    membership: { family_id: 'fam_old', status: 'active' },
  });
  await page.refresh();
  assert.notEqual(page.data.status, 'active');
  assert.equal(page.data.identity, null);
  assert.match(page.data.errorMsg, /身份刷新失败/);
});

test('adopted family without a current identity cannot fall back to local admin writes', () => {
  const adopted = indexHarness({ adopted: true });
  adopted.resetOperator();
  assert.equal(adopted.data.operatorKey, '');
  assert.equal(adopted.data.operatorRole, 'guest');
  assert.equal(adopted.canWriteMember('mama'), false);

  const localPreview = indexHarness();
  localPreview.resetOperator();
  assert.equal(localPreview.data.operatorKey, 'mama');
  assert.equal(localPreview.data.operatorRole, 'admin');
  const child = { familyId: 'fam_test', memberKey: 'guoguo', role: 'child', status: 'active' };
  localPreview.applyIdentity(child);
  assert.equal(localPreview.canWriteMember('guoguo'), false, 'child profiles are read-only; a parent records on their behalf');
  assert.equal(localPreview.canWriteMember('papa'), false);
});

test('requestJoin blocks an active identity from applying to the same or another family', async t => {
  for (const familyId of ['fam_test', 'fam_other']) {
    await t.test(familyId, async () => {
      const { family, db } = loadFamily({
        identity: { familyId: 'fam_test', memberKey: 'papa', role: 'parent', status: 'active' },
        rows: [{ family_id: 'fam_test', uid: 'u1', status: 'active' }],
      });
      await assert.rejects(family.requestJoin(familyId, 'papa', '家人'), /加入/);
      assert.equal(db.calls.some(call => call.action === 'insert'), false);
    });
  }
});

test('approval fails when no pending member row was updated', async () => {
  const { family } = loadFamily({
    identity: { familyId: 'fam_test', role: 'admin', status: 'active' },
    rows: [{ family_id: 'fam_test', uid: 'u2', status: 'active' }],
  });
  await assert.rejects(family.approveMember('u2'), /已处理或不属于当前家庭/);
});

test('invite and visitor links with malformed expiration are rejected', async t => {
  for (const [table, token, fn] of [
    ['gg_invite_tokens', 'inv_test', 'resolveInvite'],
    ['gg_visitor_snapshots', 'vis_test', 'getVisitorSnapshot'],
  ]) {
    await t.test(table, async () => {
      const { family } = loadFamily({ rows: [{ token, family_id: 'fam_test', expires_at: 'not-a-date', revoked: false }] });
      const result = await family[fn](token);
      assert.equal(result.valid, false);
      assert.match(result.reason, /过期/);
    });
  }
});

test('invite revocation is scoped to the active family and requires an affected row', async () => {
  const { family, db } = loadFamily({
    identity: { familyId: 'fam_one', role: 'admin', status: 'active' },
    rows: [{ token: 'inv_other', family_id: 'fam_two', revoked: false }],
  });
  await assert.rejects(family.revokeInviteLink('inv_other'), /不属于当前家庭/);
  const update = db.calls.find(call => call.action === 'update');
  assert.ok(update.filters.some(([op, key, value]) => op === 'eq' && key === 'family_id' && value === 'fam_one'));
});

test('replacement invite is inserted before older tokens are revoked, excluding itself', async () => {
  const { family, db } = loadFamily({
    identity: { familyId: 'fam_one', uid: 'u1', role: 'admin', status: 'active' },
    rows: [{ token: 'inv_old', family_id: 'fam_one', revoked: false }],
  });
  await family.createInviteLink();
  const insertIndex = db.calls.findIndex(call => call.action === 'insert' && call.table === 'gg_invite_tokens');
  const updateIndex = db.calls.findIndex(call => call.action === 'update' && call.table === 'gg_invite_tokens');
  assert.ok(insertIndex >= 0 && updateIndex > insertIndex);
  assert.ok(db.calls[updateIndex].filters.some(([op, key]) => op === 'neq' && key === 'token'));
  assert.equal(db.rows.find(row => row.token === 'inv_old').revoked, true);
});
