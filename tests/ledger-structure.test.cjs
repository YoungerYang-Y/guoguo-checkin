'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

test('记账页入口重构：两视图 + 记一笔动作弹层 + 统一时间状态', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/ledger/ledger.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/ledger/ledger.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/ledger/ledger.js'), 'utf8');
  // 入口：只剩账本 / 看账两个 tab，记一笔不再是 tab
  assert.ok(wxml.includes('data-tab="book"') && wxml.includes('data-tab="view"'), '两入口缺失');
  assert.ok(!wxml.includes('data-tab="add"'), '记一笔仍占 tab');
  assert.ok(wxml.includes('bindtap="openForm"') && wxml.includes('book-add'), '记账动作按钮缺失');
  // 看账：流水 / 占比分段共用一份 period
  assert.ok(wxml.includes('data-mode="list"') && wxml.includes('data-mode="chart"'), '分段缺失');
  assert.ok(wxml.includes('period.scope') && js.includes('period.monthIndex'), '时间状态未收口');
  assert.ok(!/this\.data\.(scope|monthIndex|year)\b/.test(js), '时间状态仍有顶层残留');
  // 弹层：mask + sheet，编辑与新增共用
  assert.ok(wxml.includes('class="mask"') && wxml.includes('form-sheet'), '动作弹层缺失');
  assert.ok(js.includes('showForm: false') && js.includes('returnTab:'), '弹层状态缺失');
  assert.ok(js.includes('openForm()') && js.includes('closeForm()'), '弹层方法缺失');
  assert.ok(!/tab: 'add'/.test(js), '编辑仍跨 tab 跳转');
  // 账本首页：最近记录 + 分类 Top3
  assert.ok(js.includes('recent, topCats') && wxml.includes('最近记录') && wxml.includes('本月花在哪'), '账本首页数据缺失');
  // 触区与规范
  assert.ok(wxss.split('.book-add')[1].split('}')[0].includes('min-height: 128rpx'), '记账按钮尺寸不足');
  assert.ok(wxss.split('.seg {')[1].split('}')[0].includes('min-height: 88rpx'), '分段触区不足');
  assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(wxss), 'WXSS 存在裸色');
  assert.ok(!/style="[^"]*margin/.test(wxml), 'WXML 存在内联间距');
});
