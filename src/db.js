import mysql from 'mysql2/promise';
import { config } from './config.js';

// 连接池：CloudBase MySQL 走内网/外网地址，连接参数全部来自环境变量。
// 针对 Serverless MySQL 空闲自动 pause 的特性做加固：
//  - enableKeepAlive：TCP keepalive，避免中间件静默断开
//  - idleTimeout / maxIdle：空闲连接定时回收重建，杜绝长期持有死连接
const pool = mysql.createPool({
  ...config.db,
  enableKeepAlive: true,
  connectionLimit: 10,
  connectTimeout: 10000,
  maxIdle: 5,
  idleTimeout: 300000,
});

// Serverless MySQL 空闲一段时间会自动 pause，导致连接池里的旧连接变为死连接
// （前端表现就是偶发 ECONNRESET / "read ECONNRESET"）。用一条极轻的保活查询
// 让实例持续保持活跃、不进入 pause；即使偶发断连，mysql2 也会自动剔除死连接。
const keepAlive = setInterval(() => {
  pool.query('SELECT 1').catch(() => {});
}, 60000);
// 不阻止进程退出
if (typeof keepAlive.unref === 'function') keepAlive.unref();

// 判断是否为"连接层"错误（这类错误下连接已失效，可安全重试——事务尚未提交，重试不会产生副作用）
function isConnLost(err) {
  if (!err) return false;
  const code = err.code || '';
  if (['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ECONNREFUSED', 'ETIMEDOUT', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'].includes(code)) {
    return true;
  }
  return /connection.*closed|server has gone away|broken pipe/i.test(err.message || '');
}

export async function query(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (err) {
    if (isConnLost(err)) {
      // 死连接已被连接池自动剔除，重试一次会建立新连接
      const [rows] = await pool.query(sql, params);
      return rows;
    }
    throw err;
  }
}

export async function transaction(fn) {
  let conn;
  try {
    conn = await pool.getConnection();
  } catch (err) {
    if (isConnLost(err)) {
      conn = await pool.getConnection(); // 重试取连接
    } else {
      throw err;
    }
  }
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => {});
    // 若失败由连接丢失引起，用全新连接整体重试一次（事务未提交，安全）
    if (isConnLost(err)) {
      const conn2 = await pool.getConnection();
      try {
        await conn2.beginTransaction();
        const result = await fn(conn2);
        await conn2.commit();
        return result;
      } catch (e2) {
        await conn2.rollback().catch(() => {});
        throw e2;
      } finally {
        conn2.release();
      }
    }
    throw err;
  } finally {
    conn.release();
  }
}

export { pool };
