// 统一内容库种子源：诗词正文沿用 poem-library.js 的 20 首定稿，
// 英语 50 张生活场景卡来自 english-seed.js。poems-data.js 的 40 首仅作录入联想，不再单独成库。
// 本模块只读、零存储写入；页面与学习引擎都通过这里取内容。
const poemLib = require('./poem-library.js');
const poemTitles = require('./poems-data.js');
const english = require('./english-seed.js');

const TYPES = {
  poem: { label: '诗词', intervals: [1, 3, 7, 14, 30] },
  english: { label: '英语', intervals: [1, 2, 4, 7, 16] },
};

function seedPoem(p) {
  return {
    id: 'poem_' + p.id,
    type: 'poem',
    primary: p.title,
    secondary: p.author,
    body: p.content,
    meta: {
      dynasty: p.dynasty,
      variant: p.variant || '',
      explain: p.explain || '',
      highlight: p.highlight || '',
      question: p.question || '',
      background: p.background || '',
      clues: (p.clues || []).slice(),
      source: p.source || '',
      tags: ['诗词'],
    },
    origin: 'builtin',
    status: 1,
  };
}

function seedEnglish(c) {
  return {
    id: 'en_' + c.id,
    type: 'english',
    primary: c.en,
    secondary: c.zh,
    body: c.scene,
    meta: {
      title: c.title,
      tag: c.tag,
      scene: c.scene,
      reply: c.reply,
      alt: c.alt,
      prompt: c.prompt,
      tags: [c.tag],
    },
    origin: 'builtin',
    status: 1,
  };
}

const BUILTIN = []
  .concat(poemLib.all().map(seedPoem))
  .concat(english.all().map(seedEnglish));

function norm(s) {
  return String(s || '').replace(/[《》〈〉\s·、，,。．！？!?（）()「」：:；;’‘“”"']/g, '').toLowerCase();
}

function all(type) {
  return BUILTIN.filter(x => !type || x.type === type).map(x => JSON.parse(JSON.stringify(x)));
}

function byId(id) {
  const hit = BUILTIN.find(x => x.id === id);
  return hit ? JSON.parse(JSON.stringify(hit)) : null;
}

function firstLine(body) {
  return String(body || '').split('\n')[0].replace(/[，,。．！？!?、]/g, '');
}

// role='agent' style search: title/primary 优先，其次正文/线索/讲解。
function search(keyword, type) {
  const q = norm(keyword);
  const list = all(type);
  if (!q) return list.map(x => Object.assign(x, { matchType: '' }));
  const out = [];
  list.forEach(x => {
    const m = x.meta || {};
    let matchType = '';
    if (norm(x.primary).indexOf(q) >= 0 || norm(m.title).indexOf(q) >= 0) matchType = '标题';
    else if (norm(x.secondary).indexOf(q) >= 0 || norm(m.author).indexOf(q) >= 0) matchType = '释义';
    else if ((m.clues || []).some(c => norm(c).indexOf(q) >= 0) || (m.tags || []).some(t => norm(t).indexOf(q) >= 0)) matchType = '线索';
    else if (norm(x.body).indexOf(q) >= 0 || norm(m.scene).indexOf(q) >= 0) matchType = '场景';
    else if (norm(m.reply).indexOf(q) >= 0 || norm(m.alt).indexOf(q) >= 0 || norm(m.prompt).indexOf(q) >= 0) matchType = '对话';
    else if (norm(m.explain).indexOf(q) >= 0 || norm(m.highlight).indexOf(q) >= 0) matchType = '讲解';
    if (matchType) out.push(Object.assign(x, { matchType }));
  });
  return out;
}

function titleHints() { return poemTitles.POEMS.slice(); }
function findPoem(title, author) { return poemTitles.findPoem(title, author); }
function tags(type) {
  const out = [];
  all(type).forEach(x => (x.meta && x.meta.tags || []).forEach(t => { if (out.indexOf(t) < 0) out.push(t); }));
  return out;
}

module.exports = {
  TYPES, BUILTIN, all, byId, search, firstLine, titleHints, findPoem, tags, norm,
};
