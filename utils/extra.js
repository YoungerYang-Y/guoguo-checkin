// 扩展数据层：体重记录与果果培训费。
// 复用 store.read / store.write，写入会自动触发 cloudstore 的云同步钩子。
const store = require('./store.js');
const D = require('./date.js');

const MEMBERS = [
  { id: 'guoguo', name: '果果', color: '#F58AAE' },
  { id: 'papa', name: '爸爸', color: '#3BA99C' },
  { id: 'mama', name: '妈妈', color: '#F0A93B' },
];

const FEE_CATEGORIES = [
  { key: 'swim', name: '游泳', color: '#3BA99C' },
  { key: 'skate', name: '轮滑', color: '#F0A93B' },
  { key: 'reading', name: '阅读课', color: '#7F77DD' },
  { key: 'thinking', name: '思维课', color: '#378ADD' },
  { key: 'english', name: '英语课', color: '#EC5B8C' },
  { key: 'member', name: '会员课', color: '#D85A30' },
  { key: 'art', name: '美术课', color: '#F58AAE' },
  { key: 'books', name: '书籍购买', color: '#0F6E56' },
];

const CHART = { w: 620, h: 300, padL: 64, padT: 18 };

function uid(p) { return p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function ymOf(y, m) { return y + '-' + D.pad(m); }
function num(v) { return Math.round(Number(v) * 100) / 100; }
function money(v) { return num(v).toFixed(2).replace(/\.00$/, ''); }
function pct(part, total) { return total > 0 ? Math.round(part / total * 1000) / 10 : 0; }
function catOf(key) { return FEE_CATEGORIES.find(c => c.key === key) || { key, name: key, color: '#B4B2A9' }; }
function validYm(s) { return /^\d{4}-\d{2}$/.test(s || ''); }

// ---------- 体重 ----------
function getWeights() { return store.read(store.KEYS.WEIGHTS, []); }

function saveWeight(entry) {
  const ym = entry.ym, memberId = entry.member_id;
  if (!validYm(ym)) return { data: null, error: 'BAD_MONTH' };
  if (!MEMBERS.some(m => m.id === memberId)) return { data: null, error: 'BAD_MEMBER' };
  const has = v => v !== '' && v !== undefined && v !== null;
  const rawW = has(entry.weight) ? num(entry.weight) : null;
  const rawH = has(entry.height) ? num(entry.height) : null;
  const weight = rawW !== null && isFinite(rawW) && rawW > 0 && rawW <= 400 ? rawW : null;
  const height = rawH !== null && isFinite(rawH) && rawH > 0 && rawH <= 250 ? rawH : null;
  if (has(entry.weight) && weight === null) return { data: null, error: 'BAD_WEIGHT' };
  if (has(entry.height) && height === null) return { data: null, error: 'BAD_HEIGHT' };
  if (weight === null && height === null) return { data: null, error: 'EMPTY_VALUE' };
  // 身高只记果果；体重与身高至少填一项，未填的那项保留历史值
  if (height !== null && memberId !== 'guoguo') return { data: null, error: 'HEIGHT_ONLY_CHILD' };
  const list = getWeights();
  const idx = list.findIndex(w => w.member_id === memberId && w.ym === ym);
  const prev = idx >= 0 ? list[idx] : null;
  const now = new Date().toISOString();
  const rec = {
    id: prev ? prev.id : uid('w'),
    member_id: memberId, ym,
    weight: weight !== null ? weight : (prev && prev.weight != null ? prev.weight : null),
    height: height !== null ? height : (prev && prev.height != null ? prev.height : null),
    note: String(entry.note || '').slice(0, 200),
    created_at: prev ? prev.created_at : now,
    updated_at: now,
  };
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  const w = store.write(store.KEYS.WEIGHTS, list);
  return w.error ? w : { data: rec, error: null };
}

function removeWeight(id) {
  const list = getWeights().filter(w => w.id !== id);
  const w = store.write(store.KEYS.WEIGHTS, list);
  return w.error ? w : { data: null, error: null };
}

function weightYears() {
  const set = {};
  getWeights().forEach(w => { set[w.ym.slice(0, 4)] = 1; });
  const years = Object.keys(set).map(Number).sort((a, b) => a - b);
  const cur = Number(D.today().slice(0, 4));
  if (years.indexOf(cur) < 0) years.push(cur);
  return years.sort((a, b) => a - b);
}

function weightTable(year) {
  const all = getWeights();
  return Array.from({ length: 12 }, (_, i) => {
    const ym = ymOf(year, i + 1);
    return {
      ym, label: (i + 1) + '月',
      values: MEMBERS.map(m => {
        const r = all.find(w => w.member_id === m.id && w.ym === ym);
        return { memberId: m.id, value: r ? r.weight : null };
      }),
    };
  });
}

// 把若干条序列转换成 WXML 可直接渲染的线段与圆点（纯 CSS 折线图）
function buildLineChart(labels, series, connectGaps) {
  const values = [];
  series.forEach(s => s.points.forEach(p => { if (p.value !== null) values.push(p.value); }));
  if (!values.length) return { empty: true, segments: [], dots: [], yLabels: [], xLabels: [], gridLines: [] };
  let min = Math.min.apply(null, values), max = Math.max.apply(null, values);
  const span = Math.max(max - min, 2);
  min = min - span * 0.12; max = max + span * 0.12;
  const n = labels.length;
  const xStep = n > 1 ? (CHART.w - 70) / (n - 1) : 0;
  const px = i => CHART.padL + i * xStep;
  const py = v => CHART.padT + (max - v) / (max - min) * CHART.h;

  const segments = [], dots = [];
  series.forEach(s => {
    let prev = null;
    s.points.forEach((p, i) => {
      if (p.value === null) { if (!connectGaps) prev = null; return; }
      const x = px(i), y = py(p.value);
      dots.push({
        key: s.id + '-' + i,
        left: x.toFixed(1) + 'rpx', top: y.toFixed(1) + 'rpx',
        color: s.color, value: p.value, label: s.name + ' ' + p.label,
      });
      if (prev) {
        const dx = x - prev.x, dy = y - prev.y;
        segments.push({
          key: s.id + '-s' + i,
          left: prev.x.toFixed(1) + 'rpx', top: prev.y.toFixed(1) + 'rpx',
          width: Math.sqrt(dx * dx + dy * dy).toFixed(1) + 'rpx',
          rotate: 'rotate(' + (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(2) + 'deg)',
          color: s.color,
        });
      }
      prev = { x, y };
    });
  });

  const yLabels = [], gridLines = [];
  for (let i = 0; i <= 4; i++) {
    const v = max - (max - min) * i / 4;
    const top = (CHART.padT + CHART.h * i / 4).toFixed(1) + 'rpx';
    yLabels.push({ key: 'y' + i, top, text: v.toFixed(1) });
    gridLines.push({ key: 'g' + i, top });
  }
  const xLabels = labels.map((l, i) => ({ key: 'x' + i, left: px(i).toFixed(1) + 'rpx', text: l }));
  return { empty: false, segments, dots, yLabels, xLabels, gridLines };
}

// 年度曲线：当年 12 个月 × 三人
function weightYearChart(year, visible) {
  const all = getWeights();
  const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
  const series = MEMBERS.filter(m => !visible || visible.indexOf(m.id) >= 0).map(m => ({
    id: m.id, name: m.name, color: m.color,
    points: Array.from({ length: 12 }, (_, i) => {
      const ym = ymOf(year, i + 1);
      const r = all.find(w => w.member_id === m.id && w.ym === ym);
      return { value: r ? r.weight : null, label: ym };
    }),
  }));
  return Object.assign({ legend: series.map(s => ({ id: s.id, name: s.name, color: s.color })) }, buildLineChart(labels, series));
}

// 跨年度曲线：从最早有记录的月份到最近有记录的月份，连续时间轴
function weightCrossChart(visible) {
  const all = getWeights();
  if (!all.length) return Object.assign({ legend: [], labels: [] }, buildLineChart([], []));
  const yms = all.map(w => w.ym).sort();
  const start = yms[0], end = yms[yms.length - 1];
  const sy = Number(start.slice(0, 4)), sm = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4)), em = Number(end.slice(5, 7));
  const months = [];
  let y = sy, m = sm;
  let guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 240) {
    months.push(ymOf(y, m));
    m++; if (m > 12) { m = 1; y++; }
    guard++;
  }
  const labels = months.map(s => Number(s.slice(5, 7)) === 1 ? s.slice(0, 4) + '年' : s.slice(5, 7) + '月');
  const series = MEMBERS.filter(mm => !visible || visible.indexOf(mm.id) >= 0).map(mm => ({
    id: mm.id, name: mm.name, color: mm.color,
    points: months.map(ym => {
      const r = all.find(w => w.member_id === mm.id && w.ym === ym);
      return { value: r ? r.weight : null, label: ym };
    }),
  }));
  const chart = buildLineChart(labels, series);
  // 跨年度月份可能很多，只保留少量 X 轴标签，避免拥挤
  const keep = months.length > 18 ? Math.ceil(months.length / 12) : 1;
  chart.xLabels = chart.xLabels.filter((_, i) => i % keep === 0 || Number(months[i].slice(5, 7)) === 1);
  chart.legend = series.map(s => ({ id: s.id, name: s.name, color: s.color }));
  chart.monthCount = months.length;
  return chart;
}

