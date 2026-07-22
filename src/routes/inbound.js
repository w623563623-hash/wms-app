import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';
import { genOrderNo, applyInboundAudit } from '../service/inventory.js';

const router = Router();
router.use(authMiddleware);

// 入库单列表（含往来单位名称）
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.*, s.name AS supplier_name, c.name AS customer_name
      FROM inbound_order o
      LEFT JOIN supplier s ON o.supplier_id = s.id
      LEFT JOIN customer c ON o.customer_id = c.id
      ORDER BY o.id DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 入库单明细
router.get('/:id/items', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, m.name AS material_name, m.code AS material_code, m.unit
       FROM inbound_item i JOIN material m ON i.material_id = m.id
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
      await conn.query(
        `INSERT INTO inbound_item (order_id, material_id, qty, unit_price, amount, remark)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [r.insertId, it.material_id, it.qty, it.unit_price, it.amount, it.remark || null]
      );
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

// 提交审核（draft -> pending）
router.post('/:id/submit', requireRole('inout', 'admin'), async (req, res) => {
  try {
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
