const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  historyAdd: (entry) => ipcRenderer.invoke('history-add', entry),
  historyGetAll: () => ipcRenderer.invoke('history-get-all'),
  historyUpdateCards: (payload) => ipcRenderer.invoke('history-update-cards', payload),
  historyUpdateInterpretation: (payload) => ipcRenderer.invoke('history-update-interpretation', payload),
  historySave: (payload) => ipcRenderer.invoke('history-save', payload),
  interpretLogAdd: (payload) => ipcRenderer.invoke('interpret-log-add', payload),
  showToast: (message, durationMs) => ipcRenderer.send('show-toast', message, durationMs)
});