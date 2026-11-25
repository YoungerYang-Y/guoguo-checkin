// 统计口径：唯一数据源为打卡记录，其余表只提供口径与配置
const store = require('./store.js');
const D = require('./date.js');
const policy = require('./policy.js');
const { ITEMS, GUOGUO_ITEMS, PARENT_ITEMS } = require('./constants.js');

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function r1(v) { return Math.round(v * 10) / 10; }
function pct(done, total) { return total <= 0 ? 100 : clamp((done / total) * 100, 0, 100); }

function customTargetsAt(memberId, date) {
  if (typeof store.getCustomTargetsAt === 'function') return store.getCustomTargetsAt(memberId, date);
  return store.getCustomTargets(memberId)
    .map(t => policy.customTargetAt(t, date))
    .filter(Boolean);
}

function targetAt(date, raw) {
  return policy.getTargetsAt(date, raw === undefined ? store.getTargets() : raw);
}

function weeklyTargetTotal(dates, code, fallback, raw) {
  const weeks = {};
  dates.forEach(date => {
    const start = D.weekStart(date);
    if (!weeks[start]) weeks[start] = [];
    weeks[start].push(date);
  });
  return Object.keys(weeks).reduce((total, start) => {
    const config = targetAt(start, raw);
    const value = config[code] === undefined || config[code] === null ? fallback : Number(config[code]);
    return total + value * weeks[start].length / 7;
  }, 0);
}

function periodTargetTotals(dates, raw) {
  const defaults = { 'G-MEMBER': 2, 'G-ART': 1, 'G-SKATE': 2, 'G-SWIM': 2, 'P-AI': 5, 'P-WORD': 5, 'P-SWIM': 2 };
  const totals = {};
  Object.keys(defaults).forEach(code => {
    totals[code] = r1(weeklyTargetTotal(dates, code, defaults[code], raw));
  });
  return totals;
}

// 某成员某天的应完成项（含计入必修的自定义目标）
function requiredItems(memberId, date) {
  const sched = policy.getScheduleAt(date, store.getSchedule());
  const dow = D.weekday(date);
  const list = [];
  const codes = memberId === 'guoguo' ? GUOGUO_ITEMS : PARENT_ITEMS;
  codes.forEach(code => {
    const req = sched[code] && sched[code][dow];
    if (req) list.push({ code, name: ITEMS[code].name });
  });
  // 自定义必修目标，且在生效期内
  customTargetsAt(memberId, date).forEach(t => {
    if (t.count_mode !== 1) return;
    if (t.start_date && date < t.start_date) return;
    if (t.end_date && date > t.end_date) return;
    list.push({ code: t.target_id, name: t.name, custom: true });
  });
  return list;
}

// 某成员某天统计
function dayStat(memberId, date) {
  const recs = store.getRecords().filter(r => r.biz_date === date && r.status === 1 && r.member_id === memberId);
  const doneCodes = {};
  recs.forEach(r => { doneCodes[r.item_code] = r; });
  const required = requiredItems(memberId, date);
  const doneRequired = required.filter(it => doneCodes[it.code]).length;
  const extraDone = recs.filter(r => !required.some(it => it.code === r.item_code)).length;
  const isFull = required.length > 0 && doneRequired === required.length;
  const hasAny = recs.length > 0;
  const backfillCount = recs.filter(r => r.source === 2).length;
  return {
    memberId, date, required: required.length, doneRequired,
    rate: pct(doneRequired, required.length), isFull, hasAny,
    doneTotal: recs.length, extraDone, backfillCount,
    noRequired: required.length === 0, recs, doneCodes,
  };
}

// 连续全勤天数：自统计日向前回溯，任一天非全勤即中断
function streak(memberId, endDate, limitEnd) {
  let cur = endDate;
  let n = 0;
  let guard = 0;
  while (cur >= (limitEnd || '0000-01-01') && guard < 800) {
    const s = dayStat(memberId, cur);
    if (s.isFull) { n++; cur = D.addDays(cur, -1); } else break;
    guard++;
  }
  return n;
}

