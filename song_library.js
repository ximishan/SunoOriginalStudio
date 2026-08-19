const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { BrowserWindow, session } = require('electron');

const SUNO_HOME = 'https://suno.com/';
const SUNO_STUDIO = 'https://suno.com/studio';
const SUNO_API = 'https://studio-api-prod.suno.com';
const WAV_TIMEOUT_MS = 150000;

let activeProcess = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const AVR_TOOLCHAIN_HASHES = Object.freeze({
  'ffmpeg-win-x86_64-v7.1.exe': '2ce797a0f88d7f067180338fb227f7b1928ea727bd9a4d7a1d022f7c52af71a3',
  'sox/sox.exe': 'e0e3cdc4bcdfbb5b91ac8f53b024964d092f89ba90130ba74b223a1df11b5439',
  'sox/libflac-8.dll': '2c154aeaad085e01361b967adfec84b63db76a82a45681b3e6cdfacb6088e369',
  'sox/libgcc_s_sjlj-1.dll': '2af381dbd5ea1a9a150307b1cba3a150321a3c3ff09fb6ead9bba1e880e03a64',
  'sox/libgomp-1.dll': '9dbbb0cb3f31ded7fbf51141a39578c0bc5cc85b83e9b6908657a6083948b9ba',
  'sox/libid3tag-0.dll': '4ec8e74cdd48a388a41f7f3ab2cea810a1661f47e79b6338192f000341f20af0',
  'sox/libogg-0.dll': '3262325b43b6f249831cc15428372a6daa34cf2459e66ed047dbbd9f00f49378',
  'sox/libpng16-16.dll': '22d46adb7927690eeeb1a27f9544108f7a1c66bf1daec90f3c41aa36e176920d',
  'sox/libsox-3.dll': '240a7e47a4274908786220f1b92372ed1b5f2a1c29874292fad5e64f120d84b4',
  'sox/libssp-0.dll': '113da78ba0514b3947e0988376002c4d5f783d62d5058f99259771648f2e9138',
  'sox/libvorbis-0.dll': '03ae1625a47c1255d70e7d63ee42ef2483c7e2adc9a33d21f45799f323a530b4',
  'sox/libvorbisenc-2.dll': '3b809daf958b6dedeedbe05e91a0ac016b18c871b33dc98c728f8b3440874385',
  'sox/libvorbisfile-3.dll': '1a14d8b0749f66811dacb23b093d54d4ff88036d49fd017b0d98b21de7f9ef1d',
  'sox/libwavpack-1.dll': '9123e73f801629a8791c80d9dc5041ee23f7f1d9ed8510f2f758269159aa26b8',
  'sox/libwinpthread-1.dll': '036af4b9aed20a6bd8b1993f2e0a4789c2ba555c00c0b2d72a6d6a6b8c13ef68',
  'sox/zlib1.dll': '189336a0cf1131d6a681e81b43385ade7252f7211df50774772d8c8ec40d5f8f',
});

const SCHEME1_SOX_EFFECTS = [
  'highpass', '28',
  'pitch', '-22',
  'treble', '-0.20', '8500',
  'treble', '0', '7000',
  'treble', '-1.5', '10000',
  'treble', '-2.5', '12000',
  'lowpass', '15000',
  'reverb', '15', '40', '40', '45',
  'gain', '-n', '-1.8',
  'rate', '44100',
  'dither', '-s',
];
const BETWEEN_NORM_AF = 'loudnorm=I=-15:TP=-1.5:LRA=11';
const SCHEME9_AF = 'rubberband=pitch=0.975,equalizer=f=80:g=4.0:width_type=h:width=80,equalizer=f=150:g=3.0:width_type=h:width=100,equalizer=f=300:g=-1.5:width_type=h:width=200,equalizer=f=1500:g=-1.0:width_type=h:width=400,equalizer=f=4000:g=3.5:width_type=h:width=2000,equalizer=f=8000:g=1.8:width_type=h:width=4000,aecho=0.55:0.4:35|45:0.12|0.08,volume=2.0,highpass=f=45,acompressor=threshold=-18dB:ratio=2.0:attack=10:release=120:makeup=1.5,volume=2.0dB,alimiter=limit=0.97';
const POSTPROCESS_AF = 'highpass=f=28,equalizer=f=120:g=0.25:width_type=h:width=100,equalizer=f=1800:g=0.20:width_type=h:width=1200,equalizer=f=7200:g=-0.18:width_type=h:width=3800,acompressor=threshold=-19dB:ratio=1.18:attack=24:release=210:makeup=1,alimiter=limit=0.96';

