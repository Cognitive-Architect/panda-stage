import type { Project } from './models/project';
import {
  AudioClipService,
  type CreateAudioClipInput,
  type StandaloneAudioRole,
} from './services/AudioClipService';
import {
  evaluateFlaGraphicFrame,
  type FlaGraphicPlaybackMode,
} from '../shared/fla-graphic-playback';

/**
 * Adobe Animate / XFL `inPoint44` and `outPoint44` are always expressed in
 * samples at the fixed 44.1 kHz reference clock, regardless of the actual
 * sample rate of the embedded audio asset.
 */
export const FLA_SOUND_REFERENCE_SAMPLE_RATE = 44_100;

/** Upper bound for finite repeat expansion to guard against sentinel/infinite values. */
export const FLA_SOUND_MAX_FINITE_REPEAT = 256;

/** Maximum nested Graphic/MovieClip recursion depth for deterministic sound mapping. */
export const FLA_SOUND_MAX_NESTED_DEPTH = 16;

export type FlaSoundTimelineSync = 'event' | 'start' | 'stop' | 'stream';
export type FlaSoundTimelineLoopMode = 'repeat' | 'loop';
export type FlaSoundSymbolPlaybackMode = FlaGraphicPlaybackMode;
export type FlaSoundSymbolType = 'graphic' | 'movieclip' | 'button';

export type FlaSoundTimelineDiagnosticCode =
  | 'unsupported-sync'
  | 'unsupported-loop'
  | 'unresolved-sound'
  | 'missing-audio-asset'
  | 'outside-shot-boundary'
  | 'empty-source-range'
  | 'zero-duration-clip'
  | 'unsupported-nested-clock'
  | 'nested-symbol-cycle'
  | 'missing-nested-symbol';

export interface FlaSoundTimelineDiagnostic {
  readonly code: FlaSoundTimelineDiagnosticCode;
  readonly soundName: string;
  readonly frameIndex: number;
  readonly layerIndex?: number;
  readonly sync?: FlaSoundTimelineSync;
  readonly message: string;
}

export interface FlaSceneFrameSoundDescriptor {
  readonly soundId?: string;
  readonly name: string;
  readonly sync: FlaSoundTimelineSync;
  readonly inPoint44?: number;
  readonly outPoint44?: number;
  readonly loopMode?: FlaSoundTimelineLoopMode;
  readonly loopCount?: number;
}

export interface FlaSceneSoundEvent {
  readonly layerIndex: number;
  readonly frameIndex: number;
  readonly frameDuration: number;
  readonly sound: FlaSceneFrameSoundDescriptor;
}

export interface FlaResolvedSoundAsset {
  readonly assetId: string;
  readonly name: string;
  readonly durationMs: number;
}

export interface FlaSymbolInstanceSoundPlacement {
  readonly libraryItemName: string;
  readonly symbolType: FlaSoundSymbolType;
  readonly loop: FlaSoundSymbolPlaybackMode;
  readonly firstFrame?: number;
  readonly lastFrame?: number;
}

export interface FlaTimelineSoundSource {
  readonly totalFrames?: number;
  readonly layers: readonly {
    readonly sourceLayerIndex: number;
    readonly frames: readonly {
      readonly sourceFrameIndex: number;
      readonly startFrame: number;
      readonly duration: number;
      readonly sound?: FlaSceneFrameSoundDescriptor;
      readonly symbolInstances?: readonly FlaSymbolInstanceSoundPlacement[];
    }[];
  }[];
}

export interface FlaSymbolTimelineSoundSource extends FlaTimelineSoundSource {
  readonly name: string;
  readonly symbolType: FlaSoundSymbolType;
  readonly totalFrames: number;
  readonly hasActionScript?: boolean;
}

export interface ExtractFlaNestedSoundEventsOptions {
  readonly symbolTimelines?: readonly FlaSymbolTimelineSoundSource[];
  readonly sourceFps?: number;
  readonly maxDepth?: number;
}

