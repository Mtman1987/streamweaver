@echo off
echo Cleaning personal data...

del /q .env 2>nul
del /q tokens\*.json 2>nul
copy tokens\user-config.example.json tokens\user-config.json
copy tokens\discord-webhooks.example.json tokens\discord-webhooks.json
copy tokens\twitch-tokens.example.json tokens\twitch-tokens.json
copy tokens\discord-channels.example.json tokens\discord-channels.json
copy tokens\welcome-wagon.example.json tokens\welcome-wagon.json
copy .env.example .env

echo Done! Now zip the folder and send it.
pause
