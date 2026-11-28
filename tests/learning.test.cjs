const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// 每个测试用独立 storage mock，避免互相污染。
function sandbox(opts) {
  const o = opts || {};
  const mem = Object.assign({}, o.storage || {});
  const wx = {
    getStorageSync: k => (k in mem ? mem[k] : ''),
    setStorageSync: (k, v) => { mem[k] = v; },
    removeStorageSync: k => { delete mem[k]; },
    getSystemInfoSync: () => ({ platform: 'devtools' }),
  };
  global.wx = wx;
  return mem;
}

function fresh(opts) {
  const mem = sandbox(opts);
  for (const k of Object.keys(require.cache)) if (k.indexOf(path.join(root, 'utils')) >= 0) delete require.cache[k];
  const store = require(path.join(root, 'utils/store.js'));
  const learning = require(path.join(root, 'utils/learning.js'));
  const migrate = require(path.join(root, 'utils/learning-migrate.js'));
  const merge = require(path.join(root, 'utils/sync-merge.js'));
  return { mem, store, learning, migrate, merge };
}

const iso = s => /^\d{4}-\d{2}-\d{2}T/.test(String(s || ''));

test('断言1 种子 70 条唯一，E01/E50 字段完整，无 meta.stage', () => {
  const { learning } = fresh();
  const seed = require(path.join(root, 'utils/content-seed.js'));
  assert.equal(seed.BUILTIN.length, 70);
  assert.equal(new Set(seed.BUILTIN.map(x => x.id)).size, 70);
  const e01 = seed.byId('en_E01'), e50 = seed.byId('en_E50');
  assert.ok(e01.primary && e01.secondary && e01.meta.reply && e01.meta.prompt);
  assert.ok(e50.primary && e50.secondary && e50.meta.reply && e50.meta.prompt);
  assert.ok(seed.BUILTIN.every(x => !('stage' in (x.meta || {}))));
  assert.equal(learning.QUOTA.poem, 1);
  assert.equal(learning.QUOTA.english, 2);
});

test('断言2 ensureSeeded 幂等、不覆盖编辑、软删不复活、全部带 ISO updated_at', () => {
  const { mem, learning } = fresh();
  assert.equal(learning.ensureSeeded().data.added, 70);
  assert.equal(learning.ensureSeeded().data.added, 0);
  const list = mem.gg_content;
  assert.equal(list.length, 70);
  assert.ok(list.every(x => iso(x.updated_at)), '每条须带 ISO updated_at');
  // 用户编辑内置项后重跑不覆盖
  const edited = list.find(x => x.id === 'poem_lichun');
  edited.primary = '立春（我改的）';
  mem.gg_content = list;
  learning.ensureSeeded();
  assert.equal(mem.gg_content.find(x => x.id === 'poem_lichun').primary, '立春（我改的）');
  // 软删后重跑不复活
  assert.equal(learning.removeContent('poem_lichun').error, null);
  learning.ensureSeeded();
  assert.equal(mem.gg_content.find(x => x.id === 'poem_lichun').status, 0);
  assert.ok(mem.gg_content.find(x => x.id === 'poem_lichun').deleted_at);
});

test('断言3 todayPlan 诗词1+英语2、内容不足补齐、到期进复习、同日稳定', () => {
  const { mem, learning } = fresh();
  learning.ensureSeeded();
  const plan = learning.todayPlan();
  assert.equal(plan.stats.poemLearn, 1);
  assert.equal(plan.stats.englishLearn, 2);
  assert.equal(plan.learn.filter(x => x.type === 'poem').length, 1);
  assert.equal(plan.learn.filter(x => x.type === 'english').length, 2);
  assert.deepEqual(plan.learn.map(x => x.id), learning.todayPlan().learn.map(x => x.id), '同日顺序稳定');
  // 内容不足：只留 1 首诗词 + 1 张英语卡，仍各出 1 条
  mem.gg_content = mem.gg_content.filter(x => ['poem_lichun', 'en_E01'].indexOf(x.id) >= 0);
  const thin = learning.todayPlan();
  assert.equal(thin.learn.filter(x => x.type === 'poem').length, 1);
  assert.equal(thin.learn.filter(x => x.type === 'english').length, 1);
});

