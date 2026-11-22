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

let audioCtx = null;
let analyser = null;
let gainNode = null;
let eqFilters = [];
let vizFrameId = null;
let currentCoverUrl = null;
let sleepTimeout = null;
let sleepInterval = null;
let sleepEndTime = 0;
let playbackSpeed = 1.0;
let statsListenInterval = null;
let statsListenStart = 0;
let statsCurrentPath = null;

const SPEED_OPTS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
const EQ_PRESETS = {
  flat:      [0, 0, 0, 0, 0],
  bass:      [8, 5, 0, -1, -2],
  vocal:     [-2, 0, 5, 4, -1],
  classical: [4, 2, -2, 1, 4],
};

const audio = document.getElementById('audio-el');

// ── Persistence ────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (!s.stats) s.stats = { plays: {}, listenTime: {} };
      if (!s.ratings) s.ratings = {};
      return s;
    }
  } catch {}
  return { collections: [], comments: [], stats: { plays: {}, listenTime: {} }, ratings: {} };
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

  el.innerHTML = state.collections.map((c, ci) => {
    const isActive = c.id === activeColl;
    const isOpen = c.open;
    const songs = c.songs || [];
    return `
    <div class="coll ${isActive ? 'active' : ''} ${isOpen ? 'open' : ''}" id="coll-${c.id}"
         draggable="true"
         ondragstart="collDragStart(event,'${c.id}')"
         ondragend="collDragEnd(event)"
         ondragover="collHeaderDragOver(event,'${c.id}')"
         ondrop="collHeaderDrop(event,'${c.id}')">
      <div class="coll-hd" onclick="toggleColl('${c.id}')">
        <div class="coll-icon">🎵</div>
        <div class="coll-meta">
          <div class="coll-name">${esc(c.name)}</div>
          <div class="coll-cnt">${songs.length} آهنگ</div>
        </div>
        <div class="coll-del-btn" onclick="event.stopPropagation();deleteColl('${c.id}')" title="حذف مجموعه">🗑</div>
        <span class="coll-chev">›</span>
      </div>
      <div class="coll-songs" id="csongs-${c.id}"
           ondragover="songColDragOver(event,'${c.id}')"
           ondrop="songColDrop(event,'${c.id}')"
           ondragleave="document.getElementById('csongs-${c.id}').style.background=''">
        ${songs.map((s, i) => {
          const playing = queueIdx >= 0 && queue[queueIdx]?.path === s.path && activeColl === c.id;
          const songRating = getSongRating(s.path);
          const ratingDot = songRating > 0 ? `<span style="color:var(--warn);font-size:9px;margin-right:2px">${'★'.repeat(songRating)}</span>` : '';
          return `<div class="song ${playing ? 'playing' : ''}"
              draggable="true"
              ondragstart="songDragStart(event,'${c.id}',${i})"
              ondragend="songDragEnd(event)"
              onclick="playSong('${c.id}',${i})">
            <span class="song-n">${i + 1}</span>
            <div class="eq"><span></span><span></span><span></span></div>
            <div class="song-info">
              <div class="song-name">${esc(s.title || s.fileName)}${ratingDot}</div>
              <div class="song-artist">${esc(s.artist || '')}</div>
            </div>
            <span class="song-dur">${s.duration ? fmtTime(s.duration) : ''}</span>
            <div class="song-del-btn" onclick="event.stopPropagation();removeSongFromColl('${c.id}',${i})" title="حذف">🗑</div>
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
    if (!meta.cover) meta.cover = generateCover(meta.title || p.split(/[\\/]/).pop());
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
  if (audioCtx && gainNode && !audio.paused) {
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(gainNode.gain.value, now);
    gainNode.gain.linearRampToValueAtTime(0, now + 0.26);
    await sleep(260);
  }

  currentCoverUrl = null;
  const path = song.path.replace(/\\/g, '/');
  audio.src = `file:///${path}`;
  audio.load();
  audio.playbackRate = playbackSpeed;
  audio.play().catch(() => {});

  if (!audioCtx) initAudioCtx();
  if (audioCtx && gainNode) {
    audioCtx.resume().catch(() => {});
    const now = audioCtx.currentTime;
    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(1, now + 0.4);
  }

  startVisualizer();
  startWaveform();
  trackPlayStat(song);
  startListenTracking(song);

  renderPlayer(song);
  updateBgGlow(null);
  updateFsInfo(song);
  fetchCover(song);
  fetchLyrics(song);
}

function renderPlayer(song) {
  document.getElementById('player-content').innerHTML = `
    <div class="art-wrap">
      <div class="art" id="art-playing" onclick="openFullscreen()" style="cursor:pointer" title="نمایش تمام صفحه">
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
      <canvas id="wave-canvas"></canvas>
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
    </button>
    <div class="extra-row">
      <button class="ex-btn no-drag ${playbackSpeed !== 1.0 ? 'on' : ''}" id="btn-speed" onclick="cycleSpeed()" title="سرعت پخش — کلیک برای تغییر">⚡ <span id="speed-display">${playbackSpeed}×</span></button>
      <button class="ex-btn no-drag" onclick="toggleEQ()" title="اکولایزر">🎚 EQ</button>
      <button class="ex-btn no-drag ${sleepEndTime > Date.now() ? 'on' : ''}" id="btn-sleep" onclick="showSleep()" title="تایمر خواب">😴 <span id="sleep-display">${sleepEndTime > Date.now() ? fmtSleepTime() : 'خواب'}</span></button>
      <button class="ex-btn no-drag" onclick="showStats()" title="آمار پخش">📊</button>
      <button class="ex-btn no-drag" onclick="showQueue()" title="صف پخش">☰ صف</button>
    </div>
    <div class="rating-row" id="rating-row" style="display:flex;align-items:center;justify-content:center;gap:3px;margin-top:8px">${renderRatingStars(song)}</div>`;

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
    smartShuffleNext();
  } else {
    queueIdx = (queueIdx - 1 + queue.length) % queue.length;
  }
  loadTrack(queue[queueIdx]);
  renderColls();
}