// 单项连续天数（用于家长连续性口径）
function itemStreak(memberId, itemCode, endDate, limitEnd) {
  let cur = endDate, n = 0, guard = 0;
  while (cur >= (limitEnd || '0000-01-01') && guard < 800) {
    const r = store.getRecords().find(x => x.member_id === memberId && x.item_code === itemCode && x.biz_date === cur && x.status === 1);
    if (r) { n++; cur = D.addDays(cur, -1); } else break;
    guard++;
  }
  return n;
}

// 有效打卡日数
function effectiveDays(memberId, dates) {
  return dates.filter(d => dayStat(memberId, d).hasAny).length;
}

// 样本是否有效
function sampleValid(memberId, dates, type) {
  const n = effectiveDays(memberId, dates);
  const min = type === 'week' ? 3 : (type === 'month' ? 10 : 90);
  return { valid: n >= min, days: n, min };
}

// ---------- 维度计算 ----------
// 果果：完成率、连续性、目标达成、广度；家长：对应口径
function dimensions(memberId, dates, type, targets) {
  const allRecs = store.getRecords().filter(r => r.member_id === memberId && r.status === 1 && dates.indexOf(r.biz_date) >= 0);
  const totalDays = dates.length || 1;
  const last = dates[dates.length - 1] || D.today();
  const targetHistory = targets || store.getTargets();
  const goalTargets = {};
  const targetKeys = memberId === 'guoguo'
    ? ['G-MEMBER', 'G-ART', 'G-SKATE', 'G-SWIM']
    : ['P-AI', 'P-WORD', 'P-SWIM'];
  targetKeys.forEach(code => {
    const fallback = memberId === 'guoguo'
      ? ({ 'G-MEMBER': 2, 'G-ART': 1, 'G-SKATE': 2, 'G-SWIM': 2 }[code])
      : ({ 'P-AI': 5, 'P-WORD': 5, 'P-SWIM': 2 }[code]);
    goalTargets[code] = weeklyTargetTotal(dates, code, fallback, targetHistory);
  });

  // 完成率
  let completion;
  if (memberId === 'guoguo') {
    let reqSum = 0, doneSum = 0;
    dates.forEach(d => { const s = dayStat(memberId, d); reqSum += s.required; doneSum += s.doneRequired; });
    completion = pct(doneSum, reqSum);
  } else {
    const aiDays = uniqueDays(allRecs, 'P-AI').length;
    const wordDays = allRecs.filter(r => r.item_code === 'P-WORD' && wordQualified(r)).length;
    const swimTimes = allRecs.filter(r => r.item_code === 'P-SWIM').length;
    completion = (pct(aiDays, goalTargets['P-AI']) + pct(wordDays, goalTargets['P-WORD']) + pct(swimTimes, goalTargets['P-SWIM'])) / 3;
  }

  // 连续性
  let continuity;
  if (memberId === 'guoguo') {
    const fullDays = dates.filter(d => dayStat(memberId, d).isFull).length;
    const shouldDays = dates.filter(d => requiredItems(memberId, d).length > 0).length;
    continuity = pct(fullDays, shouldDays);
  } else {
    const codes = ['P-AI', 'P-WORD', 'P-SWIM'];
    continuity = codes.reduce((sum, c) => sum + pct(itemStreak(memberId, c, last, dates[0]), totalDays), 0) / 3;
  }

  // 目标达成
  let goal;
  if (memberId === 'guoguo') {
    const memberSessions = sumMetric(allRecs, 'G-MEMBER', 'session_count');
    const artTimes = allRecs.filter(r => r.item_code === 'G-ART').length;
    const skateTimes = allRecs.filter(r => r.item_code === 'G-SKATE').length;
    const swimTimes = allRecs.filter(r => r.item_code === 'G-SWIM').length;
    goal = (
      pct(memberSessions, goalTargets['G-MEMBER']) +
      pct(artTimes, goalTargets['G-ART']) +
      pct(skateTimes, goalTargets['G-SKATE']) +
      pct(swimTimes, goalTargets['G-SWIM'])
    ) / 4;
  } else {
    const aiDays = uniqueDays(allRecs, 'P-AI').length;
    const wordDays = allRecs.filter(r => r.item_code === 'P-WORD' && wordQualified(r)).length;
    const swimTimes = allRecs.filter(r => r.item_code === 'P-SWIM').length;
    const met = [aiDays >= goalTargets['P-AI'], wordDays >= goalTargets['P-WORD'], swimTimes >= goalTargets['P-SWIM']].filter(Boolean).length;
    goal = pct(met, 3);
  }

  // 广度与自主
  let breadth;
  if (memberId === 'guoguo') {
    const hasSport = allRecs.some(r => ITEMS[r.item_code] && ITEMS[r.item_code].category === 'sport');
    const hasArt = allRecs.some(r => ITEMS[r.item_code] && ITEMS[r.item_code].category === 'art');
    const hasWeekend = allRecs.some(r => D.weekday(r.biz_date) >= 6);
    const kinds = [hasSport, hasArt, hasWeekend].filter(Boolean).length;
    breadth = kinds >= 3 ? 100 : (kinds === 2 ? 80 : (kinds === 1 ? 50 : 0));
  } else {
    const themes = {};
    allRecs.filter(r => r.item_code === 'P-AI' && r.theme && r.theme.trim()).forEach(r => { themes[r.theme.trim()] = 1; });
    const n = Object.keys(themes).length;
    breadth = clamp(Math.round(n / 3 * 100), 0, 100);
  }

  const d = { completion: r1(completion), continuity: r1(continuity), goal: r1(goal), breadth: r1(breadth) };
  d.index = Math.round(0.4 * d.completion + 0.3 * d.continuity + 0.2 * d.goal + 0.1 * d.breadth);
  d.gap = 100 - d.index;
  return d;
}

