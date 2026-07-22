import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';
import { genOrderNo, applyOutboundAudit } from '../service/inventory.js';

const router = Router();
router.use(authMiddleware);

// 出库单列表
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.*, c.name AS customer_name, s.name AS supplier_name
      FROM outbound_order o
      LEFT JOIN customer c ON o.customer_id = c.id
      LEFT JOIN supplier s ON o.supplier_id = s.id
      ORDER BY o.id DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 出库单明细
router.get('/:id/items', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*, m.name AS material_name, m.code AS material_code, m.unit
       FROM outbound_item i JOIN material m ON i.material_id = m.id
       WHERE i.order_id = ?`,
      [req.params.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新建出库单（inout / admin 制单）
router.post('/', requireRole('inout', 'admin'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { type, customer_id, supplier_id, remark, items } = req.body || {};
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
    const orderNo = genOrderNo('OUT');
    await conn.beginTransaction();
    const [r] = await conn.query(
      `INSERT INTO outbound_order
        (order_no, type, customer_id, supplier_id, total_qty, total_amount, status, creator_id, remark)
       VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
      [
        orderNo,
        type,
        customer_id || null,
        supplier_id || null,
        totalQty,
        totalAmount,
        req.user.sub,
        remark || null,
      ]
    );
    for (const it of items) {
      await conn.query(
        `INSERT INTO outbound_item (order_id, material_id, qty, unit_price, amount, remark)
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
      "UPDATE outbound_order SET status = 'pending' WHERE id = ? AND status = 'draft'",
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
    const [orders] = await pool.query('SELECT * FROM outbound_order WHERE id = ?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: '单据不存在' });
    const order = orders[0];
    if (order.status !== 'pending') return res.status(400).json({ error: '仅待审核单可审核' });

    if (action === 'reject') {
      await pool.query(
        "UPDATE outbound_order SET status = 'cancel', auditor_id = ?, audited_at = NOW() WHERE id = ?",
        [req.user.sub, order.id]
      );
      return res.json({ ok: true, status: 'cancel' });
    }
    if (action !== 'approve') return res.status(400).json({ error: 'action 须为 approve/reject' });

    const [items] = await pool.query('SELECT * FROM outbound_item WHERE order_id = ?', [order.id]);
    await applyOutboundAudit(order, items, { id: req.user.sub, real_name: req.user.real_name });
    res.json({ ok: true, status: 'done' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 打包确认（仅成品出库 sale，且已审核；packer / admin）
router.post('/:id/pack', requireRole('packer', 'admin'), async (req, res) => {
  try {
    const { logistics_no } = req.body || {};
    const [orders] = await pool.query('SELECT * FROM outbound_order WHERE id = ?', [req.params.id]);
    if (!orders.length) return res.status(404).json({ error: '单据不存在' });
    const order = orders[0];
    if (order.type !== 'sale') return res.status(400).json({ error: '仅成品出库(sale)需要打包确认' });
    if (order.status !== 'done') return res.status(400).json({ error: '仅已审核单据可打包' });
    await pool.query(
      "UPDATE outbound_order SET pack_status = 'packed', packer_id = ?, packed_at = NOW(), logistics_no = ? WHERE id = ?",
      [req.user.sub, logistics_no || null, order.id]
    );
    res.json({ ok: true, pack_status: 'packed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