function nextSong() {
  if (!queue.length) return;
  if (shuffle) {
    smartShuffleNext();
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
      currentCoverUrl = url;
      const blurEl = document.getElementById('fs-blur');
      if (blurEl) {
        blurEl.style.backgroundImage = `url('${url.replace(/'/g, "\\'")}')`;
        blurEl.classList.add('has-cover');
      }
      const artBox = document.getElementById('fs-art-box');
      if (artBox && document.getElementById('fs-overlay')?.classList.contains('show')) {
        artBox.innerHTML = `<img src="${url}" style="width:100%;height:100%;object-fit:cover">`;
      }
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

  body.innerHTML = `<div class="lyr-loading"><span>در حال جستجوی متن...</span></div>`;
  lyrLines = [];
  lyrFaLines = [];
  lyrFetching = true;

  // Use whatever info we have — title-only search if no artist
  const artist = song.artist || '';
  const title = song.title || song.fileName || '';

  try {
    const raw = await window.api.fetchLyrics(artist, title);
    if (!raw) {
      body.innerHTML = `<div class="lyr-no-data">
        متن آهنگ پیدا نشد.
        <button class="ai-lyr-btn" onclick="fetchLyricsWithAI()">🤖 جستجو با هوش مصنوعی</button>
      </div>`;
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

async function fetchLyricsWithAI() {
  const body = document.getElementById('lyr-body');
  const song = queue[queueIdx];
  if (!body || !song) return;
  const key = getAIKey();
  if (!key) {
    body.innerHTML = `<div class="lyr-no-data">ابتدا کلید API رو در پنل هوش مصنوعی وارد کن.</div>`;
    return;
  }
  body.innerHTML = `<div class="lyr-loading"><span>هوش مصنوعی داره دنبال متن می‌گرده...</span></div>`;
  try {
    const artistPart = song.artist ? ` by "${song.artist}"` : '';
    const prompt = `Write the complete lyrics of the song "${song.title || song.fileName}"${artistPart}. Output ONLY the lyrics, line by line, no explanations or headers.`;
    const result = await window.api.claudeChat(
      'You are a lyrics database. When asked for lyrics, output only the song lyrics text, line by line. No explanations, no headers, just the lyrics.',
      [{ role: 'user', content: prompt }],
      key, getAIProvider()
    );
    if (result && result.length > 30) {
      lyrLines = result.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      lyrFaLines = [];
      renderLyrics();
      translateLyricsChunked(lyrLines);
    } else {
      body.innerHTML = `<div class="lyr-no-data">هوش مصنوعی متن این آهنگ رو پیدا نکرد.</div>`;
    }
  } catch (e) {
    body.innerHTML = `<div class="lyr-no-data">خطا: ${String(e.message).slice(0, 100)}</div>`;
  }
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

// ── Claude AI Panel ───────────────────────────────────────────────────
let aiOpen = false, aiHistory = [], aiCtxOn = false;
const AI_CTX_LABEL_MUSIC = 'اضافه کردن اطلاعات آهنگ';

function getAIKey() { try { return localStorage.getItem('claude-api-key') || ''; } catch { return ''; } }
function getAIProvider() { try { const p = localStorage.getItem('claude-api-provider') || 'auto'; return p === 'auto' ? null : p; } catch { return null; } }
function saveAIKey() {
  const k = document.getElementById('ai-key-inp').value.trim();
  if (!k) return;
  try {
    localStorage.setItem('claude-api-key', k);
    const sel = document.getElementById('ai-provider-sel');
    if (sel) localStorage.setItem('claude-api-provider', sel.value);
  } catch {}
  document.getElementById('ai-key-box').style.display = 'none';
}
function toggleAI() {
  aiOpen = !aiOpen;
  document.getElementById('ai-panel').classList.toggle('open', aiOpen);
  if (aiOpen) {
    if (!getAIKey()) document.getElementById('ai-key-box').style.display = '';
    setTimeout(() => document.getElementById('ai-textarea')?.focus(), 300);
  }
}
function toggleAICtx() {
  aiCtxOn = !aiCtxOn;
  document.getElementById('ai-ctx-btn').classList.toggle('on', aiCtxOn);
  document.getElementById('ai-ctx-lbl').textContent = aiCtxOn ? 'context اضافه شد ✓' : AI_CTX_LABEL_MUSIC;
}
function onAIKey(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); } }
function appendAIMsg(role, text) {
  const msgs = document.getElementById('ai-msgs');
  msgs.querySelector('.ai-empty')?.remove();
  const d = document.createElement('div');
  d.className = `ai-bubble ${role}`;
  d.textContent = text;
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
  return d;
}
function getAIContext() {
  const song = queue[queueIdx];
  if (!song) return 'آهنگی پخش نمیشه.';
  const lyrics = lyrLines?.length ? lyrLines.map(l => typeof l === 'string' ? l : (l.text || '')).join('\n').slice(0, 800) : '(ترانه‌ای لود نشده)';
  return `Song: "${song.title}" by ${song.artist || 'Unknown'}\n\nLyrics:\n${lyrics}`;
}
async function sendAI() {
  const ta = document.getElementById('ai-textarea');
  const text = ta.value.trim();
  if (!text) return;
  const key = getAIKey();
  if (!key) { document.getElementById('ai-key-box').style.display = ''; return; }
  ta.value = '';
  appendAIMsg('user', text);
  const content = aiCtxOn ? `[Context]\n${getAIContext()}\n\n[Question]\n${text}` : text;
  aiHistory.push({ role: 'user', content });
  if (aiHistory.length > 20) aiHistory = aiHistory.slice(-20);
  const typingDiv = appendAIMsg('bot typing', '...');
  document.getElementById('ai-send-btn').disabled = true;
  try {
    const sys = `You are a helpful AI assistant in a music player app. Help the user understand lyrics, learn about the song, or discuss music. Be concise. Match user's language (Persian or English).`;
    const reply = await window.api.claudeChat(sys, aiHistory, key, getAIProvider());
    typingDiv.classList.remove('typing'); typingDiv.textContent = reply;
    aiHistory.push({ role: 'assistant', content: reply });
    if (aiCtxOn) { aiCtxOn = false; document.getElementById('ai-ctx-btn').classList.remove('on'); document.getElementById('ai-ctx-lbl').textContent = AI_CTX_LABEL_MUSIC; }
  } catch (err) {
    typingDiv.classList.remove('typing'); typingDiv.style.color = 'var(--err)';
    typingDiv.textContent = `خطا: ${String(err.message).slice(0, 200)}`; aiHistory.pop();
  }
  document.getElementById('ai-send-btn').disabled = false;
  document.getElementById('ai-msgs').scrollTop = document.getElementById('ai-msgs').scrollHeight;
}

// ── Esc → back to main app ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (document.getElementById('fs-overlay')?.classList.contains('show')) { closeFullscreen(); return; }
    const openModal = document.querySelector('.modal-bg.show,.cmt-modal.show,.newcoll-modal.show,.sleep-modal.show,.stats-modal.show');
    if (openModal) { openModal.classList.remove('show'); return; }
    if (document.getElementById('eq-panel')?.classList.contains('show')) { closeEQ(); return; }
    if (aiOpen) { toggleAI(); return; }
    window.api.closeWindow();
  }
});

