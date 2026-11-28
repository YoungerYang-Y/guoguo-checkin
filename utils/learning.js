// 学习体系引擎：统一内容库 + 按条到期排程 + 录入 + 日志 + 撤销 + 统计 + 权限守卫。
// 取代旧 review.js 的「按周批量复习」；三个存储键：gg_content / gg_progress / gg_study_logs。
// 所有写操作统一带 updated_at（snake_case），与 sync-merge.js 的合并口径一致。
const store = require('./store.js');
const seed = require('./content-seed.js');
const D = require('./date.js');
const family = require('./family.js');

const KEYS = {
  CONTENT: 'gg_content',
  PROGRESS: 'gg_progress',
  LOGS: 'gg_study_logs',
};

// 今日新学默认配额：诗词 1 条 + 英语 2 条；每类至少 1 条、不足按可用内容补齐。
const QUOTA = { poem: 1, english: 2 };

let _memoryContent = null; // 写入失败时的只读内存副本，保证启动不中断
// P1-2：seq 从落盘日志推导，不再用进程内计数器（重启/跨设备不会归零后误判）
function maxLogSeq(logs) { return (logs || []).reduce((m, x) => Math.max(m, Number(x && x.seq) || 0), 0); }

function now() { return new Date().toISOString(); }
function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function read(key) { return store.read(key, []); }
function write(key, rows) { return store.write(key, rows); }
function isLive(x) { return !!(x && x.status !== 0 && !x.deleted_at); }
// N2：搜索字段统一归一化——数组 join、字符串原样、其他转空串，避免异常 meta.clues 崩溃。
function toText(v) {
  if (Array.isArray(v)) return v.join(' ');
  if (typeof v === 'string') return v;
  if (v === null || v === undefined) return '';
  return String(v);
}
function intervalsOf(type) { return (seed.TYPES[type] || seed.TYPES.poem).intervals.slice(); }
function tagOf(c) {
  const m = c.meta || {};
  return m.tag || (m.tags && m.tags[0]) || (c.type === 'poem' ? '诗词' : '英语');
}

// ---------- 权限三档（R2：本机默认家庭可用，仅访客只读） ----------
function currentIdentity() {
  try { return family.getIdentity(); } catch (e) { return null; }
}
// 只读档：无 active 身份且曾加入/已加入家庭（adopted 非空）= 访客或已退出
function isReadOnly() {
  const id = currentIdentity();
  const adopted = store.read('gg_family_adopted', '');
  return !(id && id.status === 'active') && !!adopted;
}
// 记录档：active 成员（含爸爸代签）或本机默认家庭
function canRecord() { return !isReadOnly(); }
// 管理档：复用 store.canManage 既有回退（active+creator/admin，或无身份且未 adopt）
function canManageContent() { return !!store.canManage(); }

// ---------- 内容库 ----------
// 首次启动把 70 条内置内容 upsert 进 gg_content；只在 id 不存在时写入，绝不覆盖用户编辑；
// 已软删的内置 id 跳过（不复活）；每条带 ISO updated_at；失败降级内存副本，不阻断启动。
function ensureSeeded() {
  try {
    const list = read(KEYS.CONTENT).slice();
    const ids = {};
    list.forEach(x => { ids[x.id] = true; });
    let added = 0;
    seed.BUILTIN.forEach(entry => {
      if (ids[entry.id]) return;
      const t = now();
      const row = Object.assign({}, entry, { created_at: t, updated_at: t });
      list.push(row);
      ids[entry.id] = true;
      added++;
    });
    _memoryContent = list.slice();
    if (added) {
      const w = write(KEYS.CONTENT, list);
      if (w && w.error) return { data: { added: 0, total: list.length, memoryOnly: true }, error: 'READONLY_MEMORY' };
    }
    return { data: { added, total: list.length }, error: null };
  } catch (e) {
    _memoryContent = seed.BUILTIN.map(x => Object.assign({}, x, { updated_at: now() }));
    return { data: { added: 0, total: _memoryContent.length, memoryOnly: true }, error: 'READONLY_MEMORY' };
  }
}