function uniqueDays(recs, code) {
  const map = {};
  recs.filter(r => r.item_code === code).forEach(r => { map[r.biz_date] = 1; });
  return Object.keys(map).map(d => d);
}
function sumMetric(recs, code, field) {
  return recs.filter(r => r.item_code === code).reduce((s, r) => s + (Number(r[field]) || 0), 0);
}
function wordQualified(r) {
  let v = r.metric_value;
  if (v === null || v === undefined || v === '' || r.unverified) v = 20;
  return Number(v) >= 20;
}

// 进步空间：最低两个维度 + 建议
function progressAdvice(memberId, dims, dates, type, targets) {
  const periodName = type === 'year' ? '本年' : (type === 'month' ? '本月' : '本周');
  const pairs = [
    { key: 'completion', name: '完成率', v: dims.completion },
    { key: 'continuity', name: '连续性', v: dims.continuity },
    { key: 'goal', name: '目标达成', v: dims.goal },
    { key: 'breadth', name: '广度与自主', v: dims.breadth },
  ].sort((a, b) => a.v - b.v);
  const low = pairs.slice(0, 2);
  const texts = low.map(p => {
    if (p.key === 'completion') {
      const miss = dates.reduce((s, d) => s + Math.max(0, dayStat(memberId, d).required - dayStat(memberId, d).doneRequired), 0);
      return periodName + '有 ' + miss + ' 项必修没完成；建议把阅读课固定在晚饭后同一时段。';
    }
    if (p.key === 'continuity') return '中断主要发生在周末；周末只保留 1 项必修，先把连续天数续上。';
    if (p.key === 'goal') {
      const sessions = sumMetric(store.getRecords().filter(r => r.member_id === memberId && r.status === 1 && dates.indexOf(r.biz_date) >= 0), 'G-MEMBER', 'session_count');
      const expected = weeklyTargetTotal(dates, 'G-MEMBER', 2, targets);
      return periodName + '会员课 ' + sessions + ' 节，目标约 ' + r1(expected) + ' 节；建议固定每周课时。';
    }
    if (memberId !== 'guoguo') {
      const ai = uniqueDays(store.getRecords().filter(r => r.member_id === memberId && r.status === 1 && dates.indexOf(r.biz_date) >= 0), 'P-AI').length;
      return periodName + 'AI 学习 ' + ai + ' 天；建议改为每天 20 分钟固定时段，与孩子的阅读课同步。';
    }
    return periodName + '只覆盖了运动或艺术中的一类；建议每周固定一次绘画，并为游泳安排固定时间。';
  });
  return { low: low.map(p => p.name), texts };
}

