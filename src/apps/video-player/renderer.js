// ── Generated cover fallback ───────────────────────────────────────────
function generateCover(title, w = 200, h = 280) {
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
  ctx.arc(w * 0.5, h * 0.38, h * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = `hsla(${hue1},70%,55%,0.15)`;
  ctx.fill();
  const initials = title.trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || title[0]?.toUpperCase() || '?';
  ctx.fillStyle = `hsla(${hue1},80%,78%,0.9)`;
  ctx.font = `bold ${Math.round(h * 0.22)}px Arial`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(initials, w / 2, h * 0.38);
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  const fSize = Math.max(10, Math.round(h * 0.062));
  ctx.font = `${fSize}px Arial`; ctx.textBaseline = 'bottom';
  const maxLineW = w - 16;
  const words = title.split(/\s+/); const lines = []; let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxLineW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(-3);
  shown.forEach((l, i) => ctx.fillText(l, w / 2, h - 10 - (shown.length - 1 - i) * fSize * 1.4));
  return canvas.toDataURL('image/jpeg', 0.88);
}

// ── State ──────────────────────────────────────────────────────────────
const DATA_KEY = 'video-player';
let state = loadState();
let activeColl = state.collections.length ? state.collections[0].id : null;
let queue = [];
let queueIdx = -1;
let subMode = 'both';
let subtitles = [];        // [{start, end, en, fa}]
let translatingTrack = null;
let subtitleSearchRequest = 0;
let subtitleSelection = 0;
let cmtTimestamp = 0;
let isDraggingProg = false;
let isDraggingVol = false;
let hideCtrlTimer = null;
let currentMovieInfo = null;
let abA = null, abB = null, abActive = false;
let vidSpeed = 1.0;
let resumeSaveTimer = null;
const VID_SPEED_OPTS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

const vid = document.getElementById('vid');
const area = document.getElementById('video-area');

// ── Persistence ────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (!s.resume) s.resume = {};
      if (!s.watchData) s.watchData = {};
      return s;
    }
  } catch {}
  return { collections: [], comments: [], resume: {}, watchData: {} };
}

function saveState() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch {}
  window.asarCollections?.refresh();
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

// ── OpenSubtitles key ──────────────────────────────────────────────────
function getOsubKey() {
  try { return localStorage.getItem('osub-key') || ''; } catch { return ''; }
}

function saveOsubKey() {
  const key = document.getElementById('osub-key-input').value.trim();
  if (!key) return;
  try { localStorage.setItem('osub-key', key); } catch {}
  document.getElementById('osub-banner').classList.remove('show');
  // retry subtitle fetch for current video
  if (queue[queueIdx]) autoFetchSubtitle(queue[queueIdx]);
}

// ── Auto-subtitle status ───────────────────────────────────────────────
let subStatusTimer = null;

function setSubAutoStatus(msg, type) {
  const el = document.getElementById('sub-auto-status');
  if (!el) return;
  clearTimeout(subStatusTimer);
  if (!msg) { el.classList.add('hidden'); return; }
  el.textContent = msg;
  el.className = 'sub-auto-status' + (type ? ' ' + type : '');
  if (type === 'done' || type === 'error') {
    subStatusTimer = setTimeout(() => el.classList.add('hidden'), 4000);
  }
}

// ── Auto-fetch subtitle ────────────────────────────────────────────────
async function checkSubtitleSync(parsedSubs, movieTitle) {
  const aiKey = getAIKey();
  if (!aiKey || parsedSubs.length < 3) return true; // no key or too short → accept
  try {
    const sample = parsedSubs.slice(0, Math.min(8, parsedSubs.length));
    const lines = sample.map((s, i) => {
      const mins = Math.floor(s.start / 60);
      const secs = Math.floor(s.start % 60);
      return `[${mins}:${secs.toString().padStart(2,'0')}] ${s.en}`;
    }).join('\n');
    const sys = `You are a movie subtitle sync checker. Given a movie title and sample subtitle lines with timestamps, determine if the dialogue seems plausible for that movie at approximately those timestamps. Answer with just YES or NO.`;
    const msg = `Movie: "${movieTitle}"\n\nSample subtitle lines:\n${lines}\n\nDoes this subtitle content seem plausible for this movie? YES or NO.`;
    const reply = await window.api.claudeChat(sys, [{ role: 'user', content: msg }], aiKey);
    if (!reply) return true; // AI failed → accept
    return reply.trim().toUpperCase().startsWith('YES');
  } catch { return true; }
}

async function autoFetchSubtitle(video) {
  const request = ++subtitleSearchRequest;
  const subdlKey = getOsubKey();

  const fileName = video.fileName || '';
  const videoPath = video.path || '';
  const { title: parsedTitle, year: parsedYear } = parseVideoFileName(fileName);
  const title = parsedTitle || video.title || fileName;
  // parsedYear (from filename) takes priority — TMDB may match a wrong movie
  const year  = parsedYear || video.year || null;
  const imdbId = video.imdbId || null;

  // If no subdl key and no IMDB, show banner and stop — hash search only works with file path
  if (!subdlKey) {
    setSubAutoStatus('⚠️ کلید subdl لازمه', 'error');
    setTimeout(() => document.getElementById('osub-banner')?.classList.add('show'), 300);
    return;
  }

  // Build title variations: original, with/without "The "
  const titleVariants = [title];
  if (!title.toLowerCase().startsWith('the ')) titleVariants.push('The ' + title);
  else titleVariants.push(title.replace(/^the\s+/i, ''));

  showSubAIBtn(false);
  let results = null;

  for (const t of titleVariants) {
    if (request !== subtitleSearchRequest) return;
    setSubAutoStatus(`🔍 "${t}" ${year || ''}...`, '');
    const r = await window.api.subtitleSearch(t, year, subdlKey, fileName, videoPath, imdbId).catch(e => {
      if (request === subtitleSearchRequest) setSubAutoStatus(`❌ خطای IPC: ${e?.message || e}`, 'error');
      return null;
    });
    if (request !== subtitleSearchRequest) return;
    if (r?.length) { results = r; break; }
    setSubAutoStatus(`⚠️ "${t}" — ۰ نتیجه`, '');
    await sleep(500);
  }

  if (request !== subtitleSearchRequest) return;
  if (!results?.length) {
    setSubAutoStatus(`⚠️ نتیجه‌ای یافت نشد — "${title}" ${year||''}`, 'error');
    showSubAIBtn(true);
    return;
  }

  // Show subtitle picker — user selects the synced one, then translates
  showSubtitlePicker(results, subdlKey);
}

