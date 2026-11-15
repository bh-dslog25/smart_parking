import { Router, type Request } from 'express';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { digest } from './security.js';
import { signalState, validPlan } from './signals.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function trafficRouter(sessionToken: (req: Request) => string) {
  const router = Router();
  router.use(async (req, res, next) => {
    const token = sessionToken(req);
    const { rows } = await pool.query('SELECT u.id,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true', [digest(token)]);
    if (!token || !rows[0]) { res.status(401).json({ message: 'Vui lòng đăng nhập.' }); return; }
    res.locals.actor = rows[0];
    if (req.method !== 'GET' && rows[0].role !== 'admin') {
      res.status(403).json({ message: 'Chỉ quản trị viên được điều khiển đèn giao thông.' }); return;
    }
    next();
  });
  router.get('/intersections', async (_req, res) => {
    const { rows } = await pool.query('SELECT * FROM intersections ORDER BY name,id');
    const now = Date.now();
    res.json({ simulation: true, serverTime: new Date(now), intersections: rows.map(row => ({ ...row, signals: signalState(row, now) })) });
  });
  router.post('/intersections', async (req, res) => {
    const { name, location } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || typeof location !== 'string' || !location.trim() || location.trim().length > 240) {
      res.status(400).json({ message: 'Nhập tên nút giao (tối đa 120 ký tự) và vị trí (tối đa 240 ký tự).' }); return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('INSERT INTO intersections(id,name,location) VALUES($1,$2,$3) RETURNING *', [randomUUID(), name.trim(), location.trim()]);
      await client.query("INSERT INTO signal_changes(id,intersection_id,actor_id,action,configuration) VALUES($1,$2,$3,'created',$4)", [randomUUID(), rows[0].id, res.locals.actor.id, JSON.stringify(rows[0])]);
      await client.query('COMMIT');
      res.status(201).json({ intersection: rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  router.post('/intersections/:id/configure', async (req, res) => {
    const body = req.body ?? {};
    if (!uuid.test(String(req.params.id)) || !validPlan(body) || !Number.isInteger(body.version) || body.version < 1) {
      res.status(400).json({ message: 'Cấu hình không hợp lệ. Xanh: 10–180s, vàng: 3–10s, đỏ toàn phần: 2–10s.' }); return;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query('SELECT * FROM intersections WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rows[0] || current.rows[0].version !== body.version) {
        await client.query('ROLLBACK');
        res.status(current.rows[0] ? 409 : 404).json({ message: current.rows[0] ? 'Cấu hình đã thay đổi. Tải lại trước khi lưu.' : 'Không tìm thấy nút giao.' }); return;
      }
      // Restart at all-red clearance for every configuration change.
      const { rows } = await client.query('UPDATE intersections SET mode=$2,north_south_green=$3,east_west_green=$4,yellow=$5,all_red=$6,version=version+1,cycle_started_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1 RETURNING *', [req.params.id, body.mode, body.north_south_green, body.east_west_green, body.yellow, body.all_red]);
      await client.query("INSERT INTO signal_changes(id,intersection_id,actor_id,action,configuration) VALUES($1,$2,$3,'configured',$4)", [randomUUID(), req.params.id, res.locals.actor.id, JSON.stringify(rows[0])]);
      await client.query('COMMIT');
      res.json({ intersection: rows[0] });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  router.get('/intersections/:id/history', async (req, res) => {
    if (!uuid.test(String(req.params.id))) { res.status(400).json({ message: 'Mã nút giao không hợp lệ.' }); return; }
    const exists = await pool.query('SELECT id FROM intersections WHERE id=$1', [req.params.id]);
    if (!exists.rows[0]) { res.status(404).json({ message: 'Không tìm thấy nút giao.' }); return; }
    const { rows } = await pool.query('SELECT c.id,c.action,c.configuration,c.created_at,u.name AS actor_name FROM signal_changes c LEFT JOIN users u ON u.id=c.actor_id WHERE c.intersection_id=$1 ORDER BY c.created_at DESC,c.id LIMIT 50', [req.params.id]);
    res.json({ changes: rows });
  });
  return router;
}
