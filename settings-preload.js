const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  resetOmen: () => ipcRenderer.send('reset-omen'),
  historyGetAll: () => ipcRenderer.invoke('history-get-all'),
  historyUpdateInterpretation: (payload) => ipcRenderer.invoke('history-update-interpretation', payload),
  windowGetPresets: () => ipcRenderer.invoke('window-get-presets'),
  windowSetPreset: (presetName) => ipcRenderer.invoke('window-set-preset', presetName),
  showToast: (message, durationMs) => ipcRenderer.send('show-toast', message, durationMs)
});
