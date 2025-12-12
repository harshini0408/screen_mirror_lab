@echo off
title Lab Kiosk - Deployment Setup
color 0B
cls

echo ========================================
echo   LAB KIOSK DEPLOYMENT
echo ========================================
echo.
echo Server IP: 10.10.46.103
echo Server Port: 7401
echo Lab ID: CC1
echo.
echo ========================================
echo.

echo [STEP 1] Checking Node.js installation...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Download the LTS version and run the installer.
    echo.
    pause
    exit /b 1
)

echo [OK] Node.js found: 
node --version
echo.

echo [STEP 2] Navigating to kiosk directory...
cd /d "%~dp0student-kiosk\desktop-app"
if %errorlevel% neq 0 (
    echo [ERROR] Cannot find kiosk directory!
    echo Expected path: %~dp0student-kiosk\desktop-app
    pause
    exit /b 1
)
echo [OK] Directory found
echo.

echo [STEP 3] Installing dependencies...
echo This may take 2-5 minutes...
echo.
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    echo.
    echo Try running: npm install manually
    pause
    exit /b 1
)
echo.
echo [OK] Dependencies installed successfully
echo.

echo [STEP 4] Creating startup batch file...
cd /d "%~dp0"
(
    echo @echo off
    echo title Lab Kiosk Application
    echo color 0A
    echo cd /d "%~dp0student-kiosk\desktop-app"
    echo echo.
    echo echo ========================================
    echo echo   LAB KIOSK STARTING
    echo echo ========================================
    echo echo.
    echo echo Server: http://10.10.46.103:7401
    echo echo Lab ID: CC1
    echo echo.
    echo echo Loading kiosk application...
    echo echo ========================================
    echo echo.
    echo npm start
) > start-kiosk.bat
echo [OK] Created start-kiosk.bat
echo.

echo [STEP 5] Creating desktop shortcut...
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut('%USERPROFILE%\Desktop\Lab Kiosk.lnk'); $Shortcut.TargetPath = '%~dp0start-kiosk.bat'; $Shortcut.WorkingDirectory = '%~dp0'; $Shortcut.IconLocation = 'imageres.dll,1'; $Shortcut.Save()"
if %errorlevel% equ 0 (
    echo [OK] Desktop shortcut created
) else (
    echo [WARNING] Could not create desktop shortcut
)
echo.

echo ========================================
echo   DEPLOYMENT COMPLETE!
echo ========================================
echo.
echo Next steps:
echo.
echo 1. Test the kiosk:
echo    - Run: start-kiosk.bat
echo    - Or double-click "Lab Kiosk" on desktop
echo.
echo 2. Verify connectivity:
echo    - Should show "Connected to server"
echo    - If not, check server is running
echo.
echo 3. Test login:
echo    - Use student ID and password
echo    - Should see session on admin dashboard
echo.
echo 4. Make kiosk auto-start on boot:
echo    - Press Win+R, type: shell:startup
echo    - Copy start-kiosk.bat shortcut there
echo.
echo 5. Optional - Build standalone installer:
echo    - Run: npm run build
echo    - Find installer in: student-kiosk\desktop-app\dist
echo.
echo ========================================
echo.

pause
