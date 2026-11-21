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
const KEY_HABITS = 'asar-habits';
const KEY_GOALS  = 'asar-goals';

let library = [];
let events  = {}; // keyed by "jy-jm-jd"
let settings = {};
let habits = [];   // [{id, name, doneByDay:{key:bool}}]
let goals  = [];   // [{id, title, type, target, current}]
let libFilter = 'all';
let libSort   = 'default'; // 'default' | 'rating' | 'recent'
let editingItemId = null;
let editingEventId = null;
let selectedItemType = 'book';
let selectedEventType = 'task';
let selectedRecur = 'none';
let selectedGoalType = 'book';

let calViewY, calViewM;
let selectedDay; // {y,m,d} jalali

function load() {
  try { library  = JSON.parse(localStorage.getItem(KEY_LIB))  || []; } catch { library  = []; }
  try { events   = JSON.parse(localStorage.getItem(KEY_EVENTS)) || {}; } catch { events   = {}; }
  try { settings = JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}; } catch { settings = {}; }
  try { habits   = JSON.parse(localStorage.getItem(KEY_HABITS)) || []; } catch { habits   = []; }
  try { goals    = JSON.parse(localStorage.getItem(KEY_GOALS))  || []; } catch { goals    = []; }
}

function saveLib()      { localStorage.setItem(KEY_LIB,    JSON.stringify(library)); }
function saveEvents()   { localStorage.setItem(KEY_EVENTS, JSON.stringify(events));  }
function saveSettings() { localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); }
function saveHabits()   { localStorage.setItem(KEY_HABITS,  JSON.stringify(habits));  }
function saveGoals()    { localStorage.setItem(KEY_GOALS,   JSON.stringify(goals));   }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── Navigation ────────────────────────────────────────────────────────────
let activeSection = 'home';

window.showSection = function(id, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('section-' + id).classList.add('active');
  if (el) el.classList.add('active');
  activeSection = id;
  if (id === 'home')      renderHome();
  if (id === 'library')   renderLibrary();
  if (id === 'planner')   renderPlanner();
  if (id === 'settings')  renderSettings();
  if (id === 'community') loadCommunity(currentCommunityTab);
  if (id === 'admin')     loadAdminData();
};

// ── Command Palette ───────────────────────────────────────────────────────
let cmdPalSel = -1, cmdPalItems = [];

window.openCmdPal = function() {
  document.getElementById('cmdpal').classList.add('show');
  const inp = document.getElementById('cmdpal-input');
  inp.value = '';
  cmdPalSel = -1;
  searchCmdPal('');
  setTimeout(() => inp.focus(), 50);
};

window.closeCmdPal = function() {
  document.getElementById('cmdpal').classList.remove('show');
};

window.cmdPalKey = function(e) {
  if (e.key === 'Escape') { closeCmdPal(); return; }
  if (e.key === 'ArrowDown') { cmdPalSel = Math.min(cmdPalSel + 1, cmdPalItems.length - 1); highlightCmdPal(); e.preventDefault(); }
  if (e.key === 'ArrowUp')   { cmdPalSel = Math.max(cmdPalSel - 1, 0); highlightCmdPal(); e.preventDefault(); }
  if (e.key === 'Enter' && cmdPalSel >= 0) { cmdPalItems[cmdPalSel]?.action(); closeCmdPal(); }
};

function highlightCmdPal() {
  document.querySelectorAll('.cmdpal-item').forEach((el, i) => el.classList.toggle('sel', i === cmdPalSel));
}

window.searchCmdPal = function(q) {
  q = q.trim().toLowerCase();
  cmdPalItems = [];
  const res = document.getElementById('cmdpal-results');

  // Actions
  const actions = [
    { icon:'🏠', title:'خانه', sub:'برو به بخش خانه', badge:'بخش', action:()=>showSection('home', document.querySelector('[onclick*="home"]')) },
    { icon:'📚', title:'کتابخانه', sub:'برو به کتابخانه', badge:'بخش', action:()=>showSection('library', document.querySelector('[onclick*="library"]')) },
    { icon:'📅', title:'برنامه‌ریزی', sub:'برو به تقویم', badge:'بخش', action:()=>showSection('planner', document.querySelector('[onclick*="planner"]')) },
    { icon:'🎵', title:'موزیک پلیر', sub:'باز کردن موزیک پلیر', badge:'اپ', action:()=>window.api.openMusicPlayer() },
    { icon:'🎬', title:'ویدئو پلیر', sub:'باز کردن ویدئو پلیر', badge:'اپ', action:()=>window.api.openVideoPlayer() },
    { icon:'📖', title:'بوک ریدر', sub:'باز کردن بوک ریدر', badge:'اپ', action:()=>window.api.openBookReader() },
    { icon:'➕', title:'اثر جدید', sub:'اضافه کردن به کتابخانه', badge:'عمل', action:()=>{ showSection('library',null); openAddItem(); } },
  ].filter(a => !q || a.title.includes(q) || a.sub.includes(q));

  // Library items
  const libItems = library.filter(i => !q || (i.title||'').toLowerCase().includes(q) || (i.creator||'').toLowerCase().includes(q)).slice(0, 8).map(i => ({
    icon: typeEmoji(i.type), title: i.title, sub: i.creator || typeLabel(i.type),
    badge: typeLabel(i.type), action: () => { showSection('library', document.querySelector('[onclick*="library"]')); }
  }));

  // Events (today)
  const today = todayJalali();
  const todayKey = `${today.y}-${today.m}-${today.d}`;
  const evItems = (events[todayKey] || []).filter(e => !q || e.title.toLowerCase().includes(q)).slice(0, 4).map(e => ({
    icon: e.type==='habit'?'🔁':e.type==='note'?'📝':'✅', title: e.title, sub: `امروز ${e.time||''}`, badge:'رویداد',
    action: () => showSection('planner', document.querySelector('[onclick*="planner"]'))
  }));

  cmdPalItems = [...actions, ...libItems, ...evItems];
  if (!cmdPalItems.length) { res.innerHTML = '<div class="cmdpal-empty">نتیجه‌ای پیدا نشد</div>'; return; }

  let html = '';
  if (actions.length && !q) html += '<div class="cmdpal-section-label">دستورات سریع</div>';
  if (libItems.length)  html += '<div class="cmdpal-section-label">کتابخانه</div>';
  cmdPalItems.forEach((item, i) => {
    html += `<div class="cmdpal-item ${i===cmdPalSel?'sel':''}" onclick="cmdPalItems[${i}].action();closeCmdPal()">
      <div class="cmdpal-item-icon">${item.icon}</div>
      <div class="cmdpal-item-info">
        <div class="cmdpal-item-title">${esc(item.title)}</div>
        <div class="cmdpal-item-sub">${esc(item.sub)}</div>
      </div>
      <span class="cmdpal-item-badge">${esc(item.badge)}</span>
    </div>`;
  });
  res.innerHTML = html;
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

  renderXP();
  renderHeatmap();
  renderTopRated();
  renderGoalsHome();

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

window.setSortMode = function(mode, el) {
  libSort = mode;
  document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('on'));
  if (el) el.classList.add('on');
  else { const btn = document.getElementById('sort-'+mode); if (btn) btn.classList.add('on'); }
  renderLibrary();
};

