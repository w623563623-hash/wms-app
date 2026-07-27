import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';
import { config } from '../config.js';
import { genOrderNo, applyOutboundAudit } from '../service/inventory.js';

const router = Router();
router.use(authMiddleware);

// 出库单列表（含往来单位名称 + 物料明细聚合）
router.get('/', async (req, res) => {
  try {
    await pool.query('SET SESSION group_concat_max_len = 65535');
    const [rows] = await pool.query(`
      SELECT o.*, c.name AS customer_name, s.name AS supplier_name,
        (SELECT GROUP_CONCAT(
           CONCAT(COALESCE(m.name, i.material_name, ''), ' ', COALESCE(m.unit, i.unit, ''), ' ×', i.qty)
           SEPARATOR '；')
         FROM outbound_item i LEFT JOIN material m ON i.material_id = m.id WHERE i.order_id = o.id) AS items_summary
      FROM outbound_order o
      LEFT JOIN customer c ON o.customer_id = c.id
      LEFT JOIN supplier s ON o.supplier_id = s.id
      ORDER BY o.id DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 出库单明细（兼容原料批次与成品物料）
router.get('/:id/items', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*,
              COALESCE(m.name, i.material_name) AS material_name,
              COALESCE(m.code, i.material_code) AS material_code,
              COALESCE(m.unit, i.unit) AS unit,
              b.category_id AS batch_category_id, cat.name AS category_name
       FROM outbound_item i
       LEFT JOIN material m ON i.material_id = m.id
       LEFT JOIN raw_stock_batch b ON i.batch_id = b.id
       LEFT JOIN raw_category cat ON b.category_id = cat.id
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
      if (it.batch_id) {
        // 原料批次出库：冗余名称/编号/单位/大类，审核时按批次扣减
        const [batches] = await conn.query(
          'SELECT material_name, material_code, unit, category_id FROM raw_stock_batch WHERE id = ?',
          [it.batch_id]
        );
        if (!batches.length) {
          await conn.rollback();
          return res.status(400).json({ error: '原料批次不存在或已被删除' });
        }
        const b = batches[0];
        await conn.query(
          `INSERT INTO outbound_item (order_id, batch_id, category_id, material_name, material_code, unit, qty, unit_price, amount, remark)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [r.insertId, it.batch_id, b.category_id, b.material_name, b.material_code, b.unit, it.qty, it.unit_price, it.amount, it.remark || null]
        );
      } else {
        // 成品出库：沿用 material_id
        if (!it.material_id) {
          await conn.rollback();
          return res.status(400).json({ error: '出库明细需选择成品物料或原料批次' });
        }
        await conn.query(
          `INSERT INTO outbound_item (order_id, material_id, qty, unit_price, amount, remark)
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
      const [orders] = await pool.query('SELECT * FROM outbound_order WHERE id = ?', [req.params.id]);
      if (!orders.length) return res.status(404).json({ error: '单据不存在' });
      const order = orders[0];
      if (order.status !== 'draft') return res.status(400).json({ error: '仅草稿单可提交' });
      // 先置 pending，复用既有审核入账事务（其内部 pending -> done 并变动库存）
      await pool.query("UPDATE outbound_order SET status = 'pending' WHERE id = ? AND status = 'draft'", [order.id]);
      const [items] = await pool.query('SELECT * FROM outbound_item WHERE order_id = ?', [order.id]);
      await applyOutboundAudit(order, items, { id: req.user.sub, real_name: req.user.real_name });
      return res.json({ ok: true, status: 'done', auditSkipped: true });
    }
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

export default router;
