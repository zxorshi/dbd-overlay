const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  act: (name, payload) => ipcRenderer.send('action', name, payload),
  callouts: (what) => ipcRenderer.send('callouts', what),
  detect: () => ipcRenderer.send('detect'),
  leagues: () => ipcRenderer.invoke('leagues.list'),
  importLeague: (p) => ipcRenderer.invoke('leagues.import', p),
  copy: (text) => ipcRenderer.send('copy', text),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
});
