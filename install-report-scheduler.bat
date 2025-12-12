@echo off
echo ============================================================
echo  Installing Automatic Report Scheduler
echo ============================================================
echo.

echo [1/3] Installing node-cron package...
cd central-admin\server
call npm install node-cron

echo.
echo [2/3] Verifying installation...
call npm list node-cron

echo.
echo [3/3] Setup complete!
echo.
echo ============================================================
echo  Installation Summary
echo ============================================================
echo  Status: Ready to use
echo  Package: node-cron installed
echo  Location: central-admin/server/node_modules
echo.
echo  Next Steps:
echo  1. Start the server: node app.js
echo  2. Open admin dashboard
echo  3. Configure schedule in "Automatic Report Schedule" section
echo  4. Test with "Generate Report Now" button
echo.
echo  Documentation: AUTOMATIC_REPORT_SCHEDULING_GUIDE.md
echo ============================================================
echo.
pause
