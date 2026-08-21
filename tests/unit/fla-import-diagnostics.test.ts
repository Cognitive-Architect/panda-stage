import { describe, expect, it } from 'vitest';
import {
  flaErrorDiagnostics,
  flaZeroRasterDiagnostic,
} from '../../src/shared/fla-import-diagnostics';
import type { AnimationImportIR } from '../../src/shared/fla-import-api';

function ir(mediaCount: number): AnimationImportIR {
  return {
    source: {
      format: 'fla',
      basename: 'sample.fla',
      byteLength: 1,
      sha256: 'a'.repeat(64),
      parser: {
        package: 'lifeart/fla-viewer',
        entrypoint: 'FLAParser.parse',
        commit: '048000ccab67469980b8dedd1fc2b65a02d2b164',
      },
    },
    document: { width: 1, height: 1, frameRate: 1, backgroundColor: '#fff' },
    media: Array.from({ length: mediaCount }, (_, index) => ({
      id: `fla-media-test-${String(index).padStart(4, '0')}`,
      name: `m${index}`,
      sourceReference: 'DOMDocument.xml',
      bitmapDataReference: null,
      sourceFormat: 'png' as const,
      width: 1,
      height: 1,
      payload: {
        mimeType: 'image/png' as const,
        width: 1,
        height: 1,
        bytes: new Uint8Array([1, 2, 3]),
        alpha: { kind: 'opaque' as const, zeroAlphaPixels: 0, partialAlphaPixels: 0 },
      },
    })),
    timelines: [],
    compatibility: [],
    summary: { placedInstanceCount: 0, libraryOnlyMediaCount: 0 },
  };
}

describe('FLA V1.5-A diagnostics', () => {
  it('classifies archive / unsupported-container errors as archive-malformed', () => {
    const malformed = flaErrorDiagnostics({
      code: 'MALFORMED_ARCHIVE',
      message: 'ZIP central directory exceeds the source boundary',
    });
    expect(malformed).toHaveLength(1);
    expect(malformed[0]!.category).toBe('archive-malformed');
    expect(malformed[0]!.userMessage).toContain('安全规则');
    expect(malformed[0]!.developerNote).toBe('ZIP central directory exceeds the source boundary');

    const unsupported = flaErrorDiagnostics({
      code: 'UNSUPPORTED_FLA_CONTAINER',
      message: 'Legacy OLE2 FLA containers are not supported in Slice 1',
    });
    expect(unsupported[0]!.category).toBe('archive-malformed');
  });

  it('classifies unsupported-feature errors as unsupported-or-unknown', () => {
    const result = flaErrorDiagnostics({
      code: 'UNSUPPORTED_FEATURE_PRESENT',
      message: 'Some unsupported feature present',
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.category).toBe('unsupported-or-unknown');
    expect(result[0]!.userMessage).toContain('暂不兼容');
  });

  it('does not attach archive-malformed to internal / cancellation / limit errors', () => {
    // Regression guard: a crash or cancellation must not be reported as an
    // archive-malformed rejection, and unknown stays distinct from zero.
    const crash = flaErrorDiagnostics({ code: 'PARSER_CRASH', message: 'boom' });
    expect(crash).toEqual([]);
    const cancelled = flaErrorDiagnostics({ code: 'USER_CANCELLED', message: 'cancelled' });
    expect(cancelled).toEqual([]);
    const limit = flaErrorDiagnostics({ code: 'ARCHIVE_LIMIT_EXCEEDED', message: 'too big' });
    expect(limit).toEqual([]);
  });

  it('derives no-importable-raster only for a successfully parsed empty media set', () => {
    const empty = flaZeroRasterDiagnostic(ir(0));
    expect(empty).toHaveLength(1);
    expect(empty[0]!.category).toBe('no-importable-raster');
    expect(empty[0]!.userMessage).toContain('没有找到可直接导入的位图素材');

    const populated = flaZeroRasterDiagnostic(ir(3));
    expect(populated).toEqual([]);
  });
});
