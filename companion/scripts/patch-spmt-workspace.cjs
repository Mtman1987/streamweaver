const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function patch(rel, transform) {
  const file = path.join(root, rel);
  const before = fs.readFileSync(file, 'utf8');
  const after = transform(before);
  if (after !== before) {
    fs.writeFileSync(file, after, 'utf8');
    console.log(`patched ${rel}`);
  }
}

patch('lib/config-store.cjs', (source) => {
  source = source.replace('schemaVersion: 2,', 'schemaVersion: 3,');
  source = source.replace("url: 'https://spacemountain.live/?companionWorkspace=streamweaver'", "url: 'https://spmt.live/embed/worktray?mode=full&app=companion'");
  const migration = `    if (Number(stored.schemaVersion || 1) < 3\n      && String(stored.windows?.workspace?.url || '').includes('companionWorkspace=streamweaver')) {\n      stored.windows.workspace.url = DEFAULT_CONFIG.windows.workspace.url;\n    }\n`;
  const marker = '    return {\n      ...clone(DEFAULT_CONFIG),';
  if (!source.includes('Number(stored.schemaVersion || 1) < 3') && source.includes(marker)) source = source.replace(marker, migration + marker);
  return source;
});

patch('main.cjs', (source) => {
  const showWorkspace = `function showWorkspace() {\n  const window = ensureWorkspaceWindow();\n  window.show();\n  window.focus();\n  return { visible: true };\n}`;
  if (source.includes(showWorkspace) && !source.includes('function showSpmtSurface(')) {
    source = source.replace(showWorkspace, `${showWorkspace}\n\nfunction showSpmtSurface(surface = 'worktray') {\n  const allowed = new Set(['worktray', 'settings', 'overlays']);\n  const selected = allowed.has(surface) ? surface : 'worktray';\n  const mode = selected === 'worktray' ? 'full' : 'full';\n  const window = ensureWorkspaceWindow();\n  void loadManagedUrl(window, \`https://spmt.live/embed/\${selected}?mode=\${mode}&app=companion\`);\n  window.setTitle(\`SPMT \${selected === 'worktray' ? 'Workspace' : selected === 'settings' ? 'Settings' : 'Overlay Bay'} · Companion\`);\n  window.show();\n  window.focus();\n  return { visible: true, surface: selected };\n}`);
  }
  source = source.replace("{ label: 'Open StreamWeaver', click: showWorkspace },", "{ label: 'Open SPMT Workspace', click: () => showSpmtSurface('worktray') },\n    { label: 'Open Universal Settings', click: () => showSpmtSurface('settings') },\n    { label: 'Open Overlay Bay', click: () => showSpmtSurface('overlays') },\n    { label: 'Open StreamWeaver', click: showWorkspace },");
  const actionMarker = "    if (action === 'workspace.show') return showWorkspace();";
  if (source.includes(actionMarker) && !source.includes("action === 'spmt.worktray'")) {
    source = source.replace(actionMarker, `${actionMarker}\n    if (action === 'spmt.worktray') return showSpmtSurface('worktray');\n    if (action === 'spmt.settings') return showSpmtSurface('settings');\n    if (action === 'spmt.overlays') return showSpmtSurface('overlays');`);
  }
  return source;
});

patch('ui/index.html', (source) => {
  const marker = '<button id="open-spacemountain">Open SpaceMountain Crew Desk</button>\n      <button id="open-streamweaver" class="secondary">Open StreamWeaver</button>';
  if (source.includes(marker) && !source.includes('open-spmt-workspace')) {
    source = source.replace(marker, '<button id="open-spmt-workspace">Workspace</button>\n      <button id="open-spmt-settings" class="secondary">Universal Settings</button>\n      <button id="open-spmt-overlays" class="secondary">Overlay Bay</button>\n      <button id="open-spacemountain" class="secondary">SpaceMountain</button>\n      <button id="open-streamweaver" class="secondary">StreamWeaver</button>');
  }
  source = source.replace('Your local bridge for overlays, OBS, audio, media, and reviewed cloud commands.', 'Your local bridge for canonical SPMT workspace controls, overlays, OBS, audio, media, and reviewed cloud commands.');
  return source;
});

patch('ui/renderer.js', (source) => {
  const marker = "byId('open-spacemountain').addEventListener('click', () => window.companion.windowAction('spacemountain.show'));";
  if (source.includes(marker) && !source.includes("open-spmt-workspace")) {
    source = source.replace(marker, `byId('open-spmt-workspace').addEventListener('click', () => window.companion.windowAction('spmt.worktray'));\nbyId('open-spmt-settings').addEventListener('click', () => window.companion.windowAction('spmt.settings'));\nbyId('open-spmt-overlays').addEventListener('click', () => window.companion.windowAction('spmt.overlays'));\n${marker}`);
  }
  return source;
});
