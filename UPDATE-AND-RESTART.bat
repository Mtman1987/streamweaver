@echo off
echo ========================================
echo UPDATING STREAMWEAVER
echo ========================================
echo.

REM Go to the correct folder
cd /d "%~dp0"

echo [1/4] Stopping any running processes...
call stop-streamweaver.bat >nul 2>&1

echo [2/4] Deleting Next.js cache...
if exist ".next" (
    rmdir /s /q .next
    echo Cache deleted!
) else (
    echo No cache found.
)

echo [3/4] Pulling latest code from GitHub...
git pull --ff-only
if errorlevel 1 (
    echo Update failed. Resolve local git changes manually, then retry.
    pause
    exit /b 1
)

echo [4/4] Starting StreamWeaver...
echo.
call start-streamweaver.bat
