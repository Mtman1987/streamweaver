import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = fs.readFileSync(path.join(root, 'src/components/spmt-workspace-host.tsx'), 'utf8');
const header = fs.readFileSync(path.join(root, 'src/components/layout/header.tsx'), 'utf8');

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

test('desktop header exposes the existing sidebar collapse trigger', () => {
  assert.match(header, /Collapse or expand StreamWeaver navigation/);
  assert.doesNotMatch(header, /className="md:hidden"[\s\S]{0,120}<SidebarTrigger/);
});
