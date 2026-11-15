import test from "node:test";
import assert from "node:assert/strict";
import {
  canCreateAccount,
  validAccountRole,
  validEmail,
  validPassword,
} from "./security.js";

test("account creation validation: email bounds and formats", () => {
  // Valid emails
  assert.equal(validEmail("admin@example.com"), true);
  assert.equal(validEmail("quanly@smartparking.vn"), true);
  assert.equal(validEmail("nhanvien.soatve@sub.domain.org"), true);

  // Invalid emails
  assert.equal(validEmail(""), false);
  assert.equal(validEmail("   "), false);
  assert.equal(validEmail("plainaddress"), false);
  assert.equal(validEmail("@missingusername.com"), false);
  assert.equal(validEmail("username@.com"), false);
  assert.equal(validEmail("user name@example.com"), false);
  assert.equal(validEmail(null), false);
  assert.equal(validEmail(undefined), false);
  assert.equal(validEmail(12345), false);
  // Max length 254
  assert.equal(validEmail(`${"a".repeat(242)}@example.com`), true);
  assert.equal(validEmail(`${"a".repeat(243)}@example.com`), false);
});

test("account creation validation: password policy and confirmation", () => {
  // Valid bounds: 12 to 128 characters
  assert.equal(validPassword("123456789012"), true);
  assert.equal(validPassword("A very strong password! 2026"), true);
  assert.equal(validPassword("x".repeat(128)), true);

  // Invalid: < 12 characters
  assert.equal(validPassword("12345678901"), false);
  assert.equal(validPassword(""), false);
  assert.equal(validPassword("short"), false);

  // Invalid: > 128 characters
  assert.equal(validPassword("x".repeat(129)), false);

  // Non-string types
  assert.equal(validPassword(null), false);
  assert.equal(validPassword(undefined), false);
  assert.equal(validPassword(1234567890123), false);
});

test("account creation validation: allowed target roles in system", () => {
  // Allowed staff roles in use case diagram: admin, manager, employee
  assert.equal(validAccountRole("admin"), true);
  assert.equal(validAccountRole("manager"), true);
  assert.equal(validAccountRole("employee"), true);

  // Customer or arbitrary string cannot be created via staff creation flow
  assert.equal(validAccountRole("customer"), false);
  assert.equal(validAccountRole("superadmin"), false);
  assert.equal(validAccountRole("root"), false);
  assert.equal(validAccountRole(""), false);
  assert.equal(validAccountRole(null), false);
});

test("use case diagram permission matrix: Admin actor", () => {
  // Diagram: "Tạo tài khoản(Admin là actor).png"
  // Admin can create:
  // 1. Tạo tài khoản admin
  // 2. Tạo tài khoản quản lý
  // 3. Tạo tài khoản nhân viên
  assert.equal(canCreateAccount("admin", "admin"), true);
  assert.equal(canCreateAccount("admin", "manager"), true);
  assert.equal(canCreateAccount("admin", "employee"), true);

  // Admin cannot create unauthorized roles
  assert.equal(canCreateAccount("admin", "customer"), false);
  assert.equal(canCreateAccount("admin", "superuser"), false);
});

test("use case diagram permission matrix: Quản lý (Manager) actor", () => {
  // Diagram: "Tạo tài khoản(Quản lý là actor).png"
  // Quản lý can ONLY create:
  // 1. Tạo tài khoản nhân viên
  assert.equal(canCreateAccount("manager", "employee"), true);

  // Quản lý CANNOT create manager or admin
  assert.equal(canCreateAccount("manager", "manager"), false);
  assert.equal(canCreateAccount("manager", "admin"), false);
  assert.equal(canCreateAccount("manager", "customer"), false);
  assert.equal(canCreateAccount("manager", "other"), false);
});

test("use case diagram permission matrix: Unauthorized actors", () => {
  // Employee, Customer, Guest have no permission to create accounts
  const unauthorizedActors = ["employee", "customer", "guest", "anonymous", ""];
  const allRoles = ["admin", "manager", "employee", "customer"];

  for (const actor of unauthorizedActors) {
    for (const target of allRoles) {
      assert.equal(
        canCreateAccount(actor, target),
        false,
        `Actor '${actor}' should not be able to create '${target}'`,
      );
    }
  }
});
