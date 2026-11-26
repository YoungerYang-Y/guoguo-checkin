const store = require('./utils/store.js');
const cloudstore = require('./utils/cloudstore.js');
const wxCompat = require('./utils/wx-compat.js');

// 预览面板只模拟了部分微信 API，先补齐缺失项，避免交互中断
wxCompat.install();

App({
  globalData: {
    appName: '果果家庭打卡',
    version: '1.10.1',
    cloud: true,
    // switchTab 不支持 query 传参，用一次性信号告知报表页进入哪个视图（'compare' / ''）
    reportView: '',
  },
  onLaunch() {
    wxCompat.install();
    // 本地初始化保证首屏立即可用
    store.initFamily();
    // 异步引导云同步：登录 + 判定家庭身份 + 按家庭合并云端数据
    this.cloudReady = cloudstore.bootstrap();
    this._lastFullSync = 0;
    this._networkSyncTimer = null;
    const app = this;
    if (typeof wx.onNetworkStatusChange === 'function') {
      wx.onNetworkStatusChange(status => {
        if (!status.isConnected) return;
        // 弱网抖动会连续回调，去抖后合并成一次全量同步
        if (app._networkSyncTimer) clearTimeout(app._networkSyncTimer);
        app._networkSyncTimer = setTimeout(() => {
          app._networkSyncTimer = null;
          app.requestFullSync();
        }, 1500);
      });
    }
  },
  // 回前台 / 网络恢复共用 30 秒节流，避免每次切回都全量拉取（E-07）
  requestFullSync() {
    if (!cloudstore.getState().ready) return;
    const now = Date.now();
    if (now - (this._lastFullSync || 0) < 30000) return;
    this._lastFullSync = now;
    cloudstore.syncNow();
  },
  onShow() {
    this.requestFullSync();
  },
});
