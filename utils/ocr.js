// 图片识别：把照片交给支持视觉的云服务模型，读出其中的英文单词和句子。
// 模型选择：优先用写死的视觉模型 PREFERRED_MODEL_ID（glm-4.6v），避免动态挑选挑到纯文本模型；
// 只有当前账号模型目录里查无此模型时，才严格挑一个 supportsImages=true 的视觉模型降级。
// SDK 的 messages.content 支持
// [{ type:'text' }, { type:'image_url', image_url:{ url:'data:image/...;base64,...' } }]。
const PREFERRED_MODEL_ID = 'glm-4.6v';
const SYSTEM_PROMPT = 'You are a precise OCR assistant for a child English-learning log. Extract only the English words and short sentences actually visible in the photo. Never invent text. Reply with a JSON array only.';

// 严格判定：必须明确支持图片，且未禁用多模态、未停用
function isVisionModel(m) {
  return !!(m && m.enabled !== false && m.disabled !== true
    && m.supportsImages === true && m.disabledMultimodal !== true);
}

function pickModel(models) {
  const usable = (models || []).filter(isVisionModel);
  const preferred = usable.find(m => m.id === PREFERRED_MODEL_ID);
  return preferred || usable[0] || null;
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
  if (!session) {
    const why = cloudApi.getLastAuthError();
    throw new Error('未登录微信，图片识别需在微信客户端中使用'
      + (why ? '（' + why + '）' : '') + '；预览环境请改用批量粘贴');
  }
  const cloud = cloudApi.getCloud();

  // 默认直接用写死的首选模型，不依赖模型目录；目录拉取只用于校验首选模型是否仍可用。
  let modelId = PREFERRED_MODEL_ID;
  let list = models;
  if (!list) {
    try { list = await cloud.llm.models.list(); } catch (e) { list = null; }
  }
  if (list) {
    const model = pickModel(list);
    if (!model) throw new Error('当前账号没有可用的图片识别模型，请检查云服务模型权限');
    modelId = model.id;
  }

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
  try {
    for await (const chunk of cloud.llm.chat.completions.create({
      model: modelId, messages, stream: true,
    })) {
      const delta = chunk && chunk.choices && chunk.choices[0]
        && chunk.choices[0].delta && chunk.choices[0].delta.content;
      if (delta) answer += delta;
    }
  } catch (e) {
    // 域名未配 / 网络异常时给出可读原因，不再笼统报「识别失败」
    throw new Error(cloudApi.describeCloudError(e, '图片识别失败：'));
  }
  const items = parseItems(answer);
  if (!items.length) throw new Error('没有识别到内容，请换一张更清晰的照片或手动粘贴');
  return { items, model: modelId };
}

module.exports = { recognize, parseItems, pickModel, PREFERRED_MODEL_ID };
