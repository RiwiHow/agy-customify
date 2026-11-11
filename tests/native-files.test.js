import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/injections/native-files.js', import.meta.url), 'utf8');

function setup() {
  const root = 'file:///d%3A/work', uri = root + '/notes.md';
  const files = new Map([[uri, new TextEncoder().encode('original\r\n')]]), calls = [];
  const directories = new Set([root]);
  const ls = {
    async statUri({ uri: u }) {
      if (directories.has(u)) return { fileType: 2, size: 0 };
      if (!files.has(u)) throw Error('not_found');
      return { fileType: 1, size: files.get(u).length };
    },
    async readFile({ uri: u }) {
      if (!files.has(u)) throw Error('not_found');
      return { content: files.get(u) };
    },
    async writeFile(req) {
      calls.push(req);
      if (files.has(req.uri) && !req.overwrite) throw Error('already_exists');
      files.set(req.uri, req.content);
    },
    async createDirectory(req) { calls.push(req); directories.add(req.uri); },
    async deleteFileOrDirectory(req) { calls.push(req); files.delete(req.uri); if (req.recursive) directories.delete(req.uri); },
  };
  const treeId = { kind: 'cascadeId', cascadeId: 'session' };
  const tab = { id: 'file__' + uri, content: { type: 'fileView', fileView: { fileUri: uri } } };
  const state = { sidePanelV2: { conversationPanes: { session: { tabs: [tab], activeTabId: tab.id } } } };
  const store = { getState: () => state, dispatch: () => {} };
  const core = { projectManagementService: { lsClient: ls } };
  const el = { __reactFiber$test: { memoizedProps: { rootUris: [root], treeId, tab }, dependencies: { firstContext: { memoizedValue: { core }, next: { memoizedValue: { store } } } } }, closest: () => null };
  const sandbox = { window: {}, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, location: { pathname: '/c/session', search: '?project=project' } };
  vm.runInNewContext(source, sandbox);
  const api = sandbox.window.__agyNativeFiles;
  return { api, ctx: api.context(el), files, uri, root, calls, directories };
}

test('URI canonicalization, boundaries and special characters', () => {
  const { api } = setup();
  assert.equal(api.canonical('file:///D%3A/work/a.md'), '/d:/work/a.md');
  assert.equal(api.contains('file:///d:/work', 'file:///d%3A/work/a.md'), true);
  assert.equal(api.contains('file:///d:/work', 'file:///d:/workspace/a.md'), false);
  assert.equal(api.contains('file:///d:/work', 'file:///d:/work/../private/a.md'), false);
  const u = api.childUri('file:///d%3A/work', 'note #1%.md');
  assert.equal(api.basename(u), 'note #1%.md');
  assert.equal(api.parent(u), 'file:///d%3A/work');
  assert.equal(api.displayPath(u), 'D:\\work\\note #1%.md');
  assert.equal(api.displayPath('file:///home/test/a%20b.txt'), '/home/test/a b.txt');
  assert.equal(api.displayPath('file://server/share/a.txt'), '\\\\server\\share\\a.txt');
  for (const name of ['', '.', '..', '../x', 'a/b', 'a\\b', ' x']) assert.throws(() => api.childUri('file:///d:/work', name));
});

test('UTF-8 BOM and LF/CRLF round trips, reject binary and invalid encodings', () => {
  const { api } = setup();
  for (const text of ['hello\nworld\n', '\uFEFFhello\r\nworld\r\n', '']) {
    const bytes = new TextEncoder().encode(text), doc = api.decode(bytes);
    assert.deepEqual(api.encode(doc, doc.text), bytes);
  }
  for (const bytes of [new Uint8Array([0, 1]), new Uint8Array([255]), new Uint8Array(2 * 1024 * 1024 + 1)]) {
    assert.throws(() => api.decode(bytes));
  }
});

test('save preserves newline and refuses external changes and missing files', async () => {
  const { ctx, uri, files, calls } = setup();
  const original = await ctx.read(uri);
  const saved = await ctx.save(uri, original, 'updated\n');
  assert.equal(new TextDecoder().decode(saved.bytes), 'updated\r\n');
  assert.equal(calls[0].conversationId, 'session');
  files.set(uri, new TextEncoder().encode('external'));
  await assert.rejects(ctx.save(uri, saved, 'local'), /modified on disk/);
  assert.equal(new TextDecoder().decode(files.get(uri)), 'external');
  files.delete(uri);
  await assert.rejects(ctx.save(uri, saved, 'local'), /not_found/);
});

test('create, directory duplicate protection and root deletion guard', async () => {
  const { ctx, uri, root, files, calls, directories } = setup();
  await assert.rejects(ctx.create(root, 'notes.md'), /already_exists/);
  const created = await ctx.create(root, 'new.md');
  assert.equal(files.get(created).length, 0);
  await assert.rejects(ctx.remove(root), /root directory/);
  await ctx.remove(created);
  assert.equal(files.has(created), false);
  assert.equal(calls.at(-1).recursive, false);
  const directory = await ctx.createDirectory(root, 'notes');
  assert.equal(directories.has(directory), true);
  await assert.rejects(ctx.createDirectory(root, 'notes'), /already exists/);
  await assert.rejects(ctx.createDirectory(root, 'notes.md'), /already exists/);
  await assert.rejects(ctx.remove(root, true), /root directory/);
  await ctx.remove(directory, true);
  assert.equal(directories.has(directory), false);
  assert.equal(calls.at(-1).recursive, true);
  assert.equal(files.has(uri), true);
});
