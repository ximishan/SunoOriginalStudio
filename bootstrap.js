const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, shell, BrowserWindow, session } = require('electron');
const { partitionFor, flushAccountSession, flushAllAccountSessions, getAccountStatus, destroyAuthWindows } = require('./suno_session');

const ACCOUNT_SLOTS = ['1', '2', '3'];

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
      const localState = path.join(source, 'Local State');
      if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(stableRoot, 'Local State'));
      for (const slot of ACCOUNT_SLOTS) {
        const sourcePartition = path.join(source, 'Partitions', `suno-original-demo-${slot}`);
        const targetPartition = path.join(stablePartitions, `suno-original-demo-${slot}`);
        if (fs.existsSync(sourcePartition)) copyDir(sourcePartition, targetPartition);
      }
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

const flushTimers = new Map();
const accountStateTimers = new Map();
const lastKnownLoginState = new Map();

function emitAccountStateChanged(slot) {
  slot = String(slot);
  const old = accountStateTimers.get(slot);
  if (old) clearTimeout(old);

  const timer = setTimeout(async () => {
    accountStateTimers.delete(slot);
    let state;
    try { state = await getAccountStatus(slot); } catch { return; }

    const previous = lastKnownLoginState.get(slot);
    lastKnownLoginState.set(slot, Boolean(state.loggedIn));

    // Cookie/Clerk 初始化会产生很多 changed 事件。只有真正的登录状态
    // 发生变化时才通知 renderer，避免多个 refreshAccounts() 交叉执行，
    // 导致账号 1/2/3 在界面上重复追加。
    if (previous === undefined || previous === Boolean(state.loggedIn)) return;

    for (const win of BrowserWindow.getAllWindows()) {
      try {
        if (!win.isDestroyed() && win.webContents.getURL().startsWith('file://')) {
          win.webContents.send('account:state-changed', state);
        }
      } catch {}
    }
  }, 1200);

  accountStateTimers.set(slot, timer);
}

function scheduleAccountFlush(slot, delay = 700) {
  const old = flushTimers.get(slot);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    flushTimers.delete(slot);
    flushAccountSession(slot).catch(() => {});
    emitAccountStateChanged(slot);
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
  const timer = setInterval(() => flushAllAccountSessions().catch(() => {}), 20000);
  if (typeof timer.unref === 'function') timer.unref();
}

async function robustAccountStatus(slot) {
  const state = await getAccountStatus(slot);
  lastKnownLoginState.set(String(slot), Boolean(state.loggedIn));
  return {
    ...state,
    windowOpen: false,
    verificationActive: false,
    stableProfile: app.getPath('userData'),
  };
}

const profileInfo = prepareStableProfile();

const { registerDeaiIpc } = require('./deai');
const { registerSongLibraryIpc, startSongLibraryAutomation, stopSongLibraryAutomation } = require('./song_library');
require('./main');

app.whenReady().then(() => {
  installAccountPersistence();
  registerDeaiIpc({ app, ipcMain, dialog, shell });
  registerSongLibraryIpc({ app, ipcMain, dialog, shell });
  startSongLibraryAutomation(app);

  ipcMain.removeHandler('account:status');
  ipcMain.handle('account:status', async (_event, slot) => robustAccountStatus(slot));

  ipcMain.handle('app:profile-info', async () => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    migratedFrom: profileInfo.migratedFrom || '',
  }));

  flushAllAccountSessions().catch(() => {});
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
  stopSongLibraryAutomation();
  destroyAuthWindows();
  for (const timer of accountStateTimers.values()) clearTimeout(timer);
  accountStateTimers.clear();
  flushAllAccountSessions()
    .finally(() => {
      quitFlushDone = true;
      quitFlushStarted = false;
      app.quit();
    });
});
