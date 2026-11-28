// 一次性迁移：旧 gg_poems / gg_words → 新内容库 + 进度 + 日志。
// 旧键不删除，供回滚；迁移标记写在 gg_settings.learningMigratedV1。
const store = require('./store.js');
const seed = require('./content-seed.js');
const D = require('./date.js');
const learning = require('./learning.js');

const MARK = 'learningMigratedV1';
const KEYS = {
  CONTENT: 'gg_content',
  PROGRESS: 'gg_progress',
  LOGS: 'gg_study_logs',
  SETTINGS: 'gg_settings',
};

function now() { return new Date().toISOString(); }
function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function read(key, fallback) { return store.read(key, fallback === undefined ? [] : fallback); }
function write(key, value) { return store.write(key, value); }
function settings() { return read(KEYS.SETTINGS, {}) || {}; }
// P1-5：迁移条目用确定性 id，重跑时按 id 去重，避免 MARK 写失败后重复建进度。
function pushUnique(list, row) {
  if (list.some(x => x.id === row.id)) return false;
  list.push(row);
  return true;
}

// week key（如 2026-W48）→ 该周周一 YYYY-MM-DD；失败返回 null，不编造。
function weekToDate(week) {
  const s = String(week || '');
  const m = /^(\d{4})-W(\d{1,2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]), w = Number(m[2]);
  if (w < 1 || w > 53) return null;
  try {
    const jan4 = year + '-01-04';
    const monday = D.weekStart(jan4);
    return D.addDays(monday, (w - 1) * 7);
  } catch (e) { return null; }
}
function firstDateOf(item) {
  return weekToDate(item.week) ||
    (String(item.created_at || '').slice(0, 10).match(/^\d{4}-\d{2}-\d{2}$/) ? String(item.created_at).slice(0, 10) : null) ||
    D.today();
}

function migrate() {
  const st = settings();
  if (st[MARK]) return { data: { skipped: true }, error: null };

  const t = now();
  const d = D.today();
  const contents = read(KEYS.CONTENT).slice();
  const progresses = read(KEYS.PROGRESS).slice();
  const logs = read(KEYS.LOGS).slice();
  const known = {};
  contents.forEach(c => { known[c.id] = true; });
  const stats = { poem: 0, word: 0, review: 0, reused: 0 };

  const migratePoem = item => {
    if (!item || item.status !== 1) return;
    const title = String(item.title || '').trim();
    if (!title) return;
    // 优先匹配内置 20 首（含「宿新市徐公店」vs「宿新市徐公店（其二）」差异）
    const hit = seed.findPoem(title, item.author);
    let contentId;
    if (hit && known['poem_' + hit.id]) {
      contentId = 'poem_' + hit.id;
      stats.reused++;
    } else {
      const poemId = 'custom_poem_' + String(item.id || uid('m')).replace(/[^a-zA-Z0-9]/g, '');
      contentId = poemId;
      if (!known[contentId]) {
        contents.push({
          id: contentId, type: 'poem', primary: title, secondary: String(item.author || ''),
          body: String(item.content || ''),
          meta: { tags: ['诗词'], source: '旧数据迁移' },
          origin: 'legacy', status: 1, created_at: t, updated_at: t,
        });
        known[contentId] = true;
      }
      stats.poem++;
    }
    const first = firstDateOf(item);
    const pid = 'mig_' + contentId;
    let p = progresses.find(x => x.id === pid || x.contentId === contentId);
    if (!p) {
      p = {
        id: pid, contentId: contentId, type: 'poem',
        stage: 0, status: 'learning',
        nextReviewAt: item.inReviewBank ? d : D.addDays(first, seed.TYPES.poem.intervals[0]),
        failCount: 0, intervals: seed.TYPES.poem.intervals.slice(),
        firstLearnedAt: first, created_at: t, updated_at: t,
      };
      progresses.push(p);
    }
    const reviews = item.reviews || {};
    Object.keys(reviews).forEach(week => {
      const rv = reviews[week];
      if (!rv) return;
      const at = String(rv.at || t);
      if (pushUnique(logs, {
        id: 'miglog_' + contentId + '_' + week, contentId: contentId, progressId: p.id,
        kind: 'review', result: rv.ok ? 'pass' : 'fail',
        note: '旧复习记录迁移', operator: '', at: at, updated_at: at, status: 1,
        before: null, week: week, addToLibrary: false,
      })) stats.review++;
    });
  };

  const migrateWord = item => {
    if (!item || item.status !== 1) return;
    const text = String(item.text || '').trim();
    if (!text) return;
    const contentId = 'custom_en_' + String(item.id || uid('m')).replace(/[^a-zA-Z0-9]/g, '');
    if (!known[contentId]) {
      contents.push({
        id: contentId, type: 'english', primary: text, secondary: '', body: '',
        meta: { tag: '旧单词句子', tags: ['旧单词句子'] },
        origin: 'legacy', status: 1, created_at: t, updated_at: t,
      });
      known[contentId] = true;
    }
    stats.word++;
    const first = firstDateOf(item);
    const pid = 'mig_' + contentId;
    let p = progresses.find(x => x.id === pid || x.contentId === contentId);
    if (!p) {
      p = {
        id: pid, contentId: contentId, type: 'english',
        stage: 0, status: 'learning',
        nextReviewAt: item.inReviewBank ? d : D.addDays(first, seed.TYPES.english.intervals[0]),
        failCount: 0, intervals: seed.TYPES.english.intervals.slice(),
        firstLearnedAt: first, created_at: t, updated_at: t,
      };
      progresses.push(p);
    }
    const reviews = item.reviews || {};
    Object.keys(reviews).forEach(week => {
      const rv = reviews[week];
      if (!rv) return;
      const at = String(rv.at || t);
      if (pushUnique(logs, {
        id: 'miglog_' + contentId + '_' + week, contentId: contentId, progressId: p.id,
        kind: 'review', result: rv.ok ? 'pass' : 'fail',
        note: '旧复习记录迁移', operator: '', at: at, updated_at: at, status: 1,
        before: null, week: week, addToLibrary: false,
      })) stats.review++;
    });
  };

  (read('gg_poems', []) || []).forEach(migratePoem);
  (read('gg_words', []) || []).forEach(migrateWord);

  const wc = write(KEYS.CONTENT, contents);
  const wp = write(KEYS.PROGRESS, progresses);
  const wl = write(KEYS.LOGS, logs);
  if ((wc && wc.error) || (wp && wp.error) || (wl && wl.error)) {
    return { data: null, error: 'MIGRATE_WRITE_FAILED' };
  }
  const next = Object.assign({}, st, { [MARK]: t });
  const ws = write(KEYS.SETTINGS, next);
  if (ws && ws.error) return { data: stats, error: ws.error };
  return { data: stats, error: null };
}

module.exports = { migrate, weekToDate, MARK };
