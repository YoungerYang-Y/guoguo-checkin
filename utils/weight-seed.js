// 果果身高体重历史测量种子：13 条原始记录（2022-11-15 ~ 2026-11-13）。
// 由家长提供，已去重，未补录或修正原始数值。
//
// 存储约定（与 utils/extra.js、sync-merge.js 一致）：
//   - gg_weights 以「成员 + 年月(ym)」为唯一键，一条记录同时带身高与体重；
//   - 13 条测量各在不同月份，一一对应，不影响合并去重；
//   - 具体测量日期与当时年龄没有独立字段，写进 note（页面「最近记录」会展示），
//     避免为了存日期改动 existing 图表/表格的数据结构；
//   - updated_at 用测量当天，日后家长在页面修改同月数据时时间戳更新，不会被种子盖回。
const store = require('./store.js');

const MEMBER = 'guoguo';
const BIRTH_YM = '2022-11'; // 出生 2022-11-15；extra.setGuoguoBirth 只接受 YYYY-MM

// date 测量日期 / age 当时年龄 / ym 存储年月 / h 身高(cm) / w 体重(kg)
const ROWS = [
  { date: '2022-11-15', age: '出生',          ym: '2022-11', h: 52.0,  w: 3.42 },
  { date: '2022-12-15', age: '1个月',         ym: '2022-12', h: 55.7,  w: 4.65 },
  { date: '2023-01-18', age: '2个月3天',      ym: '2023-01', h: 60.6,  w: 6.22 },
  { date: '2023-03-19', age: '4个月4天',      ym: '2023-03', h: 65.5,  w: 7.30 },
  { date: '2023-04-21', age: '5个月6天',      ym: '2023-04', h: 67.0,  w: 7.80 },
  { date: '2023-05-21', age: '6个月6天',      ym: '2023-05', h: 69.5,  w: 8.00 },
  { date: '2023-07-15', age: '8个月',         ym: '2023-07', h: 72.0,  w: 9.00 },
  { date: '2023-11-11', age: '11个月27天',    ym: '2023-11', h: 76.0,  w: 9.70 },
  { date: '2024-05-15', age: '1岁6个月',      ym: '2024-05', h: 85.0,  w: 10.70 },
  { date: '2024-11-25', age: '2岁10天',       ym: '2024-11', h: 90.4,  w: 12.20 },
  { date: '2025-06-15', age: '2岁7个月',      ym: '2025-06', h: 96.5,  w: 12.80 },
  { date: '2025-11-02', age: '2岁11个月18天', ym: '2025-11', h: 98.3,  w: 13.00 },
  { date: '2026-11-13', age: '3岁11个月29天', ym: '2026-11', h: 104.9, w: 15.90 },
];

function ensureSeeded() {
  const stored = store.read(store.KEYS.WEIGHTS, []);
  const list = Array.isArray(stored) ? stored.slice() : [];
  const seen = {};
  list.forEach(x => { if (x && x.member_id === MEMBER && x.ym) seen[x.ym] = true; });

  let added = 0;
  ROWS.forEach(r => {
    if (seen[r.ym]) return; // 该月已有记录（手录或云端同步），不覆盖，防止种子回填旧值
    const t = r.date + 'T00:00:00.000Z';
    list.push({
      id: 'seed_w_' + r.ym,
      member_id: MEMBER,
      ym: r.ym,
      height: r.h,
      weight: r.w,
      note: r.date + ' · ' + r.age,
      created_at: t,
      updated_at: t,
      source: 'seed',
    });
    added++;
  });
  if (added) store.write(store.KEYS.WEIGHTS, list);

  // 出生年月只到月（extra.setGuoguoBirth 的校验口径），日信息已保存在 2022-11 的 note 里
  let birthSet = false;
  const settings = store.read(store.KEYS.EXTRA_SETTINGS, null);
  if (!settings || !settings.guoguoBirth) {
    const r = store.write(store.KEYS.EXTRA_SETTINGS,
      Object.assign({}, settings && typeof settings === 'object' ? settings : {}, { guoguoBirth: BIRTH_YM }));
    birthSet = !r.error;
  }
  return { added, total: list.length, birthSet };
}

module.exports = { ROWS, BIRTH_YM, MEMBER, ensureSeeded };
