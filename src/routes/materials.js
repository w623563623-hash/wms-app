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
// code 可省略：省略时按自增 id 生成 FG#### 编号（如 FG0001）
router.post('/', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const { code, name, spec, type, unit, safety_stock, ref_price } = req.body || {};
    if (!name || !type || !unit) {
      return res.status(400).json({ error: '名称/类型/单位必填' });
    }
    const inputCode = code && String(code).trim() ? String(code).trim() : '';
    const conn = await pool.getConnection();
    try {
      const [result] = await conn.query(
        `INSERT INTO material (code, name, spec, type, unit, safety_stock, ref_price)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [inputCode, name, spec || null, type, unit, safety_stock || 0, ref_price || null]
      );
      let finalCode = inputCode;
      if (!finalCode) {
        finalCode = 'FG' + String(result.insertId).padStart(4, '0');
        await conn.query('UPDATE material SET code = ? WHERE id = ?', [finalCode, result.insertId]);
      }
      res.json({ id: result.insertId, code: finalCode });
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除物料（软删 status=0，admin / inout 可维护）
router.delete('/:id', requireRole('admin', 'inout'), async (req, res) => {
  try {
    await pool.query('UPDATE material SET status = 0 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
