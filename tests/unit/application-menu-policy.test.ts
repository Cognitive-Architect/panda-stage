import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { shouldExposeDevelopmentMenu } from '../../src/main/menu-policy';

describe('application menu policy', () => {
  it('hides the native application menu in development acceptance builds', () => {
    expect(
      shouldExposeDevelopmentMenu({
        isPackaged: false,
        gateA: false,
      }),
    ).toBe(false);
  });

  it('hides the default development menu in packaged production', () => {
    expect(
      shouldExposeDevelopmentMenu({
        isPackaged: true,
        gateA: false,
      }),
    ).toBe(false);
  });

  it('does not expose a development menu during packaged Gate A', () => {
    expect(
      shouldExposeDevelopmentMenu({
        isPackaged: true,
        gateA: true,
      }),
    ).toBe(false);
  });

  it('applies the production policy before application windows are created', () => {
    const main = readFileSync('src/main/index.ts', 'utf8');

    expect(main).toContain('shouldExposeDevelopmentMenu');
    expect(main).toContain('Menu.setApplicationMenu(null)');
    expect(main.indexOf('Menu.setApplicationMenu(null)')).toBeLessThan(
      main.indexOf('await createApplicationWindows()'),
    );
  });
});
