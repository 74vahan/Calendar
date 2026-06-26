import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { pool, initDb } from './db.js';

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const PORT = Number(process.env.PORT) || 8080;

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
app.post('/api/register', async (req, res) => {
  const { username, password, full_name } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'օգտանունը և գաղտնաբառը պարտադիր են' });
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

app.post('/api/login', async (req, res) => {
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
      const lesson = r.rows[0];
      // հրավերներ բոլոր բաժանորդներին
      await pool.query(
        `INSERT INTO lesson_invites(lesson_id, user_id)
         SELECT $1, s.user_id FROM subscriptions s WHERE s.room_id = $2
         ON CONFLICT (lesson_id, user_id) DO NOTHING`,
        [lesson.id, roomId]
      );
      created.push(lesson);
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
    // հրավերներ՝ սենյակի ապագա դասերի համար
    await pool.query(
      `INSERT INTO lesson_invites(lesson_id, user_id)
       SELECT l.id, $1 FROM lessons l
       WHERE l.room_id = $2 AND l.lesson_date >= CURRENT_DATE
       ON CONFLICT (lesson_id, user_id) DO NOTHING`,
      [req.user.id, roomId]
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
    // հեռացնում ենք այս սենյակի դասերի հրավերները տվյալ օգտատիրոջից
    await pool.query(
      `DELETE FROM lesson_invites i USING lessons l
       WHERE i.lesson_id = l.id AND l.room_id = $1 AND i.user_id = $2`,
      [roomId, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

// ---- aggregated calendar ----
app.get('/api/lessons', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT l.*, r.name AS room_name, r.channel AS channel, true AS owned
         FROM lessons l JOIN rooms r ON r.id = l.room_id
        WHERE r.owner_id = $1
       UNION
       SELECT l.*, r.name AS room_name, r.channel AS channel, false AS owned
         FROM lessons l
         JOIN rooms r ON r.id = l.room_id
         JOIN lesson_invites i ON i.lesson_id = l.id
        WHERE i.user_id = $1 AND i.state = 'accepted'
        ORDER BY lesson_date, start_time`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

// ---- messages (հրավերներ) ----
app.get('/api/messages', auth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT i.id AS invite_id, i.state,
         l.id, l.title, l.topic, l.lesson_date, l.start_time, l.end_time, l.note, l.status,
         r.name AS room_name, r.channel,
         u.full_name AS owner_name, u.username AS owner_username
       FROM lesson_invites i
       JOIN lessons l ON l.id = i.lesson_id
       JOIN rooms r ON r.id = l.room_id
       JOIN users u ON u.id = r.owner_id
       WHERE i.user_id = $1 AND i.state = 'pending'
       ORDER BY l.lesson_date, l.start_time`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

async function setInviteState(req, res, state) {
  const id = Number(req.params.id);
  try {
    const r = await pool.query(
      'UPDATE lesson_invites SET state = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
      [state, id, req.user.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'հրավերը չգտնվեց' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
}
app.post('/api/messages/:id/accept', auth, (req, res) => setInviteState(req, res, 'accepted'));
app.post('/api/messages/:id/decline', auth, (req, res) => setInviteState(req, res, 'declined'));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Backend ունկնդրում է :${PORT}`));
  })
  .catch((err) => {
    console.error('БД-ի ինիցիալիզացիան ձախողվեց', err);
    process.exit(1);
  });
