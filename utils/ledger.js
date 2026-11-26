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
function money(cents) { return (cents / 100).toFixed(2); }

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
  add, update, remove, listAll, listByMonth, byYm, summary, months, getRecord,
  toCents, fromCents, money,
};
