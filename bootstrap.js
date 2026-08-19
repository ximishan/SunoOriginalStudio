const { app, ipcMain, dialog, shell } = require('electron');
const { registerDeaiIpc } = require('./deai');

require('./main');

app.whenReady().then(() => {
  registerDeaiIpc({ app, ipcMain, dialog, shell });
});