export interface ExtractFlaNestedSoundEventsResult {
  readonly events: FlaSceneSoundEvent[];
  readonly diagnostics: FlaSoundTimelineDiagnostic[];
}

export interface PlanFlaSceneAudioClipsInput {
  readonly sourceFps: number;
  readonly shotId: string;
  readonly shotDurationMs: number;
  readonly role?: StandaloneAudioRole;
  readonly events: readonly FlaSceneSoundEvent[];
  readonly resolveAsset: (
    sound: Pick<FlaSceneFrameSoundDescriptor, 'soundId' | 'name'>,
  ) => FlaResolvedSoundAsset | undefined;
}

export interface PlanFlaSceneAudioClipsResult {
  readonly clips: Omit<CreateAudioClipInput, 'shotId'>[];
  readonly diagnostics: FlaSoundTimelineDiagnostic[];
}

export interface ApplyFlaSceneAudioClipsResult {
  readonly project: Project;
  readonly createdClipIds: string[];
  readonly diagnostics: FlaSoundTimelineDiagnostic[];
}

const SYNC_PRIORITY: Record<FlaSoundTimelineSync, number> = {
  stop: 0,
  stream: 1,
  start: 2,
  event: 3,
};

function compareSoundEvents(
  left: FlaSceneSoundEvent,
  right: FlaSceneSoundEvent,
): number {
  return (
    left.frameIndex - right.frameIndex ||
    SYNC_PRIORITY[left.sound.sync] - SYNC_PRIORITY[right.sound.sync] ||
    left.layerIndex - right.layerIndex
  );
}

function soundIdentityKey(
  sound: Pick<FlaSceneFrameSoundDescriptor, 'soundId' | 'name'>,
): string {
  return sound.soundId ?? `name:${sound.name.trim().toLowerCase()}`;
}

interface PendingPlannedClip {
  soundKey: string;
  soundName: string;
  frameIndex: number;
  layerIndex: number;
  sync: 'stream' | 'event' | 'start';
  assetId: string;
  assetDurationMs: number;
  role: StandaloneAudioRole;
  rawStartMs: number;
  rawEndMs: number;
  rawOffsetMs: number;
}

/**
 * Extracts sound events from a parsed FLA Scene timeline in deterministic
 * chronological order (frameIndex ascending, stop before start/event/stream on
 * the same frame, then sourceLayerIndex ascending).
 */
export function extractFlaTimelineSoundEvents(
  timeline: FlaTimelineSoundSource,
): FlaSceneSoundEvent[] {
  const events: FlaSceneSoundEvent[] = [];
  for (const layer of timeline.layers) {
    for (const frame of layer.frames) {
      if (!frame.sound) continue;
      events.push({
        layerIndex: layer.sourceLayerIndex,
        frameIndex: Math.max(0, frame.sourceFrameIndex),
        frameDuration: Math.max(1, frame.duration),
        sound: frame.sound,
      });
    }
  }
  events.sort(compareSoundEvents);
  return events;
}

function resolveChildTotalFrames(symbol: FlaSymbolTimelineSoundSource): number {
  let derived = Math.max(0, symbol.totalFrames);
  for (const layer of symbol.layers) {
    for (const frame of layer.frames) {
      derived = Math.max(derived, Math.max(0, frame.sourceFrameIndex) + Math.max(1, frame.duration));
    }
  }
  return derived;
}

