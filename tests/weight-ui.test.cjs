'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

test('体重页 A 方向改版：hero / 分组 / 防重 / 错误态 / 常驻数值 / 触区', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/weight/weight.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/weight/weight.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/weight/weight.js'), 'utf8');
  // 结构：hero + 两个语义分组
  assert.ok(wxml.includes('weight-hero'), '成长 hero 缺失');
  assert.ok(wxml.includes('hero.weight') && wxml.includes('hero.height'), 'hero 数值未绑定');
  assert.ok(wxml.includes('记什么') && wxml.includes('看哪段'), '录入语义分组缺失');
  // 状态：防重 + 行内错误
  assert.ok(wxml.includes("saving ? 'is-loading'"), '保存防重 UI 缺失');
  assert.ok(wxml.includes("errorField === 'weight' ? 'is-error'"), '体重错误态未接全局类');
  assert.ok(wxml.includes('field-error'), '行内错误文案缺失');
  assert.ok(js.includes('buildHero()') && js.includes('clearError('), 'UI 状态方法缺失');
  // 图表：常驻数值 + 氛围层
  assert.ok(wxml.includes('dot-value') && wxml.includes('item.showLabel'), '曲线常驻数值缺失');
  assert.ok(js.includes('showLabel'), '数值标记逻辑缺失');
  assert.ok(wxss.includes('.chart-aura'), '曲线氛围层缺失');
  // 触区：删除按钮 88rpx、图例 88rpx，全局 chip 接管胶囊
  const recDel = wxss.split('.rec-del')[1].split('}')[0];
  assert.ok(recDel.includes('min-height: 88rpx'), '删除按钮触区不足');
  const legendItem = wxss.split('.legend-item')[1].split('}')[0];
  assert.ok(legendItem.includes('min-height: 88rpx'), '图例触区不足');
  assert.ok(!wxml.includes('mode-chip'), '仍在用页面私有小胶囊');
  // 规范：无裸色、无内联间距
  assert.ok(!/#[0-9A-Fa-f]{3,8}\b/.test(wxss), 'WXSS 存在裸色');
  assert.ok(!/style="[^"]*margin/.test(wxml), 'WXML 存在内联间距');
});
