const { app, ipcMain, dialog, shell } = require('electron');
const { registerDeaiIpc } = require('./deai');

// Keep the existing Suno original-generation main process intact.
require('./main');

app.whenReady().then(() => {
  registerDeaiIpc({ ipcMain, dialog, shell });
});
