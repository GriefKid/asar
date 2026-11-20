'use strict';

// ── Jalali conversion ─────────────────────────────────────────────────────
const J_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const J_DAYS   = ['یک‌شنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه','شنبه'];

function toJalali(gy, gm, gd) {
  const g_d_no = [0,31,59+Math.floor(gy/4)-Math.floor(gy/100)+Math.floor(gy/400)-Math.floor((gy-1)/4)+Math.floor((gy-1)/100)-Math.floor((gy-1)/400),
    91,120,151,181,212,243,273,304,334];
  let jy = gy <= 1600 ? 0 : 979;
  gy = gy <= 1600 ? gy - 621 : gy - 1600;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let g_days = 365*gy + Math.floor((gy2+3)/4) - Math.floor((gy2+99)/100) + Math.floor((gy2+399)/400) - 80 + gd + g_d_no[gm-1];
  jy += 33*Math.floor(g_days/12053);
  g_days %= 12053;
  jy += 4*Math.floor(g_days/1461);
  g_days %= 1461;
  if (g_days > 365) { jy += Math.floor((g_days-1)/365); g_days = (g_days-1) % 365; }
  const jm = g_days < 186 ? 1+Math.floor(g_days/31) : 7+Math.floor((g_days-186)/30);
  const jd = g_days < 186 ? (g_days % 31)+1 : ((g_days-186) % 30)+1;
  return { y: jy, m: jm, d: jd };
}

function fromJalali(jy, jm, jd) {
  let epbase = jy - (jy >= 0 ? 474 : 473);
  const epyear = 474 + (((epbase % 2820) + 2820) % 2820);
  return jd + (jm <= 6 ? (jm-1)*31 : (jm-1)*30+6) +
    Math.floor((epyear*682 - 110) / 2816) + (epyear-1)*365 +
    Math.floor(epbase/2820)*1029983 + 1948319.5 - 2440587.5;
}

function jalaliToGregorian(jy, jm, jd) {
  const jdn = fromJalali(jy, jm, jd);
  const a = jdn + 0.5, z = Math.floor(a), f = a - z;
  let b = z >= 2299161 ? ((() => { const alpha = Math.floor((z-1867216.25)/36524.25); return z+1+alpha-Math.floor(alpha/4); })()) : z;
  const c = b + 1524, d = Math.floor((c-122.1)/365.25), e = Math.floor(365.25*d), g = Math.floor((c-e)/30.6001);
  const gd = c - e + f - Math.floor(30.6001*g);
  const gm = g < 14 ? g-1 : g-13;
  const gy = gm > 2 ? d-4716 : d-4715;
  return { y: gy, m: gm, d: Math.floor(gd) };
}

function todayJalali() {
  const now = new Date();
  return toJalali(now.getFullYear(), now.getMonth()+1, now.getDate());
}

function jalaliMonthLen(y, m) {
  if (m <= 6) return 31;
  if (m <= 11) return 30;
  // Esfand: leap check
  const g = jalaliToGregorian(y, 12, 1);
  const isLeap = (g.y%4===0 && g.y%100!==0) || g.y%400===0;
  return isLeap ? 30 : 29;
}

function jalaliFirstWeekday(y, m) {
  const g = jalaliToGregorian(y, m, 1);
  const dow = new Date(g.y, g.m-1, g.d).getDay(); // 0=Sun
  // Jalali week starts Sat(6): convert Sun=0→1, Mon=1→2 ... Sat=6→0
  return (dow + 1) % 7;
}

function toFarsiNum(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

// ── State & persistence ───────────────────────────────────────────────────
const KEY_LIB    = 'asar-library';
const KEY_EVENTS = 'asar-events';
const KEY_SETTINGS = 'asar-settings';

let library = [];
let events  = {}; // keyed by "jy-jm-jd"
let settings = {};
let libFilter = 'all';
let editingItemId = null;
let editingEventId = null;
let selectedItemType = 'book';
let selectedEventType = 'task';

let calViewY, calViewM;
let selectedDay; // {y,m,d} jalali

function load() {
  try { library  = JSON.parse(localStorage.getItem(KEY_LIB))  || []; } catch { library  = []; }
  try { events   = JSON.parse(localStorage.getItem(KEY_EVENTS)) || {}; } catch { events   = {}; }
  try { settings = JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}; } catch { settings = {}; }
}

