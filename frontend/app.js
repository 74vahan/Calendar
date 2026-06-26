// ====== Վիճակ ======
let token = localStorage.getItem('token') || null;
let me = null;            // { id, username, role }
let lessons = [];         // ընթացիկ ցուցադրվող դասերը
let viewYear, viewMonth;  // ցուցադրվող ամիսը (0-11)
let students = [];        // ադմինի համար
let filterStudent = '';   // ադմին: որ աշակերտի կալենդարն ենք նայում

const MONTHS = ['Հունվար','Փետրվար','Մարտ','Ապրիլ','Մայիս','Հունիս',
  'Հուլիս','Օգոստոս','Սեպտեմբեր','Հոկտեմբեր','Նոյեմբեր','Դեկտեմբեր'];
const WEEKDAYS = ['Երկ','Երք','Չրք','Հնգ','Ուր','Շբթ','Կիր']; // երկուշաբթիից

const $ = (id) => document.getElementById(id);

// ====== API օգնականներ ======
function authHeaders(extra = {}) {
  return { Authorization: 'Bearer ' + token, ...extra };
}
async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) throw new Error((data && data.error) || 'Սխալ');
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
  $('auth-submit').textContent = m === 'login' ? 'Մուտք' : 'Գրանցվել';
  $('auth-error').textContent = '';
}

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

// ====== Boot ======
async function boot() {
  try {
    me = await api('/api/me', { headers: authHeaders() });
  } catch {
    // անվավեր թոքեն
    token = null; localStorage.removeItem('token');
    $('auth').classList.remove('hidden'); $('app').classList.add('hidden');
    return;
  }
  $('auth').classList.add('hidden');
  $('app').classList.remove('hidden');
  $('who').textContent = me.username + (me.role === 'admin' ? ' (ադմին)' : '');

  const now = new Date();
  viewYear = now.getFullYear();
  viewMonth = now.getMonth();

  renderWeekdays();

  if (me.role === 'admin') {
    $('admin-panel').classList.remove('hidden');
    await loadStudents();
  } else {
    $('admin-panel').classList.add('hidden');
    $('admin-list').classList.add('hidden');
  }
  await loadLessons();
}

// ====== Աշակերտներ (ադմին) ======
async function loadStudents() {
  students = await api('/api/students', { headers: authHeaders() });
  const opts = students
    .map((s) => `<option value="${s.id}">${esc(s.full_name || s.username)} (${esc(s.username)})</option>`)
    .join('');
  $('f-student').innerHTML = students.length
    ? opts
    : '<option value="">— աշակերտներ դեռ չկան —</option>';
  $('filter-student').innerHTML =
    '<option value="">— Բոլոր դասերը (ցանկ) —</option>' + opts;
}

$('filter-student') && ($('filter-student').onchange = async (e) => {
  filterStudent = e.target.value;
  await loadLessons();
});

// ====== Դասեր ======
async function loadLessons() {
  let path = '/api/lessons';
  if (me.role === 'admin' && filterStudent) path += '?student_id=' + filterStudent;
  lessons = await api(path, { headers: authHeaders() });
  renderCalendar();
  if (me.role === 'admin') renderAdminList();
}

// ====== Կալենդարի ցանց ======
function renderWeekdays() {
  $('weekdays').innerHTML = WEEKDAYS.map((d) => `<div>${d}</div>`).join('');
}

