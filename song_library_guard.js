const fs = require('fs');
const path = require('path');

let installed = false;
let originalRenameSync = null;

function parseJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function timeValue(value) {
  const n = Date.parse(String(value || ''));
  return Number.isFinite(n) ? n : 0;
}

function mergeSong(current, incoming) {
  if (!current) return incoming;
  if (!incoming) return current;

  const currentTime = timeValue(current.updatedAt || current.submittedAt);
  const incomingTime = timeValue(incoming.updatedAt || incoming.submittedAt);

  // Newer song state wins. This prevents a stale refresh snapshot from rolling
  // back download/de-AI/local state while still allowing a fresh Suno refresh
  // to update generation status and audio metadata.
  if (incomingTime >= currentTime) return { ...current, ...incoming };
  return { ...incoming, ...current };
}

function mergeLibraries(current, incoming) {
  if (!current || typeof current !== 'object') return incoming;
  if (!incoming || typeof incoming !== 'object') return current;

  const currentSongs = Array.isArray(current.songs) ? current.songs : [];
  const incomingSongs = Array.isArray(incoming.songs) ? incoming.songs : [];
  const byId = new Map();

  for (const song of currentSongs) {
    const id = String(song?.clipId || song?.id || '');
    if (!id) continue;
    byId.set(id, song);
  }
  for (const song of incomingSongs) {
    const id = String(song?.clipId || song?.id || '');
    if (!id) continue;
    byId.set(id, mergeSong(byId.get(id), song));
  }

  // Keep incoming ordering first, then append songs that only existed in the
  // latest on-disk state. This is the key protection against lost submissions.
  const ordered = [];
  const seen = new Set();
  for (const song of incomingSongs) {
    const id = String(song?.clipId || song?.id || '');
    if (!id || seen.has(id)) continue;
    ordered.push(byId.get(id));
    seen.add(id);
  }
  for (const song of currentSongs) {
    const id = String(song?.clipId || song?.id || '');
    if (!id || seen.has(id)) continue;
    ordered.push(byId.get(id));
    seen.add(id);
  }

  return {
    ...current,
    ...incoming,
    songs: ordered,
  };
}

function installSongLibraryWriteGuard(app) {
  if (installed) return;
  installed = true;

  const libraryPath = path.resolve(path.join(app.getPath('userData'), 'song-library-v1.json'));
  originalRenameSync = fs.renameSync.bind(fs);

  fs.renameSync = function guardedRenameSync(oldPath, newPath) {
    try {
      const target = path.resolve(String(newPath || ''));
      if (target === libraryPath && fs.existsSync(oldPath) && fs.existsSync(newPath)) {
        const incoming = parseJson(oldPath);
        const current = parseJson(newPath);
        if (incoming && current) {
          const merged = mergeLibraries(current, incoming);
          fs.writeFileSync(oldPath, JSON.stringify(merged, null, 2), 'utf8');
        }
      }
    } catch (error) {
      try {
        const line = `${new Date().toISOString()} merge-guard-error=${String(error?.message || error)}\n`;
        fs.appendFileSync(path.join(app.getPath('userData'), 'song-library-guard.log'), line, 'utf8');
      } catch {}
    }
    return originalRenameSync(oldPath, newPath);
  };
}

module.exports = { installSongLibraryWriteGuard, mergeLibraries };
