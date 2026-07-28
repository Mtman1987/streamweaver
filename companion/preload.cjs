const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('companion', {
  getState: () => ipcRenderer.invoke('companion:get-state'),
  saveConfig: (updates) => ipcRenderer.invoke('companion:save-config', updates),
  saveSecrets: (updates) => ipcRenderer.invoke('companion:save-secrets', updates),
  windowAction: (action, id) => ipcRenderer.invoke('companion:window', action, id),
  importMedia: () => ipcRenderer.invoke('companion:media-import'),
  transcodeMedia: (inputName, preset) => ipcRenderer.invoke('companion:media-transcode', inputName, preset),
  playObsMedia: (mediaName, obsInputName) => ipcRenderer.invoke('companion:obs-play-media', mediaName, obsInputName),
  createWorkflow: (workflowId, payload) => ipcRenderer.invoke('companion:workflow-create', workflowId, payload),
  reviewWorkflow: (jobId, approved) => ipcRenderer.invoke('companion:workflow-review', jobId, approved),
  testWorkflow: () => ipcRenderer.invoke('companion:workflow-test'),
  resolveConfirmation: (commandId, approved) => ipcRenderer.invoke('companion:confirmation-resolve', commandId, approved),
  chooseLibrary: () => ipcRenderer.invoke('companion:choose-library'),
  obsScenes: () => ipcRenderer.invoke('companion:obs-scenes'),
  setObsScene: (sceneName) => ipcRenderer.invoke('companion:obs-set-scene', sceneName),
  setAudio: (payload) => ipcRenderer.invoke('companion:audio', payload),
  openExternal: (url) => ipcRenderer.invoke('companion:open-external', url),
  onStatus: (handler) => ipcRenderer.on('companion:status', (_event, status) => handler(status)),
  onMediaJob: (handler) => ipcRenderer.on('companion:media-job', (_event, job) => handler(job))
  ,
  onWorkflowJob: (handler) => ipcRenderer.on('companion:workflow-job', (_event, job) => handler(job)),
  onConfirmation: (handler) => ipcRenderer.on('companion:confirmation', (_event, command) => handler(command))
});
