'use client';
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export default function LoyaltyImportPage() {
  const [text,setText] = useState(''), [name,setName] = useState(''), [unit,setUnit] = useState('minutes'), [preview,setPreview] = useState<any>(null), [busy,setBusy] = useState(false), [status,setStatus] = useState('');
  const request = async (action: string) => {
    setBusy(true); setStatus('');
    try {
      const response = await fetch('/api/import/loyalty',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,text,unit,digest:preview?.digest})});
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Import failed.');
      if (action === 'preview') setPreview(data);
      else { setStatus(data.alreadyImported ? 'This file was already imported. No totals were changed.' : 'Imported ' + data.imported + ' viewers into ' + data.channel + '. Your existing higher totals were kept.'); setPreview(null); }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Card><CardHeader><CardTitle>Import StreamElements Loyalty</CardTitle><p>Bring your channel’s watchtime and loyalty points into StreamWeaver.</p></CardHeader><CardContent className="space-y-5">
    <p>Upload a CSV or JSON export containing Twitch usernames and points, watchtime, or both. Maximum 2 MB / 10,000 viewers.</p>
    <p className="text-sm text-muted-foreground">CSV columns: username, points, watchtime. Separate points and watchtime files are supported. Select the unit used by your watchtime export; StreamWeaver stores whole minutes.</p>
    <label className="block">Export file<input className="block mt-2" type="file" accept=".csv,.json,text/csv,application/json" disabled={busy} onChange={async e=>{setPreview(null);setStatus('');setText('');const file=e.target.files?.[0];if(!file)return;if(file.size>2_000_000){setStatus('Choose a file smaller than 2 MB.');return;}setName(file.name);setText(await file.text());}} /></label>
    <label className="block">Watchtime unit<select className="block mt-2 rounded border bg-background p-2" value={unit} disabled={busy} onChange={e=>{setUnit(e.target.value);setPreview(null);}}><option value="minutes">Minutes</option><option value="seconds">Seconds</option><option value="hours">Hours</option></select></label>
    <p className="text-sm">Import keeps the higher total for each viewer. It does not add the same balance twice, reduce existing totals, or change Nebula/SPMT XP. A backup is saved before applying.</p>
    <Button disabled={!text||busy} onClick={()=>void request('preview')}>{busy?'Working…':'Preview import'}</Button>
    {preview && <section className="space-y-3"><p><strong>{preview.channel}</strong>: {preview.viewers} viewers in {name}; {preview.changed} would change.</p><div className="overflow-auto"><table className="w-full text-sm"><thead><tr><th>Viewer</th><th>Points before → after</th><th>Minutes before → after</th></tr></thead><tbody>{preview.sample.map((r:any)=><tr key={r.username}><td>{r.username}</td><td>{r.beforePoints} → {r.afterPoints}</td><td>{r.beforeWatchMinutes} → {r.afterWatchMinutes}</td></tr>)}</tbody></table></div>{preview.alreadyImported && <p>This file has already been imported.</p>}<p className="text-sm">Preview shows the first 50 viewers. All validated viewers are imported.</p><Button disabled={busy||preview.alreadyImported} onClick={()=>void request('apply')}>Import into {preview.channel}</Button></section>}
    {status && <p role="status">{status}</p>}
  </CardContent></Card>;
}
