const fs = require('fs');

function patchFile(file, transforms) {
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  let changed = false;
  for (const { from, to, label } of transforms) {
    if (text.includes(to)) continue;
    if (!text.includes(from)) throw new Error(`${file}: cannot find expected source for ${label}`);
    text = text.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, text, 'utf8');
  return changed;
}

const changed = [];

if (patchFile('song_library.js', [
  {
    label: 'pathToFileURL import',
    from: `const crypto = require('crypto');\nconst { spawn, spawnSync } = require('child_process');`,
    to: `const crypto = require('crypto');\nconst { pathToFileURL } = require('url');\nconst { spawn, spawnSync } = require('child_process');`,
  },
  {
    label: 'song playback source resolver',
    from: `function registerSongLibraryIpc({ app, ipcMain, dialog, shell }) {`,
    to: `function getSongPlaySource(app, clipId) {\n  const state = readState(app);\n  const song = state.songs.find(x => x.clipId === clipId);\n  if (!song) throw new Error('歌曲列表中没有找到这首歌');\n\n  const localCandidates = [\n    { file: song.processedWavPath, kind: 'n19', label: 'AI消痕版 WAV' },\n    { file: song.sourceWavPath, kind: 'suno-wav', label: 'Suno 原始 WAV' },\n  ];\n  for (const candidate of localCandidates) {\n    if (candidate.file && fs.existsSync(candidate.file)) {\n      try {\n        if (fs.statSync(candidate.file).size > 0) {\n          return {\n            clipId: song.clipId,\n            title: song.title || '未命名',\n            url: pathToFileURL(candidate.file).href,\n            kind: candidate.kind,\n            label: candidate.label,\n            local: true,\n          };\n        }\n      } catch {}\n    }\n  }\n\n  if (song.audioUrl) {\n    return {\n      clipId: song.clipId,\n      title: song.title || '未命名',\n      url: song.audioUrl,\n      kind: 'suno-stream',\n      label: 'Suno 在线音频',\n      local: false,\n    };\n  }\n\n  if (/^(complete|completed)$/i.test(String(song.generationStatus || '')) && song.clipId) {\n    return {\n      clipId: song.clipId,\n      title: song.title || '未命名',\n      url: \`https://cdn1.suno.ai/\${encodeURIComponent(song.clipId)}.mp3\`,\n      kind: 'suno-cdn',\n      label: 'Suno 在线音频',\n      local: false,\n    };\n  }\n\n  throw new Error('这首歌还没有可试听的音频，请先刷新 Suno 状态');\n}\n\nfunction registerSongLibraryIpc({ app, ipcMain, dialog, shell }) {`,
  },
  {
    label: 'play source ipc',
    from: `  ipcMain.handle('library:open-song-dir', async (_event, clipId) => {`,
    to: `  ipcMain.handle('library:get-play-source', async (_event, clipId) => getSongPlaySource(app, clipId));\n  ipcMain.handle('library:open-song-dir', async (_event, clipId) => {`,
  },
])) changed.push('song_library.js');

if (patchFile('preload.js', [
  {
    label: 'play source bridge',
    from: `  openSongLocalDir: (clipId) => ipcRenderer.invoke('library:open-song-dir', clipId),\n  processSelectedSongs: (clipIds) => ipcRenderer.invoke('library:process-selected', clipIds),`,
    to: `  openSongLocalDir: (clipId) => ipcRenderer.invoke('library:open-song-dir', clipId),\n  getSongPlaySource: (clipId) => ipcRenderer.invoke('library:get-play-source', clipId),\n  processSelectedSongs: (clipIds) => ipcRenderer.invoke('library:process-selected', clipIds),`,
  },
])) changed.push('preload.js');

