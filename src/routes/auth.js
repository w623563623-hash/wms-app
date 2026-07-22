import { Router } from 'express';
import { verifyPassword, signToken, authMiddleware } from '../auth.js';
import { pool } from '../db.js';

const router = Router();

// 登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    const user = await verifyPassword(username, password);
    if (!user) return res.status(401).json({ error: '用户名或密码错误' });
    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        real_name: user.real_name,
        role: user.role,
      },
    });
  } catch (err) {
    res.status(500).json({ error: '登录失败：' + err.message });
  }
});

// 当前用户信息
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

export default router;
