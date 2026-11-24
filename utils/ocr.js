// 图片识别：把照片交给支持视觉的云服务模型，读出其中的英文单词和句子。
// 模型目录里 supportsImages=true 的模型可用；SDK 的 messages.content 支持
// [{ type:'text' }, { type:'image_url', image_url:{ url:'data:image/...;base64,...' } }]。
const SYSTEM_PROMPT = 'You are a precise OCR assistant for a child English-learning log. Extract only the English words and short sentences actually visible in the photo. Never invent text. Reply with a JSON array only.';

function pickModel(models) {
  const usable = (models || []).filter(m => m && m.disabled !== true && m.enabled !== false);
  return usable.find(m => m.supportsImages === true && m.disabledMultimodal !== true)
    || usable.find(m => m.disabledMultimodal !== true)
    || null;
}

function parseItems(text) {
  const cleaned = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const s = cleaned.indexOf('['), e = cleaned.lastIndexOf(']');
  if (s < 0 || e <= s) return [];
  let arr;
  try { arr = JSON.parse(cleaned.slice(s, e + 1)); } catch (err) { return []; }
  if (!Array.isArray(arr)) return [];
  const out = [];
  arr.forEach(x => {
    const raw = typeof x === 'string' ? x : (x && (x.text || x.word || x.content));
    if (!raw) return;
    const t = String(raw).trim();
    if (!t) return;
    const type = (x && (x.type === 'word' || x.type === 'sentence'))
      ? x.type
      : (/[\s,.!?，。！？]/.test(t) ? 'sentence' : 'word');
    out.push({ text: t, type });
  });
  return out;
}

async function recognize(base64, mime, models) {
  // 延迟加载：页面初始化不触碰云 SDK，预览环境也能正常打开页面
  const cloudApi = require('./cloud.js');
  const session = await cloudApi.ensureSession();
  if (!session) throw new Error('未登录微信，图片识别需在微信客户端中使用；预览环境请改用批量粘贴');
  const cloud = cloudApi.getCloud();
  let list = models;
  if (!list) {
    try { list = await cloud.llm.models.list(); } catch (e) { list = []; }
  }
  const model = pickModel(list);
  if (!model) throw new Error('当前没有可用的图片识别模型');
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: [
        { type: 'text', text: '识别照片中的英文单词和句子，逐条输出。只返回 JSON 数组，例如 [{"text":"apple","type":"word"},{"text":"Good morning!","type":"sentence"}]，不要输出解释。' },
        { type: 'image_url', image_url: { url: 'data:' + (mime || 'image/jpeg') + ';base64,' + base64, detail: 'high' } },
      ],
    },
  ];
  let answer = '';
  for await (const chunk of cloud.llm.chat.completions.create({
    model: model.id, messages, stream: true,
  })) {
    const delta = chunk && chunk.choices && chunk.choices[0]
      && chunk.choices[0].delta && chunk.choices[0].delta.content;
    if (delta) answer += delta;
  }
  const items = parseItems(answer);
  if (!items.length) throw new Error('没有识别到内容，请换一张更清晰的照片或手动粘贴');
  return { items, model: model.id };
}

module.exports = { recognize, parseItems, pickModel };