if (patchFile('renderer.js', [
  {
    label: 'player state',
    from: `let selectedSongIds = new Set();\nlet libraryBusy = false;`,
    to: `let selectedSongIds = new Set();\nlet libraryBusy = false;\nconst libraryAudio = new Audio();\nlet playingClipId = '';\nlet playingSource = null;\nlet playerSeeking = false;`,
  },
  {
    label: 'player functions',
    from: `function isSongComplete(song) {\n  return /^(complete|completed)$/i.test(String(song.generationStatus || ''));\n}\n\nfunction renderSongLibrary() {`,
    to: `function isSongComplete(song) {\n  return /^(complete|completed)$/i.test(String(song.generationStatus || ''));\n}\n\nfunction formatPlayerTime(value) {\n  const seconds = Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;\n  const m = Math.floor(seconds / 60);\n  const s = seconds % 60;\n  return \`\${String(m).padStart(2, '0')}:\${String(s).padStart(2, '0')}\`;\n}\n\nfunction refreshPlayerUi() {\n  const toggle = $('libraryPlayerToggle');\n  const stop = $('libraryPlayerStop');\n  const seek = $('libraryPlayerSeek');\n  const time = $('libraryPlayerTime');\n  const title = $('libraryPlayerTitle');\n  const source = $('libraryPlayerSource');\n  if (!toggle) return;\n\n  const hasTrack = Boolean(playingClipId && libraryAudio.src);\n  toggle.disabled = !hasTrack;\n  stop.disabled = !hasTrack;\n  toggle.textContent = hasTrack && !libraryAudio.paused ? '暂停' : '播放';\n  if (title) title.textContent = playingSource?.title || '还没有选择歌曲';\n  if (source) source.textContent = playingSource?.label || '点击歌曲右侧“试听”开始播放';\n\n  const duration = Number.isFinite(libraryAudio.duration) ? libraryAudio.duration : 0;\n  if (seek && !playerSeeking) {\n    seek.disabled = !hasTrack || !duration;\n    seek.max = duration || 1;\n    seek.value = Number.isFinite(libraryAudio.currentTime) ? libraryAudio.currentTime : 0;\n  }\n  if (time) time.textContent = \`\${formatPlayerTime(libraryAudio.currentTime)} / \${formatPlayerTime(duration)}\`;\n\n  document.querySelectorAll('[data-play-song]').forEach(btn => {\n    const same = btn.dataset.playSong === playingClipId;\n    btn.textContent = same ? (libraryAudio.paused ? '继续' : '暂停') : '试听';\n  });\n}\n\nasync function playSongFromLibrary(clipId) {\n  try {\n    if (playingClipId === clipId && libraryAudio.src) {\n      if (libraryAudio.paused) await libraryAudio.play();\n      else libraryAudio.pause();\n      refreshPlayerUi();\n      return;\n    }\n\n    const source = await window.demoApi.getSongPlaySource(clipId);\n    if (!source?.url) throw new Error('没有取得可播放的音频地址');\n    libraryAudio.pause();\n    libraryAudio.src = source.url;\n    libraryAudio.currentTime = 0;\n    playingClipId = clipId;\n    playingSource = source;\n    refreshPlayerUi();\n    await libraryAudio.play();\n    libraryLog(\`正在试听：\${source.title}（\${source.label}）\`, 'oktxt');\n    refreshPlayerUi();\n  } catch (e) {\n    libraryLog(e?.message || e, 'err');\n    refreshPlayerUi();\n  }\n}\n\nlibraryAudio.preload = 'metadata';\nlibraryAudio.volume = 0.85;\nlibraryAudio.addEventListener('play', refreshPlayerUi);\nlibraryAudio.addEventListener('pause', refreshPlayerUi);\nlibraryAudio.addEventListener('loadedmetadata', refreshPlayerUi);\nlibraryAudio.addEventListener('durationchange', refreshPlayerUi);\nlibraryAudio.addEventListener('timeupdate', refreshPlayerUi);\nlibraryAudio.addEventListener('ended', () => { libraryAudio.currentTime = 0; refreshPlayerUi(); });\nlibraryAudio.addEventListener('error', () => {\n  if (playingClipId) libraryLog(\`试听失败：\${playingSource?.title || playingClipId}\`, 'err');\n  refreshPlayerUi();\n});\n\nfunction renderSongLibrary() {`,
  },
  {
    label: 'row play button',
    from: `      <td><div class="inline-actions"><button class="secondary" data-open-suno="${escapeHtml(song.clipId)}">Suno</button>${song.localDir ? `<button class="secondary" data-open-local="${escapeHtml(song.clipId)}">本地</button>` : ''}</div></td>`,
    to: `      <td><div class="inline-actions"><button class="secondary" data-play-song="${escapeHtml(song.clipId)}" ${isSongComplete(song) || song.audioUrl || song.sourceWavPath || song.processedWavPath ? '' : 'disabled'}>试听</button><button class="secondary" data-open-suno="${escapeHtml(song.clipId)}">Suno</button>${song.localDir ? `<button class="secondary" data-open-local="${escapeHtml(song.clipId)}">本地</button>` : ''}</div></td>`,
  },
  {
    label: 'bind play buttons',
    from: `  body.querySelectorAll('[data-open-suno]').forEach(btn => btn.onclick = () => window.demoApi.openSong(\`https://suno.com/song/\${btn.dataset.openSuno}\`));`,
    to: `  body.querySelectorAll('[data-play-song]').forEach(btn => btn.onclick = () => playSongFromLibrary(btn.dataset.playSong));\n  body.querySelectorAll('[data-open-suno]').forEach(btn => btn.onclick = () => window.demoApi.openSong(\`https://suno.com/song/\${btn.dataset.openSuno}\`));`,
  },
  {
    label: 'refresh player after render',
    from: `  syncMasterCheck();\n}\n\nfunction syncMasterCheck() {`,
    to: `  syncMasterCheck();\n  refreshPlayerUi();\n}\n\nfunction syncMasterCheck() {`,
  },
  {
    label: 'player controls',
    from: `$('libraryRefresh').onclick = async () => {`,
    to: `$('libraryPlayerToggle').onclick = async () => {\n  if (!playingClipId || !libraryAudio.src) return;\n  try {\n    if (libraryAudio.paused) await libraryAudio.play();\n    else libraryAudio.pause();\n  } catch (e) {\n    libraryLog(e?.message || e, 'err');\n  }\n  refreshPlayerUi();\n};\n\n$('libraryPlayerStop').onclick = () => {\n  libraryAudio.pause();\n  try { libraryAudio.currentTime = 0; } catch {}\n  refreshPlayerUi();\n};\n\n$('libraryPlayerSeek').addEventListener('input', () => {\n  playerSeeking = true;\n  const value = Number($('libraryPlayerSeek').value || 0);\n  $('libraryPlayerTime').textContent = \`\${formatPlayerTime(value)} / \${formatPlayerTime(libraryAudio.duration)}\`;\n});\n$('libraryPlayerSeek').addEventListener('change', () => {\n  const value = Number($('libraryPlayerSeek').value || 0);\n  if (Number.isFinite(value)) libraryAudio.currentTime = value;\n  playerSeeking = false;\n  refreshPlayerUi();\n});\n$('libraryPlayerVolume').addEventListener('input', () => {\n  libraryAudio.volume = Math.max(0, Math.min(1, Number($('libraryPlayerVolume').value || 0) / 100));\n});\n\n$('libraryRefresh').onclick = async () => {`,
  },
])) changed.push('renderer.js');