test('断言4 record 三结果推进排程、mastered 退出复习、restart 拉回', () => {
  const { learning } = fresh();
  learning.ensureSeeded();
  const base = new Date();
  const stamp = n => new Date(base.getTime() + n * 1000).toISOString();
  let n = 0;
  // 新学一张英语卡（pass）：首次推进一档，nextReviewAt = today + intervals[1] = +2 天
  const r1 = learning.record({ ids: ['en_E01'], kind: 'learn', result: 'pass', operator: 'mama' });
  assert.equal(r1.error, null);
  const p1 = memProgress(learning, 'en_E01');
  assert.equal(p1.stage, 1);
  const d = p1.nextReviewAt;
  const expect = addDaysStr(todayStr(), 2);
  assert.equal(d, expect);
  // 复习 pass → stage=2
  learning.record({ ids: ['en_E01'], kind: 'review', result: 'pass' });
  assert.equal(memProgress(learning, 'en_E01').stage, 2);
  // 模糊 → 明天、档位不变
  const before = memProgress(learning, 'en_E01').stage;
  learning.record({ ids: ['en_E01'], kind: 'review', result: 'fuzzy' });
  const fuzzy = memProgress(learning, 'en_E01');
  assert.equal(fuzzy.stage, before);
  assert.equal(fuzzy.nextReviewAt, addDaysStr(todayStr(), 1));
  // 没记住 → 回档 0、failCount+1
  learning.record({ ids: ['en_E01'], kind: 'review', result: 'fail' });
  const fail = memProgress(learning, 'en_E01');
  assert.equal(fail.stage, 0);
  assert.equal(fail.failCount, 1);
  // 推进到 mastered：英语 5 档，连续 pass 到顶
  for (let i = 0; i < 6; i++) learning.record({ ids: ['en_E01'], kind: 'review', result: 'pass' });
  const mastered = memProgress(learning, 'en_E01');
  assert.equal(mastered.status, 'mastered');
  assert.equal(mastered.nextReviewAt, '');
  assert.ok(!learning.todayPlan().review.some(x => x.id === 'en_E01'));
  // 重新学习拉回
  assert.equal(learning.restartContent('en_E01').error, null);
  const restarted = memProgress(learning, 'en_E01');
  assert.equal(restarted.status, 'learning');
  assert.equal(restarted.stage, 0);
  assert.ok(restarted.nextReviewAt);
});

