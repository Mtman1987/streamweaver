@echo off
echo ========================================
echo FORCE UPDATE - CLEARING ALL CACHES
echo ========================================
echo.

REM Go to the correct folder
cd /d "%~dp0"

echo [1/5] Stopping all Node processes...
taskkill /F /IM node.exe 2>nul
timeout /t 2 /nobreak >nul

echo [2/5] Deleting Next.js cache...
if exist ".next" rmdir /s /q .next

echo [3/5] Deleting node_modules cache...
if exist "node_modules\.cache" rmdir /s /q node_modules\.cache

echo [4/5] Deleting TSX cache...
if exist "%TEMP%\tsx" rmdir /s /q "%TEMP%\tsx"
if exist "%LOCALAPPDATA%\tsx" rmdir /s /q "%LOCALAPPDATA%\tsx"

echo [5/5] Starting StreamWeaver...
echo.
echo ALL CACHES CLEARED!
echo.
start-streamweaver.bat
