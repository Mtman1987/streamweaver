@echo off
echo Stopping StreamWeaver...
echo.

cd /d %~dp0

REM Kill processes by window title
echo Stopping StreamWeaver windows...
taskkill /F /FI "WINDOWTITLE:StreamWeaver*" >nul 2>&1

REM Kill processes by command line patterns
echo Stopping Next.js processes...
wmic process where "commandline like '%%next dev%%'" delete >nul 2>&1
wmic process where "commandline like '%%next start%%'" delete >nul 2>&1

echo Stopping server processes...
wmic process where "commandline like '%%tsx server.ts%%'" delete >nul 2>&1
wmic process where "commandline like '%%npx tsx server.ts%%'" delete >nul 2>&1

REM Kill processes on specific ports
echo Cleaning up ports...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3100" 2^>nul') do (
    taskkill /F /PID %%p >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":8090" 2^>nul') do (
    taskkill /F /PID %%p >nul 2>&1
)

echo.
echo StreamWeaver stopped.
echo You can now run start-streamweaver.bat to restart.
echo.
pause