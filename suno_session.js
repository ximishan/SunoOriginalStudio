const fs = require('fs');
const path = require('path');
const { app, BrowserWindow, session } = require('electron');

const SUNO_HOME = 'https://suno.com/';
const SUNO_STUDIO = 'https://suno.com/studio';
const ACCOUNT_SLOTS = ['1', '2', '3'];
const AUTH_WAIT_MS = 18000;
const LOGIN_STATE_FILE = 'suno-account-login-state-v1.json';

const authWindows = new Map();
const tokenInflight = new Map();
let loginStateCache = null;

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
    return name === '__client' || name === '__client_uat' || name.startsWith('__client_');
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
  if (win && !win.isDestroyed()) {
    const url = win.webContents.getURL();
    if (!url.startsWith('https://suno.com/')) await win.loadURL(SUNO_STUDIO);
    return win;
  }

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

async function getAuthToken(slot) {
  slot = normalizeSlot(slot);
  if (tokenInflight.has(slot)) return tokenInflight.get(slot);

  const job = (async () => {
    const win = await ensureAuthWindow(slot);
    const result = await readAuthState(win, AUTH_WAIT_MS);
    const token = String(result?.token || '').trim();
    if (!result?.loggedIn || !token) {
      throw new Error(`账号 ${slot} 尚未登录，或 Suno 登录状态暂时无法恢复，请打开账号窗口确认登录状态`);
    }
    markAccountVerified(slot, true, result.clerkReady ? 'clerk-token' : 'session-token');
    await flushAccountSession(slot).catch(() => {});
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
// 1) 刚登录产生 __session：立即认定已登录并记录；
// 2) __session 过期后：使用曾经由真实 session/token 确认过的槽位状态；
// 3) 单独的 __client 永远不能把空槽位判成已登录。
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
  const loggedIn = Boolean(verified?.loggedIn);
  return {
    slot,
    loggedIn,
    partition: partitionFor(slot),
    authSource: loggedIn ? 'verified-persistent-state' : 'none',
    durableCookie,
    authWindowOpen: Boolean(authWindows.get(slot) && !authWindows.get(slot).isDestroyed()),
  };
}

// 只用于升级后首次恢复旧账号状态，在后台运行，不阻塞 UI。
// 仅当槽位尚无可靠记录、但存在 Clerk 持久 Cookie 时才真正打开一次隐藏页面确认。
async function probeUnknownAccount(slot) {
  slot = normalizeSlot(slot);
  const known = getVerifiedState(slot);
  if (known) return getAccountStatus(slot);

  const ses = sessionFor(slot);
  const cookies = await ses.cookies.get({});
  if (hasShortSessionCookie(cookies)) {
    markAccountVerified(slot, true, 'session-cookie-migration');
    return getAccountStatus(slot);
  }
  if (!hasDurableClerkCookie(cookies)) return getAccountStatus(slot);

  try {
    const win = await ensureAuthWindow(slot);
    const result = await readAuthState(win, 10000);
    if (result?.loggedIn) {
      markAccountVerified(slot, true, 'clerk-migration-probe');
      await flushAccountSession(slot).catch(() => {});
    } else if (result?.clerkReady) {
      markAccountVerified(slot, false, 'clerk-migration-probe');
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
