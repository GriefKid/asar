'use strict';

(() => {
  const bar = document.querySelector('.asar-windowbar');
  bar.insertAdjacentHTML('beforeend', `
    <div class="asar-window-actions" role="group" aria-label="کنترل پنجره">
      <button type="button" data-window-action="minimize" title="کوچک‌کردن پنجره" aria-label="کوچک‌کردن پنجره">−</button>
      <button type="button" data-window-action="close" title="بستن پنجره" aria-label="بستن پنجره">×</button>
    </div>
  `);
  bar.querySelector('[data-window-action="minimize"]').onclick = () => window.api.minimizeWindow();
  bar.querySelector('[data-window-action="close"]').onclick = () => {
    const exitModal = document.getElementById('exit-modal');
    if (exitModal) {
      exitModal.classList.add('show');
      document.getElementById('exit-cancel-btn').focus();
    } else {
      window.api.closeWindow();
    }
  };
})();
