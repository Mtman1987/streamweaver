import { addPoints, getPoints, setPoints, getLeaderboard } from '@/services/points';

export async function handlePointsCommands(event: any) {
  const { message, user, platform } = event;
  const args = message.split(' ').slice(1);
  
  try {
    if (message.startsWith('!points')) {
      const target = args[0] ? args[0].replace('@', '') : user;
      const userPoints = await getPoints(target);
      return `${target} has ${userPoints.points.toLocaleString()} points (Level ${userPoints.level})`;
    }
    
    if (message.startsWith('!addpoints') && args.length >= 2) {
      const target = args[0].replace('@', '');
      const amount = parseInt(args[1]);
      if (isNaN(amount)) return 'Invalid amount';
      
      const result = await addPoints(target, amount, 'manual add');
      return `Added ${amount} points to ${target}. They now have ${result.points.toLocaleString()} points`;
    }
    
    if (message.startsWith('!setpoints') && args.length >= 2) {
      const target = args[0].replace('@', '');
      const amount = parseInt(args[1]);
      if (isNaN(amount)) return 'Invalid amount';
      
      const result = await setPoints(target, amount);
      return `Set ${target}'s points to ${result.points.toLocaleString()} points`;
    }
    
    if (message.startsWith('!leaderboard') || message.startsWith('!leader')) {
      const limit = args[0] ? Math.min(parseInt(args[0]) || 5, 10) : 5;
      const leaderboard = await getLeaderboard(limit);
      
      if (leaderboard.length === 0) return 'No users found on leaderboard';
      
      const entries = leaderboard.map((entry, i) => 
        `${i + 1}. ${entry.user} (${entry.points.toLocaleString()})`
      ).join(' • ');
      
      return `Top ${limit}: ${entries}`;
    }
    
  } catch (error) {
    console.error('[Points Commands] Error:', error);
    return 'Error processing points command';
  }
  
  return null;
}