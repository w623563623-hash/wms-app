import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';

const router = Router();
router.use(authMiddleware);

// 供应商列表
router.get('/suppliers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM supplier WHERE status = 1 ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 客户列表
router.get('/customers', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM customer WHERE status = 1 ORDER BY id DESC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新建供应商（admin / inout）
router.post('/suppliers', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const { code, name, contact, phone, address } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: '编码/名称必填' });
    const [result] = await pool.query(
      'INSERT INTO supplier (code, name, contact, phone, address) VALUES (?, ?, ?, ?, ?)',
      [code, name, contact || null, phone || null, address || null]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 新建客户（admin / inout）
router.post('/customers', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const { code, name, contact, phone, address } = req.body || {};
    if (!code || !name) return res.status(400).json({ error: '编码/名称必填' });
    const [result] = await pool.query(
      'INSERT INTO customer (code, name, contact, phone, address) VALUES (?, ?, ?, ?, ?)',
      [code, name, contact || null, phone || null, address || null]
    );
    res.json({ id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除供应商（软删 status=0，admin / inout）
router.delete('/suppliers/:id', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE supplier SET status = 0 WHERE id = ? AND status = 1',
      [req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: '供应商不存在或已删除' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 删除客户（软删 status=0，admin / inout）
router.delete('/customers/:id', requireRole('admin', 'inout'), async (req, res) => {
  try {
    const [result] = await pool.query(
      'UPDATE customer SET status = 0 WHERE id = ? AND status = 1',
      [req.params.id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: '客户不存在或已删除' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
