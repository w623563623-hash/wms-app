// ===== 云仓储 WMS 前端（原生 JS，调用真实后端 API）=====

const state = { token: localStorage.getItem('wms_token'), user: null };

function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  return fetch('/api' + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('请求失败 ' + r.status));
    return data;
  });
}

const ROLE_NAME = { admin: '系统管理员', inout: '出入库管理员', packer: '打包出货管理员', finance: '财务' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function fmt(n) { return n == null ? '-' : Number(n).toLocaleString('zh-CN'); }
function statusTag(s) {
  const map = { draft: ['tag-draft', '草稿'], pending: ['tag-pending', '待审核'], done: ['tag-done', '已审核'], cancel: ['tag-cancel', '已取消'] };
  const [cls, txt] = map[s] || ['tag-draft', s];
  return `<span class="tag ${cls}">${txt}</span>`;
}

// ===== 登录 =====
async function doLogin() {
  const msg = document.getElementById('loginMsg');
  msg.innerHTML = '';
  try {
    const data = await api('POST', '/login', {
      username: document.getElementById('username').value,
      password: document.getElementById('password').value,
    });
    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('wms_token', data.token);
    showApp();
  } catch (e) {
    msg.innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
  }
}
function doLogout() {
  state.token = null; state.user = null;
  localStorage.removeItem('wms_token');
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
}
window.doLogin = doLogin;
window.doLogout = doLogout;

function showApp() {
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('who').textContent = `${state.user.real_name}（${ROLE_NAME[state.user.role]}）`;
  renderSidebar();
  navigate('dashboard');
}

// ===== 侧边栏（按角色）=====
const MENU = [
  { group: '总览', items: [{ id: 'dashboard', label: '概览', roles: ['admin', 'inout', 'packer', 'finance'] }] },
  { group: '基础数据', items: [
    { id: 'materials', label: '物料档案', roles: ['admin', 'inout', 'packer', 'finance'] },
    { id: 'partners', label: '供应商 / 客户', roles: ['admin', 'inout', 'packer', 'finance'] },
  ] },
  { group: '入库', items: [
    { id: 'in-purchase', label: '原料入库', types: ['purchase'], kind: 'inbound', roles: ['admin', 'inout', 'packer', 'finance'] },
    { id: 'in-finish', label: '成品入库', types: ['finish'], kind: 'inbound', roles: ['admin', 'inout', 'packer', 'finance'] },
  ] },
  { group: '出库', items: [
    { id: 'out-pick', label: '原料出库', types: ['pick'], kind: 'outbound', roles: ['admin', 'inout', 'packer', 'finance'] },
    { id: 'out-sale', label: '成品出库', types: ['sale'], kind: 'outbound', roles: ['admin', 'inout', 'packer', 'finance'] },
  ] },
  { group: '库存', items: [
    { id: 'stock', label: '实时库存', roles: ['admin', 'inout', 'packer', 'finance'] },
    { id: 'flow', label: '库存流水', roles: ['admin', 'inout', 'packer', 'finance'] },
  ] },
];

function renderSidebar() {
  const role = state.user.role;
  const el = document.getElementById('sidebar');
  el.innerHTML = MENU.map((g) => {
    const items = g.items.filter((i) => i.roles.includes(role)).map((i) =>
      `<a data-id="${i.id}" onclick="navigate('${i.id}')">${i.label}</a>`
    ).join('');
    return `<div class="group-title">${g.group}</div>${items}`;
  }).join('');
}
window.navigate = navigate;

const VIEW_META = {
  dashboard: ['总览', '概览'],
  materials: ['基础数据', '物料档案'],
  partners: ['基础数据', '供应商 / 客户'],
  'in-purchase': ['入库', '原料入库'],
  'in-finish': ['入库', '成品入库'],
  'out-pick': ['出库', '原料出库'],
  'out-sale': ['出库', '成品出库'],
  stock: ['库存', '实时库存'],
  flow: ['库存', '库存流水'],
};

let _curView = 'dashboard';
async function navigate(id) {
  _curView = id;
  document.querySelectorAll('#sidebar a').forEach((a) => a.classList.toggle('active', a.dataset.id === id));
  const [b, t] = VIEW_META[id] || ['', ''];
  document.getElementById('breadcrumb').textContent = b;
  document.getElementById('pageTitle').textContent = t;
  const view = document.getElementById('view');
  view.innerHTML = '<div class="hint">加载中…</div>';
  try {
    if (id === 'dashboard') return renderDashboard(view);
    if (id === 'materials') return renderMaterials(view);
    if (id === 'partners') return renderPartners(view);
    if (id === 'stock') return renderStock(view);
    if (id === 'flow') return renderFlow(view);
    if (id.startsWith('in-')) {
      const types = id === 'in-purchase' ? ['purchase'] : ['finish'];
      return renderOrders(view, 'inbound', types, t);
    }
    if (id.startsWith('out-')) {
      const types = id === 'out-pick' ? ['pick'] : ['sale'];
      return renderOrders(view, 'outbound', types, t);
    }
  } catch (e) {
    view.innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`;
  }
}

// ===== 概览 =====
async function renderDashboard(view) {
  const [stock, flow, inbound, outbound] = await Promise.all([
    api('GET', '/stock'), api('GET', '/stock/flow'),
    api('GET', '/inbound'), api('GET', '/outbound'),
  ]);
  const low = stock.filter((s) => s.low_stock).length;
  const pending = [...inbound, ...outbound].filter((o) => o.status === 'pending').length;
  view.innerHTML = `
    <div class="kpi">
      <div class="box"><div class="num">${stock.length}</div><div class="lbl">在库物料种类</div></div>
      <div class="box"><div class="num" style="color:var(--warning)">${pending}</div><div class="lbl">待财务审核单据</div></div>
      <div class="box"><div class="num" style="color:var(--danger)">${low}</div><div class="lbl">低于安全库存</div></div>
      <div class="box"><div class="num">${flow.length}</div><div class="lbl">近期流水笔数</div></div>
    </div>
    <div class="card"><b>审批链：</b> 出入库管理员制单 → 提交 → 财务审核（库存变动）→ 成品出库由打包出货管理员打包确认。</div>`;
}

// ===== 物料 =====
async function renderMaterials(view) {
  const list = await api('GET', '/materials');
  const canEdit = ['admin', 'inout'].includes(state.user.role);
  view.innerHTML = `
    <div class="toolbar">
      <span class="grow"></span>
      ${canEdit ? '<button class="btn btn-primary btn-sm" onclick="openMaterialModal()">+ 新增物料</button>' : ''}
    </div>
    <div class="card" style="padding:0">
      <table><thead><tr><th>编码</th><th>名称</th><th>规格</th><th>类型</th><th>单位</th><th>安全库存</th><th>参考价</th></tr></thead>
      <tbody>${list.map((m) => `<tr><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td>${esc(m.spec)}</td><td>${m.type === 'raw' ? '原料' : '成品'}</td><td>${esc(m.unit)}</td><td>${fmt(m.safety_stock)}</td><td>${fmt(m.ref_price)}</td></tr>`).join('')}</tbody></table>
    </div>`;
}
window.openMaterialModal = async function () {
  openModal(`<h3>新增物料</h3>
    <div class="field"><label>编码</label><input id="m_code"></div>
    <div class="field"><label>名称</label><input id="m_name"></div>
    <div class="field"><label>规格</label><input id="m_spec"></div>
    <div class="row">
      <div class="field"><label>类型</label><select id="m_type"><option value="raw">原料</option><option value="finished">成品</option></select></div>
      <div class="field"><label>单位</label><input id="m_unit"></div>
    </div>
    <div class="row">
      <div class="field"><label>安全库存</label><input id="m_safe" type="number" value="0"></div>
      <div class="field"><label>参考价</label><input id="m_price" type="number"></div>
    </div>
    <div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveMaterial()">保存</button></div>`);
};
window.saveMaterial = async function () {
  try {
    await api('POST', '/materials', {
      code: val('m_code'), name: val('m_name'), spec: val('m_spec'),
      type: val('m_type'), unit: val('m_unit'),
      safety_stock: Number(val('m_safe') || 0), ref_price: val('m_price') ? Number(val('m_price')) : null,
    });
    closeModal(); navigate('materials');
  } catch (e) { modalMsg(e.message); }
};

// ===== 供应商 / 客户 =====
async function renderPartners(view) {
  const [sup, cus] = await Promise.all([api('GET', '/partners/suppliers'), api('GET', '/partners/customers')]);
  view.innerHTML = `
    <div class="card"><h3 style="margin-top:0">供应商</h3>
      <table><thead><tr><th>编码</th><th>名称</th><th>联系人</th><th>电话</th></tr></thead>
      <tbody>${sup.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(s.contact)}</td><td>${esc(s.phone)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><h3 style="margin-top:0">客户</h3>
      <table><thead><tr><th>编码</th><th>名称</th><th>联系人</th><th>电话</th></tr></thead>
      <tbody>${cus.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.contact)}</td><td>${esc(c.phone)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ===== 单据（入库/出库通用）=====
async function renderOrders(view, kind, types, title) {
  const list = await api('GET', '/' + kind);
  const filtered = list.filter((o) => types.includes(o.type));
  const canCreate = ['admin', 'inout'].includes(state.user.role);
  const isOutbound = kind === 'outbound';
  view.innerHTML = `
    <div class="toolbar">
      <span class="grow"></span>
      ${canCreate ? `<button class="btn btn-primary btn-sm" onclick="openOrderModal('${kind}', '${types[0]}')">+ 新建${title}</button>` : ''}
    </div>
    <div class="card" style="padding:0">
      <table><thead><tr>
        <th>单据号</th><th>类型</th><th>往来单位</th><th>数量</th><th>金额</th><th>状态</th>
        <th>打包</th><th>操作</th>
      </tr></thead><tbody>${filtered.length ? filtered.map((o) => orderRow(o, kind, isOutbound)).join('') : '<tr><td colspan="8" style="color:var(--text-3)">暂无单据</td></tr>'}</tbody></table>
    </div>`;
}
const TYPE_LABEL = { purchase: '采购入库', finish: '成品入库', pick: '领料出库', sale: '销售出库', scrap: '报废出库', other_in: '其他入库', other_out: '其他出库' };

function orderRow(o, kind, isOutbound) {
  const partner = o.supplier_name || o.customer_name || '-';
  const role = state.user.role;
  let actions = `<button class="btn btn-sm" onclick="viewItems('${kind}', ${o.id})">明细</button>`;
  if (o.status === 'draft' && ['admin', 'inout'].includes(role))
    actions += ` <button class="btn btn-sm btn-primary" onclick="submitOrder('${kind}', ${o.id})">提交审核</button>`;
  if (o.status === 'pending' && ['admin', 'finance'].includes(role)) {
    actions += ` <button class="btn btn-sm btn-success" onclick="auditOrder('${kind}', ${o.id}, 'approve')">审核通过</button>`;
    actions += ` <button class="btn btn-sm btn-danger" onclick="auditOrder('${kind}', ${o.id}, 'reject')">驳回</button>`;
  }
  if (isOutbound && o.type === 'sale' && o.status === 'done' && ['admin', 'packer'].includes(role) && o.pack_status !== 'packed')
    actions += ` <button class="btn btn-sm" onclick="packOrder(${o.id})">打包确认</button>`;
  const pack = isOutbound ? (o.pack_status === 'packed' ? `<span class="tag tag-done">已打包${o.logistics_no ? ' / ' + esc(o.logistics_no) : ''}</span>` : '<span class="tag tag-draft">未打包</span>') : '-';
  return `<tr><td>${esc(o.order_no)}</td><td>${TYPE_LABEL[o.type] || o.type}</td><td>${esc(partner)}</td><td>${fmt(o.total_qty)}</td><td>${fmt(o.total_amount)}</td><td>${statusTag(o.status)}</td><td>${pack}</td><td>${actions}</td></tr>`;
}

window.viewItems = async function (kind, id) {
  const items = await api('GET', `/${kind}/${id}/items`);
  openModal(`<h3>单据明细</h3>
    <table><thead><tr><th>物料编码</th><th>名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th></tr></thead>
    <tbody>${items.map((i) => `<tr><td>${esc(i.material_code)}</td><td>${esc(i.material_name)}</td><td>${esc(i.unit)}</td><td>${fmt(i.qty)}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.amount)}</td></tr>`).join('')}</tbody></table>
    <div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">关闭</button></div>`);
};

window.submitOrder = async function (kind, id) {
  await api('POST', `/${kind}/${id}/submit`);
  navigate(_curView);
};
window.auditOrder = async function (kind, id, action) {
  await api('POST', `/${kind}/${id}/audit`, { action });
  navigate(_curView);
};
window.packOrder = async function (id) {
  const no = prompt('请输入物流单号（可留空）：');
  await api('POST', `/outbound/${id}/pack`, { logistics_no: no || '' });
  navigate(_curView);
};

function currentView() { return _curView; }

// 新建单据弹窗
window.openOrderModal = async function (kind, type) {
  const materials = await api('GET', '/materials');
  const isPurchase = type === 'purchase';
  const isSale = type === 'sale';
  let partnerOpts = '';
  if (isPurchase || type === 'prod_return') { const s = await api('GET', '/partners/suppliers'); partnerOpts = s.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); }
  if (isSale || type === 'pick') { const c = await api('GET', '/partners/customers'); partnerOpts = c.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); }
  const matOpts = materials.map((m) => `<option value="${m.id}" data-unit="${esc(m.unit)}" data-price="${m.ref_price ?? 0}">${esc(m.code)} ${esc(m.name)}</option>`).join('');
  openModal(`<h3>新建${TYPE_LABEL[type] || ''}单</h3>
    ${partnerOpts ? `<div class="field"><label>往来单位</label><select id="o_partner">${partnerOpts}</select></div>` : ''}
    <div class="field"><label>备注</label><input id="o_remark"></div>
    <div id="o_items"></div>
    <button class="btn btn-sm" onclick="addItemRow('${matOpts}')">+ 添加明细</button>
    <div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveOrder('${kind}', '${type}')">保存草稿</button></div>`);
  addItemRow(matOpts);
};
window.addItemRow = function (matOpts) {
  const box = document.getElementById('o_items');
  const div = document.createElement('div');
  div.className = 'item-row';
  div.innerHTML = `<select class="m">${matOpts}</select><input class="q" type="number" placeholder="数量" style="max-width:90px"><input class="p" type="number" placeholder="单价" style="max-width:90px"><button class="btn btn-sm btn-danger" onclick="this.parentNode.remove()">×</button>`;
  box.appendChild(div);
};
window.saveOrder = async function (kind, type) {
  const rows = [...document.querySelectorAll('#o_items .item-row')];
  const items = rows.map((r) => {
    const sel = r.querySelector('.m');
    const opt = sel.selectedOptions[0];
    return { material_id: Number(sel.value), qty: Number(r.querySelector('.q').value), unit_price: Number(r.querySelector('.p').value || opt.dataset.price || 0) };
  }).filter((i) => i.material_id && i.qty > 0);
  if (!items.length) return modalMsg('请至少添加一条有效明细');
  const body = { type, items, remark: val('o_remark') || '' };
  if (document.getElementById('o_partner')) {
    if (type === 'purchase' || type === 'prod_return') body.supplier_id = Number(val('o_partner'));
    else body.customer_id = Number(val('o_partner'));
  }
  try {
    await api('POST', '/' + kind, body);
    closeModal(); navigate(_curView);
  } catch (e) { modalMsg(e.message); }
};

