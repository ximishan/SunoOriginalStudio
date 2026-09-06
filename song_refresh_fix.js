const fs = require('fs');
const path = require('path');
const { session, BrowserWindow } = require('electron');
const { ACCOUNT_SLOTS, sessionFor, apiHeaders } = require('./suno_session');

const SUNO_API = 'https://studio-api-prod.suno.com';
const BATCH_SIZE = 20;
const DOWNLOAD_BODY_TIMEOUT_MS = 60000;
const DOWNLOAD_PROGRESS_STEP_BYTES = 5 * 1024 * 1024;
const mediaDiagPatchedSessions = new WeakSet();

function libraryFile(app) {
  return path.join(app.getPath('userData'), 'song-library-v1.json');
}

function defaultRoot(app) {
  return path.join(app.getPath('documents'), 'SunoOriginalStudio作品');
}

function readState(app) {
  try {
    const parsed = JSON.parse(fs.readFileSync(libraryFile(app), 'utf8'));
    return {
      version: 2,
      rootDir: parsed.rootDir || defaultRoot(app),
      automation: parsed.automation || {},
      songs: Array.isArray(parsed.songs) ? parsed.songs : [],
    };
  } catch {
    return { version: 2, rootDir: defaultRoot(app), automation: {}, songs: [] };
  }
}

function writeState(app, state) {
  const file = libraryFile(app);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

function rawList(body) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.clips)) return body.clips;
  if (Array.isArray(body?.items)) return body.items;
  return [];
}

function urlString(input) {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return String(input?.url || input || '');
  } catch {
    return String(input || '');
  }
}

function isSunoMediaUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    if (/\.(wav|mp3|m4a|flac|aac|ogg|webm)$/i.test(pathname)) return true;
    if ((host.endsWith('.amazonaws.com') || host.endsWith('.cloudfront.net') || host.endsWith('.suno.ai') || host.endsWith('.suno.com')) && /audio|download|uploads|generated|stream|wav|mp3/i.test(pathname)) return true;
    return false;
  } catch {
    return false;
  }
}

function clipIdFromMediaUrl(url) {
  const text = String(url || '');
  const uuid = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  try {
    const name = path.basename(new URL(text).pathname);
    return name.replace(/\.(wav|mp3|m4a|flac|aac|ogg|webm)$/i, '') || '-';
  } catch {
    return '-';
  }
}

function formatMb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
}

function emitDownloadDiag(clipId, message) {
  const id = String(clipId || '-');
  try { console.log(`[SunoDownload ${id}] ${message}`); } catch {}
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && win.webContents.getURL().startsWith('file://')) {
        win.webContents.send('song-library:changed', {
          type: 'progress',
          clipId: id === '-' ? '' : id,
          message: `[下载诊断] ${message}`,
        });
      }
    } catch {}
  }
}

async function readWithTimeout(reader) {
  let timer = null;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`读取 WAV 响应体连续 ${Math.round(DOWNLOAD_BODY_TIMEOUT_MS / 1000)} 秒没有返回数据`)), DOWNLOAD_BODY_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function bufferMediaResponse(response, url, slot) {
  if (!response?.ok) return response;
  const contentType = String(response.headers?.get('content-type') || '').toLowerCase();
  if (!isSunoMediaUrl(url) && !contentType.startsWith('audio/')) return response;

  const clipId = clipIdFromMediaUrl(url);
  const total = Number(response.headers?.get('content-length') || 0);
  emitDownloadDiag(clipId, `HTTP 200 后开始读取 WAV 响应体（账号 ${slot}）${total > 0 ? `，Content-Length=${formatMb(total)}` : '，Content-Length=未知'}`);

  try {
    let buffer;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const parts = [];
      let received = 0;
      let lastReported = 0;
      let lastReportAt = Date.now();
      try {
        while (true) {
          const { done, value } = await readWithTimeout(reader);
          if (done) break;
          if (!value?.byteLength) continue;
          const part = Buffer.from(value);
          parts.push(part);
          received += part.length;
          const now = Date.now();
          if (received - lastReported >= DOWNLOAD_PROGRESS_STEP_BYTES || now - lastReportAt >= 3000) {
            const totalText = total > 0 ? ` / ${formatMb(total)}` : '';
            const percent = total > 0 ? `（${Math.min(100, Math.round(received * 100 / total))}%）` : '';
            emitDownloadDiag(clipId, `WAV 响应体已接收 ${formatMb(received)}${totalText}${percent}`);
            lastReported = received;
            lastReportAt = now;
          }
        }
      } catch (error) {
        try { await reader.cancel(error); } catch {}
        throw error;
      }
      buffer = Buffer.concat(parts);
    } else {
      let timer = null;
      try {
        const ab = await Promise.race([
          response.arrayBuffer(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`读取 WAV 响应体超过 ${Math.round(DOWNLOAD_BODY_TIMEOUT_MS / 1000)} 秒`)), DOWNLOAD_BODY_TIMEOUT_MS);
          }),
        ]);
        buffer = Buffer.from(ab);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    if (!buffer?.length) throw new Error('HTTP 200，但 WAV 响应体为空');
    emitDownloadDiag(clipId, `WAV 响应体读取完成：${formatMb(buffer.length)}`);

    const headers = new Headers(response.headers || {});
    headers.set('Content-Length', String(buffer.length));
    return new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    emitDownloadDiag(clipId, `WAV 响应体读取失败：${error?.message || error}`);
    throw error;
  }
}

