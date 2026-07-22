# WMS 后端 + 前端 单镜像部署（CloudBase 云托管 容器模式）
FROM node:18-alpine

WORKDIR /app

# 先装依赖，利用层缓存
COPY package.json ./
RUN npm install --production

# 复制源码
COPY . .

EXPOSE 3000
CMD ["node", "src/server.js"]
