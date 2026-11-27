// 培训费 → 家庭记账 的一次性迁移。
// 背景：原「培训费」页（gg_fees）与「记账」（gg_ledger）是两套账，同一笔钱会被记两遍或漏记一遍；
// 现在统一收进记账，gg_fees 作为历史数据只读保留，不再写入、不再同步。
//
// 迁移规则（刻意保守，宁可少迁也不错迁）：
//   1. 培训费只记到「月」，没有具体日期 → 落到该月 1 号，如需精确日期可进明细手动改；
//   2. 培训费属于果果的教育支出 → 成员固定 guoguo，分类落「育儿教育」：
//      书籍购买 → 4-03 教材绘本，其余课程 → 4-02 兴趣班；
//   3. 原分类名（游泳/英语课…）写进备注开头，信息不丢；
//   4. 每条打 src='fees:<原id>' 幂等标记，重复执行不会产生重复账；
//   5. 迁移成功才写完成标记，写入失败下次启动自动重试。
const store = require('./store.js');
const ledger = require('./ledger.js');

const MARK = 'gg_fees_migrated_v1';
// 培训费分类 key → 记账二级分类编码
const CAT_MAP = { books: '4-03' };
const DEFAULT_CAT2 = '4-02';   // 育儿教育 · 兴趣班
const CAT_NAMES = {
  swim: '游泳', skate: '轮滑', reading: '阅读课', thinking: '思维课',
  english: '英语课', member: '会员课', art: '美术课', books: '书籍购买',
};

function mapCat2(key) { return CAT_MAP[key] || DEFAULT_CAT2; }
function catName(key) { return CAT_NAMES[key] || String(key || '培训费'); }

function buildNote(fee) {
  const head = catName(fee.category);
  const tail = String(fee.note || '').trim();
  return tail ? head + ' · ' + tail : head;
}

// 返回 { migrated, skipped, total, error? }
function migrateFees() {
  // 完成标记是删除语义的一部分，不能靠当前账本是否仍有 src 来重复迁移。
  if (isMigrated()) return { migrated: 0, skipped: 0, total: 0 };
  let fees = [];
  try { fees = store.read(store.KEYS.FEES, []) || []; } catch (e) { fees = []; }
  if (!Array.isArray(fees) || !fees.length) {
    try { store.write(MARK, true); } catch (e) {}
    return { migrated: 0, skipped: 0, total: 0 };
  }

  const entries = fees.filter(f => f && f.id).map(f => ({
    // 只有月份，统一落 1 号
    date: String(f.ym || '').slice(0, 7) + '-01',
    cat2: mapCat2(f.category),
    amount: f.amount,
    member: 'guoguo',
    note: buildNote(f),
    src: 'fees:' + f.id,
  }));
  // 月份缺失的记录会被 normalize 判为 BAD_DATE 而跳过，不阻塞整批
  const r = ledger.bulkAdd(entries);
  if (r.error) {
    // 写盘失败：不写完成标记，下次启动重试
    return { migrated: 0, skipped: r.skipped || 0, total: fees.length, error: r.error };
  }
  const marked = store.write(MARK, true);
  if (marked && marked.error) return { migrated: r.data.length, skipped: r.skipped || 0, total: fees.length, error: marked.error };
  return { migrated: r.data.length, skipped: r.skipped || 0, total: fees.length };
}

// 仅由同步层在当前家庭 legacy 代次成功拉取后调用。删除凭据与账目在同一文档
// 中同步，新设备不会把旧云费用再次导入；清空后的新代次不再消费旧费用文档。
function migrateCloudFees(fees) {
  const local = store.read(store.KEYS.FEES, []);
  const handled = new Set(isMigrated() && Array.isArray(local) ? local.filter(f => f && f.id).map(f => String(f.id)) : []);
  const entries = (Array.isArray(fees) ? fees : []).filter(f => f && f.id).map(f => ({
    date: String(f.ym || '').slice(0, 7) + '-01',
    cat2: mapCat2(f.category), amount: f.amount, member: 'guoguo', note: buildNote(f),
    src: 'fees:' + f.id,
    // 兼容旧客户端：已完成本机迁移但账本来源消失，保留用户的历史删除。
    deleted: handled.has(String(f.id)) && !ledger.hasSource('fees:' + f.id),
  }));
  return ledger.bulkAdd(entries);
}

function isMigrated() {
  try { return !!store.read(MARK, false); } catch (e) { return false; }
}

module.exports = { migrateFees, migrateCloudFees, isMigrated, MARK, CAT_MAP, mapCat2 };