let _pickerResults = [];
let _pickerKey = '';

function showSubtitlePicker(results, subdlKey) {
  _pickerResults = results.slice(0, 10);
  _pickerKey = subdlKey;

  const list = document.getElementById('sub-picker-list');
  if (!list) return;

  list.innerHTML = _pickerResults.map((r, i) => {
    const src = r.source || '';
    const name = (r.name || '—').slice(0, 48);
    return `<div class="sub-pick-item" id="spitem-${i}" onclick="selectSubtitleFromPicker(${i})">
      <span class="sub-pick-src">${esc(src)}</span>
      <span class="sub-pick-name">${esc(name)}</span>
    </div>`;
  }).join('');

  const picker = document.getElementById('sub-picker');
  if (picker) picker.style.display = 'block';
  document.getElementById('sub-translate-btn').style.display = 'none';
  setSubAutoStatus(`${_pickerResults.length} زیرنویس — یکی انتخاب کن`, '');
}

async function selectSubtitleFromPicker(idx) {
  const r = _pickerResults[idx];
  if (!r) return;
  const request = ++subtitleSelection;
  const btn = document.getElementById('sub-translate-btn');

  // Visual feedback
  document.querySelectorAll('.sub-pick-item').forEach((el, i) => {
    el.classList.remove('selected', 'loading', 'done');
    if (i === idx) el.classList.add('loading');
  });
  btn.style.display = 'none';
  setSubAutoStatus(`📥 در حال دانلود...`, '');

  const srtText = await window.api.subtitleDownload(r.fileId, _pickerKey).catch(() => null);
  if (request !== subtitleSelection || r !== _pickerResults[idx]) return;
  document.getElementById(`spitem-${idx}`)?.classList.remove('loading');
  if (!srtText) {
    setSubAutoStatus(`❌ دانلود ناموفق`, 'error');
    return;
  }
  const parsed = parseSrt(srtText);
  if (!parsed.length) {
    setSubAutoStatus(`❌ فایل ناخوانا`, 'error');
    return;
  }

  document.getElementById(`spitem-${idx}`)?.classList.add('done');
  document.querySelectorAll('.sub-pick-item').forEach((el, i) => {
    if (i !== idx) el.classList.remove('selected');
  });
  document.getElementById(`spitem-${idx}`)?.classList.add('selected');

  subtitles = parsed;
  updateSubtitle();
  subOffset = 0;
  const offsetBar = document.getElementById('sub-offset-bar');
  const offsetVal = document.getElementById('sub-offset-val');
  if (offsetBar) offsetBar.style.display = 'flex';
  if (offsetVal) offsetVal.textContent = '0.0s';

  btn.style.display = 'block';
  btn.disabled = false;
  btn.textContent = 'ترجمه به فارسی';
  setSubAutoStatus(`✓ ${parsed.length} خط | سینک تنظیم کن، بعد ترجمه بزن`, 'done');
}

async function translateNowFromPicker() {
  const track = subtitles;
  const selection = subtitleSelection;
  if (!track.length || translatingTrack === track) return;
  const btn = document.getElementById('sub-translate-btn');
  btn.disabled = true;
  btn.textContent = 'در حال ترجمه…';
  const result = await translateSubtitles((message, type) => setSubAutoStatus(message, type));
  if (!result || track !== subtitles || selection !== subtitleSelection) return;
  btn.disabled = result.complete;
  btn.textContent = result.complete ? '✓ ترجمه شد' : 'تلاش دوباره برای ترجمه';
}

let subOffset = 0;

function shiftSubs(delta) {
  if (!subtitles.length) return;
  subOffset += delta;
  for (const s of subtitles) {
    s.start += delta;
    s.end += delta;
  }
  const bar = document.getElementById('sub-offset-bar');
  const val = document.getElementById('sub-offset-val');
  if (bar) bar.style.display = 'flex';
  if (val) val.textContent = (subOffset >= 0 ? '+' : '') + subOffset.toFixed(1) + 's';
}

function showSubAIBtn(show, video) {
  const btn = document.getElementById('sub-ai-btn');
  if (!btn) return;
  btn.style.display = show ? '' : 'none';
  if (show && video) btn.dataset.title = video.title || video.fileName || '';
}

