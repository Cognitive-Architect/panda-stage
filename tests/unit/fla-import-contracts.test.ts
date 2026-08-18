import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FLA_IMPORT_LIMITS,
  FLA_PARSER_COMMIT,
  FLA_PARSER_ENTRYPOINT,
  FLA_PARSER_PACKAGE,
  FlaImportErrorCodeSchema,
  FlaInspectionResponseSchema,
} from '../../src/shared/fla-import-api';

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
        ir: { ...valid.ir, projectRoot: 'C:\\outside' },
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

  it('allows parser imports only in the adapter and keeps upstream objects inside the closure', () => {
    const files = sourceFiles(sourceRoot);
    const outsideParserCore = files.filter(
      (filePath) => !filePath.includes(`${path.sep}parser-core${path.sep}`),
    );
    const parserImportOwners = outsideParserCore.filter((filePath) =>
      /from\s+['"]\.\/parser-core\//u.test(readFileSync(filePath, 'utf8')),
    );
    expect(parserImportOwners.map((filePath) => path.relative(sourceRoot, filePath))).toEqual([
      'fla-viewer-adapter.ts',
    ]);

    const thirdPartyImportOwners = files.filter((filePath) =>
      /from\s+['"](?:jszip|pako)['"]/u.test(readFileSync(filePath, 'utf8')),
    );
    expect(thirdPartyImportOwners.map((filePath) => path.relative(sourceRoot, filePath))).toEqual([
      path.join('parser-core', 'fla-parser.ts'),
    ]);

    const nonAdapterSources = outsideParserCore.filter(
      (filePath) => !filePath.endsWith(`${path.sep}fla-viewer-adapter.ts`),
    );
    for (const filePath of nonAdapterSources) {
      expect(readFileSync(filePath, 'utf8')).not.toMatch(
        /\b(?:FLADocument|BitmapItem|HTMLImageElement|JSZip|Blob)\b/u,
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
