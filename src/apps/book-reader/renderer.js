// ── pdf.js setup ───────────────────────────────────────────────────────
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ── State ──────────────────────────────────────────────────────────────
const DATA_KEY = 'book-reader';
let state = loadState();
let pdfDoc = null;
let currentPage = 1;
let totalPages = 0;
let currentBookPath = null;
let readMode = 'original';   // 'original' | 'both' | 'persian'
let fontSize = 18;
let activeTab = 0;
let translating = false;
let translationAborted = false;
let pendingHighlight = null;  // {text, page, color}
let pendingRectAnnot = null;
let currentRectColor = 'y';
let activeRectPreview = null;
let zoomLevel = 1.0;
let srchMatches = [];
let srchIdx = 0;

// ── Persistence ────────────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { books: [], bookmarks: [], highlights: [], rectAnnotations: [] };
}

function saveState() {
  try { localStorage.setItem(DATA_KEY, JSON.stringify(state)); } catch {}
}

function getTransCache(path, page) {
  try { return localStorage.getItem(`trans_${btoa(path)}_${page}`) || null; } catch { return null; }
}

function setTransCache(path, page, text) {
  try { localStorage.setItem(`trans_${btoa(path)}_${page}`, text); } catch {}
}

function allPagesTranslated(path, total) {
  for (let i = 1; i <= total; i++) {
    if (!getTransCache(path, i)) return false;
  }
  return true;
}

// ── Library ────────────────────────────────────────────────────────────
function renderLibrary() {
  const el = document.getElementById('library-list');
  if (!state.books.length) {
    el.innerHTML = `<div class="empty-lib">
      <p>کتابخانه خالیه.<br>یه PDF اضافه کن.</p>
      <div class="icon-btn accent" style="width:auto;padding:8px 16px;border-radius:10px;font-family:'Space Grotesk',sans-serif;font-size:12.5px;display:flex;gap:6px;margin:0 auto" onclick="importPdf()">
        + افزودن PDF
      </div>
    </div>`;
    return;
  }

  el.innerHTML = state.books.map(b => {
    const isActive = b.path === currentBookPath;
    const pct = b.totalPages ? Math.round(((b.lastPage || 1) / b.totalPages) * 100) : 0;
    return `<div class="book-item ${isActive ? 'active' : ''}" onclick="openBook('${esc(b.path)}')">
      <div class="book-cover">${b.cover ? `<img src="${esc(b.cover)}" alt="">` : '📖'}</div>
      <div class="book-meta">
        <div class="book-title">${esc(b.title)}</div>
        ${b.author ? `<div class="book-author">${esc(b.author)}</div>` : ''}
        <div class="book-prog"><div class="book-prog-fill" style="width:${pct}%"></div></div>
      </div>
    </div>`;
  }).join('');
}

async function importPdf() {
  const paths = await window.api.openPdfFiles();
  if (!paths.length) return;
  const newPaths = [];
  for (const p of paths) {
    if (state.books.find(b => b.path === p)) continue;
    const fileName = p.split(/[\\/]/).pop().replace(/\.pdf$/i, '');
    state.books.push({ path: p, title: fileName, author: '', totalPages: 0, lastPage: 1, cover: null });
    newPaths.push(p);
  }
  saveState();
  renderLibrary();
  if (paths.length === 1) openBook(paths[0]);
  // fetch covers in background
  for (const p of newPaths) fetchAndSaveBookMeta(p);
}

async function fetchAndSaveBookMeta(path) {
  const book = state.books.find(b => b.path === path);
  if (!book || book.cover) return;
  try {
    const meta = await window.api.fetchBookMeta(book.title);
    if (!meta) return;
    if (meta.cover)   book.cover  = meta.cover;
    if (meta.authors?.length) book.author = meta.authors[0];
    if (meta.title)   book.title  = meta.title;
    if (meta.description) book.description = meta.description;
    if (meta.publishedDate) book.year = meta.publishedDate.slice(0, 4);
    saveState();
    renderLibrary();
    // update title bar if this is the open book
    if (path === currentBookPath) {
      document.getElementById('book-name-tb').textContent = book.title;
    }
  } catch {}
}

async function openBook(path) {
  const book = state.books.find(b => b.path === path);
  if (!book) return;

  currentBookPath = path;
  renderLibrary();

  // load PDF
  document.getElementById('no-book').style.display = 'none';
  document.getElementById('pdf-container').style.display = 'block';
  document.getElementById('pdf-container').innerHTML = `<div class="spinner"></div>`;

  try {
    const buf = await window.api.readFileBuffer(path);
    pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
    totalPages = pdfDoc.numPages;

    book.totalPages = totalPages;
    saveState();

    document.getElementById('page-total').textContent = `/ ${totalPages}`;
    document.getElementById('btn-prev').disabled = false;
    document.getElementById('btn-next').disabled = false;

    // restore last page
    currentPage = book.lastPage || 1;
    document.getElementById('book-name-tb').textContent = book.title;

    // load TOC
    loadToc();

    await renderCurrentPage();
    updateNav();
    checkTranslateBtn();
  } catch (e) {
    document.getElementById('pdf-container').innerHTML =
      `<div style="color:var(--err);text-align:center;padding:40px;direction:rtl">خطا در بارگذاری PDF: ${esc(String(e.message))}</div>`;
  }
}

