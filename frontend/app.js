// ====== Վիճակ ======
let token = localStorage.getItem('token') || null;
let me = null;                 // { id, username }
let lessons = [];              // ագրեգացված կալենդար (owned + accepted)
let rooms = [];                // իմ սենյակները
let channels = [];             // բոլոր կանալները
let todos = [];                // անձնական անելիքներ
let activeRoom = null;         // ընտրված սենյակը (կառավարման համար)
let roomLessons = [];          // ընտրված սենյակի դասերը
let viewYear, viewMonth;
let currentView = 'calendar';

let lang = localStorage.getItem('lang') || 'hy';
if (!LANGS.includes(lang)) lang = 'hy';
let theme = localStorage.getItem('theme') || 'dark';

const $ = (id) => document.getElementById(id);

// ====== i18n ======
function t(key, params) {
  let s = (I18N[lang] && I18N[lang][key]) ?? (I18N.hy[key] ?? key);
  if (params) for (const k in params) s = s.replace('{' + k + '}', params[k]);
  return s;
}
function months() { return CAL_LOCALE[lang].months; }
function weekdays() { return CAL_LOCALE[lang].weekdays; }

function applyStatic() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $('auth-submit').textContent = mode === 'login' ? t('btn_login') : t('btn_register');
}
function fillLangSelect(sel) {
  sel.innerHTML = LANGS.map((l) => `<option value="${l}" ${l === lang ? 'selected' : ''}>${I18N[l]._label}</option>`).join('');
}
function setLang(l) {
  if (!LANGS.includes(l)) return;
  lang = l; localStorage.setItem('lang', l);
  fillLangSelect($('lang-auth')); fillLangSelect($('lang-app'));
  applyStatic();
  paintQuote();
  if (me) {
    renderWho(); renderWeekdays(); renderCalendar(); renderUpcoming();
    renderRooms(); if (activeRoom) { $('active-room-name').textContent = activeRoom.name; renderRoomTable(); }
    renderChannels();
  }
}
function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  const icon = theme === 'light' ? '☀️' : '🌙';
  $('theme-toggle').textContent = icon;
  $('theme-toggle-auth').textContent = icon;
}

// ====== Auth: սմենվող մեջբերումներ (Սոկրատես) ======
let quoteIdx = 0, quoteTimer = null;
function currentQuotes() { return (I18N[lang] && I18N[lang].socrates_quotes) || I18N.hy.socrates_quotes; }
function paintQuote() {
  const el = $('q-text'); if (!el) return;
  el.textContent = currentQuotes()[quoteIdx % currentQuotes().length];
}
function startQuoteRotation() {
  paintQuote();
  clearInterval(quoteTimer);
  quoteTimer = setInterval(() => {
    const el = $('q-text'); if (!el) return;
    el.style.opacity = '0';                                   // դանդաղ մարում
    setTimeout(() => {
      quoteIdx = (quoteIdx + 1) % currentQuotes().length;
      paintQuote();
      el.style.opacity = '1';
    }, 900);
  }, 4000);
}
function toggleTheme() {
  theme = theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('theme', theme); applyTheme();
}

// ====== Toast ======
function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => el.classList.add('hide'), 2600);
  setTimeout(() => el.remove(), 3000);
}

// ====== API ======
function authHeaders(extra = {}) { return { Authorization: 'Bearer ' + token, ...extra }; }
async function api(path, opts = {}) {
  const res = await fetch(path, { headers: opts.body ? authHeaders({ 'Content-Type': 'application/json' }) : authHeaders(), ...opts });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || t('err_generic'));
  return data;
}

// ====== Auth ======
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
$('theme-toggle-auth').onclick = toggleTheme;

