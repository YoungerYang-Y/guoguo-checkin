// 家庭管理页：创建家庭 / 家庭码加入 / 邀请卡片分享 / 成员审批 / 访客只读卡片分享
const family = require('../../utils/family.js');
const cloudstore = require('../../utils/cloudstore.js');
const store = require('../../utils/store.js');
const stats = require('../../utils/stats.js');
const D = require('../../utils/date.js');

const app = getApp();
const toast = (title, icon) => { try { wx.showToast({ title, icon: icon || 'none' }); } catch (e) {} };

Page({
  // 输入聚焦反馈：WXSS 无 :focus，只能由事件切换 class
  onFieldFocus() { if (!this.data.fieldFocus) this.setData({ fieldFocus: true }); },
  onFieldBlur() { if (this.data.fieldFocus) this.setData({ fieldFocus: false }); },
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
    // 身份（member_key）只决定数据归属与代签对象，不决定权限
    roleOptions: [
      { key: 'mama', label: '妈妈' },
      { key: 'papa', label: '爸爸' },
      { key: 'guoguo', label: '孩子' },
    ],
    joinCode: '',
    joinRole: 'papa',
    joinName: '家人',
    busy: false,
    // 成员邀请（卡片分享用，只有 inv_xxx token，不含家庭码）
    inviteToken: '',
    inviteExpires: '',
    // 点邀请卡片进入时解析出的邀请信息（familyId 只留内存，不写回任何分享参数）
    incomingInvite: null,
    incomingError: '',
    // 访客链接（卡片分享用）
    visitorToken: '',
    visitorExpires: '',
    // 家庭设置：名称 / 显示名 / 角色（角色与身份 member_key 完全分离）
    familyName: '',
    familyNameDraft: '',
    editingFamilyName: false,
    editingNameUid: '',
    nameDraft: '',
    isAdmin: false,
    createDisplayName: '',
  },

  onLoad(options) {
    // 微信卡片 path: /pages/family/family?invite=inv_xxx
    this._incomingToken = (options && options.invite) || '';
    this.refresh();
  },
  onShow() { this.refresh(); },

  refresh() {
    if (this._refreshPromise) return this._refreshPromise;
    this._refreshPromise = this.refreshState().finally(() => { this._refreshPromise = null; });
    return this._refreshPromise;
  },

  async refreshState() {
    this.setData({ status: 'loading', errorMsg: '' });
    try {
      if (app.cloudReady && typeof app.cloudReady.then === 'function') await app.cloudReady;
      if (this._incomingToken && !this._inviteResolved) {
        const token = this._incomingToken;
        this._inviteResolved = true;
        try {
          const invite = await family.resolveInvite(token);
          if (invite.valid) this.setData({ incomingInvite: invite, incomingError: '' });
          else this.setData({ incomingError: invite.reason });
        } catch (e) {
          this.setData({ incomingError: '邀请链接读取失败，请检查网络' });
        }
      }

      const state = await cloudstore.refreshMembership();
      this.setData({ loggedIn: !!state.loggedIn });
      if (!state.loggedIn) { this.setData({ status: 'noauth', identity: null, members: [] }); return; }
      if (state.lastError && (state.familyId || (family.getIdentity() && family.getIdentity().status === 'active'))) throw new Error(state.lastError);

      const membership = await family.getMyMembership();
      // refreshMembership has refreshed the cloud identity; never trust the pre-launch cache here.
      const id = family.getIdentity();
      if (id && id.status === 'active' && id.familyId) {
        const admin = family.isAdmin(id);
        this.setData({ status: 'active', identity: id, isAdmin: admin, errorMsg: state.lastError || '' });
        await this.loadMembers();
        this.loadVisitorToken();
        try {
          const fname = await family.getFamilyName();
          this.setData({ familyName: fname, familyNameDraft: fname });
        } catch (e) { /* 名称读取失败不阻塞主流程 */ }
        if (admin) await this.ensureInvite();
      } else if (membership && membership.status === 'pending') {
        this.setData({ status: 'pending', pendingFamilyId: membership.family_id, identity: null });
      } else {
        this.setData({ status: 'none', identity: null, members: [] });
      }
    } catch (e) {
      const state = cloudstore.getState();
      this.setData({
        loggedIn: !!state.loggedIn,
        status: state.loggedIn ? 'none' : 'noauth',
        identity: null,
        members: [],
        errorMsg: (e && e.message) || '读取家庭状态失败',
      });
    }
  },

  // 确保有一个可用的成员邀请 token：优先用本地缓存（校验有效），失效则新建
  async ensureInvite() {
    if (this.data.inviteToken) return;
    try {
      const cached = family.getCachedInvite();
      if (cached && cached.token) {
        const r = await family.resolveInvite(cached.token);
        if (r.valid) {
          this.setData({ inviteToken: cached.token, inviteExpires: this.fmtDate(cached.expiresAt) });
          return;
        }
      }
      const res = await family.createInviteLink();
      this.setData({ inviteToken: res.token, inviteExpires: this.fmtDate(res.expiresAt) });
    } catch (e) {
      // 不阻塞主流程：分享按钮在 token 为空时不渲染，可下拉重试
    }
  },

  // 微信卡片转发：用 e.target.dataset.kind 区分「邀请家人」和「访客只读」
  // 家庭码 fam_xxx 绝不出现在任何 path / query 里，只传 inv_ / vis_ token
  onShareAppMessage(e) {
    const kind = e && e.from === 'button' && e.target && e.target.dataset ? e.target.dataset.kind : '';
    if (kind === 'invite') {
      const token = this.data.inviteToken;
      if (!token) return { title: '果果家庭打卡 · 一起坚持每一天', path: '/pages/family/family' };
      return {
        title: '邀请你加入果果家庭打卡 · 一起坚持每一天',
        path: '/pages/family/family?invite=' + encodeURIComponent(token),
      };
    }
    if (kind === 'visitor') {
      const token = this.data.visitorToken;
      if (!token) return { title: '果果家庭打卡 · 一起坚持每一天', path: '/pages/family/family' };
      return {
        title: '果果家庭打卡 · 本周概览（只读）',
        path: '/pages/guest/guest?token=' + encodeURIComponent(token),
      };
    }
    // 右上角菜单默认转发：引导到家庭页，不带任何 token / 家庭码
    return { title: '果果家庭打卡 · 一起坚持每一天', path: '/pages/family/family' };
  },

  // 点邀请卡片后「接受邀请」：用内存里的 familyId 直接申请，不展示给用户也不写入链接
  async acceptInvite() {
    const inv = this.data.incomingInvite;
    if (!inv || !inv.familyId) return;
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      if (app.cloudReady && typeof app.cloudReady.then === 'function') await app.cloudReady;
      const state = await cloudstore.refreshMembership();
      this.setData({ loggedIn: !!state.loggedIn });
      if (!state.loggedIn) { this.goLoginHint(); return; }
      const identity = family.getIdentity();
      if (identity && identity.status === 'active') {
        toast(identity.familyId === inv.familyId ? '你已经在这个家庭里了' : '当前账号已加入其他家庭，不能再申请加入');
        return;
      }
      await family.requestJoin(inv.familyId, this.data.joinRole, this.data.joinName.trim() || '家人');
      toast('已申请，等待创建人同意', 'success');
      this.setData({ incomingInvite: null });
      await this.refresh();
    } catch (err) {
      toast((err && err.message) || '加入失败');
    } finally {
      this.setData({ busy: false });
    }
  },

  async loadMembers() {
    try {
      const list = await family.listMembers();
      const statusLabel = { active: '已加入', pending: '待批准', left: '已退出' };
      const admin = this.data.isAdmin;
      const selfUid = this.data.identity && this.data.identity.uid;
      const members = list.map(m => Object.assign({}, m, {
        roleLabel: (family.ROLE_LABELS || {})[m.role] || m.role,
        roleValue: family.normalizeRole(m.role),
        statusLabel: statusLabel[m.status] || m.status,
        isSelf: m.uid === selfUid,
        canEditName: admin || m.uid === selfUid,
        canSwitchRole: admin && m.status === 'active',
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
  onCreateDisplayName(e) { this.setData({ createDisplayName: e.detail.value }); },
  onJoinCode(e) { this.setData({ joinCode: e.detail.value }); },
  onJoinName(e) { this.setData({ joinName: e.detail.value }); },
  pickCreateRole(e) { this.setData({ createRole: e.currentTarget.dataset.key }); },
  pickJoinRole(e) { this.setData({ joinRole: e.currentTarget.dataset.key }); },

  // ---------- 创建家庭 ----------
  async doCreate() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const id = await family.createFamily(
        this.data.createName.trim() || '果果家庭',
        this.data.createRole,
        this.data.createDisplayName.trim() || '我'
      );
      await cloudstore.adoptCreatedFamily(id);
      toast('家庭已创建', 'success');
      await this.refresh();
    } catch (e) {
      toast((e && e.message) || '创建失败');
    } finally {
      this.setData({ busy: false });
    }
  },

  // ---------- 申请加入（手动输入家庭码） ----------
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

  // ---------- 复制家庭码（备用：对方手动输入） ----------
  copyFamilyCode() {
    const fid = (this.data.identity && this.data.identity.familyId) || '';
    if (!fid) return;
    wx.setClipboardData({ data: fid, success: () => toast('家庭码已复制') });
  },

  // ---------- 成员邀请链接 ----------
  async doCreateInvite() {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      const res = await family.createInviteLink();
      this.setData({ inviteToken: res.token, inviteExpires: this.fmtDate(res.expiresAt) });
      toast('新邀请已生成，旧邀请已失效', 'success');
    } catch (e) {
      toast((e && e.message) || '生成失败');
    } finally {
      this.setData({ busy: false });
    }
  },

  copyInviteLink() {
    const token = this.data.inviteToken;
    if (!token) return;
    const link = '/pages/family/family?invite=' + encodeURIComponent(token);
    wx.setClipboardData({ data: link, success: () => toast('邀请路径已复制（也可直接点分享按钮转发卡片）') });
  },

  revokeInviteLink() {
    const token = this.data.inviteToken;
    if (!token) return;
    wx.showModal({
      title: '撤销家庭邀请',
      content: '撤销后该邀请链接立即失效，对方将无法通过它申请加入。',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await family.revokeInviteLink(token);
          this.setData({ inviteToken: '', inviteExpires: '' });
          toast('邀请已撤销', 'success');
        } catch (err) {
          toast((err && err.message) || '撤销失败');
        }
      },
    });
  },

  // ---------- 访客只读链接 ----------
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
    if (!this.data.isAdmin) { toast('仅管理员可生成访客链接'); return; }
    this.setData({ busy: true });
    try {
      const snap = this.buildVisitorSnapshot();
      const res = await family.createVisitorLink(snap, 7);
      try { wx.setStorageSync('gg_visitor_link', res); } catch (e) {}
      this.setData({ visitorToken: res.token, visitorExpires: this.fmtDate(res.expiresAt) });
      toast('访客链接已生成（7 天有效），点分享转发', 'success');
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
    wx.setClipboardData({ data: link, success: () => toast('访客路径已复制（也可直接点分享按钮转发卡片）') });
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

  // ---------- 家庭名称 / 显示名 / 角色 / 退出 ----------
  editFamilyName() { this.setData({ editingFamilyName: true, familyNameDraft: this.data.familyName }); },
  cancelFamilyName() { this.setData({ editingFamilyName: false, familyNameDraft: this.data.familyName }); },
  onFamilyNameInput(e) { this.setData({ familyNameDraft: e.detail.value }); },
  async saveFamilyName() {
    const v = (this.data.familyNameDraft || '').trim();
    if (!v) { toast('家庭名称不能为空'); return; }
    if (v === this.data.familyName) { this.setData({ editingFamilyName: false }); return; }
    this.setData({ busy: true });
    try {
      const name = await family.renameFamily(v);
      this.setData({ familyName: name, familyNameDraft: name, editingFamilyName: false });
      toast('家庭名称已更新', 'success');
    } catch (e) { toast((e && e.message) || '保存失败'); }
    finally { this.setData({ busy: false }); }
  },

  onEditMemberName(e) {
    const { uid, name } = e.currentTarget.dataset;
    this.setData({ editingNameUid: uid, nameDraft: name || '' });
  },
  cancelMemberName() { this.setData({ editingNameUid: '', nameDraft: '' }); },
  onNameDraft(e) { this.setData({ nameDraft: e.detail.value }); },
  async saveMemberName() {
    const uid = this.data.editingNameUid;
    const v = (this.data.nameDraft || '').trim();
    if (!uid || !v) { toast('显示名不能为空'); return; }
    this.setData({ busy: true });
    try {
      await family.updateDisplayName(uid, v);
      // 本地成员表里的显示名同步更新，保证首页/报表称谓一致
      const m = this.data.members.find(x => x.uid === uid);
      if (m && m.member_key) store.updateMemberName(m.member_key, v);
      this.setData({ editingNameUid: '', nameDraft: '' });
      toast('显示名已更新', 'success');
      await this.refresh();
    } catch (e) { toast((e && e.message) || '保存失败'); }
    finally { this.setData({ busy: false }); }
  },

  onToggleRole(e) {
    const { uid, role } = e.currentTarget.dataset;
    const next = role === 'admin' ? 'member' : 'admin';
    wx.showModal({
      title: next === 'admin' ? '设为管理员' : '设为成员',
      content: next === 'admin'
        ? '管理员可审批成员、修改家庭名与角色、生成邀请和访客链接。'
        : '成员可打卡、代签、管理自己的目标，但不能管理家庭设置。',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        try {
          await family.setMemberRole(uid, next);
          toast('角色已更新', 'success');
          await this.refresh();
        } catch (err) { toast((err && err.message) || '角色更新失败'); }
        finally { this.setData({ busy: false }); }
      },
    });
  },

  doLeaveFamily() {
    wx.showModal({
      title: '退出家庭',
      content: '退出后本机家庭数据会被清空；再次加入需要新的邀请并重新审批。确定退出吗？',
      confirmText: '退出', confirmColor: '#d93026',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        try {
          await family.leaveFamily();
          cloudstore.forgetFamily();
          this.setData({ inviteToken: '', visitorToken: '', familyName: '', members: [], isAdmin: false });
          toast('已退出家庭', 'success');
          await this.refresh();
        } catch (e) { toast((e && e.message) || '退出失败'); }
        finally { this.setData({ busy: false }); }
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