// ---------- 果果身高 ----------
function heightRecords() {
  return getWeights()
    .filter(w => w.member_id === 'guoguo' && w.height !== null && w.height !== undefined && Number(w.height) > 0)
    .slice().sort((a, b) => a.ym.localeCompare(b.ym));
}

function heightYears() {
  const set = {};
  heightRecords().forEach(w => { set[w.ym.slice(0, 4)] = 1; });
  const years = Object.keys(set).map(Number).sort((a, b) => a - b);
  const cur = Number(D.today().slice(0, 4));
  if (years.indexOf(cur) < 0) years.push(cur);
  return years.sort((a, b) => a - b);
}

function heightTable(year) {
  const all = heightRecords();
  return Array.from({ length: 12 }, (_, i) => {
    const ym = ymOf(year, i + 1);
    const r = all.find(w => w.ym === ym);
    return { ym, label: (i + 1) + '月', value: r ? r.height : null };
  });
}

function heightYearChart(year) {
  const all = heightRecords();
  const labels = Array.from({ length: 12 }, (_, i) => (i + 1) + '月');
  const series = [{
    id: 'height', name: '果果身高', color: '#EC5B8C',
    points: Array.from({ length: 12 }, (_, i) => {
      const ym = ymOf(year, i + 1);
      const r = all.find(w => w.ym === ym);
      return { value: r ? r.height : null, label: ym };
    }),
  }];
  return Object.assign({ legend: [{ id: 'guoguo', name: '果果', color: '#EC5B8C' }] }, buildLineChart(labels, series, true));
}