// ── Delete helpers ─────────────────────────────────────────────────────
function deleteColl(id) {
  state.collections = state.collections.filter(c => c.id !== id);
  if (activeColl === id) activeColl = state.collections[0]?.id || null;
  saveState();
  renderColls();
}

function removeSongFromColl(collId, idx) {
  const coll = state.collections.find(c => c.id === collId);
  if (!coll) return;
  coll.songs.splice(idx, 1);
  saveState();
  renderColls();
}

// ── Drag & Drop ────────────────────────────────────────────────────────
let dragCollId = null;
let dragSong = null; // { collId, idx }

function collDragStart(e, id) {
  dragCollId = id;
  dragSong = null;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.5';
}

function collDragEnd(e) {
  dragCollId = null;
  e.currentTarget.style.opacity = '';
}

function collHeaderDragOver(e, id) {
  if (!dragCollId || dragCollId === id) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}

function collHeaderDrop(e, targetId) {
  if (!dragCollId || dragCollId === targetId) return;
  e.preventDefault();
  const fromIdx = state.collections.findIndex(c => c.id === dragCollId);
  const toIdx = state.collections.findIndex(c => c.id === targetId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = state.collections.splice(fromIdx, 1);
  state.collections.splice(toIdx, 0, moved);
  dragCollId = null;
  saveState();
  renderColls();
}

function songDragStart(e, collId, idx) {
  dragSong = { collId, idx };
  dragCollId = null;
  e.dataTransfer.effectAllowed = 'move';
  e.currentTarget.style.opacity = '0.5';
  e.stopPropagation();
}

function songDragEnd(e) {
  dragSong = null;
  e.currentTarget.style.opacity = '';
}

function songColDragOver(e, collId) {
  if (!dragSong) return;
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = 'move';
  document.getElementById('csongs-' + collId).style.background = 'rgba(123,94,255,.1)';
}

function songColDrop(e, targetCollId) {
  if (!dragSong) return;
  e.preventDefault();
  e.stopPropagation();
  document.getElementById('csongs-' + targetCollId).style.background = '';
  const { collId: srcCollId, idx: srcIdx } = dragSong;
  const srcColl = state.collections.find(c => c.id === srcCollId);
  const dstColl = state.collections.find(c => c.id === targetCollId);
  if (!srcColl || !dstColl) return;
  const [song] = srcColl.songs.splice(srcIdx, 1);
  dstColl.songs.push(song);
  dragSong = null;
  saveState();
  renderColls();
}

// ── Generated cover fallback ───────────────────────────────────────────
function generateCover(title, w = 240, h = 240) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  let hash = 0;
  for (let i = 0; i < title.length; i++) hash = title.charCodeAt(i) + ((hash << 5) - hash);
  const hue1 = Math.abs(hash) % 360;
  const hue2 = (hue1 + 50) % 360;
  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${hue1},55%,22%)`);
  grad.addColorStop(1, `hsl(${hue2},55%,13%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.42, h * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${hue1},70%,55%,0.15)`;
  ctx.fill();
  const initials = title.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || title[0]?.toUpperCase() || '?';
  ctx.fillStyle = `hsla(${hue1},80%,78%,0.9)`;
  ctx.font = `bold ${Math.round(h * 0.24)}px Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(initials, w / 2, h * 0.42);
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  const fSize = Math.max(10, Math.round(h * 0.065));
  ctx.font = `${fSize}px Arial`; ctx.textBaseline = 'bottom';
  const maxLineW = w - 16;
  const words = title.split(/\s+/); const lines = []; let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxLineW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(-2);
  shown.forEach((l, i) => ctx.fillText(l, w / 2, h - 10 - (shown.length - 1 - i) * fSize * 1.4));
  return canvas.toDataURL('image/jpeg', 0.88);
}

