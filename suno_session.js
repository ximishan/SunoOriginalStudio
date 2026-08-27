const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session, safeStorage } = require('electron');

const SUNO_HOME = 'https://suno.com/';
const SUNO_STUDIO = 'https://suno.com/studio';
const ACCOUNT_SLOTS = ['1', '2', '3'];
const AUTH_WAIT_MS = 18000;
const LOGIN_STATE_FILE = 'suno-account-login-state-v1.json';
const COOKIE_SNAPSHOT_FILE = 'suno-sessions.dat';
const TOKEN_REFRESH_SKEW_SEC = 90;

const authWindows = new Map();
const tokenInflight = new Map();
let loginStateCache = null;
let cookieSnapshotCache = null;

function normalizeSlot(slot) {
  const value = String(slot || '1');
  if (!ACCOUNT_SLOTS.includes(value)) throw new Error(`无效 Suno 账号槽位：${value}`);
  return value;
}

function partitionFor(slot) {
  return `persist:suno-original-demo-${normalizeSlot(slot)}`;
}

function sessionFor(slot) {
  return session.fromPartition(partitionFor(slot));
}

function stateFilePath() {
  return path.join(app.getPath('userData'), LOGIN_STATE_FILE);
}

function snapshotFilePath() {
  return path.join(app.getPath('userData'), COOKIE_SNAPSHOT_FILE);
}

function defaultLoginState() {
  return { version: 1, slots: {} };
}

function defaultCookieSnapshot() {
  return { version: 1, slots: {} };
}

function readLoginState() {
  if (loginStateCache) return loginStateCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFilePath(), 'utf8'));
    loginStateCache = parsed && typeof parsed === 'object' ? parsed : defaultLoginState();
  } catch {
    loginStateCache = defaultLoginState();
  }
  if (!loginStateCache.slots || typeof loginStateCache.slots !== 'object') loginStateCache.slots = {};
  return loginStateCache;
}