function evaluateInstanceChildFrame(
  placement: FlaSymbolInstanceSoundPlacement,
  symbol: FlaSymbolTimelineSoundSource,
  childTotalFrames: number,
  offset: number,
): number {
  if (symbol.symbolType === 'movieclip' || placement.symbolType === 'movieclip') {
    return offset % childTotalFrames;
  }
  const safeOffset = Math.max(0, Math.trunc(offset));
  const rawFirstFrame =
    placement.firstFrame !== undefined &&
    Number.isSafeInteger(placement.firstFrame) &&
    placement.firstFrame >= 0
      ? placement.firstFrame
      : 0;
  const clampedFirstFrame = Math.min(rawFirstFrame, childTotalFrames - 1);
  const clampedLastFrame =
    placement.lastFrame !== undefined &&
    Number.isSafeInteger(placement.lastFrame) &&
    placement.lastFrame >= 0
      ? Math.min(placement.lastFrame, childTotalFrames - 1)
      : undefined;
  const evaluated = evaluateFlaGraphicFrame(
    placement.loop,
    clampedFirstFrame,
    clampedLastFrame,
    childTotalFrames,
    safeOffset,
  );
  if (evaluated.ok) {
    return evaluated.frameIndex;
  }
  // Fallback if an unknown playback mode arrives from malformed input: hold firstFrame safely.
  return clampedFirstFrame;
}

/**
 * Extracts sound events from a main Scene timeline AND deterministically nested
 * Graphic / MovieClip symbol instances using independent per-instance clocks.
 *
 * Out-of-scope interactive/dynamic features (Button symbols, ActionScript-driven
 * MovieClips, circular references, or excessive nesting depth) emit clear local
 * diagnostics while preserving all deterministic triggers and audio assets.
 */