// ── Init ───────────────────────────────────────────────────────────────
renderColls();

// Generate covers for songs that have none
(function() {
  let changed = false;
  for (const coll of state.collections) {
    for (const s of (coll.songs || [])) {
      if (!s.cover) {
        s.cover = generateCover(s.title || s.path?.split(/[\\/]/).pop() || coll.name);
        changed = true;
      }
    }
  }
  if (changed) { saveState(); renderColls(); }
})();
initEQUI();

// ── Web Audio + Visualizer ─────────────────────────────────────────────
function initAudioCtx() {
  if (audioCtx) return;
  try {
    audioCtx = new AudioContext();
    const source = audioCtx.createMediaElementSource(audio);
    gainNode = audioCtx.createGain();
    gainNode.gain.value = 1;
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    const specs = [
      { freq: 60,    type: 'lowshelf' },
      { freq: 250,   type: 'peaking',  Q: 1.0 },
      { freq: 1000,  type: 'peaking',  Q: 1.0 },
      { freq: 4000,  type: 'peaking',  Q: 1.0 },
      { freq: 16000, type: 'highshelf' },
    ];
    eqFilters = specs.map(s => {
      const f = audioCtx.createBiquadFilter();
      f.type = s.type;
      f.frequency.value = s.freq;
      f.gain.value = 0;
      if (s.Q !== undefined) f.Q.value = s.Q;
      return f;
    });
    source.connect(gainNode);
    let node = gainNode;
    for (const f of eqFilters) { node.connect(f); node = f; }
    node.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch { audioCtx = null; }
}

function startVisualizer() {
  if (vizFrameId) cancelAnimationFrame(vizFrameId);
  if (!analyser) return;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  function draw() {
    vizFrameId = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    const cv = document.getElementById('viz-canvas');
    const fv = document.getElementById('fs-canvas');
    if (cv) drawViz(cv, dataArray, false);
    if (fv && document.getElementById('fs-overlay')?.classList.contains('show')) drawViz(fv, dataArray, true);
  }
  draw();
}

function drawViz(canvas, data, large) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!W || !H) return;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const useBins = Math.floor(data.length * 0.6);
  const count = large ? Math.min(useBins, 80) : Math.min(useBins, 60);
  const step = Math.max(1, Math.floor(useBins / count));
  for (let i = 0; i < count; i++) {
    const v = data[i * step] / 255;
    const barW = (w / count) * 0.72;
    const gap = (w / count) * 0.28;
    const barH = Math.max(2 * dpr, v * h * 0.95);
    const x = i * (w / count) + gap / 2;
    const hue = 250 - v * 55;
    ctx.fillStyle = `hsla(${hue},75%,65%,${0.25 + v * 0.75})`;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, h - barH, barW, barH, Math.min(barW / 2, 3 * dpr));
    else ctx.rect(x, h - barH, barW, barH);
    ctx.fill();
  }
}

