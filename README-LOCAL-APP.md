# StreamWeaver Local App

StreamWeaver runs entirely on your machine as a local Node server with a browser UI.

## What users do

1. Download the release zip.
2. Extract it to a normal folder.
3. Run `StreamWeaver.exe` on Windows, `./StreamWeaver` on macOS/Linux, or `npm start` for a source build.
4. The app starts on `http://127.0.0.1:3100`.
5. Open the Settings page and enter the API key from `config/app.json`.

## Folder layout

The release keeps editable and persistent files outside the app code:

- `config/`
- `data/`
- `logs/`

Secrets stay on the local machine and are masked in the UI after they are saved.