const store = require('./utils/store.js');
const cloudstore = require('./utils/cloudstore.js');
const wxCompat = require('./utils/wx-compat.js');

// 预览面板只模拟了部分微信 API，先补齐缺失项，避免交互中断
wxCompat.install();

App({
  globalData: {
    appName: '果果家庭打卡',
    version: '1.3.0',
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
  },
});
