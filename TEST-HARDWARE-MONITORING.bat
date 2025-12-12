@echo off
REM ========================================
REM Hardware Monitoring Quick Test Script
REM ========================================

echo.
echo ====================================
echo   HARDWARE MONITORING TEST SCRIPT
echo ====================================
echo.
echo This script helps you test the Hardware Monitoring feature on your laptop.
echo.
echo WHAT WILL BE TESTED:
echo   1. Network disconnection (Turn off Wi-Fi)
echo   2. Mouse disconnection (Unplug wireless receiver)
echo   3. Alert display on admin dashboard
echo   4. Alert queueing and retry
echo.
echo PREREQUISITES:
echo   - Server must be running (port 7401)
echo   - Admin dashboard must be open in browser
echo   - Student must be logged into kiosk
echo   - Active lab session must be running
echo.
pause

echo.
echo ========================================
echo STEP 1: Verify System Components
echo ========================================
echo.

REM Check if server is running
echo Checking if server is running on port 7401...
netstat -ano | findstr ":7401" >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Server is running on port 7401
) else (
    echo [ERROR] Server is NOT running!
    echo Please start the server first:
    echo   cd central-admin\server
    echo   node app.js
    pause
    exit /b 1
)

echo.
echo Please verify manually:
echo   [ ] Admin dashboard is open: http://localhost:7401/central-admin/dashboard/admin-dashboard.html
echo   [ ] Lab session is started
echo   [ ] Student is logged into kiosk
echo   [ ] Kiosk console shows: "Hardware monitoring started..."
echo.
pause

echo.
echo ========================================
echo STEP 2: Test Network Disconnection
echo ========================================
echo.
echo INSTRUCTIONS:
echo   1. Make sure kiosk is logged in and visible
echo   2. Open kiosk DevTools (should auto-open)
echo   3. Watch the console for network messages
echo   4. Turn OFF Wi-Fi on your laptop
echo   5. Wait 10 seconds
echo   6. Check admin dashboard for red network alert
echo.
echo EXPECTED IN KIOSK CONSOLE:
echo   "SOCKET DISCONNECTED - NETWORK ISSUE!"
echo   "Alert stored in localStorage"
echo.
echo EXPECTED ON ADMIN DASHBOARD:
echo   - Toast notification: "Network disconnected on [SYSTEM]"
echo   - Hardware Alerts badge shows "1"
echo   - Student card shows red network icon
echo.
echo Ready to test network disconnection?
pause

echo.
echo ACTION REQUIRED: Turn OFF your Wi-Fi now!
echo.
echo Press any key AFTER you've turned off Wi-Fi...
pause >nul

echo.
echo Waiting 10 seconds for alerts to register...
timeout /t 10 /nobreak >nul

echo.
echo CHECK ADMIN DASHBOARD NOW:
echo   [ ] Did you see a toast notification?
echo   [ ] Does Hardware Alerts badge show "1" or more?
echo   [ ] Does the student card have a red network icon?
echo   [ ] Open Hardware Alerts panel - is there a network disconnect alert?
echo.
pause

echo.
echo ========================================
echo STEP 3: Test Network Reconnection
echo ========================================
echo.
echo ACTION REQUIRED: Turn ON your Wi-Fi now!
echo.
echo Press any key AFTER you've turned on Wi-Fi...
pause >nul

echo.
echo Waiting 10 seconds for reconnection...
timeout /t 10 /nobreak >nul

echo.
echo CHECK KIOSK CONSOLE:
echo   Should show: "SOCKET RECONNECTED - NETWORK RESTORED!"
echo   Should show: "Sending pending alerts from storage"
echo.
echo CHECK ADMIN DASHBOARD:
echo   [ ] Did you see "Network reconnected" notification?
echo   [ ] Did pending alerts appear in the panel?
echo   [ ] Is the network icon now green?
echo.
pause

echo.
echo ========================================
echo STEP 4: Test Mouse Disconnection
echo ========================================
echo.
echo INSTRUCTIONS:
echo   1. Make sure wireless mouse is working
echo   2. Move mouse to confirm activity
echo   3. UNPLUG the nano USB receiver
echo   4. Wait 30-40 seconds without moving mouse
echo   5. Check admin dashboard for mouse alert
echo.
echo EXPECTED BEHAVIOR:
echo   - After 30 seconds: "Mouse inactive" alert
echo   - Admin dashboard shows mouse disconnect icon
echo.
echo Ready to test mouse disconnection?
pause

echo.
echo ACTION REQUIRED: Unplug your wireless mouse receiver NOW!
echo.
echo Press any key AFTER you've unplugged the receiver...
pause >nul

echo.
echo Waiting 40 seconds for mouse inactivity detection...
echo (This is a 30-second threshold, plus buffer time)
timeout /t 40 /nobreak >nul

echo.
echo CHECK ADMIN DASHBOARD:
echo   [ ] Did you see a "Mouse inactive" alert?
echo   [ ] Does the student card show mouse disconnect icon?
echo   [ ] Open Hardware Alerts panel - is there a mouse alert?
echo.
pause

echo.
echo ========================================
echo STEP 5: Test Mouse Reconnection
echo ========================================
echo.
echo ACTION REQUIRED: 
echo   1. Plug the nano receiver back into USB port
echo   2. Move the mouse to trigger activity
echo.
echo Press any key AFTER you've moved the mouse...
pause >nul

echo.
echo Waiting 5 seconds...
timeout /t 5 /nobreak >nul

echo.
echo CHECK ADMIN DASHBOARD:
echo   [ ] Did you see "Mouse activity resumed" alert?
echo   [ ] Is the mouse icon back to normal?
echo.
pause

echo.
echo ========================================
echo STEP 6: Verify localStorage Persistence
echo ========================================
echo.
echo INSTRUCTIONS:
echo   1. Open kiosk DevTools
echo   2. Go to: Application tab ^> Local Storage
echo   3. Look for key: "pendingHardwareAlerts"
echo.
echo VERIFICATION:
echo   - Should be EMPTY now (all alerts sent)
echo   - If it has data, that means offline queueing is working
echo.
pause

echo.
echo ========================================
echo TEST SUMMARY
echo ========================================
echo.
echo Did all tests pass?
echo.
echo [1] YES - All alerts appeared correctly
echo [2] NO - Some alerts didn't work
echo [3] PARTIAL - Some worked, some didn't
echo.
set /p result="Enter your choice (1/2/3): "

if "%result%"=="1" (
    echo.
    echo ========================================
    echo   SUCCESS! Hardware Monitoring Works!
    echo ========================================
    echo.
    echo Your system is ready for deployment to college lab.
    echo.
    echo NEXT STEPS:
    echo   1. Test on 1 college lab system with Ethernet
    echo   2. Physically unplug Ethernet cable
    echo   3. Verify alerts appear
    echo   4. Deploy to all lab systems
    echo.
) else (
    echo.
    echo ========================================
    echo   TROUBLESHOOTING NEEDED
    echo ========================================
    echo.
    echo Please check:
    echo   1. Server logs for errors
    echo   2. Kiosk console for error messages
    echo   3. Browser console on admin dashboard
    echo   4. Network connectivity
    echo.
    echo Refer to: HARDWARE_MONITORING_TEST_GUIDE.md
    echo Section: Troubleshooting
    echo.
)

echo.
echo ========================================
echo   TEST COMPLETE
echo ========================================
echo.
echo Documentation:
echo   - HARDWARE_MONITORING_TEST_GUIDE.md (detailed guide)
echo   - HARDWARE_MONITORING_COMPLETE.md (quick reference)
echo.
pause
