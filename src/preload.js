const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  act: (name, payload) => ipcRenderer.send('action', name, payload),
  callouts: (what) => ipcRenderer.send('callouts', what),
  detect: () => ipcRenderer.send('detect'),
  leagues: () => ipcRenderer.invoke('leagues.list'),
  importLeague: (p) => ipcRenderer.invoke('leagues.import', p),
  restore: (json) => ipcRenderer.invoke('restore', json),
  suspendHotkeys: (on) => ipcRenderer.send('hotkeys.suspend', on),
  snap: (id, where) => ipcRenderer.send('overlay.snap', id, where),
  update: (what) => ipcRenderer.send('update', what),
  copy: (text) => ipcRenderer.send('copy', text),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
});
