import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pool } from './db.js';
import { hashPassword, validEmail, validPassword } from './security.js';

export async function pruneTemporaryAdmins() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT user_id FROM temporary_admin_accounts');
    for (const { user_id } of rows) {
      const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired', [user_id]);
      if (lock.rows[0].acquired) await client.query('DELETE FROM users WHERE id=$1 AND id IN (SELECT user_id FROM temporary_admin_accounts)', [user_id]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function createTemporaryAdmin(name: string, email: string, password: string, onLeaseLost = () => {}) {
  if (!name.trim() || name.length > 200 || !validEmail(email) || !validPassword(password)) throw new Error('Enter a name, valid email and a password of 12–128 characters.');
  const id = randomUUID();
  const hash = await hashPassword(password);
  const lease = await pool.connect();
  lease.on('error', onLeaseLost);
  try {
    await lease.query('SELECT pg_advisory_lock(hashtextextended($1,0))', [id]);
    await lease.query('BEGIN');
    const result = await lease.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,$3,'admin',$4) ON CONFLICT(email) DO NOTHING RETURNING id", [id, email.trim().toLowerCase(), name.trim(), hash]);
    if (!result.rowCount) throw new Error('That email already exists. Existing accounts are never replaced; choose a different email.');
    await lease.query('INSERT INTO temporary_admin_accounts(user_id) VALUES($1)', [id]);
    await lease.query('COMMIT');
  } catch (error) {
    await lease.query('ROLLBACK').catch(() => {});
    await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [id]).catch(() => {});
    lease.removeListener('error', onLeaseLost);
    lease.release(true);
    throw error;
  }
  let removed = false;
  return { id, async remove() {
    if (removed) return;
    removed = true;
    try { await pool.query('DELETE FROM users WHERE id=$1 AND id IN (SELECT user_id FROM temporary_admin_accounts)', [id]); }
    finally {
      await lease.query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [id]).catch(() => {});
      lease.removeListener('error', onLeaseLost);
      lease.release(true);
    }
  } };
}

export async function promptTemporaryAdmin() {
  if (!process.stdin.isTTY) throw new Error('Temporary admin setup requires an interactive terminal. Run npm run start:temporary-admin on the server machine.');
  const text = createInterface({ input: process.stdin, output: process.stdout });
  let name: string, email: string;
  try { name = await text.question('Temporary admin name: '); email = await text.question('Email: '); }
  finally { text.close(); }
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const hidden = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    process.stdout.write('Password (12–128 characters; hidden): ');
    const password = await hidden.question('');
    process.stdout.write('\nConfirm password (hidden): ');
    const confirm = await hidden.question('');
    process.stdout.write('\n');
    if (password !== confirm) throw new Error('Passwords do not match.');
    return { name, email, password };
  } finally { hidden.close(); muted.end(); }
}