function installMediaBodyDiagnostics() {
  for (const slot of ACCOUNT_SLOTS) {
    const ses = sessionFor(slot);
    if (!ses || mediaDiagPatchedSessions.has(ses)) continue;
    const originalFetch = ses.fetch.bind(ses);
    const wrappedFetch = async (input, options = {}) => {
      const url = urlString(input);
      const response = await originalFetch(input, options);
      if (!isSunoMediaUrl(url)) return response;
      return bufferMediaResponse(response, url, slot);
    };
    try {
      ses.fetch = wrappedFetch;
    } catch {
      try { Object.defineProperty(ses, 'fetch', { configurable: true, writable: true, value: wrappedFetch }); } catch {}
    }
    mediaDiagPatchedSessions.add(ses);
  }
}

async function fetchStatusBatch(slot, batch, forceRefresh = false) {
  const ses = sessionFor(slot);
  const headers = await apiHeaders(slot, { json: false, forceRefresh });
  const ids = batch.map(song => String(song.clipId || song.id || '')).filter(Boolean);
  const url = `${SUNO_API}/api/feed/v2?ids=${encodeURIComponent(ids.join(','))}`;
  return ses.fetch(url, { headers, cache: 'no-store' });
}

async function refreshSlotSongs(slot, songs) {
  const now = new Date().toISOString();
  const batches = chunks(songs.filter(song => song?.clipId || song?.id), BATCH_SIZE);

  for (const batch of batches) {
    let res;
    try {
      res = await fetchStatusBatch(slot, batch, false);
      if (res.status === 401 || res.status === 403) res = await fetchStatusBatch(slot, batch, true);
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const message = `账号 ${slot} 读取歌曲状态失败（${res.status}）`;
        for (const song of batch) song.lastError = message;
        continue;
      }

      const byId = new Map(rawList(body).filter(x => x?.id).map(x => [String(x.id), x]));
      for (const song of batch) {
        const x = byId.get(String(song.clipId || song.id || ''));
        if (!x) continue;
        song.generationStatus = String(x.status || song.generationStatus || 'submitted');
        song.title = x.title || song.title;
        song.audioUrl = x.audio_url || x.audioUrl || song.audioUrl || '';
        song.duration = Number(x.metadata?.duration || x.duration || song.duration || 0);
        song.lastError = String(x.error_message || x.metadata?.error_message || '');
        song.updatedAt = now;
      }
    } catch (error) {
      const message = `账号 ${slot} 读取歌曲状态失败：${error?.message || error}`;
      for (const song of batch) song.lastError = message;
    }
  }
}

async function refreshLibrary(app) {
  const state = readState(app);
  const groups = new Map();
  for (const song of state.songs) {
    const slot = String(song.slot || '1');
    if (!groups.has(slot)) groups.set(slot, []);
    groups.get(slot).push(song);
  }

  for (const [slot, songs] of groups.entries()) await refreshSlotSongs(slot, songs);
  writeState(app, state);
  return state;
}

function installSongRefreshFix({ app, ipcMain }) {
  installMediaBodyDiagnostics();
  ipcMain.removeHandler('library:refresh');
  ipcMain.handle('library:refresh', async () => refreshLibrary(app));
}

module.exports = { installSongRefreshFix, refreshLibrary };
