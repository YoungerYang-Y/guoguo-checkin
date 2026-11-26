// P0/P1 修复 + 家庭管理重构的回归测试。
// 全部使用隔离的 mock 存储 / 数据库 / wx，不读取也不修改真实家庭数据。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = v => v === undefined ? undefined : structuredClone(v);
const DAY = 86400000;
const future = () => new Date(Date.now() + 3 * DAY).toISOString();
const ADMIN = { familyId: 'fam_one', memberKey: 'mama', role: 'admin', name: '妈妈', uid: 'u1', status: 'active' };

const sandboxGlobals = {
  Date, Math, String, Number, Boolean, Array, Object, Error, RegExp, JSON,
  Promise, Uint8Array, ArrayBuffer, setTimeout, clearTimeout,
};

class Database {
  constructor(rows = []) {
    this.rows = structuredClone(rows);
    this.calls = [];
    this.failFirstUpdateOn = '';
    this._failUsed = false;
  }
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
    if (query.action === 'update' || query.action === 'delete') {
      if (query.action === 'update' && this.failFirstUpdateOn === query.table && !this._failUsed) {
        this._failUsed = true;
        return { data: null, error: new Error('boom') };
      }
      const rows = this.rows.filter(matches);
      if (query.action === 'update') rows.forEach(row => Object.assign(row, clone(query.values)));
      else this.rows = this.rows.filter(row => !matches(row));
      return { data: query.returnRows ? clone(rows) : null, error: null };
    }
    return { data: null, error: null };
  }
}

class Query {
  constructor(db, table) { this.database = db; this.table = table; this.action = 'select'; this.filters = []; this.returnRows = false; }
  select() { this.returnRows = true; return this; }
  eq(key, value) { this.filters.push(['eq', key, value]); return this; }
  neq(key, value) { this.filters.push(['neq', key, value]); return this; }
  update(values) { this.action = 'update'; this.values = clone(values); return this; }
  insert(values) { this.action = 'insert'; this.values = clone(values); return this; }
  delete() { this.action = 'delete'; return this; }
  then(resolve, reject) { return this.database.run(this).then(resolve, reject); }
}

function loadFamily({ rows = [], identity = null, session = { user: { id: 'u1' } }, withRandom = false } = {}) {
  const db = new Database(rows);
  const storage = new Map();
  if (identity) storage.set('gg_my_identity', clone(identity));
  let randomCalled = false;
  const wx = {
    getStorageSync(key) { return storage.has(key) ? clone(storage.get(key)) : ''; },
    setStorageSync(key, value) { storage.set(key, clone(value)); },
    removeStorageSync(key) { storage.delete(key); },
  };
  if (withRandom) {
    wx.getRandomValues = ({ length, success }) => {
      randomCalled = true;
      const buf = new ArrayBuffer(length);
      const arr = new Uint8Array(buf);
      for (let i = 0; i < length; i++) arr[i] = (i * 37 + 11) % 256;
      success({ randomValues: buf });
    };
  }
  const cloud = { getCloud: () => ({ database: db }), ensureSession: async () => session };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/family.js'), 'utf8'), {
    module, exports: module.exports, wx,
    require: name => name === './cloud.js' ? cloud
      : name === './sync-merge.js' ? require(path.join(root, 'utils', 'sync-merge.js'))
        : require(name),
    ...sandboxGlobals,
  }, { filename: 'utils/family.js' });
  return { family: module.exports, db, storage, wasRandomUsed: () => randomCalled };
}

function loadCloudstore({ session = null } = {}) {
  let cleared = 0;
  const storage = new Map([['gg_family_adopted', 'fam_old'], ['gg_sync_epoch', 'epoch_old'], ['gg_records', [{ record_id: 'x' }]]]);
  const wx = {
    getStorageSync(key) { return storage.has(key) ? clone(storage.get(key)) : ''; },
    setStorageSync(key, value) { storage.set(key, clone(value)); },
    removeStorageSync(key) { storage.delete(key); },
  };
  const familyMock = {
    getIdentity: () => ADMIN,
    clearIdentity: () => { cleared++; },
    refreshIdentity: async () => ADMIN,
  };
  const cloudMock = {
    ensureSession: async () => session,
    getLastAuthError: () => 'offline',
    describeCloudError: (e, prefix) => (prefix || '') + 'offline',
    getCloud: () => ({ database: { from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }) }) } }),
  };
  const storeMock = { initFamily: () => ({}), getFamily: () => ({}) };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/cloudstore.js'), 'utf8'), {
    module, exports: module.exports, wx,
    require: name => name === './cloud.js' ? cloudMock
      : name === './family.js' ? familyMock
        : name === './store.js' ? storeMock
          : name === './sync-merge.js' ? require(path.join(root, 'utils', 'sync-merge.js'))
            : require(name),
    ...sandboxGlobals,
  }, { filename: 'utils/cloudstore.js' });
  return { cloudstore: module.exports, storage, clearedCount: () => cleared };
}