// ── TOC ────────────────────────────────────────────────────────────────
async function loadToc() {
  if (!pdfDoc) return;
  try {
    const outline = await pdfDoc.getOutline();
    if (!outline || !outline.length) {
      if (activeTab === 0) renderTocPanel([]);
      return;
    }
    if (activeTab === 0) renderTocPanel(outline);
  } catch {}
}

function renderTocPanel(outline) {
  const body = document.getElementById('panel-body');
  if (!outline.length) {
    body.innerHTML = `<div class="empty-panel">فهرستی پیدا نشد</div>`;
    return;
  }

  function buildItems(items, depth = 0) {
    return items.map(item => {
      const sub = depth > 0 ? 'toc-sub' : '';
      const dest = item.dest ? JSON.stringify(item.dest) : 'null';
      return `<div class="toc-item ${sub}" onclick="tocGo(${JSON.stringify(item.dest)})">
        <div class="toc-dot"></div>
        <span class="toc-label">${esc(item.title)}</span>
      </div>
      ${item.items?.length ? buildItems(item.items, depth + 1) : ''}`;
    }).join('');
  }

  body.innerHTML = `<div style="padding-top:6px">${buildItems(outline)}</div>`;
}

async function tocGo(dest) {
  if (!dest || !pdfDoc) return;
  try {
    let page;
    if (typeof dest === 'string') {
      const d = await pdfDoc.getDestination(dest);
      const ref = await pdfDoc.getPageIndex(d[0]);
      page = ref + 1;
    } else if (Array.isArray(dest)) {
      const ref = await pdfDoc.getPageIndex(dest[0]);
      page = ref + 1;
    }
    if (page) goToPage(page);
  } catch {}
}

// ── Rendering ──────────────────────────────────────────────────────────
async function renderCurrentPage() {
  if (!pdfDoc) return;
  const container = document.getElementById('pdf-container');

  if (readMode === 'original') {
    await renderPdfCanvas(container);
  } else {
    await renderTextMode(container);
  }

  updateNav();
  updateProgress();
  renderHighlightsPanel();

  // save last page
  const book = state.books.find(b => b.path === currentBookPath);
  if (book) { book.lastPage = currentPage; saveState(); }
}

async function renderPdfCanvas(container) {
  container.innerHTML = `<div class="spinner"></div>`;
  try {
    const page = await pdfDoc.getPage(currentPage);
    const scale = ((container.clientWidth - 40) / page.getViewport({ scale: 1 }).width) * zoomLevel;
    const viewport = page.getViewport({ scale });

    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-wrap';
    wrap.style.width = viewport.width + 'px';

    // canvas
    const canvas = document.createElement('canvas');
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    wrap.appendChild(canvas);

    // text layer (enables selection & highlight)
    const textLayerDiv = document.createElement('div');
    textLayerDiv.className = 'textLayer';
    textLayerDiv.style.width  = viewport.width  + 'px';
    textLayerDiv.style.height = viewport.height + 'px';
    wrap.appendChild(textLayerDiv);

    // annotation layer (rect marks)
    const annotLayer = document.createElement('div');
    annotLayer.className = 'annot-layer';
    wrap.appendChild(annotLayer);

    container.innerHTML = '';
    container.appendChild(wrap);
    container.appendChild(makePageNum());

    // render canvas
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;

    // render text layer
    const textContent = await page.getTextContent();
    await pdfjsLib.renderTextLayer({
      textContent,
      container: textLayerDiv,
      viewport,
      textDivs: []
    }).promise;

    // render saved rect annotations
    renderRectAnnotations(annotLayer, viewport);

    wrap.addEventListener('mouseup', onTextSelect);
    wrap.addEventListener('contextmenu', e => e.preventDefault());
    wrap.addEventListener('mousedown', e => {
      if (e.button === 2) startRectDraw(e, wrap, annotLayer, viewport);
    });
  } catch (e) {
    container.innerHTML = `<div style="color:var(--err);padding:20px;text-align:center">خطا: ${esc(String(e.message))}</div>`;
  }
}

