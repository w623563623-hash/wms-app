-- WMS 数据库结构（MySQL 8）
-- 与腾讯云 CloudBase MySQL 实例结构一致；本地 docker-compose 初始化时自动执行。

CREATE TABLE IF NOT EXISTS `material` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `spec` VARCHAR(100) DEFAULT NULL,
  `type` VARCHAR(10) NOT NULL COMMENT 'raw=原料 / finished=成品',
  `unit` VARCHAR(10) NOT NULL,
  `safety_stock` DECIMAL(18,3) DEFAULT 0,
  `ref_price` DECIMAL(18,2) DEFAULT NULL,
  `status` TINYINT DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_code` (`code`)
) COMMENT='物料/产品档案';

CREATE TABLE IF NOT EXISTS `supplier` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `contact` VARCHAR(50) DEFAULT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `address` VARCHAR(200) DEFAULT NULL,
  `status` TINYINT DEFAULT 1,
  UNIQUE KEY `uk_code` (`code`)
) COMMENT='供应商';

CREATE TABLE IF NOT EXISTS `customer` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `contact` VARCHAR(50) DEFAULT NULL,
  `phone` VARCHAR(30) DEFAULT NULL,
  `address` VARCHAR(200) DEFAULT NULL,
  `status` TINYINT DEFAULT 1,
  UNIQUE KEY `uk_code` (`code`)
) COMMENT='客户';

CREATE TABLE IF NOT EXISTS `wms_user` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `username` VARCHAR(50) NOT NULL,
  `password` VARCHAR(100) NOT NULL COMMENT 'bcrypt 哈希',
  `real_name` VARCHAR(50) DEFAULT NULL,
  `role` VARCHAR(20) NOT NULL COMMENT 'admin/inout/packer/finance',
  `status` TINYINT DEFAULT 1,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_username` (`username`)
) COMMENT='系统用户(4角色)';

CREATE TABLE IF NOT EXISTS `operation_log` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `user_id` BIGINT DEFAULT NULL,
  `user_name` VARCHAR(50) DEFAULT NULL,
  `action` VARCHAR(100) DEFAULT NULL,
  `target` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP
) COMMENT='操作日志';

CREATE TABLE IF NOT EXISTS `stock` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `material_id` BIGINT NOT NULL,
  `qty` DECIMAL(18,3) DEFAULT 0,
  `amount` DECIMAL(18,2) DEFAULT 0,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_material` (`material_id`),
  CONSTRAINT `fk_stock_material` FOREIGN KEY (`material_id`) REFERENCES `material`(`id`)
) COMMENT='实时库存结存(单仓库,按物料)';

CREATE TABLE IF NOT EXISTS `stock_flow` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `order_no` VARCHAR(32) NOT NULL,
  `biz_type` VARCHAR(10) NOT NULL COMMENT 'inbound/outbound',
  `material_id` BIGINT NOT NULL,
  `change_qty` DECIMAL(18,3) NOT NULL,
  `change_amount` DECIMAL(18,2) NOT NULL,
  `balance_qty` DECIMAL(18,3) NOT NULL,
  `balance_amount` DECIMAL(18,2) NOT NULL,
  `operator_id` BIGINT DEFAULT NULL,
  `operator_name` VARCHAR(50) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_order` (`order_no`),
  KEY `idx_material` (`material_id`),
  CONSTRAINT `fk_flow_material` FOREIGN KEY (`material_id`) REFERENCES `material`(`id`)
) COMMENT='库存变动流水';

