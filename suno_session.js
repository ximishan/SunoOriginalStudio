const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');

const SUNO_HOME = 'https://suno.com/';
const SUNO_STUDIO = 'https://suno.com/studio';
const ACCOUNT_SLOTS = ['1', '2', '3'];
const AUTH_WAIT_MS = 18000;
const AUTH_RESTORE_WAIT_MS = 12000;
const LOGIN_STATE_FILE = 'suno-account-login-state-v1.json';

const authWindows = new Map();
const tokenInflight = new Map();
let loginStateCache = null;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

function defaultLoginState() {
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

function hasDurableClerkCookie(cookies) {
  return cookies.some(cookie => {
    const name = String(cookie?.name || '');
    return name === '__client' || name === '__client_uat' || name.startsWith('__client_') || /clerk.*client/i.test(name);
  });
}

function hasShortSessionCookie(cookies) {
  return cookies.some(cookie => {
    const name = String(cookie?.name || '');
    return name === '__session' || name.startsWith('__session_');
  });
}

function noteSessionCookie(slot, cookie, removed = false) {
  const name = String(cookie?.name || '');
  if (!removed && (name === '__session' || name.startsWith('__session_'))) {
    markAccountVerified(slot, true, 'session-cookie');
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
  win.webContents.on('did-finish-load', () => {
    flushAccountSession(slot).catch(() => {});
  });
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
          clerkReady = true;
          if (window.Clerk?.session) {
            const token = await window.Clerk.session.getToken?.();
            if (token) return { clerkReady: true, loggedIn: true, token: String(token) };
          }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    const cookie = Object.fromEntries(document.cookie.split(';').map(part => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }));
    const shortToken = cookie.__session || Object.entries(cookie).find(([key]) => key.startsWith('__session'))?.[1] || '';
    return { clerkReady, loggedIn: Boolean(window.Clerk?.session || shortToken), token: shortToken };
  })()`);
}

async function loadForSessionRestore(win, slot) {
  try {
    await flushAccountSession(slot);
  } catch {}
  try {
    await win.loadURL(SUNO_HOME);
    await sleep(500);
    await win.loadURL(SUNO_STUDIO);
  } catch {}
}

async function restoreAuthState(slot, waitMs = AUTH_RESTORE_WAIT_MS) {
  slot = normalizeSlot(slot);
  const win = await ensureAuthWindow(slot);

  let result = await readAuthState(win, waitMs).catch(() => null);
  if (result?.loggedIn && result?.token) {
    markAccountVerified(slot, true, result.clerkReady ? 'clerk-token-restore' : 'session-token-restore');
    await flushAccountSession(slot).catch(() => {});
    return result;
  }

  // Short session cookies are intentionally short lived. Clerk's durable state
  // and partition storage can recreate them after a real navigation. Do one
  // controlled reload before considering the account unavailable.
  await loadForSessionRestore(win, slot);
  result = await readAuthState(win, waitMs).catch(() => null);
  if (result?.loggedIn && result?.token) {
    markAccountVerified(slot, true, result.clerkReady ? 'clerk-token-reloaded' : 'session-token-reloaded');
    await flushAccountSession(slot).catch(() => {});
    return result;
  }
  return result || { clerkReady: false, loggedIn: false, token: '' };
}

async function getAuthToken(slot) {
  slot = normalizeSlot(slot);
  if (tokenInflight.has(slot)) return tokenInflight.get(slot);

  const job = (async () => {
    const result = await restoreAuthState(slot, AUTH_WAIT_MS);
    const token = String(result?.token || '').trim();
    if (!result?.loggedIn || !token) {
      const ses = sessionFor(slot);
      const cookies = await ses.cookies.get({}).catch(() => []);
      const durable = hasDurableClerkCookie(cookies);
      if (!durable && result?.clerkReady) markAccountVerified(slot, false, 'clerk-session-missing');
      throw new Error(`账号 ${slot} 登录状态未能恢复，请打开账号窗口重新登录一次`);
    }
    return token;
  })();

  tokenInflight.set(slot, job);
  try {
    return await job;
  } finally {
    tokenInflight.delete(slot);
  }
}

function browserToken() {
  return JSON.stringify({
    token: Buffer.from(JSON.stringify({ timestamp: Date.now() }), 'utf8').toString('base64'),
  });
}

async function apiHeaders(slot, options = {}) {
  const token = await getAuthToken(slot);
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

// UI 状态查询必须是本地快速操作。这里绝不加载 Suno 页面，也不等待 Clerk。
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
  const loggedIn = Boolean(verified?.loggedIn && (durableCookie || verified?.source));
  return {
    slot,
    loggedIn,
    partition: partitionFor(slot),
    authSource: loggedIn ? (durableCookie ? 'durable-clerk-state' : 'verified-persistent-state') : 'none',
    durableCookie,
    authWindowOpen: Boolean(authWindows.get(slot) && !authWindows.get(slot).isDestroyed()),
  };
}

// 启动恢复：不仅恢复未知旧账号，也会主动唤醒“之前确认登录过”的账号。
// 这样 __session 过期时不用等到用户提交歌曲才临时恢复 Clerk 会话。
async function probeUnknownAccount(slot) {
  slot = normalizeSlot(slot);
  const known = getVerifiedState(slot);
  const ses = sessionFor(slot);
  const cookies = await ses.cookies.get({});

  if (hasShortSessionCookie(cookies)) {
    markAccountVerified(slot, true, 'session-cookie-migration');
    return getAccountStatus(slot);
  }

  const shouldRestore = Boolean(known?.loggedIn || hasDurableClerkCookie(cookies));
  if (!shouldRestore) return getAccountStatus(slot);

  try {
    const result = await restoreAuthState(slot, AUTH_RESTORE_WAIT_MS);
    if (result?.loggedIn && result?.token) {
      markAccountVerified(slot, true, 'startup-clerk-restore');
      await flushAccountSession(slot).catch(() => {});
    } else {
      const latestCookies = await ses.cookies.get({}).catch(() => []);
      if (result?.clerkReady && !hasDurableClerkCookie(latestCookies)) {
        markAccountVerified(slot, false, 'startup-session-missing');
      }
    }
  } catch {}
  return getAccountStatus(slot);
}

async function flushAllAccountSessions() {
  await Promise.allSettled(ACCOUNT_SLOTS.map(slot => flushAccountSession(slot)));
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
  markAccountVerified,
  noteSessionCookie,
  getAuthToken,
  apiHeaders,
  destroyAuthWindows,
};
