// scripts/eevee-pokedex.js
// Scans all TCG set data for Eevee + evolutions, generates an HTML checklist.
// Usage: node scripts/eevee-pokedex.js
// Output: eevee-pokedex.html (open in any browser)

const fs = require('fs');
const path = require('path');

const CARDS_DIR = path.join(__dirname, '..', 'pokemon-tcg-data-master', 'cards', 'en');
const OUT_FILE = path.join(__dirname, '..', 'public', 'eevee-pokedex.html');

const EEVEE_DEX = new Set([133, 134, 135, 136, 196, 197, 470, 471, 700]);
const EEVEE_FAMILY = ['Eevee','Vaporeon','Jolteon','Flareon','Espeon','Umbreon','Leafeon','Glaceon','Sylveon'];
const DEX_TO_NAME = {133:'Eevee',134:'Vaporeon',135:'Jolteon',136:'Flareon',196:'Espeon',197:'Umbreon',470:'Leafeon',471:'Glaceon',700:'Sylveon'};

function getFamily(card) {
  // Match by dex number first (most reliable)
  for (const n of (card.nationalPokedexNumbers || [])) {
    if (DEX_TO_NAME[n]) return DEX_TO_NAME[n];
  }
  // Fallback: check if any family name appears in the card name
  const lower = (card.name || '').toLowerCase();
  for (const name of EEVEE_FAMILY) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  return null;
}

const results = [];
const setFiles = fs.readdirSync(CARDS_DIR).filter(f => f.endsWith('.json'));

for (const file of setFiles) {
  const setCode = file.replace('.json', '');
  const cards = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, file), 'utf-8'));
  for (const card of cards) {
    const family = getFamily(card);
    if (!family) continue;
    results.push({
      id: card.id,
      name: card.name,
      family,
      set: setCode,
      number: card.number,
      rarity: card.rarity || 'Unknown',
      types: (card.types || []).join('/'),
      artist: card.artist || '',
      img: card.images?.small || `https://images.pokemontcg.io/${setCode}/${card.number}.png`,
      imgLarge: card.images?.large || `https://images.pokemontcg.io/${setCode}/${card.number}_hires.png`,
      dex: (card.nationalPokedexNumbers || [])[0] || 0,
    });
  }
}

results.sort((a, b) => a.dex - b.dex || a.set.localeCompare(b.set) || parseInt(a.number) - parseInt(b.number));

const summary = {};
for (const r of results) {
  summary[r.family] = (summary[r.family] || 0) + 1;
}

