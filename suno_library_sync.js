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

function clipSummary(clip) {
  return {
    id: String(clip?.id || ''),
    title: String(clip?.title || '').trim() || '未命名',
    status: statusOf(clip),
    createdAt: createdAtOf(clip),
  };
}

async function postFeedV3(slot, limit, cursor = '', forceRefresh = false) {
  const ses = sessionFor(slot);
  const headers = await apiHeaders(slot, { forceRefresh });
  const effectiveLimit = Math.max(10, Math.min(50, Number(limit || 50)));
  const requestBody = {
    filters: { trashed: 'False' },
    limit: effectiveLimit,
  };
  if (cursor) requestBody.cursor = cursor;
  const res = await ses.fetch(`${SUNO_API}/api/feed/v3`, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  return { res, body, effectiveLimit };
}

async function fetchRecentSunoClips(slot, limit = 50, diagnostics = []) {
  slot = String(slot || '1');
  const requestedLimit = Math.max(10, Math.min(200, Number(limit || 50)));
  const collected = new Map();
  let cursor = '';
  let page = 0;
  let forceRefresh = false;

  while (collected.size < requestedLimit && page < 10) {
    page += 1;
    const pageLimit = Math.min(50, requestedLimit - collected.size);
    diagnostics.push(`[feed] 账号${slot} -> POST /api/feed/v3，第${page}页，limit=${pageLimit}${cursor ? '，带 cursor' : ''}`);

    let result = await postFeedV3(slot, pageLimit, cursor, forceRefresh);
    diagnostics.push(`[feed] 第${page}页 HTTP ${result.res.status}${result.res.ok ? ' OK' : ''}`);
    if ((result.res.status === 401 || result.res.status === 403) && !forceRefresh) {
      diagnostics.push(`[feed] 收到 ${result.res.status}，强制刷新 token 后重试`);
      forceRefresh = true;
      result = await postFeedV3(slot, pageLimit, cursor, true);
      diagnostics.push(`[feed] 第${page}页重试 HTTP ${result.res.status}${result.res.ok ? ' OK' : ''}`);
    }

    if (!result.res.ok) {
      const detail = errorDetail(result.body);
      diagnostics.push(`[feed] 请求失败：${detail || '无详细错误'}`);
      const error = new Error(`账号 ${slot} 读取 Suno 作品失败：HTTP ${result.res.status}${detail ? ` · ${detail}` : ''}`);
      error.diagnostics = diagnostics.slice();
      throw error;
    }

    const pageClips = rawList(result.body).filter(x => x?.id);
    const nextCursor = String(result.body?.next_cursor || result.body?.nextCursor || '');
    const hasMore = Boolean(result.body?.has_more ?? result.body?.hasMore ?? nextCursor);
    diagnostics.push(`[feed] 返回结构=${Array.isArray(result.body) ? 'array' : Object.keys(result.body || {}).join(',') || 'null'}，本页有效 clip=${pageClips.length}，has_more=${hasMore}，next_cursor=${nextCursor ? '有' : '无'}`);

    for (const clip of pageClips) {
      const id = String(clip?.id || '');
      if (id && !collected.has(id)) collected.set(id, clip);
    }

    if (!pageClips.length || !hasMore || !nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }

  const all = [...collected.values()]
    .sort((a, b) => Date.parse(createdAtOf(b) || 0) - Date.parse(createdAtOf(a) || 0))
    .slice(0, requestedLimit);

  diagnostics.push(`[feed] 合计取得 ${all.length}/${requestedLimit} 个 clip`);
  for (const clip of all.slice(0, 30)) {
    const s = clipSummary(clip);
    diagnostics.push(`[remote] ${s.title} | ${s.id} | ${s.status}${s.createdAt ? ` | ${s.createdAt}` : ''}`);
  }
  if (all.length > 30) diagnostics.push(`[remote] ...其余 ${all.length - 30} 个未展开`);
  return all;
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

function reconcileClips(app, slot, clips, diagnostics = []) {
  const state = readState(app);
  const byId = new Map();
  for (const song of state.songs) {
    const id = String(song.clipId || song.id || '');
    if (id) byId.set(id, song);
  }
  const missing = clips.filter(x => !byId.has(String(x.id)));

  diagnostics.push(`[local] 同步前本地歌曲=${state.songs.length}，本地 clipId=${byId.size}`);
  diagnostics.push(`[diff] 远端=${clips.length}，已存在=${clips.length - missing.length}，缺失=${missing.length}`);

  const versionByTitle = new Map();
  for (const song of state.songs) {
    const key = String(song.title || '').trim().toLowerCase();
    if (!key) continue;
    versionByTitle.set(key, Math.max(versionByTitle.get(key) || 0, Number(song.version || 0)));
  }

  const imported = [];
  const repaired = [];
  const now = new Date().toISOString();

  for (const clip of clips) {
    const id = String(clip?.id || '');
    if (!id) continue;
    const local = byId.get(id);
    if (!local) continue;

    const beforeTitle = String(local.title || '').trim() || '未命名';
    const remoteTitle = String(clip?.title || '').trim() || beforeTitle;
    const created = createdAtOf(clip);
    const remoteStatus = statusOf(clip);
    const remoteAudio = String(clip?.audio_url || clip?.audioUrl || '');
    const remoteDuration = Number(clip?.metadata?.duration || clip?.duration || 0);
    let changed = false;

    const setIfDifferent = (key, value) => {
      if (value === undefined || value === null || value === '') return;
      if (String(local[key] ?? '') !== String(value)) {
        local[key] = value;
        changed = true;
      }
    };

    setIfDifferent('title', remoteTitle);
    setIfDifferent('submittedAt', created);
    setIfDifferent('generationStatus', remoteStatus);
    if (remoteAudio) setIfDifferent('audioUrl', remoteAudio);
    if (remoteDuration > 0) setIfDifferent('duration', remoteDuration);
    setIfDifferent('slot', String(slot));
    setIfDifferent('modelVersion', modelOf(clip));
    if (!String(local.lyrics || '').trim()) setIfDifferent('lyrics', promptOf(clip));
    if (!String(local.stylePrompt || '').trim()) setIfDifferent('stylePrompt', tagsOf(clip));
    if (!String(local.negativeStyle || '').trim()) setIfDifferent('negativeStyle', negativeTagsOf(clip));
    local.lastError = String(clip?.error_message || clip?.metadata?.error_message || local.lastError || '');

    if (changed) {
      local.updatedAt = now;
      local.syncSource = 'suno-feed-v3-post-reconciled';
      repaired.push(local);
      diagnostics.push(`[repair] ${id} | ${beforeTitle} -> ${remoteTitle}${created ? ` | ${created}` : ''}`);
    }
  }

  for (const clip of missing.slice().reverse()) {
    diagnostics.push(`[missing] ${String(clip?.title || '').trim() || '未命名'} | ${String(clip?.id || '')}`);
    const key = String(clip.title || '').trim().toLowerCase();
    const nextVersion = key ? (versionByTitle.get(key) || 0) + 1 : 1;
    if (key) versionByTitle.set(key, nextVersion);
    const song = makeImportedSong(clip, slot, nextVersion);
    state.songs.push(song);
    imported.push(song);
    diagnostics.push(`[import] ${song.title} v${song.version} | ${song.clipId}`);
  }

  if (imported.length || repaired.length) {
    state.songs.sort((a, b) => {
      const ta = Date.parse(a.submittedAt || a.updatedAt || 0) || 0;
      const tb = Date.parse(b.submittedAt || b.updatedAt || 0) || 0;
      return tb - ta;
    });
    writeState(app, state);
    const verifyState = readState(app);
    diagnostics.push(`[write] 新增=${imported.length}，校正=${repaired.length}；写入后本地歌曲=${verifyState.songs.length}`);
    const verifyById = new Map(verifyState.songs.map(x => [String(x.clipId || x.id || ''), x]));
    for (const song of imported) diagnostics.push(`[verify] 新增 ${song.clipId}=${verifyById.has(String(song.clipId)) ? '存在' : '未找到'}`);
    for (const song of repaired.slice(0, 20)) {
      const saved = verifyById.get(String(song.clipId));
      diagnostics.push(`[verify] 校正 ${song.clipId}=${saved ? saved.title : '未找到'}`);
    }
  } else {
    diagnostics.push('[write] 无缺失且已有记录元数据一致，不执行写库');
  }

  return { missing, imported, repaired };
}

async function syncRecentSongs(app, options = {}) {
  const slot = String(options.slot || '1');
  const requestedLimit = Math.max(10, Math.min(200, Number(options.limit || 50)));
  const rounds = Math.max(1, Math.min(10, Number(options.rounds || 6)));
  const waitMs = Math.max(1000, Math.min(15000, Number(options.waitMs || 4000)));
  const stopAfterStableRounds = Math.max(1, Math.min(4, Number(options.stopAfterStableRounds || 3)));

  const diagnostics = [];
  diagnostics.push(`[sync] 开始：账号=${slot}，requestedLimit=${requestedLimit}，rounds=${rounds}`);
  diagnostics.push(`[sync] library=${libraryFile(app)}`);

  const seenRemote = new Map();
  const importedIds = new Set();
  const repairedIds = new Set();
  let stableRounds = 0;
  let lastRemoteSignature = '';
  let executedRounds = 0;

  try {
    for (let round = 1; round <= rounds; round += 1) {
      executedRounds = round;
      diagnostics.push(`----- 第 ${round}/${rounds} 轮 -----`);
      const clips = await fetchRecentSunoClips(slot, requestedLimit, diagnostics);
      for (const clip of clips) {
        const id = String(clip?.id || '');
        if (id) seenRemote.set(id, clip);
      }

      const result = reconcileClips(app, slot, [...seenRemote.values()], diagnostics);
      for (const song of result.imported) importedIds.add(String(song.clipId));
      for (const song of result.repaired) repairedIds.add(String(song.clipId));

      const signature = [...seenRemote.keys()].sort().join(',');
      if (signature === lastRemoteSignature && result.imported.length === 0 && result.repaired.length === 0) stableRounds += 1;
      else stableRounds = 0;
      lastRemoteSignature = signature;
      diagnostics.push(`[round] 累计远端=${seenRemote.size}，本轮导入=${result.imported.length}，本轮校正=${result.repaired.length}，stable=${stableRounds}/${stopAfterStableRounds}`);

      if (round >= rounds || stableRounds >= stopAfterStableRounds) break;
      diagnostics.push(`[round] 等待 ${waitMs}ms 后继续`);
      await sleep(waitMs);
    }
  } catch (e) {
    const combined = Array.isArray(e?.diagnostics) ? e.diagnostics : diagnostics;
    e.diagnostics = combined;
    throw e;
  }

  const state = readState(app);
  const currentIds = new Set(state.songs.map(x => String(x.clipId || x.id || '')).filter(Boolean));
  let existing = 0;
  for (const id of seenRemote.keys()) if (currentIds.has(id)) existing += 1;
  diagnostics.push(`[done] 扫描=${seenRemote.size}，本地已存在=${existing}，本次补回=${importedIds.size}，校正=${repairedIds.size}，最终本地=${state.songs.length}`);

  return {
    slot,
    scanned: seenRemote.size,
    existing,
    missing: importedIds.size,
    imported: importedIds.size,
    repaired: repairedIds.size,
    importedClipIds: [...importedIds],
    repairedClipIds: [...repairedIds],
    rounds: executedRounds,
    source: 'feed-v3-post-cursor',
    requestedLimit,
    effectiveLimit: requestedLimit,
    diagnostics,
    state,
  };
}

function registerSunoLibrarySyncIpc({ app, ipcMain }) {
  ipcMain.handle('library:sync-suno', async (_event, options) => {
    try {
      return await syncRecentSongs(app, options || {});
    } catch (e) {
      const message = e?.message || String(e);
      const diagnostics = Array.isArray(e?.diagnostics) ? e.diagnostics : [];
      const wrapped = new Error(`${message}${diagnostics.length ? `\n\n[同步诊断]\n${diagnostics.join('\n')}` : ''}`);
      throw wrapped;
    }
  });
}

module.exports = { registerSunoLibrarySyncIpc, syncRecentSongs, fetchRecentSunoClips };
