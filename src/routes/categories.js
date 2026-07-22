import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';

const router = Router();
router.use(authMiddleware);

// 原料大类列表
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM raw_category ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新增大类（编号 RC#### 自动生成）
router.post('/', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const { name, spec } = req.body || {};
    if (!name) return res.status(400).json({ error: '大类名称必填' });
    const conn = await pool.getConnection();
    try {
      const [r] = await conn.query(
        'INSERT INTO raw_category (code, name, spec) VALUES (?, ?, ?)',
        ['', name, spec || null]
      );
      const code = 'RC' + String(r.insertId).padStart(4, '0');
      await conn.query('UPDATE raw_category SET code = ? WHERE id = ?', [code, r.insertId]);
      res.json({ id: r.insertId, code });
    } finally {
      conn.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 编辑大类
router.put('/:id', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const { name, spec } = req.body || {};
    if (!name) return res.status(400).json({ error: '大类名称必填' });
    await pool.query('UPDATE raw_category SET name = ?, spec = ? WHERE id = ?', [
      name,
      spec || null,
      req.params.id,
    ]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除大类
router.delete('/:id', requireRole('admin', 'inout'), async (req, res) => {
  try {
    await pool.query('DELETE FROM raw_category WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
