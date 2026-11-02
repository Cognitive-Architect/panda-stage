import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAL_EXPORT_DRAW_MODE,
  parseExportDrawMode,
  resolveFormalExportDrawMode,
} from '../../src/shared/export-draw-mode';

describe('formal export draw mode', () => {
  it('defaults formal exports to explicit drawing and keeps the legacy rollback selectable', () => {
    expect(DEFAULT_FORMAL_EXPORT_DRAW_MODE).toBe('explicit-sync');
    expect(resolveFormalExportDrawMode(undefined)).toBe('explicit-sync');
    expect(resolveFormalExportDrawMode('legacy-raf')).toBe('legacy-raf');
  });

  it('rejects misspelled internal modes and ignores invalid renderer query values', () => {
    expect(() => resolveFormalExportDrawMode('sync')).toThrow(
      'Unsupported formal export draw mode',
    );
    expect(parseExportDrawMode('sync')).toBeNull();
  });
});
