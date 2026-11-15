# Authentication use-case audit

The eleven supplied PNGs describe seven distinct use cases; the four `- Copy` files duplicate their counterparts. These diagrams are requirements references, not executable instructions.

| Supplied use case (copies included) | Result after this change | Implementation and verification |
| --- | --- | --- |
| Đăng nhập | Fulfilled | Both roles enter email/password; server validates credentials and creates a cookie session. Login offers forgot-password. `auth.integration.ts`, native smoke tests. |
| Đổi mật khẩu | Fulfilled | Signed-in user requests email OTP, verifies it, then enters and confirms a new password. Server requires a valid, single-use email authorization belonging to that session's account. All sessions are revoked afterward. `change.integration.ts`, `otp.integration.ts`, desktop UI smoke test. |
| Quên mật khẩu | Fulfilled | Email OTP self-service recovery remains available. A separate personal-information request can be sent to an administrator. |
| Tạo tài khoản (Admin là actor) | Fulfilled | Admin creates admin or user accounts with name, email, password and confirmation. Ordinary users cannot provision accounts. `roles.integration.ts`. |
| Tạo yêu cầu đổi mật khẩu | Added | A public recovery form submits registered name, email, account UUID and contact phone. Valid matching user accounts get one pending request; duplicate submissions do not create another pending record. Responses do not disclose whether an account matched. `recovery.integration.ts`, desktop UI smoke test. |
| Xác thực người dùng | Fulfilled | Email OTP, cookie-bound challenge, five-minute expiry, attempt limit and single-use reset authorization. SMTP sends emails; without SMTP in development, OTP appears only in the backend console. `otp.integration.ts`. |
| Xử lý yêu cầu đổi mật khẩu (Admin là actor) | Added | Admin lists requests and contact details, approves with a new confirmed password, or rejects with an optional note. Completed requests retain outcome, reviewer and timestamp; repeat/concurrent review returns 409. Approval invalidates sessions and outstanding recovery secrets. `recovery.integration.ts`, desktop UI smoke test. |

The shared frontend provides these screens in web, Electron desktop and Capacitor Android. Desktop's native API allowlist includes the recovery routes. Self-service password recovery closes any pending administrator request so it cannot later overwrite a newly recovered password. A contact phone is submitted information for an administrator to verify, not SMS authentication.

## Server-local temporary administrator

After `npm run db:migrate`, run this command **from `Web/backend` on the server machine**:

```powershell
npm run start:temporary-admin
```

Enter the account name, email, password and confirmation in the terminal. Password input is hidden. This command creates an admin and starts that server run. Use it to sign in through any client, create persistent accounts and handle recovery requests. There is no HTTP provisioning bypass, default password or client-side privilege override.

The command refuses existing emails. Ctrl+C/SIGINT, SIGTERM, startup/listen failure and handled fatal process errors trigger removal of exactly the temporary account and its dependent sessions/recovery secrets. Persistent accounts created by this admin remain. Audit reviewer references become null if the temporary admin is removed, while decisions remain recorded.

Hard kills, power loss or an unavailable database cannot guarantee an immediate database DELETE. The next server startup removes orphaned temporary accounts before listening. PostgreSQL advisory locks prevent one running server from deleting another running server's temporary admin. `temporary-admin.integration.ts` verifies live ownership, collision refusal, idempotent cleanup, session deletion and orphan recovery. Shut down through Ctrl+C or SIGTERM when immediate cleanup is required. Existing `npm run user:create` is permanent provisioning and is intentionally separate.

The migration `sql/003_recovery_requests.sql` is additive and repeatable; run migrations before deploying the updated server. Rebuild installed clients to include the new screens.