function saveLib()      { localStorage.setItem(KEY_LIB,    JSON.stringify(library)); }
function saveEvents()   { localStorage.setItem(KEY_EVENTS, JSON.stringify(events));  }
function saveSettings() { localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── Navigation ────────────────────────────────────────────────────────────
let activeSection = 'home';

window.showSection = function(id, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('section-' + id).classList.add('active');
  if (el) el.classList.add('active');
  activeSection = id;
  if (id === 'home')     renderHome();
  if (id === 'library')  renderLibrary();
  if (id === 'planner')  renderPlanner();
  if (id === 'settings') renderSettings();
};

// ── HOME ──────────────────────────────────────────────────────────────────
function renderHome() {
  const today = todayJalali();
  document.getElementById('shamsi-date').textContent =
    toFarsiNum(today.d) + ' ' + J_MONTHS[today.m-1] + ' ' + toFarsiNum(today.y);

  const g = new Date();
  document.getElementById('shamsi-day').textContent =
    J_DAYS[g.getDay()] + ' — ' + g.toLocaleDateString('fa-IR',{year:'numeric',month:'long',day:'numeric'});

  // Stats
  const total  = library.length;
  const active = library.filter(i => i.stage === 'active').length;
  const done   = library.filter(i => i.stage === 'done').length;
  const todayKey = `${today.y}-${today.m}-${today.d}`;
  const evToday = (events[todayKey] || []).length;

  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card" onclick="showSection('library',document.querySelector('[onclick*=library]'))">
      <div class="stat-num accent">${toFarsiNum(total)}</div><div class="stat-label">مجموع آثار</div>
    </div>
    <div class="stat-card" onclick="showSection('library',document.querySelector('[onclick*=library]'))">
      <div class="stat-num" style="color:var(--accent)">${toFarsiNum(active)}</div><div class="stat-label">در حال بررسی</div>
    </div>
    <div class="stat-card" onclick="showSection('library',document.querySelector('[onclick*=library]'))">
      <div class="stat-num ok">${toFarsiNum(done)}</div><div class="stat-label">تمام شده</div>
    </div>
    <div class="stat-card" onclick="showSection('planner',document.querySelector('[onclick*=planner]'))">
      <div class="stat-num warn">${toFarsiNum(evToday)}</div><div class="stat-label">رویداد امروز</div>
    </div>`;

  // Today events
  const todayEvs = events[todayKey] || [];
  const planEl = document.getElementById('today-plan-list');
  if (!todayEvs.length) {
    planEl.innerHTML = '<div class="plan-empty">امروز رویدادی نداری. یه برنامه اضافه کن!</div>';
  } else {
    planEl.innerHTML = todayEvs.sort((a,b) => a.time.localeCompare(b.time)).map(ev => `
      <div class="plan-item ${ev.done?'done':''}" onclick="toggleEventDone('${todayKey}','${ev.id}')">
        <div class="plan-time">${ev.time||''}</div>
        <div class="plan-dot" style="background:${ev.type==='habit'?'var(--ok)':ev.type==='note'?'var(--t3)':'var(--accent)'}"></div>
        <div class="plan-title">${esc(ev.title)}</div>
        <div class="plan-check ${ev.done?'done':''}">
          ${ev.done ? '<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M2 6l3 3 5-5"/></svg>' : ''}
        </div>
      </div>`).join('');
  }

  // Active items
  const activeItems = library.filter(i => i.stage === 'active');
  const acEl = document.getElementById('active-cards');
  if (!activeItems.length) {
    acEl.innerHTML = '<div style="font-size:12.5px;color:var(--t3);padding:8px 0">چیزی در حال بررسی نداری</div>';
  } else {
    acEl.innerHTML = activeItems.map(item => `
      <div class="active-card" onclick="showSection('library',document.querySelector('[onclick*=library]'))">
        <div class="active-card-cover">${item.cover ? `<img src="${item.cover}" onerror="this.style.display='none'">` : typeEmoji(item.type)}</div>
        <div class="active-card-body">
          <div class="active-card-title">${esc(item.title)}</div>
          <div class="active-card-sub">${esc(item.creator||'')}</div>
          <div class="active-card-prog"><div class="active-card-prog-fill" style="width:${item.progress||0}%"></div></div>
        </div>
      </div>`).join('');
  }
}

window.toggleEventDone = function(key, id) {
  const ev = (events[key]||[]).find(e => e.id === id);
  if (!ev) return;
  ev.done = !ev.done;
  saveEvents();
  renderHome();
};

// ── LIBRARY ───────────────────────────────────────────────────────────────
function typeEmoji(t) { return t === 'book' ? '📚' : t === 'film' ? '🎬' : '🎵'; }
function typeLabel(t) { return t === 'book' ? 'کتاب' : t === 'film' ? 'فیلم' : 'موزیک'; }

window.filterLib = function(el, type) {
  document.querySelectorAll('.lib-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  libFilter = type;
  renderLibrary();
};

function filteredItems() {
  return libFilter === 'all' ? library : library.filter(i => i.type === libFilter);
}

function renderLibrary() {
  const cols = { queue:[], active:[], done:[] };
  filteredItems().forEach(item => { if (cols[item.stage]) cols[item.stage].push(item); });

  ['queue','active','done'].forEach(stage => {
    const el = document.getElementById('col-'+stage);
    const cnt = document.getElementById('cnt-'+stage);
    cnt.textContent = toFarsiNum(cols[stage].length);
    if (!cols[stage].length) {
      el.innerHTML = '<div class="kcard-empty">اینجا خالیه</div>';
      return;
    }
    el.innerHTML = cols[stage].map(item => `
      <div class="kcard" id="kcard-${item.id}">
        <div class="kcard-top">
          <div class="kcard-cover">${item.cover ? `<img src="${item.cover}" onerror="this.parentElement.textContent='${typeEmoji(item.type)}'">` : typeEmoji(item.type)}</div>
          <div class="kcard-info">
            <div class="kcard-title">${esc(item.title)}</div>
            <div class="kcard-creator">${esc(item.creator||'')}</div>
            <div class="kcard-badges">
              <span class="kcard-badge type-${item.type}">${typeLabel(item.type)}</span>
              ${item.year ? `<span class="kcard-badge" style="background:rgba(255,255,255,.06);color:var(--t3)">${esc(item.year)}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="kcard-rating">${[1,2,3,4,5].map(n => `<span class="star ${(item.rating||0)>=n?'on':''}" onclick="rateItem('${item.id}',${n})">★</span>`).join('')}</div>
        <div class="kcard-actions">
          ${stage !== 'queue'  ? `<div class="kcard-action" onclick="moveItem('${item.id}','queue')">↩ می‌خوام</div>` : ''}
          ${stage !== 'active' ? `<div class="kcard-action primary" onclick="moveItem('${item.id}','active')">▶ شروع</div>` : ''}
          ${stage !== 'done'   ? `<div class="kcard-action" onclick="moveItem('${item.id}','done')">✓ تموم شد</div>` : ''}
          <div class="kcard-action" onclick="deleteItem('${item.id}')">🗑</div>
        </div>
      </div>`).join('');
  });
}

