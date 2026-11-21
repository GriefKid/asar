// ── State ──────────────────────────────────────────────────────────────
const DATA_KEY = 'music-player';
let state = loadState();
let activeColl = state.collections.length ? state.collections[0].id : null;
let queue = [];
let queueIdx = -1;
let shuffle = false;
let repeatMode = 0; // 0=off 1=all 2=one
let lyrMode = 'both';
let lyrLines = [];
let lyrFaLines = [];
let lyrFetching = false;
let cmtTimestamp = 0;
let isDraggingProg = false;
let isDraggingVol = false;

const audio = document.getElementById('audio-el');

// ── Persistence ────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { collections: [], comments: [] };
}

function saveState() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch {}
}

// ── Collections rendering ──────────────────────────────────────────────
function renderColls() {
  const el = document.getElementById('colls-list');
  if (!state.collections.length) {
    el.innerHTML = `<div class="empty-colls">
      <p>هنوز مجموعه‌ای نداری.<br>یه مجموعه بساز و آهنگ اضافه کن.</p>
      <div class="icon-btn accent" style="width:auto;padding:8px 16px;border-radius:10px;font-family:'Space Grotesk',sans-serif;font-size:12.5px;gap:6px;display:flex" onclick="showNewColl()">
        + مجموعه جدید
      </div>
    </div>`;
    return;
  }

  el.innerHTML = state.collections.map(c => {
    const isActive = c.id === activeColl;
    const isOpen = c.open;
    const songs = c.songs || [];
    return `
    <div class="coll ${isActive ? 'active' : ''} ${isOpen ? 'open' : ''}" id="coll-${c.id}">
      <div class="coll-hd" onclick="toggleColl('${c.id}')">
        <div class="coll-icon">🎵</div>
        <div class="coll-meta">
          <div class="coll-name">${esc(c.name)}</div>
          <div class="coll-cnt">${songs.length} آهنگ</div>
        </div>
        <span class="coll-chev">›</span>
      </div>
      <div class="coll-songs">
        ${songs.map((s, i) => {
          const playing = queueIdx >= 0 && queue[queueIdx]?.path === s.path && activeColl === c.id;
          return `<div class="song ${playing ? 'playing' : ''}" onclick="playSong('${c.id}',${i})">
            <span class="song-n">${i + 1}</span>
            <div class="eq"><span></span><span></span><span></span></div>
            <div class="song-info">
              <div class="song-name">${esc(s.title || s.fileName)}</div>
              <div class="song-artist">${esc(s.artist || '')}</div>
            </div>
            <span class="song-dur">${s.duration ? fmtTime(s.duration) : ''}</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

function toggleColl(id) {
  const c = state.collections.find(c => c.id === id);
  if (!c) return;
  c.open = !c.open;
  activeColl = id;
  saveState();
  renderColls();
}

// ── Import ─────────────────────────────────────────────────────────────
async function importFiles() {
  const paths = await window.api.openAudioFiles();
  if (!paths.length) return;
  await addSongsToColl(paths);
}

async function importFolder() {
  const paths = await window.api.openAudioFolder();
  if (!paths.length) return;
  await addSongsToColl(paths);
}

async function addSongsToColl(paths) {
  let coll = state.collections.find(c => c.id === activeColl);
  if (!coll) {
    if (!state.collections.length) {
      createCollWithName('پیش‌فرض');
      coll = state.collections[0];
    } else {
      coll = state.collections[0];
    }
  }

  for (const p of paths) {
    if (coll.songs.find(s => s.path === p)) continue;
    const meta = await window.api.getMeta(p);
    coll.songs.push({ ...meta, duration: null });
  }

  coll.open = true;
  activeColl = coll.id;
  saveState();
  renderColls();
  loadDurations(coll);
}

async function loadDurations(coll) {
  for (const s of coll.songs) {
    if (s.duration !== null) continue;
    const dur = await getSongDuration(s.path);
    if (dur) { s.duration = dur; }
  }
  saveState();
  renderColls();
}

function getSongDuration(path) {
  return new Promise(resolve => {
    const a = new Audio();
    a.src = `file:///${path.replace(/\\/g, '/')}`;
    a.addEventListener('loadedmetadata', () => resolve(Math.round(a.duration)));
    a.addEventListener('error', () => resolve(null));
    setTimeout(() => resolve(null), 5000);
  });
}

// ── New Collection ─────────────────────────────────────────────────────
function showNewColl() {
  document.getElementById('newcoll-modal').classList.add('show');
  setTimeout(() => document.getElementById('newcoll-name').focus(), 100);
}

function closeNewColl() {
  document.getElementById('newcoll-modal').classList.remove('show');
  document.getElementById('newcoll-name').value = '';
}

function createColl() {
  const name = document.getElementById('newcoll-name').value.trim();
  if (!name) return;
  createCollWithName(name);
  closeNewColl();
}

function createCollWithName(name) {
  const id = 'c' + Date.now();
  state.collections.push({ id, name, songs: [], open: true });
  activeColl = id;
  saveState();
  renderColls();
}

// ── Playback ───────────────────────────────────────────────────────────
async function playSong(collId, idx) {
  const coll = state.collections.find(c => c.id === collId);
  if (!coll) return;
  activeColl = collId;
  queue = [...coll.songs];
  queueIdx = idx;
  await loadTrack(queue[queueIdx]);
  renderColls();
}

async function loadTrack(song) {
  const path = song.path.replace(/\\/g, '/');
  audio.src = `file:///${path}`;
  audio.load();
  audio.play();
  renderPlayer(song);
  updateBgGlow(null);
  fetchCover(song);
  fetchLyrics(song);
}

function renderPlayer(song) {
  document.getElementById('player-content').innerHTML = `
    <div class="art-wrap">
      <div class="art" id="art-playing">
        <span id="art-emoji">🎵</span>
        <img id="art-img" style="display:none" alt="">
      </div>
      <div class="info-pill no-drag" onclick="openInfo()">ℹ اطلاعات</div>
    </div>
    <div class="now-wrap">
      <div class="now-title" id="now-title">${esc(song.title || song.fileName)}</div>
      <div class="now-artist" id="now-artist">${esc(song.artist || '—')}</div>
      <div class="now-album" id="now-album"></div>
    </div>
    <div class="prog-wrap">
      <div class="prog-track" id="prog-track">
        <div class="prog-fill" id="prog-fill" style="width:0%">
          <div class="markers" id="markers"></div>
        </div>
      </div>
      <div class="time-row">
        <span id="time-cur">0:00</span>
        <span id="time-dur">0:00</span>
      </div>
    </div>
    <div class="ctrls">
      <button class="c-btn no-drag" id="btn-shuf" onclick="toggleShuffle()" title="تصادفی">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>
      </button>
      <button class="c-btn no-drag" onclick="prevSong()" title="قبلی">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.195 18.44c1.25.713 2.805-.19 2.805-1.629v-2.34l6.945 3.968c1.25.714 2.805-.188 2.805-1.628V8.688c0-1.44-1.555-2.342-2.805-1.628L12 11.03v-2.34c0-1.44-1.555-2.343-2.805-1.629l-7.108 4.062c-1.26.72-1.26 2.536 0 3.256l7.108 4.061z"/></svg>
      </button>
      <button class="play-btn no-drag" id="play-btn" onclick="togglePlay()">
        <svg id="play-icon" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd"/></svg>
      </button>
      <button class="c-btn no-drag" onclick="nextSong()" title="بعدی">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M5.055 7.06c-1.25-.714-2.805.189-2.805 1.628v8.123c0 1.44 1.555 2.342 2.805 1.628L12 14.471v2.34c0 1.44 1.555 2.342 2.805 1.628l7.108-4.061c1.26-.72 1.26-2.536 0-3.256l-7.108-4.061c-1.25-.714-2.805.188-2.805 1.628v2.34L5.055 7.06z"/></svg>
      </button>
      <button class="c-btn no-drag" id="btn-rep" onclick="toggleRepeat()" title="تکرار">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3"/></svg>
      </button>
    </div>
    <div class="vol-row">
      <div class="vol-icon no-drag" onclick="toggleMute()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" id="vol-icon-svg"><path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.241 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 11-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z"/><path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.061z"/></svg>
      </div>
      <div class="vol-track no-drag" id="vol-track">
        <div class="vol-fill" id="vol-fill" style="width:80%"></div>
      </div>
      <span class="vol-val" id="vol-val">80</span>
    </div>
    <button class="add-cmt no-drag" onclick="openCmt()">
      <svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd"/></svg>
      افزودن کامنت در این لحظه
    </button>`;

  audio.volume = 0.8;
  setupProgDrag();
  setupVolDrag();
  renderMarkers();
  updatePlayBtn();
}

// ── Progress bar ───────────────────────────────────────────────────────
function setupProgDrag() {
  const track = document.getElementById('prog-track');
  if (!track) return;

  track.addEventListener('mousedown', e => {
    isDraggingProg = true;
    seekTo(e, track);
  });
  document.addEventListener('mousemove', e => {
    if (!isDraggingProg) return;
    seekTo(e, document.getElementById('prog-track'));
  });
  document.addEventListener('mouseup', () => { isDraggingProg = false; });
}

function seekTo(e, track) {
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (audio.duration) audio.currentTime = pct * audio.duration;
}

audio.addEventListener('timeupdate', () => {
  if (isDraggingProg || !audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  const fill = document.getElementById('prog-fill');
  const cur = document.getElementById('time-cur');
  if (fill) fill.style.width = pct + '%';
  if (cur) cur.textContent = fmtTime(audio.currentTime);
  updateActiveLyric();
});

audio.addEventListener('loadedmetadata', () => {
  const dur = document.getElementById('time-dur');
  if (dur) dur.textContent = fmtTime(audio.duration);
});

audio.addEventListener('ended', () => {
  if (repeatMode === 2) {
    audio.currentTime = 0;
    audio.play();
  } else {
    nextSong();
  }
});

audio.addEventListener('play', updatePlayBtn);
audio.addEventListener('pause', updatePlayBtn);

function updatePlayBtn() {
  const btn = document.getElementById('play-btn');
  const icon = document.getElementById('play-icon');
  if (!btn || !icon) return;
  if (audio.paused) {
    icon.innerHTML = `<path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd"/>`;
  } else {
    icon.innerHTML = `<path fill-rule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clip-rule="evenodd"/>`;
  }
}

function togglePlay() {
  if (audio.paused) audio.play();
  else audio.pause();
}

// ── Volume ─────────────────────────────────────────────────────────────
function setupVolDrag() {
  const track = document.getElementById('vol-track');
  if (!track) return;

  track.addEventListener('mousedown', e => {
    isDraggingVol = true;
    setVol(e, track);
  });
  document.addEventListener('mousemove', e => {
    if (!isDraggingVol) return;
    setVol(e, document.getElementById('vol-track'));
  });
  document.addEventListener('mouseup', () => { isDraggingVol = false; });
}

function setVol(e, track) {
  if (!track) return;
  const rect = track.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.volume = pct;
  audio.muted = false;
  updateVolUI(pct);
}

function updateVolUI(pct) {
  const fill = document.getElementById('vol-fill');
  const val = document.getElementById('vol-val');
  if (fill) fill.style.width = (pct * 100) + '%';
  if (val) val.textContent = Math.round(pct * 100);
}

function toggleMute() {
  audio.muted = !audio.muted;
}

// ── Controls ───────────────────────────────────────────────────────────
function prevSong() {
  if (!queue.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  if (shuffle) {
    queueIdx = Math.floor(Math.random() * queue.length);
  } else {
    queueIdx = (queueIdx - 1 + queue.length) % queue.length;
  }
  loadTrack(queue[queueIdx]);
  renderColls();
}

function nextSong() {
  if (!queue.length) return;
  if (shuffle) {
    queueIdx = Math.floor(Math.random() * queue.length);
  } else {
    if (repeatMode === 1) {
      queueIdx = (queueIdx + 1) % queue.length;
    } else {
      if (queueIdx >= queue.length - 1) return;
      queueIdx++;
    }
  }
  loadTrack(queue[queueIdx]);
  renderColls();
}

function toggleShuffle() {
  shuffle = !shuffle;
  const btn = document.getElementById('btn-shuf');
  if (btn) btn.classList.toggle('on', shuffle);
}

function toggleRepeat() {
  repeatMode = (repeatMode + 1) % 3;
  const btn = document.getElementById('btn-rep');
  if (!btn) return;
  btn.classList.toggle('on', repeatMode > 0);
  btn.title = ['تکرار خاموش', 'تکرار همه', 'تکرار یک'][repeatMode];
  if (repeatMode === 2) {
    btn.querySelector('svg').innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3"/><text x="11" y="14" font-size="6" fill="currentColor" text-anchor="middle">1</text>`;
  }
}

// ── Cover ──────────────────────────────────────────────────────────────
async function fetchCover(song) {
  try {
    const artist = (!song.artist || song.artist === 'Unknown') ? '' : song.artist;
    const url = await window.api.fetchCover(artist, song.title);
    if (!url) return;
    const img = document.getElementById('art-img');
    const emoji = document.getElementById('art-emoji');
    const art = document.getElementById('art-playing');
    if (!img || !art) return;
    img.onload = () => {
      img.style.display = 'block';
      if (emoji) emoji.style.display = 'none';
      art.classList.add('has-art');
      updateBgGlow(url);
    };
    img.src = url;
  } catch {}
}

function updateBgGlow(coverUrl) {
  const glow = document.getElementById('bg-glow');
  if (!glow) return;
  if (coverUrl) {
    glow.style.background = `radial-gradient(ellipse 60% 40% at 50% 0%,rgba(123,94,255,.2) 0%,transparent 60%), var(--bg0)`;
  } else {
    glow.style.background = '';
  }
}

// ── Lyrics ─────────────────────────────────────────────────────────────
async function fetchLyrics(song) {
  const body = document.getElementById('lyr-body');
  if (!body) return;
  if (!song.artist || song.title === song.fileName) {
    body.innerHTML = `<div class="lyr-no-data">متن آهنگ پیدا نشد.<br>نام فایل باید به شکل «خواننده - عنوان» باشه.</div>`;
    return;
  }

  body.innerHTML = `<div class="lyr-loading"><span>در حال جستجوی متن...</span></div>`;
  lyrLines = [];
  lyrFaLines = [];
  lyrFetching = true;

  try {
    const raw = await window.api.fetchLyrics(song.artist, song.title);
    if (!raw) {
      body.innerHTML = `<div class="lyr-no-data">متن آهنگ پیدا نشد.</div>`;
      lyrFetching = false;
      return;
    }

    lyrLines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    renderLyrics();

    translateLyricsChunked(lyrLines);
  } catch {
    body.innerHTML = `<div class="lyr-no-data">خطا در بارگذاری متن آهنگ.</div>`;
  }
  lyrFetching = false;
}

async function translateLyricsChunked(lines) {
  lyrFaLines = new Array(lines.length).fill('');
  const chunkSize = 10;
  for (let i = 0; i < lines.length; i += chunkSize) {
    const chunk = lines.slice(i, i + chunkSize);
    const joined = chunk.join('\n');
    try {
      const translated = await window.api.translate(joined);
      if (translated) {
        const parts = translated.split('\n');
        for (let j = 0; j < chunk.length; j++) {
          lyrFaLines[i + j] = parts[j] || '';
        }
        renderLyrics();
      }
    } catch {}
    await sleep(300);
  }
}

function renderLyrics() {
  const body = document.getElementById('lyr-body');
  if (!body || !lyrLines.length) return;

  body.innerHTML = lyrLines.map((line, i) => {
    const fa = lyrFaLines[i] || '';
    const showEn = lyrMode === 'en' || lyrMode === 'both';
    const showFa = (lyrMode === 'fa' || lyrMode === 'both') && fa;
    return `<div class="lyr-line" id="lyr-${i}">
      ${showEn ? `<div class="lyr-en">${esc(line)}</div>` : ''}
      ${showFa ? `<div class="lyr-fa">${esc(fa)}</div>` : ''}
    </div>`;
  }).join('');
}

function setLyrMode(btn, mode) {
  lyrMode = mode;
  document.querySelectorAll('.ltab').forEach(t => t.classList.remove('on'));
  btn.classList.add('on');
  if (lyrLines.length) renderLyrics();
}

function updateActiveLyric() {
  if (!lyrLines.length || !audio.duration) return;
  const pct = audio.currentTime / audio.duration;
  const idx = Math.floor(pct * lyrLines.length);
  document.querySelectorAll('.lyr-line').forEach((el, i) => {
    el.classList.toggle('active', i === idx);
  });
  const active = document.getElementById('lyr-' + idx);
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Info modal ─────────────────────────────────────────────────────────
async function openInfo() {
  const modal = document.getElementById('info-modal');
  const content = document.getElementById('info-content');
  if (!modal || !content) return;
  modal.classList.add('show');

  if (queueIdx < 0 || !queue[queueIdx]) return;
  const song = queue[queueIdx];
  content.innerHTML = `<div class="info-loading">در حال بارگذاری اطلاعات...</div>`;

  try {
    const [info, infoFa] = await Promise.all([
      window.api.fetchInfo(song.artist, song.title),
      null
    ]);

    if (!info) {
      content.innerHTML = `<div class="info-row"><div class="info-en">اطلاعاتی پیدا نشد.</div></div>`;
      return;
    }

    const titleFa = await window.api.translate(info.title).catch(() => null);
    const artistFa = await window.api.translate(info.artist).catch(() => null);
    const releaseList = info.releases.slice(0, 3).map(r =>
      `<div class="info-en">${esc(r.title)}${r.date ? ` — ${r.date}` : ''}</div>`
    ).join('');

    content.innerHTML = `
      <div class="info-row">
        <div class="info-lbl">عنوان</div>
        <div class="info-en">${esc(info.title)}</div>
        ${titleFa ? `<div class="info-fa">${esc(titleFa)}</div>` : ''}
      </div>
      <div class="info-row">
        <div class="info-lbl">خواننده</div>
        <div class="info-en">${esc(info.artist)}</div>
        ${artistFa ? `<div class="info-fa">${esc(artistFa)}</div>` : ''}
      </div>
      ${info.duration ? `<div class="info-row">
        <div class="info-lbl">مدت</div>
        <div class="info-en">${fmtTime(info.duration)}</div>
      </div>` : ''}
      ${info.releases.length ? `<div class="info-row">
        <div class="info-lbl">آلبوم‌ها</div>
        ${releaseList}
      </div>` : ''}`;
  } catch {
    content.innerHTML = `<div class="info-row"><div class="info-en">خطا در بارگذاری.</div></div>`;
  }
}

function closeInfo() {
  document.getElementById('info-modal')?.classList.remove('show');
}

// ── Comment modal ──────────────────────────────────────────────────────
function openCmt() {
  cmtTimestamp = audio.currentTime || 0;
  const timeEl = document.getElementById('cmt-time');
  if (timeEl) timeEl.textContent = '⏱ ' + fmtTime(cmtTimestamp);
  const input = document.getElementById('cmt-input');
  if (input) input.value = '';
  document.getElementById('cmt-modal')?.classList.add('show');
  setTimeout(() => input?.focus(), 100);
}

function closeCmt() {
  document.getElementById('cmt-modal')?.classList.remove('show');
}

function saveCmt() {
  const text = document.getElementById('cmt-input')?.value.trim();
  if (!text) return;

  if (!state.comments) state.comments = [];
  const song = queue[queueIdx];
  state.comments.push({
    id: 'cmt' + Date.now(),
    path: song?.path || '',
    timestamp: cmtTimestamp,
    text,
    createdAt: Date.now()
  });
  saveState();
  closeCmt();
  renderMarkers();
}

function renderMarkers() {
  const container = document.getElementById('markers');
  if (!container) return;
  const song = queueIdx >= 0 ? queue[queueIdx] : null;
  if (!song) return;

  const cmts = (state.comments || []).filter(c => c.path === song.path);
  const colors = ['#7B5EFF', '#2FD6A8', '#F5A623', '#FF5F7E', '#60A5FA'];

  container.innerHTML = cmts.map((c, i) => {
    const pct = audio.duration ? (c.timestamp / audio.duration) * 100 : 0;
    const color = colors[i % colors.length];
    return `<div class="marker" style="left:${pct}%;background:${color}"
      onclick="audio.currentTime=${c.timestamp}">
      <div class="marker-tip">${esc(c.text)}</div>
    </div>`;
  }).join('');
}

// ── Utils ──────────────────────────────────────────────────────────────
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Init ───────────────────────────────────────────────────────────────
renderColls();
