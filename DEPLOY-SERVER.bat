@echo off
title Lab Management Server - Deployment Setup
color 0B
cls

echo ========================================
echo   LAB MANAGEMENT SERVER SETUP
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

echo [STEP 2] Navigating to server directory...
cd /d "%~dp0central-admin\server"
if %errorlevel% neq 0 (
    echo [ERROR] Cannot find server directory!
    echo Expected path: %~dp0central-admin\server
    pause
    exit /b 1
)
echo [OK] Directory found
echo.

echo [STEP 3] Checking .env file...
if not exist ".env" (
    echo [WARNING] .env file not found!
    echo.
    echo Creating default .env file...
    (
        echo PORT=7401
        echo NODE_ENV=production
        echo MONGODB_URI=mongodb+srv://srijaaanandhan12_db_user:122007@cluster0.2kzkkpe.mongodb.net/college-lab-registration?retryWrites=true^&w=majority
        echo BCRYPT_SALT_ROUNDS=10
        echo.
        echo # Email Configuration (optional - for password reset)
        echo EMAIL_USER=clab7094@gmail.com
        echo EMAIL_PASSWORD=your-app-password
        echo EMAIL_FROM="Lab Management System <clab7094@gmail.com>"
    ) > .env
    echo [OK] Default .env created
    echo.
    echo NOTE: Edit .env to configure email settings if needed.
    echo.
) else (
    echo [OK] .env file exists
    echo.
)

echo [STEP 4] Installing dependencies...
echo This may take 2-5 minutes...
echo.
call npm install --production
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

echo [STEP 5] Creating startup batch file...
cd /d "%~dp0"
(
    echo @echo off
    echo title Lab Management Server
    echo color 0A
    echo cd /d "%~dp0central-admin\server"
    echo echo.
    echo echo ========================================
    echo echo   LAB MANAGEMENT SERVER RUNNING
    echo echo ========================================
    echo echo.
    echo echo Server URL: http://10.10.46.103:7401
    echo echo Admin Dashboard: http://10.10.46.103:7401/admin-dashboard.html
    echo echo.
    echo echo Press Ctrl+C to stop the server
    echo echo ========================================
    echo echo.
    echo node app.js
    echo pause
) > start-server.bat
echo [OK] Created start-server.bat
echo.

echo ========================================
echo   DEPLOYMENT COMPLETE!
echo ========================================
echo.
echo Next steps:
echo.
echo 1. Configure Windows Firewall:
echo    - Open Windows Firewall
echo    - Create inbound rule for port 7401
echo.
echo 2. Set Static IP Address:
echo    - IP: 10.10.46.103
echo    - Subnet: 255.255.255.0
echo    - Gateway: 10.10.46.1 (ask IT admin)
echo.
echo 3. Start the server:
echo    - Run: start-server.bat
echo.
echo 4. Test from browser:
echo    - Open: http://10.10.46.103:7401
echo.
echo 5. Optional - Make server auto-start:
echo    - Use Task Scheduler
echo    - See DEPLOYMENT_GUIDE_COLLEGE.md
echo.
echo ========================================
echo.

pause
