import {
  createRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type Konva from 'konva';
import {
  Layer as KonvaLayer,
  Rect,
  Stage,
} from 'react-konva';
import {
  hasAuthoredPartPose,
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  calculateViewportTransform,
  evaluateShotAtTime,
  listShotRuntimeImageAssets,
  resolveImageAsset,
  type Shot,
  type ViewportTransform,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import {
  canvasViewportStore,
} from '../../stores/canvasViewportStore';
import { layerStore } from '../../stores/layerStore';
import { useOpacityPreview } from '../../stores/opacityPreviewStore';
import {
  usePositionAuthoringSession,
  positionAuthoringSessionStore,
} from '../../stores/positionAuthoringSessionStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasViewport } from './CanvasViewport';
import canvasEmptyStateArt from './assets/canvas-empty-state.png';
import {
  isTransformerOverlayVisible,
  LayerTransformer,
} from './LayerTransformer';
import { SelectableLayer } from './SelectableLayer';
import { layerPointToSource, sourcePointToLayer } from './partPoseCanvasGeometry';
import { SubtitleRenderer } from '../subtitles/SubtitleRenderer';
import {
  timelineUiStore,
  useTimelineUi,
} from '../timeline/timelineUiStore';
import { buildDialogueSubtitleCues } from '../../../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../../shared/preview/subtitle-engine';
import type { CanvasDropPreview } from './useCanvasDrop';
import {
  createPartPoseGestureContextKey,
  EMPTY_PART_POSE_EDITOR_UI,
  resolvePartPoseEditorParts,
  type PartPoseEditorUi,
} from '../part-pose/partPoseEditorTypes';
import {
  configureKonvaScenePixelRatio,
  resolveEditorCanvasPixelRatio,
} from '../../stage/konva-pixel-ratio';
import {
  CanvasImageResourceSession,
  canvasImageResourceKey,
  EMPTY_CANVAS_IMAGE_STATE,
  type CanvasImageAssetSource,
  type CanvasImageState,
} from './canvasImageResources';
import {
  buildEditorTemporalCanvasModel,
} from './editorTemporalCanvasModel';
import { isAnimationBaseTransformEditableAtTime } from '../properties/layerTransformTemporalGuard';
import {
  failedRequiredCanvasLayers,
  scheduleCanvasPendingFeedback,
} from './canvasReadinessFeedback';
import {
  commitEditorTemporalContinuityBucket,
  createEditorTemporalContinuityState,
  editorTemporalContinuityMode,
  readEditorTemporalContinuityBucket,
  type EditorTemporalContinuityMode,
} from './editorTemporalCanvasContinuity';

// Keep the editor backing store sharp on Windows 125%/150% scaling without
// allowing an unbounded DPR to multiply canvas memory.
const editorDevicePixelRatio =
  typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
const editorCanvasPixelRatio = resolveEditorCanvasPixelRatio(
  editorDevicePixelRatio,
);

interface PivotCalibrationPreview {
  contextKey: string;
  layerId: string;
  partId: string;
  point: { x: number; y: number };
  valid: boolean;
}

function partPoseCanvasError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (message.includes('locked')) return '角色图层已锁定，动作没有更改。';
  if (message.includes('stale') || message.includes('changed')) {
    return '工程、镜头或时间已变化，动作没有更改。';
  }
  if (message.includes('degenerate') || message.includes('transform')) {
    return '部件变换无效，动作没有更改。';
  }
  if (message.includes('pivot')) {
    return '该零件已有动作姿势；清除本镜头动作后才能重新设置旋转点。';
  }
  return '部件姿势没有保存，请调整后重试。';
}

function CanvasEmptyState(): React.JSX.Element {
  return (
    <div
      className="canvas-empty-state-overlay"
      data-testid="canvas-empty-guidance"
    >
      <img
        alt=""
        aria-hidden="true"
        className="canvas-empty-state-art"
        data-testid="canvas-empty-state-art"
        draggable={false}
        src={canvasEmptyStateArt}
      />
      <span className="canvas-empty-state-copy">
        先往画布里放点东西吧。
      </span>
    </div>
  );
}

function useCanvasImages(
  snapshot: EditorProjectSnapshot | null,
  shot: Shot | null,
  retainedAssets: readonly CanvasImageAssetSource[],
): CanvasImageState {
  const assets = useMemo(
    () =>
      snapshot && shot
        ? listShotRuntimeImageAssets(snapshot.project, shot)
        : [],
    [shot, snapshot],
  );
  const sourceKey = assets
    .map((asset) => `${asset.id}:${asset.sha256 ?? 'missing'}`)
    .sort()
    .join('|');
  const retainedSourceKey = retainedAssets
    .map((asset) => `${asset.id}:${asset.sha256 ?? 'missing'}`)
    .sort()
    .join('|');
  const projectId = snapshot?.project.id ?? null;
  const projectInstanceId = editorProjectStore.getProjectInstanceId();
  const projectRoot = snapshot?.projectRoot ?? null;
  const shotId = shot?.id ?? null;
  const projectContextKey =
    projectId && projectRoot && projectInstanceId !== null
      ? `${projectId}:${projectRoot}:${projectInstanceId}`
      : null;
  const [state, setState] = useState<CanvasImageState>(
    EMPTY_CANVAS_IMAGE_STATE,
  );
  const sessionRef = useRef<CanvasImageResourceSession | null>(null);

  useEffect(() => {
    const session = new CanvasImageResourceSession();
    sessionRef.current = session;
    return () => {
      session.dispose();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    sessionRef.current?.reconcile(
      {
        contextKey: projectContextKey,
        projectRoot,
        assets: shotId ? assets : [],
        retainedAssets: shotId ? retainedAssets : [],
      },
      setState,
    );
  }, [
    assets,
    projectContextKey,
    projectRoot,
    retainedAssets,
    retainedSourceKey,
    shotId,
    sourceKey,
  ]);

  return state;
}

function isCurrentCanvasAssetReady(
  project: EditorProjectSnapshot['project'],
  assetId: string,
  imageState: CanvasImageState,
): boolean {
  if (!imageState.images.has(assetId)) return false;
  const asset = resolveImageAsset(project, assetId);
  if (!asset) return false;
  return (
    !asset.sha256 || imageState.sourceKeys.get(assetId) === asset.sha256
  );
}

export interface CanvasStageProps {
  showHeading?: boolean;
  showToolbar?: boolean;
  partPoseEditor?: PartPoseEditorUi;
}

export function CanvasStage({
  showHeading = true,
  showToolbar = true,
  partPoseEditor = EMPTY_PART_POSE_EDITOR_UI,
}: CanvasStageProps = {}): React.JSX.Element {
  const configureEditorLayer = useCallback((layer: Konva.Layer | null) => {
    if (layer) {
      configureKonvaScenePixelRatio(layer, editorCanvasPixelRatio);
    }
  }, []);
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const projectInstanceId = editorProjectStore.getProjectInstanceId();
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const viewport = useSyncExternalStore(
    canvasViewportStore.subscribe,
    canvasViewportStore.getSnapshot,
  );
  const timelineUi = useTimelineUi();
  const positionAuthoringSnapshot = usePositionAuthoringSession();
  const positionAuthoringSession =
    positionAuthoringSessionStore.getActiveSessionHandle();
  const [toolbarTransform, setToolbarTransform] =
    useState<ViewportTransform>(() =>
      calculateViewportTransform({ width: 0, height: 0 }, 'fit'),
    );
  const [dropPreview, setDropPreview] =
    useState<CanvasDropPreview | null>(null);
  const [pivotCalibrationPreview, setPivotCalibrationPreview] =
    useState<PivotCalibrationPreview | null>(null);
  const [interactionStatus, setInteractionStatus] = useState(
    '从素材库拖入图片或动画，或点击普通图层进行选择。',
  );
  useEffect(() => {
    if (!partPoseEditor.calibratingPivot) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      partPoseEditor.onCancelPivot();
      setInteractionStatus('旋转点设置已取消。');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [partPoseEditor.calibratingPivot, partPoseEditor.onCancelPivot]);
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const opacityPreview = useOpacityPreview();
  const layerNodeRefs = useRef(
    new Map<string, React.RefObject<Konva.Group | null>>(),
  );
  const getLayerNodeRef = (
    layerId: string,
  ): React.RefObject<Konva.Group | null> => {
    const existing = layerNodeRefs.current.get(layerId);
    if (existing) return existing;
    const created = createRef<Konva.Group>();
    layerNodeRefs.current.set(layerId, created);
    return created;
  };
  const shot =
    snapshot?.project.shots.find(
      (candidate) => candidate.id === currentShotId,
    ) ?? null;
  const activeOpacityPreview =
    opacityPreview &&
    snapshot &&
    shot &&
    opacityPreview.projectInstanceId ===
      editorProjectStore.getProjectInstanceId() &&
    opacityPreview.projectId === snapshot.project.id &&
    opacityPreview.projectRoot === snapshot.projectRoot &&
    opacityPreview.revision === snapshot.revision &&
    opacityPreview.shotId === shot.id &&
    opacityPreview.layerId === selectedLayerId &&
    timelineUi.currentTimeMs === 0
      ? opacityPreview
      : null;
  const subtitleCues = useMemo(
    () => (shot ? buildDialogueSubtitleCues(shot.dialogues) : []),
    [shot],
  );
  const activeCue = useMemo(
    () => evaluateSubtitleAtTime(subtitleCues, timelineUi.currentTimeMs),
    [subtitleCues, timelineUi.currentTimeMs],
  );
  const temporalContextKey =
    snapshot && shot && editorProjectStore.getProjectInstanceId() !== null
      ? `${snapshot.project.id}:${snapshot.projectRoot}:${editorProjectStore.getProjectInstanceId()}:${shot.id}`
      : null;
  const continuityMode: EditorTemporalContinuityMode =
    editorTemporalContinuityMode(timelineUi.currentTimeMs);
  const temporalContinuityRef = useRef(
    createEditorTemporalContinuityState(),
  );
  const previousTemporalVisuals = readEditorTemporalContinuityBucket(
    temporalContinuityRef.current,
    temporalContextKey,
    continuityMode,
  );
  const retainedAssets = useMemo<CanvasImageAssetSource[]>(() => {
    const assets = new Map<string, CanvasImageAssetSource>();
    for (const visual of previousTemporalVisuals.values()) {
      for (const [assetId, sha256] of visual.assetSourceKeys ?? []) {
        assets.set(`${assetId}:${sha256}`, { id: assetId, sha256 });
      }
    }
    return [...assets.values()];
  }, [previousTemporalVisuals]);
  const imageState = useCanvasImages(snapshot, shot, retainedAssets);
  const temporalCanvasModel = useMemo(
    () =>
      snapshot && shot
        ? buildEditorTemporalCanvasModel({
            activeDialogueId: activeCue?.id ?? null,
            currentTimeMs: timelineUi.currentTimeMs,
            previousVisuals: previousTemporalVisuals,
            project: snapshot.project,
            readyAssetIds: new Set(imageState.images.keys()),
            readyAssetSourceKeys: imageState.sourceKeys,
            readyResourceKeys: imageState.readyResourceKeys,
            missingAssetIds: imageState.missing,
            shot,
            positionDraft: positionAuthoringSnapshot
              ? {
                  layerId: positionAuthoringSnapshot.layerId,
                  position: positionAuthoringSnapshot.draft,
                }
              : undefined,
          })
        : null,
    [
      activeCue?.id,
      imageState.images,
      imageState.readyResourceKeys,
      previousTemporalVisuals,
      positionAuthoringSnapshot,
      shot,
      snapshot,
      temporalContextKey,
      timelineUi.currentTimeMs,
    ],
  );
  useEffect(() => {
    if (!temporalCanvasModel) {
      temporalContinuityRef.current = createEditorTemporalContinuityState(
        temporalContextKey,
      );
      return;
    }
    temporalContinuityRef.current = commitEditorTemporalContinuityBucket(
      temporalContinuityRef.current,
      temporalContextKey,
      continuityMode,
      temporalCanvasModel.lastValidVisuals,
    );
  }, [continuityMode, temporalCanvasModel, temporalContextKey]);
  const stageModel = temporalCanvasModel?.stageModel ?? null;
  const currentReadyImages = useMemo(() => {
    if (!snapshot) return new Map<string, HTMLImageElement>();
    return new Map(
      [...imageState.images.entries()].filter(([assetId]) =>
        isCurrentCanvasAssetReady(snapshot.project, assetId, imageState),
      ),
    );
  }, [imageState, snapshot]);
  const isStageLayerVisualReady = useCallback(
    (stageLayer: NonNullable<typeof stageModel>['layers'][number]): boolean => {
      if (!stageLayer.visual.parts.length) return false;
      const sourceKeys = temporalCanvasModel?.visualSourceKeysByLayer.get(
        stageLayer.layer.id,
      );
      if (sourceKeys && sourceKeys.size > 0) {
        return stageLayer.visual.parts.every((part) => {
          const sourceKey = sourceKeys.get(part.assetId);
          return sourceKey
            ? imageState.readyResourceKeys.has(
                canvasImageResourceKey(part.assetId, sourceKey),
              )
            : Boolean(
                snapshot &&
                  isCurrentCanvasAssetReady(
                    snapshot.project,
                    part.assetId,
                    imageState,
                  ),
              );
        });
      }
      return Boolean(
        snapshot &&
          stageLayer.visual.parts.every((part) =>
            isCurrentCanvasAssetReady(snapshot.project, part.assetId, imageState),
          ),
      );
    },
    [imageState, snapshot, temporalCanvasModel],
  );
  const directEditingEnabled =
    temporalCanvasModel?.directEditingEnabled ??
    timelineUi.currentTimeMs === 0;
  const temporalInspection =
    temporalCanvasModel?.temporalInspection ?? !directEditingEnabled;
  const rejectTemporalCanvasEdit = (animationLayer = false): string => {
    const message =
      animationLayer
        ? '动画基础变换仅能在当前可见且素材就绪的帧编辑。'
        : '时间轴预览中 · 回到 0:00 可调整图层';
    setInteractionStatus(message);
    return message;
  };
  const canCommitCanvasEdit = (
    stageLayer: NonNullable<typeof stageModel>['layers'][number],
  ): boolean => {
    const currentTimeMs = timelineUiStore.getSnapshot().currentTimeMs;
    if (stageLayer.layer.source.kind !== 'animation') {
      return currentTimeMs === 0;
    }
    const current = editorProjectStore.getSnapshot();
    const currentShot = current?.project.shots.find(
      (candidate) => candidate.id === shot?.id,
    );
    const currentLayer = currentShot?.layers.find(
      (candidate) => candidate.id === stageLayer.layer.id,
    );
    const evaluated = currentShot && current
      ? evaluateShotAtTime(currentShot, currentTimeMs, current.project).layers.find(
          (candidate) => candidate.id === stageLayer.layer.id,
        )
      : undefined;
    const currentFrameAssetId = stageLayer.visual.parts[0]?.assetId;
    return Boolean(
      snapshot &&
        shot &&
        current &&
        currentLayer?.source.kind === 'animation' &&
        !currentLayer.locked &&
        editorProjectStore.getProjectInstanceId() === projectInstanceId &&
        current.project.id === snapshot.project.id &&
        current.projectRoot === snapshot.projectRoot &&
        current.revision === snapshot.revision &&
        shotStore.getCurrentShotId() === shot.id &&
        selectionStore.getSelectedLayerId() === stageLayer.layer.id &&
        isAnimationBaseTransformEditableAtTime(
          current.project,
          shot.id,
          stageLayer.layer.id,
          currentTimeMs,
        ) &&
        evaluated?.visible &&
        evaluated.assetId === currentFrameAssetId &&
        stageLayer.render.visible &&
        isStageLayerVisualReady(stageLayer),
    );
  };
  const directEditingEnabledForStageLayer = (
    stageLayer: NonNullable<typeof stageModel>['layers'][number],
  ): boolean => {
    if (stageLayer.layer.source.kind !== 'animation') {
      return directEditingEnabled;
    }
    const evaluated = shot && snapshot
      ? evaluateShotAtTime(
          shot,
          timelineUi.currentTimeMs,
          snapshot.project,
        ).layers.find((candidate) => candidate.id === stageLayer.layer.id)
      : undefined;
    return Boolean(
      evaluated?.visible &&
        evaluated.assetId === stageLayer.visual.parts[0]?.assetId &&
        isAnimationBaseTransformEditableAtTime(
          snapshot!.project,
          shot!.id,
          stageLayer.layer.id,
          timelineUi.currentTimeMs,
        ) &&
        isStageLayerVisualReady(stageLayer),
    );
  };
  const activeSubtitleStyle = activeCue
    ? snapshot?.project.subtitleStyles.find(
        (style) => style.id === activeCue.styleId,
      )
    : undefined;
  const imageForAsset = (asset: {
    id: string;
  }): HTMLImageElement | undefined =>
    currentReadyImages.get(asset.id);
  const imageForStageLayer = (
    stageLayer: NonNullable<typeof stageModel>['layers'][number],
  ): HTMLImageElement | undefined => {
    const sourceKeys = temporalCanvasModel?.visualSourceKeysByLayer.get(
      stageLayer.layer.id,
    );
    const firstPart = stageLayer.visual.parts[0];
    const sourceKey = firstPart
      ? sourceKeys?.get(firstPart.assetId)
      : undefined;
    if (!firstPart || !sourceKey) return imageForAsset(stageLayer.asset);
    return imageState.imagesByResourceKey.get(
      canvasImageResourceKey(firstPart.assetId, sourceKey),
    );
  };
  const backgroundLayer =
    stageModel?.layers.find((layer) => layer.render.isBackground) ?? null;
  const backgroundAsset = backgroundLayer?.asset ?? null;
  const backgroundImage = backgroundLayer && isStageLayerVisualReady(backgroundLayer) && backgroundAsset
    ? imageForStageLayer(backgroundLayer)
    : undefined;
  const empty = Boolean(stageModel && stageModel.layers.length === 0);
  const incompleteVisualLayers = stageModel?.layers.filter(
    (stageLayer) => !isStageLayerVisualReady(stageLayer),
  ) ?? [];
  const missingBackground =
    Boolean(shot) &&
    !empty &&
    (!backgroundLayer || !backgroundAsset || !backgroundImage);
  const missingNonBackgroundVisual = incompleteVisualLayers.some(
    (stageLayer) => !stageLayer.render.isBackground,
  );
  const nonBackgroundStatuses = stageModel?.layers
    .filter(({ render }) => !render.isBackground)
    .map(({ layer }) =>
      temporalCanvasModel?.visualStatusByLayer.get(layer.id),
    )
    .filter((status): status is NonNullable<typeof status> => Boolean(status));
  const compositeCharacterStatuses = stageModel?.layers
    .filter(
      ({ render, visual }) =>
        !render.isBackground && visual.kind === 'composite-character',
    )
    .map(({ layer }) =>
      temporalCanvasModel?.visualStatusByLayer.get(layer.id),
    )
    .filter((status): status is NonNullable<typeof status> => Boolean(status));
  const failedRequiredVisualLayers = failedRequiredCanvasLayers(
    stageModel?.layers ?? [],
    imageState.missing,
  );
  const hasRequiredCharacterFailure =
    failedRequiredVisualLayers.some(
      ({ visual }) => visual.kind === 'composite-character',
    ) || (compositeCharacterStatuses?.includes('required-failed') ?? false);
  const hasRequiredVisualFailure =
    failedRequiredVisualLayers.length > 0 || hasRequiredCharacterFailure;
  const hasMouthVisualDegradation = compositeCharacterStatuses?.some(
    (status) =>
      status === 'mouth-expression-fallback' ||
      status === 'mouth-fallback-pending',
  ) ?? false;
  const hasMouthExpressionFallback = compositeCharacterStatuses?.some(
    (status) => status === 'mouth-expression-fallback',
  ) ?? false;
  const hasPendingVisual = nonBackgroundStatuses?.some(
    (status) => status === 'pending' || status === 'previous-complete',
  ) ?? false;
  const hasNonBackgroundVisualIssue =
    missingNonBackgroundVisual ||
    hasRequiredVisualFailure ||
    hasMouthVisualDegradation ||
    hasPendingVisual;
  const routineVisualPending =
    !missingBackground &&
    hasNonBackgroundVisualIssue &&
    !hasRequiredVisualFailure &&
    !hasMouthVisualDegradation;
  const pendingFeedbackKey = `${temporalContextKey}:${snapshot?.revision}:${timelineUi.currentTimeMs}`;
  const [visiblePendingKey, setVisiblePendingKey] = useState<string | null>(null);
  useLayoutEffect(() => {
    setVisiblePendingKey(null);
    if (!routineVisualPending) return undefined;
    return scheduleCanvasPendingFeedback(() => {
      setVisiblePendingKey(pendingFeedbackKey);
    });
  }, [pendingFeedbackKey, routineVisualPending]);
  const showRoutineVisualPending =
    routineVisualPending && visiblePendingKey === pendingFeedbackKey;
  const selectedStageLayer =
    stageModel?.layers.find(
      ({ layer }) => layer.id === selectedLayerId,
    ) ?? null;
  const poseEditorStageLayer = partPoseEditor.activeLayerId
    ? stageModel?.layers.find(
        ({ layer }) => layer.id === partPoseEditor.activeLayerId,
      ) ?? null
    : null;
  const poseEditorLayerSource = poseEditorStageLayer?.layer.source;
  const poseEditorCharacter =
    poseEditorLayerSource?.kind === 'character'
      ? snapshot?.project.characters.find(
          (candidate) =>
            candidate.id === poseEditorLayerSource.characterId,
        )
      : undefined;
  const poseEditorCharacterPart =
    poseEditorCharacter?.mode === 'adaptive-parts' && poseEditorStageLayer
      ? resolvePartPoseEditorParts(
          poseEditorCharacter,
          poseEditorStageLayer.layer,
        ).find(
          (part) => part.partId === partPoseEditor.selectedPartId,
        ) ?? null
      : null;
  const poseEditorVisualPart =
    poseEditorStageLayer?.visual.parts.find(
      (part) =>
        part.source.kind === 'adaptive-part' &&
        part.source.characterPartId === partPoseEditor.selectedPartId,
    ) ?? null;
  const poseEditorTrack =
    poseEditorStageLayer?.layer.poseAnimation?.tracks.find(
      (track) => track.partId === partPoseEditor.selectedPartId,
    ) ?? null;
  const poseEditorPivotLocked = Boolean(
    poseEditorTrack && hasAuthoredPartPose(poseEditorTrack),
  );
  const poseEditorPivotSource =
    poseEditorTrack?.pivotSource ??
    (partPoseEditor.pivotDraft?.layerId === partPoseEditor.activeLayerId &&
    partPoseEditor.pivotDraft.partId === partPoseEditor.selectedPartId
      ? partPoseEditor.pivotDraft.point
      : poseEditorCharacterPart
        ? {
            x:
              poseEditorCharacterPart.imageMapping.crop.x +
              poseEditorCharacterPart.imageMapping.crop.width / 2,
            y:
              poseEditorCharacterPart.imageMapping.crop.y +
              poseEditorCharacterPart.imageMapping.crop.height / 2,
          }
        : null);
  const poseEditorPivotLayerPoint =
    poseEditorPivotSource && poseEditorCharacterPart
      ? sourcePointToLayer(
          poseEditorVisualPart,
          poseEditorCharacterPart,
          poseEditorPivotSource,
        )
      : null;
  const poseEditorKeyframe =
    poseEditorTrack?.keys.find(
      (keyframe) => keyframe.timeMs === timelineUi.currentTimeMs,
    ) ?? null;
  const poseEditorCanTransform = Boolean(
    partPoseEditor.activeLayerId &&
      !partPoseEditor.calibratingPivot &&
      poseEditorStageLayer &&
      poseEditorStageLayer.layer.id === selectedLayerId &&
      !poseEditorStageLayer.layer.locked &&
      poseEditorCharacterPart?.visible !== false &&
      poseEditorKeyframe &&
      temporalCanvasModel &&
      isStageLayerVisualReady(poseEditorStageLayer),
  );
  const poseEditorCanSetPivot = Boolean(
    partPoseEditor.activeLayerId &&
      partPoseEditor.activeLayerId === selectedLayerId &&
      !positionAuthoringSession &&
      poseEditorStageLayer?.layer.id === partPoseEditor.activeLayerId &&
      !poseEditorStageLayer.layer.locked &&
      poseEditorCharacterPart &&
      poseEditorCharacterPart.visible !== false &&
      poseEditorVisualPart &&
      !poseEditorPivotLocked &&
      !partPoseEditor.calibratingPivot &&
      temporalCanvasModel &&
      isStageLayerVisualReady(poseEditorStageLayer),
  );
  const poseGestureContextKey = createPartPoseGestureContextKey({
    projectInstanceId,
    projectId: snapshot?.project.id ?? null,
    projectRoot: snapshot?.projectRoot ?? null,
    revision: snapshot?.revision ?? null,
    shotId: currentShotId,
    selectedLayerId,
    activeLayerId: partPoseEditor.activeLayerId,
    selectedPartId: partPoseEditor.selectedPartId,
    timeMs: timelineUi.currentTimeMs,
  });
  useEffect(() => {
    setPivotCalibrationPreview((current) => {
      if (
        !partPoseEditor.calibratingPivot ||
        current?.contextKey !== poseGestureContextKey ||
        current.layerId !== partPoseEditor.activeLayerId ||
        current.partId !== partPoseEditor.selectedPartId
      ) {
        return null;
      }
      return current;
    });
  }, [
    partPoseEditor.activeLayerId,
    partPoseEditor.calibratingPivot,
    partPoseEditor.selectedPartId,
    poseGestureContextKey,
  ]);
  const activePivotCalibrationPreview =
    pivotCalibrationPreview?.contextKey === poseGestureContextKey &&
    pivotCalibrationPreview.layerId === partPoseEditor.activeLayerId &&
    pivotCalibrationPreview.partId === partPoseEditor.selectedPartId
      ? {
          point: pivotCalibrationPreview.point,
          valid: pivotCalibrationPreview.valid,
        }
      : null;
  const transformerVisible = isTransformerOverlayVisible({
    selected: Boolean(
      selectedStageLayer &&
        selectedStageLayer.render.visible &&
        directEditingEnabledForStageLayer(selectedStageLayer) &&
        partPoseEditor.activeLayerId !== selectedStageLayer.layer.id,
    ),
    isBackground: selectedStageLayer?.render.isBackground ?? false,
    locked: selectedStageLayer?.layer.locked ?? false,
    imageReady: selectedStageLayer
      ? isStageLayerVisualReady(selectedStageLayer)
      : false,
  });
  const calibratePivotFromCanvas = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    event.cancelBubble = true;
    const layerId = partPoseEditor.activeLayerId;
    const partId = partPoseEditor.selectedPartId;
    const layerNode = layerId ? getLayerNodeRef(layerId).current : null;
    const localPoint = layerNode?.getRelativePointerPosition();
    if (
      !partPoseEditor.calibratingPivot ||
      !layerId ||
      !partId ||
      !localPoint ||
      !poseEditorCharacterPart
    ) {
      setInteractionStatus('无法读取旋转点，请重新选择部件后再试。');
      return;
    }
    const sourcePoint = layerPointToSource(
      localPoint,
      poseEditorVisualPart,
      poseEditorCharacterPart,
    );
    if (!sourcePoint) {
      setInteractionStatus('请在原图范围内点击旋转位置。');
      return;
    }
    try {
      partPoseEditor.onSetPivot(layerId, partId, sourcePoint);
      setInteractionStatus('旋转点已设置。');
    } catch (error) {
      partPoseEditor.onCancelPivot();
      setInteractionStatus(partPoseCanvasError(error));
    }
  };
  const previewPivotFromCanvas = (
    event: Konva.KonvaEventObject<MouseEvent | TouchEvent>,
  ): void => {
    event.cancelBubble = true;
    const layerId = partPoseEditor.activeLayerId;
    const partId = partPoseEditor.selectedPartId;
    const layerNode = layerId ? getLayerNodeRef(layerId).current : null;
    const localPoint = layerNode?.getRelativePointerPosition();
    if (
      !partPoseEditor.calibratingPivot ||
      !layerId ||
      !partId ||
      !localPoint ||
      !poseEditorCharacterPart
    ) {
      setPivotCalibrationPreview(null);
      return;
    }
    const sourcePoint = layerPointToSource(
      localPoint,
      poseEditorVisualPart,
      poseEditorCharacterPart,
    );
    setPivotCalibrationPreview({
      contextKey: poseGestureContextKey,
      layerId,
      partId,
      point: localPoint,
      valid: sourcePoint !== null,
    });
  };
  const commitPivotDragFromCanvas = (
    layerId: string,
    partId: string,
    layerPoint: { x: number; y: number },
    gestureContextKey: string,
  ): void => {
    const currentSnapshot = editorProjectStore.getSnapshot();
    const currentContextKey = createPartPoseGestureContextKey({
      projectInstanceId: editorProjectStore.getProjectInstanceId(),
      projectId: currentSnapshot?.project.id ?? null,
      projectRoot: currentSnapshot?.projectRoot ?? null,
      revision: currentSnapshot?.revision ?? null,
      shotId: shotStore.getCurrentShotId(),
      selectedLayerId: selectionStore.getSelectedLayerId(),
      activeLayerId: partPoseEditor.activeLayerId,
      selectedPartId: partPoseEditor.selectedPartId,
      timeMs: timelineUiStore.getSnapshot().currentTimeMs,
    });
    if (
      gestureContextKey !== currentContextKey ||
      !poseEditorCanSetPivot ||
      partPoseEditor.calibratingPivot ||
      layerId !== partPoseEditor.activeLayerId ||
      partId !== partPoseEditor.selectedPartId ||
      !poseEditorCharacterPart
    ) {
      return;
    }
    const sourcePoint = layerPointToSource(
      layerPoint,
      poseEditorVisualPart,
      poseEditorCharacterPart,
    );
    if (!sourcePoint) {
      setInteractionStatus('请在原图范围内拖动旋转点。');
      return;
    }
    try {
      partPoseEditor.onCommitPivotDrag(layerId, partId, sourcePoint);
    } catch (error) {
      setInteractionStatus(partPoseCanvasError(error));
    }
  };
  const backgroundSelected =
    Boolean(backgroundLayer && selectedLayerId === backgroundLayer.render.id);
  const backgroundListening =
    backgroundSelected && backgroundLayer?.layer.locked === false;

  return (
    <section
      aria-label={showHeading ? undefined : '画布'}
      aria-labelledby={showHeading ? 'canvas-heading' : undefined}
      className="project-canvas"
      data-with-heading={showHeading ? 'true' : 'false'}
    >
      {showHeading ? (
        <div className="project-canvas-heading">
          <div>
            <p className="eyebrow">画布</p>
            <h2 id="canvas-heading">镜头画布</h2>
          </div>
          <span>{shot ? shot.name : '未选择镜头'}</span>
        </div>
      ) : null}
      <CanvasViewport
        dropDisabled={!snapshot || !shot}
        dropInteractionDisabled={temporalInspection}
        animationDropTarget={
          snapshot && shot && projectInstanceId !== null
            ? {
                projectId: snapshot.project.id,
                projectInstanceId,
                projectRevision: snapshot.revision,
                shotId: shot.id,
              }
            : null
        }
        mode={viewport.mode}
        onAssetDrop={(payload, point) => {
          if (
            payload.type !== 'animation' &&
            timelineUiStore.getSnapshot().currentTimeMs !== 0
          ) {
            rejectTemporalCanvasEdit();
            return;
          }
          try {
            const layer = layerStore.createFromAsset({
              ...payload,
              position: point,
              ...(payload.type === 'animation'
                ? { startTimeMs: timelineUiStore.getSnapshot().currentTimeMs }
                : {}),
            });
            selectionStore.select(layer.id);
            setInteractionStatus(
              `已在 (${layer.x.toFixed(1)}, ${layer.y.toFixed(1)}) 创建并选择“${layer.name}”。`,
            );
          } catch (error) {
            setInteractionStatus(
              error instanceof Error
                ? error.message
                : '图层创建失败。',
            );
          }
        }}
        onDropError={setInteractionStatus}
        onDropPreview={setDropPreview}
        onStagePoint={(point) =>
          canvasViewportStore.recordStagePoint(point)
        }
        onTransform={setToolbarTransform}
        onViewportChromePointerDown={() => selectionStore.clear()}
        viewportOverlay={empty ? <CanvasEmptyState /> : null}
        viewportChrome={showToolbar ? (
          <CanvasToolbar
            mode={viewport.mode}
            point={viewport.lastStagePoint}
            transform={toolbarTransform}
          />
        ) : null}
      >
        {(transform) => (
          <>
            <div
              data-background-listening={String(backgroundListening)}
              data-background-editing={String(backgroundSelected)}
              data-background-locked={String(
                backgroundLayer?.layer.locked ?? false,
              )}
              data-background-layer-id={
                backgroundLayer?.render.id ?? ''
              }
              data-background-opacity={
                backgroundLayer &&
                activeOpacityPreview?.layerId === backgroundLayer.layer.id
                  ? activeOpacityPreview.opacity
                  : backgroundLayer?.render.opacity ?? ''
              }
              data-background-policy="cover-centered-no-stretch"
              data-background-ready={String(Boolean(backgroundImage))}
              data-background-scale-x={
                backgroundLayer?.render.coverScale ?? ''
              }
              data-background-scale-y={
                backgroundLayer?.render.coverScale ?? ''
              }
              data-interaction-status={interactionStatus}
              data-current-time-ms={timelineUi.currentTimeMs}
              data-active-subtitle-id={activeCue?.id ?? ''}
              data-temporal-inspection={String(temporalInspection)}
              data-direct-canvas-editing={String(directEditingEnabled)}
              data-layer-json={JSON.stringify(shot?.layers ?? [])}
              data-evaluated-layer-json={JSON.stringify(
                temporalCanvasModel?.evaluatedShot.layers ?? [],
              )}
              data-project-revision={snapshot?.revision ?? -1}
              data-render-source="project-assets-original"
              data-rendered-asset-intrinsic-sizes={JSON.stringify(
                [...currentReadyImages.entries()].map(([assetId, image]) => ({
                  assetId,
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                })),
              )}
              data-rendered-asset-ids={JSON.stringify([
                ...currentReadyImages.keys(),
              ])}
              data-composite-layer-ids={JSON.stringify(
                stageModel?.layers
                  .filter(({ visual }) => visual.kind === 'composite-character')
                  .map(({ layer }) => layer.id) ?? [],
              )}
              data-incomplete-visual-layer-ids={JSON.stringify(
                incompleteVisualLayers.map(({ layer }) => layer.id),
              )}
              data-visual-status-json={JSON.stringify(
                [...(temporalCanvasModel?.visualStatusByLayer.entries() ?? [])],
              )}
              data-target-ready-layer-ids={JSON.stringify([
                ...(temporalCanvasModel?.targetReadyLayerIds ?? []),
              ])}
              data-render-contract="shared-stage-layer-v1"
              data-selected-layer-id={selectedLayerId ?? ''}
              data-part-pose-edit-layer-id={partPoseEditor.activeLayerId ?? ''}
              data-part-pose-pivot-calibrating={String(
                partPoseEditor.calibratingPivot,
              )}
              data-stage-center="960,540"
              data-transformer-overlay="separate-konva-layer-after-content"
              data-transformer-visible={String(
                transformerVisible,
              )}
              data-testid="project-canvas-stage"
              onMouseDownCapture={(event) =>
                event.currentTarget.focus({ preventScroll: true })
              }
              tabIndex={-1}
            >
              <Stage
                height={PROJECT_HEIGHT}
                listening
                width={PROJECT_WIDTH}
              >
                <KonvaLayer listening ref={configureEditorLayer}>
                  <Rect
                    fill="#111914"
                    height={PROJECT_HEIGHT}
                    listening
                    onClick={() => selectionStore.clear()}
                    onTap={() => selectionStore.clear()}
                    width={PROJECT_WIDTH}
                  />
                  {stageModel
                    ? stageModel.layers.map((stageLayer) => {
                        const { layer, render, visual } = stageLayer;
                        const image = imageForStageLayer(stageLayer);
                        return (
                          <SelectableLayer
                            directEditingEnabled={directEditingEnabledForStageLayer(stageLayer)}
                            image={image}
                            images={currentReadyImages}
                            imagesByResourceKey={imageState.imagesByResourceKey}
                            key={render.id}
                            layer={layer}
                            nodeRef={getLayerNodeRef(layer.id)}
                             onCommitPosition={(layerId, position) => {
                              if (!canCommitCanvasEdit(stageLayer)) {
                                throw new Error(
                                  rejectTemporalCanvasEdit(
                                    layer.source.kind === 'animation',
                                  ),
                                );
                              }
                              layerStore.updatePosition(layerId, position);
                              setInteractionStatus(
                                `图层位置已提交为 (${position.x.toFixed(1)}, ${position.y.toFixed(1)})。`,
                               );
                             }}
                             onPositionAuthoringCommit={(result) => {
                               setInteractionStatus(
                                 result.status === 'committed'
                                   ? '位置已更新。'
                                   : result.status === 'no-op'
                                     ? '位置未变化。'
                                     : result.error.message,
                               );
                             }}
                             onCommitTransform={(layerId, transform) => {
                              if (!canCommitCanvasEdit(stageLayer)) {
                                throw new Error(
                                  rejectTemporalCanvasEdit(
                                    layer.source.kind === 'animation',
                                  ),
                                );
                              }
                              layerStore.updateTransform(layerId, transform);
                              setInteractionStatus(
                                `图层变换已提交：缩放 ${transform.scale.toFixed(3)}，旋转 ${transform.rotationDeg.toFixed(1)}°。`,
                              );
                            }}
                             onError={setInteractionStatus}
                            poseEditing={
                              partPoseEditor.activeLayerId === layer.id
                            }
                            poseSelectionEnabled={
                              partPoseEditor.actionSectionOpen
                            }
                            poseSelectedPartId={
                              partPoseEditor.activeLayerId === layer.id
                                ? partPoseEditor.selectedPartId
                                : null
                            }
                            poseCurrentKeyframe={
                              partPoseEditor.activeLayerId === layer.id
                                ? poseEditorKeyframe
                                : null
                            }
                            poseCanTransform={
                              partPoseEditor.activeLayerId === layer.id &&
                              poseEditorCanTransform
                            }
                            poseCanSetPivot={
                              partPoseEditor.activeLayerId === layer.id &&
                              poseEditorCanSetPivot
                            }
                            posePivotLayerPoint={
                              partPoseEditor.activeLayerId === layer.id
                                ? poseEditorPivotLayerPoint
                                : null
                            }
                            posePivotCalibrationPreview={
                              partPoseEditor.activeLayerId === layer.id
                                ? activePivotCalibrationPreview
                                : null
                            }
                            poseGestureContextKey={poseGestureContextKey}
                            onSelectPart={(partId) => {
                              selectionStore.select(layer.id);
                              partPoseEditor.onSelectPart(partId);
                            }}
                            onStartPartPose={(layerId, partId) => {
                              partPoseEditor.onStart(layerId, partId);
                            }}
                            onCommitPartPose={(partId, keyframe, gestureContextKey) => {
                              try {
                                const currentSnapshot =
                                  editorProjectStore.getSnapshot();
                                const currentContextKey =
                                  createPartPoseGestureContextKey({
                                    projectInstanceId:
                                      editorProjectStore.getProjectInstanceId(),
                                    projectId:
                                      currentSnapshot?.project.id ?? null,
                                    projectRoot:
                                      currentSnapshot?.projectRoot ?? null,
                                    revision:
                                      currentSnapshot?.revision ?? null,
                                    shotId: shotStore.getCurrentShotId(),
                                    selectedLayerId:
                                      selectionStore.getSelectedLayerId(),
                                    activeLayerId:
                                      partPoseEditor.activeLayerId,
                                    selectedPartId:
                                      partPoseEditor.selectedPartId,
                                    timeMs:
                                      timelineUiStore.getSnapshot().currentTimeMs,
                                  });
                                if (gestureContextKey !== currentContextKey) {
                                  setInteractionStatus(
                                    '工程、镜头、图层或时间已变化，拖动已取消。',
                                  );
                                  return;
                                }
                                layerStore.setPartPoseKeyframe(
                                  layer.id,
                                  partId,
                                  keyframe,
                                );
                                setInteractionStatus('部件姿势已更新。');
                              } catch (error) {
                                setInteractionStatus(partPoseCanvasError(error));
                              }
                            }}
                            onCommitPivotDrag={commitPivotDragFromCanvas}
                             onSelect={(layerId) => {
                              if (render.isBackground) {
                                selectionStore.selectExplicit(layerId);
                              } else {
                                selectionStore.select(layerId);
                              }
                              setInteractionStatus('已选择图层。');
                            }}
                             render={
                               activeOpacityPreview?.layerId === layer.id
                                 ? {
                                     ...render,
                                     opacity: activeOpacityPreview.opacity,
                                   }
                                 : render
                             }
                             positionAuthoringSession={
                               positionAuthoringSnapshot?.layerId === layer.id &&
                               selectedLayerId === layer.id
                                 ? positionAuthoringSession
                                 : null
                             }
                             positionAuthoringShakeOffset={
                               positionAuthoringSnapshot?.layerId === layer.id &&
                               selectedLayerId === layer.id
                                 ? temporalCanvasModel?.positionAuthoringShakeOffset
                                 : null
                             }
                            selected={selectedLayerId === layer.id}
                            visualSourceKeys={
                              temporalCanvasModel?.visualSourceKeysByLayer.get(
                                layer.id,
                              )
                            }
                            visual={visual}
                          />
                        );
                      })
                    : null}
                  <SubtitleRenderer
                    style={activeSubtitleStyle}
                    text={activeCue?.text ?? null}
                  />
                </KonvaLayer>
                <KonvaLayer
                  listening
                  name="transformer-overlay-layer"
                  ref={configureEditorLayer}
                >
                  {partPoseEditor.calibratingPivot ? (
                    <Rect
                      fill="#000000"
                      height={PROJECT_HEIGHT}
                      name="part-pose-pivot-calibration-overlay"
                      onClick={calibratePivotFromCanvas}
                      onMouseLeave={() => setPivotCalibrationPreview(null)}
                      onMouseMove={previewPivotFromCanvas}
                      onTap={calibratePivotFromCanvas}
                      onTouchMove={previewPivotFromCanvas}
                      opacity={0}
                      width={PROJECT_WIDTH}
                    />
                  ) : null}
                  {transformerVisible && selectedStageLayer ? (
                    <LayerTransformer
                      locked={selectedStageLayer.layer.locked}
                      nodeRef={getLayerNodeRef(
                        selectedStageLayer.layer.id,
                      )}
                      scale={selectedStageLayer.render.scaleX}
                      selected
                    />
                  ) : null}
                </KonvaLayer>
              </Stage>
            </div>
            {dropPreview ? (
              <div
                className="canvas-drop-ghost"
                data-testid="canvas-drop-ghost"
                style={{
                  left: dropPreview.point.x,
                  top: dropPreview.point.y,
                }}
              >
                <strong>放置图层</strong>
                <span>
                  x {dropPreview.point.x.toFixed(1)} · y{' '}
                  {dropPreview.point.y.toFixed(1)}
                </span>
              </div>
            ) : null}
            {missingBackground ? (
              <div
                className="canvas-stage-message canvas-stage-warning"
                data-testid="canvas-background-warning"
              >
                <strong>背景预览不可用</strong>
                <span>
                  请添加背景图层，或在项目素材库中重新生成缩略图。
                </span>
              </div>
            ) : null}
            {(hasRequiredVisualFailure || hasMouthVisualDegradation) ? (
              <div
                className="canvas-stage-message canvas-stage-warning"
                data-testid="canvas-visual-failure-warning"
                data-visual-warning-kind={
                  hasRequiredVisualFailure ? 'failed' : 'degraded'
                }
              >
                <strong>
                  {hasRequiredVisualFailure
                    ? hasRequiredCharacterFailure
                      ? '角色素材读取失败'
                      : '素材读取失败'
                    : hasMouthExpressionFallback
                      ? '张嘴表情不可用，已暂时显示当前表情'
                      : '张嘴表情不可用，正在准备当前表情'}
                </strong>
                <span>
                  {hasRequiredVisualFailure
                    ? hasRequiredCharacterFailure
                      ? '当前角色画面不可用，请检查素材后重试。'
                      : '当前画面素材不可用，请检查素材后重试。'
                    : hasMouthExpressionFallback
                      ? '素材恢复后会自动更新。'
                      : '当前表情准备完成后会自动更新。'}
                </span>
              </div>
            ) : null}
            {showRoutineVisualPending ? (
              <div
                className="canvas-stage-message canvas-stage-pending"
                data-testid="canvas-visual-warning"
                data-visual-warning-kind="pending"
                role="status"
              >
                <span>正在准备素材…</span>
              </div>
            ) : null}
            <span
              hidden
              data-transform-mode={transform.mode}
              data-testid="canvas-transform-contract"
            />
          </>
        )}
      </CanvasViewport>
      <output
        className="canvas-interaction-status"
        data-testid="canvas-interaction-status"
        hidden
      >
        {interactionStatus}
      </output>
    </section>
  );
}
