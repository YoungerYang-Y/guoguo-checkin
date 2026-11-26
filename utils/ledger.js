// 家庭记账数据层：增删改查 + 月度汇总。
// 记录结构：{ id, date, ym, cat1, cat2, amount, member, note, created_at, updated_at, created_by }
// 金额以「元」存储但汇总时按分累加，避免 0.1+0.2 这类浮点误差。
const store = require('./store.js');
const C = require('./ledger-categories.js');
const D = require('./date.js');

const KEY = () => store.KEYS.LEDGER;

function uid(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function toCents(v) {
  const n = Number(v);
  return isFinite(n) ? Math.round(n * 100) : 0;
}
function fromCents(c) { return Math.round(c) / 100; }
// 千分位分组：账本金额常是四五位数，5800.00 与 15800.00 光看数字很难分辨
function group(text) {
  const parts = String(text).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
function money(cents) { return group((cents / 100).toFixed(2)); }
// 元（number）→ 分组后的两位小数字符串，供页面直接展示单笔金额
function moneyOf(amount) { return money(toCents(amount)); }

function listAll() {
  const v = store.read(KEY(), []);
  return Array.isArray(v) ? v : [];
}
function writeAll(list) {
  return store.write(KEY(), list);
}

// 归一化输入并校验；不合法返回 { error }
function normalize(input) {
  const date = String(input.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: 'BAD_DATE' };
  const cat2 = String(input.cat2 || '').trim();
  const hit = C.findCat2(cat2);
  if (!hit) return { error: 'BAD_CATEGORY' };
  const cat1 = cat2.split('-')[0];
  const cents = toCents(input.amount);
  if (cents <= 0) return { error: 'BAD_AMOUNT' };
  if (cents > 100000000) return { error: 'BAD_AMOUNT' };
  // 居住类恒为公共支出，忽略传入的成员
  const member = C.isPublicOnly(cat1) ? 'public' : String(input.member || 'public');
  if (!C.MEMBERS.some(m => m.id === member)) return { error: 'BAD_MEMBER' };
  return {
    value: {
      date,
      ym: date.slice(0, 7),
      cat1, cat2,
      amount: fromCents(cents),
      member,
      note: String(input.note || '').trim().slice(0, 40),
    },
  };
}

function add(input) {
  const n = normalize(input);
  if (n.error) return { data: null, error: n.error };
  const list = listAll();
  const now = new Date().toISOString();
  const rec = Object.assign({ id: uid('led_'), created_at: now, updated_at: now }, n.value);
  list.push(rec);
  const w = writeAll(list);
  if (w.error) return { data: null, error: w.error };
  // 待整理占比是分类体系健康度信号，先埋点不做阻断
  return { data: rec, error: null };
}

// 批量导入（历史数据迁移用）：一次性归一化并写盘，避免 N 条记录触发 N 次云同步。
// src 是幂等标记，同一条来源只会导入一次，重复执行不会产生重复账。
function bulkAdd(entries) {
  const list = listAll();
  const seen = {};
  list.forEach(r => { if (r.src) seen[r.src] = true; });
  const now = new Date().toISOString();
  const added = [];
  let skipped = 0;
  (entries || []).forEach(e => {
    const n = normalize(e);
    if (n.error) { skipped += 1; return; }
    const src = e && e.src ? String(e.src) : '';
    if (src && seen[src]) { skipped += 1; return; }
    if (src) seen[src] = true;
    const rec = Object.assign({ id: uid('led_'), created_at: now, updated_at: now }, n.value);
    if (src) rec.src = src;
    list.push(rec);
    added.push(rec);
  });
  if (added.length) {
    const w = writeAll(list);
    if (w.error) return { data: [], skipped, error: w.error };
  }
  return { data: added, skipped, error: null };
}

function update(id, patch) {
  const list = listAll();
  const idx = list.findIndex(r => r.id === id);
  if (idx < 0) return { data: null, error: 'NOT_FOUND' };
  const merged = Object.assign({}, list[idx], patch);
  const n = normalize(merged);
  if (n.error) return { data: null, error: n.error };
  const rec = Object.assign({}, list[idx], n.value, { updated_at: new Date().toISOString() });
  list[idx] = rec;
  const w = writeAll(list);
  return w.error ? { data: null, error: w.error } : { data: rec, error: null };
}

function remove(id) {
  const list = listAll();
  const next = list.filter(r => r.id !== id);
  if (next.length === list.length) return { data: null, error: 'NOT_FOUND' };
  const w = writeAll(next);
  return w.error ? { data: null, error: w.error } : { data: { id }, error: null };
}

function byYm(ym) {
  return listAll().filter(r => r.ym === ym);
}

// 月度汇总：总额、按成员、按一级分类（带占比），以及待整理占比
function summary(ym) {
  const rows = byYm(ym);
  let totalCents = 0;
  const memberMap = {};
  const catMap = {};
  rows.forEach(r => {
    const c = toCents(r.amount);
    totalCents += c;
    memberMap[r.member] = (memberMap[r.member] || 0) + c;
    catMap[r.cat1] = (catMap[r.cat1] || 0) + c;
  });
  const pct = c => (totalCents ? Math.round((c / totalCents) * 1000) / 10 : 0);
  const members = C.MEMBERS.map(m => ({
    id: m.id, name: m.name,
    amount: fromCents(memberMap[m.id] || 0),
    amountText: money(memberMap[m.id] || 0),
    pct: pct(memberMap[m.id] || 0),
  }));
  const cats = C.CATEGORIES
    .map(c => ({
      code: c.code, name: c.name,
      amount: fromCents(catMap[c.code] || 0),
      amountText: money(catMap[c.code] || 0),
      pct: pct(catMap[c.code] || 0),
    }))
    .filter(c => c.amount > 0)
    .sort((a, b) => b.amount - a.amount);
  const pendingCents = catMap['13'] || 0;
  return {
    ym,
    count: rows.length,
    total: fromCents(totalCents),
    totalText: money(totalCents),
    members,
    cats,
    pendingPct: pct(pendingCents),
  };
}

// 年度汇总：原培训费页有「年度对比 / 按月趋势」，合并进记账后这部分能力不能丢。
function yearSummary(year) {
  const y = String(year);
  const all = listAll();
  let totalCents = 0;
  let prevCents = 0;
  let count = 0;
  const catMap = {};
  const monthMap = {};
  all.forEach(r => {
    const c = toCents(r.amount);
    const ry = String(r.date).slice(0, 4);
    if (ry === y) {
      totalCents += c;
      count += 1;
      catMap[r.cat1] = (catMap[r.cat1] || 0) + c;
      const m = String(r.date).slice(5, 7);
      monthMap[m] = (monthMap[m] || 0) + c;
    } else if (ry === String(Number(y) - 1)) {
      prevCents += c;
    }
  });
  const pct = c => (totalCents ? Math.round((c / totalCents) * 1000) / 10 : 0);
  const cats = C.CATEGORIES.map(c => ({
    code: c.code, name: c.name,
    amount: fromCents(catMap[c.code] || 0),
    amountText: money(catMap[c.code] || 0),
    pct: pct(catMap[c.code] || 0),
  })).filter(c => c.amount > 0).sort((a, b) => b.amount - a.amount);
  const months = Object.keys(monthMap).sort().map(m => ({
    ym: y + '-' + m,
    label: Number(m) + '月',
    amount: fromCents(monthMap[m]),
    amountText: money(monthMap[m]),
    pct: pct(monthMap[m]),
  }));
  const diffCents = totalCents - prevCents;
  const prevTotal = fromCents(prevCents);
  return {
    year: Number(y), count,
    total: fromCents(totalCents), totalText: money(totalCents),
    months, cats,
    prevTotal, prevTotalText: money(prevCents),
    // 去年没记录时不报「增长 100%」，那只会误导
    hasPrev: prevCents > 0,
    diffWord: diffCents === 0 ? '持平' : (diffCents > 0 ? '增加' : '减少'),
    diffText: money(Math.abs(diffCents)),
    diffPct: prevCents > 0 ? Math.round(Math.abs(diffCents) / prevCents * 1000) / 10 : 0,
  };
}

// 有记录的月份列表（倒序），用于汇总页切换
function months() {
  const set = {};
  listAll().forEach(r => { if (r.ym) set[r.ym] = true; });
  const todayYm = D.today().slice(0, 7);
  set[todayYm] = true;
  return Object.keys(set).sort().reverse();
}

// 明细：按月倒序（同月按日期倒序）
function listByMonth(ym) {
  return byYm(ym).slice().sort((a, b) => {
    const d = String(b.date).localeCompare(String(a.date));
    return d !== 0 ? d : String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
}

function getRecord(id) { return listAll().find(r => r.id === id) || null; }

module.exports = {
  add, bulkAdd, update, remove, listAll, listByMonth, byYm, summary, yearSummary, months, getRecord,
  toCents, fromCents, money, moneyOf,
};
