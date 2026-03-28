@echo off
REM Deploy streamweaver to Fly.io

setlocal enabledelayedexpansion

echo Deploying streamweaver to Fly.io...
echo.

where flyctl >nul 2>&1
if errorlevel 1 (
    echo ERROR: Fly CLI not found
    pause
    exit /b 1
)

cd /d "C:\Users\mtman\Desktop\streamweaver-main"

echo Deploying streamweaver-new...
call fly deploy -c fly.toml -a streamweaver-new

if errorlevel 1 (
    echo ERROR: Deployment failed
    pause
    exit /b 1
)

echo.
echo ✓ streamweaver-new deployed successfully!
echo   Web: https://streamweaver-new.fly.dev
echo   WebSocket: wss://streamweaver-new.fly.dev:8090
pause