export function extractFlaTimelineSoundEventsWithNested(
  timeline: FlaTimelineSoundSource,
  options: ExtractFlaNestedSoundEventsOptions = {},
): ExtractFlaNestedSoundEventsResult {
  const events: FlaSceneSoundEvent[] = [];
  const diagnostics: FlaSoundTimelineDiagnostic[] = [];
  const symbolByName = new Map<string, FlaSymbolTimelineSoundSource>();
  for (const symbol of options.symbolTimelines ?? []) {
    symbolByName.set(symbol.name, symbol);
    const normalized = symbol.name.trim().toLowerCase();
    if (!symbolByName.has(normalized)) {
      symbolByName.set(normalized, symbol);
    }
  }
  const maxDepth = options.maxDepth ?? FLA_SOUND_MAX_NESTED_DEPTH;
  const sourceFps = options.sourceFps;
  const reportedCycles = new Set<string>();

  const lookupSymbol = (name: string): FlaSymbolTimelineSoundSource | undefined =>
    symbolByName.get(name) ?? symbolByName.get(name.trim().toLowerCase());

  const expandPlacement = (
    placement: FlaSymbolInstanceSoundPlacement,
    parentStartFrame: number,
    parentRelativeOffsets: readonly number[],
    parentLayerIndex: number,
    depth: number,
    ancestry: ReadonlySet<string>,
  ): void => {
    const parentSpanFrames = parentRelativeOffsets.length;
    if (parentSpanFrames <= 0) return;

    if (placement.symbolType === 'button') {
      diagnostics.push({
        code: 'unsupported-nested-clock',
        soundName: placement.libraryItemName,
        frameIndex: parentStartFrame,
        layerIndex: parentLayerIndex,
        message: `Button symbol "${placement.libraryItemName}" at frame ${parentStartFrame} uses interactive state triggers outside deterministic timeline recovery.`,
      });
      return;
    }

    if (depth > maxDepth) {
      diagnostics.push({
        code: 'unsupported-nested-clock',
        soundName: placement.libraryItemName,
        frameIndex: parentStartFrame,
        layerIndex: parentLayerIndex,
        message: `Nested symbol "${placement.libraryItemName}" at frame ${parentStartFrame} exceeded maximum deterministic nesting depth (${maxDepth}).`,
      });
      return;
    }

    const symbol = lookupSymbol(placement.libraryItemName);
    if (!symbol) {
      // Only diagnose if symbolTimelines were provided and symbol was missing?
      // Symbols without sounds or nested symbols are omitted from symbolTimelines,
      // so absence here simply means the symbol has no audio content.
      return;
    }

    if (symbol.symbolType === 'button') {
      diagnostics.push({
        code: 'unsupported-nested-clock',
        soundName: symbol.name,
        frameIndex: parentStartFrame,
        layerIndex: parentLayerIndex,
        message: `Button symbol "${symbol.name}" at frame ${parentStartFrame} uses interactive state triggers outside deterministic timeline recovery.`,
      });
      return;
    }

    const canonicalKey = symbol.name.trim().toLowerCase();
    if (ancestry.has(canonicalKey)) {
      if (!reportedCycles.has(canonicalKey)) {
        reportedCycles.add(canonicalKey);
        diagnostics.push({
          code: 'nested-symbol-cycle',
          soundName: symbol.name,
          frameIndex: parentStartFrame,
          layerIndex: parentLayerIndex,
          message: `Circular symbol reference detected for "${symbol.name}" at frame ${parentStartFrame}; nested audio expansion stopped to prevent infinite recursion.`,
        });
      }
      return;
    }

    if (
      (symbol.symbolType === 'movieclip' || placement.symbolType === 'movieclip') &&
      symbol.hasActionScript
    ) {
      diagnostics.push({
        code: 'unsupported-nested-clock',
        soundName: symbol.name,
        frameIndex: parentStartFrame,
        layerIndex: parentLayerIndex,
        message: `MovieClip "${symbol.name}" at frame ${parentStartFrame} contains ActionScript (e.g. dynamic stop/gotoAndPlay) and cannot be deterministically mapped to Shot audio.`,
      });
      return;
    }

    const childTotalFrames = resolveChildTotalFrames(symbol);
    if (childTotalFrames <= 0) return;

    // Build this instance's independent per-tick child frame sequence:
    // - MovieClips run on their own deterministic timeline clock while on stage.
    // - Graphics derive their displayed frame strictly from their parent's
    //   actually selected frame offset into the enclosing keyframe span, so a
    //   frozen single-frame or clamped play-once ancestor never advances a
    //   nested Graphic's audio clock ahead of its visual frame.
    const isMovieClip =
      symbol.symbolType === 'movieclip' || placement.symbolType === 'movieclip';
    const childFramesByOffset: number[] = new Array(parentSpanFrames);
    for (let offset = 0; offset < parentSpanFrames; offset += 1) {
      const clockOffset = isMovieClip ? offset : parentRelativeOffsets[offset]!;
      childFramesByOffset[offset] = evaluateInstanceChildFrame(
        placement,
        symbol,
        childTotalFrames,
        clockOffset,
      );
    }

    const nextAncestry = new Set(ancestry);
    nextAncestry.add(canonicalKey);

    for (const childLayer of symbol.layers) {
      for (const childFrame of childLayer.frames) {
        const keyStart = Math.max(0, childFrame.sourceFrameIndex);
        const keyDuration = Math.max(1, childFrame.duration);
        const keyEnd = keyStart + keyDuration;

        if (childFrame.sound) {
          for (let offset = 0; offset < parentSpanFrames; offset += 1) {
            const currentChildFrame = childFramesByOffset[offset]!;
            const prevChildFrame = offset > 0 ? childFramesByOffset[offset - 1]! : undefined;

            // Normal keyframe entry (including loop wrap-around and offset=0).
            if (
              currentChildFrame === keyStart &&
              (offset === 0 || prevChildFrame !== currentChildFrame)
            ) {
              // For stream sounds, compute how many contiguous parent ticks remain
              // inside this child keyframe span.
              let activeSpan = 1;
              if (childFrame.sound.sync === 'stream') {
                while (
                  offset + activeSpan < parentSpanFrames &&
                  childFramesByOffset[offset + activeSpan]! === keyStart + activeSpan &&
                  activeSpan < keyDuration
                ) {
                  activeSpan += 1;
                }
              }
              events.push({
                layerIndex: parentLayerIndex,
                frameIndex: parentStartFrame + offset,
                frameDuration: childFrame.sound.sync === 'stream' ? activeSpan : 1,
                sound: childFrame.sound,
              });
            } else if (
              offset === 0 &&
              childFrame.sound.sync === 'stream' &&
              currentChildFrame > keyStart &&
              currentChildFrame < keyEnd
            ) {
              // Graphic instance entered mid-stream via firstFrame > keyStart:
              // advance inPoint44 by the skipped child frames and trim remaining span.
              const skippedFrames = currentChildFrame - keyStart;
              let activeSpan = 1;
              while (
                offset + activeSpan < parentSpanFrames &&
                childFramesByOffset[offset + activeSpan]! === currentChildFrame + activeSpan &&
                skippedFrames + activeSpan < keyDuration
              ) {
                activeSpan += 1;
              }
              const extraIn44 =
                sourceFps && sourceFps > 0
                  ? Math.round((skippedFrames * FLA_SOUND_REFERENCE_SAMPLE_RATE) / sourceFps)
                  : 0;
              events.push({
                layerIndex: parentLayerIndex,
                frameIndex: parentStartFrame,
                frameDuration: activeSpan,
                sound: {
                  ...childFrame.sound,
                  inPoint44: (childFrame.sound.inPoint44 ?? 0) + extraIn44,
                },
              });
            }
          }
        }

        if (childFrame.symbolInstances && childFrame.symbolInstances.length > 0) {
          // Group contiguous parent offsets where the parent instance visits this
          // child keyframe [keyStart, keyEnd) into independent nested entry runs,
          // propagating the exact parent keyframe-relative offsets (cf - keyStart)
          // so nested Graphics follow the parent's actual displayed frame clock.
          const isReverseMode =
            !isMovieClip &&
            (placement.loop === 'loop reverse' || placement.loop === 'play once reverse');
          let runStart = -1;
          for (let offset = 0; offset <= parentSpanFrames; offset += 1) {
            const cf = offset < parentSpanFrames ? childFramesByOffset[offset]! : -1;
            const prevCf = offset > 0 ? childFramesByOffset[offset - 1]! : -1;
            const inRange = cf >= keyStart && cf < keyEnd;
            const wrapped =
              inRange && runStart >= 0 && (isReverseMode ? cf > prevCf : cf < prevCf);

            if ((!inRange || wrapped) && runStart >= 0) {
              const runRelativeOffsets: number[] = new Array(offset - runStart);
              for (let i = runStart; i < offset; i += 1) {
                runRelativeOffsets[i - runStart] = childFramesByOffset[i]! - keyStart;
              }
              for (const nested of childFrame.symbolInstances) {
                expandPlacement(
                  nested,
                  parentStartFrame + runStart,
                  runRelativeOffsets,
                  parentLayerIndex,
                  depth + 1,
                  nextAncestry,
                );
              }
              runStart = wrapped ? offset : -1;
            } else if (inRange && runStart < 0) {
              runStart = offset;
            }
          }
        }
      }
    }
  };

  for (const layer of timeline.layers) {
    for (const frame of layer.frames) {
      const frameIndex = Math.max(0, frame.sourceFrameIndex);
      const frameDuration = Math.max(1, frame.duration);
      if (frame.sound) {
        events.push({
          layerIndex: layer.sourceLayerIndex,
          frameIndex,
          frameDuration,
          sound: frame.sound,
        });
      }
      if (frame.symbolInstances && frame.symbolInstances.length > 0) {
        const sceneRelativeOffsets = Array.from({ length: frameDuration }, (_, i) => i);
        for (const placement of frame.symbolInstances) {
          expandPlacement(
            placement,
            frameIndex,
            sceneRelativeOffsets,
            layer.sourceLayerIndex,
            1,
            new Set(),
          );
        }
      }
    }
  }

  events.sort(compareSoundEvents);
  return { events, diagnostics };
}