function partitionFor(slot) {
  return `persist:suno-original-demo-${slot}`;
}

function libraryFile(app) {
  return path.join(app.getPath('userData'), 'song-library-v1.json');
}

function defaultRoot(app) {
  return path.join(app.getPath('documents'), 'SunoOriginalStudio作品');
}

function readState(app) {
  const file = libraryFile(app);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      version: 1,
      rootDir: parsed.rootDir || defaultRoot(app),
      songs: Array.isArray(parsed.songs) ? parsed.songs : [],
    };
  } catch {
    return { version: 1, rootDir: defaultRoot(app), songs: [] };
  }
}

function writeState(app, state) {
  const file = libraryFile(app);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function emit(sender, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send('song-library:changed', payload);
  } catch {}
}

function safeName(value, fallback = '未命名') {
  const cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim();
  return (cleaned || fallback).slice(0, 70);
}

function saveSubmission(app, payload = {}) {
  const task = payload.task || {};
  const input = payload.input || {};
  const ids = Array.isArray(task.clipIds) ? task.clipIds.filter(Boolean) : [];
  if (!ids.length) throw new Error('提交结果没有作品编号，无法写入歌曲列表');
  const state = readState(app);
  const now = new Date().toISOString();
  const submissionId = task.submissionId || `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  ids.forEach((clipId, index) => {
    if (state.songs.some(x => x.clipId === clipId)) return;
    state.songs.unshift({
      id: clipId,
      clipId,
      submissionId,
      version: index + 1,
      title: String(task.title || input.title || '').trim() || '未命名',
      lyrics: String(input.lyrics || ''),
      stylePrompt: String(input.stylePrompt || ''),
      negativeStyle: String(input.negativeStyle || ''),
      slot: String(task.slot || input.slot || '1'),
      modelVersion: String(input.modelVersion || ''),
      vocalGender: String(input.vocalGender || ''),
      weirdness: Number(input.weirdness || 0),
      styleInfluence: Number(input.styleInfluence || 0),
      submittedAt: task.submittedAt || now,
      generationStatus: 'submitted',
      audioUrl: '',
      wavUrl: '',
      duration: 0,
      wavStatus: 'not_downloaded',
      deaiStatus: 'not_processed',
      localStatus: 'not_saved',
      localDir: '',
      sourceWavPath: '',
      processedWavPath: '',
      lyricsPath: '',
      lastError: '',
      updatedAt: now,
    });
  });
  writeState(app, state);
  return state;
}

async function hiddenAuthToken(slot) {
  const partition = partitionFor(slot);
  const ses = session.fromPartition(partition);
  const cookies = await ses.cookies.get({ url: SUNO_HOME });
  if (!cookies.some(c => c.name === '__session' || c.name.startsWith('__session_'))) {
    throw new Error(`账号 ${slot} 未登录`);
  }

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  try {
    await win.loadURL(SUNO_STUDIO);
    const token = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 30; i++) {
        if (window.Clerk?.session) break;
        await new Promise(r => setTimeout(r, 400));
      }
      try {
        const t = await window.Clerk?.session?.getToken?.();
        if (t) return t;
      } catch {}
      const cookie = Object.fromEntries(document.cookie.split(';').map(part => {
        const [key, ...rest] = part.trim().split('=');
        return [key, rest.join('=')];
      }));
      return cookie.__session || Object.entries(cookie).find(([k]) => k.startsWith('__session'))?.[1] || '';
    })()`);
    if (!String(token || '').trim()) throw new Error(`账号 ${slot} 无法读取 Suno 登录令牌`);
    return String(token).trim();
  } finally {
    try { win.destroy(); } catch {}
  }
}

async function apiHeaders(slot) {
  const token = await hiddenAuthToken(slot);
  const ses = session.fromPartition(partitionFor(slot));
  const cookies = await ses.cookies.get({ url: SUNO_HOME });
  const device = cookies.find(c => c.name === 'suno_device_id')?.value || '';
  return {
    Authorization: `Bearer ${token}`,
    'Browser-Token': JSON.stringify({ token: Buffer.from(JSON.stringify({ timestamp: Date.now() }), 'utf8').toString('base64') }),
    ...(device ? { 'Device-Id': device } : {}),
  };
}

