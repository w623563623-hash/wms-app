import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';

const router = Router();
router.use(authMiddleware);

// 物料/产品列表
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT * FROM material WHERE status = 1 ORDER BY id DESC"
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新建物料/产品（admin / inout 可维护基础数据）
router.post('/', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const { code, name, spec, type, unit, safety_stock, ref_price } = req.body || {};
    if (!code || !name || !type || !unit) {
      return res.status(400).json({ error: '编码/名称/类型/单位必填' });
    }
    const [result] = await pool.query(
      `INSERT INTO material (code, name, spec, type, unit, safety_stock, ref_price)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [code, name, spec || null, type, unit, safety_stock || 0, ref_price || null]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
