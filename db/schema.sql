-- ============================================================
--  Կալենդար v2.1 — Rooms / Channels / Subscriptions / Todos
--  users    — օգտատերեր (բոլորը հավասար)
--  rooms    — ժամանակացույց + ունիկալ կանալ
--  subscriptions — բաժանորդագրումներ (բաժանորդը ՈՒՂԻՂ տեսնում է կանալի դասերը)
--  lessons  — դասեր (պատկանում են սենյակին/կանալին)
--  todos    — օգտատիրոջ անձնական գործերի ցանկ (օրացույցում)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  password_hash TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id         SERIAL PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  channel    TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS lessons (
  id          SERIAL PRIMARY KEY,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  topic       TEXT,
  lesson_date DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled | done | cancelled
  series_id   TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Հրավերների (accept/decline) ֆունկցիան հանված է → բաժանորդն ուղիղ տեսնում է դասերը.
DROP TABLE IF EXISTS lesson_invites CASCADE;

CREATE TABLE IF NOT EXISTS todos (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  todo_date  DATE NOT NULL,
  todo_time  TIME,
  title      TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lessons_room   ON lessons(room_id);
CREATE INDEX IF NOT EXISTS idx_lessons_series ON lessons(series_id);
CREATE INDEX IF NOT EXISTS idx_subs_user      ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_room      ON subscriptions(room_id);
CREATE INDEX IF NOT EXISTS idx_todos_user     ON todos(user_id, todo_date);
