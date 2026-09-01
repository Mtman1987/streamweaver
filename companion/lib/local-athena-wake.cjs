const { spawn } = require('node:child_process');
const readline = require('node:readline');

const READY_PREFIX = 'SPMT_WAKE_READY';
const WAKE_PREFIX = 'SPMT_WAKE\t';
const ERROR_PREFIX = 'SPMT_WAKE_ERROR\t';
const DEFAULT_PHRASE = 'hey athena';

function cleanWakePhrase(value) {
  const phrase = String(value || DEFAULT_PHRASE).trim().toLowerCase().replace(/\s+/g, ' ');
  return phrase === DEFAULT_PHRASE ? phrase : DEFAULT_PHRASE;
}

function decodePayload(value) {
  try {
    return Buffer.from(String(value || ''), 'base64').toString('utf8').trim();
  } catch {
    return '';
  }
}

function decodeWakeLine(line) {
  const value = String(line || '').trim();
  if (value === READY_PREFIX) return { type: 'ready' };
  if (value.startsWith(WAKE_PREFIX)) {
    const transcript = decodePayload(value.slice(WAKE_PREFIX.length));
    return transcript ? { type: 'wake', transcript } : { type: 'ignore' };
  }
  if (value.startsWith(ERROR_PREFIX)) {
    const message = decodePayload(value.slice(ERROR_PREFIX.length)) || 'Local wake listener failed';
    return { type: 'error', message };
  }
  return { type: 'ignore' };
}

function powershellWakeScript(phrase = DEFAULT_PHRASE) {
  const wakePhrase = cleanWakePhrase(phrase).replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1
  if ($null -eq $installed) { throw 'No offline Windows English speech recognizer is installed.' }

  $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($installed)
  $recognizer.SetInputToDefaultAudioDevice()

  $wakeOnlyBuilder = New-Object System.Speech.Recognition.GrammarBuilder
  $wakeOnlyBuilder.Culture = $installed.Culture
  $wakeOnlyBuilder.Append('${wakePhrase}')
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.Grammar($wakeOnlyBuilder)))

  $commandBuilder = New-Object System.Speech.Recognition.GrammarBuilder
  $commandBuilder.Culture = $installed.Culture
  $commandBuilder.Append('${wakePhrase}')
  $commandBuilder.AppendDictation()
  $recognizer.LoadGrammar((New-Object System.Speech.Recognition.Grammar($commandBuilder)))

  [Console]::Out.WriteLine('${READY_PREFIX}')
  [Console]::Out.Flush()
  while ($true) {
    $result = $recognizer.Recognize()
    if ($null -eq $result) { continue }
    $text = [string]$result.Text
    if ([string]::IsNullOrWhiteSpace($text)) { continue }
    if ($text -notmatch '^(?i)hey\\s+athena\\b') { continue }
    $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text.Trim()))
    [Console]::Out.WriteLine('${WAKE_PREFIX}' + $payload)
    [Console]::Out.Flush()
  }
} catch {
  $message = [string]$_.Exception.Message
  $payload = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($message))
  [Console]::Out.WriteLine('${ERROR_PREFIX}' + $payload)
  [Console]::Out.Flush()
  exit 2
}
`;
}

class LocalAthenaWake {
  constructor({ phrase = DEFAULT_PHRASE, onWake = () => {}, onStatus = () => {}, onError = () => {} } = {}) {
    this.phrase = cleanWakePhrase(phrase);
    this.onWake = onWake;
    this.onStatus = onStatus;
    this.onError = onError;
    this.child = null;
    this.stopped = true;
    this.state = { state: process.platform === 'win32' ? 'stopped' : 'unsupported', phrase: this.phrase, localOnly: true };
  }

  snapshot() {
    return { ...this.state };
  }

  setState(next) {
    this.state = { ...this.state, ...next, phrase: this.phrase, localOnly: true };
    this.onStatus(this.snapshot());
  }

  start() {
    if (!this.stopped && this.child) return this.snapshot();
    if (process.platform !== 'win32') {
      this.stopped = true;
      this.setState({ state: 'unsupported', detail: 'Local Athena wake currently requires Windows Companion.' });
      return this.snapshot();
    }

    this.stop();
    this.stopped = false;
    this.setState({ state: 'starting', detail: 'Starting offline Windows wake listener.' });
    const encoded = Buffer.from(powershellWakeScript(this.phrase), 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.child = child;

    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      const event = decodeWakeLine(line);
      if (event.type === 'ready') {
        this.setState({ state: 'listening', detail: `Listening locally for “${this.phrase}”.` });
      } else if (event.type === 'wake') {
        this.setState({ state: 'triggered', detail: event.transcript });
        this.onWake({ transcript: event.transcript, phrase: this.phrase, capturedAt: Date.now(), source: 'windows-companion-local' });
        this.setState({ state: 'listening', detail: `Listening locally for “${this.phrase}”.` });
      } else if (event.type === 'error') {
        this.setState({ state: 'error', detail: event.message });
        this.onError(new Error(event.message));
      }
    });

    child.stderr.on('data', (chunk) => {
      const message = String(chunk || '').trim();
      if (message) this.onError(new Error(message));
    });
    child.on('error', (error) => {
      if (this.child === child) this.child = null;
      this.setState({ state: 'error', detail: error.message });
      this.onError(error);
    });
    child.on('exit', (code) => {
      if (this.child === child) this.child = null;
      if (this.stopped) {
        this.setState({ state: 'stopped', detail: 'Local wake listener stopped.' });
        return;
      }
      this.stopped = true;
      this.setState({ state: code === 0 ? 'stopped' : 'error', detail: `Local wake listener exited (${code ?? 'unknown'}).` });
    });
    return this.snapshot();
  }

  stop() {
    this.stopped = true;
    const child = this.child;
    this.child = null;
    if (child && child.exitCode == null) {
      try { child.kill(); } catch {}
    }
    if (process.platform === 'win32') this.setState({ state: 'stopped', detail: 'Local wake listener stopped.' });
    return this.snapshot();
  }
}

module.exports = {
  LocalAthenaWake,
  DEFAULT_PHRASE,
  decodeWakeLine,
  powershellWakeScript,
  cleanWakePhrase,
};
