-- ============================================================
--  Կալենդար v2 — Rooms / Channels / Subscriptions / Messages
--  users    — օգտատերեր (բոլորը հավասար)
--  rooms    — ժամանակացույց + ունիկալ կանալ
--  subscriptions — ո՞վ ո՞ր կանալին է բաժանորդագրված
--  lessons  — դասեր (պատկանում են սենյակին/կանալին)
--  lesson_invites — «Հաղորդագրություններ»: հրավերներ բաժանորդներին
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
  channel    TEXT UNIQUE NOT NULL,          -- ունիկալ կանալի անունը
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id         SERIAL PRIMARY KEY,
  room_id    INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(room_id, user_id)
);

-- v1-ի lessons-ը (student_id-ով) անհամատեղելի է նոր մոդելի հետ → վերստեղծում ենք.
DROP TABLE IF EXISTS lessons CASCADE;
CREATE TABLE lessons (
  id          SERIAL PRIMARY KEY,
  room_id     INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  topic       TEXT,
  lesson_date DATE NOT NULL,
  start_time  TIME NOT NULL,
  end_time    TIME,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',   -- scheduled | done | cancelled
  series_id   TEXT,                                 -- կրկնվող դասերի խումբ
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lesson_invites (
  id         SERIAL PRIMARY KEY,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state      TEXT NOT NULL DEFAULT 'pending',       -- pending | accepted | declined
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(lesson_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_lessons_room      ON lessons(room_id);
CREATE INDEX IF NOT EXISTS idx_lessons_series    ON lessons(series_id);
CREATE INDEX IF NOT EXISTS idx_subs_user         ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subs_room         ON subscriptions(room_id);
CREATE INDEX IF NOT EXISTS idx_invites_user      ON lesson_invites(user_id, state);
CREATE INDEX IF NOT EXISTS idx_invites_lesson    ON lesson_invites(lesson_id);
