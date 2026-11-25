import { PROJECT_HEIGHT, PROJECT_WIDTH } from '../constants';
import { lastValidFrameTime, TIMELINE_FPS } from '../timeline/frame-grid';

export type BackgroundScrollDirection = 'left' | 'right' | 'up' | 'down';
export type BackgroundTileInput =
  | { readonly mode: 'static' }
  | { readonly mode: 'loop'; readonly direction: BackgroundScrollDirection; readonly periodFrames: number };

export function planBackgroundTiles(width: number, height: number, durationMs: number, input: BackgroundTileInput) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('铺排尺寸无效，请调整素材比例。');
  }
  const loop = input.mode === 'loop' ? input : null;
  const horizontal = loop?.direction === 'left' || loop?.direction === 'right';
  const vertical = loop?.direction === 'up' || loop?.direction === 'down';
  const lastFrame = Math.round(lastValidFrameTime(durationMs) * TIMELINE_FPS / 1000);
  if (loop && (!horizontal && !vertical)) throw new Error('请选择循环方向。');
  if (loop && (!Number.isSafeInteger(loop.periodFrames) || loop.periodFrames < 1 || loop.periodFrames > lastFrame)) {
    throw new Error(`循环周期必须是 1–${lastFrame} 帧之间的整数。`);
  }

  const columns = Math.ceil(PROJECT_WIDTH / width) + (horizontal ? 2 : 0);
  const rows = Math.ceil(PROJECT_HEIGHT / height) + (vertical ? 2 : 0);
  const count = rows * columns;
  if (count > 100) throw new Error('铺排最多生成 100 个副本，请放大源图层。');
  if (loop && count * (lastFrame + 1) > 50_000) {
    throw new Error('循环关键帧过多，请放大源图层或缩短镜头。');
  }
  return { width, height, columns, rows, count, lastFrame, horizontal, vertical };
}

export function sampleScrollingTile(
  index: number,
  slots: number,
  pitch: number,
  length: number,
  frame: number,
  period: number,
  reverse: boolean,
): { center: number; recycleAfter: boolean } {
  const cycle = Math.floor(frame / period);
  const phase = frame % period;
  const slot = ((index - cycle) % slots + slots) % slots;
  const center = (slot - 0.5 - phase / period) * pitch;
  return {
    center: reverse ? length - center : center,
    recycleAfter: slot === 0 && phase === period - 1,
  };
}
