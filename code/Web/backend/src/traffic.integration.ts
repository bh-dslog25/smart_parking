import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { app } from './app.js';
import { pool } from './db.js';
import { digest, newToken } from './security.js';

test('traffic plans persist, enforce permissions and reject stale writes', async () => {
  const ids: string[] = [], intersections: string[] = [];
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const request = (path: string, cookie = '', body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/traffic/${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const cookies: Record<string, string> = {};
    for (const role of ['admin', 'user']) {
      const id = randomUUID(), token = newToken(); ids.push(id);
      await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Traffic test',$3,'unused')", [id, `${id}@example.com`, role]);
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(token), id]);
      cookies[role] = `traffic_session=${token}`;
    }
    assert.equal((await request('intersections')).status, 401);
    assert.equal((await request('intersections', cookies.user, { name: 'Blocked', location: 'Test' })).status, 403);
    assert.equal((await request('intersections', cookies.admin, { name: '', location: 'Test' })).status, 400);
    const response = await request('intersections', cookies.admin, { name: 'Test junction', location: 'Test location' });
    assert.equal(response.status, 201);
    const { intersection: row } = await response.json(); intersections.push(row.id);
    assert.equal(row.mode, 'all_red');
    const plan = { version: row.version, mode: 'automatic', north_south_green: 30, east_west_green: 45, yellow: 3, all_red: 2 };
    const path = `intersections/${row.id}/configure`;
    assert.equal((await request(path, cookies.user, plan)).status, 403);
    assert.equal((await request(path, cookies.admin, { ...plan, yellow: 1 })).status, 400);
    assert.equal((await request(path, cookies.admin, { ...plan, mode: ['automatic'] })).status, 400);
    assert.equal((await request(path, cookies.admin, plan)).status, 200);
    assert.equal((await request(path, cookies.admin, plan)).status, 409);
    const data = await (await request('intersections', cookies.user)).json();
    const saved = data.intersections.find((item: { id: string }) => item.id === row.id);
    assert.equal(data.simulation, true);
    assert.equal(saved.east_west_green, 45);
    assert.equal(saved.version, 2);
    assert.ok(saved.signals.northSouth === 'red' || saved.signals.eastWest === 'red');
    const history = await (await request(`intersections/${row.id}/history`, cookies.user)).json();
    assert.equal(history.changes.length, 2);
    assert.equal(history.changes[0].configuration.mode, 'automatic');
    assert.equal((await request(`intersections/${randomUUID()}/configure`, cookies.admin, plan)).status, 404);
    assert.equal((await request('intersections/bad/history', cookies.user)).status, 400);
    await pool.query('UPDATE users SET active=false WHERE id=$1', [ids[0]]);
    assert.equal((await request(path, cookies.admin, { ...plan, version: 2 })).status, 401);
  } finally {
    try { await pool.query('DELETE FROM intersections WHERE id=ANY($1::uuid[])', [intersections]); await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); }
  }
});
