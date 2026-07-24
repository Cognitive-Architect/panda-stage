import { describe, expect, it } from 'vitest';
import { AudioAssetSchema, ProjectSchema } from '../../src/domain';
import { sanitizeAssetFileName } from '../../src/main/services/AssetImportService';
import {
  AssetImportDroppedRequestSchema,
  AssetImportResponseSchema,
  declaredMimeTypeForAssetPath,
} from '../../src/shared/asset-import-api';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('asset import contracts', () => {
  it('derives picker MIME declarations for supported file names', () => {
    expect(declaredMimeTypeForAssetPath('熊猫 图片.PNG')).toBe(
      'image/png',
    );
    expect(declaredMimeTypeForAssetPath('voice.mp3')).toBe('audio/mpeg');
    expect(declaredMimeTypeForAssetPath('asset.txt')).toBeNull();
  });

  it('accepts imported audio before duration metadata exists', () => {
    expect(
      AudioAssetSchema.parse({
        id: '16000000-0000-4000-8000-000000000001',
        name: 'Imported audio',
        relativePath: 'assets/imported.mp3',
        mimeType: 'audio/mpeg',
        kind: 'audio',
      }),
    ).not.toHaveProperty('durationMs');
  });

  it('rejects using duration-less audio on the timeline', () => {
    const project = structuredClone(exampleProject);
    const audio = project.assets.find((asset) => asset.kind === 'audio')!;
    delete (audio as { durationMs?: number }).durationMs;

    expect(ProjectSchema.safeParse(project)).toMatchObject({
      success: false,
      error: {
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['shots', 0, 'audioClips', 0, 'assetId'],
            message: expect.stringContaining('duration metadata'),
          }),
        ]),
      },
    });
  });

  it('sanitizes traversal and Windows-reserved characters from targets', () => {
    expect(sanitizeAssetFileName('..\\坏:name?.PNG', '.png')).toBe(
      '坏_name_.png',
    );
  });

  it('keeps request and response payloads strict', () => {
    expect(
      AssetImportDroppedRequestSchema.safeParse({
        projectRoot: 'D:\\project.pandastage',
        project: exampleProject,
        baseRevision: 0,
        candidates: [
          {
            sourcePath: 'D:\\source.png',
            declaredMimeType: 'image/png',
            execute: 'fs.read',
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      AssetImportResponseSchema.safeParse({
        ok: true,
        status: 'cancelled',
        project: exampleProject,
      }).success,
    ).toBe(false);
  });
});
