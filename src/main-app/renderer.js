'use strict';

// ── Jalali conversion ─────────────────────────────────────────────────────
const J_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const J_DAYS   = ['یک‌شنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه','شنبه'];

const { todayJalali, jalaliMonthLen, jalaliWeekday, jalaliFirstWeekday, addJalaliDays, dateKey, compareDays } = AsarCalendar;

function toFarsiNum(n) {
  return String(n).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]);
}

// ── State & persistence ───────────────────────────────────────────────────
const KEY_LIB    = 'asar-library';
const KEY_EVENTS = 'asar-events';
const KEY_ACTUAL = 'asar-actual-events';
let actualEvents = {};
let eventSide = 'plan';
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
let libView   = 'shelf';   // 'shelf' | 'kanban'
let dragItemId = null;
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
  try { actualEvents = JSON.parse(localStorage.getItem(KEY_ACTUAL)) || {}; } catch { actualEvents = {}; }
  try { settings = JSON.parse(localStorage.getItem(KEY_SETTINGS)) || {}; } catch { settings = {}; }
  try { habits   = JSON.parse(localStorage.getItem(KEY_HABITS)) || []; } catch { habits   = []; }
  try { goals    = JSON.parse(localStorage.getItem(KEY_GOALS))  || []; } catch { goals    = []; }
  syncSubAppsToLibrary();
}

function syncSubAppsToLibrary() {
  let changed = false;

  // Sync video player films
  try {
    const vp = JSON.parse(localStorage.getItem('video-player') || 'null');
    if (vp?.collections) {
      vp.collections.forEach(coll => {
        (coll.videos || []).forEach(v => {
          if (!v.path) return;
          const existing = library.find(i => i.filePath === v.path);
          if (existing) {
            if (v.poster && !existing.cover) { existing.cover = v.poster; changed = true; }
            return;
          }
          library.push({
            id: 'film_' + v.path.split(/[\\/]/).pop().replace(/\W/g,'').slice(0,14) + '_' + Date.now().toString(36),
            type: 'film', title: v.title || v.fileName || 'بدون عنوان',
            creator: '', year: v.year ? String(v.year) : '', notes: '',
            stage: 'queue', rating: 0, cover: v.poster || null,
            filePath: v.path, downloadStatus: 'done', createdAt: Date.now()
          });
          changed = true;
        });
      });
    }
  } catch {}

  // Sync music player songs
  try {
    const mp = JSON.parse(localStorage.getItem('music-player') || 'null');
    if (mp?.collections) {
      mp.collections.forEach(coll => {
        (coll.songs || []).forEach(s => {
          if (!s.path) return;
          const existing = library.find(i => i.filePath === s.path);
          if (existing) {
            if (s.cover && !existing.cover) { existing.cover = s.cover; changed = true; }
            return;
          }
          library.push({
            id: 'music_' + s.path.split(/[\\/]/).pop().replace(/\W/g,'').slice(0,14) + '_' + Date.now().toString(36),
            type: 'music', title: s.title || s.path.split(/[\\/]/).pop() || 'بدون عنوان',
            creator: s.artist || '', year: '', notes: '',
            stage: 'queue', rating: 0, cover: s.cover || null,
            filePath: s.path, downloadStatus: 'done', createdAt: Date.now()
          });
          changed = true;
        });
      });
    }
  } catch {}

  // Sync book reader books
  try {
    const br = JSON.parse(localStorage.getItem('book-reader') || 'null');
    if (br?.books) {
      br.books.forEach(b => {
        if (!b.path) return;
        const existing = library.find(i => i.filePath === b.path);
        if (existing) {
          if (b.cover && !existing.cover) { existing.cover = b.cover; changed = true; }
          return;
        }
        library.push({
          id: 'book_' + b.path.split(/[\\/]/).pop().replace(/\W/g,'').slice(0,14) + '_' + Date.now().toString(36),
          type: 'book', title: b.title || 'بدون عنوان',
          creator: b.author || '', year: '', notes: '',
          stage: 'queue', rating: 0, cover: b.cover || null,
          filePath: b.path, downloadStatus: 'done', createdAt: Date.now()
        });
        changed = true;
      });
    }
  } catch {}

  if (changed) saveLib();
}

function saveLib()      { localStorage.setItem(KEY_LIB,    JSON.stringify(library)); window.asarCollections?.refresh(); }
function saveEvents()   { localStorage.setItem(KEY_EVENTS, JSON.stringify(events));  }
function saveActualEvents() { localStorage.setItem(KEY_ACTUAL, JSON.stringify(actualEvents)); debouncedSync(); }
function saveSettings() { localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings)); }
function saveHabits()   { localStorage.setItem(KEY_HABITS,  JSON.stringify(habits));  }
function saveGoals()    { localStorage.setItem(KEY_GOALS,   JSON.stringify(goals));   }

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// ── Navigation ────────────────────────────────────────────────────────────
let activeSection = 'home';

window.showSection = function(id, el) {
  const section = document.getElementById('section-' + id);
  if (!section) return;
  document.querySelector('.section.active')?.classList.remove('active');
  document.querySelector('.nav-item.active')?.classList.remove('active');
  const tab = document.querySelector('.nav-item[data-section="' + id + '"]') || el;
  document.querySelector('.nav-item[aria-current]')?.removeAttribute('aria-current');
  tab?.classList.add('active');
  tab?.setAttribute('aria-current', 'page');
  section.classList.add('active');
  const title = tab?.querySelector('.nav-label')?.textContent;
  if (title) document.getElementById('asar-section-title').textContent = title;
  activeSection = id;
  if (id === 'home')      renderHome();
  if (id === 'library')   renderLibrary();
  if (id === 'planner')   renderPlanner();
  if (id === 'settings')  renderSettings();
  if (id === 'profile') window.asarProfile?.render();
  if (id === 'community') loadCommunity(currentCommunityTab);
  if (id === 'admin')     loadAdminData();
};

