# StreamWeaver - Development Guidelines

## Code Quality Standards

### TypeScript Conventions
- Strict mode enabled (`"strict": true` in tsconfig)
- ES2018 target with ESNext modules (bundler resolution)
- Path alias `@/*` maps to `./src/*` — always use it for imports
- Prefer `type` imports for type-only usage: `import type { Metadata } from 'next'`
- Use `interface` for object shapes that may be extended, `type` for unions/intersections
- Avoid `any` where possible, but pragmatic use is acceptable in service layers

### Naming Conventions
- **Files**: kebab-case (`tenant-context.ts`, `api-response.ts`, `chat-dispatcher.ts`)
- **Components**: PascalCase files for React components (`CardBack.tsx`), kebab-case for most
- **Functions**: camelCase, descriptive verbs (`getPoints`, `bootstrapTenant`, `loadChatHistory`)
- **Constants**: UPPER_SNAKE_CASE for module-level constants (`PERSIST_ROOT`, `TIMEOUTS`)
- **Types/Interfaces**: PascalCase (`PointSettings`, `StorageContext`, `TenantSession`)

### File Organization
- One service per file in `src/services/`
- Exports at bottom or inline with function declarations
- Related types defined in same file or in `src/types/`
- UI components use `"use client"` directive when needed

## Architectural Patterns

### Multi-Tenant Context Passing
Every data operation accepts an optional `StorageContext` parameter:
```typescript
export interface StorageContext {
  tenantId: string;
  username: string;
}

// Service functions accept ctx as last param
export async function getPoints(userId: string, ctx?: StorageContext): Promise<...>
export async function addPoints(userId: string, amount: number, reason?: string, ctx?: StorageContext): Promise<...>
```

### Tenant Resolution in API Routes
```typescript
import { getTenantFromRequest, toStorageContext } from '@/lib/tenant-context';

export async function GET(request: NextRequest) {
  const session = getTenantFromRequest(request);
  if (!session) return apiError('Not authenticated', { status: 401 });
  const ctx = toStorageContext(session);
  // ... use ctx in service calls
}
```

### API Response Pattern
Use the standardized response helpers from `@/lib/api-response`:
```typescript
import { apiOk, apiError } from '@/lib/api-response';

// Success
return apiOk({ points: 100, level: 2 });

// Error
return apiError('User not found', { status: 404, code: 'NOT_FOUND' });
```

### JSON File Storage Pattern
All data persistence uses `readJsonFile` / `writeJsonFile` from `@/services/storage`:
```typescript
import { readJsonFile, writeJsonFile, StorageContext } from './storage';

async function loadData(ctx?: StorageContext): Promise<MyType> {
  return readJsonFile<MyType>('my-file.json', defaultValue, ctx);
}

async function saveData(data: MyType, ctx?: StorageContext): Promise<void> {
  await writeJsonFile('my-file.json', data, ctx);
}
```
- Atomic writes via temp file + rename
- Mutex locks prevent race conditions
- Falls back to legacy single-user path when no ctx provided

### Tenant Filesystem Layout
```typescript
import { tenantRoot, tenantPath, globalPath } from '@/lib/tenant';

// Per-tenant file
const tokensFile = tenantPath(twitchId, 'tokens/twitch-tokens.json');

// Global shared file
const pokemonFile = globalPath('pokemon-users/username.json');
```

### WebSocket Broadcasting
```typescript
// Global broadcast function (set in server.ts)
(global as any).broadcast({ type: 'event-name', payload: { ... } });

// Tenant-scoped broadcast
(global as any).broadcast({ type: 'event-name', payload: { ... } }, tenantId);
```

### UI Component Pattern (shadcn/ui)
Components in `src/components/ui/` re-export Radix primitives:
```typescript
"use client"
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible"

const Collapsible = CollapsiblePrimitive.Root
const CollapsibleTrigger = CollapsiblePrimitive.CollapsibleTrigger
const CollapsibleContent = CollapsiblePrimitive.CollapsibleContent

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
```

### Icon Components
Custom SVG icons accept standard `SVGProps<SVGSVGElement>`:
```typescript
import type { SVGProps } from "react";

export function TwitchIcon(props: SVGProps<SVGSVGElement>) {
  return <svg {...props} ...>...</svg>;
}
```

## Service Layer Patterns

### Service Initialization
Services are loaded lazily via `require()` in server.ts startup sequence:
```typescript
const { setupAllTenants } = require('./src/services/twitch-client');
await setupAllTenants();
```

### Polling Tasks
Register recurring tasks with the unified polling service:
```typescript
pollingService.addTask('task-name', async () => {
  // task logic
}, intervalMs);
```

### Error Handling
- Services use try/catch with `console.warn` for non-fatal errors
- Server startup continues even if individual services fail (`⚠️` vs `✅` logging)
- API routes return structured errors via `apiError()`

### Logging Convention
```typescript
console.log('[ServiceName] ✅ Success message');
console.warn('[ServiceName] ⚠️ Warning message');
console.error('[ServiceName] Error message:', error);
```
- Prefix with `[ServiceName]` in brackets
- Use emoji indicators: ✅ success, ⚠️ warning, ❌ failure
- Step-based logging in server.ts: `[STEP N]`

## React & Next.js Patterns

### App Router Layout
- Root layout in `src/app/layout.tsx` wraps with `SidebarProvider` and `Toaster`
- Dark mode by default (`className="dark"` on html)
- Google Fonts loaded via `<link>` in head

### Client vs Server Components
- Default to server components (no directive needed)
- Add `"use client"` only when using hooks, event handlers, or browser APIs
- UI primitives from shadcn always use `"use client"`

### Middleware Auth
- Session parsed from `streamweaver-session` cookie
- Public paths defined in `PUBLIC_PATHS` array
- Overlay pages are always public (no auth)
- API routes from localhost bypass auth

## Development Workflow

### Adding a New Service
1. Create `src/services/my-service.ts`
2. Export functions that accept `StorageContext` as last param
3. Register in server.ts startup if it needs initialization
4. Add polling task if it needs periodic execution

### Adding a New API Route
1. Create `src/app/api/my-route/route.ts`
2. Use `getTenantFromRequest()` for auth
3. Use `apiOk()` / `apiError()` for responses
4. Call service functions with `toStorageContext(session)`

### Adding a New Overlay
1. Create `src/app/my-overlay/page.tsx` (client component)
2. Add path to `PUBLIC_PATHS` in middleware.ts
3. Connect to WebSocket for real-time updates
4. No auth required — overlays are public

### Adding a New Dashboard Page
1. Create `src/app/(app)/my-page/page.tsx`
2. Protected by middleware automatically (inside `(app)` group)
3. Use shadcn/ui components for consistent styling
