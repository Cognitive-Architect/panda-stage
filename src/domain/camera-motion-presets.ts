import { solveCameraCenterForWorldPoint } from './camera-projection';
import { sliceAnimationCurve } from './evaluate-animation-core';
import { evaluateShotAtTime } from './evaluate-shot-at-time';
import { evaluatedLayerWorldMatrix } from './layer-parent-space';
import { ProjectSchema, type Project, type Shot } from './models';
import type { AnimationCurve, AnimationInterpolation } from './models/animationCore';
import type { ManualCameraPose, ShotCameraKey, ShotCameraOverride } from './models/shotCamera';
import { fullStageCamera } from './resolve-speaker-focus-camera';
import {
  DEFAULT_CAMERA_OVERRIDE_BLEND_MS,
  evaluateManualCamera,
  prepareShotCamera,
} from './shot-camera';
import { frameTimeMs, resolveTimelineFrameTime, TIMELINE_FPS } from './timeline/frame-grid';

export type CameraMotionPresetId =
  | 'push-in'
  | 'pull-out'
  | 'pan-horizontal'
  | 'pan-vertical'
  | 'a-to-b'
  | 'return-to-full-stage';

export const CAMERA_MOTION_PRESET_LABELS: Readonly<Record<CameraMotionPresetId, string>> = {
  'push-in': '推近',
  'pull-out': '拉远',
  'pan-horizontal': '水平平移',
  'pan-vertical': '垂直平移',
  'a-to-b': 'A→B 构图',
  'return-to-full-stage': '回全景',
};

export const DEFAULT_CAMERA_PRESET_DURATION_MS = 1_000;
export const DEFAULT_CAMERA_PRESET_ZOOM_FACTOR = 1.35;
export const DEFAULT_CAMERA_PRESET_PAN_X_PX = 240;
export const DEFAULT_CAMERA_PRESET_PAN_Y_PX = 180;

export type CameraPresetHybridAction = 'use-selected-override' | 'create-override';

export interface ApplyCameraMotionPresetInput {
  preset: CameraMotionPresetId;
  startTimeMs: number;
  durationMs: number;
  easing?: AnimationInterpolation;
  curveToNext?: AnimationCurve;
  /** Zoom factor (> 1) for push-in/pull-out, or pixel offset for pan-horizontal/pan-vertical. */
  amplitude?: number;
  /** Optional explicit end zoom (must be > 0). Overrides amplitude-derived zoom when set. */
  targetZoom?: number;
  /** Optional explicit start framing overrides (unspecified fields inherit sampled start camera). */
  startPose?: Partial<ManualCameraPose>;
  /** Optional explicit end framing overrides (unspecified fields inherit preset/start values). */
  endPose?: Partial<ManualCameraPose>;
  /** Optional target layer sampled at startTimeMs for world position & effective depth. */
  startTargetLayerId?: string | null;
  /** Optional target layer sampled at endTimeMs for world position & effective depth. */
  targetLayerId?: string | null;
  /** Whether to append an explicit return key restoring start framing after endTimeMs. */
  returnToStart?: boolean;
  /** Duration of the explicit return segment in ms (defaults to durationMs). */
  returnDurationMs?: number;
  /** Easing of the explicit return segment (defaults to easing). */
  returnEasing?: AnimationInterpolation;
  /** Optional custom curve for the explicit return segment. */
  returnCurveToNext?: AnimationCurve;
  /** Must be explicitly true to replace conflicting keys inside [startTimeMs, rangeEndMs]. */
  overwriteExisting?: boolean;
  /** Hybrid mode strategy: reuse a covering override or explicitly create a new override. */
  hybridAction?: CameraPresetHybridAction;
  /** Hybrid mode: preferred override ID to reuse. */
  selectedOverrideId?: string | null;
  /** Optional deterministic ID for a newly created Hybrid override. */
  overrideId?: string;
}

export interface CameraMotionPresetPlan {
  startTimeMs: number;
  endTimeMs: number;
  returnTimeMs: number | null;
  rangeEndMs: number;
  startPose: ManualCameraPose;
  endPose: ManualCameraPose;
  keysToWrite: ShotCameraKey[];
  conflictingKeyTimes: number[];
  suggestedFreeStartMs: number | null;
  hybridMode: boolean;
  reusedOverrideId: string | null;
  createOverrideRange: { startMs: number; endMs: number } | null;
}

