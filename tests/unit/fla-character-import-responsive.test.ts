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

    expect(shell).toContain("onFlaCharacterImportStart={() => workbench.current?.show('assets')}");
    expect(shell).toContain('onFlaCharacterCommitStateChange={setFlaCharacterCommitActive}');
    expect(shell).toMatch(/panel === 'assets'.*!flaCharacterCommitActiveRef\.current/u);
    expect(leftWorkspace).toContain(
      'onFlaCharacterImportStart={onFlaCharacterImportStart}',
    );
    expect(dock).toContain('onFlaCharacterImportStart?.();');
    expect(dock).toContain('flaCharacterImportAttemptRef.current');
    expect(dock).toContain('keepOpenForFlaCharacterImport');
  });
});
