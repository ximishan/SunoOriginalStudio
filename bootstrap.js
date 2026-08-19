const { app, ipcMain, dialog, shell } = require('electron');
const { registerDeaiIpc } = require('./deai');
const { registerSongLibraryIpc } = require('./song_library');

require('./main');

app.whenReady().then(() => {
  registerDeaiIpc({ app, ipcMain, dialog, shell });
  registerSongLibraryIpc({ app, ipcMain, dialog, shell });
});