window.rateItem = function(id, rating) {
  const item = library.find(i => i.id === id);
  if (!item) return;
  item.rating = item.rating === rating ? 0 : rating;
  saveLib();
  renderLibrary();
};

window.moveItem = function(id, stage) {
  const item = library.find(i => i.id === id);
  if (!item) return;
  item.stage = stage;
  saveLib();
  renderLibrary();
  if (activeSection === 'home') renderHome();
};

window.deleteItem = function(id) {
  library = library.filter(i => i.id !== id);
  saveLib();
  renderLibrary();
  if (activeSection === 'home') renderHome();
};

// Add item modal
window.openAddItem = function(id) {
  editingItemId = id || null;
  const item = id ? library.find(i => i.id === id) : null;
  document.getElementById('item-title').value   = item ? item.title   : '';
  document.getElementById('item-creator').value = item ? (item.creator||'') : '';
  document.getElementById('item-year').value    = item ? (item.year||'')    : '';
  document.getElementById('item-notes').value   = item ? (item.notes||'')   : '';
  selectedItemType = item ? item.type : 'book';
  document.querySelectorAll('.type-opt[data-t]').forEach(o => {
    o.classList.toggle('on', o.dataset.t === selectedItemType);
  });
  document.getElementById('add-item-modal').classList.add('show');
  setTimeout(() => document.getElementById('item-title').focus(), 100);
};

