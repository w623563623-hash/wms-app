import { pool } from './db.js';

// 辅助：判断列是否存在
async function colExists(conn, table, col) {
  const [rows] = await conn.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, col]
  );
  return rows.length > 0;
}

// 辅助：判断列是否 NOT NULL
async function isNotNull(conn, table, col) {
  const [rows] = await conn.query(
    `SELECT is_nullable FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, col]
  );
  return rows.length > 0 && rows[0].IS_NULLABLE === 'NO';
}

// 幂等迁移：在应用启动时执行，兼容 CloudBase MySQL 与本地 docker
export async function migrate() {
  const conn = await pool.getConnection();
  try {
    // 1) 原料大类（档案简化为：编号/大类名称/规格）
    await conn.query(`CREATE TABLE IF NOT EXISTS raw_category (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      code VARCHAR(32) NOT NULL,
      name VARCHAR(100) NOT NULL,
      spec VARCHAR(100) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_code (code)
    ) COMMENT='原料大类(简化档案:编号/名称/规格)'`);

    // 2) 原料批次库存（按批次独立结存）
    await conn.query(`CREATE TABLE IF NOT EXISTS raw_stock_batch (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      category_id BIGINT DEFAULT NULL,
      material_name VARCHAR(100) NOT NULL,
      material_code VARCHAR(32) DEFAULT NULL,
      unit VARCHAR(10) DEFAULT NULL,
      production_date DATE DEFAULT NULL,
      expiry_date DATE DEFAULT NULL,
      qty DECIMAL(18,3) DEFAULT 0,
      amount DECIMAL(18,2) DEFAULT 0,
      inbound_order_id BIGINT DEFAULT NULL,
      inbound_item_id BIGINT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_batch (category_id, material_name, production_date, expiry_date),
      KEY idx_cat (category_id)
    ) COMMENT='原料批次库存(按大类+名称+生产/有效期批次)'`);

    // 3) 原料批次流水
    await conn.query(`CREATE TABLE IF NOT EXISTS raw_stock_flow (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      order_no VARCHAR(32) DEFAULT NULL,
      biz_type VARCHAR(10) DEFAULT NULL,
      category_id BIGINT DEFAULT NULL,
      material_name VARCHAR(100) DEFAULT NULL,
      material_code VARCHAR(32) DEFAULT NULL,
      change_qty DECIMAL(18,3) DEFAULT 0,
      change_amount DECIMAL(18,2) DEFAULT 0,
      balance_qty DECIMAL(18,3) DEFAULT 0,
      balance_amount DECIMAL(18,2) DEFAULT 0,
      production_date DATE DEFAULT NULL,
      expiry_date DATE DEFAULT NULL,
      operator_id BIGINT DEFAULT NULL,
      operator_name VARCHAR(50) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      KEY idx_order (order_no)
    ) COMMENT='原料批次库存变动流水'`);

    // 4) inbound_item 扩展：原料批次字段 + material_id 可空
    if (await isNotNull(conn, 'inbound_item', 'material_id')) {
      await conn.query(`ALTER TABLE inbound_item MODIFY material_id BIGINT NULL`);
    }
    const addCols = [
      ['category_id', 'BIGINT NULL'],
      ['material_name', 'VARCHAR(100) NULL'],
      ['material_code', 'VARCHAR(32) NULL'],
      ['production_date', 'DATE NULL'],
      ['expiry_date', 'DATE NULL'],
      ['unit', 'VARCHAR(10) NULL'],
    ];
    for (const [col, def] of addCols) {
      if (!(await colExists(conn, 'inbound_item', col))) {
        await conn.query(`ALTER TABLE inbound_item ADD COLUMN \`${col}\` ${def}`);
      }
    }

    // 5) 示例大类（仅当为空时灌入，避免覆盖用户数据）
    const [cnt] = await conn.query('SELECT COUNT(*) AS c FROM raw_category');
    if (cnt[0].c === 0) {
      await conn.query(
        `INSERT INTO raw_category (code, name, spec) VALUES
         ('RC0001', '金属板材', '1.2mm'),
         ('RC0002', '塑料粒子', 'PE'),
         ('RC0003', '电子元件', 'SMD')`
      );
    }

    // 6) 供应商/客户补充「税号」列（开票单位精确匹配用）
    for (const t of ['supplier', 'customer']) {
      if (!(await colExists(conn, t, 'tax_no'))) {
        await conn.query(`ALTER TABLE \`${t}\` ADD COLUMN tax_no VARCHAR(30) NULL COMMENT '纳税人识别号/统一社会信用代码'`);
      }
    }

    // 7) 发票表（上传解析 + 开票单位匹配）
    // 兼容旧版发票表（字段结构不兼容，且无 is_deleted 列）：检测到旧结构则重建
    const [invOk] = await conn.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'invoice' AND column_name = 'is_deleted' LIMIT 1`
    );
    if (invOk.length === 0) {
      await conn.query('DROP TABLE IF EXISTS invoice');
    }
    await conn.query(`CREATE TABLE IF NOT EXISTS invoice (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      invoice_no VARCHAR(30) DEFAULT NULL COMMENT '发票号码',
      invoice_type VARCHAR(10) DEFAULT NULL COMMENT 'purchase=进项/sale=销项',
      invoice_kind VARCHAR(30) DEFAULT NULL COMMENT '发票种类(专票/普票/数电票/机动车...)',
      billing_name VARCHAR(120) DEFAULT NULL COMMENT '开票单位名称(销售方)',
      billing_tax_no VARCHAR(30) DEFAULT NULL COMMENT '开票单位税号',
      billing_unit_id BIGINT DEFAULT NULL COMMENT '匹配到的 partner id(supplier/customer)',
      partner_type VARCHAR(10) DEFAULT NULL COMMENT 'supplier/customer(往来单位类型)',
      partner_name VARCHAR(120) DEFAULT NULL COMMENT '往来单位名称',
      expense_type VARCHAR(40) DEFAULT NULL COMMENT '费用类型',
      amount_ex_tax DECIMAL(18,2) DEFAULT 0 COMMENT '金额(不含税)',
      tax_amount DECIMAL(18,2) DEFAULT 0 COMMENT '税额',
      amount_incl_tax DECIMAL(18,2) DEFAULT 0 COMMENT '价税合计',
      invoice_date DATE DEFAULT NULL COMMENT '开票日期',
      file_data MEDIUMTEXT COMMENT 'PDF base64 原文(预览/下载)',
      file_name VARCHAR(120) DEFAULT NULL COMMENT '原文件名',
      status VARCHAR(10) DEFAULT 'confirmed' COMMENT 'confirmed/draft',
      confidence JSON DEFAULT NULL COMMENT '各字段置信度等级记录',
      confidence_level VARCHAR(20) DEFAULT NULL COMMENT '整体 high/medium/low/reimbursement',
      operator_id BIGINT DEFAULT NULL,
      operator_name VARCHAR(50) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_deleted TINYINT DEFAULT 0,
      KEY idx_type (invoice_type),
      KEY idx_date (invoice_date),
      KEY idx_deleted (is_deleted)
    ) COMMENT='发票管理(上传解析+开票单位匹配)'`);

    // 8.5) outbound_item 扩展：支持原料批次出库（batch_id + 冗余字段），material_id 可空
    if (await isNotNull(conn, 'outbound_item', 'material_id')) {
      await conn.query(`ALTER TABLE outbound_item MODIFY material_id BIGINT NULL`);
    }
    const addOutCols = [
      ['batch_id', 'BIGINT NULL'],
      ['category_id', 'BIGINT NULL'],
      ['material_name', 'VARCHAR(100) NULL'],
      ['material_code', 'VARCHAR(32) NULL'],
      ['unit', 'VARCHAR(10) NULL'],
    ];
    for (const [col, def] of addOutCols) {
      if (!(await colExists(conn, 'outbound_item', col))) {
        await conn.query(`ALTER TABLE outbound_item ADD COLUMN \`${col}\` ${def}`);
      }
    }

    // 8.6) 原料批次 + 入库明细：保质期字段（有效期按保质期换算，可空）
    for (const t of ['raw_stock_batch', 'inbound_item']) {
      if (!(await colExists(conn, t, 'shelf_life_value'))) {
        await conn.query(`ALTER TABLE \`${t}\` ADD COLUMN shelf_life_value INT NULL COMMENT '保质期数值'`);
      }
      if (!(await colExists(conn, t, 'shelf_life_unit'))) {
        await conn.query(`ALTER TABLE \`${t}\` ADD COLUMN shelf_life_unit ENUM('year','month','day') NULL COMMENT '保质期单位 year/month/day'`);
      }
    }

    // 8) 财务设置（本公司名称/税号，销项判断参考 + 上传方信息）
    await conn.query(`CREATE TABLE IF NOT EXISTS finance_setting (
      id INT PRIMARY KEY AUTO_INCREMENT,
      self_company_name VARCHAR(120) DEFAULT NULL COMMENT '本公司名称',
      self_company_taxno VARCHAR(30) DEFAULT NULL COMMENT '本公司税号',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) COMMENT='财务设置'`);

    console.log('[migrate] 数据库结构已是最新');
  } finally {
    conn.release();
  }
}
