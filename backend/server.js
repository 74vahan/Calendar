import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, initDb } from './db.js';

const app = express();
app.use(express.json());
// Հավելվածն աշխատում է nginx-ի հետևում → վստահում ենք առաջին proxy-ին, որ req.ip-ը
// լինի հաճախորդի իրական հասցեն (X-Forwarded-For), այլ ոչ թե nginx-ի կոնտեյների IP-ն։
app.set('trust proxy', 1);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET === 'dev-secret-change-me') {
  console.error('FATAL: JWT_SECRET must be set to a strong random value');
  process.exit(1);
}
const PORT = Number(process.env.PORT) || 8080;

// ---- rate limiting (անկշիռ in-memory, single-instance) ----
// Պաշտպանություն auth-էնդփոյնթների վրա բրուտ-ֆորսից։ Ֆիքսված պատուհան՝ IP-ով։
function rateLimit({ windowMs, max }) {
  const hits = new Map(); // ip -> { count, resetAt }
  // Պարբերաբար մաքրում ենք հնացած գրառումները, որ Map-ը անսահման չաճի։
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, rec] of hits) if (now > rec.resetAt) hits.delete(ip);
  }, windowMs);
  sweep.unref?.();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || 'unknown';
    let rec = hits.get(ip);
    if (!rec || now > rec.resetAt) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(ip, rec);
    }
    rec.count++;
    if (rec.count > max) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'չափից շատ փորձեր, փորձեք քիչ անց' });
    }
    next();
  };
}
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// ---- helpers ----
function sign(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'թոքենը բացակայում է' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'անվավեր թոքեն' });
  }
}

// 'YYYY-MM-DD' + N օր (UTC-ով, որ ժամային գոտին չշեղի օրը)
function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
function genSeriesId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
const STATUSES = ['scheduled', 'done', 'cancelled'];

// Արդյո՞ք տվյալ դասը պատկանում է ընթացիկ օգտատիրոջ սենյակին
async function lessonOwner(lessonId) {
  const r = await pool.query(
    'SELECT r.owner_id FROM lessons l JOIN rooms r ON r.id = l.room_id WHERE l.id = $1',
    [lessonId]
  );
  return r.rows[0]?.owner_id ?? null;
}

