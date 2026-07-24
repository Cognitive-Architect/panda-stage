import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MediaInspectionService,
  declaredMimeTypeForPath,
} from '../../src/main/services/MediaInspectionService';

const fixtures = path.resolve('tests/fixtures/assets');

describe('MediaInspectionService', () => {
  const service = new MediaInspectionService();

  it.each([
    ['熊猫 图片.png', 'image/png', 'image', 16, 12],
    ['熊猫 照片.jpg', 'image/jpeg', 'image', 18, 14],
    ['熊猫 声音.mp3', 'audio/mpeg', 'audio', undefined, undefined],
    ['熊猫 声音.wav', 'audio/wav', 'audio', undefined, undefined],
  ] as const)(
    'validates the extension, declaration, and real contents of %s',
    async (fileName, mimeType, kind, width, height) => {
      const inspected = await service.inspect(
        path.join(fixtures, fileName),
        mimeType,
      );
      expect(inspected).toMatchObject({ mimeType, kind });
      if (kind === 'image') {
        expect(inspected).toMatchObject({ width, height });
      } else {
        expect(inspected).not.toHaveProperty('width');
        expect(inspected).not.toHaveProperty('height');
      }
    },
  );

  it('rejects an extension-disguised text file', async () => {
    await expect(
      service.inspect(
        path.join(fixtures, '伪装 图片.png'),
        'image/png',
      ),
    ).rejects.toMatchObject({
      code: 'ASSET_IMPORT_INVALID_CONTENT',
    });
  });

  it('rejects a declared media type that disagrees with the extension', async () => {
    await expect(
      service.inspect(
        path.join(fixtures, '熊猫 图片.png'),
        'image/jpeg',
      ),
    ).rejects.toMatchObject({
      code: 'ASSET_IMPORT_DECLARED_TYPE_MISMATCH',
    });
  });

  it('maps only the supported native-picker extensions', () => {
    expect(declaredMimeTypeForPath('asset.PNG')).toBe('image/png');
    expect(declaredMimeTypeForPath('asset.jpeg')).toBe('image/jpeg');
    expect(declaredMimeTypeForPath('asset.gif')).toBeNull();
  });
});
