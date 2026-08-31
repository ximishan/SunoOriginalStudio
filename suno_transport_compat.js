const { session } = require('electron');
const { randomUUID } = require('crypto');
const { ACCOUNT_SLOTS, sessionFor } = require('./suno_session');

const SUNO_API_HOST = 'studio-api-prod.suno.com';
const patchedSessions = new WeakSet();
const originalFetchBySession = new WeakMap();
const fallbackDeviceIds = new Map();
let defaultSessionPatched = false;

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

function isPresignedDownload(url) {
  try {
    const u = new URL(url);
    const q = u.searchParams;
    return q.has('X-Amz-Signature') || q.has('X-Amz-Credential') || q.has('AWSAccessKeyId') || (q.has('Signature') && q.has('Expires'));
  } catch { return false; }
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

function stripSignedDownloadHeaders(input) {
  const headers = cloneHeaders(input);
  for (const name of ['Authorization', 'Browser-Token', 'Device-Id', 'X-Suno-Client']) {
    try { headers.delete(name); } catch {}
  }
  return headers;
}

function patchAccountSession(slot) {
  const ses = sessionFor(slot);
  if (patchedSessions.has(ses)) return ses;

  const originalFetch = ses.fetch.bind(ses);
  originalFetchBySession.set(ses, originalFetch);

  const wrappedFetch = async (input, options = {}) => {
    const url = urlString(input);
    if (!isStudioApi(url)) return originalFetch(input, options);

    const headers = cloneHeaders(options.headers);
    if (!headers.has('X-Suno-Client')) headers.set('X-Suno-Client', 'Web');
    if (!headers.has('Device-Id')) headers.set('Device-Id', getFallbackDeviceId(slot));

    const next = { ...options, headers };
    if (String(options.method || 'GET').toUpperCase() === 'POST' && isConvertWav(url) && options.body == null) {
      next.body = '{}';
      if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    }
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
    if (!isPresignedDownload(url)) return originalDefaultFetch(input, options);

    const cleanOptions = { ...options, headers: stripSignedDownloadHeaders(options.headers) };
    let lastResponse = null;
    let lastError = null;

    // Suno 2026 下载链路要求复用 Chromium 账号分区网络栈。
    // 预签名地址本身已经带签名，所以这里绝不附加 Authorization。
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
    throw lastError || new Error('Suno 预签名下载失败');
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
