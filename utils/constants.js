// 打卡项与成员字典（对应需求文档附录 A）
const MEMBERS = [
  { id: 'guoguo', name: '果果', role: 'child', color: '#F58AAE', light: '#FFEDF4' },
  { id: 'papa', name: '爸爸', role: 'parent', color: '#61DDAA', light: '#E8F8F1' },
  { id: 'mama', name: '妈妈', role: 'admin', color: '#F6BD16', light: '#FFF6DC' },
];

// 内置打卡项定义
const ITEMS = {
  'G-READ':  { code: 'G-READ',  name: '阅读课',   owner: 'guoguo', kind: 'toggle', defaultRequired: true },
  'G-THINK': { code: 'G-THINK', name: '思维课',   owner: 'guoguo', kind: 'toggle', defaultRequired: true },
  'G-ENG':   { code: 'G-ENG',   name: '英语课',   owner: 'guoguo', kind: 'toggle', defaultRequired: true },
  'G-ART':   { code: 'G-ART',   name: '绘画课',   owner: 'guoguo', kind: 'art',    defaultRequired: false, category: 'art' },
  'G-MEMBER':{ code: 'G-MEMBER',name: '会员课',   owner: 'guoguo', kind: 'session', defaultRequired: true },
  'G-SKATE': { code: 'G-SKATE', name: '轮滑课',   owner: 'guoguo', kind: 'metric', defaultRequired: false, category: 'sport' },
  'G-SWIM':  { code: 'G-SWIM',  name: '游泳课',   owner: 'guoguo', kind: 'metric', defaultRequired: false, category: 'sport' },
  'P-AI':    { code: 'P-AI',    name: 'AI 学习',  owner: 'parent', kind: 'study', defaultRequired: true },
  'P-WORD':  { code: 'P-WORD',  name: '背诵 20 个英语单词', owner: 'parent', kind: 'word', defaultRequired: true },
  'P-SWIM':  { code: 'P-SWIM',  name: '游泳',     owner: 'parent', kind: 'metric', defaultRequired: true, category: 'sport' },
};

// 果果区固定顺序
const GUOGUO_ITEMS = ['G-READ', 'G-THINK', 'G-ENG', 'G-ART', 'G-MEMBER', 'G-SKATE', 'G-SWIM'];
// 家长区三项
const PARENT_ITEMS = ['P-AI', 'P-WORD', 'P-SWIM'];

// 默认周目标
const DEFAULT_WEEKLY_TARGETS = {
  'G-ART': 1, 'G-MEMBER': 2, 'G-SKATE': 2, 'G-SWIM': 2,
  'P-AI': 5, 'P-WORD': 5, 'P-SWIM': 2,
};

// 默认排期：周一至周四(1-4)阅读思维英语必修，其余选修
function defaultSchedule() {
  const plan = {};
  GUOGUO_ITEMS.forEach(code => {
    plan[code] = {};
    for (let d = 1; d <= 7; d++) {
      plan[code][d] = ITEMS[code].defaultRequired && d <= 4 ? 1 : 0;
    }
  });
  // 家长三项默认每日必修
  PARENT_ITEMS.forEach(code => {
    plan[code] = {};
    for (let d = 1; d <= 7; d++) plan[code][d] = 1;
  });
  return plan;
}

// 进步空间建议规则（固定文案模板）
const ADVICE_RULES = {
  completion: '本周有 {n} 项必修没完成，集中在阅读课；建议把阅读课固定在晚饭后同一时段。',
  continuity: '中断主要发生在周末；周末只保留 1 项必修，先把连续天数续上。',
  goal: '会员课本月 {x} 节，目标 8 节；建议每周固定两晚加周末一节。',
  breadth: '本月只覆盖了轮滑一类，游泳与绘画都未开始；建议每周固定一次绘画、每月安排 2 次游泳。',
  ai: '本周 AI 学习 {x} 天；建议改为每天 20 分钟固定时段，与孩子的阅读课同步。',
};

module.exports = {
  MEMBERS, ITEMS, GUOGUO_ITEMS, PARENT_ITEMS,
  DEFAULT_WEEKLY_TARGETS, defaultSchedule, ADVICE_RULES,
};
