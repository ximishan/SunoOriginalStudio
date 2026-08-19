const { app, BrowserWindow, session } = require('electron');

const SUNO_HOME = 'https://suno.com/';
const SUNO_STUDIO = 'https://suno.com/studio';
const ACCOUNT_SLOTS = ['1', '2', '3'];
const AUTH_WAIT_MS = 18000;
const STATUS_WAIT_MS = 5000;

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
  const waitMs = includeToken ? AUTH_WAIT_MS : STATUS_WAIT_MS;
  return win.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + ${waitMs};
    let clerkSeenAt = 0;

    while (Date.now() < deadline) {
      try {
        if (window.Clerk !== undefined) {
          if (!clerkSeenAt) clerkSeenAt = Date.now();

          if (window.Clerk?.session) {
            if (!${includeToken ? 'true' : 'false'}) return { loggedIn: true, token: '' };
            const token = await window.Clerk.session.getToken?.();
            if (token) return { loggedIn: true, token: String(token) };
          }

          // Clerk 的 __client 只代表“客户端存在”，并不代表已经登录。
          // 状态查询时，只要 Clerk 已经初始化一小段时间仍没有 active session，
          // 就明确判定为未登录，避免空槽位被 __client 误判为已登录。
          if (!${includeToken ? 'true' : 'false'} && Date.now() - clerkSeenAt >= 1200) {
            return { loggedIn: false, token: '' };
          }
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (!${includeToken ? 'true' : 'false'}) {
      return { loggedIn: Boolean(window.Clerk?.session), token: '' };
    }

    // Token 获取保留短期 __session fallback，仅用于真实 API 调用。
    // 注意：这个 fallback 不参与“账号是否已登录”的 UI 判断。
    const cookie = Object.fromEntries(document.cookie.split(';').map(part => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }));
    const shortToken = cookie.__session || Object.entries(cookie).find(([key]) => key.startsWith('__session'))?.[1] || '';
    return { loggedIn: Boolean(window.Clerk?.session || shortToken), token: shortToken };
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
  const shortCookie = hasShortSessionCookie(cookies);

  let loggedIn = false;
  let authSource = 'none';

  try {
    // UI 登录状态以该槽位自己的 Clerk active session 为准。
    // 绝不能把 __client / __client_uat 当成登录凭据：空槽位访问一次 Suno
    // 也会产生这些 Cookie，之前因此把账号 2/3 误判成已登录。
    const win = await ensureAuthWindow(slot);
    const state = await readClerkState(win, false);
    loggedIn = Boolean(state?.loggedIn);
    authSource = loggedIn ? 'clerk-active-session' : 'none';
  } catch {
    // 网络/页面加载异常时，只允许短期 __session 作为保守 fallback。
    // durable __client 永远不能单独代表“已登录”。
    loggedIn = shortCookie;
    authSource = shortCookie ? 'short-session-cookie-fallback' : 'none';
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