function nextFrameAfter(timeMs: number, durationMs: number): number | null {
  const frameIndex = Math.round((timeMs * TIMELINE_FPS) / 1_000) + 1;
  const candidate = frameTimeMs(frameIndex);
  return candidate <= durationMs ? candidate : null;
}

function resolveSpanEndpoints(
  startMs: number,
  durationMs: number,
  returnToStart: boolean,
  returnDurationMs: number,
  shotDurationMs: number,
): { startTimeMs: number; endTimeMs: number; returnTimeMs: number | null; rangeEndMs: number } | null {
  const startTimeMs = resolveTimelineFrameTime(startMs, shotDurationMs);
  const rawEnd = startTimeMs + durationMs;
  if (rawEnd > shotDurationMs) return null;
  const endTimeMs = resolveTimelineFrameTime(rawEnd, shotDurationMs);
  if (endTimeMs <= startTimeMs || endTimeMs > shotDurationMs) return null;
  if (!returnToStart) {
    return { startTimeMs, endTimeMs, returnTimeMs: null, rangeEndMs: endTimeMs };
  }
  const rawReturn = endTimeMs + returnDurationMs;
  if (rawReturn > shotDurationMs) return null;
  const returnTimeMs = resolveTimelineFrameTime(rawReturn, shotDurationMs);
  if (returnTimeMs <= endTimeMs || returnTimeMs > shotDurationMs) return null;
  return { startTimeMs, endTimeMs, returnTimeMs, rangeEndMs: returnTimeMs };
}

/**
 * Find the nearest free author-frame start time within `bounds` (default `[0, shot.durationMs]`)
 * where `[startTimeMs, rangeEndMs]` has no existing camera keys.
 */
export function findFreeCameraPresetStartMs(
  shot: Shot,
  durationMs: number,
  preferredStartMs: number,
  options: {
    returnToStart?: boolean;
    returnDurationMs?: number;
    bounds?: { startMs: number; endMs: number };
  } = {},
): number | null {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return null;
  const returnToStart = Boolean(options.returnToStart);
  const returnDurationMs = options.returnDurationMs ?? durationMs;
  if (returnToStart && (!Number.isFinite(returnDurationMs) || returnDurationMs <= 0)) return null;

  const minStart = options.bounds ? Math.max(0, options.bounds.startMs) : 0;
  const maxEnd = options.bounds ? Math.min(shot.durationMs, options.bounds.endMs) : shot.durationMs;
  if (maxEnd <= minStart) return null;

  const keys = shot.camera?.keys ?? [];
  const preferred = resolveTimelineFrameTime(
    Math.min(maxEnd, Math.max(minStart, Number.isFinite(preferredStartMs) ? preferredStartMs : minStart)),
    shot.durationMs,
  );

  const isFree = (candidateStart: number): boolean => {
    const span = resolveSpanEndpoints(candidateStart, durationMs, returnToStart, returnDurationMs, shot.durationMs);
    if (!span || span.startTimeMs < minStart || span.rangeEndMs > maxEnd) return false;
    return !keys.some((key) => key.timeMs >= span.startTimeMs && key.timeMs <= span.rangeEndMs);
  };

  if (isFree(preferred)) return preferred;

  const candidates = new Set<number>();
  const minFrame = resolveTimelineFrameTime(minStart, shot.durationMs);
  if (minFrame >= minStart) {
    candidates.add(minFrame);
  } else {
    const next = nextFrameAfter(minFrame, maxEnd);
    if (next !== null) candidates.add(next);
  }
  for (const key of keys) {
    if (key.timeMs < minStart || key.timeMs >= maxEnd) continue;
    const after = nextFrameAfter(key.timeMs, maxEnd);
    if (after !== null && after >= minStart) candidates.add(after);
  }

  let best: number | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isFree(candidate)) continue;
    const distance = Math.abs(candidate - preferred);
    if (distance < bestDistance || (distance === bestDistance && best !== null && candidate > best)) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function sampleLayerCameraCenter(
  project: Project,
  shot: Shot,
  layerId: string,
  timeMs: number,
  zoom: number,
): { centerX: number; centerY: number } {
  const layer = shot.layers.find((entry) => entry.id === layerId);
  if (!layer) {
    throw new Error('找不到所选构图目标图层。');
  }
  const evaluated = evaluateShotAtTime(shot, timeMs, project, { includeShake: false })
    .layers.find((entry) => entry.id === layerId);
  if (!evaluated) {
    throw new Error('无法在目标时刻采样所选图层。');
  }
  const anchor = evaluated.parentSpace
    ? evaluatedLayerWorldMatrix(evaluated)
    : { tx: evaluated.x, ty: evaluated.y };
  const solved = solveCameraCenterForWorldPoint(
    anchor.tx,
    anchor.ty,
    project.width,
    project.height,
    zoom,
    evaluated.effectiveDepth ?? 0,
    evaluated.effectiveCameraSpace ?? 'world',
  );
  if (!solved) {
    throw new Error('目标图层位于屏幕空间或在当前倍率下被近裁剪，无法作为相机构图目标。');
  }
  return solved;
}

