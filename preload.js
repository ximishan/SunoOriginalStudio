const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('demoApi', {
  profileInfo: () => ipcRenderer.invoke('app:profile-info'),
  accountStatus: (slot) => ipcRenderer.invoke('account:status', slot),
  openLogin: (slot) => ipcRenderer.invoke('account:open-login', slot),
  submitOriginal: (payload) => ipcRenderer.invoke('original:submit', payload),
  refreshTask: (task) => ipcRenderer.invoke('task:refresh', task),
  openSong: (url) => ipcRenderer.invoke('song:open', url),
  onVerificationState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('verification:state', listener);
    return () => ipcRenderer.removeListener('verification:state', listener);
  },

  listSongs: () => ipcRenderer.invoke('library:list'),
  saveSongSubmission: (payload) => ipcRenderer.invoke('library:save-submission', payload),
  refreshSongLibrary: () => ipcRenderer.invoke('library:refresh'),
  selectSongRoot: () => ipcRenderer.invoke('library:select-root'),
  openSongRoot: () => ipcRenderer.invoke('library:open-root'),
  openSongLocalDir: (clipId) => ipcRenderer.invoke('library:open-song-dir', clipId),
  processSelectedSongs: (clipIds) => ipcRenderer.invoke('library:process-selected', clipIds),
  onSongLibraryChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('song-library:changed', listener);
    return () => ipcRenderer.removeListener('song-library:changed', listener);
  },

  getDeaiEngineInfo: () => ipcRenderer.invoke('deai:engine-info'),
  selectDeaiFiles: () => ipcRenderer.invoke('deai:select-files'),
  selectDeaiOutputDir: () => ipcRenderer.invoke('deai:select-output-dir'),
  processDeai: (payload) => ipcRenderer.invoke('deai:process', payload),
  cancelDeai: () => ipcRenderer.invoke('deai:cancel'),
  openDeaiOutputDir: (outputDir) => ipcRenderer.invoke('deai:open-output-dir', outputDir),
  onDeaiProgress: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('deai:progress', listener);
    return () => ipcRenderer.removeListener('deai:progress', listener);
  },
});
