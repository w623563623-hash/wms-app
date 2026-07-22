import { Router } from 'express';
import { authMiddleware } from '../auth.js';
import { pool } from '../db.js';

const router = Router();
router.use(authMiddleware);

// 实时库存（含安全库存预警）
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.material_id, m.code, m.name, m.spec, m.type, m.unit, m.safety_stock,
             s.qty, s.amount,
             CASE WHEN s.qty <= m.safety_stock THEN 1 ELSE 0 END AS low_stock
      FROM stock s
      JOIN material m ON s.material_id = m.id
      ORDER BY m.type, m.code`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 库存变动流水
router.get('/flow', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT f.*, m.code AS material_code, m.name AS material_name
      FROM stock_flow f
      JOIN material m ON f.material_id = m.id
      ORDER BY f.id DESC
      LIMIT 200`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
