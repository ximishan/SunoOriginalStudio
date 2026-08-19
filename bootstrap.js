const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, shell, BrowserWindow, session } = require('electron');

const ACCOUNT_SLOTS = ['1', '2', '3'];
const SUNO_HOME = 'https://suno.com/';
const SUNO_STUDIO = 'https://suno.com/studio';

// Pin Chromium/Suno session storage to a stable directory that does not depend
// on the portable EXE filename or build version. This runs before main.js
// creates any BrowserWindow/session.
function hasLegacySunoProfile(root) {
  if (!root || !fs.existsSync(root)) return false;
  const partitions = path.join(root, 'Partitions');
  return ACCOUNT_SLOTS.some(slot => fs.existsSync(path.join(partitions, `suno-original-demo-${slot}`)));
}

function copyDir(source, target) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(target, { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: src => {
      const name = path.basename(src);
      return !['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'LOCK'].includes(name);
    },
  });
}

function prepareStableProfile() {
  const defaultUserData = app.getPath('userData');
  const appData = process.env.APPDATA || app.getPath('appData') || path.dirname(defaultUserData);
  const stableRoot = path.join(appData, 'SunoOriginalStudio');
  const stablePartitions = path.join(stableRoot, 'Partitions');

  const stableHasSessions = hasLegacySunoProfile(stableRoot);
  const candidates = [
    defaultUserData,
    path.join(appData, 'Suno原创Demo'),
    path.join(appData, 'suno-original-demo'),
    path.join(appData, 'Suno Original Studio'),
  ].filter((value, index, arr) => value && arr.indexOf(value) === index && path.resolve(value) !== path.resolve(stableRoot));

  let migratedFrom = '';
  if (!stableHasSessions) {
    const source = candidates.find(hasLegacySunoProfile);
    if (source) {
      fs.mkdirSync(stableRoot, { recursive: true });

      // Chromium cookie encryption depends on Local State, so migrate it together
      // with the persistent partition directories.
      const localState = path.join(source, 'Local State');
      if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(stableRoot, 'Local State'));

      for (const slot of ACCOUNT_SLOTS) {
        const sourcePartition = path.join(source, 'Partitions', `suno-original-demo-${slot}`);
        const targetPartition = path.join(stablePartitions, `suno-original-demo-${slot}`);
        if (fs.existsSync(sourcePartition)) copyDir(sourcePartition, targetPartition);
      }

      // Preserve the song list if it already exists in the legacy profile.
      const oldLibrary = path.join(source, 'song-library-v1.json');
      const newLibrary = path.join(stableRoot, 'song-library-v1.json');
      if (fs.existsSync(oldLibrary) && !fs.existsSync(newLibrary)) fs.copyFileSync(oldLibrary, newLibrary);
      migratedFrom = source;
    }
  }

  fs.mkdirSync(stableRoot, { recursive: true });
  app.setPath('userData', stableRoot);
  app.setPath('sessionData', stableRoot);

  try {
    const line = `${new Date().toISOString()} stable=${stableRoot} migratedFrom=${migratedFrom || '-'}\n`;
    fs.appendFileSync(path.join(stableRoot, 'profile-migration.log'), line, 'utf8');
  } catch {}

  return { stableRoot, migratedFrom };
}

function partitionFor(slot) {
  return `persist:suno-original-demo-${slot}`;
}

const flushTimers = new Map();

async function flushAccountSession(slot) {
  const ses = session.fromPartition(partitionFor(slot));
  const jobs = [];
  try { jobs.push(ses.cookies.flushStore()); } catch {}
  try {
    const result = ses.flushStorageData();
    if (result && typeof result.then === 'function') jobs.push(result);
  } catch {}
  if (jobs.length) await Promise.allSettled(jobs);
}

function scheduleAccountFlush(slot, delay = 700) {
  const old = flushTimers.get(slot);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    flushTimers.delete(slot);
    flushAccountSession(slot).catch(() => {});
  }, delay);
  flushTimers.set(slot, timer);
}

