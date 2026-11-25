// 家庭身份与成员管理：直连云端表（无 RPC 函数，本平台未建且 DEFINER 函数被拦）。
// - gg_families：RLS 仅成员可查，创建由 created_by=auth.uid() 放行
// - gg_members ：无 RLS，靠 gg_members_guard 触发器收紧写入（首成员 active/admin，其余 pending/parent）
// - 家庭码 = family_id（fam_xxx），外人查不到 families 表，用外键自动校验码是否存在，不泄露家庭信息
// - 成员邀请链接：只分享 inv_xxx token（不含家庭码），7 天有效、可撤销、需 admin 批准，和访客只读 token 完全分开
// - 访客快照：token 随机不可猜 + 7 天有效 + 可撤销；表无 RLS 属已知风险（见设计文档第 14 节）
const { getCloud, ensureSession } = require('./cloud.js');

// 角色（权限）与身份（member_key，数据归属/代签对象）是两个独立概念：
// role 只有 admin / member 两种；member_key 可为 mama / papa / guoguo 或任意自定义。
// 旧数据 role=parent/child 一律按 member 兼容。
const ROLES = { ADMIN: 'admin', MEMBER: 'member' };
const ROLE_LABELS = { admin: '管理员', member: '成员', parent: '成员', child: '成员' };
function normalizeRole(role) { return role === ROLES.ADMIN ? ROLES.ADMIN : ROLES.MEMBER; }
function isAdmin(identity) {
  return !!(identity && identity.status === 'active' && normalizeRole(identity.role) === ROLES.ADMIN);
}
function requireAdminIdentity() {
  const id = getIdentity();
  if (!isAdmin(id)) throw new Error('只有管理员能执行此操作');
  return id;
}

const IDENTITY_KEY = 'gg_my_identity';   // 本地缓存的云端家庭身份（不参与云同步）
const INVITE_KEY = 'gg_invite_link';     // 本地缓存的成员邀请 token（不含家庭码，不参与云同步）

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
// 邀请/访客 token 是唯一的访问控制（表无 RLS），必须优先用密码学随机源。
// wx.getRandomValues 的基础库版本要求需以微信官方文档核实；不可用时降级，保证预览环境仍可用。
function secureRandom(len) {
  return new Promise(resolve => {
    try {
      if (typeof wx === 'undefined' || !wx || typeof wx.getRandomValues !== 'function') { resolve(null); return; }
      wx.getRandomValues({
        length: len,
        success: (res) => {
          try {
            const buf = res && res.randomValues;
            const bytes = buf instanceof ArrayBuffer ? Array.from(new Uint8Array(buf))
              : (Array.isArray(buf) ? buf : null);
            resolve(bytes && bytes.length === len ? bytes : null);
          } catch (e) { resolve(null); }
        },
        fail: () => resolve(null),
      });
    } catch (e) { resolve(null); }
  });
}
async function randomCode(len) {
  const bytes = await secureRandom(len);
  if (bytes) return bytes.map(b => CODE_CHARS[b % CODE_CHARS.length]).join('');
  // 降级：H5 预览 / 低版本基础库无密码学随机源时仍保证功能可用，但熵低于正式环境。
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}
async function generateFamilyId() {
  return 'fam_' + Date.now().toString(36) + (await randomCode(4)).toLowerCase();
}

function uidOf(session) {
  return session && session.user && session.user.id ? session.user.id : '';
}

