// Локальный режим БЕЗ Docker и БЕЗ Postgres.
// Один процесс отдаёт фронтенд + API, данные хранит в data/db.json.
// Запуск:  npm run dev   ->  http://localhost:8080
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
let db = {
  users: [], rooms: [], subscriptions: [], lessons: [], invites: [],
  seq: { users: 1, rooms: 1, subscriptions: 1, lessons: 1, invites: 1 },
};
if (existsSync(DB_FILE)) {
  try { db = JSON.parse(readFileSync(DB_FILE, 'utf8')); } catch {}
}
function save() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const app = express();
app.use(express.json());

// ---- helpers ----
function sign(u) {
  return jwt.sign({ id: u.id, username: u.username }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const tk = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!tk) return res.status(401).json({ error: 'թոքենը բացակայում է' });
  try { req.user = jwt.verify(tk, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'անվավեր թոքեն' }); }
}
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function genSeriesId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
const STATUSES = ['scheduled', 'done', 'cancelled'];
const roomById = (id) => db.rooms.find((r) => r.id === id);
const lessonById = (id) => db.lessons.find((l) => l.id === id);
const userById = (id) => db.users.find((u) => u.id === id);
const lessonOwner = (id) => { const l = lessonById(id); return l ? roomById(l.room_id)?.owner_id : null; };
const subCount = (roomId) => db.subscriptions.filter((s) => s.room_id === roomId).length;

// ---- auth ----
app.post('/api/register', async (req, res) => {
  const { username, password, full_name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'օգտանունը և գաղտնաբառը պարտադիր են' });
  if (db.users.some((u) => u.username === username)) return res.status(409).json({ error: 'այդ օգտանունը զբաղված է' });
  const user = {
    id: db.seq.users++, username, full_name: full_name || null,
    password_hash: await bcrypt.hash(password, 10),
  };
  db.users.push(user); save();
  res.json({ token: sign(user), username: user.username });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.users.find((u) => u.username === username);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    return res.status(401).json({ error: 'սխալ օգտանուն կամ գաղտնաբառ' });
  res.json({ token: sign(user), username: user.username });
});

app.get('/api/me', auth, (req, res) => res.json({ id: req.user.id, username: req.user.username }));

// ---- rooms ----
app.post('/api/rooms', auth, (req, res) => {
  const { name, channel } = req.body || {};
  if (!name || !channel) return res.status(400).json({ error: 'անունը և կանալը պարտադիր են' });
  if (db.rooms.some((r) => r.channel === channel.trim()))
    return res.status(409).json({ error: 'այդ կանալն արդեն զբաղված է' });
  const room = {
    id: db.seq.rooms++, owner_id: req.user.id, name: name.trim(), channel: channel.trim(),
    created_at: new Date().toISOString(),
  };
  db.rooms.push(room); save();
  res.json(room);
});

app.get('/api/rooms', auth, (req, res) => {
  res.json(db.rooms.filter((r) => r.owner_id === req.user.id)
    .map((r) => ({ ...r, subscriber_count: subCount(r.id) })));
});

app.get('/api/rooms/:id/lessons', auth, (req, res) => {
  const room = roomById(Number(req.params.id));
  if (!room) return res.status(404).json({ error: 'սենյակը չգտնվեց' });
  if (room.owner_id !== req.user.id) return res.status(403).json({ error: 'միայն սեփականատերը' });
  res.json(db.lessons.filter((l) => l.room_id === room.id)
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time)));
});

app.post('/api/rooms/:id/lessons', auth, (req, res) => {
  const room = roomById(Number(req.params.id));
  if (!room) return res.status(404).json({ error: 'սենյակը չգտնվեց' });
  if (room.owner_id !== req.user.id) return res.status(403).json({ error: 'միայն սեփականատերը' });
  const { title, topic, lesson_date, start_time, end_time, note, repeat, repeat_count } = req.body || {};
  if (!title || !lesson_date || !start_time)
    return res.status(400).json({ error: 'անվանում, օր և ժամ պարտադիր են' });
  const count = repeat === 'weekly' ? Math.min(Math.max(Number(repeat_count) || 1, 1), 52) : 1;
  const series = count > 1 ? genSeriesId() : null;
  const subs = db.subscriptions.filter((s) => s.room_id === room.id);
  const created = [];
  for (let i = 0; i < count; i++) {
    const lesson = {
      id: db.seq.lessons++, room_id: room.id, title, topic: topic || null,
      lesson_date: addDays(lesson_date, i * 7), start_time, end_time: end_time || null,
      note: note || null, status: 'scheduled', series_id: series,
    };
    db.lessons.push(lesson);
    for (const s of subs) {
      db.invites.push({ id: db.seq.invites++, lesson_id: lesson.id, user_id: s.user_id, state: 'pending' });
    }
    created.push(lesson);
  }
  save();
  res.json({ count: created.length, lessons: created });
});

app.put('/api/lessons/:id', auth, (req, res) => {
  const l = lessonById(Number(req.params.id));
  if (!l) return res.status(404).json({ error: 'դասը չգտնվեց' });
  if (lessonOwner(l.id) !== req.user.id) return res.status(403).json({ error: 'միայն սեփականատերը' });
  const b = req.body || {};
  if (b.title) l.title = b.title;
  l.topic = b.topic || null;
  if (b.lesson_date) l.lesson_date = b.lesson_date;
  if (b.start_time) l.start_time = b.start_time;
  l.end_time = b.end_time || null;
  l.note = b.note || null;
  save();
  res.json(l);
});

