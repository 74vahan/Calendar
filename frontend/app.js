// ====== Վիճակ ======
let token = localStorage.getItem('token') || null;
let me = null;            // { id, username, role }
let lessons = [];         // ընթացիկ ցուցադրվող դասերը
let viewYear, viewMonth;  // ցուցադրվող ամիսը (0-11)
let students = [];        // ադմինի համար
let filterStudent = '';   // ադմին: որ աշակերտի կալենդարը

// ====== Լեզու / Theme ======
let lang = localStorage.getItem('lang') || 'hy';
if (!LANGS.includes(lang)) lang = 'hy';
let theme = localStorage.getItem('theme') || 'dark';

const $ = (id) => document.getElementById(id);

function t(key, params) {
  let s = (I18N[lang] && I18N[lang][key]) ?? (I18N.hy[key] ?? key);
  if (params) for (const k in params) s = s.replace('{' + k + '}', params[k]);
  return s;
}
function months() { return CAL_LOCALE[lang].months; }
function weekdays() { return CAL_LOCALE[lang].weekdays; }

// Կիրառել ստատիկ թարգմանությունները DOM-ում
function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  // auth submit-ի տեքստը կախված է ռեժիմից
  $('auth-submit').textContent = mode === 'login' ? t('btn_login') : t('btn_register');
}

function fillLangSelect(sel) {
  sel.innerHTML = LANGS.map((l) =>
    `<option value="${l}" ${l === lang ? 'selected' : ''}>${I18N[l]._label}</option>`).join('');
}

function setLang(l) {
  if (!LANGS.includes(l)) return;
  lang = l;
  localStorage.setItem('lang', l);
  fillLangSelect($('lang-auth'));
  fillLangSelect($('lang-app'));
  applyStatic();
  // վերաշարադրել դինամիկ մասերը
  if (me) {
    renderWho();
    renderWeekdays();
    renderCalendar();
    if (me.role === 'admin') { renderStudentSelects(); renderAdminList(); }
    else { renderUpcoming(); }
  }
}

function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  $('theme-toggle').textContent = theme === 'light' ? '☀️' : '🌙';
}
function toggleTheme() {
  theme = theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', theme);
  applyTheme();
}

// ====== Toast ======
let toastSeq = 0;
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  const id = ++toastSeq;
  el.dataset.id = id;
  setTimeout(() => { el.classList.add('hide'); }, 2600);
  setTimeout(() => { el.remove(); }, 3000);
}

// ====== API օգնականներ ======
function authHeaders(extra = {}) {
  return { Authorization: 'Bearer ' + token, ...extra };
}
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || t('err_generic'));
  return data;
}

// ====== Auth UI ======
let mode = 'login';
$('tab-login').onclick = () => setMode('login');
$('tab-register').onclick = () => setMode('register');
function setMode(m) {
  mode = m;
  $('tab-login').classList.toggle('active', m === 'login');
  $('tab-register').classList.toggle('active', m === 'register');
  $('fullname-row').classList.toggle('hidden', m !== 'register');
  $('auth-submit').textContent = m === 'login' ? t('btn_login') : t('btn_register');
  $('auth-error').textContent = '';
}

$('lang-auth').onchange = (e) => setLang(e.target.value);
$('lang-app').onchange = (e) => setLang(e.target.value);
$('theme-toggle').onclick = toggleTheme;

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  const username = $('username').value.trim();
  const password = $('password').value;
  const full_name = $('full_name').value.trim();
  try {
    const path = mode === 'login' ? '/api/login' : '/api/register';
    const body = mode === 'login' ? { username, password } : { username, password, full_name };
    const data = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    token = data.token;
    localStorage.setItem('token', token);
    await boot();
  } catch (err) {
    $('auth-error').textContent = err.message;
  }
};

$('logout').onclick = () => {
  token = null; me = null;
  localStorage.removeItem('token');
  $('app').classList.add('hidden');
  $('auth').classList.remove('hidden');
};

function renderWho() {
  $('who').textContent = me.username + (me.role === 'admin' ? ' (' + t('admin') + ')' : '');
}

// ====== Boot ======
async function boot() {
  try {
    me = await api('/api/me', { headers: authHeaders() });
  } catch {
    token = null; localStorage.removeItem('token');
    $('auth').classList.remove('hidden'); $('app').classList.add('hidden');
    return;
  }
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  renderWho();

  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  renderWeekdays();

  if (me.role === 'admin') {
    $('admin-panel').classList.remove('hidden');
    $('upcoming').classList.add('hidden');
    await loadStudents();
  } else {
    $('admin-panel').classList.add('hidden');
    $('admin-list').classList.add('hidden');
    $('upcoming').classList.remove('hidden');
  }
  await loadLessons();
}

