-- 吉林大学宿舍报修系统 · Supabase 初始化 SQL
-- 在 Supabase SQL Editor 中执行此文件

-- 1. 用户表
CREATE TABLE IF NOT EXISTS user_info (
  user_id TEXT PRIMARY KEY,
  name TEXT, role TEXT, contact TEXT,
  dorm_building TEXT, password TEXT
);

-- 2. 工单表
CREATE TABLE IF NOT EXISTS repair_order (
  order_id TEXT PRIMARY KEY,
  user_id TEXT, fault_type TEXT, description TEXT,
  img_url TEXT, address TEXT, appoint_time TEXT,
  need_company BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'pending',
  create_time BIGINT, assign_time BIGINT,
  repair_time BIGINT, complete_time BIGINT,
  repair_result TEXT DEFAULT '', complete_img TEXT DEFAULT ''
);

-- 3. 维修人员技能表
CREATE TABLE IF NOT EXISTS repairman_skill (
  repairman_id TEXT PRIMARY KEY,
  skill_tag TEXT, workload INT DEFAULT 0,
  schedule TEXT, avg_score FLOAT DEFAULT 0
);

-- 4. 派单记录表
CREATE TABLE IF NOT EXISTS assign_record (
  assign_id TEXT PRIMARY KEY,
  order_id TEXT, repairman_id TEXT,
  assign_time BIGINT, is_auto BOOLEAN DEFAULT FALSE
);

-- 5. 评价反馈表
CREATE TABLE IF NOT EXISTS repair_feedback (
  feedback_id TEXT PRIMARY KEY,
  order_id TEXT, speed_score INT, attitude_score INT,
  quality_score INT, suggestion TEXT, feedback_time BIGINT
);

-- 6. 耗材使用表
CREATE TABLE IF NOT EXISTS material_usage (
  record_id TEXT PRIMARY KEY,
  order_id TEXT, material_name TEXT,
  quantity INT, use_time BIGINT
);

-- 7. 通知公告表
CREATE TABLE IF NOT EXISTS notice (
  notice_id TEXT PRIMARY KEY,
  publisher_id TEXT, title TEXT, content TEXT,
  target_role TEXT, publish_time BIGINT,
  status TEXT DEFAULT 'active'
);

-- 8. 投诉建议表
CREATE TABLE IF NOT EXISTS complaint (
  complaint_id TEXT PRIMARY KEY,
  user_id TEXT, order_id TEXT, type TEXT,
  content TEXT, status TEXT DEFAULT 'pending',
  reply_content TEXT DEFAULT '', reply_user_id TEXT,
  create_time BIGINT, reply_time BIGINT
);

-- 9. 消息推送表
CREATE TABLE IF NOT EXISTS message_push (
  push_id TEXT PRIMARY KEY,
  user_id TEXT, order_id TEXT, push_type TEXT,
  content TEXT, push_time BIGINT,
  is_read BOOLEAN DEFAULT FALSE
);

-- 10. 系统配置表
CREATE TABLE IF NOT EXISTS sys_config (
  config_id TEXT PRIMARY KEY,
  config_key TEXT, config_value TEXT,
  description TEXT, update_time BIGINT, update_user_id TEXT
);

-- 11. 系统日志表
CREATE TABLE IF NOT EXISTS sys_log (
  log_id TEXT PRIMARY KEY,
  operator TEXT, operate_type TEXT,
  operate_time BIGINT, result TEXT
);

-- ============================================================
-- 关闭 RLS（演示用，允许匿名读写）
-- ============================================================
ALTER TABLE user_info      DISABLE ROW LEVEL SECURITY;
ALTER TABLE repair_order   DISABLE ROW LEVEL SECURITY;
ALTER TABLE repairman_skill DISABLE ROW LEVEL SECURITY;
ALTER TABLE assign_record  DISABLE ROW LEVEL SECURITY;
ALTER TABLE repair_feedback DISABLE ROW LEVEL SECURITY;
ALTER TABLE material_usage DISABLE ROW LEVEL SECURITY;
ALTER TABLE notice         DISABLE ROW LEVEL SECURITY;
ALTER TABLE complaint      DISABLE ROW LEVEL SECURITY;
ALTER TABLE message_push   DISABLE ROW LEVEL SECURITY;
ALTER TABLE sys_config     DISABLE ROW LEVEL SECURITY;
ALTER TABLE sys_log        DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- 种子数据（用户 + 技能 + 配置）
-- ============================================================
INSERT INTO user_info VALUES
  ('U001','韩房佳茵','student',   '13800138001','知新楼','123456'),
  ('U002','李明阳',  'student',   '13800138002','励学楼','123456'),
  ('U003','王璐曜',  'dorm_admin','13800138003','知新楼','123456'),
  ('U004','周天临',  'repairman', '13800138004','',      '123456'),
  ('U005','张国强',  'repairman', '13800138005','',      '123456'),
  ('U006','刘明泽',  'repairman', '13800138006','',      '123456'),
  ('U007','余锐新',  'admin',     '13800138007','',      '123456')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO repairman_skill VALUES
  ('U004','水电',2,'周一至周五 08:00-17:00',4.6),
  ('U005','家具',1,'周一至周六 09:00-18:00',4.3),
  ('U006','空调',3,'周二至周日 08:00-16:00',4.8)
ON CONFLICT (repairman_id) DO NOTHING;

INSERT INTO sys_config VALUES
  ('CF001','auto_assign_enabled','true', '是否启用智能自动派单',0,'U007'),
  ('CF002','ai_inspect_enabled', 'true', '是否启用AI质检模拟',  0,'U007'),
  ('CF003','max_workload',       '5',    '每人最大同时工单数',   0,'U007')
ON CONFLICT (config_id) DO NOTHING;

INSERT INTO notice VALUES
  ('NT001','U007','暑期宿舍报修服务时间调整通知',
   '因暑期维修人员部分休假，7月15日至8月15日期间，报修服务时间调整为每周一、三、五上午9:00-12:00。',
   'all', extract(epoch from now())*1000, 'active'),
  ('NT002','U007','关于空调维修排期的说明',
   '近期空调报修量较大，预计等待时间为3-5个工作日，感谢同学们的理解与配合。',
   'student', extract(epoch from now())*1000, 'active')
ON CONFLICT (notice_id) DO NOTHING;