function filteredItems() {
  let items = libFilter === 'all' ? library : library.filter(i => i.type === libFilter);
  if (libSort === 'rating') items = [...items].sort((a,b) => (b.rating||0) - (a.rating||0));
  if (libSort === 'recent') items = [...items].sort((a,b) => (b.createdAt||0) - (a.createdAt||0));
  return items;
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
  renderHabits();
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
  selectedRecur = 'none';
  document.getElementById('event-title').value = '';
  document.getElementById('event-time').value  = prefillTime || '09:00';
  document.getElementById('event-dur').value   = '60';
  selectedEventType = 'task';
  document.querySelectorAll('.type-opt[data-ev]').forEach(o => o.classList.toggle('on', o.dataset.ev === 'task'));
  document.querySelectorAll('[data-r]').forEach(o => o.classList.toggle('on', o.dataset.r === 'none'));
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
    const newEv = { id: uid(), title, time, duration: dur, type: selectedEventType, done: false, recur: selectedRecur };
    events[key].push(newEv);
    if (selectedRecur !== 'none') generateRecurringEvents(newEv, { y, m, d });
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
  const cinp = document.getElementById('claude-key-input');
  try { if (cinp) cinp.value = localStorage.getItem('claude-api-key') || ''; } catch {}
  // Firebase config
  const fbInp = document.getElementById('firebase-config-inp');
  const fbCfg = getFirebaseConfig();
  if (fbInp && fbCfg) { try { fbInp.value = JSON.stringify(fbCfg, null, 2); } catch {} }
  updateFirebaseStatus(!!(window._fbApp && window._currentUser), window._currentUser || null);
}

window.saveClaudeKey = function() {
  const val = document.getElementById('claude-key-input').value.trim();
  try { localStorage.setItem('claude-api-key', val); } catch {}
  const btn = document.querySelector('[onclick="saveClaudeKey()"]');
  if (btn) { const orig = btn.textContent; btn.textContent = '✓ ذخیره شد'; setTimeout(() => btn.textContent = orig, 1500); }
};

window.saveSetting = function(key, inputId) {
  const val = document.getElementById(inputId).value.trim();
  settings[key] = val;
  saveSettings();
  const btn = document.querySelector(`[onclick="saveSetting('${key}','${inputId}')"]`);
  if (btn) { const orig = btn.textContent; btn.textContent = '✓ ذخیره شد'; setTimeout(() => btn.textContent = orig, 1500); }
};

// ── Top Rated ─────────────────────────────────────────────────────────────
function renderTopRated() {
  const el = document.getElementById('top-rated-scroll');
  if (!el) return;
  const rated = library.filter(i => i.rating > 0).sort((a,b) => (b.rating||0)-(a.rating||0)).slice(0, 10);
  if (!rated.length) { el.innerHTML = '<div style="font-size:12.5px;color:var(--t3);padding:8px 0">هنوز امتیاز ندادی</div>'; return; }
  el.innerHTML = rated.map(item => `
    <div class="rated-card" onclick="showSection('library',document.querySelector('[onclick*=library]'))">
      <div class="rated-cover">${item.cover ? `<img src="${item.cover}" onerror="this.style.display='none'">` : typeEmoji(item.type)}</div>
      <div class="rated-body">
        <div class="rated-title">${esc(item.title)}</div>
        <div class="rated-stars">${'★'.repeat(item.rating||0)}${'☆'.repeat(5-(item.rating||0))}</div>
      </div>
    </div>`).join('');
}