// ====== Աշակերտներ (ադմին) ======
async function loadStudents() {
  students = await api('/api/students', { headers: authHeaders() });
  renderStudentSelects();
}
function renderStudentSelects() {
  const opts = students
    .map((s) => `<option value="${s.id}">${esc(s.full_name || s.username)} (${esc(s.username)})</option>`)
    .join('');
  const prevFilter = $('filter-student').value;
  $('f-student').innerHTML = students.length ? opts : `<option value="">${t('no_students')}</option>`;
  $('filter-student').innerHTML =
    `<option value="">${t('all_lessons_opt')}</option>` + opts;
  $('filter-student').value = prevFilter;
}

$('filter-student').onchange = async (e) => {
  filterStudent = e.target.value;
  await loadLessons();
};

// ====== Դասեր ======
async function loadLessons() {
  let path = '/api/lessons';
  if (me.role === 'admin' && filterStudent) path += '?student_id=' + filterStudent;
  lessons = await api(path, { headers: authHeaders() });
  renderCalendar();
  if (me.role === 'admin') renderAdminList();
  else renderUpcoming();
}

// ====== Ամսաթվի օգնականներ ======
function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function todayStr() {
  const n = new Date();
  return ymd(n.getFullYear(), n.getMonth(), n.getDate());
}
function daysBetween(fromStr, toStr) {
  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);
  const a = Date.UTC(y1, m1 - 1, d1), b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
}

// ====== Կալենդարի ցանց ======
function renderWeekdays() {
  $('weekdays').innerHTML = weekdays().map((d) => `<div>${d}</div>`).join('');
}

function renderCalendar() {
  $('cal-title').textContent = `${months()[viewMonth]} ${viewYear}`;
  const cal = $('calendar');
  cal.innerHTML = '';

  const first = new Date(viewYear, viewMonth, 1);
  let lead = (first.getDay() + 6) % 7;            // երկուշաբթիից
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  const byDay = {};
  for (const l of lessons) (byDay[l.lesson_date] = byDay[l.lesson_date] || []).push(l);

  const today = todayStr();

  for (let i = 0; i < lead; i++) {
    const c = document.createElement('div');
    c.className = 'cell empty';
    cal.appendChild(c);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = ymd(viewYear, viewMonth, d);
    const dayLessons = (byDay[key] || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const c = document.createElement('div');
    c.className = 'cell'
      + (key === today ? ' today' : '')
      + (key < today ? ' past' : '');
    c.innerHTML = `<div class="num">${d}</div>`;
    const shown = dayLessons.slice(0, 2);
    for (const l of shown) {
      const p = document.createElement('div');
      p.className = 'pill s-' + (l.status || 'scheduled');
      p.textContent = `${l.start_time} ${l.title}`;
      c.appendChild(p);
    }
    if (dayLessons.length > 2) {
      const more = document.createElement('div');
      more.className = 'pill more';
      more.textContent = `+${dayLessons.length - 2}`;
      c.appendChild(more);
    }
    c.onclick = () => openDay(key, dayLessons);
    cal.appendChild(c);
  }
}

$('prev').onclick = () => shiftMonth(-1);
$('next').onclick = () => shiftMonth(1);
$('today-btn').onclick = () => {
  const n = new Date();
  viewYear = n.getFullYear(); viewMonth = n.getMonth();
  renderCalendar();
};
function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
}

// ====== Աշակերտի առաջիկա դասերը ======
function relativeDay(dateStr) {
  const diff = daysBetween(todayStr(), dateStr);
  if (diff === 0) return t('today_word');
  if (diff === 1) return t('tomorrow');
  return t('in_days', { n: diff });
}
function renderUpcoming() {
  const today = todayStr();
  const future = lessons
    .filter((l) => l.lesson_date >= today && l.status !== 'cancelled')
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time));
  const body = $('upcoming-body');
  if (!future.length) {
    body.innerHTML = `<p class="empty-note">${t('no_upcoming')}</p>`;
    return;
  }
  const [next, ...rest] = future;
  const dateFmt = (l) => `${Number(l.lesson_date.split('-')[2])} ${months()[Number(l.lesson_date.split('-')[1]) - 1]}`;
  const time = (l) => l.end_time ? `${l.start_time}–${l.end_time}` : l.start_time;

  let html = `<div class="next-card">
    <div class="next-tag">${t('next_lesson')} · ${relativeDay(next.lesson_date)}</div>
    <div class="next-title">${esc(next.title)}</div>
    <div class="next-meta">📅 ${dateFmt(next)} · 🕒 ${esc(time(next))}</div>
    ${next.topic ? `<div class="next-meta">📚 ${esc(next.topic)}</div>` : ''}
    ${next.note ? `<div class="next-meta">📝 ${esc(next.note)}</div>` : ''}
  </div>`;
  if (rest.length) {
    html += '<ul class="up-list">' + rest.slice(0, 6).map((l) =>
      `<li><span class="up-date">${dateFmt(l)}</span>
        <span class="up-time">${esc(time(l))}</span>
        <span class="up-title">${esc(l.title)}</span></li>`).join('') + '</ul>';
  }
  body.innerHTML = html;
}

