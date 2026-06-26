"""
吉林大学宿舍报修系统 · Flask 后端
运行：python3 server.py
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import pymysql, os, json

app = Flask(__name__)
CORS(app)  # 允许前端跨域访问

# ── 数据库配置 ──────────────────────────────────────────────
# Railway 部署时自动从环境变量读取，本地开发修改下面的值
DB_CONFIG = {
    'host':     os.getenv('DB_HOST',     'localhost'),
    'port':     int(os.getenv('DB_PORT', '3306')),
    'user':     os.getenv('DB_USER',     'root'),
    'password': os.getenv('DB_PASSWORD', 'xcy060316'),      # ← 改成你的 MySQL 密码
    'database': os.getenv('DB_NAME',     'dorm_repair'),
    'charset':  'utf8mb4',
    'cursorclass': pymysql.cursors.DictCursor
}

# 每张表的主键
TABLE_PK = {
    'user_info': 'user_id', 'repair_order': 'order_id',
    'repairman_skill': 'repairman_id', 'assign_record': 'assign_id',
    'repair_feedback': 'feedback_id', 'material_usage': 'record_id',
    'notice': 'notice_id', 'complaint': 'complaint_id',
    'message_push': 'push_id', 'sys_config': 'config_id', 'sys_log': 'log_id'
}
VALID_TABLES = set(TABLE_PK.keys())

def get_db():
    cfg = dict(DB_CONFIG)
    cfg.pop('cursorclass', None)
    return pymysql.connect(**cfg, cursorclass=pymysql.cursors.DictCursor)

# ── 通用接口 ────────────────────────────────────────────────

@app.route('/api/<table>', methods=['GET'])
def get_table(table):
    if table not in VALID_TABLES:
        return jsonify({'error': 'Invalid table'}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(f'SELECT * FROM `{table}`')
            rows = cur.fetchall()
            # TINYINT(1) → bool，BIGINT → int 已由 pymysql 处理
            return jsonify(rows)
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/<table>', methods=['POST'])
def insert_row(table):
    if table not in VALID_TABLES:
        return jsonify({'error': 'Invalid table'}), 400
    data = request.json
    if not data:
        return jsonify({'error': 'No data'}), 400
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cols   = ', '.join(f'`{k}`' for k in data)
            ph     = ', '.join(['%s'] * len(data))
            update = ', '.join(f'`{k}`=VALUES(`{k}`)' for k in data)
            sql    = f'INSERT INTO `{table}` ({cols}) VALUES ({ph}) ON DUPLICATE KEY UPDATE {update}'
            cur.execute(sql, list(data.values()))
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/<table>/<row_id>', methods=['PUT'])
def update_row(table, row_id):
    if table not in VALID_TABLES:
        return jsonify({'error': 'Invalid table'}), 400
    data = request.json
    if not data:
        return jsonify({'error': 'No data'}), 400
    pk   = TABLE_PK[table]
    conn = get_db()
    try:
        with conn.cursor() as cur:
            sets = ', '.join(f'`{k}`=%s' for k in data)
            sql  = f'UPDATE `{table}` SET {sets} WHERE `{pk}`=%s'
            cur.execute(sql, list(data.values()) + [row_id])
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

@app.route('/api/<table>/<row_id>', methods=['DELETE'])
def delete_row(table, row_id):
    if table not in VALID_TABLES:
        return jsonify({'error': 'Invalid table'}), 400
    pk   = TABLE_PK[table]
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(f'DELETE FROM `{table}` WHERE `{pk}`=%s', [row_id])
        conn.commit()
        return jsonify({'ok': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

# ── 健康检查 ────────────────────────────────────────────────
@app.route('/api/ping')
def ping():
    return jsonify({'ok': True, 'msg': '宿舍报修系统后端运行中'})

if __name__ == '__main__':
    port = int(os.getenv('PORT', 5000))
    print(f'🚀 后端启动：http://localhost:{port}')
    app.run(host='0.0.0.0', port=port, debug=True)