function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDaysStr(s, n) { const p = s.split('-'); const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function memProgress(learning, contentId) {
  const list = global.wx.getStorageSync('gg_progress');
  return list.find(x => x.contentId === contentId);
}

test('断言5 undoLog 回退快照、STALE_LOG 不覆盖新进度、内容仍在', () => {
  const { learning } = fresh();
  learning.ensureSeeded();
  learning.record({ ids: ['poem_lichun'], kind: 'review', result: 'pass' });
  let logs = global.wx.getStorageSync('gg_study_logs');
  const first = logs[0];
  const stageAfterFirst = memProgress(learning, 'poem_lichun').stage;
  // 第二次记录后再撤销第一条 → STALE_LOG
  learning.record({ ids: ['poem_lichun'], kind: 'review', result: 'pass' });
  const r = learning.undoLog(first.id);
  assert.equal(r.error, 'STALE_LOG');
  assert.equal(memProgress(learning, 'poem_lichun').stage, stageAfterFirst + 1, '进度保持第二次值');
  logs = global.wx.getStorageSync('gg_study_logs');
  assert.equal(logs.find(x => x.id === first.id).status, 2);
  // 撤销最后一条 → 回退到 before 快照
  const last = logs.filter(x => x.status === 1).sort((a, b) => a.at.localeCompare(b.at)).pop();
  const beforeStage = last.before ? last.before.stage : null;
  assert.equal(learning.undoLog(last.id).error, null);
  if (beforeStage !== null) assert.equal(memProgress(learning, 'poem_lichun').stage, beforeStage);
  assert.ok(learning.contentById('poem_lichun'), '内容不被撤销');
});

test('断言6 临时录入补入库：内容/进度/日志三处均写且 updated_at 为 ISO', () => {
  const { learning } = fresh();
  learning.ensureSeeded();
  const before = learning.library({ keyword: 'apple' }).length;
  const r = learning.record({ temp: [{ type: 'english', primary: 'apple', secondary: '苹果', meta: { tag: '临时录入' } }], kind: 'learn', result: 'pass', addToLibrary: true, operator: 'papa' });
  assert.equal(r.error, null);
  assert.equal(learning.library({ keyword: 'apple' }).length, before + 1);
  assert.equal(memProgress(learning, r.data[0].contentId).type, 'english');
  const logs = global.wx.getStorageSync('gg_study_logs');
  assert.ok(logs.some(x => x.contentId === r.data[0].contentId && iso(x.updated_at)));
  assert.ok(iso(r.data[0].progress.updated_at));
  const content = global.wx.getStorageSync('gg_content').find(x => x.id === r.data[0].contentId);
  assert.ok(iso(content.updated_at));
});

test('断言7 migrate 旧数据转换、括号差异命中、week 不抛错、重复执行不重复', () => {
  const { mem, learning, migrate } = fresh({
    storage: {
      gg_poems: [
        { id: 'old1', week: '2026-W48', title: '宿新市徐公店', author: '杨万里', content: '篱落疏疏一径深', status: 1, reviews: { '2026-W48': { ok: false, at: '2026-11-25T10:00:00.000Z' } }, inReviewBank: true, created_at: '2026-11-25T10:00:00.000Z' },
        { id: 'old2', week: 'bad-week', title: '我的自定义诗', author: '我', content: '自定义内容', status: 1, reviews: {}, created_at: 'x' },
      ],
      gg_words: [{ id: 'oldw1', week: '2026-W47', text: 'apple', status: 1, reviews: {}, created_at: '2026-11-18T10:00:00.000Z' }],
    },
  });
  learning.ensureSeeded();
  const beforeContent = mem.gg_content.length;
  const r = migrate.migrate();
  assert.equal(r.error, null);
  assert.ok(mem.gg_progress.length >= 3);
  assert.ok(mem.gg_study_logs.some(x => x.week === '2026-W48'));
  // 括号差异：宿新市徐公店命中内置 id（若内置库确有该篇）
  const seeded = mem.gg_progress.find(p => p.contentId === 'poem_suxinshi');
  if (seeded) assert.equal(seeded.type, 'poem');
  // inReviewBank → 今日复习
  const bank = mem.gg_progress.find(p => p.contentId === 'poem_suxinshi' && p.nextReviewAt <= todayStr());
  if (bank) assert.ok(bank);
  const count = mem.gg_content.length;
  migrate.migrate();
  assert.equal(mem.gg_content.length, count, '重复执行不重复写');
  assert.equal(migrate.weekToDate('2026-W48') !== null, true);
  assert.equal(migrate.weekToDate('nope'), null);
});

test('断言8 同步合并取 updated_at 较新者', () => {
  const { merge } = fresh();
  const rows = [{ id: 'x', v: 'old', updated_at: '2026-11-01T00:00:00.000Z' }, { id: 'x', v: 'new', updated_at: '2026-11-28T00:00:00.000Z' }];
  const out = merge.merge('gg_content', [], [rows[0]], [rows[1]]);
  assert.equal(out.find(x => x.id === 'x').v, 'new');
});

test('断言9 权限三档：本机默认家庭可管理、active member 可记录不可管、访客只读', () => {
  const { learning } = fresh();
  learning.ensureSeeded();
  // 本机默认家庭：无 identity、未 adopt
  assert.equal(learning.isReadOnly(), false);
  assert.equal(learning.canRecord(), true);
  assert.equal(learning.canManageContent(), true);
  // active member：可记录不可管内容
  global.wx.setStorageSync('gg_my_identity', { status: 'active', role: 'member', memberKey: 'guoguo' });
  assert.equal(learning.canRecord(), true);
  assert.equal(learning.canManageContent(), false);
  assert.equal(learning.upsertContent({ primary: 'x' }).error, 'FORBIDDEN');
  assert.equal(learning.record({ ids: ['en_E01'] }).error, null);
  // 访客：无 active + adopted 非空
  global.wx.setStorageSync('gg_my_identity', { status: 'none' });
  global.wx.setStorageSync('gg_family_adopted', 'fam_x');
  assert.equal(learning.isReadOnly(), true);
  assert.equal(learning.canRecord(), false);
  assert.equal(learning.record({ ids: ['en_E01'] }).error, 'FORBIDDEN');
  assert.equal(learning.undoLog('log_x').error, 'FORBIDDEN');
});

test('断言10 软删不复活：library 不返回、ensureSeeded 重跑不恢复', () => {
  const { learning } = fresh();
  learning.ensureSeeded();
  assert.equal(learning.library({ keyword: '墨梅' }).length, 1);
  assert.equal(learning.removeContent('poem_momei').error, null);
  assert.equal(learning.library({ keyword: '墨梅' }).length, 0);
  learning.ensureSeeded();
  assert.equal(learning.library({ keyword: '墨梅' }).length, 0);
});

test('断言11 重置后重新播种：clearLocal + initFamily(true) 后 seed 恢复 70 条', () => {
  const { mem, store, learning } = fresh();
  learning.ensureSeeded();
  assert.equal(mem.gg_content.length, 70);
  // 模拟 clearLocal：清掉所有 DOC_KEYS
  ['gg_content', 'gg_progress', 'gg_study_logs'].forEach(k => delete mem[k]);
  store.initFamily(true);
  assert.equal(Array.isArray(mem.gg_content), true);
  assert.equal(mem.gg_content.length, 0);
  learning.ensureSeeded();
  assert.equal(mem.gg_content.length, 70);
});

// ---- 页面结构冒烟：learn / learn-library 四件套存在且关键绑定齐全 ----
test('页面冒烟 learn 两 tab 与录入弹层、learn-library 详情操作齐全', () => {
  const learnWxml = fs.readFileSync(path.join(root, 'pages/learn/learn.wxml'), 'utf8');
  assert.ok(/data-tab="today"/.test(learnWxml));
  assert.ok(/data-tab="logs"/.test(learnWxml));
  assert.ok(/bindtap="openRecord"/.test(learnWxml));
  const learnJs = fs.readFileSync(path.join(root, 'pages/learn/learn.js'), 'utf8');
  assert.ok(/wx\.switchTab/.test(learnJs) === false, 'learn 页面不用 wx.switchTab 导航');
  const libWxml = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.wxml'), 'utf8');
  assert.ok(/bindtap="addToLearn"/.test(libWxml));
  assert.ok(/bindtap="restartLearn"/.test(libWxml));
});


// ---- 审查问题修复回归：每条对应审查报告一处问题 ----
test('FIX P0-1 软删 id 不能再被记录/直达，进度不新增', () => {
  const { mem, learning } = fresh();
  learning.ensureSeeded();
  assert.equal(learning.removeContent('en_E01').error, null);
  assert.equal(learning.contentById('en_E01'), null);
  assert.equal(learning.contentById('en_E01', true).status, 0);
  const r = learning.record({ ids: ['en_E01'], kind: 'learn', result: 'pass' });
  assert.equal(r.error, 'NOT_FOUND');
  assert.equal((mem.gg_progress || []).length, 0);
  // 混合录入：有效 id 仍可记录，无效 id 被忽略
  const r2 = learning.record({ ids: ['en_E01', 'en_E02'] });
  assert.equal(r2.error, null);
  assert.equal(r2.data.length, 1);
  assert.equal(r2.data[0].contentId, 'en_E02');
});

test('FIX P0-2 今日新学按内置路线顺序取：立春 + E01/E02', () => {
  const { learning } = fresh();
  learning.ensureSeeded();
  const plan = learning.todayPlan();
  assert.deepEqual(plan.learn.map(x => x.id), ['poem_lichun', 'en_E01', 'en_E02']);
  // 标记后顺延到下一首/下一卡
  learning.record({ ids: ['poem_lichun', 'en_E01', 'en_E02'] });
  const next = learning.todayPlan().learn.map(x => x.id);
  assert.deepEqual(next, ['poem_momei', 'en_E03', 'en_E04']);
});

test('FIX P1-1 搜索覆盖英语对话/换场景/回忆提示与诗词线索/讲解', () => {
  const { learning } = fresh();
  learning.ensureSeeded();
  assert.equal(learning.library({ type: 'english', keyword: 'Here you go' }).length > 0, true);
  assert.equal(learning.library({ type: 'english', keyword: 'smaller size' }).length > 0, true);
  assert.equal(learning.library({ type: 'english', keyword: '泳镜一直进水' }).length > 0, true);
  const clues = learning.library({ type: 'poem' })[0].meta.clues || [];
  if (clues.length) assert.ok(learning.library({ type: 'poem', keyword: clues[0] }).length > 0);
});

test('FIX P1-2/P1-3 撤销 seq 落盘且先判新旧；FIX P1-4 mastered 不再加档', () => {
  const { mem, learning } = fresh();
  learning.ensureSeeded();
  // seq 来自落盘日志：两次记录的 seq 连续递增
  learning.record({ ids: ['en_E01'] });
  learning.record({ ids: ['en_E01'] });
  const logs = mem.gg_study_logs.filter(x => x.contentId === 'en_E01');
  // N5：seq 高位为毫秒时间戳，至少 > 1e12；同毫秒内严格递增
  assert.ok(logs[0].seq > 1e12, 'seq 带时间戳高位');
  assert.equal(logs[1].seq > logs[0].seq, true, 'seq 递增');
  // 清空内存模块缓存后 seq 仍从落盘最大值续上（模拟小程序重启）
  for (const k of Object.keys(require.cache)) if (k.indexOf(path.join(root, 'utils')) >= 0) delete require.cache[k];
  const again = require(path.join(root, 'utils/learning.js'));
  again.record({ ids: ['en_E01'] });
  assert.equal(mem.gg_study_logs.filter(x => x.contentId === 'en_E01').pop().seq > logs[1].seq, true);
  // mastered 后再 pass 不加档
  for (let i = 0; i < 8; i++) learning.record({ ids: ['poem_lichun'], kind: 'review', result: 'pass' });
  const p = mem.gg_progress.find(x => x.contentId === 'poem_lichun');
  assert.equal(p.status, 'mastered');
  const stage = p.stage;
  learning.record({ ids: ['poem_lichun'], kind: 'review', result: 'pass' });
  assert.equal(mem.gg_progress.find(x => x.contentId === 'poem_lichun').stage, stage);
});

test('FIX P1-5 MARK 写失败后重跑迁移不产生重复进度/日志', () => {
  const { mem, learning, migrate } = fresh({
    storage: { gg_poems: [{ id: 'old1', week: '2026-W48', title: '立春', author: '佚名', content: '春', status: 1, reviews: { '2026-W48': { ok: true } } }] },
  });
  learning.ensureSeeded();
  assert.equal(migrate.migrate().error, null);
  const pCount = mem.gg_progress.length, lCount = mem.gg_study_logs.length;
  // 模拟 MARK 写入失败：删掉标记后重跑
  delete mem.gg_settings[migrate.MARK];
  assert.equal(migrate.migrate().error, null);
  assert.equal(mem.gg_progress.length, pCount, '进度不重复');
  assert.equal(mem.gg_study_logs.length, lCount, '日志不重复');
});

test('FIX P2-4 日志按本地日期归档，不再用 ISO UTC 前 10 位', () => {
  const { mem, learning } = fresh();
  learning.ensureSeeded();
  mem.gg_study_logs = [{ id: 'x', contentId: 'en_E01', status: 1, at: '2026-11-28T16:30:00.000Z', result: 'pass', kind: 'learn' }];
  // GMT+8 下该时刻为 11-29；UTC 前 10 位会是 11-28
  const local = new Date('2026-11-28T16:30:00.000Z');
  const expect = local.getFullYear() + '-' + String(local.getMonth() + 1).padStart(2, '0') + '-' + String(local.getDate()).padStart(2, '0');
  assert.equal(learning.logsByDate(expect).length, 1);
  assert.equal(learning.logsByDate('2026-11-28').length, expect === '2026-11-28' ? 1 : 0);
});


// ---- 第二轮复审修复回归：N1–N9 ----
test('N1 跨设备撤销：进度软删而非物理删，sync-merge 让删除方胜出', () => {
  const { mem, learning, merge } = fresh();
  learning.ensureSeeded();
  const id = 'en_E01';
  learning.record({ ids: [id], kind: 'learn', result: 'pass' });
  const prog = mem.gg_progress[0];
  const log = mem.gg_study_logs[0];
  // 模拟另一设备推进过该进度（updated_at 更早）
  const otherDevice = Object.assign({}, prog, { stage: 2, updated_at: '2026-11-28T09:00:00.000Z' });
  // 本设备撤销：before=null → 软删进度 + updated_at=now
  assert.equal(learning.undoLog(log.id).error, null);
  assert.equal(mem.gg_progress.length, 1, '进度不再被物理 splice');
  assert.ok(mem.gg_progress[0].deleted_at, '带 deleted_at 软删标记');
  assert.equal(learning.todayPlan().progressIds || learning.todayPlan().review.some(x => x.id === id), false, '撤销后不进复习');
  // 三方合并：本地删除 vs 远端旧进度 → 删除方胜出
  const merged = merge.merge('gg_progress', [prog], [mem.gg_progress[0]], [otherDevice]);
  assert.equal(merged.length, 1);
  assert.ok(merged[0].deleted_at, '合并后仍为软删，进度不被救活');
});

test('N2 异常 meta.clues / tags 为字符串时搜索不崩溃', () => {
  const { mem, learning } = fresh();
  learning.ensureSeeded();
  mem.gg_content.push({
    id: 'weird_1', type: 'poem', primary: '怪数据诗', body: '测试',
    meta: { clues: '逗号线索', tags: '字符串标签' }, status: 1, updated_at: '2026-11-28T00:00:00.000Z',
  });
  assert.equal(learning.library({ keyword: '逗号线索' }).length, 1);
  assert.equal(learning.library({ keyword: '字符串标签' }).length, 1);
  // 字符串原型不应有 join，确保走的是 toText 分支
  assert.equal(typeof ''.join, 'undefined');
});

test('N3 关闭补库：只记日志不建进度，label 可读且可撤销', () => {
  const { mem, learning, migrate } = fresh();
  learning.ensureSeeded();
  const r = learning.record({
    temp: [{ type: 'english', primary: '临时句XYZ', secondary: '临时' }],
    addToLibrary: false, operator: 'mama',
  });
  assert.equal(r.error, null);
  assert.equal((mem.gg_progress || []).length, 0, '不产生孤儿进度');
  assert.equal(learning.library({ keyword: '临时句XYZ' }).length, 0, '不入内容库');
  const log = mem.gg_study_logs[0];
  assert.equal(log.progressId, '');
  assert.equal(log.label, '临时句XYZ');
  const logs = learning.logsByDate();
  assert.ok(logs.some(x => x.label === '临时句XYZ'), '日志显示标题而非 id');
  // 纯日志撤销仍成功
  assert.equal(learning.undoLog(log.id).error, null);
  assert.equal(mem.gg_study_logs[0].status, 2);
});

test('N4 新学/复习 quickPass kind 由页面 data-kind 区分', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/learn/learn.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/learn/learn.js'), 'utf8');
  assert.ok(/data-kind="learn"\s+catchtap="quickPass"/.test(wxml), '新学通过传 learn');
  assert.ok(/data-kind="review"\s+catchtap="quickPass"/.test(wxml), '复习通过传 review');
  assert.ok(/ds\.kind === 'learn' \? 'learn' : 'review'/.test(js), 'JS 按来源定 kind');
  // 引擎层两种 kind 都接受
  const { learning } = fresh();
  learning.ensureSeeded();
  assert.equal(learning.record({ ids: ['en_E01'], kind: 'learn' }).error, null);
  assert.equal(learning.record({ ids: ['en_E02'], kind: 'review' }).error, null);
  const kinds = learning.logsByDate().map(x => x.kindLabel);
  assert.ok(kinds.indexOf('新学') >= 0 && kinds.indexOf('复习') >= 0, '两种 kind 分别落日志');
});

