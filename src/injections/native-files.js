(() => {
  const maxSize = 2 * 1024 * 1024;
  function ancestors(el) {
    const result = [];
    let f = el?.[Object.keys(el).find(k => k.startsWith('__reactFiber$'))];
    for (let n = 0; f && n < 150; f = f.return, n++) result.push(f);
    return result;
  }
  function canonical(uri) {
    const u = new URL(uri);
    if (u.protocol !== 'file:') throw Error('Only local files are supported');
    const path = decodeURIComponent(u.pathname);
    return `${u.host}${path.replace(/^\/([A-Z]):/, (_, d) => `/${d.toLowerCase()}:`).replace(/\/$/, '')}`;
  }
  const parent = uri => { const u = new URL(uri); u.pathname = u.pathname.slice(0, u.pathname.lastIndexOf('/')); return u.href; };
  const basename = uri => decodeURIComponent(new URL(uri).pathname.split('/').pop());
  function displayPath(uri) {
    const url = new URL(uri), path = decodeURIComponent(url.pathname);
    if (url.protocol !== 'file:') return decodeURI(uri);
    if (url.host) return `\\\\${url.host}${path.replace(/\//g, '\\')}`;
    if (/^\/[a-z]:/i.test(path)) return path.slice(1).replace(/^[a-z]/, d => d.toUpperCase()).replace(/\//g, '\\');
    return path;
  }
  const contains = (root, uri) => {
    const r = canonical(root), u = canonical(uri);
    return u === r || u.startsWith(`${r}/`);
  };
  function childUri(directory, name) {
    if (!name || name !== name.trim() || name === '.' || name === '..' || /[/\\]/.test(name)) {
      throw Error('Invalid file or folder name');
    }
    const u = new URL(directory);
    u.pathname = `${u.pathname.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
    return u.href;
  }
  function decode(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length > maxSize) throw Error('Only UTF-8 text files up to 2 MiB are supported');
    if (bytes.includes(0)) throw Error('Binary files cannot be edited');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw Error('File is not valid UTF-8 text'); }
    const bom = text.startsWith('\uFEFF');
    if (bom) text = text.slice(1);
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    return { text: text.replace(/\r\n|\r/g, '\n'), bom, newline };
  }
  function encode(doc, text) {
    const normalized = text.replace(/\r\n|\r/g, '\n');
    const body = doc.newline === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
    return new TextEncoder().encode((doc.bom ? '\uFEFF' : '') + body);
  }
  const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  function showMenu(items) {
    const native = window.electronNative;
    if (typeof native?.showContextMenu !== 'function') throw Error('Native context menu API is unavailable');
    return native.showContextMenu(items.map(({ id, label, disabled = false }) => ({ id, label, type: 'normal', disabled })));
  }
  const closeMenu = () => Promise.resolve(window.electronNative?.closeContextMenu?.());
  function context(el) {
    let store, core, treeId, tab, roots, entry, router;
    const seen = new Set();
    for (const f of ancestors(el)) {
      const props = f.memoizedProps;
      if (props?.tab && props?.treeId && !tab) { tab = props.tab; treeId = props.treeId; }
      if (props?.entry && !entry) entry = props.entry;
      if (props?.rootUris && !roots) roots = props.rootUris;
      for (let d = f.dependencies?.firstContext; d; d = d.next) {
        const v = d.memoizedValue;
        if (!v || seen.has(v)) continue;
        seen.add(v);
        if (v.core?.projectManagementService) core = v.core;
        if (v.store?.getState && v.store.getState().sidePanelV2) store = v.store;
        if (v.navigate && v.history) router = v;
      }
    }
    const ls = core?.projectManagementService?.lsClient;
    if (!ls?.statUri || !ls?.readFile || !ls?.writeFile || !ls?.deleteFileOrDirectory || !store) throw Error('Native file API is unavailable in this Antigravity version');
    if (!treeId) {
      const id = /^\/c\/([^/]+)/.exec(location.pathname)?.[1];
      const project = new URLSearchParams(location.search).get('project');
      if (id) treeId = { kind: 'cascadeId', cascadeId: id };
      else if (project) treeId = { kind: 'newConversation', projectId: project };
      else throw Error('Open a project or conversation first');
    }
    const getPane = () => {
      const panels = store.getState().sidePanelV2;
      return treeId.kind === 'cascadeId' ? panels.conversationPanes[treeId.cascadeId]
        : treeId.kind === 'newConversation' ? panels.newConversationPanes[treeId.projectId]
        : treeId.kind === 'home' ? panels.homePane : panels.customViewPanes[treeId.viewId];
    };
    const pane = getPane();
    tab ??= pane?.tabs.find(t => t.id === pane.activeTabId);
    if (!roots) {
      const tree = el?.closest('[data-side-panel-body]')?.querySelector('[data-testid="tab-file-tree-sidebar"] [role="tree"]');
      for (const f of ancestors(tree)) if (f.memoizedProps?.rootUris) { roots = f.memoizedProps.rootUris; break; }
    }
    if (!roots?.length) {
      const uri = el?.closest('[data-side-panel-body]')?.querySelector('nav [data-uri]')?.dataset.uri;
      const file = tab?.content?.fileView?.fileUri;
      if (uri && file && canonical(uri) !== canonical(file)) roots = [uri];
    }
    const conversationId = treeId.kind === 'cascadeId' ? treeId.cascadeId : undefined;
    const options = { conversationId, userInitiated: true };
    const dispatch = (action, payload) => store.dispatch({ type: `sidePanelV2/${action}`, payload: { treeId, ...payload } });
    return {
      treeId, tab, roots: roots ?? [], entry, conversationId,
      key: JSON.stringify(treeId), uri: tab?.content?.type === 'fileView' ? tab.content.fileView.fileUri : undefined,
      async read(uri) {
        canonical(uri);
        const stat = await ls.statUri({ uri, ...options });
        if (stat.fileType !== 1 || Number(stat.size) > maxSize) throw Error('Only regular text files up to 2 MiB are supported');
        const { content } = await ls.readFile({ uri, ...options });
        return { bytes: content, ...decode(content) };
      },
      async save(uri, doc, text) {
        const latest = await this.read(uri);
        if (!equal(latest.bytes, doc.bytes)) throw Error('File was modified on disk; draft kept. Copy your changes or revert before saving.');
        const bytes = encode(doc, text);
        if (bytes.length > maxSize) throw Error('Edited file exceeds 2 MiB');
        await ls.writeFile({ uri, content: bytes, overwrite: true, ...options });
        return { bytes, ...decode(bytes) };
      },
      async create(directory, name) {
        const uri = childUri(directory, name);
        await ls.writeFile({ uri, content: new Uint8Array(), overwrite: false, ...options });
        return uri;
      },
      async createDirectory(directory, name) {
        if (!ls.createDirectory) throw Error('Creating folders is not supported in this version');
        const uri = childUri(directory, name);
        const exists = await ls.statUri({ uri, ...options }).then(() => true, () => false);
        if (exists) throw Error('A file or folder with that name already exists');
        await ls.createDirectory({ uri, ...options });
        return uri;
      },
      async remove(uri, directory = false) {
        if (roots?.some(r => canonical(r) === canonical(uri))) throw Error('Cannot delete workspace root directory');
        await ls.deleteFileOrDirectory({ uri, recursive: directory, ...options });
      },
      open(uri) {
        dispatch('setContent', { content: { type: 'fileView', fileView: uri ? { fileUri: uri, cascadeId: conversationId } : {} }, keepOpen: true });
        dispatch('setSidebarOpen', { mode: 'fileView', open: true });
        const id = getPane()?.activeTabId;
        if (router && id) return router.navigate({ search: prev => ({ ...prev, tab: id }) });
      },
      pin() { if (tab) dispatch('promoteTab', { tabId: tab.id }); },
      close(uri, directory = false) {
        for (const t of getPane()?.tabs ?? []) {
          const fileUri = t.content.type === 'fileView' && t.content.fileView.fileUri;
          if (fileUri && (directory ? contains(uri, fileUri) : canonical(fileUri) === canonical(uri))) {
            dispatch('clearContent', { tabId: t.id, recordClosed: false });
          }
        }
        const id = getPane()?.activeTabId;
        if (router) return router.navigate({ search: prev => ({ ...prev, tab: id }) });
      },
    };
  }
  window.__agyNativeFiles = { context, ancestors, canonical, parent, basename, displayPath, childUri, contains, decode, encode, equal, showMenu, closeMenu };
})();