// ===== 库存 / 流水 =====
async function renderStock(view) {
  const list = await api('GET', '/stock');
  view.innerHTML = `<div class="card" style="padding:0"><table><thead><tr><th>编码</th><th>名称</th><th>类型</th><th>单位</th><th>当前库存</th><th>金额</th><th>安全库存</th><th>预警</th></tr></thead>
    <tbody>${list.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${s.type === 'raw' ? '原料' : '成品'}</td><td>${esc(s.unit)}</td><td>${fmt(s.qty)}</td><td>${fmt(s.amount)}</td><td>${fmt(s.safety_stock)}</td><td>${s.low_stock ? '<span class="tag tag-low">低于安全库存</span>' : '-'}</td></tr>`).join('')}</tbody></table></div>`;
}
async function renderFlow(view) {
  const list = await api('GET', '/stock/flow');
  view.innerHTML = `<div class="card" style="padding:0"><table><thead><tr><th>时间</th><th>单据号</th><th>类型</th><th>物料</th><th>变动数量</th><th>结存数量</th><th>操作人</th></tr></thead>
    <tbody>${list.map((f) => `<tr><td>${esc(f.created_at)}</td><td>${esc(f.order_no)}</td><td>${f.biz_type === 'inbound' ? '入库' : '出库'}</td><td>${esc(f.material_name)}</td><td style="color:${f.change_qty >= 0 ? 'var(--success)' : 'var(--danger)'}">${f.change_qty >= 0 ? '+' : ''}${fmt(f.change_qty)}</td><td>${fmt(f.balance_qty)}</td><td>${esc(f.operator_name)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ===== 弹窗工具 =====
function openModal(html) {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal">${html}</div></div>`;
}
function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
function modalMsg(m) {
  const bar = document.querySelector('#modalRoot .modal');
  if (!bar) return;
  let el = bar.querySelector('.msg');
  if (!el) { el = document.createElement('div'); bar.insertBefore(el, bar.firstChild); }
  el.className = 'msg msg-err'; el.textContent = m;
}
function val(id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; }
window.closeModal = closeModal;

// ===== 启动 =====
if (state.token) {
  api('GET', '/me').then((d) => { state.user = d.user; showApp(); })
    .catch(() => { doLogout(); });
} else {
  document.getElementById('login').classList.remove('hidden');
}
