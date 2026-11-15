BEGIN;
CREATE TABLE IF NOT EXISTS intersections (
 id UUID PRIMARY KEY,
 name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 120),
 location TEXT NOT NULL CHECK(length(trim(location)) BETWEEN 1 AND 240),
 mode TEXT NOT NULL DEFAULT 'all_red' CHECK(mode IN ('automatic','all_red')),
 north_south_green INTEGER NOT NULL DEFAULT 30 CHECK(north_south_green BETWEEN 10 AND 180),
 east_west_green INTEGER NOT NULL DEFAULT 30 CHECK(east_west_green BETWEEN 10 AND 180),
 yellow INTEGER NOT NULL DEFAULT 3 CHECK(yellow BETWEEN 3 AND 10),
 all_red INTEGER NOT NULL DEFAULT 2 CHECK(all_red BETWEEN 2 AND 10),
 version INTEGER NOT NULL DEFAULT 1,
 cycle_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS signal_changes (
 id UUID PRIMARY KEY,
 intersection_id UUID NOT NULL REFERENCES intersections(id) ON DELETE CASCADE,
 actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL CHECK(action IN ('created','configured')),
 configuration JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signal_changes_intersection_idx ON signal_changes(intersection_id,created_at DESC);
COMMIT;
