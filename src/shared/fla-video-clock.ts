import { evaluateFlaGraphicFrame } from './fla-graphic-playback';

export const FLA_VIDEO_FRAME_ASSET_KEY_SEPARATOR = '#frame:';

export function flaVideoFrameAssetKey(assetId: string, sampleIndex: number): string {
  return `${assetId}${FLA_VIDEO_FRAME_ASSET_KEY_SEPARATOR}${sampleIndex}`;
}

export function parseFlaVideoFrameAssetKey(
  value: string,
): { readonly assetId: string; readonly sampleIndex: number } | null {
  const splitIndex = value.lastIndexOf(FLA_VIDEO_FRAME_ASSET_KEY_SEPARATOR);
  if (splitIndex <= 0) return null;
  const assetId = value.slice(0, splitIndex);
  const rawIndex = value.slice(splitIndex + FLA_VIDEO_FRAME_ASSET_KEY_SEPARATOR.length);
  if (!/^\d+$/u.test(rawIndex)) return null;
  const sampleIndex = Number(rawIndex);
  if (!Number.isSafeInteger(sampleIndex) || sampleIndex < 0) return null;
  return { assetId, sampleIndex };
}

/** A validated display-order index. Duplicate PTS use the last decoded frame at that timestamp. */
export function createFlaVideoPresentationIndex(
  pts: readonly number[],
  endTick: number,
): ((sourceTick: number) => number | null) | null {
  if (!pts.length || !Number.isSafeInteger(endTick) || endTick <= pts.at(-1)! ||
      pts.some((tick, i) => !Number.isSafeInteger(tick) || (i > 0 && tick < pts[i - 1]!))) {
    return null;
  }
  const timeline = [...pts];
  return (sourceTick: number): number | null => {
    if (!Number.isFinite(sourceTick) || sourceTick < timeline[0]! || sourceTick >= endTick) return null;
    let low = 0;
    let high = timeline.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (timeline[middle]! <= sourceTick) low = middle;
      else high = middle;
    }
    return low;
  };
}

export interface FlaVideoTimingMetadata {
  readonly timeBase: {
    readonly numerator: number;
    readonly denominator: number;
  };
  readonly startTick: number;
  readonly endTick: number;
  readonly presentationTicks: readonly number[];
}

export interface FlaVideoNestedHostClock {
  readonly kind: 'graphic' | 'movieclip';
  readonly playbackMode?: string;
  readonly firstFrame?: number;
  readonly lastFrame?: number;
  readonly hostFrameCount: number;
  readonly hostFps?: number;
  readonly spanStartFrame?: number;
}

export interface FlaVideoClockInput {
  readonly shotTimeMs: number;
  readonly layerStartTimeMs?: number;
  readonly timing: FlaVideoTimingMetadata;
  readonly playbackMode?: 'play-once' | 'loop' | 'single-frame';
  readonly trimStartMs?: number;
  readonly trimEndMs?: number;
  readonly heldFrameIndex?: number;
  readonly sourceFps?: number;
  readonly nestedHost?: FlaVideoNestedHostClock;
}

export interface FlaVideoClockSample {
  readonly sampleIndex: number;
  readonly presentationTick: number;
  readonly sourceTimeSeconds: number;
  readonly visible: boolean;
}

/**
 * Deterministic source-time & PTS display-sample selector shared by Stage,
 * Preview, and formal Export. Never relies on free-running HTMLVideoElement time.
 */