// ── Fullscreen art ─────────────────────────────────────────────────────
function openFullscreen() {
  if (queueIdx < 0) return;
  const song = queue[queueIdx];
  const overlay = document.getElementById('fs-overlay');
  if (!overlay) return;
  updateFsInfo(song);
  const artBox = document.getElementById('fs-art-box');
  if (artBox) {
    if (currentCoverUrl) artBox.innerHTML = `<img src="${currentCoverUrl}" style="width:100%;height:100%;object-fit:cover">`;
    else artBox.innerHTML = '🎵';
  }
  const blurEl = document.getElementById('fs-blur');
  if (blurEl) {
    if (currentCoverUrl) {
      blurEl.style.backgroundImage = `url('${currentCoverUrl.replace(/'/g, "\\'")}')`;
      blurEl.classList.add('has-cover');
    } else {
      blurEl.style.backgroundImage = '';
      blurEl.classList.remove('has-cover');
    }
  }
  overlay.classList.add('show');
}

function closeFullscreen() {
  document.getElementById('fs-overlay')?.classList.remove('show');
}

function updateFsInfo(song) {
  const t = document.getElementById('fs-t');
  const a = document.getElementById('fs-a');
  if (t) t.textContent = song.title || song.fileName || '';
  if (a) a.textContent = song.artist || '';
}

// ── EQ ─────────────────────────────────────────────────────────────────
function initEQUI() {
  const container = document.getElementById('eq-bands');
  if (!container) return;
  const labels = ['60Hz', '250Hz', '1kHz', '4kHz', '16kHz'];
  container.innerHTML = labels.map((lbl, i) => `
    <div class="eq-band">
      <div class="eq-val" id="eq-val-${i}">0</div>
      <div class="eq-slider-wrap">
        <div class="eq-center-line"></div>
        <input class="eq-slider" type="range" id="eq-${i}" min="-12" max="12" step="0.5" value="0"
          oninput="setEQBand(${i}, this.value)">
      </div>
      <div class="eq-label">${lbl}</div>
    </div>`).join('');
}

function toggleEQ() {
  const panel = document.getElementById('eq-panel');
  const bg = document.getElementById('eq-bg');
  panel?.classList.toggle('show');
  bg?.classList.toggle('show');
}

