import { NextRequest, NextResponse } from 'next/server';
import { getBicData, getVictimList } from '@/services/bic-storage';

export async function GET(request: NextRequest) {
  const format = request.nextUrl.searchParams.get('format');
  const data = getBicData();
  const victims = getVictimList();

  if (format === 'txt') {
    const lines = [`Bic Lighter Victim List — ${data.total} total stolen`, ''];
    victims.forEach((v, i) => lines.push(`${i + 1}. ${v.name}: ${v.count} lighters`));
    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="bic-victims.txt"',
      },
    });
  }

  const rows = victims.map((v, i) => {
    const pct = data.total > 0 ? ((v.count / data.total) * 100).toFixed(1) : '0';
    return `<tr><td>${i + 1}</td><td>${v.name}</td><td>${v.count}</td><td><div class="bar" style="width:${pct}%"></div>${pct}%</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🔥 Bic Lighter Victim List</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f1a;color:#e0e0e0;font-family:'Segoe UI',system-ui,sans-serif;padding:24px}
h1{color:#ffd700;margin-bottom:4px;font-size:24px}
.sub{opacity:.6;margin-bottom:20px;font-size:14px}
table{width:100%;border-collapse:collapse;max-width:700px}
th{text-align:left;padding:8px 12px;border-bottom:2px solid #ffd70044;color:#ffd700;font-size:13px}
td{padding:8px 12px;border-bottom:1px solid #1a1a2e;font-size:14px}
tr:hover{background:#1a1a3e}
.bar{height:14px;background:linear-gradient(90deg,#e25822,#ffd700);border-radius:3px;display:inline-block;min-width:2px;margin-right:6px;vertical-align:middle}
a{color:#60a5fa;text-decoration:none}
a:hover{text-decoration:underline}
.dl{margin-top:16px;font-size:13px}
</style></head><body>
<h1>🔥 Bic Lighter Victim List</h1>
<p class="sub">${data.total} lighters stolen from ${victims.length} victims — Updated ${new Date().toISOString().split('T')[0]}</p>
<table><thead><tr><th>#</th><th>Victim</th><th>Stolen</th><th>Share</th></tr></thead><tbody>${rows || '<tr><td colspan="4" style="text-align:center;opacity:.5;padding:40px">No lighters stolen yet!</td></tr>'}</tbody></table>
<p class="dl"><a href="?format=txt">📥 Download as .txt</a></p>
</body></html>`;

  return new NextResponse(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