// ---------- 周期报表 ----------
function buildReport(type, anchor) {
  const targetHistory = store.getTargets();
  let dates, trendDates, key, prevDates, prevKey, title;
  if (type === 'week') {
    key = D.periodKey('week', anchor);
    trendDates = D.weekDates(anchor);
    const prevAnchor = D.addDays(D.weekStart(anchor), -7);
    prevKey = D.periodKey('week', prevAnchor);
    prevDates = D.weekDates(prevAnchor);
  } else if (type === 'month') {
    key = D.periodKey('month', anchor);
    trendDates = D.monthDates(anchor);
    const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
    const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
    prevKey = py + '-' + (pm < 10 ? '0' + pm : pm);
    prevDates = D.monthDates(py + '-' + (pm < 10 ? '0' + pm : pm) + '-01');
  } else {
    key = D.periodKey('year', anchor);
    trendDates = D.datesBetween(D.yearStart(anchor), key + '-12-31');
    prevKey = String(Number(key) - 1);
    prevDates = D.datesBetween(prevKey + '-01-01', prevKey + '-12-31');
  }
  // Keep future trend slots visible, but exclude them from current-period metrics.
  dates = trendDates.filter(date => date <= D.today());
  title = D.periodLabel(type, key);

  const report = { type, key, title, anchor, generatedAt: new Date().toISOString(), targetTotals: periodTargetTotals(dates, targetHistory), members: {}, compare: [], valid: true, sampleNote: '' };

  const members = store.getFamily().members;
  members.forEach(m => {
    const valid = sampleValid(m.id, dates, type);
    const dims = valid.valid ? dimensions(m.id, dates, type, targetHistory) : null;
    const prevValid = sampleValid(m.id, prevDates, type);
    const prevDims = prevValid.valid ? dimensions(m.id, prevDates, type, targetHistory) : null;
    const delta = (dims && prevDims) ? dims.index - prevDims.index : null;
    let trend = 'basic';
    if (delta !== null) {
      if (Math.abs(delta) >= 5) trend = delta > 0 ? 'up' : 'down';
    }
    report.members[m.id] = {
      id: m.id, name: m.name, role: m.role,
      dims, prevDims, delta, trend,
      valid: valid.valid, effectiveDays: valid.days, minDays: valid.min,
      advice: dims ? progressAdvice(m.id, dims, dates, type, targetHistory) : null,
      detail: memberDetail(m.id, dates, type),
    };
  });

  // 三人对比排行（仅有效样本）
  report.compare = members.map(m => report.members[m.id]).filter(x => x.valid && x.dims)
    .sort((a, b) => b.dims.index - a.dims.index)
    .map((x, i) => ({ id: x.id, name: x.name, index: x.dims.index, rank: i + 1, delta: x.delta, trend: x.trend }));

  report.totalDone = members.reduce((s, m) => s + report.members[m.id].detail.doneTotal, 0);
  report.fullDays = dates.filter(d => dayStat('guoguo', d).isFull).length;
  report.backfillRate = report.totalDone ? Math.round(report.totalDone && members.reduce((s, m) => s + report.members[m.id].detail.backfillCount, 0) / report.totalDone * 100) : 0;
  report.trend = buildTrend(trendDates);
  report.highlights = buildHighlights(report, dates, type);
  return report;
}

// 成员明细
function memberDetail(memberId, dates, type) {
  const recs = store.getRecords().filter(r => r.member_id === memberId && r.status === 1 && dates.indexOf(r.biz_date) >= 0);
  const detail = { doneTotal: recs.length, backfillCount: recs.filter(r => r.source === 2).length, counts: {}, sessions: 0, wordDays: 0, wordTotal: 0, longestStreak: longestStreak(memberId, dates), fullDays: 0, weekendExtra: 0, themes: [] };
  Object.keys(ITEMS).forEach(code => { detail.counts[code] = recs.filter(r => r.item_code === code).length; });
  detail.sessions = sumMetric(recs, 'G-MEMBER', 'session_count');
  const wd = recs.filter(r => r.item_code === 'P-WORD');
  detail.wordDays = wd.filter(wordQualified).length;
  detail.wordTotal = wd.reduce((s, r) => s + (Number(r.metric_value) || (r.unverified ? 20 : 0)), 0);
  detail.fullDays = dates.filter(d => dayStat(memberId, d).isFull).length;
  detail.weekendExtra = recs.filter(r => D.weekday(r.biz_date) >= 6 && !requiredItems(memberId, r.biz_date).some(it => it.code === r.item_code)).length;
  const th = {};
  recs.filter(r => r.theme && r.theme.trim()).forEach(r => { th[r.theme.trim()] = 1; });
  detail.themes = Object.keys(th);
  // 自定义目标区
  detail.custom = customTargetDetails(memberId, dates, recs);
  return detail;
}

