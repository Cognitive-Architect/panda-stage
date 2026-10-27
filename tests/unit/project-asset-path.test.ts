import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const realpathMock = vi.hoisted(() => vi.fn());

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, realpath: realpathMock };
});

import { resolveProjectAssetPath } from '../../src/main/services/project-asset-path';

afterEach(() => {
  vi.resetAllMocks();
});

describe('resolveProjectAssetPath', () => {
  it('preserves filesystem permission errors for read callers that request them', async () => {
    const projectRoot = path.resolve('fixture-project');
    const assetsRoot = path.resolve(projectRoot, 'assets');
    const permissionError = Object.assign(new Error('access is denied'), {
      code: 'EPERM',
    });
    realpathMock
      .mockResolvedValueOnce(assetsRoot)
      .mockRejectedValueOnce(permissionError);

    await expect(
      resolveProjectAssetPath(
        projectRoot,
        path.join('assets', 'background.png'),
        { preservePermissionErrors: true },
      ),
    ).rejects.toMatchObject({ code: 'EPERM' });
  });

  it('continues treating inaccessible paths as unavailable for ordinary path checks', async () => {
    const projectRoot = path.resolve('fixture-project');
    const assetsRoot = path.resolve(projectRoot, 'assets');
    realpathMock
      .mockResolvedValueOnce(assetsRoot)
      .mockRejectedValueOnce(
        Object.assign(new Error('access is denied'), { code: 'EPERM' }),
      );

    await expect(
      resolveProjectAssetPath(
        projectRoot,
        path.join('assets', 'background.png'),
      ),
    ).resolves.toBeNull();
  });
});
