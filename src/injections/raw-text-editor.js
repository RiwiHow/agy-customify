(() => {
  const languages = { md: 'markdown', mdx: 'markdown', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx', json: 'json', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', css: 'css', scss: 'scss', py: 'python', sh: 'bash', bash: 'bash', ps1: 'powershell', yaml: 'yaml', yml: 'yaml', toml: 'toml', rs: 'rust', go: 'go', java: 'java', c: 'c', h: 'c', cpp: 'cpp', sql: 'sql' };
  const esc = s => s.replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
  function create(host, uri, onInput) {
    let disposed = false, frame, lastText, lines = [''], lineCount = 1, active = 0;
    let paintedStart = -1, paintedEnd = -1, paintedText, paintedActive = -1;
    let view = { start: 0, end: 0, direction: 'none', top: 0, left: 0 };
    const root = document.createElement('div'); root.dataset.agyRawEditor = ''; root.className = 'font-mono text-xs'; root.hidden = true;
    const gutter = document.createElement('div'); gutter.dataset.agyCodeGutter = ''; gutter.setAttribute('aria-hidden', 'true');
    const gutterTrack = document.createElement('div'); gutterTrack.dataset.agyCodeGutterTrack = ''; gutter.appendChild(gutterTrack);
    const content = document.createElement('div'); content.dataset.agyCodeInput = '';
    const pre = document.createElement('pre'); pre.dataset.agyCodeHighlight = ''; pre.setAttribute('aria-hidden', 'true');
    const code = document.createElement('code'); pre.appendChild(code);
    const area = document.createElement('textarea'); area.dataset.agyTextEditor = ''; area.setAttribute('aria-label', `Edit ${window.__agyNativeFiles.basename(uri)}`);
    area.spellcheck = false; area.wrap = 'off'; area.autocomplete = 'off'; area.autocapitalize = 'off';
    content.append(pre, area); root.append(gutter, content); host.appendChild(root);
    const nativeLine = host.querySelector('.file-viewer-root .code-line');
    const nativeStyle = nativeLine && getComputedStyle(nativeLine);
    const lineHeight = Math.max(parseFloat(nativeStyle?.minHeight) || 19.2, parseFloat(nativeStyle?.lineHeight) || 0);
    root.style.setProperty('--agy-code-line-height', `${lineHeight}px`);
    let language;
    const raw = host.querySelector('.file-viewer-root');
    for (const f of window.__agyNativeFiles.ancestors(raw)) if (f.memoizedProps?.languageId) { language = f.memoizedProps.languageId; break; }
    language ??= languages[window.__agyNativeFiles.basename(uri).split('.').pop().toLowerCase()];
    function draw() {
      frame = null;
      if (disposed || root.hidden) return;
      const top = area.scrollTop, left = area.scrollLeft;
      const fullHighlight = lineCount <= 400 && (lastText?.length ?? 0) <= 32 * 1024;
      const start = Math.max(0, Math.floor(top / lineHeight) - 8);
      const end = Math.min(lineCount, start + Math.ceil((area.clientHeight || 600) / lineHeight) + 16);
      const offsetY = 8 + start * lineHeight - top;
      gutterTrack.style.transform = `translate3d(0, ${offsetY}px, 0)`;
      if (start !== paintedStart || end !== paintedEnd || lastText !== paintedText) {
        const count = end - start;
        while (gutterTrack.childElementCount > count) gutterTrack.lastElementChild.remove();
        while (gutterTrack.childElementCount < count) {
          const number = document.createElement('div'); number.style.height = `${lineHeight}px`; gutterTrack.appendChild(number);
        }
        for (let i = start; i < end; i++) {
          const number = gutterTrack.children[i - start];
          const label = String(i + 1);
          if (number.textContent !== label) number.textContent = label;
        }
        if (fullHighlight) {
          if (lastText !== paintedText) {
            const slice = `${lastText}\n`;
            const grammar = window.Prism?.languages?.[language];
            if (grammar) {
              try { code.innerHTML = window.Prism.highlight(slice, grammar, language); }
              catch { code.textContent = slice; }
            } else code.textContent = slice;
          }
        } else {
          const slice = `${lines.slice(start, end).join('\n')}\n`;
          const grammar = window.Prism?.languages?.[language];
          if (grammar && slice.length <= 32 * 1024) {
            try { code.innerHTML = window.Prism.highlight(slice, grammar, language); }
            catch { code.innerHTML = esc(slice); }
          } else code.textContent = slice;
        }
        paintedStart = start; paintedEnd = end;
        paintedText = lastText;
        paintedActive = -1;
      }
      pre.style.transform = `translate3d(${-left}px, ${fullHighlight ? -top : offsetY - 8}px, 0)`;
      if (active !== paintedActive || start !== paintedStart) {
        for (let i = 0; i < gutterTrack.childElementCount; i++) {
          gutterTrack.children[i].toggleAttribute('data-active', start + i === active);
        }
        paintedActive = active;
      }
    }
    function syncScroll() {
      if (disposed || root.hidden) return;
      const top = area.scrollTop, left = area.scrollLeft;
      view.top = top; view.left = left;
      const fullHighlight = lineCount <= 400 && (lastText?.length ?? 0) <= 32 * 1024;
      const start = Math.max(0, Math.floor(top / lineHeight) - 8);
      const end = Math.min(lineCount, start + Math.ceil((area.clientHeight || 600) / lineHeight) + 16);
      if (start === paintedStart && end === paintedEnd && lastText === paintedText) {
        const offsetY = 8 + start * lineHeight - top;
        gutterTrack.style.transform = `translate3d(0, ${offsetY}px, 0)`;
        pre.style.transform = `translate3d(${-left}px, ${fullHighlight ? -top : offsetY - 8}px, 0)`;
        return;
      }
      schedule();
    }
    function schedule() { if (!disposed && !frame) frame = requestAnimationFrame(draw); }
    function snapshot() {
      if (root.isConnected && !root.hidden && !area.hidden) {
        view = { start: area.selectionStart, end: area.selectionEnd, direction: area.selectionDirection, top: area.scrollTop, left: area.scrollLeft };
      }
      return { ...view };
    }
    function restore(position) {
      view = { ...position };
      area.setSelectionRange(view.start, view.end, view.direction);
      area.scrollTop = view.top; area.scrollLeft = view.left;
      schedule();
    }
    function selection() {
      snapshot();
      active = 0;
      const end = area.selectionStart;
      for (let i = 0; i < end; i++) if (area.value.charCodeAt(i) === 10) active++;
      schedule();
    }
    function render(text) {
      if (lastText !== text) {
        const firstRender = lastText === undefined;
        lastText = text;
        if (area.value !== text) {
          const position = firstRender ? { start: 0, end: 0, direction: 'none', top: 0, left: 0 } : snapshot();
          area.value = text;
          restore(position);
        }
        lines = text.split('\n');
        lineCount = lines.length;
        gutter.style.width = `calc(${Math.max(3, String(lineCount).length)}ch + 32px)`;
        paintedText = undefined;
      }
      selection();
    }
    area.addEventListener('input', () => { render(area.value); onInput(area.value); });
    area.addEventListener('scroll', syncScroll, { passive: true });
    area.addEventListener('select', selection); area.addEventListener('keyup', selection); area.addEventListener('click', selection);
    area.addEventListener('keydown', e => {
      if (e.key === 'Tab' && !area.readOnly) { e.preventDefault(); document.execCommand('insertText', false, '  '); }
    });
    const resize = new ResizeObserver(() => { paintedStart = -1; schedule(); }); resize.observe(content);
    return { root, area, render, snapshot, restore,
      focus(position = snapshot()) { area.focus({ preventScroll: true }); restore(position); selection(); },
      dispose() { disposed = true; cancelAnimationFrame(frame); resize.disconnect(); root.remove(); } };
  }
  window.__agyRawEditor = { create };
})();
