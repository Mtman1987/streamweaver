import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = fs.readFileSync(path.join(root, 'src/components/spmt-workspace-host.tsx'), 'utf8');
const header = fs.readFileSync(path.join(root, 'src/components/layout/header.tsx'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/layout/app-shell.tsx'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'src/components/layout/sidebar.tsx'), 'utf8');
const parityCss = fs.readFileSync(path.join(root, 'src/app/workspace-parity.css'), 'utf8');

test('shared workspace footer survives a disconnected SPMT bridge', () => {
  assert.doesNotMatch(host, /hiddenRoute\s*\|\|\s*embedded\s*\|\|\s*!connected/);
  assert.match(host, /Reconnect SPMT workspace/);
  assert.match(host, /aria-label="SPMT workspace tray"/);
  assert.match(host, /\/auth\/spmt\/start\?next=/);
});

test('saved overlay positions use canonical percentage coordinates', () => {
  assert.match(host, /left:\s*`\$\{Number\(widget\.x \|\| 0\)\}%`/);
  assert.match(host, /top:\s*`\$\{Number\(widget\.y \|\| 0\)\}%`/);
});

test('desktop sidebar has a working collapse trigger and rail', () => {
  assert.match(header, /Collapse or expand StreamWeaver navigation/);
  assert.doesNotMatch(header, /className="md:hidden"[\s\S]{0,120}<SidebarTrigger/);
  assert.match(sidebar, /<SidebarRail \/>/);
  assert.match(sidebar, /group-data-\[collapsible=icon\]:hidden/);
});

test('global shell does not duplicate feature utilities or page actions', () => {
  assert.doesNotMatch(shell, /Open private gallery/);
  assert.doesNotMatch(shell, /Send me a bot DM/);
  assert.doesNotMatch(header, /Review setup/);
  assert.doesNotMatch(header, /Build commands/);
  assert.doesNotMatch(header, />\s*Refresh\s*</);
  assert.doesNotMatch(header, /GlobalActivityPulse/);
});

test('canonical workspace owns the background and glass surfaces', () => {
  assert.match(parityCss, /var\(--workspace-background-image\)/);
  assert.match(parityCss, /\.sw-starfield/);
  assert.match(parityCss, /calc\(var\(--workspace-glass-opacity, 0\.65\) \* 0\.72\)/);
});
