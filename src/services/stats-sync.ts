import fs from 'fs';
import path from 'path';

const MASTER_STATS_DIR = path.join(process.cwd(), 'MasterStats');
const ALL_USERS_JSON = path.join(MASTER_STATS_DIR, 'allUsers.json');
const STREAMWEAVER_STATS = path.join(process.cwd(), 'data', 'user-stats.json');

interface MasterUserStats {
  User: string;
  Points: number;
  Watchtime: number;
  Deaths: number;
  JoinDate: string;
  Visits: number;
  LastSeen: string;
  TotalCards: number;
  RareCards: number;
  Badges: string[];
}

interface StreamWeaverUserStats extends MasterUserStats {
  user: string;
  points: number;
  watchtime: number;
  deaths: number;
  joinDate: string;
  visits: number;
  lastSeen: string;
  totalCards: number;
  rareCards: number;
  badges: string[];
  cardCollection: string[];
}

export function syncFromMasterStats() {
  if (!fs.existsSync(ALL_USERS_JSON)) {
    console.log('[Sync] MasterStats/allUsers.json not found, skipping sync');
    return;
  }

  const masterData: Record<string, MasterUserStats> = JSON.parse(fs.readFileSync(ALL_USERS_JSON, 'utf-8'));
  
  let streamweaverData: Record<string, StreamWeaverUserStats> = {};
  if (fs.existsSync(STREAMWEAVER_STATS)) {
    streamweaverData = JSON.parse(fs.readFileSync(STREAMWEAVER_STATS, 'utf-8'));
  }

  let imported = 0;
  let updated = 0;

  for (const [username, masterUser] of Object.entries(masterData)) {
    const user = username.toLowerCase();
    
    if (!streamweaverData[user]) {
      // New user - import from master
      streamweaverData[user] = {
        user,
        points: masterUser.Points,
        watchtime: masterUser.Watchtime,
        deaths: masterUser.Deaths,
        joinDate: masterUser.JoinDate,
        visits: masterUser.Visits,
        lastSeen: masterUser.LastSeen,
        totalCards: masterUser.TotalCards,
        rareCards: masterUser.RareCards,
        badges: masterUser.Badges || [],
        cardCollection: [],
        // Duplicate for compatibility
        User: user,
        Points: masterUser.Points,
        Watchtime: masterUser.Watchtime,
        Deaths: masterUser.Deaths,
        JoinDate: masterUser.JoinDate,
        Visits: masterUser.Visits,
        LastSeen: masterUser.LastSeen,
        TotalCards: masterUser.TotalCards,
        RareCards: masterUser.RareCards,
        Badges: masterUser.Badges || []
      };
      imported++;
    } else {
      // Existing user - update points/watchtime from master, keep cards from StreamWeaver
      streamweaverData[user].points = masterUser.Points;
      streamweaverData[user].deaths = masterUser.Deaths;
      streamweaverData[user].lastSeen = masterUser.LastSeen;
      
      // Merge gym badges from master (union of both sets)
      const localBadges = streamweaverData[user].badges || [];
      const masterBadges = masterUser.Badges || [];
      const merged = [...new Set([...localBadges, ...masterBadges])];
      streamweaverData[user].badges = merged;
      
      // Update duplicate fields
      streamweaverData[user].Points = masterUser.Points;
      streamweaverData[user].Deaths = masterUser.Deaths;
      streamweaverData[user].LastSeen = masterUser.LastSeen;
      streamweaverData[user].Badges = merged;
      
      updated++;
    }
  }

  fs.mkdirSync(path.dirname(STREAMWEAVER_STATS), { recursive: true });
  fs.writeFileSync(STREAMWEAVER_STATS, JSON.stringify(streamweaverData, null, 2));
  
  console.log(`[Sync] ✅ Imported ${imported} new users, updated ${updated} existing users`);
  return { imported, updated, total: Object.keys(streamweaverData).length };
}

export function syncToMasterStats() {
  const streamweaverData: Record<string, StreamWeaverUserStats> = JSON.parse(
    fs.readFileSync(STREAMWEAVER_STATS, 'utf-8')
  );

  const masterData: Record<string, MasterUserStats> = {};

  for (const [username, user] of Object.entries(streamweaverData)) {
    masterData[username] = {
      User: user.user,
      Points: user.points,
      Watchtime: user.watchtime,
      Deaths: user.deaths,
      JoinDate: user.joinDate,
      Visits: user.visits,
      LastSeen: user.lastSeen,
      TotalCards: user.totalCards,
      RareCards: user.rareCards,
      Badges: user.badges
    };
  }

  fs.mkdirSync(MASTER_STATS_DIR, { recursive: true });
  fs.writeFileSync(ALL_USERS_JSON, JSON.stringify(masterData, null, 2));
  
  console.log(`[Sync] ✅ Synced ${Object.keys(masterData).length} users to MasterStats`);
}

// Run sync on import
if (require.main === module) {
  console.log('[Sync] Running manual sync...');
  syncFromMasterStats();
}
