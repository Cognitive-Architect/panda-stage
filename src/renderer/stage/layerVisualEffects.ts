import type Konva from 'konva';
import type { LayerVisualEffects } from '../../domain/models/layerVisualEffects';

type Rect = { x: number; y: number; width: number; height: number };

const blendModes: Record<LayerVisualEffects['blend'], GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', add: 'lighter',
};

function localCanvas(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法预览图层效果。');
  return context;
}

function alphaDilation(data: ImageData, radius: number): Uint8ClampedArray {
  const { width, height } = data;
  const horizontal = new Uint8ClampedArray(width * height);
  const vertical = new Uint8ClampedArray(width * height);
  const deque = new Int32Array(Math.max(width, height));
  function spread(length: number, read: (index: number) => number, write: (index: number, value: number) => void): void {
    let front = 0;
    let back = 0;
    let next = 0;
    for (let index = 0; index < length; index += 1) {
      while (front < back && deque[front]! < index - radius) front += 1;
      while (next <= Math.min(length - 1, index + radius)) {
        while (front < back && read(deque[back - 1]!) <= read(next)) back -= 1;
        deque[back++] = next++;
      }
      write(index, read(deque[front]!));
    }
  }
  for (let y = 0; y < height; y += 1) {
    spread(width, (x) => data.data[(y * width + x) * 4 + 3]!, (x, alpha) => { horizontal[y * width + x] = alpha; });
  }
  for (let x = 0; x < width; x += 1) {
    spread(height, (y) => horizontal[y * width + x]!, (y, alpha) => { vertical[y * width + x] = alpha; });
  }
  return vertical;
}

function tint(context: CanvasRenderingContext2D, color: string): void {
  context.globalCompositeOperation = 'source-in';
  context.fillStyle = color;
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);
  context.globalCompositeOperation = 'source-over';
}

function applySpatialEffects(image: ImageData, effects: LayerVisualEffects, bounds: Rect): void {
  const { width, height } = image;
  const subject = localCanvas(width, height);
  subject.putImageData(image, 0, 0);
  if (effects.silhouette) tint(subject, effects.silhouette);
  if (effects.feather > 0) {
    const mask = localCanvas(width, height);
    mask.filter = `blur(${effects.feather / 2}px)`;
    mask.fillStyle = '#ffffff';
    mask.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    subject.globalCompositeOperation = 'destination-in';
    subject.drawImage(mask.canvas, 0, 0);
    subject.globalCompositeOperation = 'source-over';
  }
  const composition = localCanvas(width, height);
  if (effects.glow.radius > 0) {
    const glow = localCanvas(width, height);
    glow.filter = `blur(${effects.glow.radius}px)`;
    glow.drawImage(subject.canvas, 0, 0);
    glow.filter = 'none';
    tint(glow, effects.glow.color);
    composition.drawImage(glow.canvas, 0, 0);
  }
  if (effects.outline.radius > 0) {
    const outline = localCanvas(width, height);
    const alpha = subject.getImageData(0, 0, width, height);
    const dilated = alphaDilation(alpha, effects.outline.radius);
    for (let index = 0; index < dilated.length; index += 1) {
      const offset = index * 4 + 3;
      const original = alpha.data[offset]!;
      // Covered by the subject again below. Normalize by the uncovered fraction.
      alpha.data[offset] = original < 255 ? 255 * Math.max(0, dilated[index]! - original) / (255 - original) : 0;
    }
    outline.putImageData(alpha, 0, 0);
    tint(outline, effects.outline.color);
    composition.drawImage(outline.canvas, 0, 0);
  }
  composition.filter = effects.blur > 0 ? `blur(${effects.blur}px)` : 'none';
  composition.drawImage(subject.canvas, 0, 0);
  image.data.set(composition.getImageData(0, 0, width, height).data);
}

/** Cache the flattened owner visual, then blend this single draw into the real Stage. */
export function cacheLayerVisualEffects(node: Konva.Group, bounds: Rect, effects: LayerVisualEffects): void {
  const padding = Math.ceil(Math.max(effects.blur * 3, effects.glow.radius * 3, effects.outline.radius));
  const x = Math.floor(bounds.x - padding);
  const y = Math.floor(bounds.y - padding);
  const width = Math.ceil(bounds.x + bounds.width + padding) - x;
  const height = Math.ceil(bounds.y + bounds.height + padding) - y;
  if (width <= 0 || height <= 0) return;
  const spatial = effects.blur > 0 || effects.glow.radius > 0 || effects.outline.radius > 0 ||
    Boolean(effects.silhouette) || effects.feather > 0;
  // Configure compositing after the local cache so it can see the lower Stage layers.
  node.clearCache();
  node.globalCompositeOperation('source-over');
  node.cache({ x, y, width, height, pixelRatio: 1 });
  node.filters(spatial ? [function filter(image: ImageData) {
    applySpatialEffects(image, effects, { ...bounds, x: bounds.x - x, y: bounds.y - y });
  }] : []);
  node.globalCompositeOperation(blendModes[effects.blend]);
}
