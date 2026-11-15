import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { createTemporaryAdmin, pruneTemporaryAdmins } from './temporary-admin.js';
import { digest, newToken, verifyPassword } from './security.js';

test('temporary admin is isolated, protected while alive, deleted with sessions; orphan cleanup preserves normal accounts', async () => {
  const suffix = randomUUID();
  const password = 'Temporary test password 2026!';
  let temporary: Awaited<ReturnType<typeof createTemporaryAdmin>> | undefined;
  const permanent = randomUUID(), orphan = randomUUID();
  try {
    await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Existing admin','admin','unused')", [permanent, `permanent-${suffix}@example.com`]);
    await assert.rejects(createTemporaryAdmin('Collision', `permanent-${suffix}@example.com`, password), /already exists/);
    temporary = await createTemporaryAdmin('Local operator', `temporary-${suffix}@example.com`, password);
    const account = (await pool.query('SELECT * FROM users WHERE id=$1', [temporary.id])).rows[0];
    assert.equal(account.role, 'admin');
    assert.ok(await verifyPassword(password, account.password_hash));
    await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(newToken()), temporary.id]);
    await pruneTemporaryAdmins();
    assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [temporary.id])).rowCount, 1);
    await temporary.remove();
    await temporary.remove();
    assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [temporary.id])).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM sessions WHERE user_id=$1', [temporary.id])).rowCount, 0);
    await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Orphan','admin','unused')", [orphan, `orphan-${suffix}@example.com`]);
    await pool.query('INSERT INTO temporary_admin_accounts(user_id) VALUES($1)', [orphan]);
    await pruneTemporaryAdmins();
    assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [orphan])).rowCount, 0);
    assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [permanent])).rowCount, 1);
  } finally {
    await temporary?.remove();
    await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [[permanent, orphan]]);
    await pool.end();
  }
});
