const store = require('./utils/store.js');
const cloudstore = require('./utils/cloudstore.js');
const wxCompat = require('./utils/wx-compat.js');
const ledgerMigrate = require('./utils/ledger-migrate.js');
const learning = require('./utils/learning.js');
const learningMigrate = require('./utils/learning-migrate.js');
const weightSeed = require('./utils/weight-seed.js');

// 预览面板只模拟了部分微信 API，先补齐缺失项，避免交互中断
wxCompat.install();

App({
  globalData: {
    appName: '果果家庭打卡',
    version: '1.12.8',
    icp: '湘ICP备2023008600号-2X',   // ICP 备案号，展示在「我的」与隐私页底部
    cloud: true,
    // switchTab 不支持 query 传参，用一次性信号告知报表页进入哪个视图（'compare' / ''）
    reportView: '',
  },
  onLaunch() {
    wxCompat.install();
    // 本地初始化保证首屏立即可用
    store.initFamily();
    // 学习体系：initFamily 会把新键重建为空数组，种子与迁移必须在其后；
    // 且三者都要在 bootstrap 前完成，才能随首轮同步上传。每步独立容错，不阻断启动。
    try { this.seedResult = learning.ensureSeeded(); } catch (e) { this.seedResult = null; }
    try { this.learningMigration = learningMigrate.migrate(); } catch (e) { this.learningMigration = null; }
    // 果果身高体重历史 13 条：同样必须在 bootstrap 前补入，幂等且不覆盖已有记录
    try { this.weightSeed = weightSeed.ensureSeeded(); } catch (e) { this.weightSeed = null; }
    // 历史培训费并入记账：必须在 bootstrap 之前跑，新增账目才能随首轮同步上传；
    // 完成标记阻止删除后的重放，云端旧费用在成功接入家庭后另行迁移。
    try { this.feeMigration = ledgerMigrate.migrateFees(); } catch (e) { this.feeMigration = null; }
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
