const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  scanLocal: (opts) => ipcRenderer.invoke('fonts:scan', opts),
  listSource: (id, params) => ipcRenderer.invoke('source:list', id, params),
  openExternal: (url) => ipcRenderer.invoke('shell:open', url),
  reveal: (faceId) => ipcRenderer.invoke('shell:reveal', faceId),
  install: (item) => ipcRenderer.invoke('fonts:install', item),
  onInstallEvent: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('install:event', handler);
    return () => ipcRenderer.removeListener('install:event', handler);
  },
  onSourceProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('source:progress', handler);
    return () => ipcRenderer.removeListener('source:progress', handler);
  },
  onScanProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('fonts:progress', handler);
    return () => ipcRenderer.removeListener('fonts:progress', handler);
  },
});