function heightCrossChart() {
  const all = heightRecords();
  if (!all.length) return Object.assign({ legend: [], monthCount: 0 }, buildLineChart([], []));
  const yms = all.map(w => w.ym).sort();
  const start = yms[0], end = yms[yms.length - 1];
  const sy = Number(start.slice(0, 4)), sm = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4)), em = Number(end.slice(5, 7));
  const months = [];
  let y = sy, m = sm, guard = 0;
  while ((y < ey || (y === ey && m <= em)) && guard < 240) {
    months.push(ymOf(y, m));
    m++; if (m > 12) { m = 1; y++; }
    guard++;
  }
  const labels = months.map(s => Number(s.slice(5, 7)) === 1 ? s.slice(0, 4) + '年' : s.slice(5, 7) + '月');
  const series = [{
    id: 'height', name: '果果身高', color: '#EC5B8C',
    points: months.map(ym => {
      const r = all.find(w => w.ym === ym);
      return { value: r ? r.height : null, label: ym };
    }),
  }];
  const chart = buildLineChart(labels, series, true);
  const keep = months.length > 18 ? Math.ceil(months.length / 12) : 1;
  chart.xLabels = chart.xLabels.filter((_, i) => i % keep === 0 || Number(months[i].slice(5, 7)) === 1);
  chart.legend = [{ id: 'guoguo', name: '果果', color: '#EC5B8C' }];
  chart.monthCount = months.length;
  return chart;
}

