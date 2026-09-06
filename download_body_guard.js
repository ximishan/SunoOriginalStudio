const { session, BrowserWindow } = require('electron');
const { ACCOUNT_SLOTS, sessionFor } = require('./suno_session');

const BODY_TIMEOUT_MS = 90000;
const patchedSessions = new WeakSet();
const patchedResponses = new WeakSet();

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
    const audioPath = /\.(wav|mp3|m4a|flac|aac|ogg|webm)$/i.test(pathname) || /audio|download|uploads|generated|stream|wav|mp3/i.test(pathname);
    const mediaHost = host.endsWith('.amazonaws.com') || host.endsWith('.cloudfront.net') || host.endsWith('.suno.ai') || host.endsWith('.suno.com');
    return mediaHost && audioPath;
  } catch {
    return false;
  }
}

function clipIdFromUrl(url) {
  const text = String(url || '');
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
  return match ? match[0] : '-';
}

function formatMb(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MB`;
}

function emitDiag(clipId, message) {
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

function patchResponseArrayBuffer(response, url, sourceLabel) {
  if (!response || patchedResponses.has(response) || !isSunoMediaUrl(url)) return response;
  if (typeof response.arrayBuffer !== 'function') return response;

  const clipId = clipIdFromUrl(url);
  const originalArrayBuffer = response.arrayBuffer.bind(response);
  const total = Number(response.headers?.get?.('content-length') || 0);

  const guardedArrayBuffer = async () => {
    const startedAt = Date.now();
    emitDiag(clipId, `开始读取 WAV 正文（${sourceLabel}）${total > 0 ? `，预计 ${formatMb(total)}` : '，Content-Length 未知'}`);

    let timer = null;
    const bodyPromise = Promise.resolve().then(() => originalArrayBuffer());
    try {
      const data = await Promise.race([
        bodyPromise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`ERR_TIMED_OUT: WAV HTTP 200 后 ${Math.round(BODY_TIMEOUT_MS / 1000)} 秒仍未读取完成`)), BODY_TIMEOUT_MS);
        }),
      ]);

      const bytes = Number(data?.byteLength || 0);
      const elapsedMs = Math.max(1, Date.now() - startedAt);
      if (!bytes) {
        throw new Error('ERR_EMPTY_RESPONSE: Suno WAV 返回 HTTP 200，但响应正文为 0 字节');
      }

      const speed = bytes / 1024 / 1024 / (elapsedMs / 1000);
      emitDiag(clipId, `WAV 正文读取完成：${formatMb(bytes)}，耗时 ${(elapsedMs / 1000).toFixed(1)} 秒，平均 ${speed.toFixed(2)} MB/s`);
      return data;
    } catch (error) {
      emitDiag(clipId, `WAV 正文读取失败：${error?.message || error}`);
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      bodyPromise.catch(() => {});
    }
  };

  let installed = false;
  try {
    response.arrayBuffer = guardedArrayBuffer;
    installed = response.arrayBuffer === guardedArrayBuffer;
  } catch {}
  if (!installed) {
    try {
      Object.defineProperty(response, 'arrayBuffer', {
        configurable: true,
        writable: true,
        value: guardedArrayBuffer,
      });
      installed = true;
    } catch {}
  }

  if (installed) patchedResponses.add(response);
  else emitDiag(clipId, '无法安装 WAV 正文读取保护，继续使用原始 Response');
  return response;
}

function patchSession(ses, sourceLabel) {
  if (!ses || patchedSessions.has(ses) || typeof ses.fetch !== 'function') return;
  const originalFetch = ses.fetch.bind(ses);

  const wrappedFetch = async (input, options = {}) => {
    const url = urlString(input);
    const response = await originalFetch(input, options);
    return patchResponseArrayBuffer(response, url, sourceLabel);
  };

  let installed = false;
  try {
    ses.fetch = wrappedFetch;
    installed = ses.fetch === wrappedFetch;
  } catch {}
  if (!installed) {
    try {
      Object.defineProperty(ses, 'fetch', {
        configurable: true,
        writable: true,
        value: wrappedFetch,
      });
      installed = true;
    } catch {}
  }
  if (installed) patchedSessions.add(ses);
}

function installDownloadBodyGuard() {
  for (const slot of ACCOUNT_SLOTS) patchSession(sessionFor(slot), `账号 ${slot} Session`);
  patchSession(session.defaultSession, 'defaultSession');
}

module.exports = { installDownloadBodyGuard };
