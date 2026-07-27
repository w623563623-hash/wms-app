import { pool } from './src/db.js';

const BASE = 'https://wms-app-285760-10-1456992047.sh.run.tcloudbase.com';
const U = 'admin', P = 'Wms@2026';
let TOKEN = '';

async function api(method, path, body) {
  const res = await fetch(BASE + '/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${typeof data === 'string' ? data : JSON.stringify(data)}`);
  return data;
}

// 临期判定（与前端 isNearExpiry 一致；接口 DATE 字段序列化为 ISO datetime，取日期部分）
function isNearExpiry(s) {
  if (!s.expiry_date || !s.shelf_life_value || !s.shelf_life_unit || !s.production_date) return false;
  const prod = new Date(String(s.production_date).slice(0, 10) + 'T00:00:00').getTime();
  const exp = new Date(String(s.expiry_date).slice(0, 10) + 'T00:00:00').getTime();
  const now = Date.now();
  const total = exp - prod, remaining = exp - now;
  if (total <= 0 || remaining <= 0) return false;
  return remaining / total <= 0.2;
}
const expDay = (s) => String(s.expiry_date).slice(0, 10);

const created = [];
async function cleanup() {
  for (const id of created) {
    const [o] = await pool.query('SELECT order_no FROM inbound_order WHERE id = ?', [id]);
    if (o[0]) await pool.query('DELETE FROM raw_stock_flow WHERE order_no = ?', [o[0].order_no]);
    await pool.query('DELETE FROM raw_stock_batch WHERE inbound_order_id = ?', [id]);
    await pool.query('DELETE FROM inbound_item WHERE order_id = ?', [id]);
    await pool.query('DELETE FROM inbound_order WHERE id = ?', [id]);
  }
}
async function main() {
  const login = await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: U, password: P }),
  }).then((r) => r.json());
  TOKEN = login.token;
  if (!TOKEN) throw new Error('登录失败: ' + JSON.stringify(login));
  console.log('登录 OK');

  const sups = await api('GET', '/partners/suppliers');
  if (!sups.length) throw new Error('没有供应商，无法创建原料入库单');
  const sid = sups[0].id;
  console.log('使用供应商 id=', sid);

  const o1 = await api('POST', '/inbound', {
    type: 'purchase', supplier_id: sid, remark: 'E2E_SHELFLIFE',
    items: [{ category_id: 1, material_name: '测试钢板A', production_date: '2027-01-01',
      shelf_life_value: 24, shelf_life_unit: 'month', unit: '张', qty: 10, unit_price: 5 }],
  });
  created.push(o1.id);
  await api('POST', `/inbound/${o1.id}/submit`);
  await api('POST', `/inbound/${o1.id}/audit`, { action: 'approve' });
  console.log('用例1 入库审核完成 id=', o1.id);

  const o2 = await api('POST', '/inbound', {
    type: 'purchase', supplier_id: sid, remark: 'E2E_SHELFLIFE',
    items: [{ category_id: 1, material_name: '测试钢板B', production_date: '2025-08-01',
      shelf_life_value: 12, shelf_life_unit: 'month', unit: '张', qty: 7, unit_price: 4 }],
  });
  created.push(o2.id);
  await api('POST', `/inbound/${o2.id}/submit`);
  await api('POST', `/inbound/${o2.id}/audit`, { action: 'approve' });
  console.log('用例2 入库审核完成 id=', o2.id);

  const stock = await api('GET', '/stock');
  const batches = stock.filter((s) => s.kind === 'raw' && (s.name === '测试钢板A' || s.name === '测试钢板B'));
  console.log('批次数:', batches.length);
  for (const b of batches) {
    console.log(`  ${b.name} | expiry=${expDay(b)} | unit=${b.shelf_life_unit} | value=${b.shelf_life_value} | 临期=${isNearExpiry(b)}`);
  }
  const a = batches.find((b) => b.name === '测试钢板A');
  const b = batches.find((b) => b.name === '测试钢板B');
  const okExpiryA = a && expDay(a) === '2029-01-01' && a.shelf_life_unit === 'month' && a.shelf_life_value === 24;
  const okExpiryB = b && expDay(b) === '2026-08-01' && b.shelf_life_unit === 'month' && b.shelf_life_value === 12;
  const okNear = a && !isNearExpiry(a) && b && isNearExpiry(b);
  console.log('断言 expiry A=2029-01-01:', okExpiryA);
  console.log('断言 expiry B=2026-08-01:', okExpiryB);
  console.log('断言 临期判定 (A否/B是):', okNear);
  if (!(okExpiryA && okExpiryB && okNear)) throw new Error('断言失败');

  await cleanup();
  console.log('测试数据已清理');
  console.log('ALL PASS');
}
main().catch(async (e) => {
  try { await cleanup(); } catch {}
  console.error('FAIL:', e.message);
  process.exit(1);
}).finally(() => pool.end());