// ====== Օրվա մոդալ ======
function openDay(key, dayLessons) {
  const [y, m, d] = key.split('-');
  $('day-modal-title').textContent = `${Number(d)} ${months()[Number(m) - 1]} ${y}`;
  const body = $('day-modal-body');
  if (!dayLessons.length) {
    body.innerHTML = `<p class="empty-note">${t('no_lessons_day')}</p>`;
  } else {
    body.innerHTML = dayLessons.map(lessonCard).join('');
    if (me.role === 'admin') wireDayActions();
  }
  $('day-modal').classList.remove('hidden');
}
function statusBadge(s) {
  const st = s || 'scheduled';
  return `<span class="badge s-${st}">${t('st_' + st)}</span>`;
}
function lessonCard(l) {
  const time = l.end_time ? `${l.start_time}–${l.end_time}` : l.start_time;
  const st = l.status || 'scheduled';
  const adminWho = me.role === 'admin' && l.student_name
    ? `<div class="note">👤 ${esc(l.student_name || l.student_username)}</div>` : '';
  let actions = '';
  if (me.role === 'admin') {
    const statusBtns = `
      ${st !== 'done' ? `<button class="btn-ghost mk" data-id="${l.id}" data-st="done">✓ ${t('mark_done')}</button>` : ''}
      ${st !== 'cancelled' ? `<button class="btn-ghost mk" data-id="${l.id}" data-st="cancelled">✕ ${t('mark_cancelled')}</button>` : ''}
      ${st !== 'scheduled' ? `<button class="btn-ghost mk" data-id="${l.id}" data-st="scheduled">↺ ${t('reset_status')}</button>` : ''}`;
    actions = `<div class="row-actions">
         <button class="btn-ghost edit" data-id="${l.id}">${t('edit')}</button>
         <button class="btn-ghost del" data-id="${l.id}">${t('del')}</button>
         ${l.series_id ? `<button class="btn-ghost del-series" data-id="${l.id}">${t('del_series')}</button>` : ''}
       </div>
       <div class="row-actions status-actions">${statusBtns}</div>`;
  }
  return `<div class="lesson-item st-${st}">
    <div class="li-head"><div class="time">🕒 ${esc(time)}</div>${statusBadge(st)}</div>
    <div class="title">${esc(l.title)}</div>
    ${l.topic ? `<div class="topic">📚 ${esc(l.topic)}</div>` : ''}
    ${l.note ? `<div class="note">📝 ${esc(l.note)}</div>` : ''}
    ${adminWho}
    ${actions}
  </div>`;
}
function wireDayActions() {
  document.querySelectorAll('#day-modal-body .edit').forEach((b) => {
    b.onclick = () => { startEdit(Number(b.dataset.id)); closeDay(); };
  });
  document.querySelectorAll('#day-modal-body .del').forEach((b) => {
    b.onclick = () => delLesson(Number(b.dataset.id), false);
  });
  document.querySelectorAll('#day-modal-body .del-series').forEach((b) => {
    b.onclick = () => delLesson(Number(b.dataset.id), true);
  });
  document.querySelectorAll('#day-modal-body .mk').forEach((b) => {
    b.onclick = () => setStatus(Number(b.dataset.id), b.dataset.st);
  });
}
function closeDay() { $('day-modal').classList.add('hidden'); }
$('day-modal-close').onclick = closeDay;
$('day-modal').onclick = (e) => { if (e.target.id === 'day-modal') closeDay(); };

