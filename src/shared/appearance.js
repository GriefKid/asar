'use strict';

(() => {
  const page = location.pathname.split('/').at(-2);
  const appearanceKey = 'asar-appearance';
  const layoutKey = 'asar-layouts';
  const selectors = {
    'main-app': {
      '.sidebar': 'ناوبری', '.asar-cover': 'جلد', '#daily-score-card': 'نمره',
      '#stats-row': 'آمار', '#xp-row': 'سطح', '#home-activity-panel': 'نقشه فعالیت',
      '#home-today-panel': 'برنامه امروز', '#home-active-panel': 'آثار در حال بررسی',
      '#home-rated-panel': 'آثار محبوب', '#home-goal-panel': 'هدف‌ها',
      '.lib-header': 'فیلتر کتابخانه', '#lib-shelf-view': 'قفسه', '#kanban': 'تابلو',
      '.planner-day': 'برنامه و واقعیت', '.habit-panel': 'عادت‌ها',
      '.planner-cal': 'تقویم', '.settings-scroll': 'تنظیمات', '#profile-content': 'پروفایل',
      '#community-grid': 'آثار اجتماعی', '#asar-collection-tree': 'مجموعه‌ها'
    },
    'music-player': { '.sidebar': 'مجموعه‌ها', '#player-content': 'پخش موسیقی', '.lyr-panel': 'متن آهنگ', '#ai-panel': 'گفت‌وگو' },
    'video-player': { '.sidebar': 'مجموعه‌ها', '#controls': 'کنترل پخش', '#ai-panel': 'گفت‌وگو', '#sub-display': 'زیرنویس' },
    'book-reader': { '.sidebar': 'کتابخانه', '.reader-toolbar': 'نوار کتاب', '#pdf-container': 'صفحه کتاب', '#ai-panel': 'گفت‌وگو' },
    writer: { '.sidebar': 'نوشته‌ها', '#editor-area': 'ویرایشگر' }
  }[page] || {};
  const controls = {
    scale: ['اندازهٔ رابط', 'range', 100, 75, 150],
    text: ['رنگ متن رابط', 'color', '#f4e8de'],
    subtitleSize: ['اندازهٔ زیرنویس', 'range', 21, 11, 54],
    subtitleColor: ['رنگ زیرنویس', 'color', '#ffffff'],
    subtitleBg: ['پس‌زمینهٔ زیرنویس', 'color', '#120e18'],
    lyricsSize: ['اندازهٔ متن آهنگ', 'range', 16, 11, 36],
    lyricsColor: ['رنگ متن آهنگ', 'color', '#f4e8de'],
    bookSize: ['اندازهٔ متن کتاب', 'range', 17, 11, 36],
    bookColor: ['رنگ متن کتاب', 'color', '#f4e8de']
  };

  function read(key) {
    try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; }
  }

  const style = document.documentElement.style;
  let appearance = read(appearanceKey);
  let layouts = read(layoutKey);
  let scope = '';
  let edit = false;
  let dragging = null;

  const element = (tag, text, classes) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (classes) node.className = classes;
    return node;
  };

  function applyAppearance() {
    const color = (key) => /^#[\da-f]{6}$/i.test(appearance[key]) ? appearance[key] : controls[key][2];
    const range = (key) => {
      const [, , fallback, min, max] = controls[key];
      return Math.max(min, Math.min(max, Number(appearance[key]) || fallback));
    };
    style.setProperty('--asar-base-scale', range('scale') / 100);
    style.setProperty('--t1', color('text'));
    for (const [name, property] of [['subtitle', 'subtitle'], ['lyrics', 'lyrics'], ['book', 'book']]) {
      style.setProperty('--asar-' + property + '-size', range(name + 'Size') + 'px');
      style.setProperty('--asar-' + property + '-color', color(name + 'Color'));
    }
    style.setProperty('--asar-subtitle-bg', color('subtitleBg') + 'c7');
  }

  function button(text, action, target) {
    const node = element('button', text);
    node.type = 'button';
    node.addEventListener('click', action);
    target.append(node);
    return node;
  }

  function appearanceForm(target, names) {
    const form = element('div', '', 'asar-appearance');
    const inputs = {};
    for (const name of names) {
      const [label, type, fallback, min, max] = controls[name];
      const row = element('label', label);
      const input = element('input');
      input.type = type;
      if (type === 'range') { input.min = min; input.max = max; }
      input.value = appearance[name] ?? fallback;
      input.addEventListener('input', () => {
        appearance[name] = input.value;
        localStorage.setItem(appearanceKey, JSON.stringify(appearance));
      window.dispatchEvent(new CustomEvent('asar-store', { detail: appearanceKey }));
        applyAppearance();
      });
      inputs[name] = input;
      row.append(input);
      form.append(row);
    }
    button('بازنشانی ظاهر', () => {
      for (const [key, input] of Object.entries(inputs)) {
        delete appearance[key];
        input.value = controls[key][2];
      }
      localStorage.setItem(appearanceKey, JSON.stringify(appearance));
      window.dispatchEvent(new CustomEvent('asar-store', { detail: appearanceKey }));
      applyAppearance();
    }, form);
    target.append(form);
  }

  const menu = element('details', '', 'asar-layout-menu');
  menu.append(element('summary', 'چیدمان و ظاهر'));
  const toolbar = element('div');
  const layer = element('div', '', 'asar-layout-layer');
  menu.append(toolbar);
  document.body.append(menu, layer);
  const toggle = button('ویرایش چیدمان', () => {
    edit = !edit;
    toggle.textContent = edit ? 'قفل چیدمان' : 'ویرایش چیدمان';
    if (edit) menu.open = false;
    updateHandles();
  }, toolbar);
  button('بازنشانی چیدمان', () => {
    const entry = current();
    entry.positions = {};
    applyPositions();
    persist();
  }, toolbar);
  const name = element('input');
  name.placeholder = 'نام چیدمان';
  name.setAttribute('aria-label', 'نام چیدمان');
  name.maxLength = 50;
  toolbar.append(name);
  const saved = element('select');
  saved.setAttribute('aria-label', 'چیدمان‌های ذخیره‌شده');
  button('ذخیرهٔ چیدمان', () => {
    const label = name.value.trim();
    if (!label) { name.focus(); return; }
    const entry = current();
    entry.presets = [...entry.presets.filter(item => item.name !== label), { name: label, positions: structuredClone(entry.positions) }];
    refreshPresets(label);
    persist();
  }, toolbar);
  toolbar.append(saved);
  button('بازکردن', () => {
    const entry = current();
    const preset = entry.presets.find(item => item.name === saved.value);
    if (!preset) return;
    entry.positions = structuredClone(preset.positions);
    name.value = preset.name;
    applyPositions();
    persist();
  }, toolbar);
  button('حذف چیدمان ذخیره‌شده', () => {
    if (!saved.value) return;
    const entry = current();
    entry.presets = entry.presets.filter(item => item.name !== saved.value);
    refreshPresets();
    persist();
  }, toolbar);

  const specific = { 'video-player': ['subtitleSize', 'subtitleColor', 'subtitleBg'], 'music-player': ['lyricsSize', 'lyricsColor'], 'book-reader': ['bookSize', 'bookColor'] };
  appearanceForm(toolbar, ['scale', 'text', ...(specific[page] || [])]);
  const settings = document.querySelector('#asar-appearance-settings');
  if (settings) appearanceForm(settings, Object.keys(controls));

  function current() {
    return layouts[scope] ||= { positions: {}, presets: [] };
  }

  function persist() {
    localStorage.setItem(layoutKey, JSON.stringify(layouts));
    window.dispatchEvent(new CustomEvent('asar-store', { detail: layoutKey }));
  }

  function refreshPresets(value = '') {
    saved.replaceChildren(new Option('چیدمان ذخیره‌شده', ''));
    for (const preset of current().presets) saved.add(new Option(preset.name, preset.name));
    saved.value = value;
  }

  function panels() {
    return Object.entries(selectors).map(([selector, label]) => [selector, label, document.querySelector(selector)]).filter(([, , panel]) => panel);
  }

  function zoom() { return Number(style.getPropertyValue('--asar-base-scale')) || 1; }

  function size() {
    return { w: innerWidth / zoom(), h: innerHeight / zoom() };
  }

  function clamp(rect) {
    const view = size();
    const w = Math.max(Math.min(136, view.w), Math.min(view.w, rect.w));
    const h = Math.max(Math.min(70, view.h), Math.min(view.h, rect.h));
    return { w, h, x: Math.min(Math.max(0, rect.x), view.w - w), y: Math.min(Math.max(0, rect.y), view.h - h) };
  }

  function apply(panel, position) {
    panel.toggleAttribute('data-asar-positioned', !!position);
    if (!position) return;
    for (const [key, value] of Object.entries(clamp(position))) panel.style.setProperty('--asar-' + key, value + 'px');
  }

  function applyPositions() {
    for (const [key, , panel] of panels()) apply(panel, current().positions[key]);
    updateHandles();
  }

  const handles = new Map();
  const edges = ['move', 'n', 's', 'e', 'w', 'se', 'sw', 'ne', 'nw'];
  function shifted(rect, edge, dx, dy) {
    if (edge === 'move') return clamp({ ...rect, x: rect.x + dx, y: rect.y + dy });
    const next = { ...rect };
    if (edge.includes('w')) { dx = Math.min(dx, next.w - 136); next.x += dx; next.w -= dx; }
    if (edge.includes('n')) { dy = Math.min(dy, next.h - 70); next.y += dy; next.h -= dy; }
    if (edge.includes('e')) next.w += dx;
    if (edge.includes('s')) next.h += dy;
    return clamp(next);
  }

  function geometry(panel) {
    const r = panel.getBoundingClientRect();
    const factor = zoom();
    return { x: r.left / factor, y: r.top / factor, w: r.width / factor, h: r.height / factor };
  }

  function savePosition(key, panel, position) {
    current().positions[key] = position;
    apply(panel, position);
    persist();
    updateHandles();
  }

  function makeHandles(key, label, panel) {
    return edges.map(edge => {
      const handle = element('button', edge === 'move' ? label : '', 'asar-layout-handle ' + (edge === 'move' ? 'move' : 'resize-' + edge));
      handle.type = 'button';
      handle.setAttribute('aria-label', (edge === 'move' ? 'جابه‌جایی ' : 'تغییر اندازهٔ ') + label);
      handle.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        event.preventDefault();
        handle.setPointerCapture(event.pointerId);
        dragging = { key, panel, edge, start: geometry(panel), x: event.clientX, y: event.clientY };
      });
      handle.addEventListener('pointermove', event => {
        if (!dragging || dragging.key !== key) return;
        const { start, x, y } = dragging;
        apply(panel, shifted(start, edge, (event.clientX - x) / zoom(), (event.clientY - y) / zoom()));
        updateHandles();
      });
      for (const type of ['pointerup', 'pointercancel']) handle.addEventListener(type, () => {
        if (!dragging || dragging.key !== key) return;
        dragging = null;
        if (panel.hasAttribute('data-asar-positioned')) savePosition(key, panel, geometry(panel));
      });
      handle.addEventListener('keydown', event => {
        const d = { ArrowUp: [0, -10], ArrowDown: [0, 10], ArrowLeft: [-10, 0], ArrowRight: [10, 0] }[event.key];
        if (!d) return;
        event.preventDefault();
        savePosition(key, panel, shifted(geometry(panel), edge, ...d));
      });
      layer.append(handle);
      return handle;
    });
  }

  function updateHandles() {
    layer.hidden = !edit;
    if (!edit) return;
    for (const [key, label, panel] of panels()) {
      const nodes = handles.get(key) || makeHandles(key, label, panel);
      handles.set(key, nodes);
      const { x, y, w, h } = geometry(panel);
      const points = [[x, y, Math.min(w, 110), 26], [x + 9, y - 3, w - 18, 8], [x + 9, y + h - 5, w - 18, 8], [x + w - 5, y + 9, 8, h - 18], [x - 3, y + 9, 8, h - 18], [x + w - 10, y + h - 10, 10, 10], [x, y + h - 10, 10, 10], [x + w - 10, y, 10, 10], [x, y, 10, 10]];
      nodes.forEach((node, index) => {
        node.hidden = w < 1 || h < 1 || getComputedStyle(panel).visibility === 'hidden' || (panel.classList.contains('ai-panel') && !panel.classList.contains('open'));
        for (const [i, property] of ['left', 'top', 'width', 'height'].entries()) node.style[property] = Math.max(0, points[index][i]) + 'px';
      });
    }
  }

  function updateScope() {
    const next = page + ':' + (document.querySelector('.section.active')?.id || '');
    if (scope === next) { updateHandles(); return; }
    scope = next;
    applyPositions();
    refreshPresets();
  }

  applyAppearance();
  updateScope();
  new MutationObserver(updateScope).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });
  window.addEventListener('resize', applyPositions);
  window.addEventListener('scroll', updateHandles, true);
  window.addEventListener('storage', event => {
    if (event.key === appearanceKey) { appearance = read(appearanceKey); applyAppearance(); updateHandles(); }
    if (event.key === layoutKey) { layouts = read(layoutKey); applyPositions(); refreshPresets(); }
  });
})();