function loadApp() {
  let definition;
  let syncCalls = 0;
  const cloudstoreMock = {
    bootstrap: () => Promise.resolve(),
    getState: () => ({ ready: true }),
    syncNow: () => { syncCalls++; return Promise.resolve(); },
  };
  const wx = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), {
    App(value) { definition = value; },
    wx,
    require: name => name === './utils/store.js' ? { initFamily() {} }
      : name === './utils/cloudstore.js' ? cloudstoreMock
        : { install() {} },
    ...sandboxGlobals,
  }, { filename: 'app.js' });
  return { app: definition, syncCalls: () => syncCalls };
}

// ---------- P0-1 离线可用性 ----------
test('P0-1 offline login failure keeps cached active identity', async () => {
  const { family, storage } = loadFamily({ identity: ADMIN, session: null });
  const result = await family.refreshIdentity();
  assert.equal(result && result.status, 'active');
  assert.equal(storage.get('gg_my_identity').role, 'admin');
});

test('P0-1 cloudstore does not clear identity when there is no session', async () => {
  const { cloudstore, clearedCount } = loadCloudstore({ session: null });
  await cloudstore.bootstrap();
  assert.equal(clearedCount(), 0);
  assert.equal(cloudstore.getState().familyId, '');
});

test('P0-1 forgetting a family clears adopted and epoch so writes are not locked', async () => {
  const { cloudstore, storage } = loadCloudstore({ session: null });
  cloudstore.forgetFamily();
  assert.equal(storage.has('gg_family_adopted'), false);
  assert.equal(storage.has('gg_sync_epoch'), false);
  assert.equal(storage.has('gg_records'), false);
});

// ---------- P1-1 同步节流 ----------
test('P1-1 repeated onShow within 30s triggers only one full sync', () => {
  const { app, syncCalls } = loadApp();
  app.onLaunch();
  app.onShow(); app.onShow(); app.onShow();
  assert.equal(syncCalls(), 1);
});

// ---------- P1-2 token 随机源 ----------
test('P1-2 visitor token uses cryptographic random when available', async () => {
  const { family, wasRandomUsed } = loadFamily({ identity: ADMIN, withRandom: true });
  const res = await family.createVisitorLink({}, 7);
  assert.match(res.token, /^vis_[0-9a-z]+$/);
  assert.equal(wasRandomUsed(), true);
});

test('P1-2 token generation still works when cryptographic random is unavailable', async () => {
  const { family, wasRandomUsed } = loadFamily({ identity: ADMIN, withRandom: false });
  const res = await family.createVisitorLink({}, 7);
  assert.match(res.token, /^vis_[0-9a-z]+$/);
  assert.equal(wasRandomUsed(), false);
});

// ---------- P0-2 / P1-3 链接校验与竞态 ----------
test('P0-2 malformed visitor token is rejected before any query', async () => {
  const { family } = loadFamily({ rows: [{ token: 'vis_ok', snapshot: {}, expires_at: future(), revoked: false }] });
  const result = await family.getVisitorSnapshot('../../anything');
  assert.equal(result.valid, false);
});

test('P1-3 failed revocation rolls back the freshly inserted invite', async () => {
  const { family, db } = loadFamily({ identity: ADMIN, rows: [] });
  db.failFirstUpdateOn = 'gg_invite_tokens';
  await assert.rejects(family.createInviteLink(), /boom/);
  const inserted = db.rows.find(row => String(row.token).startsWith('inv_'));
  assert.ok(inserted, 'new invite row should exist');
  assert.equal(inserted.revoked, true, 'new invite must be revoked on compensation');
});

