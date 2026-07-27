import { Router } from 'express';
import { authMiddleware, requireRole } from '../auth.js';
import { pool } from '../db.js';
import { analyzeInvoice } from '../service/invoiceParse.js';

const router = Router();
router.use(authMiddleware);

function safeParse(j) {
  if (!j) return null;
  if (typeof j === 'object') return j;
  try { return JSON.parse(j); } catch { return null; }
}

// 解析 PDF：返回字段 + 开票单位匹配结果（不落库）
router.post('/parse', async (req, res) => {
  try {
    const { file, fileName } = req.body || {};
    if (!file) return res.status(400).json({ error: '缺少 PDF 文件' });
    if (typeof file !== 'string' || file.length < 100) {
      return res.status(400).json({ error: 'PDF 内容无效' });
    }
    const result = await analyzeInvoice(file);
    res.json({ result, fileName: fileName || null });
  } catch (err) {
    console.error('[invoice/parse]', err);
    res.status(500).json({ error: '解析失败：' + err.message });
  }
});

// 入库（携带最终确认/修正字段 + PDF base64）
router.post('/', requireRole('admin', 'finance', 'inout'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.file) return res.status(400).json({ error: '缺少 PDF 文件' });
    if (!b.invoice_no) return res.status(400).json({ error: '发票号必填' });

    const conn = await pool.getConnection();
    try {
      const [r] = await conn.query(
        `INSERT INTO invoice (
          invoice_no, invoice_type, invoice_kind,
          billing_name, billing_tax_no, billing_unit_id, partner_type, partner_name,
          expense_type, amount_ex_tax, tax_amount, amount_incl_tax, invoice_date,
          file_data, file_name, status, confidence, confidence_level,
          operator_id, operator_name
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          b.invoice_no, b.invoice_type || null, b.invoice_kind || null,
          b.billing_name || null, b.billing_tax_no || null, b.billing_unit_id || null,
          b.partner_type || null, b.partner_name || null,
          b.expense_type || null,
          b.amount_ex_tax || 0, b.tax_amount || 0, b.amount_incl_tax || 0,
          b.invoice_date || null,
          b.file, b.fileName || null, b.status || 'confirmed',
          JSON.stringify(b.confidence || {}), b.confidence_level || null,
          req.user.sub || req.user.id, req.user.real_name || req.user.username,
        ]
      );
      // 操作日志
      await conn.query(
        'INSERT INTO operation_log (user_id, user_name, action, target) VALUES (?,?,?,?)',
        [req.user.sub || req.user.id, req.user.real_name || req.user.username, '上传发票', b.invoice_no]
      );
      res.json({ id: r.insertId });
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[invoice/create]', err);
    res.status(500).json({ error: err.message });
  }
});

// 批量入账（报销单：一次传 PDF + 多行明细，循环插入）
// 按 invoice_no 去重：已存在的跳过，返回 {inserted, skipped, ids}
router.post('/batch', requireRole('admin', 'finance', 'inout'), async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.file) return res.status(400).json({ error: '缺少 PDF 文件' });
    if (!Array.isArray(b.rows) || !b.rows.length) return res.status(400).json({ error: '无明细行' });

    const conn = await pool.getConnection();
    const ids = [];
    let skipped = 0;
    try {
      await conn.beginTransaction();
      // 先查已存在的 invoice_no，构建去重集合
      const allNos = b.rows.map((r) => r.invoice_no).filter(Boolean);
      const [existing] = await conn.query(
        'SELECT invoice_no FROM invoice WHERE invoice_no IN (' + allNos.map(() => '?').join(',') + ')',
        allNos
      );
      const existSet = new Set(existing.map((r) => r.invoice_no));

      for (let i = 0; i < b.rows.length; i++) {
        const row = b.rows[i];
        if (!row.invoice_no) continue;
        // 去重：已存在的 invoice_no 跳过
        if (existSet.has(row.invoice_no)) { skipped++; continue; }
        // 报销单 PDF 仅存首条，避免 34 行各存 6MB（约 200MB 事务风险）；其余行 file_data 为空
        const fileData = i === 0 ? b.file : null;
        const fileName = i === 0 ? (b.fileName || null) : null;
        const [r] = await conn.query(
          `INSERT INTO invoice (
            invoice_no, invoice_type, invoice_kind,
            billing_name, billing_tax_no, billing_unit_id, partner_type, partner_name,
            expense_type, amount_ex_tax, tax_amount, amount_incl_tax, invoice_date,
            file_data, file_name, status, confidence, confidence_level,
            operator_id, operator_name
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [
            row.invoice_no, row.invoice_type || 'purchase', row.invoice_kind || null,
            row.billing_name || null, null, null, null, null,
            row.expense_type || null, 0, 0, Number(row.amount_incl_tax) || 0,
            row.invoice_date || null,
            fileData, fileName, 'confirmed',
            JSON.stringify({ source: 'reimbursement' }), 'reimbursement',
            req.user.sub || req.user.id, req.user.real_name || req.user.username,
          ]
        );
        await conn.query(
          'INSERT INTO operation_log (user_id, user_name, action, target) VALUES (?,?,?,?)',
          [req.user.sub || req.user.id, req.user.real_name || req.user.username, '批量导入报销单', row.invoice_no]
        );
        ids.push(r.insertId);
      }
      await conn.commit();
      res.json({ inserted: ids.length, skipped, ids });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error('[invoice/batch]', err);
    res.status(500).json({ error: err.message });
  }
});

