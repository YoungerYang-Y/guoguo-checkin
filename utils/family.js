// 家庭身份与成员管理：直连云端表（无 RPC 函数，本平台未建且 DEFINER 函数被拦）。
// - gg_families：RLS 仅成员可查，创建由 created_by=auth.uid() 放行
// - gg_members ：无 RLS，靠 gg_members_guard 触发器收紧写入（首成员 active/admin，其余 pending/parent）
// - 家庭码 = family_id（fam_xxx），外人查不到 families 表，用外键自动校验码是否存在，不泄露家庭信息
// - 访客快照：token 随机不可猜 + 7 天有效 + 可撤销；表无 RLS 属已知风险（见设计文档第 14 节）
const { getCloud, ensureSession } = require('./cloud.js');

const IDENTITY_KEY = 'gg_my_identity';   // 本地缓存的云端家庭身份（不参与云同步）

function getIdentity() {
  try {
    const v = wx.getStorageSync(IDENTITY_KEY);
    return v && typeof v === 'object' ? v : null;
  } catch (e) { return null; }
}
function saveIdentity(id) {
  try { id ? wx.setStorageSync(IDENTITY_KEY, id) : wx.removeStorageSync(IDENTITY_KEY); } catch (e) {}
}
function clearIdentity() { saveIdentity(null); }

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
function generateFamilyId() {
  return 'fam_' + Date.now().toString(36) + randomCode(4).toLowerCase();
}

function uidOf(session) {
  return session && session.user && session.user.id ? session.user.id : '';
}

// 从云端刷新我的家庭身份：只认 active 成员；返回 { familyId, memberKey, role, name, status, uid }
// 未登录 → null；已登录未入家庭 → { uid, status:'none' }（不落缓存）
async function refreshIdentity() {
  const session = await ensureSession();
  const uid = uidOf(session);
  if (!uid) { clearIdentity(); return null; }
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_members')
    .select('family_id, member_key, role, name, status, uid')
    .eq('uid', uid)
    .eq('status', 'active');
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) { clearIdentity(); return { uid, status: 'none' }; }
  const r = rows[0];
  const id = {
    familyId: r.family_id, memberKey: r.member_key, role: r.role,
    name: r.name, status: 'active', uid,
  };
  saveIdentity(id);
  return id;
}

// 查我的成员记录（含 pending），用于家庭页展示申请状态
async function getMyMembership() {
  const session = await ensureSession();
  const uid = uidOf(session);
  if (!uid) return null;
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_members')
    .select('family_id, member_key, role, name, status, uid')
    .eq('uid', uid);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows[0] || null;
}

// 创建家庭：调用者成为 admin。memberKey 为家庭内标识（papa/mama）
async function createFamily(name, memberKey) {
  const session = await ensureSession();
  const uid = uidOf(session);
  if (!uid) throw new Error('未登录，暂不能创建家庭（请用微信扫码打开小程序）');
  const cloud = getCloud();
  const familyId = generateFamilyId();
  const mk = memberKey || 'mama';
  const { error: e1 } = await cloud.database.from('gg_families').insert({
    family_id: familyId,
    name: name || '果果家庭',
    invite_code: familyId,          // 家庭码 = family_id
    created_by: uid,
  });
  if (e1) throw e1;
  // 首成员由触发器强制 active/admin（传什么都覆盖，这里传一致值避免歧义）
  const { error: e2 } = await cloud.database.from('gg_members').insert({
    family_id: familyId, uid, member_key: mk,
    name: '我', role: 'admin', status: 'active',
  });
  if (e2) throw e2;
  const id = { familyId, memberKey: mk, role: 'admin', name: '我', status: 'active', uid };
  saveIdentity(id);
  return id;
}

// 申请加入家庭：以家庭码(fam_xxx)直插 pending 成员，触发器压成 pending/parent；外键校验家庭存在
async function requestJoin(familyCode, memberKey, name) {
  const session = await ensureSession();
  const uid = uidOf(session);
  if (!uid) throw new Error('未登录，暂不能加入家庭（请用微信扫码打开小程序）');
  const fid = String(familyCode || '').trim().toLowerCase();
  if (!/^fam_[0-9a-z]+$/.test(fid)) throw new Error('家庭码格式不对，应为 fam 开头');
  const cloud = getCloud();
  const { error } = await cloud.database.from('gg_members').insert({
    family_id: fid, uid,
    member_key: memberKey || 'papa',
    name: name || '家人',
    role: 'parent', status: 'pending',
  });
  if (error) throw new Error('家庭码无效，或你已申请过该家庭');
  return { familyId: fid, status: 'pending' };
}

// 列出本家庭成员（含 pending），供 admin 审批
async function listMembers() {
  const id = getIdentity();
  if (!id || !id.familyId) return [];
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_members')
    .select('family_id, member_key, name, role, status, uid')
    .eq('family_id', id.familyId);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// 批准成员：触发器校验「本家庭 active admin」才允许改 status
async function approveMember(targetUid) {
  const id = getIdentity();
  if (!id || id.role !== 'admin') throw new Error('只有管理员能批准成员');
  const cloud = getCloud();
  const { error } = await cloud.database.from('gg_members')
    .update({ status: 'active' })
    .eq('family_id', id.familyId)
    .eq('uid', targetUid);
  if (error) throw error;
  return true;
}

// 生成访客链接：写入脱敏快照，返回 token + 到期时间（默认 7 天）
async function createVisitorLink(snapshot, days) {
  const id = getIdentity();
  if (!id || !id.familyId || id.role !== 'admin') throw new Error('只有管理员能生成访客链接');
  const token = 'vis_' + Date.now().toString(36) + randomCode(20).toLowerCase();
  const expiresAt = new Date(Date.now() + (days || 7) * 86400000).toISOString();
  const cloud = getCloud();
  const { error } = await cloud.database.from('gg_visitor_snapshots').insert({
    token, family_id: id.familyId, snapshot: snapshot || {},
    expires_at: expiresAt, revoked: false,
  });
  if (error) throw error;
  return { token, expiresAt };
}

// 撤销访客链接
async function revokeVisitorLink(token) {
  const id = getIdentity();
  if (!id || id.role !== 'admin') throw new Error('只有管理员能撤销访客链接');
  const cloud = getCloud();
  const { error } = await cloud.database.from('gg_visitor_snapshots')
    .update({ revoked: true }).eq('token', token);
  if (error) throw error;
  return true;
}

// 读取访客快照：校验有效期与撤销状态。访客无登录态，靠 token 随机不可猜
async function getVisitorSnapshot(token) {
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_visitor_snapshots')
    .select('snapshot, expires_at, revoked')
    .eq('token', token);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { valid: false, reason: '链接不存在' };
  if (row.revoked) return { valid: false, reason: '链接已撤销' };
  if (new Date(row.expires_at).getTime() <= Date.now()) return { valid: false, reason: '链接已过期' };
  return { valid: true, snapshot: row.snapshot };
}

module.exports = {
  getIdentity, saveIdentity, clearIdentity, refreshIdentity, getMyMembership,
  createFamily, requestJoin, listMembers, approveMember,
  createVisitorLink, revokeVisitorLink, getVisitorSnapshot, randomCode, generateFamilyId,
};
