const { contextBridge, ipcRenderer } = require('electron');

function readDownloadPolicyFromDom() {
  const formatEl = document.getElementById('libraryDownloadFormat');
  const fallbackEl = document.getElementById('libraryAllowMp3Fallback');
  const format = String(formatEl?.value || 'wav').toLowerCase() === 'mp3' ? 'mp3' : 'wav';
  return {
    format,
    allowMp3Fallback: format === 'wav' ? Boolean(fallbackEl?.checked) : true,
  };
}

contextBridge.exposeInMainWorld('demoApi', {
  appVersion: () => ipcRenderer.invoke('app:get-version'),
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
  getDownloadPolicy: () => ipcRenderer.invoke('library:get-download-policy'),
  setDownloadPolicy: (value) => ipcRenderer.invoke('library:set-download-policy', value),
  redownloadSong: async (clipId) => {
    await ipcRenderer.invoke('library:set-download-policy', readDownloadPolicyFromDom());
    return ipcRenderer.invoke('library:redownload', clipId);
  },
  processSelectedSongs: async (clipIds) => {
    await ipcRenderer.invoke('library:set-download-policy', readDownloadPolicyFromDom());
    return ipcRenderer.invoke('library:process-selected', clipIds);
  },
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

function applyAppTitle(version = '') {
  const displayTitle = version ? `Suno Original Studio v${version}` : 'Suno Original Studio';
  document.title = displayTitle;
  const appHeading = document.querySelector('.wrap > h1');
  if (appHeading) appHeading.textContent = displayTitle;
}

function installDownloadPolicyUi() {
  if (document.getElementById('libraryDownloadPolicy')) return;
  const actionButton = document.getElementById('libraryProcessSelected');
  const actions = actionButton?.parentElement;
  if (!actions) return;

  const panel = document.createElement('div');
  panel.id = 'libraryDownloadPolicy';
  panel.className = 'hero-note';
  panel.style.marginTop = '12px';
  panel.innerHTML = `
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
      <label style="margin:0;display:flex;gap:8px;align-items:center">
        <span>下载源格式</span>
        <select id="libraryDownloadFormat" style="width:auto;min-width:210px">
          <option value="wav">WAV（严格，默认）</option>
          <option value="mp3">MP3（兼容源）</option>
        </select>
      </label>
      <label style="margin:0;display:flex;gap:8px;align-items:center">
        <input id="libraryAllowMp3Fallback" class="check" type="checkbox" />
        <span>WAV 不可用时允许降级 MP3</span>
      </label>
    </div>
    <div id="libraryDownloadPolicyHint" class="small" style="margin-top:8px"></div>`;
  actions.insertAdjacentElement('afterend', panel);

  const format = document.getElementById('libraryDownloadFormat');
  const fallback = document.getElementById('libraryAllowMp3Fallback');
  const hint = document.getElementById('libraryDownloadPolicyHint');

  try {
    const savedFormat = localStorage.getItem('suno.downloadFormat');
    const savedFallback = localStorage.getItem('suno.allowMp3Fallback');
    format.value = savedFormat === 'mp3' ? 'mp3' : 'wav';
    fallback.checked = savedFallback === '1';
  } catch {
    format.value = 'wav';
    fallback.checked = false;
  }

  const sync = () => {
    const policy = readDownloadPolicyFromDom();
    fallback.disabled = policy.format === 'mp3';
    if (policy.format === 'wav' && !policy.allowMp3Fallback) {
      hint.textContent = '严格 WAV：只接受 Suno 官方真实 WAV；拿不到就报错，不会下载 MP3 后转成 WAV。';
      hint.className = 'small oktxt';
    } else if (policy.format === 'wav') {
      hint.textContent = 'WAV 优先；只有官方 WAV 不可用时才允许按参考 EXE 降级到 MP3/播放媒体。';
      hint.className = 'small warn';
    } else {
      hint.textContent = 'MP3 兼容源：AI 消痕前会解码成 WAV，但音质上限仍然是 MP3/播放源。';
      hint.className = 'small warn';
    }
    try {
      localStorage.setItem('suno.downloadFormat', policy.format);
      localStorage.setItem('suno.allowMp3Fallback', policy.allowMp3Fallback && policy.format === 'wav' ? '1' : '0');
    } catch {}
    ipcRenderer.invoke('library:set-download-policy', policy).catch(() => {});
  };

  format.addEventListener('change', sync);
  fallback.addEventListener('change', sync);
  sync();
}

function appendLibraryUiLog(text, cls = 'err') {
  const box = document.getElementById('libraryLog');
  if (!box) return;
  const span = document.createElement('span');
  span.className = cls;
  span.textContent = `\n[${new Date().toLocaleTimeString()}] ${String(text || '')}`;
  box.appendChild(span);
  box.scrollTop = box.scrollHeight;
}

function installRedownloadButtons() {
  const body = document.getElementById('songTableBody');
  if (!body || body.dataset.redownloadObserverInstalled === '1') return;
  body.dataset.redownloadObserverInstalled = '1';

  const apply = () => {
    for (const sunoButton of body.querySelectorAll('button[data-open-suno]')) {
      const clipId = String(sunoButton.dataset.openSuno || '');
      if (!clipId) continue;
      const actions = sunoButton.parentElement;
      if (!actions || actions.querySelector(`button[data-redownload-song="${clipId}"]`)) continue;

      const button = document.createElement('button');
      button.className = 'secondary';
      button.dataset.redownloadSong = clipId;
      button.textContent = '重新下载 WAV';
      const playButton = actions.querySelector('button[data-play-song]');
      button.disabled = Boolean(playButton?.disabled);
      button.onclick = async () => {
        if (button.dataset.busy === '1') return;
        button.dataset.busy = '1';
        button.disabled = true;
        button.textContent = '重新下载中…';
        try {
          await ipcRenderer.invoke('library:set-download-policy', readDownloadPolicyFromDom());
          await ipcRenderer.invoke('library:redownload', clipId);
        } catch (error) {
          appendLibraryUiLog(`${clipId.slice(0, 8)}：${error?.message || error}`, 'err');
        } finally {
          button.dataset.busy = '0';
          if (button.isConnected) {
            button.disabled = false;
            button.textContent = '重新下载 WAV';
          }
        }
      };
      actions.appendChild(button);
    }
  };

  const observer = new MutationObserver(() => apply());
  observer.observe(body, { childList: true, subtree: true });
  apply();
}

window.addEventListener('DOMContentLoaded', () => {
  // 先立即移除 index.html 中任何历史硬编码版本，避免打包后短暂或永久显示旧版本。
  applyAppTitle('');

  // 软件版本只认 Electron 打包版本（package.json -> app.getVersion()）。
  ipcRenderer.invoke('app:get-version')
    .then(version => applyAppTitle(String(version || '').trim()))
    .catch(() => applyAppTitle(''));

  installDownloadPolicyUi();
  installRedownloadButtons();

  for (const src of ['account_slots_fix.js', 'batch_renderer.js', 'suno_sync_renderer.js']) {
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    document.body.appendChild(script);
  }
});
