import * as fs from 'fs';
import * as path from 'path';
import { getAllCollections } from './pokemon-storage-discord';

const CARDS_DIR = path.join(process.cwd(), 'pokemon-tcg-data-master', 'cards', 'en');

const setCache = new Map<string, any[]>();
function getSetData(setCode: string): any[] {
  if (setCache.has(setCode)) return setCache.get(setCode)!;
  try {
    const data = JSON.parse(fs.readFileSync(path.join(CARDS_DIR, `${setCode}.json`), 'utf-8'));
    setCache.set(setCode, data);
    return data;
  } catch { return []; }
}

function enrichCard(card: any, index: number) {
  const setData = getSetData(card.setCode);
  const tcg = setData.find((c: any) => c.number === card.number);
  return {
    idx: index + 1,
    name: card.name,
    number: card.number,
    setCode: card.setCode,
    rarity: card.rarity || 'Common',
    imageUrl: tcg?.images?.large || card.imageUrl || `https://images.pokemontcg.io/${card.setCode}/${card.number}_hires.png`,
    hp: tcg?.hp || '',
    types: tcg?.types || [],
    supertype: tcg?.supertype || '',
    subtypes: tcg?.subtypes || [],
    evolvesFrom: tcg?.evolvesFrom || '',
    attacks: tcg?.attacks || [],
    abilities: tcg?.abilities || [],
    weaknesses: tcg?.weaknesses || [],
    resistances: tcg?.resistances || [],
    retreatCost: tcg?.retreatCost || [],
    flavorText: tcg?.flavorText || '',
    artist: tcg?.artist || '',
    seasonId: card.seasonId || '',
    openedAt: card.openedAt || '',
  };
}

