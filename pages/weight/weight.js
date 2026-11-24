const extra = require('../../utils/extra.js');
const D = require('../../utils/date.js');

function toast(title) { try { wx.showToast({ title, icon: 'none' }); } catch (e) {} }

Page({
  data: {
    year: Number(D.today().slice(0, 4)),
    years: [],
    mode: 'year',           // year | cross
    metric: 'weight',       // weight | height
    visible: ['guoguo', 'papa', 'mama'],
    members: extra.MEMBERS,
    legend: [],
    monthKeys: [],
    monthLabels: [],
    monthIndex: 0,
    form: { ym: '', memberId: 'guoguo', weight: '', height: '', note: '' },
    chart: { empty: true, segments: [], dots: [], yLabels: [], xLabels: [], gridLines: [] },
    chartTitle: '体重曲线',
    tableTitle: '逐月体重',
    table: [],
    heightCompare: { empty: true, rows: [] },
    recent: [],
  },

  onLoad() {
    const now = D.today();
    const y = Number(now.slice(0, 4)), m = Number(now.slice(5, 7));
    const keys = [], labels = [];
    for (let i = 0; i < 36; i++) {
      let yy = y, mm = m - i;
      while (mm <= 0) { mm += 12; yy--; }
      keys.push(extra.ymOf(yy, mm));
      labels.push(yy + ' 年 ' + mm + ' 月');
    }
    this.setData({
      monthKeys: keys, monthLabels: labels, monthIndex: 0,
      'form.ym': keys[0], 'form.memberId': 'guoguo',
    });
    this.refresh();
  },
  onShow() { if (this.data.monthKeys.length) this.refresh(); },

  refresh() {
    const isHeight = this.data.metric === 'height';
    const years = isHeight ? extra.heightYears() : extra.weightYears();
    let year = this.data.year;
    if (years.indexOf(year) < 0) year = years[years.length - 1];
    let chart;
    if (isHeight) {
      chart = this.data.mode === 'year' ? extra.heightYearChart(year) : extra.heightCrossChart();
    } else {
      chart = this.data.mode === 'year'
        ? extra.weightYearChart(year, this.data.visible)
        : extra.weightCrossChart(this.data.visible);
    }
    const table = isHeight ? extra.heightTable(year) : extra.weightTable(year);
    const recent = extra.getWeights().slice()
      .sort((a, b) => b.ym.localeCompare(a.ym))
      .slice(0, 12)
      .map(w => {
        const bits = [];
        if (w.weight !== null && w.weight !== undefined) bits.push(w.weight + ' kg');
        if (w.height !== null && w.height !== undefined && Number(w.height) > 0) bits.push(w.height + ' cm');
        return {
          id: w.id, ym: w.ym, note: w.note,
          valueText: bits.join(' · ') || '—',
          memberName: (extra.MEMBERS.find(m => m.id === w.member_id) || {}).name || w.member_id,
        };
      });
    this.setData({
      years, year, chart, table, recent,
      heightCompare: extra.heightYearCompare(),
      chartTitle: isHeight
        ? (this.data.mode === 'year' ? year + ' 年果果身高曲线' : '果果跨年度身高曲线')
        : (this.data.mode === 'year' ? year + ' 年体重曲线' : '跨年度体重曲线'),
      tableTitle: isHeight ? year + ' 年果果逐月身高（cm）' : year + ' 年逐月体重（kg）',
      legend: isHeight
        ? [{ id: 'guoguo', name: '果果身高', color: '#EC5B8C', on: true }]
        : extra.MEMBERS.map(m => Object.assign({}, m, { on: this.data.visible.indexOf(m.id) >= 0 })),
    });
  },

  switchMetric(e) { this.setData({ metric: e.currentTarget.dataset.metric }, () => this.refresh()); },
  switchMode(e) { this.setData({ mode: e.currentTarget.dataset.mode }, () => this.refresh()); },
  prevYear() {
    const i = this.data.years.indexOf(this.data.year);
    if (i > 0) this.setData({ year: this.data.years[i - 1] }, () => this.refresh());
  },
  nextYear() {
    const i = this.data.years.indexOf(this.data.year);
    if (i >= 0 && i < this.data.years.length - 1) this.setData({ year: this.data.years[i + 1] }, () => this.refresh());
  },
  toggleMember(e) {
    if (this.data.metric === 'height') return;
    const id = e.currentTarget.dataset.id;
    const v = this.data.visible.slice();
    const i = v.indexOf(id);
    if (i >= 0) {
      if (v.length === 1) { toast('至少保留一位成员'); return; }
      v.splice(i, 1);
    } else v.push(id);
    this.setData({ visible: v }, () => this.refresh());
  },

  onMonthChange(e) {
    const i = Number(e.detail.value);
    this.setData({ monthIndex: i, 'form.ym': this.data.monthKeys[i] });
  },
  chooseMember(e) { this.setData({ 'form.memberId': e.currentTarget.dataset.id }); },
  onWeightInput(e) { this.setData({ 'form.weight': e.detail.value }); },
  onHeightInput(e) { this.setData({ 'form.height': e.detail.value }); },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value }); },

  save() {
    const f = this.data.form;
    const r = extra.saveWeight({
      ym: f.ym, member_id: f.memberId,
      weight: f.weight, height: f.height, note: f.note,
    });
    if (r.error) {
      const msg = {
        BAD_WEIGHT: '请输入有效体重（0-400kg）',
        BAD_HEIGHT: '请输入有效身高（0-250cm）',
        EMPTY_VALUE: '体重或身高至少填一项',
        HEIGHT_ONLY_CHILD: '身高仅记录果果',
      };
      toast(msg[r.error] || '保存失败，请检查月份');
      return;
    }
    this.setData({
      'form.weight': '', 'form.height': '', 'form.note': '',
      year: Number(f.ym.slice(0, 4)), mode: 'year',
    });
    toast('已保存');
    this.refresh();
  },
  removeWeight(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除记录', content: '确定删除这条记录吗？',
      success: (res) => {
        if (!res.confirm) return;
        extra.removeWeight(id);
        toast('已删除');
        this.refresh();
      },
    });
  },
  onDotTap(e) {
    const unit = this.data.metric === 'height' ? ' cm' : ' kg';
    toast(e.currentTarget.dataset.label + '：' + e.currentTarget.dataset.value + unit);
  },
});