async function fetchSubtitleWithAI(video) {
  const title = video?.title || video?.fileName || queue[queueIdx]?.title || queue[queueIdx]?.fileName || '';
  const key = getAIKey();
  if (!key) { setSubAutoStatus('کلید AI ندارم', 'error'); return; }
  const request = ++subtitleSelection;

  showSubAIBtn(false);
  setSubAutoStatus('🤖 ساخت زیرنویس با AI...', '');

  const sys = `You are a subtitle generator. Generate approximate English subtitles in SRT format for the given movie. Create 25-35 key dialogue/scene description lines spread through a typical ~2 hour movie. Use realistic timestamps. Format strictly as:
1
00:00:30,000 --> 00:00:33,000
dialogue here

2
00:02:15,000 --> 00:02:18,500
next line

(blank line between entries)`;
  const msg = `Generate English subtitles for: "${title}"`;

  try {
    const reply = await window.api.claudeChat(sys, [{ role: 'user', content: msg }], key);
    if (request !== subtitleSelection) return;
    subtitles = parseSrt(reply);
    if (!subtitles.length) { setSubAutoStatus('زیرنویس AI ساخته نشد', 'error'); return; }
    setSubAutoStatus(`🤖 ${subtitles.length} خط از AI (تقریبی)`, 'done');
    await translateSubtitles((message, type) => setSubAutoStatus(message, type));
  } catch {
    if (request !== subtitleSelection) return;
    setSubAutoStatus('خطا در AI', 'error');
    showSubAIBtn(true, queue[queueIdx]);
  }
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

  const rows = window.asarCollections?.nativeRows(state.collections) || state.collections.map(collection => ({ collection, depth: 0 }));
  el.innerHTML = rows.map(({ collection: c, depth }) => {
    const isActive = c.id === activeColl;
    const videos = c.videos || [];
    const thumb = videos.find(v => v.poster)?.poster || null;

    return `<div class="coll ${isActive ? 'active' : ''} ${c.open ? 'open' : ''}" id="coll-${c.id}"
         style="margin-inline-start: ${Math.min(depth, 7) * 10}px"
         draggable="true"
         ondragstart="dragNativeFolder(event,'${c.id}')"
         ondragend="endNativeDrag(event)"
         ondragover="window.asarCollections?.dragOverNative(event)"
         ondragleave="window.asarCollections?.dragLeaveNative(event)"
         ondrop="window.asarCollections?.dropNative(event,'${c.id}')">
      <div class="coll-hd" onclick="toggleColl('${c.id}')">
        <div class="coll-thumb">
          ${thumb ? `<img src="${esc(thumb)}" alt="">` : '🎬'}
        </div>
        <div class="coll-meta">
          <div class="coll-name">${esc(c.name)}</div>
          <div class="coll-cnt">${videos.length} فیلم</div>
        </div>
        ${c.id === 'asar-unfiled' ? '' : `<div class="coll-del-btn" onclick="event.stopPropagation();deleteColl('${c.id}')" title="حذف مجموعه">🗑</div>`}
        <span class="coll-chev">›</span>
      </div>
      <div class="coll-items" id="coll-items-${c.id}">
        ${videos.map((v, i) => {
          const playing = queueIdx >= 0 && queue[queueIdx]?.path === v.path && activeColl === c.id;
          const wd = state.watchData?.[v.path];
          const isWatched = wd?.watched;
          const rating = wd?.rating || 0;
          const ratingStr = rating ? ' · ' + '★'.repeat(rating) : '';
          return `<div class="movie-row ${playing ? 'playing' : ''}"
              draggable="true"
              ondragstart="movieDragStart(event,'${c.id}',${i})"
              ondragend="endNativeDrag(event)"
              onclick="playVideo('${c.id}',${i})">
            <div class="movie-thumb-sm">
              ${v.poster ? `<img src="${esc(v.poster)}" alt="" draggable="false">` : '🎥'}
            </div>
            <div class="movie-info">
              <div class="movie-name">${esc(v.title || v.fileName)}</div>
              <div class="movie-year">${v.year ? v.year + ' · ' : ''}${v.duration ? fmtTime(v.duration) : ''}${isWatched ? '<span class="wd">✓</span>' : ''}${ratingStr}</div>
            </div>
            <div class="movie-row-actions">
              <div class="movie-del-btn" onclick="event.stopPropagation();removeVideoFromColl('${c.id}',${i})" title="حذف">🗑</div>
              <div class="play-ind">
                <svg width="8" height="8" viewBox="0 0 8 8" fill="#fff"><path d="M2 1.5l4 2.5-4 2.5V1.5z"/></svg>
              </div>
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

function removeVideoFromColl(collId, idx) {
  const c = state.collections.find(c => c.id === collId);
  if (!c) return;
  c.videos.splice(idx, 1);
  saveState();
  renderColls();
}

function deleteColl(id) {
  if (window.asarCollections?.removeNativeFolder(id)) return;
  state.collections = state.collections.filter(c => c.id !== id);
  if (activeColl === id) activeColl = state.collections[0]?.id || null;
  saveState();
  renderColls();
}

// Drag from the visible collection or media row.
function dragNativeFolder(event, id) {
  if (event.target !== event.currentTarget && event.target.closest(".movie-row")) return;
  window.asarCollections?.startNativeFolderDrag(event, id);
  event.currentTarget.classList.add("asar-dragging");
}

function movieDragStart(event, collId, index) {
  const item = state.collections.find(collection => collection.id === collId)?.videos[index];
  if (!item) return;
  event.stopPropagation();
  window.asarCollections?.startDrag(event, "item", item.path, collId);
  event.currentTarget.classList.add("asar-dragging");
}

function endNativeDrag(event) {
  event.currentTarget.classList.remove("asar-dragging");
}

// ── Import ─────────────────────────────────────────────────────────────
async function importFiles() {
  const paths = await window.api.openVideoFiles();
  if (!paths.length) return;
  await addVideosToColl(paths);
}

async function addVideosToColl(paths, destination) {
  let coll = destination || state.collections.find(c => c.id === activeColl);
  if (!coll) {
    if (!state.collections.length) {
      createCollWithName('فیلم‌ها');
      coll = state.collections[0];
    } else {
      coll = state.collections[0];
    }
  }

  const newPaths = [];
  for (const p of paths) {
    if (coll.videos.find(v => v.path === p)) continue;
    const fileName = p.split(/[\\/]/).pop().replace(/\.[^.]+$/, '');
    const { title, year } = parseVideoFileName(fileName);
    coll.videos.push({ path: p, fileName, title, year, poster: null, duration: null });
    newPaths.push({ p, title, year });
  }

  coll.open = true;
  activeColl = coll.id;
  saveState();
  renderColls();
  fetchMetadataForColl(coll);

  // sync to main library
  for (const { p, title, year } of newPaths) {
    if (window.api?.addToLibrary) {
      window.api.addToLibrary({
        id: 'film_' + p.split(/[\\/]/).pop().replace(/\W/g,'').slice(0,14) + '_' + Date.now().toString(36),
        type: 'film', title, creator: '', year: year || '',
        stage: 'queue', rating: 0, cover: null, filePath: p, createdAt: Date.now()
      });
    }
  }
}

function parseVideoFileName(name) {
  // Find year (1900–2099) — everything before it is the title
  const yearMatch = name.match(/\b(19\d{2}|20\d{2})\b/);
  const year = yearMatch ? yearMatch[1] : null;
  let raw = yearMatch ? name.slice(0, yearMatch.index) : name;
  let title = raw
    .replace(/\./g, ' ')
    .replace(/[-_]/g, ' ')
    .replace(/\[.*?\]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Fix spaced-out titles like "L o l i t a" → "Lolita"
  // If 3+ consecutive single-letter tokens exist, collapse them
  title = title.replace(/\b([A-Za-z])((?:\s[A-Za-z]){2,})\b/g, (_, first, rest) => first + rest.replace(/\s/g, ''));
  return { title: title || name, year };
}

function cleanTitle(name) {
  return parseVideoFileName(name).title;
}

async function fetchMetadataForColl(coll) {
  const key = getTmdbKey();
  for (const v of coll.videos) {
    // Skip only if we have a proxied data: URL or confirmed-accessible Deezer CDN URL
    const hasGoodPoster = v.poster && (v.poster.startsWith('data:') || v.poster.includes('dzcdn.net'));
    if (hasGoodPoster) continue;

    let poster = null;

    if (key) {
      const info = await window.api.tmdbSearch(v.title, key).catch(() => null);
      if (info) {
        v.year = v.year || info.release_date?.slice(0, 4) || null;
        v.tmdbId = v.tmdbId || info.id;
        // Fetch details to get imdb_id (used for subtitle search)
        if (!v.imdbId && info.id) {
          const details = await window.api.tmdbDetails(info.id, key).catch(() => null);
          if (details?.imdb_id) v.imdbId = details.imdb_id;
        }
        if (info.poster_path) {
          poster = await window.api.fetchImage(info.poster_path).catch(() => null);
        }
      }
    }

    // Deezer soundtrack fallback
    if (!poster) {
      poster = await window.api.fetchMoviePoster(v.title).catch(() => null);
    }

    if (poster) {
      v.poster = poster;
    } else {
      v.poster = generateCover(v.title || v.fileName || 'Film');
    }
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
  clearSceneFrame();
  const path = video.path.replace(/\\/g, '/');
  vid.src = `file:///${path}`;
  vid.load();

  // restore resume position
  const savedPos = state.resume?.[video.path];
  if (savedPos && savedPos > 10) {
    vid.addEventListener('canplay', function restorePos() {
      vid.removeEventListener('canplay', restorePos);
      if (savedPos < (vid.duration || 0) - 15) {
        vid.currentTime = savedPos;
        showResumeToast(savedPos);
      }
    }, { once: true });
  }

  vid.play();
  addToHistory(video);

  // reset AB loop
  abA = null; abB = null; abActive = false;
  updateABUI();

  // restore speed
  vid.playbackRate = vidSpeed;
  const speedBtn = document.getElementById('vid-speed-btn');
  if (speedBtn) speedBtn.textContent = vidSpeed === 1 ? '1×' : vidSpeed + '×';

  // hide no-track, show meta
  document.getElementById('no-track').classList.add('hidden');
  const metaOverlay = document.getElementById('meta-overlay');
  metaOverlay.classList.add('has-video');

  // update meta overlay
  document.getElementById('meta-title').textContent = video.title || video.fileName;
  renderMetaTags(video);

  // reset subtitles
  ++subtitleSelection;
  _pickerResults = [];
  document.getElementById('sub-picker').style.display = 'none';
  document.getElementById('sub-modal').classList.remove('show');
  subtitles = [];
  hideSubtitle();
  setSubAutoStatus('', '');
  showSubAIBtn(false);

  // load duration later
  currentMovieInfo = video;
  fetchMovieDetails(video);
  autoFetchSubtitle(video);
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

  // A-B loop check
  if (abActive && abA !== null && abB !== null && vid.currentTime >= abB) {
    vid.currentTime = abA;
  }

  // save resume position every 5s
  if (queue[queueIdx] && vid.currentTime > 5) {
    clearTimeout(resumeSaveTimer);
    resumeSaveTimer = setTimeout(() => {
      if (queue[queueIdx]) {
        if (!state.resume) state.resume = {};
        state.resume[queue[queueIdx].path] = vid.currentTime;
        saveState();
      }
    }, 5000);
  }
});

vid.addEventListener('ended', () => {
  if (queue[queueIdx]) {
    addToHistory(queue[queueIdx]);
    if (state.resume) delete state.resume[queue[queueIdx].path];
    saveState();
  }
  nextVideo();
});
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

// ── Claude AI Panel ───────────────────────────────────────────────────
let aiOpen = false, aiHistory = [], aiCtxOn = false;
let sceneFrame = null;
const AI_CTX_LABEL_VID = 'اضافه کردن اطلاعات صحنه';

function getAIKey() { try { return localStorage.getItem('claude-api-key') || ''; } catch { return ''; } }
function saveAIKey() {
  const k = document.getElementById('ai-key-inp').value.trim();
  if (!k) return;
  try { localStorage.setItem('claude-api-key', k); } catch {}
  document.getElementById('ai-key-box').style.display = 'none';
}
function toggleAI() {
  aiOpen = !aiOpen;
  document.getElementById('ai-panel').classList.toggle('open', aiOpen);
  if (aiOpen) {
    updateSceneButton();
    if (!getAIKey()) document.getElementById('ai-key-box').style.display = '';
    setTimeout(() => document.getElementById('ai-textarea')?.focus(), 300);
  }
}
function toggleAICtx() {
  aiCtxOn = !aiCtxOn;
  document.getElementById('ai-ctx-btn').classList.toggle('on', aiCtxOn);
  document.getElementById('ai-ctx-lbl').textContent = aiCtxOn ? 'context اضافه شد ✓' : AI_CTX_LABEL_VID;
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
  const v = queue[queueIdx];
  if (!v) return 'ویدئویی پخش نمیشه.';
  const name = v.path ? v.path.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') : 'Unknown';
  const secs = Math.floor(vid.currentTime);
  const timeStr = `${Math.floor(secs/3600).toString().padStart(2,'0')}:${(Math.floor(secs/60)%60).toString().padStart(2,'0')}:${(secs%60).toString().padStart(2,'0')}`;
  const curSub = subtitles.find(s => vid.currentTime >= s.start && vid.currentTime <= s.end);
  const info = currentMovieInfo ? `\nMovie: ${currentMovieInfo.title} (${currentMovieInfo.release_date?.slice(0,4)||''})\nOverview: ${(currentMovieInfo.overview||'').slice(0,300)}` : '';
  return `Video: "${name}"\nTimestamp: ${timeStr}${info}\nCurrent subtitle: "${curSub?.en || ''}"`;
}
function updateSceneButton() {
  const button = document.getElementById('scene-attach');
  if (!button) return;
  button.disabled = !vid.paused || vid.readyState < 2 || !vid.videoWidth;
}
for (const event of ['pause', 'play', 'loadeddata', 'emptied', 'seeked']) vid.addEventListener(event, updateSceneButton);

function clearSceneFrame() {
  sceneFrame = null;
  document.getElementById('scene-preview').hidden = true;
  document.getElementById('scene-preview-image').removeAttribute('src');
  document.getElementById('scene-status').textContent = 'برای افزودن تصویر، فیلم را مکث کن.';
}

function attachSceneFrame() {
  if (!vid.paused || vid.readyState < 2 || !vid.videoWidth) return;
  const status = document.getElementById('scene-status');
  try {
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 960 / Math.max(vid.videoWidth, vid.videoHeight));
    canvas.width = Math.round(vid.videoWidth * scale);
    canvas.height = Math.round(vid.videoHeight * scale);
    canvas.getContext('2d').drawImage(vid, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', 0.8);
    const t = Math.floor(vid.currentTime);
    const timestamp = [Math.floor(t / 3600), Math.floor(t / 60) % 60, t % 60].map(n => String(n).padStart(2, '0')).join(':');
    sceneFrame = { data: url.split(',')[1], context: getAIContext() };
    document.getElementById('scene-preview-image').src = url;
    document.getElementById('scene-frame-time').textContent = timestamp;
    document.getElementById('scene-preview').hidden = false;
    status.textContent = 'تصویر هنگام ارسال سؤال به سرویس هوش مصنوعی می‌رسد.';
    document.getElementById('ai-textarea').focus();
  } catch {
    status.textContent = 'گرفتن تصویر از این ویدیو ممکن نبود.';
  }
}

async function sendAI() {
  const ta = document.getElementById('ai-textarea');
  const text = ta.value.trim();
  if (!text) return;
  const key = getAIKey();
  if (!key) { document.getElementById('ai-key-box').style.display = ''; return; }
  ta.value = '';
  appendAIMsg('user', text);
  const frame = sceneFrame;
  const content = frame ? '[Frame context]\n' + frame.context + '\n\n[Question]\n' + text : aiCtxOn ? `[Context]\n${getAIContext()}\n\n[Question]\n${text}` : text;
  aiHistory.push({ role: 'user', content });
  if (aiHistory.length > 20) aiHistory = aiHistory.slice(-20);
  const typingDiv = appendAIMsg('bot typing', '...');
  document.getElementById('ai-send-btn').disabled = true;
  try {
    const sys = `You are a helpful AI assistant in a video player app. Help the user understand the movie/show they are watching. Be concise. Match user's language (Persian or English).`;
    const setting = localStorage.getItem('claude-api-provider');
    const provider = setting && setting !== 'auto' ? setting : null;
    const reply = await window.api.claudeChat(sys, aiHistory, key, provider, frame?.data);
    if (frame && frame === sceneFrame) clearSceneFrame();
    typingDiv.classList.remove('typing'); typingDiv.textContent = reply;
    aiHistory.push({ role: 'assistant', content: reply });
    if (aiCtxOn) { aiCtxOn = false; document.getElementById('ai-ctx-btn').classList.remove('on'); document.getElementById('ai-ctx-lbl').textContent = AI_CTX_LABEL_VID; }
  } catch (err) {
    typingDiv.classList.remove('typing'); typingDiv.style.color = 'var(--err)';
    typingDiv.textContent = `خطا: ${String(err.message).slice(0, 200)}`; aiHistory.pop();
  }
  document.getElementById('ai-send-btn').disabled = false;
  document.getElementById('ai-msgs').scrollTop = document.getElementById('ai-msgs').scrollHeight;
}

// click on video area to toggle play (but not on controls)
vid.addEventListener('click', togglePlay);
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    const openModal = document.querySelector('.modal-bg.show,.cmt-modal.show,.newcoll-modal.show,.sub-modal.show');
    if (openModal) { openModal.classList.remove('show'); return; }
    if (aiOpen) { toggleAI(); return; }
    window.api.closeWindow();
    return;
  }
  if (e.code === 'Space' && !e.target.closest('.asar-window-actions')) { e.preventDefault(); togglePlay(); }
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
  const retry = document.getElementById('sub-modal-retry');
  modal.classList.add('show');
  retry.hidden = true;
  status.innerHTML = `<span class="translating">در حال بارگذاری...</span>`;

  const selection = subtitleSelection;
  const raw = await window.api.openSubtitleFile().catch(() => null);
  if (selection !== subtitleSelection) return;
  if (!raw) { modal.classList.remove('show'); return; }

  const parsed = parseSrt(raw);
  if (!parsed.length) {
    status.innerHTML = `<span style="color:var(--err)">فایل زیرنویس ناخوانا بود.</span>`;
    return;
  }

  ++subtitleSelection;
  subtitles = parsed;
  document.getElementById('sub-translate-btn').style.display = 'none';
  updateSubtitle();
  subOffset = 0;
  const offsetBar = document.getElementById('sub-offset-bar');
  const offsetVal = document.getElementById('sub-offset-val');
  if (offsetBar) offsetBar.style.display = 'flex';
  if (offsetVal) offsetVal.textContent = '0.0s';

  await translateLocalSubtitle();
}

async function translateLocalSubtitle() {
  const retry = document.getElementById('sub-modal-retry');
  const status = document.getElementById('sub-status');
  retry.hidden = true;
  const result = await translateSubtitles((message, type) => {
    status.textContent = message;
    status.className = `sub-status ${type || 'translating'}`;
  });
  if (result) retry.hidden = result.complete;
}

function parseSrt(text) {
  if (!text) return [];
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');

  // Auto-detect ASS/SSA format
  if (/^\[Script Info\]/m.test(normalized) || /^Dialogue:/m.test(normalized)) {
    return parseAss(normalized);
  }

  const result = [];
  const blocks = normalized.split(/\n(?:[ \t]*\n)+/);
  const timing = /^\s*((?:\d+:)?\d{2}:\d{2}(?:[,.]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{2}:\d{2}(?:[,.]\d{1,3})?)(?:\s|$)/;

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (/^(WEBVTT|NOTE|STYLE|REGION)(?:\s|$)/.test(lines[0])) continue;
    const i = timing.test(lines[0]) ? 0 : 1;
    const timeMatch = lines[i]?.match(timing);
    if (!timeMatch) continue;

    const start = parseSrtTime(timeMatch[1]);
    const end = parseSrtTime(timeMatch[2]);
    const en = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!en) continue;

    result.push({ start, end, en, fa: '' });
  }
  return result;
}

function parseAss(text) {
  const result = [];
  const lines = text.split('\n');
  let fmtIdx = { start: -1, end: -1, text: -1 };
  for (const line of lines) {
    const ltr = line.trim();
    if (ltr.startsWith('Format:') && fmtIdx.start === -1) {
      const cols = ltr.replace('Format:', '').split(',').map(s => s.trim().toLowerCase());
      fmtIdx = { start: cols.indexOf('start'), end: cols.indexOf('end'), text: cols.indexOf('text') };
    } else if (ltr.startsWith('Dialogue:') && fmtIdx.start >= 0) {
      const vals = ltr.replace('Dialogue:', '').split(',');
      const startStr = vals[fmtIdx.start]?.trim();
      const endStr   = vals[fmtIdx.end]?.trim();
      const textPart = vals.slice(fmtIdx.text).join(',').replace(/\{[^}]+\}/g, '').replace(/\\N/gi, ' ').trim();
      if (!startStr || !endStr || !textPart) continue;
      const start = parseAssTime(startStr);
      const end   = parseAssTime(endStr);
      if (start < 0 || !textPart) continue;
      result.push({ start, end, en: textPart, fa: '' });
    }
  }
  return result;
}

