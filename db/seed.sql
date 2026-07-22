-- WMS 示例数据（本地 docker-compose 初始化时执行）
-- 4 个角色账号（默认密码 Wms@2026，bcrypt $2b$10$ 哈希）
INSERT INTO `wms_user` (`username`, `password`, `real_name`, `role`, `status`) VALUES
  ('admin', '$2b$10$KlAZDQRhIqG9l.vPw9ml1uuPAyZtwUUjgY38fb.ufB7959.ruz1jG', '系统管理员', 'admin', 1),
  ('inout', '$2b$10$KlAZDQRhIqG9l.vPw9ml1uuPAyZtwUUjgY38fb.ufB7959.ruz1jG', '出入库管理员', 'inout', 1),
  ('packer', '$2b$10$KlAZDQRhIqG9l.vPw9ml1uuPAyZtwUUjgY38fb.ufB7959.ruz1jG', '打包出货管理员', 'packer', 1),
  ('finance', '$2b$10$KlAZDQRhIqG9l.vPw9ml1uuPAyZtwUUjgY38fb.ufB7959.ruz1jG', '财务', 'finance', 1);

-- 物料/产品
INSERT INTO `material` (`code`, `name`, `spec`, `type`, `unit`, `safety_stock`, `ref_price`) VALUES
  ('RM-001', '钢板', '1.2mm', 'raw', '张', 50, 120.00),
  ('RM-002', '铝合金型材', '40x40', 'raw', '米', 100, 18.50),
  ('FG-001', '机箱总成', 'A型', 'finished', '台', 20, 880.00),
  ('FG-002', '控制面板', 'B型', 'finished', '块', 30, 240.00);

-- 供应商
INSERT INTO `supplier` (`code`, `name`, `contact`, `phone`) VALUES
  ('SUP-001', '钢材贸易有限公司', '王经理', '13800000001'),
  ('SUP-002', '有色金属材料厂', '李工', '13800000002');

-- 客户
INSERT INTO `customer` (`code`, `name`, `contact`, `phone`) VALUES
  ('CUS-001', '设备制造客户', '张总', '13900000001'),
  ('CUS-002', '海外贸易公司', 'Mary', '13900000002');

-- 原料大类（编号由后端自动生成，这里仅示例）
INSERT INTO `raw_category` (`code`, `name`, `spec`) VALUES
  ('RC0001', '金属板材', '1.2mm'),
  ('RC0002', '塑料粒子', 'PE'),
  ('RC0003', '电子元件', 'SMD');
