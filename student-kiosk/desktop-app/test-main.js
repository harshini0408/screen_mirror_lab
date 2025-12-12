const { app, BrowserWindow } = require('electron');

console.log('App object:', typeof app);
console.log('App ready?', app.isReady());

app.whenReady().then(() => {
  console.log('App is ready!');
  
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  win.loadFile('student-interface.html');
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
