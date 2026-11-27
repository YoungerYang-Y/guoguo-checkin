// 家庭文档同步：本地变更队列 + 三方合并 + 云端乐观并发控制。
const { getCloud, ensureSession, getLastAuthError, describeCloudError } = require('./cloud.js');
const family = require('./family.js');
const { merge, mergeRecords } = require('./sync-merge.js');
const DOC_KEYS = ['gg_family', 'gg_records', 'gg_schedule', 'gg_targets', 'gg_custom', 'gg_settings', 'gg_snapshots', 'gg_weights', 'gg_extra_settings', 'gg_poems', 'gg_words', 'gg_logs', 'gg_ledger'];
const META_KEY = 'gg_reset_state';
const PENDING_KEY = 'gg_pending_keys';
const BASE_KEY = 'gg_sync_base';
const VERSION_KEY = 'gg_sync_versions';
const ADOPTED_KEY = 'gg_family_adopted';
const EPOCH_KEY = 'gg_sync_epoch';
const LEGACY = 'legacy';
const read = (key, fallback) => { const v = wx.getStorageSync(key); return v === '' || v === null || v === undefined ? fallback : v; };
const put = (key, value) => wx.setStorageSync(key, value);
const pending = () => read(PENDING_KEY, []).filter(k => DOC_KEYS.indexOf(k) >= 0);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
let _state = { loggedIn: false, syncing: false, lastSync: '', lastError: '', dirty: false, familyId: '', memberKey: '', role: '' };
let _ready = false, _session = null, _familyId = '', _epoch = LEGACY, _initializing = false;
let _queue = Promise.resolve(), _scheduled = false, _bootstrap = null;
let _listeners = [];
function getState() { return Object.assign({}, _state, { ready: _ready, dirty: pending().length > 0 }); }
function saveState() {
  put('gg_sync_state', _state);
  _listeners.slice().forEach(fn => { try { fn(getState()); } catch (e) {} });
}
function onStateChange(fn) {
  _listeners.push(fn);
  return () => { _listeners = _listeners.filter(listener => listener !== fn); };
}
function enqueue(task) { const result = _queue.then(task); _queue = result.catch(() => {}); return result; }
function nextVersion(prev) { return new Date(Math.max(Date.now(), (Date.parse(prev) || 0) + 1)).toISOString(); }
function unpack(value, epoch) {
  if (value && value.__gg === 2) return value.epoch === epoch ? value.value : undefined;
  return epoch === LEGACY ? value : undefined;
}
async function getRow(key) {
  const { data, error } = await getCloud().database.from('gg_docs').select('doc_key,doc_value,family_id,updated_at')
    .eq('family_id', _familyId).eq('doc_key', key);
  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : null;
}
async function getEpoch() { const row = await getRow(META_KEY); return row && row.doc_value && row.doc_value.epoch || LEGACY; }
async function assertEpoch() { if (await getEpoch() !== _epoch) throw new Error('FAMILY_RESET_CHANGED'); }
async function compareWrite(key, row, value) {
  const payload = { family_id: _familyId, doc_key: key, doc_value: value, updated_at: nextVersion(row && row.updated_at) };
  let response;
  if (!row) {
    response = await getCloud().database.from('gg_docs').insert(payload).select('doc_key,updated_at');
    if (response.error && String(response.error.code) === '23505') return false;
  } else {
    let query = getCloud().database.from('gg_docs').update(payload).eq('family_id', _familyId).eq('doc_key', key);
    query = row.updated_at == null ? query.is('updated_at', null) : query.eq('updated_at', row.updated_at);
    response = await query.select('doc_key,updated_at');
  }
  if (response.error) throw response.error;
  // SELECT after mutation is essential: zero updated rows means another device won.
  return Array.isArray(response.data) && response.data.length > 0;
}
function clearLocal() {
  DOC_KEYS.forEach(key => wx.removeStorageSync(key));
  // 旧费用不再是同步文档，但仍属于原家庭，不能跨家庭或跨重置代次重放。
  ['gg_fees', 'gg_fees_migrated_v1'].forEach(key => wx.removeStorageSync(key));
  put(PENDING_KEY, []); put(BASE_KEY, {}); put(VERSION_KEY, {});
  // 家庭归属与重置代次一并清除：否则「清空数据 / 退出家庭」后残留的 adopted
  // 会让 store 的写入门禁把本机用户误判成访客，打卡和设置全部锁死。
  [ADOPTED_KEY, EPOCH_KEY, 'gg_invite_link', 'gg_visitor_link'].forEach(key => wx.removeStorageSync(key));
}
function stampFamily() {
  const f = read('gg_family', null);
  if (f) { f.familyId = _familyId; put('gg_family', f); }
}
async function pullAll(fresh) {
  // Fetch before replacing any local data. A failed join leaves the old cache intact.
  const epoch = await getEpoch();
  const { data, error } = await getCloud().database.from('gg_docs').select('doc_key,doc_value,family_id,updated_at').eq('family_id', _familyId);
  if (error) throw error;
  if (await getEpoch() !== epoch) throw new Error('FAMILY_RESET_CHANGED');
  const map = {};
  let legacyFees = [], ledgerNeedsRepair = false;
  (Array.isArray(data) ? data : []).forEach(row => {
    if (row.family_id === _familyId && row.doc_key === 'gg_fees' && epoch === LEGACY) {
      const fees = unpack(row.doc_value, epoch);
      if (Array.isArray(fees)) legacyFees = fees;
    }
    if (row.family_id === _familyId && DOC_KEYS.indexOf(row.doc_key) >= 0) {
      let v = unpack(row.doc_value, epoch);
      if (row.doc_key === 'gg_ledger' && Array.isArray(v)) {
        const normalized = merge('gg_ledger', undefined, v, v);
        ledgerNeedsRepair = JSON.stringify(normalized) !== JSON.stringify(v);
        v = normalized;
      }
      if (v !== undefined) map[row.doc_key] = v;
    }
  });
  const changed = read(ADOPTED_KEY, '') !== _familyId || read(EPOCH_KEY, LEGACY) !== epoch;
  fresh = fresh || changed;
  _epoch = epoch;
  _initializing = true;
  try {
    if (fresh) clearLocal();
    const base = read(BASE_KEY, {}), keys = pending();
    DOC_KEYS.forEach(key => {
      const remote = map[key];
      if (keys.indexOf(key) >= 0 && !fresh) {
        const local = read(key, undefined);
        const value = merge(key, base[key], local, remote);
        if (value !== undefined) put(key, value);
      } else if (has(map, key)) put(key, remote);
      else if (fresh) wx.removeStorageSync(key);
      if (remote !== undefined) base[key] = remote; else delete base[key];
    });
    put(BASE_KEY, base);
    require('./store.js').initFamily(false);
    stampFamily();
    put(ADOPTED_KEY, _familyId); put(EPOCH_KEY, epoch);
  } finally { _initializing = false; }
  if (ledgerNeedsRepair) markDirty('gg_ledger');
  if (legacyFees.length) {
    const result = require('./ledger-migrate.js').migrateCloudFees(legacyFees);
    if (result.error) throw new Error(result.error);
  }
}
async function pushKey(key) {
  const epoch = _epoch;
  for (let attempt = 0; attempt < 10; attempt++) {
    await assertEpoch();
    const versions = read(VERSION_KEY, {}), version = versions[key] || 0;
    const value = read(key, undefined), base = read(BASE_KEY, {});
    const row = await getRow(key);
    const remote = row ? unpack(row.doc_value, epoch) : undefined;
    const out = merge(key, base[key], value, remote);
    await assertEpoch();
    if (!await compareWrite(key, row, { __gg: 2, epoch, value: out === undefined ? null : out })) continue;
    await assertEpoch();
    const current = read(key, undefined), nowVersions = read(VERSION_KEY, {});
    const unchanged = (nowVersions[key] || 0) === version;
    // A write made while the request was in flight must survive acknowledgement.
    const reconciled = unchanged ? out : merge(key, value, current, out);
    if (reconciled !== undefined) put(key, reconciled);
    base[key] = out === undefined ? null : out; put(BASE_KEY, base);
    if (unchanged) put(PENDING_KEY, pending().filter(k => k !== key));
    return;
  }
  throw new Error('数据更新较频繁，请稍后再同步');
}
async function pushPending() {
  for (let round = 0; round < 16 && pending().length; round++) {
    for (const key of pending()) await pushKey(key);
  }
}
async function identify() {
  _familyId = ''; _state.familyId = ''; _state.memberKey = ''; _state.role = '';
  _session = await ensureSession(); _state.loggedIn = !!_session;
  if (!_session) {
    _familyId = ''; _state.familyId = ''; _state.memberKey = ''; _state.role = '';
    // 离线/登录失败时保留身份缓存：数据层与首页据此判定可写；
    // 上传目标由 _familyId 控制（此处为空），离线写入只会留在本机待同步。
    _state.lastError = (typeof getLastAuthError === 'function' && getLastAuthError()) || '暂未连接，记录已保存在本机';
    return null;
  }
  let id;
  try { id = await family.refreshIdentity(); }
  catch (e) {
    // A new session must never inherit the previous session's upload destination.
    _familyId = ''; _state.familyId = ''; _state.memberKey = ''; _state.role = '';
    throw e;
  }
  _familyId = id && id.status === 'active' ? id.familyId : '';
  _state.familyId = _familyId; _state.memberKey = _familyId ? id.memberKey : ''; _state.role = _familyId ? id.role : '';
  if (!_familyId) _state.lastError = '尚未加入家庭，数据仅保存在本机';
  return _familyId ? id : null;
}
async function runSync(refresh, upload) {
  _state.syncing = true; saveState();
  try {
    if (refresh || !_session || !_familyId) await identify();
    if (!_familyId) return getState();
    if (refresh || read(ADOPTED_KEY, '') !== _familyId || await getEpoch() !== read(EPOCH_KEY, LEGACY)) await pullAll(false);
    else _epoch = read(EPOCH_KEY, LEGACY);
    if (upload) await pushPending();
    _state.lastError = ''; _state.lastSync = new Date().toISOString();
  } catch (error) {
    if (error && error.message === 'FAMILY_RESET_CHANGED') {
      try { await pullAll(true); _state.lastError = '家庭数据已重置，已刷新本机记录'; }
      catch (e) { _state.lastError = describeCloudError(e, '同步未完成：'); }
    } else _state.lastError = describeCloudError(error, '同步未完成：');
  } finally { _state.syncing = false; saveState(); }
  return getState();
}
function markDirty(key) {
  if (_initializing || DOC_KEYS.indexOf(key) < 0) return;
  const list = pending(); if (list.indexOf(key) < 0) list.push(key); put(PENDING_KEY, list);
  const versions = read(VERSION_KEY, {}); versions[key] = (versions[key] || 0) + 1; put(VERSION_KEY, versions);
  saveState();
  if (_session && _familyId && !_scheduled) {
    _scheduled = true;
    Promise.resolve().then(() => { _scheduled = false; return flush(); }).catch(() => {});
  }
}
function bootstrap() {
  if (!_bootstrap) _bootstrap = enqueue(async () => { try { return await runSync(true, true); } finally { _ready = true; saveState(); } });
  return _bootstrap;
}
function syncNow() { return enqueue(() => runSync(true, true)); }
function flush() { return enqueue(() => runSync(false, true)); }
function refreshMembership() { return enqueue(() => runSync(true, false)); }
function adoptCreatedFamily(id) {
  return enqueue(async () => {
    _session = await ensureSession();
    if (!_session) throw new Error('登录未完成，请重新连接后重试');
    _familyId = id.familyId; Object.assign(_state, { loggedIn: true, familyId: id.familyId, memberKey: id.memberKey, role: id.role });
    _epoch = await getEpoch();
    // 首个云家庭可接管纯本机记录；换账号后创建新家庭不能接管旧家庭缓存。
    const previousFamily = read(ADOPTED_KEY, '');
    if (previousFamily && previousFamily !== _familyId) {
      _initializing = true;
      try { clearLocal(); require('./store.js').initFamily(true); }
      finally { _initializing = false; }
    }
    put(ADOPTED_KEY, _familyId); put(EPOCH_KEY, _epoch); put(BASE_KEY, {}); stampFamily();
    put(PENDING_KEY, DOC_KEYS.filter(key => read(key, undefined) !== undefined));
    return runSync(false, true);
  });
}
function adoptJoinedFamily() { return syncNow(); }
async function resetFamilyData() {
  return enqueue(async () => {
    const cached = family.getIdentity();
    if (cached && cached.status === 'active') {
      const id = await identify();
      const fam = require('./family.js');
      const can = typeof fam.isManager === 'function' ? fam.isManager(id)
        : !!(id && id.status === 'active' && ['creator', 'admin'].indexOf(id.role) >= 0);
      if (!id || !can) throw new Error('请连接网络并以创建人或管理员身份清空数据');
      let saved = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        const row = await getRow(META_KEY);
        const epoch = 'reset_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        if (await compareWrite(META_KEY, row, { epoch })) { _epoch = epoch; saved = true; break; }
      }
      if (!saved) throw new Error('家庭数据正在更新，请稍后重试');
      // The committed epoch invalidates every previous document, including offline copies.
      await pullAll(true);
      // Scrub old payloads too; the epoch already prevents their reuse if cleanup is interrupted.
      DOC_KEYS.forEach(key => {
        if (read(key, undefined) === undefined) put(key, key === 'gg_extra_settings' ? {} : []);
      });
      put(PENDING_KEY, DOC_KEYS.slice());
      try { await pushPending(); }
      catch (e) {
        _state.lastError = describeCloudError(e, '重置已生效，云端清理待同步：');
        saveState();
        return { data: require('./store.js').getFamily(), error: null, cleanupPending: true };
      }
    } else {
      _initializing = true;
      try { clearLocal(); require('./store.js').initFamily(true); }
      finally { _initializing = false; }
    }
    _state.lastError = ''; saveState();
    return { data: require('./store.js').getFamily(), error: null };
  });
}
// 退出家庭后把本机恢复为「未加入家庭」：清身份缓存、清 adopted/epoch、重建本地默认家庭
function forgetFamily() {
  _familyId = '';
  Object.assign(_state, { loggedIn: !!_session, familyId: '', memberKey: '', role: '' });
  family.clearIdentity();
  _initializing = true;
  try { clearLocal(); require('./store.js').initFamily(true); }
  finally { _initializing = false; }
  saveState();
}

module.exports = {
  bootstrap, markDirty, flush, syncNow, refreshMembership, getState, onStateChange,
  isLoggedIn: () => !!_session,
  getSessionUser: () => _session && _session.user ? { id: _session.user.id, name: _session.user.name } : null,
  getFamilyId: () => _familyId, getIdentity: () => family.getIdentity(),
  adoptCreatedFamily, adoptJoinedFamily, resetFamilyData, forgetFamily, DOC_KEYS, mergeRecords,
};
