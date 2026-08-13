const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function patch(rel, transform) {
  const file = path.join(root, rel);
  const raw = fs.readFileSync(file, 'utf8');
  const before = raw.replace(/\r\n/g, '\n');
  const after = transform(before);
  if (after !== raw) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`patched ${rel}`);
  }
}

function replaceRequired(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Companion canonical workspace marker missing: ${label}`);
  return source.replace(from, to);
}

function replaceBlock(source, startMarker, endMarker, replacement, label) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Companion canonical workspace marker missing: ${label}`);
  return source.slice(0, start) + replacement + source.slice(end);
}

patch('main.cjs', (source) => {
  const surfaceImport = "const { DEFAULT_ORIGIN: SPMT_ORIGIN, resolveSurfaceUrl, resolvePersonalOverlayUrl } = require('./lib/spmt-surfaces.cjs');";
  const importMarker = "const { WorkflowJobs } = require('./lib/workflow-jobs.cjs');";
  if (!source.includes(surfaceImport)) source = replaceRequired(source, importMarker, `${importMarker}\n${surfaceImport}`, 'SPMT surface resolver import');

  if (!source.includes('const trustedWorkspaceOrigins = new Set([')) {
    const newTrust = `const trustedWorkspaceOrigins = new Set([\n  'https://spacemountain.live',\n  'https://spacemountain-live.fly.dev',\n  'https://spmt.live',\n  'https://streamweaver-new.fly.dev'\n]);\n\nfunction trustManagedUrl(value) {\n  try {\n    const parsed = new URL(value);\n    if (parsed.protocol === 'https:') trustedWorkspaceOrigins.add(parsed.origin);\n  } catch {}\n}\n\nfunction isTrustedWorkspaceUrl(value) {\n  try {\n    const parsed = new URL(value);\n    return parsed.protocol === 'https:' && trustedWorkspaceOrigins.has(parsed.origin);\n  } catch {\n    return false;\n  }\n}\n\n`;
    source = replaceBlock(source, 'function isTrustedWorkspaceUrl(value) {', 'function loadManagedUrl(window, value) {', newTrust, 'trusted workspace origins');
  }

  const oldShowWorkspace = `function showWorkspace() {\n  const window = ensureWorkspaceWindow();\n  window.show();\n  window.focus();\n  return { visible: true };\n}`;
  if (source.includes(oldShowWorkspace)) {
    source = source.replace(oldShowWorkspace, `function showWorkspace() {\n  return showSpmtSurface('worktray');\n}\n\nasync function showSpmtSurface(surface = 'worktray') {\n  const allowed = new Set(['worktray', 'settings', 'overlays']);\n  const selected = allowed.has(surface) ? surface : 'worktray';\n  const window = ensureWorkspaceWindow();\n  let target = '';\n  try {\n    target = await resolveSurfaceUrl(window.webContents.session, selected, 'companion', SPMT_ORIGIN);\n  } catch (error) {\n    logCompanion(\`Canonical SPMT surface could not be resolved (\${selected})\`, error);\n  }\n  if (!target) target = SPMT_ORIGIN;\n  trustManagedUrl(target);\n  await loadManagedUrl(window, target);\n  window.setTitle(\`SPMT \${selected === 'worktray' ? 'Workspace' : selected === 'settings' ? 'Settings' : 'Overlay Bay'} · Companion\`);\n  window.show();\n  window.focus();\n  return { visible: true, surface: selected, canonical: Boolean(target && target !== SPMT_ORIGIN) };\n}\n\nasync function refreshCanonicalPersonalOverlay(targetWindow = overlayWindow) {\n  if (!targetWindow || targetWindow.isDestroyed()) return '';\n  const session = workspaceWindow && !workspaceWindow.isDestroyed()\n    ? workspaceWindow.webContents.session\n    : targetWindow.webContents.session;\n  let resolved = '';\n  try {\n    resolved = await resolvePersonalOverlayUrl(session, SPMT_ORIGIN);\n  } catch (error) {\n    logCompanion('Canonical Personal overlay URL could not be resolved', error);\n  }\n  const cached = String(config.windows.overlay.url || '').trim();\n  const next = resolved || cached;\n  if (!next) return '';\n  trustManagedUrl(next);\n  if (resolved && resolved !== cached) {\n    config.windows.overlay.url = resolved;\n    saveConfig();\n  }\n  if (targetWindow.webContents.getURL() !== next) await loadManagedUrl(targetWindow, next);\n  return next;\n}`);
  }

  source = source.replace(
    "  workspaceWindow.webContents.on('did-navigate', (_event, url) => {\n    if (url.startsWith('https://spacemountain.live/')) {\n      overlayWindow?.webContents.reload();\n    }\n  });",
    "  workspaceWindow.webContents.on('did-navigate', () => {\n    if (overlayWindow && !overlayWindow.isDestroyed()) void refreshCanonicalPersonalOverlay(overlayWindow);\n  });"
  );

  source = source.replace("  overlayWindow.setTitle('SpaceMountain Personal Overlay');", "  overlayWindow.setTitle('SPMT Personal Overlay');");
  source = source.replace(
    "  void loadManagedUrl(overlayWindow, config.windows.overlay.url);\n  return overlayWindow;",
    "  const cachedPersonalUrl = String(config.windows.overlay.url || '').trim();\n  if (cachedPersonalUrl) {\n    trustManagedUrl(cachedPersonalUrl);\n    void loadManagedUrl(overlayWindow, cachedPersonalUrl);\n  } else {\n    void overlayWindow.loadURL('about:blank');\n  }\n  void refreshCanonicalPersonalOverlay(overlayWindow);\n  return overlayWindow;"
  );

  source = source.replace("{ label: 'Open StreamWeaver', click: showWorkspace },", "{ label: 'Open SPMT Workspace', click: () => void showSpmtSurface('worktray') },\n    { label: 'Open Universal Settings', click: () => void showSpmtSurface('settings') },\n    { label: 'Open Overlay Bay', click: () => void showSpmtSurface('overlays') },\n    { label: 'Open StreamWeaver', click: showWorkspace },");

  const actionMarker = "    if (action === 'workspace.show') return showWorkspace();";
  if (source.includes(actionMarker) && !source.includes("action === 'spmt.worktray'")) {
    source = source.replace(actionMarker, `${actionMarker}\n    if (action === 'spmt.worktray') return showSpmtSurface('worktray');\n    if (action === 'spmt.settings') return showSpmtSurface('settings');\n    if (action === 'spmt.overlays') return showSpmtSurface('overlays');`);
  }

  return source;
});

