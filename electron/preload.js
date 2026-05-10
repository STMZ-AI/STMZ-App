import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // File system
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectFiles: () => ipcRenderer.invoke('select-files'),
  selectXmlFile: () => ipcRenderer.invoke('select-xml-file'),
  selectOutputFolder: () => ipcRenderer.invoke('select-output-folder'),
  getDroppedFiles: (paths) => ipcRenderer.invoke('get-dropped-files', paths),

  // Dependency management (replaces old checkModels)
  checkDependencies: () => ipcRenderer.invoke('check-dependencies'),
  downloadDependency: (name) => ipcRenderer.invoke('download-dependency', name),
  onSetupProgress: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('setup-progress', handler);
    return () => ipcRenderer.removeListener('setup-progress', handler);
  },

  // Engine communication
  sendToEngine: (command) => ipcRenderer.invoke('engine-send', command),
  cancelEngine: () => ipcRenderer.invoke('engine-cancel'),
  onEngineMessage: (callback) => {
    const handler = (_event, msg) => callback(msg);
    ipcRenderer.on('engine-message', handler);
    return () => ipcRenderer.removeListener('engine-message', handler);
  },
});
