// Manual sync script - run with: npx tsx scripts/sync-masterstats.ts
import fs from 'fs';
import path from 'path';

type MasterStatsEntry = {
  Points?: number;
  Watchtime?: number;
  Deaths?: number;
  JoinDate?: string;
  Visits?: number;
  LastSeen?: string;
  TotalCards?: number;
  RareCards?: number;
  Badges?: string[];
};

const MASTER_STATS_FILE = path.join(process.cwd(), 'MasterStats', 'allUsers.json');
const STREAMWEAVER_STATS = path.join(process.cwd(), 'data', 'user-stats.json');

console.log('[Sync] Starting MasterStats import...');

if (!fs.existsSync(MASTER_STATS_FILE)) {
  console.error('[Sync] ❌ MasterStats/allUsers.json not found!');
  console.log('[Sync] Expected at:', MASTER_STATS_FILE);
  process.exit(1);
}

const masterData = JSON.parse(fs.readFileSync(MASTER_STATS_FILE, 'utf-8')) as Record<string, MasterStatsEntry>;
const streamweaverData: any = {};

let imported = 0;

for (const [username, masterUser] of Object.entries(masterData)) {
  const user = username.toLowerCase();
  
  streamweaverData[user] = {
    user,
    points: masterUser.Points || 0,
    watchtime: masterUser.Watchtime || 0,
    deaths: masterUser.Deaths || 0,
    joinDate: masterUser.JoinDate || new Date().toISOString(),
    visits: masterUser.Visits || 1,
    lastSeen: masterUser.LastSeen || new Date().toISOString(),
    totalCards: masterUser.TotalCards || 0,
    rareCards: masterUser.RareCards || 0,
    badges: masterUser.Badges || [],
    cardCollection: []
  };
  imported++;
}

fs.mkdirSync(path.dirname(STREAMWEAVER_STATS), { recursive: true });
fs.writeFileSync(STREAMWEAVER_STATS, JSON.stringify(streamweaverData, null, 2));

console.log(`[Sync] ✅ Imported ${imported} users from MasterStats`);
console.log(`[Sync] Data saved to: ${STREAMWEAVER_STATS}`);