export function evaluateFlaVideoClock(input: FlaVideoClockInput): FlaVideoClockSample | null {
  const { timing } = input;
  const { numerator, denominator } = timing.timeBase;
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) ||
      numerator <= 0 || denominator <= 0) {
    return null;
  }
  const indexLookup = createFlaVideoPresentationIndex(timing.presentationTicks, timing.endTick);
  if (!indexLookup) return null;

  const firstTick = timing.presentationTicks[0]!;
  const totalTicks = timing.endTick - firstTick;
  const totalDurationMs = (totalTicks * numerator * 1_000) / denominator;
  if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) return null;

  const playbackMode = input.playbackMode ?? 'play-once';
  if (playbackMode === 'single-frame') {
    const clampedIndex = Math.max(
      0,
      Math.min(timing.presentationTicks.length - 1, Math.trunc(input.heldFrameIndex ?? 0)),
    );
    const tick = timing.presentationTicks[clampedIndex]!;
    return {
      sampleIndex: clampedIndex,
      presentationTick: tick,
      sourceTimeSeconds: ((tick - firstTick) * numerator) / denominator,
      visible: true,
    };
  }

  const rawElapsedMs = Math.max(0, input.shotTimeMs - (input.layerStartTimeMs ?? 0));
  let effectiveElapsedMs = rawElapsedMs;
  if (input.nestedHost) {
    const hostFps = Math.max(1, input.nestedHost.hostFps ?? input.sourceFps ?? 24);
    const frameMs = 1_000 / hostFps;
    const hostFrameCount = Math.max(1, input.nestedHost.hostFrameCount);
    if (input.nestedHost.kind === 'movieclip') {
      // Independent MovieClip advances modulo its own timeline independently of held Graphic ancestors.
      const mcDurationMs = hostFrameCount * frameMs;
      effectiveElapsedMs = mcDurationMs > 0 ? ((rawElapsedMs % mcDurationMs) + mcDurationMs) % mcDurationMs : 0;
    } else {
      // Nested Graphic follows Animate's single-frame / play-once / loop frame clock.
      const elapsedFrames = Math.floor(rawElapsedMs / frameMs + 1e-9);
      const selected = evaluateFlaGraphicFrame(
        input.nestedHost.playbackMode ?? 'loop',
        input.nestedHost.firstFrame ?? 0,
        input.nestedHost.lastFrame,
        hostFrameCount,
        elapsedFrames,
      );
      if (!selected.ok) return null;
      const spanStart = input.nestedHost.spanStartFrame ?? 0;
      effectiveElapsedMs = Math.max(0, (selected.frameIndex - spanStart) * frameMs);
    }
  }

  const trimStartMs = Math.max(0, Math.min(totalDurationMs, input.trimStartMs ?? 0));
  const rawTrimEndMs = input.trimEndMs !== undefined ? Math.min(totalDurationMs, input.trimEndMs) : totalDurationMs;
  const trimEndMs = Math.max(trimStartMs, rawTrimEndMs);
  const windowMs = trimEndMs - trimStartMs;

  let localMs: number;
  if (windowMs <= 0) {
    localMs = 0;
  } else if (playbackMode === 'loop') {
    localMs = ((effectiveElapsedMs % windowMs) + windowMs) % windowMs;
  } else {
    // play-once clamps cleanly to the terminal sample within the trim window.
    localMs = Math.min(effectiveElapsedMs, Math.max(0, windowMs - 1e-6));
  }

  const sourceMs = trimStartMs + localMs;
  const relativeTicks = Math.floor((sourceMs * denominator) / (numerator * 1_000) + 1e-9);
  const targetTick = Math.min(timing.endTick - 1, Math.max(firstTick, firstTick + relativeTicks));
  const sampleIndex = indexLookup(targetTick);
  if (sampleIndex === null) return null;
  const presentationTick = timing.presentationTicks[sampleIndex]!;
  return {
    sampleIndex,
    presentationTick,
    sourceTimeSeconds: ((presentationTick - firstTick) * numerator) / denominator,
    visible: true,
  };
}

export interface PlannedVideoAudioClip {
  readonly startMs: number;
  readonly endMs: number;
  readonly offsetMs: number;
}

export interface PlanEmbeddedVideoAudioInput {
  readonly shotDurationMs: number;
  readonly layerStartTimeMs?: number;
  readonly videoDurationMs: number;
  readonly audioDurationMs: number;
  readonly audioStartOffsetMs?: number;
  readonly playbackMode?: 'play-once' | 'loop' | 'single-frame';
  readonly trimStartMs?: number;
  readonly trimEndMs?: number;
  readonly nestedHost?: FlaVideoNestedHostClock;
  readonly maxLoopCycles?: number;
}

export interface PlanEmbeddedVideoAudioResult {
  readonly clips: readonly PlannedVideoAudioClip[];
  readonly diagnostics: readonly string[];
}

const MAX_VIDEO_AUDIO_LOOP_CYCLES = 32;

/**
 * Aligns formal Shot AudioClip timeline spans to the embedded video's authored
 * visual clock (play-once, trim, loop, single-frame/held, and A/V start PTS offset).
 * Unsupported nested host clocks disable audio explicitly with a local diagnostic
 * instead of emitting desynchronized audio (E-F10).
 */
