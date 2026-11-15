import test from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  newToken,
  digest,
  validEmail,
  validPassword,
  validAccountRole,
  canCreateAccount,
} from "./security.js";
test("password hashes use independent salts and reject a wrong password", async () => {
  const password = "Secure parking password 2026!";
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(password, a), true);
  assert.equal(await verifyPassword("wrong password", a), false);
  assert.equal(await verifyPassword(password, "malformed"), false);
});
test("session and reset tokens are random and stored as digests", () => {
  const a = newToken(),
    b = newToken();
  assert.match(a, /^[a-f0-9]{64}$/);
  assert.notEqual(a, b);
  assert.notEqual(digest(a), a);
  assert.equal(digest(a), digest(a));
});
test("credential validation enforces email shape and password bounds", () => {
  assert.equal(validEmail("staff@example.com"), true);
  for (const email of ["bad", "a@b", "a b@example.com", null])
    assert.equal(validEmail(email), false);
  assert.equal(validPassword("long enough password"), true);
  assert.equal(validPassword("short"), false);
  assert.equal(validPassword("a".repeat(129)), false);
});
test("account role validation and creation authorization hierarchy", () => {
  // validAccountRole checks allowed staff/admin roles
  assert.equal(validAccountRole("admin"), true);
  assert.equal(validAccountRole("manager"), true);
  assert.equal(validAccountRole("employee"), true);
  assert.equal(validAccountRole("customer"), false);
  assert.equal(validAccountRole("unknown"), false);
  assert.equal(validAccountRole(null), false);
  assert.equal(validAccountRole(undefined), false);

  // Admin actor can create admin, manager, employee
  assert.equal(canCreateAccount("admin", "admin"), true);
  assert.equal(canCreateAccount("admin", "manager"), true);
  assert.equal(canCreateAccount("admin", "employee"), true);
  assert.equal(canCreateAccount("admin", "customer"), false);
  assert.equal(canCreateAccount("admin", "other"), false);

  // Manager actor can only create employee
  assert.equal(canCreateAccount("manager", "employee"), true);
  assert.equal(canCreateAccount("manager", "manager"), false);
  assert.equal(canCreateAccount("manager", "admin"), false);
  assert.equal(canCreateAccount("manager", "customer"), false);

  // Employee, customer, or invalid actors cannot create any accounts
  for (const role of ["employee", "customer", "guest", ""]) {
    assert.equal(canCreateAccount(role, "employee"), false);
    assert.equal(canCreateAccount(role, "manager"), false);
    assert.equal(canCreateAccount(role, "admin"), false);
  }
});
