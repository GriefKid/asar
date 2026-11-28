'use strict';

(() => {
  const bar = document.querySelector('.asar-windowbar');
  bar.insertAdjacentHTML('beforeend', `
    <div class="asar-window-actions" role="group" aria-label="کنترل پنجره">
      <button type="button" data-window-action="minimize" title="کوچک‌کردن پنجره" aria-label="کوچک‌کردن پنجره">−</button>
      <button type="button" data-window-action="fullscreen" title="تمام‌صفحه" aria-label="تمام‌صفحه" aria-pressed="false">□</button>
      <button type="button" data-window-action="close" title="بستن پنجره" aria-label="بستن پنجره">×</button>
    </div>
  `);
  bar.querySelector('[data-window-action="minimize"]').onclick = () => window.api.minimizeWindow();
  const fullscreenButton = bar.querySelector('[data-window-action="fullscreen"]');
  fullscreenButton.onclick = () => window.api.toggleWindowFullscreen();
  window.api.onWindowFullscreen(fullscreen => {
    bar.dataset.fullscreen = String(fullscreen);
    fullscreenButton.textContent = fullscreen ? '❐' : '□';
    fullscreenButton.title = fullscreen ? 'بازگشت به اندازهٔ قبلی' : 'تمام‌صفحه';
    fullscreenButton.setAttribute('aria-label', fullscreenButton.title);
    fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
  });
  bar.querySelector('[data-window-action="close"]').onclick = () => {
    const exitModal = document.getElementById('exit-modal');
    if (exitModal) {
      exitModal.classList.add('show');
      document.getElementById('exit-cancel-btn').focus();
    } else {
      window.api.closeWindow();
    }
  };

  // Leave controls, editing, and collection drag-and-drop available on a plain press.
  const interactive = [
    'a', 'button', 'input', 'select', 'textarea', 'summary', 'label', '[onclick]', '[contenteditable]',
    '[draggable="true"]', '[role="button"]', '[role="slider"]', '.prog-track', '.vol-track', '.pdf-container', '.sidebar [tabindex]'
  ].join(',');
  let pointer = null;
  let suppressClick = false;
  const root = document.documentElement;

  document.addEventListener('pointerdown', event => {
    suppressClick = false;
    if (event.button !== 0 || event.pointerType !== 'mouse') return;
    if (!event.altKey && event.target.closest(interactive)) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, alt: event.altKey, moving: false };
    window.api.beginWindowDrag();
    if (event.altKey) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);

  document.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || !(event.buttons & 1)) return;
    if (!pointer.moving) {
      if (Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) < 6) return;
      pointer.moving = true;
      root.setPointerCapture(event.pointerId);
      root.classList.add('asar-window-moving');
      window.getSelection()?.removeAllRanges();
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    window.api.moveWindowDrag();
  }, true);

  function endDrag() {
    if (!pointer) return;
    suppressClick = pointer.moving || pointer.alt;
    pointer = null;
    root.classList.remove('asar-window-moving');
    window.api.endWindowDrag();
  }

  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    document.addEventListener(eventName, event => {
      if (pointer?.id === event.pointerId) endDrag();
    }, true);
  }
  window.addEventListener('blur', endDrag);
  document.addEventListener('click', event => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
})();
