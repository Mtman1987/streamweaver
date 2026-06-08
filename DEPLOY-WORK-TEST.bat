@echo off
REM Deploy streamweaver work test to Fly.io

setlocal enabledelayedexpansion

echo Deploying streamweaver-work-test to Fly.io...
echo.

where flyctl >nul 2>&1
if errorlevel 1 (
    echo ERROR: Fly CLI not found
    pause
    exit /b 1
)

cd /d "%~dp0"

echo Deploying streamweaver-work-test...
call fly deploy -c fly.work-test.toml -a streamweaver-work-test

if errorlevel 1 (
    echo ERROR: Deployment failed
    pause
    exit /b 1
)

echo.
echo ✓ streamweaver-work-test deployed successfully!
echo   Web: https://streamweaver-work-test.fly.dev
echo   WebSocket: wss://streamweaver-work-test.fly.dev:8090
pause
