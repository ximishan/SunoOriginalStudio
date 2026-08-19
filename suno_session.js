const { app, BrowserWindow, session } = require('electron');

const SUNO_HOME = 'https://suno.com/';
const SUNO_STUDIO = 'https://suno.com/studio';
const ACCOUNT_SLOTS = ['1', '2', '3'];
const AUTH_WAIT_MS = 18000;

const authWindows = new Map();
const tokenInflight = new Map();

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

async function readClerkState(win, includeToken = false) {
  return win.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + ${AUTH_WAIT_MS};
    while (Date.now() < deadline) {
      try {
        if (window.Clerk?.session) {
          if (!${includeToken ? 'true' : 'false'}) return { loggedIn: true, token: '' };
          const token = await window.Clerk.session.getToken?.();
          if (token) return { loggedIn: true, token: String(token) };
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 400));
    }

    const cookie = Object.fromEntries(document.cookie.split(';').map(part => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }));
    const shortToken = cookie.__session || Object.entries(cookie).find(([key]) => key.startsWith('__session'))?.[1] || '';
    return { loggedIn: Boolean(window.Clerk?.session || shortToken), token: ${includeToken ? 'shortToken' : "''"} };
  })()`);
}

async function getAuthToken(slot) {
  slot = normalizeSlot(slot);
  if (tokenInflight.has(slot)) return tokenInflight.get(slot);

  const job = (async () => {
    const win = await ensureAuthWindow(slot);
    const result = await readClerkState(win, true);
    const token = String(result?.token || '').trim();
    if (!result?.loggedIn || !token) {
      throw new Error(`账号 ${slot} 尚未登录，或 Suno 登录状态已失效，请先打开账号窗口重新登录`);
    }
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

async function getAccountStatus(slot) {
  slot = normalizeSlot(slot);
  const ses = sessionFor(slot);
  const cookies = await ses.cookies.get({});
  const durableCookie = hasDurableClerkCookie(cookies);
  const shortCookie = hasShortSessionCookie(cookies);
  let loggedIn = durableCookie || shortCookie;
  let authSource = durableCookie ? 'clerk-client-cookie' : (shortCookie ? 'short-session-cookie' : 'none');

  if (!loggedIn) {
    try {
      const win = await ensureAuthWindow(slot);
      const state = await readClerkState(win, false);
      if (state?.loggedIn) {
        loggedIn = true;
        authSource = 'clerk-session';
      }
    } catch {}
  }

  if (loggedIn) await flushAccountSession(slot).catch(() => {});
  const win = authWindows.get(slot);
  return {
    slot,
    loggedIn,
    partition: partitionFor(slot),
    authSource,
    authWindowOpen: Boolean(win && !win.isDestroyed()),
  };
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
  getAuthToken,
  apiHeaders,
  destroyAuthWindows,
};