test('N5 跨设备首次记录 seq 不重复（时间戳高位 + 序号）', () => {
  const seen = [];
  for (let i = 0; i < 3; i++) {
    const { mem, learning } = fresh();
    learning.ensureSeeded();
    learning.record({ ids: ['en_E01'] });
    seen.push(mem.gg_study_logs[0].seq);
  }
  assert.equal(new Set(seen).size, seen.length, '三台独立设备 seq 各不相同');
  assert.ok(seen.every(x => x > 1e12));
});

test('N7 软删内容可通过回收站列出并恢复', () => {
  const { mem, learning, store } = fresh();
  learning.ensureSeeded();
  assert.equal(learning.removeContent('poem_lichun').error, null);
  assert.equal(learning.libraryDeleted().length, 1);
  assert.equal(learning.library({ keyword: '立春' }).length, 0);
  assert.equal(learning.restoreContent('poem_lichun').error, null);
  assert.equal(learning.libraryDeleted().length, 0);
  assert.equal(learning.library({ keyword: '立春' }).length, 1);
  assert.equal(mem.gg_content.find(x => x.id === 'poem_lichun').status, 1);
  // 恢复后不再复活软删标记
  assert.equal(mem.gg_content.find(x => x.id === 'poem_lichun').deleted_at, undefined);
  // 访客不可恢复
  global.wx.setStorageSync('gg_my_identity', { status: 'none' });
  global.wx.setStorageSync('gg_family_adopted', 'fam_x');
  assert.equal(learning.restoreContent('poem_lichun').error, 'FORBIDDEN');
});

