const { app, BrowserWindow, ipcMain, screen, dialog, globalShortcut, desktopCapturer } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Enable screen capturing - will be set when app is ready
console.log('🎬 Kiosk application starting...');

// ✅ AUTO-START: Register app to start after Windows login
function setupAutoStart() {
  try {
    if (process.platform === 'win32') {
      // Check if already registered
      const appPath = app.getPath('exe');
      console.log(`📋 App path: ${appPath}`);
      
      // Note: If running via npm start (development), auto-start uses electron.exe path
      // For production EXE, the NSIS installer handles registry entry
      // Auto-start in production is configured in package.json build.nsis
      console.log('✅ Auto-start configured in NSIS installer for production');
      console.log('   In development, run: npm run build-win to create installer with auto-start');
    }
  } catch (error) {
    console.error('⚠️ Error setting up auto-start:', error.message);
  }
}

let mainWindow = null;
let timerWindow = null;
let currentSession = null;
let sessionActive = false;

// Load server URL from config file (auto-detected by server)
function loadServerUrl() {
  try {
    // Try multiple possible config locations
    const possiblePaths = [
      path.join(__dirname, '..', '..', '..', 'server-config.json'),  // From desktop-app folder
      path.join(app.getAppPath(), '..', '..', '..', 'server-config.json'),  // From app folder
      'D:\\screen_mirror_deployment_my_laptop\\server-config.json'  // Absolute path
    ];
    
    for (const configPath of possiblePaths) {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const url = `http://${config.serverIp}:${config.serverPort}`;
        console.log(`✅ Loaded server URL from config: ${url}`);
        console.log(`📁 Config path: ${configPath}`);
        console.log(`📅 Config last updated: ${config.lastUpdated}`);
        return url;
      }
    }
    console.warn('⚠️ Config file not found in any expected location');
  } catch (error) {
    console.error('⚠️ Error loading config:', error.message);
  }
  // Fallback to localhost
  return 'http://localhost:7401';
}

const SERVER_URL = loadServerUrl();

// IP-based Lab Detection
function detectLabFromIP() {
  try {
    const networkInterfaces = os.networkInterfaces();
    let detectedLab = null;
    
    // IP range to Lab ID mapping
    // Note: Remove specific IP ranges when not at college
    // Default to CC1 for local development
    const labIPRanges = {
      // Add your college IP ranges here when needed
      // '10.10.46.': 'CC1',
      // '10.10.47.': 'CC2',
      // '10.10.48.': 'CC3',
    };
    
    // Check all network interfaces
    for (const interfaceName in networkInterfaces) {
      const addresses = networkInterfaces[interfaceName];
      for (const addr of addresses) {
        if (addr.family === 'IPv4' && !addr.internal) {
          const ip = addr.address;
          console.log(`🔍 Checking IP: ${ip}`);
          
          // Check against known lab IP ranges
          for (const [prefix, labId] of Object.entries(labIPRanges)) {
            if (ip.startsWith(prefix)) {
              detectedLab = labId;
              console.log(`✅ Lab detected from IP ${ip}: ${labId}`);
              return labId;
            }
          }
        }
      }
    }
    
    // Fallback: use environment variable or default
    if (!detectedLab) {
      detectedLab = process.env.LAB_ID || "CC1";
      console.log(`⚠️ Could not detect lab from IP, using default: ${detectedLab}`);
    }
    
    return detectedLab;
  } catch (error) {
    console.error('⚠️ Error detecting lab from IP:', error.message);
    return process.env.LAB_ID || "CC1";
  }
}

const LAB_ID = detectLabFromIP();
const SYSTEM_NUMBER = process.env.SYSTEM_NUMBER || `${LAB_ID}-${String(Math.floor(Math.random() * 10) + 1).padStart(2, '0')}`;