function longestStreak(memberId, dates) {
  let best = 0, current = 0, previous = '';
  dates.forEach(date => {
    if (previous && date !== D.addDays(previous, 1)) current = 0;
    if (dayStat(memberId, date).isFull) current++;
    else current = 0;
    best = Math.max(best, current);
    previous = date;
  });
  return best;
}

function customTargetDetails(memberId, dates, recs) {
  const activeById = {};
  const actualByIdAndDate = {};
  dates.forEach(date => {
    customTargetsAt(memberId, date).forEach(target => {
      if (!activeById[target.target_id]) activeById[target.target_id] = { target, activeDates: [] };
      activeById[target.target_id].activeDates.push(date);
    });
  });
  recs.forEach(record => {
    const key = record.item_code + ':' + record.biz_date;
    actualByIdAndDate[key] = (actualByIdAndDate[key] || 0) + 1;
  });

  return Object.keys(activeById).map(targetId => {
    const entry = activeById[targetId];
    const datesByCycle = {};
    let actual = 0, needs = 0;
    const cycleTypes = {};
    entry.activeDates.forEach(date => {
      const target = customTargetsAt(memberId, date).find(item => item.target_id === targetId);
      if (!target) return;
      const cycleType = target.cycle_type || 'daily';
      cycleTypes[cycleType] = true;
      const cycleKey = cycleType === 'daily' ? date
        : (cycleType === 'weekly' ? D.weekStart(date)
          : (cycleType === 'monthly' ? date.slice(0, 7) : 'once'));
      if (!datesByCycle[cycleKey]) datesByCycle[cycleKey] = { type: cycleType, dates: [], target, actual: 0 };
      datesByCycle[cycleKey].dates.push(date);
      const dateActual = actualByIdAndDate[targetId + ':' + date] || 0;
      datesByCycle[cycleKey].actual += dateActual;
      actual += dateActual;
    });

    let achieved = true;
    Object.keys(datesByCycle).forEach(cycleKey => {
      const cycle = datesByCycle[cycleKey];
      const amount = Number(cycle.target.cycle_value) || 1;
      let cycleNeed = 0;
      if (cycle.type === 'daily') cycleNeed = 1;
      else if (cycle.type === 'weekly') cycleNeed = amount * cycle.dates.length / 7;
      else if (cycle.type === 'monthly') {
        const year = Number(cycleKey.slice(0, 4)), month = Number(cycleKey.slice(5, 7));
        const monthDays = new Date(year, month, 0).getDate();
        cycleNeed = amount * cycle.dates.length / monthDays;
      } else if (cycle.type === 'once') cycleNeed = 1;
      // Partial report/active cycles are prorated by covered days; the same decimal threshold is displayed and compared.
      needs += cycleNeed;
      if (cycle.type === 'once' ? cycle.actual === 0 : cycle.actual < cycleNeed) achieved = false;
    });

    const target = entry.target;
    const cycleNames = Object.keys(cycleTypes);
    const cycleType = cycleNames.length === 1 ? cycleNames[0] : (cycleNames.length ? 'mixed' : target.cycle_type);
    return {
      target_id: targetId, name: target.name, cycle_type: cycleType,
      cycle_value: target.cycle_value, need: r1(needs), actual,
      achieved: Object.keys(datesByCycle).length > 0 && achieved,
      executed: actual > 0, standard: target.standard_note,
      count_mode: target.count_mode,
    };
  });
}

