import { LAYER_MAX_SCALE, LAYER_MIN_SCALE } from '../constants';
import { calculateCoverTransform } from '../geometry';
import { ProjectSchema, type Project } from '../models/project';
import { OpacityEventSchema } from '../models/timeline-event';
import { isValidFrameTime } from '../timeline/frame-grid';
import { LayerService } from './LayerService';

/** Place a regular opaque backplate beneath the topmost speaking actor. */
export function planMonologueBackdrop(
  project: Project,
  input: { shotId: string; layerId: string; assetId: string; startMs: number; endMs: number },
  createId = () => crypto.randomUUID(),
): Project {
  const shot = project.shots.find(({ id }) => id === input.shotId);
  const speaker = shot?.layers.find(({ id }) => id === input.layerId);
  if (!shot || speaker?.source.kind !== 'character' || speaker.locked || !speaker.visible) {
    throw new Error('请选择可编辑、可见的角色图层。');
  }
  if (shot.layers.some((layer) => layer.id !== speaker.id && layer.zIndex >= speaker.zIndex)) {
    throw new Error('请先把独白角色移到最上层。');
  }
  const { startMs, endMs } = input;
  if (!isValidFrameTime(startMs) || !isValidFrameTime(endMs) || startMs >= endMs || endMs > shot.durationMs) {
    throw new Error('请选择镜头内有效的黑幕区段。');
  }
  const image = project.assets.find(({ id }) => id === input.assetId);
  if (image?.kind !== 'image') throw new Error('请选择已导入的遮幕图片。');
  const cover = calculateCoverTransform(image, project);
  if (!cover || cover.scale < LAYER_MIN_SCALE || cover.scale > LAYER_MAX_SCALE) {
    throw new Error('这张图片的尺寸无法覆盖舞台。');
  }

  const layers = new LayerService({ createId });
  const position = { x: project.width / 2, y: project.height / 2 };
  const placed = layers.createFromAsset(project, shot.id, {
    version: 2, type: 'asset-image', assetId: image.id, position,
  });
  const layerId = placed.layer.id;
  const covered = layers.updateTransform(placed.project, shot.id, layerId, {
    ...position, scale: cover.scale, rotationDeg: 0, opacity: 0, flipX: false,
  });
  const named = layers.renameContentLayers(covered, shot.id, new Map([[layerId, '独白黑幕']]));
  const ordered = layers.reorder(named, shot.id, layerId, 'backward');
  const toggle = (timeMs: number, value: number) => OpacityEventSchema.parse({
    id: createId(), layerId, type: 'opacity', startMs: timeMs, endMs: timeMs, from: value, to: value, easing: 'step',
  });
  return ProjectSchema.parse({ ...ordered, shots: ordered.shots.map((entry) => entry.id === shot.id
    ? { ...entry, timelineEvents: [...entry.timelineEvents, toggle(startMs, 1), toggle(endMs, 0)] } : entry) });
}
