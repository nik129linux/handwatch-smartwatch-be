/* ==========================================================================
   main.js — Hand Hygiene Watch desktop app (Electron)
   Real desktop window around the same static prototype: no server,
   no build step, index.html loaded straight from disk.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');

let win = null;

/* --- wrist:send payload safety: shared by the IPC handler and the tests -- */
const KINDS = ['reminder', 'doubtful', 'ok', 'end'];
const LANGS = ['en', 'es'];
/* letters, digits, spaces and a few marks: safe inside the remote
   shell's single quotes, and all the watch font can draw anyway */
const clean = (v, n) => String(v || '').replace(/·/g, '-')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   /* Lávate -> Lavate */
  .replace(/[^A-Za-z0-9 ?.,:-]/g, '').slice(0, n).trim();
/* The Wear app draws Spanish, so its extras keep accents and ¿/¡.
   Quotes, backslashes and every shell metacharacter still never pass. */
const cleanWear = (v, n) => String(v || '').replace(/·/g, '-')
  .replace(/[^A-Za-z0-9À-ÖØ-öø-ÿÑñÜü¿¡ ?.,:!-]/g, '').slice(0, n).trim();
const clampInt = (v, fallback) => {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(99, Math.trunc(n)));
};
/* One sanitizer for the wrist:send payload. Bad values become the same
   defaults js/wrist.js uses (en, 0, 15); numbers are clamped to 0..99. */
function sanitizeWrist(msg) {
  const m = msg || {};
  return {
    title: cleanWear(m.title, 40),
    body: cleanWear(m.body, 80),
    phoneTitle: clean(m.title, 40),
    phoneBody: clean(m.body, 80),
    kind: KINDS.includes(m.kind) ? m.kind : 'reminder',
    lang: LANGS.includes(m.lang) ? m.lang : 'en',
    done: clampInt(m.done, 0),
    plan: clampInt(m.plan, 15)
  };
}

/* --- event log file: the Electron copy of the on-watch log ------------- */

function logPath() {
  return path.join(app.getPath('userData'), 'log.json');
}

/* --- on-device model: the renderer sends a prompt, main talks to
   Ollama on localhost and hands the raw text back. Aggregates only
   ever reach this point; validation and grounding happen in js/ai.js.
   Every failure is a value: the page falls back to its rules. */
function setupAIIPC() {
  let Ollama = null;
  try {
    Ollama = require('./ai/ollama.js');
  } catch (e) { /* packaged without the ai folder — rules only */ }
  ipcMain.handle('ai:query', async (_ev, prompt) => {
    try {
      if (!Ollama) return { ok: false, reason: 'no-model' };
      return await Ollama.query(String(prompt === undefined ? '' : prompt));
    } catch (e) {
      return { ok: false, reason: 'down' };
    }
  });
}

/* --- real watch: the page hands over an already-built push (title, one
   line, priority, kind). Shape is re-checked here so nothing else can ride
   along. Route 1: a phone on USB/Wi-Fi adb running the Hand Hygiene relay
   app (android/), offline, the watch mirrors its notification. Route 2:
   ntfy.sh. Failure is a value, never a throw. */
