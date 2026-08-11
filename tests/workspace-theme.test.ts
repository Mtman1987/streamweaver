import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorkspaceThemeTokens, clearWorkspaceThemeTokens, hexToHslComponents } from '../src/lib/workspace-theme';

test('workspace theme tokens map to StreamWeaver CSS variables and can be cleared', () => {
  const properties = new Map<string, string>();
  const root = {
    style: {
      setProperty: (name: string, value: string) => properties.set(name, value),
      removeProperty: (name: string) => properties.delete(name),
    },
    dataset: {} as Record<string, string>,
  } as unknown as HTMLElement;

  applyWorkspaceThemeTokens(root, {
    schemaVersion: 1,
    themeId: 'nebula-purple',
    background: '#070812',
    surface: '#18152a',
    text: '#f4f3ff',
    accent: '#a855f7',
    radius: 'lg',
    density: 'comfortable',
    motion: { enabled: true, speed: 85 },
  });

  assert.equal(hexToHslComponents('#000000'), '0 0% 0%');
  assert.equal(properties.get('--radius'), '26px');
  assert.equal(properties.get('--workspace-background-image'), 'url("https://spacemountain.live/assets/theme-nebula-purple-background.webp")');
  assert.equal(root.dataset.workspaceTheme, 'nebula-purple');
  assert.equal(root.dataset.workspaceMotion, 'on');

  clearWorkspaceThemeTokens(root);
  assert.equal(properties.has('--background'), false);
  assert.equal(properties.has('--workspace-background-image'), false);
  assert.equal(root.dataset.workspaceTheme, undefined);
});