function validatePose(pose: ManualCameraPose, label: string): ManualCameraPose {
  if (
    !Number.isFinite(pose.centerX) ||
    !Number.isFinite(pose.centerY) ||
    !Number.isFinite(pose.zoom) ||
    !Number.isFinite(pose.rotationDeg)
  ) {
    throw new Error(`${label}包含无效数值。`);
  }
  if (pose.zoom <= 0) {
    throw new Error(`${label}倍率必须大于 0。`);
  }
  return pose;
}

function resolveBaseStartPose(
  project: Project,
  shot: Shot,
  startTimeMs: number,
  sampleEffectiveHybridCamera: boolean,
): ManualCameraPose {
  const keys = shot.camera?.keys ?? [];
  if (shot.camera?.mode === 'hybrid' && (keys.length === 0 || sampleEffectiveHybridCamera)) {
    const view = prepareShotCamera(project, shot, 'speaker-focus')(startTimeMs)
      ?? fullStageCamera(project.width, project.height);
    return {
      centerX: view.centerX,
      centerY: view.centerY,
      zoom: view.zoom,
      rotationDeg: view.rotationDeg ?? 0,
    };
  }
  return evaluateManualCamera(shot, startTimeMs);
}

/**
 * Validate and plan a camera motion preset without mutating the project.
 * Computes exact snapped endpoints, target-layer world/depth centers, conflicts, and Hybrid override strategy.
 */