function installAccountPersistence() {
  for (const slot of ACCOUNT_SLOTS) {
    const ses = session.fromPartition(partitionFor(slot));
    ses.cookies.on('changed', (_event, cookie) => {
      const name = String(cookie?.name || '');
      const domain = String(cookie?.domain || '').toLowerCase();
      if (domain.includes('suno.com') || domain.includes('clerk') || /^__(session|client|clerk)/i.test(name)) {
        scheduleAccountFlush(slot);
      }
    });
  }

  const timer = setInterval(() => {
    for (const slot of ACCOUNT_SLOTS) flushAccountSession(slot).catch(() => {});
  }, 20000);
  if (typeof timer.unref === 'function') timer.unref();
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

async function probeClerkSession(slot) {
  const partition = partitionFor(slot);
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      partition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  try {
    await win.loadURL(SUNO_STUDIO);
    const result = await win.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 24; i++) {
        if (window.Clerk !== undefined) {
          try {
            if (window.Clerk?.session) {
              const token = await window.Clerk.session.getToken?.();
              return { loggedIn: true, token: Boolean(token) };
            }
          } catch {}
        }
        await new Promise(resolve => setTimeout(resolve, 400));
      }
      return { loggedIn: Boolean(window.Clerk?.session), token: false };
    })()`);
    return !!result?.loggedIn;
  } catch {
    return false;
  } finally {
    try { win.destroy(); } catch {}
  }
}

async function robustAccountStatus(slot) {
  slot = String(slot || '1');
  const ses = session.fromPartition(partitionFor(slot));
  const cookies = await ses.cookies.get({});
  const durableCookie = hasDurableClerkCookie(cookies);
  const shortCookie = hasShortSessionCookie(cookies);

  let loggedIn = durableCookie || shortCookie;
  let authSource = durableCookie ? 'clerk-client-cookie' : (shortCookie ? 'short-session-cookie' : 'none');

  // __session is intentionally short-lived. When neither durable cookie nor a
  // fresh __session is visible, ask Clerk in the real Suno partition before
  // declaring the account logged out. This avoids false "未登录" states.
  if (!loggedIn) {
    const clerkLoggedIn = await probeClerkSession(slot);
    if (clerkLoggedIn) {
      loggedIn = true;
      authSource = 'clerk-session';
    }
  }

  if (loggedIn) await flushAccountSession(slot).catch(() => {});

  return {
    slot,
    loggedIn,
    partition: partitionFor(slot),
    windowOpen: false,
    verificationActive: false,
    authSource,
    stableProfile: app.getPath('userData'),
  };
}

const profileInfo = prepareStableProfile();

const { registerDeaiIpc } = require('./deai');
const { registerSongLibraryIpc } = require('./song_library');
require('./main');

app.whenReady().then(() => {
  installAccountPersistence();
  registerDeaiIpc({ app, ipcMain, dialog, shell });
  registerSongLibraryIpc({ app, ipcMain, dialog, shell });

  // main.js registers a lightweight cookie-only status check. Replace it with
  // a Clerk-aware check after main.js has registered its handlers.
  ipcMain.removeHandler('account:status');
  ipcMain.handle('account:status', async (_event, slot) => robustAccountStatus(slot));

  ipcMain.handle('app:profile-info', async () => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    migratedFrom: profileInfo.migratedFrom || '',
  }));

  for (const slot of ACCOUNT_SLOTS) flushAccountSession(slot).catch(() => {});
});

let quitFlushStarted = false;
let quitFlushDone = false;
app.on('before-quit', event => {
  if (quitFlushDone) return;
  if (quitFlushStarted) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  quitFlushStarted = true;
  Promise.allSettled(ACCOUNT_SLOTS.map(slot => flushAccountSession(slot)))
    .finally(() => {
      quitFlushDone = true;
      quitFlushStarted = false;
      app.quit();
    });
});
