const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, shell, BrowserWindow, session } = require('electron');
const {
  partitionFor,
  flushAccountSession,
  flushAllAccountSessions,
  getAccountStatus,
  probeUnknownAccount,
  noteSessionCookie,
  destroyAuthWindows,
} = require('./suno_session');

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

function sendAccountState(state) {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!win.isDestroyed() && win.webContents.getURL().startsWith('file://')) {
        win.webContents.send('account:state-changed', state);
      }
    } catch {}
  }
}

function emitAccountStateChanged(slot, delay = 180) {
  slot = String(slot);
  const old = accountStateTimers.get(slot);
  if (old) clearTimeout(old);

  const timer = setTimeout(async () => {
    accountStateTimers.delete(slot);
    let state;
    try { state = await getAccountStatus(slot); } catch { return; }

    const previous = lastKnownLoginState.get(slot);
    const current = Boolean(state.loggedIn);
    lastKnownLoginState.set(slot, current);
    if (previous === undefined || previous !== current) sendAccountState(state);
  }, delay);

  accountStateTimers.set(slot, timer);
}

function scheduleAccountFlush(slot, delay = 450) {
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
    ses.cookies.on('changed', (_event, cookie, _cause, removed) => {
      const name = String(cookie?.name || '');
      const domain = String(cookie?.domain || '').toLowerCase();
      const relevant = domain.includes('suno.com') || domain.includes('clerk') || /^__(session|client|clerk)/i.test(name);
      if (!relevant) return;

      const becameLoggedIn = noteSessionCookie(slot, cookie, Boolean(removed));
      scheduleAccountFlush(slot, becameLoggedIn ? 120 : 450);
      emitAccountStateChanged(slot, becameLoggedIn ? 80 : 300);
    });
  }

  const timer = setInterval(() => flushAllAccountSessions().catch(() => {}), 20000);
  if (typeof timer.unref === 'function') timer.unref();
}

async function warmUnknownAccountStates() {
  // UI 不等待这里。只用于从旧版 profile 一次性恢复长期 Clerk 登录状态。
  for (const slot of ACCOUNT_SLOTS) {
    try {
      const before = await getAccountStatus(slot);
      lastKnownLoginState.set(slot, Boolean(before.loggedIn));
      const after = await probeUnknownAccount(slot);
      const changed = Boolean(before.loggedIn) !== Boolean(after.loggedIn);
      lastKnownLoginState.set(slot, Boolean(after.loggedIn));
      if (changed) sendAccountState(after);
    } catch {}
  }
}

const profileInfo = prepareStableProfile();
const { installSongLibraryWriteGuard } = require('./song_library_guard');
installSongLibraryWriteGuard(app);

const { registerDeaiIpc } = require('./deai');
const { registerSongLibraryIpc, startSongLibraryAutomation, stopSongLibraryAutomation } = require('./song_library');
require('./main');

app.whenReady().then(() => {
  installAccountPersistence();
  registerDeaiIpc({ app, ipcMain, dialog, shell });
  registerSongLibraryIpc({ app, ipcMain, dialog, shell });
  startSongLibraryAutomation(app);

  // account:status 保留 main.js 注册的处理器：它会附带当前可见登录窗口和验证码状态。
  // suno_session.getAccountStatus 本身已经是纯本地快速查询，不再需要 bootstrap 覆盖 handler。

  ipcMain.handle('app:profile-info', async () => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    migratedFrom: profileInfo.migratedFrom || '',
  }));

  flushAllAccountSessions().catch(() => {});
  setTimeout(() => warmUnknownAccountStates().catch(() => {}), 1800);
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
  for (const timer of flushTimers.values()) clearTimeout(timer);
  flushTimers.clear();
  flushAllAccountSessions()
    .finally(() => {
      quitFlushDone = true;
      quitFlushStarted = false;
      app.quit();
    });
});