test('P1-3 resolveInvite only accepts the newest active token of a family', async () => {
  const { family } = loadFamily({
    rows: [
      { token: 'inv_old', family_id: 'fam_one', family_name: '家', expires_at: future(), revoked: false, created_at: '2026-11-01T00:00:00Z' },
      { token: 'inv_new', family_id: 'fam_one', family_name: '家', expires_at: future(), revoked: false, created_at: '2026-11-20T00:00:00Z' },
    ],
  });
  assert.equal((await family.resolveInvite('inv_old')).valid, false);
  assert.equal((await family.resolveInvite('inv_new')).valid, true);
});

// ---------- 角色与身份分离 / 家庭设置 ----------
test('roles normalize to admin/member and are independent of member_key', () => {
  const { family } = loadFamily();
  assert.equal(family.normalizeRole('admin'), 'admin');
  assert.equal(family.normalizeRole('parent'), 'member');
  assert.equal(family.normalizeRole('child'), 'member');
  assert.equal(family.normalizeRole('anything'), 'member');
  assert.equal(family.isAdmin({ status: 'active', role: 'admin', memberKey: 'guoguo' }), true);
  assert.equal(family.isAdmin({ status: 'active', role: 'member', memberKey: 'mama' }), false);
});

test('admin can rename the family; a plain member cannot', async () => {
  const a = loadFamily({ identity: ADMIN, rows: [{ family_id: 'fam_one', name: '旧名', created_by: 'u1' }] });
  assert.equal(await a.family.renameFamily('新家'), '新家');
  assert.equal(a.db.rows[0].name, '新家');

  const b = loadFamily({
    identity: Object.assign({}, ADMIN, { role: 'member', uid: 'u2' }),
    rows: [{ family_id: 'fam_one', name: '旧名', created_by: 'u1' }],
  });
  await assert.rejects(b.family.renameFamily('改不了'), /只有创建人或管理员/);
});

test('last admin cannot demote itself, but can promote another member', async () => {
  const rows = [
    { family_id: 'fam_one', uid: 'u1', name: '妈妈', role: 'admin', status: 'active', member_key: 'mama', created_at: '2026-11-01T00:00:00Z' },
    { family_id: 'fam_one', uid: 'u2', name: '爸爸', role: 'member', status: 'active', member_key: 'papa', created_at: '2026-11-02T00:00:00Z' },
  ];
  const a = loadFamily({ identity: ADMIN, rows });
  assert.equal(await a.family.setMemberRole('u2', 'admin'), 'admin', '先提拔继任者');
  assert.equal(await a.family.setMemberRole('u1', 'member'), 'member', '再自行降级，家庭仍有管理员');
  assert.equal(a.db.rows[1].role, 'admin');
});

test('members can rename themselves but not other members', async () => {
  const rows = [
    { family_id: 'fam_one', uid: 'u1', name: '妈妈', role: 'admin', status: 'active', member_key: 'mama' },
    { family_id: 'fam_one', uid: 'u2', name: '爸爸', role: 'member', status: 'active', member_key: 'papa' },
  ];
  const member = loadFamily({ identity: Object.assign({}, ADMIN, { uid: 'u2', name: '爸爸', role: 'member' }), rows });
  assert.equal(await member.family.updateDisplayName('u2', '老爸'), '老爸');
  await assert.rejects(member.family.updateDisplayName('u1', '乱改'), /只有管理员/);
  assert.equal(member.storage.get('gg_my_identity').name, '老爸', 'self rename updates cached identity');
});

test('leaving promotes the earliest active member and removes own row', async () => {
  const rows = [
    { family_id: 'fam_one', uid: 'u1', name: '妈妈', role: 'admin', status: 'active', member_key: 'mama', created_at: '2026-11-01T00:00:00Z' },
    { family_id: 'fam_one', uid: 'u2', name: '爸爸', role: 'member', status: 'active', member_key: 'papa', created_at: '2026-11-02T00:00:00Z' },
  ];
  const { family, db, storage } = loadFamily({ identity: ADMIN, rows });
  assert.equal(await family.leaveFamily(), true);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].uid, 'u2');
  assert.equal(db.rows[0].role, 'admin', 'heir must be promoted before admin leaves');
  assert.equal(storage.has('gg_my_identity'), false);
});
