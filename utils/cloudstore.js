// 云同步引擎（家庭版）：本地存储为工作缓存，云端 gg_docs 为持久化权威源。
// 家庭核心：所有写入带 family_id；冲突键 family_id,doc_key；
//   gg_records 按 record_id 记录级合并（同 id 取 updated_at 新），保证多人各自打卡都保留。
// 身份来自 utils/family.js（直连 gg_members），未入家庭时仅本地模式。
const { getCloud, ensureSession, getLastAuthError, describeCloudError } = require('./cloud.js');
const family = require('./family.js');

const DOC_KEYS = ['gg_family', 'gg_records', 'gg_schedule', 'gg_targets', 'gg_custom', 'gg_settings', 'gg_snapshots', 'gg_weights', 'gg_fees', 'gg_extra_settings', 'gg_poems', 'gg_words'];
const SYNC_KEY = 'gg_sync_state';
const PENDING_KEY = 'gg_pending_keys';
const ADOPTED_KEY = 'gg_family_adopted';   // 本地数据已归属的家庭 id；变化时说明换了家庭，需重建本地

function localModeMessage() {
  const reason = (typeof getLastAuthError === 'function' ? getLastAuthError() : '') || '';
  return reason
    ? (reason + '；数据已保存在本机，不影响打卡')
    : '暂未登录，数据已保存在本机，不影响打卡';
}

