const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  getState: () => ipcRenderer.invoke('companion:get-state'),
  saveConfig: (updates) => ipcRenderer.invoke('companion:save-config', updates),
  saveSecrets: (updates) => ipcRenderer.invoke('companion:save-secrets', updates),
  windowAction: (action, id) => ipcRenderer.invoke('companion:window', action, id),
  importMedia: () => ipcRenderer.invoke('companion:media-import'),
  transcodeMedia: (inputName, preset) => ipcRenderer.invoke('companion:media-transcode', inputName, preset),
  chooseLibrary: () => ipcRenderer.invoke('companion:choose-library'),
  obsScenes: () => ipcRenderer.invoke('companion:obs-scenes'),
  setObsScene: (sceneName) => ipcRenderer.invoke('companion:obs-set-scene', sceneName),
  setAudio: (payload) => ipcRenderer.invoke('companion:audio', payload),
  openExternal: (url) => ipcRenderer.invoke('companion:open-external', url),
  onStatus: (handler) => ipcRenderer.on('companion:status', (_event, status) => handler(status)),
  onMediaJob: (handler) => ipcRenderer.on('companion:media-job', (_event, job) => handler(job))
});