function ymd(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function renderCalendar() {
  $('cal-title').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  const cal = $('calendar');
  cal.innerHTML = '';

  const first = new Date(viewYear, viewMonth, 1);
  // JS: 0=կիրակի ... 6=շաբաթ. Մեզ պետք է երկուշաբթիից:
  let lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

  // խմբավորում ըստ օրվա
  const byDay = {};
  for (const l of lessons) {
    (byDay[l.lesson_date] = byDay[l.lesson_date] || []).push(l);
  }

  const todayStr = ymd(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  for (let i = 0; i < lead; i++) {
    const c = document.createElement('div');
    c.className = 'cell empty';
    cal.appendChild(c);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = ymd(viewYear, viewMonth, d);
    const dayLessons = (byDay[key] || []).sort((a, b) => a.start_time.localeCompare(b.start_time));
    const c = document.createElement('div');
    c.className = 'cell' + (key === todayStr ? ' today' : '');
    c.innerHTML = `<div class="num">${d}</div>`;
    const shown = dayLessons.slice(0, 2);
    for (const l of shown) {
      const p = document.createElement('div');
      p.className = 'pill';
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

$('prev').onclick = () => { shiftMonth(-1); };
$('next').onclick = () => { shiftMonth(1); };
function shiftMonth(delta) {
  viewMonth += delta;
  if (viewMonth < 0) { viewMonth = 11; viewYear--; }
  if (viewMonth > 11) { viewMonth = 0; viewYear++; }
  renderCalendar();
}

// ====== Օրվա մոդալ ======
function openDay(key, dayLessons) {
  const [y, m, d] = key.split('-');
  $('day-modal-title').textContent = `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
  const body = $('day-modal-body');
  if (!dayLessons.length) {
    body.innerHTML = '<p class="empty-note">Այս օրը դասեր չկան։</p>';
  } else {
    body.innerHTML = dayLessons.map(lessonCard).join('');
    if (me.role === 'admin') wireDayActions();
  }
  $('day-modal').classList.remove('hidden');
}
function lessonCard(l) {
  const time = l.end_time ? `${l.start_time}–${l.end_time}` : l.start_time;
  const adminWho = me.role === 'admin' && l.student_name
    ? `<div class="note">👤 ${esc(l.student_name || l.student_username)}</div>` : '';
  const actions = me.role === 'admin'
    ? `<div class="row-actions">
         <button class="btn-ghost edit" data-id="${l.id}">Խմբագրել</button>
         <button class="btn-ghost del" data-id="${l.id}">Ջնջել</button>
       </div>` : '';
  return `<div class="lesson-item">
    <div class="time">🕒 ${esc(time)}</div>
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
    b.onclick = () => delLesson(Number(b.dataset.id));
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
    $('lessons-table').innerHTML = '<p class="empty-note">Դեռ դասեր չկան։</p>';
    return;
  }
  const rows = [...lessons]
    .sort((a, b) => (a.lesson_date + a.start_time).localeCompare(b.lesson_date + b.start_time))
    .map((l) => `<tr>
      <td>${esc(l.lesson_date)}</td>
      <td>${esc(l.start_time)}${l.end_time ? '–' + esc(l.end_time) : ''}</td>
      <td>${esc(l.student_name || l.student_username || '')}</td>
      <td>${esc(l.title)}</td>
      <td>${esc(l.topic || '')}</td>
      <td>
        <button class="btn-ghost edit" data-id="${l.id}">✎</button>
        <button class="btn-ghost del" data-id="${l.id}">🗑</button>
      </td>
    </tr>`).join('');
  $('lessons-table').innerHTML = `<table>
    <thead><tr><th>Օր</th><th>Ժամ</th><th>Աշակերտ</th><th>Անվանում</th><th>Թեմա</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  $('lessons-table').querySelectorAll('.edit').forEach((b) => b.onclick = () => startEdit(Number(b.dataset.id)));
  $('lessons-table').querySelectorAll('.del').forEach((b) => b.onclick = () => delLesson(Number(b.dataset.id)));
}

// ====== Ադմին: ստեղծել / խմբագրել / ջնջել ======
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
    } else {
      await api('/api/lessons', {
        method: 'POST', headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
    }
    resetForm();
    await loadLessons();
  } catch (err) {
    $('lesson-error').textContent = err.message;
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
  $('lesson-submit').textContent = 'Պահպանել';
  $('lesson-cancel').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$('lesson-cancel').onclick = resetForm;
function resetForm() {
  $('lesson-form').reset();
  $('lesson-id').value = '';
  $('lesson-submit').textContent = 'Ավելացնել';
  $('lesson-cancel').classList.add('hidden');
  $('lesson-error').textContent = '';
}

async function delLesson(id) {
  if (!confirm('Ջնջե՞լ այս դասը։')) return;
  await api('/api/lessons/' + id, { method: 'DELETE', headers: authHeaders() });
  closeDay();
  await loadLessons();
}

// ====== Util ======
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ====== Start ======
if (token) boot();
