import type { SubtitleStyle } from '../../domain';
import type { StageRenderModel } from '../../shared/stage/render-model';

export interface StageVisualFrame<TModel = StageRenderModel> {
  model: TModel;
  caption: string | null;
  captionStyle?: SubtitleStyle;
}

/**
 * A visual frame becomes the fallback only after the exact desired frame has
 * been rendered with its complete decoded resource set.
 *
 * The ref that stores this result lives in StageRenderer. These helpers keep
 * the commit boundary testable without introducing another playback or frame
 * store.
 */
export function commitStageVisualFrame<TModel>(
  committedFrame: StageVisualFrame<TModel> | null,
  desiredFrame: StageVisualFrame<TModel> | null,
  ready: boolean,
): StageVisualFrame<TModel> | null {
  return ready && desiredFrame ? desiredFrame : committedFrame;
}

export function selectStageVisualFrame<TModel>(
  committedFrame: StageVisualFrame<TModel> | null,
  desiredFrame: StageVisualFrame<TModel> | null,
  ready: boolean,
): StageVisualFrame<TModel> | null {
  return ready && desiredFrame ? desiredFrame : committedFrame ?? desiredFrame;
}
