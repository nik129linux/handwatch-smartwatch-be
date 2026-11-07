/* ==========================================================================
   preload.js — the only bridge between the page and Electron.
   Exposes a file-backed copy of the event log; everything else stays
   exactly as in the browser (context isolation on, no node in the page).
   ========================================================================== */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__logAPI', {
  load: () => ipcRenderer.invoke('log:load'),
  save: (json) => ipcRenderer.invoke('log:save', json)
});

/* Model bridge: prompts go to the main process, which asks Ollama on
   localhost. Absent in a plain browser — then the pages use rules only. */
contextBridge.exposeInMainWorld('__aiAPI', {
  query: (prompt) => ipcRenderer.invoke('ai:query', prompt)
});

/* Real-watch bridge: a short push (title, one line, priority) to ntfy.sh,
   which the phone mirrors to the wrist. Absent in a plain browser. */
contextBridge.exposeInMainWorld('__wristAPI', {
  send: (topic, msg) => ipcRenderer.invoke('wrist:send', topic, msg),
  onAnswer: (fn) => ipcRenderer.on('wrist:answer', (_ev, value, from) => fn(value, from))
});
