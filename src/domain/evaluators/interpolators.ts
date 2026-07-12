export type Easing = 'linear' | 'ease-in-out';

export function interpolate(start: number, end: number, t: number, easing: Easing): number {
  const clamped = Math.max(0, Math.min(1, t));
  const eased = easing === 'ease-in-out' ? easeInOutCubic(clamped) : clamped;
  return start + (end - start) * eased;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function easeInOutQuad(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function dampedSine(phase: number, damping: number): number {
  return Math.sin(phase) * damping;
}

export function calculateShakeOffset(
  amplitudeX: number,
  amplitudeY: number,
  frequency: number,
  progress: number
): { offsetX: number; offsetY: number } {
  const damping = 1 - clamp(progress, 0, 1);
  const phase = progress * frequency * Math.PI * 2;
  return {
    offsetX: Math.sin(phase) * amplitudeX * damping,
    offsetY: Math.cos(phase) * amplitudeY * damping,
  };
}