// ── Goals ─────────────────────────────────────────────────────────────────
function renderGoalsHome() {
  const el = document.getElementById('goals-home-list');
  if (!el) return;
  if (!goals.length) { el.innerHTML = '<div class="plan-empty">هیچ هدفی نداری. یه هدف برای خودت تعریف کن!</div>'; return; }
  el.innerHTML = goals.map(g => {
    const pct = g.target > 0 ? Math.min(100, Math.round((g.current / g.target) * 100)) : 0;
    const icon = g.type === 'book' ? '📚' : g.type === 'film' ? '🎬' : '🎯';
    return `<div class="goal-item">
      <div style="font-size:22px;flex-shrink:0">${icon}</div>
      <div class="goal-info">
        <div class="goal-title-txt">${esc(g.title)}</div>
        <div class="goal-bar-track"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
        <div class="goal-meta">${toFarsiNum(g.current)} از ${toFarsiNum(g.target)} — ${toFarsiNum(pct)}٪</div>
      </div>
      <div class="goal-pct">${toFarsiNum(pct)}٪</div>
      <div style="display:flex;gap:5px;flex-shrink:0">
        <div class="goal-del" onclick="incrementGoal('${g.id}')" title="یک عدد اضافه کن">+</div>
        <div class="goal-del" onclick="deleteGoal('${g.id}')">🗑</div>
      </div>
    </div>`;
  }).join('');
}

let _goalTypeEdit = 'book';
window.openAddGoal = function() {
  _goalTypeEdit = 'book';
  document.getElementById('goal-title-inp').value = '';
  document.getElementById('goal-target').value = '5';
  document.getElementById('goal-current').value = '0';
  document.querySelectorAll('[data-g]').forEach(o => o.classList.toggle('on', o.dataset.g === 'book'));
  document.getElementById('add-goal-modal').classList.add('show');
  setTimeout(() => document.getElementById('goal-title-inp').focus(), 100);
};
window.closeAddGoal = function() { document.getElementById('add-goal-modal').classList.remove('show'); };
window.selectGoalType = function(el, t) {
  _goalTypeEdit = t;
  document.querySelectorAll('[data-g]').forEach(o => o.classList.toggle('on', o.dataset.g === t));
};
window.saveGoal = function() {
  const title = document.getElementById('goal-title-inp').value.trim();
  if (!title) return;
  goals.push({ id: uid(), title, type: _goalTypeEdit,
    target: parseInt(document.getElementById('goal-target').value) || 5,
    current: parseInt(document.getElementById('goal-current').value) || 0 });
  saveGoals();
  closeAddGoal();
  renderGoalsHome();
};
window.incrementGoal = function(id) {
  const g = goals.find(g => g.id === id);
  if (!g) return;
  g.current = Math.min(g.target, g.current + 1);
  saveGoals();
  renderGoalsHome();
};
window.deleteGoal = function(id) {
  goals = goals.filter(g => g.id !== id);
  saveGoals();
  renderGoalsHome();
};

// ── Habits ────────────────────────────────────────────────────────────────
window.addHabit = function() {
  const inp = document.getElementById('habit-inp');
  const name = inp.value.trim();
  if (!name) return;
  habits.push({ id: uid(), name, doneByDay: {} });
  inp.value = '';
  saveHabits();
  renderHabits();
};

function getTodayKey() { const t = todayJalali(); return `${t.y}-${t.m}-${t.d}`; }

function habitStreak(habit) {
  let streak = 0;
  const g = new Date();
  for (let i = 0; i < 365; i++) {
    const j = toJalali(g.getFullYear(), g.getMonth()+1, g.getDate());
    const key = `${j.y}-${j.m}-${j.d}`;
    if (habit.doneByDay[key]) streak++;
    else if (i > 0) break;
    g.setDate(g.getDate() - 1);
  }
  return streak;
}

function renderHabits() {
  const el = document.getElementById('habit-list');
  if (!el) return;
  if (!habits.length) { el.innerHTML = '<div class="habit-empty">عادتی تعریف نکردی.<br>چیزی که می‌خوای هر روز انجام بدی رو بنویس.</div>'; return; }
  const todayKey = getTodayKey();
  el.innerHTML = habits.map(h => {
    const done = !!h.doneByDay[todayKey];
    const streak = habitStreak(h);
    const last7 = Array.from({length:7}, (_, i) => {
      const g2 = new Date(); g2.setDate(g2.getDate()-6+i);
      const j2 = toJalali(g2.getFullYear(), g2.getMonth()+1, g2.getDate());
      const k2 = `${j2.y}-${j2.m}-${j2.d}`;
      return h.doneByDay[k2] ? 'var(--ok)' : 'var(--bg4)';
    });
    return `<div class="habit-item ${done?'done-today':''}" onclick="toggleHabit('${h.id}')">
      <div class="habit-check ${done?'done':''}">${done?'<svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#fff" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M2 6l3 3 5-5"/></svg>':''}</div>
      <div style="flex:1;min-width:0">
        <div class="habit-name">${esc(h.name)}</div>
        <div class="habit-week">${last7.map(c=>`<div class="habit-week-dot" style="background:${c}"></div>`).join('')}</div>
      </div>
      ${streak>0?`<div class="habit-streak">🔥${toFarsiNum(streak)}</div>`:''}
      <div class="habit-del" onclick="event.stopPropagation();deleteHabit('${h.id}')">✕</div>
    </div>`;
  }).join('');
}

window.toggleHabit = function(id) {
  const h = habits.find(h => h.id === id);
  if (!h) return;
  const key = getTodayKey();
  h.doneByDay[key] = !h.doneByDay[key];
  saveHabits();
  renderHabits();
};

window.deleteHabit = function(id) {
  habits = habits.filter(h => h.id !== id);
  saveHabits();
  renderHabits();
};

// ── Recurrence ────────────────────────────────────────────────────────────
window.selectRecur = function(el, r) {
  selectedRecur = r;
  document.querySelectorAll('[data-r]').forEach(o => o.classList.toggle('on', o.dataset.r === r));
};

