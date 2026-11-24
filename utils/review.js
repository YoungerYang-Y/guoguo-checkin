// 通用每周复习引擎：古诗 / 单词句子共用。
// 规则：每周复习「近 5 周（含本周）录入的条目」+「复习库中所有条目」；
// 标记「不能完整背诵」自动进复习库，之后每周继续出现，直到标记通过。
const store = require('./store.js');
const D = require('./date.js');

const MODULES = {
  poem: { key: 'gg_poems', label: '古诗' },
  word: { key: 'gg_words', label: '单词句子' },
};
const REVIEW_WEEKS = 5;

function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function cfg(module) { return MODULES[module] || MODULES.poem; }
function currentWeek() { return D.periodKey('week', D.today()); }

// 从本周往前按 7 天取样，去重得到最近 n 个周标识（兼容跨年周）
function recentWeeks(n) {
  const out = [];
  let d = D.today();
  for (let i = 0; i < n * 3 && out.length < n; i++) {
    const k = D.periodKey('week', d);
    if (out.indexOf(k) < 0) out.push(k);
    d = D.addDays(d, -7);
  }
  return out;
}

function weekOptions(n) {
  return recentWeeks(n || 8).map(k => ({ key: k, label: D.periodLabel('week', k) }));
}

function readAll(module) { return store.read(cfg(module).key, []); }
function writeAll(module, list) { return store.write(cfg(module).key, list); }
function active(module) { return readAll(module).filter(x => x.status === 1); }

function itemLabel(module, x) {
  return module === 'poem' ? (x.title + ' · ' + (x.author || '佚名')) : x.text;
}

function add(module, entry) {
  const m = cfg(module);
  const e = entry || {};
  const text = m.key === 'gg_poems' ? String(e.title || '').trim() : String(e.text || '').trim();
  if (!text) return { data: null, error: 'EMPTY' };
  const week = e.week || currentWeek();
  const list = readAll(module);
  const probe = m.key === 'gg_poems' ? { title: text, author: e.author } : { text };
  const dup = list.some(x => x.status === 1 && x.week === week && itemLabel(module, x) === itemLabel(module, probe));
  if (dup) return { data: null, error: 'DUPLICATE' };
  const item = Object.assign({}, e, {
    id: uid('r'), week, status: 1,
    reviews: {}, inReviewBank: false, masteredAt: '',
    created_at: new Date().toISOString(),
  });
  if (m.key === 'gg_poems') item.title = text;
  else item.text = text;
  list.push(item);
  const w = writeAll(module, list);
  return w.error ? w : { data: item, error: null };
}

function addBatch(module, entries) {
  const out = { added: 0, skipped: 0 };
  (entries || []).forEach(e => {
    const r = add(module, e);
    if (r.error) out.skipped++; else out.added++;
  });
  return out;
}

function remove(module, id) {
  const list = readAll(module);
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  list[idx].status = 2;
  const w = writeAll(module, list);
  return w.error ? w : { data: null, error: null };
}

function decorate(module, x, week) {
  const rv = (x.reviews || {})[week] || null;
  const reviews = x.reviews || {};
  return Object.assign({}, x, {
    label: itemLabel(module, x),
    originLabel: D.periodLabel('week', x.week),
    state: rv ? (rv.ok ? 'passed' : 'failed') : 'pending',
    stateText: rv ? (rv.ok ? '已能完整背诵' : '未通过 · 已进复习库') : '待检查',
    inBank: !!x.inReviewBank,
    failCount: Object.keys(reviews).filter(k => reviews[k] && reviews[k].ok === false).length,
    typeLabel: x.type === 'sentence' ? '句子' : (x.type === 'word' ? '单词' : ''),
  });
}

function weeklyReview(module, week) {
  const wk = week || currentWeek();
  const weeks = recentWeeks(REVIEW_WEEKS);
  const items = active(module)
    .filter(x => weeks.indexOf(x.week) >= 0 || x.inReviewBank)
    .map(x => decorate(module, x, wk));
  return {
    week: wk,
    weekLabel: D.periodLabel('week', wk),
    scopeWeeks: weeks,
    scopeLabel: D.periodLabel('week', weeks[0]) + ' 至 ' + D.periodLabel('week', weeks[weeks.length - 1]),
    items,
    total: items.length,
    pending: items.filter(x => x.state === 'pending').length,
    passed: items.filter(x => x.state === 'passed').length,
    failed: items.filter(x => x.state === 'failed').length,
  };
}

function markReview(module, id, week, ok) {
  const wk = week || currentWeek();
  const list = readAll(module);
  const idx = list.findIndex(x => x.id === id);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  const item = list[idx];
  item.reviews = item.reviews || {};
  item.reviews[wk] = { ok: !!ok, at: new Date().toISOString() };
  if (ok) {
    item.inReviewBank = false;
    if (!item.masteredAt) item.masteredAt = new Date().toISOString();
  } else {
    item.inReviewBank = true;
    item.masteredAt = '';
  }
  const w = writeAll(module, list);
  return w.error ? w : { data: item, error: null };
}

function reviewBank(module) {
  const wk = currentWeek();
  const items = active(module).filter(x => x.inReviewBank).map(x => decorate(module, x, wk));
  return { items, total: items.length, weekLabel: D.periodLabel('week', wk) };
}

function weekItems(module, week) {
  const wk = week || currentWeek();
  return active(module)
    .filter(x => x.week === wk)
    .map(x => decorate(module, x, wk))
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function overview(module) {
  const wk = currentWeek();
  const r = weeklyReview(module, wk);
  const bank = reviewBank(module);
  return {
    weekLabel: r.weekLabel, total: r.total, pending: r.pending,
    passed: r.passed, failed: r.failed, bankCount: bank.total,
    learnedThisWeek: weekItems(module, wk).length,
  };
}

module.exports = {
  MODULES, REVIEW_WEEKS, currentWeek, recentWeeks, weekOptions,
  add, addBatch, remove, weeklyReview, markReview, reviewBank, weekItems, overview,
};
