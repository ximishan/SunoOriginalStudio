const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sessionFor, apiHeaders } = require('./suno_session');

const SUNO_API = 'https://studio-api-prod.suno.com';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function errorDetail(body) {
  if (!body) return '';
  if (typeof body?.detail === 'string') return body.detail;
  if (typeof body?.message === 'string') return body.message;
  try {
    const text = JSON.stringify(body?.detail ?? body);
    return text === '{}' ? '' : text;
  } catch {
    return '';
  }
}

async function postFeedV3(slot, limit, forceRefresh = false) {
  const ses = sessionFor(slot);
  const headers = await apiHeaders(slot, { forceRefresh });
  const effectiveLimit = Math.max(10, Math.min(50, Number(limit || 50)));
  const res = await ses.fetch(`${SUNO_API}/api/feed/v3`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      filters: { trashed: 'False' },
      limit: effectiveLimit,
    }),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  return { res, body, effectiveLimit };
}

async function fetchRecentSunoClips(slot, limit = 50) {
  slot = String(slot || '1');

  // Current Suno/AVR workspace feed is POST /api/feed/v3 with a JSON body.
  // The old GET ?page=... form can return an incomplete/different feed and is
  // deliberately not used for recovery anymore.
  let result = await postFeedV3(slot, limit, false);
  if (result.res.status === 401 || result.res.status === 403) {
    result = await postFeedV3(slot, limit, true);
  }

  if (!result.res.ok) {
    const detail = errorDetail(result.body);
    throw new Error(`账号 ${slot} 读取 Suno 作品失败：HTTP ${result.res.status}${detail ? ` · ${detail}` : ''}`);
  }

  return rawList(result.body)
    .filter(x => x?.id)
    .sort((a, b) => Date.parse(createdAtOf(b) || 0) - Date.parse(createdAtOf(a) || 0))
    .slice(0, result.effectiveLimit);
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
    syncSource: 'suno-feed-v3-post',
  };
}

function importMissingClips(app, slot, clips) {
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
  return { missing, imported };
}

async function syncRecentSongs(app, options = {}) {
  const slot = String(options.slot || '1');
  const requestedLimit = Math.max(10, Math.min(200, Number(options.limit || 50)));
  const rounds = Math.max(1, Math.min(10, Number(options.rounds || 6)));
  const waitMs = Math.max(1000, Math.min(15000, Number(options.waitMs || 4000)));
  const stopAfterStableRounds = Math.max(1, Math.min(4, Number(options.stopAfterStableRounds || 3)));

  const seenRemote = new Map();
  const importedIds = new Set();
  let stableRounds = 0;
  let lastRemoteSignature = '';
  let executedRounds = 0;

  for (let round = 1; round <= rounds; round += 1) {
    executedRounds = round;
    const clips = await fetchRecentSunoClips(slot, requestedLimit);
    for (const clip of clips) {
      const id = String(clip?.id || '');
      if (id) seenRemote.set(id, clip);
    }

    const result = importMissingClips(app, slot, [...seenRemote.values()]);
    for (const song of result.imported) importedIds.add(String(song.clipId));

    const signature = [...seenRemote.keys()].sort().join(',');
    if (signature === lastRemoteSignature && result.imported.length === 0) stableRounds += 1;
    else stableRounds = 0;
    lastRemoteSignature = signature;

    if (round >= rounds || stableRounds >= stopAfterStableRounds) break;
    await sleep(waitMs);
  }

  const state = readState(app);
  const currentIds = new Set(state.songs.map(x => String(x.clipId || x.id || '')).filter(Boolean));
  let existing = 0;
  for (const id of seenRemote.keys()) if (currentIds.has(id)) existing += 1;

  return {
    slot,
    scanned: seenRemote.size,
    existing,
    missing: importedIds.size,
    imported: importedIds.size,
    importedClipIds: [...importedIds],
    rounds: executedRounds,
    source: 'feed-v3-post',
    requestedLimit,
    effectiveLimit: Math.min(50, requestedLimit),
    state,
  };
}

function registerSunoLibrarySyncIpc({ app, ipcMain }) {
  ipcMain.handle('library:sync-suno', async (_event, options) => syncRecentSongs(app, options || {}));
}

module.exports = { registerSunoLibrarySyncIpc, syncRecentSongs, fetchRecentSunoClips };
