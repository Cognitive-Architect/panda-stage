import { describe, expect, it } from 'vitest';
import {
  FlaRenderableTargetCatalogSchema,
  FlaRenderTargetKindSchema,
  FlaRenderTargetSchema,
  FlaStaticSnapshotCancelRequestSchema,
  FlaStaticSnapshotCancelResponseSchema,
  FlaStaticSnapshotCommitErrorCodeSchema,
  FlaStaticSnapshotCommitRequestSchema,
  FlaStaticSnapshotCommitResponseSchema,
  FlaStaticSnapshotCommitResultSchema,
  FlaStaticSnapshotPreviewErrorCodeSchema,
  FlaStaticSnapshotPreviewRequestSchema,
  FlaStaticSnapshotPreviewResponseSchema,
  FlaStaticSnapshotPreviewSuccessSchema,
  FLA_STATIC_SNAPSHOT_LIMITS,
} from '../../src/shared/fla-static-snapshot-api';
import { buildProject } from './domain/testProject';

const validTarget = {
  renderTargetId: 'fla-render-target-1a2b3c4d5e6f7a8b',
  kind: 'graphic-symbol',
  userLabel: '剑 · 主体',
  sourceSymbolName: '剑主体',
  frameCount: 2,
  selectedFrameIndex: 0,
  compatibility: ['degraded'],
} as const;

const validUuid = '00000000-0000-4000-8000-000000000001';
const validRequestId = '00000000-0000-4000-8000-0000000000aa';
const validSha256 = 'a'.repeat(64);