$('auth-form').onsubmit = async (e) => {
  e.preventDefault();
  $('auth-error').textContent = '';
  const username = $('username').value.trim();
  const password = $('password').value;
  const full_name = $('full_name').value.trim();
  try {
    const path = mode === 'login' ? '/api/login' : '/api/register';
    const body = mode === 'login' ? { username, password } : { username, password, full_name };
    const data = await api(path, { method: 'POST', body: JSON.stringify(body) });
    token = data.token; localStorage.setItem('token', token);
    await boot();
  } catch (err) { $('auth-error').textContent = err.message; }
};
$('logout').onclick = () => {
  token = null; me = null; activeRoom = null;
  localStorage.removeItem('token');
  $('app').classList.add('hidden'); $('auth').classList.remove('hidden');
};
function renderWho() { $('who').textContent = me.username; }

// ====== Boot ======
async function boot() {
  try { me = await api('/api/me'); }
  catch { token = null; localStorage.removeItem('token'); $('auth').classList.remove('hidden'); $('app').classList.add('hidden'); return; }
  $('auth').classList.add('hidden'); $('app').classList.remove('hidden');
  renderWho();
  const now = new Date(); viewYear = now.getFullYear(); viewMonth = now.getMonth();
  renderWeekdays();
  await showView('calendar');
}

// ====== View router ======
document.querySelectorAll('.nav-tab').forEach((b) => { b.onclick = () => showView(b.dataset.view); });
async function showView(v) {
  currentView = v;
  for (const name of ['calendar', 'rooms', 'channels'])
    $('view-' + name).classList.toggle('hidden', name !== v);
  document.querySelectorAll('.nav-tab').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  if (v === 'calendar') await loadCalendar();
  if (v === 'rooms') await loadRooms();
  if (v === 'channels') await loadChannels();
}

// ====== Ամսաթվի օգնականներ ======
function ymd(y, m, d) { return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
function todayStr() { const n = new Date(); return ymd(n.getFullYear(), n.getMonth(), n.getDate()); }
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number), [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}
function timeStr(l) { return l.end_time ? `${l.start_time}–${l.end_time}` : l.start_time; }
function dateShort(dateStr) { const [, m, d] = dateStr.split('-'); return `${Number(d)} ${months()[Number(m) - 1]}`; }

// ====== Կալենդար ======
async function loadCalendar() {
  [lessons, todos] = await Promise.all([api('/api/lessons'), api('/api/todos')]);
  renderCalendar(); renderUpcoming();
}

function renderWeekdays() { $('weekdays').innerHTML = weekdays().map((d) => `<div>${d}</div>`).join(''); }

function renderCalendar() {
  $('cal-title').textContent = `${months()[viewMonth]} ${viewYear}`;
  const cal = $('calendar'); cal.innerHTML = '';
  const first = new Date(viewYear, viewMonth, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const byDay = {};
  for (const l of lessons) (byDay[l.lesson_date] = byDay[l.lesson_date] || []).push(l);
  const byTodo = {};
  for (const tdo of todos) (byTodo[tdo.todo_date] = byTodo[tdo.todo_date] || []).push(tdo);
  const today = todayStr();
  for (let i = 0; i < lead; i++) { const c = document.createElement('div'); c.className = 'cell empty'; cal.appendChild(c); }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = ymd(viewYear, viewMonth, d);
    const dayLessons = (byDay[key] || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const dayTodos = (byTodo[key] || []).sort((a, b) => (a.todo_time || '').localeCompare(b.todo_time || ''));
    const c = document.createElement('div');
    c.className = 'cell' + (key === today ? ' today' : '') + (key < today ? ' past' : '');
    c.innerHTML = `<div class="num">${d}</div>`;
    const items = [
      ...dayLessons.map((l) => ({ kind: 'lesson', obj: l })),
      ...dayTodos.map((tdo) => ({ kind: 'todo', obj: tdo })),
    ];
    for (const it of items.slice(0, 3)) {
      const p = document.createElement('div');
      if (it.kind === 'lesson') {
        p.className = 'pill s-' + (it.obj.status || 'scheduled') + (it.obj.owned ? '' : ' sub');
        p.textContent = `${it.obj.start_time} ${it.obj.title}`;
      } else {
        p.className = 'pill todo';
        p.textContent = `${it.obj.todo_time ? it.obj.todo_time + ' ' : '✓ '}${it.obj.title}`;
      }
      c.appendChild(p);
    }
    if (items.length > 3) {
      const more = document.createElement('div'); more.className = 'pill more';
      more.textContent = `+${items.length - 3}`; c.appendChild(more);
    }
    c.onclick = () => openDay(key);
    cal.appendChild(c);
  }
}
$('prev').onclick = () => shiftMonth(-1);
$('next').onclick = () => shiftMonth(1);
$('today-btn').onclick = () => { const n = new Date(); viewYear = n.getFullYear(); viewMonth = n.getMonth(); renderCalendar(); };
function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
}

