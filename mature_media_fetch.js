const http = require('http');
const https = require('https');
const { Readable } = require('stream');
const { session } = require('electron');
const { ACCOUNT_SLOTS, sessionFor } = require('./suno_session');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';
const ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';
const REQUEST_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 6;
const patchedSessions = new WeakSet();

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

function urlString(input) {
  try {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.toString();
    return String(input?.url || input || '');
  } catch {
    return String(input || '');
  }
}

function isSignedQuery(u) {
  const q = u.searchParams;
  return q.has('X-Amz-Signature') || q.has('X-Amz-Credential') || q.has('AWSAccessKeyId') ||
    (q.has('Signature') && q.has('Expires')) || q.has('Policy') || q.has('Key-Pair-Id');
}

function isDirectMediaUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const pathname = u.pathname.toLowerCase();
    if (host === 'studio-api-prod.suno.com' || host === 'auth.suno.com') return false;

    const mediaHost = host.endsWith('.amazonaws.com') || host.endsWith('.cloudfront.net') ||
      host === 'cdn1.suno.ai' || /^cdn\d*\.suno\.ai$/i.test(host) || host.endsWith('.suno.ai');
    const audioPath = /\.(wav|mp3|m4a|flac|aac|ogg|webm)$/i.test(pathname) ||
      /\/studio\/uploads\//i.test(pathname) || /audio|generated|stream/i.test(pathname);

    return isSignedQuery(u) || (mediaHost && audioPath);
  } catch {
    return false;
  }
}

function headerGetter(headers) {
  const normalized = new Map();
  for (const [key, value] of Object.entries(headers || {})) {
    normalized.set(String(key).toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value ?? ''));
  }
  return {
    get(name) {
      return normalized.get(String(name || '').toLowerCase()) || null;
    },
  };
}

function directRequest(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); }
    catch (error) { reject(error); return; }

    const transport = parsed.protocol === 'http:' ? http : https;
    const request = transport.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': ACCEPT_LANGUAGE,
        'Accept': '*/*',
      },
      agent: parsed.protocol === 'http:' ? httpAgent : httpsAgent,
    }, response => {
      const status = Number(response.statusCode || 0);
      const location = response.headers.location;
      if ([301, 302, 303, 307, 308].includes(status) && location) {
        if (redirects >= MAX_REDIRECTS) {
          response.resume();
          reject(new Error(`下载重定向超过 ${MAX_REDIRECTS} 次`));
          return;
        }
        const next = new URL(location, parsed).toString();
        response.resume();
        directRequest(next, redirects + 1).then(resolve, reject);
        return;
      }

      const body = typeof Readable.toWeb === 'function' ? Readable.toWeb(response) : null;
      if (!body) {
        response.destroy();
        reject(new Error('ERR_STREAM_UNAVAILABLE: Node HTTP 响应无法转换为流'));
        return;
      }

      resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: String(response.statusMessage || ''),
        headers: headerGetter(response.headers),
        body,
        url: parsed.toString(),
      });
    });

    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      const error = new Error(`ERR_TIMED_OUT: HTTP ${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒无响应`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end();
  });
}

function patchSession(ses, label) {
  if (!ses || patchedSessions.has(ses) || typeof ses.fetch !== 'function') return;
  const originalFetch = ses.fetch.bind(ses);

  const wrappedFetch = async (input, options = {}) => {
    const url = urlString(input);
    const method = String(options?.method || 'GET').toUpperCase();
    if (method !== 'GET' || !isDirectMediaUrl(url)) return originalFetch(input, options);

    try {
      const response = await directRequest(url);
      try {
        const u = new URL(url);
        console.log(`[SunoMatureDownload] ${label} direct HTTP ${response.status} ${u.hostname}${u.pathname}`);
      } catch {}
      return response;
    } catch (error) {
      try { console.log(`[SunoMatureDownload] ${label} direct HTTP failed: ${error?.message || error}`); } catch {}
      throw error;
    }
  };

  try {
    ses.fetch = wrappedFetch;
  } catch {
    try { Object.defineProperty(ses, 'fetch', { configurable: true, writable: true, value: wrappedFetch }); } catch {}
  }
  patchedSessions.add(ses);
}

function installMatureMediaFetch() {
  for (const slot of ACCOUNT_SLOTS) patchSession(sessionFor(slot), `account-${slot}`);
  patchSession(session.defaultSession, 'default');
}

module.exports = { installMatureMediaFetch };