// Kiosk mode configuration
// ✅ PRODUCTION: Full kiosk lock enabled from startup
// KIOSK_MODE = true: Full-screen lock, no ESC, no Alt+Tab, no keyboard shortcuts
const KIOSK_MODE = true; // ✅ ENABLED: Full kiosk lockdown - all shortcuts blocked
let isKioskLocked = true; // ✅ LOCKED: Complete lockdown until student logs in

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  // Window configuration depends on kiosk mode
  const windowOptions = KIOSK_MODE ? {
    width,
    height,
    frame: false,
    fullscreen: true,
    kiosk: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    minimizable: false,
    closable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        enableBlinkFeatures: 'GetDisplayMedia',
        webSecurity: false,
        devTools: false // 🔒 KIOSK MODE: DevTools disabled for security
      }
    } : {
      width,
      height,
      frame: true,
      fullscreen: false,
      kiosk: false,
    alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
      minimizable: true,
      closable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableBlinkFeatures: 'GetDisplayMedia',
      webSecurity: false,
        devTools: true // 🔧 DEBUG MODE: Enabled for testing
    }
    };

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log('🔐 Permission requested:', permission);
    if (permission === 'media' || permission === 'display-capture') {
      callback(true);
    } else {
      callback(false);
    }
  });

  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    console.log('🔐 Permission check:', permission);
    return true;
  });

  mainWindow.loadFile('student-interface.html');
  
  if (KIOSK_MODE) {
    console.log('🔒 Kiosk application starting in FULL BLOCKING mode...');
  } else {
    console.log('✅ Testing mode - Kiosk disabled');
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Fullscreen is already enforced via window options in kiosk mode
    mainWindow.focus();
    
    // 🔒 BLOCK ESC KEY AT WINDOW LEVEL - Additional protection
    if (KIOSK_MODE && isKioskLocked) {
      // Prevent fullscreen exit via ESC
      mainWindow.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'Escape' || input.key === 'Esc') {
          event.preventDefault();
          console.log('🔒 ESC key blocked at window level');
          return false;
        }
      });
    }
    
    // DevTools only in testing mode
    if (!KIOSK_MODE) {
      mainWindow.webContents.openDevTools();
      console.log('🔧 DevTools opened (testing mode)');
    }
    
    console.log(`✅ Application Ready - System: ${SYSTEM_NUMBER}, Lab: ${LAB_ID}`);
    console.log(`✅ Server: ${SERVER_URL}`);
    if (KIOSK_MODE) {
      console.log('🔒 FULL KIOSK MODE ACTIVE - System completely locked down!');
      console.log('🚫 All keyboard shortcuts blocked until student login');
      console.log('🚫 ESC key blocked at multiple levels');
    } else {
      console.log('✅ TESTING MODE - Shortcuts available, DevTools enabled');
    }
  });

  // Kiosk mode - prevent closing
  mainWindow.on('close', (e) => {
    if (isKioskLocked) {
      e.preventDefault();
      console.log('🚫 Window close blocked - kiosk mode active');
      mainWindow.focus(); // Force focus back
    }
  });

  // 🔒 PREVENT FULLSCREEN EXIT VIA ESC - Additional protection
  if (KIOSK_MODE && isKioskLocked) {
    mainWindow.on('leave-full-screen', (e) => {
      if (isKioskLocked) {
        console.log('🚫 Fullscreen exit blocked - forcing back to fullscreen');
        setTimeout(() => {
          mainWindow.setFullScreen(true);
          mainWindow.focus();
        }, 100);
      }
    });

    mainWindow.on('blur', () => {
      if (isKioskLocked) {
        // Force focus back if window loses focus
        setTimeout(() => {
          mainWindow.focus();
        }, 100);
      }
    });
  }
}

