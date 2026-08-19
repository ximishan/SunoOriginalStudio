const fs = require('fs');
const path = require('path');
const { app, ipcMain, dialog, shell } = require('electron');

// v0.5.1: pin Chromium/Suno session storage to a stable directory that does not
// depend on the portable EXE filename or build version. This runs before main.js
// creates any BrowserWindow/session.
function hasLegacySunoProfile(root) {
  if (!root || !fs.existsSync(root)) return false;
  const partitions = path.join(root, 'Partitions');
  return ['1', '2', '3'].some(slot => fs.existsSync(path.join(partitions, `suno-original-demo-${slot}`)));
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

      for (const slot of ['1', '2', '3']) {
        const sourcePartition = path.join(source, 'Partitions', `suno-original-demo-${slot}`);
        const targetPartition = path.join(stablePartitions, `suno-original-demo-${slot}`);
        if (fs.existsSync(sourcePartition)) copyDir(sourcePartition, targetPartition);
      }

      // Preserve the v0.5 song list if it already exists in the legacy profile.
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

const profileInfo = prepareStableProfile();

const { registerDeaiIpc } = require('./deai');
const { registerSongLibraryIpc } = require('./song_library');
require('./main');

app.whenReady().then(() => {
  registerDeaiIpc({ app, ipcMain, dialog, shell });
  registerSongLibraryIpc({ app, ipcMain, dialog, shell });
  ipcMain.handle('app:profile-info', async () => ({
    userData: app.getPath('userData'),
    sessionData: app.getPath('sessionData'),
    migratedFrom: profileInfo.migratedFrom || '',
  }));
});
