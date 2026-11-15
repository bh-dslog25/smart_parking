import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app } from './app.js';
import { pool } from './db.js';
import { digest, hashPassword, newToken, verifyPassword } from './security.js';

test('users request recovery; only admins can approve/reject; reviews are single-use and revoke access', async () => {
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const emails = ids.map(id => `review-${id}@example.com`);
  const tokens = ids.map(() => newToken());
  const password = 'Recovery original password!';
  const next = 'Recovery approved password!';
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const request = (path = '', body?: unknown, actor?: number) => fetch(`http://127.0.0.1:${address.port}/api/auth/recovery-requests${path}`, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(actor === undefined ? {} : { Cookie: `traffic_session=${tokens[actor]}` }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const identity = (index: number) => ({ name: `Review ${index}`, email: emails[index], accountId: ids[index], phone: '0901234567' });
  try {
    const hash = await hashPassword(password);
    for (let i = 0; i < ids.length; i++) {
      await pool.query('INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5)', [ids[i], emails[i], `Review ${i}`, i === 0 ? 'admin' : 'user', hash]);
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(tokens[i]), ids[i]]);
    }
    assert.equal((await request()).status, 401);
    assert.equal((await request('', undefined, 1)).status, 403);
    assert.equal((await request('', { ...identity(1), accountId: 'bad' })).status, 400);
    const invalid = await request('', { ...identity(1), name: 'Wrong name' });
    const valid = await request('', identity(1));
    assert.equal(valid.status, 202); assert.deepEqual(await invalid.json(), await valid.json());
    assert.equal((await request('', identity(1))).status, 202);
    let rows = (await pool.query('SELECT * FROM recovery_requests WHERE user_id=$1', [ids[1]])).rows;
    assert.equal(rows.length, 1);
    const firstId = rows[0].id;
    const list = await (await request('', undefined, 0)).json();
    assert.ok(list.requests.some((row: any) => row.id === firstId && row.request_phone === '0901234567'));
    assert.equal((await request(`/${firstId}/review`, { decision: 'approve', password: next, confirm: next }, 1)).status, 403);
    assert.equal((await request(`/${firstId}/review`, { decision: 'approve', password: 'short', confirm: 'short' }, 0)).status, 400);
    assert.equal((await request(`/${firstId}/review`, { decision: 'reject', note: 'Identity could not be confirmed' }, 0)).status, 200);
    assert.ok(await verifyPassword(password, (await pool.query('SELECT password_hash FROM users WHERE id=$1', [ids[1]])).rows[0].password_hash));
    assert.equal((await request(`/${firstId}/review`, { decision: 'approve', password: next, confirm: next }, 0)).status, 409);
    await request('', identity(1));
    rows = (await pool.query("SELECT id FROM recovery_requests WHERE user_id=$1 AND status='pending'", [ids[1]])).rows;
    const recovery = newToken();
    await pool.query("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(recovery), ids[1]]);
    const results = await Promise.all([0, 1].map(() => request(`/${rows[0].id}/review`, { decision: 'approve', password: next, confirm: next }, 0)));
    assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
    assert.ok(await verifyPassword(next, (await pool.query('SELECT password_hash FROM users WHERE id=$1', [ids[1]])).rows[0].password_hash));
    assert.equal((await pool.query('SELECT * FROM sessions WHERE user_id=$1', [ids[1]])).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM password_resets WHERE user_id=$1', [ids[1]])).rowCount, 0);
    assert.equal((await pool.query('SELECT reviewed_by FROM recovery_requests WHERE id=$1', [rows[0].id])).rows[0].reviewed_by, ids[0]);
    // Requests cannot target admin accounts.
    await request('', identity(0));
    assert.equal((await pool.query('SELECT * FROM recovery_requests WHERE user_id=$1', [ids[0]])).rowCount, 0);
  } finally {
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
});