window.closeAddItem = function() {
  document.getElementById('add-item-modal').classList.remove('show');
};

window.selectType = function(el, t) {
  document.querySelectorAll('.type-opt[data-t]').forEach(o => o.classList.remove('on'));
  el.classList.add('on');
  selectedItemType = t;
};

window.saveItem = function() {
  const title = document.getElementById('item-title').value.trim();
  if (!title) { document.getElementById('item-title').focus(); return; }
  if (editingItemId) {
    const item = library.find(i => i.id === editingItemId);
    if (item) {
      item.title   = title;
      item.creator = document.getElementById('item-creator').value.trim();
      item.year    = document.getElementById('item-year').value.trim();
      item.notes   = document.getElementById('item-notes').value.trim();
      item.type    = selectedItemType;
    }
  } else {
    library.push({
      id:      uid(),
      type:    selectedItemType,
      title,
      creator: document.getElementById('item-creator').value.trim(),
      year:    document.getElementById('item-year').value.trim(),
      notes:   document.getElementById('item-notes').value.trim(),
      stage:   'queue',
      rating:  0,
      cover:   null,
      progress: 0,
      createdAt: Date.now()
    });
  }
  saveLib();
  closeAddItem();
  renderLibrary();
  if (activeSection === 'home') renderHome();
};

// ── PLANNER ───────────────────────────────────────────────────────────────
function renderPlanner() {
  renderCalendar();
  renderDayView();
}

function renderCalendar() {
  const today = todayJalali();
  document.getElementById('cal-month').textContent = J_MONTHS[calViewM-1];
  document.getElementById('cal-year').textContent  = toFarsiNum(calViewY);

  const firstWd = jalaliFirstWeekday(calViewY, calViewM);
  const monthLen = jalaliMonthLen(calViewY, calViewM);

  const DOW = ['ش','ی','د','س','چ','پ','ج'];
  let html = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');

  for (let i = 0; i < firstWd; i++) html += '<div></div>';
  for (let d = 1; d <= monthLen; d++) {
    const key = `${calViewY}-${calViewM}-${d}`;
    const isToday    = calViewY===today.y && calViewM===today.m && d===today.d;
    const isSelected = selectedDay.y===calViewY && selectedDay.m===calViewM && selectedDay.d===d;
    const hasEv      = (events[key]||[]).length > 0;
    html += `<div class="cal-day ${isToday?'today':''} ${isSelected?'selected':''}"
                  onclick="selectCalDay(${calViewY},${calViewM},${d})">${toFarsiNum(d)}${hasEv?'<span class="has-event"></span>':''}</div>`;
  }
  document.getElementById('cal-grid').innerHTML = html;
}

window.selectCalDay = function(y, m, d) {
  selectedDay = { y, m, d };
  renderCalendar();
  renderDayView();
};

window.calNav = function(dir) {
  calViewM += dir;
  if (calViewM > 12) { calViewM = 1; calViewY++; }
  if (calViewM < 1)  { calViewM = 12; calViewY--; }
  renderCalendar();
};

