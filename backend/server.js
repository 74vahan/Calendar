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
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
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

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ error: 'միայն ադմինի համար' });
  next();
}

// ---- auth routes ----
app.post('/api/register', async (req, res) => {
  const { username, password, full_name } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'օգտանունը և գաղտնաբառը պարտադիր են' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      `INSERT INTO users(username, full_name, password_hash, role)
       VALUES($1, $2, $3, 'student')
       RETURNING id, username, role`,
      [username, full_name || null, hash]
    );
    const user = r.rows[0];
    res.json({ token: sign(user), username: user.username, role: user.role });
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
    res.json({ token: sign(user), username: user.username, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.get('/api/me', auth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role, id: req.user.id });
});

// ---- students (admin) ----
app.get('/api/students', auth, requireAdmin, async (_req, res) => {
  const r = await pool.query(
    `SELECT id, username, full_name FROM users
     WHERE role = 'student' ORDER BY full_name NULLS LAST, username`
  );
  res.json(r.rows);
});

// ---- lessons ----
// Ученик видит только свои; админ — все или по ?student_id=
app.get('/api/lessons', auth, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      const sid = req.query.student_id ? Number(req.query.student_id) : null;
      const r = await pool.query(
        `SELECT l.*, u.username AS student_username, u.full_name AS student_name
         FROM lessons l JOIN users u ON u.id = l.student_id
         ${sid ? 'WHERE l.student_id = $1' : ''}
         ORDER BY l.lesson_date, l.start_time`,
        sid ? [sid] : []
      );
      return res.json(r.rows);
    }
    const r = await pool.query(
      `SELECT * FROM lessons WHERE student_id = $1
       ORDER BY lesson_date, start_time`,
      [req.user.id]
    );
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.post('/api/lessons', auth, requireAdmin, async (req, res) => {
  const { student_id, title, topic, lesson_date, start_time, end_time, note } = req.body || {};
  if (!student_id || !title || !lesson_date || !start_time)
    return res.status(400).json({ error: 'աշակերտ, անվանում, օր և ժամ պարտադիր են' });
  try {
    const r = await pool.query(
      `INSERT INTO lessons(student_id, title, topic, lesson_date, start_time, end_time, note, created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [student_id, title, topic || null, lesson_date, start_time, end_time || null, note || null, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.put('/api/lessons/:id', auth, requireAdmin, async (req, res) => {
  const { student_id, title, topic, lesson_date, start_time, end_time, note } = req.body || {};
  try {
    const r = await pool.query(
      `UPDATE lessons SET
         student_id  = COALESCE($1, student_id),
         title       = COALESCE($2, title),
         topic       = $3,
         lesson_date = COALESCE($4, lesson_date),
         start_time  = COALESCE($5, start_time),
         end_time    = $6,
         note        = $7
       WHERE id = $8 RETURNING *`,
      [student_id || null, title || null, topic || null, lesson_date || null,
       start_time || null, end_time || null, note || null, Number(req.params.id)]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'դասը չգտնվեց' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'սերվերի սխալ' });
  }
});

app.delete('/api/lessons/:id', auth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM lessons WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
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