// 年度对比：每年首末身高、年内增长、相对上一年末增长
function heightYearCompare() {
  const all = heightRecords();
  if (!all.length) return { empty: true, rows: [] };
  const byYear = {};
  all.forEach(w => {
    const y = Number(w.ym.slice(0, 4));
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(w);
  });
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  let prevLast = null;
  const rows = years.map(y => {
    const arr = byYear[y];
    const first = arr[0], last = arr[arr.length - 1];
    const growth = arr.length > 1 ? num(last.height - first.height) : null;
    const growthNum = growth === null ? 0 : growth;
    const yoy = prevLast !== null ? num(last.height - prevLast) : null;
    prevLast = last.height;
    return {
      year: y, firstYm: first.ym, firstText: num(first.height).toFixed(1),
      lastYm: last.ym, lastText: num(last.height).toFixed(1),
      growth: growth === null ? '—' : (growth >= 0 ? '+' : '') + growth.toFixed(1),
      growthNum,
      yoy: yoy === null ? '—' : (yoy >= 0 ? '+' : '') + yoy.toFixed(1),
      count: arr.length,
    };
  });
  const maxGrowth = Math.max.apply(null, [1].concat(rows.map(r => Math.abs(r.growthNum))));
  rows.forEach(r => {
    r.barHeight = Math.max(8, Math.round(Math.abs(r.growthNum) / maxGrowth * 100));
    r.barColor = r.growthNum >= 0 ? '#EC5B8C' : '#F0A93B';
  });
  return { empty: false, rows, latest: rows[rows.length - 1] };
}

// ---------- 培训费 ----------
function getFees() { return store.read(store.KEYS.FEES, []); }

function addFee(entry) {
  const ym = entry.ym, amount = num(entry.amount);
  if (!validYm(ym)) return { data: null, error: 'BAD_MONTH' };
  if (!FEE_CATEGORIES.some(c => c.key === entry.category)) return { data: null, error: 'BAD_CATEGORY' };
  if (!isFinite(amount) || amount <= 0 || amount > 10000000) return { data: null, error: 'BAD_AMOUNT' };
  const list = getFees();
  const now = new Date().toISOString();
  const rec = {
    id: uid('f'), ym, category: entry.category, amount,
    note: String(entry.note || '').slice(0, 200),
    created_at: now, updated_at: now,
  };
  list.push(rec);
  const w = store.write(store.KEYS.FEES, list);
  return w.error ? w : { data: rec, error: null };
}

function removeFee(id) {
  const list = getFees().filter(f => f.id !== id);
  const w = store.write(store.KEYS.FEES, list);
  return w.error ? w : { data: null, error: null };
}

function feeYears() {
  const set = {};
  getFees().forEach(f => { set[f.ym.slice(0, 4)] = 1; });
  const years = Object.keys(set).map(Number);
  const cur = Number(D.today().slice(0, 4));
  if (years.indexOf(cur) < 0) years.push(cur);
  return years.sort((a, b) => a - b);
}

function sumFees(list) { return num(list.reduce((s, f) => s + Number(f.amount), 0)); }

function monthAnalysis(ym) {
  const list = getFees().filter(f => f.ym === ym);
  const total = sumFees(list);
  const rows = FEE_CATEGORIES.map(c => {
    const amount = sumFees(list.filter(f => f.category === c.key));
    return { key: c.key, name: c.name, color: c.color, amount, amountText: money(amount), pct: pct(amount, total) };
  }).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
  return { ym, total, totalText: money(total), rows, count: list.length, list: list.slice().sort((a, b) => b.created_at.localeCompare(a.created_at)) };
}

