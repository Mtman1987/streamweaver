# StreamWeaver Plugin System

## What is StreamWeaver?

StreamWeaver is a **blank canvas bot framework** - you get the core infrastructure, then build everything else yourself.

### What You Get Out of the Box:
- **Points System** - Track and manage viewer currency
- **Leaderboard** - Rank viewers by points, watchtime, etc.
- **AI/Voice Commander** - Voice-controlled AI assistant
- **Platform Integrations** - Twitch, Discord, OBS connectivity
- **Building Tools** - Actions page, Commands page, API endpoints

### What You Build:
- **Everything else!** Custom commands, automations, games, overlays, chat interactions

Think of it like Streamer.bot - you start with a powerful engine, then create your own workflows. The difference? StreamWeaver lets you **package and share** your creations as plugins.

## The Plugin Philosophy

StreamWeaver works within clear boundaries:
- ✅ Use the built-in points system
- ✅ Use the built-in leaderboard
- ✅ Use the built-in AI capabilities
- ✅ Use platform integrations (Twitch, Discord, OBS)
- ✅ Create custom commands and actions
- ✅ Build overlays and automations
- ✅ Package it all as a shareable plugin

Plugins are **modular, shareable feature sets** that work within StreamWeaver's capabilities. Like Streamer.bot workflows, but for an entire bot ecosystem.

## Core vs Plugin Features

### Core (Hardcoded Infrastructure)
- Points/Currency system + UI
- Leaderboard system + UI
- AI/Voice Commander
- Twitch/Discord/OBS integrations
- Actions management UI (tool to BUILD actions)
- Commands management UI (tool to BUILD commands)
- WebSocket server
- API endpoints

### Plugins (Community Creations)
- Custom commands (!pack, !trade, !death, etc.)
- Custom actions (flows/automations)
- Game systems (Pokemon TCG, etc.)
- Custom overlays
- Stream mini-games
- Chat interactions
- Data tracking systems

## What Makes a Good Plugin?

- **Self-contained** - All files, commands, actions included
- **Uses core features** - Leverages points, leaderboard, AI, integrations
- **Documented** - Clear setup and usage instructions
- **Flexible** - Configurable for different streams
- **Shareable** - Easy to export and import

## Plugin Structure

Each plugin lives in `src/plugins/[plugin-name]/` and contains:

```
src/plugins/pokemon-tcg/
├── plugin.json          # Plugin manifest (metadata)
├── commands/            # Command definitions
├── actions/             # Action flows
├── services/            # Backend logic
├── overlays/            # UI components
└── data/               # Static data files
```

## Creating a Plugin

### 1. Build Your Feature Using StreamWeaver's Tools

- Create commands in the Commands page
- Create actions in the Actions page
- Use the points system for costs/rewards
- Use the leaderboard for tracking stats
- Use AI for dynamic responses
- Use platform integrations (Twitch, Discord, OBS)

### 2. Organize Your Files

```bash
mkdir src/plugins/my-plugin
```

### 3. Create plugin.json Manifest

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "author": "YourName",
  "description": "What your plugin does",
  "category": "games",
  "tags": ["chat", "points"],
  "commands": [
    {
      "name": "!mycommand",
      "description": "Does something cool",
      "usage": "!mycommand [args]",
      "pointCost": 100
    }
  ],
  "features": [
    "Uses points system for costs",
    "Tracks stats in leaderboard",
    "Custom chat commands"
  ],
  "files": [
    "src/services/my-service.ts",
    "src/app/api/my-endpoint/route.ts"
  ],
  "setup": [
    "1. Import plugin via dashboard",
    "2. Configure settings",
    "3. Add data files if needed"
  ]
}
```

### 4. Implement Your Plugin Files

**Services** (backend logic):
```typescript
// src/services/my-service.ts
import { getUser, updateUser } from './user-stats';