function _contentList() {
  const list = read(KEYS.CONTENT);
  return list && list.length ? list : (_memoryContent || []);
}
// P0-1：默认只返回 live 内容；includeDeleted 仅供明确的库内编辑场景使用。
function contentById(id, includeDeleted) {
  const hit = _contentList().find(x => x.id === id);
  return hit && (includeDeleted || isLive(hit)) ? hit : null;
}

// 库列表：过滤 status=0 / deleted_at，附 progress 摘要，支持 type / keyword / tag 过滤。
function library(opts) {
  const o = opts || {};
  const progresses = read(KEYS.PROGRESS);
  const pmap = {};
  // N1：已撤销（软删）的进度不参与库列表状态展示
  progresses.filter(isLive).forEach(p => { pmap[p.contentId] = p; });
  const q = seed.norm(o.keyword);
  const out = [];
  _contentList().filter(isLive).forEach(x => {
    if (o.type && x.type !== o.type) return;
    if (o.tag && tagOf(x) !== o.tag && ((x.meta && x.meta.tags) || []).indexOf(o.tag) < 0) return;
    if (q) {
      const m = x.meta || {};
      // P1-1：补齐英语对话/换场景/回忆提示与诗词线索/讲解/提问/背景，与 content-seed.search 对齐
      const hay = seed.norm([
        x.primary, x.secondary, x.body,
        m.title, m.tag, toText(m.tags),
        m.reply, m.alt, m.prompt, m.scene,
        toText(m.clues), m.explain, m.highlight,
        m.question, m.background,
      ].join(' '));
      if (hay.indexOf(q) < 0) return;
    }
    const p = pmap[x.id];
    out.push(Object.assign({}, x, {
      firstLine: seed.firstLine(x.body),
      label: x.primary,
      state: p ? p.status : '',
      stage: p ? p.stage : 0,
      nextReviewAt: p ? p.nextReviewAt : '',
      progress: p ? {
        stage: p.stage, status: p.status, nextReviewAt: p.nextReviewAt,
        failCount: p.failCount || 0,
      } : null,
    }));
  });
  return out;
}

function upsertContent(entry) {
  if (!canManageContent()) return { data: null, error: 'FORBIDDEN' };
  const e = entry || {};
  const primary = String(e.primary || '').trim();
  if (!primary) return { data: null, error: 'EMPTY' };
  const type = e.type === 'english' ? 'english' : 'poem';
  const t = now();
  const list = read(KEYS.CONTENT).slice();
  let row;
  if (e.id) {
    const idx = list.findIndex(x => x.id === e.id);
    if (idx < 0) return { data: null, error: 'NOT_FOUND' };
    // 内置内容编辑保留 origin:'builtin'（Object.assign 保留原字段）
    row = Object.assign({}, list[idx], {
      type, primary, secondary: String(e.secondary || ''), body: String(e.body || ''),
      meta: Object.assign({}, list[idx].meta || {}, e.meta || {}),
      updated_at: t,
    });
    list[idx] = row;
  } else {
    const tag = e.meta && e.meta.tag ? e.meta.tag : (type === 'poem' ? '诗词' : '英语');
    row = {
      id: 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type, primary, secondary: String(e.secondary || ''), body: String(e.body || ''),
      meta: Object.assign({ tags: [tag] }, e.meta || {}),
      origin: 'custom', status: 1, created_at: t, updated_at: t,
    };
    list.push(row);
  }
  const w = write(KEYS.CONTENT, list);
  return w && w.error ? w : { data: row, error: null };
}

// 软删：deleted_at + status=0，保留进度；同步层不会让一台设备的删除被另一台救活。
function removeContent(id) {
  if (!canManageContent()) return { data: null, error: 'FORBIDDEN' };
  const list = read(KEYS.CONTENT).slice();
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  const t = now();
  list[idx] = Object.assign({}, list[idx], { status: 0, deleted_at: t, updated_at: t });
  const w = write(KEYS.CONTENT, list);
  return w && w.error ? w : { data: null, error: null };
}

