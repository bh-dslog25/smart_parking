import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { app } from "./app.js";
import { pool } from "./db.js";
import {
  canCreateAccount,
  digest,
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

test("POST /api/auth/users HTTP endpoint: validation, authentication and role matrix", async () => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api/auth/users`;

  const validPasswordStr = "ValidPassword2026!";
  const validUserPayload = {
    name: "Nguyen Van A",
    email: "nguyenvana@example.com",
    role: "employee",
    password: validPasswordStr,
    confirm: validPasswordStr,
  };

  type UserRecord = {
    id: string;
    email: string;
    name: string;
    role: string;
    active: boolean;
    password_hash: string;
  };
  const mockUsers = new Map<string, UserRecord>();
  const mockSessions = new Map<
    string,
    { token_hash: string; user_id: string; expires_at: Date }
  >();

  const createMockActor = (role: string, active = true, expired = false) => {
    const userId = randomUUID();
    const token = "a"
      .repeat(64)
      .replace(/a/g, () => Math.floor(Math.random() * 16).toString(16));
    const tokenHash = digest(token);
    mockUsers.set(userId, {
      id: userId,
      email: `${role}-${userId.slice(0, 8)}@example.com`,
      name: `Actor ${role}`,
      role,
      active,
      password_hash: "hash",
    });
    mockSessions.set(tokenHash, {
      token_hash: tokenHash,
      user_id: userId,
      expires_at: new Date(Date.now() + (expired ? -1000 : 3600000)),
    });
    return `parking_session=${token}`;
  };

  const adminCookie = createMockActor("admin");
  const managerCookie = createMockActor("manager");
  const employeeCookie = createMockActor("employee");
  const expiredAdminCookie = createMockActor("admin", true, true);

  const mockClient = {
    query: async (sql: string, params: unknown[] = []) => {
      if (
        sql.includes("BEGIN") ||
        sql.includes("COMMIT") ||
        sql.includes("ROLLBACK")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT user_id FROM sessions")) {
        const tokenHash = params[0] as string;
        const session = mockSessions.get(tokenHash);
        if (session && session.expires_at.getTime() > Date.now()) {
          return { rows: [{ user_id: session.user_id }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO users")) {
        const [id, email, name, role, password_hash] = params as [
          string,
          string,
          string,
          string,
          string,
        ];
        for (const u of mockUsers.values()) {
          if (u.email === email) {
            return { rows: [], rowCount: 0 };
          }
        }
        const createdUser: UserRecord = {
          id,
          email,
          name,
          role,
          active: true,
          password_hash,
        };
        mockUsers.set(id, createdUser);
        return { rows: [{ id, email, name, role }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    release: () => {},
  };

  mock.method(pool, "query", async (sql: string, params: unknown[] = []) => {
    if (sql.includes("SELECT u.id,u.role FROM users u JOIN sessions s")) {
      const tokenHash = params[0] as string;
      const session = mockSessions.get(tokenHash);
      if (session && session.expires_at.getTime() > Date.now()) {
        const user = mockUsers.get(session.user_id);
        if (user && user.active) {
          return { rows: [{ id: user.id, role: user.role }], rowCount: 1 };
        }
      }
      return { rows: [], rowCount: 0 };
    }
    return { rows: [], rowCount: 0 };
  });

  mock.method(pool, "connect", async () => mockClient as any);

  const postUsers = (payload: unknown, cookie = "") =>
    fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify(payload),
    });

  try {
    // 1. Unauthenticated -> 401
    const unauth = await postUsers(validUserPayload);
    assert.equal(unauth.status, 401);
    const unauthBody = await unauth.json();
    assert.equal(unauthBody.message, "Vui lòng đăng nhập.");

    // 2. Input validation failures -> 400
    // Missing name
    const badName = await postUsers(
      { ...validUserPayload, name: "   " },
      adminCookie,
    );
    assert.equal(badName.status, 400);

    // Name too long (>200)
    const longName = await postUsers(
      { ...validUserPayload, name: "A".repeat(201) },
      adminCookie,
    );
    assert.equal(longName.status, 400);

    // Invalid email
    const badEmail = await postUsers(
      { ...validUserPayload, email: "invalid-email" },
      adminCookie,
    );
    assert.equal(badEmail.status, 400);

    // Password < 12
    const shortPass = await postUsers(
      { ...validUserPayload, password: "short", confirm: "short" },
      adminCookie,
    );
    assert.equal(shortPass.status, 400);

    // Password > 128
    const longPass = await postUsers(
      {
        ...validUserPayload,
        password: "a".repeat(129),
        confirm: "a".repeat(129),
      },
      adminCookie,
    );
    assert.equal(longPass.status, 400);

    // Password mismatch
    const mismatch = await postUsers(
      { ...validUserPayload, confirm: "DifferentPassword123!" },
      adminCookie,
    );
    assert.equal(mismatch.status, 400);

    // Invalid role
    const badRole = await postUsers(
      { ...validUserPayload, role: "customer" },
      adminCookie,
    );
    assert.equal(badRole.status, 400);

    // 3. Expired session -> 401
    const expiredRes = await postUsers(validUserPayload, expiredAdminCookie);
    assert.equal(expiredRes.status, 401);
    const expiredBody = await expiredRes.json();
    assert.equal(expiredBody.message, "Phiên đăng nhập đã hết hạn.");

    // 4. Role authorization: Employee cannot create any account -> 403
    const empTryEmp = await postUsers(
      { ...validUserPayload, email: "e1@example.com", role: "employee" },
      employeeCookie,
    );
    assert.equal(empTryEmp.status, 403);

    // 5. Role authorization: Manager cannot create Admin or Manager -> 403
    const mgrTryAdm = await postUsers(
      { ...validUserPayload, email: "m1@example.com", role: "admin" },
      managerCookie,
    );
    assert.equal(mgrTryAdm.status, 403);
    const mgrTryMgr = await postUsers(
      { ...validUserPayload, email: "m2@example.com", role: "manager" },
      managerCookie,
    );
    assert.equal(mgrTryMgr.status, 403);

    // 6. Role authorization: Manager CAN create Employee -> 201
    const mgrCreateEmp = await postUsers(
      {
        ...validUserPayload,
        email: "emp-by-mgr@example.com",
        role: "employee",
      },
      managerCookie,
    );
    assert.equal(mgrCreateEmp.status, 201);
    const mgrEmpBody = await mgrCreateEmp.json();
    assert.equal(mgrEmpBody.user.role, "employee");
    assert.equal(mgrEmpBody.user.password_hash, undefined);

    // 7. Role authorization: Admin can create all three roles -> 201
    const admCreateAdm = await postUsers(
      { ...validUserPayload, email: "adm-by-adm@example.com", role: "admin" },
      adminCookie,
    );
    assert.equal(admCreateAdm.status, 201);
    const admAdmBody = await admCreateAdm.json();
    assert.equal(admAdmBody.user.role, "admin");

    const admCreateMgr = await postUsers(
      {
        ...validUserPayload,
        email: "mgr-by-adm@example.com",
        role: "manager",
      },
      adminCookie,
    );
    assert.equal(admCreateMgr.status, 201);
    const admMgrBody = await admCreateMgr.json();
    assert.equal(admMgrBody.user.role, "manager");

    const admCreateEmp = await postUsers(
      {
        ...validUserPayload,
        email: "emp-by-adm@example.com",
        role: "employee",
      },
      adminCookie,
    );
    assert.equal(admCreateEmp.status, 201);
    const admEmpBody = await admCreateEmp.json();
    assert.equal(admEmpBody.user.role, "employee");

    // 8. Duplicate email conflict -> 409
    const dupRes = await postUsers(
      {
        ...validUserPayload,
        email: "emp-by-adm@example.com",
        role: "employee",
      },
      adminCookie,
    );
    assert.equal(dupRes.status, 409);
    const dupBody = await dupRes.json();
    assert.equal(
      dupBody.message,
      "Email đã được sử dụng. Vui lòng chọn email khác.",
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
