// ── State ──────────────────────────────────────────────────────────────
const DATA_KEY = 'video-player';
let state = loadState();
let activeColl = state.collections.length ? state.collections[0].id : null;
let queue = [];
let queueIdx = -1;
let subMode = 'both';
let subtitles = [];        // [{start, end, en, fa}]
let subTranslating = false;
let cmtTimestamp = 0;
let isDraggingProg = false;
let isDraggingVol = false;
let hideCtrlTimer = null;
let currentMovieInfo = null;

const vid = document.getElementById('vid');
const area = document.getElementById('video-area');

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

// ── TMDB key ───────────────────────────────────────────────────────────
function getTmdbKey() {
  try { return localStorage.getItem('tmdb-key') || ''; } catch { return ''; }
}

function saveTmdbKey() {
  const key = document.getElementById('tmdb-key-input').value.trim();
  if (!key) return;
  try { localStorage.setItem('tmdb-key', key); } catch {}
  document.getElementById('setup-banner').classList.remove('show');
}

// ── Collections ────────────────────────────────────────────────────────
function renderColls() {
  const el = document.getElementById('colls-list');
  if (!state.collections.length) {
    el.innerHTML = `<div class="empty-colls">
      <p>هنوز مجموعه‌ای نداری.<br>یه مجموعه بساز و فیلم اضافه کن.</p>
      <div class="icon-btn accent" style="width:auto;padding:8px 16px;border-radius:10px;font-family:'Space Grotesk',sans-serif;font-size:12.5px;display:flex;gap:6px" onclick="showNewColl()">
        + مجموعه جدید
      </div>
    </div>`;
    return;
  }

  el.innerHTML = state.collections.map(c => {
    const isActive = c.id === activeColl;
    const videos = c.videos || [];
    const thumb = videos.find(v => v.poster)?.poster || null;

    return `<div class="coll ${isActive ? 'active' : ''} ${c.open ? 'open' : ''}" id="coll-${c.id}">
      <div class="coll-hd" onclick="toggleColl('${c.id}')">
        <div class="coll-thumb">
          ${thumb ? `<img src="${esc(thumb)}" alt="">` : '🎬'}
        </div>
        <div class="coll-meta">
          <div class="coll-name">${esc(c.name)}</div>
          <div class="coll-cnt">${videos.length} فیلم</div>
        </div>
        <span class="coll-chev">›</span>
      </div>
      <div class="coll-items">
        ${videos.map((v, i) => {
          const playing = queueIdx >= 0 && queue[queueIdx]?.path === v.path && activeColl === c.id;
          return `<div class="movie-row ${playing ? 'playing' : ''}" onclick="playVideo('${c.id}',${i})">
            <div class="movie-thumb-sm">
              ${v.poster ? `<img src="${esc(v.poster)}" alt="">` : '🎥'}
            </div>
            <div class="movie-info">
              <div class="movie-name">${esc(v.title || v.fileName)}</div>
              <div class="movie-year">${v.year ? v.year + ' · ' : ''}${v.duration ? fmtTime(v.duration) : ''}</div>
            </div>
            <div class="play-ind">
              <svg width="8" height="8" viewBox="0 0 8 8" fill="#fff"><path d="M2 1.5l4 2.5-4 2.5V1.5z"/></svg>
            </div>
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
  const paths = await window.api.openVideoFiles();
  if (!paths.length) return;
  await addVideosToColl(paths);
}

async function addVideosToColl(paths) {
  let coll = state.collections.find(c => c.id === activeColl);
  if (!coll) {
    if (!state.collections.length) {
      createCollWithName('فیلم‌ها');
      coll = state.collections[0];
    } else {
      coll = state.collections[0];
    }
  }

  for (const p of paths) {
    if (coll.videos.find(v => v.path === p)) continue;
    const fileName = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const title = cleanTitle(fileName);
    coll.videos.push({ path: p, fileName, title, year: null, poster: null, duration: null });
  }

  coll.open = true;
  activeColl = coll.id;
  saveState();
  renderColls();
  fetchMetadataForColl(coll);
}

function cleanTitle(name) {
  return name
    .replace(/\./g, ' ')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\b(1080p|720p|480p|4K|BluRay|WEBRip|HDRip|x264|x265|HEVC|AAC|AC3)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchMetadataForColl(coll) {
  const key = getTmdbKey();
  if (!key) return;
  for (const v of coll.videos) {
    if (v.poster) continue;
    const info = await window.api.tmdbSearch(v.title, key).catch(() => null);
    if (!info) continue;
    v.poster = info.poster_path || null;
    v.year = info.release_date?.slice(0, 4) || null;
    v.tmdbId = info.id;
    saveState();
    renderColls();
  }
}

// ── Collections management ─────────────────────────────────────────────
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
  const id = 'vc' + Date.now();
  state.collections.push({ id, name, videos: [], open: true });
  activeColl = id;
  saveState();
  renderColls();
}

// ── Playback ───────────────────────────────────────────────────────────
async function playVideo(collId, idx) {
  const coll = state.collections.find(c => c.id === collId);
  if (!coll) return;
  activeColl = collId;
  queue = [...coll.videos];
  queueIdx = idx;
  loadVideo(queue[queueIdx]);
  renderColls();
}

function loadVideo(video) {
  const path = video.path.replace(/\\/g, '/');
  vid.src = `file:///${path}`;
  vid.load();
  vid.play();

  // hide no-track, show meta
  document.getElementById('no-track').classList.add('hidden');
  const metaOverlay = document.getElementById('meta-overlay');
  metaOverlay.classList.add('has-video');

  // update meta overlay
  document.getElementById('meta-title').textContent = video.title || video.fileName;
  renderMetaTags(video);

  // reset subtitles
  subtitles = [];
  hideSubtitle();

  // load duration later
  currentMovieInfo = video;
  fetchMovieDetails(video);
}

function renderMetaTags(video) {
  const tags = document.getElementById('meta-tags');
  const parts = [];
  if (video.year) parts.push(`<span class="meta-tag">${esc(video.year)}</span>`);
  if (video.genres?.length) video.genres.slice(0, 2).forEach(g => parts.push(`<span class="meta-tag">${esc(g)}</span>`));
  if (video.rating) parts.push(`<span class="meta-tag rating">★ ${video.rating}</span>`);
  if (video.director) parts.push(`<span style="font-size:11px;color:rgba(255,255,255,.4)">کارگردان: ${esc(video.director)}</span>`);
  tags.innerHTML = parts.join('');
}

async function fetchMovieDetails(video) {
  const key = getTmdbKey();
  if (!key || !video.tmdbId) return;
  try {
    const details = await window.api.tmdbDetails(video.tmdbId, key);
    if (!details) return;
    // update video record
    video.genres = details.genres;
    video.director = details.director;
    video.rating = details.vote_average?.toFixed(1);
    video.runtime = details.runtime;
    video.overview = details.overview;
    video.cast = details.cast;
    video.poster = video.poster || details.poster_path;
    saveState();
    renderColls();
    renderMetaTags(video);
  } catch {}
}

// ── Video events ───────────────────────────────────────────────────────
vid.addEventListener('loadedmetadata', () => {
  const dur = document.getElementById('time-dur');
  if (dur) dur.textContent = fmtTime(vid.duration);
  // update stored duration
  if (queue[queueIdx]) {
    queue[queueIdx].duration = Math.round(vid.duration);
    const coll = state.collections.find(c => c.id === activeColl);
    if (coll) {
      const v = coll.videos[queueIdx];
      if (v) v.duration = queue[queueIdx].duration;
    }
    saveState();
  }
});

vid.addEventListener('timeupdate', () => {
  if (isDraggingProg || !vid.duration) return;
  const pct = (vid.currentTime / vid.duration) * 100;
  const fill = document.getElementById('prog-fill');
  const cur = document.getElementById('time-cur');
  if (fill) fill.style.width = pct + '%';
  if (cur) cur.textContent = fmtTime(vid.currentTime);
  updateSubtitle();
});

vid.addEventListener('ended', () => { nextVideo(); });
vid.addEventListener('play', updatePlayBtn);
vid.addEventListener('pause', updatePlayBtn);

function updatePlayBtn() {
  const icon = document.getElementById('play-icon');
  if (!icon) return;
  if (vid.paused) {
    icon.innerHTML = `<path fill-rule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clip-rule="evenodd"/>`;
  } else {
    icon.innerHTML = `<path fill-rule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clip-rule="evenodd"/>`;
  }
}

function togglePlay() {
  if (vid.paused) vid.play();
  else vid.pause();
}

function prevVideo() {
  if (!queue.length) return;
  if (vid.currentTime > 3) { vid.currentTime = 0; return; }
  queueIdx = (queueIdx - 1 + queue.length) % queue.length;
  loadVideo(queue[queueIdx]);
  renderColls();
}

function nextVideo() {
  if (!queue.length || queueIdx >= queue.length - 1) return;
  queueIdx++;
  loadVideo(queue[queueIdx]);
  renderColls();
}

// ── Progress bar ───────────────────────────────────────────────────────
const progTrack = document.getElementById('prog-track');
progTrack.addEventListener('mousedown', e => {
  isDraggingProg = true;
  seekTo(e);
});
document.addEventListener('mousemove', e => {
  if (isDraggingProg) seekTo(e);
});
document.addEventListener('mouseup', () => { isDraggingProg = false; });

function seekTo(e) {
  const rect = progTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (vid.duration) vid.currentTime = pct * vid.duration;
}

// ── Volume ─────────────────────────────────────────────────────────────
vid.volume = 0.75;
const volTrack = document.getElementById('vol-track');
volTrack.addEventListener('mousedown', e => {
  isDraggingVol = true;
  setVol(e);
});
document.addEventListener('mousemove', e => {
  if (isDraggingVol) setVol(e);
});
document.addEventListener('mouseup', () => { isDraggingVol = false; });

function setVol(e) {
  const rect = volTrack.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  vid.volume = pct;
  vid.muted = false;
  updateVolUI(pct);
}

function updateVolUI(pct) {
  const fill = document.getElementById('vol-fill');
  const val = document.getElementById('vol-val');
  if (fill) fill.style.width = (pct * 100) + '%';
  if (val) val.textContent = Math.round(pct * 100);
}

function toggleMute() {
  vid.muted = !vid.muted;
  updateVolUI(vid.muted ? 0 : vid.volume);
}

// ── Controls auto-hide ─────────────────────────────────────────────────
area.addEventListener('mousemove', () => {
  area.classList.add('show-ctrl');
  area.classList.remove('cursor-hidden');
  clearTimeout(hideCtrlTimer);
  if (!vid.paused) {
    hideCtrlTimer = setTimeout(() => {
      area.classList.remove('show-ctrl');
      area.classList.add('cursor-hidden');
    }, 3000);
  }
});

area.addEventListener('mouseleave', () => {
  if (!vid.paused) {
    area.classList.remove('show-ctrl');
  }
});

vid.addEventListener('pause', () => {
  area.classList.add('show-ctrl');
  area.classList.remove('cursor-hidden');
  clearTimeout(hideCtrlTimer);
});

// click on video area to toggle play (but not on controls)
vid.addEventListener('click', togglePlay);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'KeyF') toggleFullscreen();
  if (e.code === 'ArrowRight') vid.currentTime = Math.min(vid.duration || 0, vid.currentTime + 10);
  if (e.code === 'ArrowLeft') vid.currentTime = Math.max(0, vid.currentTime - 10);
  if (e.code === 'ArrowUp') { vid.volume = Math.min(1, vid.volume + 0.1); updateVolUI(vid.volume); }
  if (e.code === 'ArrowDown') { vid.volume = Math.max(0, vid.volume - 0.1); updateVolUI(vid.volume); }
});

