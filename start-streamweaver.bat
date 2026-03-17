@echo off
echo Starting StreamWeaver...
echo.

REM Always run from this folder
cd /d "%~dp0"

REM Check if Node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm dependencies are installed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
)

echo Starting StreamWeaver server...
echo.
echo Dashboard: http://127.0.0.1:3100
echo WebSocket: ws://127.0.0.1:8090
echo.
echo Press Ctrl+C to stop
echo.

REM Start in dev mode (use start:local for production after running npm run build)
npm run dev

REM Keep window open if there's an error
if errorlevel 1 (
    echo StreamWeaver failed to start.
    pause
)

echo StreamWeaver has stopped.
pause
