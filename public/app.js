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
    { id: 'categories', label: '原料大类', roles: ['admin', 'inout', 'packer', 'finance'] },
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
  { group: '财务', items: [
    { id: 'invoices', label: '发票管理', roles: ['admin', 'inout', 'packer', 'finance'] },
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
  categories: ['基础数据', '原料大类'],
  partners: ['基础数据', '供应商 / 客户'],
  'in-purchase': ['入库', '原料入库'],
  'in-finish': ['入库', '成品入库'],
  'out-pick': ['出库', '原料出库'],
  'out-sale': ['出库', '成品出库'],
  stock: ['库存', '实时库存'],
  flow: ['库存', '库存流水'],
  invoices: ['财务', '发票管理'],
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
    if (id === 'categories') return renderCategories(view);
    if (id === 'partners') return renderPartners(view);
    if (id === 'stock') return renderStock(view);
    if (id === 'flow') return renderFlow(view);
    if (id === 'invoices') return renderInvoices(view);
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

// ===== 原料大类 / 成品物料（档案页）=====
async function renderCategories(view) {
  let tab = window._catTab || 'raw';
  const draw = async () => {
    const canEdit = ['admin', 'inout'].includes(state.user.role);
    const tabBar = `<div class="tabs"><button class="tab ${tab === 'raw' ? 'active' : ''}" onclick="switchCatTab('raw')">原料大类</button><button class="tab ${tab === 'fg' ? 'active' : ''}" onclick="switchCatTab('fg')">成品物料</button></div>`;
    if (tab === 'raw') {
      const list = await api('GET', '/categories');
      view.innerHTML = `
        ${tabBar}
        <div class="toolbar"><span class="grow"></span>${canEdit ? '<button class="btn btn-primary btn-sm" onclick="openCategoryModal()">+ 新增大类</button>' : ''}</div>
        <div class="card" style="padding:0"><table><thead><tr><th>编号</th><th>大类名称</th><th>规格</th><th>操作</th></tr></thead>
        <tbody>${list.length ? list.map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.spec)}</td><td>${canEdit ? `<button class="btn btn-sm btn-danger" onclick="deleteCategory(${c.id})">删除</button>` : '-'}</td></tr>`).join('') : '<tr><td colspan="4" style="color:var(--text-3)">暂无大类，点击右上角新增（编号将自动生成）</td></tr>'}</tbody></table></div>`;
    } else {
      const list = await api('GET', '/materials');
      view.innerHTML = `
        ${tabBar}
        <div class="toolbar"><span class="grow"></span>${canEdit ? '<button class="btn btn-primary btn-sm" onclick="openMaterialModal()">+ 新增物料</button>' : ''}</div>
        <div class="card" style="padding:0"><table><thead><tr><th>编码</th><th>名称</th><th>规格</th><th>类型</th><th>单位</th><th>安全库存</th><th>参考价</th></tr></thead>
        <tbody>${list.map((m) => `<tr><td>${esc(m.code)}</td><td>${esc(m.name)}</td><td>${esc(m.spec)}</td><td>${m.type === 'raw' ? '原料' : '成品'}</td><td>${esc(m.unit)}</td><td>${fmt(m.safety_stock)}</td><td>${fmt(m.ref_price)}</td></tr>`).join('')}</tbody></table></div>`;
    }
  };
  window.switchCatTab = async function (t) { window._catTab = t; tab = t; await draw(); };
  await draw();
}
window.openCategoryModal = async function () {
  openModal(`<h3>新增原料大类</h3>
    <div class="field"><label>大类名称</label><input id="c_name" placeholder="如：金属板材"></div>
    <div class="field"><label>规格</label><input id="c_spec" placeholder="如：1.2mm"></div>
    <div class="hint">编号将在保存后自动生成（RC0001 起）</div>
    <div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveCategory()">保存</button></div>`);
};
window.saveCategory = async function () {
  try {
    await api('POST', '/categories', { name: val('c_name'), spec: val('c_spec') });
    closeModal(); navigate('categories');
  } catch (e) { modalMsg(e.message); }
};
window.deleteCategory = async function (id) {
  if (!confirm('确认删除该大类？')) return;
  try { await api('DELETE', '/categories/' + id); navigate('categories'); } catch (e) { alert(e.message); }
};
window.openMaterialModal = async function () {
  openModal(`<h3>新增物料</h3>
    <div class="field"><label>编码</label><input id="m_code"></div>
    <div class="field"><label>名称</label><input id="m_name"></div>
    <div class="field"><label>规格</label><input id="m_spec"></div>
    <div class="row">
      <div class="field"><label>类型</label><select id="m_type"><option value="finished" selected>成品</option><option value="raw">原料</option></select></div>
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
    <table><thead><tr><th>编码</th><th>名称</th><th>单位</th><th>数量</th><th>单价</th><th>金额</th><th>生产日期</th><th>有效期</th></tr></thead>
    <tbody>${items.map((i) => `<tr><td>${esc(i.material_code)}</td><td>${esc(i.material_name)}</td><td>${esc(i.unit)}</td><td>${fmt(i.qty)}</td><td>${fmt(i.unit_price)}</td><td>${fmt(i.amount)}</td><td>${i.production_date || '-'}</td><td>${i.expiry_date || '-'}</td></tr>`).join('')}</tbody></table>
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
let _matOptsCache = '';
let _catOptsCache = '';
let _rawMode = false;
window.openOrderModal = async function (kind, type) {
  _rawMode = type === 'purchase';
  let partnerOpts = '';
  if (type === 'purchase' || type === 'prod_return') { const s = await api('GET', '/partners/suppliers'); partnerOpts = s.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); }
  if (type === 'sale' || type === 'pick') { const c = await api('GET', '/partners/customers'); partnerOpts = c.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); }
  if (_rawMode) {
    const cats = await api('GET', '/categories');
    _catOptsCache = cats.length
      ? cats.map((c) => `<option value="${c.id}">${esc(c.code)} ${esc(c.name)}</option>`).join('')
      : '<option value="" disabled>请先在「原料大类」中维护</option>';
  } else {
    const materials = await api('GET', '/materials');
    _matOptsCache = materials.map((m) => `<option value="${m.id}" data-unit="${esc(m.unit)}" data-price="${m.ref_price ?? 0}">${esc(m.code)} ${esc(m.name)}</option>`).join('');
  }
  const tip = _rawMode ? '（选大类 + 自定义原料名称，编号/批次自动生成）' : '';
  openModal(`<h3>新建${TYPE_LABEL[type] || ''}单 ${tip}</h3>
    ${partnerOpts ? `<div class="field"><label>往来单位</label><select id="o_partner">${partnerOpts}</select></div>` : ''}
    <div class="field"><label>备注</label><input id="o_remark"></div>
    <div id="o_items"></div>
    <button class="btn btn-sm" onclick="addItemRow()">+ 添加明细</button>
    <div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveOrder('${kind}', '${type}')">保存草稿</button></div>`);
  addItemRow();
};
window.addItemRow = function () {
  const box = document.getElementById('o_items');
  const div = document.createElement('div');
  div.className = 'item-row' + (_rawMode ? ' raw' : '');
  if (_rawMode) {
    div.innerHTML = `<select class="cat">${_catOptsCache}</select><input class="mn" placeholder="原料名称(自定义)"><span class="code-preview">编号自动生成</span><input class="pd" type="date" title="生产日期"><input class="ed" type="date" title="有效期"><input class="u" placeholder="单位" style="max-width:64px"><input class="q" type="number" placeholder="数量" style="max-width:72px"><input class="p" type="number" placeholder="单价" style="max-width:72px"><button class="btn btn-sm btn-danger" onclick="this.parentNode.remove()">×</button>`;
  } else {
    div.innerHTML = `<select class="m">${_matOptsCache || '<option value="" disabled selected>暂无物料，请先在「成品物料」中维护</option>'}</select><input class="q" type="number" placeholder="数量" style="max-width:90px"><input class="p" type="number" placeholder="单价" style="max-width:90px"><button class="btn btn-sm btn-danger" onclick="this.parentNode.remove()">×</button>`;
  }
  box.appendChild(div);
};
window.saveOrder = async function (kind, type) {
  const rows = [...document.querySelectorAll('#o_items .item-row')];
  let items;
  if (_rawMode) {
    items = rows.map((r) => ({
      category_id: Number(r.querySelector('.cat').value),
      material_name: r.querySelector('.mn').value.trim(),
      production_date: r.querySelector('.pd').value || null,
      expiry_date: r.querySelector('.ed').value || null,
      unit: r.querySelector('.u').value.trim() || null,
      qty: Number(r.querySelector('.q').value),
      unit_price: Number(r.querySelector('.p').value || 0),
    })).filter((i) => i.category_id && i.material_name && i.qty > 0);
  } else {
    items = rows.map((r) => {
      const sel = r.querySelector('.m');
      const opt = sel.selectedOptions[0];
      return { material_id: Number(sel.value), qty: Number(r.querySelector('.q').value), unit_price: Number(r.querySelector('.p').value || opt.dataset.price || 0) };
    }).filter((i) => i.material_id && i.qty > 0);
  }
  if (!items.length) return modalMsg('请至少添加一条有效明细（原料需选大类并填名称）');
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
  view.innerHTML = `<div class="card" style="padding:0"><table><thead><tr><th>编码</th><th>名称</th><th>类型</th><th>单位</th><th>当前库存</th><th>金额</th><th>安全库存</th><th>效期(生产/有效)</th><th>预警</th></tr></thead>
    <tbody>${list.map((s) => `<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${s.kind === 'raw' ? '原料(批次)' : (s.type === 'raw' ? '原料' : '成品')}</td><td>${esc(s.unit)}</td><td>${fmt(s.qty)}</td><td>${fmt(s.amount)}</td><td>${s.kind === 'raw' ? '-' : fmt(s.safety_stock)}</td><td>${s.kind === 'raw' ? `${s.production_date || '-'} / ${s.expiry_date || '-'}` : '-'}</td><td>${s.low_stock ? '<span class="tag tag-low">低于安全库存</span>' : '-'}</td></tr>`).join('')}</tbody></table></div>`;
}
async function renderFlow(view) {
  const list = await api('GET', '/stock/flow');
  view.innerHTML = `<div class="card" style="padding:0"><table><thead><tr><th>时间</th><th>单据号</th><th>类型</th><th>物料</th><th>变动数量</th><th>结存数量</th><th>操作人</th></tr></thead>
    <tbody>${list.map((f) => `<tr><td>${esc(f.created_at)}</td><td>${esc(f.order_no)}</td><td>${f.biz_type === 'inbound' ? '入库' : '出库'}</td><td>${esc(f.material_name)}</td><td style="color:${f.change_qty >= 0 ? 'var(--success)' : 'var(--danger)'}">${f.change_qty >= 0 ? '+' : ''}${fmt(f.change_qty)}</td><td>${fmt(f.balance_qty)}</td><td>${esc(f.operator_name)}</td></tr>`).join('')}</tbody></table></div>`;
}

// ===== 弹窗工具 =====
function openModal(html, cls = '') {
  document.getElementById('modalRoot').innerHTML = `<div class="modal-mask" onclick="if(event.target===this)closeModal()"><div class="modal ${cls}">${html}</div></div>`;
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

// ===== 发票管理 =====
function fmtMoney(n) { return n == null ? '0.00' : Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function confCls(lv) { return lv === 'high' ? 'conf-high' : lv === 'medium' ? 'conf-medium' : 'conf-low'; }
function cfTag(lv) { return lv === 'high' ? '<span class="ok">✓</span>' : lv === 'medium' ? '<span class="warn">!</span>' : '<span class="err">⚠</span>'; }

async function renderInvoices(view) {
  const f = window._invFilter || (window._invFilter = { type: '', kind: '', month: '', q: '', page: 1, pageSize: 20 });
  const qs = new URLSearchParams();
  if (f.type) qs.set('type', f.type);
  if (f.kind) qs.set('kind', f.kind);
  if (f.month) qs.set('month', f.month);
  if (f.q) qs.set('q', f.q);
  qs.set('page', f.page); qs.set('pageSize', f.pageSize);
  let data;
  try { data = await api('GET', '/invoices?' + qs.toString()); }
  catch (e) { view.innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`; return; }
  const { rows, total, stats } = data;
  const s = stats || {};
  const statCards = `<div class="inv-kpi">
      <div class="box"><div class="num">${s.purchase_count || 0}</div><div class="lbl">进项发票</div></div>
      <div class="box"><div class="num">${s.sale_count || 0}</div><div class="lbl">销项发票</div></div>
      <div class="box"><div class="num">¥${fmtMoney(s.total_amount)}</div><div class="lbl">价税合计</div></div>
      <div class="box"><div class="num" style="color:var(--success)">¥${fmtMoney(s.deductible_tax)}</div><div class="lbl">可抵扣进项税</div></div>
    </div>`;
  const filterBar = `<div class="toolbar inv-filter">
      <select id="f_type" onchange="invFilter('type', this.value)"><option value="">全部类型</option><option value="purchase">进项</option><option value="sale">销项</option></select>
      <select id="f_kind" onchange="invFilter('kind', this.value)"><option value="">全部种类</option><option value="增值税专用发票">增值税专用发票</option><option value="增值税普通发票">增值税普通发票</option><option value="数电专用发票">数电专票</option><option value="数电普通发票">数电普票</option></select>
      <input id="f_month" type="month" onchange="invFilter('month', this.value)">
      <input id="f_q" placeholder="搜索发票号/开票单位/往来单位" onkeydown="if(event.key==='Enter')invFilter('q', this.value)">
      <button class="btn btn-sm" onclick="invFilter('q', val('f_q'))">搜索</button>
      <span class="grow"></span>
      <button class="btn btn-primary btn-sm" onclick="openUploadModal()">+ 上传发票</button>
    </div>`;
  let body;
  const hasFilter = f.type || f.kind || f.month || f.q;
  if (!rows.length) {
    body = hasFilter
      ? `<div class="inv-empty"><div class="ico">∅</div><div>没有匹配的发票</div><div class="sub">尝试调整筛选条件或清除筛选</div><button class="btn btn-sm" onclick="invClearFilter()">清除筛选</button></div>`
      : `<div class="inv-empty"><div class="ico">+</div><div>还没有发票记录</div><div class="sub">上传第一张发票，系统会自动解析并填充字段</div><button class="btn btn-primary btn-sm" onclick="openUploadModal()">上传发票</button></div>`;
  } else {
    body = `<div class="card" style="padding:0"><table><thead><tr>
        <th>发票号</th><th>类型</th><th>开票单位</th><th>种类</th><th>开票日期</th>
        <th>金额(不含税)</th><th>税额</th><th>费用类别</th><th>往来单位</th><th>状态</th><th>操作</th>
      </tr></thead><tbody>${rows.map(invRow).join('')}</tbody></table></div>${invPager(total, f)}`;
  }
  view.innerHTML = statCards + filterBar + body;
  const st = document.getElementById('f_type'); if (st) st.value = f.type;
  const sk = document.getElementById('f_kind'); if (sk) sk.value = f.kind;
  const sm = document.getElementById('f_month'); if (sm) sm.value = f.month;
  const sq = document.getElementById('f_q'); if (sq) sq.value = f.q;
}

function invRow(r) {
  const lvl = r.confidence_level || (r.billing_unit_id ? 'high' : (r.partner_name ? 'medium' : 'low'));
  const typeTag = r.invoice_type === 'purchase' ? '<span class="tag tag-in">进项</span>' : r.invoice_type === 'sale' ? '<span class="tag tag-out">销项</span>' : '-';
  return `<tr>
    <td>${esc(r.invoice_no)}</td><td>${typeTag}</td><td>${esc(r.billing_name)}</td><td>${esc(r.invoice_kind || '-')}</td>
    <td>${r.invoice_date || '-'}</td>
    <td class="num">¥${fmtMoney(r.amount_ex_tax)}</td><td class="num">¥${fmtMoney(r.tax_amount)}</td>
    <td>${esc(r.expense_type || '-')}</td><td>${esc(r.partner_name || '-')}</td>
    <td>${confBadge(lvl)}</td>
    <td><button class="btn btn-sm" onclick="viewInvoice(${r.id})">查看</button> <button class="btn btn-sm btn-danger" onclick="delInvoice(${r.id})">删除</button></td>
  </tr>`;
}
function confBadge(lv) {
  if (lv === 'high') return '<span class="tag conf-high">✓ 高置信</span>';
  if (lv === 'medium') return '<span class="tag conf-medium">! 待确认</span>';
  return '<span class="tag conf-low">⚠ 未匹配</span>';
}
function invPager(total, f) {
  const pages = Math.ceil(total / f.pageSize) || 1;
  if (pages <= 1) return '';
  return `<div class="pager">共 ${total} 条 · 第 ${f.page}/${pages} 页
    <button class="btn btn-sm" ${f.page <= 1 ? 'disabled' : ''} onclick="invPage(${f.page - 1})">上一页</button>
    <button class="btn btn-sm" ${f.page >= pages ? 'disabled' : ''} onclick="invPage(${f.page + 1})">下一页</button></div>`;
}
window.invFilter = function (key, v) { window._invFilter[key] = v; window._invFilter.page = 1; navigate('invoices'); };
window.invClearFilter = function () { window._invFilter = { type: '', kind: '', month: '', q: '', page: 1, pageSize: 20 }; navigate('invoices'); };
window.invPage = function (p) { window._invFilter.page = Math.max(1, p); navigate('invoices'); };

// 上传弹窗
window.openUploadModal = async function () {
  openModal(`<h3>上传发票</h3>
    <div id="inv_drop" class="inv-drop">
      <input type="file" id="inv_file" accept="application/pdf" style="display:none" onchange="invFileChosen(this)">
      <div onclick="document.getElementById('inv_file').click()" style="cursor:pointer;text-align:center;padding:24px">
        <div style="font-size:30px">📄</div>
        <div style="margin-top:6px">点击或拖拽 PDF 发票到此处</div>
        <div class="sub">支持增值税电子发票 / 数电票 / 专票 / 普票</div>
      </div>
    </div>
    <div id="inv_result" style="display:none"></div>
    <div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">取消</button></div>`, 'wide');
  const drop = document.getElementById('inv_drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('drag'); };
  drop.ondragleave = () => drop.classList.remove('drag');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('drag'); const f = e.dataTransfer.files[0]; if (f) invReadFile(f); };
};
window.invFileChosen = function (input) { const f = input.files[0]; if (f) invReadFile(f); };
function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}
async function invReadFile(file) {
  if (!file || file.type !== 'application/pdf') { alert('请选择 PDF 文件'); return; }
  const base64 = await fileToBase64(file);
  window._invFile = { base64, name: file.name };
  const drop = document.getElementById('inv_drop');
  drop.innerHTML = `<div style="padding:18px;text-align:center"><div class="loading">解析中…</div><div class="sub">${esc(file.name)} (${(file.size / 1024).toFixed(0)} KB)</div></div>`;
  try {
    const { result } = await api('POST', '/invoices/parse', { file: base64, fileName: file.name });
    window._invPartners = await api('GET', '/invoices/partners/all').catch(() => []);
    window._invBilling = { partner_id: result.billing.partner_id || null, partner_type: result.billing.partner_type || null, partner_name: result.billing.partner_name || null };
    renderInvResult(result);
  } catch (e) { drop.innerHTML = `<div class="msg msg-err">${esc(e.message)}</div>`; }
}

function pendList(r, b) {
  const a = [];
  if (b.match !== 'exact') a.push('开票单位');
  if ((r.invoice_kind || {}).confidence === 'medium') a.push('发票种类');
  if ((r.expense_type || {}).confidence === 'medium') a.push('费用类型');
  return a.join('、') || '无';
}

function renderInvResult(r) {
  window._invResult = r;
  const el = document.getElementById('inv_result');
  el.style.display = 'block';
  const b = r.billing || {};
  const cf = confCls;
  let billingHtml;
  if (b.match === 'exact') {
    billingHtml = `<div class="inv-field ${cf(b.confidence)}"><label>开票单位 <span class="badge-ok">精确匹配</span></label>
      <div class="fv">${esc(b.name)} <span class="ok">✓</span></div>
      <div class="sub">税号 ${esc(b.tax_no)} · ${b.partner_type === 'supplier' ? '供应商' : '客户'}：${esc(b.partner_name)}</div></div>`;
  } else if (b.match === 'fuzzy') {
    const cands = (b.candidates || []).map((c) => `<option value="${c.id}">${esc(c.name)}（${Math.round(c.score * 100)}%）</option>`).join('');
    billingHtml = `<div class="inv-field ${cf(b.confidence)}"><label>开票单位 <span class="badge-warn">待确认</span></label>
      <select id="billing_sel" onchange="invBillingPick(this.value)">
        <option value="${b.partner_id}" selected>${esc(b.name)}</option>${cands}
        <option value="__new">+ 新建往来单位…</option>
      </select><div class="sub">PDF 原文：${esc(b.name)}</div></div>`;
  } else {
    billingHtml = `<div class="inv-field ${cf(b.confidence)}"><label>开票单位 <span class="badge-err">未匹配</span></label>
      <div class="fv err">未匹配</div><div class="sub">PDF 原文：${esc(b.name || '-')}</div>
      <div class="inv-actions"><button class="btn btn-sm btn-primary" onclick="invNewPartner()">+ 用此名称新建</button>
      <button class="btn btn-sm" onclick="invPickPartner()">手动搜索已有</button></div></div>`;
  }
  const it = r.invoice_type || {};
  const pend = (b.match !== 'exact' ? 1 : 0) + ((r.invoice_kind || {}).confidence === 'medium' ? 1 : 0) + ((r.expense_type || {}).confidence === 'medium' ? 1 : 0);
  el.innerHTML = `<div class="inv-split">
      <div class="inv-left"><div class="sub">PDF 解析结果</div><div class="inv-pdf-ph">PDF<br><span class="sub">${esc(window._invFile.name)}</span></div></div>
      <div class="inv-right">
        ${billingHtml}
        <div class="inv-grid">
          <div class="inv-field ${cf(r.invoice_no.confidence)}"><label>发票号${cfTag(r.invoice_no.confidence)}</label><input id="inv_invoice_no" value="${esc(r.invoice_no.value || '')}"></div>
          <div class="inv-field ${cf(r.invoice_date.confidence)}"><label>开票日期${cfTag(r.invoice_date.confidence)}</label><input id="inv_invoice_date" type="date" value="${esc(r.invoice_date.value || '')}"></div>
          <div class="inv-field ${cf(it.confidence)}"><label>发票类型${cfTag(it.confidence)}</label>
            <select id="inv_invoice_type"><option value="purchase" ${it.value === 'purchase' ? 'selected' : ''}>进项</option><option value="sale" ${it.value === 'sale' ? 'selected' : ''}>销项</option></select></div>
          <div class="inv-field ${cf(r.invoice_kind.confidence)}"><label>发票种类${cfTag(r.invoice_kind.confidence)}</label>
            <select id="inv_invoice_kind"><option value="增值税专用发票" ${r.invoice_kind.value === '增值税专用发票' ? 'selected' : ''}>增值税专用发票</option><option value="增值税普通发票" ${r.invoice_kind.value === '增值税普通发票' ? 'selected' : ''}>增值税普通发票</option><option value="数电专用发票" ${r.invoice_kind.value === '数电专用发票' ? 'selected' : ''}>数电专票</option><option value="数电普通发票" ${r.invoice_kind.value === '数电普通发票' ? 'selected' : ''}>数电普票</option><option value="机动车销售统一发票" ${r.invoice_kind.value === '机动车销售统一发票' ? 'selected' : ''}>机动车</option><option value="" ${!r.invoice_kind.value ? 'selected' : ''}>其他/未知</option></select></div>
          <div class="inv-field ${cf((r.partner || {}).confidence)}"><label>往来单位${cfTag((r.partner || {}).confidence)}</label><input id="inv_partner_name" value="${esc((r.partner || {}).name || '')}" placeholder="匹配后自动填充"></div>
          <div class="inv-field ${cf(r.expense_type.confidence)}"><label>费用类型${cfTag(r.expense_type.confidence)}</label><input id="inv_expense_type" value="${esc(r.expense_type.value || '')}" placeholder="如：运输费"></div>
          <div class="inv-field ${cf(r.amount_ex_tax.confidence)}"><label>金额(不含税)${cfTag(r.amount_ex_tax.confidence)}</label><input id="inv_amount_ex_tax" type="number" step="0.01" value="${r.amount_ex_tax.value ?? ''}"></div>
          <div class="inv-field ${cf(r.tax_amount.confidence)}"><label>税额${cfTag(r.tax_amount.confidence)}</label><input id="inv_tax_amount" type="number" step="0.01" value="${r.tax_amount.value ?? ''}"></div>
          <div class="inv-field ${cf(r.amount_incl_tax.confidence)}"><label>价税合计${cfTag(r.amount_incl_tax.confidence)}</label><input id="inv_amount_incl_tax" type="number" step="0.01" value="${r.amount_incl_tax.value ?? ''}"></div>
        </div>
        ${pend > 0 ? `<div class="inv-tip">! ${pend} 项待确认：${pendList(r, b)}。开单位已匹配，请核对后入账。</div>` : `<div class="inv-tip ok">✓ 全部字段已识别，可直接入账。</div>`}
        <div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">取消</button><button class="btn btn-primary" onclick="saveInvoice()">确认入账</button></div>
      </div>
    </div>`;
}

window.invBillingPick = function (v) {
  if (v === '__new') { invNewPartner(); return; }
  const id = Number(v);
  const p = (window._invPartners || []).find((x) => x.id === id) || (window._invResult.billing.candidates || []).find((x) => x.id === id);
  if (p) {
    window._invBilling = { partner_id: p.id, partner_type: p.type, partner_name: p.name };
    const it = p.type === 'supplier' ? 'purchase' : 'sale';
    const e1 = document.getElementById('inv_invoice_type'); if (e1) e1.value = it;
    const e2 = document.getElementById('inv_partner_name'); if (e2) e2.value = p.name;
    const r = window._invResult; r.billing.match = 'exact'; r.billing.partner_id = p.id; r.billing.partner_type = p.type; r.billing.partner_name = p.name; r.billing.confidence = 'high';
    r.invoice_type = { value: it, confidence: 'high', source: 'partner' }; r.partner = { name: p.name, type: p.type, id: p.id, confidence: 'high' }; r.confidence_level = 'high';
    renderInvResult(r);
  }
};
window.invNewPartner = async function () {
  const name = window._invResult.billing.name;
  const taxNo = window._invResult.billing.tax_no;
  const type = prompt('新建往来单位类型：输入 supplier（供应商）或 customer（客户）', 'supplier');
  if (!type || (type !== 'supplier' && type !== 'customer')) return;
  try {
    const code = 'P' + Date.now().toString().slice(-8);
    const res = await api('POST', '/partners/' + type + 's', { code, name, tax_no: taxNo || null });
    const partner = { id: res.id, name, tax_no: taxNo, type };
    (window._invPartners || []).push(partner);
    window._invBilling = { partner_id: res.id, partner_type: type, partner_name: name };
    const r = window._invResult;
    r.billing.match = 'exact'; r.billing.partner_id = res.id; r.billing.partner_type = type; r.billing.partner_name = name; r.billing.confidence = 'high';
    r.invoice_type = { value: type === 'supplier' ? 'purchase' : 'sale', confidence: 'high', source: 'partner' };
    r.partner = { name, type, id: res.id, confidence: 'high' }; r.confidence_level = 'high';
    renderInvResult(r);
    modalMsg('已新建往来单位并关联');
  } catch (e) { alert(e.message); }
};
window.invPickPartner = async function () {
  const all = window._invPartners || [];
  openModal(`<h3>选择往来单位</h3><div class="inv-picklist">${(all.length ? all : [{ name: '暂无往来单位', type: '', id: 0 }]).map((p) => `<div class="pick" onclick="invPickThis(${p.id})">${esc(p.name)} <span class="sub">${p.type === 'supplier' ? '供应商' : p.type === 'customer' ? '客户' : ''}${p.tax_no ? ' · ' + esc(p.tax_no) : ''}</span></div>`).join('')}</div><div class="toolbar"><span class="grow"></span><button class="btn" onclick="closeModal()">取消</button></div>`);
};
window.invPickThis = function (id) {
  const p = (window._invPartners || []).find((x) => x.id === id);
  if (p) {
    window._invBilling = { partner_id: p.id, partner_type: p.type, partner_name: p.name };
    const r = window._invResult; r.billing.match = 'exact'; r.billing.partner_id = p.id; r.billing.partner_type = p.type; r.billing.partner_name = p.name; r.billing.confidence = 'high';
    r.confidence_level = 'high'; renderInvResult(r);
  }
  closeModal();
};

function collectInvForm() {
  const r = window._invResult;
  const b = window._invBilling || { partner_id: r.billing.partner_id || null, partner_type: r.billing.partner_type || null, partner_name: r.billing.partner_name || null };
  const g = (id) => { const e = document.getElementById(id); return e ? e.value : ''; };
  return {
    file: window._invFile.base64, fileName: window._invFile.name,
    invoice_no: g('inv_invoice_no'), invoice_date: g('inv_invoice_date'),
    invoice_type: g('inv_invoice_type') || null, invoice_kind: g('inv_invoice_kind'), expense_type: g('inv_expense_type'),
    amount_ex_tax: Number(g('inv_amount_ex_tax') || 0), tax_amount: Number(g('inv_tax_amount') || 0), amount_incl_tax: Number(g('inv_amount_incl_tax') || 0),
    billing_name: r.billing.name, billing_tax_no: r.billing.tax_no,
    billing_unit_id: b.partner_id || null, partner_type: b.partner_type || null, partner_name: b.partner_name || r.billing.name,
    confidence: r.confidence || {}, confidence_level: r.confidence_level,
  };
}
window.saveInvoice = async function () {
  try {
    const body = collectInvForm();
    if (!body.invoice_no) return modalMsg('发票号必填');
    await api('POST', '/invoices', body);
    closeModal(); navigate('invoices');
  } catch (e) { modalMsg(e.message); }
};

// 详情
function fieldCard(label, value, confCls, sub) {
  return `<div class="inv-field ${confCls}"><label>${label}</label><div class="fv">${value || '-'}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
}
window.viewInvoice = async function (id) {
  let r;
  try { r = await api('GET', '/invoices/' + id); } catch (e) { return alert(e.message); }
  const cf = confCls;
  const c = r.confidence || {};
  const lvl = r.confidence_level;
  const typeTxt = r.invoice_type === 'purchase' ? '进项' : r.invoice_type === 'sale' ? '销项' : '-';
  openModal(`<h3>发票详情 · ${esc(r.invoice_no)}</h3>
    <div class="inv-detail ${cf(lvl)}">
      <div class="inv-pdf"><div class="sub">发票原件</div>
        ${r.file_data ? `<button class="btn btn-sm" onclick="invDownload(${r.id})">下载原件 PDF</button>` : '<span class="sub">无原件</span>'}
        <div class="pdf-ph">PDF<br><span class="sub">${esc(r.file_name || '')}</span></div>
      </div>
      <div class="inv-info">
        ${fieldCard('开票单位', r.billing_name, cf((c.billing || {}).confidence || 'high'), '税号 ' + (r.billing_tax_no || '-'))}
        ${fieldCard('发票类型', typeTxt, cf((c.invoice_type || {}).confidence))}
        ${fieldCard('发票种类', r.invoice_kind, cf((c.invoice_kind || {}).confidence))}
        ${fieldCard('往来单位', r.partner_name, cf((c.partner || {}).confidence))}
        ${fieldCard('费用类型', r.expense_type, cf((c.expense_type || {}).confidence))}
        ${fieldCard('金额(不含税)', '¥' + fmtMoney(r.amount_ex_tax), cf((c.amount_ex_tax || {}).confidence))}
        ${fieldCard('税额', '¥' + fmtMoney(r.tax_amount), cf((c.tax_amount || {}).confidence))}
        ${fieldCard('价税合计', '¥' + fmtMoney(r.amount_incl_tax), cf((c.amount_incl_tax || {}).confidence))}
        ${fieldCard('开票日期', r.invoice_date, cf((c.invoice_date || {}).confidence))}
        ${fieldCard('上传人', r.operator_name, 'conf-high')}
      </div>
    </div>
    <div class="toolbar"><span class="grow"></span>
      <button class="btn btn-sm btn-danger" onclick="delInvoice(${r.id})">删除</button>
      <button class="btn" onclick="closeModal()">关闭</button>
    </div>`, 'wide');
};
window.invDownload = async function (id) {
  const r = await api('GET', '/invoices/' + id);
  if (!r.file_data) return alert('无原件');
  const a = document.createElement('a');
  a.href = 'data:application/pdf;base64,' + r.file_data;
  a.download = (r.file_name || ('invoice_' + r.invoice_no)) + '.pdf';
  a.click();
};
window.delInvoice = async function (id) {
  if (!confirm('确认删除该发票？')) return;
  try { await api('DELETE', '/invoices/' + id); navigate('invoices'); } catch (e) { alert(e.message); }
};

// ===== 启动 =====
if (state.token) {
  api('GET', '/me').then((d) => { state.user = d.user; showApp(); })
    .catch(() => { doLogout(); });
} else {
  document.getElementById('login').classList.remove('hidden');
}