if (patchFile('index.html', [
  {
    label: 'player css',
    from: `    .check { width:auto; }`,
    to: `    .check { width:auto; }\n    .player-bar { margin-top:14px; display:grid; grid-template-columns:auto minmax(220px,1fr) auto; gap:12px; align-items:center; padding:12px; border:1px solid #2a3040; border-radius:12px; background:#10141d; }\n    .player-buttons { display:flex; gap:8px; }\n    .player-main { min-width:0; }\n    .player-title { font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n    .player-meta { display:flex; justify-content:space-between; gap:10px; margin-top:4px; color:#8f98aa; font-size:11px; }\n    .player-seek { margin-top:8px; padding:0; }\n    .player-volume { display:flex; align-items:center; gap:7px; min-width:150px; color:#9aa3b5; font-size:11px; }\n    .player-volume input { width:105px; padding:0; }`,
  },
  {
    label: 'page version',
    from: `<h1>Suno Original Studio v0.5.3</h1>`,
    to: `<h1>Suno Original Studio v0.5.4</h1>`,
  },
  {
    label: 'song player markup',
    from: `        <div class="small" style="margin-top:8px">处理完成后，每首歌会建立独立目录，保存“歌词.txt”、“Suno原始.wav”和“消痕-N19.wav”。</div>\n        <div class="table-wrap">`,
    to: `        <div class="small" style="margin-top:8px">处理完成后，每首歌会建立独立目录，保存“歌词.txt”、“Suno原始.wav”和“消痕-N19.wav”。</div>\n        <div class="player-bar">\n          <div class="player-buttons">\n            <button id="libraryPlayerToggle" disabled>播放</button>\n            <button id="libraryPlayerStop" class="secondary" disabled>停止</button>\n          </div>\n          <div class="player-main">\n            <div id="libraryPlayerTitle" class="player-title">还没有选择歌曲</div>\n            <div class="player-meta"><span id="libraryPlayerSource">点击歌曲右侧“试听”开始播放</span><span id="libraryPlayerTime">00:00 / 00:00</span></div>\n            <input id="libraryPlayerSeek" class="player-seek" type="range" min="0" max="1" step="0.1" value="0" disabled />\n          </div>\n          <div class="player-volume"><span>音量</span><input id="libraryPlayerVolume" type="range" min="0" max="100" value="85" /></div>\n        </div>\n        <div class="table-wrap">`,
  },
])) changed.push('index.html');

