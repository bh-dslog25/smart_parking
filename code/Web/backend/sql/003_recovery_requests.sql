BEGIN;
CREATE TABLE IF NOT EXISTS recovery_requests (
 id UUID PRIMARY KEY,
 user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 request_name TEXT NOT NULL,
 request_email TEXT NOT NULL,
 request_phone TEXT NOT NULL,
 request_account_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 reviewed_at TIMESTAMPTZ,
 reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
 review_note TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS recovery_pending_user_idx ON recovery_requests(user_id) WHERE status='pending';
CREATE TABLE IF NOT EXISTS temporary_admin_accounts (
 user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMIT;
