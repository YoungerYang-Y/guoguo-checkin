// 访客只读页：凭 token 读取云端脱敏快照。无任何写入口、无家庭码、无明细/备注/主题/导出/设置。
const family = require('../../utils/family.js');

Page({
  data: {
    loading: true,
    token: '',
    valid: false,
    reason: '',
    snapshot: null,
  },

  onLoad(options) {
    const token = (options && options.token) || '';
    this.setData({ token });
    if (!token) {
      this.setData({ loading: false, valid: false, reason: '链接无效（缺少访问凭证）' });
      return;
    }
    this.load();
  },

  async load() {
    try {
      const res = await family.getVisitorSnapshot(this.data.token);
      if (!res.valid) {
        this.setData({ loading: false, valid: false, reason: res.reason || '链接已失效' });
        return;
      }
      const snap = res.snapshot || {};
      this.setData({
        loading: false,
        valid: true,
        snapshot: {
          period: snap.period || '本周',
          generatedAt: snap.generatedAt || '',
          totalDone: snap.totalDone,
          streak: snap.streak,
          members: (snap.members || []).map(m => Object.assign({}, m, {
            completionText: (m.completion === null || m.completion === undefined) ? '样本不足' : m.completion + '%',
            indexText: (m.index === null || m.index === undefined) ? '—' : String(m.index),
          })),
          note: snap.note || '',
        },
      });
    } catch (e) {
      this.setData({ loading: false, valid: false, reason: '读取失败，请检查网络后重试' });
    }
  },

  onPullDownRefresh() {
    this.load().then(() => { try { wx.stopPullDownRefresh(); } catch (e) {} });
  },

  retry() { this.setData({ loading: true }); this.load(); },
});