if (patchFile('main.js', [
  {
    label: 'window version',
    from: `    title: 'Suno Original Studio v0.5.3',`,
    to: `    title: 'Suno Original Studio v0.5.4',`,
  },
])) changed.push('main.js');

if (patchFile('package.json', [
  {
    label: 'package version',
    from: `  "version": "0.5.3",`,
    to: `  "version": "0.5.4",`,
  },
  {
    label: 'artifact name',
    from: `      "artifactName": "SunoOriginalStudio_v0.5.3.exe"`,
    to: `      "artifactName": "SunoOriginalStudio_v0.5.4.exe"`,
  },
])) changed.push('package.json');

if (fs.existsSync('PROJECT_STATUS_AND_AVR_FEATURES.md')) {
  if (patchFile('PROJECT_STATUS_AND_AVR_FEATURES.md', [
    {
      label: 'current version',
      from: '当前开发版本：`v0.4.0`',
      to: '当前开发版本：`v0.5.4`',
    },
    {
      label: 'version history song player',
      from: '- `v0.4.0`：将 AI 消痕升级为 AVR 1.77.0 原版完整 `SoX + Rubber Band + FFmpeg` 工具链与执行路径，并增加构建时、运行时 SHA-256 校验',
      to: '- `v0.4.0`：将 AI 消痕升级为 AVR 1.77.0 原版完整 `SoX + Rubber Band + FFmpeg` 工具链与执行路径，并增加构建时、运行时 SHA-256 校验\n- `v0.5.0`：新增持久化歌曲列表、Suno WAV 下载、歌曲列表直达 N19 与歌词/原始 WAV/消痕 WAV 本地保存\n- `v0.5.1`：固定用户数据目录并增强旧 Session 迁移\n- `v0.5.2`：新增“排除风格 / negative_tags”\n- `v0.5.3`：已完成 AI 消痕的歌曲前后端双重跳过，避免重复处理；增强 Clerk 登录状态持久化与识别\n- `v0.5.4`：歌曲列表新增内置试听播放器，支持 Suno 在线音频、原始 WAV 和 N19 消痕 WAV 播放',
    },
  ])) changed.push('PROJECT_STATUS_AND_AVR_FEATURES.md');
}

console.log(changed.length ? `Patched: ${changed.join(', ')}` : 'v0.5.4 song player patch already applied.');
