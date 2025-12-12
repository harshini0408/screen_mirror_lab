@echo off
echo ========================================
echo   Student Kiosk - GitHub Build Setup
echo ========================================
echo.

REM Check if we're in the right directory
if not exist "student-kiosk\desktop-app\package.json" (
    echo ERROR: Please run this script from the root directory containing student-kiosk folder
    pause
    exit /b 1
)

echo [1/6] Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed. Please install from https://nodejs.org/
    pause
    exit /b 1
)
echo ✅ Node.js is installed

echo.
echo [2/6] Installing electron-builder...
cd student-kiosk\desktop-app
npm install --save-dev electron-builder
if errorlevel 1 (
    echo ERROR: Failed to install electron-builder
    pause
    exit /b 1
)
echo ✅ electron-builder installed

echo.
echo [3/6] Creating GitHub Actions workflow directory...
cd ..\..
mkdir .github\workflows 2>nul
echo ✅ Workflow directory created

echo.
echo [4/6] Creating build workflow file...
(
echo name: Build and Release Executable
echo.
echo on:
echo   push:
echo     branches: [ main ]
echo     tags: [ 'v*' ]
echo   pull_request:
echo     branches: [ main ]
echo   workflow_dispatch:
echo.
echo jobs:
echo   build:
echo     runs-on: ${{ matrix.os }}
echo     
echo     strategy:
echo       matrix:
echo         os: [windows-latest]
echo         
echo     steps:
echo     - name: Checkout code
echo       uses: actions/checkout@v3
echo       
echo     - name: Setup Node.js
echo       uses: actions/setup-node@v3
echo       with:
echo         node-version: '18'
echo         cache: 'npm'
echo         cache-dependency-path: student-kiosk/desktop-app/package-lock.json
echo         
echo     - name: Install dependencies
echo       run: ^|
echo         cd student-kiosk/desktop-app
echo         npm ci
echo         
echo     - name: Build Windows application
echo       run: ^|
echo         cd student-kiosk/desktop-app
echo         npm run build-win
echo         
echo     - name: Upload Windows executable
echo       uses: actions/upload-artifact@v3
echo       with:
echo         name: student-kiosk-windows-exe
echo         path: student-kiosk/desktop-app/dist/*.exe
) > .github\workflows\build-exe.yml

echo ✅ Workflow file created

echo.
echo [5/6] Updating package.json with build configuration...
cd student-kiosk\desktop-app

REM Backup original package.json
copy package.json package.json.backup >nul

REM Create updated package.json with build config
powershell -Command "& {
    $json = Get-Content 'package.json' | ConvertFrom-Json
    if (-not $json.scripts) { $json | Add-Member -Type NoteProperty -Name 'scripts' -Value @{} }
    $json.scripts | Add-Member -Type NoteProperty -Name 'build' -Value 'electron-builder' -Force
    $json.scripts | Add-Member -Type NoteProperty -Name 'build-win' -Value 'electron-builder --win' -Force
    $json.scripts | Add-Member -Type NoteProperty -Name 'dist' -Value 'npm run build' -Force
    
    $buildConfig = @{
        'appId' = 'com.college.student-kiosk'
        'productName' = 'Student Kiosk'
        'directories' = @{ 'output' = 'dist' }
        'files' = @('**/*', '!node_modules/**/*')
        'win' = @{
            'target' = 'nsis'
            'icon' = 'assets/icon.ico'
        }
        'nsis' = @{
            'oneClick' = $false
            'allowToChangeInstallationDirectory' = $true
            'createDesktopShortcut' = $true
            'createStartMenuShortcut' = $true
        }
    }
    
    $json | Add-Member -Type NoteProperty -Name 'build' -Value $buildConfig -Force
    $json | ConvertTo-Json -Depth 10 | Set-Content 'package.json'
}"

echo ✅ package.json updated with build configuration

echo.
echo [6/6] Creating .gitignore file...
cd ..\..
(
echo node_modules/
echo dist/
echo *.log
echo .env
echo .DS_Store
echo Thumbs.db
echo *.tmp
echo *.temp
) > .gitignore

echo ✅ .gitignore created

echo.
echo ========================================
echo           SETUP COMPLETE! ✅
echo ========================================
echo.
echo Next steps:
echo 1. Create a GitHub repository at https://github.com
echo 2. Initialize git: git init
echo 3. Add remote: git remote add origin https://github.com/USERNAME/REPO.git
echo 4. Add files: git add .
echo 5. Commit: git commit -m "Initial commit"
echo 6. Push: git push -u origin main
echo.
echo The GitHub Action will automatically build your .exe file!
echo.
echo For detailed instructions, see BUILD_EXE_GUIDE.md
echo.
pause