function parseAssTime(t) {
  const m = t.match(/(\d+):(\d{2}):(\d{2})[.,](\d+)/);
  if (!m) return -1;
  return parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 100;
}

function parseSrtTime(t) {
  return t.replace(',', '.').split(':').reduce((seconds, part) => seconds * 60 + Number(part), 0);
}

async function translateSubtitles(report) {
  const track = subtitles;
  const selection = subtitleSelection;
  if (!track.length || translatingTrack === track) return;
  translatingTrack = track;
  const pending = track.filter(cue => !cue.fa);
  let translated = track.length - pending.length;
  let emptyBatches = 0;
  const progress = () => report(`در حال ترجمه · ${translated} از ${track.length} خط`, '');

  try {
    progress();
    for (let index = 0; index < pending.length && emptyBatches < 2;) {
      const batch = [];
      let querySize = 0;
      while (index < pending.length && batch.length < 32) {
        const cue = pending[index];
        const size = new URLSearchParams({ q: cue.en }).toString().length + 1;
        if (batch.length && querySize + size > 3400) break;
        batch.push(cue);
        querySize += size;
        index++;
      }

      const result = await window.api.subtitleTranslate(batch.map(cue => cue.en)).catch(() => null);
      if (track !== subtitles || selection !== subtitleSelection) return;
      const before = translated;
      if (result?.length === batch.length) {
        batch.forEach((cue, index) => {
          if (!result[index]) return;
          cue.fa = result[index];
          translated++;
        });
      }
      emptyBatches = translated === before ? emptyBatches + 1 : 0;
      if (translated && subMode === 'en') setSubMode(document.querySelector('.stab[data-mode="both"]'), 'both');
      updateSubtitle();
      progress();
    }

    const complete = translated === track.length;
    report(complete ? '✓ ترجمه کامل شد' : `ترجمه ناقص ماند · ${translated} از ${track.length} خط`, complete ? 'done' : 'error');
    return { complete };
  } finally {
    if (translatingTrack === track) translatingTrack = null;
  }
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
  faLine.textContent = sub.fa || '';

  enLine.style.display = (subMode === 'en' || subMode === 'both') ? 'inline-block' : 'none';
  // Hide FA line if translation isn't available (empty string) rather than showing "..."
  faLine.style.display = (subMode === 'fa' || subMode === 'both') && sub.fa ? 'inline-block' : 'none';
}

