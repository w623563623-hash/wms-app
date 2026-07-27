// 发票解析与开票单位匹配（纯函数服务层，不依赖 Express / DB / 连接池）
// 设计原则：PDF 文本提取 与 字段正则提取 分离，便于用真实电子发票文本单独联调正则逻辑。

import { pool } from '../db.js';

// ===== 1) PDF 文本提取 =====
async function extractTextFromPdf(base64) {
  const pdfParse = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const buffer = Buffer.from(base64, 'base64');
  const data = await pdfParse(buffer);
  return data.text || '';
}

// ===== 2) 工具函数 =====
function cleanNum(s) {
  if (!s) return null;
  const n = Number(String(s).replace(/[¥￥,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function firstMatch(text, patterns) {
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[1] != null) return m[1].trim();
  }
  return null;
}

// 从"关键词"所在行提取其后的金额数字（跳过关键词本身）
function findAmount(text, keywords) {
  const lines = text.split('\n');
  for (const line of lines) {
    for (const kw of keywords) {
      if (line.includes(kw) && !line.includes('价税合计') && !line.includes('大写')) {
        const m = line.match(/[¥￥]?\s*([\d,]+\.?\d*)/);
        if (m) return cleanNum(m[1]);
      }
    }
  }
  // 整段 fallback：关键词后最近的数字
  for (const kw of keywords) {
    const m = text.match(new RegExp(kw + '\\s*[:：]?[¥￥]?\\s*([\\d,]+\\.?\\d*)'));
    if (m) return cleanNum(m[1]);
  }
  return null;
}

// ===== 3) 字段正则提取（纯函数，输入 PDF 文本）=====
export function extractInvoiceFields(text) {
  const t = (text || '').replace(/\r/g, '');

  // 发票号码：优先「发票号码」后 8-20 位（排除 12 位发票代码）
  let invoiceNo = firstMatch(t, [
    /发票号码\s*[:：]?\s*([0-9]{15,20})/,
    /发票号码\s*[:：]?\s*([0-9]{8,12})/,
    /(?:No\.?|发票号)\s*[:：]?\s*([0-9]{8,20})/i,
  ]);

  // 开票日期
  const dateRaw = firstMatch(t, [
    /开票日期\s*[:：]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})/,
    /开票日期\s*[:：]?\s*(\d{4}年\d{1,2}月\d{1,2}日)/,
  ]);
  let invoiceDate = null;
  if (dateRaw) {
    const m = dateRaw.match(/(\d{4}).*?(\d{1,2}).*?(\d{1,2})/);
    if (m) {
      const y = m[1];
      const mo = String(m[2]).padStart(2, '0');
      const d = String(m[3]).padStart(2, '0');
      invoiceDate = `${y}-${mo}-${d}`;
    }
  }

  // 销售方（开票单位）
  const billingName = firstMatch(t, [
    /销售方名称\s*[:：]?\s*([^\n（(]+)/,
    /销售方\s*[:：]?\s*([^\n（(]+)/,
  ])?.replace(/[（(].*$/, '').trim() || null;

  const billingTaxNo = firstMatch(t, [
    /销售方[\s\S]{0,40}?纳税人识别号\s*[:：]?\s*([0-9A-Z]{15,20})/,
    /销售方[\s\S]{0,40}?统一社会信用代码\s*[:：]?\s*([0-9A-Z]{18})/,
  ]);

  // 购买方
  const buyerName = firstMatch(t, [
    /购买方名称\s*[:：]?\s*([^\n（(]+)/,
    /购买方\s*[:：]?\s*([^\n（(]+)/,
  ])?.replace(/[（(].*$/, '').trim() || null;
  const buyerTaxNo = firstMatch(t, [
    /购买方[\s\S]{0,40}?纳税人识别号\s*[:：]?\s*([0-9A-Z]{15,20})/,
    /购买方[\s\S]{0,40}?统一社会信用代码\s*[:：]?\s*([0-9A-Z]{18})/,
  ]);

  // 三金额
  const amountInclTax = findAmount(t, ['价税合计']) || findAmount(t, ['（小写）', '小写']) || findAmount(t, ['合计']);
  const taxAmount = findAmount(t, ['税额']);
  // 金额（不含税）：避开「价税合计」，优先带「金额」且同行无「税」的行
  let amountExTax = null;
  const lines = t.split('\n');
  for (const line of lines) {
    if (line.includes('金额') && !line.includes('价税合计') && !line.includes('税额') && !line.includes('大写')) {
      const m = line.match(/[¥￥]?\s*([\d,]+\.?\d*)/);
      if (m) { amountExTax = cleanNum(m[1]); break; }
    }
  }
  if (amountExTax == null) amountExTax = findAmount(t, ['不含税金额', '金额']);

  // 发票种类（关键词）
  let invoiceKind = null;
  if (/机动车销售统一发票/.test(t)) invoiceKind = '机动车销售统一发票';
  else if (/增值税专用发票/.test(t)) invoiceKind = '增值税专用发票';
  else if (/增值税普通发票/.test(t)) invoiceKind = '增值税普通发票';
  else if (/数电专票|电子专用发票/.test(t)) invoiceKind = '数电专用发票';
  else if (/数电普票|电子普通发票/.test(t)) invoiceKind = '数电普通发票';
  else if (/海关进口增值税/.test(t)) invoiceKind = '海关进口增值税缴款书';

  // 费用类型（关键词映射，作用于文本整体 + 开票单位名）
  const expenseType = mapExpenseType(t + ' ' + (billingName || ''));

  return {
    invoice_no: invoiceNo,
    invoice_date: invoiceDate,
    billing_name: billingName,
    billing_tax_no: billingTaxNo,
    buyer_name: buyerName,
    buyer_tax_no: buyerTaxNo,
    amount_ex_tax: amountExTax,
    tax_amount: taxAmount,
    amount_incl_tax: amountInclTax,
    invoice_kind: invoiceKind,
    expense_type: expenseType,
  };
}

// 费用类型关键词映射
function mapExpenseType(text) {
  const map = [
    [/运输|物流|快递|货运|配送/, '运输费'],
    [/招待|餐饮|餐费|用餐/, '业务招待费'],
    [/差旅|住宿|酒店|机票|车票/, '差旅费'],
    [/广告|推广|宣传|营销/, '广告费'],
    [/办公|文具|耗材|打印/, '办公费'],
    [/水电|物业|房租|租赁/, '物业费'],
    [/仓储|仓租|存货/, '仓储费'],
    [/咨询|顾问|服务/, '服务费'],
    [/维修|维护|保养/, '维修费'],
    [/软件|系统|SAAS|saas|订阅/, '软件费'],
    [/通讯|电话|宽带/, '通讯费'],
    [/燃料|油费|加油/, '油费'],
  ];
  for (const [re, label] of map) if (re.test(text)) return label;
  return null;
}

// ===== 报销单明细解析（增强：支持"报销单汇总"PDF）=====
// 报销单文字层格式：序号 + 费用类型 + 日期(YYYY年M月D日) + 金额(2位小数) + 票据号码(15~20位)
// 少数行因排版换行断裂，故先合并换行再整体匹配
function mapReimbExpenseType(raw) {
  const map = {
    '物流': '运输费',
    '餐饮': '业务招待费',
    '商品': '办公费',
    '服务': '服务费',
    '交通': '差旅费',
    '住宿': '差旅费',
    '医疗': '福利费',
    '医药': '福利费',
  };
  return map[raw] || null;
}

export function extractReimbursementRows(text) {
  // 合并所有换行，修复"11\n商品\n2026年...\n1122.32..."断裂行
  const t = (text || '').replace(/\r/g, '').replace(/\n/g, '');
  const types = '物流|餐饮|商品|服务|交通|住宿|医疗|医药';
  // 金额用 \.\d{1,2} 限定 2 位小数，避免贪婪吞掉后续 20 位票据号
  const re = new RegExp(
    '(\\d{1,3})(' + types + ')(\\d{4}年\\d{1,2}月\\d{1,2}日)(\\d+\\.\\d{1,2})(\\d{15,20})',
    'g'
  );
  const rows = [];
  let m;
  while ((m = re.exec(t)) !== null) {
    const seq = parseInt(m[1], 10);
    const expenseRaw = m[2];
    const dateRaw = m[3];
    const amount = cleanNum(m[4]);
    const invoiceNo = m[5];
    const dm = dateRaw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const invoiceDate = dm
      ? `${dm[1]}-${String(dm[2]).padStart(2, '0')}-${String(dm[3]).padStart(2, '0')}`
      : null;
    rows.push({
      seq,
      expense_type_raw: expenseRaw,
      expense_type: mapReimbExpenseType(expenseRaw),
      invoice_date: invoiceDate,
      amount_incl_tax: amount,
      invoice_no: invoiceNo,
    });
  }
  return rows;
}

// ===== 4) 开票单位匹配 partner =====
// partners: [{id, name, tax_no, type:'supplier'|'customer'}]
export function matchPartner(name, taxNo, partners = []) {
  if (!partners.length) return { match: 'none', partnerId: null, partnerName: null, partnerType: null, candidates: [] };

  // 1) 税号精确
  if (taxNo) {
    const hit = partners.find((p) => p.tax_no && p.tax_no.toUpperCase() === String(taxNo).toUpperCase());
    if (hit) {
      return { match: 'exact', partnerId: hit.id, partnerName: hit.name, partnerType: hit.type, candidates: [] };
    }
  }
  // 2) 名称包含（双向，长度>3 才可信）
  const candidates = [];
  if (name && name.length > 3) {
    for (const p of partners) {
      const pn = (p.name || '').trim();
      if (!pn) continue;
      if (pn.includes(name) || name.includes(pn)) {
        const score = pn.length <= name.length
          ? pn.length / name.length
          : name.length / pn.length;
        candidates.push({ id: p.id, name: pn, type: p.type, score });
      }
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0];
    return { match: 'fuzzy', partnerId: top.id, partnerName: top.name, partnerType: top.type, candidates: candidates.slice(0, 5) };
  }
  return { match: 'none', partnerId: null, partnerName: null, partnerType: null, candidates: [] };
}

// ===== 5) 综合解析（主入口）=====
// 入参 base64 PDF；从 DB 查 partner 列表做匹配
export async function analyzeInvoice(base64) {
  const text = await extractTextFromPdf(base64);

  // 报销单模式优先：文字层含报销单表格且能提取到多条明细
  const reimbRows = extractReimbursementRows(text);
  if (reimbRows.length >= 2) {
    const total = reimbRows.reduce((s, r) => s + (Number(r.amount_incl_tax) || 0), 0);
    return {
      mode: 'reimbursement',
      count: reimbRows.length,
      total: Math.round(total * 100) / 100,
      rows: reimbRows,
      raw_text: text.slice(0, 2000),
    };
  }

  const fields = extractInvoiceFields(text);

  // 拉取 partner 列表（supplier + customer 合并）
  const [sup] = await pool.query('SELECT id, name, tax_no, "supplier" AS type FROM supplier WHERE status = 1');
  const [cus] = await pool.query('SELECT id, name, tax_no, "customer" AS type FROM customer WHERE status = 1');
  const partners = [...sup, ...cus].map((p) => ({ id: p.id, name: p.name, tax_no: p.tax_no, type: p.type }));

  const match = matchPartner(fields.billing_name, fields.billing_tax_no, partners);

  // 反推发票类型 / 往来单位
  let invoiceType = null;
  let invoiceTypeConf = 'low';
  let invoiceTypeSource = 'none';
  let partnerName = null;
  let partnerType = null;
  let partnerConf = 'low';

  if (match.match !== 'none') {
    partnerType = match.partnerType;
    partnerName = match.partnerName;
    partnerConf = match.match === 'exact' ? 'high' : 'medium';
    invoiceType = partnerType === 'supplier' ? 'purchase' : 'sale';
    invoiceTypeConf = match.match === 'exact' ? 'high' : 'medium';
    invoiceTypeSource = 'partner';
  }

  // 勾稽校验：若 不含税+税额≈价税合计，金额置信度 high
  let amountConf = 'high';
  if (fields.amount_ex_tax != null && fields.tax_amount != null && fields.amount_incl_tax != null) {
    const sum = fields.amount_ex_tax + fields.tax_amount;
    const diff = Math.abs(sum - fields.amount_incl_tax);
    if (diff > 1 && diff / fields.amount_incl_tax > 0.01) amountConf = 'medium';
  }

  // 整体置信度
  const level =
    match.match === 'exact' ? 'high'
      : match.match === 'fuzzy' ? 'medium'
        : 'low';

  return {
    mode: 'invoice',
    raw_text: text.slice(0, 2000),
    invoice_no: { value: fields.invoice_no, confidence: fields.invoice_no ? 'high' : 'low' },
    invoice_date: { value: fields.invoice_date, confidence: fields.invoice_date ? 'high' : 'low' },
    billing: {
      name: fields.billing_name,
      tax_no: fields.billing_tax_no,
      match: match.match,
      partner_id: match.partnerId,
      partner_name: match.partnerName,
      partner_type: match.partnerType,
      confidence: match.match === 'exact' ? 'high' : match.match === 'fuzzy' ? 'medium' : 'low',
      candidates: match.candidates || [],
    },
    invoice_type: { value: invoiceType, confidence: invoiceTypeConf, source: invoiceTypeSource },
    invoice_kind: { value: fields.invoice_kind, confidence: fields.invoice_kind ? 'medium' : 'low' },
    partner: { name: partnerName, type: partnerType, id: match.partnerId, confidence: partnerConf },
    expense_type: { value: fields.expense_type, confidence: fields.expense_type ? 'medium' : 'low' },
    amount_ex_tax: { value: fields.amount_ex_tax, confidence: amountConf },
    tax_amount: { value: fields.tax_amount, confidence: amountConf },
    amount_incl_tax: { value: fields.amount_incl_tax, confidence: amountConf },
    confidence_level: level,
  };
}

// 仅解析字段（不查库），供单测 / 用真实文本联调正则
export async function parsePdfText(text) {
  const fields = extractInvoiceFields(text);
  return { fields, match: matchPartner(fields.billing_name, fields.billing_tax_no, []) };
}
