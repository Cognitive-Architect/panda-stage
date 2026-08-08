export interface StageSize {
  width: number;
  height: number;
}

export interface CoverTransform extends StageSize {
  x: number;
  y: number;
  scale: number;
}

export interface StageLayerVisualInput {
  id: string;
  assetId: string;
  assetWidth: number;
  assetHeight: number;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
}

export interface StageLayerRenderInstruction {
  id: string;
  assetId: string;
  isBackground: boolean;
  listening: false;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
  coverScale: number | null;
}

export function calculateCoverTransform(
  source: StageSize,
  destination: StageSize,
): CoverTransform | null {
  if (
    !Number.isFinite(source.width) ||
    !Number.isFinite(source.height) ||
    !Number.isFinite(destination.width) ||
    !Number.isFinite(destination.height) ||
    source.width <= 0 ||
    source.height <= 0 ||
    destination.width <= 0 ||
    destination.height <= 0
  ) {
    return null;
  }
  const scale = Math.max(
    destination.width / source.width,
    destination.height / source.height,
  );
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    scale,
    width,
    height,
    x: (destination.width - width) / 2,
    y: (destination.height - height) / 2,
  };
}

export function buildStageLayerRenderInstruction(
  layer: StageLayerVisualInput,
  stage: StageSize,
  isBackground: boolean,
): StageLayerRenderInstruction {
  if (isBackground) {
    const cover = calculateCoverTransform(
      { width: layer.assetWidth, height: layer.assetHeight },
      stage,
    );
    if (!cover) {
      throw new Error(`Cannot cover stage with layer ${layer.id}.`);
    }
    return {
      id: layer.id,
      assetId: layer.assetId,
      isBackground: true,
      listening: false,
      // Background geometry is persisted on the layer. The cover value is
      // retained as diagnostic metadata, while the actual render uses the
      // authored layer dimensions and transform so old projects are not
      // silently rewritten on load and manual edits survive reopen.
      x: layer.x,
      y: layer.y,
      width: layer.assetWidth,
      height: layer.assetHeight,
      offsetX: layer.assetWidth / 2,
      offsetY: layer.assetHeight / 2,
      scaleX: layer.flipX ? -layer.scaleX : layer.scaleX,
      scaleY: layer.scaleY,
      rotationDeg: layer.rotationDeg,
      opacity: layer.opacity,
      visible: layer.visible,
      zIndex: layer.zIndex,
      coverScale: cover.scale,
    };
  }

  return {
    id: layer.id,
    assetId: layer.assetId,
    isBackground: false,
    listening: false,
    x: layer.x,
    y: layer.y,
    width: layer.assetWidth,
    height: layer.assetHeight,
    offsetX: layer.assetWidth / 2,
    offsetY: layer.assetHeight / 2,
    scaleX: layer.flipX ? -layer.scaleX : layer.scaleX,
    scaleY: layer.scaleY,
    rotationDeg: layer.rotationDeg,
    opacity: layer.opacity,
    visible: layer.visible,
    zIndex: layer.zIndex,
    coverScale: null,
  };
}