export function planCameraMotionPreset(
  project: Project,
  shotId: string,
  input: ApplyCameraMotionPresetInput,
): CameraMotionPresetPlan {
  const shot = project.shots.find((entry) => entry.id === shotId);
  if (!shot) throw new Error('找不到当前镜头。');

  const mode = shot.camera?.mode;
  if (mode !== 'manual' && mode !== 'hybrid') {
    throw new Error('当前镜头为自动或固定相机模式，请先切换到手工运镜或自动+手工接管后再应用运镜预设。');
  }

  if (!Number.isFinite(input.startTimeMs) || input.startTimeMs < 0 || input.startTimeMs > shot.durationMs) {
    throw new Error('预设开始时间超出镜头范围。');
  }
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) {
    throw new Error('预设持续时间必须大于 0。');
  }
  const returnToStart = Boolean(input.returnToStart);
  const returnDurationMs = input.returnDurationMs ?? input.durationMs;
  if (returnToStart && (!Number.isFinite(returnDurationMs) || returnDurationMs <= 0)) {
    throw new Error('恢复构图的持续时间必须大于 0。');
  }

  const span = resolveSpanEndpoints(
    input.startTimeMs,
    input.durationMs,
    returnToStart,
    returnDurationMs,
    shot.durationMs,
  );
  if (!span) {
    throw new Error('运镜预设时段超出当前镜头时长或不足一帧。');
  }
  const { startTimeMs, endTimeMs, returnTimeMs, rangeEndMs } = span;

  const hybridMode = mode === 'hybrid';
  const overrides = shot.camera?.overrides ?? [];
  let reusedOverrideId: string | null = null;
  let createOverrideRange: { startMs: number; endMs: number } | null = null;
  let freeSearchBounds: { startMs: number; endMs: number } | undefined;

  if (hybridMode) {
    const hybridAction = input.hybridAction ?? 'use-selected-override';
    if (hybridAction === 'create-override') {
      const overlaps = overrides.some((override) => startTimeMs < override.endMs && override.startMs < rangeEndMs);
      if (overlaps) {
        throw new Error('新建接管区间与已有接管区间重叠，请调整开始时间或复用已有接管段。');
      }
      createOverrideRange = { startMs: startTimeMs, endMs: rangeEndMs };
    } else {
      const selected = input.selectedOverrideId
        ? overrides.find((override) => override.id === input.selectedOverrideId)
        : overrides.find((override) => startTimeMs >= override.startMs && startTimeMs < override.endMs);
      if (!selected) {
        throw new Error('自动+手工接管模式下请先选中已有接管段，或选择新建接管段后再应用运镜预设。');
      }
      if (startTimeMs < selected.startMs || rangeEndMs > selected.endMs) {
        throw new Error('运镜预设时段超出当前选中的接管区间，请缩短时长、调整位置或新建接管段。');
      }
      reusedOverrideId = selected.id;
      freeSearchBounds = { startMs: selected.startMs, endMs: selected.endMs };
    }
  }

  const baseStart = resolveBaseStartPose(project, shot, startTimeMs, createOverrideRange !== null);
  const startZoom = input.startPose?.zoom ?? baseStart.zoom;
  if (!Number.isFinite(startZoom) || startZoom <= 0) {
    throw new Error('起始构图倍率必须大于 0。');
  }
  const startRotation = input.startPose?.rotationDeg ?? baseStart.rotationDeg;
  const sampledStartCenter = input.startTargetLayerId
    ? sampleLayerCameraCenter(project, shot, input.startTargetLayerId, startTimeMs, startZoom)
    : null;
  const startPose = validatePose(
    {
      centerX: input.startPose?.centerX ?? sampledStartCenter?.centerX ?? baseStart.centerX,
      centerY: input.startPose?.centerY ?? sampledStartCenter?.centerY ?? baseStart.centerY,
      zoom: startZoom,
      rotationDeg: startRotation,
    },
    '起始构图',
  );

  let defaultEndZoom = startPose.zoom;
  let defaultEndCenter = { centerX: startPose.centerX, centerY: startPose.centerY };
  switch (input.preset) {
    case 'push-in': {
      const explicitZoom = input.endPose?.zoom ?? input.targetZoom;
      if (explicitZoom !== undefined) {
        defaultEndZoom = explicitZoom;
      } else {
        const factor = input.amplitude ?? DEFAULT_CAMERA_PRESET_ZOOM_FACTOR;
        if (!Number.isFinite(factor) || factor <= 1) {
          throw new Error('推近幅度倍率必须大于 1。');
        }
        defaultEndZoom = startPose.zoom * factor;
      }
      if (input.targetLayerId) {
        defaultEndCenter = sampleLayerCameraCenter(project, shot, input.targetLayerId, endTimeMs, defaultEndZoom);
      }
      break;
    }
    case 'pull-out': {
      const explicitZoom = input.endPose?.zoom ?? input.targetZoom;
      if (explicitZoom !== undefined) {
        defaultEndZoom = explicitZoom;
      } else {
        const factor = input.amplitude ?? DEFAULT_CAMERA_PRESET_ZOOM_FACTOR;
        if (!Number.isFinite(factor) || factor <= 1) {
          throw new Error('拉远幅度倍率必须大于 1。');
        }
        defaultEndZoom = startPose.zoom / factor;
      }
      if (input.targetLayerId) {
        defaultEndCenter = sampleLayerCameraCenter(project, shot, input.targetLayerId, endTimeMs, defaultEndZoom);
      }
      break;
    }
    case 'pan-horizontal': {
      const deltaX = input.amplitude ?? DEFAULT_CAMERA_PRESET_PAN_X_PX;
      if (!Number.isFinite(deltaX)) throw new Error('水平平移幅度必须是有效数值。');
      defaultEndZoom = input.endPose?.zoom ?? input.targetZoom ?? startPose.zoom;
      defaultEndCenter = { centerX: startPose.centerX + deltaX, centerY: startPose.centerY };
      break;
    }
    case 'pan-vertical': {
      const deltaY = input.amplitude ?? DEFAULT_CAMERA_PRESET_PAN_Y_PX;
      if (!Number.isFinite(deltaY)) throw new Error('垂直平移幅度必须是有效数值。');
      defaultEndZoom = input.endPose?.zoom ?? input.targetZoom ?? startPose.zoom;
      defaultEndCenter = { centerX: startPose.centerX, centerY: startPose.centerY + deltaY };
      break;
    }
    case 'a-to-b': {
      defaultEndZoom = input.endPose?.zoom ?? input.targetZoom ?? startPose.zoom;
      if (input.targetLayerId) {
        defaultEndCenter = sampleLayerCameraCenter(project, shot, input.targetLayerId, endTimeMs, defaultEndZoom);
      }
      break;
    }
    case 'return-to-full-stage': {
      const full = fullStageCamera(project.width, project.height);
      defaultEndZoom = input.endPose?.zoom ?? input.targetZoom ?? full.zoom;
      defaultEndCenter = { centerX: full.centerX, centerY: full.centerY };
      break;
    }
  }

  const endPose = validatePose(
    {
      centerX: input.endPose?.centerX ?? defaultEndCenter.centerX,
      centerY: input.endPose?.centerY ?? defaultEndCenter.centerY,
      zoom: input.endPose?.zoom ?? defaultEndZoom,
      rotationDeg: input.endPose?.rotationDeg ?? startPose.rotationDeg,
    },
    '结束构图',
  );

  const easing: AnimationInterpolation = input.easing ?? 'ease-in-out';
  const returnEasing: AnimationInterpolation = input.returnEasing ?? easing;

  const keysToWrite: ShotCameraKey[] = [
    {
      ...startPose,
      timeMs: startTimeMs,
      interpolationToNext: easing,
      ...(input.curveToNext ? { curveToNext: input.curveToNext } : {}),
    },
    {
      ...endPose,
      timeMs: endTimeMs,
      interpolationToNext: returnToStart ? returnEasing : 'linear',
      ...(returnToStart && input.returnCurveToNext ? { curveToNext: input.returnCurveToNext } : {}),
    },
  ];
  if (returnToStart && returnTimeMs !== null) {
    keysToWrite.push({
      ...startPose,
      timeMs: returnTimeMs,
      interpolationToNext: 'linear',
    });
  }

  const existingKeys = shot.camera?.keys ?? [];
  const conflictingKeyTimes = existingKeys
    .filter((key) => key.timeMs >= startTimeMs && key.timeMs <= rangeEndMs)
    .map((key) => key.timeMs);

  const suggestedFreeStartMs = conflictingKeyTimes.length > 0
    ? findFreeCameraPresetStartMs(shot, input.durationMs, startTimeMs, {
        returnToStart,
        returnDurationMs,
        bounds: freeSearchBounds,
      })
    : startTimeMs;

  return {
    startTimeMs,
    endTimeMs,
    returnTimeMs,
    rangeEndMs,
    startPose,
    endPose,
    keysToWrite,
    conflictingKeyTimes,
    suggestedFreeStartMs,
    hybridMode,
    reusedOverrideId,
    createOverrideRange,
  };
}

