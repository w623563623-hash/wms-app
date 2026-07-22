# 云仓储 WMS · 出入库管理后台（最小可用系统 MVP）

原料 / 成品的入库、出库、库存管理后台。4 角色线性审批（系统管理员 → 出入库管理员 → 打包出货管理员 → 财务），库存**仅在财务审核通过后**于事务内变动。

- 后端：Node + Express + MySQL（`mysql2`）
- 前端：原生 JS 单页（腾讯云控制台 TDesign 风格）
- 数据库：腾讯云 CloudBase MySQL（也可本地 docker-compose 起 MySQL 8）

## 角色与权限

| 角色 | 用户名 | 职责 |
|------|--------|------|
| 系统管理员 | `admin` | 全部菜单 + 强制取消/修正 |
| 出入库管理员 | `inout` | 制单、收货上架、拣货下架、提交审核 |
| 打包出货管理员 | `packer` | 仅成品出库(sale) 打包确认 + 填物流单号 |
| 财务 | `finance` | 四类单据审核（**审核通过后库存才变动**）|

默认密码：`Wms@2026`（bcrypt 哈希存储，上线前请改）。

## 审批 / 库存变动逻辑

```
出入库管理员制单(草稿) → 提交(待审核) → 财务审核通过(已审核, 库存+流水变动)
                                          └→ 驳回(已取消, 不动库存)
成品出库 已审核 → 打包出货管理员 打包确认(填物流单号, 不改库存)
```

- 入库：库存 `+qty`，写 `stock_flow`。
- 出库：`stock` 行锁 `FOR UPDATE` 防并发超卖；库存不足则整单回滚。
- 库存仅由 `status='done'` 的审核动作触发，杜绝未确认改账。

## 原料大类与原料批次管理

原料侧采用「大类档案 + 批次明细」模型，与成品（沿用原物料 `material` 表）相互独立、互不干扰。

### 数据模型

| 表 | 说明 |
|----|------|
| `raw_category` | 原料大类档案：`code`（自动生成 `RC0001` 起）、`name`（大类名称）、`spec`（规格）。 |
| `raw_stock_batch` | 原料批次库存，按 **`category_id + material_name + production_date + expiry_date`** 唯一键记账；字段含 `material_code`（自动生成 `RM+YYYYMMDD+4位随机`）、`qty`、`amount`、`incoming_date` 等。 |
| `raw_stock_flow` | 原料批次流水，每笔含 `change_qty / change_amount / balance_qty / balance_amount`，结存可追溯。 |
| `inbound_item` | 明细同时支持两种来源：成品走 `material_id`；原料走 `category_id + material_name`（自定义名称）+ `material_code`（自动）+ `production_date` + `expiry_date`，二者其一即可。 |

> 迁移脚本 `src/migrate.js` 在 `server.js` 启动时**幂等**执行：自动建上述表、给 `inbound_item` 扩充列，并在 `raw_category` 为空时灌入 3 条示例大类（金属板材 / 塑料粒子 / 电子元件）。

### 原料入库流程（前端：原料入库弹窗）

1. 选择「原料大类」（下拉来自 `raw_category`）。
2. 填写**自定义原料名称**（如「铜板A」），系统预览自动编号 `RM20260722XXXX`。
3. 填数量、单价，以及**生产日期 / 有效期**（批次管理的关键字段）。
4. 保存草稿 → 提交 → 财务审核通过。
5. 审核时库存事务对原料明细走 `applyRawBatch`：按唯一批次键 upsert `raw_stock_batch`，并写 `raw_stock_flow`（含结存）。

成品入库/出库逻辑完全不变（仍按 `material_id` 记账 `stock` / `stock_flow`）。实时库存、流水接口已合并成品与原料批次，并标注 `kind` 与有效期。

### 相关 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/categories` | 原料大类列表 |
| POST | `/api/categories` | 新建大类（自动生成 `RC####` 编号） |
| DELETE | `/api/categories/:id` | 删除大类 |
| POST | `/api/inbound` | 建单；明细 `items[].category_id` 或 `items[].material_id` 二选一 |


## 本地运行（docker-compose 一键起 MySQL）

```bash
cp .env.example .env          # DB_HOST=127.0.0.1 / DB_USER=root / DB_PASSWORD=wms123456 / DB_NAME=wms
docker compose up -d          # 自动建表 + 灌入示例数据(含4个角色账号)
npm install
npm start                     # http://localhost:3000
npm test                      # 运行库存结存纯逻辑单测
```

打开 `http://localhost:3000`，用上面 4 个账号登录即可走通全流程。

## 连接腾讯云 CloudBase MySQL

本实例信息（已开通）：环境 `w2026-d3gl5d1a5403e9caa`，库名同环境 ID，MySQL 8.0 Serverless。

1. 在 CloudBase 控制台「数据库 → 账号管理」查看/重置数据库账号密码。
2. 部署方式二选一：
   - **部署到 CloudBase CloudRun / 云函数（同 VPC）**：`.env` 填
     `DB_HOST=172.17.0.15`、`DB_PORT=3306`、`DB_USER`、`DB_PASSWORD`、`DB_NAME=w2026-d3gl5d1a5403e9caa`。
     内网地址仅同 VPC 的服务可访问。
   - **外部直连**：先在控制台开启「外网访问」，把 `DB_HOST` 改为控制台给出的外网地址，
     并放行调用方 IP。
3. 表结构与 4 个角色账号已在 CloudBase 实例中（与 `db/schema.sql`、`db/seed.sql` 一致）。

> 说明：CloudBase MySQL 实例仅暴露 VPC 内网地址，且数据库密码无法经 API 获取，
> 因此本仓库代码以「连接参数走环境变量」实现，部署时按上述填好即可连上实时库。

## 目录结构

```
wms-app/
├─ src/
│  ├─ config.js          # 环境变量
│  ├─ db.js              # mysql2 连接池 + 事务封装
│  ├─ auth.js            # JWT、bcrypt 登录、角色网关
│  ├─ service/inventory.js  # 库存结存纯函数 + 审核事务
│  ├─ routes/            # auth/materials/partners/inbound/outbound/stock
│  ├─ app.js / server.js
├─ public/               # 前端（index.html / app.js / styles.css）
├─ db/                   # schema.sql / seed.sql
├─ test/                 # 库存逻辑单测
├─ docker-compose.yml
└─ .env.example
```