// 每日完成项趋势
function buildTrend(dates) {
  return dates.map(d => {
    const g = dayStat('guoguo', d), p = dayStat('papa', d), m = dayStat('mama', d);
    return { date: d, label: d.slice(5), guoguo: g.doneTotal, papa: p.doneTotal, mama: m.doneTotal, total: g.doneTotal + p.doneTotal + m.doneTotal, hasAny: g.hasAny || p.hasAny || m.hasAny };
  });
}

// 亮点事件
function buildHighlights(report, dates, type) {
  if (type !== 'month') return [];
  const out = [];
  const gg = report.members.guoguo;
  if (gg && gg.detail.longestStreak >= 14) out.push('果果本月最长连续全勤达 ' + gg.detail.longestStreak + ' 天');
  if (gg && gg.detail.sessions >= 10) out.push('单月会员课达到 ' + gg.detail.sessions + ' 节');
  const mama = report.members.mama;
  if (mama && mama.detail.wordDays >= 20) out.push('妈妈本月单词达标 ' + mama.detail.wordDays + ' 天');
  const swim = gg ? (gg.detail.counts['G-SWIM'] || 0) + (gg.detail.counts['G-SKATE'] || 0) : 0;
  if (swim >= 8) out.push('单月运动打卡达到 ' + swim + ' 次');
  return out.slice(0, 4);
}

// 首页今日汇总
function todaySummary(date) {
  const d = date || D.today();
  const members = store.getFamily().members;
  const groups = members.map(m => {
    const s = dayStat(m.id, d);
    const codes = m.id === 'guoguo' ? GUOGUO_ITEMS : PARENT_ITEMS;
    const rows = codes.map(code => buildRow(m.id, code, d));
    const custom = customTargetsAt(m.id, d).map(t => buildRow(m.id, t.target_id, d, t));
    return Object.assign({}, m, { rows, custom, stat: s });
  });
  const totalRequired = groups.reduce((s, g) => s + g.stat.required, 0);
  const totalDone = groups.reduce((s, g) => s + g.stat.doneRequired, 0);
  const backfill = groups.reduce((s, g) => s + g.stat.backfillCount, 0);
  const full = totalRequired > 0 && totalDone === totalRequired;
  return { date: d, groups, totalRequired, totalDone, rate: pct(totalDone, totalRequired), backfill, full, streak: streak('guoguo', D.addDays(d, -1), D.addDays(d, -60)) };
}

// 构造单项行（供页面渲染，所有计算在此完成）
function buildRow(memberId, code, date, customTarget) {
  const isCustom = !!customTarget;
  const def = ITEMS[code];
  const rec = store.getRecord(memberId, code, date);
  const schedule = policy.getScheduleAt(date, store.getSchedule());
  // 撤销记录（status=2）只在底层保留供审计，界面与统计中必须完全不可见
  const active = rec && rec.status === 1 ? rec : null;
  const done = !!active;
  const row = {
    code, name: isCustom ? customTarget.name : def.name,
    custom: isCustom, done,
    required: isCustom ? customTarget.count_mode === 1 : !!(schedule[code] && schedule[code][D.weekday(date)]),
    kind: isCustom ? 'custom' : def.kind,
    note: active ? active.note : '', value: active ? active.metric_value : null,
    sessionCount: active ? active.session_count : null,
    theme: active ? active.theme : '',
    source: active ? active.source : 0,
    standard: isCustom ? customTarget.standard_note : '',
    standardSnapshot: active ? active.standard_snapshot : '',
    unverified: active ? active.unverified : false,
    targetId: isCustom ? code : '',
  };
  // 单词未达标标记
  if (code === 'P-WORD' && done) {
    let v = active.metric_value;
    if (v === null || v === undefined || v === '' || active.unverified) v = 20;
    row.underTarget = Number(v) < 20;
    row.wordValue = v;
  }
  return row;
}

module.exports = {
  requiredItems, dayStat, streak, itemStreak, effectiveDays, sampleValid,
  dimensions, buildReport, todaySummary, buildRow, wordQualified, pct, r1,
  periodTargetTotals, longestStreak,
};