// ---- auth routes ----
app.post('/api/register', authLimiter, async (req, res) => {
  const { username, password, full_name } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'օգտանունը և գաղտնաբառը պարտադիր են' });
  if (typeof password !== 'string' || password.length < 8)
    return res.status(400).json({ error: 'գաղտնաբառը պետք է լինի առնվազն 8 նիշ' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users(username, full_name, password_hash)
       VALUES($1, $2, $3) RETURNING id, username`,
      [username, full_name || null, hash]
    );
    const user = r.rows[0];
    res.json({ token: sign(user), username: user.username });
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'այդ օգտանունը զբաղված է' });
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'օգտանունը և գաղտնաբառը պարտադիր են' });
  try {
    const r = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'սխալ օգտանուն կամ գաղտնաբառ' });
    res.json({ token: sign(user), username: user.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username });
});

// ---- rooms (սեփական ժամանակացույց + կանալ) ----
app.post('/api/rooms', auth, async (req, res) => {
  const { name, channel } = req.body || {};
  if (!name || !channel)
    return res.status(400).json({ error: 'անունը և կանալը պարտադիր են' });
  try {
    const r = await pool.query(
      'INSERT INTO rooms(owner_id, name, channel) VALUES($1,$2,$3) RETURNING *',
      [req.user.id, name.trim(), channel.trim()]
    );
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505')
      return res.status(409).json({ error: 'այդ կանալն արդեն զբաղված է' });
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.get('/api/rooms', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.*,
         (SELECT count(*) FROM subscriptions s WHERE s.room_id = r.id) AS subscriber_count
       FROM rooms r WHERE r.owner_id = $1 ORDER BY r.created_at`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.get('/api/rooms/:id/lessons', auth, async (req, res) => {
  const roomId = Number(req.params.id);
  try {
    const own = await pool.query('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (!own.rows[0]) return res.status(404).json({ error: 'սենյակը չգտնվեց' });
    if (own.rows[0].owner_id !== req.user.id)
      return res.status(403).json({ error: 'միայն սեփականատերը' });
    const r = await pool.query(
      'SELECT * FROM lessons WHERE room_id = $1 ORDER BY lesson_date, start_time',
      [roomId]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

// Դաս ստեղծել սենյակում (+ կրկնություն) և հրավերներ ուղարկել բոլոր բաժանորդներին
app.post('/api/rooms/:id/lessons', auth, async (req, res) => {
  const roomId = Number(req.params.id);
  const { title, topic, lesson_date, start_time, end_time, note, repeat, repeat_count } = req.body || {};
  if (!title || !lesson_date || !start_time)
    return res.status(400).json({ error: 'անվանում, օր և ժամ պարտադիր են' });
  try {
    const own = await pool.query('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (!own.rows[0]) return res.status(404).json({ error: 'սենյակը չգտնվեց' });
    if (own.rows[0].owner_id !== req.user.id)
      return res.status(403).json({ error: 'միայն սեփականատերը' });

    const count = repeat === 'weekly' ? Math.min(Math.max(Number(repeat_count) || 1, 1), 52) : 1;
    const series = count > 1 ? genSeriesId() : null;
    const created = [];
    for (let i = 0; i < count; i++) {
      const date = addDays(lesson_date, i * 7);
      const r = await pool.query(
        `INSERT INTO lessons(room_id, title, topic, lesson_date, start_time, end_time, note, series_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [roomId, title, topic || null, date, start_time, end_time || null, note || null, series]
      );
      created.push(r.rows[0]);
    }
    res.json({ count: created.length, lessons: created });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.put('/api/lessons/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  const { title, topic, lesson_date, start_time, end_time, note } = req.body || {};
  try {
    if (await lessonOwner(id) !== req.user.id)
      return res.status(403).json({ error: 'միայն սեփականատերը' });
    const r = await pool.query(
      `UPDATE lessons SET
         title       = COALESCE($1, title),
         topic       = $2,
         lesson_date = COALESCE($3, lesson_date),
         start_time  = COALESCE($4, start_time),
         end_time    = $5,
         note        = $6
       WHERE id = $7 RETURNING *`,
      [title || null, topic || null, lesson_date || null, start_time || null,
       end_time || null, note || null, id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.patch('/api/lessons/:id/status', auth, async (req, res) => {
  const id = Number(req.params.id);
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) return res.status(400).json({ error: 'սխալ կարգավիճակ' });
  try {
    if (await lessonOwner(id) !== req.user.id)
      return res.status(403).json({ error: 'միայն սեփականատերը' });
    const r = await pool.query(
      'UPDATE lessons SET status = $1 WHERE id = $2 RETURNING *', [status, id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.delete('/api/lessons/:id', auth, async (req, res) => {
  const id = Number(req.params.id);
  try {
    if (await lessonOwner(id) !== req.user.id)
      return res.status(403).json({ error: 'միայն սեփականատերը' });
    if (req.query.series) {
      const f = await pool.query('SELECT series_id FROM lessons WHERE id = $1', [id]);
      const sid = f.rows[0]?.series_id;
      if (sid) {
        const r = await pool.query('DELETE FROM lessons WHERE series_id = $1', [sid]);
        return res.json({ ok: true, deleted: r.rowCount });
      }
    }
    await pool.query('DELETE FROM lessons WHERE id = $1', [id]);
    res.json({ ok: true, deleted: 1 });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

// ---- channels (բոլոր կանալները + բաժանորդագրում) ----
app.get('/api/channels', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT r.id, r.name, r.channel,
         u.full_name AS owner_name, u.username AS owner_username,
         (SELECT count(*) FROM subscriptions s WHERE s.room_id = r.id) AS subscriber_count,
         EXISTS(SELECT 1 FROM subscriptions s WHERE s.room_id = r.id AND s.user_id = $1) AS subscribed,
         (r.owner_id = $1) AS owned
       FROM rooms r JOIN users u ON u.id = r.owner_id
       ORDER BY r.created_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.post('/api/channels/:roomId/subscribe', auth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  try {
    const room = await pool.query('SELECT owner_id FROM rooms WHERE id = $1', [roomId]);
    if (!room.rows[0]) return res.status(404).json({ error: 'կանալը չգտնվեց' });
    if (room.rows[0].owner_id === req.user.id)
      return res.status(400).json({ error: 'չես կարող բաժանորդագրվել սեփական կանալին' });
    await pool.query(
      'INSERT INTO subscriptions(room_id, user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
      [roomId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.delete('/api/channels/:roomId/subscribe', auth, async (req, res) => {
  const roomId = Number(req.params.roomId);
  try {
    await pool.query('DELETE FROM subscriptions WHERE room_id = $1 AND user_id = $2',
      [roomId, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

// ---- aggregated calendar (սեփական սենյակներ + բաժանորդագրվածներ՝ ՈՒՂԻՂ) ----
app.get('/api/lessons', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.*, r.name AS room_name, r.channel AS channel, (r.owner_id = $1) AS owned
         FROM lessons l JOIN rooms r ON r.id = l.room_id
        WHERE r.owner_id = $1
           OR r.id IN (SELECT room_id FROM subscriptions WHERE user_id = $1)
        ORDER BY l.lesson_date, l.start_time`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

// ---- todos (անձնական գործերի ցանկ օրացույցում) ----
app.get('/api/todos', auth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM todos WHERE user_id = $1 ORDER BY todo_date, todo_time NULLS LAST',
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.post('/api/todos', auth, async (req, res) => {
  const { todo_date, todo_time, title } = req.body || {};
  if (!todo_date || !title) return res.status(400).json({ error: 'օր և անվանում պարտադիր են' });
  try {
    const r = await pool.query(
      'INSERT INTO todos(user_id, todo_date, todo_time, title) VALUES($1,$2,$3,$4) RETURNING *',
      [req.user.id, todo_date, todo_time || null, title.trim()]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.delete('/api/todos/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM todos WHERE id = $1 AND user_id = $2',
      [Number(req.params.id), req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Backend ունկնդրում է :${PORT}`));
  })
  .catch((err) => {
    console.error('БД-ի ինիցիալիզացիան ձախողվեց', err);
    process.exit(1);
  });