CREATE TABLE IF NOT EXISTS `inbound_order` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `order_no` VARCHAR(32) NOT NULL,
  `type` VARCHAR(20) NOT NULL COMMENT 'purchase/prod_return/finish/other_in',
  `supplier_id` BIGINT DEFAULT NULL,
  `customer_id` BIGINT DEFAULT NULL,
  `total_qty` DECIMAL(18,3) DEFAULT 0,
  `total_amount` DECIMAL(18,2) DEFAULT 0,
  `status` VARCHAR(10) NOT NULL DEFAULT 'draft' COMMENT 'draft/pending/done/cancel',
  `creator_id` BIGINT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `auditor_id` BIGINT DEFAULT NULL,
  `audited_at` DATETIME DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_in_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`),
  CONSTRAINT `fk_in_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`)
) COMMENT='入库单头';

CREATE TABLE IF NOT EXISTS `outbound_order` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `order_no` VARCHAR(32) NOT NULL,
  `type` VARCHAR(20) NOT NULL COMMENT 'pick/sale/scrap/other_out',
  `customer_id` BIGINT DEFAULT NULL,
  `supplier_id` BIGINT DEFAULT NULL,
  `total_qty` DECIMAL(18,3) DEFAULT 0,
  `total_amount` DECIMAL(18,2) DEFAULT 0,
  `status` VARCHAR(10) NOT NULL DEFAULT 'draft' COMMENT 'draft/pending/done/cancel',
  `creator_id` BIGINT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `auditor_id` BIGINT DEFAULT NULL,
  `audited_at` DATETIME DEFAULT NULL,
  `pack_status` VARCHAR(10) DEFAULT 'none' COMMENT 'none/wait/packed',
  `packer_id` BIGINT DEFAULT NULL,
  `packed_at` DATETIME DEFAULT NULL,
  `logistics_no` VARCHAR(50) DEFAULT NULL,
  `remark` VARCHAR(255) DEFAULT NULL,
  UNIQUE KEY `uk_order_no` (`order_no`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_out_customer` FOREIGN KEY (`customer_id`) REFERENCES `customer`(`id`),
  CONSTRAINT `fk_out_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `supplier`(`id`)
) COMMENT='出库单头';

CREATE TABLE IF NOT EXISTS `inbound_item` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `order_id` BIGINT NOT NULL,
  `material_id` BIGINT DEFAULT NULL COMMENT '成品物料（原料批次时为空）',
  `category_id` BIGINT DEFAULT NULL COMMENT '原料大类（成品物料时为空）',
  `material_name` VARCHAR(100) DEFAULT NULL COMMENT '原料自定义名称',
  `material_code` VARCHAR(32) DEFAULT NULL COMMENT '原料自动编号',
  `production_date` DATE DEFAULT NULL,
  `expiry_date` DATE DEFAULT NULL,
  `unit` VARCHAR(10) DEFAULT NULL,
  `qty` DECIMAL(18,3) NOT NULL,
  `unit_price` DECIMAL(18,2) DEFAULT 0,
  `amount` DECIMAL(18,2) DEFAULT 0,
  `remark` VARCHAR(255) DEFAULT NULL,
  CONSTRAINT `fk_in_item_order` FOREIGN KEY (`order_id`) REFERENCES `inbound_order`(`id`),
  CONSTRAINT `fk_in_item_material` FOREIGN KEY (`material_id`) REFERENCES `material`(`id`)
) COMMENT='入库单明细(原料批次+成品物料)';

CREATE TABLE IF NOT EXISTS `outbound_item` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `_openid` VARCHAR(64) DEFAULT '' NOT NULL,
  `order_id` BIGINT NOT NULL,
  `material_id` BIGINT DEFAULT NULL COMMENT '成品物料(原料出库时为空)',
  `batch_id` BIGINT DEFAULT NULL COMMENT '原料批次ID(原料出库时)',
  `category_id` BIGINT DEFAULT NULL COMMENT '原料大类(冗余)',
  `material_name` VARCHAR(100) DEFAULT NULL COMMENT '原料/成品名称(冗余)',
  `material_code` VARCHAR(32) DEFAULT NULL COMMENT '原料编号/成品编码(冗余)',
  `unit` VARCHAR(10) DEFAULT NULL COMMENT '单位(冗余)',
  `qty` DECIMAL(18,3) NOT NULL,
  `unit_price` DECIMAL(18,2) DEFAULT 0,
  `amount` DECIMAL(18,2) DEFAULT 0,
  `remark` VARCHAR(255) DEFAULT NULL,
  CONSTRAINT `fk_out_item_order` FOREIGN KEY (`order_id`) REFERENCES `outbound_order`(`id`),
  CONSTRAINT `fk_out_item_material` FOREIGN KEY (`material_id`) REFERENCES `material`(`id`)
) COMMENT='出库单明细(原料批次+成品物料)';

-- ===== 原料大类 / 原料批次（2026-07 新增）=====
CREATE TABLE IF NOT EXISTS `raw_category` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `spec` VARCHAR(100) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_code` (`code`)
) COMMENT='原料大类(简化档案:编号/名称/规格)';

CREATE TABLE IF NOT EXISTS `raw_stock_batch` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `category_id` BIGINT DEFAULT NULL,
  `material_name` VARCHAR(100) NOT NULL,
  `material_code` VARCHAR(32) DEFAULT NULL,
  `unit` VARCHAR(10) DEFAULT NULL,
  `production_date` DATE DEFAULT NULL,
  `expiry_date` DATE DEFAULT NULL,
  `qty` DECIMAL(18,3) DEFAULT 0,
  `amount` DECIMAL(18,2) DEFAULT 0,
  `inbound_order_id` BIGINT DEFAULT NULL,
  `inbound_item_id` BIGINT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uk_batch` (`category_id`, `material_name`, `production_date`, `expiry_date`),
  KEY `idx_cat` (`category_id`)
) COMMENT='原料批次库存(按大类+名称+生产/有效期批次)';

CREATE TABLE IF NOT EXISTS `raw_stock_flow` (
  `id` BIGINT PRIMARY KEY AUTO_INCREMENT,
  `order_no` VARCHAR(32) DEFAULT NULL,
  `biz_type` VARCHAR(10) DEFAULT NULL,
  `category_id` BIGINT DEFAULT NULL,
  `material_name` VARCHAR(100) DEFAULT NULL,
  `material_code` VARCHAR(32) DEFAULT NULL,
  `change_qty` DECIMAL(18,3) DEFAULT 0,
  `change_amount` DECIMAL(18,2) DEFAULT 0,
  `balance_qty` DECIMAL(18,3) DEFAULT 0,
  `balance_amount` DECIMAL(18,2) DEFAULT 0,
  `production_date` DATE DEFAULT NULL,
  `expiry_date` DATE DEFAULT NULL,
  `operator_id` BIGINT DEFAULT NULL,
  `operator_name` VARCHAR(50) DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_order` (`order_no`)
) COMMENT='原料批次库存变动流水';