// N7：软删内容列表（管理档恢复用）+ 恢复入口
function libraryDeleted() {
  return _contentList().filter(x => !isLive(x)).map(x => Object.assign({}, x, {
    firstLine: seed.firstLine(x.body), label: x.primary,
  }));
}
function restoreContent(id) {
  if (!canManageContent()) return { data: null, error: 'FORBIDDEN' };
  const list = read(KEYS.CONTENT).slice();
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  const t = now();
  const row = Object.assign({}, list[idx], { status: 1, updated_at: t });
  delete row.deleted_at;
  list[idx] = row;
  const w = write(KEYS.CONTENT, list);
  return w && w.error ? w : { data: Object.assign({}, row), error: null };
}

// ---------- 进度与排程 ----------
function progressSnapshot(p) {
  if (!p) return null;
  return {
    stage: p.stage, status: p.status, nextReviewAt: p.nextReviewAt,
    failCount: p.failCount || 0, intervals: (p.intervals || []).slice(),
  };
}
function newProgress(contentId, type, nextReviewAt, t) {
  return {
    id: uid('prog'), contentId, type,
    stage: 0, status: 'learning', nextReviewAt,
    failCount: 0, intervals: intervalsOf(type),
    firstLearnedAt: D.today(),
    created_at: t, updated_at: t,
  };
}
// 表现推进：pass 进档（到顶 mastered），fuzzy 明天且档位不变，fail 回档并累积 failCount。
function applyResult(p, result, d, t) {
  // P1-4：已掌握内容再点通过不再加档，避免 stage 虚高；模糊/没记住仍允许重新进入复习。
  if (p.status === 'mastered' && result === 'pass') { p.updated_at = t; return p; }
  const intervals = (p.intervals && p.intervals.length) ? p.intervals : intervalsOf(p.type);
  if (result === 'fuzzy') {
    p.status = 'learning';
    p.nextReviewAt = D.addDays(d, 1);
  } else if (result === 'fail') {
    p.stage = 0;
    p.failCount = (p.failCount || 0) + 1;
    p.status = 'learning';
    p.nextReviewAt = D.addDays(d, 1);
  } else {
    p.stage = (p.stage || 0) + 1;
    if (p.stage >= intervals.length) {
      p.status = 'mastered';
      p.nextReviewAt = '';
    } else {
      p.status = 'learning';
      p.nextReviewAt = D.addDays(d, intervals[p.stage]);
    }
  }
  p.updated_at = t;
  return p;
}