function readPending() {
  try { const v = wx.getStorageSync(PENDING_KEY); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function savePending(list) {
  try { wx.setStorageSync(PENDING_KEY, list); } catch (e) {}
}
function addPending(docKey) {
  const list = readPending();
  if (list.indexOf(docKey) < 0) { list.push(docKey); savePending(list); }
}
function removePending(docKey) {
  const list = readPending().filter(k => k !== docKey);
  savePending(list);
}
function readAdopted() {
  try { return wx.getStorageSync(ADOPTED_KEY) || ''; } catch (e) { return ''; }
}
function saveAdopted(fid) {
  try { wx.setStorageSync(ADOPTED_KEY, fid || ''); } catch (e) {}
}

// 记录级合并：两边 record_id 取并集，同 id 比 updated_at 取新。核心保证多人打卡互不覆盖。
function mergeRecords(local, remote) {
  const map = {};
  (Array.isArray(local) ? local : []).forEach(r => {
    if (r && r.record_id) map[r.record_id] = r;
  });
  (Array.isArray(remote) ? remote : []).forEach(r => {
    if (!r || !r.record_id) return;
    const prev = map[r.record_id];
    if (!prev || String(r.updated_at || '') >= String(prev.updated_at || '')) map[r.record_id] = r;
  });
  return Object.keys(map).map(k => map[k]);
}

// 首次接入家庭：清掉本机旧的单机数据（用户已拍板旧数据丢弃）
function clearLocalForFamily() {
  DOC_KEYS.forEach(k => { try { wx.removeStorageSync(k); } catch (e) {} });
  savePending([]);
}
// 给本地家庭配置打上云端 family_id（去掉旧的本地随机 id 语义）
function stampFamilyId(fid) {
  try {
    const f = wx.getStorageSync('gg_family');
    if (f && typeof f === 'object') { f.familyId = fid; wx.setStorageSync('gg_family', f); }
  } catch (e) {}
}

let _state = { loggedIn: false, syncing: false, lastSync: '', lastError: '', dirty: false, familyId: '', memberKey: '', role: '' };
let _ready = false;
let _session = null;
let _familyId = '';
let _identity = null;
let _dirty = false;
let _flushing = false;
let _initializing = false;   // 重建本地期间抑制 flush
let _retry = 0;
const MAX_RETRY = 3;
let _listeners = [];

function readState() {
  try {
    const v = wx.getStorageSync(SYNC_KEY);
    if (v && typeof v === 'object') _state = Object.assign({}, _state, v);
  } catch (e) {}
  return _state;
}
function saveState() {
  try { wx.setStorageSync(SYNC_KEY, _state); } catch (e) {}
  _listeners.forEach(fn => { try { fn(getState()); } catch (e) {} });
}
function getState() { return Object.assign({}, _state, { ready: _ready }); }
function onStateChange(fn) { _listeners.push(fn); }

function isLoggedIn() { return !!_session; }
function getSessionUser() {
  return _session && _session.user ? { id: _session.user.id, name: _session.user.name } : null;
}
function getFamilyId() { return _familyId; }
function getIdentity() { return family.getIdentity(); }

// ---------- 云端读写 ----------
// fresh=true 时清空本地后全量覆盖（换家庭/新加入）；否则记录级合并
async function pullAll(fresh) {
  if (!_familyId) return {};
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_docs')
    .select('doc_key, doc_value, family_id')
    .eq('family_id', _familyId);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const map = {};
  rows.forEach(r => {
    if (r.family_id !== _familyId) return;    // 忽略本人 owner 的旧数据行（family_id=NULL，用户已弃用）
    map[r.doc_key] = r.doc_value;
  });
  const pending = readPending();
  DOC_KEYS.forEach(k => {
    if (!fresh && pending.indexOf(k) >= 0) return;   // 本地有未上传变更时不覆盖
    if (Object.prototype.hasOwnProperty.call(map, k) && map[k] !== undefined && map[k] !== null && map[k] !== '') {
      let value = map[k];
      if (k === 'gg_records' && !fresh) {
        let local = null;
        try { local = wx.getStorageSync(k); } catch (e) {}
        value = mergeRecords(local, value);
      }
      try { wx.setStorageSync(k, value); } catch (e) {}
    } else if (fresh) {
      try { wx.removeStorageSync(k); } catch (e) {}
    }
  });
  return map;
}

async function pushAll() {
  if (!_familyId) return;   // 未入家庭：不上传，避免制造孤立 owner 行
  const cloud = getCloud();
  for (let i = 0; i < DOC_KEYS.length; i++) {
    const docKey = DOC_KEYS[i];
    let value;
    try { value = wx.getStorageSync(docKey); } catch (e) { value = null; }
    if (value === '' || value === undefined || value === null) { removePending(docKey); continue; }
    let out = value;
    // push 前合并一次云端，尽量缩小并发覆盖窗口（彻底消除需服务端事务/RPC，本平台不可用）
    if (docKey === 'gg_records') {
      try {
        const { data } = await cloud.database.from('gg_docs')
          .select('doc_value').eq('family_id', _familyId).eq('doc_key', docKey);
        if (Array.isArray(data) && data[0] && data[0].doc_value) out = mergeRecords(value, data[0].doc_value);
      } catch (e) {}
    }
    const { error } = await cloud.database
      .from('gg_docs')
      .upsert({
        family_id: _familyId, doc_key: docKey, doc_value: out,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'family_id,doc_key' });
    if (error) throw error;
    if (docKey === 'gg_records' && out !== value) {
      try { wx.setStorageSync(docKey, out); } catch (e) {}
    }
    removePending(docKey);
  }
}

// ---------- 写入钩子：store.write 后调用 ----------
function markDirty(docKey) {
  if (DOC_KEYS.indexOf(docKey) < 0) return;
  addPending(docKey);
  if (!_session || !_familyId) return;   // 未登录/未入家庭：仅本地，dirty 等待入家庭后补传
  if (_initializing) return;
  _dirty = true;
  _state.dirty = true;
  saveState();
  flush();
}

async function flush() {
  if (_flushing || !_session || !_familyId || !_dirty) return;
  _flushing = true;
  _dirty = false;
  _state.dirty = false;
  _state.syncing = true;
  saveState();
  try {
    await pushAll();
    _retry = 0;
    _state.lastSync = new Date().toISOString();
    _state.lastError = '';
  } catch (e) {
    _retry++;
    _state.lastError = describeCloudError(e, '同步失败：');
    if (_retry >= MAX_RETRY) { _dirty = false; _state.dirty = false; }
    else { _dirty = true; _state.dirty = true; }
  } finally {
    _state.syncing = false;
    _flushing = false;
    saveState();
    if (_dirty && _session && _familyId && _retry < MAX_RETRY) flush();
  }
}

// ---------- 身份接入 ----------
// 创建家庭成功：本地数据作为种子上传（不清空）
async function adoptCreatedFamily(id) {
  _identity = id;
  _familyId = id.familyId;
  _state.familyId = id.familyId;
  _state.memberKey = id.memberKey;
  _state.role = id.role;
  saveAdopted(id.familyId);
  stampFamilyId(id.familyId);
  _dirty = true;
  saveState();
  await flush();
  return getState();
}

// 加入家庭/被批准后：清空本地旧数据，以云端家庭数据为准
async function adoptJoinedFamily(id) {
  _identity = id;
  _familyId = id.familyId;
  _state.familyId = id.familyId;
  _state.memberKey = id.memberKey;
  _state.role = id.role;
  _state.lastError = '';
  _initializing = true;
  try {
    clearLocalForFamily();
    await pullAll(true);
    require('./store.js').initFamily(false);   // 补齐云端缺失的默认文档
    stampFamilyId(id.familyId);
    saveAdopted(id.familyId);
  } finally {
    _initializing = false;
  }
  _dirty = true;
  saveState();
  await flush();
  return getState();
}

// ---------- 启动引导 ----------
async function bootstrap() {
  readState();
  try {
    const session = await ensureSession();
    _session = session || null;
    _state.loggedIn = !!_session;
    if (_session) {
      const id = await family.refreshIdentity();
      _identity = id && id.status === 'active' ? id : null;
      if (_identity && _identity.familyId) {
        _familyId = _identity.familyId;
        _state.familyId = _familyId;
        _state.memberKey = _identity.memberKey;
        _state.role = _identity.role;
        const adopted = readAdopted();
        if (adopted !== _familyId) {
          // 本机尚未归属该家庭（换设备/被批准）：重建本地
          _initializing = true;
          try {
            clearLocalForFamily();
            await pullAll(true);
            require('./store.js').initFamily(false);
            stampFamilyId(_familyId);
            saveAdopted(_familyId);
          } finally { _initializing = false; }
        } else {
          await pullAll(false);
        }
        _dirty = true;
        await flush();
      } else {
        _familyId = '';
        _state.familyId = '';
        _state.memberKey = '';
        _state.role = '';
        _state.lastError = '尚未加入家庭，数据仅保存在本机；可在「我的 → 家庭管理」创建或加入';
      }
    } else {
      _state.lastError = localModeMessage();
    }
  } catch (e) {
    _state.lastError = describeCloudError(e, '云端读写失败：');
  } finally {
    _ready = true;
    saveState();
  }
  return getState();
}

// 手动同步：刷新身份 → 合并拉取 → 上传
async function syncNow() {
  if (!_session) {
    const session = await ensureSession();
    _session = session || null;
    _state.loggedIn = !!_session;
  }
  if (!_session) { _state.lastError = localModeMessage(); saveState(); return getState(); }
  try {
    const id = await family.refreshIdentity();
    _identity = id && id.status === 'active' ? id : null;
    if (!_identity || !_identity.familyId) {
      _state.lastError = '尚未加入家庭，数据仅保存在本机';
      saveState();
      return getState();
    }
    _familyId = _identity.familyId;
    _state.familyId = _familyId;
    _state.memberKey = _identity.memberKey;
    _state.role = _identity.role;
    await pullAll(false);
    await pushAll();
    savePending([]);
    _dirty = false;
    _state.dirty = false;
    _state.lastSync = new Date().toISOString();
    _state.lastError = '';
  } catch (e) {
    _dirty = true;
    _state.dirty = true;
    _state.lastError = describeCloudError(e, '同步失败：');
  }
  saveState();
  return getState();
}

module.exports = {
  bootstrap, markDirty, flush, syncNow, getState, onStateChange,
  isLoggedIn, getSessionUser, getFamilyId, getIdentity,
  adoptCreatedFamily, adoptJoinedFamily, DOC_KEYS, mergeRecords,
};
