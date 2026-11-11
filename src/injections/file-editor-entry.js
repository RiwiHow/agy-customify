(() => {
  const key = '__agyFileEditorEntry', previous = window[key];
  const drafts = previous?.drafts ?? new Map();
  previous?.dispose();
  const api = window.__agyNativeFiles;
  if (!api || !window.__agyRawEditor) return;
  let disposed = false, queued = false, modal, toast, toastTimer;
  const mounts = new Map(), selections = new Map();
  function notify(message) {
    toast?.remove(); clearTimeout(toastTimer);
    toast = document.createElement('div'); toast.dataset.agyToast = ''; toast.setAttribute('role', 'alert');
    toast.textContent = message; document.body.appendChild(toast);
    toastTimer = setTimeout(() => toast?.remove(), 8000);
  }
  function button(label, action, parent) {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = label;
    b.onclick = action; parent.appendChild(b); return b;
  }
  function ask(title, message, input = false, confirmLabel = 'OK', inputLabel = 'File name') {
    if (modal) return Promise.resolve(null);
    return new Promise(resolve => {
      const dialog = document.createElement('dialog'); dialog.dataset.agyModal = '';
      if (title.startsWith('Delete')) dialog.dataset.agyDanger = '';
      dialog.innerHTML = `
        <header><strong></strong><button type="button" data-agy-modal-close aria-label="Close"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 6 12 12M6 18 18 6"/></svg></button></header>
        <p></p>
        ${input ? '<label></label><input autocomplete="off" spellcheck="false">' : ''}
        <footer><button type="button" data-cancel>Cancel</button><button type="button" data-agy-primary></button></footer>
      `;
      dialog.querySelector('strong').textContent = title;
      dialog.querySelector('p').textContent = message;
      const field = dialog.querySelector('input');
      if (field) {
        dialog.querySelector('label').textContent = inputLabel;
        field.placeholder = inputLabel === 'Folder name' ? 'e.g. notes' : 'e.g. notes.md';
      }
      const ok = dialog.querySelector('[data-agy-primary]'); ok.textContent = confirmLabel;
      const finish = value => { if (modal !== dialog) return; modal = null; dialog.close(); dialog.remove(); resolve(value); };
      const submit = () => { if (field && !field.value.trim()) { field.focus(); return; } finish(field ? field.value : true); };
      dialog.querySelector('[data-agy-modal-close]').onclick = () => finish(null);
      dialog.querySelector('[data-cancel]').onclick = () => finish(null);
      ok.onclick = submit;
      dialog.addEventListener('cancel', e => { e.preventDefault(); finish(null); });
      dialog.addEventListener('keydown', e => { if (e.key === 'Enter' && field && !e.isComposing) { e.preventDefault(); submit(); } });
      dialog.cancel = () => finish(null);
      modal = dialog; document.body.appendChild(dialog); dialog.showModal(); (field ?? ok).focus();
    });
  }
  function refresh() {
    document.querySelectorAll('[data-testid="file-view-refresh"], [data-testid="tab-file-tree-sidebar"] button[aria-label="Refresh"]').forEach(b => b.click());
  }
  const draftKey = (ctx, uri = ctx.uri) => `${ctx.key}\0${api.canonical(uri)}`;
  const dirty = d => !!d && d.text !== d.original.text;
  function update(m) {
    const d = drafts.get(m.id), busy = !!d?.busy;
    m.edit.setAttribute('aria-pressed', String(!!d?.editing));
    m.modeGroup.toggleAttribute('data-agy-edit-selected', !!d?.editing);
    m.edit.disabled = busy; m.save.disabled = !dirty(d) || busy;
    m.discard.disabled = !d || busy;
    const status = busy ? 'Working…' : dirty(d) ? '● Unsaved' : d ? 'Saved' : '';
    if (m.status.textContent !== status) m.status.textContent = status;
    m.area.hidden = !d?.editing; m.area.readOnly = busy; m.host.toggleAttribute('data-agy-editing', !!d?.editing);
    m.editor.root.hidden = !d?.editing;
    if (d) m.editor.render(d.text);
  }
  async function run(m, action) {
    try { await action(); } catch (e) { if (!disposed) notify(e.message ?? String(e)); }
    finally { if (!disposed) update(m); }
  }
  async function edit(m) {
    let d = drafts.get(m.id);
    if (d?.busy || m.edit.disabled) return;
    const position = m.editor.snapshot();
    if (!d || (!d.editing && !dirty(d))) {
      m.edit.disabled = true;
      const original = await m.ctx.read(m.ctx.uri);
      if (disposed) return;
      d = { original, text: original.text, editing: false, busy: false, uri: m.ctx.uri, ctx: m.ctx, view: position };
      drafts.set(m.id, d); m.ctx.pin();
    }
    d.editing = !d.editing;
    d.view = position;
    update(m); if (d.editing && m.area.isConnected) m.editor.focus(position);
  }
  async function save(m) {
    const d = drafts.get(m.id);
    if (!dirty(d) || d.busy) return;
    d.busy = true; update(m);
    const text = d.text;
    try {
      d.original = await m.ctx.save(d.uri, d.original, text);
      if (!disposed) { refresh(); notify('Saved'); }
    } finally { d.busy = false; }
  }
  async function discard(m) {
    const d = drafts.get(m.id);
    if (!d || d.busy) return;
    d.busy = true; update(m);
    try {
      if (dirty(d) && !await ask('Discard Changes', `Discard unsaved changes to ${api.basename(d.uri)} and reload from disk?`, false, 'Discard')) return;
      d.original = await m.ctx.read(d.uri); d.text = d.original.text;
    } finally { d.busy = false; }
  }
  async function create(ctx, directory, folder = false) {
    try {
      const name = await ask(folder ? 'New Folder' : 'New File', `Create in ${api.displayPath(directory)}`, true, 'Create', folder ? 'Folder name' : 'File name');
      if (name === null || disposed) return;
      const uri = folder ? await ctx.createDirectory(directory, name) : await ctx.create(directory, name);
      if (disposed) return;
      if (folder) selections.set(ctx.key, { uri, fileType: 2 }); else await ctx.open(uri);
      refresh(); notify(`Created ${name}`);
    } catch (e) { if (!disposed) notify(e.message); }
  }
  async function remove(ctx, uri, directory = false) {
    try {
      const label = directory ? 'Folder' : 'File';
      const affected = [...drafts].filter(([, d]) => d.ctx.key === ctx.key && (directory ? api.contains(uri, d.uri) : api.canonical(d.uri) === api.canonical(uri)));
      if (!await ask(`Delete ${label}`, `Permanently delete this ${label.toLowerCase()}${directory ? ' and all of its contents' : ''}?\n${api.displayPath(uri)}${affected.some(([, d]) => dirty(d)) ? '\nUnsaved draft changes will also be discarded.' : ''}\nThis action cannot be undone.`, false, 'Delete')) return;
      if (disposed) return;
      await ctx.remove(uri, directory);
      for (const [id] of affected) drafts.delete(id);
      const selected = selections.get(ctx.key);
      if (selected?.uri && api.contains(uri, selected.uri)) selections.delete(ctx.key);
      if (!disposed) { await ctx.close(uri, directory); refresh(); notify(`${label} deleted`); }
    } catch (e) { if (!disposed) notify(e.message); }
  }
  function mountViewer(viewer) {
    const ctx = api.context(viewer);
    if (!ctx.uri || ctx.tab?.content?.fileView?.showDiff) {
      const old = mounts.get(viewer); if (old) unmount(old);
      return;
    }
    const id = draftKey(ctx), old = mounts.get(viewer);
    if (old?.id === id && old.tools.isConnected && old.host.isConnected && old.edit.isConnected) { old.ctx = ctx; update(old); return; }
    if (old) unmount(old);
    const split = viewer.querySelector('[data-split-root]');
    const host = split?.firstElementChild ?? viewer;
    const scope = viewer.closest('[data-side-panel-focus-scope]');
    const anchor = scope?.querySelector('[data-testid="file-view-refresh"]');
    if (!anchor) return;
    const nativeModes = [...anchor.parentElement.querySelectorAll('[role="button"]')].find(el => el.textContent.trim() === 'Preview' || el.textContent.trim() === 'Raw')?.parentElement;
    const modeGroup = nativeModes ?? document.createElement('div');
    if (!nativeModes) {
      modeGroup.dataset.agyModeGroup = '';
      const overflow = anchor.parentElement.querySelector('[data-testid="more-actions-overflow"]');
      (overflow ?? anchor).before(modeGroup);
    }
    const tools = document.createElement('div'); tools.dataset.agyFileTools = '';
    const status = document.createElement('span'); status.setAttribute('aria-live', 'polite');
    const m = { viewer, ctx, id, tools, host, status, modeGroup, ownModes: !nativeModes };
    m.edit = button('Edit', () => run(m, () => edit(m)), modeGroup);
    m.edit.dataset.agyEditMode = ''; m.edit.title = 'Edit text (click again to return to view)';
    m.save = button('Save', () => run(m, () => save(m)), tools); m.save.title = 'Save (Ctrl/Cmd+S)';
    m.discard = button('Revert', () => run(m, () => discard(m)), tools); m.discard.title = 'Discard draft and reload from disk';
    tools.appendChild(status); anchor.before(tools);
    m.editor = window.__agyRawEditor.create(host, ctx.uri, text => { const d = drafts.get(id); if (d) { d.text = text; update(m); } });
    m.area = m.editor.area;
    host.dataset.agyEditHost = ''; mounts.set(viewer, m); update(m);
    const view = drafts.get(id)?.view; if (view) m.editor.restore(view);
  }
  function unmount(m) {
    const d = drafts.get(m.id); if (d) d.view = m.editor.snapshot();
    m.edit.remove(); m.modeGroup.removeAttribute('data-agy-edit-selected'); if (m.ownModes) m.modeGroup.remove();
    m.tools.remove(); m.editor.dispose(); m.host.removeAttribute('data-agy-edit-host'); m.host.removeAttribute('data-agy-editing'); mounts.delete(m.viewer);
  }
  function mountTree(tree) {
    if (tree.querySelector('[data-agy-tree-tools]')) return;
    const tools = document.createElement('div'); tools.dataset.agyTreeTools = '';
    button('+ New File', async () => {
      try {
        const selected = tree.querySelector('[role="treeitem"][aria-selected="true"]') ?? tree.querySelector('[role="treeitem"]');
        const ctx = api.context(selected ?? tree), entry = selections.get(ctx.key) ?? ctx.entry;
        const directory = entry?.fileType === 2 ? entry.uri : entry?.uri ? api.parent(entry.uri) : ctx.roots[0];
        if (!directory) throw Error('Expand the workspace file tree and select a folder first');
        await create(ctx, directory);
      } catch (e) { notify(e.message); }
    }, tools);
    tree.prepend(tools);
  }
  function reconcile() {
    if (disposed) return;
    for (const m of mounts.values()) if (!m.viewer.isConnected || !m.tools.isConnected || !m.host.isConnected) unmount(m);
    for (const viewer of document.querySelectorAll('[data-side-panel-body] [role="region"][aria-label="File Viewer"]')) {
      try { mountViewer(viewer); } catch {}
    }
    document.querySelectorAll('[data-testid="tab-file-tree-sidebar"]').forEach(mountTree);
  }
  const observer = new MutationObserver(records => {
    if (!records.some(r => !r.target.closest?.('[data-agy-file-tools], [data-agy-tree-tools], [data-agy-modal], [data-agy-toast], [data-agy-raw-editor]'))) return;
    if (!queued) { queued = true; setTimeout(() => { queued = false; reconcile(); }, 0); }
  });
  function dismissMenu() { api.closeMenu().catch(() => {}); }
  function onKey(e) {
    if (e.key === 'Escape') dismissMenu();
    if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's' || e.altKey) return;
    const m = [...mounts.values()].find(m => m.viewer.contains(document.activeElement) || m.tools.contains(document.activeElement) || m.edit === document.activeElement);
    if (!m) return;
    e.preventDefault(); e.stopImmediatePropagation(); run(m, () => save(m));
  }
  function guardClose(e) {
    const target = e.target.closest?.('[data-side-panel-strip] .agy-aux-tab');
    const close = e.target.closest?.('button[aria-label^="Close "]');
    if (!target || !(close || (e.type === 'auxclick' && e.button === 1))) return;
    const tabId = target.querySelector('[data-tab-id]')?.dataset.tabId;
    let ctx; try { ctx = api.context(target); } catch { return; }
    const d = [...drafts.values()].find(d => d.ctx.key === ctx.key && d.ctx.tab?.id === tabId && (dirty(d) || d.busy));
    if (!d) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (d.busy) { notify('File operation in progress, please wait'); return; }
    ask('Unsaved Changes', `${api.basename(d.uri)} has unsaved changes. Your draft will be kept if you close the tab and can be resumed when reopened.`, false, 'Close and Keep Draft')
      .then(yes => { if (yes && !disposed && !d.busy) return d.ctx.close(d.uri); }).catch(e => notify(e.message));
  }
  function onClick(e) {
    guardClose(e);
    if (e.defaultPrevented) return;
    const choice = e.target.closest?.('[role="button"]');
    if (choice && ['Preview', 'Raw'].includes(choice.textContent.trim())) {
      for (const m of mounts.values()) if (m.modeGroup.contains(choice)) {
        const d = drafts.get(m.id); if (d) { d.view = m.editor.snapshot(); d.editing = false; }
        update(m);
      }
    }
    dismissMenu();
    const row = e.target.closest?.('[data-testid="tab-file-tree-sidebar"] [role="treeitem"]');
    if (row) { try { const ctx = api.context(row); if (ctx.entry) selections.set(ctx.key, ctx.entry); } catch {} }
  }
  async function onContext(e) {
    const sidebar = e.target.closest?.('[data-testid="tab-file-tree-sidebar"]');
    if (!sidebar) return;
    const row = e.target.closest?.('[data-testid="tab-file-tree-sidebar"] [role="treeitem"]');
    let ctx; try { ctx = api.context(row ?? sidebar.querySelector('[role="tree"]') ?? sidebar); } catch { return; }
    if (row && !ctx.entry?.uri) return;
    e.preventDefault(); e.stopImmediatePropagation(); dismissMenu();
    const items = [], actions = new Map();
    const item = (id, label, action) => { items.push({ id, label }); actions.set(id, action); };
    const entry = row ? ctx.entry : null;
    if (!entry) {
      const directory = ctx.roots[0];
      if (!directory) { notify('Workspace root directory not found'); return; }
      item('agy-new-folder', 'New Folder…', () => create(ctx, directory, true));
      item('agy-new-file', 'New File…', () => create(ctx, directory));
    } else if (entry.fileType === 2) {
      item('agy-new-file', 'New File…', () => create(ctx, entry.uri));
      const root = ctx.roots.some(uri => api.canonical(uri) === api.canonical(entry.uri));
      if (!root) item('agy-delete-folder', 'Delete Folder…', () => remove(ctx, entry.uri, true));
    } else if (entry.fileType === 1) item('agy-delete-file', 'Delete File…', () => remove(ctx, entry.uri));
    if (!items.length) return;
    try {
      const selected = await api.showMenu(items);
      if (!disposed) await actions.get(selected)?.();
    } catch (error) {
      if (!disposed) notify(error.message);
    }
  }
  function beforeUnload(e) { if ([...drafts.values()].some(d => dirty(d) || d.busy)) { e.preventDefault(); e.returnValue = ''; } }
  function start() {
    if (disposed) return;
    reconcile(); observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', onKey, true); document.addEventListener('click', onClick, true); document.addEventListener('auxclick', guardClose, true);
    document.addEventListener('contextmenu', onContext, true); window.addEventListener('beforeunload', beforeUnload);
  }
  window[key] = {
    drafts,
    dispose() {
      disposed = true; observer.disconnect(); modal?.cancel(); dismissMenu(); toast?.remove(); clearTimeout(toastTimer);
      document.removeEventListener('DOMContentLoaded', start); document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('click', onClick, true); document.removeEventListener('auxclick', guardClose, true); document.removeEventListener('contextmenu', onContext, true);
      window.removeEventListener('beforeunload', beforeUnload);
      for (const m of mounts.values()) unmount(m);
      document.querySelectorAll('[data-agy-tree-tools], [data-agy-file-editor-entry]').forEach(e => e.remove());
    },
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
