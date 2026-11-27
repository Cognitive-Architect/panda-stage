const fallbackColors = {
  'action-primary': '#54cdf3',
  'selected-surface': '#23343e',
  'text-primary': '#e3e7ed',
  'text-secondary': '#a0a8b6',
};

type CanvasControlColor = keyof typeof fallbackColors;
const resolvedColors = new Map<CanvasControlColor, string>();

// Konva needs resolved colors. The product tokens are fixed for the renderer session.
export function readCanvasControlColor(role: CanvasControlColor): string {
  const cached = resolvedColors.get(role);
  if (cached) return cached;
  if (typeof document === 'undefined') return fallbackColors[role];

  const value = getComputedStyle(document.documentElement).getPropertyValue('--ui-color-' + role).trim();
  if (!value) return fallbackColors[role];
  resolvedColors.set(role, value);
  return value;
}
