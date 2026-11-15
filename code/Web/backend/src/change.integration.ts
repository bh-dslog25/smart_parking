import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { pool } from "./db.js";
import { digest, hashPassword, newToken } from "./security.js";

test("authenticated password change and recovery verification", async () => {
  const id = randomUUID();
  const otherId = randomUUID();
  const password = "Original password 2026!";
  const next = "Updated password 2026!";
  const email = `change-${id}@example.com`;
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const request = (path: string, body: unknown, cookie = "") => fetch(`http://127.0.0.1:${address.port}/api/auth/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body),
  });
  try {
    await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Change test','user',$3)", [id, email, await hashPassword(password)]);
    await pool.query("INSERT INTO users(id,email,name,role,password_hash) VALUES($1,$2,'Other test','user',$3)", [otherId, `other-${email}`, await hashPassword(password)]);
    assert.equal((await request("change-password", { password: next, confirm: next })).status, 401);
    const login = await request("login", { email, password });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    assert.equal((await request("change-password", { password: next, confirm: "mismatch" }, cookie)).status, 400);
    assert.equal((await request("change-password", { password: "short", confirm: "short" }, cookie)).status, 400);
    const token = newToken();
    await pool.query("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '15 minutes')", [digest(token), id]);
    assert.equal((await request("verify-reset", { token })).status, 200);
    assert.equal((await request("reset-password", { token, password: next, confirm: "mismatch" })).status, 400);
    assert.equal((await request("change-password", { password: next, confirm: next }, cookie)).status, 400);
    const otherToken = newToken(), expiredToken = newToken();
    await pool.query("INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '15 minutes'),($3,$4,now()-interval '1 second')", [digest(otherToken), otherId, digest(expiredToken), id]);
    assert.equal((await request('change-password', { token: otherToken, password: next, confirm: next }, cookie)).status, 400);
    assert.equal((await request('change-password', { token: expiredToken, password: next, confirm: next }, cookie)).status, 400);
    assert.equal((await pool.query('SELECT * FROM password_resets WHERE token_hash=$1', [digest(otherToken)])).rowCount, 1);
    await pool.query("INSERT INTO recovery_requests(id,user_id,request_name,request_email,request_phone,request_account_id) SELECT $1,id,name,email,'0901234567',id::text FROM users WHERE id=$2", [randomUUID(), id]);
    assert.equal((await request("change-password", { token, password: next, confirm: next }, cookie)).status, 200);
    assert.equal((await pool.query('SELECT status FROM recovery_requests WHERE user_id=$1', [id])).rows[0].status, 'rejected');
    assert.equal((await request("change-password", { password, confirm: password }, cookie)).status, 401);
    assert.equal((await request("verify-reset", { token })).status, 400);
    assert.equal((await request("login", { email, password })).status, 401);
    assert.equal((await request("login", { email, password: next })).status, 200);
    assert.equal((await pool.query("SELECT * FROM password_resets WHERE user_id=$1", [id])).rowCount, 0);
  } finally {
    try { await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[id, otherId]]); }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await pool.end();
    }
  }
});