// 录入：ids 为库中已有 id；temp 为临时条目数组（[{type,primary,secondary,body,meta}]）。
// addToLibrary=true（默认）时临时条目先写入 gg_content，再与 ids 一起更新进度与日志。
function record(input) {
  if (!canRecord()) return { data: null, error: 'FORBIDDEN' };
  const o = input || {};
  const ids = Array.isArray(o.ids) ? o.ids.slice() : [];
  const temps = Array.isArray(o.temp) ? o.temp : [];
  const kind = o.kind === 'review' ? 'review' : 'learn';
  const result = ['pass', 'fuzzy', 'fail'].indexOf(o.result) >= 0 ? o.result : 'pass';
  const addToLibrary = o.addToLibrary !== false;
  const t = now();
  const d = D.today();
  const contents = read(KEYS.CONTENT).slice();
  const progresses = read(KEYS.PROGRESS).slice();
  const logs = read(KEYS.LOGS).slice();
  const targets = [];

  ids.forEach(id => {
    // P0-1：只认 live 内容，软删 id 不再被 contentById 兜底复活
    const c = contents.find(x => x.id === id && isLive(x));
    if (c) targets.push({ id: id, type: c.type, label: c.primary });
  });
  temps.forEach(tc => {
    const e = tc || {};
    const primary = String(e.primary || '').trim();
    if (!primary) return;
    const type = e.type === 'english' ? 'english' : 'poem';
    const tag = e.meta && e.meta.tag ? e.meta.tag : (type === 'poem' ? '诗词' : '临时录入');
    const row = {
      id: 'custom_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '_' + targets.length,
      type: type, primary: primary, secondary: String(e.secondary || ''), body: String(e.body || ''),
      meta: Object.assign({ tags: [tag] }, e.meta || {}),
      origin: 'temp', status: 1, created_at: t, updated_at: t,
    };
    // N3：关闭补库时不建进度，只记日志；日志自带 label/type，避免孤儿进度
    targets.push({ id: row.id, type: type, label: primary, row: row, logOnly: !addToLibrary });
    if (addToLibrary) contents.push(row);
  });
  if (!targets.length) return { data: null, error: ids.length && !temps.length ? 'NOT_FOUND' : 'EMPTY' };

  const written = [];
  // N5：seq 高位为当前毫秒时间戳，低位递增——跨设备不会都从 1 开始
  let seq = Math.max(maxLogSeq(logs), Date.now() * 1000);
  targets.forEach(target => {
    // N1：不复用已撤销（软删）的进度；N3：logOnly 目标不建/不更新进度
    let p = target.logOnly ? null : progresses.find(x => x.contentId === target.id && isLive(x));
    const before = progressSnapshot(p);
    if (!target.logOnly) {
      if (!p) {
        p = newProgress(target.id, target.type, D.addDays(d, intervalsOf(target.type)[0]), t);
        progresses.push(p);
        // 首次学习按 pass 再推进一档：从库选 E01 标记通过 → 下次复习日 = 今天 + intervals[1]
        applyResult(p, result, d, t);
      } else {
        applyResult(p, result, d, t);
      }
    }
    const log = {
      id: uid('log'), seq: (seq += 1), contentId: target.id, progressId: p ? p.id : '',
      label: target.label, type: target.type, // N3：日志自带展示信息
      kind: kind, result: result, note: String(o.note || ''),
      operator: String(o.operator || ''), at: t, updated_at: t, status: 1,
      before: before, addToLibrary: !!addToLibrary,
    };
    logs.push(log);
    written.push({ contentId: target.id, progress: Object.assign({}, p), log: Object.assign({}, log) });
  });

  const wc = write(KEYS.CONTENT, contents);
  const wp = write(KEYS.PROGRESS, progresses);
  const wl = write(KEYS.LOGS, logs);
  const err = (wc && wc.error) || (wp && wp.error) || (wl && wl.error);
  if (err) return { data: null, error: err };
  return { data: written, error: null };
}

// 重新学习：mastered 条目拉回学习态，stage=0、status='learning'、下一次为 intervals[0]。
function restartContent(id) {
  if (!canRecord()) return { data: null, error: 'FORBIDDEN' };
  const c = contentById(id);
  if (!c || !isLive(c)) return { data: null, error: 'NOT_FOUND' };
  const t = now();
  const progresses = read(KEYS.PROGRESS).slice();
  const logs = read(KEYS.LOGS).slice();
  // N1：不复用已撤销（软删）的进度
  let p = progresses.find(x => x.contentId === id && isLive(x));
  const before = progressSnapshot(p);
  if (!p) {
    p = newProgress(id, c.type, D.addDays(D.today(), intervalsOf(c.type)[0]), t);
    progresses.push(p);
  } else {
    p.stage = 0;
    p.status = 'learning';
    p.failCount = 0;
    p.nextReviewAt = D.addDays(D.today(), intervalsOf(c.type)[0]);
    p.updated_at = t;
  }
  logs.push({
    id: uid('log'), seq: Math.max(maxLogSeq(logs) + 1, Date.now() * 1000 + 1), contentId: id, progressId: p.id,
    kind: 'learn', result: 'pass', note: '重新学习', operator: '',
    at: t, updated_at: t, status: 1, before: before, addToLibrary: false,
  });
  const wp = write(KEYS.PROGRESS, progresses);
  const wl = write(KEYS.LOGS, logs);
  const err = (wp && wp.error) || (wl && wl.error);
  if (err) return { data: null, error: err };
  return { data: Object.assign({}, p), error: null };
}

