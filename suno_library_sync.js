const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sessionFor, apiHeaders } = require('./suno_session');

const SUNO_API = 'https://studio-api-prod.suno.com';

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

function rawList(body) {
  if (Array.isArray(body)) return body;
  for (const key of ['clips', 'items', 'results', 'data']) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return [];
}

function createdAtOf(clip) {
  return clip?.created_at || clip?.createdAt || clip?.metadata?.created_at || clip?.metadata?.createdAt || '';
}

function promptOf(clip) {
  return String(clip?.metadata?.prompt || clip?.prompt || clip?.metadata?.lyrics || '');
}

function tagsOf(clip) {
  return String(clip?.metadata?.tags || clip?.tags || '');
}

function negativeTagsOf(clip) {
  return String(clip?.metadata?.negative_tags || clip?.negative_tags || '');
}

function modelOf(clip) {
  return String(clip?.metadata?.model_name || clip?.metadata?.mv || clip?.model_name || '');
}

function statusOf(clip) {
  return String(clip?.status || 'submitted');
}

async function fetchRecentSunoClips(slot, limit = 50) {
  slot = String(slot || '1');
  const headers = await apiHeaders(slot, { json: false });
  const ses = sessionFor(slot);
  const candidates = [
    `${SUNO_API}/api/feed/v3?page=1&page_size=${encodeURIComponent(limit)}`,
    `${SUNO_API}/api/feed/v2?page=1&page_size=${encodeURIComponent(limit)}`,
    `${SUNO_API}/api/feed/?page=1&page_size=${encodeURIComponent(limit)}`,
  ];
  let lastError = '';
  for (const url of candidates) {
    try {
      const res = await ses.fetch(url, { headers, cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const clips = rawList(body).filter(x => x?.id);
      if (clips.length || body) return clips.slice(0, limit);
    } catch (e) {
      lastError = String(e?.message || e);
    }
  }
  throw new Error(`账号 ${slot} 读取 Suno 最近作品失败${lastError ? `：${lastError}` : ''}`);
}

function makeImportedSong(clip, slot, version = 1) {
  const now = new Date().toISOString();
  const created = createdAtOf(clip) || now;
  const title = String(clip?.title || '').trim() || '未命名';
  return {
    id: clip.id,
    clipId: clip.id,
    submissionId: `suno-sync-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    version,
    title,
    lyrics: promptOf(clip),
    stylePrompt: tagsOf(clip),
    negativeStyle: negativeTagsOf(clip),
    slot: String(slot),
    modelVersion: modelOf(clip),
    vocalGender: '',
    weirdness: 0,
    styleInfluence: 0,
    submittedAt: created,
    generationStatus: statusOf(clip),
    audioUrl: String(clip?.audio_url || clip?.audioUrl || ''),
    wavUrl: '',
    duration: Number(clip?.metadata?.duration || clip?.duration || 0),
    wavStatus: 'not_downloaded',
    deaiStatus: 'not_processed',
    localStatus: 'not_saved',
    localDir: '',
    sourceWavPath: '',
    processedWavPath: '',
    lyricsPath: '',
    lastError: String(clip?.error_message || clip?.metadata?.error_message || ''),
    updatedAt: now,
    syncSource: 'suno-feed',
  };
}

async function syncRecentSongs(app, options = {}) {
  const slot = String(options.slot || '1');
  const limit = Math.max(10, Math.min(200, Number(options.limit || 50)));
  const clips = await fetchRecentSunoClips(slot, limit);
  const state = readState(app);
  const existingIds = new Set(state.songs.map(x => String(x.clipId || x.id || '')).filter(Boolean));
  const missing = clips.filter(x => !existingIds.has(String(x.id)));

  const versionByTitle = new Map();
  for (const song of state.songs) {
    const key = String(song.title || '').trim().toLowerCase();
    if (!key) continue;
    versionByTitle.set(key, Math.max(versionByTitle.get(key) || 0, Number(song.version || 0)));
  }

  const imported = [];
  for (const clip of missing.slice().reverse()) {
    const key = String(clip.title || '').trim().toLowerCase();
    const nextVersion = key ? (versionByTitle.get(key) || 0) + 1 : 1;
    if (key) versionByTitle.set(key, nextVersion);
    const song = makeImportedSong(clip, slot, nextVersion);
    state.songs.unshift(song);
    imported.push(song);
  }

  if (imported.length) writeState(app, state);
  return {
    slot,
    scanned: clips.length,
    existing: clips.length - missing.length,
    missing: missing.length,
    imported: imported.length,
    importedClipIds: imported.map(x => x.clipId),
    state: readState(app),
  };
}

function registerSunoLibrarySyncIpc({ app, ipcMain }) {
  ipcMain.handle('library:sync-suno', async (_event, options) => syncRecentSongs(app, options || {}));
}

module.exports = { registerSunoLibrarySyncIpc, syncRecentSongs };
