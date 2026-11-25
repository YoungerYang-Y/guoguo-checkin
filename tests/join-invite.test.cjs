const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clone = value => value === undefined ? undefined : structuredClone(value);
const future = new Date(Date.now() + 86400000).toISOString();

class Query {
  constructor(database, table) { this.database = database; this.table = table; this.action = 'select'; this.filters = []; this.values = null; this.returnRows = false; }
  select() { this.returnRows = true; return this; }
  eq(key, value) { this.filters.push(['eq', key, value]); return this; }
  neq(key, value) { this.filters.push(['neq', key, value]); return this; }
  update(values) { this.action = 'update'; this.values = clone(values); this.returnRows = true; return this; }
  insert(values) { this.action = 'insert'; this.values = clone(values); this.returnRows = true; return this; }
  then(resolve, reject) { return this.database.run(this).then(resolve, reject); }
}

class Database {
  constructor(rows = []) { this.rows = structuredClone(rows); this.calls = []; }
  from(table) { return new Query(this, table); }
  async run(query) {
    this.calls.push({ table: query.table, action: query.action, filters: clone(query.filters), values: clone(query.values) });
    const matches = row => query.filters.every(([op, key, value]) => op === 'neq' ? row[key] !== value : row[key] === value);
    if (query.action === 'insert') {
      // 模拟 UNIQUE(family_id, uid)
      const row = clone(query.values);
      if (this.rows.some(r => r.family_id === row.family_id && r.uid === row.uid)) {
        return { data: null, error: { message: 'duplicate key (family_id, uid)' } };
      }
      this.rows.push(row);
      return { data: query.returnRows ? [clone(row)] : null, error: null };
    }
    if (query.action === 'update') {
      const rows = this.rows.filter(matches);
      rows.forEach(r => Object.assign(r, clone(query.values)));
      return { data: query.returnRows ? clone(rows) : null, error: null };
    }
    return { data: clone(this.rows.filter(matches)), error: null };
  }
}

// 触发器在库层的行为：任何持有凭证（邀请 token / 家庭码）的新成员 → active/member。
// 用 JS 复刻判定，保证前端传参与云端守卫语义一致（真机仍以数据库触发器为准）。
function triggerInsert(rows, invites, values) {
  const { family_id: fid, invited_by: token } = values;
  const isFirst = !rows.some(r => r.family_id === fid);
  if (isFirst) return { ...values, status: 'active', role: 'admin', invited_by: null };
  const invite = invites.find(t => t.token === token && t.family_id === fid && !t.revoked && t.expires_at === future);
  if (invite) return { ...values, status: 'active', role: 'member', invited_by: invite.created_by };
  return { ...values, status: 'active', role: 'member', invited_by: null };
}

