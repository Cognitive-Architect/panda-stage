import { useMemo, type ReactNode } from 'react';
import { Group } from 'react-konva';
import type { CoverageMaskClip } from '../../domain';

/**
 * Clips Stage/Canvas children to an author-level coverage mask (#1454).
 *
 * The geometry is precomputed in `src/domain/selectors/coverageMaskGeometry.ts`
 * in stage coordinates and the clip fill rule is resolved there: polygon regions
 * are normalized to a single non-negative `nonzero` winding
 * (`coverageMaskFillRule.ts`), while a mask consisting only of authored Bézier
 * regions keeps its authored `evenodd`/`nonzero` rule instead of a converted
 * approximation (#1469 F4). This wrapper must not add a transform of its own.
 * Renderers place it at the identity (camera-world) root, directly wrapping the
 * target Layer's existing `StageLayerSpace` so the clip and the drawn content
 * share the exact same coordinate space.
 *
 * An empty-but-valid coverage compiles to an empty `Path2D` clip, which hides
 * the target (the same result as the FLA `destination-in` mask with no painted
 * shapes) instead of silently degrading to the unclipped Layer.
 */

const compiledPathCache = new WeakMap<CoverageMaskClip, Path2D | null>();

function compileCoveragePath(clip: CoverageMaskClip): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  const cached = compiledPathCache.get(clip);
  if (cached !== undefined) return cached;
  const d = clip.paths.map((path) => path.d).join(' ').trim();
  let compiled: Path2D | null;
  try {
    compiled = d ? new Path2D(d) : new Path2D();
  } catch {
    compiled = null;
  }
  compiledPathCache.set(clip, compiled);
  return compiled;
}

export type CoverageMaskClipFunc = () => [Path2D, CanvasFillRule];

/**
 * Compiles one resolved clip into a Konva `clipFunc`. Returns null when the
 * runtime has no Path2D, so callers degrade to the unclipped Layer instead of
 * drawing an empty clip.
 */
export function createCoverageMaskClipFunc(
  clip: CoverageMaskClip,
): CoverageMaskClipFunc | null {
  const path = compileCoveragePath(clip);
  if (!path) return null;
  // Konva applies a single clip for the group, so the domain resolves one
  // homogeneous rule for every path in the clip (see coverageMaskGeometry.ts).
  return () => [path, clip.fillRule];
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
