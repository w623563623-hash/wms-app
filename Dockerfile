# WMS 后端 + 前端 单镜像部署（CloudBase 云托管 容器模式）
FROM node:18-alpine

WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json ./
RUN npm install --production

# 复制源码
COPY . .

EXPOSE 3000
# 审核流程开关：默认关闭（WMS_AUDIT_ENABLED=false）；在 CloudBase 控制台将该环境变量设为 true 即可恢复审核
CMD ["sh", "-c", "WMS_AUDIT_ENABLED=${WMS_AUDIT_ENABLED:-false} node src/server.js"]
