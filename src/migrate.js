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

    console.log('[migrate] 数据库结构已是最新');
  } finally {
    conn.release();
  }
}