/**
 * Apply a parameterized camera motion preset as ordinary `ShotCameraKey`s (plus optional Hybrid override)
 * in a single immutable project transition, preserving adjacent segment curves and continuous rotation.
 */
export function applyCameraMotionPreset(
  project: Project,
  shotId: string,
  input: ApplyCameraMotionPresetInput,
  options: { createId?: () => string } = {},
): Project {
  const plan = planCameraMotionPreset(project, shotId, input);
  if (plan.conflictingKeyTimes.length > 0 && !input.overwriteExisting) {
    throw new Error(
      `时段 ${plan.startTimeMs}–${plan.rangeEndMs} ms 内已有 ${plan.conflictingKeyTimes.length} 个相机关键帧，请改到空闲时段或明确确认覆盖后再应用。`,
    );
  }

  const shot = project.shots.find((entry) => entry.id === shotId)!;
  const originalKeys = shot.camera?.keys ?? [];

  const keysBefore = originalKeys
    .filter((key) => key.timeMs < plan.startTimeMs)
    .map((key) => ({ ...key }));
  const keysAfter = originalKeys
    .filter((key) => key.timeMs > plan.rangeEndMs)
    .map((key) => ({ ...key }));

  // Preserve incoming segment curve when inserting startTimeMs inside an existing segment.
  const prevBeforeStart = keysBefore.at(-1);
  if (prevBeforeStart) {
    const origAfterPrev = originalKeys.find((key) => key.timeMs > prevBeforeStart.timeMs);
    if (origAfterPrev && origAfterPrev.timeMs > plan.startTimeMs) {
      const split = (plan.startTimeMs - prevBeforeStart.timeMs) / (origAfterPrev.timeMs - prevBeforeStart.timeMs);
      keysBefore[keysBefore.length - 1] = {
        ...prevBeforeStart,
        curveToNext: sliceAnimationCurve(prevBeforeStart.curveToNext, 0, split),
      };
    }
  }

  // Preserve outgoing segment curve from rangeEndMs to the first key after rangeEndMs.
  const writtenKeys = plan.keysToWrite.map((key) => ({ ...key }));
  const lastWritten = writtenKeys[writtenKeys.length - 1]!;
  const firstAfterEnd = keysAfter[0];
  if (firstAfterEnd) {
    const exactAtEnd = originalKeys.find((key) => key.timeMs === plan.rangeEndMs);
    if (exactAtEnd) {
      lastWritten.interpolationToNext = exactAtEnd.interpolationToNext;
      if (exactAtEnd.curveToNext) {
        lastWritten.curveToNext = exactAtEnd.curveToNext;
      } else {
        delete lastWritten.curveToNext;
      }
    } else {
      let origBeforeEnd: ShotCameraKey | undefined;
      for (const candidate of originalKeys) {
        if (candidate.timeMs < plan.rangeEndMs) origBeforeEnd = candidate;
        else break;
      }
      if (origBeforeEnd) {
        const origAfterEnd = originalKeys.find((key) => key.timeMs > origBeforeEnd.timeMs);
        if (origAfterEnd && origAfterEnd.timeMs > plan.rangeEndMs) {
          const split = (plan.rangeEndMs - origBeforeEnd.timeMs) / (origAfterEnd.timeMs - origBeforeEnd.timeMs);
          lastWritten.interpolationToNext = origBeforeEnd.interpolationToNext;
          lastWritten.curveToNext = sliceAnimationCurve(origBeforeEnd.curveToNext, split, 1);
        }
      }
    }
  }

  const nextKeys = [...keysBefore, ...writtenKeys, ...keysAfter];
  let nextOverrides: ShotCameraOverride[] | undefined = shot.camera?.overrides
    ? [...shot.camera.overrides]
    : undefined;

  if (plan.createOverrideRange) {
    const id = input.overrideId ?? (options.createId ? options.createId() : crypto.randomUUID());
    const existingOverrides = nextOverrides ?? [];
    if (existingOverrides.some((override) => override.id === id)) {
      throw new Error('接管区间标识重复。');
    }
    const created: ShotCameraOverride = {
      id,
      startMs: plan.createOverrideRange.startMs,
      endMs: plan.createOverrideRange.endMs,
      blendInMs: DEFAULT_CAMERA_OVERRIDE_BLEND_MS,
      blendOutMs: DEFAULT_CAMERA_OVERRIDE_BLEND_MS,
    };
    nextOverrides = [...existingOverrides, created].sort((a, b) => a.startMs - b.startMs);
  }

  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((entry) => entry === shot
      ? {
          ...shot,
          camera: {
            mode: shot.camera!.mode,
            keys: nextKeys,
            ...(nextOverrides?.length ? { overrides: nextOverrides } : {}),
            ...(shot.camera?.autoFraming ? { autoFraming: shot.camera.autoFraming } : {}),
          },
        }
      : entry),
  });
}