// ── Fullscreen ─────────────────────────────────────────────────────────
function toggleFullscreen() {
  if (!document.fullscreenElement) {
    area.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

document.addEventListener('fullscreenchange', () => {
  const icon = document.getElementById('fs-icon');
  if (!icon) return;
  if (document.fullscreenElement) {
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"/>`;
  } else {
    icon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/>`;
  }
});

// ── Subtitle ───────────────────────────────────────────────────────────
async function loadSubtitle() {
  const modal = document.getElementById('sub-modal');
  const status = document.getElementById('sub-status');
  modal.classList.add('show');
  status.innerHTML = `<span class="translating">در حال بارگذاری...</span>`;

  const raw = await window.api.openSubtitleFile().catch(() => null);
  if (!raw) { modal.classList.remove('show'); return; }

  subtitles = parseSrt(raw);
  if (!subtitles.length) {
    status.innerHTML = `<span style="color:var(--err)">فایل زیرنویس ناخوانا بود.</span>`;
    return;
  }

  status.innerHTML = `<span class="ok">✓ ${subtitles.length} خط لود شد.</span> در حال ترجمه...`;
  modal.classList.add('show');

  await translateSubtitles();
  status.innerHTML = `<span class="ok">✓ ترجمه کامل شد. زیرنویس آماده‌ست.</span>`;
}

function parseSrt(text) {
  const result = [];
  // normalize line endings
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\n+/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;

    // skip index line if numeric
    let i = 0;
    if (/^\d+$/.test(lines[0].trim())) i = 1;

    const timeLine = lines[i];
    if (!timeLine) continue;

    const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[,.]?\d{0,3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]?\d{0,3})/);
    if (!timeMatch) continue;

    const start = parseSrtTime(timeMatch[1]);
    const end = parseSrtTime(timeMatch[2]);
    const en = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!en) continue;

    result.push({ start, end, en, fa: '' });
  }
  return result;
}

function parseSrtTime(t) {
  const clean = t.replace(',', '.');
  const parts = clean.split(':');
  const h = parseInt(parts[0]) || 0;
  const m = parseInt(parts[1]) || 0;
  const s = parseFloat(parts[2]) || 0;
  return h * 3600 + m * 60 + s;
}

async function translateSubtitles() {
  subTranslating = true;
  const chunkSize = 8;
  for (let i = 0; i < subtitles.length; i += chunkSize) {
    const chunk = subtitles.slice(i, i + chunkSize);
    const joined = chunk.map(s => s.en).join('\n');
    try {
      const translated = await window.api.translate(joined);
      if (translated) {
        const parts = translated.split('\n');
        for (let j = 0; j < chunk.length; j++) {
          subtitles[i + j].fa = parts[j]?.trim() || '';
        }
      }
    } catch {}
    await sleep(250);
  }
  subTranslating = false;
}

function updateSubtitle() {
  if (!subtitles.length) return;
  const t = vid.currentTime;
  const sub = subtitles.find(s => t >= s.start && t <= s.end);

  const display = document.getElementById('sub-display');
  const enLine = document.getElementById('sub-en-line');
  const faLine = document.getElementById('sub-fa-line');

  if (!sub) {
    display.classList.add('hidden');
    return;
  }

  display.classList.remove('hidden');

  enLine.textContent = sub.en;
  faLine.textContent = sub.fa || '...';

  enLine.style.display = (subMode === 'en' || subMode === 'both') ? 'inline-block' : 'none';
  faLine.style.display = (subMode === 'fa' || subMode === 'both') && sub.fa ? 'inline-block' : 'none';
}

function hideSubtitle() {
  document.getElementById('sub-display').classList.add('hidden');
}

function setSubMode(btn, mode) {
  subMode = mode;
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

// ── Info modal ─────────────────────────────────────────────────────────
async function openInfo() {
  const modal = document.getElementById('info-modal');
  modal.classList.add('show');

  const video = queue[queueIdx];
  if (!video) return;

  // set header
  document.getElementById('modal-film-title').textContent = video.title || video.fileName;
  document.getElementById('modal-orig').textContent = video.fileName || '';

  const posterEl = document.getElementById('modal-poster');
  if (video.poster) {
    posterEl.innerHTML = `<img src="${esc(video.poster)}" alt="">`;
  } else {
    posterEl.textContent = '🎬';
  }

  const tags = document.getElementById('modal-tags');
  const tagParts = [];
  if (video.year) tagParts.push(`<span class="meta-tag">${esc(video.year)}</span>`);
  if (video.rating) tagParts.push(`<span class="meta-tag rating">★ ${esc(video.rating)}</span>`);
  if (video.genres?.length) video.genres.forEach(g => tagParts.push(`<span class="meta-tag">${esc(g)}</span>`));
  tags.innerHTML = tagParts.join('');

  const content = document.getElementById('info-content');

  if (!video.overview) {
    const key = getTmdbKey();
    if (!key) {
      content.innerHTML = `<div class="info-row"><div class="info-en">برای اطلاعات بیشتر، TMDB API key رو در بالا وارد کن.</div></div>`;
      document.getElementById('setup-banner').classList.add('show');
      return;
    }
    content.innerHTML = `<div class="info-loading">در حال بارگذاری...</div>`;
    await fetchMovieDetails(video);
  }

  if (!video.overview) {
    content.innerHTML = `<div class="info-row"><div class="info-en">اطلاعاتی پیدا نشد.</div></div>`;
    return;
  }

  const overviewFa = await window.api.translate(video.overview).catch(() => null);
  const directorFa = video.director ? await window.api.translate(video.director).catch(() => null) : null;

  content.innerHTML = `
    ${video.director ? `<div class="info-row">
      <div class="info-lbl">کارگردان</div>
      <div class="info-en">${esc(video.director)}</div>
      ${directorFa ? `<div class="info-fa">${esc(directorFa)}</div>` : ''}
    </div>` : ''}
    ${video.runtime ? `<div class="info-row">
      <div class="info-lbl">مدت</div>
      <div class="info-en">${Math.floor(video.runtime / 60)} ساعت ${video.runtime % 60} دقیقه</div>
    </div>` : ''}
    ${video.cast?.length ? `<div class="info-row">
      <div class="info-lbl">بازیگران</div>
      <div class="info-en">${video.cast.map(esc).join('، ')}</div>
    </div>` : ''}
    <div class="info-row">
      <div class="info-lbl">خلاصه</div>
      <div class="info-en" style="direction:ltr;text-align:left">${esc(video.overview)}</div>
      ${overviewFa ? `<div class="info-fa">${esc(overviewFa)}</div>` : ''}
    </div>`;
}

function closeInfo() {
  document.getElementById('info-modal').classList.remove('show');
}

// ── Comment modal ──────────────────────────────────────────────────────
function openCmt() {
  cmtTimestamp = vid.currentTime || 0;
  const timeEl = document.getElementById('cmt-time');
  if (timeEl) timeEl.textContent = '⏱ ' + fmtTime(cmtTimestamp);
  document.getElementById('cmt-input').value = '';
  document.getElementById('cmt-modal').classList.add('show');
  setTimeout(() => document.getElementById('cmt-input').focus(), 100);
}

function closeCmt() {
  document.getElementById('cmt-modal').classList.remove('show');
}

function saveCmt() {
  const text = document.getElementById('cmt-input').value.trim();
  if (!text) return;
  if (!state.comments) state.comments = [];
  const video = queue[queueIdx];
  state.comments.push({
    id: 'vcmt' + Date.now(),
    path: video?.path || '',
    timestamp: cmtTimestamp,
    text,
    createdAt: Date.now()
  });
  saveState();
  closeCmt();
  renderMarkers();
}

function renderMarkers() {
  const container = document.getElementById('markers-bar');
  if (!container) return;
  const video = queueIdx >= 0 ? queue[queueIdx] : null;
  if (!video) return;

  const cmts = (state.comments || []).filter(c => c.path === video.path);
  const colors = ['#7B5EFF', '#2FD6A8', '#F5A623', '#FF5F7E', '#60A5FA'];

  container.innerHTML = cmts.map((c, i) => {
    const pct = vid.duration ? (c.timestamp / vid.duration) * 100 : 0;
    const color = colors[i % colors.length];
    return `<div class="marker" style="left:${pct}%;background:${color}"
      onclick="vid.currentTime=${c.timestamp}">
      <div class="marker-tip">${esc(c.text)}</div>
    </div>`;
  }).join('');
}

// ── Utils ──────────────────────────────────────────────────────────────
function fmtTime(s) {
  if (!s || isNaN(s)) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Init ───────────────────────────────────────────────────────────────
updateVolUI(0.75);
renderColls();

// show TMDB banner if no key and there are collections
if (!getTmdbKey() && state.collections.length > 0) {
  setTimeout(() => document.getElementById('setup-banner').classList.add('show'), 1000);
}