function yearAnalysis(year) {
  const all = getFees().filter(f => Number(f.ym.slice(0, 4)) === year);
  const total = sumFees(all);
  const months = Array.from({ length: 12 }, (_, i) => {
    const ym = ymOf(year, i + 1);
    const list = all.filter(f => f.ym === ym);
    const t = sumFees(list);
    return { ym, label: (i + 1) + '月', total: t, totalText: money(t), count: list.length };
  });
  const categories = FEE_CATEGORIES.map(c => {
    const amount = sumFees(all.filter(f => f.category === c.key));
    return { key: c.key, name: c.name, color: c.color, amount, amountText: money(amount), pct: pct(amount, total) };
  }).filter(r => r.amount > 0).sort((a, b) => b.amount - a.amount);
  const prevTotal = sumFees(getFees().filter(f => Number(f.ym.slice(0, 4)) === year - 1));
  const diff = num(total - prevTotal);
  const diffPct = prevTotal > 0 ? Math.round(diff / prevTotal * 1000) / 10 : null;
  return {
    year, total, totalText: money(total), months, categories, count: all.length,
    prevTotal, prevTotalText: money(prevTotal), diff, diffText: money(Math.abs(diff)),
    diffPct, diffWord: diff >= 0 ? '增加' : '减少',
    diffLabel: diffPct === null ? '—' : (diff >= 0 ? '+' : '-') + Math.abs(diffPct) + '%',
    hasPrev: getFees().some(f => Number(f.ym.slice(0, 4)) === year - 1),
  };
}

function yearTotals() {
  const byYear = {};
  getFees().forEach(f => {
    const y = Number(f.ym.slice(0, 4));
    byYear[y] = (byYear[y] || 0) + Number(f.amount);
  });
  const cur = Number(D.today().slice(0, 4));
  if (!byYear[cur]) byYear[cur] = 0;
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  let max = 0;
  const rows = years.map((y, i) => {
    const total = num(byYear[y]);
    const prev = i > 0 ? num(byYear[years[i - 1]]) : 0;
    max = Math.max(max, total);
    return {
      year: y, total, totalText: money(total),
      diff: num(total - prev), diffText: money(Math.abs(num(total - prev))),
      diffPct: prev > 0 ? Math.round((total - prev) / prev * 1000) / 10 : null,
      isUp: total >= prev,
    };
  });
  rows.forEach(r => {
    r.barHeight = max > 0 ? Math.max(6, Math.round(r.total / max * 100)) : 6;
    r.barColor = r.isUp ? '#EC5B8C' : '#F0A93B';
    r.diffLabel = r.diffPct === null ? '—' : (r.isUp ? '+' : '-') + Math.abs(r.diffPct) + '%';
  });
  return { rows, max, sumText: money(num(rows.reduce((s, r) => s + r.total, 0))) };
}

// 按果果年龄逐年求和：年龄按自然年估算（年份 - 出生年）
function ageTotals(birthYm) {
  if (!validYm(birthYm)) return null;
  const birthYear = Number(birthYm.slice(0, 4));
  const rows = yearTotals().rows.map(r => ({ year: r.year, age: r.year - birthYear, total: r.total, totalText: r.totalText }));
  return { birthYm, rows, sumText: money(num(rows.reduce((s, r) => s + r.total, 0))) };
}

// 环形占比图：CSS conic-gradient
function pieGradient(rows) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (total <= 0) return 'background: conic-gradient(#F1EFE8 0%, #F1EFE8 100%)';
  let acc = 0;
  const parts = rows.map(r => {
    const start = acc;
    acc += r.amount / total * 100;
    return r.color + ' ' + start.toFixed(2) + '%, ' + r.color + ' ' + acc.toFixed(2) + '%';
  });
  return 'background: conic-gradient(' + parts.join(', ') + ')';
}

// ---------- 扩展设置 ----------
function getExtraSettings() { return store.read(store.KEYS.EXTRA_SETTINGS, { guoguoBirth: '' }); }
function setGuoguoBirth(ym) {
  const s = getExtraSettings();
  s.guoguoBirth = validYm(ym) ? ym : '';
  const w = store.write(store.KEYS.EXTRA_SETTINGS, s);
  return w.error ? w : { data: s, error: null };
}

module.exports = {
  MEMBERS, FEE_CATEGORIES, money, pct, catOf, ymOf,
  getWeights, saveWeight, removeWeight, weightYears, weightTable, weightYearChart, weightCrossChart,
  heightYears, heightTable, heightYearChart, heightCrossChart, heightYearCompare,
  getFees, addFee, removeFee, feeYears, monthAnalysis, yearAnalysis, yearTotals, ageTotals, pieGradient,
  getExtraSettings, setGuoguoBirth,
};