// ====== Առաջիկա դասեր ======
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
  if (!future.length) { body.innerHTML = `<p class="empty-note">${t('no_upcoming')}</p>`; return; }
  const [next, ...rest] = future;
  let html = `<div class="next-card">
    <div class="next-tag">${t('next_lesson')} · ${relativeDay(next.lesson_date)}</div>
    <div class="next-title">${esc(next.title)}</div>
    <div class="next-meta">📅 ${dateShort(next.lesson_date)} · 🕒 ${esc(timeStr(next))}</div>
    ${next.channel ? `<div class="next-meta">📡 ${esc(next.channel)}</div>` : ''}
  </div>`;
  if (rest.length) {
    html += '<ul class="up-list">' + rest.slice(0, 6).map((l) =>
      `<li><span class="up-date">${dateShort(l.lesson_date)}</span>
        <span class="up-time">${esc(timeStr(l))}</span>
        <span class="up-title">${esc(l.title)}</span></li>`).join('') + '</ul>';
  }
  body.innerHTML = html;
}

// ====== Օրվա մոդալ ======
function statusBadge(s) { const st = s || 'scheduled'; return `<span class="badge s-${st}">${t('st_' + st)}</span>`; }
let currentDayKey = null;
function openDay(key) {
  currentDayKey = key;
  const [y, m, d] = key.split('-');
  $('day-modal-title').textContent = `${Number(d)} ${months()[Number(m) - 1]} ${y}`;
  renderDayModalBody(key);
  $('day-modal').classList.remove('hidden');
}
function renderDayModalBody(key) {
  const dayLessons = lessons.filter((l) => l.lesson_date === key)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const dayTodos = todos.filter((tdo) => tdo.todo_date === key)
    .sort((a, b) => (a.todo_time || '').localeCompare(b.todo_time || ''));
  const lessonsHtml = dayLessons.length
    ? dayLessons.map(lessonCard).join('')
    : `<p class="empty-note">${t('no_lessons_day')}</p>`;
  const todosHtml = `
    <div class="todo-section">
      <h4>${t('todo_section')}</h4>
      ${dayTodos.length ? dayTodos.map(todoItem).join('') : `<p class="empty-note">${t('no_todos')}</p>`}
      <div class="todo-add">
        <input type="time" id="td-time" />
        <input type="text" id="td-title" placeholder="${t('todo_title_ph')}" />
        <button class="btn-primary" id="td-add">+ ${t('todo_add')}</button>
      </div>
    </div>`;
  $('day-modal-body').innerHTML = lessonsHtml + todosHtml;
  wireDayActions();
  wireTodoActions(key);
}
function todoItem(tdo) {
  return `<div class="todo-item">
    <span class="td-time">${tdo.todo_time ? esc(tdo.todo_time) : '—'}</span>
    <span class="td-title">${esc(tdo.title)}</span>
    <button class="btn-ghost td-del" data-id="${tdo.id}">✕</button>
  </div>`;
}
function wireTodoActions(key) {
  const add = $('td-add');
  if (add) add.onclick = () => addTodo(key);
  document.querySelectorAll('#day-modal-body .td-del').forEach((b) => b.onclick = () => delTodo(Number(b.dataset.id)));
}
async function addTodo(key) {
  const title = $('td-title').value.trim();
  const time = $('td-time').value || null;
  if (!title) return;
  try {
    await api('/api/todos', { method: 'POST', body: JSON.stringify({ todo_date: key, todo_time: time, title }) });
    toast(t('toast_todo_added'));
    todos = await api('/api/todos');
    renderCalendar();
    renderDayModalBody(key);
  } catch (err) { toast(err.message, 'err'); }
}
async function delTodo(id) {
  if (!confirm(t('confirm_delete_todo'))) return;
  try {
    await api('/api/todos/' + id, { method: 'DELETE' });
    toast(t('toast_todo_deleted'));
    todos = await api('/api/todos');
    renderCalendar();
    if (currentDayKey) renderDayModalBody(currentDayKey);
  } catch (err) { toast(err.message, 'err'); }
}
function lessonCard(l) {
  const st = l.status || 'scheduled';
  const origin = l.channel ? `<div class="note">📡 ${esc(l.room_name || '')} · ${esc(l.channel)}</div>` : '';
  let actions = '';
  if (l.owned) {
    const sb = `
      ${st !== 'done' ? `<button class="btn-ghost mk" data-id="${l.id}" data-st="done">✓ ${t('mark_done')}</button>` : ''}
      ${st !== 'cancelled' ? `<button class="btn-ghost mk" data-id="${l.id}" data-st="cancelled">✕ ${t('mark_cancelled')}</button>` : ''}
      ${st !== 'scheduled' ? `<button class="btn-ghost mk" data-id="${l.id}" data-st="scheduled">↺ ${t('reset_status')}</button>` : ''}`;
    actions = `<div class="row-actions">
        <button class="btn-ghost edit" data-id="${l.id}">${t('edit')}</button>
        <button class="btn-ghost del" data-id="${l.id}">${t('del')}</button>
        ${l.series_id ? `<button class="btn-ghost del-series" data-id="${l.id}">${t('del_series')}</button>` : ''}
      </div><div class="row-actions status-actions">${sb}</div>`;
  }
  return `<div class="lesson-item st-${st}">
    <div class="li-head"><div class="time">🕒 ${esc(timeStr(l))}</div>${statusBadge(st)}</div>
    <div class="title">${esc(l.title)}</div>
    ${l.topic ? `<div class="topic">📚 ${esc(l.topic)}</div>` : ''}
    ${l.note ? `<div class="note">📝 ${esc(l.note)}</div>` : ''}
    ${origin}${actions}
  </div>`;
}
function wireDayActions() {
  document.querySelectorAll('#day-modal-body .edit').forEach((b) => b.onclick = () => editFromCalendar(Number(b.dataset.id)));
  document.querySelectorAll('#day-modal-body .del').forEach((b) => b.onclick = () => delLesson(Number(b.dataset.id), false));
  document.querySelectorAll('#day-modal-body .del-series').forEach((b) => b.onclick = () => delLesson(Number(b.dataset.id), true));
  document.querySelectorAll('#day-modal-body .mk').forEach((b) => b.onclick = () => setStatus(Number(b.dataset.id), b.dataset.st));
}
function closeDay() { $('day-modal').classList.add('hidden'); }
$('day-modal-close').onclick = closeDay;
$('day-modal').onclick = (e) => { if (e.target.id === 'day-modal') closeDay(); };

