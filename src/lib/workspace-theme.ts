import type { WorkspaceThemeTokensV1 } from '@spmt/sdk';

export function hexToHslComponents(hex: string): string {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(normalized)) throw new Error(`Invalid workspace color: ${hex}`);
  const r = parseInt(normalized.slice(0, 2), 16) / 255;
  const g = parseInt(normalized.slice(2, 4), 16) / 255;
  const b = parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  if (hue < 0) hue += 360;
  const lightness = (max + min) / 2;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

const WORKSPACE_PROPERTIES = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--accent',
  '--ring',
  '--radius',
];

export function clearWorkspaceThemeTokens(root: HTMLElement): void {
  for (const property of WORKSPACE_PROPERTIES) root.style.removeProperty(property);
  delete root.dataset.workspaceTheme;
  delete root.dataset.workspaceDensity;
  delete root.dataset.workspaceMotion;
}

export function applyWorkspaceThemeTokens(root: HTMLElement, tokens: WorkspaceThemeTokensV1): void {
  const background = hexToHslComponents(tokens.background);
  const surface = hexToHslComponents(tokens.surface);
  const text = hexToHslComponents(tokens.text);
  const accent = hexToHslComponents(tokens.accent);
  root.style.setProperty('--background', background);
  root.style.setProperty('--foreground', text);
  root.style.setProperty('--card', `${surface} / 0.82`);
  root.style.setProperty('--card-foreground', text);
  root.style.setProperty('--popover', surface);
  root.style.setProperty('--popover-foreground', text);
  root.style.setProperty('--primary', accent);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--ring', accent);
  const radius = ({ sm: '0.25rem', md: '0.5rem', lg: '0.8rem', full: '9999px' } as Record<string, string>)[tokens.radius] || tokens.radius;
  root.style.setProperty('--radius', radius);
  root.dataset.workspaceTheme = tokens.themeId;
  root.dataset.workspaceDensity = tokens.density;
  root.dataset.workspaceMotion = tokens.motion.enabled ? 'on' : 'off';
}
