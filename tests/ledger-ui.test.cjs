'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

test('记账页视觉：账本 hero / 分组 / 防重 / 错误态 / 色条 / 语义卡 / 趋势', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/ledger/ledger.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/ledger/ledger.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/ledger/ledger.js'), 'utf8');
  // 结构：账本 hero + 两组表单（弹层内）
  assert.ok(wxml.includes('book-hero'), '账本 hero 缺失');
  assert.ok(wxml.includes('这笔花在哪') && wxml.includes('花了多少'), '表单语义分组缺失');
  // 状态：防重 + 表单错误条 + 金额错误态
  assert.ok(wxml.includes("saving ? 'is-loading'"), '保存防重 UI 缺失');
  assert.ok(wxml.includes('form-alert') && wxml.includes('{{formError}}'), '表单错误条缺失');
  assert.ok(wxml.includes("amountError ? 'is-error'"), '金额错误态未接全局类');
  assert.ok(js.includes('saving: false') && js.includes('formError:'), 'UI 状态字段缺失');
  // 明细：分类色条 + 较上月趋势
  assert.ok(wxml.includes('tone-{{item.catTone}}') && wxss.includes('.tone-pink'), '分类色条缺失');
  assert.ok(wxml.includes('sum-trend') && wxml.includes('monthTrendDir'), '趋势 chip 缺失');
  assert.ok(js.includes('catTone(') && js.includes('prevMonthKey('), 'UI 计算缺失');
  // 汇总：语义底色卡 + Top3 强调
  assert.ok(wxml.includes('sum-card-members') && wxml.includes('sum-card-cats') && wxml.includes('sum-card-months'), '语义卡缺失');
  assert.ok(wxss.includes('.bar-row.is-top .bar-fill'), 'Top3 强调缺失');
  // 触区：删除按钮 88rpx
  const del = wxss.split('.led-del')[1].split('}')[0];
  assert.ok(del.includes('min-height: 88rpx'), '删除按钮触区不足');
  // 规范：无裸色、无静态内联间距（动态宽度例外）
  assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(wxss), 'WXSS 存在裸色');
  assert.ok(!/style="[^"]*margin/.test(wxml), 'WXML 存在内联间距');
});
