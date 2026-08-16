const fs = require('node:fs');
const path = require('node:path');

const SECRET_KEY = /(?:authorization|password|secret|token|api[_-]?key|cookie)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const QUERY_SECRET_PATTERN = /([?&](?:access_token|refresh_token|id_token|token|api_key|apikey|key|signature|jwt)=)[^&\s"'<>]+/gi;
const BEARER_PATTERN = /(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi;
const HEADER_SECRET_PATTERN = /(\b(?:authorization|x-api-key|api-key)\s*[:=]\s*)([^\s,;}\]]{8,})/gi;
const JSON_SECRET_PATTERN = /(["']?(?:access_token|refresh_token|id_token|api_key|apikey|client_secret|password|authorization)["']?\s*[:=]\s*["'])([^"']+)(["'])/gi;

function redactText(value) {
  return String(value ?? '')
    .replace(QUERY_SECRET_PATTERN, '$1[REDACTED]')
    .replace(BEARER_PATTERN, '$1[REDACTED]')
    .replace(HEADER_SECRET_PATTERN, '$1[REDACTED]')
    .replace(JSON_SECRET_PATTERN, '$1[REDACTED]$3')
    .replace(JWT_PATTERN, '[REDACTED_JWT]');
}

function sanitizeValue(value, depth = 0) {
  if (depth > 10) return '[TRUNCATED]';
  if (typeof value === 'string') return redactText(value).slice(0, 8_000);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(-500).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 500).map(([key, item]) => [
      String(key).slice(0, 120),
      SECRET_KEY.test(key) ? '[REDACTED]' : sanitizeValue(item, depth + 1),
    ]));
  }
  return redactText(value);
}

function safeTimestamp(value = new Date().toISOString()) {
  const parsed = new Date(value);
  const timestamp = Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  return timestamp.replace(/[:.]/g, '-');
}

class DiagnosticsStore {
  constructor({ rootPath, maxSnapshots = 30, maxLogDays = 30, maxSnapshotBytes = 400_000 }) {
    this.directory = path.join(rootPath, 'diagnostics');
    this.maxSnapshots = maxSnapshots;
    this.maxLogDays = maxLogDays;
    this.maxSnapshotBytes = maxSnapshotBytes;
    fs.mkdirSync(this.directory, { recursive: true });
  }

  log(message, error) {
    const now = new Date();
    const detail = error instanceof Error ? error.stack || error.message : error ? String(error) : '';
    const line = `[${now.toISOString()}] ${redactText(message)}${detail ? `: ${redactText(detail)}` : ''}\n`;
    fs.appendFileSync(path.join(this.directory, `companion-${now.toISOString().slice(0, 10)}.log`), line, 'utf8');
    this.prune('companion-', '.log', this.maxLogDays);
  }

  writeSnapshot(input) {
    const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const capturedAt = new Date(String(source.capturedAt || ''));
    const snapshot = sanitizeValue({
      schemaVersion: 1,
      snapshotId: String(source.snapshotId || '').slice(0, 120),
      source: 'fly-machine-rotator',
      mode: source.mode === 'debug' ? 'debug' : 'verbose',
      capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date().toISOString() : capturedAt.toISOString(),
      states: source.states && typeof source.states === 'object' ? source.states : {},
      logs: Array.isArray(source.logs) ? source.logs.slice(-500) : [],
    });

    let serialized = JSON.stringify(snapshot, null, 2);
    while (Buffer.byteLength(serialized, 'utf8') > this.maxSnapshotBytes && snapshot.logs.length > 1) {
      snapshot.logs = snapshot.logs.slice(Math.ceil(snapshot.logs.length / 4));
      serialized = JSON.stringify(snapshot, null, 2);
    }
    if (Buffer.byteLength(serialized, 'utf8') > this.maxSnapshotBytes) {
      throw new Error('Sanitized diagnostics snapshot is too large');
    }

    const suffix = String(snapshot.snapshotId || safeTimestamp(snapshot.capturedAt)).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
    const filename = `fly-snapshot-${safeTimestamp(snapshot.capturedAt)}-${suffix || 'snapshot'}.json`;
    const destination = path.join(this.directory, filename);
    const temporary = `${destination}.tmp`;
    fs.writeFileSync(temporary, `${serialized}\n`, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, destination);
    fs.writeFileSync(path.join(this.directory, 'latest-fly-snapshot.json'), `${serialized}\n`, { encoding: 'utf8', mode: 0o600 });
    this.prune('fly-snapshot-', '.json', this.maxSnapshots);
    return {
      filename,
      path: destination,
      bytes: Buffer.byteLength(serialized, 'utf8'),
      logCount: snapshot.logs.length,
      capturedAt: snapshot.capturedAt,
    };
  }

  snapshot() {
    const latestPath = path.join(this.directory, 'latest-fly-snapshot.json');
    let latest = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(latestPath, 'utf8'));
      latest = { capturedAt: parsed.capturedAt || null, logCount: Array.isArray(parsed.logs) ? parsed.logs.length : 0 };
    } catch {}
    return { directory: this.directory, latest };
  }

  prune(prefix, suffix, keep) {
    try {
      const files = fs.readdirSync(this.directory)
        .filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
        .map((name) => ({ name, mtime: fs.statSync(path.join(this.directory, name)).mtimeMs }))
        .sort((left, right) => right.mtime - left.mtime);
      for (const file of files.slice(keep)) fs.unlinkSync(path.join(this.directory, file.name));
    } catch {
      // Diagnostics cleanup must not interrupt Companion operation.
    }
  }
}

module.exports = { DiagnosticsStore, redactText, sanitizeValue };
