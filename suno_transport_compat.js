const { session, BrowserWindow } = require('electron');
const { randomUUID } = require('crypto');
const { ACCOUNT_SLOTS, sessionFor, partitionFor } = require('./suno_session');

const SUNO_API_HOST = 'studio-api-prod.suno.com';
const patchedSessions = new WeakSet();
const originalFetchBySession = new WeakMap();
const fallbackDeviceIds = new Map();
const mediaResolveInflight = new Map();
let defaultSessionPatched = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function isStudioApi(url) {
  try { return new URL(url).hostname.toLowerCase() === SUNO_API_HOST; }
  catch { return false; }
}

function isConvertWav(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase() === SUNO_API_HOST && /\/api\/gen\/[^/]+\/convert_wav\/$/i.test(u.pathname);
  } catch { return false; }
}

function wavFileClipId(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/api\/gen\/([^/]+)\/wav_file\/$/i);
    return m ? m[1] : '';
  } catch { return ''; }
}

function hasSignedQuery(u) {
  const q = u.searchParams;
  return q.has('X-Amz-Signature') || q.has('X-Amz-Credential') || q.has('AWSAccessKeyId') || (q.has('Signature') && q.has('Expires')) || q.has('Policy') || q.has('Key-Pair-Id');
}

function isSunoMediaDownload(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    if (hasSignedQuery(u)) return true;

    const sunoHost = host === 'cdn1.suno.ai' || /^cdn\d*\.suno\.ai$/i.test(host) || host.endsWith('.suno.ai') || host.endsWith('.suno.com');
    const cloudHost = host.endsWith('.cloudfront.net') || host.endsWith('.amazonaws.com');
    const audioPath = /\.(wav|mp3|m4a|flac|aac|ogg|webm)(?:$|[?#])/i.test(url) || /audio|download|generated|wav|mp3|stream/i.test(path);

    return (sunoHost && audioPath) || (cloudHost && audioPath);
  } catch { return false; }
}

function looksLikePlayableMedia(url, mimeType = '') {
  if (!url) return false;
  const type = String(mimeType || '').toLowerCase();
  if (type.startsWith('audio/')) return true;
  if (/\.(mp3|wav|m4a|flac|aac|ogg|webm)(?:$|[?#])/i.test(url)) return true;
  return /cdn\d*\.suno\.ai/i.test(url) && /audio|mp3|wav|stream|generated/i.test(url);
}

function decodeEscapedUrl(value) {
  return String(value || '')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u002F/gi, '/')
    .replace(/\\\//g, '/')
    .replace(/&amp;/g, '&');
}

function extractMediaUrlFromText(text) {
  const body = String(text || '');
  const patterns = [
    /"audio_url"\s*:\s*"(https?:\/\/[^"\\]+(?:\\.[^"\\]*)*)/i,
    /"audioUrl"\s*:\s*"(https?:\/\/[^"\\]+(?:\\.[^"\\]*)*)/i,
    /"clip_url"\s*:\s*"(https?:\/\/[^"\\]+(?:\\.[^"\\]*)*)/i,
    /(https?:\/\/cdn\d*\.suno\.ai\/[^\s"'<>]+\.(?:mp3|wav|m4a|aac|ogg|webm)[^\s"'<>]*)/i,
  ];
  for (const re of patterns) {
    const match = body.match(re);
    if (match?.[1]) return decodeEscapedUrl(match[1]);
  }
  return '';
}

function getFallbackDeviceId(slot) {
  slot = String(slot || '1');
  let value = fallbackDeviceIds.get(slot);
  if (!value) {
    value = randomUUID();
    fallbackDeviceIds.set(slot, value);
  }
  return value;
}

function cloneHeaders(input) {
  try { return new Headers(input || {}); }
  catch {
    const headers = new Headers();
    for (const [key, value] of Object.entries(input || {})) {
      if (value != null) headers.set(key, String(value));
    }
    return headers;
  }
}

function stripMediaDownloadHeaders(input) {
  const headers = cloneHeaders(input);
  for (const name of ['Authorization', 'Browser-Token', 'Device-Id', 'X-Suno-Client', 'Content-Type']) {
    try { headers.delete(name); } catch {}
  }
  return headers;
}

async function resolveMediaFromSongPage(slot, clipId) {
  const ses = sessionFor(slot);
  const pageUrl = `https://suno.com/song/${encodeURIComponent(clipId)}`;
  try {
    const response = await ses.fetch(pageUrl, { cache: 'no-store' });
    if (response.ok) {
      const text = await response.text().catch(() => '');
      const found = extractMediaUrlFromText(text);
      if (found) return found;
    }
  } catch {}
  return '';
}

async function resolveMediaFromHiddenPlayback(slot, clipId) {
  const pageUrl = `https://suno.com/song/${encodeURIComponent(clipId)}`;
  let win = null;
  let resolved = false;
  let foundUrl = '';
  let timeout = null;
  let onDebuggerMessage = null;

  try {
    win = new BrowserWindow({
      show: false,
      width: 960,
      height: 720,
      webPreferences: {
        partition: partitionFor(slot),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });

    const wc = win.webContents;
    try { wc.debugger.attach('1.3'); } catch {}
    try { await wc.debugger.sendCommand('Network.enable'); } catch {}

    const resultPromise = new Promise(resolve => {
      const finish = value => {
        if (resolved) return;
        resolved = true;
        foundUrl = value || '';
        resolve(foundUrl);
      };

      onDebuggerMessage = (_event, method, params) => {
        if (method !== 'Network.responseReceived') return;
        const response = params?.response || {};
        const url = String(response.url || '');
        const mime = String(response.mimeType || '');
        if (looksLikePlayableMedia(url, mime)) finish(url);
      };
      wc.debugger.on('message', onDebuggerMessage);

      timeout = setTimeout(() => finish(''), 16000);
    });

    await win.loadURL(pageUrl).catch(() => {});

    for (let i = 0; i < 5 && !resolved; i += 1) {
      try {
        const direct = await wc.executeJavaScript(`(() => {
          const media = document.querySelector('audio, video');
          const src = media?.currentSrc || media?.src || '';
          if (src) return src;
          const entries = performance.getEntriesByType('resource') || [];
          const hit = entries.map(x => x.name).find(u => /cdn\\d*\\.suno\\.ai|\\.(mp3|wav|m4a|aac|ogg|webm)(?:$|[?#])/i.test(u));
          return hit || '';
        })()`, true);
        if (direct && looksLikePlayableMedia(String(direct))) {
          foundUrl = String(direct);
          resolved = true;
          break;
        }
      } catch {}

      try {
        await wc.executeJavaScript(`(() => {
          const media = document.querySelector('audio, video');
          if (media) {
            try { media.currentTime = 0; } catch {}
            media.muted = false;
            media.volume = 1;
            media.play().catch(() => {});
          }
          const controls = Array.from(document.querySelectorAll('button, [role="button"]'));
          const play = controls.find(item => /^play$/i.test((item.getAttribute('aria-label') || '').trim())) ||
            controls.find(item => /play|播放/i.test([
              item.getAttribute('aria-label') || '',
              item.getAttribute('title') || '',
              item.textContent || ''
            ].join(' ')));
          if (play) play.click();
          return Boolean(media || play);
        })()`, true);
      } catch {}

      await Promise.race([resultPromise, sleep(1800)]);
    }

    if (!foundUrl && !resolved) foundUrl = await resultPromise;
    return foundUrl || '';
  } catch {
    return '';
  } finally {
    if (timeout) clearTimeout(timeout);
    try {
      if (win && onDebuggerMessage && win.webContents.debugger.isAttached()) {
        win.webContents.debugger.removeListener('message', onDebuggerMessage);
      }
    } catch {}
    try { if (win && win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    try { if (win && !win.isDestroyed()) win.destroy(); } catch {}
  }
}

async function resolvePlaybackMediaUrl(slot, clipId) {
  const key = `${slot}:${clipId}`;
  const existing = mediaResolveInflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const staticUrl = await resolveMediaFromSongPage(slot, clipId);
    if (staticUrl) return staticUrl;
    return resolveMediaFromHiddenPlayback(slot, clipId);
  })().finally(() => mediaResolveInflight.delete(key));

  mediaResolveInflight.set(key, promise);
  return promise;
}

function validWavPayload(data) {
  const url = data?.wav_file_url || data?.audio_url_wav || data?.wav_url || '';
  return typeof url === 'string' && url.startsWith('http');
}

function syntheticWavResponse(mediaUrl) {
  return new Response(JSON.stringify({
    wav_file_url: mediaUrl,
    fallback_media_url: true,
    fallback_source: 'suno-song-playback',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function patchAccountSession(slot) {
  const ses = sessionFor(slot);
  if (patchedSessions.has(ses)) return ses;

  const originalFetch = ses.fetch.bind(ses);
  originalFetchBySession.set(ses, originalFetch);

  const wrappedFetch = async (input, options = {}) => {
    const url = urlString(input);

    if (isSunoMediaDownload(url) && !isStudioApi(url)) {
      return originalFetch(input, { ...options, headers: stripMediaDownloadHeaders(options.headers), cache: 'no-store' });
    }

    if (!isStudioApi(url)) return originalFetch(input, options);

    const headers = cloneHeaders(options.headers);
    if (!headers.has('X-Suno-Client')) headers.set('X-Suno-Client', 'Web');
    if (!headers.has('Device-Id')) headers.set('Device-Id', getFallbackDeviceId(slot));

    const next = { ...options, headers };
    if (String(options.method || 'GET').toUpperCase() === 'POST' && isConvertWav(url) && options.body == null) {
      next.body = '{}';
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }

    const clipId = wavFileClipId(url);
    if (!clipId) return originalFetch(input, next);

    let response = null;
    try {
      response = await originalFetch(input, next);
      if (response.ok) {
        const clone = response.clone();
        const data = await clone.json().catch(() => null);
        if (validWavPayload(data)) return response;
      }
    } catch {}

    const mediaUrl = await resolvePlaybackMediaUrl(slot, clipId).catch(() => '');
    if (mediaUrl) return syntheticWavResponse(mediaUrl);
    if (response) return response;
    return originalFetch(input, next);
  };

  try {
    ses.fetch = wrappedFetch;
  } catch {
    try { Object.defineProperty(ses, 'fetch', { configurable: true, writable: true, value: wrappedFetch }); } catch {}
  }
  patchedSessions.add(ses);
  return ses;
}

function patchDefaultSession() {
  if (defaultSessionPatched) return;
  const ses = session.defaultSession;
  if (!ses) return;
  defaultSessionPatched = true;

  const originalDefaultFetch = ses.fetch.bind(ses);
  const wrapped = async (input, options = {}) => {
    const url = urlString(input);
    if (!isSunoMediaDownload(url)) return originalDefaultFetch(input, options);

    const cleanOptions = { ...options, headers: stripMediaDownloadHeaders(options.headers), cache: 'no-store' };
    let lastResponse = null;
    let lastError = null;

    for (const slot of ACCOUNT_SLOTS) {
      try {
        const accountSession = patchAccountSession(slot);
        const response = await accountSession.fetch(input, cleanOptions);
        if (response.ok) return response;
        lastResponse = response;
      } catch (error) {
        lastError = error;
      }
    }

    try {
      const response = await originalDefaultFetch(input, cleanOptions);
      if (response.ok) return response;
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }

    if (lastResponse) return lastResponse;
    throw lastError || new Error('Suno 媒体下载失败');
  };

  try {
    ses.fetch = wrapped;
  } catch {
    try { Object.defineProperty(ses, 'fetch', { configurable: true, writable: true, value: wrapped }); } catch {}
  }
}

function installSunoTransportCompatibility() {
  for (const slot of ACCOUNT_SLOTS) patchAccountSession(slot);
  patchDefaultSession();
}

module.exports = { installSunoTransportCompatibility };
