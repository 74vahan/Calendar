-- ============================================================
--  Կալենդար-հարթակ — տվյալների բազայի սխեման
--  users  — օգտատերեր (ադմին + աշակերտներ)
--  lessons — դասեր, որ ադմինը նշանակում է աշակերտին
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  full_name     TEXT,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'student',   -- 'admin' | 'student'
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lessons (
  id          SERIAL PRIMARY KEY,
  student_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,          -- անվանում (название)
  topic       TEXT,                   -- թեմա (тема)
  lesson_date DATE NOT NULL,          -- օր (день)
  start_time  TIME NOT NULL,          -- ժամ (время)
  end_time    TIME,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled | done | cancelled
  series_id   TEXT,                   -- խումբ կրկնվող դասերի համար (группа повторов)
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Միգրացիա հին բազաների համար (CREATE IF NOT EXISTS-ը նոր սյուներ չի ավելացնում).
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS status    TEXT NOT NULL DEFAULT 'scheduled';
ALTER TABLE lessons ADD COLUMN IF NOT EXISTS series_id TEXT;

CREATE INDEX IF NOT EXISTS idx_lessons_student ON lessons(student_id);
CREATE INDEX IF NOT EXISTS idx_lessons_date    ON lessons(lesson_date);
CREATE INDEX IF NOT EXISTS idx_lessons_series  ON lessons(series_id);

-- ============================================================
--  ԱԴՄԻՆ
--  Օգտանուն (login):  Vahan
--  Գաղտնաբառ (password): Vahan123
--  Ստորև պահվում է bcrypt-hash-ը (rounds=10), ոչ թե բուն գաղտնաբառը։
--  Անվտանգության համար առաջին մուտքից հետո խորհուրդ է տրվում փոխել գաղտնաբառը։
-- ============================================================
INSERT INTO users (username, full_name, password_hash, role)
VALUES (
  'Vahan',
  'Vahan Asoyan',
  '$2a$10$bKb0ciLOkYbgaXNvrb26bee/APNgsLGEmxlBTiO5jNpIL0HyxKr0y',  -- Vahan123
  'admin'
)
ON CONFLICT (username) DO NOTHING;
