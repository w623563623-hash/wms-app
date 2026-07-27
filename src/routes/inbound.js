import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';
import { config } from '../config.js';
import { genOrderNo, applyInboundAudit, computeExpiryDate } from '../service/inventory.js';

const router = Router();
router.use(authMiddleware);

// 原料编号：RM + 日期 + 4 位随机（保存时由服务端权威生成）
function genRawMaterialCode() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(
    d.getDate()
  ).padStart(2, '0')}`;
  const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `RM${ymd}${rnd}`;
}

// 入库单列表（含往来单位名称 + 物料明细聚合）
router.get('/', async (req, res) => {
  try {
    await pool.query('SET SESSION group_concat_max_len = 65535');
    const [rows] = await pool.query(`
      SELECT o.*, s.name AS supplier_name, c.name AS customer_name,
        (SELECT GROUP_CONCAT(
           CONCAT(COALESCE(m.name, i.material_name, ''), ' ', COALESCE(m.unit, i.unit, ''), ' ×', i.qty)
           SEPARATOR '；')
         FROM inbound_item i LEFT JOIN material m ON i.material_id = m.id WHERE i.order_id = o.id) AS items_summary
      FROM inbound_order o
      LEFT JOIN supplier s ON o.supplier_id = s.id
      LEFT JOIN customer c ON o.customer_id = c.id
      ORDER BY o.id DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 入库单明细（兼容原料批次与成品物料）
router.get('/:id/items', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*,
              COALESCE(i.material_name, m.name) AS material_name,
              COALESCE(i.material_code, m.code) AS material_code,
              COALESCE(i.unit, m.unit) AS unit,
              cat.name AS category_name, cat.code AS category_code
       FROM inbound_item i
       LEFT JOIN material m ON i.material_id = m.id
       LEFT JOIN raw_category cat ON i.category_id = cat.id
       WHERE i.order_id = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新建入库单（inout / admin 制单）
router.post('/', requireRole('inout', 'admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { type, supplier_id, customer_id, remark, items } = req.body || {};
    if (!type || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: '单据类型与明细必填' });
    }
    let totalQty = 0;
    let totalAmount = 0;
    for (const it of items) {
      it.qty = Number(it.qty);
      it.unit_price = Number(it.unit_price || 0);
      it.amount = it.qty * it.unit_price;
      totalQty += it.qty;
      totalAmount += it.amount;
    }
    const orderNo = genOrderNo('IN');
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO inbound_order
        (order_no, type, supplier_id, customer_id, total_qty, total_amount, status, creator_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        orderNo,
        type,
        supplier_id || null,
        customer_id || null,
        totalQty,
        totalAmount,
        req.user.sub,
        remark || null,
      ]
    );
    for (const it of items) {
      // 原料批次：选大类 + 自定义名称，编号服务端生成
      if (it.category_id) {
        if (!it.material_name || it.qty <= 0) {
          await conn.rollback();
          return res.status(400).json({ error: '原料明细需填写大类、原料名称与数量' });
        }
        const expiry = computeExpiryDate(it.production_date, it.shelf_life_value, it.shelf_life_unit);
        await conn.query(
          `INSERT INTO inbound_item
            (order_id, category_id, material_name, material_code, unit, qty, unit_price, amount, production_date, expiry_date, shelf_life_value, shelf_life_unit, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.insertId,
            it.category_id,
            it.material_name,
            genRawMaterialCode(),
            it.unit || null,
            it.qty,
            it.unit_price,
            it.amount,
            it.production_date || null,
            expiry,
            it.shelf_life_value || null,
            it.shelf_life_unit || null,
            it.remark || null,
          ]
        );
      } else {
        // 成品物料：沿用既有 material_id
        if (!it.material_id || it.qty <= 0) {
          await conn.rollback();
          return res.status(400).json({ error: '成品明细需选择物料并填写数量' });
        }
        await conn.query(
          `INSERT INTO inbound_item (order_id, material_id, qty, unit_price, amount, remark)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [r.insertId, it.material_id, it.qty, it.unit_price, it.amount, it.remark || null]
        );
      }
    }
    await conn.commit();
    res.json({ id: r.insertId, order_no: orderNo });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// 提交审核（draft -> pending）；审核流程关闭时提交即直接入账生效
router.post('/:id/submit', requireRole('inout', 'admin'), async (req, res) => {
  try {
    if (!config.auditEnabled) {
      // 审核流程暂时关闭：提交即直接入账，库存当场变动
      const [orders] = await pool.query('SELECT * FROM inbound_order WHERE id = ?', [req.params.id]);
      if (!orders.length) return res.status(404).json({ error: '单据不存在' });
      const order = orders[0];
      if (order.status !== 'draft') return res.status(400).json({ error: '仅草稿单可提交' });
      const [items] = await pool.query('SELECT * FROM inbound_item WHERE order_id = ?', [order.id]);
      await applyInboundAudit(order, items, { id: req.user.sub, real_name: req.user.real_name });
      return res.json({ ok: true, status: 'done', auditSkipped: true });
    }
    const [result] = await pool.query(
      "UPDATE inbound_order SET status = 'pending' WHERE id = ? AND status = 'draft'",
      [req.params.id]
    );
    if (!result.affectedRows) return res.status(400).json({ error: '仅草稿单可提交' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 财务审核（approve / reject）
router.post('/:id/audit', requireRole('finance', 'admin'), async (req, res) => {
  try {
    const { action } = req.body || {};
    const [orders] = await pool.query('SELECT * FROM inbound_order WHERE id = ?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: '单据不存在' });
    const order = orders[0];
    if (order.status !== 'pending') return res.status(400).json({ error: '仅待审核单可审核' });

    if (action === 'reject') {
      await pool.query(
        "UPDATE inbound_order SET status = 'cancel', auditor_id = ?, audited_at = NOW() WHERE id = ?",
        [req.user.sub, order.id]
      );
      return res.json({ ok: true, status: 'cancel' });
    }
    if (action !== 'approve') return res.status(400).json({ error: 'action 须为 approve/reject' });

    const [items] = await pool.query('SELECT * FROM inbound_item WHERE order_id = ?', [order.id]);
    await applyInboundAudit(order, items, { id: req.user.sub, real_name: req.user.real_name });
    res.json({ ok: true, status: 'done' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