function closeEQ() {
  document.getElementById('eq-panel')?.classList.remove('show');
  document.getElementById('eq-bg')?.classList.remove('show');
}

function setEQBand(i, value) {
  const gain = parseFloat(value);
  const valEl = document.getElementById(`eq-val-${i}`);
  if (valEl) valEl.textContent = (gain > 0 ? '+' : '') + gain;
  if (eqFilters[i]) eqFilters[i].gain.value = gain;
  document.querySelectorAll('.eq-preset').forEach(el => el.classList.remove('on'));
}

function applyEQPreset(name, btn) {
  const preset = EQ_PRESETS[name];
  if (!preset) return;
  document.querySelectorAll('.eq-preset').forEach(el => el.classList.remove('on'));
  if (btn) btn.classList.add('on');
  preset.forEach((gain, i) => {
    const slider = document.getElementById(`eq-${i}`);
    const valEl = document.getElementById(`eq-val-${i}`);
    if (slider) slider.value = gain;
    if (valEl) valEl.textContent = (gain > 0 ? '+' : '') + gain;
    if (eqFilters[i]) eqFilters[i].gain.value = gain;
  });
}

// ── Speed control ──────────────────────────────────────────────────────
function cycleSpeed() {
  const idx = SPEED_OPTS.indexOf(playbackSpeed);
  const next = SPEED_OPTS[(idx + 1) % SPEED_OPTS.length];
  setPlaybackSpeed(next);
}

function setPlaybackSpeed(rate) {
  playbackSpeed = rate;
  audio.playbackRate = rate;
  const display = document.getElementById('speed-display');
  if (display) display.textContent = rate + '×';
  const btn = document.getElementById('btn-speed');
  if (btn) btn.classList.toggle('on', rate !== 1.0);
}