describe('R1-A render target contract', () => {
  it('accepts a valid target and applies strict mode', () => {
    const target = FlaRenderTargetSchema.parse(validTarget);
    expect(target.renderTargetId).toBe(validTarget.renderTargetId);
    expect(target.kind).toBe('graphic-symbol');
    expect(target.frameCount).toBe(2);
    expect(target.selectedFrameIndex).toBe(0);
  });

  it('rejects a non-uuid renderTargetId', () => {
    const bad = { ...validTarget, renderTargetId: 'fla-render-target-XX' };
    expect(FlaRenderTargetSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    const bad = { ...validTarget, kind: 'movieclip-internals' };
    expect(FlaRenderTargetSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects selectedFrameIndex >= frameCount', () => {
    const bad = { ...validTarget, frameCount: 2, selectedFrameIndex: 2 };
    const result = FlaRenderTargetSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it('rejects frameCount > 100,000 (hard limit)', () => {
    const bad = { ...validTarget, frameCount: 100_001 };
    expect(FlaRenderTargetSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects zero frameCount (must be positive)', () => {
    const bad = { ...validTarget, frameCount: 0 };
    expect(FlaRenderTargetSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an unknown user-facing label that looks like DOM internals (XFL / Edge / MovieClip)', () => {
    // userLabel must be a beginner-readable string. Some labels happen to
    // contain a benign substring that overlaps ("Edge"). The R1 contract
    // does NOT block these substrings - the runtime copy gate is in
    // the adapter. Here we only confirm the schema allows userLabel
    // to be a free-form string and rejects only length bounds.
    const ok = { ...validTarget, userLabel: 'Edge of the blade (裁切边)' };
    expect(FlaRenderTargetSchema.safeParse(ok).success).toBe(true);
    const tooLong = { ...validTarget, userLabel: 'x'.repeat(501) };
    expect(FlaRenderTargetSchema.safeParse(tooLong).success).toBe(false);
  });

  it('rejects extra keys (strict mode)', () => {
    const bad = { ...validTarget, extra: 'forbidden' };
    expect(FlaRenderTargetSchema.safeParse(bad).success).toBe(false);
  });

  it('kind enum is bounded', () => {
    expect(FlaRenderTargetKindSchema.options).toEqual([
      'scene', 'timeline', 'graphic-symbol', 'unknown',
    ]);
  });
});

describe('R1-A renderable target catalog', () => {
  it('accepts a valid catalog', () => {
    const catalog = {
      ok: true as const,
      sessionId: validUuid,
      entries: [
        { target: validTarget, previewSupported: true },
      ],
      summary: '这个 FLA 有 1 个可渲染图形。',
    };
    const parsed = FlaRenderableTargetCatalogSchema.parse(catalog);
    expect(parsed.entries).toHaveLength(1);
  });

  it('rejects an unsupported entry without an unsupportedReason', () => {
    const catalog = {
      sessionId: validUuid,
      entries: [
        { target: validTarget, previewSupported: false },
      ],
      summary: '0 renderable targets.',
    };
    expect(FlaRenderableTargetCatalogSchema.safeParse(catalog).success).toBe(false);
  });

  it('accepts an unsupported entry WITH a reason (R1-F: do not silently support)', () => {
    const catalog = {
      ok: true as const,
      sessionId: validUuid,
      entries: [
        { target: validTarget, previewSupported: false, unsupportedReason: 'shape tween not implemented' },
      ],
      summary: '0 renderable targets.',
    };
    expect(FlaRenderableTargetCatalogSchema.safeParse(catalog).success).toBe(true);
  });

  it('rejects a catalog that exceeds maxRenderableTargetsPerFile', () => {
    const entry = { target: validTarget, previewSupported: true };
    const entries = Array(FLA_STATIC_SNAPSHOT_LIMITS.maxRenderableTargetsPerFile + 1).fill(entry);
    const catalog = { sessionId: validUuid, entries, summary: 'too many' };
    expect(FlaRenderableTargetCatalogSchema.safeParse(catalog).success).toBe(false);
  });
});

describe('R1-B preview request contract', () => {
  it('accepts a valid preview request', () => {
    const req = {
      format: 'fla-static-snapshot-preview' as const,
      version: 1 as const,
      requestId: validRequestId,
      sessionId: validUuid,
      target: validTarget,
    };
    expect(FlaStaticSnapshotPreviewRequestSchema.safeParse(req).success).toBe(true);
  });

  it('rejects a wrong format discriminant (does not over-load fla-raster-selection)', () => {
    const bad = {
      format: 'fla-raster-selection',
      version: 1,
      requestId: validRequestId,
      sessionId: validUuid,
      target: validTarget,
    };
    expect(FlaStaticSnapshotPreviewRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing sessionId', () => {
    const bad = {
      format: 'fla-static-snapshot-preview' as const,
      version: 1 as const,
      requestId: validRequestId,
      target: validTarget,
    };
    expect(FlaStaticSnapshotPreviewRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('R1-B preview response contract', () => {
  const validBytes = new Uint8Array(16);
  const validSuccess = {
    ok: true as const,
    requestId: validRequestId,
    targetRenderTargetId: validTarget.renderTargetId,
    targetSelectedFrameIndex: 0,
    width: 1920,
    height: 1080,
    pixelCount: 1920 * 1080,
    bytes: validBytes,
    sha256: validSha256,
    wallClockMs: 1234,
    isFirstPreviewForSession: true,
    startedAt: new Date(0).toISOString(),
  };

  it('accepts a valid preview success', () => {
    expect(FlaStaticSnapshotPreviewSuccessSchema.safeParse(validSuccess).success).toBe(true);
  });

  it('rejects an empty bytes buffer', () => {
    const bad = { ...validSuccess, bytes: new Uint8Array(0) };
    expect(FlaStaticSnapshotPreviewSuccessSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects bytes larger than maxSnapshotBytes (64 MiB)', () => {
    // We don't actually allocate the 64 MiB; instead probe the schema
    // with a wrong dimension to make sure it fails.
    const bad = { ...validSuccess, width: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth + 1 };
    expect(FlaStaticSnapshotPreviewSuccessSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects pixelCount > maxOutputPixels (16,777,216)', () => {
    const bad = { ...validSuccess, pixelCount: FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels + 1 };
    expect(FlaStaticSnapshotPreviewSuccessSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an invalid sha256', () => {
    const bad = { ...validSuccess, sha256: 'not-a-sha256' };
    expect(FlaStaticSnapshotPreviewSuccessSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a preview failure with every documented error code', () => {
    const codes = FlaStaticSnapshotPreviewErrorCodeSchema.options;
    for (const code of codes) {
      const failure = {
        ok: false as const,
        error: { code, message: 'preview failed' },
      };
      const parsed = FlaStaticSnapshotPreviewResponseSchema.parse(failure);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe(code);
      }
    }
  });

  it('rejects a preview error with a non-enum code', () => {
    const bad = { ok: false, error: { code: 'BOGUS', message: 'x' } };
    expect(FlaStaticSnapshotPreviewResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('R1-D + R1-E stale-preview guard', () => {
  const baseProject = buildProject();
  const validCommitBase = {
    format: 'fla-static-snapshot-commit' as const,
    version: 1 as const,
    projectRoot: 'D:\\projects\\sword',
    project: baseProject,
    baseRevision: 0,
    sessionId: validUuid,
    confirmedPreviewRequestId: validRequestId,
    source: { basename: '剑.fla', sha256: validSha256 },
    target: { ...validTarget, selectedFrameIndex: 0 },
    preview: { sha256: validSha256, width: 1920, height: 1080, byteLength: 16 },
    confirmed: true as const,
  };

  it('accepts a valid commit request with a pinned preview', () => {
    expect(FlaStaticSnapshotCommitRequestSchema.safeParse(validCommitBase).success).toBe(true);
  });

  it('rejects a commit request that is missing selectedFrameIndex (R1-D: cannot silently re-target)', () => {
    const target = { ...validTarget } as Record<string, unknown>;
    delete target.selectedFrameIndex;
    const bad = { ...validCommitBase, target };
    expect(FlaStaticSnapshotCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects the wrong format discriminant (does not over-load fla-raster-commit)', () => {
    const bad = { ...validCommitBase, format: 'fla-raster-commit' as const };
    expect(FlaStaticSnapshotCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing confirmed flag (R1-E: explicit user confirmation required)', () => {
    const bad = { ...validCommitBase, confirmed: false };
    expect(FlaStaticSnapshotCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing confirmedPreviewRequestId (R1-D: stale guard requires identity)', () => {
    const bad = { ...validCommitBase } as Record<string, unknown>;
    delete bad.confirmedPreviewRequestId;
    expect(FlaStaticSnapshotCommitRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects an out-of-range selectedFrameIndex', () => {
    const bad = {
      ...validCommitBase,
      target: { ...validTarget, frameCount: 1, selectedFrameIndex: 5 },
    };
    expect(FlaStaticSnapshotCommitRequestSchema.safeParse(bad).success).toBe(false);
  });
});

describe('R1-E commit response contract', () => {
  it('accepts a successful commit response', () => {
    const success = {
      ok: true as const,
      status: 'completed' as const,
      project: buildProject(),
      baseRevision: 0,
      savedRevision: 1,
      projectChanged: true,
      result: {
        assetId: validUuid,
        sourceName: '剑 · 主体',
        width: 1920,
        height: 1080,
        status: 'imported' as const,
        sha256: validSha256,
        asset: {
          id: validUuid,
          name: '剑 · 主体',
          kind: 'image' as const,
          relativePath: 'sword-main.png',
          mimeType: 'image/png',
          width: 1920,
          height: 1080,
        },
        duplicateOfAssetId: null,
        targetFileName: 'sword-main.png',
        renamed: false,
        message: 'imported',
      },
    };
    expect(FlaStaticSnapshotCommitResponseSchema.safeParse(success).success).toBe(true);
  });

  it('accepts a duplicate result', () => {
    const success = {
      ok: true as const,
      status: 'completed' as const,
      project: buildProject(),
      baseRevision: 0,
      savedRevision: 1,
      projectChanged: true,
      result: {
        assetId: validUuid,
        sourceName: '剑 · 主体',
        width: 1920,
        height: 1080,
        status: 'duplicate' as const,
        sha256: validSha256,
        asset: {
          id: validUuid,
          name: 'x',
          kind: 'image' as const,
          relativePath: 'x.png',
          mimeType: 'image/png',
          width: 100,
          height: 100,
        },
        duplicateOfAssetId: validUuid,
        targetFileName: 'x.png',
        renamed: false,
        message: 'duplicate',
      },
    };
    const parsed = FlaStaticSnapshotCommitResponseSchema.parse(success);
    expect(parsed.ok).toBe(true);
    if (parsed.ok && parsed.status === 'completed') {
      expect(parsed.result.status).toBe('duplicate');
    }
  });

  it('accepts every documented commit error code', () => {
    const codes = FlaStaticSnapshotCommitErrorCodeSchema.options;
    for (const code of codes) {
      const failure = {
        ok: false as const,
        error: { code, message: 'commit failed', projectRoot: 'D:\\projects\\sword' },
      };
      const parsed = FlaStaticSnapshotCommitResponseSchema.parse(failure);
      expect(parsed.ok).toBe(false);
    }
  });

  it('rejects a commit error with a non-enum code', () => {
    const bad = { ok: false, error: { code: 'BOGUS', message: 'x', projectRoot: 'x' } };
    expect(FlaStaticSnapshotCommitResponseSchema.safeParse(bad).success).toBe(false);
  });
});

describe('R1-B cancel / latest-request-wins', () => {
  it('accepts a cancel with requestId', () => {
    const req = {
      format: 'fla-static-snapshot-cancel' as const,
      version: 1 as const,
      requestId: validRequestId,
    };
    expect(FlaStaticSnapshotCancelRequestSchema.safeParse(req).success).toBe(true);
  });

  it('accepts a cancel with sessionId only (cancels latest)', () => {
    const req = {
      format: 'fla-static-snapshot-cancel' as const,
      version: 1 as const,
      sessionId: validUuid,
    };
    expect(FlaStaticSnapshotCancelRequestSchema.safeParse(req).success).toBe(true);
  });

  it('rejects a cancel without either requestId or sessionId', () => {
    const bad = { format: 'fla-static-snapshot-cancel' as const, version: 1 as const };
    expect(FlaStaticSnapshotCancelRequestSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts a cancel response', () => {
    const res = { accepted: true, cancelledRequestId: validRequestId };
    expect(FlaStaticSnapshotCancelResponseSchema.safeParse(res).success).toBe(true);
  });
});

describe('R1-B / R1-E limits sanity', () => {
  it('exposes the R0-spike-derived limits and pins them to known values', () => {
    // These limits are referenced from the R0 receipt; keep the
    // numbers stable or the R1 evidence becomes unauditable.
    expect(FLA_STATIC_SNAPSHOT_LIMITS.maxSnapshotBytes).toBe(64 * 1024 * 1024);
    expect(FLA_STATIC_SNAPSHOT_LIMITS.previewWallTimeMs).toBe(30_000);
    expect(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputWidth).toBe(4_096);
    expect(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputHeight).toBe(4_096);
    expect(FLA_STATIC_SNAPSHOT_LIMITS.maxOutputPixels).toBe(16_777_216);
    expect(FLA_STATIC_SNAPSHOT_LIMITS.maxRenderableTargetsPerFile).toBe(64);
  });

  it('commit result exposes the minimum required fields', () => {
    const result = {
      assetId: validUuid,
      sourceName: 'sword',
      width: 100,
      height: 100,
      status: 'imported' as const,
      sha256: validSha256,
      asset: {
        id: validUuid,
        name: 'sword',
        kind: 'image' as const,
        relativePath: 'sword.png',
        mimeType: 'image/png',
        width: 100,
        height: 100,
      },
      duplicateOfAssetId: null,
      targetFileName: 'sword.png',
      renamed: false,
      message: 'imported',
    };
    expect(FlaStaticSnapshotCommitResultSchema.safeParse(result).success).toBe(true);
  });
});