async function refreshSlotSongs(slot, songs) {
  if (!songs.length) return;
  const headers = await apiHeaders(slot);
  const ses = session.fromPartition(partitionFor(slot));
  const ids = songs.map(x => x.clipId);
  const res = await ses.fetch(`${SUNO_API}/api/feed/v2?ids=${encodeURIComponent(ids.join(','))}`, { headers });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`账号 ${slot} 读取歌曲状态失败（${res.status}）`);
  const raw = Array.isArray(body) ? body : (body?.clips || body?.items || []);
  const byId = new Map(raw.map(x => [x.id, x]));
  const now = new Date().toISOString();
  for (const song of songs) {
    const x = byId.get(song.clipId);
    if (!x) continue;
    song.generationStatus = String(x.status || song.generationStatus || 'submitted');
    song.title = x.title || song.title;
    song.audioUrl = x.audio_url || song.audioUrl || '';
    song.duration = Number(x.metadata?.duration || song.duration || 0);
    song.lastError = x.error_message || x.metadata?.error_message || song.lastError || '';
    song.updatedAt = now;
  }
}

async function refreshLibrary(app) {
  const state = readState(app);
  const groups = new Map();
  for (const song of state.songs) {
    if (!groups.has(song.slot)) groups.set(song.slot, []);
    groups.get(song.slot).push(song);
  }
  for (const [slot, songs] of groups.entries()) {
    try {
      await refreshSlotSongs(slot, songs);
    } catch (e) {
      for (const song of songs) song.lastError = String(e?.message || e);
    }
  }
  writeState(app, state);
  return state;
}

function candidateToolRoots() {
  const roots = [];
  if (process.resourcesPath) roots.push(path.join(process.resourcesPath, 'tools', 'n19'));
  roots.push(path.join(__dirname, 'vendor', 'avr-n19'));
  return roots;
}

