// 云同步引擎：本地存储为工作缓存（保持同步 API），云端 gg_docs 为持久化权威源。
// - 启动：ensureSession → pullAll（云端覆盖本地）→ 全量补传本地数据上云
// - 写入：本地先写（即时响应），再标记 dirty 触发一次全量 upsert（防抖）
// - 未登录时仅本地可用；dirty 标志保留，登录后自动补传
// 说明：家庭数据仅 7 个文档，全量同步开销极小，用全量替代增量队列以规避并发竞态。
const { getCloud, ensureSession, getLastAuthError, describeCloudError } = require('./cloud.js');

// 未登录时的可读原因。数据始终先写本机缓存，登录不可用不影响打卡与报表。
function localModeMessage() {
  const reason = (typeof getLastAuthError === 'function' ? getLastAuthError() : '') || '';
  return reason
    ? (reason + '；数据已保存在本机，不影响打卡')
    : '暂未登录，数据已保存在本机，不影响打卡';
}

const DOC_KEYS = ['gg_family', 'gg_records', 'gg_schedule', 'gg_targets', 'gg_custom', 'gg_settings', 'gg_snapshots', 'gg_weights', 'gg_fees', 'gg_extra_settings', 'gg_poems', 'gg_words'];
const SYNC_KEY = 'gg_sync_state';
// 本地有未上传变更的文档：启动拉取时不得用云端旧数据覆盖（防止撤销/离线打卡被复活）
const PENDING_KEY = 'gg_pending_keys';

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

let _state = { loggedIn: false, syncing: false, lastSync: '', lastError: '', dirty: false };
let _ready = false;
let _session = null;
let _dirty = false;          // 是否有待上传变更
let _flushing = false;
let _retry = 0;              // 连续失败重试计数，避免失效会话下无限重试
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

// ---------- 云端读写 ----------
async function pullAll() {
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_docs').select('doc_key, doc_value');
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const map = {};
  rows.forEach(r => { map[r.doc_key] = r.doc_value; });
  // 云端数据覆盖本地缓存（仅覆盖有值且本地无待上传变更的 key）
  const pending = readPending();
  DOC_KEYS.forEach(k => {
    if (pending.indexOf(k) >= 0) return;   // 本地更新优先，等 pushAll 上传后再以云端为准
    if (Object.prototype.hasOwnProperty.call(map, k) && map[k] !== undefined && map[k] !== null && map[k] !== '') {
      try { wx.setStorageSync(k, map[k]); } catch (e) {}
    }
  });
  return map;
}

async function pushAll() {
  const cloud = getCloud();
  for (let i = 0; i < DOC_KEYS.length; i++) {
    const docKey = DOC_KEYS[i];
    let value;
    try { value = wx.getStorageSync(docKey); } catch (e) { value = null; }
    if (value === '' || value === undefined || value === null) { removePending(docKey); continue; }
    // owner_id 不传，由数据库 DEFAULT auth.uid() 填充，RLS 校验归属
    const { error } = await cloud.database
      .from('gg_docs')
      .upsert({ doc_key: docKey, doc_value: value, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,doc_key' });
    if (error) throw error;
    removePending(docKey);
  }
}

// ---------- 写入钩子：store.write 后调用 ----------
function markDirty(docKey) {
  if (DOC_KEYS.indexOf(docKey) < 0) return;
  addPending(docKey);                  // 离线/未登录时同样标记，启动拉取不得覆盖
  if (!_session) return;               // 未登录：仅本地，dirty 等待登录后补传
  _dirty = true;
  _state.dirty = true;
  saveState();
  flush();
}

async function flush() {
  if (_flushing || !_session || !_dirty) return;
  _flushing = true;
  _dirty = false;                       // 取走 dirty 标志
  _state.dirty = false;
  _state.syncing = true;
  saveState();
  try {
    await pushAll();
    _retry = 0;
    _state.lastSync = new Date().toISOString();
    _state.lastError = '';
  } catch (e) {
    // 上传失败：保留 dirty 标志，但限制连续重试次数，避免会话失效时死循环
    _retry++;
    _state.lastError = describeCloudError(e, '同步失败：');
    if (_retry >= MAX_RETRY) {
      _dirty = false;                 // 停止自动重试；保留 lastError 提示，等待手动同步
      _state.dirty = false;
    } else {
      _dirty = true;
      _state.dirty = true;
    }
  } finally {
    _state.syncing = false;
    _flushing = false;
    saveState();
    // 本轮期间又有新写入且未达重试上限：继续下一轮
    if (_dirty && _session && _retry < MAX_RETRY) flush();
  }
}

// ---------- 启动引导 ----------
async function bootstrap() {
  readState();
  try {
    const session = await ensureSession();
    _session = session || null;
    _state.loggedIn = !!_session;
    if (_session) {
      try {
        await pullAll();                       // 云端权威覆盖本地
        _dirty = true;                         // 全量补传一次，合并本地既有数据
        await flush();
      } catch (e) {
        _state.lastError = describeCloudError(e, '云端读写失败：');
      }
    } else {
      _state.lastError = localModeMessage();
    }
  } catch (e) {
    _state.lastError = describeCloudError(e, '云服务不可用：');
  } finally {
    _ready = true;
    saveState();
  }
  return getState();
}

// 手动触发：重新登录并全量同步（供"我的"页按钮调用）
async function syncNow() {
  if (!_session) {
    const session = await ensureSession();
    _session = session || null;
    _state.loggedIn = !!_session;
  }
  if (!_session) { _state.lastError = localModeMessage(); saveState(); return getState(); }
  _dirty = true;
  try {
    await pullAll();
    await pushAll();
    savePending([]);                     // 手动同步成功后清空待上传标记
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
  isLoggedIn, getSessionUser, DOC_KEYS,
};
