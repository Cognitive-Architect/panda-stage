import type { Project } from './models/project';
import {
  AudioClipService,
  type CreateAudioClipInput,
  type StandaloneAudioRole,
} from './services/AudioClipService';

/**
 * Adobe Animate / XFL `inPoint44` and `outPoint44` are always expressed in
 * samples at the fixed 44.1 kHz reference clock, regardless of the actual
 * sample rate of the embedded audio asset.
 */
export const FLA_SOUND_REFERENCE_SAMPLE_RATE = 44_100;

export type FlaSoundTimelineSync = 'event' | 'start' | 'stop' | 'stream';
export type FlaSoundTimelineLoopMode = 'repeat' | 'loop';

export type FlaSoundTimelineDiagnosticCode =
  | 'unsupported-sync'
  | 'unsupported-loop'
  | 'unresolved-sound'
  | 'missing-audio-asset'
  | 'outside-shot-boundary'
  | 'empty-source-range'
  | 'zero-duration-clip';

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

export interface FlaTimelineSoundSource {
  readonly layers: readonly {
    readonly sourceLayerIndex: number;
    readonly frames: readonly {
      readonly sourceFrameIndex: number;
      readonly startFrame: number;
      readonly duration: number;
      readonly sound?: FlaSceneFrameSoundDescriptor;
    }[];
  }[];
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

/**
 * Extracts sound events from a parsed FLA Scene timeline in deterministic
 * chronological order (frameIndex ascending, then sourceLayerIndex ascending).
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
  events.sort(
    (left, right) =>
      left.frameIndex - right.frameIndex || left.layerIndex - right.layerIndex,
  );
  return events;
}

/**
 * Plans Shot-local standalone AudioClips for a selected FLA main Scene.
 *
 * S05-A supports `stream` and `event` sync modes, converting source frame
 * indices using `sourceFps` and `inPoint44`/`outPoint44` using the fixed
 * 44,100 Hz reference rate, rounding to integer milliseconds only at the end.
 * Unsupported sync/loop semantics emit local diagnostics without dropping
 * audio assets.
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
  const clips: Omit<CreateAudioClipInput, 'shotId'>[] = [];
  const diagnostics: FlaSoundTimelineDiagnostic[] = [];

  const orderedEvents = [...input.events].sort(
    (left, right) =>
      left.frameIndex - right.frameIndex || left.layerIndex - right.layerIndex,
  );

  for (const event of orderedEvents) {
    const { sound } = event;
    if (sound.sync !== 'stream' && sound.sync !== 'event') {
      diagnostics.push({
        code: 'unsupported-sync',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: `Sound "${sound.name}" at frame ${event.frameIndex} uses "${sound.sync}" sync, which is not yet recovered into timeline clips (asset preserved).`,
      });
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

    const hasUnsupportedLoop =
      sound.loopMode === 'loop' ||
      sound.loopMode === 'repeat' ||
      (sound.loopCount !== undefined && sound.loopCount > 1);
    if (hasUnsupportedLoop) {
      diagnostics.push({
        code: 'unsupported-loop',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: `Sound "${sound.name}" at frame ${event.frameIndex} specifies loop/repeat playback, which is not yet expanded; only the first pass was placed.`,
      });
    }

    const rawStartMs = (event.frameIndex * 1000) / input.sourceFps;
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

    const rawStreamEndMs =
      sound.sync === 'stream'
        ? ((event.frameIndex + event.frameDuration) * 1000) / input.sourceFps
        : Number.POSITIVE_INFINITY;
    const rawEndMs = Math.min(
      rawStartMs + rawAvailableSourceMs,
      rawStreamEndMs,
      input.shotDurationMs,
    );

    const startMs = Math.max(0, Math.round(rawStartMs));
    if (startMs >= input.shotDurationMs) {
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

    const offsetMs = Math.max(0, Math.round(rawOffsetMs));
    if (offsetMs >= asset.durationMs) {
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

    const maxAssetEndMs = startMs + (asset.durationMs - offsetMs);
    const endMs = Math.min(Math.round(rawEndMs), input.shotDurationMs, maxAssetEndMs);
    if (endMs <= startMs) {
      diagnostics.push({
        code: 'zero-duration-clip',
        soundName: sound.name,
        frameIndex: event.frameIndex,
        layerIndex: event.layerIndex,
        sync: sound.sync,
        message: `Sound "${sound.name}" at frame ${event.frameIndex} resolved to a zero-duration clip after boundary trimming.`,
      });
      continue;
    }

    clips.push({
      assetId: asset.assetId,
      role,
      startMs,
      endMs,
      offsetMs,
      name: sound.name,
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
