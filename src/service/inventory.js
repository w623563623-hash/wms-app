import { pool, transaction } from '../db.js';

/**
 * 纯函数：根据当前库存 + 单据明细，计算审核通过后的库存结存与流水差额。
 * 抽成纯函数是为了可单测（不依赖数据库）。
 * @param {object|null} prev  当前 stock 行（无则 null）
 * @param {object} item        单据明细 { qty, unit_price?, amount? }
 * @param {'inbound'|'outbound'} bizType
 */
export function computeStock(prev, item, bizType) {
  const prevQty = prev ? Number(prev.qty) : 0;
  const prevAmt = prev ? Number(prev.amount) : 0;
  const dq = Number(item.qty);
  const damt = Number(item.amount ?? item.qty * (item.unit_price ?? 0));
  const sign = bizType === 'inbound' ? 1 : -1;
  const newQty = prevQty + sign * dq;
  const newAmt = prevAmt + sign * damt;
  return {
    newQty,
    newAmt,
    balanceQty: newQty,
    balanceAmount: newAmt,
    changeQty: sign * dq,
    changeAmount: sign * damt,
  };
}

// 生成单据号：类型前缀 + 日期 + 4位随机
export function genOrderNo(prefix) {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}${ymd}${rnd}`;
}

/**
 * 由生产日期 + 保质期换算"有效期至"（本地时区，避免 UTC 偏移导致差一天）。
 * @param {string} prod  生产日期 'YYYY-MM-DD'
 * @param {number|string} value 保质期数值
 * @param {'year'|'month'|'day'} unit 保质期单位
 * @returns {string|null} 'YYYY-MM-DD' 或 null（缺参/非法）
 */
export function computeExpiryDate(prod, value, unit) {
  if (!prod || !value || !unit) return null;
  const d = new Date(prod + 'T00:00:00');
  if (isNaN(d.getTime())) return null;
  const v = Number(value);
  if (isNaN(v) || v <= 0) return null;
  let y = d.getFullYear(), m = d.getMonth(), day = d.getDate();
  if (unit === 'year') { y += v; m = 11; day = 31; }
  else if (unit === 'month') { m += v; }
  else if (unit === 'day') { day += v; }
  else return null;
  const nd = new Date(y, m, day);
  const yy = nd.getFullYear();
  const mm = String(nd.getMonth() + 1).padStart(2, '0');
  const dd = String(nd.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

// 入库审核通过：事务内更新 stock + 写 stock_flow（行锁防并发超卖）
export async function applyInboundAudit(order, items, auditor) {
  return transaction(async (conn) => {
    for (const it of items) {
      if (it.category_id) {
        // 原料批次：按批次独立记账
        await applyRawBatch(conn, order, it, auditor);
      } else {
        const [st] = await conn.query(
          'SELECT qty, amount FROM stock WHERE material_id = ? FOR UPDATE',
          [it.material_id]
        );
        const c = computeStock(st[0] || null, it, 'inbound');
        await conn.query(
          `INSERT INTO stock (material_id, qty, amount) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE qty = VALUES(qty), amount = VALUES(amount)`,
          [it.material_id, c.newQty, c.newAmt]
        );
        await conn.query(
          `INSERT INTO stock_flow
            (order_no, biz_type, material_id, change_qty, change_amount, balance_qty, balance_amount, operator_id, operator_name)
           VALUES (?, 'inbound', ?, ?, ?, ?, ?, ?, ?)`,
          [
            order.order_no,
            it.material_id,
            c.changeQty,
            c.changeAmount,
            c.balanceQty,
            c.balanceAmount,
            auditor.id,
            auditor.real_name,
          ]
        );
      }
    }
    const [result] = await conn.query(
      "UPDATE inbound_order SET status = 'done', auditor_id = ?, audited_at = NOW() WHERE id = ? AND status = 'pending'",
      [auditor.id, order.id]
    );
    if (result.affectedRows === 0) throw new Error('单据状态已变化，审核失败');
  });
}

// 原料批次审核入账：按 (大类, 名称, 生产日期, 有效期) 唯一键累加，并写批次流水
async function applyRawBatch(conn, order, it, auditor) {
  const changeQty = Number(it.qty);
  const changeAmount = Number(it.amount ?? it.qty * (it.unit_price ?? 0));
  const prod = it.production_date || null;
  // 有效期优先由保质期字段换算（服务端权威），回退用明细携带的 expiry_date
  const exp = computeExpiryDate(it.production_date, it.shelf_life_value, it.shelf_life_unit) || it.expiry_date || null;
  const slv = it.shelf_life_value || null;
  const slu = it.shelf_life_unit || null;
  // 行锁定位已有批次（NULL 安全比较）
  const [existing] = await conn.query(
    `SELECT qty, amount FROM raw_stock_batch
     WHERE category_id <=> ? AND material_name = ? AND production_date <=> ? AND expiry_date <=> ?
     FOR UPDATE`,
    [it.category_id || null, it.material_name, prod, exp]
  );
  const prevQty = existing[0] ? Number(existing[0].qty) : 0;
  const prevAmt = existing[0] ? Number(existing[0].amount) : 0;
  const newQty = prevQty + changeQty;
  const newAmt = prevAmt + changeAmount;
  await conn.query(
    `INSERT INTO raw_stock_batch
      (category_id, material_name, material_code, unit, production_date, expiry_date, shelf_life_value, shelf_life_unit, qty, amount, inbound_order_id, inbound_item_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE qty = VALUES(qty), amount = VALUES(amount)`,
    [
      it.category_id || null,
      it.material_name,
      it.material_code || null,
      it.unit || null,
      prod,
      exp,
      slv,
      slu,
      newQty,
      newAmt,
      order.id,
      it.id,
    ]
  );
  await conn.query(
    `INSERT INTO raw_stock_flow
      (order_no, biz_type, category_id, material_name, material_code, change_qty, change_amount, balance_qty, balance_amount, production_date, expiry_date, operator_id, operator_name)
     VALUES (?, 'inbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.order_no,
      it.category_id || null,
      it.material_name,
      it.material_code || null,
      changeQty,
      changeAmount,
      newQty,
      newAmt,
      prod,
      exp,
      auditor.id,
      auditor.real_name,
    ]
  );
}

