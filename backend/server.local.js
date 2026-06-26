// Локальный режим БЕЗ Docker и БЕЗ Postgres.
// Один процесс отдаёт фронтенд + API, данные хранит в data/db.json.
// Запуск:  npm run dev   ->  http://localhost:8080  (логин Vahan / Vahan123)
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, 'data');
const DB_FILE = join(DATA_DIR, 'db.json');
const FRONTEND = join(__dirname, '..', 'frontend');

const JWT_SECRET = 'local-dev-secret';
const PORT = Number(process.env.PORT) || 8080;

// ---- простое JSON-хранилище ----
let db = { users: [], lessons: [], seq: { users: 1, lessons: 1 } };
if (existsSync(DB_FILE)) {
  try { db = JSON.parse(readFileSync(DB_FILE, 'utf8')); } catch {}
}
function save() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

// сид админа Vahan / Vahan123 (как в db/schema.sql)
if (!db.users.some((u) => u.role === 'admin')) {
  db.users.push({
    id: db.seq.users++,
    username: 'Vahan',
    full_name: 'Vahan Asoyan',
    password_hash: bcrypt.hashSync('Vahan123', 10),
    role: 'admin',
  });
  save();
  console.log('Админ создан: Vahan / Vahan123');
}

const app = express();
app.use(express.json());

function sign(u) {
  return jwt.sign({ id: u.id, username: u.username, role: u.role }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!t) return res.status(401).json({ error: 'թոքենը բացակայում է' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'անվավեր թոքեն' }); }
}
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'միայն ադմինի համար' });
  next();
}

app.post('/api/register', async (req, res) => {
  const { username, password, full_name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'օգտանունը և գաղտնաբառը պարտադիր են' });
  if (db.users.some((u) => u.username === username)) return res.status(409).json({ error: 'այդ օգտանունը զբաղված է' });
  const user = {
    id: db.seq.users++, username, full_name: full_name || null,
    password_hash: await bcrypt.hash(password, 10), role: 'student',
  };
  db.users.push(user); save();
  res.json({ token: sign(user), username: user.username, role: user.role });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'սխալ օգտանուն կամ գաղտնաբառ' });
  res.json({ token: sign(user), username: user.username, role: user.role });
});

app.get('/api/me', auth, (req, res) =>
  res.json({ username: req.user.username, role: req.user.role, id: req.user.id }));

app.get('/api/students', auth, requireAdmin, (_req, res) => {
  res.json(db.users.filter((u) => u.role === 'student')
    .map((u) => ({ id: u.id, username: u.username, full_name: u.full_name })));
});

app.get('/api/lessons', auth, (req, res) => {
  if (req.user.role === 'admin') {
    const sid = req.query.student_id ? Number(req.query.student_id) : null;
    let list = db.lessons;
    if (sid) list = list.filter((l) => l.student_id === sid);
    return res.json(list.map((l) => {
      const s = db.users.find((u) => u.id === l.student_id);
      return { ...l, student_username: s?.username, student_name: s?.full_name };
    }));
  }
  res.json(db.lessons.filter((l) => l.student_id === req.user.id));
});

app.post('/api/lessons', auth, requireAdmin, (req, res) => {
  const { student_id, title, topic, lesson_date, start_time, end_time, note } = req.body || {};
  if (!student_id || !title || !lesson_date || !start_time)
    return res.status(400).json({ error: 'աշակերտ, անվանում, օր և ժամ պարտադիր են' });
  const lesson = {
    id: db.seq.lessons++, student_id: Number(student_id), title, topic: topic || null,
    lesson_date, start_time, end_time: end_time || null, note: note || null, created_by: req.user.id,
  };
  db.lessons.push(lesson); save();
  res.json(lesson);
});

app.put('/api/lessons/:id', auth, requireAdmin, (req, res) => {
  const l = db.lessons.find((x) => x.id === Number(req.params.id));
  if (!l) return res.status(404).json({ error: 'դասը չգտնվեց' });
  const b = req.body || {};
  if (b.student_id) l.student_id = Number(b.student_id);
  if (b.title) l.title = b.title;
  l.topic = b.topic || null;
  if (b.lesson_date) l.lesson_date = b.lesson_date;
  if (b.start_time) l.start_time = b.start_time;
  l.end_time = b.end_time || null;
  l.note = b.note || null;
  save();
  res.json(l);
});

app.delete('/api/lessons/:id', auth, requireAdmin, (req, res) => {
  db.lessons = db.lessons.filter((x) => x.id !== Number(req.params.id));
  save();
  res.json({ ok: true });
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// статика фронтенда + SPA fallback
app.use(express.static(FRONTEND));
app.get('*', (_req, res) => res.sendFile(join(FRONTEND, 'index.html')));

app.listen(PORT, () => console.log(`Локальный режим: http://localhost:${PORT}  (Vahan / Vahan123)`));
