import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { digest, hashPassword, newToken } from '../security.js';

export const originalPassword = 'Use case original password 2026!';
export const updatedPassword = 'Use case updated password 2026!';
export const cookie = (response: Response) => response.headers.get('set-cookie')!.split(';')[0]!;
export type Account = { id: string; name: string; email: string; role: 'admin' | 'user' };

export async function useCaseHarness() {
  // Fresh app instances isolate rate limits without changing production configuration.
  const moduleUrl = new URL('../app.js', import.meta.url);
  moduleUrl.searchParams.set('useCase', randomUUID());
  const { app } = await import(moduleUrl.href) as typeof import('../app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const ids: string[] = [];
  const request = (path: string, body?: unknown, browserCookie = '', origin?: string) => fetch(`http://127.0.0.1:${address.port}/api/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: browserCookie, ...(origin ? { Origin: origin } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  let fixtureHash: string | undefined;
  return {
    request,
    own(id: string) { ids.push(id); },
    async account(role: Account['role'] = 'user'): Promise<Account> {
      const id = randomUUID(); ids.push(id);
      const account = { id, name: 'Nguyễn Kiểm Thử', email: `use-case-${id}@example.com`, role };
      fixtureHash ??= await hashPassword(originalPassword);
      await pool.query('INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,$3,$4,$5)', [id, account.email, account.name, role, fixtureHash]);
      return account;
    },
    async session(account: Account) {
      const token = newToken();
      await pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(token), account.id]);
      return `traffic_session=${token}`;
    },
    identity(account: Account) { return { email: account.email, name: account.name, phone: '0901234567', accountId: account.id }; },
    async pending(account: Account) {
      const response = await request('recovery-requests', { email: account.email, name: account.name, phone: '0901234567', accountId: account.id });
      assert.equal(response.status, 202);
      return (await pool.query("SELECT id FROM recovery_requests WHERE user_id=$1 AND status='pending'", [account.id])).rows[0].id as string;
    },
    async close() {
      try { await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]); }
      finally { await new Promise<void>(resolve => server.close(() => resolve())); }
    },
  };
}
