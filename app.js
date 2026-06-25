/* ============================================================
   SUPABASE 配置 — 填入你自己的 URL 和 Key
   ============================================================ */
const SUPABASE_URL = 'https://zuirzfpqkwjcyktmvsuz.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp1aXJ6ZnBxa3dqY3lrdG12c3V6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI0MDI5ODgsImV4cCI6MjA5Nzk3ODk4OH0.QuAHlZUReQpEFcIKEXgepJ3LixuW1NjYKTiDJnBqDDg'; // 替换：anon public key

// 每张表的主键字段名
const TABLE_PK = {
  user_info: 'user_id', repair_order: 'order_id', repairman_skill: 'repairman_id',
  assign_record: 'assign_id', repair_feedback: 'feedback_id', material_usage: 'record_id',
  notice: 'notice_id', complaint: 'complaint_id', message_push: 'push_id',
  sys_config: 'config_id', sys_log: 'log_id'
};

const ALL_TABLES = Object.keys(TABLE_PK);

/* ============================================================
   SYNC MODULE — Supabase 实时同步层
   ============================================================ */
const SYNC = {
  client: null,
  enabled: false,
  _realtimeChannel: null,

  async init() {
    if (SUPABASE_URL === 'YOUR_SUPABASE_URL') {
      console.warn('⚠️ 未配置 Supabase，以单机离线模式运行');
      showSyncStatus('offline');
      return;
    }
    try {
      const { createClient } = supabase;
      this.client  = createClient(SUPABASE_URL, SUPABASE_KEY);
      this.enabled = true;
      showSyncStatus('connecting');
      await this.pullAll();
      this.subscribeRealtime();
      showSyncStatus('online');
    } catch(e) {
      console.warn('Supabase 连接失败，降级为离线模式', e);
      showSyncStatus('offline');
    }
  },

  // 从 Supabase 拉取所有表，云端有数据则覆盖本地
  async pullAll() {
    if (!this.enabled) return;
    for (const table of ALL_TABLES) {
      try {
        const { data, error } = await this.client.from(table).select('*');
        if (error || !data) continue;
        if (data.length > 0) DB._d[table] = data;
      } catch(e) { /* 单表失败不影响其他表 */ }
    }
    DB.save();
  },

  // 写操作同步到 Supabase
  async push(table, operation, row, id) {
    if (!this.enabled) return;
    const pk = TABLE_PK[table];
    try {
      if (operation === 'insert' || operation === 'upsert') {
        await this.client.from(table).upsert(row);
      } else if (operation === 'update') {
        await this.client.from(table).update(row).eq(pk, id);
      } else if (operation === 'delete') {
        await this.client.from(table).delete().eq(pk, id);
      }
    } catch(e) {
      console.warn(`Sync push [${table}] 失败:`, e);
    }
  },

  // 实时监听所有表变化 → 自动刷新当前页
  subscribeRealtime() {
    if (!this.enabled) return;
    this._realtimeChannel = this.client
      .channel('public-all-changes')
      .on('postgres_changes', { event: '*', schema: 'public' }, async () => {
        await this.pullAll(false);
        // 刷新当前页面（不跳转）
        if (currentUser && currentPage) {
          destroyCharts();
          const mc = document.getElementById('main-content');
          mc.innerHTML = renderPage(currentPage, pageParams);
          attachPageEvents(currentPage);
          updateMsgBadge();
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') showSyncStatus('online');
      });
  }
};

// 顶部连接状态指示器
function showSyncStatus(status) {
  let el = document.getElementById('sync-status');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sync-status';
    el.style.cssText = 'position:fixed;bottom:1.5rem;left:1.5rem;padding:.35rem .8rem;' +
      'border-radius:999px;font-size:.75rem;font-weight:600;z-index:9999;' +
      'display:flex;align-items:center;gap:.4rem;box-shadow:0 2px 8px rgba(0,0,0,.15)';
    document.body.appendChild(el);
  }
  const cfg = {
    online:      { bg:'#DCFCE7', color:'#166534', dot:'#22C55E', text:'☁️ 云端已连接' },
    offline:     { bg:'#F1F5F9', color:'#64748B', dot:'#94A3B8', text:'💾 离线模式'   },
    connecting:  { bg:'#FEF9C3', color:'#854D0E', dot:'#F59E0B', text:'⏳ 正在连接…'  },
  };
  const c = cfg[status] || cfg.offline;
  el.style.background = c.bg;
  el.style.color       = c.color;
  el.innerHTML = `<span style="width:8px;height:8px;border-radius:50%;background:${c.dot};display:inline-block"></span>${c.text}`;
}

/* ============================================================
   DB MODULE
   ============================================================ */
const DB = {
  KEY: 'dorm_repair_db',
  _d: null,

  load() {
    const raw = localStorage.getItem(this.KEY);
    this._d = raw ? JSON.parse(raw) : null;
    if (!this._d) { this._d = createSeedData(); this.save(); }
    return this._d;
  },

  save() { localStorage.setItem(this.KEY, JSON.stringify(this._d)); },

  get(table) { return this._d[table] || []; },

  insert(table, row) {
    if (!this._d[table]) this._d[table] = [];
    this._d[table].push(row);
    this.save();
    SYNC.push(table, 'insert', row);
    return row;
  },

  update(table, idField, id, patch) {
    const arr = this._d[table];
    const i = arr.findIndex(r => r[idField] === id);
    if (i >= 0) {
      arr[i] = { ...arr[i], ...patch };
      this.save();
      SYNC.push(table, 'update', patch, id);
      return arr[i];
    }
    return null;
  },

  remove(table, idField, id) {
    this._d[table] = this._d[table].filter(r => r[idField] !== id);
    this.save();
    SYNC.push(table, 'delete', null, id);
  },

  reset() {
    this._d = createSeedData();
    this.save();
    // 云端同步重置
    if (SYNC.enabled) {
      ALL_TABLES.forEach(t => {
        (this._d[t] || []).forEach(row => SYNC.push(t, 'upsert', row));
      });
    }
  }
};

/* ============================================================
   SEED DATA
   ============================================================ */
function ts(daysAgo, hoursAgo = 0) {
  return Date.now() - daysAgo * 86400000 - hoursAgo * 3600000;
}

function createSeedData() {
  const now = Date.now();
  return {
    user_info: [
      { user_id: 'U001', name: '韩房佳茵', role: 'student',    contact: '13800138001', dorm_building: '知新楼', password: '123456' },
      { user_id: 'U002', name: '李明阳',   role: 'student',    contact: '13800138002', dorm_building: '励学楼', password: '123456' },
      { user_id: 'U003', name: '王璐曜',   role: 'dorm_admin', contact: '13800138003', dorm_building: '知新楼', password: '123456' },
      { user_id: 'U004', name: '周天临',   role: 'repairman',  contact: '13800138004', dorm_building: '',       password: '123456' },
      { user_id: 'U005', name: '张国强',   role: 'repairman',  contact: '13800138005', dorm_building: '',       password: '123456' },
      { user_id: 'U006', name: '刘明泽',   role: 'repairman',  contact: '13800138006', dorm_building: '',       password: '123456' },
      { user_id: 'U007', name: '余锐新',   role: 'admin',      contact: '13800138007', dorm_building: '',       password: '123456' },
    ],
    repairman_skill: [
      { repairman_id: 'U004', skill_tag: '水电', workload: 2, schedule: '周一至周五 08:00-17:00', avg_score: 4.6 },
      { repairman_id: 'U005', skill_tag: '家具', workload: 1, schedule: '周一至周六 09:00-18:00', avg_score: 4.3 },
      { repairman_id: 'U006', skill_tag: '空调', workload: 3, schedule: '周二至周日 08:00-16:00', avg_score: 4.8 },
    ],
    repair_order: [
      {
        order_id: 'JD10001', user_id: 'U001', fault_type: '水电',
        description: '宿舍洗手间水龙头漏水，已影响正常使用，请尽快派人维修。',
        img_url: '', address: '知新楼 301室', appoint_time: '',
        need_company: false, status: 'completed', create_time: ts(10),
        assign_time: ts(9), repair_time: ts(8), complete_time: ts(7),
        repair_result: '更换了水龙头密封圈，漏水问题已解决。', complete_img: ''
      },
      {
        order_id: 'JD10002', user_id: 'U001', fault_type: '网络',
        description: '宿舍网络端口无法连接，网线插入后无信号，影响学习。',
        img_url: '', address: '知新楼 301室', appoint_time: '',
        need_company: true, status: 'to_evaluate', create_time: ts(5),
        assign_time: ts(4), repair_time: ts(3), complete_time: null,
        repair_result: '重新压制了网线水晶头，端口恢复正常。', complete_img: ''
      },
      {
        order_id: 'JD10003', user_id: 'U002', fault_type: '空调',
        description: '空调不制冷，开机后只吹热风，室内温度过高无法正常休息。',
        img_url: '', address: '励学楼 215室', appoint_time: '',
        need_company: false, status: 'repairing', create_time: ts(3),
        assign_time: ts(2), repair_time: null, complete_time: null,
        repair_result: '', complete_img: ''
      },
      {
        order_id: 'JD10004', user_id: 'U001', fault_type: '家具',
        description: '上铺床架松动，翻身时有异响，存在安全隐患，请尽快检修。',
        img_url: '', address: '知新楼 301室', appoint_time: '',
        need_company: false, status: 'assigned', create_time: ts(2),
        assign_time: ts(1), repair_time: null, complete_time: null,
        repair_result: '', complete_img: ''
      },
      {
        order_id: 'JD10005', user_id: 'U002', fault_type: '门窗',
        description: '宿舍门锁损坏，无法从外部开锁，严重影响出入安全。',
        img_url: '', address: '励学楼 215室', appoint_time: '',
        need_company: true, status: 'pending', create_time: ts(1),
        assign_time: null, repair_time: null, complete_time: null,
        repair_result: '', complete_img: ''
      },
    ],
    assign_record: [
      { assign_id: 'AS001', order_id: 'JD10001', repairman_id: 'U004', assign_time: ts(9), is_auto: true },
      { assign_id: 'AS002', order_id: 'JD10002', repairman_id: 'U004', assign_time: ts(4), is_auto: false },
      { assign_id: 'AS003', order_id: 'JD10003', repairman_id: 'U006', assign_time: ts(2), is_auto: true },
      { assign_id: 'AS004', order_id: 'JD10004', repairman_id: 'U005', assign_time: ts(1), is_auto: true },
    ],
    repair_feedback: [
      { feedback_id: 'FB001', order_id: 'JD10001', speed_score: 5, attitude_score: 5, quality_score: 4, suggestion: '维修及时，态度很好，下次可以更快一些。', feedback_time: ts(7) },
    ],
    material_usage: [
      { record_id: 'MU001', order_id: 'JD10001', material_name: '水龙头密封圈', quantity: 2, use_time: ts(8) },
    ],
    notice: [
      { notice_id: 'NT001', publisher_id: 'U007', title: '暑期宿舍报修服务时间调整通知', content: '因暑期维修人员部分休假，7月15日至8月15日期间，报修服务时间调整为每周一、三、五上午9:00-12:00，请同学们合理安排报修时间。紧急情况请拨打宿舍管理处电话。', target_role: 'all', publish_time: ts(3), status: 'active' },
      { notice_id: 'NT002', publisher_id: 'U007', title: '关于空调维修排期的说明', content: '近期空调报修量较大，预计等待时间为3-5个工作日，感谢同学们的理解与配合。', target_role: 'student', publish_time: ts(1), status: 'active' },
    ],
    complaint: [
      { complaint_id: 'CP001', user_id: 'U001', order_id: 'JD10001', type: 'order', content: '维修人员上门时间与预约时间相差两小时，希望以后能准时。', status: 'resolved', reply_content: '非常抱歉给您带来不便，我们已对维修人员进行了提醒，后续会严格管控时效。', reply_user_id: 'U007', create_time: ts(6), reply_time: ts(5) },
    ],
    message_push: [
      { push_id: 'MP001', user_id: 'U001', order_id: 'JD10002', push_type: 'status_change', content: '您的工单 JD10002（网络）已完成维修，请及时进行评价。', push_time: ts(3), is_read: false },
      { push_id: 'MP002', user_id: 'U004', order_id: 'JD10002', push_type: 'assigned',      content: '您有新的维修任务：JD10002（网络），地点：知新楼 301室，请尽快处理。', push_time: ts(4), is_read: true },
      { push_id: 'MP003', user_id: 'U007', order_id: 'JD10005', push_type: 'new_order',     content: '新工单待派单：JD10005（门窗），励学楼 215室。', push_time: ts(1), is_read: false },
    ],
    sys_config: [
      { config_id: 'CF001', config_key: 'auto_assign_enabled', config_value: 'true',  description: '是否启用智能自动派单', update_time: ts(30), update_user_id: 'U007' },
      { config_id: 'CF002', config_key: 'ai_inspect_enabled',  config_value: 'true',  description: '是否启用AI质检模拟', update_time: ts(30), update_user_id: 'U007' },
      { config_id: 'CF003', config_key: 'max_workload',        config_value: '5',     description: '每位维修人员最大同时工单数', update_time: ts(30), update_user_id: 'U007' },
    ],
    sys_log: [
      { log_id: 'L001', operator: '余锐新', operate_type: '派单',   operate_time: ts(9), result: '工单JD10001派单给周天临' },
      { log_id: 'L002', operator: '周天临', operate_type: '接单',   operate_time: ts(8), result: '工单JD10001开始维修' },
      { log_id: 'L003', operator: '周天临', operate_type: '完成维修', operate_time: ts(7), result: '工单JD10001完成，进入待评价' },
      { log_id: 'L004', operator: '韩房佳茵', operate_type: '评价', operate_time: ts(6), result: '工单JD10001评价完成' },
    ]
  };
}