function setupWristIPC() {
  const { execFile } = require('child_process');
  const TOPIC_RE = /^[a-z0-9_-]{8,64}$/;

  function adb(args) {
    return new Promise((resolve) => {
      execFile('adb', args, { timeout: 4000 }, (err, out) =>
        resolve(err ? null : String(out)));
    });
  }

  /* Every attached target, by serial. A phone runs the relay app
     (co.ucc.handhygiene); a Wear OS emulator runs the watch app
     (co.ucc.handhygiene.wear). Both can be live at once. */
  const RELAY = 'co.ucc.handhygiene';
  const WEAR = 'co.ucc.handhygiene.wear';
  async function targets() {
    const out = await adb(['devices']);
    if (!out) return [];
    const serials = out.split('\n').slice(1)
      .map((l) => l.trim().split(/\s+/))
      .filter((f) => f[1] === 'device').map((f) => f[0]);
    const found = [];
    for (const serial of serials) {
      const pkgs = (await adb(['-s', serial, 'shell', 'pm list packages co.ucc.handhygiene']) || '')
        .split('\n').map((l) => l.trim().replace(/^package:/, ''));
      if (pkgs.includes(WEAR)) found.push({ serial, type: 'wear' });
      else if (pkgs.includes(RELAY)) found.push({ serial, type: 'phone' });
    }
    return found;
  }

  async function sendTo(t, m) {
    const wear = t.type === 'wear';
    const title = wear ? m.title : m.phoneTitle;
    const body = wear ? m.body : m.phoneBody;
    if (!title) return false;
    let extras = " --es title '" + title + "' --es body '" + body + "' --es kind '" + m.kind + "'";
    /* The Wear app needs the language and the Home counters with every alert. */
    if (wear) extras += " --es lang '" + m.lang + "' --ei done " + m.done + " --ei plan " + m.plan;
    const cmd = wear
      ? 'am start -n ' + WEAR + '/.AlertActivity' + extras
      : 'am broadcast -n ' + RELAY + '/.NotifyReceiver -a ' + RELAY + '.NOTIFY' + extras;
    const out = await adb(['-s', t.serial, 'shell', cmd]);
    return !!out && !/Error|Exception/.test(out);
  }

  /* --- the way back: both apps log "answer=yes|no" under the tag HHW
     (watch crown or tap, phone notification buttons). Main tails each
     device's log over adb and hands every answer to the page. */
  const tails = new Map();
  /* logcat -T takes 'MM-DD hh:mm:ss.mmm': only answers from now on */
  function stamp() {
    const d = new Date(), p = (n, w = 2) => String(n).padStart(w, '0');
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' +
      p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.' + p(d.getMilliseconds(), 3);
  }
  function listen(t) {
    if (tails.has(t.serial)) return;
    const { spawn } = require('child_process');
    if (t.type === 'phone') {
      adb(['-s', t.serial, 'shell', 'am start-foreground-service -n ' + RELAY + '/.RelayService']);
    }
    const proc = spawn('adb', ['-s', t.serial, 'logcat', '-T', stamp(), '-s', 'HHW:I'],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    tails.set(t.serial, proc);
    let buf = '';
    proc.stdout.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const m = line.match(/answer=(yes|no)\b/);
        if (m && win && !win.isDestroyed()) win.webContents.send('wrist:answer', m[1], t.type);
      }
    });
    proc.on('exit', () => { tails.delete(t.serial); });
  }
  app.on('will-quit', () => { for (const p of tails.values()) p.kill(); });

  ipcMain.handle('wrist:send', async (_ev, topic, msg) => {
    try {
      if (!msg) return { ok: false };
      const m = sanitizeWrist(msg);
      if (!m.title && !m.phoneTitle) return { ok: false };
      const routes = [];
      for (const t of await targets()) {
        if (await sendTo(t, m)) { listen(t); routes.push(t.type === 'wear' ? 'watch' : 'phone'); }
      }
      if (routes.length) return { ok: true, route: routes.join(' + ') };
      if (!m.phoneTitle) return { ok: false };
      if (!TOPIC_RE.test(String(topic))) return { ok: false };
      const priority = [1, 2, 3, 4, 5].includes(msg.priority) ? msg.priority : 3;
      const r = await fetch('https://ntfy.sh/' + topic, {
        method: 'POST',
        body: m.phoneBody,
        headers: { Title: m.phoneTitle, Priority: String(priority) },
        signal: AbortSignal.timeout(4000)
      });
      return { ok: r.ok, route: 'ntfy' };
    } catch (e) {
      return { ok: false };
    }
  });
}

function setupLogIPC() {
  ipcMain.handle('log:load', async () => {
    try {
      return fs.readFileSync(logPath(), 'utf8');
    } catch (e) {
      return null; /* first run — no file yet */
    }
  });
  ipcMain.handle('log:save', async (_ev, json) => {
    try {
      if (typeof json === 'string' && json.length < 1024 * 1024) {
        fs.writeFileSync(logPath(), json, 'utf8');
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 640,
    title: 'Hand Hygiene Watch',
    autoHideMenuBar: true,
    backgroundColor: '#101010',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  win.on('closed', () => { win = null; });
}

/* Tests require this file in plain Node to exercise the sanitizer:
   only the Electron main process may start the app. */
if (process.versions.electron) {
  app.whenReady().then(() => {
    setupLogIPC();
    setupAIIPC();
    setupWristIPC();
    createWindow();

    /* Ctrl+Shift+L flips the same theme hook the toggle button uses */
    globalShortcut.register('CommandOrControl+Shift+L', () => {
      if (win && !win.isDestroyed()) {
        win.webContents.executeJavaScript(
          'window.__toggleTheme && window.__toggleTheme()'
        ).catch(() => { /* page not ready yet */ });
      }
    });

    /* F11 fullscreen */
    globalShortcut.register('F11', () => {
      if (win && !win.isDestroyed()) win.setFullScreen(!win.isFullScreen());
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

module.exports = { sanitizeWrist, clean, cleanWear };