const POKEMON_COLORS = {
  Eevee:'#c6a96c',Vaporeon:'#4a90d9',Jolteon:'#f5c542',Flareon:'#e25822',
  Espeon:'#a855f7',Umbreon:'#444',Leafeon:'#4caf50',Glaceon:'#7dd3fc',Sylveon:'#ee99ac'
};

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eevee Family Pok\u00e9dex \u2014 Complete TCG Checklist</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#1a1a2e;color:#eee;padding:20px}
h1{text-align:center;font-size:28px;margin-bottom:4px}
.subtitle{text-align:center;color:#888;margin-bottom:20px;font-size:14px}
.stats{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:20px}
.stat{padding:6px 14px;border-radius:20px;font-size:13px;font-weight:600;cursor:pointer;border:2px solid transparent;transition:all .2s}
.stat:hover{transform:scale(1.05)}
.stat.active{border-color:#fff}
.controls{display:flex;gap:12px;justify-content:center;margin-bottom:20px;flex-wrap:wrap}
.controls input{padding:8px 16px;border-radius:8px;border:1px solid #444;background:#2a2a3e;color:#eee;font-size:14px;width:250px}
.controls select{padding:8px 12px;border-radius:8px;border:1px solid #444;background:#2a2a3e;color:#eee;font-size:14px}
.count-bar{text-align:center;margin-bottom:16px;font-size:18px;font-weight:600}
.count-bar span{color:#ffd700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;max-width:1400px;margin:0 auto}
.card{background:#2a2a3e;border-radius:10px;overflow:hidden;cursor:pointer;transition:all .2s;position:relative;border:2px solid transparent}
.card:hover{transform:translateY(-2px);box-shadow:0 4px 16px rgba(0,0,0,.4)}
.card.owned{border-color:#4caf50;background:#1a3a1a}
.card.owned::after{content:'\\2713';position:absolute;top:6px;right:8px;font-size:20px;color:#4caf50;font-weight:bold}
.card img{width:100%;display:block}
.card .info{padding:8px;font-size:11px}
.card .info .name{font-weight:700;font-size:13px;margin-bottom:2px}
.card .info .meta{color:#888}
.owned-count{position:absolute;top:6px;left:8px;background:#4caf50;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:10px;display:none}
.card.owned .owned-count{display:block}
.export-bar{text-align:center;margin:24px 0}
.export-bar button{padding:10px 24px;border-radius:8px;border:none;background:#4a90d9;color:#fff;font-size:14px;font-weight:600;cursor:pointer;margin:0 6px}
.export-bar button:hover{background:#3a7bc8}
.detail{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100;align-items:center;justify-content:center}
.detail.open{display:flex}
.detail img{max-height:80vh;border-radius:12px}
.detail .close{position:absolute;top:20px;right:30px;font-size:32px;color:#fff;cursor:pointer}
</style></head><body>
<h1>\u2728 Eevee Family TCG Checklist \u2728</h1>
<p class="subtitle">${results.length} cards across all sets \u2014 click a card to mark it as owned</p>
<div class="stats" id="stats"></div>
<div class="controls">
<input type="text" id="search" placeholder="Search by name, set, or artist...">
<select id="sort"><option value="dex">Pok\u00e9mon</option><option value="set">Set</option><option value="rarity">Rarity</option><option value="name">Name</option></select>
<select id="filter"><option value="">All Pok\u00e9mon</option></select>
</div>
<div class="count-bar">Owned: <span id="ownedCount">0</span> / <span>${results.length}</span></div>
<div class="grid" id="grid"></div>
<div class="export-bar">
<button onclick="exportList()">Export Owned List</button>
<button onclick="clearAll()">Clear All</button>
</div>
<div class="detail" id="detail" onclick="this.classList.remove('open')">
<span class="close">&times;</span>
<img id="detailImg" src="">
</div>
<script>
const ALL=${JSON.stringify(results)};
const COLORS=${JSON.stringify(POKEMON_COLORS)};
let owned=JSON.parse(localStorage.getItem('eevee_owned')||'{}');
let activeFilter='';

function save(){localStorage.setItem('eevee_owned',JSON.stringify(owned))}

function buildStats(){
  const s=document.getElementById('stats');
  const summary={};
  ALL.forEach(c=>{const p=c.family;summary[p]=(summary[p]||0)+1});
  let h='<div class="stat'+(activeFilter===''?' active':'')+'" style="background:#555" onclick="setFilter(\\'\\')">All ('+ALL.length+')</div>';
  for(const[name,count]of Object.entries(summary)){
    const ownedN=ALL.filter(c=>c.family===name&&owned[c.id]).length;
    const col=COLORS[name]||'#666';
    h+='<div class="stat'+(activeFilter===name?' active':'')+'" style="background:'+col+'" onclick="setFilter(\\''+name+'\\')">'+name+' '+ownedN+'/'+count+'</div>';
  }
  s.innerHTML=h;
  // filter dropdown
  const f=document.getElementById('filter');
  f.innerHTML='<option value="">All Pok\\u00e9mon</option>';
  for(const name of Object.keys(summary)){
    const o=document.createElement('option');o.value=name;o.textContent=name;
    if(name===activeFilter)o.selected=true;
    f.appendChild(o);
  }
}

function setFilter(name){activeFilter=name;document.getElementById('filter').value=name;buildStats();render()}

function render(){
  const q=(document.getElementById('search').value||'').toLowerCase();
  const sort=document.getElementById('sort').value;
  let cards=[...ALL];
  if(activeFilter)cards=cards.filter(c=>c.family===activeFilter);
  if(q)cards=cards.filter(c=>(c.name+' '+c.set+' '+c.artist+' '+c.rarity).toLowerCase().includes(q));
  if(sort==='set')cards.sort((a,b)=>a.set.localeCompare(b.set)||parseInt(a.number)-parseInt(b.number));
  else if(sort==='rarity')cards.sort((a,b)=>a.rarity.localeCompare(b.rarity)||a.name.localeCompare(b.name));
  else if(sort==='name')cards.sort((a,b)=>a.name.localeCompare(b.name));
  const g=document.getElementById('grid');
  g.innerHTML='';
  cards.forEach(c=>{
    const d=document.createElement('div');
    d.className='card'+(owned[c.id]?' owned':'');
    const cnt=owned[c.id]||0;
    d.innerHTML='<div class="owned-count">x'+cnt+'</div><img src="'+c.img+'" alt="'+c.name+'" loading="lazy"><div class="info"><div class="name">'+c.name+'</div><div class="meta">'+c.set+' #'+c.number+' \\u00b7 '+c.rarity+'</div></div>';
    d.addEventListener('click',e=>{
      if(e.shiftKey){document.getElementById('detailImg').src=c.imgLarge;document.getElementById('detail').classList.add('open');return}
      owned[c.id]=(owned[c.id]||0)+1;save();buildStats();render();
    });
    d.addEventListener('contextmenu',e=>{
      e.preventDefault();
      if(owned[c.id]>1)owned[c.id]--;
      else delete owned[c.id];
      save();buildStats();render();
    });
    g.appendChild(d);
  });
  document.getElementById('ownedCount').textContent=Object.values(owned).reduce((a,b)=>a+b,0);
}

function exportList(){
  const lines=['Eevee Family - Owned Cards',''];
  ALL.filter(c=>owned[c.id]).forEach(c=>{
    lines.push(c.name+' ('+c.set+' #'+c.number+') x'+(owned[c.id]||1)+' - '+c.rarity);
  });
  lines.push('','Total: '+Object.values(owned).reduce((a,b)=>a+b,0)+' cards');
  const blob=new Blob([lines.join('\\n')],{type:'text/plain'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='eevee-owned.txt';a.click();
}

function clearAll(){if(confirm('Clear all owned marks?')){owned={};save();buildStats();render()}}

document.getElementById('search').addEventListener('input',render);
document.getElementById('sort').addEventListener('change',render);
document.getElementById('filter').addEventListener('change',e=>{activeFilter=e.target.value;buildStats();render()});
buildStats();render();
</script></body></html>`;

fs.writeFileSync(OUT_FILE, html);
console.log(`\nEevee Pokedex written to: ${OUT_FILE}`);
console.log(`Total cards found: ${results.length}\n`);
console.log('Breakdown:');
for (const [name, count] of Object.entries(summary)) {
  console.log(`  ${name}: ${count}`);
}
console.log(`\nOpen eevee-pokedex.html in any browser.`);
console.log(`Click a card to mark owned (right-click to remove).`);
console.log(`Shift+click for full-size image.`);
