const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process safely
contextBridge.exposeInMainWorld('electronAPI', {
  // Authentication
  studentLogin: (credentials) => ipcRenderer.invoke('student-login', credentials),
  studentLogout: () => ipcRenderer.invoke('student-logout'),

  // System info
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  getServerUrl: () => ipcRenderer.invoke('get-server-url'),
  getSystemNumber: () => ipcRenderer.invoke('get-system-number'),

  // CRITICAL: Get screen sources via IPC from main process
  // This is the key fix - desktopCapturer is called in main process, not preload
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),

  // Forgot password API methods
  forgotPassword: (data) => ipcRenderer.invoke('forgot-password', data),
  verifyOTP: (data) => ipcRenderer.invoke('verify-otp', data),
  resetPassword: (data) => ipcRenderer.invoke('reset-password', data),
  
  // First-time signin API
  firstTimeSignin: (data) => ipcRenderer.invoke('first-time-signin', data),
  checkStudentEligibility: (data) => ipcRenderer.invoke('check-student-eligibility', data),

  // Listen for session created event and stop live stream command
  onSessionCreated: (callback) => ipcRenderer.on('session-created', (event, data) => callback(data)),
  onStopLiveStream: (callback) => {
    ipcRenderer.on('stop-live-stream', callback);
  },

  onTimerCloseBlocked: (callback) => {
    ipcRenderer.on('timer-close-blocked', callback);
  },

  onTriggerLogout: (callback) => {
    ipcRenderer.on('trigger-logout', callback);
  },
  
  // System shutdown
  shutdownSystem: () => ipcRenderer.invoke('shutdown-system'),
  
  // 🔓 Guest login (bypass normal authentication)
  guestLogin: (data) => ipcRenderer.invoke('guest-login', data),
  triggerGuestLogin: () => ipcRenderer.send('trigger-guest-login'),
});

// Security measures: block right click context menu
window.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  console.log('Context menu disabled');
});

// Block text selection
document.addEventListener('selectstart', (e) => {
  e.preventDefault();
});

// Block drag and drop
document.addEventListener('dragover', (e) => {
  e.preventDefault();
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
});

// Block EVERYTHING - Complete kiosk lockdown
window.addEventListener('keydown', (e) => {
  // Block ESC key - prevent fullscreen exit (check both key and code)
  if (e.key === 'Escape' || e.key === 'Esc' || e.code === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    console.log('🔒 ESC key blocked (preload)');
    return false;
  }
  
  // Block Alt+Tab - prevent app switching
  if ((e.altKey && e.key === 'Tab') || (e.metaKey && e.key === 'Tab')) {
    e.preventDefault();
    console.log('🔒 Alt+Tab / Cmd+Tab blocked');
    return;
  }
  
  // Block Alt+F4 - prevent window close
  if (e.altKey && e.key === 'F4') {
    e.preventDefault();
    console.log('🔒 Alt+F4 blocked');
    return;
  }
  
  // Block Windows key - prevent Start menu
  if (e.key === 'Meta' || e.key === 'Win') {
    e.preventDefault();
    console.log('🔒 Windows/Meta key blocked');
    return;
  }
  
  // Block Ctrl+Alt+Delete - prevent task manager
  if (e.ctrlKey && e.altKey && e.key === 'Delete') {
    e.preventDefault();
    console.log('🔒 Ctrl+Alt+Delete blocked');
    return;
  }
  
  // Block F1-F12 keys (system functions)
  if (e.key >= 'F1' && e.key <= 'F12') {
    e.preventDefault();
    console.log(`🔒 ${e.key} blocked`);
    return;
  }
  
  // Block devtools combinations
  if (
    (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) ||
    (e.ctrlKey && e.key.toLowerCase() === 'u') ||
    (e.altKey && e.key.toLowerCase() === 'f12')
  ) {
    e.preventDefault();
    console.log(`🔒 Blocked shortcut: ${e.key}`);
  }
});

console.log('✅ Preload script loaded with screen sources support via IPC');