async function renderTextMode(container) {
  container.innerHTML = `<div class="spinner"></div>`;
  try {
    const page = await pdfDoc.getPage(currentPage);
    const textContent = await page.getTextContent();
    const rawText = textContent.items.map(i => i.str).join(' ').trim();

    // group into paragraphs (split on double space / sentence boundaries)
    const paragraphs = splitIntoParagraphs(rawText);

    const faCache = getTransCache(currentBookPath, currentPage);
    const faParagraphs = faCache ? splitIntoParagraphs(faCache) : null;

    const wrap = document.createElement('div');
    wrap.className = 'text-page';
    wrap.style.fontSize = fontSize + 'px';

    paragraphs.forEach((para, i) => {
      if (!para.trim()) return;
      const p = document.createElement('p');
      p.textContent = para;
      applyHighlightsToElement(p, para);
      wrap.appendChild(p);

      if (readMode === 'both') {
        if (faParagraphs && faParagraphs[i]) {
          const pFa = document.createElement('p');
          pFa.className = 'para-fa';
          pFa.textContent = faParagraphs[i];
          wrap.appendChild(pFa);
        } else {
          const pFa = document.createElement('p');
          pFa.className = 'para-fa translating-note';
          pFa.textContent = getTransCache(currentBookPath, currentPage)
            ? '...' : 'ترجمه نشده — دکمه "ترجمه کل کتاب" رو بزن';
          wrap.appendChild(pFa);
        }
      }
    });

    if (readMode === 'persian') {
      wrap.innerHTML = '';
      if (faParagraphs) {
        faParagraphs.forEach(para => {
          if (!para.trim()) return;
          const p = document.createElement('p');
          p.className = 'para-fa';
          p.style.color = 'var(--page-fg)';
          p.style.fontSize = fontSize + 'px';
          p.textContent = para;
          wrap.appendChild(p);
        });
      } else {
        const note = document.createElement('p');
        note.className = 'translating-note';
        note.style.textAlign = 'center';
        note.style.padding = '40px 0';
        note.textContent = 'این صفحه هنوز ترجمه نشده. دکمه "ترجمه کل کتاب" رو بزن.';
        wrap.appendChild(note);
      }
    }

    container.innerHTML = '';
    container.appendChild(wrap);
    container.appendChild(makePageNum());

    // text selection for highlights
    wrap.addEventListener('mouseup', onTextSelect);
  } catch (e) {
    container.innerHTML = `<div style="color:var(--err);padding:20px;text-align:center">خطا: ${esc(String(e.message))}</div>`;
  }
}

function makePageNum() {
  const d = document.createElement('div');
  d.className = 'page-num-line';
  d.textContent = `صفحه ${currentPage} از ${totalPages}`;
  return d;
}