// 从云端刷新我的家庭身份：只认 active 成员；返回 { familyId, memberKey, role, name, status, uid }
// 未登录 → null；已登录未入家庭 → { uid, status:'none' }（不落缓存）
async function refreshIdentity() {
  const session = await ensureSession();
  const uid = uidOf(session);
  // 离线/登录失败时保留最近一次 active 身份缓存：否则首页会把本机用户误判成访客，
  // 断网时连打卡都会被拒。真正换账号时由下面「查不到成员记录」的分支清缓存。
  if (!uid) return getIdentity() || null;
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_members')
    .select('family_id, member_key, role, name, status, uid')
    .eq('uid', uid)
    .eq('status', 'active');
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) { clearIdentity(); return { uid, status: 'none' }; }
  if (rows.length > 1) {
    clearIdentity();
    throw new Error('当前账号关联了多个家庭，请联系管理员处理后再继续');
  }
  const r = rows[0];
  const id = {
    familyId: r.family_id, memberKey: r.member_key, role: normalizeRole(r.role),
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
async function createFamily(name, memberKey, displayName) {
  const session = await ensureSession();
  const uid = uidOf(session);
  if (!uid) throw new Error('未登录，暂不能创建家庭（请用微信扫码打开小程序）');
  const identity = await refreshIdentity();
  if (identity && identity.status === 'active') throw new Error('当前账号已加入家庭，不能重复创建');
  const membership = await getMyMembership();
  if (membership && membership.status === 'pending') throw new Error('当前账号有待审批的家庭申请，暂不能创建家庭');
  const cloud = getCloud();
  const familyId = await generateFamilyId();
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
    name: displayName || '我', role: ROLES.ADMIN, status: 'active',
  });
  if (e2) throw e2;
  const id = { familyId, memberKey: mk, role: ROLES.ADMIN, name: displayName || '我', status: 'active', uid };
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
  const identity = await refreshIdentity();
  if (identity && identity.status === 'active') {
    throw new Error(identity.familyId === fid ? '你已经加入这个家庭' : '当前账号已加入其他家庭，不能再申请加入');
  }
  const membership = await getMyMembership();
  if (membership && membership.status === 'pending') {
    throw new Error(membership.family_id === fid ? '你已申请过这个家庭，等待创建人批准' : '当前账号已有待审批的家庭申请');
  }
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_members').insert({
    family_id: fid, uid,
    member_key: memberKey || 'papa',
    name: name || '家人',
    role: ROLES.MEMBER, status: 'pending',
  }).select('family_id, uid, status');
  if (error) throw new Error('家庭码无效，或你已申请过该家庭');
  if (!Array.isArray(data) || !data.some(row => row.uid === uid && row.family_id === fid && row.status === 'pending')) {
    throw new Error('加入申请未能保存，请重试');
  }
  return { familyId: fid, status: 'pending' };
}

// 列出本家庭成员（含 pending），供 admin 审批
async function listMembers() {
  const id = getIdentity();
  if (!id || !id.familyId) return [];
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_members')
    .select('family_id, member_key, name, role, status, uid, created_at')
    .eq('family_id', id.familyId);
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

// 批准成员：触发器校验「本家庭 active admin」才允许改 status
async function approveMember(targetUid) {
  const id = getIdentity();
  if (!id || id.role !== 'admin') throw new Error('只有管理员能批准成员');
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_members')
    .update({ status: 'active' })
    .eq('family_id', id.familyId)
    .eq('uid', targetUid)
    .eq('status', 'pending')
    .select('family_id, uid, status');
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(row => row.uid === targetUid && row.family_id === id.familyId && row.status === 'active')) {
    throw new Error('该申请已处理或不属于当前家庭，请刷新成员列表');
  }
  return true;
}

// ---------- 成员邀请链接（只传 inv_xxx token，不传家庭码） ----------
// 生成邀请：同家庭旧邀请自动失效（保证同时只有一个有效邀请，便于管理）
async function createInviteLink() {
  const id = getIdentity();
  if (!id || !id.familyId || id.role !== 'admin') throw new Error('只有管理员能生成邀请链接');
  const cloud = getCloud();
  // 家庭名：admin 是家庭成员，RLS 允许查自己的家庭；查不到就用默认名，不阻塞
  let familyName = '';
  try {
    const { data } = await cloud.database.from('gg_families')
      .select('name').eq('family_id', id.familyId);
    familyName = (Array.isArray(data) && data[0] && data[0].name) || '';
  } catch (e) {}
  const token = 'inv_' + Date.now().toString(36) + (await randomCode(20)).toLowerCase();
  const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
  const { error } = await cloud.database.from('gg_invite_tokens').insert({
    token, family_id: id.familyId, family_name: familyName || '果果家庭',
    created_by: id.uid || '', expires_at: expiresAt, revoked: false,
  });
  if (error) throw error;
  // Keep the current invite valid unless its replacement was inserted successfully.
  const { error: e0 } = await cloud.database.from('gg_invite_tokens')
    .update({ revoked: true })
    .eq('family_id', id.familyId)
    .eq('revoked', false)
    .neq('token', token);
  if (e0) {
    // 旧链接撤销失败时，不能把「新链接已生效 + 旧链接仍有效」的状态留在库里：
    // 先把刚插入的新 token 也作废，让本次生成整体失败，用户重试即可。
    await cloud.database.from('gg_invite_tokens').update({ revoked: true }).eq('token', token);
    throw e0;
  }
  try { wx.setStorageSync(INVITE_KEY, { token, expiresAt }); } catch (e) {}
  return { token, expiresAt, familyName: familyName || '果果家庭' };
}

