@echo off
title Fix Port Configuration
color 0E
cls

echo ========================================
echo   FIXING PORT CONFIGURATION
echo ========================================
echo.
echo This will update your .env file to use port 7401
echo.
echo Current issue: Server running on port 8000
echo Solution: Update to port 7401
echo.
echo ========================================
echo.

cd /d "%~dp0central-admin\server"

echo [STEP 1] Backing up current .env file...
if exist .env (
    copy .env .env.backup >nul 2>&1
    echo [OK] Backup created: .env.backup
) else (
    echo [WARNING] No .env file found
)
echo.

echo [STEP 2] Copying corrected configuration...
if exist .env.college (
    copy /Y .env.college .env >nul 2>&1
    echo [OK] Configuration updated to port 7401
) else (
    echo [ERROR] .env.college template not found!
    pause
    exit /b 1
)
echo.

echo [STEP 3] Verifying configuration...
findstr /C:"PORT=7401" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Port correctly set to 7401
) else (
    echo [ERROR] Port not updated correctly
    pause
    exit /b 1
)

findstr /C:"SERVER_URL=http://10.10.46.103:7401" .env >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Server URL correctly set
) else (
    echo [WARNING] Server URL may need manual update
)
echo.

echo ========================================
echo   CONFIGURATION FIXED!
echo ========================================
echo.
echo Your .env file now has:
echo   PORT=7401
echo   SERVER_URL=http://10.10.46.103:7401
echo.
echo Next steps:
echo   1. Stop the server if running (Ctrl+C)
echo   2. Restart: .\start-server.bat
echo   3. Verify: Should show port 7401
echo.
echo ========================================
echo.

pause
