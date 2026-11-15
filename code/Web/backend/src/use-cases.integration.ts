import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from './db.js';
import { digest, newToken, verifyPassword } from './security.js';
import { createTemporaryAdmin, pruneTemporaryAdmins } from './temporary-admin.js';
import { smtpInbox } from './testing/smtp.js';
import { cookie, originalPassword, updatedPassword, useCaseHarness } from './testing/use-case-harness.js';

test('Implemented use cases — real HTTP, PostgreSQL and captured SMTP email', async t => {
  const inbox = await smtpInbox();
  const keys = ['SMTP_HOST','SMTP_PORT','SMTP_FROM','SMTP_USER','SMTP_PASS'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = String(inbox.port);
  process.env.SMTP_FROM = 'traffic-tests@example.com'; delete process.env.SMTP_USER; delete process.env.SMTP_PASS;
  try {
    await t.test('UC01 Đăng nhập — both roles, invalid credentials, session cookies, expiry and logout', async () => {
      const h = await useCaseHarness();
      try {
        assert.equal((await h.request('me')).status, 401);
        for (const role of ['admin','user'] as const) {
          const account = await h.account(role);
          const result = await h.request('login', { email: account.email, password: originalPassword });
          assert.equal(result.status, 200);
          assert.deepEqual((await result.json()).user, account);
          assert.match(result.headers.get('set-cookie')!, /HttpOnly.*SameSite=Lax/i);
          assert.doesNotMatch(result.headers.get('set-cookie')!, /Max-Age/i);
          const ordinary = cookie(result);
          assert.equal((await h.request('me', undefined, ordinary)).status, 200);
          const remembered = await h.request('login', { email: account.email, password: originalPassword, remember: true }, ordinary);
          assert.match(remembered.headers.get('set-cookie')!, /Max-Age=2592000/);
          assert.equal((await h.request('me', undefined, ordinary)).status, 401);
          const rememberedCookie = cookie(remembered);
          assert.equal((await h.request('logout', {}, rememberedCookie)).status, 204);
          assert.equal((await h.request('me', undefined, rememberedCookie)).status, 401);
          assert.equal((await h.request('login', { email: account.email, password: 'wrong password' })).status, 401);
          await pool.query('UPDATE users SET active=false WHERE id=$1', [account.id]);
          assert.equal((await h.request('login', { email: account.email, password: originalPassword })).status, 401);
        }
        assert.equal((await h.request('login', { email: 'invalid', password: originalPassword })).status, 400);
        assert.equal((await h.request('login', { email: `missing-${randomUUID()}@example.com`, password: originalPassword })).status, 401);
        assert.equal((await h.request('login', { email: 'test@example.com', password: originalPassword }, '', 'https://untrusted.example')).status, 403);
        const expiredAccount = await h.account();
        const expiredCookie = await h.session(expiredAccount);
        await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [expiredAccount.id]);
        assert.equal((await h.request('me', undefined, expiredCookie)).status, 401);
      } finally { await h.close(); }
    });

    await t.test('UC02 Đổi mật khẩu — email OTP required, confirmation, single use and session revocation', async () => {
      const h = await useCaseHarness();
      try {
        for (const role of ['admin','user'] as const) {
          const account = await h.account(role), session = await h.session(account), second = await h.session(account);
          if (role === 'user') await h.pending(account);
          assert.equal((await h.request('change-password', { password: updatedPassword, confirm: updatedPassword }, session)).status, 400);
          const issued = await h.request('forgot-password', role === 'admin' ? { email: account.email } : h.identity(account));
          const { challengeId } = await issued.json();
          const verified = await h.request('verify-otp', { challengeId, code: inbox.latestCode(account.email) }, cookie(issued));
          assert.equal(verified.status, 200);
          const { token } = await verified.json();
          assert.equal((await h.request('change-password', { token, password: updatedPassword, confirm: 'mismatch' }, session)).status, 400);
          assert.equal((await h.request('change-password', { token, password: updatedPassword, confirm: updatedPassword }, session)).status, 200);
          for (const old of [session, second]) assert.equal((await h.request('me', undefined, old)).status, 401);
          assert.equal((await h.request('verify-reset', { token })).status, 400);
          assert.equal((await h.request('login', { email: account.email, password: originalPassword })).status, 401);
          assert.equal((await h.request('login', { email: account.email, password: updatedPassword })).status, 200);
          if (role === 'user') assert.equal((await pool.query('SELECT status FROM recovery_requests WHERE user_id=$1', [account.id])).rows[0].status, 'rejected');
        }
      } finally { await h.close(); }
    });

    await t.test('UC03 Quên mật khẩu — complete emailed recovery, hidden account existence and admin email-only recovery', async () => {
      const h = await useCaseHarness();
      try {
        const account = await h.account(), session = await h.session(account);
        await h.pending(account);
        const before = inbox.messages.length;
        const unknown = await h.request('forgot-password', { ...h.identity(account), email: `missing-${randomUUID()}@example.com` });
        assert.equal(unknown.status, 200); assert.equal(inbox.messages.length, before);
        const issued = await h.request('forgot-password', h.identity(account));
        const data = await issued.json();
        assert.equal(data.message, (await unknown.json()).message);
        assert.equal(data.code, undefined); assert.equal(data.token, undefined);
        assert.equal(inbox.messages.length, before + 1);
        const verified = await h.request('verify-otp', { challengeId: data.challengeId, code: inbox.latestCode(account.email) }, cookie(issued));
        const { token } = await verified.json();
        const reset = (password: string, confirm = password) => h.request('reset-password', { token, password, confirm });
        assert.equal((await reset('short')).status, 400);
        assert.equal((await reset(updatedPassword, 'mismatch')).status, 400);
        assert.equal((await reset(updatedPassword)).status, 200);
        assert.equal((await reset(updatedPassword)).status, 400);
        assert.equal((await h.request('me', undefined, session)).status, 401);
        assert.equal((await h.request('login', { email: account.email, password: updatedPassword })).status, 200);
        assert.equal((await pool.query('SELECT status FROM recovery_requests WHERE user_id=$1', [account.id])).rows[0].status, 'rejected');
        const admin = await h.account('admin');
        const adminRecovery = await h.request('forgot-password', { email: admin.email });
        assert.equal(adminRecovery.status, 200); assert.match(inbox.latestCode(admin.email), /^\d{6}$/);
        assert.equal((await pool.query('SELECT request_phone FROM email_otps WHERE user_id=$1', [admin.id])).rows[0].request_phone, null);
      } finally { await h.close(); }
    });

    await t.test('UC04 Tạo tài khoản — admin creates both roles; validation, duplicate email and access restrictions', async () => {
      const h = await useCaseHarness();
      try {
        const admin = await h.account('admin'), user = await h.account();
        const session = await h.session(admin), ordinary = await h.session(user);
        const payload = { name: 'Created account', email: `created-${randomUUID()}@example.com`, role: 'user', password: originalPassword, confirm: originalPassword };
        assert.equal((await h.request('users', payload)).status, 401);
        assert.equal((await h.request('users', payload, ordinary)).status, 403);
        for (const role of ['admin','user']) {
          const email = `created-${randomUUID()}@example.com`;
          const result = await h.request('users', { ...payload, role, email }, session);
          assert.equal(result.status, 201);
          const { user: created } = await result.json(); h.own(created.id);
          assert.equal(created.role, role); assert.equal(created.password_hash, undefined);
          assert.equal((await h.request('login', { email, password: originalPassword })).status, 200);
          const stored = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [created.id])).rows[0].password_hash;
          assert.notEqual(stored, originalPassword); assert.ok(await verifyPassword(originalPassword, stored));
          assert.equal((await h.request('users', { ...payload, email }, session)).status, 409);
        }
        for (const invalid of [{ name: ' ' }, { email: 'invalid' }, { password: 'short', confirm: 'short' }, { confirm: 'mismatch' }, { role: 'manager' }, { role: 'employee' }]) {
          assert.equal((await h.request('users', { ...payload, ...invalid }, session)).status, 400);
        }
        await pool.query('UPDATE users SET active=false WHERE id=$1', [admin.id]);
        assert.equal((await h.request('users', payload, session)).status, 401);
      } finally { await h.close(); }
    });

    await t.test('UC05 Tạo yêu cầu đổi mật khẩu — personal details, non-disclosure, deduplication and submission limit', async () => {
      const h = await useCaseHarness();
      try {
        const account = await h.account(), admin = await h.account('admin');
        const details = h.identity(account);
        for (const invalid of [{ name: '' }, { email: 'invalid' }, { phone: 'bad' }, { accountId: 'invalid' }]) assert.equal((await h.request('recovery-requests', { ...details, ...invalid })).status, 400);
        const mismatch = await h.request('recovery-requests', { ...details, name: 'Wrong name' });
        const missing = await h.request('recovery-requests', { ...details, accountId: randomUUID() });
        assert.equal((await h.request('recovery-requests', h.identity(admin))).status, 202);
        const submitted = await h.request('recovery-requests', details);
        assert.equal(submitted.status, 202);
        const response = await submitted.json();
        assert.deepEqual(await mismatch.json(), response); assert.deepEqual(await missing.json(), response);
        assert.equal((await h.request('recovery-requests', details)).status, 202);
        const rows = (await pool.query('SELECT * FROM recovery_requests WHERE user_id=$1', [account.id])).rows;
        assert.equal(rows.length, 1);
        for (const [key, value] of Object.entries({ request_name: details.name, request_email: details.email, request_phone: details.phone, request_account_id: details.accountId, status: 'pending' })) assert.equal(rows[0][key], value);
        assert.equal((await pool.query('SELECT * FROM recovery_requests WHERE user_id=$1', [admin.id])).rowCount, 0);
        const inactive = await h.account();
        await pool.query('UPDATE users SET active=false WHERE id=$1', [inactive.id]);
        assert.equal((await h.request('recovery-requests', h.identity(inactive))).status, 202);
        assert.equal((await pool.query('SELECT * FROM recovery_requests WHERE user_id=$1', [inactive.id])).rowCount, 0);
        assert.equal((await h.request('recovery-requests', details)).status, 429);
      } finally { await h.close(); }
    });

    await t.test('UC06 Xác thực người dùng — real email, cookie binding, cooldown, attempts, expiry, replay and delivery failure', async () => {
      const h = await useCaseHarness();
      try {
        const account = await h.account();
        const initial = await h.request('forgot-password', h.identity(account));
        const { challengeId } = await initial.json(), browserCookie = cookie(initial);
        const code = inbox.latestCode(account.email), before = inbox.messages.length;
        const retry = await h.request('forgot-password', h.identity(account), browserCookie);
        assert.equal((await retry.json()).challengeId, challengeId); assert.equal(inbox.messages.length, before);
        const verify = (value = code, browser = browserCookie, challenge = challengeId) => h.request('verify-otp', { challengeId: challenge, code: value }, browser);
        assert.equal((await verify(code, '')).status, 400);
        assert.equal((await verify(code, browserCookie, newToken())).status, 400);
        assert.equal((await verify('abc123')).status, 400);
        const wrong = code === '000000' ? '000001' : '000000';
        for (let i = 1; i <= 5; i++) {
          assert.equal((await verify(wrong)).status, 400);
          assert.equal((await pool.query('SELECT attempts FROM email_otps WHERE user_id=$1', [account.id])).rows[0].attempts, i);
        }
        assert.equal((await verify()).status, 400);
        await pool.query("UPDATE email_otps SET attempts=0,expires_at=now()-interval '1 second' WHERE user_id=$1", [account.id]);
        assert.equal((await verify()).status, 400);
        await pool.query("UPDATE email_otps SET created_at=now()-interval '61 seconds' WHERE user_id=$1", [account.id]);
        const reissued = await h.request('forgot-password', h.identity(account));
        const next = await reissued.json();
        const verified = await h.request('verify-otp', { challengeId: next.challengeId, code: inbox.latestCode(account.email) }, cookie(reissued));
        assert.equal(verified.status, 200);
        const { token } = await verified.json(); assert.match(token, /^[a-f0-9]{64}$/);
        assert.equal((await h.request('verify-otp', { challengeId: next.challengeId, code: inbox.latestCode(account.email) }, cookie(reissued))).status, 400);
        const stored = (await pool.query('SELECT token_hash FROM password_resets WHERE user_id=$1', [account.id])).rows[0];
        assert.equal(stored.token_hash, digest(token)); assert.notEqual(stored.token_hash, token);
        await pool.query("UPDATE password_resets SET expires_at=now()-interval '1 second' WHERE user_id=$1", [account.id]);
        assert.equal((await h.request('reset-password', { token, password: updatedPassword, confirm: updatedPassword })).status, 400);
      } finally { await h.close(); }
      // A separate app avoids changing rate limits to test a mail-server failure.
      const delivery = await useCaseHarness();
      try {
        const account = await delivery.account(); inbox.failDelivery(true);
        assert.equal((await delivery.request('forgot-password', delivery.identity(account))).status, 200);
        assert.equal((await pool.query('SELECT * FROM email_otps WHERE user_id=$1', [account.id])).rowCount, 0);
      } finally { inbox.failDelivery(false); await delivery.close(); }
    });

    await t.test('UC07 Xử lý yêu cầu — admin view, reject, approve, audit, revocation and concurrent review', async () => {
      const h = await useCaseHarness();
      try {
        const admin = await h.account('admin'), user = await h.account();
        const adminCookie = await h.session(admin), userCookie = await h.session(user);
        const first = await h.pending(user);
        const review = (id: string, body: unknown, actor = adminCookie) => h.request(`recovery-requests/${id}/review`, body, actor);
        assert.equal((await h.request('recovery-requests')).status, 401);
        assert.equal((await h.request('recovery-requests', undefined, userCookie)).status, 403);
        const list = await h.request('recovery-requests', undefined, adminCookie);
        const found = (await list.json()).requests.find((row: any) => row.id === first);
        assert.equal(found.request_email, user.email); assert.equal(found.request_phone, '0901234567');
        assert.equal((await review(first, { decision: 'reject' }, '')).status, 401);
        assert.equal((await review(first, { decision: 'reject' }, userCookie)).status, 403);
        for (const body of [{ decision: 'invalid' }, { decision: 'approve', password: 'short', confirm: 'short' }, { decision: 'approve', password: updatedPassword, confirm: 'mismatch' }, { decision: 'reject', note: 'x'.repeat(1001) }]) assert.equal((await review(first, body)).status, 400);
        assert.equal((await review(randomUUID(), { decision: 'reject' })).status, 404);
        const hash = (await pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0].password_hash;
        assert.equal((await review(first, { decision: 'reject', note: 'Identity not confirmed' })).status, 200);
        assert.equal((await pool.query('SELECT password_hash FROM users WHERE id=$1', [user.id])).rows[0].password_hash, hash);
        assert.equal((await h.request('me', undefined, userCookie)).status, 200);
        assert.equal((await review(first, { decision: 'reject' })).status, 409);
        const second = await h.pending(user);
        await h.request('forgot-password', h.identity(user));
        const token = newToken();
        await pool.query("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')", [digest(token), user.id]);
        const approved = { decision: 'approve', password: updatedPassword, confirm: updatedPassword, note: 'Identity confirmed' };
        const results = await Promise.all([review(second, approved), review(second, approved)]);
        assert.deepEqual(results.map(response => response.status).sort(), [200, 409]);
        for (const table of ['sessions','email_otps','password_resets']) assert.equal((await pool.query(`SELECT * FROM ${table} WHERE user_id=$1`, [user.id])).rowCount, 0);
        const audit = (await pool.query('SELECT * FROM recovery_requests WHERE id=$1', [second])).rows[0];
        assert.equal(audit.status, 'approved'); assert.equal(audit.reviewed_by, admin.id); assert.equal(audit.review_note, 'Identity confirmed'); assert.ok(audit.reviewed_at);
        assert.equal((await h.request('login', { email: user.email, password: originalPassword })).status, 401);
        assert.equal((await h.request('login', { email: user.email, password: updatedPassword })).status, 200);
        await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1", [admin.id]);
        assert.equal((await h.request('recovery-requests', undefined, adminCookie)).status, 401);
      } finally { await h.close(); }
    });

    await t.test('UC08 Server-local temporary admin — provisioning, persistent child accounts and deletion', async () => {
      const h = await useCaseHarness();
      let temporary: Awaited<ReturnType<typeof createTemporaryAdmin>> | undefined;
      try {
        await assert.rejects(createTemporaryAdmin('', 'invalid', 'short'), /Enter a name/);
        const permanent = await h.account('admin');
        await assert.rejects(createTemporaryAdmin('Collision', permanent.email, originalPassword), /already exists/);
        const email = `temporary-use-case-${randomUUID()}@example.com`;
        temporary = await createTemporaryAdmin('Local operator', email, originalPassword);
        const login = await h.request('login', { email, password: originalPassword }); assert.equal(login.status, 200);
        assert.equal((await login.json()).user.role, 'admin');
        const browserCookie = cookie(login);
        const created = await h.request('users', { name: 'Persistent admin', email: `persistent-${randomUUID()}@example.com`, role: 'admin', password: originalPassword, confirm: originalPassword }, browserCookie);
        assert.equal(created.status, 201); const { user } = await created.json(); h.own(user.id);
        await pruneTemporaryAdmins();
        assert.equal((await h.request('me', undefined, browserCookie)).status, 200);
        await temporary.remove(); await temporary.remove();
        assert.equal((await h.request('me', undefined, browserCookie)).status, 401);
        assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [temporary.id])).rowCount, 0);
        assert.equal((await h.request('login', { email: user.email, password: originalPassword })).status, 200);
        assert.equal((await pool.query('SELECT id FROM users WHERE id=$1', [permanent.id])).rowCount, 1);
      } finally { await temporary?.remove(); await h.close(); }
    });
  } finally {
    await inbox.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await pool.end();
  }
});