export function planEmbeddedVideoAudioClips(
  input: PlanEmbeddedVideoAudioInput,
): PlanEmbeddedVideoAudioResult {
  const playbackMode = input.playbackMode ?? 'play-once';
  if (playbackMode === 'single-frame') {
    return {
      clips: [],
      diagnostics: ['单帧定格（single-frame）视频不生成持续音轨。'],
    };
  }
  if (input.nestedHost) {
    return {
      clips: [],
      diagnostics: ['嵌套宿主时钟与独立线性音轨暂不支持自动同步，已禁用该实例伴音。'],
    };
  }
  const shotDurationMs = Math.max(0, Math.round(input.shotDurationMs));
  const layerStartMs = Math.max(0, Math.round(input.layerStartTimeMs ?? 0));
  const videoDurationMs = Math.max(1, Math.round(input.videoDurationMs));
  const audioDurationMs = Math.max(1, Math.round(input.audioDurationMs));
  const audioStartOffsetMs = Math.round(input.audioStartOffsetMs ?? 0);
  if (layerStartMs >= shotDurationMs) {
    return { clips: [], diagnostics: [] };
  }

  const trimStartMs = Math.max(0, Math.min(videoDurationMs, Math.round(input.trimStartMs ?? 0)));
  const trimEndMs = Math.max(
    trimStartMs,
    input.trimEndMs !== undefined ? Math.min(videoDurationMs, Math.round(input.trimEndMs)) : videoDurationMs,
  );
  const windowMs = trimEndMs - trimStartMs;
  if (windowMs <= 0) {
    return {
      clips: [],
      diagnostics: ['视频裁剪区间长度为 0，未生成伴音片段。'],
    };
  }

  // Align one visual window [trimStartMs, trimEndMs) against audio timeline shifted by audioStartOffsetMs:
  // Audio sample time = visualSourceTime - audioStartOffsetMs.
  const alignSingleCycle = (cycleTimelineStartMs: number): PlannedVideoAudioClip | null => {
    const rawAudioOffset = trimStartMs - audioStartOffsetMs;
    let startMs = cycleTimelineStartMs;
    let offsetMs = rawAudioOffset;
    let playableMs = windowMs;
    if (offsetMs < 0) {
      const leadDelayMs = -offsetMs;
      startMs += leadDelayMs;
      offsetMs = 0;
      playableMs -= leadDelayMs;
    }
    if (playableMs <= 0 || offsetMs >= audioDurationMs || startMs >= shotDurationMs) {
      return null;
    }
    const maxByAudio = audioDurationMs - offsetMs;
    const maxByShot = shotDurationMs - startMs;
    const clipLen = Math.min(playableMs, maxByAudio, maxByShot);
    if (clipLen <= 0) return null;
    return {
      startMs,
      endMs: startMs + clipLen,
      offsetMs,
    };
  };

  if (playbackMode === 'play-once') {
    const clip = alignSingleCycle(layerStartMs);
    if (!clip) {
      return {
        clips: [],
        diagnostics: ['音画起始偏移超出可用音轨范围，已禁用该实例伴音。'],
      };
    }
    return { clips: [clip], diagnostics: [] };
  }

  // Loop mode: emit non-overlapping AudioClip per visual loop cycle across [layerStartMs, shotDurationMs).
  const maxCycles = Math.max(1, Math.min(MAX_VIDEO_AUDIO_LOOP_CYCLES, input.maxLoopCycles ?? MAX_VIDEO_AUDIO_LOOP_CYCLES));
  const clips: PlannedVideoAudioClip[] = [];
  const diagnostics: string[] = [];
  let cursorMs = layerStartMs;
  let cycle = 0;
  while (cursorMs < shotDurationMs && cycle < maxCycles) {
    const clip = alignSingleCycle(cursorMs);
    if (clip) {
      const prev = clips.at(-1);
      // Guarantee strictly non-overlapping sequential occurrences.
      if (!prev || clip.startMs >= prev.endMs) {
        clips.push(clip);
      }
    }
    cursorMs += windowMs;
    cycle += 1;
  }
  if (cursorMs < shotDurationMs) {
    diagnostics.push(`循环伴音已达到上限（${maxCycles} 轮），后续循环静音。`);
  }
  return { clips, diagnostics };
}
