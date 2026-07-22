import app from './app.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`WMS 后端已启动: http://localhost:${config.port}`);
  console.log(`数据库: ${config.db.host}:${config.db.port}/${config.db.database}`);
});