// ====== Ադմին: դասերի ցանկ ======
function renderAdminList() {
  const showTable = !filterStudent;
  $('admin-list').classList.toggle('hidden', !showTable);
  if (!showTable) return;
  if (!lessons.length) {
    $('lessons-table').innerHTML = `<p class="empty-note">${t('no_lessons_yet')}</p>`;
    return;
  }
  const rows = [...lessons]
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time))
    .map((l) => `<tr class="st-${l.status || 'scheduled'}">
      <td>${esc(l.lesson_date)}</td>
      <td>${esc(l.start_time)}${l.end_time ? '–' + esc(l.end_time) : ''}</td>
      <td>${esc(l.student_name || l.student_username || '')}</td>
      <td>${esc(l.title)}</td>
      <td>${esc(l.topic || '')}</td>
      <td>${statusBadge(l.status)}</td>
      <td>
        <button class="btn-ghost edit" data-id="${l.id}">✎</button>
        <button class="btn-ghost del" data-id="${l.id}">🗑</button>
      </td>
    </tr>`).join('');
  $('lessons-table').innerHTML = `<table>
    <thead><tr>
      <th>${t('th_day')}</th><th>${t('th_time')}</th><th>${t('th_student')}</th>
      <th>${t('th_title')}</th><th>${t('th_topic')}</th><th>${t('th_status')}</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody></table>`;
  $('lessons-table').querySelectorAll('.edit').forEach((b) => b.onclick = () => startEdit(Number(b.dataset.id)));
  $('lessons-table').querySelectorAll('.del').forEach((b) => b.onclick = () => delLesson(Number(b.dataset.id), false));
}

// ====== Ադմին: ստեղծել / խմբագրել / ջնջել ======
$('f-repeat').onchange = (e) => {
  $('repeat-count-field').classList.toggle('hidden', e.target.value !== 'weekly');
};

$('lesson-form').onsubmit = async (e) => {
  e.preventDefault();
  $('lesson-error').textContent = '';
  const id = $('lesson-id').value;
  const body = {
    student_id: Number($('f-student').value),
    title: $('f-title').value.trim(),
    topic: $('f-topic').value.trim() || null,
    lesson_date: $('f-date').value,
    start_time: $('f-start').value,
    end_time: $('f-end').value || null,
    note: $('f-note').value.trim() || null,
  };
  try {
    if (id) {
      await api('/api/lessons/' + id, {
        method: 'PUT', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      toast(t('toast_saved'));
    } else {
      body.repeat = $('f-repeat').value;
      body.repeat_count = Number($('f-repeat-count').value) || 1;
      const r = await api('/api/lessons', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      toast(t('toast_created', { n: (r && r.count) || 1 }));
    }
    resetForm();
    await loadLessons();
  } catch (err) {
    $('lesson-error').textContent = err.message;
    toast(err.message, 'err');
  }
};

function startEdit(id) {
  const l = lessons.find((x) => x.id === id);
  if (!l) return;
  $('lesson-id').value = l.id;
  $('f-student').value = l.student_id;
  $('f-title').value = l.title;
  $('f-topic').value = l.topic || '';
  $('f-date').value = l.lesson_date;
  $('f-start').value = l.start_time;
  $('f-end').value = l.end_time || '';
  $('f-note').value = l.note || '';
  // խմբագրման ժամանակ կրկնությունը թաքցնում ենք (մեկ դաս)
  $('f-repeat').value = 'none';
  $('repeat-count-field').classList.add('hidden');
  $('repeat-block').classList.add('hidden');
  $('lesson-submit').textContent = t('btn_save');
  $('lesson-cancel').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('lesson-cancel').onclick = resetForm;
function resetForm() {
  $('lesson-form').reset();
  $('lesson-id').value = '';
  $('repeat-block').classList.remove('hidden');
  $('repeat-count-field').classList.add('hidden');
  $('lesson-submit').textContent = t('btn_add');
  $('lesson-cancel').classList.add('hidden');
  $('lesson-error').textContent = '';
}

async function setStatus(id, status) {
  try {
    await api('/api/lessons/' + id + '/status', {
      method: 'PATCH', headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ status }),
    });
    toast(t('toast_status'));
    closeDay();
    await loadLessons();
  } catch (err) {
    toast(err.message, 'err');
  }
}

async function delLesson(id, series) {
  if (!confirm(series ? t('confirm_delete_series') : t('confirm_delete'))) return;
  try {
    await api('/api/lessons/' + id + (series ? '?series=1' : ''), {
      method: 'DELETE', headers: authHeaders(),
    });
    toast(t('toast_deleted'));
    closeDay();
    await loadLessons();
  } catch (err) {
    toast(err.message, 'err');
  }
}

// ====== Util ======
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ====== Start ======
fillLangSelect($('lang-auth'));
fillLangSelect($('lang-app'));
applyStatic();
applyTheme();
if (token) boot();
