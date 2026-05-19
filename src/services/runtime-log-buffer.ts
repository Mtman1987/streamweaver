import { format } from 'util';

const MAX_LINES = Number(process.env.RUNTIME_LOG_BUFFER_LINES || 500);
const lines: string[] = [];
let installed = false;

function append(level: string, args: unknown[]): void {
  const line = `[${new Date().toISOString()}] [${level}] ${format(...args)}`;
  lines.push(line);
  if (lines.length > MAX_LINES) {
    lines.splice(0, lines.length - MAX_LINES);
  }
}

export function installRuntimeLogBuffer(): void {
  if (installed) return;
  installed = true;

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    append('log', args);
    original.log(...args);
  };
  console.warn = (...args: unknown[]) => {
    append('warn', args);
    original.warn(...args);
  };
  console.error = (...args: unknown[]) => {
    append('error', args);
    original.error(...args);
  };
}

export function getRecentLogLines(count = 120): string[] {
  return lines.slice(-count);
}
