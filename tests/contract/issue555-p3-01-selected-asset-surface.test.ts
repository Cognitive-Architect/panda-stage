import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd());
const basePath = resolve(
  root,
  'src/renderer/styles/features/characters/image-picker/s14-14--image-picker-base-492.css',
);
const settingsPath = resolve(
  root,
  'src/renderer/styles/features/characters/settings/s16-04--character-settings-polish-526.css',
);
const inlinePath = resolve(
  root,
  'src/renderer/styles/features/characters/image-picker/s16-07--image-picker-inline-and-host.css',
);

const contract = {
  border: '--image-asset-picker-selected-surface-border',
  borderHover: '--image-asset-picker-selected-surface-border-hover',
  radius: '--image-asset-picker-selected-surface-radius',
  background: '--image-asset-picker-selected-surface-background',
  backgroundHover: '--image-asset-picker-selected-surface-background-hover',
} as const;

function read(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function ruleContaining(source: string, selector: string): string {
  const selectorStart = source.indexOf(selector);
  expect(selectorStart, `missing CSS selector: ${selector}`).toBeGreaterThanOrEqual(0);
  const openBrace = source.indexOf('{', selectorStart);
  const closeBrace = source.indexOf('}', openBrace);
  expect(openBrace).toBeGreaterThan(selectorStart);
  expect(closeBrace).toBeGreaterThan(openBrace);
  return source.slice(selectorStart, closeBrace + 1);
}

describe('Issue #555 Selected Asset Surface Contract', () => {
  it('defines one family-scoped contract and makes the base selected Picker consume it', () => {
    const base = read(basePath);
    const rootRule = ruleContaining(base, '.image-asset-picker {');
    const selectedRule = ruleContaining(base, '.image-asset-picker-selected {');
    const interactionRule = ruleContaining(
      base,
      '.image-asset-picker-selected:hover:not(:disabled),',
    );

    expect(rootRule).toContain(
      `${contract.border}: rgb(127 199 148 / 34%);`,
    );
    expect(rootRule).toContain(
      `${contract.borderHover}: rgb(127 199 148 / 70%);`,
    );
    expect(rootRule).toContain(`${contract.radius}: 9px;`);
    expect(rootRule).toContain(`${contract.background}:`);
    expect(rootRule).toContain(`${contract.backgroundHover}:`);
    expect(selectedRule).toContain(`border: 1px solid var(${contract.border})`);
    expect(selectedRule).toContain(`border-radius: var(${contract.radius})`);
    expect(selectedRule).toContain(`background: var(${contract.background})`);
    expect(interactionRule).toContain(
      `border-color: var(${contract.borderHover})`,
    );
    expect(interactionRule).toContain(
      `background: var(${contract.backgroundHover})`,
    );
  });

  it('makes C05 consume the contract while preserving the transparent Picker seam and Clear action', () => {
    const settings = read(settingsPath);
    const outerRule = ruleContaining(settings, '.image-asset-picker-selected-row {');
    const innerRule = ruleContaining(
      settings,
      '.image-asset-picker-selected-row\n  > .image-asset-picker-selected {',
    );
    const innerInteractionRule = ruleContaining(
      settings,
      '.image-asset-picker-selected-row\n  > .image-asset-picker-selected:hover:not(:disabled),',
    );

    expect(outerRule).toContain(`border: 1px solid var(${contract.border})`);
    expect(outerRule).toContain(`border-radius: var(${contract.radius})`);
    expect(outerRule).toContain(`background: var(${contract.background})`);
    expect(innerRule).toContain('border-color: transparent;');
    expect(innerRule).toContain('border-radius: 0;');
    expect(innerRule).toContain('background: transparent;');
    expect(innerInteractionRule).toContain(
      `background: var(${contract.backgroundHover})`,
    );
    expect(settings).toContain('.character-mouth-clear');
  });

  it('keeps C09 inline geometry local while inheriting the family surface from the base rule', () => {
    const inline = read(inlinePath);
    const inlineSelectedRule = ruleContaining(
      inline,
      '.image-asset-picker-inline .image-asset-picker-selected {',
    );

    expect(inlineSelectedRule).toContain('min-height: 52px;');
    expect(inlineSelectedRule).toContain('padding: 3px 5px;');
    expect(inlineSelectedRule).toContain(
      'grid-template-columns: 44px minmax(0, 1fr) max-content;',
    );
    expect(inlineSelectedRule).toContain('gap: 7px;');
    expect(inlineSelectedRule).not.toMatch(/\bborder(?:-color|-radius)?\s*:/u);
    expect(inlineSelectedRule).not.toContain('background:');
  });
});