function splitIntoParagraphs(text) {
  // try to split on double spaces or sentence-like boundaries
  return text
    .replace(/  +/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

// ── Text selection & highlights ────────────────────────────────────────
let selectionText = '';
let selectionRange = null;

function onTextSelect() {
  const sel = window.getSelection();
  const text = sel?.toString().trim();
  if (!text || text.length < 5) {
    hideHlTooltip();
    return;
  }
  selectionText = text;
  selectionRange = sel.getRangeAt(0).cloneRange();
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  showHlTooltip(rect.left + rect.width / 2, rect.top - 8);
}

function showHlTooltip(x, y) {
  const tip = document.getElementById('hl-tooltip');
  tip.style.display = 'flex';
  tip.style.left = Math.max(10, x - 70) + 'px';
  tip.style.top = (y - 46) + 'px';
}

function hideHlTooltip() {
  document.getElementById('hl-tooltip').style.display = 'none';
}

document.addEventListener('mousedown', e => {
  if (!e.target.closest('#hl-tooltip') && !e.target.closest('.text-page') && !e.target.closest('.textLayer')) {
    hideHlTooltip();
  }
  if (!e.target.closest('#rect-popup') && !e.target.closest('.rect-annot')) {
    cancelRectAnnot();
    document.getElementById('rect-edit-popup')?.remove();
  }
});

function applyHighlight(color) {
  if (!selectionText) return;
  pendingHighlight = { text: selectionText, page: currentPage, color, note: '' };
  hideHlTooltip();
  saveHighlight(pendingHighlight);
  renderCurrentPage();
}

function openHlNote() {
  if (!selectionText) return;
  pendingHighlight = { text: selectionText, page: currentPage, color: 'y', note: '' };
  document.getElementById('hl-selected-preview').textContent = selectionText.slice(0, 200);
  document.getElementById('hl-note-text').value = '';
  document.getElementById('hl-note-modal').classList.add('show');
  hideHlTooltip();
  setTimeout(() => document.getElementById('hl-note-text').focus(), 100);
}

function closeHlNote() {
  document.getElementById('hl-note-modal').classList.remove('show');
}

function saveHlWithNote() {
  if (!pendingHighlight) return;
  pendingHighlight.note = document.getElementById('hl-note-text').value.trim();
  saveHighlight(pendingHighlight);
  closeHlNote();
  renderCurrentPage();
}

function saveHighlight(hl) {
  if (!state.highlights) state.highlights = [];
  state.highlights.push({ ...hl, path: currentBookPath, id: 'hl' + Date.now() });
  saveState();
  if (activeTab === 2) renderHighlightsPanel();
}

function applyHighlightsToElement(el, text) {
  const pageHls = (state.highlights || []).filter(h => h.path === currentBookPath && h.page === currentPage);
  if (!pageHls.length) return;

  let html = esc(text);
  pageHls.forEach(h => {
    const escaped = esc(h.text);
    if (html.includes(escaped)) {
      html = html.replace(escaped, `<span class="hl-${h.color}">${escaped}</span>`);
    }
  });
  el.innerHTML = html;
}

// ── Zoom ───────────────────────────────────────────────────────────────
function adjustZoom(delta) {
  zoomLevel = Math.max(0.5, Math.min(3.0, zoomLevel + delta));
  document.getElementById('zoom-val').textContent = Math.round(zoomLevel * 100) + '%';
  if (pdfDoc && readMode === 'original') renderCurrentPage();
}

// ── PDF Search ─────────────────────────────────────────────────────────
function openPdfSearch() {
  document.getElementById('pdf-search-bar').classList.add('show');
  document.getElementById('pdf-search-inp').focus();
}

function closePdfSearch() {
  document.getElementById('pdf-search-bar').classList.remove('show');
  document.getElementById('pdf-search-inp').value = '';
  clearSrch();
}

function clearSrch() {
  document.querySelectorAll('.textLayer .srch-match,.textLayer .srch-cur')
    .forEach(el => el.classList.remove('srch-match','srch-cur'));
  srchMatches = []; srchIdx = 0;
  document.getElementById('pdf-search-info').textContent = '';
}

function onPdfSearch(q) {
  clearSrch();
  if (!q.trim()) return;
  const ql = q.toLowerCase();
  document.querySelectorAll('.textLayer span').forEach(sp => {
    if (sp.textContent.toLowerCase().includes(ql)) {
      sp.classList.add('srch-match');
      srchMatches.push(sp);
    }
  });
  if (srchMatches.length) {
    srchIdx = 0;
    srchMatches[0].classList.add('srch-cur');
    srchMatches[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  updateSrchInfo();
}

function pdfSearchNav(dir) {
  if (!srchMatches.length) return;
  srchMatches[srchIdx].classList.remove('srch-cur');
  srchIdx = (srchIdx + dir + srchMatches.length) % srchMatches.length;
  srchMatches[srchIdx].classList.add('srch-cur');
  srchMatches[srchIdx].scrollIntoView({ block: 'center', behavior: 'smooth' });
  updateSrchInfo();
}

function updateSrchInfo() {
  const inp = document.getElementById('pdf-search-inp').value;
  document.getElementById('pdf-search-info').textContent =
    srchMatches.length ? `${srchIdx + 1} / ${srchMatches.length}` : (inp ? 'نتیجه‌ای نیافت' : '');
}

function onPdfSearchKey(e) {
  if (e.key === 'Enter') { e.shiftKey ? pdfSearchNav(-1) : pdfSearchNav(1); }
  if (e.key === 'Escape') closePdfSearch();
}

// ── Rect Annotations ───────────────────────────────────────────────────
const RECT_COLORS = {
  y: { border: 'rgba(255,214,0,.85)',   bg: 'rgba(255,214,0,.18)' },
  b: { border: 'rgba(100,180,255,.85)', bg: 'rgba(100,180,255,.16)' },
  g: { border: 'rgba(80,210,160,.85)',  bg: 'rgba(80,210,160,.16)' },
  r: { border: 'rgba(255,100,120,.85)', bg: 'rgba(255,100,120,.16)' },
};

function renderRectAnnotations(annotLayer, viewport) {
  annotLayer.innerHTML = '';
  if (!state.rectAnnotations) state.rectAnnotations = [];
  const annots = state.rectAnnotations.filter(a =>
    a.path === currentBookPath && a.page === currentPage
  );
  annots.forEach(a => {
    const col = RECT_COLORS[a.color] || RECT_COLORS.y;
    const div = document.createElement('div');
    div.className = 'rect-annot' + (a.note ? ' has-note' : '');
    div.style.left        = (a.nx * viewport.width)  + 'px';
    div.style.top         = (a.ny * viewport.height) + 'px';
    div.style.width       = (a.nw * viewport.width)  + 'px';
    div.style.height      = (a.nh * viewport.height) + 'px';
    div.style.borderColor = col.border;
    div.style.background  = col.bg;
    if (a.note) div.title = a.note;
    div.addEventListener('click', e => { e.stopPropagation(); editRectAnnot(a.id, e); });
    annotLayer.appendChild(div);
  });
}

function startRectDraw(e, wrap, annotLayer, viewport) {
  e.preventDefault();
  const wrapRect = wrap.getBoundingClientRect();
  const startX = e.clientX - wrapRect.left;
  const startY = e.clientY - wrapRect.top;

  if (activeRectPreview) activeRectPreview.remove();
  activeRectPreview = document.createElement('div');
  activeRectPreview.className = 'rect-preview';
  wrap.appendChild(activeRectPreview);

  function onMove(ev) {
    const cx = ev.clientX - wrapRect.left;
    const cy = ev.clientY - wrapRect.top;
    const x = Math.min(startX, cx), y = Math.min(startY, cy);
    const w = Math.abs(cx - startX), h = Math.abs(cy - startY);
    activeRectPreview.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
  }

  function onUp(ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    const cx = ev.clientX - wrapRect.left;
    const cy = ev.clientY - wrapRect.top;
    const px = Math.min(startX, cx), py = Math.min(startY, cy);
    const pw = Math.abs(cx - startX), ph = Math.abs(cy - startY);
    if (activeRectPreview) { activeRectPreview.remove(); activeRectPreview = null; }
    if (pw < 10 || ph < 10) return;
    const nx = Math.max(0, px / viewport.width);
    const ny = Math.max(0, py / viewport.height);
    const nw = Math.min(1 - nx, pw / viewport.width);
    const nh = Math.min(1 - ny, ph / viewport.height);
    pendingRectAnnot = { nx, ny, nw, nh, page: currentPage, color: currentRectColor };
    showRectPopup(ev.clientX, ev.clientY);
  }

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function showRectPopup(x, y) {
  currentRectColor = 'y';
  document.querySelectorAll('.rect-color-btn').forEach((b, i) => b.classList.toggle('on', i === 0));
  document.getElementById('rect-popup-note').value = '';
  const popup = document.getElementById('rect-popup');
  const left = Math.min(x + 12, window.innerWidth - 276);
  const top  = Math.min(y + 12, window.innerHeight - 200);
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
  popup.classList.add('show');
  setTimeout(() => document.getElementById('rect-popup-note').focus(), 80);
}

function selectRectColor(color, btn) {
  currentRectColor = color;
  if (pendingRectAnnot) pendingRectAnnot.color = color;
  document.querySelectorAll('.rect-color-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

function saveRectAnnot() {
  if (!pendingRectAnnot) return;
  if (!state.rectAnnotations) state.rectAnnotations = [];
  const note = document.getElementById('rect-popup-note').value.trim();
  state.rectAnnotations.push({
    ...pendingRectAnnot,
    path: currentBookPath,
    note,
    id: 'ra' + Date.now(),
    color: currentRectColor,
  });
  saveState();
  cancelRectAnnot();
  renderCurrentPage();
  if (activeTab === 2) renderHighlightsPanel();
}

function cancelRectAnnot() {
  pendingRectAnnot = null;
  document.getElementById('rect-popup').classList.remove('show');
}

function editRectAnnot(id, e) {
  document.getElementById('rect-edit-popup')?.remove();
  const annot = (state.rectAnnotations || []).find(a => a.id === id);
  if (!annot) return;
  const div = document.createElement('div');
  div.id = 'rect-edit-popup';
  div.className = 'rect-popup show';
  const left = e ? Math.min(e.clientX + 12, window.innerWidth - 276) : 200;
  const top  = e ? Math.min(e.clientY + 12, window.innerHeight - 180) : 200;
  div.style.left = left + 'px';
  div.style.top  = top  + 'px';
  div.innerHTML = `
    <div class="rect-popup-title">ویرایش مارک</div>
    <textarea class="rect-popup-note" id="rect-edit-note" placeholder="یادداشت...">${esc(annot.note || '')}</textarea>
    <div class="rect-popup-actions">
      <button class="btn-cancel" style="background:var(--err);color:#fff;border-color:var(--err)" onclick="deleteRectAnnot('${id}')">حذف</button>
      <button class="btn-cancel" onclick="document.getElementById('rect-edit-popup').remove()">لغو</button>
      <button class="btn-save" onclick="updateRectAnnot('${id}')">ذخیره</button>
    </div>`;
  document.body.appendChild(div);
  setTimeout(() => document.getElementById('rect-edit-note')?.focus(), 80);
}

function updateRectAnnot(id) {
  const annot = (state.rectAnnotations || []).find(a => a.id === id);
  if (annot) {
    annot.note = document.getElementById('rect-edit-note')?.value.trim() || '';
    saveState();
    renderCurrentPage();
    if (activeTab === 2) renderHighlightsPanel();
  }
  document.getElementById('rect-edit-popup')?.remove();
}

function deleteRectAnnot(id) {
  if (state.rectAnnotations)
    state.rectAnnotations = state.rectAnnotations.filter(a => a.id !== id);
  saveState();
  renderCurrentPage();
  if (activeTab === 2) renderHighlightsPanel();
  document.getElementById('rect-edit-popup')?.remove();
}

// ── Translation ────────────────────────────────────────────────────────
async function translateAllPages() {
  if (!pdfDoc || translating) return;

  translating = true;
  translationAborted = false;

  const btn = document.getElementById('trans-all-btn');
  btn.classList.add('busy');
  btn.textContent = 'در حال ترجمه...';

  const prog = document.getElementById('trans-progress');
  prog.classList.add('show');

  let done = 0;
  for (let i = 1; i <= totalPages; i++) {
    if (translationAborted) break;

    // skip already cached
    if (getTransCache(currentBookPath, i)) {
      done++;
      updateTransProgress(done, totalPages);
      continue;
    }

    try {
      const page = await pdfDoc.getPage(i);
      const textContent = await page.getTextContent();
      const rawText = textContent.items.map(item => item.str).join(' ').trim();
      if (!rawText) { done++; updateTransProgress(done, totalPages); continue; }

      // translate in chunks to avoid timeout
      const chunks = chunkText(rawText, 1000);
      const translatedParts = [];
      for (const chunk of chunks) {
        if (translationAborted) break;
        const fa = await window.api.translate(chunk).catch(() => null);
        translatedParts.push(fa || chunk);
        await sleep(200);
      }

      setTransCache(currentBookPath, i, translatedParts.join(' '));
    } catch {}

    done++;
    updateTransProgress(done, totalPages);
    await sleep(100);
  }

  translating = false;
  btn.classList.remove('busy');
  checkTranslateBtn();

  // re-render if in a translated mode
  if (readMode !== 'original') renderCurrentPage();
}

function updateTransProgress(done, total) {
  const pct = Math.round((done / total) * 100);
  document.getElementById('trans-bar-fill').style.width = pct + '%';
  document.getElementById('trans-progress-pct').textContent = pct + '%';
  document.getElementById('trans-progress-text').textContent =
    `ترجمه ${done} از ${total} صفحه`;
  if (done >= total) {
    setTimeout(() => document.getElementById('trans-progress').classList.remove('show'), 2000);
  }
}

function checkTranslateBtn() {
  const btn = document.getElementById('trans-all-btn');
  if (!currentBookPath || !totalPages) return;
  if (allPagesTranslated(currentBookPath, totalPages)) {
    btn.innerHTML = `✓ ترجمه شده`;
    btn.style.opacity = '.6';
    btn.style.cursor = 'default';
  }
}

function chunkText(text, maxLen) {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxLen) {
      if (current) chunks.push(current.trim());
      current = s;
    } else {
      current += ' ' + s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text];
}

// ── Read mode ──────────────────────────────────────────────────────────
function setReadMode(btn, mode) {
  readMode = mode;
  document.querySelectorAll('.rmode-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  if (pdfDoc) renderCurrentPage();
}

// ── Navigation ─────────────────────────────────────────────────────────
function prevPage() {
  if (currentPage <= 1) return;
  currentPage--;
  renderCurrentPage();
}

function nextPage() {
  if (currentPage >= totalPages) return;
  currentPage++;
  renderCurrentPage();
}

function goToPage(n) {
  if (!pdfDoc) return;
  n = Math.max(1, Math.min(totalPages, n));
  currentPage = n;
  renderCurrentPage();
}

function seekBook(e) {
  if (!totalPages) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  goToPage(Math.round(pct * totalPages) || 1);
}

function updateNav() {
  document.getElementById('page-input').value = currentPage;
  document.getElementById('btn-prev').disabled = currentPage <= 1;
  document.getElementById('btn-next').disabled = currentPage >= totalPages;
}

function updateProgress() {
  if (!totalPages) return;
  const pct = Math.round((currentPage / totalPages) * 100);
  document.getElementById('prog-bottom-fill').style.width = pct + '%';
  document.getElementById('read-pct').textContent = pct + '٪';
  // rough ETA: avg 2 min per page
  const remaining = totalPages - currentPage;
  if (remaining > 0) {
    const hrs = Math.floor((remaining * 2) / 60);
    const mins = (remaining * 2) % 60;
    document.getElementById('read-eta').textContent =
      hrs > 0 ? `~${hrs} ساعت مانده` : `~${mins} دقیقه مانده`;
  } else {
    document.getElementById('read-eta').textContent = 'تمام شد ✓';
  }
}

// keyboard navigation
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === 'Escape') {
    if (document.getElementById('pdf-search-bar').classList.contains('show')) { closePdfSearch(); return; }
    const openModal = document.querySelector('.modal-bg.show');
    if (openModal) { openModal.classList.remove('show'); return; }
    if (aiOpen) { toggleAI(); return; }
    window.api.closeWindow();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyF') { e.preventDefault(); openPdfSearch(); return; }
  if (e.code === 'ArrowRight' || e.code === 'ArrowLeft') {
    e.preventDefault();
    if (e.code === 'ArrowRight') prevPage();
    else nextPage();
  }
  if (e.code === 'ArrowDown') nextPage();
  if (e.code === 'ArrowUp') prevPage();
});

// ── Bookmark ───────────────────────────────────────────────────────────
function toggleBookmark() {
  const existing = (state.bookmarks || []).findIndex(
    b => b.path === currentBookPath && b.page === currentPage
  );
  if (existing >= 0) {
    state.bookmarks.splice(existing, 1);
  } else {
    if (!state.bookmarks) state.bookmarks = [];
    state.bookmarks.push({ path: currentBookPath, page: currentPage, id: 'bm' + Date.now() });
  }
  saveState();
  updateBookmarkBtn();
  if (activeTab === 1) renderBookmarksPanel();
}

function updateBookmarkBtn() {
  const btn = document.getElementById('btn-bookmark');
  const isBookmarked = (state.bookmarks || []).some(
    b => b.path === currentBookPath && b.page === currentPage
  );
  if (isBookmarked) {
    btn.classList.add('on');
    btn.querySelector('svg').setAttribute('fill', 'currentColor');
    btn.querySelector('svg').setAttribute('stroke', 'none');
  } else {
    btn.classList.remove('on');
    btn.querySelector('svg').setAttribute('fill', 'none');
    btn.querySelector('svg').setAttribute('stroke', 'currentColor');
  }
}

// ── Left panel rendering ───────────────────────────────────────────────
function switchTab(el, idx) {
  activeTab = idx;
  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('on'));
  el.classList.add('on');
  if (idx === 0) renderTocPanel([]); // will be reloaded
  if (idx === 0 && pdfDoc) loadToc();
  if (idx === 1) renderBookmarksPanel();
  if (idx === 2) renderHighlightsPanel();
}

function renderBookmarksPanel() {
  const body = document.getElementById('panel-body');
  const bmarks = (state.bookmarks || []).filter(b => b.path === currentBookPath);
  if (!bmarks.length) {
    body.innerHTML = `<div class="empty-panel">بوکمارکی نداری.<br>روی آیکون بوکمارک در toolbar بزن.</div>`;
    return;
  }
  body.innerHTML = bmarks.map(b => `
    <div class="bmark-item" onclick="goToPage(${b.page})">
      <svg class="bmark-icon" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M6.32 2.577a49.255 49.255 0 0111.36 0c1.497.174 2.57 1.46 2.57 2.93V21a.75.75 0 01-1.085.67L12 18.089l-7.165 3.583A.75.75 0 013.75 21V5.507c0-1.47 1.073-2.756 2.57-2.93z" clip-rule="evenodd"/></svg>
      <div>
        <div class="bmark-label">صفحه ${b.page}</div>
        <div class="bmark-page">p.${b.page} / ${totalPages}</div>
      </div>
    </div>`).join('');
}

function renderHighlightsPanel() {
  const body = document.getElementById('panel-body');
  if (activeTab !== 2) return;
  const hls  = (state.highlights     || []).filter(h => h.path === currentBookPath);
  const rects = (state.rectAnnotations || []).filter(a => a.path === currentBookPath);
  if (!hls.length && !rects.length) {
    body.innerHTML = `<div class="empty-panel">هایلایتی نداری.<br>در حالت متنی، متن انتخاب کن.<br>یا کلیک راست + drag روی PDF.</div>`;
    return;
  }
  const colors = { y: 'rgba(255,214,0,.7)', b: 'rgba(100,180,255,.7)', g: 'rgba(80,210,160,.7)', r: 'rgba(255,100,120,.7)' };
  const hlHTML = hls.map(h => `
    <div class="hl-item" style="border-right-color:${colors[h.color]||colors.y}" onclick="goToPage(${h.page})">
      <div class="hl-text">"${esc(h.text.slice(0,120))}${h.text.length>120?'...':''}"</div>
      ${h.note ? `<div class="hl-note">${esc(h.note)}</div>` : ''}
      <div class="hl-page">صفحه ${h.page}</div>
    </div>`).join('');
  const rectHTML = rects.map(a => `
    <div class="hl-item" style="border-right-color:${colors[a.color]||colors.y}" onclick="goToPage(${a.page})">
      <div class="hl-text">🔲 مارک ناحیه — صفحه ${a.page}</div>
      ${a.note ? `<div class="hl-note">${esc(a.note)}</div>` : ''}
      <div class="hl-page">صفحه ${a.page}</div>
    </div>`).join('');
  body.innerHTML = hlHTML + rectHTML;
}

// ── Theme & font ───────────────────────────────────────────────────────
function setTheme(btn, _name, pageBg, pageFg, shadow) {
  document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  document.documentElement.style.setProperty('--page-bg', pageBg);
  document.documentElement.style.setProperty('--page-fg', pageFg);
  document.documentElement.style.setProperty('--page-shadow', shadow);
}

function changeFontSize(delta) {
  fontSize = Math.max(13, Math.min(28, fontSize + delta));
  document.getElementById('font-size-val').textContent = fontSize;
  document.querySelectorAll('.text-page').forEach(el => { el.style.fontSize = fontSize + 'px'; });
}

// ── Utils ──────────────────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Book info modal ────────────────────────────────────────────────────
async function openBookInfo() {
  if (!currentBookPath) return;
  const book = state.books.find(b => b.path === currentBookPath);
  if (!book) return;

  const modal = document.getElementById('book-info-modal');
  modal.classList.add('show');

  // cover
  const coverEl = document.getElementById('binfo-cover');
  coverEl.innerHTML = book.cover ? `<img src="${esc(book.cover)}" style="width:100%;height:100%;object-fit:cover">` : '📖';

  document.getElementById('binfo-title').textContent  = book.title || '—';
  document.getElementById('binfo-author').textContent = book.author || '';
  document.getElementById('binfo-year').textContent   = book.year   || '';
  document.getElementById('binfo-desc-en').textContent = '';
  document.getElementById('binfo-desc-fa').textContent = '';
  document.getElementById('binfo-cats').innerHTML = (book.categories||[])
    .slice(0,3).map(c => `<span style="font-size:11px;padding:2px 7px;border-radius:4px;background:var(--bg3);color:var(--t2)">${esc(c)}</span>`).join('');

  if (book.description) {
    document.getElementById('binfo-desc-en').textContent = book.description;
    document.getElementById('binfo-loading').textContent = 'در حال ترجمه...';
    const fa = await window.api.translate(book.description.slice(0, 1200)).catch(() => null);
    document.getElementById('binfo-loading').textContent = '';
    if (fa) document.getElementById('binfo-desc-fa').textContent = fa;
  } else if (!book.cover) {
    // try to fetch meta now
    document.getElementById('binfo-loading').textContent = 'در حال جستجو...';
    await fetchAndSaveBookMeta(currentBookPath);
    const updated = state.books.find(b => b.path === currentBookPath);
    document.getElementById('binfo-loading').textContent = '';
    if (updated?.cover) coverEl.innerHTML = `<img src="${esc(updated.cover)}" style="width:100%;height:100%;object-fit:cover">`;
    if (updated?.author) document.getElementById('binfo-author').textContent = updated.author;
    if (updated?.description) {
      document.getElementById('binfo-desc-en').textContent = updated.description;
      const fa = await window.api.translate(updated.description.slice(0, 1200)).catch(() => null);
      if (fa) document.getElementById('binfo-desc-fa').textContent = fa;
    }
  } else {
    document.getElementById('binfo-loading').textContent = 'توضیحاتی پیدا نشد';
  }
}

function closeBookInfo() {
  document.getElementById('book-info-modal').classList.remove('show');
}

// ── Claude AI Panel ───────────────────────────────────────────────────
let aiOpen = false;
let aiHistory = [];
let aiCtxOn = false;
const AI_CTX_LABEL_BOOK = 'اضافه کردن محتوای صفحه';

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
    if (!getAIKey()) document.getElementById('ai-key-box').style.display = '';
    setTimeout(() => document.getElementById('ai-textarea')?.focus(), 300);
  }
}

function toggleAICtx() {
  aiCtxOn = !aiCtxOn;
  document.getElementById('ai-ctx-btn').classList.toggle('on', aiCtxOn);
  document.getElementById('ai-ctx-lbl').textContent = aiCtxOn ? 'context اضافه شد ✓' : AI_CTX_LABEL_BOOK;
}

function onAIKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAI(); }
}

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
  if (!pdfDoc || !currentBookPath) return 'هیچ کتابی باز نیست.';
  const book = state.books.find(b => b.path === currentBookPath);
  const spans = document.querySelectorAll('.textLayer span');
  const text = [...spans].map(s => s.textContent).join(' ').replace(/\s+/g, ' ').trim().slice(0, 3000);
  return `Book: "${book?.title || 'Unknown'}"\nPage ${currentPage} of ${totalPages}:\n${text || '(متنی استخراج نشد)'}`;
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
    const sys = `You are a helpful AI assistant in a book reader app. Help the user understand or analyze the content they are reading. Be concise. Match user's language (Persian or English).`;
    const reply = await window.api.claudeChat(sys, aiHistory, key);
    typingDiv.classList.remove('typing');
    typingDiv.textContent = reply;
    aiHistory.push({ role: 'assistant', content: reply });
    if (aiCtxOn) {
      aiCtxOn = false;
      document.getElementById('ai-ctx-btn').classList.remove('on');
      document.getElementById('ai-ctx-lbl').textContent = AI_CTX_LABEL_BOOK;
    }
  } catch (err) {
    typingDiv.classList.remove('typing');
    typingDiv.style.color = 'var(--err)';
    typingDiv.textContent = `خطا: ${String(err.message).slice(0, 200)}`;
    aiHistory.pop();
  }
  document.getElementById('ai-send-btn').disabled = false;
  document.getElementById('ai-msgs').scrollTop = document.getElementById('ai-msgs').scrollHeight;
}