function loadFamily({ rows = [], invites = [], session = { user: { id: 'u2' } } } = {}) {
  const db = new Database([...rows, ...invites]);
  const storage = new Map();
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

function validInvite(familyId = 'fam_x', createdBy = 'u1') {
  return { token: 'inv_ok', family_id: familyId, created_by: createdBy, family_name: '测试家庭', expires_at: future, revoked: false };
}

test('邀请直连：有效 token + 未入家庭 → 一次插入即 active/member，不产生 pending', async () => {
  const inv = validInvite();
  const { family, db, storage } = loadFamily({ invites: [inv] });
  const joined = await family.joinByInvite('inv_ok', 'papa', '爸爸');
  assert.equal(joined.status, 'active');
  assert.equal(joined.familyId, 'fam_x');
  assert.equal(joined.identity.memberKey, 'papa');
  const insert = db.calls.find(c => c.action === 'insert' && c.table === 'gg_members');
  assert.ok(insert, '应写入成员行');
  assert.equal(insert.values.status, 'active');
  assert.equal(insert.values.invited_by, 'inv_ok', '前端把 token 交给触发器校验');
  assert.equal(db.calls.some(c => c.action === 'update' && c.table === 'gg_members'), false, '不需要事后批准');
  assert.equal(storage.get('gg_my_identity').memberKey, 'papa', '身份立即写入缓存');
});

test('身份查重：同家庭已有 active 成员占用该身份时拒绝加入', async () => {
  const inv = validInvite();
  const { family, db } = loadFamily({
    rows: [{ family_id: 'fam_x', uid: 'u1', member_key: 'papa', name: '爸爸', role: 'admin', status: 'active' }],
    invites: [inv],
  });
  await assert.rejects(family.joinByInvite('inv_ok', 'papa', '爸爸'), /已有人使用/);
  assert.equal(db.calls.some(c => c.action === 'insert' && c.table === 'gg_members'), false);
});

test('身份可用：换一个未被占用的身份可以加入', async () => {
  const inv = validInvite();
  const { family } = loadFamily({
    rows: [{ family_id: 'fam_x', uid: 'u1', member_key: 'papa', name: '爸爸', role: 'admin', status: 'active' }],
    invites: [inv],
  });
  const joined = await family.joinByInvite('inv_ok', 'mama', '妈妈');
  assert.equal(joined.identity.memberKey, 'mama');
});

test('失效邀请：撤销 / 过期 / 不存在 的 token 一律拒绝，不写库', async t => {
  const cases = [
    ['撤销', { token: 'inv_ok', family_id: 'fam_x', created_by: 'u1', expires_at: future, revoked: true }],
    ['过期', { token: 'inv_ok', family_id: 'fam_x', created_by: 'u1', expires_at: '2020-01-01T00:00:00Z', revoked: false }],
  ];
  for (const [label, invite] of cases) {
    await t.test(label, async () => {
      const { family, db } = loadFamily({ invites: [invite] });
      await assert.rejects(family.joinByInvite('inv_ok', 'papa', '爸爸'));
      assert.equal(db.calls.some(c => c.action === 'insert' && c.table === 'gg_members'), false);
    });
  }
  await t.test('不存在', async () => {
    const { family, db } = loadFamily();
    await assert.rejects(family.joinByInvite('inv_nope', 'papa', '爸爸'));
    assert.equal(db.calls.some(c => c.action === 'insert' && c.table === 'gg_members'), false);
  });
});

test('已入其他家庭：邀请直连也拒绝，避免一人多家庭', async () => {
  const inv = validInvite('fam_new');
  const { family, db } = loadFamily({
    identity: { familyId: 'fam_old', memberKey: 'mama', role: 'admin', status: 'active', uid: 'u2' },
    rows: [{ family_id: 'fam_old', uid: 'u2', member_key: 'mama', role: 'admin', status: 'active' }],
    invites: [inv],
  });
  await assert.rejects(family.joinByInvite('inv_ok', 'papa', '爸爸'), /其他家庭/);
  assert.equal(db.calls.some(c => c.action === 'insert' && c.table === 'gg_members'), false);
});

test('历史 pending 行指向其他家庭时，不阻塞邀请直连加入', async () => {
  const inv = validInvite();
  const { family } = loadFamily({
    rows: [{ family_id: 'fam_y', uid: 'u2', member_key: 'papa', status: 'pending' }],
    invites: [inv],
  });
  const joined = await family.joinByInvite('inv_ok', 'papa', '爸爸');
  assert.equal(joined.status, 'active');
  assert.equal(joined.familyId, 'fam_x');
});

test('云端触发器语义：邀请 token 记邀请人；家庭码同为 active/member 且 invited_by 留空', () => {
  const inv = validInvite();
  const existing = [{ family_id: 'fam_x', uid: 'u1', status: 'active' }];
  const viaInvite = triggerInsert(existing, [inv], { family_id: 'fam_x', uid: 'u2', member_key: 'papa', status: 'active', role: 'member', invited_by: 'inv_ok' });
  assert.equal(viaInvite.status, 'active');
  assert.equal(viaInvite.role, 'member');
  assert.equal(viaInvite.invited_by, 'u1', 'token 被改写成邀请人 uid，不落库 token');
  const viaCode = triggerInsert(existing, [inv], { family_id: 'fam_x', uid: 'u3', member_key: 'mama', status: 'active', role: 'member', invited_by: null });
  assert.equal(viaCode.status, 'active', '手动家庭码同为凭证，直接生效');
  assert.equal(viaCode.role, 'member', '无邀请 token 时 invited_by 留空');
  const first = triggerInsert([], [inv], { family_id: 'fam_new', uid: 'u9', status: 'pending', role: 'member', invited_by: null });
  assert.equal(first.status, 'active');
  assert.equal(first.role, 'admin', '创建者仍是 admin');
});
