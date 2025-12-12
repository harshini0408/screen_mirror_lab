# Windows EXE Build and Deployment Guide

## Prerequisites

Before building the Windows EXE, ensure you have the following installed:

- **Node.js** (v16 or later): Download from https://nodejs.org/
- **npm** (comes with Node.js)
- **Git** (optional, for version control)
- **Windows Build Tools** (for native modules): Run `npm install --global windows-build-tools` (optional)

## Installation Steps

### 1. Prepare the Build Environment

Navigate to the kiosk desktop app directory:

```powershell
cd d:\screen_mirror_deployment_my_laptop\student-kiosk\desktop-app
```

### 2. Install Dependencies

Install all required npm packages:

```powershell
npm install
```

This will install:
- `electron` - The Electron framework for building cross-platform apps
- `electron-builder` - Tool for packaging and building installers
- `node-fetch` - HTTP client library
- `socket.io-client` - WebSocket communication library

### 3. Verify Configuration Files

Ensure these files exist in the desktop-app directory:
- `main-simple.js` - Main Electron process
- `student-interface.html` - Student login UI
- `preload.js` - Preload script for IPC
- `package.json` - Project configuration
- `build/installer.nsh` - NSIS installer script (for auto-launch)

### 4. Create Application Icon (Optional but Recommended)

Create `assets/icon.ico` (256x256 pixels) for the application icon:

If you don't have an icon, you can:
- Create one using an online tool: https://icoconvert.com/
- Use a placeholder icon
- The app will work without an icon, but it looks better with one

## Building the Windows EXE

### Option 1: Build with NSIS Installer (Recommended)

This creates an installer that:
- Installs the app to `Program Files\College Lab Kiosk`
- Sets up auto-launch on Windows login
- Creates Start Menu shortcuts
- Requires admin rights to install

```powershell
npm run build-win
```

The installer will be created at: `dist\College-Lab-Kiosk-Setup-1.0.0.exe`

### Option 2: Build Portable Executable

This creates a standalone EXE that can run from any location without installation:

```powershell
npm run build-portable
```

The portable executable will be created at: `dist\College-Lab-Kiosk-Portable-1.0.0.exe`

### Option 3: Build Both

```powershell
npm run build
```

This creates both the NSIS installer and portable executable.

## Output Files

After building, you'll find the following in the `dist` folder:

- `College-Lab-Kiosk-Setup-1.0.0.exe` - NSIS Installer (recommended for deployment)
- `College-Lab-Kiosk-Portable-1.0.0.exe` - Standalone executable
- `College-Lab-Kiosk-Setup-1.0.0.exe.blockmap` - Update manifest
- Installer support files in subdirectories

## Deployment to Student PCs

### Using the NSIS Installer (Recommended)

1. **Copy the installer to the student PC:**
   ```powershell
   # From admin computer or shared network
   Copy-Item "dist\College-Lab-Kiosk-Setup-1.0.0.exe" "\\StudentPC\c$\Downloads\"
   ```

2. **Execute the installer on the student PC:**
   ```powershell
   # Run with administrator privileges
   & "C:\Downloads\College-Lab-Kiosk-Setup-1.0.0.exe"
   ```

3. **The installer will:**
   - Extract files to `C:\Program Files\College Lab Kiosk`
   - Set up auto-launch registry entry: `HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`
   - Create Start Menu shortcuts
   - Launch the application after installation

4. **On next Windows login:**
   - The kiosk will automatically launch in full-screen mode
   - It will block all other applications until the student logs in
   - Timer window will minimize after successful login

### Using the Portable Executable

1. **Copy the portable EXE to the student PC:**
   ```powershell
   Copy-Item "dist\College-Lab-Kiosk-Portable-1.0.0.exe" "C:\ProgramData\College Lab Kiosk\"
   ```

2. **Create a Windows Task Scheduler task for auto-launch:**
   ```powershell
   $action = New-ScheduledTaskAction -Execute "C:\ProgramData\College Lab Kiosk\College-Lab-Kiosk-Portable-1.0.0.exe"
   $trigger = New-ScheduledTaskTrigger -AtLogon
   $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
   Register-ScheduledTask -TaskName "College Lab Kiosk" -Action $action -Trigger $trigger -Settings $settings -Force
   ```

## Troubleshooting

### Build Errors

**Error: "node-gyp failed"**
- Install Windows Build Tools: `npm install --global windows-build-tools`
- Delete `node_modules` folder and reinstall: `npm install`

**Error: "Could not find Electron"**
- Ensure Electron is installed: `npm install`
- Clear npm cache: `npm cache clean --force`

**Error: "Icon file not found"**
- Create `assets/icon.ico` or remove the icon reference from package.json
- The app will still build without an icon

### Runtime Issues

**Error: "VCRUNTIME140.dll not found"**
- Install Visual C++ Redistributable from Microsoft
- Or install Node.js with all tools included

**Kiosk doesn't auto-launch on login**
- Verify the registry entry was created:
  ```powershell
  Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" | Select-Object "College Lab Kiosk"
  ```
- Check that the app executable path is correct
- Try running the app manually from `Program Files\College Lab Kiosk\College Lab Kiosk.exe`

**Timer window closes unexpectedly**
- Ensure the logout functionality is working correctly
- Check that the student-logout IPC handler is receiving events

## Key Features Implemented

✅ **Kiosk Lock Behavior**
- Blocks all other applications before login
- Releases lock after successful login
- Auto-minimizes timer window

✅ **Timer Window Management**
- Automatically minimizes after login
- Cannot be closed by student (shows warning)
- Auto-closes after logout

✅ **Shutdown Delay**
- 90-second (1 minute 30 seconds) delay after logout
- Persistent auto-launch on next Windows login

✅ **Windows Integration**
- Auto-launch via Windows registry on login
- Runs with administrator privileges
- Full-screen kiosk mode on startup

## Building for Other Platforms

### macOS
```powershell
npm run build-mac
```
Creates a DMG installer for macOS.

### Linux
```powershell
npm run build-linux
```
Creates an AppImage for Linux distributions.

## Updating the App

To update the version number in future builds:

Edit `package.json` and change:
```json
"version": "1.0.1"  // Increment version
```

Then rebuild:
```powershell
npm run build-win
```

New installers will use the updated version number.

## Security Considerations

⚠️ **Important Security Notes:**

1. **Admin Privileges**: The app requests admin rights for:
   - Full-screen kiosk mode
   - Blocking keyboard shortcuts
   - Accessing system resources

2. **Registry Modifications**: The installer modifies Windows registry for:
   - Auto-launch on login
   - Startup registry keys
   - Kiosk mode identification

3. **Process Blocking**: Once in kiosk mode, students cannot:
   - Access Task Manager
   - Switch to other applications
   - Bypass login via shortcuts

4. **Deployment**: Always deploy from a trusted source and verify:
   - Installer digital signature (if available)
   - File integrity before installation
   - Network connectivity for server communication

## Support and Logs

Application logs are typically located at:
```
%APPDATA%\College Lab Kiosk\logs
```

Check these logs for troubleshooting:
- Kiosk startup issues
- Authentication failures
- Network connectivity problems
- Shutdown command errors

## Next Steps

1. Build the EXE: `npm run build-win`
2. Test on a development PC
3. Deploy the installer to student PCs
4. Configure server IP in `server-config.json`
5. Verify auto-launch on Windows login
6. Test kiosk locking behavior before and after login
