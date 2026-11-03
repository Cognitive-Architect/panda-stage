import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

describe('F1-04 responsive import lifecycle', () => {
  it('preserves the Character resource surface while a FLA import is active', () => {
    const shell = source('src/renderer/shell/EditorShell.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const leftWorkspace = source('src/renderer/shell/LeftWorkspace.tsx');

    expect(shell).toContain('onFlaCharacterImportStart={() => {');
    expect(shell).toContain("setPortraitWorkspace('canvas');");
    expect(shell).toContain("setPortraitResourceActivity('characters');");
    expect(shell).toContain("setPortraitCanvasSurface('shots');");
    expect(leftWorkspace).toContain(
      'onFlaCharacterImportStart={onFlaCharacterImportStart}',
    );
    expect(dock).toContain('onFlaCharacterImportStart?.();');
    expect(dock).toContain('flaCharacterImportAttemptRef.current');
    expect(dock).toContain('keepOpenForFlaCharacterImport');
  });
});
