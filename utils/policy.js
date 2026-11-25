const D = require('./date.js');

const HISTORY_KEY = '__history';

function clone(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function currentValue(value) {
  const out = clone(value);
  delete out[HISTORY_KEY];
  return out;
}

function readStored(key) {
  try {
    const value = wx.getStorageSync(key);
    return value && typeof value === 'object' ? value : {};
  } catch (e) {
    return {};
  }
}

function valueAt(raw, date) {
  const source = raw || {};
  const history = Array.isArray(source[HISTORY_KEY]) ? source[HISTORY_KEY] : [];
  let selected = null;
  history.slice().sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)))
    .forEach(entry => {
      if (entry && entry.value && String(entry.effectiveFrom) <= date) selected = entry.value;
    });
  return currentValue(selected || source);
}

function getScheduleAt(date, raw) {
  return valueAt(raw === undefined ? readStored('gg_schedule') : raw, date);
}

function getTargetsAt(date, raw) {
  return valueAt(raw === undefined ? readStored('gg_targets') : raw, date);
}

function stage(current, effectiveFrom, update) {
  const latest = currentValue(current);
  const history = Array.isArray(current && current[HISTORY_KEY])
    ? current[HISTORY_KEY].map(entry => ({ effectiveFrom: entry.effectiveFrom, value: currentValue(entry.value) }))
    : [{ effectiveFrom: '0000-01-01', value: currentValue(current) }];
  const next = currentValue(latest);
  update(next);
  const replacement = { effectiveFrom, value: currentValue(next) };
  const index = history.findIndex(entry => entry.effectiveFrom === effectiveFrom);
  if (index >= 0) history[index] = replacement;
  else history.push(replacement);
  history.sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)));
  next[HISTORY_KEY] = history;
  return next;
}

function stageScheduleChange(current, code, dow, value, today) {
  return stage(current, D.addDays(today, 1), next => {
    next[code] = Object.assign({}, next[code] || {});
    next[code][dow] = value ? 1 : 0;
  });
}

function stageTargetChange(current, code, value, today) {
  const nextWeek = D.addDays(D.weekStart(today), 7);
  return stage(current, nextWeek, next => { next[code] = Math.max(0, Number(value) || 0); });
}

function customTargetAt(target, date) {
  const current = valueAt(target || {}, date);
  if (current.status !== 1) return null;
  if (current.start_date && date < current.start_date) return null;
  if (current.end_date && date > current.end_date) return null;
  return current;
}

module.exports = {
  HISTORY_KEY, getScheduleAt, getTargetsAt,
  stageScheduleChange, stageTargetChange, customTargetAt,
};
