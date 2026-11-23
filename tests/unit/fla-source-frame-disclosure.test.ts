// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { FlaSourceFrameSuggestions } from '../../src/renderer/fla-import/FlaSourceFrameSuggestions';

it('opens long source frames initially and remembers manual collapse when revisiting', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  const preference = new Map<string, boolean>();
  const draw = (frameCount: number) => {
    const key = String(frameCount);
    root.render(createElement(FlaSourceFrameSuggestions, {
      key, sessionId: 'fixture', disabled: false,
      target: { renderTargetId: key, kind: 'scene', frameCount, userLabel: key, compatibility: [] },
      initialOpen: preference.get(key),
      onOpenChange: (open) => preference.set(key, open),
      onChooseFrame: () => {},
    }));
  };
  try {
    await act(async () => draw(257));
    const details = element.querySelector('details')!;
    expect(details.open).toBe(true);
    await act(async () => {
      details.open = false;
      details.dispatchEvent(new Event('toggle'));
    });
    expect(element.querySelector('input[type="search"]')).toBeNull();
    await act(async () => draw(256));
    expect(element.querySelector('details')!.open).toBe(false);
    await act(async () => draw(257));
    expect(element.querySelector('details')!.open).toBe(false);
  } finally {
    await act(async () => root.unmount());
    element.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
