/**
 * Pure, store-free helpers behind the Stage 1B product preview overlay.
 *
 * Everything here is a deterministic function of the *already loaded* formal
 * project. The overlay reuses the formal evaluator (`evaluateShotAtTime`) and
 * the formal renderer (`buildStageRenderModel` via `StageRenderer`), so this
 * module deliberately contains no rendering, no IPC, and no store access: it
 * only prepares inputs (asset ids, subtitle cues) and advances the overlay's
 * own local playback clock.
 *
 * Read-only guarantee: no function in this file mutates the project, the
 * revision, the dirty flag, the selection or the history. They all take the
 * project as a readonly input and return new values.
 */
import {
  listShotImageAssets,
  type AudioClip,
  type Project,
  type Shot,
  type SubtitleStyle,
} from '../../domain';
import type { SubtitleCue } from '../../shared/preview/subtitle-engine';

/**
 * Upper bound for a single playback step. A background tab, a blocked main
 * thread or a paused animation frame can produce a very large delta; clamping
 * keeps the preview from jumping across the whole shot in one frame.
 */
export const PRODUCT_PREVIEW_MAX_STEP_MS = 250;

/** Longest subtitle text the shared subtitle contract accepts. */
const PRODUCT_PREVIEW_MAX_CUE_LENGTH = 500;

export interface ProductPreviewAudioClip {
  clip: AudioClip;
  assetId: string;
  sha256: string | undefined;
  durationMs: number | undefined;
}

export interface ProductPreviewTimeStep {
  /** Clamped, integer millisecond position inside `[0, durationMs]`. */
  timeMs: number;
  /** True once the clock reached the end of the shot. */
  ended: boolean;
}

/**
 * Finds the shot the overlay should render. Returns `null` when the project
 * has no shots at all, or when the requested shot no longer exists.
 */
export function resolveProductPreviewShot(
  project: Project,
  shotId: string | null,
): Shot | null {
  if (project.shots.length === 0) {
    return null;
  }
  if (shotId === null) {
    return project.shots[0] ?? null;
  }
  return (
    project.shots.find((candidate) => candidate.id === shotId) ??
    project.shots[0] ??
    null
  );
}

/**
 * Lists every image asset id the shot can display at *any* time.
 *
 * The base layer assets are not enough: an `expression` timeline event can
 * swap a character layer to another expression mid-shot, so every expression
 * of every character used by the shot must be preloaded too. Otherwise the
 * formal render model would throw `MISSING_ASSET_URL` in the middle of
 * playback.
 */
export function listProductPreviewAssetIds(
  project: Project,
  shot: Shot,
): string[] {
  const assetIds = new Set<string>();
  for (const asset of listShotImageAssets(project, shot.layers)) {
    assetIds.add(asset.id);
  }

  const characterIds = new Set<string>();
  for (const layer of shot.layers) {
    if (layer.source.kind === 'character') {
      characterIds.add(layer.source.characterId);
    }
  }
  for (const character of project.characters) {
    if (!characterIds.has(character.id)) continue;
    for (const expression of character.expressions) {
      const asset = project.assets.find(
        (candidate) => candidate.id === expression.assetId,
      );
      if (asset?.kind === 'image') {
        assetIds.add(asset.id);
      }
    }
    if (character.mouthOpenAssetId) {
      const mouthAsset = project.assets.find(
        (candidate) => candidate.id === character.mouthOpenAssetId,
      );
      if (mouthAsset?.kind === 'image') assetIds.add(mouthAsset.id);
    }
  }

  return [...assetIds];
}

/**
 * Projects the shot dialogues onto the shared subtitle cue contract so the
 * overlay can reuse `evaluateSubtitleAtTime` instead of re-implementing
 * subtitle timing. Dialogues with a non-positive span carry no visible window
 * and are dropped; text is trimmed and capped to the shared contract limit.
 */