function generateRecurringEvents(ev, { y, m, d }) {
  if (!ev.recur || ev.recur === 'none') return;
  const daysToGen = ev.recur === 'daily' ? 30 : ev.recur === 'weekly' ? 12 : 3; // weeks/months ahead
  for (let i = 1; i <= daysToGen; i++) {
    let nextG;
    if (ev.recur === 'daily') {
      const g = jalaliToGregorian(y, m, d);
      const dt = new Date(g.y, g.m-1, g.d); dt.setDate(dt.getDate()+i);
      const j2 = toJalali(dt.getFullYear(), dt.getMonth()+1, dt.getDate());
      nextG = { y: j2.y, m: j2.m, d: j2.d };
    } else if (ev.recur === 'weekly') {
      const g = jalaliToGregorian(y, m, d);
      const dt = new Date(g.y, g.m-1, g.d); dt.setDate(dt.getDate()+i*7);
      const j2 = toJalali(dt.getFullYear(), dt.getMonth()+1, dt.getDate());
      nextG = { y: j2.y, m: j2.m, d: j2.d };
    } else { // monthly
      let nm = m + i, ny = y;
      while (nm > 12) { nm -= 12; ny++; }
      const dl = jalaliMonthLen(ny, nm);
      nextG = { y: ny, m: nm, d: Math.min(d, dl) };
    }
    const nextKey = `${nextG.y}-${nextG.m}-${nextG.d}`;
    if (!events[nextKey]) events[nextKey] = [];
    if (!events[nextKey].find(e => e.recurId === ev.id)) {
      events[nextKey].push({ ...ev, id: uid(), recurId: ev.id, done: false });
    }
  }
}

// ── Theme ─────────────────────────────────────────────────────────────────
const THEME_DEFAULTS = { accent:'#7B5EFF', accentDark:'#5B3FDF' };

window.setTheme = function(accent, accentDark, el) {
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-lo', hexToRgba(accent, .14));
  document.documentElement.style.setProperty('--accent-mid', hexToRgba(accent, .3));
  try { localStorage.setItem('asar-theme', JSON.stringify({ accent, accentDark })); } catch {}
  document.querySelectorAll('.theme-swatch').forEach(s => s.classList.remove('on'));
  if (el) el.classList.add('on');
};

function hexToRgba(hex, a) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}

function applyStoredTheme() {
  try {
    const t = JSON.parse(localStorage.getItem('asar-theme'));
    if (!t) return;
    document.documentElement.style.setProperty('--accent', t.accent);
    document.documentElement.style.setProperty('--accent-lo', hexToRgba(t.accent, .14));
    document.documentElement.style.setProperty('--accent-mid', hexToRgba(t.accent, .3));
    document.querySelectorAll('.theme-swatch').forEach(s => {
      s.classList.toggle('on', s.dataset.color === t.accent);
    });
  } catch {}
}

