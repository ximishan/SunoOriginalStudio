const { contextBridge, ipcRenderer } = require('electron');
const { version: APP_VERSION } = require('./package.json');

contextBridge.exposeInMainWorld('demoApi', {
  appVersion: APP_VERSION,
  profileInfo: () => ipcRenderer.invoke('app:profile-info'),
  accountStatus: (slot) => ipcRenderer.invoke('account:status', slot),
  openLogin: (slot) => ipcRenderer.invoke('account:open-login', slot),
  submitOriginal: (payload) => ipcRenderer.invoke('original:submit', payload),
  refreshTask: (task) => ipcRenderer.invoke('task:refresh', task),
  openSong: (url) => ipcRenderer.invoke('song:open', url),
  onAccountStateChanged: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('account:state-changed', listener);
    return () => ipcRenderer.removeListener('account:state-changed', listener);
  },
  onVerificationState: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('verification:state', listener);
    return () => ipcRenderer.removeListener('verification:state', listener);
  },

  listSongs: () => ipcRenderer.invoke('library:list'),
  getSongAutomation: () => ipcRenderer.invoke('library:get-automation'),
  setSongAutomation: (patch) => ipcRenderer.invoke('library:set-automation', patch),
  runSongAutomationNow: () => ipcRenderer.invoke('library:run-automation-now'),
  saveSongSubmission: (payload) => ipcRenderer.invoke('library:save-submission', payload),
  refreshSongLibrary: () => ipcRenderer.invoke('library:refresh'),
  syncSunoSongs: (options) => ipcRenderer.invoke('library:sync-suno', options),
  selectSongRoot: () => ipcRenderer.invoke('library:select-root'),
  openSongRoot: () => ipcRenderer.invoke('library:open-root'),
  openSongLocalDir: (clipId) => ipcRenderer.invoke('library:open-song-dir', clipId),
  getSongPlaySource: (clipId) => ipcRenderer.invoke('library:get-play-source', clipId),
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

window.addEventListener('DOMContentLoaded', () => {
  const displayTitle = `Suno Original Studio v${APP_VERSION}`;
  document.title = displayTitle;
  const appHeading = document.querySelector('.wrap > h1');
  if (appHeading) appHeading.textContent = displayTitle;

  for (const src of ['account_slots_fix.js', 'batch_renderer.js', 'suno_sync_renderer.js']) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.body.appendChild(script);
  }
});