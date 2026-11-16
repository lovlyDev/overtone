'use strict';
// Мост между страницей и главным процессом. Работает в песочнице: только electron, без других модулей.
const { contextBridge, ipcRenderer } = require('electron');

if (!/^(https?|file|devtools|about|chrome):/.test(location.href)) {
  let config = ipcRenderer.sendSync('overtone:config');
  const listeners = new Set();
  ipcRenderer.on('overtone:config', (_event, next) => {
    config = next;
    listeners.forEach((listener) => listener(config));
  });
  contextBridge.exposeInMainWorld('overtone', {
    config: () => config,
    set: (patch) => ipcRenderer.invoke('overtone:set', patch),
    // Возвращать Set нельзя: мост не умеет его передавать странице.
    onConfig: (listener) => {
      listeners.add(listener);
    },
    // Blob собирается здесь: адрес blob: общий для страницы, а байты не гоняются через мост второй раз.
    video: async (track) => {
      const found = await ipcRenderer.invoke('overtone:video', track);
      if (!found) return null;
      return { kind: found.kind, url: URL.createObjectURL(new Blob([found.bytes], { type: found.mime })) };
    },
    releaseVideo: (url) => URL.revokeObjectURL(url),
    rejectVideo: (track) => ipcRenderer.invoke('overtone:video-reject', track),
    sc: {
      search: (query) => ipcRenderer.invoke('overtone:sc-search', query),
      recent: () => ipcRenderer.invoke('overtone:sc-recent'),
    },
    api: (request) => ipcRenderer.invoke('overtone:api', request),
    knownVideos: () => ipcRenderer.invoke('overtone:video-known'),
    onKnownVideos: (listener) => {
      ipcRenderer.on('overtone:video-known', (_event, ids) => listener(ids));
    },
    videoStats: () => ipcRenderer.invoke('overtone:video-stats'),
    clearVideo: () => ipcRenderer.invoke('overtone:video-clear'),
  });
}
