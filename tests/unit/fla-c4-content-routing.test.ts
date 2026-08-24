import { describe, expect, it } from 'vitest';
import type {
  AnimationImportIR,
  FlaInspectionResponse,
  FlaInspectionTrace,
} from '../../src/shared/fla-import-api';
import { routeFlaInspection } from '../../src/renderer/fla-import/fla-content-route';

function successfulInspection(options: {
  mediaCount: number;
  recovered: boolean;
  structuralFrameCount?: number;
}): FlaInspectionResponse {
  const media = Array.from({ length: options.mediaCount }, (_, index) => ({
    id: `media-${index}`,
  })) as AnimationImportIR['media'];
  const trace = {
    ingestMode: options.recovered ? 'compatibility-recovered' : 'strict',
    recoveryApplied: options.recovered,
  } as FlaInspectionTrace;
  return {
    ok: true,
    sessionId: '00000000-0000-4000-8000-000000000304',
    ir: {
      media,
      structure: options.structuralFrameCount === undefined
        ? undefined
        : { documentFrameCount: options.structuralFrameCount },
    } as AnimationImportIR,
    trace,
  };
}

describe('FLA V1.5-C4 recovered content routing', () => {
  it.each([
    ['strict-valid', false],
    ['compatibility-recovered', true],
  ] as const)('%s raster content uses the same existing V1 route', (_label, recovered) => {
    expect(routeFlaInspection(successfulInspection({ mediaCount: 1, recovered })))
      .toBe('v1-raster-review');
  });

  it.each([
    ['strict-valid', false],
    ['compatibility-recovered', true],
  ] as const)('%s zero-raster content reaches existing V2-R discovery', (_label, recovered) => {
    expect(routeFlaInspection(successfulInspection({ mediaCount: 0, recovered })))
      .toBe('v2r-target-discovery');
  });

  it('does not manufacture V2-R support from structural frame counts', () => {
    const zeroFrames = successfulInspection({
      mediaCount: 0,
      recovered: true,
      structuralFrameCount: 0,
    });
    const manyFrames = successfulInspection({
      mediaCount: 0,
      recovered: true,
      structuralFrameCount: 99_999,
    });

    expect(routeFlaInspection(zeroFrames)).toBe('v2r-target-discovery');
    expect(routeFlaInspection(manyFrames)).toBe('v2r-target-discovery');
  });

  it('blocks rejected and ambiguous inspections before either product route', () => {
    for (const classifierState of ['REJECT', 'AMBIGUOUS'] as const) {
      const response = {
        ok: false,
        error: { code: 'MALFORMED_ARCHIVE', message: 'blocked' },
        trace: { classifierState },
      } as FlaInspectionResponse;
      expect(routeFlaInspection(response)).toBe('blocked');
    }
  });
});
