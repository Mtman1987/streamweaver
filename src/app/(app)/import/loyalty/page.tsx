'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
type ImportMode = 'watchtime' | 'points' | 'all';
export default function LoyaltyImportPage() {
  const [text,setText] = useState(''), [name,setName] = useState(''), [unit,setUnit] = useState('minutes'), [mode,setMode] = useState<ImportMode>('watchtime'), [preview,setPreview] = useState<any>(null), [busy,setBusy] = useState(false), [status,setStatus] = useState('');
  const request = async (action: string) => {
    setBusy(true); setStatus('');
    try {
      const response = await fetch('/api/import/loyalty',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,text,unit,mode,digest:preview?.digest})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed.');
      if (action === 'preview') setPreview(data);
      else { setStatus(data.alreadyImported ? 'This file was already imported. No totals were changed.' : 'Imported ' + data.imported + ' viewers into ' + data.channel + '. Existing higher totals were kept.'); setPreview(null); }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader><CardTitle>Import StreamElements Data</CardTitle><p>Upload the main export now, then import points from a separate file when it is ready.</p></CardHeader><CardContent className="space-y-5">
    <p>Choose what this file contains. In <strong>Watchtime / other data only</strong> mode, StreamWeaver ignores the points column entirely—even if StreamElements exported invalid or placeholder values. The points file can be imported separately later.</p>
    <label className="block">Import type<select className="block mt-2 rounded border bg-background p-2" value={mode} disabled={busy} onChange={e=>{setMode(e.target.value as ImportMode);setPreview(null);setStatus('');}}><option value="watchtime">Watchtime / other data only (ignore points)</option><option value="points">Points only (ignore watchtime)</option><option value="all">Points and watchtime together</option></select></label>
    <p className="text-sm text-muted-foreground">Accepts CSV or JSON, up to 2 MB / 10,000 viewers. CSV should include Twitch usernames and the relevant columns. Existing totals are never reduced.</p>
    <label className="block">Export file<input className="block mt-2" type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={async e=>{setPreview(null);setStatus('');setText('');const file=e.target.files?.[0];if(!file)return;if(file.size>2_000_000){setStatus('Choose a file smaller than 2 MB.');return;}setName(file.name);setText(await file.text());}} /></label>
    <label className="block">Watchtime unit<select className="block mt-2 rounded border bg-background p-2" value={unit} disabled={busy||mode==='points'} onChange={e=>{setUnit(e.target.value);setPreview(null);}}><option value="minutes">Minutes</option><option value="seconds">Seconds</option><option value="hours">Hours</option></select></label>
    <p className="text-sm">A backup is saved before applying. Import is tenant-scoped and keeps higher existing balances; it does not add points twice or change Nebula/SPMT XP.</p>
    <Button disabled={!text||busy} onClick={()=>void request('preview')}>{busy?'Working…':'Preview import'}</Button>
    {preview && <section className="space-y-3"><p><strong>{preview.channel}</strong>: {preview.viewers} viewers in {name}; {preview.changed} would change.</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Viewer</th>{mode!=='watchtime'&&<th>Points before → after</th>}{mode!=='points'&&<th>Minutes before → after</th>}</tr></thead><tbody>{preview.sample.map((r:any)=><tr key={r.username}><td>{r.username}</td>{mode!=='watchtime'&&<td>{r.beforePoints} → {r.afterPoints}</td>}{mode!=='points'&&<td>{r.beforeWatchMinutes} → {r.afterWatchMinutes}</td>}</tr>)}</tbody></table></div>{preview.alreadyImported && <p>This file has already been imported.</p>}<p className="text-sm">Preview shows the first 50 viewers. All validated viewers are imported.</p><Button disabled={busy||preview.alreadyImported} onClick={()=>void request('apply')}>Import {mode==='watchtime'?'watchtime / other data':mode==='points'?'points':'points and watchtime'} into {preview.channel}</Button></section>}
    {status && <p role="status">{status}</p>}
  </CardContent></Card>;
}