export async function myFeature(username: string) {
  const user = await getUser(username);
  // Use built-in points system
  if (user.points < 100) return { error: 'Not enough points' };
  
  await updateUser(username, { points: user.points - 100 });
  return { success: true };
}
```

**API Routes** (endpoints):
```typescript
// src/app/api/my-endpoint/route.ts
import { myFeature } from '@/services/my-service';

export async function POST(req: Request) {
  const { username } = await req.json();
  const result = await myFeature(username);
  return Response.json(result);
}
```

**Chat Commands** (handled in chat-dispatcher.ts):
```typescript
if (message.startsWith('!mycommand')) {
  const result = await myFeature(username);
  // Send response to chat
}
```

### 5. Test Locally

Make sure everything works in your StreamWeaver instance before sharing.

## Exporting Your Plugin

Use the plugin manager to package your creation:

```typescript
import { exportPlugin } from '@/lib/plugin-manager';

await exportPlugin('my-plugin');
```

This creates `my-plugin.zip` with:
- plugin.json manifest
- All source files
- Data files
- Setup instructions

## Importing a Plugin

Other users can install your plugin:

```typescript
import { importPlugin } from '@/lib/plugin-manager';

await importPlugin('/path/to/plugin.zip');
```

The importer will:
1. Extract files to correct locations
2. Validate compatibility
3. Register commands/actions
4. Show setup steps

## Sharing with the Community

1. Export your plugin as a `.zip`
2. Share on GitHub, Discord, or your website
3. Include screenshots and examples
4. Provide support for users

Just like Streamer.bot workflows, but for entire bot features!

## Example: Pokemon TCG Plugin

Location: `src/plugins/pokemon-tcg/`

**What it does:**
- Adds Pokemon card pack opening system
- Uses built-in points (1500 per pack)
- Tracks cards in user stats
- Custom overlay for pack reveals

**Commands:**
- `!pack` - Open a pack (costs 1500 points)
- `!collection` - View your cards
- `!trade` - Trade with other viewers

**How it works within StreamWeaver:**
- ✅ Uses points system for pack costs
- ✅ Uses user-stats for card tracking
- ✅ Uses WebSocket for overlay updates
- ✅ Uses chat integration for responses
- ✅ Completely modular and shareable

**Files included:**
- `services/pokemon-packs.ts` - Pack opening logic
- `app/api/pokemon/route.ts` - API endpoint
- `app/(app)/pokemon-overlay/page.tsx` - Overlay UI
- `data/rarities/` - Card database files
- `plugin.json` - Manifest

This is a perfect example of building within StreamWeaver's capabilities and packaging it for others to use!

## Best Practices

1. **Use Core Features**: Leverage built-in points, leaderboard, and AI systems
2. **Document Everything**: Clear setup instructions and usage examples
3. **Version Your Plugin**: Use semantic versioning (1.0.0, 1.1.0, etc.)
4. **Test Thoroughly**: Make sure it works in different environments
5. **Keep It Simple**: Focus on one feature set per plugin
6. **Respect User Data**: Don't overwrite existing user stats
7. **Handle Errors**: Graceful fallbacks for missing data or API failures
8. **Make It Configurable**: Allow users to customize settings

## Plugin Categories

- **games** - Stream games and mini-games
- **chat** - Chat commands and interactions
- **overlays** - Visual overlays and alerts
- **integrations** - Third-party service integrations
- **automation** - Stream automation and workflows
- **analytics** - Stats tracking and reporting
- **moderation** - Chat moderation tools
- **utility** - General utility features

## Future: Plugin Marketplace

Eventually, StreamWeaver will have a built-in plugin marketplace where users can:
- Browse available plugins
- Install with one click
- Rate and review plugins
- Auto-update installed plugins
- Share their own creations

For now, plugins are shared manually via `.zip` files (like Streamer.bot workflows).

## Need Help?

Check out the example plugins in `src/plugins/` to see how everything works together.

Happy building! 🚀
