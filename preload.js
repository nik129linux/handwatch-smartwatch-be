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