// 日志三元组比较：同毫秒时用 (at, updated_at, id) 判定先后（R6）。
function laterLog(a, b) {
  // N5：seq 改为数值比较，避免字典序误判；时间戳高位保证跨设备可判定先后
  const ka = [String(a.at || ''), String(a.updated_at || ''), Number(a.seq) || 0, String(a.id || '')];
  const kb = [String(b.at || ''), String(b.updated_at || ''), Number(b.seq) || 0, String(b.id || '')];
  for (let i = 0; i < 3; i++) {
    if (ka[i] > kb[i]) return true;
    if (ka[i] < kb[i]) return false;
  }
  return false;
}
// 撤销：先标日志 status=2 + undone_at；仅目标日志是最新有效日志时按 before 回退，
// 陈旧日志返回 STALE_LOG 且不动进度（P0-2 + R6）。before=null 表示此前没有进度，回退即删除进度。
function undoLog(logId) {
  if (!canRecord()) return { data: null, error: 'FORBIDDEN' };
  const logs = read(KEYS.LOGS).slice();
  const idx = logs.findIndex(x => x.id === logId);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  const log = logs[idx];
  if (log.status === 2) return { data: null, error: 'ALREADY_UNDONE' };
  // P1-3：先判定 newer，再按「进度优先」落盘；进度写失败时日志保持有效，可安全重试。
  const newer = logs.some(x => x.status === 1 && x.id !== logId && x.progressId === log.progressId && laterLog(x, log));
  const t = now();
  const nextLogs = logs.slice();
  nextLogs[idx] = Object.assign({}, log, { status: 2, undone_at: t, updated_at: t });

  if (newer) {
    // 陈旧日志仍按既有约定标记撤销，但不碰进度
    const wl = write(KEYS.LOGS, nextLogs);
    if (wl && wl.error) return { data: null, error: wl.error };
    return { data: null, error: 'STALE_LOG' };
  }

  const progresses = read(KEYS.PROGRESS).slice();
  // N3：纯日志型（关闭补库的临时记录）没有进度，撤销只标日志、不碰进度
  if (!log.progressId) {
    const wl0 = write(KEYS.LOGS, nextLogs);
    if (wl0 && wl0.error) return { data: null, error: wl0.error };
    return { data: contentById(log.contentId), error: null };
  }
  const pidx = progresses.findIndex(p => p.id === log.progressId && isLive(p));
  if (pidx < 0) return { data: null, error: 'STALE_LOG' };
  if (!log.before) {
    // N1：软标记删除——物理 splice 会在跨设备合并时被另一侧旧进度救活
    progresses[pidx] = Object.assign({}, progresses[pidx], { deleted_at: t, updated_at: t });
  } else {
    progresses[pidx] = Object.assign({}, progresses[pidx], log.before, { deleted_at: '', updated_at: t });
  }
  const wp = write(KEYS.PROGRESS, progresses);
  if (wp && wp.error) return { data: null, error: wp.error };
  const wl = write(KEYS.LOGS, nextLogs);
  if (wl && wl.error) return { data: null, error: wl.error };
  return { data: contentById(log.contentId), error: null };
}

// ---------- 今日计划与统计 ----------
// P0-2：按内置内容在种子里的路线顺序取（诗词 立春→…、英语 E01→E50），
// 自定义/临时录入排在后面（created_at 升序 + id 兜底）。不按日期伪随机轮转。
const BUILTIN_RANK = {};
seed.BUILTIN.forEach((x, i) => { BUILTIN_RANK[x.id] = i; });
function pickLearn(pool, quota) {
  if (!pool.length) return [];
  const ordered = pool.slice().sort((a, b) => {
    const ra = BUILTIN_RANK[a.id], rb = BUILTIN_RANK[b.id];
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.id).localeCompare(String(b.id));
  });
  return ordered.slice(0, Math.max(1, Math.min(quota, ordered.length)));
}