export function buildProductPreviewCues(shot: Shot): SubtitleCue[] {
  return shot.dialogues
    .filter((dialogue) => dialogue.endMs > dialogue.startMs)
    .map((dialogue) => ({
      id: dialogue.id,
      startMs: Math.max(0, Math.round(dialogue.startMs)),
      endMs: Math.max(1, Math.round(dialogue.endMs)),
      text: dialogue.text.trim().slice(0, PRODUCT_PREVIEW_MAX_CUE_LENGTH),
      ...(dialogue.subtitleStyleId
        ? { styleId: dialogue.subtitleStyleId }
        : {}),
    }))
    .filter((cue) => cue.text.length > 0 && cue.endMs > cue.startMs)
    .sort(
      (left, right) =>
        left.startMs - right.startMs ||
        left.endMs - right.endMs ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

/** Maps persisted audio clips to their validated project assets. */
export function listProductPreviewAudioClips(
  project: Project,
  shot: Shot,
): ProductPreviewAudioClip[] {
  return shot.audioClips
    .map((clip) => {
      const asset = project.assets.find(
        (candidate) => candidate.id === clip.assetId,
      );
      if (!asset || asset.kind !== 'audio') return null;
      return {
        clip,
        assetId: asset.id,
        sha256: asset.sha256,
        durationMs: asset.durationMs,
      } satisfies ProductPreviewAudioClip;
    })
    .filter((entry): entry is ProductPreviewAudioClip => entry !== null)
    .sort((left, right) =>
      right.clip.startMs - left.clip.startMs ||
      right.clip.endMs - left.clip.endMs ||
      (left.clip.id < right.clip.id ? -1 : left.clip.id > right.clip.id ? 1 : 0),
    );
}

export function selectProductPreviewAudioClipAtTime(
  clips: readonly ProductPreviewAudioClip[],
  timeMs: number,
): ProductPreviewAudioClip | null {
  const safeTimeMs = Math.max(0, Math.round(timeMs));
  return (
    clips.find(
      ({ clip }) =>
        safeTimeMs >= clip.startMs && safeTimeMs < clip.endMs,
    ) ?? null
  );
}

export function resolveProductPreviewSubtitleStyle(
  project: Project,
  cue: SubtitleCue | null,
): SubtitleStyle | undefined {
  if (!cue?.styleId) return undefined;
  return project.subtitleStyles.find((style) => style.id === cue.styleId);
}

/** Clamps an arbitrary position into the shot's integer millisecond range. */
export function clampProductPreviewTime(
  requestedTimeMs: number,
  durationMs: number,
): number {
  if (!Number.isFinite(requestedTimeMs)) {
    return 0;
  }
  const maximum = Math.max(0, Math.round(durationMs));
  return Math.min(maximum, Math.max(0, Math.round(requestedTimeMs)));
}

/**
 * Advances the overlay's own playback clock by one animation frame. Pure: the
 * caller owns the resulting state, nothing global is touched.
 */
export function advanceProductPreviewTime(
  currentTimeMs: number,
  deltaMs: number,
  durationMs: number,
): ProductPreviewTimeStep {
  const step = Math.min(
    PRODUCT_PREVIEW_MAX_STEP_MS,
    Math.max(0, Number.isFinite(deltaMs) ? deltaMs : 0),
  );
  const maximum = Math.max(0, Math.round(durationMs));
  const timeMs = clampProductPreviewTime(currentTimeMs + step, maximum);
  return { timeMs, ended: timeMs >= maximum };
}

/** Formats a millisecond position as `分:秒.百分秒`, e.g. `0:03.20`. */
export function formatProductPreviewTimecode(timeMs: number): string {
  const safeTimeMs = Math.max(0, Math.round(timeMs));
  const minutes = Math.floor(safeTimeMs / 60_000);
  const seconds = Math.floor((safeTimeMs % 60_000) / 1_000);
  const hundredths = Math.floor((safeTimeMs % 1_000) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${String(
    hundredths,
  ).padStart(2, '0')}`;
}
