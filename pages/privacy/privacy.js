const privacy = require('../../utils/privacy.js');

Page({
  data: {
    version: privacy.VERSION,
    icp: '',
    updatedAt: privacy.UPDATED_AT,
    intro: privacy.INTRO,
    sections: privacy.SECTIONS,
    agreed: false,
  },

  onShow() {
    const app = getApp();
    this.setData({ agreed: privacy.hasAgreed(), icp: (app && app.globalData && app.globalData.icp) || '' });
  },

  agree() {
    privacy.setAgreed();
    this.setData({ agreed: true });
    wx.showToast({ title: '已同意', icon: 'success' });
  },

  revoke() {
    wx.showModal({
      title: '撤回同意',
      content: '撤回后，下次打开小程序会再次询问；导出页中涉及剪切板的复制功能将暂不可用。确定撤回吗？',
      confirmText: '撤回',
      confirmColor: '#d93026',
      success: (res) => {
        if (!res.confirm) return;
        privacy.revoke();
        this.setData({ agreed: false });
        wx.showToast({ title: '已撤回同意', icon: 'none' });
      },
    });
  },
});
