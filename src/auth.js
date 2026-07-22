import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool } from './db.js';
import { config } from './config.js';

const ROLES = ['admin', 'inout', 'packer', 'finance'];

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      real_name: user.real_name,
    },
    config.jwtSecret,
    { expiresIn: '8h' }
  );
}

// 真实登录：比对 wms_user 表中的 bcrypt 哈希
export async function verifyPassword(username, password) {
  const [rows] = await pool.query(
    'SELECT * FROM wms_user WHERE username = ? AND status = 1',
    [username]
  );
  if (!rows.length) return null;
  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return null;
  return user;
}

// 鉴权中间件：校验 Bearer Token
export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  try {
    req.user = jwt.verify(header.slice(7), config.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: '登录已过期，请重新登录' });
  }
}

// 角色网关：仅允许指定角色访问
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '当前角色无此操作权限' });
    }
    next();
  };
}

export { ROLES };
