import type { CameraView, SubtitleStyle } from '../../domain';
import type { StageRenderModel } from '../../shared/stage/render-model';

export interface StageVisualFrame<TModel = StageRenderModel> {
  model: TModel;
  caption: string | null;
  captionStyle?: SubtitleStyle;
  camera?: CameraView;
}

/**
 * A visual frame becomes the fallback after the desired frame is fully
 * drawable. Product Preview may meet that bar with an explicit degraded
 * fallback; exact export readiness remains a separate gate.
 *
 * The ref that stores this result lives in StageRenderer. These helpers keep
 * the commit boundary testable without introducing another playback or frame
 * store.
 */
export function commitStageVisualFrame<TModel>(
  committedFrame: StageVisualFrame<TModel> | null,
  desiredFrame: StageVisualFrame<TModel> | null,
  displayReady: boolean,
): StageVisualFrame<TModel> | null {
  return displayReady && desiredFrame ? desiredFrame : committedFrame;
}

export function selectStageVisualFrame<TModel>(
  committedFrame: StageVisualFrame<TModel> | null,
  desiredFrame: StageVisualFrame<TModel> | null,
  displayReady: boolean,
): StageVisualFrame<TModel> | null {
  return displayReady && desiredFrame ? desiredFrame : committedFrame ?? desiredFrame;
}