/**
 * Plans Shot-local standalone AudioClips for a selected FLA main Scene.
 *
 * Supports `stream`, `event`, `start` (non-restarting dedup when the same sound
 * is already active), `stop` (truncates active clips and cancels pending repeat
 * passes for that sound while allowing later triggers), and finite repeat/loop
 * expansion into multiple clips sharing the same `assetId`. Infinite loops and
 * out-of-range repeat counts emit honest diagnostics without dropping assets.
 */
export function planFlaSceneAudioClips(
  input: PlanFlaSceneAudioClipsInput,
): PlanFlaSceneAudioClipsResult {
  if (!Number.isFinite(input.sourceFps) || input.sourceFps <= 0) {
    throw new Error('FLA source frame rate must be a finite positive number.');
  }
  if (!Number.isSafeInteger(input.shotDurationMs) || input.shotDurationMs <= 0) {
    throw new Error('Target Shot duration must be a positive integer millisecond value.');
  }

  const role: StandaloneAudioRole = input.role ?? 'sfx';
  const pending: PendingPlannedClip[] = [];
  const diagnostics: FlaSoundTimelineDiagnostic[] = [];

  const orderedEvents = [...input.events].sort(compareSoundEvents);

  for (const event of orderedEvents) {
    const { sound } = event;
    const key = soundIdentityKey(sound);
    const rawStartMs = (event.frameIndex * 1000) / input.sourceFps;

    if (sound.sync === 'stop') {
      // Truncate any currently active clips for this sound and cancel any
      // scheduled future repeat passes from earlier triggers.
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index]!;
        if (candidate.soundKey !== key) continue;
        if (candidate.rawStartMs >= rawStartMs) {
          pending.splice(index, 1);
        } else if (candidate.rawEndMs > rawStartMs) {
          candidate.rawEndMs = rawStartMs;
        }
      }
      continue;
    }

    const asset = input.resolveAsset({ soundId: sound.soundId, name: sound.name });
    if (!asset) {
      diagnostics.push({
        code: sound.soundId ? 'missing-audio-asset' : 'unresolved-sound',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: sound.soundId
          ? `Audio asset for "${sound.name}" at frame ${event.frameIndex} is unavailable or missing duration metadata.`
          : `Sound "${sound.name}" at frame ${event.frameIndex} was not found in the FLA sound library.`,
      });
      continue;
    }

    if (sound.sync === 'start') {
      const alreadyActive = pending.some(
        (candidate) =>
          candidate.soundKey === key &&
          candidate.rawStartMs <= rawStartMs &&
          rawStartMs < candidate.rawEndMs,
      );
      if (alreadyActive) {
        continue;
      }
    }

    let repeatCount = 1;
    if (sound.loopMode === 'loop') {
      diagnostics.push({
        code: 'unsupported-loop',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: `Sound "${sound.name}" at frame ${event.frameIndex} uses infinite "loop" playback, which is not supported; only the first pass was placed.`,
      });
    } else if (sound.loopMode === 'repeat' || sound.loopCount !== undefined) {
      const requested = sound.loopCount ?? 1;
      if (!Number.isSafeInteger(requested) || requested <= 0 || requested > FLA_SOUND_MAX_FINITE_REPEAT) {
        diagnostics.push({
          code: 'unsupported-loop',
          soundName: sound.name,
          frameIndex: event.frameIndex,
          layerIndex: event.layerIndex,
          sync: sound.sync,
          message: `Sound "${sound.name}" at frame ${event.frameIndex} specifies repeat count ${requested}, which exceeds finite repeat support; only the first pass was placed.`,
        });
      } else {
        repeatCount = requested;
      }
    }

    const rawOffsetMs = ((sound.inPoint44 ?? 0) * 1000) / FLA_SOUND_REFERENCE_SAMPLE_RATE;
    const rawSourceEndMs =
      sound.outPoint44 !== undefined
        ? Math.min(
            (sound.outPoint44 * 1000) / FLA_SOUND_REFERENCE_SAMPLE_RATE,
            asset.durationMs,
          )
        : asset.durationMs;
    const rawAvailableSourceMs = rawSourceEndMs - rawOffsetMs;

    if (rawAvailableSourceMs <= 0) {
      diagnostics.push({
        code: 'empty-source-range',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: `Sound "${sound.name}" at frame ${event.frameIndex} has an empty source trim range after applying inPoint44/outPoint44.`,
      });
      continue;
    }

    if (Math.max(0, Math.round(rawStartMs)) >= input.shotDurationMs) {
      diagnostics.push({
        code: 'outside-shot-boundary',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: `Sound "${sound.name}" at frame ${event.frameIndex} starts at or past the target Shot end (${input.shotDurationMs} ms).`,
      });
      continue;
    }

    if (Math.max(0, Math.round(rawOffsetMs)) >= asset.durationMs) {
      diagnostics.push({
        code: 'empty-source-range',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: `Sound "${sound.name}" at frame ${event.frameIndex} starts past the audio asset duration (${asset.durationMs} ms).`,
      });
      continue;
    }

    const rawStreamEndMs =
      sound.sync === 'stream'
        ? ((event.frameIndex + event.frameDuration) * 1000) / input.sourceFps
        : Number.POSITIVE_INFINITY;
    const maxHorizonMs = Math.min(rawStreamEndMs, input.shotDurationMs);

    for (let pass = 0; pass < repeatCount; pass += 1) {
      const passStartMs = rawStartMs + pass * rawAvailableSourceMs;
      if (passStartMs >= maxHorizonMs) break;
      const passEndMs = Math.min(passStartMs + rawAvailableSourceMs, maxHorizonMs);
      if (passEndMs <= passStartMs) break;
      pending.push({
        soundKey: key,
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        assetId: asset.assetId,
        assetDurationMs: asset.durationMs,
        role,
        rawStartMs: passStartMs,
        rawEndMs: passEndMs,
        rawOffsetMs,
      });
    }
  }

  const clips: Omit<CreateAudioClipInput, 'shotId'>[] = [];
  for (const item of pending) {
    const startMs = Math.max(0, Math.round(item.rawStartMs));
    if (startMs >= input.shotDurationMs) continue;
    const offsetMs = Math.max(0, Math.round(item.rawOffsetMs));
    if (offsetMs >= item.assetDurationMs) continue;
    const maxAssetEndMs = startMs + (item.assetDurationMs - offsetMs);
    const endMs = Math.min(Math.round(item.rawEndMs), input.shotDurationMs, maxAssetEndMs);
    if (endMs <= startMs) {
      diagnostics.push({
        code: 'zero-duration-clip',
        soundName: item.soundName,
        frameIndex: item.frameIndex,
        layerIndex: item.layerIndex,
        sync: item.sync,
        message: `Sound "${item.soundName}" at frame ${item.frameIndex} resolved to a zero-duration clip after boundary trimming.`,
      });
      continue;
    }
    clips.push({
      assetId: item.assetId,
      role: item.role,
      startMs,
      endMs,
      offsetMs,
      name: item.soundName,
    });
  }

  return { clips, diagnostics };
}

/**
 * Applies planned FLA Scene AudioClips onto a Project Shot via AudioClipService
 * in a single atomic Project update.
 */
export function applyFlaSceneAudioClips(
  project: Project,
  input: PlanFlaSceneAudioClipsInput,
  audioClipService: AudioClipService = new AudioClipService(),
): ApplyFlaSceneAudioClipsResult {
  const beforeShot = project.shots.find((shot) => shot.id === input.shotId);
  if (!beforeShot) {
    throw new Error(`Unknown Shot: ${input.shotId}`);
  }
  const previousCount = beforeShot.audioClips.length;
  const plan = planFlaSceneAudioClips(input);
  const nextProject = audioClipService.createMany(project, input.shotId, plan.clips);
  const afterShot = nextProject.shots.find((shot) => shot.id === input.shotId)!;
  const createdClipIds = afterShot.audioClips
    .slice(previousCount)
    .map((clip) => clip.id);

  return {
    project: nextProject,
    createdClipIds,
    diagnostics: plan.diagnostics,
  };
}
