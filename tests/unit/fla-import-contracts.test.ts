import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLA_IMPORT_LIMITS,
  FLA_PARSER_COMMIT,
  FLA_PARSER_ENTRYPOINT,
  FLA_PARSER_PACKAGE,
  FlaDiagnosticCategorySchema,
  FlaImportErrorCodeSchema,
  FlaInspectionResponseSchema,
  FlaRasterSelectionIntentSchema,
} from '../../src/shared/fla-import-api';
import { FlaAssetCommitRequestSchema } from '../../src/shared/fla-asset-commit-api';
import { migrateProject } from '../../src/domain';
import exampleProject from '../../demo-project/project-v1.example.json';

const sourceRoot = path.resolve(__dirname, '../../src/renderer/fla-import');

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return /\.(ts|tsx)$/u.test(entry.name) ? [entryPath] : [];
  });
}

describe('FLA import contracts and parser boundary', () => {
  it('pins the parser closure and all resource limits', () => {
    expect(FLA_PARSER_PACKAGE).toBe('lifeart/fla-viewer');
    expect(FLA_PARSER_ENTRYPOINT).toBe('FLAParser.parse');
    expect(FLA_PARSER_COMMIT).toBe('048000ccab67469980b8dedd1fc2b65a02d2b164');
    expect(FLA_IMPORT_LIMITS).toMatchObject({
      maxSourceBytes: 256 * 1024 * 1024,
      maxZipEntries: 20_000,
      maxExpandedArchiveBytes: 1024 * 1024 * 1024,
      maxSingleEntryBytes: 64 * 1024 * 1024,
      maxXmlBytes: 32 * 1024 * 1024,
      maxMediaCount: 2_048,
      maxImageWidth: 4_096,
      maxImageHeight: 4_096,
      maxImagePixels: 16_777_216,
      maxTotalDecodedPixels: 128_000_000,
      maxTotalDecodedRgbaBytes: 512 * 1024 * 1024,
      parserWallTimeMs: 30_000,
      noProgressWatchdogMs: 5_000,
      cancelGraceMs: 2_000,
      maxRecursionDepth: 64,
    });
    expect(FlaImportErrorCodeSchema.options).toEqual([
      'UNSUPPORTED_FLA_CONTAINER',
      'ARCHIVE_LIMIT_EXCEEDED',
      'MALFORMED_ARCHIVE',
      'MALFORMED_XFL',
      'XML_LIMIT_EXCEEDED',
      'PARSER_TIMEOUT',
      'PARSER_CRASH',
      'MEDIA_LIMIT_EXCEEDED',
      'MEDIA_DECODE_FAILED',
      'UNSUPPORTED_FEATURE_PRESENT',
      'USER_CANCELLED',
    ]);
  });

  it('exposes the three V1.5-A diagnostic categories', () => {
    expect(FlaDiagnosticCategorySchema.options).toEqual([
      'archive-malformed',
      'no-importable-raster',
      'unsupported-or-unknown',
    ]);
  });

  it('keeps cancellation and IR response payloads strict and Panda-owned', () => {
    const valid = {
      ok: true as const,
      sessionId: '00000000-0000-4000-8000-000000000251',
      ir: {
        source: {
          format: 'fla' as const,
          basename: 'sample.fla',
          byteLength: 1,
          sha256: 'a'.repeat(64),
          parser: {
            package: FLA_PARSER_PACKAGE,
            entrypoint: FLA_PARSER_ENTRYPOINT,
            commit: FLA_PARSER_COMMIT,
          },
        },
        document: { width: 1, height: 1, frameRate: 1, backgroundColor: '#fff' },
        media: [],
        timelines: [],
        compatibility: [],
        summary: { placedInstanceCount: 0, libraryOnlyMediaCount: 0 },
      },
    };
    expect(FlaInspectionResponseSchema.safeParse(valid).success).toBe(true);
    expect(
      FlaInspectionResponseSchema.safeParse({
        ...valid,
        ir: {
          ...valid.ir,
          compatibility: [
            { feature: 'symbols', status: 'not-present', reason: 'none found' },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      FlaInspectionResponseSchema.safeParse({
        ...valid,
        ir: { ...valid.ir, projectRoot: 'C:\\outside' },
      }).success,
    ).toBe(false);
    expect(
      FlaRasterSelectionIntentSchema.safeParse({
        format: 'fla-raster-selection',
        version: 1,
        sessionId: valid.sessionId,
        source: { basename: 'sample.fla', sha256: 'a'.repeat(64) },
        selectedMediaIds: [],
        selectedCount: 0,
      }).success,
    ).toBe(true);
    expect(
      FlaRasterSelectionIntentSchema.safeParse({
        format: 'fla-raster-selection',
        version: 1,
        sessionId: valid.sessionId,
        source: { basename: 'sample.fla', sha256: 'a'.repeat(64) },
        selectedMediaIds: ['fla-media-duplicate-0001', 'fla-media-duplicate-0001'],
        selectedCount: 2,
      }).success,
    ).toBe(false);
    expect(
      FlaInspectionResponseSchema.safeParse({
        ok: false,
        error: { code: 'USER_CANCELLED', message: 'cancelled' },
        sessionId: valid.sessionId,
      }).success,
    ).toBe(false);
  });

  it('allows bounded diagnostics on both inspection response branches', () => {
    const base = {
      source: {
        format: 'fla' as const,
        basename: 'sample.fla',
        byteLength: 1,
        sha256: 'a'.repeat(64),
        parser: {
          package: FLA_PARSER_PACKAGE,
          entrypoint: FLA_PARSER_ENTRYPOINT,
          commit: FLA_PARSER_COMMIT,
        },
      },
      document: { width: 1, height: 1, frameRate: 1, backgroundColor: '#fff' },
      media: [] as unknown[],
      timelines: [],
      compatibility: [],
      summary: { placedInstanceCount: 0, libraryOnlyMediaCount: 0 },
    };
    const ok = FlaInspectionResponseSchema.safeParse({
      ok: true as const,
      sessionId: '00000000-0000-4000-8000-000000000251',
      ir: base,
      diagnostics: [
        { category: 'no-importable-raster', userMessage: '没有找到可直接导入的位图素材。' },
      ],
    });
    expect(ok.success).toBe(true);

    const fail = FlaInspectionResponseSchema.safeParse({
      ok: false as const,
      error: { code: 'MALFORMED_ARCHIVE', message: 'ZIP central directory exceeds the source boundary' },
      diagnostics: [
        {
          category: 'archive-malformed',
          userMessage: '此 FLA 文件的压缩包元数据不一致，已被当前安全规则拒绝导入。',
          developerNote: 'ZIP central directory exceeds the source boundary',
        },
      ],
    });
    expect(fail.success).toBe(true);
    expect(
      FlaInspectionResponseSchema.safeParse({
        ok: false as const,
        error: { code: 'MALFORMED_ARCHIVE', message: 'x' },
        diagnostics: [{ category: 'bogus', userMessage: 'y' }],
      }).success,
    ).toBe(false);
  });

  it('keeps Slice 3 commit requests identifier-only and confirmation-bound', () => {
    const project = migrateProject(exampleProject);
    const validRequest = {
      format: 'fla-raster-commit' as const,
      version: 1 as const,
      projectRoot: 'D:\\project.pandastage',
      project,
      baseRevision: 0,
      sessionId: '00000000-0000-4000-8000-000000000257',
      source: { basename: 'sample.fla', sha256: 'a'.repeat(64) },
      selectedMediaIds: ['fla-media-contract-0001'],
      selectedCount: 1,
      confirmed: true as const,
    };

    expect(FlaAssetCommitRequestSchema.safeParse(validRequest).success).toBe(true);
    expect(
      FlaAssetCommitRequestSchema.safeParse({
        ...validRequest,
        bytes: new Uint8Array([1, 2, 3]),
      }).success,
    ).toBe(false);
    expect(
      FlaAssetCommitRequestSchema.safeParse({
        ...validRequest,
        sourcePath: 'D:\\outside\\sample.fla',
      }).success,
    ).toBe(false);
    expect(
      FlaAssetCommitRequestSchema.safeParse({
        ...validRequest,
        selectedMediaIds: [],
        selectedCount: 0,
      }).success,
    ).toBe(false);
    expect(
      FlaAssetCommitRequestSchema.safeParse({
        ...validRequest,
        confirmed: false,
      }).success,
    ).toBe(false);
  });

  it('allows parser imports only in the adapter and keeps upstream objects inside the closure', () => {
    const files = sourceFiles(sourceRoot);
    const outsideParserCore = files.filter(
      (filePath) => !filePath.includes(`${path.sep}parser-core${path.sep}`),
    );
    const parserImportOwners = outsideParserCore.filter((filePath) =>
      /from\s+['"]\.\/parser-core\//u.test(readFileSync(filePath, 'utf8')),
    );
    expect(parserImportOwners.map((filePath) => path.relative(sourceRoot, filePath))).toEqual([
      'derive-fla-structure-summary.ts',
      'fla-viewer-adapter.ts',
    ]);

    const thirdPartyImportOwners = files.filter((filePath) =>
      /from\s+['"](?:jszip|pako)['"]/u.test(readFileSync(filePath, 'utf8')),
    );
    expect(thirdPartyImportOwners.map((filePath) => path.relative(sourceRoot, filePath))).toEqual([
      path.join('parser-core', 'fla-parser.ts'),
    ]);

    const nonAdapterSources = outsideParserCore.filter(
      (filePath) =>
        !filePath.endsWith(`${path.sep}fla-viewer-adapter.ts`) &&
        !filePath.endsWith(`${path.sep}derive-fla-structure-summary.ts`),
    );
    for (const filePath of nonAdapterSources) {
      // Slice 2 may create a short-lived Blob/object URL from already-owned
      // PNG bytes for the review thumbnail. That is a renderer preview
      // resource, not an upstream parser object or type.
      // R1 static snapshot preview (FlaStaticSnapshotReview.tsx) likewise
      // builds a short-lived Blob/object URL from already-owned PNG bytes
      // returned by the sandboxed renderer; it is a renderer preview
      // resource, not an upstream parser object or type.
      // R2 frame sequence review (FlaFrameSequenceReview.tsx) builds the
      // same kind of short-lived Blob/object URL from the Main-owned
      // per-frame PNG bytes returned by the R2 success envelope; the PNG
      // bytes never accumulate on the Renderer (R2-E invariant), they are
      // transient preview resources only (Corrective B).
      // `derive-fla-structure-summary.ts` is the V1.5-B1 read-only counts
      // derivation; it consumes FLADocument only as a TypeScript type to walk
      // its own property fields and emits only Panda-owned numbers (no
      // FLADocument value crosses this module's boundary).
      const previewResource =
        filePath.endsWith(`${path.sep}FlaCompatibilityReviewSession.tsx`) ||
        filePath.endsWith(`${path.sep}FlaStaticSnapshotReview.tsx`) ||
        filePath.endsWith(`${path.sep}FlaFrameSequenceReview.tsx`);
      const forbidden = previewResource
        ? /\b(?:FLADocument|BitmapItem|HTMLImageElement|JSZip)\b/u
        : /\b(?:FLADocument|BitmapItem|HTMLImageElement|JSZip|Blob)\b/u;
      expect(readFileSync(filePath, 'utf8')).not.toMatch(
        forbidden,
      );
    }
  });

  it('keeps the worker window isolated and network/navigation constrained', () => {
    const managerSource = readFileSync(
      path.resolve(__dirname, '../../src/main/windows/fla-parser-window-manager.ts'),
      'utf8',
    );
    expect(managerSource).toContain('contextIsolation: true');
    expect(managerSource).toContain('nodeIntegration: false');
    expect(managerSource).toContain('sandbox: true');
    expect(managerSource).toContain('webviewTag: false');
    expect(managerSource).toContain('setWindowOpenHandler');
    expect(managerSource).toContain("on('will-navigate'");
    expect(managerSource).toContain('webRequest.onBeforeRequest');
    expect(statSync(path.join(sourceRoot, 'parser-core')).isDirectory()).toBe(true);
  });
});