function hashFileSync(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function verifyToolchain() {
  let root = '';
  for (const candidate of candidateToolRoots()) {
    if (fs.existsSync(path.join(candidate, 'ffmpeg-win-x86_64-v7.1.exe')) && fs.existsSync(path.join(candidate, 'sox', 'sox.exe'))) {
      root = candidate;
      break;
    }
  }
  if (!root) throw new Error('未找到 AVR N19 完整工具链');
  for (const [relative, expected] of Object.entries(AVR_TOOLCHAIN_HASHES)) {
    const file = path.join(root, ...relative.split('/'));
    if (!fs.existsSync(file)) throw new Error(`N19 工具链缺少：${relative}`);
    const actual = hashFileSync(file);
    if (actual !== expected) throw new Error(`N19 工具链 SHA-256 不匹配：${relative}`);
  }
  const ffmpeg = path.join(root, 'ffmpeg-win-x86_64-v7.1.exe');
  const sox = path.join(root, 'sox', 'sox.exe');
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-filters'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  if (!/\brubberband\b/i.test(`${probe.stdout || ''}\n${probe.stderr || ''}`)) throw new Error('N19 FFmpeg 缺少 Rubber Band filter');
  return { root, ffmpeg, sox };
}

function run(command, args, label, sender, song) {
  return new Promise((resolve, reject) => {
    emit(sender, { type: 'progress', clipId: song.clipId, message: label });
    const child = spawn(command, args, { windowsHide: true });
    activeProcess = child;
    let stderr = '';
    child.stderr?.on('data', d => {
      stderr += d.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on('error', e => {
      activeProcess = null;
      reject(new Error(`${label}启动失败：${e.message}`));
    });
    child.on('close', code => {
      activeProcess = null;
      if (code === 0) resolve();
      else reject(new Error(`${label}失败（exit ${code}）：${stderr.slice(-1600)}`));
    });
  });
}

async function processExactN19(app, sourceWav, outputWav, sender, song) {
  const tools = verifyToolchain();
  const workDir = path.join(app.getPath('temp'), `SunoOriginalStudio-library-${crypto.randomBytes(5).toString('hex')}`);
  fs.mkdirSync(workDir, { recursive: true });
  const decoded = path.join(workDir, '00-decode.wav');
  const step1 = path.join(workDir, '01-scheme1.wav');
  const norm = path.join(workDir, '02-norm.wav');
  const step9 = path.join(workDir, '03-scheme9.wav');
  try {
    await run(tools.ffmpeg, ['-hide_banner','-nostdin','-y','-i',sourceWav,'-vn','-ac','2','-ar','44100','-c:a','pcm_s16le',decoded], '1/5 解码源 WAV', sender, song);
    await run(tools.sox, ['--no-show-progress',decoded,step1,...SCHEME1_SOX_EFFECTS], '2/5 SoX 节点 1', sender, song);
    await run(tools.ffmpeg, ['-hide_banner','-nostdin','-y','-i',step1,'-vn','-ac','2','-ar','44100','-af',BETWEEN_NORM_AF,'-c:a','pcm_s16le',norm], '3/5 节点间响度对齐', sender, song);
    await run(tools.ffmpeg, ['-hide_banner','-nostdin','-y','-i',norm,'-vn','-ac','2','-ar','48000','-af',SCHEME9_AF,'-sample_fmt','s32','-c:a','pcm_s24le','-map_metadata','-1',step9], '4/5 FFmpeg 节点 9（Rubber Band）', sender, song);
    await run(tools.ffmpeg, ['-hide_banner','-nostdin','-y','-i',step9,'-vn','-ac','2','-ar','48000','-af',POSTPROCESS_AF,'-c:a','pcm_s16le','-map_metadata','-1',outputWav], '5/5 组合后处理', sender, song);
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
  if (!fs.existsSync(outputWav) || fs.statSync(outputWav).size <= 0) throw new Error('N19 没有生成有效 WAV');
}

async function requestWavUrl(slot, clipId, sender) {
  const headers = await apiHeaders(slot);
  const ses = session.fromPartition(partitionFor(slot));
  emit(sender, { type: 'progress', clipId, message: '正在向 Suno 请求 WAV 导出…' });
  const convert = await ses.fetch(`${SUNO_API}/api/gen/${clipId}/convert_wav/`, { method: 'POST', headers });
  if (!convert.ok && convert.status !== 409) {
    const detail = await convert.text().catch(() => '');
    throw new Error(`Suno WAV 导出请求失败（${convert.status}）：${detail || '当前账号可能没有 WAV 导出权限'}`);
  }

  const deadline = Date.now() + WAV_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await ses.fetch(`${SUNO_API}/api/gen/${clipId}/wav_file/`, { headers });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      const url = data.wav_file_url || data.audio_url_wav || data.wav_url || '';
      if (url) return url;
    }
    emit(sender, { type: 'progress', clipId, message: 'Suno 正在生成 WAV，等待中…' });
    await sleep(2500);
  }
  throw new Error('等待 Suno WAV 导出超过 150 秒');
}

async function downloadToFile(slot, url, filePath) {
  const ses = session.fromPartition(partitionFor(slot));
  const res = await ses.fetch(url);
  if (!res.ok) throw new Error(`下载 Suno WAV 失败（${res.status}）`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('下载到的 Suno WAV 为空');
  const tmp = `${filePath}.part`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, filePath);
}

function songDir(rootDir, song) {
  const shortId = String(song.clipId).slice(0, 8);
  return path.join(rootDir, `${safeName(song.title)}-V${song.version || 1}-${shortId}`);
}

function updateSong(app, clipId, patch, sender) {
  const state = readState(app);
  const song = state.songs.find(x => x.clipId === clipId);
  if (!song) return null;
  Object.assign(song, patch, { updatedAt: new Date().toISOString() });
  writeState(app, state);
  emit(sender, { type: 'song-updated', song });
  return song;
}

async function processSelectedSongs(app, clipIds, sender) {
  let state = await refreshLibrary(app);
  const selected = state.songs.filter(x => clipIds.includes(x.clipId));
  if (!selected.length) throw new Error('没有选择歌曲');
  const rootDir = state.rootDir || defaultRoot(app);
  fs.mkdirSync(rootDir, { recursive: true });
  const results = [];

  for (const original of selected) {
    let song = readState(app).songs.find(x => x.clipId === original.clipId) || original;
    try {
      if (!/^(complete|completed)$/i.test(String(song.generationStatus || ''))) {
        throw new Error(`歌曲尚未生成完成：${song.generationStatus || 'submitted'}`);
      }

      // v0.5.3 safety guard: a completed N19 result is authoritative.
      // Even if the renderer sends this clipId again, never download/process it twice.
      if (String(song.deaiStatus || '').toLowerCase() === 'complete') {
        emit(sender, { type: 'progress', clipId: song.clipId, message: '这首歌已经完成 AI 消痕，已自动跳过，不会重复处理。' });
        results.push({
          clipId: song.clipId,
          ok: true,
          skipped: true,
          reason: 'already_processed',
          localDir: song.localDir || '',
          sourceWavPath: song.sourceWavPath || '',
          processedWavPath: song.processedWavPath || '',
          lyricsPath: song.lyricsPath || '',
        });
        continue;
      }

      const dir = songDir(rootDir, song);
      fs.mkdirSync(dir, { recursive: true });
      const lyricsPath = path.join(dir, '歌词.txt');
      const sourceWavPath = path.join(dir, `${safeName(song.title)}-Suno原始.wav`);
      const processedWavPath = path.join(dir, `${safeName(song.title)}-消痕-N19.wav`);
      fs.writeFileSync(lyricsPath, String(song.lyrics || ''), 'utf8');
      song = updateSong(app, song.clipId, {
        localDir: dir,
        lyricsPath,
        localStatus: 'saving',
        wavStatus: 'downloading',
        deaiStatus: 'waiting',
        lastError: '',
      }, sender) || song;

      const wavUrl = await requestWavUrl(song.slot, song.clipId, sender);
      await downloadToFile(song.slot, wavUrl, sourceWavPath);
      song = updateSong(app, song.clipId, {
        wavUrl,
        sourceWavPath,
        wavStatus: 'downloaded',
        deaiStatus: 'processing',
      }, sender) || song;

      await processExactN19(app, sourceWavPath, processedWavPath, sender, song);
      updateSong(app, song.clipId, {
        processedWavPath,
        deaiStatus: 'complete',
        localStatus: 'saved',
        lastError: '',
      }, sender);
      results.push({ clipId: song.clipId, ok: true, localDir: dir, sourceWavPath, processedWavPath, lyricsPath });
    } catch (e) {
      const error = String(e?.message || e);
      updateSong(app, song.clipId, {
        deaiStatus: 'error',
        localStatus: 'error',
        wavStatus: song.wavStatus === 'downloaded' ? 'downloaded' : 'error',
        lastError: error,
      }, sender);
      results.push({ clipId: song.clipId, ok: false, error });
    }
  }
  return {
    rootDir,
    results,
    successCount: results.filter(x => x.ok && !x.skipped).length,
    skippedCount: results.filter(x => x.skipped).length,
    failureCount: results.filter(x => !x.ok).length,
    total: results.length,
  };
}

function registerSongLibraryIpc({ app, ipcMain, dialog, shell }) {
  ipcMain.handle('library:list', async () => readState(app));
  ipcMain.handle('library:save-submission', async (_event, payload) => saveSubmission(app, payload || {}));
  ipcMain.handle('library:refresh', async () => refreshLibrary(app));
  ipcMain.handle('library:select-root', async () => {
    const result = await dialog.showOpenDialog({ title: '选择歌曲保存目录', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return readState(app);
    const state = readState(app);
    state.rootDir = result.filePaths[0];
    writeState(app, state);
    return state;
  });
  ipcMain.handle('library:open-root', async () => {
    const state = readState(app);
    fs.mkdirSync(state.rootDir, { recursive: true });
    const error = await shell.openPath(state.rootDir);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle('library:open-song-dir', async (_event, clipId) => {
    const state = readState(app);
    const song = state.songs.find(x => x.clipId === clipId);
    if (!song?.localDir) throw new Error('这首歌还没有本地目录');
    const error = await shell.openPath(song.localDir);
    if (error) throw new Error(error);
    return true;
  });
  ipcMain.handle('library:process-selected', async (event, clipIds) => {
    return processSelectedSongs(app, Array.isArray(clipIds) ? clipIds : [], event.sender);
  });
}

module.exports = { registerSongLibraryIpc };