// 出库审核通过：校验库存充足后扣减 + 写流水
export async function applyOutboundAudit(order, items, auditor) {
  return transaction(async (conn) => {
    for (const it of items) {
      if (it.batch_id) {
        await applyRawBatchOutbound(conn, order, it, auditor);
        continue;
      }
      const [st] = await conn.query(
        'SELECT qty, amount FROM stock WHERE material_id = ? FOR UPDATE',
        [it.material_id]
      );
      if (!st.length || Number(st[0].qty) < Number(it.qty)) {
        throw new Error(`库存不足，物料 #${it.material_id} 当前库存 ${st[0] ? st[0].qty : 0}`);
      }
      const c = computeStock(st[0], it, 'outbound');
      await conn.query('UPDATE stock SET qty = ?, amount = ? WHERE material_id = ?', [
        c.newQty,
        c.newAmt,
        it.material_id,
      ]);
      await conn.query(
        `INSERT INTO stock_flow
          (order_no, biz_type, material_id, change_qty, change_amount, balance_qty, balance_amount, operator_id, operator_name)
         VALUES (?, 'outbound', ?, ?, ?, ?, ?, ?, ?)`,
        [
          order.order_no,
          it.material_id,
          c.changeQty,
          c.changeAmount,
          c.balanceQty,
          c.balanceAmount,
          auditor.id,
          auditor.real_name,
        ]
      );
    }
    const [result] = await conn.query(
      "UPDATE outbound_order SET status = 'done', auditor_id = ?, audited_at = NOW() WHERE id = ? AND status = 'pending'",
      [auditor.id, order.id]
    );
    if (result.affectedRows === 0) throw new Error('单据状态已变化，审核失败');
  });
}

// 原料批次出库：按批次 id 扣减 raw_stock_batch，并写批次流水
async function applyRawBatchOutbound(conn, order, it, auditor) {
  const [batch] = await conn.query(
    'SELECT * FROM raw_stock_batch WHERE id = ? FOR UPDATE',
    [it.batch_id]
  );
  if (!batch.length) throw new Error(`原料批次 #${it.batch_id} 不存在或已被删除`);
  const b = batch[0];
  if (Number(b.qty) < Number(it.qty)) {
    throw new Error(`原料库存不足，批次「${b.material_name}」当前库存 ${Number(b.qty)}`);
  }
  const changeAmt = Number(it.amount ?? it.qty * (it.unit_price ?? 0));
  const newQty = Number(b.qty) - Number(it.qty);
  const newAmt = Number(b.amount) - changeAmt;
  await conn.query('UPDATE raw_stock_batch SET qty = ?, amount = ? WHERE id = ?', [
    newQty,
    newAmt,
    b.id,
  ]);
  await conn.query(
    `INSERT INTO raw_stock_flow
      (order_no, biz_type, category_id, material_name, material_code, change_qty, change_amount, balance_qty, balance_amount, production_date, expiry_date, operator_id, operator_name)
     VALUES (?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.order_no,
      b.category_id,
      b.material_name,
      b.material_code,
      -Number(it.qty),
      -changeAmt,
      newQty,
      newAmt,
      b.production_date,
      b.expiry_date,
      auditor.id,
      auditor.real_name,
    ]
  );
}
