import { useMemo, type ReactNode } from 'react';
import { Group } from 'react-konva';
import type { CoverageMaskClip } from '../../domain';

/**
 * Clips Stage/Canvas children to an author-level coverage mask (#1454).
 *
 * The geometry is precomputed in `src/domain/selectors/coverageMaskGeometry.ts`
 * in stage coordinates, so this wrapper must not add a transform of its own.
 * Renderers place it at the identity (camera-world) root, directly wrapping the
 * target Layer's existing `StageLayerSpace` so the clip and the drawn content
 * share the exact same coordinate space.
 */

const compiledPathCache = new WeakMap<CoverageMaskClip, Path2D | null>();

function compileCoveragePath(clip: CoverageMaskClip): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  const cached = compiledPathCache.get(clip);
  if (cached !== undefined) return cached;
  const d = clip.paths.map((path) => path.d).join(' ').trim();
  let compiled: Path2D | null = null;
  if (d) {
    try {
      compiled = new Path2D(d);
    } catch {
      compiled = null;
    }
  }
  compiledPathCache.set(clip, compiled);
  return compiled;
}

export type CoverageMaskClipFunc = () => [Path2D, CanvasFillRule];

/**
 * Compiles one resolved clip into a Konva `clipFunc`. Returns null when the
 * runtime has no Path2D or the geometry is unusable, so callers degrade to the
 * unclipped Layer instead of drawing an empty clip.
 */
export function createCoverageMaskClipFunc(
  clip: CoverageMaskClip,
): CoverageMaskClipFunc | null {
  const path = compileCoveragePath(clip);
  if (!path) return null;
  return () => [path, 'nonzero'];
}

export function CoverageMaskClipGroup({
  clip,
  children,
}: {
  clip: CoverageMaskClip | null | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const clipFunc = useMemo(
    () => (clip ? createCoverageMaskClipFunc(clip) : null),
    [clip],
  );
  if (!clipFunc) return <>{children}</>;
  return (
    <Group
      clipFunc={clipFunc}
      name={`coverage-mask-clip:${clip!.maskLayerId}`}
    >
      {children}
    </Group>
  );
}