patch('ui/index.html', (source) => {
  source = source.replace('Your local bridge for overlays, OBS, audio, media, and reviewed cloud commands.', 'Your local bridge for canonical SPMT workspace controls, overlays, OBS, audio, media, and reviewed cloud commands.');
  source = source.replace(
    '<label>Personal overlay URL <input id="overlay-url" type="url"></label>',
    '<p id="overlay-source-status" class="section-copy">Personal overlay source is resolved from your signed-in SPMT account.</p>'
  );
  const marker = '<button id="open-spacemountain">Open SpaceMountain Crew Desk</button>\n      <button id="open-streamweaver" class="secondary">Open StreamWeaver</button>';
  if (source.includes(marker) && !source.includes('open-spmt-workspace')) {
    source = source.replace(marker, '<button id="open-spmt-workspace">Workspace</button>\n      <button id="open-spmt-settings" class="secondary">Universal Settings</button>\n      <button id="open-spmt-overlays" class="secondary">Overlay Bay</button>\n      <button id="open-spacemountain" class="secondary">SpaceMountain</button>\n      <button id="open-streamweaver" class="secondary">StreamWeaver</button>');
  }
  source = source.replace('Widget visibility, widget opacity, dock visibility, and glass opacity come from your SpaceMountain workspace.', 'Widget visibility, geometry, alerts, and shared appearance come from the canonical SPMT workspace.');
  return source;
});

patch('ui/renderer.js', (source) => {
  source = source.replace("  byId('overlay-url').value = config.windows.overlay.url;\n", "  byId('overlay-source-status').textContent = config.windows.overlay.url ? 'Canonical Personal overlay connected.' : 'Open Workspace and sign in to SPMT to resolve your Personal overlay.';\n");
  source = source.replace("        url: byId('overlay-url').value.trim(),\n", '');
  const marker = "byId('open-spacemountain').addEventListener('click', () => window.companion.windowAction('spacemountain.show'));";
  if (source.includes(marker) && !source.includes("open-spmt-workspace")) {
    source = source.replace(marker, `byId('open-spmt-workspace').addEventListener('click', () => window.companion.windowAction('spmt.worktray'));\nbyId('open-spmt-settings').addEventListener('click', () => window.companion.windowAction('spmt.settings'));\nbyId('open-spmt-overlays').addEventListener('click', () => window.companion.windowAction('spmt.overlays'));\n${marker}`);
  }
  return source;
});

// The canonical implementation now lives in the real resolver/config source.
// This script remains idempotent because start/check/package already invoke it.
const configSource = fs.readFileSync(path.join(root, 'lib/config-store.cjs'), 'utf8');
if (!configSource.includes('schemaVersion: 4')) throw new Error('Companion config must use canonical schemaVersion 4');
if (!fs.existsSync(path.join(root, 'lib/spmt-surfaces.cjs'))) throw new Error('Canonical SPMT surface resolver is missing');