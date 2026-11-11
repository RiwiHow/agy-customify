import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const configFile = Bun.file(new URL('../config.json', import.meta.url));
const config = (await configFile.exists()) ? await configFile.json() : {};

const { values: args } = parseArgs({
  options: {
    cdp: { type: 'string' },
    port: { type: 'string' },
    exe: { type: 'string' },
    'no-launch': { type: 'boolean', default: false },
    match: { type: 'string' },
    list: { type: 'boolean', default: false },
    once: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (args.help) {
  console.log(`Usage: bun run start [options]
  --exe PATH     Antigravity executable path (overrides config.json)
  --port PORT    Remote debugging port (default: config.json or 9222)
  --cdp URL      CDP HTTP endpoint (default: http://127.0.0.1:<port>)
  --no-launch    Do not auto-launch Antigravity if CDP is not listening
  --match TEXT   Only inject into pages whose URL contains TEXT (default: all localhost pages)
  --list         List available pages without injecting
  --once         Inject once into current pages and exit
  -h, --help     Show this help message`);
  process.exit(0);
}

const port = Number(args.port ?? config.port ?? 9222);
const exePath = args.exe ?? config.executablePath;
const cdpBase = args.cdp ?? `http://127.0.0.1:${port}`;
const listUrl = new URL('/json/list', cdpBase);

const css = await Bun.file(new URL('./injections/styles.css', import.meta.url)).text();
const styleScript = `(() => {
  const apply = () => {
    const id = 'agy-customify-styles';
    const style = document.getElementById(id) ?? document.createElement('style');
    style.id = id;
    style.textContent = ${JSON.stringify(css)};
    document.head.appendChild(style);
  };
  if (document.head) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });
})()`;

const script = [
  styleScript,
  ...(await Promise.all([
    './injections/native-files.js',
    './injections/raw-text-editor.js',
    './injections/file-editor-entry.js',
  ].map(path => Bun.file(new URL(path, import.meta.url)).text()))),
].join('\n;\n');
const active = new Map();
let lastStatus = '';

function logStatus(msg) {
  if (msg !== lastStatus) {
    console.log(msg);
    lastStatus = msg;
  }
}

async function isCdpAlive() {
  try {
    const res = await fetch(listUrl, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

if (!args.list && !args['no-launch'] && exePath && !(await isCdpAlive())) {
  const fullPath = resolve(exePath);
  if (!(await Bun.file(fullPath).exists())) {
    console.error(`Executable not found: ${fullPath} (configure "executablePath" in config.json)`);
    process.exit(1);
  }
  console.log(`Launching: ${fullPath} --remote-debugging-port=${port}`);
  const child = spawn(fullPath, [`--remote-debugging-port=${port}`], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < 30; i++) {
    if (await isCdpAlive()) break;
    await delay(500);
  }
}

function matchesUrl(url = '') {
  if (args.match) return url.includes(args.match);
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === 'http:' || protocol === 'https:')
      && ['127.0.0.1', 'localhost', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

function inject(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const send = (method, params = {}) => new Promise((res, rej) => {
      const msgId = ++id;
      const onMessage = e => {
        const data = JSON.parse(e.data);
        if (data.id !== msgId) return;
        ws.removeEventListener('message', onMessage);
        data.error ? rej(new Error(data.error.message)) : res(data.result);
      };
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });

    ws.addEventListener('open', async () => {
      try {
        await send('Page.enable');
        await send('Page.addScriptToEvaluateOnNewDocument', { source: script });
        const evaluated = await send('Runtime.evaluate', { expression: script });
        if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text);
        resolve(ws);
      } catch (err) {
        ws.close();
        reject(err);
      }
    }, { once: true });

    ws.addEventListener('error', () => reject(new Error('WebSocket connection failed')), { once: true });
  });
}

while (true) {
  try {
    const res = await fetch(listUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pages = (await res.json()).filter(t => t.type === 'page');

    if (args.list) {
      console.table(pages.map(({ id, title, url }) => ({ id, title, url })));
      break;
    }

    const targets = pages.filter(t => t.webSocketDebuggerUrl && matchesUrl(t.url));
    const currentIds = new Set(targets.map(t => t.id));

    for (const [id, ws] of active) {
      if (!currentIds.has(id) || ws.readyState !== WebSocket.OPEN) {
        ws.close();
        active.delete(id);
      }
    }

    for (const t of targets) {
      if (active.has(t.id)) continue;
      try {
        const ws = await inject(t.webSocketDebuggerUrl);
        ws.addEventListener('close', () => active.delete(t.id), { once: true });
        active.set(t.id, ws);
        console.log(`Injected: ${t.title || t.id}\n  ${t.url}`);
      } catch (err) {
        console.error(`Injection failed (${t.id}): ${err.message}`);
        if (args.once) process.exit(1);
      }
    }

    if (!targets.length) {
      logStatus('Waiting for Antigravity pages... (use --list to inspect pages, --match to filter by URL)');
      if (args.once) process.exit(1);
    } else {
      logStatus(`Watching ${active.size} page(s). Press Ctrl+C to exit.`);
    }
  } catch (err) {
    for (const ws of active.values()) ws.close();
    active.clear();
    logStatus(`Waiting for CDP at ${cdpBase}: ${err.message}`);
    if (args.once || args.list) process.exit(1);
  }

  if (args.once) {
    for (const ws of active.values()) ws.close();
    break;
  }

  await delay(2000);
}
