const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  init: () => ipcRenderer.invoke('init'),
  act: (name, payload) => ipcRenderer.send('action', name, payload),
  copy: (text) => ipcRenderer.send('copy', text),
  onState: (fn) => ipcRenderer.on('state', (_e, s) => fn(s)),
});