function hideSubtitle() {
  document.getElementById('sub-display').classList.add('hidden');
}

function setSubMode(btn, mode) {
  subMode = mode;
  document.querySelectorAll('.stab').forEach(b => b.classList.remove('on'));
  btn?.classList.add('on');
  updateSubtitle();
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

  renderWatchRow(video);

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

// ── A-B Loop ───────────────────────────────────────────────────────────
function setAbA() {
  abA = vid.currentTime;
  abB = null;
  abActive = false;
  updateABUI();
}

function setAbB() {
  if (abA === null) { setAbA(); return; }
  abB = vid.currentTime;
  if (abB <= abA) { const t = abA; abA = abB; abB = t; }
  abActive = true;
  updateABUI();
}

function clearAb() {
  abA = null; abB = null; abActive = false;
  updateABUI();
}

function updateABUI() {
  const btnA = document.getElementById('ab-a-btn');
  const btnB = document.getElementById('ab-b-btn');
  if (!btnA || !btnB) return;
  btnA.classList.toggle('set', abA !== null);
  btnB.classList.toggle('set', abB !== null);
  btnA.classList.toggle('active', abActive);
  btnB.classList.toggle('active', abActive);
  btnA.title = abA !== null ? `A: ${fmtTime(abA)} (کلیک = ریست)` : 'نقطه شروع A-B Loop';
  btnB.title = abB !== null ? `B: ${fmtTime(abB)} (کلیک = ریست)` : 'نقطه پایان A-B Loop';
  if (abActive) {
    btnA.onclick = clearAb;
    btnB.onclick = clearAb;
  } else {
    btnA.onclick = setAbA;
    btnB.onclick = setAbB;
  }
}

// ── Speed ──────────────────────────────────────────────────────────────
function cycleVidSpeed() {
  const cur = VID_SPEED_OPTS.indexOf(vidSpeed);
  vidSpeed = VID_SPEED_OPTS[(cur + 1) % VID_SPEED_OPTS.length];
  vid.playbackRate = vidSpeed;
  const btn = document.getElementById('vid-speed-btn');
  if (btn) {
    btn.textContent = vidSpeed === 1 ? '1×' : vidSpeed + '×';
    btn.classList.toggle('on', vidSpeed !== 1.0);
  }
}

// ── Resume toast ───────────────────────────────────────────────────────
let resumeToastTimer = null;
function showResumeToast(pos) {
  const toast = document.getElementById('resume-toast');
  if (!toast) return;
  toast.textContent = `ادامه از ${fmtTime(pos)} ⏩`;
  toast.classList.add('show');
  clearTimeout(resumeToastTimer);
  resumeToastTimer = setTimeout(() => toast.classList.remove('show'), 4000);
}

// ── Watch status & rating ──────────────────────────────────────────────
function getWatchData(path) {
  if (!state.watchData) state.watchData = {};
  if (!state.watchData[path]) state.watchData[path] = { watched: false, rating: 0 };
  return state.watchData[path];
}

function toggleWatched() {
  const video = queue[queueIdx];
  if (!video) return;
  const wd = getWatchData(video.path);
  wd.watched = !wd.watched;
  saveState();
  renderColls();
  renderWatchRow(video);
}

function setVideoRating(n) {
  const video = queue[queueIdx];
  if (!video) return;
  const wd = getWatchData(video.path);
  wd.rating = wd.rating === n ? 0 : n;
  saveState();
  renderColls();
  renderWatchRow(video);
  // sync to community
  if (typeof writeCommunityRating === 'function') {
    writeCommunityRating('film', video.title || video.path.split(/[\\/]/).pop(), video.poster || '', wd.rating || 0, video.year || '');
  }
  initFirebase();
}

function renderWatchRow(video) {
  const el = document.getElementById('watch-row');
  if (!el || !video) return;
  const wd = getWatchData(video.path);
  const stars = [1,2,3,4,5].map(n =>
    `<span class="star ${wd.rating >= n ? 'on' : ''}" onclick="setVideoRating(${n})">★</span>`
  ).join('');
  el.innerHTML = `
    <div class="watch-row">
      <button class="watched-toggle ${wd.watched ? 'on' : ''}" onclick="toggleWatched()">
        ${wd.watched ? '✓ دیده شد' : '○ دیده نشده'}
      </button>
      <div class="star-row">${stars}</div>
    </div>`;
}

// ── Picture-in-Picture ─────────────────────────────────────────────────
async function togglePiP() {
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      await vid.requestPictureInPicture();
    }
  } catch {}
}