app.patch('/api/lessons/:id/status', auth, (req, res) => {
  const l = lessonById(Number(req.params.id));
  if (!l) return res.status(404).json({ error: 'դասը չգտնվեց' });
  if (lessonOwner(l.id) !== req.user.id) return res.status(403).json({ error: 'միայն սեփականատերը' });
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'սխալ կարգավիճակ' });
  l.status = status; save();
  res.json(l);
});

app.delete('/api/lessons/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const l = lessonById(id);
  if (!l) return res.status(404).json({ error: 'դասը չգտնվեց' });
  if (lessonOwner(id) !== req.user.id) return res.status(403).json({ error: 'միայն սեփականատերը' });
  let toDelete = [id];
  if (req.query.series && l.series_id)
    toDelete = db.lessons.filter((x) => x.series_id === l.series_id).map((x) => x.id);
  db.lessons = db.lessons.filter((x) => !toDelete.includes(x.id));
  db.invites = db.invites.filter((iv) => !toDelete.includes(iv.lesson_id));
  save();
  res.json({ ok: true, deleted: toDelete.length });
});

// ---- channels ----
app.get('/api/channels', auth, (req, res) => {
  res.json(db.rooms
    .slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .map((r) => {
      const owner = userById(r.owner_id);
      return {
        id: r.id, name: r.name, channel: r.channel,
        owner_name: owner?.full_name || null, owner_username: owner?.username || null,
        subscriber_count: subCount(r.id),
        subscribed: db.subscriptions.some((s) => s.room_id === r.id && s.user_id === req.user.id),
        owned: r.owner_id === req.user.id,
      };
    }));
});

app.post('/api/channels/:roomId/subscribe', auth, (req, res) => {
  const room = roomById(Number(req.params.roomId));
  if (!room) return res.status(404).json({ error: 'կանալը չգտնվեց' });
  if (room.owner_id === req.user.id)
    return res.status(400).json({ error: 'չես կարող բաժանորդագրվել սեփական կանալին' });
  if (!db.subscriptions.some((s) => s.room_id === room.id && s.user_id === req.user.id)) {
    db.subscriptions.push({ id: db.seq.subscriptions++, room_id: room.id, user_id: req.user.id });
  }
  // հրավերներ ապագա դասերի համար
  const today = todayISO();
  for (const l of db.lessons.filter((l) => l.room_id === room.id && l.lesson_date >= today)) {
    if (!db.invites.some((iv) => iv.lesson_id === l.id && iv.user_id === req.user.id))
      db.invites.push({ id: db.seq.invites++, lesson_id: l.id, user_id: req.user.id, state: 'pending' });
  }
  save();
  res.json({ ok: true });
});

app.delete('/api/channels/:roomId/subscribe', auth, (req, res) => {
  const roomId = Number(req.params.roomId);
  db.subscriptions = db.subscriptions.filter((s) => !(s.room_id === roomId && s.user_id === req.user.id));
  const lessonIds = db.lessons.filter((l) => l.room_id === roomId).map((l) => l.id);
  db.invites = db.invites.filter((iv) => !(lessonIds.includes(iv.lesson_id) && iv.user_id === req.user.id));
  save();
  res.json({ ok: true });
});

// ---- aggregated calendar ----
app.get('/api/lessons', auth, (req, res) => {
  const ownedRoomIds = db.rooms.filter((r) => r.owner_id === req.user.id).map((r) => r.id);
  const acceptedLessonIds = new Set(
    db.invites.filter((iv) => iv.user_id === req.user.id && iv.state === 'accepted').map((iv) => iv.lesson_id)
  );
  const out = [];
  for (const l of db.lessons) {
    const owned = ownedRoomIds.includes(l.room_id);
    if (!owned && !acceptedLessonIds.has(l.id)) continue;
    const room = roomById(l.room_id);
    out.push({ ...l, room_name: room?.name, channel: room?.channel, owned });
  }
  out.sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time));
  res.json(out);
});

// ---- messages (հրավերներ) ----
app.get('/api/messages', auth, (req, res) => {
  const out = db.invites
    .filter((iv) => iv.user_id === req.user.id && iv.state === 'pending')
    .map((iv) => {
      const l = lessonById(iv.lesson_id);
      if (!l) return null;
      const room = roomById(l.room_id);
      const owner = room ? userById(room.owner_id) : null;
      return {
        invite_id: iv.id, state: iv.state,
        id: l.id, title: l.title, topic: l.topic, lesson_date: l.lesson_date,
        start_time: l.start_time, end_time: l.end_time, note: l.note, status: l.status,
        room_name: room?.name, channel: room?.channel,
        owner_name: owner?.full_name || null, owner_username: owner?.username || null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time));
  res.json(out);
});

function setInviteState(req, res, state) {
  const iv = db.invites.find((x) => x.id === Number(req.params.id) && x.user_id === req.user.id);
  if (!iv) return res.status(404).json({ error: 'հրավերը չգտնվեց' });
  iv.state = state; save();
  res.json(iv);
}
app.post('/api/messages/:id/accept', auth, (req, res) => setInviteState(req, res, 'accepted'));
app.post('/api/messages/:id/decline', auth, (req, res) => setInviteState(req, res, 'declined'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// статика фронтенда + SPA fallback
app.use(express.static(FRONTEND));
app.get('*', (_req, res) => res.sendFile(join(FRONTEND, 'index.html')));

app.listen(PORT, () => console.log(`Локальный режим: http://localhost:${PORT}`));