/* ============================================================
   GLOBAL STATE
   ============================================================ */
let currentUser = null;
let currentPage = 'login';
let pageParams  = {};
let _charts     = {};

/* ============================================================
   AUTH
   ============================================================ */
function login(userId) {
  const user = DB.get('user_info').find(u => u.user_id === userId);
  if (!user) return;
  currentUser = user;
  sessionStorage.setItem('currentUser', JSON.stringify(user));
  document.getElementById('login-page').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  renderTopNav();
  renderSideNav();
  const home = defaultPage(user.role);
  navigate(home);
}

function logout() {
  currentUser = null;
  sessionStorage.removeItem('currentUser');
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('login-page').classList.remove('hidden');
  renderLoginPage();
}

function defaultPage(role) {
  return { student: 'student-orders', dorm_admin: 'dorm-overview', repairman: 'repairman-tasks', admin: 'admin-assign' }[role];
}

/* ============================================================
   ROUTER
   ============================================================ */
function navigate(pageId, params = {}) {
  currentPage  = pageId;
  pageParams   = params;
  destroyCharts();
  renderSideNav();
  const mc = document.getElementById('main-content');
  mc.innerHTML = renderPage(pageId, params);
  attachPageEvents(pageId);
  updateMsgBadge();
}

function renderPage(pageId, params) {
  switch(pageId) {
    case 'student-submit':       return renderStudentSubmit();
    case 'student-orders':       return renderStudentOrders(params.filter, params.highlightId);
    case 'student-order-detail': return renderStudentOrderDetail(params.orderId);
    case 'student-evaluate':     return renderStudentEvaluate(params.orderId);
    case 'student-complaint':    return renderStudentComplaint();
    case 'student-messages':     return renderStudentMessages();
    case 'dorm-overview':        return renderDormOverview();
    case 'dorm-register':        return renderDormRegister();
    case 'dorm-orders':          return renderDormOrders();
    case 'repairman-tasks':      return renderRepairmanTasks();
    case 'repairman-record':     return renderRepairmanRecord(params.orderId);
    case 'repairman-history':    return renderRepairmanHistory();
    case 'repairman-schedule':   return renderRepairmanSchedule();
    case 'admin-assign':         return renderAdminAssign();
    case 'admin-assign-records': return renderAdminAssignRecords();
    case 'admin-repairmen':      return renderAdminRepairmen();
    case 'admin-dashboard':      return renderAdminDashboard();
    case 'admin-notice':         return renderAdminNotice();
    case 'admin-complaint':      return renderAdminComplaint();
    case 'admin-log':            return renderAdminLog();
    default: return '<div class="empty-state"><span class="empty-icon">🔍</span><p>页面不存在</p></div>';
  }
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const NAV_ITEMS = {
  student: [
    { id: 'student-submit',    icon: '📝', label: '提交工单' },
    { id: 'student-orders',    icon: '📋', label: '我的工单' },
    { id: 'student-complaint', icon: '💬', label: '投诉建议' },
    { id: 'student-messages',  icon: '🔔', label: '消息通知' },
  ],
  dorm_admin: [
    { id: 'dorm-overview',  icon: '🏠', label: '楼栋总览' },
    { id: 'dorm-register',  icon: '📝', label: '协助登记' },
    { id: 'dorm-orders',    icon: '📋', label: '工单列表' },
    { id: 'student-messages', icon: '🔔', label: '消息通知' },
  ],
  repairman: [
    { id: 'repairman-tasks',    icon: '🔧', label: '待处理工单' },
    { id: 'repairman-history',  icon: '📋', label: '我的记录' },
    { id: 'repairman-schedule', icon: '📅', label: '排班管理' },
    { id: 'student-messages',   icon: '🔔', label: '消息通知' },
  ],
  admin: [
    { id: 'admin-assign',        icon: '📌', label: '待派单工单' },
    { id: 'admin-assign-records',icon: '📑', label: '派单记录' },
    { id: 'admin-repairmen',     icon: '👷', label: '维修人员管理' },
    { id: 'admin-dashboard',     icon: '📊', label: '数据统计看板' },
    { id: 'admin-notice',        icon: '📢', label: '通知公告' },
    { id: 'admin-complaint',     icon: '💬', label: '投诉处理' },
    { id: 'admin-log',           icon: '🗒️', label: '系统日志' },
  ]
};

function renderTopNav() {
  if (!currentUser) return;
  document.getElementById('nav-user-info').textContent =
    `当前身份：${currentUser.name}（${roleName(currentUser.role)}）`;
  updateMsgBadge();
}

function renderSideNav() {
  if (!currentUser) return;
  const items = NAV_ITEMS[currentUser.role] || [];
  document.getElementById('side-nav').innerHTML = items.map(item => `
    <div class="nav-item ${currentPage === item.id ? 'active' : ''}"
         data-page="${item.id}">
      <i class="nav-icon">${item.icon}</i>${item.label}
    </div>`).join('');
}

function updateMsgBadge() {
  if (!currentUser) return;
  const unread = DB.get('message_push').filter(m => m.user_id === currentUser.user_id && !m.is_read).length;
  const badge = document.getElementById('msg-badge');
  if (badge) { badge.textContent = unread; badge.classList.toggle('hidden', unread === 0); }
}

/* ============================================================
   UTILITIES
   ============================================================ */
function genId(prefix) { return prefix + Date.now() + Math.floor(Math.random()*1000); }

function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtDate(ts) {
  if (!ts) return '—';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function pad(n) { return String(n).padStart(2,'0'); }

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone;
  return phone.slice(0,3) + '****' + phone.slice(-4);
}

const STATUS_LABEL = {
  pending:     '待派单', assigned: '已派单', repairing: '维修中',
  to_evaluate: '待评价', completed: '已完成', rejected: '已退回', cancelled: '已取消'
};
const FAULT_TYPES = ['水电','家具','网络','空调','门窗','卫浴','其他'];

function statusBadge(status) {
  return `<span class="badge badge-${status}">${STATUS_LABEL[status] || status}</span>`;
}

function roleName(role) {
  return { student:'学生', dorm_admin:'宿舍管理员', repairman:'维修人员', admin:'系统管理员' }[role] || role;
}

function roleAvatar(role) {
  return { student:'👨‍🎓', dorm_admin:'🏠', repairman:'🔧', admin:'⚙️' }[role] || '👤';
}

function getUserName(userId) {
  const u = DB.get('user_info').find(u => u.user_id === userId);
  return u ? u.name : userId;
}

function getRepairmanSkill(repairmanId) {
  const s = DB.get('repairman_skill').find(s => s.repairman_id === repairmanId);
  return s || null;
}

function getOrderAssign(orderId) {
  const records = DB.get('assign_record').filter(a => a.order_id === orderId);
  return records.length ? records[records.length - 1] : null;
}

function emptyState(msg = '暂无数据') {
  return `<div class="empty-state"><span class="empty-icon">📭</span><p>${msg}</p></div>`;
}

/* ============================================================
   TOAST & MODAL
   ============================================================ */
function showToast(msg, type = '') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

function showModal(title, body, footer = '') {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML   = body;
  document.getElementById('modal-footer').innerHTML = footer;
  document.getElementById('modal-overlay').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
  document.getElementById('modal-body').innerHTML   = '';
  document.getElementById('modal-footer').innerHTML = '';
}

function confirm(msg, onConfirm) {
  showModal('确认操作',
    `<p style="font-size:.95rem;color:var(--text)">${msg}</p>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-danger" id="confirm-ok-btn">确认</button>`
  );
  setTimeout(() => {
    const btn = document.getElementById('confirm-ok-btn');
    if (btn) btn.onclick = () => { closeModal(); onConfirm(); };
  }, 0);
}

/* ============================================================
   BUSINESS LOGIC — STATE MACHINE CORE
   ============================================================ */
function updateOrderStatus(orderId, newStatus, meta = {}) {
  DB.update('repair_order', 'order_id', orderId, { status: newStatus, ...meta });
  const order = DB.get('repair_order').find(o => o.order_id === orderId);
  const operator = currentUser ? currentUser.name : '系统';

  // sys_log
  DB.insert('sys_log', {
    log_id: genId('L'), operator,
    operate_type: STATUS_LABEL[newStatus] || newStatus,
    operate_time: Date.now(),
    result: `工单${orderId}状态变更为【${STATUS_LABEL[newStatus]}】`
  });

  // message_push — notify relevant users
  const pushes = buildPushMessages(order, newStatus, meta);
  pushes.forEach(p => DB.insert('message_push', p));
}

function buildPushMessages(order, newStatus, meta) {
  const msgs = [];
  const now  = Date.now();
  const fmsg = (userId, content) => ({
    push_id: genId('MP'), user_id: userId, order_id: order.order_id,
    push_type: 'status_change', content, push_time: now, is_read: false
  });

  switch(newStatus) {
    case 'assigned':
      msgs.push(fmsg(order.user_id, `您的工单 ${order.order_id}（${order.fault_type}）已派单，请等待维修人员上门。`));
      if (meta.repairman_id) msgs.push(fmsg(meta.repairman_id, `您有新的维修任务：${order.order_id}（${order.fault_type}），地点：${order.address}。`));
      msgs.push(fmsg('U007', `工单 ${order.order_id} 已完成派单。`));
      break;
    case 'repairing':
      msgs.push(fmsg(order.user_id, `维修人员已接单，正在前往 ${order.address} 进行维修，请保持联系。`));
      break;
    case 'to_evaluate':
      msgs.push(fmsg(order.user_id, `您的工单 ${order.order_id}（${order.fault_type}）维修已完成，请进行评价。`));
      break;
    case 'completed':
      msgs.push(fmsg('U007', `工单 ${order.order_id} 已完成评价，全流程结束。`));
      break;
    case 'rejected':
      msgs.push(fmsg('U007', `工单 ${order.order_id} 被标记为【已退回】，请重新派单。`));
      msgs.push(fmsg(order.user_id, `您的工单 ${order.order_id} 维修遇到问题，管理员将重新安排。`));
      break;
    case 'cancelled':
      msgs.push(fmsg('U007', `工单 ${order.order_id} 已被取消。`));
      break;
  }
  return msgs;
}

function assignOrder(orderId, repairmanId, isAuto) {
  const assign = {
    assign_id: genId('AS'), order_id: orderId,
    repairman_id: repairmanId, assign_time: Date.now(), is_auto: isAuto
  };
  DB.insert('assign_record', assign);
  updateOrderStatus(orderId, 'assigned', {
    assign_time: Date.now(), repairman_id: repairmanId
  });
  // increment workload
  const skill = getRepairmanSkill(repairmanId);
  if (skill) DB.update('repairman_skill', 'repairman_id', repairmanId, { workload: skill.workload + 1 });
}

function getSmartCandidates(faultType) {
  const skills = DB.get('repairman_skill');
  const users  = DB.get('user_info');
  const matched = skills.filter(s => s.skill_tag === faultType || faultType === '其他');
  const fallback = matched.length ? matched : skills;
  return fallback
    .sort((a, b) => a.workload - b.workload)
    .map(s => {
      const u = users.find(u => u.user_id === s.repairman_id);
      return { ...s, name: u ? u.name : s.repairman_id };
    });
}

/* ============================================================
   LOGIN PAGE
   ============================================================ */
function renderLoginPage() {
  const users = DB.get('user_info');
  document.getElementById('login-page').innerHTML = `
    <div class="login-card">
      <div class="login-logo">
        <span class="login-logo-icon">🏫</span>
        <h1>吉林大学宿舍报修系统</h1>
        <p>信息系统分析与设计 · 课程原型演示</p>
      </div>
      <div class="role-cards" id="role-cards">
        ${[
          {role:'student',    icon:'👨‍🎓', name:'学生', desc:'提交工单 / 查看进度'},
          {role:'dorm_admin', icon:'🏠',   name:'宿舍管理员', desc:'楼栋总览 / 协助登记'},
          {role:'repairman',  icon:'🔧',   name:'维修人员', desc:'接单 / 填写记录'},
          {role:'admin',      icon:'⚙️',   name:'系统管理员', desc:'派单 / 统计 / 配置'},
        ].map(r => `
          <div class="role-card" data-role="${r.role}">
            <span class="role-icon">${r.icon}</span>
            <div class="role-name">${r.name}</div>
            <div class="role-desc">${r.desc}</div>
          </div>`).join('')}
      </div>
      <div class="user-select-area" id="user-select-area" style="display:none">
        <label>选择演示账号</label>
        <select id="user-select"></select>
      </div>
      <div class="form-group">
        <label>用户名</label>
        <input id="login-username" type="text" placeholder="请输入用户名（演示可直接选账号）" />
      </div>
      <div class="form-group">
        <label>密码</label>
        <input id="login-password" type="password" placeholder="任意密码均可登录（演示模式）" />
      </div>
      <div class="login-actions">
        <button class="btn btn-primary w-full" id="btn-login" disabled>登录系统</button>
      </div>
      <div class="login-reset">
        <button id="btn-reset-data">⚠ 重置演示数据</button>
      </div>
    </div>`;
}

/* ============================================================
   STUDENT — SUBMIT ORDER
   ============================================================ */
function renderStudentSubmit() {
  const u = currentUser;
  return `
    <div class="page-title">📝 提交报修工单</div>
    <div class="card">
      <div class="card-header"><span class="card-title">报修申请表</span><span class="text-muted text-sm">对应用例 UC-01</span></div>
      <div class="form-grid">
        <div class="form-group">
          <label>故障类型 <span style="color:var(--danger)">*</span></label>
          <select id="f-fault-type">
            <option value="">请选择</option>
            ${FAULT_TYPES.map(t => `<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>报修地址 <span style="color:var(--danger)">*</span></label>
          <input id="f-address" type="text" placeholder="楼号+房间号，如知新楼 301室" value="${u.dorm_building ? u.dorm_building + ' ' : ''}" />
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label>故障描述 <span style="color:var(--danger)">*</span></label>
          <textarea id="f-desc" placeholder="请详细描述故障情况，便于维修人员准备工具和零件…" rows="4"></textarea>
        </div>
        <div class="form-group">
          <label>预约维修时间</label>
          <input id="f-appoint" type="datetime-local" />
        </div>
        <div class="form-group">
          <label>是否需要宿管陪同</label>
          <div class="toggle-wrap" style="margin-top:.5rem">
            <div class="toggle" id="f-company-toggle"></div>
            <span id="f-company-label" style="font-size:.85rem;color:var(--text-muted)">不需要</span>
          </div>
          <input type="hidden" id="f-company" value="false" />
        </div>
        <div class="form-group" style="grid-column:1/-1">
          <label>故障图片（可选）</label>
          <div class="file-upload-area" id="upload-area">
            <input type="file" id="f-img" accept=".jpg,.jpeg,.png" />
            <div id="upload-hint">📷 点击上传图片（仅支持 JPG/PNG）</div>
            <img id="img-preview" class="img-preview hidden" />
          </div>
        </div>
      </div>
      <div id="submit-error" class="form-error" style="margin-bottom:.5rem"></div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
        <button class="btn btn-ghost" onclick="navigate('student-orders')">取消</button>
        <button class="btn btn-primary" id="btn-submit-order">提交工单</button>
      </div>
    </div>`;
}

/* ============================================================
   STUDENT — MY ORDERS
   ============================================================ */
function renderStudentOrders(filter = 'all', highlightId = null) {
  let orders = DB.get('repair_order').filter(o => o.user_id === currentUser.user_id)
    .sort((a,b) => b.create_time - a.create_time);

  if (filter === 'active')    orders = orders.filter(o => !['completed','cancelled'].includes(o.status));
  if (filter === 'completed') orders = orders.filter(o => ['completed','cancelled'].includes(o.status));

  const tabs = [
    { key:'all', label:'全部' },
    { key:'active', label:'进行中' },
    { key:'completed', label:'已完成' }
  ];

  const rows = orders.length ? orders.map(o => `
    <tr class="${highlightId === o.order_id ? 'highlight-row' : ''}"
        style="cursor:pointer" data-order-id="${o.order_id}">
      <td><code style="font-size:.8rem">${o.order_id}</code></td>
      <td>${o.fault_type}</td>
      <td>${o.address}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="text-muted">${fmtTime(o.create_time)}</td>
      <td><button class="btn btn-ghost btn-sm" data-goto-detail="${o.order_id}">查看详情</button></td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('暂无工单，快去提交第一条报修吧！')}</td></tr>`;

  return `
    <div class="page-title">📋 我的工单</div>
    <div class="card">
      <div class="filter-bar">
        ${tabs.map(t => `<span class="filter-tab ${filter===t.key?'active':''}" data-filter="${t.key}">${t.label}</span>`).join('')}
        <button class="btn btn-primary btn-sm" style="margin-left:auto" onclick="navigate('student-submit')">+ 提交新工单</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>工单号</th><th>故障类型</th><th>地址</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   STUDENT — ORDER DETAIL
   ============================================================ */
function renderStudentOrderDetail(orderId) {
  const order = DB.get('repair_order').find(o => o.order_id === orderId);
  if (!order) return emptyState('工单不存在');

  const assign  = getOrderAssign(orderId);
  const repairman = assign ? DB.get('user_info').find(u => u.user_id === assign.repairman_id) : null;
  const materials = DB.get('material_usage').filter(m => m.order_id === orderId);
  const feedback  = DB.get('repair_feedback').find(f => f.order_id === orderId);

  const steps = [
    { key:'pending',     label:'提交工单',  time: order.create_time, desc: `由 ${getUserName(order.user_id)} 提交` },
    { key:'assigned',    label:'派单',      time: order.assign_time, desc: assign ? `派给 ${repairman ? repairman.name : assign.repairman_id}` : '' },
    { key:'repairing',   label:'维修中',    time: order.repair_time, desc: '维修人员已上门' },
    { key:'to_evaluate', label:'待评价',    time: order.complete_time, desc: '维修完成，等待评价' },
    { key:'completed',   label:'已完成',    time: order.status === 'completed' ? order.complete_time : null, desc: feedback ? `评分: 速度${feedback.speed_score}星 态度${feedback.attitude_score}星 质量${feedback.quality_score}星` : '' },
  ];

  const statusOrder = ['pending','assigned','repairing','to_evaluate','completed'];
  const curIdx = statusOrder.indexOf(order.status);

  const tlHtml = steps.map((s, i) => {
    const done   = i < curIdx || (order.status === 'completed');
    const active = statusOrder[curIdx] === s.key;
    const cls    = done ? 'done' : active ? 'active' : '';
    return `<div class="tl-item ${!s.time && !active ? 'pending-step' : ''}">
      <div class="tl-dot ${cls}"></div>
      <div class="tl-title">${s.label}</div>
      <div class="tl-meta">${s.time ? fmtTime(s.time) : '等待中'} ${s.desc ? '· ' + s.desc : ''}</div>
    </div>`;
  }).join('');

  const canCancel = ['pending','assigned'].includes(order.status);
  const canEval   = order.status === 'to_evaluate';

  return `
    <div class="page-title">工单详情 <span class="text-muted text-sm">${order.order_id}</span></div>
    <div style="display:grid;grid-template-columns:1fr 300px;gap:1rem">
      <div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header"><span class="card-title">基本信息</span>${statusBadge(order.status)}</div>
          <div class="info-grid">
            <div class="info-item"><span class="info-label">故障类型</span><span class="info-value">${order.fault_type}</span></div>
            <div class="info-item"><span class="info-label">报修地址</span><span class="info-value">${order.address}</span></div>
            <div class="info-item" style="grid-column:1/-1"><span class="info-label">故障描述</span><span class="info-value">${order.description}</span></div>
            ${order.need_company ? '<div class="info-item"><span class="info-label">宿管陪同</span><span class="info-value">需要</span></div>' : ''}
            ${order.appoint_time ? `<div class="info-item"><span class="info-label">预约时间</span><span class="info-value">${order.appoint_time}</span></div>` : ''}
          </div>
        </div>
        ${repairman && order.status !== 'pending' ? `
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header"><span class="card-title">维修人员信息</span></div>
          <div class="info-grid">
            <div class="info-item"><span class="info-label">姓名</span><span class="info-value">${repairman.name}</span></div>
            <div class="info-item"><span class="info-label">联系方式</span><span class="info-value">${maskPhone(repairman.contact)}</span></div>
            <div class="info-item"><span class="info-label">技能专长</span><span class="info-value">${getRepairmanSkill(repairman.user_id)?.skill_tag || '—'}</span></div>
            <div class="info-item"><span class="info-label">派单方式</span><span class="info-value">${assign.is_auto ? '🤖 智能推荐' : '👤 人工指定'}</span></div>
          </div>
        </div>` : ''}
        ${order.repair_result ? `
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header"><span class="card-title">维修结果</span></div>
          <p style="font-size:.875rem">${order.repair_result}</p>
          ${materials.length ? `<div style="margin-top:.75rem"><div style="font-weight:600;font-size:.85rem;margin-bottom:.5rem">使用耗材</div>
            ${materials.map(m => `<div style="font-size:.85rem;color:var(--text-muted)">· ${m.material_name} × ${m.quantity}</div>`).join('')}</div>` : ''}
        </div>` : ''}
        ${feedback ? `
        <div class="card">
          <div class="card-header"><span class="card-title">我的评价</span></div>
          <div class="info-grid">
            <div class="info-item"><span class="info-label">维修速度</span><span class="info-value">${'⭐'.repeat(feedback.speed_score)}</span></div>
            <div class="info-item"><span class="info-label">服务态度</span><span class="info-value">${'⭐'.repeat(feedback.attitude_score)}</span></div>
            <div class="info-item"><span class="info-label">维修质量</span><span class="info-value">${'⭐'.repeat(feedback.quality_score)}</span></div>
            ${feedback.suggestion ? `<div class="info-item" style="grid-column:1/-1"><span class="info-label">建议</span><span class="info-value">${feedback.suggestion}</span></div>` : ''}
          </div>
        </div>` : ''}
      </div>
      <div>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header"><span class="card-title">流程进度</span></div>
          <div class="timeline">${tlHtml}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          ${canEval ? `<button class="btn btn-primary" data-action="go-evaluate" data-order-id="${orderId}">⭐ 去评价</button>` : ''}
          ${canCancel ? `<button class="btn btn-danger" data-action="cancel-order" data-order-id="${orderId}">取消工单</button>` : ''}
          <button class="btn btn-ghost" onclick="navigate('student-orders')">返回列表</button>
        </div>
      </div>
    </div>`;
}

/* ============================================================
   STUDENT — EVALUATE
   ============================================================ */
function renderStudentEvaluate(orderId) {
  const order = DB.get('repair_order').find(o => o.order_id === orderId);
  if (!order) return emptyState('工单不存在');
  return `
    <div class="page-title">⭐ 评价维修服务</div>
    <div class="card" style="max-width:560px">
      <div class="card-header">
        <div><div class="card-title">服务评价</div><div class="card-subtitle">工单 ${orderId} · ${order.fault_type} · ${order.address}</div></div>
      </div>
      ${['speed','attitude','quality'].map((k,i) => {
        const labels = ['维修速度','服务态度','维修质量'];
        return `<div class="form-group">
          <label>${labels[i]} <span style="color:var(--danger)">*</span></label>
          <div class="star-rating" data-score-key="${k}">
            ${[1,2,3,4,5].map(n => `<span class="star" data-val="${n}">★</span>`).join('')}
          </div>
          <input type="hidden" id="score-${k}" value="0" />
        </div>`;
      }).join('')}
      <div class="form-group">
        <label>补充建议（可选）</label>
        <textarea id="eval-suggestion" placeholder="您的宝贵意见将帮助我们改进服务…" rows="3"></textarea>
      </div>
      <div id="eval-error" class="form-error"></div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
        <button class="btn btn-ghost" onclick="navigate('student-order-detail',{orderId:'${orderId}'})">返回</button>
        <button class="btn btn-primary" id="btn-submit-eval" data-order-id="${orderId}">提交评价</button>
      </div>
    </div>`;
}

/* ============================================================
   STUDENT — COMPLAINT
   ============================================================ */
function renderStudentComplaint() {
  const myOrders = DB.get('repair_order')
    .filter(o => o.user_id === currentUser.user_id && o.status !== 'cancelled');
  return `
    <div class="page-title">💬 投诉建议</div>
    <div class="card" style="max-width:560px">
      <div class="card-header"><span class="card-title">提交投诉/建议</span></div>
      <div class="form-group">
        <label>类型</label>
        <select id="c-type">
          <option value="order">针对某条工单</option>
          <option value="general">系统整体建议</option>
        </select>
      </div>
      <div class="form-group" id="c-order-group">
        <label>关联工单</label>
        <select id="c-order-id">
          <option value="">不关联特定工单</option>
          ${myOrders.map(o => `<option value="${o.order_id}">${o.order_id} · ${o.fault_type}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>投诉/建议内容 <span style="color:var(--danger)">*</span></label>
        <textarea id="c-content" rows="5" placeholder="请详细描述您的问题或建议…"></textarea>
      </div>
      <div id="c-error" class="form-error"></div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
        <button class="btn btn-primary" id="btn-submit-complaint">提交</button>
      </div>
      <hr style="margin:1.5rem 0;border:none;border-top:1px solid var(--border)">
      <div class="card-title" style="margin-bottom:.75rem">我的投诉记录</div>
      ${renderMyComplaints()}
    </div>`;
}

function renderMyComplaints() {
  const list = DB.get('complaint').filter(c => c.user_id === currentUser.user_id)
    .sort((a,b) => b.create_time - a.create_time);
  if (!list.length) return emptyState('暂无投诉记录');
  return list.map(c => `
    <div style="padding:.75rem 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;margin-bottom:.3rem">
        <span style="font-size:.8rem;color:var(--text-muted)">${fmtDate(c.create_time)} · ${c.type === 'order' ? ('工单 '+c.order_id) : '系统建议'}</span>
        <span class="badge badge-complaint-${c.status}">${{pending:'待处理',processing:'处理中',resolved:'已解决',closed:'已关闭'}[c.status]||c.status}</span>
      </div>
      <p style="font-size:.875rem">${c.content}</p>
      ${c.reply_content ? `<div style="margin-top:.5rem;padding:.5rem;background:var(--bg);border-radius:var(--radius);font-size:.8rem"><span style="font-weight:600">管理员回复：</span>${c.reply_content}</div>` : ''}
    </div>`).join('');
}

/* ============================================================
   STUDENT — MESSAGES
   ============================================================ */
function renderStudentMessages() {
  const msgs = DB.get('message_push')
    .filter(m => m.user_id === currentUser.user_id)
    .sort((a,b) => b.push_time - a.push_time);

  if (!msgs.length) return `<div class="page-title">🔔 消息通知</div><div class="card">${emptyState('暂无消息')}</div>`;

  return `
    <div class="page-title">🔔 消息通知</div>
    <div class="card">
      <div style="display:flex;justify-content:flex-end;margin-bottom:.75rem">
        <button class="btn btn-ghost btn-sm" id="btn-mark-all-read">全部标为已读</button>
      </div>
      ${msgs.map(m => `
        <div class="msg-item ${m.is_read ? '' : 'unread'}" data-push-id="${m.push_id}">
          <div class="msg-dot ${m.is_read ? 'read' : ''}"></div>
          <div class="msg-content-wrap">
            <div class="msg-text">${m.content}</div>
            <div class="msg-time">${fmtTime(m.push_time)}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ============================================================
   DORM ADMIN — OVERVIEW
   ============================================================ */
function renderDormOverview() {
  const building = currentUser.dorm_building;
  const buildingUserIds = DB.get('user_info').filter(u => u.dorm_building === building).map(u => u.user_id);
  const all = DB.get('repair_order').filter(o =>
    buildingUserIds.includes(o.user_id) || (o.address && o.address.includes(building)));
  const byStatus = {};
  all.forEach(o => { byStatus[o.status] = (byStatus[o.status]||0) + 1; });
  const byFault = {};
  all.forEach(o => { byFault[o.fault_type] = (byFault[o.fault_type]||0) + 1; });
  const topFault = Object.entries(byFault).sort((a,b)=>b[1]-a[1]).slice(0,3);

  return `
    <div class="page-title">🏠 ${building} 楼栋总览</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">报修总量</div><div class="stat-value" style="color:var(--primary)">${all.length}</div></div>
      <div class="stat-card"><div class="stat-label">待派单</div><div class="stat-value" style="color:var(--text-muted)">${byStatus.pending||0}</div></div>
      <div class="stat-card"><div class="stat-label">维修中</div><div class="stat-value" style="color:var(--warning)">${(byStatus.assigned||0)+(byStatus.repairing||0)}</div></div>
      <div class="stat-card"><div class="stat-label">已完成</div><div class="stat-value" style="color:var(--success)">${byStatus.completed||0}</div></div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:.75rem">高频故障类型 TOP3</div>
      ${topFault.length ? topFault.map(([type, count]) => `
        <div style="display:flex;align-items:center;gap:1rem;margin-bottom:.6rem">
          <span style="font-size:.875rem;width:4rem">${type}</span>
          <div class="score-bar" style="flex:1"><div class="score-bar-fill" style="width:${Math.min(100, count/all.length*100)}%;background:var(--primary)"></div></div>
          <span class="text-muted text-sm">${count} 条</span>
        </div>`).join('') : emptyState('本楼栋暂无报修记录')}
    </div>`;
}

/* ============================================================
   DORM ADMIN — REGISTER (代登记)
   ============================================================ */
function renderDormRegister() {
  return `
    <div class="page-title">📝 协助登记工单</div>
    <div class="card" style="max-width:640px">
      <div class="card-header"><span class="card-title">代学生登记报修</span><span class="text-muted text-sm">对应线下登记职能</span></div>
      <div class="form-row">
        <div class="form-group">
          <label>学生姓名 <span style="color:var(--danger)">*</span></label>
          <input id="dr-student-name" type="text" placeholder="如：韩房佳茵" />
        </div>
        <div class="form-group">
          <label>学生联系方式</label>
          <input id="dr-student-contact" type="text" placeholder="手机号" />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>故障类型 <span style="color:var(--danger)">*</span></label>
          <select id="dr-fault-type">
            <option value="">请选择</option>
            ${FAULT_TYPES.map(t=>`<option>${t}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label>报修地址 <span style="color:var(--danger)">*</span></label>
          <input id="dr-address" type="text" placeholder="楼号+房间号" value="${currentUser.dorm_building} " />
        </div>
      </div>
      <div class="form-group">
        <label>故障描述 <span style="color:var(--danger)">*</span></label>
        <textarea id="dr-desc" rows="4" placeholder="详细描述故障情况…"></textarea>
      </div>
      <div class="form-group">
        <label>是否需要宿管陪同</label>
        <div class="toggle-wrap" style="margin-top:.5rem">
          <div class="toggle on" id="dr-company-toggle"></div>
          <span id="dr-company-label" style="font-size:.85rem;color:var(--text-muted)">需要</span>
        </div>
        <input type="hidden" id="dr-company" value="true" />
      </div>
      <div id="dr-error" class="form-error"></div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
        <button class="btn btn-primary" id="btn-dorm-register">代为登记</button>
      </div>
    </div>`;
}

/* ============================================================
   DORM ADMIN — ORDERS
   ============================================================ */
function renderDormOrders() {
  const building = currentUser.dorm_building;
  // 同楼栋用户的 user_id（按 dorm_building 字段匹配）
  const buildingUserIds = DB.get('user_info')
    .filter(u => u.dorm_building === building)
    .map(u => u.user_id);
  const orders = DB.get('repair_order')
    .filter(o =>
      buildingUserIds.includes(o.user_id) ||          // 本楼栋学生提交的
      (o.address && o.address.includes(building))      // 或地址包含楼栋名
    )
    .sort((a,b) => b.create_time - a.create_time);

  const rows = orders.length ? orders.map(o => `
    <tr><td><code style="font-size:.8rem">${o.order_id}</code></td>
    <td>${o.fault_type}</td><td>${o.address}</td>
    <td>${statusBadge(o.status)}</td>
    <td class="text-muted">${fmtTime(o.create_time)}</td>
    <td>${o.need_company ? '✅ 需要' : '—'}</td></tr>`)
    .join('') : `<tr><td colspan="6">${emptyState()}</td></tr>`;

  return `
    <div class="page-title">📋 ${building} 工单列表</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>工单号</th><th>故障类型</th><th>地址</th><th>状态</th><th>提交时间</th><th>宿管陪同</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   REPAIRMAN — TASKS
   ============================================================ */
function renderRepairmanTasks() {
  const myAssigns = DB.get('assign_record')
    .filter(a => a.repairman_id === currentUser.user_id);
  const myOrderIds = myAssigns.map(a => a.order_id);
  // 同时展示"已派单(等待接单)"和"维修中(已接单待完工)"两种状态
  const tasks = DB.get('repair_order')
    .filter(o => myOrderIds.includes(o.order_id) && ['assigned','repairing'].includes(o.status))
    .sort((a,b) => b.create_time - a.create_time);

  const cards = tasks.length ? tasks.map(o => {
    const student = DB.get('user_info').find(u => u.user_id === o.user_id);
    const isRepairing = o.status === 'repairing';
    return `<div class="card" style="margin-bottom:1rem">
      <div class="card-header">
        <div><div class="card-title">${o.fault_type} · ${o.address}</div>
             <div class="card-subtitle">工单号：${o.order_id} · 提交时间：${fmtTime(o.create_time)}</div></div>
        ${statusBadge(o.status)}
      </div>
      <p style="font-size:.875rem;margin-bottom:.75rem;color:var(--text-muted)">${o.description}</p>
      <div class="info-grid" style="margin-bottom:.75rem">
        <div class="info-item"><span class="info-label">学生联系（脱敏）</span>
          <span class="info-value">${student ? maskPhone(student.contact) : '—'}</span></div>
        <div class="info-item"><span class="info-label">宿管陪同</span>
          <span class="info-value">${o.need_company ? '需要' : '不需要'}</span></div>
        ${o.appoint_time ? `<div class="info-item"><span class="info-label">预约时间</span><span class="info-value">${o.appoint_time}</span></div>` : ''}
      </div>
      <div style="display:flex;gap:.5rem">
        ${isRepairing
          ? `<button class="btn btn-success" onclick="navigate('repairman-record',{orderId:'${o.order_id}'})">📋 填写完工记录</button>`
          : `<button class="btn btn-primary" data-action="accept-order" data-order-id="${o.order_id}">✅ 接单确认</button>`
        }
      </div>
    </div>`;
  }).join('') : `<div class="card">${emptyState('暂无待处理工单，休息一下吧 ☕')}</div>`;

  return `<div class="page-title">🔧 待处理工单</div>${cards}`;
}

/* ============================================================
   REPAIRMAN — RECORD
   ============================================================ */
function renderRepairmanRecord(orderId) {
  const order = DB.get('repair_order').find(o => o.order_id === orderId);
  if (!order) return emptyState('工单不存在');

  return `
    <div class="page-title">📋 填写维修记录</div>
    <div class="card" style="max-width:640px">
      <div class="card-header">
        <div><div class="card-title">${order.fault_type} · ${order.address}</div>
             <div class="card-subtitle">工单号：${orderId}</div></div>
        ${statusBadge(order.status)}
      </div>
      <div class="form-group">
        <label>维修结果说明 <span style="color:var(--danger)">*</span></label>
        <textarea id="rr-result" rows="4" placeholder="请详细描述维修过程和处理结果…"></textarea>
      </div>
      <div class="form-group">
        <label>使用耗材/零件</label>
        <div class="material-rows" id="material-rows">
          <div class="material-row">
            <input type="text" placeholder="耗材名称" class="mat-name" />
            <input type="number" placeholder="数量" class="mat-qty qty" min="1" value="1" />
            <button class="btn btn-ghost btn-sm rm-btn" onclick="removeMaterialRow(this)">✕</button>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" id="btn-add-material" style="margin-top:.4rem">+ 添加耗材</button>
      </div>
      <div class="form-group">
        <label>完工照片（可选）</label>
        <div class="file-upload-area" id="rr-upload-area">
          <input type="file" id="rr-img" accept=".jpg,.jpeg,.png" />
          <div id="rr-upload-hint">📷 上传完工照片</div>
          <img id="rr-img-preview" class="img-preview hidden" />
        </div>
      </div>
      <div id="rr-error" class="form-error"></div>
      <div style="display:flex;gap:.5rem;margin-top:1rem;justify-content:flex-end">
        <button class="btn btn-ghost" onclick="history.back()">返回</button>
        <button class="btn btn-warning" id="btn-rr-reject" data-order-id="${orderId}">⚠ 标记无法维修</button>
        <button class="btn btn-success" id="btn-rr-complete" data-order-id="${orderId}">✅ 提交完工</button>
      </div>
    </div>`;
}

/* ============================================================
   REPAIRMAN — HISTORY
   ============================================================ */
function renderRepairmanHistory() {
  const myAssigns = DB.get('assign_record').filter(a => a.repairman_id === currentUser.user_id);
  const myOrderIds = myAssigns.map(a => a.order_id);
  const orders = DB.get('repair_order')
    .filter(o => myOrderIds.includes(o.order_id) && !['pending','assigned'].includes(o.status))
    .sort((a,b) => b.create_time - a.create_time);

  const rows = orders.length ? orders.map(o => `
    <tr>
      <td><code style="font-size:.8rem">${o.order_id}</code></td>
      <td>${o.fault_type}</td><td>${o.address}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="text-muted">${fmtDate(o.create_time)}</td>
      <td>${o.repair_result ? o.repair_result.slice(0,20)+'…' : '—'}</td>
    </tr>`).join('') : `<tr><td colspan="6">${emptyState('暂无历史记录')}</td></tr>`;

  return `
    <div class="page-title">📋 我的维修记录</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>工单号</th><th>故障类型</th><th>地址</th><th>状态</th><th>日期</th><th>维修结果摘要</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   REPAIRMAN — SCHEDULE
   ============================================================ */
function renderRepairmanSchedule() {
  const skill = getRepairmanSkill(currentUser.user_id) || { skill_tag:'', workload:0, schedule:'' };
  return `
    <div class="page-title">📅 排班与技能管理</div>
    <div class="card" style="max-width:480px">
      <div class="card-header"><span class="card-title">我的技能与排班</span></div>
      <div class="form-group">
        <label>技能专长</label>
        <select id="sch-skill">
          ${FAULT_TYPES.filter(t=>t!=='其他').map(t=>`<option ${skill.skill_tag===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label>当前工单负载</label>
        <input type="text" value="${skill.workload} 条" disabled />
      </div>
      <div class="form-group">
        <label>可维修时间段</label>
        <input id="sch-schedule" type="text" value="${skill.schedule}" placeholder="如：周一至周五 08:00-17:00" />
      </div>
      <div style="display:flex;justify-content:flex-end;gap:.5rem;margin-top:1rem">
        <button class="btn btn-primary" id="btn-save-schedule">保存</button>
      </div>
    </div>`;
}

/* ============================================================
   ADMIN — ASSIGN (待派单)
   ============================================================ */
function renderAdminAssign() {
  const orders = DB.get('repair_order')
    .filter(o => o.status === 'pending' || o.status === 'rejected')
    .sort((a,b) => b.create_time - a.create_time);

  const rows = orders.length ? orders.map(o => `
    <tr>
      <td><code style="font-size:.8rem">${o.order_id}</code></td>
      <td>${getUserName(o.user_id)}</td>
      <td>${o.fault_type}</td>
      <td>${o.address}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="text-muted">${fmtTime(o.create_time)}</td>
      <td><button class="btn btn-primary btn-sm" data-action="open-assign" data-order-id="${o.order_id}" data-fault="${o.fault_type}">派单</button></td>
    </tr>`).join('') : `<tr><td colspan="7">${emptyState('暂无待派单工单 🎉')}</td></tr>`;

  return `
    <div class="page-title">📌 待派单工单</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>工单号</th><th>学生</th><th>故障类型</th><th>地址</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   ADMIN — ASSIGN RECORDS
   ============================================================ */
function renderAdminAssignRecords() {
  const records = DB.get('assign_record').sort((a,b) => b.assign_time - a.assign_time);
  const users   = DB.get('user_info');

  const rows = records.length ? records.map(r => {
    const order    = DB.get('repair_order').find(o => o.order_id === r.order_id);
    const repairman = users.find(u => u.user_id === r.repairman_id);
    return `<tr>
      <td><code style="font-size:.8rem">${r.assign_id}</code></td>
      <td><code style="font-size:.8rem">${r.order_id}</code></td>
      <td>${order ? order.fault_type : '—'}</td>
      <td>${repairman ? repairman.name : r.repairman_id}</td>
      <td>${r.is_auto ? '🤖 智能' : '👤 人工'}</td>
      <td class="text-muted">${fmtTime(r.assign_time)}</td>
      <td>${order ? statusBadge(order.status) : '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7">${emptyState()}</td></tr>`;

  return `
    <div class="page-title">📑 派单记录</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>派单ID</th><th>工单号</th><th>故障类型</th><th>维修人员</th><th>派单方式</th><th>派单时间</th><th>当前状态</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   ADMIN — REPAIRMEN
   ============================================================ */
function renderAdminRepairmen() {
  const skills = DB.get('repairman_skill');
  const users  = DB.get('user_info');

  const rows = skills.map(s => {
    const u = users.find(u => u.user_id === s.repairman_id);
    const avgScore = s.avg_score || 0;
    return `<tr>
      <td>${u ? u.name : s.repairman_id}</td>
      <td><span class="candidate-tag">${s.skill_tag}</span></td>
      <td>
        <div class="score-bar-wrap">
          <div class="score-bar" style="width:80px"><div class="score-bar-fill" style="width:${s.workload/5*100}%;background:var(--primary)"></div></div>
          <span style="font-size:.8rem">${s.workload}/5</span>
        </div>
      </td>
      <td>${s.schedule || '—'}</td>
      <td>
        <div class="score-bar-wrap">
          <div class="score-bar" style="width:80px"><div class="score-bar-fill" style="width:${avgScore/5*100}%"></div></div>
          <span style="font-size:.8rem">${avgScore ? avgScore.toFixed(1) : '—'}</span>
        </div>
      </td>
      <td><button class="btn btn-ghost btn-sm" data-action="edit-repairman" data-uid="${s.repairman_id}">编辑</button></td>
    </tr>`;
  });

  return `
    <div class="page-title">👷 维修人员管理</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>姓名</th><th>技能标签</th><th>当前负载</th><th>排班</th><th>综合评分</th><th>操作</th></tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   ADMIN — DASHBOARD
   ============================================================ */
function renderAdminDashboard() {
  const orders   = DB.get('repair_order');
  const feedback = DB.get('repair_feedback');
  const skills   = DB.get('repairman_skill');
  const users    = DB.get('user_info');

  // efficiency stats
  const assigned = orders.filter(o => o.assign_time && o.create_time);
  const avgAssign = assigned.length
    ? Math.round(assigned.reduce((s,o) => s + (o.assign_time - o.create_time), 0) / assigned.length / 3600000 * 10) / 10
    : 0;
  const completed = orders.filter(o => o.status === 'completed' && o.repair_time && o.assign_time);
  const avgRepair = completed.length
    ? Math.round(completed.reduce((s,o) => s + (o.complete_time - o.assign_time), 0) / completed.length / 3600000 * 10) / 10
    : 0;

  // repairman score ranking
  const ranking = skills.map(s => {
    const u = users.find(u => u.user_id === s.repairman_id);
    const fbs = feedback.filter(f => {
      const o = orders.find(o => o.order_id === f.order_id);
      const a = DB.get('assign_record').find(a => a.order_id === f.order_id);
      return a && a.repairman_id === s.repairman_id;
    });
    const avg = fbs.length ? (fbs.reduce((s,f) => s + (f.speed_score+f.attitude_score+f.quality_score)/3, 0) / fbs.length).toFixed(1) : (s.avg_score||0).toFixed(1);
    return { name: u ? u.name : s.repairman_id, skill: s.skill_tag, score: parseFloat(avg), count: fbs.length };
  }).sort((a,b) => b.score - a.score);

  return `
    <div class="page-title">📊 数据统计看板</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">报修总量</div><div class="stat-value" style="color:var(--primary)">${orders.length}</div></div>
      <div class="stat-card"><div class="stat-label">已完成</div><div class="stat-value" style="color:var(--success)">${orders.filter(o=>o.status==='completed').length}</div></div>
      <div class="stat-card"><div class="stat-label">平均派单耗时</div><div class="stat-value" style="color:var(--warning)">${avgAssign}</div><div class="stat-sub">小时</div></div>
      <div class="stat-card"><div class="stat-label">平均维修耗时</div><div class="stat-value" style="color:var(--orange)">${avgRepair}</div><div class="stat-sub">小时</div></div>
      <div class="stat-card"><div class="stat-label">待处理</div><div class="stat-value" style="color:var(--text-muted)">${orders.filter(o=>o.status==='pending').length}</div></div>
      <div class="stat-card"><div class="stat-label">评价总数</div><div class="stat-value" style="color:var(--purple)">${feedback.length}</div></div>
    </div>
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-title">故障类型分布</div>
        <div class="chart-canvas-wrap"><canvas id="chart-fault-pie"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-title">各状态工单数量</div>
        <div class="chart-canvas-wrap"><canvas id="chart-status-bar"></canvas></div>
      </div>
    </div>
    <div class="chart-card-full">
      <div class="chart-title">近14天报修量趋势</div>
      <div class="chart-canvas-wrap" style="height:200px"><canvas id="chart-trend-line"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:.75rem">维修人员服务质量排行</div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>排名</th><th>姓名</th><th>技能</th><th>综合评分</th><th>评价数</th></tr></thead>
          <tbody>
            ${ranking.map((r, i) => `<tr>
              <td><span style="font-weight:700;color:${i<3?'var(--warning)':'var(--text-muted)'}">${['🥇','🥈','🥉'][i]||i+1}</span></td>
              <td>${r.name}</td><td><span class="candidate-tag">${r.skill}</span></td>
              <td><div class="score-bar-wrap">
                <div class="score-bar" style="width:80px"><div class="score-bar-fill" style="width:${r.score/5*100}%"></div></div>
                <span>${r.score}</span></div></td>
              <td>${r.count}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   ADMIN — NOTICE
   ============================================================ */
function renderAdminNotice() {
  const notices = DB.get('notice').sort((a,b) => b.publish_time - a.publish_time);
  const roleLabels = { all:'全体', student:'学生', dorm_admin:'宿管', repairman:'维修', admin:'管理员' };

  return `
    <div class="page-title">📢 通知公告管理</div>
    <div class="card" style="margin-bottom:1rem">
      <div class="card-header"><span class="card-title">发布新公告</span></div>
      <div class="form-group"><label>标题 <span style="color:var(--danger)">*</span></label><input id="nt-title" type="text" placeholder="公告标题" /></div>
      <div class="form-group"><label>内容 <span style="color:var(--danger)">*</span></label><textarea id="nt-content" rows="4" placeholder="公告正文…"></textarea></div>
      <div class="form-row">
        <div class="form-group">
          <label>目标角色</label>
          <select id="nt-target">
            <option value="all">全体</option>
            <option value="student">学生</option>
            <option value="dorm_admin">宿管</option>
            <option value="repairman">维修人员</option>
            <option value="admin">管理员</option>
          </select>
        </div>
      </div>
      <div id="nt-error" class="form-error"></div>
      <div style="display:flex;justify-content:flex-end;margin-top:1rem">
        <button class="btn btn-primary" id="btn-publish-notice">发布公告</button>
      </div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:.75rem">已发布公告</div>
      ${notices.length ? notices.map(n => `
        <div class="notice-item">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem">
            <div>
              <div class="notice-title">${n.title}</div>
              <div class="notice-meta">${fmtTime(n.publish_time)} · 目标：${roleLabels[n.target_role]||n.target_role}</div>
              <div class="notice-content">${n.content}</div>
            </div>
            <div style="display:flex;gap:.4rem;flex-shrink:0">
              <span class="badge ${n.status==='active'?'badge-completed':'badge-cancelled'}">${n.status==='active'?'已发布':'已撤回'}</span>
              ${n.status==='active'
                ? `<button class="btn btn-ghost btn-sm" data-action="retract-notice" data-id="${n.notice_id}">撤回</button>`
                : `<button class="btn btn-primary btn-sm" data-action="restore-notice" data-id="${n.notice_id}">重新发布</button>`}
            </div>
          </div>
        </div>`).join('') : emptyState()}
    </div>`;
}

/* ============================================================
   ADMIN — COMPLAINT
   ============================================================ */
function renderAdminComplaint() {
  const complaints = DB.get('complaint').sort((a,b) => b.create_time - a.create_time);
  const statusMap = { pending:'待处理', processing:'处理中', resolved:'已解决', closed:'已关闭' };

  const rows = complaints.length ? complaints.map(c => `
    <tr>
      <td><code style="font-size:.8rem">${c.complaint_id}</code></td>
      <td>${getUserName(c.user_id)}</td>
      <td>${c.type === 'order' ? ('工单 '+c.order_id) : '系统建议'}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.content}</td>
      <td><span class="badge badge-complaint-${c.status}">${statusMap[c.status]||c.status}</span></td>
      <td class="text-muted">${fmtDate(c.create_time)}</td>
      <td><button class="btn btn-primary btn-sm" data-action="reply-complaint" data-id="${c.complaint_id}">处理</button></td>
    </tr>`).join('') : `<tr><td colspan="7">${emptyState()}</td></tr>`;

  return `
    <div class="page-title">💬 投诉处理</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>ID</th><th>用户</th><th>类型</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   ADMIN — LOG
   ============================================================ */
function renderAdminLog() {
  const logs = DB.get('sys_log').sort((a,b) => b.operate_time - a.operate_time);

  const rows = logs.length ? logs.map(l => `
    <tr>
      <td><code style="font-size:.8rem">${l.log_id}</code></td>
      <td>${l.operator}</td>
      <td>${l.operate_type}</td>
      <td>${l.result}</td>
      <td class="text-muted">${fmtTime(l.operate_time)}</td>
    </tr>`).join('') : `<tr><td colspan="5">${emptyState()}</td></tr>`;

  return `
    <div class="page-title">🗒️ 系统操作日志</div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>日志ID</th><th>操作人</th><th>操作类型</th><th>操作结果</th><th>操作时间</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

/* ============================================================
   ASSIGN MODAL
   ============================================================ */
function openAssignModal(orderId, faultType) {
  const candidates = getSmartCandidates(faultType);
  const best = candidates[0];

  const listHtml = candidates.length ? candidates.map((c, i) => `
    <div class="candidate-item ${i===0?'recommended':''}" data-uid="${c.repairman_id}">
      <div>
        <span style="font-weight:600">${c.name}</span>
        <span class="candidate-tag" style="margin-left:.4rem">${c.skill_tag}</span>
        ${i===0 ? '<span style="font-size:.72rem;color:var(--primary);font-weight:600;margin-left:.3rem">🤖 智能推荐</span>' : ''}
        <div class="workload-indicator" style="margin-top:.2rem">
          当前负载：${c.workload} 条 · 排班：${c.schedule||'—'}
        </div>
      </div>
      <button class="btn btn-primary btn-sm" data-action="do-assign"
              data-order-id="${orderId}" data-repairman-id="${c.repairman_id}"
              data-is-auto="${i===0}">指定</button>
    </div>`) : '<div class="empty-state"><p>暂无匹配技能的维修人员，请手动选择</p></div>';

  const allSkills = DB.get('repairman_skill');
  const allHtml = allSkills.filter(s => !candidates.find(c=>c.repairman_id===s.repairman_id)).map(s => {
    const u = DB.get('user_info').find(u=>u.user_id===s.repairman_id);
    return `<div class="candidate-item" data-uid="${s.repairman_id}">
      <div><span style="font-weight:600">${u?u.name:s.repairman_id}</span>
        <span class="candidate-tag" style="margin-left:.4rem">${s.skill_tag}</span>
        <div class="workload-indicator" style="margin-top:.2rem">当前负载：${s.workload} 条</div>
      </div>
      <button class="btn btn-ghost btn-sm" data-action="do-assign"
              data-order-id="${orderId}" data-repairman-id="${s.repairman_id}"
              data-is-auto="false">手动指定</button>
    </div>`;
  });

  showModal(`派单 · 工单 ${orderId}（${faultType}）`,
    `<div style="margin-bottom:.75rem">
      <div style="font-size:.8rem;font-weight:700;color:var(--text-muted);margin-bottom:.4rem">🤖 匹配推荐（按负载排序）</div>
      ${listHtml}
      ${allHtml.length ? `<div style="font-size:.8rem;font-weight:700;color:var(--text-muted);margin:1rem 0 .4rem">其他人员</div>${allHtml.join('')}` : ''}
    </div>`
  );
}

/* ============================================================
   CHARTS
   ============================================================ */
function destroyCharts() {
  Object.values(_charts).forEach(c => { try { c.destroy(); } catch(e){} });
  _charts = {};
}

function initDashboardCharts() {
  const orders = DB.get('repair_order');

  // Fault type pie
  const faultCount = {};
  FAULT_TYPES.forEach(t => { faultCount[t] = orders.filter(o=>o.fault_type===t).length; });
  const pieCtx = document.getElementById('chart-fault-pie');
  if (pieCtx) {
    _charts.pie = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: FAULT_TYPES,
        datasets: [{ data: FAULT_TYPES.map(t=>faultCount[t]),
          backgroundColor: ['#4263EB','#22C55E','#F59E0B','#EF4444','#8B5CF6','#06B6D4','#94A3B8'] }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { font: { size: 11 } } } } }
    });
  }

  // Status bar
  const statusKeys = ['pending','assigned','repairing','to_evaluate','completed','rejected','cancelled'];
  const statusColors = ['#94A3B8','#3B82F6','#F59E0B','#8B5CF6','#22C55E','#F97316','#CBD5E1'];
  const barCtx = document.getElementById('chart-status-bar');
  if (barCtx) {
    _charts.bar = new Chart(barCtx, {
      type: 'bar',
      data: {
        labels: statusKeys.map(s => STATUS_LABEL[s]),
        datasets: [{ label: '工单数', data: statusKeys.map(s => orders.filter(o=>o.status===s).length),
          backgroundColor: statusColors, borderRadius: 4 }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
  }

  // Trend line (last 14 days)
  const days = Array.from({length:14}, (_,i) => {
    const d = new Date(); d.setDate(d.getDate()-13+i);
    return { label: `${d.getMonth()+1}/${d.getDate()}`, dayStart: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() };
  });
  const lineCtx = document.getElementById('chart-trend-line');
  if (lineCtx) {
    _charts.line = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: days.map(d=>d.label),
        datasets: [{ label: '报修量', data: days.map(d =>
            orders.filter(o => o.create_time >= d.dayStart && o.create_time < d.dayStart+86400000).length),
          borderColor: '#4263EB', backgroundColor: 'rgba(66,99,235,.1)',
          fill: true, tension: .4, pointRadius: 3 }]
      },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });
  }
}

/* ============================================================
   ATTACH PAGE EVENTS
   ============================================================ */
function attachPageEvents(pageId) {
  if (pageId === 'admin-dashboard') {
    requestAnimationFrame(() => requestAnimationFrame(initDashboardCharts));
  }
  if (pageId === 'student-submit') {
    setupImageUpload('upload-area', 'f-img', 'img-preview', 'upload-hint');
    setupToggle('f-company-toggle', 'f-company', 'f-company-label', '需要', '不需要');
  }
  if (pageId === 'dorm-register') {
    setupToggle('dr-company-toggle', 'dr-company', 'dr-company-label', '需要', '不需要');
  }
  if (pageId === 'repairman-record') {
    setupImageUpload('rr-upload-area', 'rr-img', 'rr-img-preview', 'rr-upload-hint');
  }
  // Star rating
  document.querySelectorAll('.star-rating').forEach(wrap => {
    const key    = wrap.dataset.scoreKey;
    const stars  = wrap.querySelectorAll('.star');
    const hidden = document.getElementById('score-' + key);
    stars.forEach((star, i) => {
      star.addEventListener('click', () => {
        hidden.value = i + 1;
        stars.forEach((s, j) => s.classList.toggle('active', j <= i));
      });
    });
  });
}

function handleContentClick(e) {
  const t = e.target.closest('[data-action],[data-page],[data-filter],[data-push-id],[data-order-id],[data-goto-detail]');
  if (!t) return;

  const action = t.dataset.action;

  if (t.dataset.gotoDetail) {
    navigate('student-order-detail', { orderId: t.dataset.gotoDetail });
    return;
  }

  if (t.dataset.filter) {
    navigate('student-orders', { filter: t.dataset.filter });
    return;
  }

  if (t.dataset.pushId) {
    DB.update('message_push', 'push_id', t.dataset.pushId, { is_read: true });
    navigate('student-messages');
    return;
  }

  switch(action) {
    case 'go-evaluate':
      navigate('student-evaluate', { orderId: t.dataset.orderId }); break;

    case 'cancel-order':
      confirm('确认取消该工单？取消后无法恢复。', () => {
        updateOrderStatus(t.dataset.orderId, 'cancelled');
        showToast('工单已取消', 'success');
        navigate('student-orders');
      }); break;

    case 'open-assign':
      openAssignModal(t.dataset.orderId, t.dataset.fault); break;

    case 'do-assign': {
      const orderId = t.dataset.orderId;
      const repairmanId = t.dataset.repairmanId;
      const isAuto = t.dataset.isAuto === 'true';
      assignOrder(orderId, repairmanId, isAuto);
      closeModal();
      showToast('派单成功！', 'success');
      navigate('admin-assign');
      break;
    }

    case 'accept-order':
      confirm('确认接单？接单后请尽快上门维修。', () => {
        updateOrderStatus(t.dataset.orderId, 'repairing', { repair_time: Date.now() });
        showToast('接单成功，请尽快上门！', 'success');
        navigate('repairman-tasks');
      }); break;

    case 'retract-notice':
      DB.update('notice', 'notice_id', t.dataset.id, { status: 'inactive' });
      showToast('公告已撤回');
      navigate('admin-notice'); break;

    case 'restore-notice':
      DB.update('notice', 'notice_id', t.dataset.id, { status: 'active' });
      showToast('公告已重新发布', 'success');
      navigate('admin-notice'); break;

    case 'reply-complaint':
      openComplaintReplyModal(t.dataset.id); break;

    case 'edit-repairman':
      openEditRepairmanModal(t.dataset.uid); break;
  }
}

/* ============================================================
   FORM SUBMIT HANDLERS (wired in init)
   ============================================================ */
function wireFormHandlers() {
  document.getElementById('main-content').addEventListener('click', e => {
    const btn = e.target.closest('button[id]');
    if (!btn) return;

    if (btn.id === 'btn-submit-order') handleSubmitOrder();
    if (btn.id === 'btn-submit-eval')  handleSubmitEval(btn.dataset.orderId);
    if (btn.id === 'btn-submit-complaint') handleSubmitComplaint();
    if (btn.id === 'btn-dorm-register') handleDormRegister();
    if (btn.id === 'btn-rr-complete') handleRepairComplete(btn.dataset.orderId, false);
    if (btn.id === 'btn-rr-reject')   handleRepairComplete(btn.dataset.orderId, true);
    if (btn.id === 'btn-add-material') addMaterialRow();
    if (btn.id === 'btn-save-schedule') handleSaveSchedule();
    if (btn.id === 'btn-publish-notice') handlePublishNotice();
    if (btn.id === 'btn-mark-all-read') handleMarkAllRead();
  });
}

function handleSubmitOrder() {
  const faultType = document.getElementById('f-fault-type')?.value;
  const address   = document.getElementById('f-address')?.value.trim();
  const desc      = document.getElementById('f-desc')?.value.trim();
  const appoint   = document.getElementById('f-appoint')?.value;
  const company   = document.getElementById('f-company')?.value === 'true';
  const imgUrl    = document.getElementById('img-preview')?.src || '';

  const err = document.getElementById('submit-error');
  if (!faultType || !address || !desc) { err.textContent = '请完整填写信息（故障类型、地址、描述为必填项）'; return; }
  err.textContent = '';

  const order = {
    order_id: 'JD' + Date.now(),
    user_id: currentUser.user_id,
    fault_type: faultType, description: desc,
    img_url: imgUrl.startsWith('data:') ? imgUrl : '',
    address, appoint_time: appoint, need_company: company,
    status: 'pending', create_time: Date.now(),
    assign_time: null, repair_time: null, complete_time: null,
    repair_result: '', complete_img: ''
  };
  DB.insert('repair_order', order);

  // notify admin
  DB.insert('message_push', {
    push_id: genId('MP'), user_id: 'U007', order_id: order.order_id,
    push_type: 'new_order', content: `新工单待派单：${order.order_id}（${order.fault_type}），${order.address}。`,
    push_time: Date.now(), is_read: false
  });
  DB.insert('sys_log', { log_id: genId('L'), operator: currentUser.name, operate_type: '提交工单', operate_time: Date.now(), result: `提交工单${order.order_id}` });

  showToast('工单提交成功！', 'success');
  navigate('student-orders', { highlightId: order.order_id });
}

function handleSubmitEval(orderId) {
  const speed    = parseInt(document.getElementById('score-speed')?.value || 0);
  const attitude = parseInt(document.getElementById('score-attitude')?.value || 0);
  const quality  = parseInt(document.getElementById('score-quality')?.value || 0);
  const suggestion = document.getElementById('eval-suggestion')?.value.trim();

  const err = document.getElementById('eval-error');
  if (!speed || !attitude || !quality) { err.textContent = '请完成全部评分（三项均需选择）'; return; }

  DB.insert('repair_feedback', {
    feedback_id: genId('FB'), order_id: orderId,
    speed_score: speed, attitude_score: attitude, quality_score: quality,
    suggestion, feedback_time: Date.now()
  });

  // update avg_score on repairman_skill
  const assign = getOrderAssign(orderId);
  if (assign) {
    const allFb = DB.get('repair_feedback').filter(f => {
      const a = DB.get('assign_record').find(a => a.order_id === f.order_id);
      return a && a.repairman_id === assign.repairman_id;
    });
    const avg = allFb.reduce((s,f) => s + (f.speed_score+f.attitude_score+f.quality_score)/3, 0) / allFb.length;
    DB.update('repairman_skill', 'repairman_id', assign.repairman_id, { avg_score: Math.round(avg*10)/10 });
    // decrease workload
    const sk = getRepairmanSkill(assign.repairman_id);
    if (sk) DB.update('repairman_skill', 'repairman_id', assign.repairman_id, { workload: Math.max(0, sk.workload-1) });
  }

  updateOrderStatus(orderId, 'completed', { complete_time: Date.now() });
  showToast('评价提交成功，感谢您的反馈！', 'success');
  navigate('student-orders');
}

function handleSubmitComplaint() {
  const type    = document.getElementById('c-type')?.value;
  const orderId = document.getElementById('c-order-id')?.value;
  const content = document.getElementById('c-content')?.value.trim();
  const err     = document.getElementById('c-error');
  if (!content) { err.textContent = '请填写投诉/建议内容'; return; }

  DB.insert('complaint', {
    complaint_id: genId('CP'), user_id: currentUser.user_id,
    order_id: orderId || null, type, content,
    status: 'pending', reply_content: '', reply_user_id: null,
    create_time: Date.now(), reply_time: null
  });
  DB.insert('sys_log', { log_id: genId('L'), operator: currentUser.name, operate_type: '提交投诉', operate_time: Date.now(), result: `投诉内容：${content.slice(0,20)}` });
  showToast('投诉已提交，管理员将尽快处理', 'success');
  navigate('student-complaint');
}

function handleDormRegister() {
  const studentName = document.getElementById('dr-student-name')?.value.trim();
  const faultType   = document.getElementById('dr-fault-type')?.value;
  const address     = document.getElementById('dr-address')?.value.trim();
  const desc        = document.getElementById('dr-desc')?.value.trim();
  const company     = document.getElementById('dr-company')?.value === 'true';
  const err         = document.getElementById('dr-error');
  if (!studentName || !faultType || !address || !desc) { err.textContent = '请完整填写信息'; return; }

  const order = {
    order_id: 'JD' + Date.now(), user_id: currentUser.user_id,
    fault_type: faultType, description: `【宿管代登记·${studentName}】${desc}`,
    img_url: '', address, appoint_time: '', need_company: company,
    status: 'pending', create_time: Date.now(),
    assign_time: null, repair_time: null, complete_time: null,
    repair_result: '', complete_img: ''
  };
  DB.insert('repair_order', order);
  DB.insert('sys_log', { log_id: genId('L'), operator: currentUser.name, operate_type: '代登记工单', operate_time: Date.now(), result: `代${studentName}登记工单${order.order_id}` });
  showToast('代登记成功！', 'success');
  navigate('dorm-orders');
}

function handleRepairComplete(orderId, isReject) {
  const result  = document.getElementById('rr-result')?.value.trim();
  const imgSrc  = document.getElementById('rr-img-preview')?.src || '';
  const err     = document.getElementById('rr-error');

  if (!result) { err.textContent = '请填写维修结果说明'; return; }
  if (isReject) {
    confirm('确认标记为无法维修？系统将通知管理员重新派单。', () => {
      updateOrderStatus(orderId, 'rejected', { repair_result: result });
      showToast('已标记无法维修，管理员将重新派单', 'info');
      navigate('repairman-history');
    });
    return;
  }

  // collect materials
  const rows = document.querySelectorAll('#material-rows .material-row');
  rows.forEach(row => {
    const name = row.querySelector('.mat-name')?.value.trim();
    const qty  = parseInt(row.querySelector('.mat-qty')?.value) || 1;
    if (name) DB.insert('material_usage', { record_id: genId('MU'), order_id: orderId, material_name: name, quantity: qty, use_time: Date.now() });
  });

  updateOrderStatus(orderId, 'to_evaluate', {
    repair_result: result,
    complete_img: imgSrc.startsWith('data:') ? imgSrc : '',
    repair_time: Date.now(),
    complete_time: Date.now()
  });
  showToast('维修记录已提交！', 'success');
  navigate('repairman-history');
}

function handleSaveSchedule() {
  const skill = document.getElementById('sch-skill')?.value;
  const schedule = document.getElementById('sch-schedule')?.value.trim();
  DB.update('repairman_skill', 'repairman_id', currentUser.user_id, { skill_tag: skill, schedule });
  showToast('排班信息已保存', 'success');
}

function handlePublishNotice() {
  const title   = document.getElementById('nt-title')?.value.trim();
  const content = document.getElementById('nt-content')?.value.trim();
  const target  = document.getElementById('nt-target')?.value;
  const err     = document.getElementById('nt-error');
  if (!title || !content) { err.textContent = '请填写标题和内容'; return; }

  DB.insert('notice', {
    notice_id: genId('NT'), publisher_id: currentUser.user_id,
    title, content, target_role: target, publish_time: Date.now(), status: 'active'
  });
  DB.insert('sys_log', { log_id: genId('L'), operator: currentUser.name, operate_type: '发布公告', operate_time: Date.now(), result: `发布公告：${title}` });
  showToast('公告已发布！', 'success');
  navigate('admin-notice');
}

function handleMarkAllRead() {
  DB.get('message_push')
    .filter(m => m.user_id === currentUser.user_id && !m.is_read)
    .forEach(m => DB.update('message_push', 'push_id', m.push_id, { is_read: true }));
  DB.save();
  showToast('全部已读');
  navigate('student-messages');
}

function addMaterialRow() {
  const rows = document.getElementById('material-rows');
  if (!rows) return;
  const div = document.createElement('div');
  div.className = 'material-row';
  div.innerHTML = `<input type="text" placeholder="耗材名称" class="mat-name" />
    <input type="number" placeholder="数量" class="mat-qty qty" min="1" value="1" />
    <button class="btn btn-ghost btn-sm rm-btn" onclick="removeMaterialRow(this)">✕</button>`;
  rows.appendChild(div);
}

function removeMaterialRow(btn) {
  const row = btn.closest('.material-row');
  if (row && document.querySelectorAll('.material-row').length > 1) row.remove();
}

/* ============================================================
   COMPLAINT REPLY MODAL
   ============================================================ */
function openComplaintReplyModal(complaintId) {
  const c = DB.get('complaint').find(c => c.complaint_id === complaintId);
  if (!c) return;
  const statusOpts = ['pending','processing','resolved','closed'];
  const statusLabels = { pending:'待处理', processing:'处理中', resolved:'已解决', closed:'已关闭' };
  showModal(`处理投诉 · ${complaintId}`,
    `<div style="font-size:.85rem;margin-bottom:1rem;padding:.75rem;background:var(--bg);border-radius:var(--radius)">
      <div style="font-weight:600;margin-bottom:.3rem">投诉内容</div>${c.content}
     </div>
     <div class="form-group">
       <label>更新状态</label>
       <select id="reply-status">
         ${statusOpts.map(s=>`<option value="${s}" ${c.status===s?'selected':''}>${statusLabels[s]}</option>`).join('')}
       </select>
     </div>
     <div class="form-group">
       <label>回复内容</label>
       <textarea id="reply-content" rows="4" placeholder="请输入回复内容…">${c.reply_content||''}</textarea>
     </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="btn-do-reply" data-id="${complaintId}">提交回复</button>`
  );
  setTimeout(() => {
    const btn = document.getElementById('btn-do-reply');
    if (btn) btn.onclick = () => {
      const status  = document.getElementById('reply-status')?.value;
      const content = document.getElementById('reply-content')?.value.trim();
      DB.update('complaint', 'complaint_id', complaintId, {
        status, reply_content: content, reply_user_id: currentUser.user_id, reply_time: Date.now()
      });
      DB.insert('sys_log', { log_id: genId('L'), operator: currentUser.name, operate_type: '处理投诉', operate_time: Date.now(), result: `投诉${complaintId}状态→${status}` });
      closeModal();
      showToast('回复已提交', 'success');
      navigate('admin-complaint');
    };
  }, 0);
}

/* ============================================================
   EDIT REPAIRMAN MODAL
   ============================================================ */
function openEditRepairmanModal(uid) {
  const skill = getRepairmanSkill(uid);
  const u = DB.get('user_info').find(u => u.user_id === uid);
  if (!skill || !u) return;
  showModal(`编辑维修人员 · ${u.name}`,
    `<div class="form-group">
       <label>技能标签</label>
       <select id="edit-skill">
         ${FAULT_TYPES.filter(t=>t!=='其他').map(t=>`<option ${skill.skill_tag===t?'selected':''}>${t}</option>`).join('')}
       </select>
     </div>
     <div class="form-group">
       <label>排班时间</label>
       <input id="edit-schedule" type="text" value="${skill.schedule||''}" placeholder="如：周一至周五 08:00-17:00" />
     </div>`,
    `<button class="btn btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn btn-primary" id="btn-do-edit-rep" data-uid="${uid}">保存</button>`
  );
  setTimeout(() => {
    const btn = document.getElementById('btn-do-edit-rep');
    if (btn) btn.onclick = () => {
      DB.update('repairman_skill', 'repairman_id', uid, {
        skill_tag: document.getElementById('edit-skill').value,
        schedule: document.getElementById('edit-schedule').value.trim()
      });
      closeModal();
      showToast('已保存', 'success');
      navigate('admin-repairmen');
    };
  }, 0);
}

/* ============================================================
   HELPERS — Toggle & Image Upload
   ============================================================ */
function setupToggle(toggleId, hiddenId, labelId, onText, offText) {
  const toggle = document.getElementById(toggleId);
  const hidden = document.getElementById(hiddenId);
  const label  = document.getElementById(labelId);
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const isOn = hidden.value === 'true';
    hidden.value = isOn ? 'false' : 'true';
    toggle.classList.toggle('on', !isOn);
    if (label) label.textContent = isOn ? offText : onText;
  });
}

function setupImageUpload(areaId, inputId, previewId, hintId) {
  const area    = document.getElementById(areaId);
  const input   = document.getElementById(inputId);
  const preview = document.getElementById(previewId);
  const hint    = document.getElementById(hintId);
  if (!area || !input) return;
  area.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    if (!['image/jpeg','image/png'].includes(file.type)) { showToast('仅支持 JPG/PNG 格式图片', 'error'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      if (preview) { preview.src = e.target.result; preview.classList.remove('hidden'); }
      if (hint) hint.style.display = 'none';
    };
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   ROLE SWITCHER
   ============================================================ */
function openRoleSwitcher() {
  const users = DB.get('user_info');
  const list  = document.getElementById('role-switcher-list');
  list.innerHTML = users.map(u => `
    <div class="switcher-user-item" data-uid="${u.user_id}">
      <div class="switcher-avatar" style="background:var(--primary-light)">${roleAvatar(u.role)}</div>
      <div>
        <div class="switcher-name">${u.name}</div>
        <div class="switcher-role">${roleName(u.role)}</div>
      </div>
      ${currentUser && currentUser.user_id === u.user_id ? '<span style="margin-left:auto;font-size:.75rem;color:var(--primary)">当前</span>' : ''}
    </div>`).join('');
  document.getElementById('role-switcher').classList.remove('hidden');
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  DB.load();

  // 启动 Supabase 同步（异步，不阻塞页面加载）
  SYNC.init();

  // Restore session
  const saved = sessionStorage.getItem('currentUser');
  if (saved) {
    currentUser = JSON.parse(saved);
    document.getElementById('login-page').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
    renderTopNav();
    renderSideNav();
    navigate(defaultPage(currentUser.role));
  } else {
    renderLoginPage();
  }

  // Login page events (delegated from login-page div)
  document.getElementById('login-page').addEventListener('click', e => {
    // Role card selection
    const roleCard = e.target.closest('.role-card');
    if (roleCard) {
      document.querySelectorAll('.role-card').forEach(c => c.classList.remove('selected'));
      roleCard.classList.add('selected');
      const role = roleCard.dataset.role;
      const area = document.getElementById('user-select-area');
      const sel  = document.getElementById('user-select');
      const users = DB.get('user_info').filter(u => u.role === role);
      area.style.display = 'block';
      sel.innerHTML = users.map(u => `<option value="${u.user_id}">${u.name}</option>`).join('');
      document.getElementById('login-username').value = users[0]?.name || '';
      document.getElementById('btn-login').disabled = false;
      sel.addEventListener('change', () => {
        const u = users.find(u => u.user_id === sel.value);
        if (u) document.getElementById('login-username').value = u.name;
      });
      return;
    }
    // Login button
    if (e.target.id === 'btn-login') {
      const sel = document.getElementById('user-select');
      if (sel && sel.value) login(sel.value);
      return;
    }
    // Reset button
    if (e.target.id === 'btn-reset-data') {
      if (window.confirm('确认重置所有演示数据？此操作不可撤销。')) {
        DB.reset();
        showToast('演示数据已重置！', 'success');
        renderLoginPage();
      }
    }
  });

  // Top nav events
  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-switch-role').addEventListener('click', openRoleSwitcher);
  document.getElementById('btn-msg').addEventListener('click', () => navigate('student-messages'));
  document.getElementById('sidebar-toggle').addEventListener('click', () => {
    document.getElementById('side-nav').classList.toggle('collapsed');
  });

  // Sidebar navigation
  document.getElementById('side-nav').addEventListener('click', e => {
    const item = e.target.closest('.nav-item');
    if (item) navigate(item.dataset.page);
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Role switcher
  document.getElementById('role-switcher-close').addEventListener('click', () => {
    document.getElementById('role-switcher').classList.add('hidden');
  });
  document.getElementById('role-switcher-list').addEventListener('click', e => {
    const item = e.target.closest('.switcher-user-item');
    if (!item) return;
    document.getElementById('role-switcher').classList.add('hidden');
    login(item.dataset.uid);
  });
  document.getElementById('role-switcher').addEventListener('click', e => {
    if (e.target === document.getElementById('role-switcher'))
      document.getElementById('role-switcher').classList.add('hidden');
  });

  // Single delegated click handler — must cover both main-content and modal-body
  document.addEventListener('click', handleContentClick);
  wireFormHandlers();
}

document.addEventListener('DOMContentLoaded', init);