function renderDayView() {
  const { y, m, d } = selectedDay;
  const g = jalaliToGregorian(y, m, d);
  const dow = J_DAYS[new Date(g.y, g.m-1, g.d).getDay()];
  document.getElementById('day-title').textContent = `${toFarsiNum(d)} ${J_MONTHS[m-1]} ${toFarsiNum(y)}`;
  document.getElementById('day-sub').textContent   = dow;

  const key = `${y}-${m}-${d}`;
  const dayEvs = events[key] || [];

  let html = '';
  for (let h = 5; h < 24; h++) {
    const hStr = String(h).padStart(2,'0');
    const slotEvs = dayEvs.filter(e => e.time && e.time.startsWith(hStr+':'));
    html += `<div class="time-slot">
      <div class="slot-label">${hStr}:۰۰</div>
      <div class="slot-events">
        ${slotEvs.map(ev => `
          <div class="event-block event-type-${ev.type} ${ev.done?'done':''}"
               onclick="openEditEvent('${key}','${ev.id}')">
            <div class="event-title">${esc(ev.title)}</div>
            <div class="event-meta">${ev.time}${ev.duration?' — '+toFarsiNum(ev.duration)+' دقیقه':''}</div>
          </div>`).join('')}
        ${slotEvs.length === 0 ? `<div class="event-empty" onclick="quickAddEvent('${hStr}:00')"></div>` : ''}
      </div>
    </div>`;
  }
  document.getElementById('timeline').innerHTML = html;
}

window.quickAddEvent = function(time) {
  openAddEvent(time);
};

window.openAddEvent = function(prefillTime) {
  editingEventId = null;
  document.getElementById('event-title').value = '';
  document.getElementById('event-time').value  = prefillTime || '09:00';
  document.getElementById('event-dur').value   = '60';
  selectedEventType = 'task';
  document.querySelectorAll('.type-opt[data-ev]').forEach(o => {
    o.classList.toggle('on', o.dataset.ev === 'task');
  });
  document.getElementById('add-event-modal').classList.add('show');
  setTimeout(() => document.getElementById('event-title').focus(), 100);
};

window.openEditEvent = function(key, id) {
  const ev = (events[key]||[]).find(e => e.id === id);
  if (!ev) return;
  editingEventId = { key, id };
  document.getElementById('event-title').value = ev.title;
  document.getElementById('event-time').value  = ev.time || '09:00';
  document.getElementById('event-dur').value   = ev.duration || 60;
  selectedEventType = ev.type || 'task';
  document.querySelectorAll('.type-opt[data-ev]').forEach(o => {
    o.classList.toggle('on', o.dataset.ev === selectedEventType);
  });
  document.getElementById('add-event-modal').classList.add('show');
};

window.closeAddEvent = function() {
  document.getElementById('add-event-modal').classList.remove('show');
};

window.selectEventType = function(el, t) {
  document.querySelectorAll('.type-opt[data-ev]').forEach(o => o.classList.remove('on'));
  el.classList.add('on');
  selectedEventType = t;
};

window.saveEvent = function() {
  const title = document.getElementById('event-title').value.trim();
  if (!title) { document.getElementById('event-title').focus(); return; }
  const time = document.getElementById('event-time').value;
  const dur  = parseInt(document.getElementById('event-dur').value) || 60;

  if (editingEventId) {
    const { key, id } = editingEventId;
    const ev = (events[key]||[]).find(e => e.id === id);
    if (ev) { ev.title = title; ev.time = time; ev.duration = dur; ev.type = selectedEventType; }
  } else {
    const { y, m, d } = selectedDay;
    const key = `${y}-${m}-${d}`;
    if (!events[key]) events[key] = [];
    events[key].push({ id: uid(), title, time, duration: dur, type: selectedEventType, done: false });
  }
  saveEvents();
  closeAddEvent();
  renderDayView();
  renderCalendar();
  if (activeSection === 'home') renderHome();
};

// ── SETTINGS ─────────────────────────────────────────────────────────────
function renderSettings() {
  const inp = document.getElementById('tmdb-key-input');
  if (inp) inp.value = settings['tmdb-key'] || '';
}

window.saveSetting = function(key, inputId) {
  const val = document.getElementById(inputId).value.trim();
  settings[key] = val;
  saveSettings();
  const btn = document.querySelector(`[onclick="saveSetting('${key}','${inputId}')"]`);
  if (btn) { const orig = btn.textContent; btn.textContent = '✓ ذخیره شد'; setTimeout(() => btn.textContent = orig, 1500); }
};

// ── Utils ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────
load();

const today = todayJalali();
calViewY   = today.y;
calViewM   = today.m;
selectedDay = { y: today.y, m: today.m, d: today.d };

renderHome();