window.openTodayPlan = function() {
  const day = todayJalali();
  showSection('planner');
  selectCalDay(day.y, day.m, day.d);
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
    { icon:'＋', title:'ثبت فعالیت واقعی', sub:'ثبت سریع فعالیت امروز', badge:'عمل', action:()=>{ const day=todayJalali(); showSection('planner'); selectCalDay(day.y,day.m,day.d); openAddEvent(null,'actual'); } },
    { icon:'＋', title:'برنامهٔ فردا', sub:'افزودن رویداد آینده', badge:'عمل', action:()=>{ const day=addJalaliDays(todayJalali(),1); showSection('planner'); selectCalDay(day.y,day.m,day.d); openAddEvent(null,'plan'); } },
    { icon:'＋', title:'نوشتهٔ جدید', sub:'بازکردن ویرایشگر', badge:'عمل', action:()=>{ localStorage.setItem('writer-open-with', JSON.stringify({action:'new-doc'})); window.api.openWriter(); } },
    { icon:'◉', title:'پروفایل', sub:'حساب و کتابخانهٔ دوستان', badge:'بخش', action:()=>showSection('profile') },
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
    badge: typeLabel(i.type), action: () => { showSection('library'); openReview(i.id); }
  }));

  const matches = (value) => !q || String(value || '').toLowerCase().includes(q);
  const safeRead = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } };
  const evItems = Object.entries({ ...events, ...Object.fromEntries(Object.keys(actualEvents).map(key => [key, events[key] || []])) }).flatMap(([key, list]) => {
    const day = dayForKey(key);
    return [...list.map(event => ({ event, side: 'plan' })), ...(actualEvents[key] || []).map(event => ({ event, side: 'actual' }))]
      .filter(({ event }) => matches(event.title) && (q || key === getTodayKey()))
      .map(({ event, side }) => ({
        icon:'📅', title:event.title, sub:key + ' · ' + (event.time || '') + ' · ' + (side === 'plan' ? 'برنامه' : 'واقعیت'),
        badge:'رویداد', action: () => { showSection('planner'); selectCalDay(day.y, day.m, day.d); }
      }));
  }).slice(0, 8);
  const collections = safeRead('asar-collections', {});
  const openings = { 'music-player':'openMusicPlayer', 'video-player':'openVideoPlayer', 'book-reader':'openBookReader', writer:'openWriter' };
  const folders = Object.entries(collections).flatMap(([scope, tree]) => (tree.folders || []).filter(folder => matches(folder.title))
    .map(folder => ({ icon:'▤', title:folder.title, sub:'مجموعه', badge:'مجموعه', action:() => {
      if (scope === 'main-app') { showSection('library'); window.asarCollections?.show(folder.id); }
      else if (openings[scope]) { localStorage.setItem('asar-folder-open', JSON.stringify({ scope, id: folder.id })); window.api[openings[scope]](); }
    }}))).slice(0, q ? 8 : 3);
  const docs = safeRead('asar-writer-docs', []).filter(doc => matches(doc.title)).slice(0, q ? 8 : 3).map(doc => ({
    icon:'✎', title:doc.title, sub:'نویسنده', badge:'سند', action: () => {
      localStorage.setItem('writer-open-with', JSON.stringify({ action:'open-doc', id:doc.id }));
      window.api.openWriter();
    }
  }));
  cmdPalItems = [...actions, ...libItems, ...evItems, ...folders, ...docs];
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

  document.getElementById('shamsi-day').textContent = J_DAYS[jalaliWeekday(today.y, today.m, today.d)];

  // Stats
  const total  = library.length;
  const active = library.filter(i => i.stage === 'active').length;
  const done   = library.filter(i => i.stage === 'done').length;
  const todayKey = `${today.y}-${today.m}-${today.d}`;
  const evToday = (events[todayKey] || []).length;


  const cards = [
    { kind: 'library', value: total, title: 'مجموع آثار', icon: 'M5 5h4v14H5zM10 5h4v14h-4zM16 5l4 1-2 13-4-1z' },
    { kind: 'active', value: active, title: 'در حال بررسی', icon: 'M8 5l11 7-11 7z' },
    { kind: 'done', value: done, title: 'تمام‌شده', icon: 'm5 12 4 4 10-10' },
    { kind: 'today', value: evToday, title: 'رویداد امروز', icon: 'M6 4v3m12-3v3M4 9h16m-14-3h12l2 2v11H4V8z' }
  ];
  document.getElementById('stats-row').innerHTML = cards.map(card => `
    <button class="stat-card" data-stat="${card.kind}" type="button" onclick="${card.kind === 'today' ? 'openTodayPlan()' : "showSection('library')"}">
      <span class="stat-num">${toFarsiNum(card.value)}</span>
      <span class="stat-label">${card.title}</span>
      <span class="asar-stat-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${card.icon}"/></svg></span>
    </button>`).join('');

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

  renderDailyScore();
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

function dlStatusBadge(item) {
  if (item.filePath)                             return `<span class="dl-badge dl-ok" title="فایل موجود">✓ دانلود شده</span>`;
  if (item.downloadStatus === 'downloading')     return `<span class="dl-badge dl-loading" title="در حال دانلود">⏳ در حال دانلود</span>`;
  if (item.downloadStatus === 'failed')          return `<span class="dl-badge dl-fail" title="دانلود نشده">✗ دانلود نشده</span>`;
  if (item.type === 'film' && !item.filePath)    return `<span class="dl-badge dl-fail" title="فایل موجود نیست">✗ فایل ندارد</span>`;
  return '';
}

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

window.setLibView = function(mode, btn) {
  libView = mode;
  document.querySelectorAll('.lib-view-btn').forEach(b => b.classList.remove('on'));
  if (btn) btn.classList.add('on');
  const shelf  = document.getElementById('lib-shelf-view');
  const kanban = document.getElementById('kanban');
  if (shelf)  shelf.style.display  = mode === 'shelf'  ? '' : 'none';
  if (kanban) kanban.style.display = mode === 'kanban' ? '' : 'none';
  renderLibrary();
};

function renderLibrary() {
  if (libView === 'shelf') {
    renderShelf();
  } else {
    renderKanban();
  }
}

function renderShelf() {
  const all = filteredItems();
  const types = libFilter === 'all' ? ['book','film','music'] : [libFilter];
  const stages = ['queue','active','done'];

  types.forEach(t => {
    const typeItems = all.filter(i => i.type === t);
    const cnt = document.getElementById('shelf-cnt-'+t);
    if (cnt) cnt.textContent = toFarsiNum(typeItems.length);

    const isMusic = t === 'music';

    stages.forEach(stage => {
      const row = document.getElementById(`shelf-row-${t}-${stage}`);
      if (!row) return;

      const items = typeItems.filter(i => (i.stage||'queue') === stage);

      row.innerHTML = items.map(item => {
        const imgEl = item.cover
          ? `<img src="${esc(item.cover)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" loading="lazy">
             <div class="mcard-fallback" style="display:none">${typeEmoji(item.type)}</div>`
          : `<div class="mcard-fallback">${typeEmoji(item.type)}</div>`;

        const ovActions = `
          <div class="mov-btn" onclick="event.stopPropagation();openReview('${item.id}')" title="نقد">📝</div>
          ${item.filePath?`<div class="mov-btn ok" onclick="event.stopPropagation();openInSubApp('${item.id}')">↗ باز</div>`:''}
          <div class="mov-btn del" onclick="event.stopPropagation();deleteItem('${item.id}')">🗑</div>`;

        const dlBadge = dlStatusBadge(item);
        const clickFn = item.filePath ? `openInSubApp('${item.id}')` : `openReview('${item.id}')`;

        return `<div class="mcard ${t}" id="mcard-${item.id}"
            draggable="true"
            ondragstart="shelfDragStart(event,'${item.id}')"
            ondragend="shelfDragEnd(event)"
            ondragover="shelfItemDragOver(event)"
            ondrop="shelfItemDrop(event,'${item.id}')"
            onclick="${clickFn}">
          ${imgEl}
          <div class="mcard-ov">
            <div class="mcard-ov-title">${esc(item.title)}</div>
            ${dlBadge ? `<div style="text-align:center;margin-top:2px">${dlBadge}</div>` : ''}
            <div class="mcard-ov-actions">${ovActions}</div>
          </div>
        </div>`;
      }).join('');

      // "+" add button only in queue column
      if (stage === 'queue') {
        row.innerHTML += `<div class="mcard-add ${isMusic?'music':''}" onclick="openAddItemOfType('${t}')" title="افزودن">+</div>`;
      }
    });
  });

  // Show/hide sections based on filter
  ['book','film','music'].forEach(t => {
    const sectionId = 'shelf-' + (t==='book'?'books':t==='film'?'films':'music');
    const section = document.getElementById(sectionId);
    if (!section) return;
    section.style.display = libFilter === 'all' || libFilter === t ? '' : 'none';
  });
}

