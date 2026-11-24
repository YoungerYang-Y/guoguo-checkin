const stats = require('../../utils/stats.js');
const store = require('../../utils/store.js');
const D = require('../../utils/date.js');

const COLORS = { guoguo: '#F58AAE', papa: '#61DDAA', mama: '#F6BD16' };

Page({
  data: {
    type: 'week',
    types: [{ key: 'week', label: '本周' }, { key: 'month', label: '本月' }, { key: 'year', label: '本年' }],
    title: '',
    members: [],
    dimNames: ['完成率', '连续性', '目标达成', '广度与自主'],
    radarReady: false,
    sampleNote: '',
  },

  onLoad() { this.setData({ anchor: D.today() }); },
  onShow() { this.build(); },

  setType(e) { this.setData({ type: e.currentTarget.dataset.key }, () => this.build()); },

  build() {
    const report = stats.buildReport(this.data.type, this.data.anchor);
    const members = store.getFamily().members.map(m => {
      const r = report.members[m.id];
      const dims = r.dims;
      return {
        id: m.id, name: m.name, color: COLORS[m.id],
        valid: r.valid, index: dims ? dims.index : null,
        effectiveDays: r.effectiveDays || 0,
        minDays: r.minDays || (this.data.type === 'week' ? 3 : (this.data.type === 'month' ? 10 : 90)),
        gap: dims ? dims.gap : null,
        delta: r.delta, trend: r.trend,
        dims: dims ? [dims.completion, dims.continuity, dims.goal, dims.breadth] : [0, 0, 0, 0],
        advice: r.advice ? r.advice.texts : [],
        low: r.advice && r.advice.low ? r.advice.low.join('、') : '',
      };
    });
    // 排行（有效样本）
    const ranked = members.filter(m => m.valid).slice().sort((a, b) => b.index - a.index);
    ranked.forEach((m, i) => { m.rank = i + 1; });
    const invalid = members.filter(m => !m.valid);

    this.setData({
      title: report.title, members,
      sampleNote: invalid.length ? ('样本不足，暂不作结论：' + invalid.map(m => m.name + ' 有效打卡日 ' + m.effectiveDays + '/' + m.minDays + ' 天').join('；')) : '',
      hasData: members.some(m => m.valid),
    }, () => {
      if (members.some(m => m.valid)) this.drawRadar(members.filter(m => m.valid));
    });
  },

  // 用 canvas 绘制四维雷达图
  drawRadar(validMembers) {
    const query = wx.createSelectorQuery();
    query.select('#radar').fields({ node: true, size: true }).exec((res) => {
      if (!res || !res[0]) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');
      const dpr = wx.getSystemInfoSync().pixelRatio || 2;
      const size = 260;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      ctx.scale(dpr, dpr);
      const cx = size / 2, cy = size / 2, R = 92;
      const N = 4;
      const angle = i => (Math.PI * 2 * i) / N - Math.PI / 2;

      ctx.clearRect(0, 0, size, size);
      // 网格
      for (let level = 1; level <= 4; level++) {
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const r = R * level / 4;
          const x = cx + r * Math.cos(angle(i)), y = cy + r * Math.sin(angle(i));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = '#e5e8eb'; ctx.lineWidth = 1; ctx.stroke();
      }
      // 轴线
      for (let i = 0; i < N; i++) {
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.lineTo(cx + R * Math.cos(angle(i)), cy + R * Math.sin(angle(i)));
        ctx.strokeStyle = '#e5e8eb'; ctx.stroke();
      }
      // 各成员多边形
      validMembers.forEach(m => {
        ctx.beginPath();
        m.dims.forEach((v, i) => {
          const r = R * Math.max(0, Math.min(100, v)) / 100;
          const x = cx + r * Math.cos(angle(i)), y = cy + r * Math.sin(angle(i));
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = this.hexToRgba(m.color, 0.14); ctx.fill();
        ctx.strokeStyle = m.color; ctx.lineWidth = 2; ctx.stroke();
      });
      // 顶点标签
      ctx.fillStyle = '#646a73'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      const labels = ['完成率', '连续性', '目标达成', '广度'];
      labels.forEach((l, i) => {
        const x = cx + (R + 20) * Math.cos(angle(i));
        const y = cy + (R + 20) * Math.sin(angle(i)) + 4;
        ctx.fillText(l, x, y);
      });
      this.setData({ radarReady: true });
    });
  },

  hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
  },
});
