@echo off
title Lab Kiosk Auto-Start
color 0A

echo.
echo ========================================
echo   LAB KIOSK APPLICATION STARTING
echo ========================================
echo.
echo Starting kiosk application...
echo.

cd /d "%~dp0student-kiosk\desktop-app"
npm start

pause
