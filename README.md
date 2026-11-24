# 果果家庭打卡 · 小程序源码

一家三口用的家庭打卡微信小程序，原生微信小程序（WXML / WXSS / JS），共 13 个页面。

## 运行

用微信开发者工具「导入项目」，选择本目录即可（无需 npm 构建）。真机云同步需在应用卡绑定正式小程序 AppID 并在微信公众平台配置 request 合法域名；H5 预览环境只能本地模式。

## 页面

| 页面 | 说明 |
| --- | --- |
| `pages/index` | 今日打卡（家庭任务、自定义目标、补卡） |
| `pages/calendar` | 日历回看与补卡 |
| `pages/report` / `report-detail` | 报表中心与详情 |
| `pages/compare` | 三人对比 |
| `pages/settings` | 排期、周目标、成员、提醒 |
| `pages/target-edit` | 自定义目标（支持多名成员） |
| `pages/mine` | 导出、分享、隐私指引、同步状态 |
| `pages/privacy` | 用户隐私保护指引 |
| `pages/weight` | 体重与身高记录、曲线与年度对比 |
| `pages/fees` | 培训费月度 / 年度分析 |
| `pages/poems` / `pages/words` | 古诗 / 单词句子每周复习 |

## utils

- `store.js` 本地存储 CRUD；`stats.js` 统计口径；`date.js` / `constants.js` 日期与常量
- `cloud.js` / `cloudstore.js` 云服务客户端与同步引擎（数据存 `gg_docs` 表）
- `extra.js` 体重与培训费数据层；`review.js` 复习引擎；`poems-data.js` 内置古诗库
- `privacy.js` 隐私指引内容；`ocr.js` 图片识别；`wx-compat.js` H5 预览兼容层

## 约定

- 图表用纯 WXML/CSS 实现，不引第三方图表库
- 古诗内容来自 `poems-data.js` 内置库，不由模型生成
- 补卡窗口 7 天；撤销记录保留审计、不计入展示与导出
