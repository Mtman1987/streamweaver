const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companionOverlay', {
  getInteractionState: () => ipcRenderer.invoke('companion:overlay-interaction-get'),
  finishInteraction: () => ipcRenderer.invoke('companion:overlay-interaction-set', false),
  onInteractionChange: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('companion:overlay-interaction', listener);
    return () => ipcRenderer.removeListener('companion:overlay-interaction', listener);
  }
});
