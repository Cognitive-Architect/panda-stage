import type {
  AdaptivePartsCharacter,
  CharacterPart,
  Layer,
  PartPosePoint,
} from '../../../domain';
import { isValidFrameTime } from '../../../domain';

const KNOWN_PART_LABELS: Readonly<Record<string, string>> = {
  Torso: '身体',
  Head: '头部',
  'Upper arm': '上臂',
  Forearm: '前臂',
};

/** Keep Part names consistent between the inspector and Timeline. */
export function getPartPosePartLabel(
  displayName: string | undefined,
  index: number,
): string {
  const name = displayName?.trim();
  if (!name) return `部件 ${index + 1}`;
  return KNOWN_PART_LABELS[name] ?? name;
}

/** The shared visibility, lock, frame, collision, and calibration add-key rule. */
export function canAddPartPoseKeyAtTime(input: {
  part: Pick<CharacterPart, 'visible'> | undefined;
  layerLocked: boolean;
  timeMs: number;
  durationMs: number;
  hasKeyAtTime: boolean;
  calibratingPivot: boolean;
}): boolean {
  const {
    part,
    layerLocked,
    timeMs,
    durationMs,
    hasKeyAtTime,
    calibratingPivot,
  } = input;
  return Boolean(
    part &&
      part.visible !== false &&
      !layerLocked &&
      isValidFrameTime(timeMs) &&
      timeMs <= durationMs &&
      !hasKeyAtTime &&
      !calibratingPivot,
  );
}

/** Resolve the parts editable on this instance, preserving its captured action snapshot. */
export function resolvePartPoseEditorParts(
  character: AdaptivePartsCharacter,
  layer: Pick<Layer, 'poseAnimation'>,
): readonly CharacterPart[] {
  return layer.poseAnimation?.tracks ?? character.parts;
}

/** Ephemeral canvas/inspector mode owned by EditorShell, never project data. */
export interface PartPoseEditorUi {
  actionSectionOpen: boolean;
  onActionSectionOpenChange(open: boolean): void;
  activeLayerId: string | null;
  selectedPartId: string | null;
  calibratingPivot: boolean;
  pivotDraft: {
    layerId: string;
    partId: string;
    point: PartPosePoint;
  } | null;
  onStart(layerId: string, partId: string): void;
  onExit(): void;
  onSelectPart(partId: string): void;
  onStartPivot(layerId: string, partId: string): void;
  onCancelPivot(): void;
  onSetPivot(layerId: string, partId: string, point: PartPosePoint): void;
  onCommitPivotDrag(
    layerId: string,
    partId: string,
    point: PartPosePoint,
  ): void;
  onPivotUsed(): void;
}

export interface PartPoseGestureContextIdentity {
  projectInstanceId: number | null;
  projectId: string | null;
  projectRoot: string | null;
  revision: number | null;
  shotId: string | null;
  selectedLayerId: string | null;
  activeLayerId: string | null;
  selectedPartId: string | null;
  timeMs: number;
}

export function createPartPoseGestureContextKey(
  context: PartPoseGestureContextIdentity,
): string {
  return JSON.stringify(context);
}

export const EMPTY_PART_POSE_EDITOR_UI: PartPoseEditorUi = {
  actionSectionOpen: false,
  onActionSectionOpenChange: () => undefined,
  activeLayerId: null,
  selectedPartId: null,
  calibratingPivot: false,
  pivotDraft: null,
  onStart: () => undefined,
  onExit: () => undefined,
  onSelectPart: () => undefined,
  onStartPivot: () => undefined,
  onCancelPivot: () => undefined,
  onSetPivot: () => undefined,
  onCommitPivotDrag: () => undefined,
  onPivotUsed: () => undefined,
};