// ── Sleep timer ────────────────────────────────────────────────────────
function fmtSleepTime() {
  if (!sleepEndTime) return 'خواب';
  const remaining = Math.max(0, sleepEndTime - Date.now());
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function showSleep() {
  document.getElementById('sleep-modal')?.classList.add('show');
  refreshSleepModal();
}

function closeSleep() {
  document.getElementById('sleep-modal')?.classList.remove('show');
}

function setSleepTimer(minutes) {
  if (sleepTimeout) clearTimeout(sleepTimeout);
  if (sleepInterval) clearInterval(sleepInterval);
  sleepEndTime = Date.now() + minutes * 60000;

  document.querySelectorAll('.sleep-opt').forEach(el => {
    el.classList.toggle('on', parseInt(el.dataset.min) === minutes);
  });

  sleepTimeout = setTimeout(() => {
    audio.pause();
    sleepTimeout = null; sleepEndTime = 0;
    updateSleepDisplay();
    refreshSleepModal();
  }, minutes * 60000);

  sleepInterval = setInterval(() => {
    if (!sleepEndTime) { clearInterval(sleepInterval); return; }
    updateSleepDisplay();
    refreshSleepModal();
  }, 1000);

  updateSleepDisplay();
  refreshSleepModal();
}

function cancelSleepTimer() {
  if (sleepTimeout) { clearTimeout(sleepTimeout); sleepTimeout = null; }
  if (sleepInterval) { clearInterval(sleepInterval); sleepInterval = null; }
  sleepEndTime = 0;
  document.querySelectorAll('.sleep-opt').forEach(el => el.classList.remove('on'));
  updateSleepDisplay();
  refreshSleepModal();
}

function updateSleepDisplay() {
  const display = document.getElementById('sleep-display');
  const btn = document.getElementById('btn-sleep');
  if (!sleepEndTime || sleepEndTime <= Date.now()) {
    if (display) display.textContent = 'خواب';
    if (btn) { btn.classList.remove('on'); btn.style.color = ''; }
    return;
  }
  const remaining = sleepEndTime - Date.now();
  if (display) display.textContent = fmtSleepTime();
  if (btn) {
    btn.classList.add('on');
    btn.style.color = remaining < 120000 ? 'var(--warn)' : '';
  }
}

function refreshSleepModal() {
  const cd = document.getElementById('sleep-cd');
  const cancelBtn = document.getElementById('sleep-cancel-btn');
  if (!cd) return;
  if (sleepEndTime > Date.now()) {
    cd.textContent = fmtSleepTime().replace(':', ':');
    cd.style.display = '';
    if (cancelBtn) cancelBtn.style.display = '';
  } else {
    cd.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
  }
}

// ── Stats ──────────────────────────────────────────────────────────────
function trackPlayStat(song) {
  if (!song?.path) return;
  if (!state.stats) state.stats = { plays: {}, listenTime: {} };
  state.stats.plays[song.path] = (state.stats.plays[song.path] || 0) + 1;
  saveState();
}

function startListenTracking(song) {
  stopListenTracking();
  statsCurrentPath = song?.path || null;
  statsListenStart = Date.now();
  statsListenInterval = setInterval(() => {
    if (audio.paused || !statsCurrentPath) return;
    const elapsed = (Date.now() - statsListenStart) / 1000;
    statsListenStart = Date.now();
    if (!state.stats) state.stats = { plays: {}, listenTime: {} };
    state.stats.listenTime[statsCurrentPath] = (state.stats.listenTime[statsCurrentPath] || 0) + elapsed;
    saveState();
  }, 10000);
}

function stopListenTracking() {
  if (statsListenInterval) {
    clearInterval(statsListenInterval);
    statsListenInterval = null;
    if (statsCurrentPath && statsListenStart > 0 && !audio.paused) {
      const elapsed = (Date.now() - statsListenStart) / 1000;
      if (!state.stats) state.stats = { plays: {}, listenTime: {} };
      state.stats.listenTime[statsCurrentPath] = (state.stats.listenTime[statsCurrentPath] || 0) + elapsed;
      saveState();
    }
  }
  statsListenStart = 0;
}

function showStats() {
  document.getElementById('stats-modal')?.classList.add('show');
  renderStats();
}

function closeStats() {
  document.getElementById('stats-modal')?.classList.remove('show');
}

function fmtListenTime(seconds) {
  if (seconds < 60) return `${Math.round(seconds)}ث`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}دق`;
  return `${Math.floor(seconds / 3600)}س ${Math.floor((seconds % 3600) / 60)}دق`;
}

function renderStats() {
  const content = document.getElementById('stats-content');
  const sub = document.getElementById('stats-sub');
  if (!content) return;
  const plays = state.stats?.plays || {};
  const listenTime = state.stats?.listenTime || {};
  const songMap = {};
  for (const coll of state.collections) {
    for (const song of (coll.songs || [])) songMap[song.path] = song;
  }
  const entries = Object.keys(plays).map(path => ({
    path, song: songMap[path] || { title: path.split(/[\\/]/).pop(), artist: '' },
    plays: plays[path] || 0, listenTime: Math.round(listenTime[path] || 0)
  })).sort((a, b) => b.plays - a.plays);

  if (!entries.length) {
    content.innerHTML = '<div style="text-align:center;color:var(--t3);padding:24px 0;direction:rtl">هنوز هیچ آهنگی پخش نشده.</div>';
    if (sub) sub.textContent = '';
    return;
  }

  const totalPlays = entries.reduce((s, e) => s + e.plays, 0);
  const totalTime = entries.reduce((s, e) => s + e.listenTime, 0);
  if (sub) sub.textContent = `${totalPlays} پخش · ${fmtListenTime(totalTime)} شنیده شده`;

  const maxPlays = entries[0].plays;
  content.innerHTML = entries.slice(0, 20).map((e, i) => `
    <div class="stats-item">
      <div class="stats-rank">${i + 1}</div>
      <div class="stats-info">
        <div class="stats-name">${esc(e.song.title || e.song.fileName || e.path.split(/[\\/]/).pop())}</div>
        <div class="stats-detail">${esc(e.song.artist || '')}${e.listenTime > 0 ? ' · ' + fmtListenTime(e.listenTime) : ''}</div>
        <div class="stats-bar"><div class="stats-bar-fill" style="width:${Math.round((e.plays / maxPlays) * 100)}%"></div></div>
      </div>
      <div class="stats-plays">${e.plays}×</div>
    </div>`).join('');
}

// ── Rating ────────────────────────────────────────────────────────────
function getSongRating(path) {
  if (!state.ratings) state.ratings = {};
  return state.ratings[path] || 0;
}

function setSongRating(n) {
  const song = queue[queueIdx];
  if (!song) return;
  if (!state.ratings) state.ratings = {};
  state.ratings[song.path] = state.ratings[song.path] === n ? 0 : n;
  saveState();
  const row = document.getElementById('rating-row');
  if (row) row.innerHTML = renderRatingStars(song);
  // sync to community
  if (typeof writeCommunityRating === 'function') {
    writeCommunityRating('music', song.title || song.path.split(/[\\/]/).pop(), song.cover || '', state.ratings[song.path] || 0, song.artist || '');
  }
  initFirebase();
}

function renderRatingStars(song) {
  const r = getSongRating(song?.path || '');
  return [1,2,3,4,5].map(n =>
    `<span onclick="setSongRating(${n})" style="cursor:pointer;font-size:18px;color:${r >= n ? 'var(--warn)' : 'var(--t3)'};" title="${n} ستاره">★</span>`
  ).join('');
}

// ── Queue Manager ──────────────────────────────────────────────────────
function showQueue() {
  renderQueueModal();
  document.getElementById('queue-modal')?.classList.add('show');
}

function closeQueue() {
  document.getElementById('queue-modal')?.classList.remove('show');
}

function renderQueueModal() {
  const list = document.getElementById('queue-list');
  if (!list) return;
  if (!queue.length) {
    list.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);direction:rtl">صف خالی است.</div>';
    return;
  }
  list.innerHTML = queue.map((s, i) => {
    const active = i === queueIdx;
    return `<div class="queue-item ${active ? 'active' : ''}" onclick="playFromQueue(${i})">
      <span class="queue-num">${i + 1}</span>
      <div class="queue-info">
        <div class="queue-name">${esc(s.title || s.fileName)}</div>
        <div class="queue-artist">${esc(s.artist || '')}</div>
      </div>
      <span class="queue-dur">${s.duration ? fmtTime(s.duration) : ''}</span>
      <div class="queue-move">
        <button class="queue-move-btn" onclick="event.stopPropagation();queueMoveUp(${i})" title="بالا">▲</button>
        <button class="queue-move-btn" onclick="event.stopPropagation();queueMoveDown(${i})" title="پایین">▼</button>
      </div>
    </div>`;
  }).join('');
  // scroll to active item
  setTimeout(() => {
    const active = list.querySelector('.queue-item.active');
    if (active) active.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, 50);
}

function playFromQueue(idx) {
  queueIdx = idx;
  loadTrack(queue[queueIdx]);
  renderColls();
  renderQueueModal();
}

function queueMoveUp(idx) {
  if (idx <= 0) return;
  [queue[idx - 1], queue[idx]] = [queue[idx], queue[idx - 1]];
  if (queueIdx === idx) queueIdx = idx - 1;
  else if (queueIdx === idx - 1) queueIdx = idx;
  renderQueueModal();
}

function queueMoveDown(idx) {
  if (idx >= queue.length - 1) return;
  [queue[idx + 1], queue[idx]] = [queue[idx], queue[idx + 1]];
  if (queueIdx === idx) queueIdx = idx + 1;
  else if (queueIdx === idx + 1) queueIdx = idx;
  renderQueueModal();
}

// ── Smart Shuffle ──────────────────────────────────────────────────────
function smartShuffleNext() {
  if (!queue.length) return;
  const plays = state.stats?.plays || {};
  // weight = 1 / (playCount + 1) so less-played songs get higher weight
  const weights = queue.map((s, i) => {
    if (i === queueIdx) return 0;
    const p = plays[s.path] || 0;
    return 1 / (p + 1);
  });
  const total = weights.reduce((a, b) => a + b, 0);
  if (total === 0) {
    queueIdx = (queueIdx + 1) % queue.length;
    return;
  }
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) { queueIdx = i; return; }
  }
  queueIdx = 0;
}

// ── Waveform on progress bar ───────────────────────────────────────────
let waveFrameId = null;

function startWaveform() {
  if (waveFrameId) cancelAnimationFrame(waveFrameId);
  if (!analyser) return;
  const dataArray = new Uint8Array(analyser.fftSize);
  function drawWave() {
    waveFrameId = requestAnimationFrame(drawWave);
    const cv = document.getElementById('wave-canvas');
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
    }
    analyser.getByteTimeDomainData(dataArray);
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.lineWidth = 1.5 * dpr;
    ctx.strokeStyle = 'rgba(123,94,255,0.6)';
    ctx.beginPath();
    const sliceW = cv.width / dataArray.length;
    let x = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = dataArray[i] / 128.0;
      const y = (v * cv.height) / 2;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      x += sliceW;
    }
    ctx.lineTo(cv.width, cv.height / 2);
    ctx.stroke();
  }
  drawWave();
}

// ── Firebase init ───────────────────────────────────────────────────────
initFirebase();