function todayPlan() {
  const d = D.today();
  const contents = library().filter(x => x.type === 'poem' || x.type === 'english');
  const progresses = read(KEYS.PROGRESS).filter(isLive);
  const pmap = {};
  progresses.forEach(p => { pmap[p.contentId] = p; });

  // 今日复习：到期 + 逾期，按逾期天数降序 → failCount 降序 → type → nextReviewAt → id。
  const review = progresses.filter(p =>
    p.status !== 'mastered' && p.nextReviewAt && p.nextReviewAt <= d && contents.some(c => c.id === p.contentId)
  ).map(p => {
    const c = contents.find(x => x.id === p.contentId);
    return Object.assign({}, c, {
      progressId: p.id, stage: p.stage, failCount: p.failCount || 0,
      overdueDays: D.diffDays(p.nextReviewAt, d),
      label: c.primary,
    });
  }).sort((a, b) =>
    (b.overdueDays - a.overdueDays) ||
    ((b.failCount || 0) - (a.failCount || 0)) ||
    String(a.type).localeCompare(String(b.type)) ||
    String(a.nextReviewAt).localeCompare(String(b.nextReviewAt)) ||
    String(a.id).localeCompare(String(b.id))
  );

  // 今日新学：库中无有效进度的条目，按类型配额选取。
  const learn = [];
  Object.keys(QUOTA).forEach(type => {
    const pool = contents.filter(c => c.type === type && !pmap[c.id]);
    pickLearn(pool, QUOTA[type]).forEach(c => {
      learn.push(Object.assign({}, c, { quotaType: type, label: c.primary }));
    });
  });

  return {
    date: d,
    learn: learn,
    review: review,
    stats: {
      poemLearn: learn.filter(x => x.type === 'poem').length,
      englishLearn: learn.filter(x => x.type === 'english').length,
      due: review.length,
    },
  };
}

// P2-4：ISO UTC 时间转本地业务日期，避免凌晨/跨时区记录归错天
function localDateOf(isoStr) {
  const s = String(isoStr || '');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  try { return D.fmt(new Date(s)); } catch (e) { return s.slice(0, 10); }
}
function logsByDate(date) {
  const d = date || D.today();
  return read(KEYS.LOGS).filter(x => isLive(x) && localDateOf(x.at) === d)
    .map(x => {
      const c = contentById(x.contentId);
      return Object.assign({}, x, {
        // N3：不入库的临时记录从日志自身取 label/type，不再显示原始 id
        label: (c && (c.primary || c.title)) || x.label || x.contentId,
        type: (c && c.type) || x.type || '',
        resultLabel: x.result === 'pass' ? '通过' : (x.result === 'fuzzy' ? '模糊' : '没记住'),
        kindLabel: x.kind === 'review' ? '复习' : '新学',
      });
    })
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

function overview() {
  const progresses = read(KEYS.PROGRESS).filter(isLive);
  const d = D.today();
  const contents = library();
  return {
    total: progresses.length,
    learning: progresses.filter(p => p.status === 'learning').length,
    mastered: progresses.filter(p => p.status === 'mastered').length,
    // N8：与 todayPlan().review 同口径——排除软删内容对应的进度
    due: progresses.filter(p => p.status !== 'mastered' && p.nextReviewAt && p.nextReviewAt <= d && contents.some(c => c.id === p.contentId)).length,
    todayLogs: logsByDate(d).length,
    library: {
      poem: contents.filter(c => c.type === 'poem').length,
      english: contents.filter(c => c.type === 'english').length,
    },
  };
}

module.exports = {
  KEYS, QUOTA, ensureSeeded, contentById, library, libraryDeleted, upsertContent, removeContent, restoreContent,
  record, restartContent, undoLog, todayPlan, logsByDate, overview,
  canRecord, canManageContent, isReadOnly, intervalsOf,
};