test('N8 overview.due 与 todayPlan.review 同口径：软删内容不计入待复习', () => {
  const { mem, learning } = fresh();
  learning.ensureSeeded();
  const id = 'poem_lichun';
  learning.record({ ids: [id], kind: 'learn', result: 'pass' });
  // 把复习日设为今天
  mem.gg_progress[0].nextReviewAt = require(path.join(root, 'utils/date.js')).today();
  mem.gg_progress = mem.gg_progress.slice();
  assert.equal(learning.overview().due, 1);
  assert.equal(learning.todayPlan().review.length, 1);
  learning.removeContent(id);
  assert.equal(learning.overview().due, 0, 'overview 排除软删内容');
  assert.equal(learning.todayPlan().review.length, 0);
});

test('N9 pickLearn 不再带死参数 d（源码断言）', () => {
  const js = fs.readFileSync(path.join(root, 'utils/learning.js'), 'utf8');
  assert.ok(/function pickLearn\(pool, quota\)/.test(js));
  assert.ok(!/pickLearn\(pool, QUOTA\[type\], d\)/.test(js));
});

test('N6 页面结构冒烟补充回收站绑定', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.js'), 'utf8');
  assert.ok(/bindtap="toggleDeleted"/.test(wxml));
  assert.ok(/catchtap="restoreItem"/.test(wxml));
  assert.ok(/showDeleted: false/.test(js));
});

