# Runtime Config Policy

Read this before changing config in this repo.

- Secrets belong in `env` / Fly secrets only.
- Public runtime config belongs in volume-backed JSON.
- App state belongs in the database.
- Local `.env` is for dev convenience only and stays gitignored.
- Do not move public toggles, URLs, or operational flags into secrets by default.
- Do not store secrets in JSON.
- Before editing config, classify the value first:
  - secret
  - public runtime config
  - app state
  - local-only debug