// Drag onto a shelf column → change item stage
window.shelfColDragOver = function(e, el) { e.preventDefault(); el.classList.add('drag-over'); };
window.shelfColDrop = function(e, type, stage) {
  e.preventDefault();
  document.querySelectorAll('.shelf-row').forEach(r => r.classList.remove('drag-over'));
  if (!dragItemId) return;
  const item = library.find(i => i.id === dragItemId);
  if (item) { item.stage = stage; saveLib(); renderLibrary(); if (typeof renderHome==='function') renderHome(); }
  dragItemId = null;
};

// Drag between items in same shelf (reorder)
window.shelfItemDragOver = function(e) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; };
window.shelfItemDrop = function(e, targetId) {
  e.preventDefault(); e.stopPropagation();
  if (!dragItemId || dragItemId === targetId) return;
  const fromIdx = library.findIndex(i => i.id === dragItemId);
  const toIdx   = library.findIndex(i => i.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = library.splice(fromIdx, 1);
  library.splice(toIdx, 0, moved);
  dragItemId = null;
  saveLib(); renderLibrary();
};

function renderKanban() {
  const cols = { queue:[], active:[], done:[] };
  filteredItems().forEach(item => { if (cols[item.stage]) cols[item.stage].push(item); });

  ['queue','active','done'].forEach(stage => {
    const el = document.getElementById('col-'+stage);
    const cnt = document.getElementById('cnt-'+stage);
    if (!el || !cnt) return;
    cnt.textContent = toFarsiNum(cols[stage].length);
    if (!cols[stage].length) {
      el.innerHTML = '<div class="kcard-empty">اینجا خالیه</div>';
      return;
    }
    el.innerHTML = cols[stage].map(item => `
      <div class="kcard" id="kcard-${item.id}" draggable="true"
           ondragstart="kcardDragStart(event,'${item.id}')"
           ondragend="kcardDragEnd(event)"
           ondragover="kcardDragOver(event)"
           ondrop="kcardDrop(event,'${item.id}')">
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
        ${dlStatusBadge(item)}
        ${item.review?.text ? `<div class="kcard-review-snip">${esc(item.review.text.slice(0,100))}${item.review.text.length>100?'…':''}</div>` : ''}
        <div class="kcard-actions">
          ${stage !== 'queue'  ? `<div class="kcard-action" onclick="moveItem('${item.id}','queue')">↩ می‌خوام</div>` : ''}
          ${stage !== 'active' ? `<div class="kcard-action primary" onclick="moveItem('${item.id}','active')">▶ شروع</div>` : ''}
          ${stage !== 'done'   ? `<div class="kcard-action" onclick="moveItem('${item.id}','done')">✓ تموم شد</div>` : ''}
          <div class="kcard-action ${item.review?.text ? 'review-on' : ''}" onclick="openReview('${item.id}')">📝 نقد</div>
          ${item.filePath ? `<div class="kcard-action" onclick="openInSubApp('${item.id}')">▶ باز</div>` : ''}
          <div class="kcard-action del-btn" onclick="deleteItem('${item.id}')">🗑</div>
        </div>
      </div>`).join('');
  });
}

// ── Shelf drag & drop (reorder within row) ────────────────────────────────
window.shelfDragStart = function(e, id) {
  dragItemId = id;
  window.asarCollections?.startDrag(e, 'item', id);
  setTimeout(() => { const el = document.getElementById('mcard-'+id); if (el) el.classList.add('dragging'); }, 0);
  e.dataTransfer.effectAllowed = 'move';
};
window.shelfDragEnd = function(e) {
  if (dragItemId) { const el = document.getElementById('mcard-'+dragItemId); if (el) el.classList.remove('dragging'); }
  dragItemId = null;
};

// ── Kanban drag & drop (move between columns) ─────────────────────────────
window.kcardDragStart = function(e, id) {
  dragItemId = id;
  window.asarCollections?.startDrag(e, 'item', id);
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => { const el = document.getElementById('kcard-'+id); if (el) el.classList.add('dragging'); }, 0);
};
window.kcardDragEnd = function(e) {
  if (dragItemId) { const el = document.getElementById('kcard-'+dragItemId); if (el) el.classList.remove('dragging'); }
  dragItemId = null;
};
window.kcardDragOver = function(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
window.kcardDrop = function(e, targetId) {
  e.preventDefault();
  if (!dragItemId || dragItemId === targetId) return;
  const fromIdx = library.findIndex(i => i.id === dragItemId);
  const toIdx   = library.findIndex(i => i.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = library.splice(fromIdx, 1);
  library.splice(toIdx, 0, moved);
  dragItemId = null;
  saveLib();
  renderLibrary();
};

// Drop onto kanban column (change stage via drag)
window.kanbanDragOver = function(e, col) {
  e.preventDefault();
  col.classList.add('drag-over');
};
window.kanbanDrop = function(e, stage) {
  e.preventDefault();
  document.querySelectorAll('.kanban-col').forEach(c => c.classList.remove('drag-over'));
  if (!dragItemId) return;
  const item = library.find(i => i.id === dragItemId);
  if (item && item.stage !== stage) {
    item.stage = stage;
    saveLib();
    renderLibrary();
    if (typeof renderHome === 'function') renderHome();
  }
  dragItemId = null;
};

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

// ── Review ────────────────────────────────────────────────────────────────
let reviewItemId = null;

window.openReview = function(id) {
  reviewItemId = id;
  const item = library.find(i => i.id === id);
  if (!item) return;

  const coverEl = document.getElementById('review-cover-el');
  coverEl.innerHTML = item.cover
    ? `<img src="${esc(item.cover)}" onerror="this.parentElement.textContent='${typeEmoji(item.type)}'">`
    : typeEmoji(item.type);

  document.getElementById('review-item-title-el').textContent = item.title || '';
  document.getElementById('review-item-sub-el').textContent   = [item.creator, item.year].filter(Boolean).join(' · ');
  document.getElementById('review-title-inp').value  = item.review?.title || '';
  document.getElementById('review-text-area').value  = item.review?.text  || '';

  const openBtn = document.getElementById('review-open-app-btn');
  openBtn.style.display = item.filePath ? 'block' : 'none';

  document.getElementById('review-modal').classList.add('show');
  setTimeout(() => document.getElementById('review-title-inp').focus(), 80);
};

window.closeReview = function() {
  document.getElementById('review-modal').classList.remove('show');
  reviewItemId = null;
};

window.saveReview = function() {
  const item = library.find(i => i.id === reviewItemId);
  if (!item) return;
  const title = document.getElementById('review-title-inp').value.trim();
  const text  = document.getElementById('review-text-area').value.trim();
  item.review = { title, text, updatedAt: Date.now() };
  if (text && item.stage !== 'done') item.stage = 'done';
  saveLib();
  closeReview();
  renderLibrary();
  if (activeSection === 'home') renderHome();
};

window.openInSubApp = function(id) {
  const item = library.find(i => i.id === id);
  if (!item || !item.filePath) return;
  if (item.type === 'book') window.api.openBookReaderWithFile(item.filePath);
  else if (item.type === 'film') window.api.openVideoPlayerWithFile(item.filePath);
};

window.openInSubAppFromReview = function() {
  if (reviewItemId) openInSubApp(reviewItemId);
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

window.openAddItemOfType = function(type) {
  openAddItem();
  selectedItemType = type;
  document.querySelectorAll('.type-opt[data-t]').forEach(o => {
    o.classList.toggle('on', o.dataset.t === type);
  });
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
    const newItem = {
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
      filePath: null,
      downloadStatus: (selectedItemType === 'film') ? null : 'downloading',
      createdAt: Date.now()
    };
    library.push(newItem);
    saveLib();
    closeAddItem();
    renderLibrary();
    if (activeSection === 'home') renderHome();

    // Try background auto-download (book / music only)
    if (newItem.downloadStatus === 'downloading' && window.api.downloadItem) {
      window.api.downloadItem({ id: newItem.id, type: newItem.type, title: newItem.title, creator: newItem.creator }).then(result => {
        const item = library.find(i => i.id === newItem.id);
        if (!item) return;
        if (result && result.filePath) {
          item.filePath = result.filePath;
          item.downloadStatus = 'done';
        } else {
          item.downloadStatus = 'failed';
        }
        saveLib();
        renderLibrary();
      }).catch(() => {
        const item = library.find(i => i.id === newItem.id);
        if (item) { item.downloadStatus = 'failed'; saveLib(); renderLibrary(); }
      });
    }
    return;
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
    const hasEv      = !!(events[key]?.length || actualEvents[key]?.length);
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


function dayForKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

function canEditPlan(day) {
  return compareDays(day, todayJalali()) > 0;
}

function renderDayView() {
  const { y, m, d } = selectedDay;
  const dow = J_DAYS[jalaliWeekday(y, m, d)];
  const key = dateKey(selectedDay);
  const editable = canEditPlan(selectedDay);
  document.getElementById('day-title').textContent = `${toFarsiNum(d)} ${J_MONTHS[m-1]} ${toFarsiNum(y)}`;
  document.getElementById('day-sub').textContent = dow;
  document.getElementById('plan-add').disabled = !editable;
  document.getElementById('plan-lock').textContent = editable ? 'تا نیمه‌شب قبل از این روز قابل ویرایش' : 'قفل شده';
  document.getElementById('actual-add').disabled = compareDays(selectedDay, todayJalali()) > 0;
  const actualAvailable = !document.getElementById('actual-add').disabled;
  const perHour = (list, hour) => list.filter(event => event.time?.startsWith(hour + ':'));
  const rows = [];
  for (let h = 0; h < 24; h++) {
    const hour = String(h).padStart(2, '0');
    const plan = perHour(events[key] || [], hour);
    const actual = perHour(actualEvents[key] || [], hour);
    rows.push(`<div class="planner-hour"><span>${toFarsiNum(hour)}:۰۰</span>
      <div class="planner-slot" data-side="plan">${renderSlot(plan, 'plan', key, hour, editable, actualAvailable)}</div>
      <div class="planner-slot" data-side="actual">${renderSlot(actual, 'actual', key, hour, actualAvailable, false)}</div></div>`);
  }
  document.getElementById('timeline').innerHTML = rows.join('');
}

function renderSlot(items, side, key, hour, editable, offerCopy) {
  const time = hour + ':00';
  if (!items.length) return editable ? `<button type="button" class="planner-empty-slot" aria-label="افزودن در ${time}" onclick="openAddEvent('${time}','${side}')">+</button>` : '';
  return items.map(event => {
    const id = encodeURIComponent(String(event.id)).replace(/'/g, '%27');
    return `<div class="event-block event-type-${['task', 'habit', 'note', 'idle'].includes(event.type) ? event.type : 'task'}">
      <button type="button" class="planner-event-name" ${editable ? `onclick="openEditEvent('${key}','${id}','${side}')"` : 'disabled'}>
        <span class="event-title">${esc(event.title)}</span><span class="event-meta">${esc(event.time)} · ${toFarsiNum(Number(event.duration) || 60)} دقیقه</span></button>
      ${offerCopy && event.type !== 'idle' && event.type !== 'note' ? `<button type="button" class="planner-mini" onclick="recordPlan('${key}','${id}')">ثبت در واقعیت</button>` : ''}
      ${editable ? `<button type="button" class="planner-mini" aria-label="حذف" onclick="deleteEvent('${key}','${id}','${side}')">×</button>` : ''}</div>`;
  }).join('');
}

function eventList(side, key) {
  const source = side === 'actual' ? actualEvents : events;
  return source[key] || [];
}

function validEdit(side, key) {
  return side === 'actual' ? compareDays(dayForKey(key), todayJalali()) <= 0 : canEditPlan(dayForKey(key));
}

window.quickAddEvent = function(time) { openAddEvent(time, 'plan'); };

window.openAddEvent = function(prefillTime, side = 'plan', prefill = null) {
  const key = dateKey(selectedDay);
  if (!validEdit(side, key)) return;
  eventSide = side;
  editingEventId = null;
  selectedRecur = 'none';
  document.getElementById('event-title').value = prefill?.title || '';
  document.getElementById('event-time').value = prefillTime || '09:00';
  document.getElementById('event-dur').value = prefill?.duration || '60';
  selectedEventType = prefill?.type || 'task';
  document.querySelectorAll('.type-opt[data-ev]').forEach(o => o.classList.toggle('on', o.dataset.ev === selectedEventType));
  document.querySelectorAll('[data-r]').forEach(o => {
    o.classList.toggle('on', o.dataset.r === 'none');
    o.hidden = side === 'actual';
  });
  document.getElementById('add-event-modal').classList.add('show');
  document.getElementById('event-title').focus();
};

window.openEditEvent = function(key, rawId, side = 'plan') {
  const id = decodeURIComponent(rawId);
  const event = eventList(side, key).find(item => String(item.id) === id);
  if (!event || !validEdit(side, key)) return;
  openAddEvent(event.time, side, event);
  editingEventId = { key, id };
};

window.recordPlan = function(key, rawId) {
  const event = eventList('plan', key).find(item => String(item.id) === decodeURIComponent(rawId));
  if (event) openAddEvent(event.time, 'actual', event);
};

window.closeAddEvent = function() {
  document.getElementById('add-event-modal').classList.remove('show');
};

window.selectEventType = function(el, type) {
  document.querySelectorAll('.type-opt[data-ev]').forEach(o => o.classList.remove('on'));
  el.classList.add('on');
  selectedEventType = type;
};

function finishEventChange(side) {
  if (side === 'actual') saveActualEvents();
  else saveEvents();
  closeAddEvent();
  renderDayView();
  renderCalendar();
}

window.saveEvent = function() {
  const titleInput = document.getElementById('event-title');
  const title = titleInput.value.trim();
  if (!title) { titleInput.focus(); return; }
  const durationInput = document.getElementById('event-dur');
  const time = document.getElementById('event-time').value;
  const duration = Number(durationInput.value);
  const range = AsarPlanner.interval({ time, duration });
  if (!range || range[1] - range[0] !== duration) {
    durationInput.setCustomValidity('بازه باید در همین روز پایان پیدا کند.');
    durationInput.reportValidity();
    durationInput.setCustomValidity('');
    return;
  }
  const side = eventSide;
  const key = editingEventId?.key || dateKey(selectedDay);
  if (!validEdit(side, key)) { closeAddEvent(); renderDayView(); return; }
  const source = side === 'actual' ? actualEvents : events;
  const list = source[key] ||= [];
  const fields = { title, time, duration, type: selectedEventType };
  if (editingEventId) {
    const event = list.find(item => String(item.id) === editingEventId.id);
    if (event) Object.assign(event, fields);
  } else {
    const event = { id: uid(), ...fields, done: side === 'actual', recur: side === 'plan' ? selectedRecur : 'none' };
    list.push(event);
    if (side === 'plan' && event.recur !== 'none') generateRecurringEvents(event, dayForKey(key));
  }
  finishEventChange(side);
};

window.deleteEvent = function(key, rawId, side = 'plan') {
  if (!validEdit(side, key)) return;
  const source = side === 'actual' ? actualEvents : events;
  source[key] = eventList(side, key).filter(event => String(event.id) !== decodeURIComponent(rawId));
  finishEventChange(side);
};

window.copyPlanDay = function() {
  const next = addJalaliDays(selectedDay, 1);
  if (!canEditPlan(next)) { alert('تنها می‌توان برای روزهای آینده برنامه کپی کرد.'); return; }
  const target = events[dateKey(next)] ||= [];
  let copied = 0;
  for (const event of events[dateKey(selectedDay)] || []) {
    if (target.some(item => item.title === event.title && item.time === event.time && item.duration === event.duration)) continue;
    target.push({ ...event, id: uid(), done: false, recur: 'none', recurId: null });
    copied++;
  }
  if (copied) saveEvents();
  renderCalendar();
  alert(copied ? toFarsiNum(copied) + ' رویداد به روز بعد اضافه شد.' : 'رویداد تازه‌ای برای کپی نبود.');
};

window.copyPlanWeek = function() {
  const start = addJalaliDays(selectedDay, -((jalaliWeekday(selectedDay.y, selectedDay.m, selectedDay.d) + 1) % 7));
  let copied = 0;
  for (let i = 0; i < 7; i++) {
    const from = dateKey(addJalaliDays(start, i));
    const day = addJalaliDays(start, i + 7);
    if (!canEditPlan(day)) continue;
    const to = dateKey(day);
    const target = events[to] ||= [];
    for (const event of events[from] || []) {
      if (target.some(item => item.title === event.title && item.time === event.time && item.duration === event.duration)) continue;
      target.push({ ...event, id: uid(), done: false, recur: 'none', recurId: null });
      copied++;
    }
  }
  if (copied) saveEvents();
  renderCalendar();
  alert(copied ? toFarsiNum(copied) + ' رویداد به هفتهٔ بعد اضافه شد.' : 'در روزهای آینده رویداد تازه‌ای برای کپی نبود.');
};

// ── SETTINGS ─────────────────────────────────────────────────────────────
function renderSettings() {
  const inp = document.getElementById('tmdb-key-input');
  if (inp) inp.value = settings['tmdb-key'] || '';
  const cinp = document.getElementById('claude-key-input');
  try { if (cinp) cinp.value = localStorage.getItem('claude-api-key') || ''; } catch {}
  // Supabase config
  const sbCfg = getSupabaseConfig();
  const sbUrl = document.getElementById('sb-url-inp');
  const sbKey = document.getElementById('sb-key-inp');
  if (sbCfg && sbUrl) sbUrl.value = sbCfg.url || '';
  if (sbCfg && sbKey) sbKey.value = sbCfg.anonKey || '';
  updateFirebaseStatus(!!(window._sb && window._currentUser), window._currentUser || null);
}

window.toggleKeyVisibility = function(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
  btn.textContent = inp.type === 'password' ? '👁' : '🙈';
};

window.copyApiKey = function(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (!inp || !inp.value) return;
  navigator.clipboard.writeText(inp.value).then(() => {
    const orig = btn.textContent;
    btn.textContent = '✓ کپی شد';
    setTimeout(() => btn.textContent = orig, 1500);
  }).catch(() => {
    inp.type = 'text';
    inp.select();
    document.execCommand('copy');
    btn.textContent = '✓ کپی شد';
    setTimeout(() => btn.textContent = 'کپی', 1500);
  });
};

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
  const today = todayJalali();
  for (let i = 0; i < 365; i++) {
    const key = dateKey(addJalaliDays(today, -i));
    if (habit.doneByDay?.[key]) streak++;
    else if (i > 0) break;
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
      const k2 = dateKey(addJalaliDays(todayJalali(), i - 6));
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
      nextG = addJalaliDays({ y, m, d }, i);
    } else if (ev.recur === 'weekly') {
      nextG = addJalaliDays({ y, m, d }, i * 7);
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
  const data = { schema: 'asar-backup', version: 2, storage: AsarBackup.collect(localStorage), exportedAt: new Date().toISOString() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'asar-backup-' + dateKey(todayJalali()) + '.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

window.importDataClick = () => document.getElementById('import-file-inp').click();

window.importData = async function(input) {
  const file = input.files[0];
  input.value = '';
  if (!file) return;
  try {
    const values = AsarBackup.parseBackup(JSON.parse(await file.text()));
    if (!confirm('داده‌های موجود در نسخهٔ پشتیبان جایگزین شوند؟')) return;
    AsarBackup.restore(localStorage, values);
    load();
    applyStoredTheme();
    loadPomoSessions();
    window.asarCollections?.refresh();
    if (activeSection === 'library') renderLibrary();
    if (activeSection === 'planner') renderPlanner();
    renderHome();
    debouncedSync();
    alert('پشتیبان بازیابی شد. پنجره‌های پلیر و نویسنده را دوباره باز کن تا نسخهٔ بازیابی‌شده را ببینی.');
  } catch {
    alert('فایل پشتیبان خوانده نشد یا فضای ذخیره کافی نبود.');
  }
};

// ── Daily Performance Score ───────────────────────────────────────────────
function calcDailyScore(jy, jm, jd) {
  const day = { y: jy, m: jm, d: jd };
  const key = dateKey(day);
  const doneHab = habits.filter(habit => habit.doneByDay?.[key]).length;
  const totalHab = habits.length;
  return {
    ...AsarPlanner.score(events[key] || [], actualEvents[key] || [], doneHab, totalHab, compareDays(day, todayJalali())),
    doneHab,
    totalHab
  };
}

function renderDailyScore() {
  const card = document.getElementById('daily-score-card');
  if (!card) return;

  const today = todayJalali();

  // Last 7 days
  const dnames = ['ی','د','س','چ','پ','ج','ش']; // Sun→Sat
  const days7 = [];
  for (let i = 6; i >= 0; i--) {
    const j = addJalaliDays(today, -i);
    days7.push({ j, data: calcDailyScore(j.y, j.m, j.d), isToday: i === 0, lbl: dnames[jalaliWeekday(j.y, j.m, j.d)] });
  }

  const td  = days7[6].data;
  const yd  = days7[5].data;
  const delta = td.score - yd.score;
  const deltaLabel = td.pending ? "پس از ثبت هر دو" : (yd.pending ? "" : "نسبت به دیروز");

  const lbl = td.pending ? 'در انتظار ثبت' : td.score >= 90 ? '✦ فوق‌العاده'
            : td.score >= 75 ? 'خوب'
            : td.score >= 50 ? 'متوسط'
            : td.score >= 25 ? 'ضعیف'
            : td.score >  0  ? 'خیلی کم'
            : 'بدون فعالیت';

  const dCls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
  const dTxt = td.pending || yd.pending ? '' : delta > 0 ? `↑ ${toFarsiNum(delta)}` : delta < 0 ? `↓ ${toFarsiNum(-delta)}` : '= مساوی';

  const evPct = Math.round(td.adherence * 2);
  const habPct = td.totalHab > 0 ? Math.round(td.doneHab / td.totalHab * 100) : 0;

  const barsHTML = days7.map(d => {
    const h = Math.max(Math.round(d.data.score / 100 * 48), 2);
    return `<div class="dsc-bw">
      <div class="dsc-bnum${d.isToday?' today':''}">${d.data.pending ? '—' : toFarsiNum(d.data.score)}</div>
      <div class="dsc-b ${d.isToday?'today':'past'}" style="height:${h}px"></div>
    </div>`;
  }).join('');

  const lblsHTML = days7.map(d =>
    `<div class="dsc-dlbl${d.isToday?' today':''}">${d.lbl}</div>`).join('');

  card.innerHTML = `
    <h2 class="dsc-title">نمرهٔ امروز</h2>
    <div class="dsc-top">
      <div class="dsc-score ${td.pending ? 'pending' : ''}" style="--daily-progress:${td.score}%">${td.pending ? "—" : toFarsiNum(td.score)}</div>
      <div class="dsc-meta">
        <div class="dsc-label">${lbl}</div>
        <div class="dsc-delta ${dCls}">${dTxt} ${deltaLabel}</div>
      </div>
    </div>
    <div class="dsc-breakdown">
      <div class="dsc-mini">
        <div class="dsc-mini-lbl">پایبندی ${toFarsiNum(Math.round(td.adherence))} از ۵۰</div>
        <div class="dsc-mini-track"><div class="dsc-mini-fill" style="width:${evPct}%;background:var(--accent)"></div></div>
      </div>
      <div class="dsc-mini">
        <div class="dsc-mini-lbl">عادت‌ها ${td.totalHab>0 ? toFarsiNum(td.doneHab)+' از '+toFarsiNum(td.totalHab) : '—'}</div>
        <div class="dsc-mini-track"><div class="dsc-mini-fill" style="width:${habPct}%;background:var(--ok)"></div></div>
      </div>
    </div>
    <div class="dsc-chart-title">${toFarsiNum(td.onTime)} دقیقه سر وقت · ${toFarsiNum(td.anotherTime)} دقیقه در ساعت دیگر · ${toFarsiNum(td.bonus)} امتیاز پاداش</div><div class="dsc-chart-title">۷ روز گذشته</div>
    <div class="dsc-bars">${barsHTML}</div>
    <div class="dsc-dlbls">${lblsHTML}</div>`;
}

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
    const j = addJalaliDays(today, -i);
    const dow = (jalaliWeekday(j.y, j.m, j.d) + 1) % 7;
    days.push({ j, dow });
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
    alert('برای این قابلیت نیاز به AI API key داری.\n\n🟢 Groq رایگان: console.groq.com\n🔵 DeepSeek: platform.deepseek.com\n\nکلید رو در تنظیمات وارد کن.');
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
    const j = addJalaliDays(today, -i);
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
  btn.innerHTML = '<span>✦</span> خلاصهٔ هفته با هوش مصنوعی';
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
    if (document.getElementById('review-modal').classList.contains('show')) { closeReview(); return; }
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
let displayedToday = dateKey(today);
function refreshAtMidnight() {
  const day = todayJalali();
  const current = dateKey(day);
  if (current === displayedToday) return;
  if (dateKey(selectedDay) === displayedToday) {
    selectedDay = day;
    calViewY = day.y;
    calViewM = day.m;
  }
  displayedToday = current;
  loadPomoSessions();
  renderHome();
  if (activeSection === 'planner') renderPlanner();
}
setInterval(refreshAtMidnight, 5000);
window.addEventListener('focus', refreshAtMidnight);


// ── Supabase Integration ──────────────────────────────────────────────────

let currentCommunityTab = 'film';
let _syncTimer = null;
let cloudOwner = null;
let cloudStamp = null;
let cloudReady = false;
let cloudSyncing = false;
let cloudDirty = false;
let cloudLoading = null;
let _authMode = 'login';

function initFirebaseApp() {
  const ok = initSupabase();
  if (!ok) { updateFirebaseStatus(false, null); return; }
}

window.onFirebaseAuthChange = function(user) {
  setTimeout(() => window.asarProfile?.accountChanged(), 0);
  if (user) {
    document.getElementById('auth-overlay').classList.remove('show');
    updateFirebaseStatus(true, user);
    loadFromSupabase(user.id);
  } else {
    cloudReady = false;
    cloudOwner = null;
    cloudLoading = null;
    clearTimeout(_syncTimer);
    updateFirebaseStatus(false, null);
    setSyncState('محلی');
  }
};

function updateFirebaseStatus(loggedIn, user) {
  const statusEl = document.getElementById('firebase-status');
  const userRow = document.getElementById('firebase-user-row');
  const sidebarRow = document.getElementById('sidebar-user-row');
  const adminNav = document.getElementById('nav-admin');
  const syncBadge = document.getElementById('sidebar-sync-badge');
  if (loggedIn && user) {
    const displayName = user.user_metadata?.display_name || user.email || 'کاربر';
    if (statusEl) { statusEl.textContent = '✅ متصل — ' + (user.email || ''); statusEl.style.color = 'var(--ok)'; }
    if (userRow) userRow.style.display = 'flex';
    const nameEl = document.getElementById('firebase-user-name-lbl');
    const emailEl = document.getElementById('firebase-user-email-lbl');
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = user.email || '';
    if (sidebarRow) sidebarRow.style.display = 'flex';
    const avatarEl = document.getElementById('sidebar-user-avatar');
    const nameLabel = document.getElementById('sidebar-user-name');
    if (avatarEl) avatarEl.textContent = displayName[0].toUpperCase();
    if (nameLabel) nameLabel.textContent = displayName;
    if (syncBadge) syncBadge.style.display = 'inline-block';
    checkAdmin(user.id).then(isAdmin => { if (adminNav) adminNav.style.display = isAdmin ? 'flex' : 'none'; });
  } else {
    if (statusEl) { statusEl.textContent = 'متصل نشده'; statusEl.style.color = 'var(--t3)'; }
    if (userRow) userRow.style.display = 'none';
    if (sidebarRow) sidebarRow.style.display = 'none';
    if (syncBadge) syncBadge.style.display = 'none';
    if (adminNav) adminNav.style.display = 'none';
  }
}

async function checkAdmin(uid) {
  if (!window._sb || !uid) return false;
  try {
    const { data } = await window._sb.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
    return !!(data && data.is_admin);
  } catch { return false; }
}

window.saveSupabaseConfig = window.saveFirebaseConfig = function() {
  const url = (document.getElementById('sb-url-inp') || {}).value?.trim();
  const key = (document.getElementById('sb-key-inp') || {}).value?.trim();
  if (!url || !key) { alert('URL و Anon Key رو وارد کن'); return; }
  if (!url.startsWith('https://')) { alert('URL باید با https:// شروع بشه'); return; }
  localStorage.setItem('asar-supabase-config', JSON.stringify({ url, anonKey: key }));
  window._sb = null; window._currentUser = null;
  const ok = initSupabase();
  if (ok) document.getElementById('firebase-status').textContent = '🔄 در حال اتصال...';
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
  if (!window._sb) { errEl.textContent = 'ابتدا Supabase رو در تنظیمات وصل کن'; return; }
  btn.textContent = '...'; btn.disabled = true; errEl.textContent = '';
  try {
    if (_authMode === 'login') {
      const { error } = await window._sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    } else {
      const name = (document.getElementById('auth-name') || {}).value || '';
      const { data, error } = await window._sb.auth.signUp({ email, password: pass, options: { data: { display_name: name }, emailRedirectTo: 'https://github.com/GriefKid/asar' } });
      if (error) throw error;
      if (!data.session) errEl.textContent = 'ثبت‌نام انجام شد. ایمیلت را تأیید کن و سپس وارد شو.';
    }
  } catch(e) {
    const msgs = {
      'Invalid login credentials': 'ایمیل یا رمز اشتباهه',
      'Email not confirmed': 'ایمیلت رو تأیید نکردی — لینک رو چک کن',
      'User already registered': 'این ایمیل قبلاً ثبت شده',
      'Password should be at least 6 characters': 'رمز باید حداقل ۶ کاراکتر باشه',
      'Email rate limit exceeded': 'تعداد ایمیل‌های ارسالی زیاده — چند دقیقه صبر کن',
      'email rate limit exceeded': 'تعداد ایمیل‌های ارسالی زیاده — چند دقیقه صبر کن',
      'over_email_send_rate_limit': 'تعداد ایمیل‌های ارسالی زیاده — چند دقیقه صبر کن',
    };
    const msg = msgs[e.message] || msgs[e.code] || e.message;
    errEl.textContent = msg;
  } finally {
    btn.textContent = _authMode === 'login' ? 'ورود' : 'ثبت‌نام';
    btn.disabled = false;
  }
};

window.skipAuth = function() { document.getElementById('auth-overlay').classList.remove('show'); };

window.fbLogout = async function() {
  if (!window._sb) return;
  if (!confirm('از حساب خارج بشم؟')) return;
  await window._sb.auth.signOut();
  window._currentUser = null;
  updateFirebaseStatus(false, null);
};

// ── Supabase Sync ────────────────────────────────────────────────────────

function setSyncState(text, color = '') {
  const badge = document.getElementById('sidebar-sync-badge');
  if (badge) { badge.textContent = text; badge.style.background = color; }
  const detail = document.getElementById('asar-cloud-state');
  if (detail) detail.textContent = text;
}

function cloudMarker(uid) { return 'asar-cloud-pending-' + uid; }

function debouncedSync() {
  clearTimeout(_syncTimer);
  const uid = getUID();
  if (!uid) { setSyncState('محلی'); return; }
  cloudDirty = true;
  localStorage.setItem(cloudMarker(uid), cloudStamp || 'new');
  setSyncState('در انتظار ارسال', 'var(--bg4)');
  if (cloudReady && cloudOwner === uid) _syncTimer = setTimeout(syncToSupabase, 1800);
}

function cloudPayload(uid) {
  return {
    id: uid, library, events, actual_events: actualEvents, habits, goals,
    extra_data: AsarBackup.collect(localStorage, AsarBackup.extras),
    updated_at: new Date().toISOString()
  };
}

async function syncToSupabase() {
  const client = window._sb;
  const uid = getUID();
  if (!client || !uid || !cloudReady || cloudOwner !== uid || cloudSyncing) return;
  cloudSyncing = true;
  cloudDirty = false;
  setSyncState('در حال ارسال', 'var(--bg4)');
  try {
    const table = client.from('user_data');
    const payload = cloudPayload(uid);
    const query = cloudStamp
      ? table.update(payload).eq('id', uid).eq('updated_at', cloudStamp)
      : table.insert(payload);
    const { data, error } = await query.select('updated_at').maybeSingle();
    if (error) throw error;
    if (!data) {
      cloudReady = false;
      setSyncState('تعارض با تغییر دستگاه دیگر', 'var(--warn)');
      return;
    }
    if (uid !== getUID()) return;
    cloudStamp = data.updated_at;
    if (!cloudDirty) localStorage.removeItem(cloudMarker(uid));
    else localStorage.setItem(cloudMarker(uid), cloudStamp);
    setSyncState(cloudDirty ? 'در انتظار ارسال' : '✓ سینک', cloudDirty ? 'var(--bg4)' : 'var(--ok)');
  } catch (error) {
    if (uid === getUID()) {
      const type = error.code === 'PGRST204' ? 'پایگاه داده نیاز به به‌روزرسانی دارد' : error.code === '23505' ? 'تعارض با تغییر دستگاه دیگر' : 'خطای همگام‌سازی';
      if (error.code === '23505') cloudReady = false;
      setSyncState(type, 'var(--err)');
    }
  } finally {
    cloudSyncing = false;
    if (cloudDirty && cloudReady && uid === getUID()) {
      clearTimeout(_syncTimer);
      _syncTimer = setTimeout(syncToSupabase, 1800);
    }
  }
}

async function loadFromSupabase(uid, mode = null) {
  const client = window._sb;
  if (!client || !uid || cloudLoading === uid) return;
  if (!mode && cloudOwner === uid && cloudReady) return;
  cloudLoading = cloudOwner = uid;
  cloudStamp = null;
  cloudReady = false;
  cloudDirty = false;
  setSyncState('در حال دریافت', 'var(--bg4)');
  try {
    const { data, error } = await client.from('user_data').select('*').eq('id', uid).maybeSingle();
    if (error) throw error;
    if (uid !== getUID()) return;
    cloudStamp = data?.updated_at || null;
    const pending = localStorage.getItem(cloudMarker(uid));
    if (data && !mode && pending && pending !== cloudStamp) {
      setSyncState('تعارض با تغییر دستگاه دیگر', 'var(--warn)');
      return;
    }
    cloudReady = true;
    if (mode === 'local' || (data && !mode && pending === cloudStamp)) { debouncedSync(); return; }
    if (!data) { setSyncState('آمادهٔ ارسال'); return; }
    const values = Object.fromEntries(Object.entries({
      'asar-library': data.library, 'asar-events': data.events, 'asar-actual-events': data.actual_events,
      'asar-habits': data.habits, 'asar-goals': data.goals
    }).filter(([, value]) => value != null).map(([key, value]) => [key, JSON.stringify(value)]));
    for (const [key, value] of Object.entries(data.extra_data || {})) {
      if (AsarBackup.extras(key) && typeof value === 'string') values[key] = value;
    }
    if (Object.keys(values).length) AsarBackup.restore(localStorage, AsarBackup.parseBackup({ schema: 'asar-backup', version: 2, storage: values }));
    localStorage.removeItem(cloudMarker(uid));
    load();
    window.asarCollections?.refresh();
    renderHome();
    if (activeSection === 'library') renderLibrary();
    if (activeSection === 'planner') renderPlanner();
    setSyncState('✓ سینک', 'var(--ok)');
  } catch {
    if (uid === getUID()) setSyncState('خطای دریافت از سرور', 'var(--err)');
  } finally {
    if (cloudLoading === uid) cloudLoading = null;
  }
}

window.asarCloudAction = function(mode) {
  const uid = getUID();
  if (!uid) { document.getElementById('auth-overlay').classList.add('show'); return; }
  const warning = mode === 'local' ? 'نسخهٔ فعلی این دستگاه جایگزین نسخهٔ ابری شود؟' : 'داده‌های ابری روی این دستگاه بارگیری شوند؟';
  if (confirm(warning)) loadFromSupabase(uid, mode);
};

window.addEventListener('storage', event => {
  if (event.key && AsarBackup.extras(event.key)) debouncedSync();
});
window.addEventListener('asar-store', event => { if (AsarBackup.extras(event.detail)) debouncedSync(); });
window.addEventListener('online', () => {
  const uid = getUID();
  if (!uid || !localStorage.getItem(cloudMarker(uid))) return;
  if (cloudReady) syncToSupabase();
  else loadFromSupabase(uid);
});

// Patch save functions to trigger sync
const _origSaveLib    = saveLib;
const _origSaveEvents = saveEvents;
const _origSaveHabits = saveHabits;
const _origSaveGoals  = saveGoals;
saveLib    = function() { _origSaveLib();    debouncedSync(); };
saveEvents = function() { _origSaveEvents(); debouncedSync(); };
saveHabits = function() { _origSaveHabits(); debouncedSync(); };
saveGoals  = function() { _origSaveGoals();  debouncedSync(); };

// ── Community Leaderboard ────────────────────────────────────────────────

window.switchCommunityTab = function(el, type) {
  currentCommunityTab = type;
  document.querySelectorAll('.community-tab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  loadCommunity(type);
};

async function loadCommunity(type) {
  const sb = window._sb;
  const grid = document.getElementById('community-grid');
  if (!grid) return;
  if (!sb) {
    grid.innerHTML = '<div class="community-loading">ابتدا Supabase رو در تنظیمات وصل کن</div>';
    return;
  }
  grid.innerHTML = '<div class="community-loading">در حال بارگذاری...</div>';
  try {
    const { data, error } = await sb.from('community').select('*').eq('type', type).gt('count', 0).order('avg', { ascending: false }).limit(100);
    if (error) throw error;
    if (!data || !data.length) {
      grid.innerHTML = '<div class="community-loading">هنوز کسی امتیاز نداده...</div>';
      return;
    }
    renderCommunityGrid(data);
  } catch(e) {
    console.error('loadCommunity error:', e);
    grid.innerHTML = '<div class="community-loading">خطا در بارگذاری: ' + e.message + '</div>';
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
  const sb = window._sb;
  const listEl = document.getElementById('admin-users-list');
  const statsEl = document.getElementById('admin-stats-row');
  if (!sb) {
    if (listEl) listEl.innerHTML = '<div class="community-loading">Supabase متصل نیست</div>';
    return;
  }
  if (listEl) listEl.innerHTML = '<div class="community-loading">در حال بارگذاری...</div>';
  try {
    const { data: users, error: ue } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (ue) throw ue;
    const { data: community } = await sb.from('community').select('count');
    const { data: votes } = await sb.from('community').select('count').gt('count', 0);
    const totalVotes = (votes || []).reduce((s, r) => s + (r.count || 0), 0);

    if (statsEl) statsEl.innerHTML = `
      <div class="admin-stat"><div class="admin-stat-num">${(users||[]).length}</div><div class="admin-stat-lbl">کاربران</div></div>
      <div class="admin-stat"><div class="admin-stat-num">${(community||[]).length}</div><div class="admin-stat-lbl">آثار امتیازدار</div></div>
      <div class="admin-stat"><div class="admin-stat-num">${totalVotes}</div><div class="admin-stat-lbl">کل رأی‌ها</div></div>
    `;

    if (!users || !users.length) {
      listEl.innerHTML = '<div class="community-loading">کاربری ثبت نشده</div>';
      return;
    }
    listEl.innerHTML = users.map((u, i) => {
      const name = u.display_name || u.email || 'بدون نام';
      const initials = name[0].toUpperCase();
      const date = u.created_at ? u.created_at.slice(0,10) : '';
      return `<div>
        <div class="admin-user-row" onclick="toggleAdminUser('au-${i}','${u.id}')">
          <div class="admin-user-avatar">${initials}</div>
          <div class="admin-user-info">
            <div class="admin-user-name">${name}${u.is_admin ? ' 👑' : ''}</div>
            <div class="admin-user-email">${u.email || ''}</div>
          </div>
          <div class="admin-user-meta">${date}</div>
        </div>
        <div class="admin-user-lib" id="au-${i}">در حال بارگذاری...</div>
      </div>`;
    }).join('');
  } catch(e) {
    console.error('loadAdminData error:', e);
    if (listEl) listEl.innerHTML = '<div class="community-loading">خطا: ' + e.message + '</div>';
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
    const { data } = await window._sb.from('user_data').select('library').eq('id', uid).maybeSingle();
    if (!data) { libEl.textContent = 'داده‌ای ثبت نشده'; return; }
    const lib = data.library || [];
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
  } catch(e) { libEl.textContent = 'خطا در دریافت داده‌ها'; }
};

// ── Sub-app sync: receive items ───────────────────────────────────────────
if (window.api?.onLibraryItem) {
  window.api.onLibraryItem(function(item) {
    const dup = library.find(i => i.id === item.id || (item.filePath && i.filePath === item.filePath));
    if (!dup) {
      library.push(item);
      saveLib();
      if (activeSection === 'library') renderLibrary();
      if (activeSection === 'home')    renderHome();
    }
  });
}

window.asarCollectionSource = {
  items: () => library,
  open: id => openReview(id)
};