// ── Export / Import ───────────────────────────────────────────────────────
window.exportData = function() {
  const data = { library, events, habits, goals, settings, exportedAt: Date.now() };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `asar-backup-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);
};

window.importDataClick = function() { document.getElementById('import-file-inp').click(); };

window.importData = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (data.library) { library = data.library; saveLib(); }
      if (data.events)  { events  = data.events;  saveEvents(); }
      if (data.habits)  { habits  = data.habits;  saveHabits(); }
      if (data.goals)   { goals   = data.goals;   saveGoals(); }
      renderHome(); renderHabits();
      alert('داده‌ها با موفقیت وارد شدند ✓');
    } catch { alert('فایل نامعتبر است'); }
  };
  reader.readAsText(file);
  input.value = '';
};

// ── XP / Level ───────────────────────────────────────────────────────────
const XP_TITLES = ['تازه‌کار','علاقه‌مند','فرهنگی','هنردوست','اهل فرهنگ','حرفه‌ای','استاد','افسانه'];

function calcXP() {
  const doneItems = library.filter(i => i.stage === 'done').length;
  const activeItems = library.filter(i => i.stage === 'active').length;
  let doneEvents = 0;
  for (const key of Object.keys(events)) {
    doneEvents += (events[key] || []).filter(e => e.done).length;
  }
  return doneItems * 20 + activeItems * 5 + doneEvents * 2;
}

function renderXP() {
  const xp = calcXP();
  const level = Math.floor(xp / 100) + 1;
  const xpInLevel = xp % 100;
  const title = XP_TITLES[Math.min(level - 1, XP_TITLES.length - 1)];
  document.getElementById('xp-lvl').textContent = level;
  document.getElementById('xp-title').textContent = title;
  document.getElementById('xp-bar').style.width = xpInLevel + '%';
  document.getElementById('xp-sub').textContent = toFarsiNum(xpInLevel) + ' / ۱۰۰ XP (مجموع: ' + toFarsiNum(xp) + ')';
}

// ── Activity Heatmap ──────────────────────────────────────────────────────
function getActivityScore(jy, jm, jd) {
  const key = `${jy}-${jm}-${jd}`;
  const dayEvs = events[key] || [];
  const done = dayEvs.filter(e => e.done).length;
  const total = dayEvs.length;
  const score = done * 2 + (total - done);
  if (score === 0) return 0;
  if (score <= 1) return 1;
  if (score <= 3) return 2;
  if (score <= 5) return 3;
  return 4;
}

function renderHeatmap() {
  const today = todayJalali();
  const grid = document.getElementById('heatmap-grid');
  if (!grid) return;

  // Build 365 days going back from today in weeks
  const days = [];
  for (let i = 364; i >= 0; i--) {
    const g = new Date();
    g.setDate(g.getDate() - i);
    const j = toJalali(g.getFullYear(), g.getMonth() + 1, g.getDate());
    const dow = (g.getDay() + 1) % 7; // 0=Sat in Jalali week
    days.push({ j, dow, g });
  }

  // Group into weeks (columns of 7)
  const weeks = [];
  let week = new Array(days[0].dow).fill(null);
  for (const day of days) {
    week.push(day);
    if (week.length === 7) { weeks.push(week); week = []; }
  }
  if (week.length) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  grid.innerHTML = weeks.map(w =>
    `<div class="heatmap-week">${w.map(day => {
      if (!day) return '<div style="width:11px;height:11px"></div>';
      const score = getActivityScore(day.j.y, day.j.m, day.j.d);
      const isToday = day.j.y === today.y && day.j.m === today.m && day.j.d === today.d;
      const title = `${day.j.y}/${day.j.m}/${day.j.d}`;
      return `<div class="heatmap-day l${score}" title="${title}" style="${isToday ? 'outline:1.5px solid var(--accent);' : ''}"></div>`;
    }).join('')}</div>`
  ).join('');
}

// ── Pomodoro ─────────────────────────────────────────────────────────────
let pomoOpen = false, pomoRunning = false, pomoInterval = null;
let pomoRemaining = 25 * 60, pomoMode = 'work', pomoSessions = 0;
const POMO_TIMES = { work: 25*60, short: 5*60, long: 15*60 };

window.togglePomo = function() {
  pomoOpen = !pomoOpen;
  document.getElementById('pomo-panel').classList.toggle('show', pomoOpen);
};

window.setPomoMode = function(mode, el) {
  if (pomoRunning) return;
  pomoMode = mode;
  pomoRemaining = POMO_TIMES[mode];
  document.querySelectorAll('.pomo-mode-btn').forEach(b => b.classList.remove('on'));
  el.classList.add('on');
  updatePomoClock();
};

window.togglePomoTimer = function() {
  if (pomoRunning) {
    clearInterval(pomoInterval);
    pomoRunning = false;
    document.getElementById('pomo-start-btn').textContent = '▶ ادامه';
  } else {
    pomoRunning = true;
    document.getElementById('pomo-start-btn').textContent = '⏸ مکث';
    pomoInterval = setInterval(() => {
      pomoRemaining--;
      updatePomoClock();
      if (pomoRemaining <= 0) {
        clearInterval(pomoInterval);
        pomoRunning = false;
        if (pomoMode === 'work') {
          pomoSessions++;
          savePomoSessions();
          updatePomoCount();
          document.getElementById('pomo-start-btn').textContent = '▶ شروع';
        }
        // Flash FAB
        const fab = document.getElementById('pomo-fab');
        fab.style.background = 'var(--ok)';
        setTimeout(() => fab.style.background = '', 2000);
      }
    }, 1000);
  }
};

window.resetPomoTimer = function() {
  clearInterval(pomoInterval);
  pomoRunning = false;
  pomoRemaining = POMO_TIMES[pomoMode];
  document.getElementById('pomo-start-btn').textContent = '▶ شروع';
  updatePomoClock();
};

function updatePomoClock() {
  const m = Math.floor(pomoRemaining / 60);
  const s = pomoRemaining % 60;
  document.getElementById('pomo-clock').textContent =
    String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function savePomoSessions() {
  const today = todayJalali();
  const key = `pomo-${today.y}-${today.m}-${today.d}`;
  try { localStorage.setItem(key, pomoSessions); } catch {}
}

function loadPomoSessions() {
  const today = todayJalali();
  const key = `pomo-${today.y}-${today.m}-${today.d}`;
  try { pomoSessions = parseInt(localStorage.getItem(key)) || 0; } catch {}
  updatePomoCount();
}

function updatePomoCount() {
  const el = document.getElementById('pomo-count');
  if (el) el.textContent = `امروز: ${toFarsiNum(pomoSessions)} جلسه تموم شد`;
}

// ── AI Weekly Summary ──────────────────────────────────────────────────
window.getWeeklySummary = async function(btn) {
  const key = getClaudeKey();
  if (!key) {
    alert('برای این قابلیت نیاز به Claude API key داری. در تنظیمات وارد کن.');
    return;
  }

  const box = document.getElementById('ai-sum-box');
  btn.disabled = true;
  btn.textContent = '⏳ در حال تهیه خلاصه...';
  box.textContent = '';
  box.classList.add('show');

  const today = todayJalali();
  const activityLines = [];
  for (let i = 6; i >= 0; i--) {
    const g = new Date();
    g.setDate(g.getDate() - i);
    const j = toJalali(g.getFullYear(), g.getMonth() + 1, g.getDate());
    const key2 = `${j.y}-${j.m}-${j.d}`;
    const dayEvs = events[key2] || [];
    const done = dayEvs.filter(e => e.done);
    if (done.length || dayEvs.length) {
      activityLines.push(`${j.d}/${j.m}: ${done.length} رویداد تمام شد از ${dayEvs.length} رویداد`);
    }
  }

  const doneThisWeek = library.filter(i => i.stage === 'done').slice(-3);
  const doneText = doneThisWeek.map(i => `${i.type === 'book' ? 'کتاب' : i.type === 'film' ? 'فیلم' : 'موزیک'}: "${i.title}"`).join(', ');

  const prompt = `من از اپ فرهنگی "اثر" استفاده می‌کنم. این خلاصه فعالیت‌های هفته‌ام است:

فعالیت‌ها:
${activityLines.join('\n') || 'هیچ رویدادی ثبت نشده'}

آثار اخیر کامل شده: ${doneText || 'هیچکدام'}
کل آثار: ${library.length} | فعال: ${library.filter(i => i.stage === 'active').length} | تمام شده: ${library.filter(i => i.stage === 'done').length}

لطفاً یک خلاصه کوتاه و انگیزشی از هفته‌ام به فارسی بنویس و یک پیشنهاد برای هفته بعد بده.`;

  try {
    const reply = await window.api.claudeChat(
      'تو یک دستیار فرهنگی فارسی‌زبان هستی. به کاربر کمک می‌کنی تا مسیر فرهنگی و برنامه‌ریزیش را بهتر کند.',
      [{ role: 'user', content: prompt }],
      key
    );
    box.textContent = reply;
  } catch (e) {
    box.textContent = 'خطا در دریافت پاسخ: ' + (e.message || e);
  }

  btn.disabled = false;
  btn.innerHTML = '<span>✦</span> خلاصه هفته با Claude';
};

function getClaudeKey() {
  try { return localStorage.getItem('claude-api-key') || settings['claude-key'] || ''; } catch { return ''; }
}

// ── Utils ─────────────────────────────────────────────────────────────────
function esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────
// ── Exit modal (Esc = PS5 home button) ───────────────────────────────
const exitModal = document.getElementById('exit-modal');
document.getElementById('exit-cancel-btn').onclick  = () => exitModal.classList.remove('show');
document.getElementById('exit-confirm-btn').onclick = () => window.api.quitApp();

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmdPal(); return; }
  if (e.key === 'Escape') {
    if (document.getElementById('cmdpal').classList.contains('show')) { closeCmdPal(); return; }
    if (document.getElementById('add-goal-modal').classList.contains('show')) { closeAddGoal(); return; }
    if (exitModal.classList.contains('show')) {
      exitModal.classList.remove('show');
    } else {
      exitModal.classList.add('show');
    }
  }
});

load();
applyStoredTheme();

const today = todayJalali();
calViewY   = today.y;
calViewM   = today.m;
selectedDay = { y: today.y, m: today.m, d: today.d };

loadPomoSessions();
renderHome();
initFirebaseApp();

// ── Firebase Integration ──────────────────────────────────────────────────

let currentCommunityTab = 'film';
let _syncTimer = null;
let _authMode = 'login'; // 'login' | 'register'

function initFirebaseApp() {
  const ok = initFirebase();
  if (!ok) {
    // No config yet — show config hint in settings, skip auth overlay
    updateFirebaseStatus(false, null);
    return;
  }
  // Firebase initialized — auth state callback will fire automatically
}

window.onFirebaseAuthChange = function(user) {
  if (user) {
    // Logged in
    document.getElementById('auth-overlay').classList.remove('show');
    updateFirebaseStatus(true, user);
    loadFromFirestore(user.uid);
  } else {
    // Not logged in — show auth overlay
    updateFirebaseStatus(false, null);
    const cfg = getFirebaseConfig();
    if (cfg && cfg.apiKey) {
      document.getElementById('auth-overlay').classList.add('show');
    }
  }
};

function updateFirebaseStatus(loggedIn, user) {
  const statusEl = document.getElementById('firebase-status');
  const userRow = document.getElementById('firebase-user-row');
  const sidebarRow = document.getElementById('sidebar-user-row');
  const adminNav = document.getElementById('nav-admin');
  const syncBadge = document.getElementById('sidebar-sync-badge');

  if (loggedIn && user) {
    if (statusEl) statusEl.textContent = '✅ متصل — ' + (user.email || '');
    if (statusEl) statusEl.style.color = 'var(--ok)';
    if (userRow) userRow.style.display = 'flex';
    const nameEl = document.getElementById('firebase-user-name-lbl');
    const emailEl = document.getElementById('firebase-user-email-lbl');
    if (nameEl) nameEl.textContent = user.displayName || 'کاربر';
    if (emailEl) emailEl.textContent = user.email || '';
    if (sidebarRow) sidebarRow.style.display = 'flex';
    const avatarEl = document.getElementById('sidebar-user-avatar');
    const nameLabel = document.getElementById('sidebar-user-name');
    if (avatarEl) avatarEl.textContent = (user.displayName || user.email || '?')[0].toUpperCase();
    if (nameLabel) nameLabel.textContent = user.displayName || user.email || 'کاربر';
    if (syncBadge) syncBadge.style.display = 'inline-block';
    // Check admin
    checkAdmin(user.uid).then(isAdmin => {
      if (adminNav) adminNav.style.display = isAdmin ? 'flex' : 'none';
    });
  } else {
    if (statusEl) statusEl.textContent = 'متصل نشده';
    if (statusEl) statusEl.style.color = 'var(--t3)';
    if (userRow) userRow.style.display = 'none';
    if (sidebarRow) sidebarRow.style.display = 'none';
    if (syncBadge) syncBadge.style.display = 'none';
    if (adminNav) adminNav.style.display = 'none';
  }
}

async function checkAdmin(uid) {
  if (!window._fbDb || !uid) return false;
  try {
    const doc = await window._fbDb.collection('users').doc(uid).get();
    return doc.exists && doc.data().isAdmin === true;
  } catch { return false; }
}

window.saveFirebaseConfig = function() {
  const val = document.getElementById('firebase-config-inp').value.trim();
  if (!val) return;
  try {
    const cfg = JSON.parse(val);
    if (!cfg.apiKey || !cfg.projectId) { alert('کانفیگ ناقصه. apiKey و projectId لازمه.'); return; }
    localStorage.setItem('asar-firebase-config', JSON.stringify(cfg));
    // Reinit
    window._fbApp = null; window._fbAuth = null; window._fbDb = null; window._currentUser = null;
    const ok = initFirebase();
    if (ok) {
      document.getElementById('firebase-status').textContent = '🔄 در حال اتصال...';
    }
  } catch(e) { alert('JSON نامعتبر: ' + e.message); }
};

window.switchAuthTab = function(el, mode) {
  _authMode = mode;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  document.getElementById('auth-submit-btn').textContent = mode === 'login' ? 'ورود' : 'ثبت‌نام';
  const nameGroup = document.getElementById('auth-name-group');
  if (nameGroup) nameGroup.style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('auth-err').textContent = '';
};

window.submitAuth = async function() {
  const email = document.getElementById('auth-email').value.trim();
  const pass  = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-err');
  const btn   = document.getElementById('auth-submit-btn');
  if (!email || !pass) { errEl.textContent = 'ایمیل و رمز عبور رو وارد کن'; return; }
  if (!window._fbAuth) { errEl.textContent = 'ابتدا Firebase رو تنظیم کن'; return; }
  btn.textContent = '...';
  btn.disabled = true;
  errEl.textContent = '';
  try {
    if (_authMode === 'login') {
      await window._fbAuth.signInWithEmailAndPassword(email, pass);
    } else {
      const name = (document.getElementById('auth-name') || {}).value || '';
      const cred = await window._fbAuth.createUserWithEmailAndPassword(email, pass);
      if (name && cred.user) await cred.user.updateProfile({ displayName: name });
      // Create user doc
      await window._fbDb.collection('users').doc(cred.user.uid).set({
        email: cred.user.email, displayName: name, createdAt: new Date().toISOString(), isAdmin: false
      });
    }
  } catch(e) {
    const msgs = {
      'auth/user-not-found': 'کاربر پیدا نشد',
      'auth/wrong-password': 'رمز اشتباهه',
      'auth/email-already-in-use': 'این ایمیل قبلاً ثبت شده',
      'auth/weak-password': 'رمز باید حداقل ۶ کاراکتر باشه',
      'auth/invalid-email': 'ایمیل نامعتبره',
      'auth/invalid-credential': 'ایمیل یا رمز اشتباهه'
    };
    errEl.textContent = msgs[e.code] || e.message;
  } finally {
    btn.textContent = _authMode === 'login' ? 'ورود' : 'ثبت‌نام';
    btn.disabled = false;
  }
};

window.skipAuth = function() {
  document.getElementById('auth-overlay').classList.remove('show');
};

window.fbLogout = async function() {
  if (!window._fbAuth) return;
  if (!confirm('از حساب خارج بشم؟')) return;
  await window._fbAuth.signOut();
  window._currentUser = null;
  updateFirebaseStatus(false, null);
};

// ── Firestore Sync ───────────────────────────────────────────────────────

function debouncedSync() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(syncToFirestore, 3000);
}

async function syncToFirestore() {
  const db = window._fbDb;
  const uid = getUID();
  if (!db || !uid) return;
  try {
    await db.collection('user_data').doc(uid).set({
      library,
      events,
      habits,
      goals,
      updatedAt: new Date().toISOString()
    });
    // Update user doc
    const user = window._currentUser;
    await db.collection('users').doc(uid).set({
      email: user.email || '', displayName: user.displayName || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });
    const badge = document.getElementById('sidebar-sync-badge');
    if (badge) { badge.textContent = '✓ سینک'; badge.style.background = 'var(--ok)'; }
  } catch(e) {
    console.error('Firestore sync error:', e);
    const badge = document.getElementById('sidebar-sync-badge');
    if (badge) { badge.textContent = '⚠ خطا'; badge.style.background = 'var(--err)'; }
  }
}

async function loadFromFirestore(uid) {
  const db = window._fbDb;
  if (!db || !uid) return;
  try {
    const doc = await db.collection('user_data').doc(uid).get();
    if (!doc.exists) { syncToFirestore(); return; }
    const d = doc.data();
    if (d.library)  { library  = d.library;  localStorage.setItem(KEY_LIB,    JSON.stringify(library)); }
    if (d.events)   { events   = d.events;   localStorage.setItem(KEY_EVENTS, JSON.stringify(events)); }
    if (d.habits)   { habits   = d.habits;   localStorage.setItem(KEY_HABITS,  JSON.stringify(habits)); }
    if (d.goals)    { goals    = d.goals;    localStorage.setItem(KEY_GOALS,   JSON.stringify(goals)); }
    renderHome();
    if (activeSection === 'library') renderLibrary();
    if (activeSection === 'planner') renderPlanner();
  } catch(e) { console.error('loadFromFirestore error:', e); }
}

// Patch save functions to trigger sync
const _origSaveLib      = saveLib;
const _origSaveEvents   = saveEvents;
const _origSaveHabits   = saveHabits;
const _origSaveGoals    = saveGoals;
saveLib      = function() { _origSaveLib();      debouncedSync(); };
saveEvents   = function() { _origSaveEvents();   debouncedSync(); };
saveHabits   = function() { _origSaveHabits();   debouncedSync(); };
saveGoals    = function() { _origSaveGoals();    debouncedSync(); };

// ── Community Leaderboard ────────────────────────────────────────────────

window.switchCommunityTab = function(el, type) {
  currentCommunityTab = type;
  document.querySelectorAll('.community-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  loadCommunity(type);
};

async function loadCommunity(type) {
  const db = window._fbDb;
  const grid = document.getElementById('community-grid');
  if (!grid) return;
  if (!db) {
    grid.innerHTML = '<div class="community-loading">ابتدا Firebase رو در تنظیمات وصل کن</div>';
    return;
  }
  grid.innerHTML = '<div class="community-loading">در حال بارگذاری...</div>';
  try {
    const snap = await db.collection('community').where('type','==',type).orderBy('avg','desc').limit(100).get();
    if (snap.empty) {
      grid.innerHTML = '<div class="community-loading">هنوز کسی امتیاز نداده...</div>';
      return;
    }
    const items = [];
    snap.forEach(doc => items.push(doc.data()));
    renderCommunityGrid(items);
  } catch(e) {
    console.error('loadCommunity error:', e);
    grid.innerHTML = '<div class="community-loading">خطا در بارگذاری — ایندکس Firestore رو بساز</div>';
  }
}

function renderCommunityGrid(items) {
  const grid = document.getElementById('community-grid');
  if (!grid) return;
  const typeEmoji = { film: '🎬', book: '📚', music: '🎵' };
  grid.innerHTML = items.map((item, i) => {
    const stars = '★'.repeat(Math.round(item.avg)) + '☆'.repeat(5 - Math.round(item.avg));
    const avg = item.avg ? item.avg.toFixed(1) : '0.0';
    const coverHtml = item.cover
      ? `<img src="${item.cover.replace(/"/g,'&quot;')}" alt="" loading="lazy" onerror="this.parentElement.textContent='${typeEmoji[item.type]||'★'}'">`
      : (typeEmoji[item.type] || '★');
    return `<div class="community-card">
      <div class="community-rank">${i < 3 ? ['🥇','🥈','🥉'][i] : '#'+(i+1)}</div>
      <div class="community-cover">${coverHtml}</div>
      <div class="community-body">
        <div class="community-title" title="${item.title.replace(/"/g,'&quot;')}">${item.title}</div>
        ${item.artist ? `<div class="community-votes" style="margin-bottom:3px">${item.artist}</div>` : ''}
        <div class="community-stars" title="${avg}">${stars} <span style="font-size:11px;color:var(--warn)">${avg}</span></div>
        <div class="community-votes">${item.count} رأی</div>
      </div>
    </div>`;
  }).join('');
}

