import type Konva from 'konva';
import { Shape } from 'react-konva';
import type { EvaluatedPinWarpMesh } from '../../domain';
import { drawPinWarpImage } from './pinWarpCanvas';

export interface PinWarpImageProps {
  image: CanvasImageSource;
  mesh: EvaluatedPinWarpMesh;
}

/**
 * Konva Shape that paints the shared evaluated pin-warp mesh via Canvas 2D
 * per-triangle affine texture mapping (#1460). Used by the shared Stage
 * renderer (Stage/Preview/Export) and by the editor canvas so all surfaces draw
 * the same evaluated mesh.
 *
 * The Shape is a painting primitive only; selection hit-testing stays on the
 * owning Layer's normal bounds so un-warped and warped Layers behave the same.
 */
export function PinWarpImage({ image, mesh }: PinWarpImageProps): React.JSX.Element {
  const sceneFunc = (context: Konva.Context): void => {
    // Konva's Context proxies most 2D methods but not the full surface this
    // helper needs, so draw onto the wrapped native 2D context. The base
    // transform/opacity Konva already applied are preserved.
    const renderingContext = (
      context as unknown as { _context?: CanvasRenderingContext2D }
    )._context;
    if (!renderingContext) return;
    drawPinWarpImage(renderingContext, image, mesh);
  };
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={sceneFunc}
    />
  );
}