function writeLoginState() {
  const file = stateFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(readLoginState(), null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function encodeSnapshot(value) {
  const text = JSON.stringify(value);
  try {
    if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(text).toString('base64');
  } catch {}
  return Buffer.from(text, 'utf8').toString('base64');
}

function decodeSnapshot(raw) {
  if (!raw) return defaultCookieSnapshot();
  try {
    const buf = Buffer.from(String(raw), 'base64');
    let text = '';
    try {
      if (safeStorage.isEncryptionAvailable()) text = safeStorage.decryptString(buf);
    } catch {}
    if (!text) text = buf.toString('utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : defaultCookieSnapshot();
  } catch {
    return defaultCookieSnapshot();
  }
}

function readCookieSnapshot() {
  if (cookieSnapshotCache) return cookieSnapshotCache;
  try { cookieSnapshotCache = decodeSnapshot(fs.readFileSync(snapshotFilePath(), 'utf8')); }
  catch { cookieSnapshotCache = defaultCookieSnapshot(); }
  if (!cookieSnapshotCache.slots || typeof cookieSnapshotCache.slots !== 'object') cookieSnapshotCache.slots = {};
  return cookieSnapshotCache;
}

function writeCookieSnapshot() {
  const file = snapshotFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, encodeSnapshot(readCookieSnapshot()), 'utf8');
  fs.renameSync(tmp, file);
}

function getVerifiedState(slot) {
  slot = normalizeSlot(slot);
  return readLoginState().slots[slot] || null;
}

function markAccountVerified(slot, loggedIn = true, source = 'unknown') {
  slot = normalizeSlot(slot);
  const state = readLoginState();
  const previous = state.slots[slot] || {};
  state.slots[slot] = {
    ...previous,
    loggedIn: Boolean(loggedIn),
    source: String(source || 'unknown'),
    verifiedAt: new Date().toISOString(),
  };
  try { writeLoginState(); } catch {}
  return state.slots[slot];
}

function isSunoAuthCookie(cookie) {
  const name = String(cookie?.name || '');
  const domain = String(cookie?.domain || '').toLowerCase();
  const authName = name === '__session' || name.startsWith('__session_') || name === '__client' || name === '__client_uat' || name.startsWith('__client_');
  const authDomain = domain.includes('suno.com') || domain.includes('clerk.accounts.dev') || domain.includes('clerk.com');
  return authName && authDomain;
}

function hasDurableClerkCookie(cookies) {
  return cookies.some(cookie => {
    const name = String(cookie?.name || '');
    return name === '__client' || name === '__client_uat' || name.startsWith('__client_');
  });
}

function hasShortSessionCookie(cookies) {
  return cookies.some(cookie => {
    const name = String(cookie?.name || '');
    return name === '__session' || name.startsWith('__session_');
  });
}

function hasAnyAuthCookie(cookies) {
  return Array.isArray(cookies) && cookies.some(isSunoAuthCookie);
}

function noteSessionCookie(slot, cookie, removed = false) {
  const name = String(cookie?.name || '');
  if (!removed && (name === '__session' || name.startsWith('__session_'))) {
    markAccountVerified(slot, true, 'session-cookie');
    return true;
  }
  return false;
}

function cookieSetUrl(cookie) {
  const rawDomain = String(cookie?.domain || '').replace(/^\./, '');
  const domain = rawDomain || 'suno.com';
  const secure = cookie?.secure !== false;
  return `${secure ? 'https' : 'http'}://${domain}${cookie?.path || '/'}`;
}

function serializeCookie(cookie) {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
  };
}

async function saveAccountCookieSnapshot(slot) {
  slot = normalizeSlot(slot);
  const ses = sessionFor(slot);
  const currentCookies = await ses.cookies.get({});
  const snapshot = readCookieSnapshot();
  const oldCookies = Array.isArray(snapshot.slots[slot]?.cookies) ? snapshot.slots[slot].cookies : [];

  // 临时读到空/不完整 Cookie 时，不允许把历史上有效的登录快照覆盖掉。
  if (!hasAnyAuthCookie(currentCookies) && hasAnyAuthCookie(oldCookies)) return snapshot.slots[slot];

  snapshot.slots[slot] = {
    cookies: currentCookies.map(serializeCookie),
    savedAt: new Date().toISOString(),
  };
  writeCookieSnapshot();
  return snapshot.slots[slot];
}

async function restoreAccountSessionFromSnapshot(slot) {
  slot = normalizeSlot(slot);
  const snapshot = readCookieSnapshot();
  const cookies = Array.isArray(snapshot.slots[slot]?.cookies) ? snapshot.slots[slot].cookies : [];
  if (!hasAnyAuthCookie(cookies)) return false;

  const ses = sessionFor(slot);
  for (const cookie of cookies) {
    if (!cookie?.name || cookie.value == null) continue;
    const details = {
      url: cookieSetUrl(cookie),
      name: cookie.name,
      value: String(cookie.value),
      path: cookie.path || '/',
      secure: cookie.secure !== false,
      httpOnly: Boolean(cookie.httpOnly),
      ...(cookie.domain ? { domain: cookie.domain } : {}),
      ...(cookie.sameSite ? { sameSite: cookie.sameSite } : {}),
      ...(Number(cookie.expirationDate) > 0 ? { expirationDate: Number(cookie.expirationDate) } : {}),
    };
    try { await ses.cookies.set(details); } catch {}
  }
  await flushAccountSession(slot).catch(() => {});
  const restored = await ses.cookies.get({});
  if (hasAnyAuthCookie(restored)) {
    markAccountVerified(slot, true, 'cookie-snapshot-restore');
    return true;
  }
  return false;
}

async function flushAccountSession(slot) {
  const ses = sessionFor(slot);
  const jobs = [];
  try { jobs.push(ses.cookies.flushStore()); } catch {}
  try {
    const result = ses.flushStorageData();
    if (result && typeof result.then === 'function') jobs.push(result);
  } catch {}
  if (jobs.length) await Promise.allSettled(jobs);
}

async function ensureAuthWindow(slot) {
  slot = normalizeSlot(slot);
  await app.whenReady();
  let win = authWindows.get(slot);
  if (win && !win.isDestroyed()) return win;

  win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    webPreferences: {
      partition: partitionFor(slot),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  win.on('closed', () => authWindows.delete(slot));
  authWindows.set(slot, win);
  await win.loadURL(SUNO_STUDIO);
  return win;
}

async function readAuthState(win, waitMs = AUTH_WAIT_MS) {
  return win.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + ${Number(waitMs)};
    let clerkReady = false;
    while (Date.now() < deadline) {
      try {
        if (window.Clerk !== undefined) {
          clerkReady = Boolean(window.Clerk?.loaded ?? true);
          if (window.Clerk?.session) {
            const token = await window.Clerk.session.getToken?.();
            if (token) return { clerkReady: true, loggedIn: true, token: String(token) };
          }
          if (window.Clerk?.loaded === true && !window.Clerk?.session) {
            return { clerkReady: true, loggedIn: false, token: '' };
          }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const cookie = Object.fromEntries(document.cookie.split(';').map(part => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }));
    const shortToken = cookie.__session || Object.entries(cookie).find(([key]) => key.startsWith('__session'))?.[1] || '';
    return { clerkReady, loggedIn: Boolean(window.Clerk?.session || shortToken), token: shortToken };
  })()`);
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch { return null; }
}

function tokenUsable(token, skewSec = TOKEN_REFRESH_SKEW_SEC) {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) return false;
  return Number(payload.exp) > Math.floor(Date.now() / 1000) + Number(skewSec || 0);
}

async function tokenFromSessionCookie(slot) {
  const cookies = await sessionFor(slot).cookies.get({});
  const candidates = cookies.filter(cookie => cookie.name === '__session' || String(cookie.name || '').startsWith('__session_'));
  for (const cookie of candidates) {
    const token = String(cookie.value || '').trim();
    if (tokenUsable(token)) return token;
  }
  return '';
}

async function refreshClerkToken(slot, forceReload = false) {
  slot = normalizeSlot(slot);
  const win = await ensureAuthWindow(slot);
  if (forceReload) {
    try { await win.loadURL(SUNO_STUDIO); } catch {}
  } else {
    const url = win.webContents.getURL();
    if (!url.startsWith('https://suno.com/')) {
      try { await win.loadURL(SUNO_STUDIO); } catch {}
    }
  }

  let result = await readAuthState(win, AUTH_WAIT_MS);
  if ((!result?.loggedIn || !result?.token) && !forceReload) {
    try {
      await restoreAccountSessionFromSnapshot(slot);
      await win.loadURL(SUNO_STUDIO);
      result = await readAuthState(win, AUTH_WAIT_MS);
    } catch {}
  }

  const token = String(result?.token || '').trim();
  if (result?.loggedIn && token) {
    markAccountVerified(slot, true, result.clerkReady ? 'clerk-token' : 'session-token');
    await flushAccountSession(slot).catch(() => {});
    await saveAccountCookieSnapshot(slot).catch(() => {});
    return token;
  }

  if (result?.clerkReady && !result?.loggedIn) {
    markAccountVerified(slot, false, 'clerk-confirmed-signed-out');
    throw new Error(`账号 ${slot} 的 Suno 登录已失效，请重新登录`);
  }
  throw new Error(`账号 ${slot} 的 Suno 登录状态暂时无法恢复，请稍后重试或打开账号窗口确认`);
}

async function getAuthToken(slot, options = {}) {
  slot = normalizeSlot(slot);
  const forceRefresh = Boolean(options.forceRefresh);
  const key = `${slot}:${forceRefresh ? 'force' : 'normal'}`;
  if (tokenInflight.has(key)) return tokenInflight.get(key);

  const job = (async () => {
    if (!forceRefresh) {
      const direct = await tokenFromSessionCookie(slot).catch(() => '');
      if (direct) {
        markAccountVerified(slot, true, 'session-cookie-jwt');
        return direct;
      }
    }

    try {
      return await refreshClerkToken(slot, forceRefresh);
    } catch (firstError) {
      if (forceRefresh) throw firstError;
      try { return await refreshClerkToken(slot, true); }
      catch { throw firstError; }
    }
  })();

  tokenInflight.set(key, job);
  try { return await job; }
  finally { tokenInflight.delete(key); }
}

function browserToken() {
  return JSON.stringify({
    token: Buffer.from(JSON.stringify({ timestamp: Date.now() }), 'utf8').toString('base64'),
  });
}

async function apiHeaders(slot, options = {}) {
  const token = await getAuthToken(slot, { forceRefresh: Boolean(options.forceRefresh) });
  const ses = sessionFor(slot);
  const cookies = await ses.cookies.get({ url: SUNO_HOME });
  const device = cookies.find(cookie => cookie.name === 'suno_device_id')?.value || '';
  return {
    Authorization: `Bearer ${token}`,
    ...(options.json === false ? {} : { 'Content-Type': 'application/json' }),
    'Browser-Token': browserToken(),
    ...(device ? { 'Device-Id': device } : {}),
  };
}

async function authenticatedFetch(slot, url, options = {}) {
  slot = normalizeSlot(slot);
  const ses = sessionFor(slot);
  const json = options.json !== false;
  const requestOptions = { ...options };
  delete requestOptions.json;
  delete requestOptions.headers;
  const extraHeaders = options.headers || {};

  let headers = { ...(await apiHeaders(slot, { json })), ...extraHeaders };
  let response = await ses.fetch(url, { ...requestOptions, headers });
  if (response.status === 401 || response.status === 403) {
    const refreshed = await apiHeaders(slot, { json, forceRefresh: true });
    headers = { ...refreshed, ...extraHeaders };
    response = await ses.fetch(url, { ...requestOptions, headers });
  }
  return response;
}

async function getAccountStatus(slot) {
  slot = normalizeSlot(slot);
  const ses = sessionFor(slot);
  const cookies = await ses.cookies.get({});
  const shortCookie = hasShortSessionCookie(cookies);
  const durableCookie = hasDurableClerkCookie(cookies);

  if (shortCookie) {
    markAccountVerified(slot, true, 'session-cookie');
    return {
      slot,
      loggedIn: true,
      partition: partitionFor(slot),
      authSource: 'short-session-cookie',
      durableCookie,
      authWindowOpen: Boolean(authWindows.get(slot) && !authWindows.get(slot).isDestroyed()),
    };
  }

  const verified = getVerifiedState(slot);
  const loggedIn = Boolean(verified?.loggedIn || durableCookie);
  return {
    slot,
    loggedIn,
    partition: partitionFor(slot),
    authSource: loggedIn ? (durableCookie ? 'durable-clerk-cookie' : 'verified-persistent-state') : 'none',
    durableCookie,
    authWindowOpen: Boolean(authWindows.get(slot) && !authWindows.get(slot).isDestroyed()),
  };
}

async function probeUnknownAccount(slot) {
  slot = normalizeSlot(slot);
  const known = getVerifiedState(slot);
  if (known?.loggedIn) {
    await restoreAccountSessionFromSnapshot(slot).catch(() => {});
    return getAccountStatus(slot);
  }

  const ses = sessionFor(slot);
  let cookies = await ses.cookies.get({});
  if (!hasAnyAuthCookie(cookies)) {
    await restoreAccountSessionFromSnapshot(slot).catch(() => {});
    cookies = await ses.cookies.get({});
  }
  if (hasShortSessionCookie(cookies)) {
    markAccountVerified(slot, true, 'session-cookie-migration');
    await saveAccountCookieSnapshot(slot).catch(() => {});
    return getAccountStatus(slot);
  }
  if (!hasDurableClerkCookie(cookies)) return getAccountStatus(slot);

  try {
    const token = await getAuthToken(slot);
    if (token) markAccountVerified(slot, true, 'startup-clerk-restore');
  } catch {}
  await saveAccountCookieSnapshot(slot).catch(() => {});
  return getAccountStatus(slot);
}

async function warmKnownAccounts() {
  for (const slot of ACCOUNT_SLOTS) {
    try {
      await restoreAccountSessionFromSnapshot(slot).catch(() => {});
      const state = await getAccountStatus(slot);
      if (state.loggedIn) {
        try { await getAuthToken(slot); } catch {}
        await saveAccountCookieSnapshot(slot).catch(() => {});
      }
    } catch {}
  }
}

async function flushAllAccountSessions() {
  await Promise.allSettled(ACCOUNT_SLOTS.map(async slot => {
    await flushAccountSession(slot).catch(() => {});
    await saveAccountCookieSnapshot(slot).catch(() => {});
  }));
}

function destroyAuthWindows() {
  for (const win of authWindows.values()) {
    try { if (!win.isDestroyed()) win.destroy(); } catch {}
  }
  authWindows.clear();
}

module.exports = {
  ACCOUNT_SLOTS,
  SUNO_HOME,
  SUNO_STUDIO,
  partitionFor,
  sessionFor,
  flushAccountSession,
  flushAllAccountSessions,
  getAccountStatus,
  probeUnknownAccount,
  warmKnownAccounts,
  markAccountVerified,
  noteSessionCookie,
  saveAccountCookieSnapshot,
  restoreAccountSessionFromSnapshot,
  getAuthToken,
  apiHeaders,
  authenticatedFetch,
  destroyAuthWindows,
};
