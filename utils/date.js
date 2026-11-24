// 日期工具：全部按业务日期 YYYY-MM-DD 处理，周一为一周起点

function pad(n) { return n < 10 ? '0' + n : '' + n; }

// Date -> 'YYYY-MM-DD'
function fmt(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// 'YYYY-MM-DD' -> Date (本地 00:00)
function parse(s) {
  const p = s.split('-');
  return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
}

function today() { return fmt(new Date()); }

function addDays(s, n) {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return fmt(d);
}

function diffDays(a, b) {
  // b - a 的天数
  return Math.round((parse(b) - parse(a)) / 86400000);
}

// 返回 1=周一 ... 7=周日
function weekday(s) {
  const d = parse(s).getDay();
  return d === 0 ? 7 : d;
}

// 所在自然周的周一
function weekStart(s) {
  const w = weekday(s);
  return addDays(s, -(w - 1));
}

function monthStart(s) { return s.slice(0, 7) + '-01'; }
function yearStart(s) { return s.slice(0, 4) + '-01-01'; }

// 周期内的所有日期
function datesBetween(start, end) {
  const out = [];
  let cur = start;
  let guard = 0;
  while (cur <= end && guard < 800) {
    out.push(cur);
    cur = addDays(cur, 1);
    guard++;
  }
  return out;
}

function weekDates(anchor) {
  return datesBetween(weekStart(anchor), addDays(weekStart(anchor), 6));
}

function monthDates(anchor) {
  const y = Number(anchor.slice(0, 4)), m = Number(anchor.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  return datesBetween(monthStart(anchor), fmt(new Date(y, m - 1, last)));
}

function yearMonths(anchor) {
  const y = Number(anchor.slice(0, 4));
  const res = [];
  for (let m = 1; m <= 12; m++) res.push(y + '-' + pad(m));
  return res;
}

// 周期标识：周 report-2026-W48 / 月 2026-11 / 年 2026
function periodKey(type, anchor) {
  if (type === 'week') {
    const ws = weekStart(anchor);
    const th = addDays(ws, 3); // ISO 周四所在年份决定归属年
    const y = Number(th.slice(0, 4));
    const start = y + '-01-01';
    const w = Math.floor(diffDays(start, ws) / 7) + 1;
    return y + '-W' + pad(w);
  }
  if (type === 'month') return anchor.slice(0, 7);
  return anchor.slice(0, 4);
}

// 用户友好的周期标签
function periodLabel(type, key) {
  if (type === 'week') {
    const p = key.split('-W');
    return p[0] + ' 第 ' + Number(p[1]) + ' 周';
  }
  if (type === 'month') {
    const p = key.split('-');
    return p[0] + ' 年 ' + Number(p[1]) + ' 月';
  }
  return key + ' 年';
}

module.exports = {
  pad, fmt, parse, today, addDays, diffDays, weekday, weekStart,
  monthStart, yearStart, datesBetween, weekDates, monthDates, yearMonths,
  periodKey, periodLabel,
};