async function editFromCalendar(lessonId) {
  const l = lessons.find((x) => x.id === lessonId);
  if (!l) return;
  closeDay();
  await showView('rooms');
  await selectRoom(l.room_id);
  fillForm(l);
}

// ====== Իմ սենյակները ======
async function loadRooms() {
  rooms = await api('/api/rooms');
  renderRooms();
  if (activeRoom) { activeRoom = rooms.find((r) => r.id === activeRoom.id) || null; }
  if (activeRoom) { $('active-room-name').textContent = activeRoom.name; }
  else { $('room-schedule').classList.add('hidden'); }
}
function renderRooms() {
  const list = $('rooms-list');
  if (!rooms.length) { list.innerHTML = `<p class="empty-note">${t('no_rooms')}</p>`; return; }
  list.innerHTML = rooms.map((r) => `
    <div class="room-row ${activeRoom && activeRoom.id === r.id ? 'active' : ''}" data-id="${r.id}">
      <div><div class="room-name">${esc(r.name)}</div><div class="room-chan">📡 ${esc(r.channel)}</div></div>
      <div class="room-subs">${r.subscriber_count} ${t('subscribers')}</div>
    </div>`).join('');
  list.querySelectorAll('.room-row').forEach((el) => el.onclick = () => selectRoom(Number(el.dataset.id)));
}
$('room-form').onsubmit = async (e) => {
  e.preventDefault();
  $('room-error').textContent = '';
  try {
    const room = await api('/api/rooms', { method: 'POST', body: JSON.stringify({ name: $('r-name').value.trim(), channel: $('r-channel').value.trim() }) });
    $('room-form').reset();
    toast(t('toast_room_created'));
    await loadRooms();
    await selectRoom(room.id);
  } catch (err) { $('room-error').textContent = err.message; toast(err.message, 'err'); }
};
async function selectRoom(id) {
  activeRoom = rooms.find((r) => r.id === id) || null;
  if (!activeRoom) return;
  renderRooms();
  $('room-schedule').classList.remove('hidden');
  $('active-room-name').textContent = activeRoom.name;
  resetForm();
  await loadRoomLessons();
}
async function loadRoomLessons() {
  if (!activeRoom) return;
  roomLessons = await api('/api/rooms/' + activeRoom.id + '/lessons');
  renderRoomTable();
}
function renderRoomTable() {
  if (!roomLessons.length) { $('lessons-table').innerHTML = `<p class="empty-note">${t('no_lessons_yet')}</p>`; return; }
  const rows = [...roomLessons]
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time))
    .map((l) => `<tr class="st-${l.status || 'scheduled'}">
      <td>${esc(l.lesson_date)}</td>
      <td>${esc(timeStr(l))}</td>
      <td>${esc(l.title)}</td>
      <td>${esc(l.topic || '')}</td>
      <td>${statusBadge(l.status)}</td>
      <td><button class="btn-ghost edit" data-id="${l.id}">✎</button>
          <button class="btn-ghost del" data-id="${l.id}">🗑</button></td>
    </tr>`).join('');
  $('lessons-table').innerHTML = `<table>
    <thead><tr><th>${t('th_day')}</th><th>${t('th_time')}</th><th>${t('th_title')}</th>
    <th>${t('th_topic')}</th><th>${t('th_status')}</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  $('lessons-table').querySelectorAll('.edit').forEach((b) => b.onclick = () => fillForm(roomLessons.find((x) => x.id === Number(b.dataset.id))));
  $('lessons-table').querySelectorAll('.del').forEach((b) => b.onclick = () => delLesson(Number(b.dataset.id), false));
}

// ====== Դաս՝ ստեղծել / խմբագրել ======
$('f-repeat').onchange = (e) => $('repeat-count-field').classList.toggle('hidden', e.target.value !== 'weekly');

$('lesson-form').onsubmit = async (e) => {
  e.preventDefault();
  $('lesson-error').textContent = '';
  if (!activeRoom) { $('lesson-error').textContent = t('select_room_first'); return; }
  const id = $('lesson-id').value;
  const body = {
    title: $('f-title').value.trim(),
    topic: $('f-topic').value.trim() || null,
    lesson_date: $('f-date').value,
    start_time: $('f-start').value,
    end_time: $('f-end').value || null,
    note: $('f-note').value.trim() || null,
  };
  try {
    if (id) {
      await api('/api/lessons/' + id, { method: 'PUT', body: JSON.stringify(body) });
      toast(t('toast_saved'));
    } else {
      body.repeat = $('f-repeat').value;
      body.repeat_count = Number($('f-repeat-count').value) || 1;
      const r = await api('/api/rooms/' + activeRoom.id + '/lessons', { method: 'POST', body: JSON.stringify(body) });
      toast(t('toast_created', { n: (r && r.count) || 1 }));
    }
    resetForm();
    await loadRoomLessons();
    lessons = await api('/api/lessons'); // թարմացնել ագրեգացված կալենդարը
  } catch (err) { $('lesson-error').textContent = err.message; toast(err.message, 'err'); }
};
function fillForm(l) {
  if (!l) return;
  $('lesson-id').value = l.id;
  $('f-title').value = l.title;
  $('f-topic').value = l.topic || '';
  $('f-date').value = l.lesson_date;
  $('f-start').value = l.start_time;
  $('f-end').value = l.end_time || '';
  $('f-note').value = l.note || '';
  $('f-repeat').value = 'none';
  $('repeat-block').classList.add('hidden');
  $('repeat-count-field').classList.add('hidden');
  $('lesson-submit').textContent = t('btn_save');
  $('lesson-cancel').classList.remove('hidden');
  $('room-schedule').scrollIntoView({ behavior: 'smooth' });
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
    await api('/api/lessons/' + id + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
    toast(t('toast_status')); closeDay();
    if (activeRoom) await loadRoomLessons();
    await loadCalendar();
  } catch (err) { toast(err.message, 'err'); }
}
async function delLesson(id, series) {
  if (!confirm(series ? t('confirm_delete_series') : t('confirm_delete'))) return;
  try {
    await api('/api/lessons/' + id + (series ? '?series=1' : ''), { method: 'DELETE' });
    toast(t('toast_deleted')); closeDay();
    if (activeRoom) await loadRoomLessons();
    await loadCalendar();
  } catch (err) { toast(err.message, 'err'); }
}

// ====== Կանալներ ======
async function loadChannels() { channels = await api('/api/channels'); renderChannels(); }
function renderChannels() {
  const list = $('channels-list');
  if (!channels.length) { list.innerHTML = `<p class="empty-note">${t('no_channels')}</p>`; return; }
  list.innerHTML = channels.map((c) => {
    let action;
    if (c.owned) action = `<span class="badge s-scheduled">${t('own_channel')}</span>`;
    else if (c.subscribed) action = `<button class="btn-ghost unsub" data-id="${c.id}">${t('unsubscribe')}</button>`;
    else action = `<button class="btn-primary inline sub" data-id="${c.id}">${t('subscribe')}</button>`;
    return `<div class="channel-row">
      <div>
        <div class="room-name">${esc(c.name)}</div>
        <div class="room-chan">📡 ${esc(c.channel)} · ${t('owner')}: ${esc(c.owner_name || c.owner_username || '')}</div>
        <div class="room-subs">${c.subscriber_count} ${t('subscribers')}</div>
      </div>
      <div>${action}</div>
    </div>`;
  }).join('');
  list.querySelectorAll('.sub').forEach((b) => b.onclick = () => subscribe(Number(b.dataset.id), true));
  list.querySelectorAll('.unsub').forEach((b) => b.onclick = () => subscribe(Number(b.dataset.id), false));
}
async function subscribe(roomId, on) {
  try {
    await api('/api/channels/' + roomId + '/subscribe', { method: on ? 'POST' : 'DELETE' });
    toast(on ? t('toast_subscribed') : t('toast_unsubscribed'));
    await loadChannels();
    // բաժանորդագրումից հետո դասերն ուղիղ երևում են օրացույցում
    lessons = await api('/api/lessons');
    renderCalendar(); renderUpcoming();
  } catch (err) { toast(err.message, 'err'); }
}

// ====== Util ======
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ====== Start ======
fillLangSelect($('lang-auth')); fillLangSelect($('lang-app'));
applyStatic(); applyTheme(); startQuoteRotation();
if (token) boot();