export async function generatePokedexHtml(username: string, cards: any[], packsOpened: number): Promise<string> {
  const enriched = cards.map((c, i) => enrichCard(c, i));
  const rareCount = enriched.filter(c => c.rarity.includes('Rare')).length;
  const now = new Date().toISOString();

  // Load all other users' collections
  const allCollections = await getAllCollections();
  const otherUsers: Record<string, { cards: any[]; packsOpened: number }> = {};
  for (const [user, entry] of Object.entries(allCollections)) {
    if (user === username.toLowerCase()) continue;
    if (!entry.cards.length) continue;
    otherUsers[user] = {
      cards: entry.cards.map((c, i) => enrichCard(c, i)),
      packsOpened: entry.packsOpened || 0,
    };
  }

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${username}'s Pok\u00e9dex \u2014 ${cards.length} cards</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0f0f1a;color:#e0e0e0;font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh}
.header{background:linear-gradient(135deg,#1a1a3e,#2d1b4e);padding:16px 24px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:2px solid #ffd70044;position:sticky;top:0;z-index:100}
.header h1{font-size:22px;color:#ffd700;white-space:nowrap}
.header .stats{font-size:13px;opacity:.7}
.tabs{display:flex;gap:0;background:#12122a;border-bottom:1px solid #222;overflow-x:auto;position:sticky;top:60px;z-index:99}
.tab{padding:10px 20px;cursor:pointer;font-size:13px;border-bottom:2px solid transparent;white-space:nowrap;transition:all .2s}
.tab:hover{background:#1a1a3e}
.tab.active{border-bottom-color:#ffd700;color:#ffd700;background:#1a1a3e}
.tab .count{font-size:11px;opacity:.5;margin-left:4px}
.controls{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:10px 24px;background:#0f0f1a;border-bottom:1px solid #1a1a2e}
input,select,button{background:#1a1a3e;color:#e0e0e0;border:1px solid #333;border-radius:6px;padding:6px 10px;font-size:13px;outline:none}
input:focus,select:focus{border-color:#ffd700}
button{cursor:pointer;background:#2d1b4e;border-color:#ffd70066}
button:hover{background:#3d2b5e;border-color:#ffd700}
.toolbar{background:#1a1a2e;padding:10px 24px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #222;flex-wrap:wrap}
.toolbar .slots{display:flex;gap:6px}
.toolbar .slot{width:40px;height:56px;border-radius:6px;border:2px dashed #555;display:flex;align-items:center;justify-content:center;font-size:11px;color:#888;overflow:hidden;position:relative}
.toolbar .slot img{width:100%;height:100%;object-fit:cover;border-radius:4px}
.toolbar .slot .x{position:absolute;top:-2px;right:1px;font-size:10px;color:#f66;cursor:pointer;display:none}
.toolbar .slot:hover .x{display:block}
.toolbar .cmd{background:#111;border:1px solid #444;border-radius:6px;padding:6px 12px;font-family:monospace;font-size:13px;color:#ffd700;user-select:all;min-width:200px;max-width:500px;word-break:break-all}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;padding:14px 24px}
.card{background:#1a1a2e;border-radius:10px;overflow:hidden;cursor:pointer;transition:transform .2s,box-shadow .2s;border:2px solid transparent;position:relative}
.card:hover{transform:translateY(-3px);box-shadow:0 6px 20px rgba(0,0,0,.5)}
.card.selected{border-color:#ffd700;box-shadow:0 0 12px #ffd70044}
.card.trade-selected{border-color:#22d3ee;box-shadow:0 0 12px #22d3ee44}
.card.holo{border-color:#a855f766}
.card .idx{position:absolute;top:4px;left:6px;background:#000a;color:#ffd700;font-size:11px;padding:1px 5px;border-radius:4px;z-index:2}
.card .dupe{position:absolute;top:4px;right:6px;background:#e25822;color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px;z-index:2}
.card img{width:100%;aspect-ratio:5/7;object-fit:cover;display:block}
.card .info{padding:5px 7px}
.card .info .name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card .info .meta{font-size:10px;opacity:.6;margin-top:1px}
.card .actions{display:flex;gap:3px;padding:3px 5px 5px}
.card .actions button{font-size:10px;padding:2px 6px;flex:1;border-radius:4px}
.card.in-deck{border-color:#22c55e;box-shadow:0 0 12px #22c55e44}
.deck-bar{background:#0a1a0a;padding:10px 24px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #22c55e44;flex-wrap:wrap}
.deck-bar .energy-row{display:flex;gap:4px;align-items:center}
.deck-bar .energy-row .ebtn{width:28px;height:28px;border-radius:50%;border:2px solid #555;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff;cursor:pointer;position:relative}
.deck-bar .energy-row .ebtn:hover{border-color:#ffd700}
.deck-bar .energy-row .ecount{position:absolute;bottom:-6px;right:-4px;background:#22c55e;color:#000;font-size:9px;font-weight:700;padding:0 3px;border-radius:3px;min-width:14px;text-align:center}
.deck-bar .deck-total{font-size:18px;font-weight:700;color:#22c55e;min-width:60px;text-align:center}
.deck-bar .deck-total.full{color:#ef4444}
.deck-bar .deck-total.ready{color:#ffd700}
.detail-overlay{position:fixed;inset:0;background:#000c;z-index:200;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s}
.detail{display:flex;gap:32px;max-width:800px;padding:24px;animation:slideUp .3s}
.detail img{width:300px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.6)}
.detail .stats{max-width:360px}
.detail .stats h2{font-size:26px;color:#ffd700;margin-bottom:4px}
.detail .stats .sub{font-size:13px;opacity:.6;margin-bottom:14px}
.detail .stats .row{margin-bottom:7px;font-size:14px}
.detail .stats .atk{background:#1a1a3e;border-radius:8px;padding:7px 10px;margin-bottom:5px}
.detail .stats .atk .aname{font-weight:600;color:#60a5fa}
.detail .stats .atk .admg{float:right;color:#fbbf24}
.detail .stats .atk .acost{display:inline-flex;gap:2px;margin-right:6px;vertical-align:middle}
.detail .stats .atk .acost .energy{width:16px;height:16px;border-radius:50%;display:inline-block;font-size:9px;text-align:center;line-height:16px;font-weight:700;color:#fff}
.detail .stats .atk .adesc{font-size:11px;opacity:.6;margin-top:2px;clear:both}
.detail .stats .flavor{font-style:italic;font-size:12px;opacity:.5;margin-top:10px;border-top:1px solid #333;padding-top:8px}
.detail .stats .artist{font-size:11px;opacity:.4;margin-top:4px}
.detail .close{position:absolute;top:16px;right:24px;font-size:28px;color:#fff;cursor:pointer;opacity:.6}
.detail .close:hover{opacity:1}
.badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;margin-right:4px}
.empty{text-align:center;padding:60px;opacity:.5;font-size:18px}
.swap-arrow{font-size:28px;color:#ffd700;margin:0 8px}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
@keyframes holoSpin{0%{filter:blur(8px) hue-rotate(0deg)}100%{filter:blur(8px) hue-rotate(360deg)}}
@media(max-width:600px){.detail{flex-direction:column;align-items:center}.detail img{width:200px}.header{flex-direction:column;align-items:flex-start}}
</style></head><body>
<div class="header">
  <h1>\ud83c\udccf Pok\u00e9dex</h1>
  <span class="stats">Viewing ${username}'s collection \u00b7 Updated ${now.split('T')[0]}</span>
</div>
<div class="tabs" id="tabs"></div>
<div class="toolbar" id="toolbar"></div>
<div id="deckBar"></div>
<div class="controls" id="controlsBar"></div>
<div class="grid" id="grid"></div>
<div id="detailOverlay" class="detail-overlay" style="display:none" onclick="if(event.target===this)closeDetail()"></div>
<script>
const OWNER='${username.toLowerCase()}';
const ALL_USERS=${JSON.stringify({
    [username.toLowerCase()]: { cards: enriched, packsOpened, rareCount, deck: allCollections[username.toLowerCase()]?.deck || null },
    ...Object.fromEntries(Object.entries(otherUsers).map(([u, d]) => [u, {
      cards: d.cards,
      packsOpened: d.packsOpened,
      rareCount: d.cards.filter(c => c.rarity.includes('Rare')).length,
      deck: allCollections[u]?.deck || null,
    }]))
  })};
const TYPE_COLORS={Fire:'#e25822',Water:'#4a90d9',Grass:'#4caf50',Lightning:'#f5c542',Psychic:'#a855f7',Fighting:'#c0392b',Darkness:'#444',Metal:'#888',Dragon:'#7038f8',Fairy:'#ee99ac',Colorless:'#aaa'};

let currentUser=OWNER;
let filtered=[];
let gymTeam=[];
let mySwapCard=null;   // {user,idx,name,rarity}
let theirSwapCard=null;
let pickMode='gym'; // 'gym' or 'swap' or 'deck'
let deckCards=[];  // array of collection idx
const deckEnergy={Fire:0,Water:0,Grass:0,Lightning:0,Psychic:0,Fighting:0,Colorless:0};
const ENERGY_IMGS={Fire:'https://images.pokemontcg.io/base1/98.png',Water:'https://images.pokemontcg.io/base1/102.png',Grass:'https://images.pokemontcg.io/base1/99.png',Lightning:'https://images.pokemontcg.io/base1/100.png',Psychic:'https://images.pokemontcg.io/base1/101.png',Fighting:'https://images.pokemontcg.io/base1/97.png',Colorless:'https://images.pokemontcg.io/base1/96.png'};
const CURRENT_SEASON='season-1';
function deckTotal(){return deckCards.length+Object.values(deckEnergy).reduce((a,b)=>a+b,0)}
function getDeckCmd(){
  if(deckTotal()===0)return 'Add cards to build a deck';
  const d={cards:deckCards,energy:{}};
  for(const[t,n]of Object.entries(deckEnergy))if(n>0)d.energy[t]=n;
  return '!setdeck '+btoa(JSON.stringify(d));
}

// Build tabs
function buildTabs(){
  const t=document.getElementById('tabs');
  t.innerHTML='';
  for(const[u,d]of Object.entries(ALL_USERS)){
    const el=document.createElement('div');
    el.className='tab'+(u===currentUser?' active':'');
    el.innerHTML=(u===OWNER?'\ud83c\udfe0 ':'')+u+'<span class="count">'+d.cards.length+'</span>';
    el.onclick=()=>{currentUser=u;buildTabs();buildToolbar();buildControls();filterCards()};
    t.appendChild(el);
  }
}

function buildToolbar(){
  const tb=document.getElementById('toolbar');
  const hasOthers=Object.keys(ALL_USERS).length>1;
  if(currentUser===OWNER){
    let h='<div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;width:100%">';
    h+='<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;border:2px solid '+(pickMode==='gym'?'#ffd700':'transparent')+';cursor:pointer" onclick="pickMode=&apos;gym&apos;;buildToolbar();render()">';
    h+='<span style="font-size:13px;font-weight:600">\u2694\ufe0f Gym:</span>';
    h+='<div class="slots"><div class="slot" id="slot0">1</div><div class="slot" id="slot1">2</div><div class="slot" id="slot2">3</div></div>';
    h+='<div class="cmd" id="gymCmd">!gymteam</div>';
    h+='<button onclick="copyText(&apos;gymCmd&apos;);event.stopPropagation()">\ud83d\udccb</button>';
    h+='<button onclick="gymTeam=[];updateGymUI();filterCards();event.stopPropagation()" style="font-size:11px">\u2715</button>';
    h+='</div>';
    if(hasOthers){
      h+='<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;border:2px solid '+(pickMode==='swap'?'#22d3ee':'transparent')+';cursor:pointer" onclick="pickMode=&apos;swap&apos;;buildToolbar();render()">';
      h+='<span style="font-size:13px;font-weight:600">\ud83d\udd04 Swap:</span>';
      h+='<div class="slots">';
      h+='<div class="slot" id="swapMy" title="Your card" style="border-color:#ffd700">'+(mySwapCard?'<img src="'+mySwapCard.img+'">':'You')+'</div>';
      h+='<span class="swap-arrow">\u21c4</span>';
      h+='<div class="slot" id="swapTheir" title="Their card" style="border-color:#22d3ee">'+(theirSwapCard?'<img src="'+theirSwapCard.img+'">':'Them')+'</div>';
      h+='</div>';
      h+='<div class="cmd" id="swapCmd">'+getSwapCmd()+'</div>';
      h+='<button onclick="copyText(&apos;swapCmd&apos;);event.stopPropagation()">\ud83d\udccb</button>';
      h+='<button onclick="clearSwap();event.stopPropagation()" style="font-size:11px">\u2715</button>';
      h+='</div>';
    }
    h+='</div>';
    h+='<div style="display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;border:2px solid '+(pickMode==='deck'?'#22c55e':'transparent')+';cursor:pointer" onclick="pickMode=&apos;deck&apos;;buildToolbar();buildDeckBar();filterCards()">';
    h+='<span style="font-size:13px;font-weight:600">\ud83c\udccf Deck:</span>';
    h+='<span class="deck-total'+(deckTotal()===40?' ready':deckTotal()>40?' full':'')+'">'+deckTotal()+'/40</span>';
    h+='</div>';
    h+='</div>';
    tb.innerHTML=h;
    updateGymUI();
  } else {
    pickMode='swap';
    tb.innerHTML='<span style="font-size:13px;font-weight:600">\ud83d\udd04 Swap with '+currentUser+':</span>'+
      '<div class="slots">'+
        '<div class="slot" id="swapMy" title="Your card" style="border-color:#ffd700">'+(mySwapCard?'<img src="'+mySwapCard.img+'">':'You')+'</div>'+
        '<span class="swap-arrow">\u21c4</span>'+
        '<div class="slot" id="swapTheir" title="Their card" style="border-color:#22d3ee">'+(theirSwapCard?'<img src="'+theirSwapCard.img+'">':'Them')+'</div>'+
      '</div>'+
      '<div class="cmd" id="swapCmd">'+getSwapCmd()+'</div>'+
      '<button onclick="copyText(&apos;swapCmd&apos;)">\ud83d\udccb Copy</button>'+
      '<button onclick="clearSwap()" style="font-size:11px">\u2715 Clear</button>';
  }
}

function getSwapCmd(){
  if(mySwapCard&&theirSwapCard) return '!swap @'+theirSwapCard.user+' '+mySwapCard.idx+' for '+theirSwapCard.idx;
  if(mySwapCard&&!theirSwapCard) return 'Pick their card \u2192';
  if(!mySwapCard&&theirSwapCard) return '\u2190 Pick your card';
  return 'Select cards to swap';
}

function clearSwap(){mySwapCard=null;theirSwapCard=null;buildToolbar();filterCards()}

function buildDeckBar(){
  const db=document.getElementById('deckBar');
  if(pickMode!=='deck'||currentUser!==OWNER){db.innerHTML='';return}
  const bar=document.createElement('div');
  bar.className='deck-bar';
  let h='<span style="font-size:13px;font-weight:600;color:#22c55e">\u26a1 Energy (free):</span>';
  h+='<div class="energy-row">';
  for(const[type,img]of Object.entries(ENERGY_IMGS)){
    h+='<div class="ebtn" data-etype="'+type+'" style="background:'+energyBg(type)+'" title="'+type+'">'+type.charAt(0)+(deckEnergy[type]>0?'<span class="ecount">'+deckEnergy[type]+'</span>':'')+'</div>';
  }
  h+='</div>';
  h+='<span class="deck-total'+(deckTotal()===40?' ready':deckTotal()>40?' full':'')+'">'+deckTotal()+'/40</span>';
  h+='<div class="cmd" id="deckCmd" style="max-width:400px;font-size:11px">'+getDeckCmd()+'</div>';
  h+='<button id="deckCopyBtn">\ud83d\udccb</button>';
  h+='<button id="deckClearBtn" style="font-size:11px">\u2715</button>';
  bar.innerHTML=h;
  db.innerHTML='';
  db.appendChild(bar);
  bar.querySelectorAll('[data-etype]').forEach(el=>{
    el.addEventListener('click',e=>{
      if(deckTotal()>=40)return;
      deckEnergy[el.dataset.etype]++;
      buildDeckBar();buildToolbar();
    });
    el.addEventListener('contextmenu',e=>{
      e.preventDefault();
      if(deckEnergy[el.dataset.etype]>0){deckEnergy[el.dataset.etype]--;buildDeckBar();buildToolbar()}
    });
  });
  bar.querySelector('#deckCopyBtn').addEventListener('click',()=>{
    const cmd=getDeckCmd();
    if(cmd.startsWith('!'))navigator.clipboard.writeText(cmd).then(()=>{
      bar.querySelector('#deckCopyBtn').textContent='\u2705';setTimeout(()=>{if(bar.querySelector('#deckCopyBtn'))bar.querySelector('#deckCopyBtn').textContent='\ud83d\udccb'},1500);
    });
  });
  bar.querySelector('#deckClearBtn').addEventListener('click',()=>{
    deckCards=[];for(const k in deckEnergy)deckEnergy[k]=0;
    buildDeckBar();buildToolbar();render();
  });
}

function buildControls(){
  document.getElementById('controlsBar').innerHTML=
    '<input id="search" placeholder="Search..." oninput="filterCards()" style="width:160px">'+
    '<select id="sort" onchange="filterCards()"><option value="idx">#</option><option value="name">Name</option><option value="rarity">Rarity</option><option value="set">Set</option><option value="hp">HP</option><option value="date">Date</option></select>'+
    '<select id="typeFilter" onchange="filterCards()"><option value="">All Types</option></select>'+
    '<select id="rarityFilter" onchange="filterCards()"><option value="">All Rarities</option></select>'+
    '<label style="font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="pokemonOnly" onchange="filterCards()"> Pok\u00e9mon only</label>'+
    '<span style="font-size:13px;opacity:.6;margin-left:auto" id="userStats"></span>';
  // Populate filters from current user's cards
  const cards=ALL_USERS[currentUser]?.cards||[];
  const types=new Set(),rars=new Set();
  cards.forEach(c=>{c.types.forEach(t=>types.add(t));if(c.rarity)rars.add(c.rarity)});
  const tf=document.getElementById('typeFilter'),rf=document.getElementById('rarityFilter');
  [...types].sort().forEach(t=>{const o=document.createElement('option');o.value=t;o.textContent=t;tf.appendChild(o)});
  [...rars].sort().forEach(r=>{const o=document.createElement('option');o.value=r;o.textContent=r;rf.appendChild(o)});
  const d=ALL_USERS[currentUser];
  document.getElementById('userStats').textContent=d?d.cards.length+' cards \u00b7 '+d.rareCount+' rare \u00b7 '+d.packsOpened+' packs':'';
}

function filterCards(){
  const cards=ALL_USERS[currentUser]?.cards||[];
  const q=(document.getElementById('search')?.value||'').toLowerCase();
  const sort=(document.getElementById('sort')?.value)||'idx';
  const type=(document.getElementById('typeFilter')?.value)||'';
  const rar=(document.getElementById('rarityFilter')?.value)||'';
  const pokeOnly=document.getElementById('pokemonOnly')?.checked;
  filtered=cards.filter(c=>{
    if(q&&!c.name.toLowerCase().includes(q)&&!c.setCode.toLowerCase().includes(q))return false;
    if(type&&!c.types.includes(type))return false;
    if(rar&&c.rarity!==rar)return false;
    if(pokeOnly&&c.supertype!=='Pok\u00e9mon')return false;
    return true;
  });
  filtered.sort((a,b)=>{
    if(sort==='name')return a.name.localeCompare(b.name);
    if(sort==='rarity')return(b.rarity||'').localeCompare(a.rarity||'');
    if(sort==='set')return a.setCode.localeCompare(b.setCode)||parseInt(a.number)-parseInt(b.number);
    if(sort==='hp')return(parseInt(b.hp)||0)-(parseInt(a.hp)||0);
    if(sort==='date')return(b.openedAt||'').localeCompare(a.openedAt||'');
    return a.idx-b.idx;
  });
  render();
}

function getDupeCount(user,c){
  const cards=ALL_USERS[user]?.cards||[];
  return cards.filter(x=>x.setCode===c.setCode&&x.number===c.number).length;
}

function render(){
  const grid=document.getElementById('grid');
  if(!filtered.length){grid.innerHTML='<div class="empty">No cards found.</div>';return}
  grid.innerHTML='';
  filtered.forEach(c=>{
    const isHolo=c.rarity&&c.rarity.includes('Holo');
    const cardId=c.setCode+'-'+c.number;
    const inGym=currentUser===OWNER&&gymTeam.includes(cardId);
    const isMySwap=mySwapCard&&mySwapCard.user===currentUser&&mySwapCard.idx===c.idx;
    const isTheirSwap=theirSwapCard&&theirSwapCard.user===currentUser&&theirSwapCard.idx===c.idx;
    const div=document.createElement('div');
    div.className='card'+(isHolo?' holo':'')+(inGym||isMySwap?' selected':'')+(isTheirSwap?' trade-selected':'');
    const dupes=getDupeCount(currentUser,c);
    let inner='<span class="idx">#'+c.idx+'</span>'+(dupes>1?'<span class="dupe">x'+dupes+'</span>':'')+
      '<img src="'+c.imageUrl+'" alt="'+c.name+'" loading="lazy">'+
      '<div class="info"><div class="name">'+c.name+'</div><div class="meta">'+c.setCode+' #'+c.number+' \u00b7 '+c.rarity+'</div></div>';
    inner+='<div class="actions">';
    const inDeck=deckCards.includes(c.idx);
    const deckCount=deckCountOf(c.idx);
    if(inDeck)div.className+=' in-deck';
    if(currentUser===OWNER){
      if(c.supertype==='Pok\u00e9mon')inner+='<button data-gym="'+cardId+'">'+(inGym?'\u2715':'\u2694\ufe0f')+'</button>';
      inner+='<button data-swap-my="'+c.idx+'">\ud83d\udd04</button>';
      if(c.seasonId===CURRENT_SEASON)inner+='<button data-deck="'+c.idx+'" style="'+(inDeck?'background:#22c55e;color:#000':'')+'">\ud83c\udccf'+(deckCount>0?' x'+deckCount:'')+'</button>';
    } else {
      inner+='<button data-swap-their="'+c.idx+'">\ud83d\udd04</button>';
    }
    inner+='</div>';
    div.innerHTML=inner;
    div.querySelector('img').addEventListener('click',()=>showDetail(c.idx));
    const gymBtn=div.querySelector('[data-gym]');
    if(gymBtn)gymBtn.addEventListener('click',e=>{e.stopPropagation();toggleGym(cardId)});
    const myBtn=div.querySelector('[data-swap-my]');
    if(myBtn)myBtn.addEventListener('click',e=>{e.stopPropagation();pickMy(c)});
    const theirBtn=div.querySelector('[data-swap-their]');
    if(theirBtn)theirBtn.addEventListener('click',e=>{e.stopPropagation();pickTheir(c)});
    const deckBtn=div.querySelector('[data-deck]');
    if(deckBtn){
      deckBtn.addEventListener('click',e=>{e.stopPropagation();toggleDeck(c.idx)});
      deckBtn.addEventListener('contextmenu',e=>{e.preventDefault();e.stopPropagation();removeDeck(c.idx)});
    }
    grid.appendChild(div);
  });
}

function toggleGym(cardId){
  const i=gymTeam.indexOf(cardId);
  if(i>=0)gymTeam.splice(i,1);
  else if(gymTeam.length<3)gymTeam.push(cardId);
  updateGymUI();render();
}
function pickMy(c){
  if(mySwapCard&&mySwapCard.idx===c.idx)mySwapCard=null;
  else mySwapCard={user:OWNER,idx:c.idx,name:c.name,rarity:c.rarity,img:c.imageUrl};
  pickMode='swap';buildToolbar();render();
}
function pickTheir(c){
  if(theirSwapCard&&theirSwapCard.idx===c.idx)theirSwapCard=null;
  else theirSwapCard={user:currentUser,idx:c.idx,name:c.name,rarity:c.rarity,img:c.imageUrl};
  buildToolbar();render();
}
function deckCountOf(idx){return deckCards.filter(x=>x===idx).length}
function toggleDeck(idx){
  const count=deckCountOf(idx);
  if(count>=4){deckCards=deckCards.filter(x=>x!==idx)}
  else{if(deckTotal()>=40)return;deckCards.push(idx)}
  pickMode='deck';buildToolbar();buildDeckBar();render();
}
function removeDeck(idx){
  const i=deckCards.indexOf(idx);
  if(i>=0)deckCards.splice(i,1);
  buildToolbar();buildDeckBar();render();
}

function updateGymUI(){
  for(let i=0;i<3;i++){
    const slot=document.getElementById('slot'+i);
    if(!slot)return;
    if(gymTeam[i]){const c=ALL_USERS[OWNER].cards.find(x=>x.setCode+'-'+x.number===gymTeam[i]);slot.innerHTML=c?'<img src="'+c.imageUrl+'" title="'+c.name+'">':''+(i+1)}
    else slot.innerHTML=''+(i+1);
  }
  const cmd=document.getElementById('gymCmd');
  if(cmd)cmd.textContent=gymTeam.length===3?'!gymteam '+gymTeam.join(' '):'!gymteam \u2014 click 3 Pok\u00e9mon';
}

function copyText(id){
  const el=document.getElementById(id);
  if(!el)return;
  const text=el.textContent;
  if(text.includes('\u2014')||text.includes('\u2192'))return;
  navigator.clipboard.writeText(text).then(()=>{
    const btn=el.nextElementSibling;
    if(btn){btn.textContent='\u2705 Copied!';setTimeout(()=>btn.textContent='\ud83d\udccb Copy',1500)}
  });
}

function energyBg(t){return TYPE_COLORS[t]||'#555'}

function showDetail(idx){
  const c=(ALL_USERS[currentUser]?.cards||[]).find(x=>x.idx===idx);
  if(!c)return;
  const isHolo=c.rarity&&c.rarity.includes('Holo');
  const dupes=getDupeCount(currentUser,c);
  const ov=document.getElementById('detailOverlay');
  ov.style.display='flex';
  let h='<div class="detail" style="position:relative">'+
    '<span class="close" onclick="closeDetail()">\u2715</span>'+
    '<div style="position:relative">'+(isHolo?'<div style="position:absolute;inset:-4px;border-radius:16px;background:linear-gradient(135deg,#ffd700,#ff6b6b,#a855f7,#3b82f6,#ffd700);opacity:.6;animation:holoSpin 3s linear infinite;filter:blur(8px)"></div>':'')+
    '<img src="'+c.imageUrl+'" style="position:relative;z-index:1" onerror="this.src=\\'https://images.pokemontcg.io/'+c.setCode+'/'+c.number+'.png\\'"></div>'+
    '<div class="stats"><h2>'+c.name+(c.hp?' <span style="font-size:16px;color:#ef4444">HP '+c.hp+'</span>':'')+'</h2>'+
    '<div class="sub">#'+c.idx+' \u00b7 '+c.rarity+' \u00b7 '+c.setCode+' #'+c.number+(c.subtypes&&c.subtypes.length?' \u00b7 '+c.subtypes.join(', '):'')+(dupes>1?' \u00b7 <span style="color:#e25822;font-weight:600">Owned: x'+dupes+'</span>':'')+(c.openedAt?' \u00b7 Opened '+c.openedAt.split('T')[0]:'')+'</div>';
  if(c.types.length)h+='<div class="row">'+c.types.map(t=>'<span class="badge" style="background:'+energyBg(t)+'">'+t+'</span>').join('')+(c.evolvesFrom?' <span style="font-size:12px;opacity:.6">Evolves from '+c.evolvesFrom+'</span>':'')+'</div>';
  if(c.abilities&&c.abilities.length)h+=c.abilities.map(a=>'<div class="atk"><div class="aname" style="color:#a855f7">\u2726 '+a.name+(a.type?' <span style="font-size:10px;opacity:.5">['+a.type+']</span>':'')+'</div><div class="adesc">'+(a.text||'')+'</div></div>').join('');
  if(c.attacks.length)h+='<div style="margin-top:8px;font-weight:600;font-size:12px;opacity:.6">ATTACKS</div>'+c.attacks.map(a=>{
    const cost=a.cost?a.cost.map(t=>'<span class="energy" style="background:'+energyBg(t)+'">'+t.charAt(0)+'</span>').join(''):'';  
    return '<div class="atk">'+(cost?'<span class="acost">'+cost+'</span>':'')+'<span class="aname">'+a.name+'</span><span class="admg">'+(a.damage||'\u2014')+'</span><div class="adesc">'+(a.text||'')+'</div></div>';
  }).join('');
  if(c.weaknesses&&c.weaknesses.length)h+='<div class="row">\ud83d\udd3b Weak: '+c.weaknesses.map(w=>'<span class="badge" style="background:'+energyBg(w.type)+'">'+w.type+' '+w.value+'</span>').join(' ')+'</div>';
  if(c.resistances&&c.resistances.length)h+='<div class="row">\ud83d\udee1\ufe0f Resist: '+c.resistances.map(r=>'<span class="badge" style="background:'+energyBg(r.type)+'">'+r.type+' '+r.value+'</span>').join(' ')+'</div>';
  if(c.retreatCost&&c.retreatCost.length)h+='<div class="row">\ud83c\udfc3 Retreat: '+c.retreatCost.map(t=>'<span class="energy" style="background:'+energyBg(t)+';width:16px;height:16px;border-radius:50%;display:inline-block;font-size:9px;text-align:center;line-height:16px;font-weight:700;color:#fff">'+t.charAt(0)+'</span>').join('')+'</div>';
  if(c.flavorText)h+='<div class="flavor">'+c.flavorText+'</div>';
  if(c.artist)h+='<div class="artist">\ud83c\udfa8 '+c.artist+'</div>';
  h+='</div></div>';
  ov.innerHTML=h;
}

function closeDetail(){document.getElementById('detailOverlay').style.display='none'}
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeDetail()});

buildTabs();buildToolbar();
// Load saved deck if present
const savedDeck=ALL_USERS[OWNER]?.deck;
if(savedDeck){deckCards=savedDeck.cards||[];for(const[t,n]of Object.entries(savedDeck.energy||{}))if(deckEnergy[t]!==undefined)deckEnergy[t]=n}
buildDeckBar();buildControls();filterCards();
<\/script>
</body></html>`;
}
