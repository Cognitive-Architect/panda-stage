import { realpath } from 'node:fs/promises';
import path from 'node:path';

export async function resolveProjectAssetPath(
  projectRoot: string,
  relativePath: string,
): Promise<string | null> {
  const assetsRoot = path.resolve(projectRoot, 'assets');
  const assetPath = path.resolve(projectRoot, relativePath);
  if (!isInsideDirectory(assetsRoot, assetPath)) return null;

  try {
    const [realAssetsRoot, realAssetPath] = await Promise.all([
      realpath(assetsRoot),
      realpath(assetPath),
    ]);
    return isInsideDirectory(realAssetsRoot, realAssetPath)
      ? realAssetPath
      : null;
  } catch {
    return null;
  }
}

function isInsideDirectory(directory: string, candidate: string): boolean {
  const relative = path.relative(directory, candidate);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative)
  );
}
