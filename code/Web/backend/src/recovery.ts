import { Router, type Request } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { digest, hashPassword, validEmail, validPassword } from './security.js';

export function recoveryRouter(sessionToken: (req: Request) => string) {
  const router = Router();
  router.post('/recovery-requests', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res) => {
    const { email, name, phone, accountId } = req.body ?? {};
    if (!validEmail(email) || typeof name !== 'string' || !name.trim() || name.length > 200 || typeof phone !== 'string' || !/^[+\d][\d ().-]{6,24}$/.test(phone.trim()) || typeof accountId !== 'string' || !/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(accountId)) {
      res.status(400).json({ message: 'Nhập email, họ tên, số điện thoại và mã tài khoản hợp lệ.' }); return;
    }
    // Acknowledgements do not reveal whether the account exists.
    await pool.query(`INSERT INTO recovery_requests(id,user_id,request_name,request_email,request_phone,request_account_id)
      SELECT $1,id,$2,$3,$4,$5::text FROM users WHERE id=$5::text::uuid AND email=$3 AND role='user' AND active=true
      AND lower(normalize(name,NFC))=lower(normalize($2,NFC)) ON CONFLICT DO NOTHING`,
    [randomUUID(), name.trim(), email.trim().toLowerCase(), phone.trim(), accountId.toLowerCase()]);
    res.status(202).json({ message: 'Nếu thông tin khớp, yêu cầu đã được gửi cho quản trị viên. Quản trị viên sẽ liên hệ qua thông tin bạn cung cấp.' });
  });
  router.use('/recovery-requests', async (req, res, next) => {
    const token = sessionToken(req);
    const { rows } = await pool.query(`SELECT u.id,u.role FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`, [digest(token)]);
    if (!rows[0]) { res.status(401).json({ message: 'Vui lòng đăng nhập.' }); return; }
    if (rows[0].role !== 'admin') { res.status(403).json({ message: 'Chỉ quản trị viên được xử lý yêu cầu.' }); return; }
    res.locals.actorId = rows[0].id;
    next();
  });
  router.get('/recovery-requests', async (_req, res) => {
    const { rows } = await pool.query(`SELECT r.*,u.name AS account_name,u.email AS account_email,reviewer.name AS reviewer_name
      FROM recovery_requests r JOIN users u ON u.id=r.user_id LEFT JOIN users reviewer ON reviewer.id=r.reviewed_by
      ORDER BY (r.status='pending') DESC,r.created_at DESC LIMIT 100`);
    res.json({ requests: rows });
  });
  router.post('/recovery-requests/:id/review', async (req, res) => {
    const { decision, password, confirm, note = '' } = req.body ?? {};
    if (!/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(String(req.params.id)) || !['approve','reject'].includes(decision) || typeof note !== 'string' || note.length > 1000 || (decision === 'approve' && (!validPassword(password) || password !== confirm))) {
      res.status(400).json({ message: 'Quyết định không hợp lệ. Khi chấp nhận, nhập mật khẩu 12–128 ký tự và xác nhận khớp.' }); return;
    }
    const hash = decision === 'approve' ? await hashPassword(password) : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const actor = await client.query(`SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true AND u.role='admin' FOR UPDATE OF u`, [digest(sessionToken(req))]);
      const session = await client.query('SELECT user_id FROM sessions WHERE token_hash=$1 AND expires_at>now()', [digest(sessionToken(req))]);
      if (!actor.rows[0] || session.rows[0]?.user_id !== actor.rows[0].id) { await client.query('ROLLBACK'); res.status(401).json({ message: 'Phiên quản trị đã hết hạn.' }); return; }
      // Lock the account before the request, consistently with other password operations.
      const owner = await client.query('SELECT user_id FROM recovery_requests WHERE id=$1', [req.params.id]);
      const target = owner.rows[0] && await client.query("SELECT id FROM users WHERE id=$1 AND role='user' AND active=true FOR UPDATE", [owner.rows[0].user_id]);
      const current = await client.query('SELECT status FROM recovery_requests WHERE id=$1 FOR UPDATE', [req.params.id]);
      if (!current.rows[0] || !target?.rows[0]) { await client.query('ROLLBACK'); res.status(404).json({ message: 'Không tìm thấy yêu cầu của tài khoản người dùng đang hoạt động.' }); return; }
      if (current.rows[0].status !== 'pending') { await client.query('ROLLBACK'); res.status(409).json({ message: 'Yêu cầu đã được xử lý. Vui lòng tải lại.' }); return; }
      if (decision === 'approve') {
        await client.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, target.rows[0].id]);
        for (const table of ['sessions','email_otps','password_resets']) await client.query(`DELETE FROM ${table} WHERE user_id=$1`, [target.rows[0].id]);
      }
      await client.query("UPDATE recovery_requests SET status=$1,reviewed_at=now(),reviewed_by=$2,review_note=$3 WHERE id=$4", [decision === 'approve' ? 'approved' : 'rejected', actor.rows[0].id, note.trim(), req.params.id]);
      await client.query('COMMIT');
      res.json({ message: decision === 'approve' ? 'Đã đổi mật khẩu và thu hồi mọi phiên đăng nhập của người dùng. Hãy chuyển mật khẩu qua kênh liên hệ đã xác minh.' : 'Đã từ chối yêu cầu. Mật khẩu không thay đổi.' });
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  return router;
}
