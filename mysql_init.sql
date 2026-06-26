-- 吉林大学宿舍报修系统 · MySQL 初始化
-- 在 MySQL 中执行：mysql -u root -p < mysql_init.sql

CREATE DATABASE IF NOT EXISTS dorm_repair DEFAULT CHARSET utf8mb4;
USE dorm_repair;

CREATE TABLE IF NOT EXISTS user_info (
  user_id VARCHAR(20) PRIMARY KEY,
  name VARCHAR(50), role VARCHAR(20), contact VARCHAR(20),
  dorm_building VARCHAR(50), password VARCHAR(50)
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS repair_order (
  order_id VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(20), fault_type VARCHAR(20), description TEXT,
  img_url MEDIUMTEXT, address VARCHAR(100), appoint_time VARCHAR(50),
  need_company TINYINT(1) DEFAULT 0, status VARCHAR(20) DEFAULT 'pending',
  create_time BIGINT, assign_time BIGINT, repair_time BIGINT, complete_time BIGINT,
  repair_result TEXT, complete_img MEDIUMTEXT
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS repairman_skill (
  repairman_id VARCHAR(20) PRIMARY KEY,
  skill_tag VARCHAR(20), workload INT DEFAULT 0,
  schedule VARCHAR(100), avg_score FLOAT DEFAULT 0
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS assign_record (
  assign_id VARCHAR(30) PRIMARY KEY,
  order_id VARCHAR(30), repairman_id VARCHAR(20),
  assign_time BIGINT, is_auto TINYINT(1) DEFAULT 0
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS repair_feedback (
  feedback_id VARCHAR(30) PRIMARY KEY,
  order_id VARCHAR(30), speed_score INT, attitude_score INT,
  quality_score INT, suggestion TEXT, feedback_time BIGINT
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS material_usage (
  record_id VARCHAR(30) PRIMARY KEY,
  order_id VARCHAR(30), material_name VARCHAR(100),
  quantity INT, use_time BIGINT
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notice (
  notice_id VARCHAR(30) PRIMARY KEY,
  publisher_id VARCHAR(20), title VARCHAR(200), content TEXT,
  target_role VARCHAR(20), publish_time BIGINT, status VARCHAR(20) DEFAULT 'active'
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS complaint (
  complaint_id VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(20), order_id VARCHAR(30), type VARCHAR(20),
  content TEXT, status VARCHAR(20) DEFAULT 'pending',
  reply_content TEXT, reply_user_id VARCHAR(20),
  create_time BIGINT, reply_time BIGINT
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS message_push (
  push_id VARCHAR(30) PRIMARY KEY,
  user_id VARCHAR(20), order_id VARCHAR(30), push_type VARCHAR(30),
  content TEXT, push_time BIGINT, is_read TINYINT(1) DEFAULT 0
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_config (
  config_id VARCHAR(20) PRIMARY KEY,
  config_key VARCHAR(50), config_value VARCHAR(100),
  description VARCHAR(200), update_time BIGINT, update_user_id VARCHAR(20)
) CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sys_log (
  log_id VARCHAR(30) PRIMARY KEY,
  operator VARCHAR(50), operate_type VARCHAR(50),
  operate_time BIGINT, result VARCHAR(200)
) CHARSET=utf8mb4;

-- 种子数据
INSERT IGNORE INTO user_info VALUES
  ('U001','韩房佳茵','student',   '13800138001','知新楼','123456'),
  ('U002','李明阳',  'student',   '13800138002','励学楼','123456'),
  ('U003','王璐曜',  'dorm_admin','13800138003','知新楼','123456'),
  ('U004','周天临',  'repairman', '13800138004','',      '123456'),
  ('U005','张国强',  'repairman', '13800138005','',      '123456'),
  ('U006','刘明泽',  'repairman', '13800138006','',      '123456'),
  ('U007','余锐新',  'admin',     '13800138007','',      '123456');

INSERT IGNORE INTO repairman_skill VALUES
  ('U004','水电',2,'周一至周五 08:00-17:00',4.6),
  ('U005','家具',1,'周一至周六 09:00-18:00',4.3),
  ('U006','空调',3,'周二至周日 08:00-16:00',4.8);

INSERT IGNORE INTO sys_config VALUES
  ('CF001','auto_assign_enabled','true','是否启用智能自动派单',0,'U007'),
  ('CF002','ai_inspect_enabled', 'true','是否启用AI质检模拟',  0,'U007'),
  ('CF003','max_workload',       '5',   '每人最大同时工单数',  0,'U007');

INSERT IGNORE INTO notice VALUES
  ('NT001','U007','暑期宿舍报修服务时间调整通知',
   '因暑期维修人员部分休假，7月15日至8月15日期间，报修服务时间调整为每周一、三、五上午9:00-12:00。',
   'all', UNIX_TIMESTAMP()*1000, 'active'),
  ('NT002','U007','关于空调维修排期的说明',
   '近期空调报修量较大，预计等待时间为3-5个工作日，感谢同学们的理解与配合。',
   'student', UNIX_TIMESTAMP()*1000, 'active');
