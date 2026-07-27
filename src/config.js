import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT || 3000),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  // 审核流程开关：默认开启；设为 false 时提交单据直接入账生效（库存当场变动），无需财务审核
  auditEnabled: process.env.WMS_AUDIT_ENABLED !== 'false',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'wms',
    charset: 'utf8mb4',
    // CloudBase MySQL 内网连接一般无需 SSL；若连接被拒，设 DB_SSL=true 重试
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 10,
    waitForConnections: true,
  },
};
