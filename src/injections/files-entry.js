(() => {
  const key = '__agyFilesEntry';
  window[key]?.dispose();
  const selector = '[data-testid="new-tab-card-open-file"]';
  let disposed = false;

  function reconcile() {
    for (const button of document.querySelectorAll(selector)) {
      const label = button.querySelector('span:last-child');
      if (label?.textContent === 'Open File') label.textContent = 'Files';
    }
  }

  function onClick(event) {
    const button = event.target.closest?.(selector);
    if (!button || button.disabled) return;
    // Use the native Files content, not the new-tab card's file picker.
    const ctx = window.__agyNativeFiles.context(button);
    event.preventDefault();
    event.stopImmediatePropagation();
    Promise.resolve(ctx.open()).catch(error => console.error('[agy-customify] Open Files:', error));
  }

  const observer = new MutationObserver(reconcile);
  function start() {
    if (disposed) return;
    reconcile();
    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    document.addEventListener('click', onClick, true);
  }
  window[key] = {
    dispose() {
      disposed = true;
      observer.disconnect();
      document.removeEventListener('DOMContentLoaded', start);
      document.removeEventListener('click', onClick, true);
    },
  };
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
