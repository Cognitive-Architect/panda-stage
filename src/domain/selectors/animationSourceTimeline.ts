import { evaluateFlaGraphicFrame } from '../../shared/fla-graphic-playback';
import { isFlaGraphicDefinition, type ProjectAnimationDefinition } from '../models/animation';
import type { TalkingAnimationPlayback } from '../models/character';
import { collectFlaGraphicTimelineDurationMs } from '../models/flaGraphicTimeline';

export interface FlaGraphicPreviewTimelineSpec {
  readonly hasInternalTimeline: boolean;
  readonly timelineDurationMs: number;
  readonly fps: number;
  readonly totalFrames: number;
  readonly sampleAtFrameIndex: (frameIndex: number) => {
    readonly frameOrdinal: number;
    readonly internalTimeMs: number | undefined;
  };
}

export function resolveFlaGraphicPreviewTimeline(
  animation: ProjectAnimationDefinition,
  configured = false,
): FlaGraphicPreviewTimelineSpec {
  const fps = configured ? animation.source.sourceFps : Math.max(1, animation.source.sourceFps || 24);
  const timelineDurationMs =
    isFlaGraphicDefinition(animation) && animation.structure
      ? collectFlaGraphicTimelineDurationMs(
          animation.structure.timeline,
          animation.structure,
        )
      : 0;
  const nestedFrameCount = configured && animation.frames.length === 1 && isFlaGraphicDefinition(animation)
    ? Object.values(animation.structure?.symbolDefinitions ?? {}).reduce(
        (count, symbol) => Math.max(count, symbol.sourceFrameCount ?? 0), 0,
      )
    : 0;
  const hasInternalTimeline = timelineDurationMs > 0 || nestedFrameCount > 1;
  const totalFrames = Math.max(animation.frames.length, nestedFrameCount, Math.floor(timelineDurationMs * fps / 1_000) + 1);

  return {
    hasInternalTimeline,
    timelineDurationMs,
    fps,
    totalFrames,
    sampleAtFrameIndex(frameIndex: number) {
      const clampedIndex = Math.max(
        0,
        Math.min(frameIndex, Math.max(0, totalFrames - 1)),
      );
      const mappedFrameIndex = Math.min(
        clampedIndex,
        Math.max(0, animation.frames.length - 1),
      );
      const frameOrdinal = animation.frames[mappedFrameIndex]?.ordinal ?? 0;
      if (configured) return { frameOrdinal, internalTimeMs: clampedIndex * (1_000 / fps) };
      if (!hasInternalTimeline) {
        return { frameOrdinal, internalTimeMs: undefined };
      }
      const internalTimeMs =
        clampedIndex >= totalFrames - 1
          ? timelineDurationMs
          : Math.min(
              timelineDurationMs,
              Math.round((clampedIndex * 1_000) / fps),
            );
      return { frameOrdinal, internalTimeMs };
    },
  };
}

export function resolveConfiguredAnimationFrameIndex(
  playback: TalkingAnimationPlayback,
  totalFrames: number,
  elapsedFrames: number,
): number | undefined {
  const reverse = playback.mode === 'loop reverse' || playback.mode === 'play once reverse';
  const selected = evaluateFlaGraphicFrame(
    playback.mode,
    reverse ? playback.lastFrame : playback.firstFrame,
    reverse ? playback.firstFrame : playback.lastFrame,
    totalFrames,
    elapsedFrames,
  );
  return selected.ok ? selected.frameIndex : undefined;
}

export function isTalkingAnimationPlaybackInRange(
  animation: ProjectAnimationDefinition,
  playback: TalkingAnimationPlayback,
): boolean {
  const { totalFrames } = resolveFlaGraphicPreviewTimeline(animation, true);
  return playback.firstFrame <= playback.lastFrame && playback.lastFrame < totalFrames &&
    (playback.restFrame === undefined || playback.restFrame < totalFrames);
}
