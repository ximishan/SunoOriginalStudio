const fs = require('fs');
const path = require('path');
const { sessionFor, apiHeaders } = require('./suno_session');

const SUNO_API = 'https://studio-api-prod.suno.com';
const BATCH_SIZE = 20;

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
  ipcMain.removeHandler('library:refresh');
  ipcMain.handle('library:refresh', async () => refreshLibrary(app));
}

module.exports = { installSongRefreshFix, refreshLibrary };
