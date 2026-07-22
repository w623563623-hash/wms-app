import app from './app.js';
import { config } from './config.js';
import { migrate } from './migrate.js';

migrate()
  .catch((e) => console.error('[migrate] 迁移失败:', e.message))
  .finally(() => {
    app.listen(config.port, () => {
      console.log(`WMS 后端已启动: http://localhost:${config.port}`);
      console.log(`数据库: ${config.db.host}:${config.db.port}/${config.db.database}`);
    });
  });