// 列表（筛选 + 统计）
router.get('/', async (req, res) => {
  try {
    const { type, kind, month, q, page = 1, pageSize = 20 } = req.query;
    const where = ['is_deleted = 0'];
    const params = [];
    if (type) { where.push('invoice_type = ?'); params.push(type); }
    if (kind) { where.push('invoice_kind = ?'); params.push(kind); }
    if (month) { where.push('DATE_FORMAT(invoice_date, "%Y-%m") = ?'); params.push(month); }
    if (q) {
      where.push('(invoice_no LIKE ? OR billing_name LIKE ? OR partner_name LIKE ?)');
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const w = where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT * FROM invoice WHERE ${w} ORDER BY invoice_date DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, Number(pageSize), (Number(page) - 1) * Number(pageSize)]
    );
    const [c] = await pool.query(`SELECT COUNT(*) AS total FROM invoice WHERE ${w}`, params);
    const [stats] = await pool.query(
      `SELECT
        SUM(CASE WHEN invoice_type='purchase' THEN 1 ELSE 0 END) AS purchase_count,
        SUM(CASE WHEN invoice_type='sale' THEN 1 ELSE 0 END) AS sale_count,
        COALESCE(SUM(amount_incl_tax),0) AS total_amount,
        COALESCE(SUM(CASE WHEN invoice_type='purchase' THEN tax_amount ELSE 0 END),0) AS deductible_tax
       FROM invoice WHERE ${w}`,
      params
    );

    res.json({
      rows: rows.map((r) => ({ ...r, confidence: safeParse(r.confidence) })),
      total: c[0].total,
      stats: stats[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 详情
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM invoice WHERE id = ? AND is_deleted = 0', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: '发票不存在' });
    const r = rows[0];
    r.confidence = safeParse(r.confidence);
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 修正字段
router.put('/:id', requireRole('admin', 'finance', 'inout'), async (req, res) => {
  try {
    const b = req.body || {};
    const colMap = {
      invoice_no: 'invoice_no', invoice_type: 'invoice_type', invoice_kind: 'invoice_kind',
      billing_name: 'billing_name', billing_tax_no: 'billing_tax_no', billing_unit_id: 'billing_unit_id',
      partner_type: 'partner_type', partner_name: 'partner_name', expense_type: 'expense_type',
      amount_ex_tax: 'amount_ex_tax', tax_amount: 'tax_amount', amount_incl_tax: 'amount_incl_tax',
      invoice_date: 'invoice_date', confidence_level: 'confidence_level',
    };
    const sets = [];
    const params = [];
    for (const [k, col] of Object.entries(colMap)) {
      if (b[k] !== undefined) { sets.push(`${col} = ?`); params.push(b[k]); }
    }
    if (b.confidence !== undefined) { sets.push('confidence = ?'); params.push(JSON.stringify(b.confidence)); }
    if (!sets.length) return res.json({ ok: true });
    params.push(req.params.id);
    await pool.query(`UPDATE invoice SET ${sets.join(', ')} WHERE id = ?`, params);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 软删
router.delete('/:id', requireRole('admin', 'finance'), async (req, res) => {
  try {
    await pool.query('UPDATE invoice SET is_deleted = 1 WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 供应商/客户列表（供前端开票单位匹配下拉用）
router.get('/partners/all', async (req, res) => {
  try {
    const [sup] = await pool.query('SELECT id, name, tax_no, "supplier" AS type FROM supplier WHERE status = 1');
    const [cus] = await pool.query('SELECT id, name, tax_no, "customer" AS type FROM customer WHERE status = 1');
    res.json([...sup, ...cus]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
