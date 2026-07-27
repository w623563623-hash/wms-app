import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRoutes from './routes/auth.js';
import materialRoutes from './routes/materials.js';
import partnerRoutes from './routes/partners.js';
import inboundRoutes from './routes/inbound.js';
import outboundRoutes from './routes/outbound.js';
import stockRoutes from './routes/stock.js';
import categoryRoutes from './routes/categories.js';
import invoiceRoutes from './routes/invoices.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api', authRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/inbound', inboundRoutes);
app.use('/api/outbound', outboundRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/invoices', invoiceRoutes);

// 静态前端
app.use(express.static(path.join(__dirname, '..', 'public')));

// 统一错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

export default app;
