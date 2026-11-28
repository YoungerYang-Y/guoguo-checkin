const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const lib = require(path.join(root, 'utils/poem-library.js'));

test('诗词库预置 20 首，关键字段完整且 id 唯一', () => {
  assert.equal(lib.all().length, 20);
  const ids = new Set();
  lib.all().forEach(p => {
    assert.ok(p.id && p.title && p.dynasty && p.author, p.title + ' 基本信息');
    assert.ok(!ids.has(p.id), 'id 重复：' + p.id);
    ids.add(p.id);
    assert.ok(p.content && p.content.split('\n').length >= 2, p.title + ' 原文');
    assert.ok(p.explain && p.highlight && p.question, p.title + ' 讲解/金句/提问');
    assert.ok(Array.isArray(p.clues) && p.clues.length > 0, p.title + ' 线索');
    assert.ok(/^https?:\/\//.test(p.source), p.title + ' 来源');
  });
});

test('首句取正文第一行并去掉句末标点', () => {
  assert.equal(lib.firstLine(lib.byId('momei')), '我家洗砚池头树');
  assert.equal(lib.firstLine(lib.byId('gulangyuexing')), '小时不识月');
  assert.equal(lib.firstLine(lib.byId('lichun')), '东风吹散梅梢雪');
});

test('按篇名检索，标注命中类型', () => {
  const r = lib.search('墨梅');
  assert.ok(r.length >= 1);
  assert.equal(r[0].id, 'momei');
  assert.equal(r[0].matchType, '篇名');
});

test('按首句检索', () => {
  const r = lib.search('东风吹散梅梢雪');
  assert.equal(r[0].id, 'lichun');
  assert.equal(r[0].matchType, '首句');
});

test('按画面线索检索（口语化说法也能命中）', () => {
  assert.equal(lib.search('追蝴蝶')[0].id, 'suxinshi');
  assert.equal(lib.search('白玉盘')[0].id, 'gulangyuexing');
  assert.equal(lib.search('满河星')[0].id, 'zhouyeshuojian');
  assert.equal(lib.search('送朋友')[0].id, 'zengwanglun');
});

test('按正文与讲解检索', () => {
  assert.equal(lib.search('银河落九天')[0].id, 'wanglushanpubu');
  assert.equal(lib.search('知己')[0].id, 'biedongda');
});

test('书名号与空格归一化，空关键词返回全部', () => {
  assert.equal(lib.search('《墨梅》')[0].id, 'momei');
  assert.equal(lib.search('   ').length, 20);
});

test('无匹配返回空，byId 未知返回 null', () => {
  assert.equal(lib.search('完全不存在的诗句').length, 0);
  assert.equal(lib.byId('nope'), null);
});

test('版本说明与故事背景按清单保留', () => {
  assert.ok(lib.byId('chusaise').background.includes('边关'));
  assert.ok(lib.byId('guohuaqinggong').background.includes('杨贵妃'));
  assert.ok(lib.byId('lichun').variant.includes('东风吹散梅梢雪'));
  assert.ok(lib.byId('yongliu').clues.includes('春风像剪刀'));
});

test('诗词库是纯数据模块，不依赖 store / 复习库，不会写入复习状态', () => {
  const src = fs.readFileSync(path.join(root, 'utils/poem-library.js'), 'utf8');
  assert.ok(!/require\s*\(/.test(src), '诗词库不应 require 任何模块');
  assert.ok(!/\bsetItem\b|\bwx\.setStorage\b/.test(src), '诗词库不应写本地存储');
});


test('诗词库页面 mock 冒烟：检索与详情字段对齐 WXML', () => {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(root, 'pages/poem-library/poem-library.js'), 'utf8');
  let def;
  vm.runInNewContext(source, {
    Page(v) { def = v; },
    wx: { showToast() {}, pageScrollTo() {} },
    require(name) {
      if (name === '../../utils/poem-library.js') return lib;
      throw new Error('unexpected module ' + name);
    },
    Object, String, Number, Array, Error, Date, Math,
  }, { filename: path.join(root, 'pages/poem-library/poem-library.js') });
  const page = Object.assign({}, def, {
    data: structuredClone(def.data),
    setData(v) { Object.assign(this.data, v); },
  });
  page.onLoad();
  assert.equal(page.data.libTotal, 20);
  assert.equal(page.data.total, 20);
  assert.equal(page.data.list.length, 20);
  page.refresh('白玉盘');
  assert.equal(page.data.total, 1);
  assert.equal(page.data.list[0].id, 'gulangyuexing');
  page.openDetail({ currentTarget: { dataset: { id: 'momei' } } });
  assert.equal(page.data.view, 'detail');
  assert.equal(page.data.detail.title, '墨梅');
  assert.equal(page.data.detail.contentLines.length, 4);
  ['title', 'dynasty', 'author', 'variant', 'explain', 'highlight', 'question', 'clues', 'source']
    .forEach(k => assert.ok(k in page.data.detail, k));
  page.backToList();
  assert.equal(page.data.view, 'list');
  assert.equal(page.data.detail, null);
});