// 解析邀请：接收方点卡片进来时调用，不要求登录；只返回展示用信息 + 内部加入用 familyId
// 注意：familyId 只留在页面内存里用于申请加入，绝不写回分享参数/URL
async function resolveInvite(token) {
  const t = String(token || '').trim();
  if (!/^inv_[0-9a-z]+$/.test(t)) return { valid: false, reason: '邀请链接格式不对' };
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_invite_tokens')
    .select('family_id, family_name, expires_at, revoked')
    .eq('token', t);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { valid: false, reason: '邀请链接不存在或已作废' };
  if (row.revoked) return { valid: false, reason: '邀请链接已失效，请联系创建人重新生成' };
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { valid: false, reason: '邀请链接已过期（7 天有效）' };
  // 若历史上旧邀请撤销失败，同家庭可能残留多条未撤销 token。数据层只承认最新一条，
  // 避免旧链接继续可用；不依赖客户端配合。
  const { data: siblings, error: siblingError } = await cloud.database.from('gg_invite_tokens')
    .select('token, created_at, id, revoked, expires_at')
    .eq('family_id', row.family_id);
  if (!siblingError && Array.isArray(siblings)) {
    const rank = r => r.created_at ? String(r.created_at)
      : (r.id !== undefined && r.id !== null ? String(r.id).padStart(20, '0') : '');
    const active = siblings.filter(r => !r.revoked)
      .sort((a, b) => rank(a).localeCompare(rank(b)) || siblings.indexOf(a) - siblings.indexOf(b));
    if (active.length && active[active.length - 1].token !== t) {
      return { valid: false, reason: '邀请链接已被新邀请替换，请联系创建人重新获取' };
    }
  }
  return { valid: true, familyId: row.family_id, familyName: row.family_name || '果果家庭' };
}

// 撤销邀请：限本家庭 admin，且只动本家庭 token
async function revokeInviteLink(token) {
  const id = getIdentity();
  if (!id || !id.familyId || id.role !== 'admin') throw new Error('只有管理员能撤销邀请链接');
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_invite_tokens')
    .update({ revoked: true })
    .eq('token', token)
    .eq('family_id', id.familyId)
    .select('token, family_id, revoked');
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(row => row.token === token && row.family_id === id.familyId && row.revoked)) {
    throw new Error('邀请链接不存在或不属于当前家庭');
  }
  try { wx.removeStorageSync(INVITE_KEY); } catch (e) {}
  return true;
}

function getCachedInvite() {
  try {
    const v = wx.getStorageSync(INVITE_KEY);
    return v && v.token ? v : null;
  } catch (e) { return null; }
}

// 生成访客链接：写入脱敏快照，返回 token + 到期时间（默认 7 天）
async function createVisitorLink(snapshot, days) {
  const id = getIdentity();
  if (!id || !id.familyId || id.role !== 'admin') throw new Error('只有管理员能生成访客链接');
  const token = 'vis_' + Date.now().toString(36) + (await randomCode(20)).toLowerCase();
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
  if (!id || !id.familyId || id.role !== 'admin') throw new Error('只有管理员能撤销访客链接');
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_visitor_snapshots')
    .update({ revoked: true })
    .eq('token', token)
    .eq('family_id', id.familyId)
    .select('token, family_id, revoked');
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(row => row.token === token && row.family_id === id.familyId && row.revoked)) {
    throw new Error('访客链接不存在或不属于当前家庭');
  }
  return true;
}