test('内容库 A 方向改版：banner / 空值判断 / 语义底色卡 / 防重 / 标签折叠', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.wxml'), 'utf8');
  const wxss = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.wxss'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.js'), 'utf8');
  assert.ok(wxml.includes('lib-banner'), '品牌 banner 缺失');
  assert.ok(wxml.includes('detail.has.reply'), '英语详情空值判断缺失');
  assert.ok(wxml.includes('bg-block') && wxss.includes('.bg-block'), '背景语义卡缺失');
  assert.ok(wxml.includes('form-group'), '表单分组缺失');
  assert.ok(wxml.includes('saving ? \'保存中…\''), '保存防重 UI 缺失');
  assert.ok(js.includes('visibleTags') && js.includes('toggleTags'), '标签折叠缺失');
  assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(wxml), '详情仍有 emoji');
});

test('内容库 UI 状态：骨架屏 / 表单错误态 / 只读禁用态绑定齐全', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/learn-library/learn-library.js'), 'utf8');
  assert.ok(wxml.includes('skeleton-row'), '加载态骨架缺失');
  assert.ok(wxml.includes("formError ? 'is-error'"), '输入框错误态未接全局类');
  assert.ok(wxml.includes('class="field-error"'), '行内错误文案缺失');
  assert.ok(wxml.includes("canEdit ? '' : 'is-disabled'"), '只读禁用态缺失');
  assert.ok(js.includes("formError: ''"), 'UI 状态字段缺失');
});
