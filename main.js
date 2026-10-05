/* ==========================================================================
   main.js — Hand Hygiene Watch desktop app (Electron)
   Real desktop window around the same static prototype: no server,
   no build step, index.html loaded straight from disk.
   ========================================================================== */

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');

let win = null;

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

app.whenReady().then(() => {
  setupLogIPC();
  setupAIIPC();
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
