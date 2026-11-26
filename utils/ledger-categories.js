// 家庭记账分类表：13 个一级分类 + 71 个二级分类。
// 编码规则：一级 '1'..'13'，二级 '1-01'..'13-02'，与账本口径一致，便于统计聚合与导出。
// PUBLIC_ONLY：该一级分类下的所有支出都算家庭公共支出（如居住），不看成员。

const CATEGORIES = [
  { code: '1', name: '餐饮食品', hint: '三餐与食材分开记，能看出在家做饭与在外就餐的比例', children: [
    { code: '1-01', name: '日常三餐' },
    { code: '1-02', name: '买菜食材' },
    { code: '1-03', name: '外卖外带' },
    { code: '1-04', name: '零食饮料' },
    { code: '1-05', name: '水果乳品' },
    { code: '1-06', name: '聚餐宴请' },
    { code: '1-07', name: '母婴食品' },
  ]},
  { code: '2', name: '居住', hint: '房贷按月供整体记一笔，不拆本金利息；本类全部计入公共支出', children: [
    { code: '2-01', name: '房租' },
    { code: '2-02', name: '房贷' },
    { code: '2-03', name: '物业费' },
    { code: '2-04', name: '水电燃气' },
    { code: '2-05', name: '供暖制冷' },
    { code: '2-06', name: '家政保洁' },
    { code: '2-07', name: '家居维修' },
    { code: '2-08', name: '家居用品' },
  ]},
  { code: '3', name: '交通出行', hint: '市内通勤与跨城出行分开，便于单独观察通勤成本', children: [
    { code: '3-01', name: '公共交通' },
    { code: '3-02', name: '打车网约' },
    { code: '3-03', name: '燃油充电' },
    { code: '3-04', name: '停车过路' },
    { code: '3-05', name: '车辆保养维修' },
    { code: '3-06', name: '车辆保险年检' },
    { code: '3-07', name: '长途出行' },
  ]},
  { code: '4', name: '育儿教育', hint: '只放教育与养育服务；孩子看病走医疗、买衣服走服饰', children: [
    { code: '4-01', name: '园校学费' },
    { code: '4-02', name: '兴趣班' },
    { code: '4-03', name: '教材绘本' },
    { code: '4-04', name: '玩具教具' },
    { code: '4-05', name: '文具耗材' },
    { code: '4-06', name: '校服校车' },
    { code: '4-07', name: '托管看护' },
    { code: '4-08', name: '儿童保健' },
  ]},
  { code: '5', name: '医疗健康', hint: '成人与儿童共用分类，由成员区分；齿科单列便于追踪高额项目', children: [
    { code: '5-01', name: '门诊挂号' },
    { code: '5-02', name: '药品' },
    { code: '5-03', name: '体检筛查' },
    { code: '5-04', name: '齿科眼科' },
    { code: '5-05', name: '康复理疗' },
    { code: '5-06', name: '医疗器械' },
  ]},
  { code: '6', name: '服饰美容', hint: '洗护化妆与日用百货的分界是「是否用于身体」', children: [
    { code: '6-01', name: '成衣' },
    { code: '6-02', name: '童装' },
    { code: '6-03', name: '鞋帽配饰' },
    { code: '6-04', name: '洗护化妆' },
    { code: '6-05', name: '理发美发' },
  ]},
  { code: '7', name: '日用百货', hint: '单价低于 100 元的家居小件并入清洁纸品，不单列', children: [
    { code: '7-01', name: '清洁纸品' },
    { code: '7-02', name: '厨房耗材' },
    { code: '7-03', name: '小家电' },
    { code: '7-04', name: '数码配件' },
    { code: '7-05', name: '家庭工具' },
  ]},
  { code: '8', name: '通讯数码', hint: '会员订阅是最容易漏记的隐形支出，单列后可做订阅体检', children: [
    { code: '8-01', name: '手机话费' },
    { code: '8-02', name: '宽带网络' },
    { code: '8-03', name: '会员订阅' },
    { code: '8-04', name: '软件服务' },
    { code: '8-05', name: '数码设备' },
  ]},
  { code: '9', name: '人情社交', hint: '给父母的固定赡养费记本类，只有成员之间调拨才走转账', children: [
    { code: '9-01', name: '礼金红包' },
    { code: '9-02', name: '礼品' },
    { code: '9-03', name: '请客招待' },
    { code: '9-04', name: '孝亲赡养' },
    { code: '9-05', name: '公益捐赠' },
  ]},
  { code: '10', name: '休闲娱乐', hint: '一次出行不拆细，整体记旅游度假，再用备注归集', children: [
    { code: '10-01', name: '旅游度假' },
    { code: '10-02', name: '门票演出' },
    { code: '10-03', name: '运动装备' },
    { code: '10-04', name: '影音娱乐' },
    { code: '10-05', name: '宠物' },
    { code: '10-06', name: '爱好收藏' },
  ]},
  { code: '11', name: '学习成长', hint: '成人学习与孩子兴趣班分属两类，区分人力资本投入对象', children: [
    { code: '11-01', name: '课程培训' },
    { code: '11-02', name: '考试证书' },
    { code: '11-03', name: '图书知识' },
  ]},
  { code: '12', name: '金融保险', hint: '保险按年付金额大，配合年度摊销；投资亏损单列，不参与日常对比', children: [
    { code: '12-01', name: '利息手续费' },
    { code: '12-02', name: '保险保费' },
    { code: '12-03', name: '投资亏损' },
    { code: '12-04', name: '税费罚款' },
  ]},
  { code: '13', name: '其他支出', hint: '兜底类；占比超过 5% 说明分类体系该收敛了', children: [
    { code: '13-01', name: '待整理' },
    { code: '13-02', name: '临时支出' },
  ]},
];

// 记账成员维度：三个家庭成员 + 公共
const MEMBERS = [
  { id: 'papa', name: '爸爸' },
  { id: 'mama', name: '妈妈' },
  { id: 'guoguo', name: '果果' },
  { id: 'public', name: '公共' },
];

// 居住类所有支出恒为公共支出
const PUBLIC_ONLY_CAT1 = ['2'];

function findCat1(code) { return CATEGORIES.find(c => c.code === String(code)) || null; }
function findCat2(code) {
  const s = String(code || '');
  const cat1 = s.split('-')[0];
  const parent = findCat1(cat1);
  if (!parent) return null;
  return parent.children.find(c => c.code === s) || null;
}
function cat1Name(code) { const c = findCat1(code); return c ? c.name : ''; }
function cat2Name(code) { const c = findCat2(code); return c ? c.name : ''; }
function isPublicOnly(cat1) { return PUBLIC_ONLY_CAT1.indexOf(String(cat1)) >= 0; }
function memberName(id) { const m = MEMBERS.find(x => x.id === id); return m ? m.name : '公共'; }

module.exports = {
  CATEGORIES, MEMBERS, PUBLIC_ONLY_CAT1,
  findCat1, findCat2, cat1Name, cat2Name, isPublicOnly, memberName,
};