// ── Watch History ──────────────────────────────────────────────────────
const HIST_KEY = 'video-history';
function loadHistory() {
  try { return JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem(HIST_KEY, JSON.stringify(h.slice(0, 100))); } catch {}
}
function addToHistory(video) {
  if (!video?.path) return;
  const h = loadHistory().filter(x => x.path !== video.path);
  h.unshift({ path: video.path, title: video.title || video.fileName, poster: video.poster || '', date: Date.now() });
  saveHistory(h);
}
function showHistory() {
  const modal = document.getElementById('hist-modal');
  const list = document.getElementById('hist-list');
  if (!modal || !list) return;
  const h = loadHistory();
  if (!h.length) {
    list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--t3)">هنوز فیلمی تماشا نکردی.</div>';
  } else {
    list.innerHTML = h.map((item, i) => {
      const d = new Date(item.date);
      const dateStr = `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
      const thumb = item.poster ? `<img src="${esc(item.poster)}" style="width:60px;height:38px;object-fit:cover;border-radius:4px;flex-shrink:0">` : `<div style="width:60px;height:38px;background:var(--glass);border-radius:4px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:18px">🎬</div>`;
      return `<div class="hist-item" onclick="playHistoryItem(${i})">
        ${thumb}
        <div class="hist-info">
          <div class="hist-title-txt">${esc(item.title || item.path.split(/[\\/]/).pop())}</div>
          <div class="hist-date">${dateStr}</div>
        </div>
      </div>`;
    }).join('');
  }
  modal.classList.add('show');
}
function closeHistory() {
  document.getElementById('hist-modal')?.classList.remove('show');
}
function playHistoryItem(idx) {
  const h = loadHistory();
  const item = h[idx];
  if (!item) return;
  closeHistory();
  const coll = state.collections.find(c => c.movies?.some(m => m.path === item.path));
  if (coll) {
    const vidIdx = coll.movies.findIndex(m => m.path === item.path);
    if (vidIdx >= 0) {
      selectColl(coll.id);
      loadVideo(coll.movies[vidIdx]);
    }
  }
}

// ── Thumbnail Preview ──────────────────────────────────────────────────
let thumbCanvas, thumbCtx, thumbPreview, thumbTimeEl;
let thumbHidden; // hidden video element for frame capture
function initThumbPreview() {
  thumbCanvas = document.getElementById('thumb-canvas');
  thumbCtx = thumbCanvas?.getContext('2d');
  thumbPreview = document.getElementById('thumb-preview');
  thumbTimeEl = document.getElementById('thumb-time-lbl');
  const progTrack = document.getElementById('prog-track');
  if (!progTrack) return;
  progTrack.addEventListener('mousemove', onProgMouseMove);
  progTrack.addEventListener('mouseleave', () => {
    if (thumbPreview) thumbPreview.classList.remove('show');
  });
}
let thumbReqTimer = null;
function onProgMouseMove(e) {
  if (!vid.duration || !thumbPreview) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const hoverTime = pct * vid.duration;
  // position preview above cursor
  const previewW = 164;
  let left = e.clientX - rect.left;
  left = Math.max(previewW/2, Math.min(rect.width - previewW/2, left));
  thumbPreview.style.left = left + 'px';
  thumbPreview.classList.add('show');
  if (thumbTimeEl) thumbTimeEl.textContent = fmtTime(hoverTime);
  // throttle frame capture
  clearTimeout(thumbReqTimer);
  thumbReqTimer = setTimeout(() => captureThumbAt(hoverTime), 120);
}
function captureThumbAt(t) {
  if (!thumbCtx || !vid.src) return;
  // use a hidden video clone for seeking without disturbing main playback
  if (!thumbHidden) {
    thumbHidden = document.createElement('video');
    thumbHidden.style.display = 'none';
    thumbHidden.muted = true;
    thumbHidden.preload = 'metadata';
    document.body.appendChild(thumbHidden);
  }
  if (thumbHidden.src !== vid.src) {
    thumbHidden.src = vid.src;
    thumbHidden.load();
  }
  thumbHidden.currentTime = t;
  thumbHidden.onseeked = () => {
    try { thumbCtx.drawImage(thumbHidden, 0, 0, 160, 90); } catch {}
  };
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
initThumbPreview();

// show TMDB banner if no key and there are collections
if (!getTmdbKey() && state.collections.length > 0) {
  setTimeout(() => document.getElementById('setup-banner').classList.add('show'), 1000);
}

// Startup: immediately generate placeholders for videos with no poster at all
(function() {
  let changed = false;
  for (const coll of state.collections) {
    for (const v of (coll.videos || [])) {
      if (!v.poster) { v.poster = generateCover(v.title || v.fileName || 'Film'); changed = true; }
    }
  }
  if (changed) { saveState(); renderColls(); }
})();

// Then fetch real covers in background (overwrites placeholders if found)
setTimeout(() => {
  for (const coll of state.collections) {
    const needsCover = coll.videos?.some(v => !v.poster || (!v.poster.startsWith('data:') && !v.poster.includes('dzcdn.net')));
    if (needsCover) fetchMetadataForColl(coll);
  }
}, 500);

initFirebase();

// receive open-file request from main library
if (window.api?.onOpenFile) {
  window.api.onOpenFile(function(filePath) {
    let found = null;
    for (const coll of state.collections) {
      const v = coll.videos.find(v => v.path === filePath);
      if (v) { found = { coll, v }; break; }
    }
    if (found) {
      const idx = found.coll.videos.indexOf(found.v);
      playVideo(found.coll.id, idx);
    } else {
      addVideosToColl([filePath]).then(() => {
        for (const coll of state.collections) {
          const idx = coll.videos.findIndex(v => v.path === filePath);
          if (idx >= 0) { playVideo(coll.id, idx); break; }
        }
      });
    }
  });
}

window.asarCollectionSource = {
  items: () => state.collections.flatMap(entry => entry.videos.map(video => ({ id: video.path, title: video.title || video.fileName }))),
  open: id => { const coll = state.collections.find(entry => entry.videos.some(item => item.path === id)); if (coll) playVideo(coll.id, coll.videos.findIndex(item => item.path === id)); },
  fileType: /\.(mp4|mkv|avi|mov|webm|m4v|wmv|flv|ts|mpg|mpeg)$/i,
  importFiles: (paths, folder) => addVideosToColl(paths, AsarCollections.ensureNative(state.collections, 'videos', folder)),
  changed() {
    if (!state.collections.some(collection => collection.id === activeColl)) activeColl = state.collections[0]?.id || null;
    saveState();
    renderColls();
  },
  redraw: renderColls,
  legacy: { list: () => state.collections, field: 'videos' }
};
