import type {
  CharacterPart,
  LayerVisualPart,
  PartPosePoint,
} from '../../../domain';

export function sourcePointToLayer(
  visualPart: LayerVisualPart | null,
  characterPart: CharacterPart | null,
  sourcePoint: PartPosePoint,
): { x: number; y: number } | null {
  const transform = visualPart?.imageTransform;
  if (!transform || !characterPart) return null;
  const { crop, exportScale } = characterPart.imageMapping;
  const imageX = (sourcePoint.x - crop.x) * exportScale;
  const imageY = (sourcePoint.y - crop.y) * exportScale;
  const point = {
    x: transform.a * imageX + transform.c * imageY + transform.tx,
    y: transform.b * imageX + transform.d * imageY + transform.ty,
  };
  return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
}

export function layerPointToSource(
  layerPoint: { x: number; y: number },
  visualPart: LayerVisualPart | null,
  characterPart: CharacterPart | null,
): PartPosePoint | null {
  const transform = visualPart?.imageTransform;
  if (!transform || !characterPart) return null;
  const { crop, exportScale, sourceWidth, sourceHeight } =
    characterPart.imageMapping;
  const determinant = transform.a * transform.d - transform.b * transform.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) {
    return null;
  }
  const x = layerPoint.x - transform.tx;
  const y = layerPoint.y - transform.ty;
  const imageX = (transform.d * x - transform.c * y) / determinant;
  const imageY = (-transform.b * x + transform.a * y) / determinant;
  const sourcePoint = {
    x: crop.x + imageX / exportScale,
    y: crop.y + imageY / exportScale,
  };
  if (
    !Number.isFinite(sourcePoint.x) ||
    !Number.isFinite(sourcePoint.y) ||
    sourcePoint.x < 0 ||
    sourcePoint.x > sourceWidth ||
    sourcePoint.y < 0 ||
    sourcePoint.y > sourceHeight
  ) {
    return null;
  }
  return sourcePoint;
}
