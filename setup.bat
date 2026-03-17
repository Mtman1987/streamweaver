@echo off
echo Setting up StreamWeaver...

REM Copy example env file if it doesn't exist
if not exist ".env" (
    echo Creating .env from .env.example...
    copy .env.example .env
)

if not exist "config" mkdir config
if not exist "data" mkdir data
if not exist "logs" mkdir logs
if not exist "tokens" mkdir tokens

echo.
echo Setup complete! Now run:
echo   npm install
echo   npm start
echo.
echo Configure the app from the browser Settings page after first start.
echo Your editable files live under config\, data\, and logs\.
pause
