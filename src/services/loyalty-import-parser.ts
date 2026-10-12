import { createHash } from 'node:crypto';
export type LoyaltyImportRow = { username: string; points?: string; watchMinutes?: number };
export type WatchUnit = 'minutes' | 'seconds' | 'hours';
const own = (row: any, keys: string[]) => keys.map(k => row[k]).find(v => v !== undefined && v !== null && String(v).trim() !== '');
function csvRows(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') { if (quoted && text[i+1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (!quoted && c === ',') { row.push(cell); cell = ''; }
    else if (!quoted && (c === '\n' || c === '\r')) { if (c === '\r' && text[i+1] === '\n') i++; row.push(cell); if (row.some(v => v.trim())) rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (quoted) throw new Error('CSV has an unfinished quoted field.');
  row.push(cell); if (row.some(v => v.trim())) rows.push(row);
  return rows;
}
export function parseLoyaltyImport(text: string, unit: WatchUnit): { rows: LoyaltyImportRow[]; digest: string } {
  if (!['minutes', 'seconds', 'hours'].includes(unit)) throw new Error('Choose the watchtime unit.');
  if (!text.trim() || Buffer.byteLength(text) > 2_000_000) throw new Error('Choose a CSV or JSON file smaller than 2 MB.');
  let source: any[];
  if (/^[\s\uFEFF]*[\[{]/.test(text)) {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    source = Array.isArray(value) ? value : Array.isArray(value.users) ? value.users : Array.isArray(value.data) ? value.data : Array.isArray(value.entries) ? value.entries : Object.entries(value).map(([username, row]) => typeof row === 'object' && row !== null ? { ...row, username } : { username, points: row });
  } else {
    const table = csvRows(text.replace(/^\uFEFF/, ''));
    const headers = table.shift()?.map(v => v.trim().toLowerCase().replace(/[ _-]/g, '')) || [];
    if (new Set(headers).size !== headers.length) throw new Error('CSV has duplicate column names.');
    source = table.map((cells, i) => { if (cells.length !== headers.length) throw new Error('CSV row ' + (i+2) + ' has the wrong column count.'); return Object.fromEntries(headers.map((h,j) => [h,cells[j]])); });
  }
  if (!source.length || source.length > 10_000) throw new Error('The file must contain 1–10,000 viewers.');
  const combined = new Map<string, LoyaltyImportRow>();
  for (let i = 0; i < source.length; i++) {
    const row = Object.fromEntries(Object.entries(source[i] || {}).map(([k,v]) => [k.toLowerCase().replace(/[ _-]/g,''),v]));
    const username = String(own(row,['username','user','name','userlogin','login']) || '').trim().replace(/^@/,'').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(username)) throw new Error('Row ' + (i+1) + ' needs a Twitch username.');
    const points = own(row,['points','loyaltypoints','balance']);
    const explicitMinutes = own(row,['watchminutes','watchtimeminutes','minutes']);
    const watch = explicitMinutes ?? own(row,['watchtime','timewatched','time','hours','seconds']);
    const next: LoyaltyImportRow = { username };
    if (points !== undefined) {
      // Exports sometimes serialize whole-number balances as "1,234" or "1234.0".
      // Accept those representations without converting large string balances through Number.
      const raw = String(points).trim().replace(/,/g,'');
      const wholeNumber = /^(\d{1,30})(?:\.0+)?$/.exec(raw);
      if (!wholeNumber || (typeof points === 'number' && (!Number.isSafeInteger(points) || points < 0))) {
        throw new Error('Row ' + (i+1) + ' has invalid points. Use a non-negative whole number (for example 1200 or "1,200"); fractional points are not supported.');
      }
      next.points = BigInt(wholeNumber[1]).toString();
    }
    if (watch !== undefined) {
      const raw = String(watch).trim().replace(/,/g,'');
      if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Row ' + (i+1) + ' has invalid watchtime.');
      const factor = explicitMinutes !== undefined ? 1 : row.hours !== undefined ? 60 : row.seconds !== undefined ? 1/60 : unit === 'hours' ? 60 : unit === 'seconds' ? 1/60 : 1;
      const minutes = Math.floor(Number(raw) * factor);
      if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > 100_000_000) throw new Error('Row ' + (i+1) + ' has invalid watchtime.');
      next.watchMinutes = minutes;
    }
    if (next.points === undefined && next.watchMinutes === undefined) throw new Error('Row ' + (i+1) + ' needs points or watchtime.');
    const previous = combined.get(username);
    if (previous) {
      if (next.points !== undefined) previous.points = previous.points === undefined || BigInt(next.points) > BigInt(previous.points || '0') ? next.points : previous.points;
      if (next.watchMinutes !== undefined) previous.watchMinutes = Math.max(previous.watchMinutes || 0,next.watchMinutes);
    } else combined.set(username,next);
  }
  const rows = [...combined.values()].sort((a,b) => a.username.localeCompare(b.username));
  return { rows, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
}
