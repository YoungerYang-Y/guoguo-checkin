// 家庭管理页：创建家庭 / 家庭码加入 / 成员审批 / 访客只读链接
const family = require('../../utils/family.js');
const cloudstore = require('../../utils/cloudstore.js');
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const D = require('../../utils/date.js');

const app = getApp();
const toast = (title, icon) => { try { wx.showToast({ title, icon: icon || 'none' }); } catch (e) {} };

Page({
  data: {
    status: 'loading',        // loading | noauth | none | pending | active
    identity: null,           // { familyId, memberKey, role, name }
    pendingFamilyId: '',      // 我的待审家庭码
    members: [],
    loggedIn: false,
    errorMsg: '',
    // 创建/加入表单
    createName: '果果家庭',
    createRole: 'mama',
    roleOptions: [
      { key: 'mama', label: '妈妈', role: 'admin' },
      { key: 'papa', label: '爸爸', role: 'parent' },
    ],
    joinCode: '',
    joinRole: 'papa',
    joinName: '家人',
    busy: false,
    // 访客链接
    visitorToken: '',
    visitorExpires: '',
  },

  onLoad() { this.refresh(); },
  onShow() { this.refresh(); },

  async refresh() {
    const s = cloudstore.getState();
    this.setData({ loggedIn: !!s.loggedIn });
    if (!s.loggedIn) { this.setData({ status: 'noauth' }); return; }
    try {
      const membership = await family.getMyMembership();
      const id = family.getIdentity();
      if (id && id.status === 'active' && id.familyId) {
        this.setData({ status: 'active', identity: id, errorMsg: '' });
        await this.loadMembers();
        this.loadVisitorToken();
      } else if (membership && membership.status === 'pending') {
        this.setData({ status: 'pending', pendingFamilyId: membership.family_id, identity: null });
      } else {
        this.setData({ status: 'none', identity: null });
      }
    } catch (e) {
      this.setData({ status: 'none', errorMsg: (e && e.message) || '读取家庭状态失败' });
    }
  },

  async loadMembers() {
    try {
      const list = await family.listMembers();
      const roleLabel = { admin: '管理员', parent: '家长', child: '孩子' };
      const statusLabel = { active: '已加入', pending: '待批准', left: '已退出' };
      const members = list.map(m => Object.assign({}, m, {
        roleLabel: roleLabel[m.role] || m.role,
        statusLabel: statusLabel[m.status] || m.status,
        isSelf: m.uid === (this.data.identity && this.data.identity.uid),
      }));
      // 待批准排前
      members.sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));
      this.setData({ members });
    } catch (e) {
      toast('读取成员列表失败');
    }
  },

  loadVisitorToken() {
    try {
      const t = wx.getStorageSync('gg_visitor_link');
      if (t && t.token) this.setData({ visitorToken: t.token, visitorExpires: this.fmtDate(t.expiresAt) });
    } catch (e) {}
  },

  // ---------- 表单输入 ----------
  onCreateName(e) { this.setData({ createName: e.detail.value }); },
  onJoinCode(e) { this.setData({ joinCode: e.detail.value }); },
  onJoinName(e) { this.setData({ joinName: e.detail.value }); },
  pickCreateRole(e) { this.setData({ createRole: e.currentTarget.dataset.key }); },
  pickJoinRole(e) { this.setData({ joinRole: e.currentTarget.dataset.key }); },

  // ---------- 创建家庭 ----------
  async doCreate() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const id = await family.createFamily(this.data.createName.trim() || '果果家庭', this.data.createRole);
      await cloudstore.adoptCreatedFamily(id);
      toast('家庭已创建', 'success');
      await this.refresh();
    } catch (e) {
      toast((e && e.message) || '创建失败');
    } finally {
      this.setData({ busy: false });
    }
  },

  // ---------- 申请加入 ----------
  async doJoin() {
    if (this.data.busy) return;
    const code = this.data.joinCode.trim();
    if (!code) { toast('请输入家庭码'); return; }
    this.setData({ busy: true });
    try {
      await family.requestJoin(code, this.data.joinRole, this.data.joinName.trim() || '家人');
      toast('已申请，等待创建人同意', 'success');
      await this.refresh();
    } catch (e) {
      toast((e && e.message) || '加入失败');
    } finally {
      this.setData({ busy: false });
    }
  },

  // ---------- 批准成员 ----------
  onApprove(e) {
    const uid = e.currentTarget.dataset.uid;
    wx.showModal({
      title: '批准加入',
      content: '同意该成员加入家庭？加入后可查看家庭数据并打卡。',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await family.approveMember(uid);
          toast('已批准', 'success');
          await this.loadMembers();
        } catch (err) {
          toast((err && err.message) || '批准失败');
        }
      },
    });
  },

  // ---------- 复制家庭码 ----------
  copyFamilyCode() {
    const fid = (this.data.identity && this.data.identity.familyId) || '';
    if (!fid) return;
    wx.setClipboardData({ data: fid, success: () => toast('家庭码已复制') });
  },

  // ---------- 访客链接 ----------
  // 脱敏快照：称谓映射「孩子/家长A/家长B」，只留聚合指标，无任何明细/备注/主题/家庭码
  buildVisitorSnapshot() {
    const d = D.today();
    const report = stats.buildReport('week', d);
    const alias = (id, idx) => {
      const m = store.getFamily().members.find(x => x.id === id);
      if (m && m.role === 'child') return '孩子';
      return idx === 0 ? '家长A' : '家长B';
    };
    const members = store.getFamily().members;
    let parentIdx = 0;
    const summary = members.map(m => {
      const r = report.members[m.id] || {};
      const dims = r.dims || {};
      const label = m.role === 'child' ? '孩子' : alias(m.id, parentIdx++);
      return {
        label,
        valid: !!r.valid,
        completion: dims.completion,
        index: dims.index,
        effectiveDays: r.effectiveDays,
        fullDays: r.detail ? r.detail.fullDays : 0,
      };
    });
    return {
      period: report.title || '本周',
      generatedAt: new Date().toISOString(),
      totalDone: report.totalDone || 0,
      streak: stats.streak('guoguo', D.addDays(d, -1), D.addDays(d, -60)),
      members: summary,
      note: '访客只读快照 · 不含明细与家庭码',
    };
  },

  async doCreateVisitorLink() {
    if (this.data.busy) return;
    if (!this.data.identity || this.data.identity.role !== 'admin') { toast('仅管理员可生成访客链接'); return; }
    this.setData({ busy: true });
    try {
      const snap = this.buildVisitorSnapshot();
      const res = await family.createVisitorLink(snap, 7);
      try { wx.setStorageSync('gg_visitor_link', res); } catch (e) {}
      this.setData({ visitorToken: res.token, visitorExpires: this.fmtDate(res.expiresAt) });
      toast('访客链接已生成（7 天有效）', 'success');
    } catch (e) {
      toast((e && e.message) || '生成失败');
    } finally {
      this.setData({ busy: false });
    }
  },

  copyVisitorLink() {
    const token = this.data.visitorToken;
    if (!token) return;
    const link = '/pages/guest/guest?token=' + encodeURIComponent(token);
    wx.setClipboardData({ data: link, success: () => toast('访客链接已复制，可发给亲友查看') });
  },

  revokeVisitorLink() {
    const token = this.data.visitorToken;
    if (!token) return;
    wx.showModal({
      title: '撤销访客链接',
      content: '撤销后该链接立即失效，对方将无法再查看。',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await family.revokeVisitorLink(token);
          try { wx.removeStorageSync('gg_visitor_link'); } catch (e) {}
          this.setData({ visitorToken: '', visitorExpires: '' });
          toast('已撤销', 'success');
        } catch (err) {
          toast((err && err.message) || '撤销失败');
        }
      },
    });
  },

  fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  },

  goLoginHint() {
    wx.showModal({
      title: '需要用微信登录',
      content: 'H5 预览面板无法获取微信登录凭证。请用微信扫码打开小程序，登录后即可创建或加入家庭。',
      showCancel: false,
    });
  },
});