// 读取访客快照：校验有效期与撤销状态。访客无登录态，靠 token 随机不可猜
async function getVisitorSnapshot(token) {
  const t = String(token || '').trim();
  if (!/^vis_[0-9a-z]+$/.test(t)) return { valid: false, reason: '链接不存在' };
  const cloud = getCloud();
  const { data, error } = await cloud.database.from('gg_visitor_snapshots')
    .select('snapshot, expires_at, revoked')
    .eq('token', t);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : null;
  if (!row) return { valid: false, reason: '链接不存在' };
  if (row.revoked) return { valid: false, reason: '链接已撤销' };
  const expiresAt = new Date(row.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return { valid: false, reason: '链接已过期' };
  return { valid: true, snapshot: row.snapshot };
}

// ---------- 家庭设置：名称 / 显示名 / 角色 / 退出（角色与身份分离） ----------
async function getFamilyName() {
  const id = getIdentity();
  if (!id || !id.familyId) return '';
  const { data, error } = await getCloud().database.from('gg_families')
    .select('name').eq('family_id', id.familyId);
  if (error) throw error;
  return (Array.isArray(data) && data[0] && data[0].name) || '';
}

async function renameFamily(name) {
  const id = requireAdminIdentity();
  const value = String(name || '').trim().slice(0, 20);
  if (!value) throw new Error('家庭名称不能为空');
  const { data, error } = await getCloud().database.from('gg_families')
    .update({ name: value }).eq('family_id', id.familyId).select('family_id, name');
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(r => r.family_id === id.familyId && r.name === value)) {
    throw new Error('家庭名称保存失败，请确认你是管理员');
  }
  return value;
}

async function setMemberRole(targetUid, role) {
  const id = requireAdminIdentity();
  const next = normalizeRole(role);
  if (targetUid === id.uid && next === ROLES.MEMBER) {
    const rows = await listMembers();
    const admins = rows.filter(m => m.status === 'active' && normalizeRole(m.role) === ROLES.ADMIN);
    if (admins.length <= 1) throw new Error('至少保留一名管理员，请先把其他成员设为管理员');
  }
  const { data, error } = await getCloud().database.from('gg_members')
    .update({ role: next }).eq('family_id', id.familyId).eq('uid', targetUid)
    .select('uid, role');
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(r => r.uid === targetUid && r.role === next)) {
    throw new Error('角色保存失败，请刷新后重试');
  }
  if (targetUid === id.uid) saveIdentity(Object.assign({}, id, { role: next }));
  return next;
}

async function updateDisplayName(targetUid, name) {
  const id = getIdentity();
  const value = String(name || '').trim().slice(0, 12);
  if (!value) throw new Error('显示名不能为空');
  const self = !!(id && id.uid && targetUid === id.uid);
  if (!isAdmin(id) && !self) throw new Error('只有管理员能修改其他成员的显示名');
  const { data, error } = await getCloud().database.from('gg_members')
    .update({ name: value }).eq('family_id', id.familyId).eq('uid', targetUid)
    .select('uid, name');
  if (error) throw error;
  if (!Array.isArray(data) || !data.some(r => r.uid === targetUid && r.name === value)) {
    throw new Error('显示名保存失败，请刷新后重试');
  }
  if (self) saveIdentity(Object.assign({}, id, { name: value }));
  return value;
}

async function leaveFamily() {
  const id = getIdentity();
  if (!id || id.status !== 'active') throw new Error('当前不在家庭中');
  const cloud = getCloud();
  const rows = await listMembers();
  const others = rows.filter(m => m.status === 'active' && m.uid !== id.uid);
  const admins = rows.filter(m => m.status === 'active' && normalizeRole(m.role) === ROLES.ADMIN);
  // 最后一个管理员退出时，先把最早加入的 active 成员提升为管理员，避免家庭失管
  if (isAdmin(id) && admins.length <= 1 && others.length) {
    const heir = others.slice().sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))[0];
    const { error: promoteError } = await cloud.database.from('gg_members')
      .update({ role: ROLES.ADMIN }).eq('family_id', id.familyId).eq('uid', heir.uid)
      .select('uid, role');
    if (promoteError) throw promoteError;
  }
  // cloud database SDK 的 delete() 方法可用性需以云服务 SDK 官方文档核实并在真机验证。
  // gg_members_guard 触发器允许本人删除自己的成员行。
  const { error } = await cloud.database.from('gg_members')
    .delete().eq('family_id', id.familyId).eq('uid', id.uid);
  if (error) throw error;
  clearIdentity();
  return true;
}

module.exports = {
  getIdentity, saveIdentity, clearIdentity, refreshIdentity, getMyMembership,
  createFamily, requestJoin, listMembers, approveMember,
  createInviteLink, resolveInvite, revokeInviteLink, getCachedInvite,
  createVisitorLink, revokeVisitorLink, getVisitorSnapshot, randomCode, generateFamilyId,
  ROLES, ROLE_LABELS, normalizeRole, isAdmin,
  getFamilyName, renameFamily, setMemberRole, updateDisplayName, leaveFamily,
};