function createTimerWindow(studentName, studentId) {
  // Prevent duplicate timer windows
  if (timerWindow && !timerWindow.isDestroyed()) {
    console.log('⚠️ Timer window already exists, not creating duplicate');
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;
  
  timerWindow = new BrowserWindow({
    width: 350,
    height: 250,  // Increased height for logout button
    x: width - 370,
    y: 20,
    frame: true,
    title: '⏱️ Active Session Timer',
    alwaysOnTop: true,
    skipTaskbar: false,
    minimizable: true,
    closable: false,  // Cannot be closed
    resizable: false,
    webPreferences: {
      nodeIntegration: true,  // Enable for ipcRenderer in timer
      contextIsolation: false  // Allow require() in timer window
    }
  });

  // HTML content for timer window with Logout button
  const timerHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Active Session Timer</title>
      <style>
        body {
          margin: 0;
          padding: 15px;
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
          color: white;
          text-align: center;
          user-select: none;
        }
        h3 {
          margin: 5px 0 10px 0;
          font-size: 16px;
        }
        .timer {
          font-size: 32px;
          font-weight: bold;
          font-family: 'Courier New', monospace;
          margin: 10px 0;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .info {
          font-size: 12px;
          opacity: 0.9;
          margin-bottom: 15px;
        }
        .logout-btn {
          background: #dc3545;
          color: white;
          border: none;
          padding: 10px 30px;
          font-size: 14px;
          font-weight: bold;
          border-radius: 5px;
          cursor: pointer;
          box-shadow: 0 3px 10px rgba(0,0,0,0.3);
          transition: all 0.3s;
        }
        .logout-btn:hover {
          background: #c82333;
          transform: translateY(-2px);
          box-shadow: 0 5px 15px rgba(0,0,0,0.4);
        }
        .logout-btn:active {
          transform: translateY(0);
        }
      </style>
    </head>
    <body>
      <h3>⏱️ Active Session</h3>
      <div class="timer" id="timer">00:00:00</div>
      <div class="info">
        <strong>${studentName}</strong><br>
        ${studentId}
      </div>
      <button class="logout-btn" onclick="handleLogout()">🚪 Logout</button>
      <script>
        const { ipcRenderer } = require('electron');
        
        let startTime = Date.now();
        function updateTimer() {
          const elapsed = Math.floor((Date.now() - startTime) / 1000);
          const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0');
          const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
          const seconds = String(elapsed % 60).padStart(2, '0');
          document.getElementById('timer').textContent = hours + ':' + minutes + ':' + seconds;
        }
        setInterval(updateTimer, 1000);
        updateTimer();
        
        function handleLogout() {
          if (confirm('Are you sure you want to end your session and logout?')) {
            ipcRenderer.send('timer-logout-clicked');
          }
        }
      </script>
    </body>
    </html>
  `;

  timerWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(timerHTML));

  // Prevent closing - block all close attempts
  timerWindow.on('close', (e) => {
    if (sessionActive) {
      e.preventDefault();
      console.log('❌ Timer window close prevented - use Logout button');
      
      // Show dialog in timer window
      const { dialog } = require('electron');
      dialog.showMessageBoxSync(timerWindow, {
        type: 'warning',
        title: 'Cannot Close Timer',
        message: 'Session Timer Active',
        detail: 'You must log out from the kiosk before closing this window.\n\nUse the Logout button on the timer or kiosk screen to end your session.',
        buttons: ['OK']
      });
      
      timerWindow.minimize();
      
      // Also notify main window
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('timer-close-blocked');
      }
    }
    // If session not active, allow closing
  });
  
      // Prevent force close attempts - timer must not be closable until logout
      timerWindow.setClosable(false);
      
      // Block Alt+F4 and other close shortcuts for timer window
      timerWindow.on('focus', () => {
        try {
          globalShortcut.register('Alt+F4', () => {
            console.log('🚫 Alt+F4 blocked on timer window - student must use Logout button');
            return false;
          });
        } catch (e) {
          console.log('⚠️ Alt+F4 already registered or error:', e.message);
        }
      });
      
      timerWindow.on('blur', () => {
        try {
          globalShortcut.unregister('Alt+F4');
        } catch (e) {
          // Ignore if already unregistered
        }
      });

  // Keep timer window visible for debugging
  timerWindow.once('ready-to-show', () => {
    timerWindow.show(); // Show and keep visible
    console.log('✅ Timer window kept visible for debugging');
  });

  console.log('⏱️ Timer window created for:', studentName);
}

function setupIPCHandlers() {
  // Handle logout from timer window
  ipcMain.on('timer-logout-clicked', async () => {
    console.log('🚪 Logout clicked from timer window');
    
    // Trigger logout from main window
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('trigger-logout');
    }
    
    // Also perform logout here
    await performLogout();
  });
  
  // Handle screen sources request
  ipcMain.handle('get-screen-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({ 
        types: ['screen', 'window'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      console.log('✅ desktopCapturer returned', sources.length, 'sources');
      return sources;
    } catch (error) {
      console.error('❌ desktopCapturer error:', error);
      throw error;
    }
  });

  // Handle student login
  ipcMain.handle('student-login', async (event, credentials) => {
    try {
      const isGuest = credentials.isGuest === true;
      
      let authData = null;
      
      if (isGuest) {
        // For guest mode, skip authentication and use GUEST account
        console.log('🔓 Guest mode login attempt');
        authData = {
          success: true,
          student: {
            name: 'Guest User',
            studentId: 'GUEST'
          }
        };
      } else {
        // Normal student authentication
        const creds = {
          studentId: credentials.studentId,
          password: credentials.password,
          labId: LAB_ID,
        };

        console.log('🔐 Attempting authentication for:', creds.studentId);

        const authRes = await fetch(`${SERVER_URL}/api/authenticate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(creds),
        });
        authData = await authRes.json();

        if (!authData.success) {
          console.error('❌ Authentication failed:', authData.error);
          return { success: false, error: authData.error || 'Authentication failed' };
        }

        console.log('✅ Authentication successful for:', authData.student.name);
      }

      const sessionRes = await fetch(`${SERVER_URL}/api/student-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: authData.student.name,
          studentId: authData.student.studentId,
          computerName: os.hostname(),
          labId: LAB_ID,
          systemNumber: credentials.systemNumber || SYSTEM_NUMBER,
          isGuest: isGuest
        }),
      });
      const sessionData = await sessionRes.json();

      if (!sessionData.success) {
        console.error('❌ Session creation failed:', sessionData.error);
        return { success: false, error: sessionData.error || 'Session creation failed' };
      }

      console.log('✅ Session created:', sessionData.sessionId);

      currentSession = { id: sessionData.sessionId, student: authData.student };
      sessionActive = true;
      isKioskLocked = false; // Unlock the system

      // After login, allow normal window behavior for work
      mainWindow.setClosable(false);
      mainWindow.setMinimizable(true);          // Allow minimize for normal work
      mainWindow.setAlwaysOnTop(false);        // Allow other apps to come forward
      mainWindow.setFullScreen(false);         // Exit fullscreen for normal work
      mainWindow.maximize();                   // Maximize but not fullscreen

      // After successful login, release global shortcuts so the student
      // can use the system and other applications normally.
      try {
        globalShortcut.unregisterAll();
        console.log('🔓 Kiosk shortcuts unregistered - system free for normal use');
      } catch (e) {
        console.error('⚠️ Error unregistering kiosk shortcuts:', e.message || e);
      }

      console.log(`🔓 System unlocked for: ${authData.student.name} (${authData.student.studentId})`);

      // Create and show timer window
      createTimerWindow(authData.student.name, authData.student.studentId);

      // Notify renderer to start screen streaming with delay
      setTimeout(() => {
        console.log('🎬 Sending session-created event to renderer:', sessionData.sessionId);
        mainWindow.webContents.send('session-created', {
          sessionId: sessionData.sessionId,
          serverUrl: SERVER_URL,
          studentInfo: {
            studentId: authData.student.studentId,
            studentName: authData.student.name,
            systemNumber: credentials.systemNumber || SYSTEM_NUMBER
          }
        });
      }, 1000);

      return { 
        success: true, 
        student: authData.student, 
        sessionId: sessionData.sessionId 
      };
    } catch (error) {
      console.error('❌ Login error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  });

  // Handle student logout
  ipcMain.handle('student-logout', async () => {
    if (!sessionActive || !currentSession) {
      return { success: false, error: 'No active session' };
    }

    try {
      console.log('🚪 Logging out session:', currentSession.id);

      mainWindow.webContents.send('stop-live-stream');

      await fetch(`${SERVER_URL}/api/student-logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.id }),
      });

      console.log('✅ Logout successful');

      sessionActive = false;
      currentSession = null;
      isKioskLocked = true; // Lock the system again

      // Close timer window properly
      if (timerWindow && !timerWindow.isDestroyed()) {
        timerWindow.setClosable(true);  // Allow closing now
        timerWindow.close();
        timerWindow = null;
        console.log('⏱️ Timer window closed after logout');
      }

      // Restore strict kiosk mode after logout
      mainWindow.setClosable(false);
      mainWindow.setMinimizable(false);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setFullScreen(true);
      
      mainWindow.focus();
      
      console.log('🔒 System locked after logout');
      
      // 🔌 NEW: Automatic shutdown after session ends
      console.log('🔌 Initiating automatic system shutdown after session end...');

      // Re-enable kiosk shortcut blocking so the machine is locked again
      try {
        blockKioskShortcuts();
        console.log('🔒 Kiosk shortcuts re-registered after logout');
      } catch (e) {
        console.error('⚠️ Error re-registering kiosk shortcuts:', e.message || e);
      }
      
      // Show notification dialog - 90 seconds (1 minute 30 seconds) shutdown delay
      setTimeout(() => {
        dialog.showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Automatic Shutdown',
          message: 'Session Ended',
          detail: 'System will automatically shutdown in 1 minute 30 seconds (90 seconds).\n\nPlease save your work and log out of any other applications.',
          buttons: ['OK']
        });
      }, 500);
      
      setTimeout(async () => {
        const { exec } = require('child_process');
        const platform = os.platform();
        let shutdownCommand;
        
        if (platform === 'win32') {
          // 90 seconds = 1 minute 30 seconds shutdown delay
          shutdownCommand = 'shutdown /s /t 90 /c "Session ended. System will shutdown in 1 minute 30 seconds (90 seconds)."';
        } else if (platform === 'linux') {
          // Linux uses minutes, so 90 seconds = ~2 minutes
          shutdownCommand = 'sudo shutdown -h +2 "Session ended. System shutting down in 1 minute 30 seconds."';
        } else if (platform === 'darwin') {
          // macOS uses minutes, so 90 seconds = ~2 minutes
          shutdownCommand = 'sudo shutdown -h +2 "Session ended. System shutting down in 1 minute 30 seconds."';
        }
        console.log(`🔌 Executing shutdown with 90-second delay: ${shutdownCommand}`);
        exec(shutdownCommand, (error, stdout, stderr) => {
          if (error) {
            console.error('❌ Shutdown error:', error.message);
            console.error('Error details:', error);
            
            // Show error to user
            dialog.showMessageBox(mainWindow, {
              type: 'error',
              title: 'Shutdown Failed',
              message: 'Automatic Shutdown Error',
              detail: `Could not initiate automatic shutdown.\nError: ${error.message}\n\nPlease shutdown manually.`,
              buttons: ['OK']
            });
          } else {
            console.log('✅ Automatic shutdown initiated (90-second delay)');
            if (stdout) console.log('Shutdown stdout:', stdout);
            if (stderr) console.log('Shutdown stderr:', stderr);
          }
        });
      }, 3000); // Wait a few seconds after logout before issuing OS shutdown

      return { success: true };
    } catch (error) {
      console.error('❌ Logout error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  });

  // Get system number
  ipcMain.handle('get-system-number', async () => {
    return SYSTEM_NUMBER;
  });

  // Get system information
  ipcMain.handle('get-system-info', async () => {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus(),
      memory: os.totalmem(),
      systemNumber: SYSTEM_NUMBER,
      labId: LAB_ID
    };
  });

  // Get server URL
  ipcMain.handle('get-server-url', async () => {
    return SERVER_URL;
  });

  // Reset Password with Date of Birth verification
  ipcMain.handle('reset-password', async (event, data) => {
    try {
      const response = await fetch(`${SERVER_URL}/api/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await response.json();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // First-time signin
  ipcMain.handle('first-time-signin', async (event, data) => {
    try {
      const response = await fetch(`${SERVER_URL}/api/student-first-signin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await response.json();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Check student eligibility for first-time signin
  ipcMain.handle('check-student-eligibility', async (event, data) => {
    try {
      const response = await fetch(`${SERVER_URL}/api/check-student-eligibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      return await response.json();
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // 🔓 GUEST ACCESS: Handle guest access command from admin
  ipcMain.handle('guest-access', async () => {
    try {
      console.log('🔓 Guest access granted - unlocking kiosk without student login');
      
      // Create a guest session
      const guestCredentials = {
        studentId: 'GUEST',
        password: 'admin123', // Fixed guest password
        labId: LAB_ID,
      };

      // Authenticate as guest (server should accept 'GUEST' + 'admin123')
      const authRes = await fetch(`${SERVER_URL}/api/authenticate-guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(guestCredentials),
      });
      
      let authData;
      if (authRes.ok) {
        authData = await authRes.json();
      } else {
        // If guest auth endpoint doesn't exist, create session directly
        authData = {
          success: true,
          student: {
            name: 'Guest User',
            studentId: 'GUEST',
            email: 'guest@lab.local',
            department: 'Guest',
            year: 0,
            labId: LAB_ID
          }
        };
      }

      if (!authData.success) {
        console.error('❌ Guest authentication failed:', authData.error);
        return { success: false, error: authData.error || 'Guest authentication failed' };
      }

      console.log('✅ Guest access authenticated');

      // Create guest session
      const sessionRes = await fetch(`${SERVER_URL}/api/student-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: 'Guest User',
          studentId: 'GUEST',
          computerName: os.hostname(),
          labId: LAB_ID,
          systemNumber: SYSTEM_NUMBER,
          isGuest: true
        }),
      });
      const sessionData = await sessionRes.json();

      if (!sessionData.success) {
        console.error('❌ Guest session creation failed:', sessionData.error);
        return { success: false, error: sessionData.error || 'Guest session creation failed' };
      }

      console.log('✅ Guest session created:', sessionData.sessionId);

      currentSession = { id: sessionData.sessionId, student: authData.student, isGuest: true };
      sessionActive = true;
      isKioskLocked = false; // Unlock the system

      // After guest login, allow normal window behavior
      mainWindow.setClosable(false);
      mainWindow.setMinimizable(true);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setFullScreen(false);
      mainWindow.maximize();

      // Release global shortcuts
      try {
        globalShortcut.unregisterAll();
        console.log('🔓 Guest mode: shortcuts unregistered - system free for use');
      } catch (e) {
        console.error('⚠️ Error unregistering shortcuts:', e.message || e);
      }

      console.log(`🔓 System unlocked for Guest User`);

      // Create and show timer window (minimized)
      createTimerWindow('Guest User', 'GUEST');

      // Notify renderer
      setTimeout(() => {
        console.log('🎬 Sending guest session-created event to renderer:', sessionData.sessionId);
        mainWindow.webContents.send('session-created', {
          sessionId: sessionData.sessionId,
          serverUrl: SERVER_URL,
          studentInfo: {
            studentId: 'GUEST',
            studentName: 'Guest User',
            systemNumber: SYSTEM_NUMBER,
            isGuest: true
          }
        });
      }, 1000);

      return { 
        success: true, 
        student: authData.student, 
        sessionId: sessionData.sessionId,
        isGuest: true
      };
    } catch (error) {
      console.error('❌ Guest access error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  });

  // Guest login handler (bypass authentication)
  ipcMain.handle('guest-login', async (event, data) => {
    try {
      console.log('🔓 Guest login requested:', data);
      
      const sessionRes = await fetch(`${SERVER_URL}/api/student-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: 'Guest User',
          studentId: 'GUEST',
          computerName: os.hostname(),
          labId: data.labId || LAB_ID,
          systemNumber: data.systemNumber || SYSTEM_NUMBER,
          isGuest: true
        }),
      });
      const sessionData = await sessionRes.json();

      if (!sessionData.success) {
        console.error('❌ Guest session creation failed:', sessionData.error);
        return { success: false, error: sessionData.error || 'Guest session creation failed' };
      }

      console.log('✅ Guest session created:', sessionData.sessionId);

      currentSession = { id: sessionData.sessionId, student: { name: 'Guest User', studentId: 'GUEST' }, isGuest: true };
      sessionActive = true;
      isKioskLocked = false; // Unlock the system

      // After guest login, allow normal window behavior
      mainWindow.setClosable(false);
      mainWindow.setMinimizable(true);
      mainWindow.setAlwaysOnTop(false);
      mainWindow.setFullScreen(false);
      mainWindow.maximize();

      // Release all shortcuts
      try {
        globalShortcut.unregisterAll();
        console.log('🔓 Guest mode: shortcuts unregistered - system free for use');
      } catch (e) {
        console.error('⚠️ Error unregistering shortcuts:', e.message || e);
      }

      console.log(`🔓 System unlocked for Guest User`);

      // Create timer window for guest (optional - can be hidden)
      createTimerWindow('Guest User', 'GUEST');

      // Notify renderer
      setTimeout(() => {
        console.log('🎬 Sending guest-session-created event to renderer:', sessionData.sessionId);
        mainWindow.webContents.send('session-created', {
          sessionId: sessionData.sessionId,
          serverUrl: SERVER_URL,
          studentInfo: {
            studentId: 'GUEST',
            studentName: 'Guest User',
            systemNumber: data.systemNumber || SYSTEM_NUMBER,
            isGuest: true
          }
        });
      }, 1000);

      return { 
        success: true, 
        sessionId: sessionData.sessionId,
        isGuest: true
      };
    } catch (error) {
      console.error('❌ Guest login error:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  });

  // Trigger guest login from renderer
  ipcMain.on('trigger-guest-login', async () => {
    console.log('🔓 Trigger guest login from renderer');
    await ipcMain.handle('guest-login', null, { labId: LAB_ID, systemNumber: SYSTEM_NUMBER });
  });

  // System shutdown handler
  ipcMain.handle('shutdown-system', async () => {
    try {
      console.log('🔌 System shutdown command received from admin');
      
      // Perform logout first if there's an active session
      if (sessionActive && currentSession) {
        console.log('🚪 Logging out before shutdown...');
        await fetch(`${SERVER_URL}/api/student-logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: currentSession.id }),
        }).catch(err => console.error('❌ Logout error during shutdown:', err));
      }
      
      // Import exec for executing system commands
      const { exec } = require('child_process');
      const platform = os.platform();
      let shutdownCommand;
      
      if (platform === 'win32') {
        // Windows: shutdown in 90 seconds (1 minute 30 seconds) with message
        shutdownCommand = 'shutdown /s /t 90 /c "System shutdown initiated by administrator"';
      } else if (platform === 'linux') {
        // Linux: shutdown in 1 minute
        shutdownCommand = 'sudo shutdown -h +1 "System shutdown initiated by administrator"';
      } else if (platform === 'darwin') {
        // macOS: shutdown in 1 minute
        shutdownCommand = 'sudo shutdown -h +1 "System shutdown initiated by administrator"';
      }
      
      console.log(`🔌 Executing shutdown command (90-second delay): ${shutdownCommand}`);
      
      exec(shutdownCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Shutdown command error:', error);
        } else {
          console.log('✅ Shutdown command executed successfully (90-second delay)');
          console.log('stdout:', stdout);
          if (stderr) console.log('stderr:', stderr);
        }
      });
      
      return { success: true, message: 'Shutdown initiated' };
    } catch (error) {
      console.error('❌ Shutdown error:', error);
      return { success: false, error: error.message };
    }
  });
}

// Enable screen capturing before app ready
try {
  app.commandLine.appendSwitch('enable-usermedia-screen-capturing');
  app.commandLine.appendSwitch('auto-select-desktop-capture-source', 'Entire screen');
  app.commandLine.appendSwitch('enable-features', 'MediaStream,GetDisplayMedia');
  app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
  app.commandLine.appendSwitch('disable-web-security');
  console.log('✅ Screen capturing switches enabled');
} catch (error) {
  console.error('❌ Error setting command line switches:', error);
}

app.whenReady().then(() => {
  setupAutoStart();  // ✅ Setup auto-start for production
  setupIPCHandlers();
  createWindow();
  
  // 🔒 KIOSK MODE - Block all shortcuts only if kiosk mode is enabled
  if (KIOSK_MODE) {
    blockKioskShortcuts();
  } else {
    console.log('✅ Shortcut blocking disabled (testing mode)');
  }
});

app.on('window-all-closed', () => {
  // 🔒 KIOSK MODE - Prevent app from quitting
  if (isKioskLocked) {
    console.log('🚫 App quit blocked - kiosk mode active');
    createWindow(); // Recreate window if closed
  } else if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

// Block keyboard shortcuts to prevent DevTools and window switching
function blockKioskShortcuts() {
  // Block DevTools shortcuts
  const devToolsShortcuts = [
    'F12',
    'CommandOrControl+Shift+I',
    'CommandOrControl+Shift+J',
    'CommandOrControl+Shift+C',
    'CommandOrControl+Option+I',
    'CommandOrControl+Option+J'
  ];
  
  // Block window management shortcuts
  const windowShortcuts = [
    'Alt+F4',
    'CommandOrControl+W',
    'CommandOrControl+Q',
    'Alt+Tab',                    // 🔒 Block Alt+Tab (main requirement)
    'Alt+Shift+Tab',             // 🔒 Block reverse Alt+Tab
    'CommandOrControl+Tab',
    'F11',
    'Escape',                     // 🔒 Block Escape key
    'Esc'                         // 🔒 Block Esc (alternative form)
  ];
  
  // Block system shortcuts
  const systemShortcuts = [
    'CommandOrControl+Alt+Delete',
    'CommandOrControl+Shift+Escape',
    'CommandOrControl+Escape',
    'Alt+Space',
    'Super',                     // 🔒 Block Windows key
    'Meta',                      // 🔒 Block Meta key
    
    // 🚫 WINDOWS KEY COMBINATIONS - Complete Desktop Access Blocking
    'Meta+D',                    // 🔒 Show desktop
    'Meta+E',                    // 🔒 File explorer
    'Meta+R',                    // 🔒 Run dialog
    'Meta+L',                    // 🔒 Lock screen
    'Meta+Tab',                  // 🔒 Task view
    'Meta+X',                    // 🔒 Power user menu
    'Meta+I',                    // 🔒 Settings
    'Meta+A',                    // 🔒 Action center
    'Meta+S',                    // 🔒 Search
    'Meta+M',                    // 🔒 Minimize all
    'Meta+K',                    // 🔒 Connect
    'Meta+P',                    // 🔒 Project/Display
    'Meta+U',                    // 🔒 Ease of Access
    'Meta+B',                    // 🔒 Focus notification area
    'Meta+Home',                 // 🔒 Minimize non-active
    
    // 🚫 ADDITIONAL ESCAPE ROUTES
    'Alt+Esc',                   // 🔒 Window cycling
    'Alt+F6',                    // 🔒 Cycle window elements
    
    // 🚫 REFRESH & RELOAD
    'CommandOrControl+R',        // 🔒 Block refresh
    'F5',                        // 🔒 Block F5 refresh
    'CommandOrControl+F5',       // 🔒 Block force refresh
    'CommandOrControl+Shift+R',  // 🔒 Block hard refresh
    
    // 🚫 BROWSER/WINDOW CONTROLS
    'CommandOrControl+N',        // 🔒 Block new window
    'CommandOrControl+T',        // 🔒 Block new tab
    'CommandOrControl+Shift+N',  // 🔒 Block incognito
    'CommandOrControl+L',        // 🔒 Block address bar focus
    'CommandOrControl+D',        // 🔒 Block bookmark
    'CommandOrControl+H',        // 🔒 Block history
    'CommandOrControl+J',        // 🔒 Block downloads
    'CommandOrControl+U',        // 🔒 Block view source
    'CommandOrControl+P',        // 🔒 Block print
    'CommandOrControl+S',        // 🔒 Block save
    'CommandOrControl+O',        // 🔒 Block open file
    'CommandOrControl+A',        // 🔒 Block select all
    'CommandOrControl+F',        // 🔒 Block find
    'CommandOrControl+G',        // 🔒 Block find next
    'CommandOrControl+Z',        // 🔒 Block undo
    'CommandOrControl+Y',        // 🔒 Block redo
    'CommandOrControl+X',        // 🔒 Block cut
    'CommandOrControl+C',        // 🔒 Block copy
    'CommandOrControl+V'         // 🔒 Block paste
  ];
  
  const allShortcuts = [...devToolsShortcuts, ...windowShortcuts, ...systemShortcuts];
  
  allShortcuts.forEach(shortcut => {
    try {
      globalShortcut.register(shortcut, () => {
        console.log(`🚫 Blocked shortcut: ${shortcut}`);
        // Force focus back to main window
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.focus();
          mainWindow.setAlwaysOnTop(true);
        }
      });
    } catch (error) {
      console.log(`⚠️ Could not register shortcut: ${shortcut}`);
    }
  });
  
  console.log('🔒 FULL KIOSK MODE - All keyboard shortcuts blocked');
  console.log(`🚫 Blocked ${allShortcuts.length} shortcuts including Alt+Tab`);
}

// Helper function for logout
async function performLogout() {
  if (sessionActive && currentSession) {
    try {
      console.log('🚪 Performing logout for session:', currentSession.id);
      
      mainWindow.webContents.send('stop-live-stream');
      
      await fetch(`${SERVER_URL}/api/student-logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: currentSession.id }),
      });
      
      sessionActive = false;
      currentSession = null;
      isKioskLocked = true;
      
      console.log('✅ Logout completed');
    } catch (error) {
      console.error('❌ Logout error:', error);
    }
  }
}

function gracefulLogout() {
  if (sessionActive && currentSession) {
    performLogout().finally(() => {
      app.quit();
    });
  } else {
    app.quit();
  }
}

process.on('SIGINT', (signal) => {
  console.log('SIGINT received, logging out and quitting...');
  gracefulLogout();
});

process.on('SIGTERM', (signal) => {
  console.log('SIGTERM received, logging out and quitting...');
  gracefulLogout();
});

app.on('before-quit', (e) => {
  if (sessionActive) {
    e.preventDefault();
    gracefulLogout();
  }
});