// ── Admin Panel ──────────────────────────────────────────────────────────

async function loadAdminData() {
  const db = window._fbDb;
  const listEl = document.getElementById('admin-users-list');
  const statsEl = document.getElementById('admin-stats-row');
  if (!db) {
    if (listEl) listEl.innerHTML = '<div class="community-loading">Firebase متصل نیست</div>';
    return;
  }
  if (listEl) listEl.innerHTML = '<div class="community-loading">در حال بارگذاری...</div>';
  try {
    const usersSnap = await db.collection('users').get();
    const users = [];
    usersSnap.forEach(doc => users.push({ id: doc.id, ...doc.data() }));

    // Stats
    const communitySnap = await db.collection('community').get();
    let totalVotes = 0;
    communitySnap.forEach(doc => { const d = doc.data(); totalVotes += d.count || 0; });

    if (statsEl) statsEl.innerHTML = `
      <div class="admin-stat"><div class="admin-stat-num">${users.length}</div><div class="admin-stat-lbl">کاربران</div></div>
      <div class="admin-stat"><div class="admin-stat-num">${communitySnap.size}</div><div class="admin-stat-lbl">آثار امتیازدار</div></div>
      <div class="admin-stat"><div class="admin-stat-num">${totalVotes}</div><div class="admin-stat-lbl">کل رأی‌ها</div></div>
    `;

    if (!users.length) {
      listEl.innerHTML = '<div class="community-loading">کاربری ثبت نشده</div>';
      return;
    }

    listEl.innerHTML = users.map((u, i) => {
      const initials = (u.displayName || u.email || '?')[0].toUpperCase();
      const date = u.createdAt ? u.createdAt.slice(0,10) : '';
      return `<div>
        <div class="admin-user-row" onclick="toggleAdminUser('au-${i}','${u.id}')">
          <div class="admin-user-avatar">${initials}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${u.displayName || 'بدون نام'}</div>
            <div class="admin-user-email">${u.email || ''}</div>
          </div>
          <div class="admin-user-meta">${date}</div>
        </div>
        <div class="admin-user-lib" id="au-${i}">در حال بارگذاری...</div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('loadAdminData error:', e);
    if (listEl) listEl.innerHTML = '<div class="community-loading">خطا — باید Admin باشی</div>';
  }
}

window.refreshAdmin = function() { loadAdminData(); };

window.toggleAdminUser = async function(libId, uid) {
  const libEl = document.getElementById(libId);
  if (!libEl) return;
  if (libEl.classList.contains('show')) { libEl.classList.remove('show'); return; }
  libEl.classList.add('show');
  if (libEl.dataset.loaded) return;
  libEl.dataset.loaded = '1';
  libEl.textContent = 'در حال بارگذاری...';
  try {
    const doc = await window._fbDb.collection('user_data').doc(uid).get();
    if (!doc.exists) { libEl.textContent = 'داده‌ای ثبت نشده'; return; }
    const d = doc.data();
    const lib = d.library || [];
    const typeEmoji = { film: '🎬', book: '📚', music: '🎵' };
    libEl.innerHTML = `<div class="admin-lib-title">کتابخانه (${lib.length} آیتم)</div>` +
      (lib.length === 0 ? '<div style="font-size:12px;color:var(--t3)">خالیه</div>' :
        lib.slice(0,30).map(it => `<div class="admin-lib-item">
          <span>${typeEmoji[it.type]||'•'}</span>
          <span style="flex:1">${it.title||'بدون عنوان'}</span>
          <span style="color:var(--warn)">${it.rating ? '★'.repeat(it.rating) : ''}</span>
          <span style="color:var(--t3);font-size:10px">${it.status||''}</span>
        </div>`).join('') +
        (lib.length > 30 ? `<div style="font-size:11px;color:var(--t3);padding-top:6px">... و ${lib.length-30} مورد دیگه</div>` : '')
      );
  } catch(e) {
    libEl.textContent = 'خطا در دریافت داده‌ها';
  }
};
