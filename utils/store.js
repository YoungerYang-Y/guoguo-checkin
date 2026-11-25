// 本地存储数据层：所有读写经此模块，页面不直接访问 wx.getStorageSync
const { defaultSchedule, DEFAULT_WEEKLY_TARGETS } = require('./constants.js');
const D = require('./date.js');
const { today } = D;
const policy = require('./policy.js');
const { mergeRecords } = require('./sync-merge.js');

const KEYS = {
  FAMILY: 'gg_family',
  RECORDS: 'gg_records',
  SCHEDULE: 'gg_schedule',
  TARGETS: 'gg_targets',
  CUSTOM: 'gg_custom',
  SETTINGS: 'gg_settings',
  SNAPSHOTS: 'gg_snapshots',
  WEIGHTS: 'gg_weights',
  FEES: 'gg_fees',
  EXTRA_SETTINGS: 'gg_extra_settings',
  POEMS: 'gg_poems',
  WORDS: 'gg_words',
};

function read(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    return v === '' || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function write(key, value) {
  try {
    wx.setStorageSync(key, value);
    // 本地写入成功后，异步触发云端同步（失败不影响本地交互）
    try { require('./cloudstore.js').markDirty(key); } catch (e) {}
    return { data: value, error: null };
  } catch (e) {
    return { data: null, error: 'STORAGE_WRITE_FAILED' };
  }
}

function uid(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------- 初始化 ----------
function initFamily(force) {
  let family = read(KEYS.FAMILY, null);
  if (!family || force) {
    family = {
      familyId: uid('fam'),
      members: [
        { id: 'guoguo', name: '果果', role: 'child' },
        { id: 'papa', name: '爸爸', role: 'parent' },
        { id: 'mama', name: '妈妈', role: 'admin' },
      ],
      createdAt: new Date().toISOString(),
    };
    write(KEYS.FAMILY, family);
  }
  if (!read(KEYS.RECORDS, null)) write(KEYS.RECORDS, []);
  if (!read(KEYS.SCHEDULE, null)) write(KEYS.SCHEDULE, defaultSchedule());
  if (!read(KEYS.TARGETS, null)) write(KEYS.TARGETS, Object.assign({}, DEFAULT_WEEKLY_TARGETS));
  if (!read(KEYS.CUSTOM, null)) write(KEYS.CUSTOM, []);
  if (!read(KEYS.SETTINGS, null)) {
    write(KEYS.SETTINGS, { remindTime: '20:30', remindEnabled: false, weekRemind: true });
  }
  if (!read(KEYS.SNAPSHOTS, null)) write(KEYS.SNAPSHOTS, []);
  return family;
}

function getFamily() { return read(KEYS.FAMILY, null) || initFamily(); }
function canManage() {
  const id = require('./family.js').getIdentity();
  return !id || id.status !== 'active' || id.role === 'admin';
}
function updateMemberName(memberId, name) {
  if (!canManage()) return { data: null, error: 'FORBIDDEN' };
  const f = getFamily();
  const m = f.members.find(x => x.id === memberId);
  if (!m) return { data: null, error: 'NOT_FOUND' };
  m.name = name;
  write(KEYS.FAMILY, f);
  return { data: f, error: null };
}

// ---------- 排期与目标 ----------
function getSchedule() { return read(KEYS.SCHEDULE, defaultSchedule()); }
function setRequired(code, dow, val) {
  if (!canManage()) return { data: null, error: 'FORBIDDEN' };
  const s = getSchedule();
  if (!s[code]) return { data: null, error: 'INVALID_CODE' };
  return write(KEYS.SCHEDULE, policy.stageScheduleChange(s, code, dow, val, today()));
}

function getTargets() { return read(KEYS.TARGETS, Object.assign({}, DEFAULT_WEEKLY_TARGETS)); }
function setTarget(code, value) {
  if (!canManage()) return { data: null, error: 'FORBIDDEN' };
  return write(KEYS.TARGETS, policy.stageTargetChange(getTargets(), code, Math.max(0, Number(value) || 0), today()));
}

function getSettings() { return read(KEYS.SETTINGS, { remindTime: '20:30', remindEnabled: false, weekRemind: true }); }
function setSettings(patch) {
  if (!canManage()) return { data: null, error: 'FORBIDDEN' };
  const s = Object.assign(getSettings(), patch);
  write(KEYS.SETTINGS, s);
  return { data: s, error: null };
}

// ---------- 打卡记录 ----------
function getRecords() { return mergeRecords([], read(KEYS.RECORDS, [])); }

// 唯一约束：member + item + biz_date，后写入覆盖先写入
function saveRecord(rec) {
  const list = getRecords();
  const idx = list.findIndex(r => r.member_id === rec.member_id && r.item_code === rec.item_code && r.biz_date === rec.biz_date);
  const now = new Date().toISOString();
  const record = Object.assign({
    record_id: idx >= 0 ? list[idx].record_id : uid('rec'),
    status: 1,
    session_count: null,
    metric_value: null,
    metric_unit: '',
    note: '',
    theme: '',
    source: 1,
    target_id: '',
    standard_snapshot: '',
    unverified: false,
    operator: 'self',
    created_at: now,
    updated_at: now,
  }, rec);
  if (idx >= 0) {
    record.created_at = list[idx].created_at;
    list[idx] = record;
  } else {
    list.push(record);
  }
  const w = write(KEYS.RECORDS, list);
  return w.error ? w : { data: record, error: null };
}

// 撤销：status=2，保留供审计
function revokeRecord(memberId, itemCode, date) {
  const list = getRecords();
  const idx = list.findIndex(r => r.member_id === memberId && r.item_code === itemCode && r.biz_date === date);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  list[idx].status = 2;
  list[idx].updated_at = new Date().toISOString();
  const w = write(KEYS.RECORDS, list);
  return w.error ? w : { data: list[idx], error: null };
}

function getRecord(memberId, itemCode, date) {
  return getRecords().find(r => r.member_id === memberId && r.item_code === itemCode && r.biz_date === date) || null;
}

function getDayRecords(date) {
  return getRecords().filter(r => r.biz_date === date && r.status === 1);
}

// 判断某日期是否可补卡（近7个自然日，含今天）
function canBackfill(date) {
  const t = today();
  if (date > t) return false;
  const days = Math.round((new Date(t) - new Date(date)) / 86400000);
  return days <= 7;
}

// 导出 CSV 明细
function exportCSV(start, end) {
  // 只导出有效打卡明细；status=2 的撤销记录仅保留在存储中供审计
  const list = getRecords().filter(r => r.biz_date >= start && r.biz_date <= end && r.status === 1);
  const head = '日期,成员,打卡项,完成状态,节数,数量,备注,来源,达标标准快照';
  const memberName = id => (getFamily().members.find(m => m.id === id) || {}).name || id;
  const cell = v => '"' + String(v === null || v === undefined ? '' : v).replace(/\r?\n/g, ' ').replace(/"/g, '""') + '"';
  const rows = list.map(r => [
    r.biz_date, memberName(r.member_id), r.item_code,
    r.status === 1 ? '已完成' : (r.status === 2 ? '已撤销' : '未完成'),
    r.session_count, r.metric_value,
    r.note,
    r.source === 2 ? '补卡' : '当日',
    r.standard_snapshot,
  ].map(cell).join(','));
  return [head].concat(rows).join('\n');
}

// ---------- 自定义目标 ----------
// 兼容旧数据：早期目标只有单个 member_id，现在一个目标可分配给多名成员
function targetMemberIds(t) {
  if (Array.isArray(t.member_ids) && t.member_ids.length) return t.member_ids.slice();
  return t.member_id ? [t.member_id] : [];
}

function normalizeMemberIds(t) {
  const raw = Array.isArray(t.member_ids) ? t.member_ids : (t.member_id ? [t.member_id] : []);
  const valid = getFamily().members.map(m => m.id);
  const ids = [];
  raw.forEach(id => { if (valid.indexOf(id) >= 0 && ids.indexOf(id) < 0) ids.push(id); });
  return ids;
}

function getCustomTargets(memberId) {
  const all = read(KEYS.CUSTOM, []);
  return memberId
    ? getCustomTargetsAt(memberId, today())
    : all;
}

function targetAt(target, date) {
  const versions = Array.isArray(target.__history) ? target.__history : [];
  const active = versions.filter(v => v.effectiveFrom <= date).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return active.length ? Object.assign({}, active[active.length - 1].value) : target;
}
function getCustomTargetsAt(memberId, date) {
  return read(KEYS.CUSTOM, []).map(t => targetAt(t, date)).filter(t => t.status === 1
    && (!memberId || targetMemberIds(t).indexOf(memberId) >= 0)
    && (!t.start_date || t.start_date <= date) && (!t.end_date || t.end_date >= date));
}
function canEditTarget(target) {
  const id = require('./family.js').getIdentity();
  if (!id || id.status !== 'active' || id.role === 'admin') return true;
  return target.created_by ? target.created_by === id.uid : targetMemberIds(target).length === 1 && targetMemberIds(target)[0] === id.memberKey;
}
function createCustomTarget(t) {

  const all = read(KEYS.CUSTOM, []);
  const ids = normalizeMemberIds(t);
  const identity = require('./family.js').getIdentity();
  if (identity && identity.status === 'active' && identity.role !== 'admin' && (ids.length !== 1 || ids[0] !== identity.memberKey)) return { data: null, error: 'FORBIDDEN' };
  if (!ids.length) return { data: null, error: 'NO_MEMBER' };
  // 每位成员分别计算进行中目标数，都不能超过 10 个
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const count = all.filter(x => x.status === 1 && targetMemberIds(x).indexOf(id) >= 0).length;
    if (count >= 10) return { data: null, error: 'TARGET_LIMIT' };
  }
  // 同名目标不能与任一选中成员重叠
  const overlap = all.filter(x => x.status === 1 && x.name === t.name
    && targetMemberIds(x).some(id => ids.indexOf(id) >= 0));
  if (overlap.length) return { data: null, error: 'DUPLICATE_NAME' };
  if (!t.standard_note || !t.standard_note.trim()) return { data: null, error: 'EMPTY_STANDARD' };
  const target = Object.assign({
    target_id: uid('U'),
    created_by: identity && identity.uid || '',
    name: '',
    cycle_type: 'daily',   // daily | weekly | monthly | once
    cycle_value: 1,
    standard_note: '',
    count_mode: 0,          // 1 必修 / 0 选修
    start_date: today(),
    end_date: '',
    status: 1,              // 1 进行中 / 2 已归档
    created_at: new Date().toISOString(),
  }, t, {
    created_by: identity && identity.uid || '',
    member_ids: ids,
    member_id: ids[0],     // 兼容字段，供旧逻辑读取
  });
  all.push(target);
  const w = write(KEYS.CUSTOM, all);
  return w.error ? w : { data: target, error: null };
}

function updateCustomTarget(targetId, patch) {
  const all = read(KEYS.CUSTOM, []);
  const idx = all.findIndex(t => t.target_id === targetId);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  const prev = all[idx];
  if (!canEditTarget(prev)) return { data: null, error: 'FORBIDDEN' };
  const next = Object.assign({}, patch);
  delete next.__history; delete next.created_by; delete next.target_id; delete next.created_at;
  if (Array.isArray(next.member_ids)) {
    next.member_ids = normalizeMemberIds(next);
    if (!next.member_ids.length) return { data: null, error: 'NO_MEMBER' };
    const identity = require('./family.js').getIdentity();
    if (identity && identity.status === 'active' && identity.role !== 'admin' && (next.member_ids.length !== 1 || next.member_ids[0] !== identity.memberKey)) return { data: null, error: 'FORBIDDEN' };
    next.member_id = next.member_ids[0];
  }
  const snapshot = value => { const out = Object.assign({}, value); delete out.__history; return out; };
  const current = targetAt(prev, today());
  let effectiveFrom = D.addDays(today(), 1);
  if (current.cycle_type === 'weekly') effectiveFrom = D.addDays(D.weekStart(today()), 7);
  if (current.cycle_type === 'monthly') { const dt = D.parse(today()); effectiveFrom = D.fmt(new Date(dt.getFullYear(), dt.getMonth() + 1, 1)); }
  const history = (prev.__history || [{ effectiveFrom: '0000-01-01', value: snapshot(prev) }]).filter(v => v.effectiveFrom !== effectiveFrom);
  const updated = Object.assign({}, prev, next, { updated_at: new Date().toISOString() });
  history.push({ effectiveFrom, value: snapshot(updated) });
  all[idx] = Object.assign(updated, { __history: history });
  const result = write(KEYS.CUSTOM, all);
  return result.error ? result : { data: all[idx], error: null };
}

function archiveCustomTarget(targetId) {
  return updateCustomTarget(targetId, { status: 2 });
}

function getCustomTarget(targetId) {
  return read(KEYS.CUSTOM, []).find(t => t.target_id === targetId) || null;
}

// 自定义目标完成（保存 standard_snapshot）
function checkCustomTarget(targetId, memberId, date, done, reason) {
  const target = getCustomTargetsAt(memberId, date).find(t => t.target_id === targetId);
  if (!target) return { data: null, error: 'NOT_FOUND' };
  return saveRecord({
    member_id: memberId,
    item_code: targetId,     // U-xxx
    biz_date: date,
    status: done ? 1 : 2,
    target_id: targetId,
    standard_snapshot: target.standard_note,
    note: reason || '',
    source: canBackfill(date) && date !== today() ? 2 : 1,
  });
}

// ---------- 报表快照 ----------
function saveSnapshot(snapshot) {
  const list = read(KEYS.SNAPSHOTS, []);
  const key = snapshot.type + ':' + snapshot.key;
  const idx = list.findIndex(s => s.type + ':' + s.key === key);
  if (idx >= 0) list[idx] = snapshot; else list.push(snapshot);
  // 保留最近 36 期
  const trimmed = list.slice(-36);
  write(KEYS.SNAPSHOTS, trimmed);
  return { data: snapshot, error: null };
}
function getSnapshot(type, key) {
  return read(KEYS.SNAPSHOTS, []).find(s => s.type === type && s.key === key) || null;
}

// 清空所有数据（设置页使用）
function resetAll() { return require('./cloudstore.js').resetFamilyData(); }

module.exports = {
  KEYS, read, write, initFamily, getFamily, updateMemberName,
  getSchedule, setRequired, getTargets, setTarget, getSettings, setSettings,
  getRecords, saveRecord, revokeRecord, getRecord, getDayRecords, canBackfill, exportCSV,
  getCustomTargets, createCustomTarget, updateCustomTarget, archiveCustomTarget, getCustomTarget, checkCustomTarget,
  targetMemberIds, normalizeMemberIds, getCustomTargetsAt, canEditTarget,
  saveSnapshot, getSnapshot, resetAll,
};
