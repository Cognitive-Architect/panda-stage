import type { PartPosePoint } from '../../../domain';

/** Ephemeral canvas/inspector mode owned by EditorShell, never project data. */
export interface PartPoseEditorUi {
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
  onPivotUsed: () => undefined,
};
