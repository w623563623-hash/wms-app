import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { pool } from '../db.js';

const router = Router();
router.use(authMiddleware);

// 实时库存：成品（按物料结存）+ 原料（按批次结存）
router.get('/', async (req, res) => {
  try {
    const [finished] = await pool.query(`
      SELECT s.material_id, m.code, m.name, m.spec, m.type, m.unit, m.safety_stock,
             s.qty, s.amount,
             CASE WHEN s.qty <= m.safety_stock THEN 1 ELSE 0 END AS low_stock,
             'finished' AS kind, NULL AS production_date, NULL AS expiry_date, NULL AS category_id
      FROM stock s
      JOIN material m ON s.material_id = m.id
      ORDER BY m.type, m.code`);
    const [raw] = await pool.query(`
      SELECT id AS batch_id, material_code AS code, material_name AS name, NULL AS spec,
             'raw' AS type, unit, NULL AS safety_stock,
             qty, amount, 0 AS low_stock, 'raw' AS kind,
             production_date, expiry_date, category_id
      FROM raw_stock_batch
      ORDER BY material_name, production_date`);
    res.json([...finished, ...raw]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 库存变动流水：成品流水 + 原料批次流水，按时间倒序
router.get('/flow', async (req, res) => {
  try {
    const [f] = await pool.query(`
      SELECT f.id, f.order_no, f.biz_type, m.name AS material_name, m.code AS material_code,
             f.change_qty, f.balance_qty, f.operator_name, f.created_at, 'finished' AS kind
      FROM stock_flow f
      JOIN material m ON f.material_id = m.id`);
    const [rf] = await pool.query(`
      SELECT id, order_no, biz_type, material_name, material_code,
             change_qty, balance_qty, operator_name, created_at, 'raw' AS kind
      FROM raw_stock_flow`);
    const merged = [...f, ...rf]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 200);
    res.json(merged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
