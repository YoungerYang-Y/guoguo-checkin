// 常见小学必背古诗库（教材常见版本）。
// 用于按「诗名 + 作者」精确带出全文，避免由模型生成而出现错字、串句。
// 若课本版本不同，家长可在录入界面直接修改诗文内容。
const POEMS = [
  { title: '静夜思', author: '李白', content: '床前明月光，疑是地上霜。\n举头望明月，低头思故乡。' },
  { title: '春晓', author: '孟浩然', content: '春眠不觉晓，处处闻啼鸟。\n夜来风雨声，花落知多少。' },
  { title: '咏鹅', author: '骆宾王', content: '鹅，鹅，鹅，曲项向天歌。\n白毛浮绿水，红掌拨清波。' },
  { title: '登鹳雀楼', author: '王之涣', content: '白日依山尽，黄河入海流。\n欲穷千里目，更上一层楼。' },
  { title: '悯农（其二）', author: '李绅', content: '锄禾日当午，汗滴禾下土。\n谁知盘中餐，粒粒皆辛苦。' },
  { title: '悯农（其一）', author: '李绅', content: '春种一粒粟，秋收万颗子。\n四海无闲田，农夫犹饿死。' },
  { title: '古朗月行（节选）', author: '李白', content: '小时不识月，呼作白玉盘。\n又疑瑶台镜，飞在青云端。' },
  { title: '绝句', author: '杜甫', content: '两个黄鹂鸣翠柳，一行白鹭上青天。\n窗含西岭千秋雪，门泊东吴万里船。' },
  { title: '江雪', author: '柳宗元', content: '千山鸟飞绝，万径人踪灭。\n孤舟蓑笠翁，独钓寒江雪。' },
  { title: '寻隐者不遇', author: '贾岛', content: '松下问童子，言师采药去。\n只在此山中，云深不知处。' },
  { title: '池上', author: '白居易', content: '小娃撑小艇，偷采白莲回。\n不解藏踪迹，浮萍一道开。' },
  { title: '小池', author: '杨万里', content: '泉眼无声惜细流，树阴照水爱晴柔。\n小荷才露尖尖角，早有蜻蜓立上头。' },
  { title: '望庐山瀑布', author: '李白', content: '日照香炉生紫烟，遥看瀑布挂前川。\n飞流直下三千尺，疑是银河落九天。' },
  { title: '赠汪伦', author: '李白', content: '李白乘舟将欲行，忽闻岸上踏歌声。\n桃花潭水深千尺，不及汪伦送我情。' },
  { title: '早发白帝城', author: '李白', content: '朝辞白帝彩云间，千里江陵一日还。\n两岸猿声啼不住，轻舟已过万重山。' },
  { title: '夜宿山寺', author: '李白', content: '危楼高百尺，手可摘星辰。\n不敢高声语，恐惊天上人。' },
  { title: '回乡偶书', author: '贺知章', content: '少小离家老大回，乡音无改鬓毛衰。\n儿童相见不相识，笑问客从何处来。' },
  { title: '咏柳', author: '贺知章', content: '碧玉妆成一树高，万条垂下绿丝绦。\n不知细叶谁裁出，二月春风似剪刀。' },
  { title: '鹿柴', author: '王维', content: '空山不见人，但闻人语响。\n返景入深林，复照青苔上。' },
  { title: '送元二使安西', author: '王维', content: '渭城朝雨浥轻尘，客舍青青柳色新。\n劝君更尽一杯酒，西出阳关无故人。' },
  { title: '九月九日忆山东兄弟', author: '王维', content: '独在异乡为异客，每逢佳节倍思亲。\n遥知兄弟登高处，遍插茱萸少一人。' },
  { title: '相思', author: '王维', content: '红豆生南国，春来发几枝。\n愿君多采撷，此物最相思。' },
  { title: '画', author: '王维（传）', content: '远看山有色，近听水无声。\n春去花还在，人来鸟不惊。' },
  { title: '村居', author: '高鼎', content: '草长莺飞二月天，拂堤杨柳醉春烟。\n儿童散学归来早，忙趁东风放纸鸢。' },
  { title: '所见', author: '袁枚', content: '牧童骑黄牛，歌声振林樾。\n意欲捕鸣蝉，忽然闭口立。' },
  { title: '望洞庭', author: '刘禹锡', content: '湖光秋月两相和，潭面无风镜未磨。\n遥望洞庭山水翠，白银盘里一青螺。' },
  { title: '饮湖上初晴后雨', author: '苏轼', content: '水光潋滟晴方好，山色空蒙雨亦奇。\n欲把西湖比西子，淡妆浓抹总相宜。' },
  { title: '题西林壁', author: '苏轼', content: '横看成岭侧成峰，远近高低各不同。\n不识庐山真面目，只缘身在此山中。' },
  { title: '敕勒歌', author: '北朝民歌', content: '敕勒川，阴山下。\n天似穹庐，笼盖四野。\n天苍苍，野茫茫，风吹草低见牛羊。' },
  { title: '凉州词', author: '王之涣', content: '黄河远上白云间，一片孤城万仞山。\n羌笛何须怨杨柳，春风不度玉门关。' },
  { title: '出塞', author: '王昌龄', content: '秦时明月汉时关，万里长征人未还。\n但使龙城飞将在，不教胡马度阴山。' },
  { title: '芙蓉楼送辛渐', author: '王昌龄', content: '寒雨连江夜入吴，平明送客楚山孤。\n洛阳亲友如相问，一片冰心在玉壶。' },
  { title: '夏日绝句', author: '李清照', content: '生当作人杰，死亦为鬼雄。\n至今思项羽，不肯过江东。' },
  { title: '示儿', author: '陆游', content: '死去元知万事空，但悲不见九州同。\n王师北定中原日，家祭无忘告乃翁。' },
  { title: '元日', author: '王安石', content: '爆竹声中一岁除，春风送暖入屠苏。\n千门万户曈曈日，总把新桃换旧符。' },
  { title: '泊船瓜洲', author: '王安石', content: '京口瓜洲一水间，钟山只隔数重山。\n春风又绿江南岸，明月何时照我还。' },
  { title: '清明', author: '杜牧', content: '清明时节雨纷纷，路上行人欲断魂。\n借问酒家何处有，牧童遥指杏花村。' },
  { title: '山行', author: '杜牧', content: '远上寒山石径斜，白云生处有人家。\n停车坐爱枫林晚，霜叶红于二月花。' },
  { title: '江南春', author: '杜牧', content: '千里莺啼绿映红，水村山郭酒旗风。\n南朝四百八十寺，多少楼台烟雨中。' },
  { title: '风', author: '李峤', content: '解落三秋叶，能开二月花。\n过江千尺浪，入竹万竿斜。' },
];

function norm(s) {
  return String(s || '').replace(/[《》〈〉\s·、，,。．！？!?（）()]/g, '').toLowerCase();
}

function findPoem(title, author) {
  const t = norm(title), a = norm(author);
  if (!t) return null;
  let hit = POEMS.find(p => norm(p.title) === t
    && (!a || norm(p.author).indexOf(a) >= 0 || a.indexOf(norm(p.author)) >= 0));
  if (!hit) hit = POEMS.find(p => norm(p.title) === t);
  if (!hit) hit = POEMS.find(p => norm(p.title).indexOf(t) >= 0 || t.indexOf(norm(p.title)) >= 0);
  return hit || null;
}

module.exports = { POEMS, findPoem, norm };