// ── Drag & Drop ────────────────────────────────────────────────────────
const dropOverlay = document.getElementById('drop-overlay');
let dragCounter = 0;

document.addEventListener('dragenter', e => {
  e.preventDefault();
  const hasPdf = [...(e.dataTransfer?.items || [])].some(i => i.type === 'application/pdf' || i.kind === 'file');
  if (!hasPdf) return;
  dragCounter++;
  dropOverlay.classList.add('show');
});

document.addEventListener('dragleave', e => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('show'); }
});

document.addEventListener('dragover', e => { e.preventDefault(); });

document.addEventListener('drop', async e => {
  e.preventDefault();
  dragCounter = 0;
  dropOverlay.classList.remove('show');
  const files = [...(e.dataTransfer?.files || [])].filter(f =>
    f.name.toLowerCase().endsWith('.pdf')
  );
  if (!files.length) return;

  const newPaths = [];
  for (const f of files) {
    const p = f.path;
    if (!p) continue;
    if (state.books.find(b => b.path === p)) continue;
    const fileName = p.split(/[\\/]/).pop().replace(/\.pdf$/i, '');
    state.books.push({ path: p, title: fileName, author: '', totalPages: 0, lastPage: 1, cover: null });
    newPaths.push(p);
  }
  if (!newPaths.length) return;
  saveState();
  renderLibrary();
  if (newPaths.length === 1) openBook(newPaths[0]);
  for (const p of newPaths) fetchAndSaveBookMeta(p);
});

// ── Init ───────────────────────────────────────────────────────────────
renderLibrary();
