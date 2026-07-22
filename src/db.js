import mysql from 'mysql2/promise';
import { config } from './config.js';

// 连接池：CloudBase MySQL 走内网/外网地址，连接参数全部来自环境变量。
export const pool = mysql.createPool(config.db);

export async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
