const { session } = require('electron');
const { ACCOUNT_SLOTS, partitionFor, apiHeaders } = require('./suno_session');

function headersToObject(headers) {
  if (!headers) return {};
  if (typeof headers.entries === 'function') {
    try { return Object.fromEntries(headers.entries()); } catch {}
  }
  if (Array.isArray(headers)) {
    try { return Object.fromEntries(headers); } catch {}
  }
  return { ...headers };
}

function hasAuthorization(headers) {
  return Object.keys(headers || {}).some(key => String(key).toLowerCase() === 'authorization');
}

function isJsonRequest(headers) {
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key).toLowerCase() === 'content-type') {
      return String(value || '').toLowerCase().includes('application/json');
    }
  }
  return false;
}

function mergeRefreshedAuth(original, refreshed) {
  const out = { ...original };
  const managed = new Set(['authorization', 'browser-token', 'device-id']);
  for (const key of Object.keys(out)) {
    if (managed.has(String(key).toLowerCase())) delete out[key];
  }
  for (const [key, value] of Object.entries(refreshed || {})) {
    if (managed.has(String(key).toLowerCase())) out[key] = value;
  }
  return out;
}

function installSlotGuard(slot) {
  const ses = session.fromPartition(partitionFor(slot));
  if (ses.__sunoOriginalAuthFetchGuard) return;

  const originalFetch = ses.fetch.bind(ses);
  Object.defineProperty(ses, '__sunoOriginalAuthFetchGuard', {
    configurable: false,
    enumerable: false,
    writable: false,
    value: true,
  });

  ses.fetch = async (input, init = {}) => {
    const originalHeaders = headersToObject(init?.headers);
    const response = await originalFetch(input, init);

    // 只接管已经带 Bearer Authorization 的 Suno API 请求。
    // 普通网页、验证码、CDN 等请求保持 Electron 原行为。
    if (![401, 403].includes(response.status) || !hasAuthorization(originalHeaders)) return response;

    try {
      const refreshed = await apiHeaders(slot, {
        json: isJsonRequest(originalHeaders),
        forceRefresh: true,
      });
      const retryHeaders = mergeRefreshedAuth(originalHeaders, refreshed);
      return await originalFetch(input, { ...init, headers: retryHeaders });
    } catch {
      // 刷新失败时保留第一次响应，让上层按原有逻辑显示真实 401/403。
      return response;
    }
  };
}

function installAuthFetchGuard() {
  for (const slot of ACCOUNT_SLOTS) installSlotGuard(slot);
}

module.exports = { installAuthFetchGuard };
