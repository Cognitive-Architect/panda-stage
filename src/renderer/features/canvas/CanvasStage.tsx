import { LayerEffectPreviewContext } from '../../stage/LayerEffectPreview';
import { CurveMotionStageOverlay, type CurveMotionStageDraft } from './CurveMotionStageOverlay';
import {
  createRef,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type Konva from 'konva';
import type { DialogueSilence } from '../../../shared/dialogue-silence';
import { CharacterMotionGesture } from './characterMotionGesture';
import { CharacterArmAssemblyOverlay, characterArmAssemblyPrompt } from './CharacterArmAssemblyOverlay';
import { updateArmAssemblyPart, useCharacterArmAssembly, useCharacterArmTool } from './CharacterArmTool';
import { CharacterArmHandle } from './CharacterArmHandle';
import type { AnimationCurveDraft } from '../timeline/AnimationCurveDraft';
import type { CharacterMotionCanvas } from './CharacterMotionPart';
import {
  adaptivePartIdForNodeId,
  isCharacterNodeMotionEditable,
  resolveCharacterView,
  type CharacterView,
} from '../characters/characterView';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  characterNodeMotionScaleBounds,
  composeAnimatedCharacterPartTransform,
  compareCameraDrawingLayers,
  resolveLayerCameraTransform,
  createCharacterPartAnimationClip,
  evaluateAnimationClipAtTime,
  evaluateCompositeFacePoseAtTime,
  evaluateManualCamera,
  prepareShotCamera,
  validLayerParentTargets,
  isValidFrameTime,
  type FlaShapeVertexTarget,
  type Layer,
} from '../../../domain';
import {
  Group,
  Layer as KonvaLayer,
  Rect,
  Stage,
} from 'react-konva';
import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  calculateViewportTransform,
  collectFlaGraphicTimelineDurationMs,
  getFlaGraphicInstanceTransformOverride,
  evaluateShotAtTime,
  listShotRuntimeImageAssets,
  listShotGraphicImageAssetsAtTime,
  resolveFlaGraphicInternalAuthoringState,
  resolveImageAsset,
  resolveRuntimeImageAsset,
  resolveCharacterArmAssemblyParts,
  resolveTimelineFrameTime,
  resolveCharacterActionRootPatch,
  type ImageAsset,
  type Shot,
  type ViewportTransform,
} from '../../../domain';
import type { AffineMatrix2D } from '../../../shared/affine-matrix';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import {
  canvasViewportStore,
} from '../../stores/canvasViewportStore';
import { layerStore } from '../../stores/layerStore';
import { useOpacityPreview } from '../../stores/opacityPreviewStore';
import { useDepthPreview } from '../../stores/depthPreviewStore';
import { useLayoutPreview } from '../../stores/layoutPreviewStore';
import { useScenePreview } from '../../stores/scenePreviewStore';
import {
  usePositionAuthoringSession,
  positionAuthoringSessionStore,
} from '../../stores/positionAuthoringSessionStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { CanvasToolbar } from './CanvasToolbar';
import { ShotCameraControls } from './ShotCameraControls';
import {
  resolveActiveShotCameraCurveDraft,
  type ShotCameraCurveDraft,
} from './ShotCameraCurveDraft';
import { ShotCameraFrame } from './ShotCameraFrame';
import { commitCameraFrame } from '../../stores/shotCameraEdits';
import { CanvasViewport } from './CanvasViewport';
import canvasEmptyStateArt from './assets/canvas-empty-state.png';
import {
  isTransformerOverlayVisible,
  LayerTransformer,
  structuredChildTransformerScales,
} from './LayerTransformer';
import { ParentLayerTransformer } from './ParentLayerTransformer';
import { SelectableLayer } from './SelectableLayer';
import { StageLayerSpace } from '../../stage/StageLayerSpace';
import { SubtitleRenderer } from '../subtitles/SubtitleRenderer';
import {
  timelineUiStore,
  useTimelineUi,
} from '../timeline/timelineUiStore';
import { buildDialogueSubtitleCues } from '../../../shared/preview/dialogue-subtitle';
import { evaluateSubtitleAtTime } from '../../../shared/preview/subtitle-engine';
import type { CanvasDropPreview } from './useCanvasDrop';
import {
  configureKonvaScenePixelRatio,
  resolveEditorCanvasPixelRatio,
} from '../../stage/konva-pixel-ratio';
import {
  CanvasImageResourceSession,
  canvasImageResourceKey,
  EMPTY_CANVAS_IMAGE_STATE,
  getCachedFlaSvgAssetText,
  type CanvasImageAssetSource,
  type CanvasImageState,
} from './canvasImageResources';
import {
  buildEditorTemporalCanvasModel,
  evaluateEditorCanvasShot,
} from './editorTemporalCanvasModel';
import { visualAssetIds } from './temporalVisualContinuity';
import {
  isAnimationBaseTransformEditableAtTime,
  isLayerMotionTransformEditableAtTime,
  isSupportedLayerMotionLayer,
} from '../properties/layerTransformTemporalGuard';
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
import {
  collectFlaGraphicStructureAssetIds,
  clearFlaGraphicEditDraft,
  clearFlaGraphicEditTargetDrafts,
  flaGraphicNodeCanTransform,
  flaGraphicNodeHasReadyVisual,
  flaGraphicNodePathKey,
  getFlaGraphicNodeAtPath,
  isFlaGraphicNodeEnterable,
  recordFlaGraphicEditDraft,
  resolveFlaGraphicExitScopeTransition,
  retainValidFlaGraphicEditDrafts,
  resolveFlaGraphicEditTarget,
} from './flaGraphicEditScope';

// Keep the editor backing store sharp on Windows 125%/150% scaling without
// allowing an unbounded DPR to multiply canvas memory.
const editorDevicePixelRatio =
  typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
const editorCanvasPixelRatio = resolveEditorCanvasPixelRatio(
  editorDevicePixelRatio,
);

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
  timeMs: number,
): CanvasImageState {
  const initialAssets = useMemo(
    () =>
      snapshot && shot
        ? listShotRuntimeImageAssets(snapshot.project, shot)
        : [],
    [shot, snapshot],
  );
  const assets = useMemo(() => {
    if (!snapshot || !shot || timeMs === 0) return initialAssets;
    const requested = listShotGraphicImageAssetsAtTime(snapshot.project, shot, timeMs);
    if (!requested.length) return initialAssets;
    const byId = new Map(initialAssets.map((asset) => [asset.id, asset]));
    for (const asset of requested) byId.set(asset.id, asset);
    return [...byId.values()];
  }, [initialAssets, shot, snapshot, timeMs]);
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

  useEffect(() => {
    if (!snapshot || !shot || !projectContextKey || !projectRoot) return;
    const characterIds = new Set(shot.layers.flatMap(({ source }) =>
      source.kind === 'character' ? [source.characterId] : [],
    ));
    const expressionAssetIds = new Set(snapshot.project.characters.flatMap((character) =>
      character.mode === 'adaptive-parts' && characterIds.has(character.id)
        ? (character.expressions ?? []).flatMap(({ assetId }) => assetId ? [assetId] : [])
        : [],
    ));
    if (expressionAssetIds.size === 0) return;
    const retryExpressions = () => sessionRef.current?.retryMissing(
      projectContextKey, projectRoot, expressionAssetIds,
    );
    window.addEventListener('focus', retryExpressions);
    return () => window.removeEventListener('focus', retryExpressions);
  }, [projectContextKey, projectRoot, shot, snapshot]);

  return state;
}

function isCurrentCanvasAssetReady(
  project: EditorProjectSnapshot['project'],
  assetId: string,
  imageState: CanvasImageState,
): boolean {
  if (!imageState.images.has(assetId)) return false;
  const asset = resolveRuntimeImageAsset(project, assetId);
  if (!asset) return false;
  return (
    !asset.sha256 || imageState.sourceKeys.get(assetId) === asset.sha256
  );
}

export interface CanvasStageProps {
  curveDraft?: AnimationCurveDraft | null;
  curveMotionDraft?: CurveMotionStageDraft | null;
  dialogueSilence?: DialogueSilence;
  showHeading?: boolean;
  showToolbar?: boolean;
  onCharacterPartSelected?: () => void;
}

export function CanvasStage({
  curveDraft,
  curveMotionDraft,
  dialogueSilence,
  showHeading = true,
  showToolbar = true,
  onCharacterPartSelected,
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
  const flaGraphicEditScope = useSyncExternalStore(
    selectionStore.subscribe, selectionStore.getStructuredEditScope,
  );
  const selectedFlaGraphicNodePath = useSyncExternalStore(
    selectionStore.subscribe, selectionStore.getSelectedStructuredNodePath,
  );
  const selectedFlaGraphicRegionRef = useSyncExternalStore(
    selectionStore.subscribe, selectionStore.getSelectedStructuredRegionRef,
  );
  const flaShapeVertexEditActive = useSyncExternalStore(
    selectionStore.subscribe, selectionStore.isFlaShapeVertexEditActive,
  );
  const selectedFlaShapeVertex = useSyncExternalStore(
    selectionStore.subscribe, selectionStore.getSelectedFlaShapeVertex,
  );
  const setFlaGraphicEditScope = selectionStore.setStructuredEditScope;
  const setSelectedFlaGraphicNodePath = selectionStore.setSelectedStructuredNodePath;
  const [flaGraphicEditDrafts, setFlaGraphicEditDrafts] = useState<
    Readonly<Record<string, Readonly<Record<string, AffineMatrix2D>>>>
  >({});
  const flaGraphicEditParentNodeRef = useRef<Konva.Group | null>(null);
  const flaGraphicEditSelectedNodeRef = useRef<Konva.Group | null>(null);
  const canvasStageElementRef = useRef<HTMLDivElement>(null);
  const [interactionStatus, setInteractionStatus] = useState(
    '从素材库拖入图片或动画，或点击普通图层进行选择。',
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
  const armDraft = useCharacterArmAssembly();
  const { setAssembly, readAssemblyParts } = useCharacterArmTool({
    projectInstanceId, shotId: currentShotId ?? '', layerId: selectedLayerId ?? '',
  });
  const armShot = armDraft && snapshot?.project.shots.find(({ id }) => id === currentShotId);
  const armAssembly = armDraft && armDraft.target.projectInstanceId === projectInstanceId &&
    armDraft.target.shotId === currentShotId && armDraft.target.layerId === selectedLayerId &&
    armDraft.revision === snapshot?.revision && armShot &&
    armDraft.timeMs === resolveTimelineFrameTime(timelineUi.currentTimeMs, armShot.durationMs) &&
    !positionAuthoringSession && !flaGraphicEditScope ? armDraft : undefined;
  useLayoutEffect(() => {
    if (armDraft && !armAssembly) setAssembly?.(current => current === armDraft ? undefined : current);
  }, [armAssembly, armDraft, setAssembly]);
  const assemblingArm = Boolean(armAssembly);
  useEffect(() => {
    if (!assemblingArm) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setAssembly?.(undefined);
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [assemblingArm, setAssembly]);

  const effectsPreview = useContext(LayerEffectPreviewContext);
  const activeEffects = !armAssembly && effectsPreview?.projectInstanceId === projectInstanceId &&
    effectsPreview?.revision === snapshot?.revision && effectsPreview?.shotId === currentShotId &&
    effectsPreview?.layerId === selectedLayerId ? effectsPreview : null;
  const activeCurveMotion = !armAssembly && curveMotionDraft?.projectInstanceId === projectInstanceId &&
    curveMotionDraft?.revision === snapshot?.revision && curveMotionDraft?.shotId === currentShotId &&
    curveMotionDraft?.layerId === selectedLayerId ? curveMotionDraft : null;
  const selectedCharacterNodeId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterNodeId);
  const selectedMotionPartId = adaptivePartIdForNodeId(selectedCharacterNodeId);
  const characterNodeSelected = selectedCharacterNodeId !== null && selectedCharacterNodeId !== 'root';
  const [motionError, setMotionError] = useState('');
  const opacityPreview = useOpacityPreview();
  const depthPreview = useDepthPreview();
  const layoutPreview = useLayoutPreview();
  const scenePreview = useScenePreview();
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
  const [showCameraView, setShowCameraView] = useState(true);
  const [cameraToolShotId, setCameraToolShotId] = useState<string | null>(null);
  const [cameraCurveDraft, setCameraCurveDraft] = useState<ShotCameraCurveDraft | null>(null);
  const activeCameraCurveDraft = resolveActiveShotCameraCurveDraft(cameraCurveDraft, {
    projectInstanceId,
    revision: snapshot?.revision,
    shotId: currentShotId,
    blocked: Boolean(armAssembly),
  });
  useLayoutEffect(() => {
    if (cameraCurveDraft && !activeCameraCurveDraft) {
      setCameraCurveDraft((current) => (current === cameraCurveDraft ? null : current));
    }
  }, [activeCameraCurveDraft, cameraCurveDraft]);
  const activeDepthPreview = !armAssembly && depthPreview &&
    depthPreview.projectInstanceId === projectInstanceId &&
    depthPreview.projectId === snapshot?.project.id &&
    depthPreview.projectRoot === snapshot?.projectRoot &&
    depthPreview.revision === snapshot?.revision &&
    depthPreview.shotId === currentShotId &&
    depthPreview.layerId === selectedLayerId &&
    depthPreview.timeMs === timelineUi.currentTimeMs
    ? depthPreview
    : null;
  const activeLayoutPreview = !armAssembly && layoutPreview &&
    layoutPreview.projectInstanceId === projectInstanceId &&
    layoutPreview.projectId === snapshot?.project.id &&
    layoutPreview.projectRoot === snapshot?.projectRoot &&
    layoutPreview.revision === snapshot?.revision &&
    layoutPreview.shotId === currentShotId &&
    layoutPreview.timeMs === timelineUi.currentTimeMs
    ? layoutPreview
    : null;
  const activeScenePreview = !armAssembly && scenePreview &&
    scenePreview.projectInstanceId === projectInstanceId &&
    scenePreview.projectId === snapshot?.project.id &&
    scenePreview.projectRoot === snapshot?.projectRoot &&
    scenePreview.revision === snapshot?.revision
    ? scenePreview
    : null;
  const effectiveCameraProject =
    activeCameraCurveDraft?.project ??
    activeDepthPreview?.previewProject ??
    activeLayoutPreview?.previewProject ??
    snapshot?.project ??
    null;
  const effectiveCameraShot =
    effectiveCameraProject?.shots.find(({ id }) => id === currentShotId) ?? shot;
  const effectiveCameraTimeMs = activeCameraCurveDraft?.timeMs ?? timelineUi.currentTimeMs;
  const hasManualCameraTrack = shot?.camera?.mode === 'manual' || shot?.camera?.mode === 'hybrid';
  const cameraTool = !showCameraView && !armAssembly && hasManualCameraTrack && cameraToolShotId === shot.id;
  const shotCameraPlan = useMemo(
    () => effectiveCameraProject && effectiveCameraShot &&
      (effectiveCameraShot.camera?.mode === 'manual' || effectiveCameraShot.camera?.mode === 'hybrid')
      ? prepareShotCamera(effectiveCameraProject, effectiveCameraShot, 'speaker-focus')
      : null,
    [effectiveCameraProject, effectiveCameraShot],
  );
  const displayCamera = showCameraView && !armAssembly && shotCameraPlan
    ? shotCameraPlan(effectiveCameraTimeMs)
    : undefined;
  const cameraViewActive = Boolean(displayCamera);
  const [parentPick, setParentPick] = useState<{ shotId: string; childId: string; instance: number | null } | null>(null);
  const pickingParent = !cameraTool && !cameraViewActive && !armAssembly &&
    parentPick?.shotId === shot?.id && parentPick?.instance === projectInstanceId &&
    parentPick?.childId === selectedLayerId ? parentPick : null;
  const activeCurveDraft = !cameraViewActive && !armAssembly && curveDraft?.projectInstanceId === projectInstanceId &&
    curveDraft?.revision === snapshot?.revision && curveDraft?.shotId === currentShotId &&
    curveDraft?.layerId === selectedLayerId ? curveDraft : null;
  const effectivePreviewTimeMs = activeScenePreview
    ? 0
    : activeCurveDraft?.timeMs ??
      activeCameraCurveDraft?.timeMs ??
      timelineUi.currentTimeMs;
  const effectivePreviewProject =
    activeScenePreview?.previewProject ??
    activeLayoutPreview?.previewProject ??
    activeDepthPreview?.previewProject ??
    activeCameraCurveDraft?.project ??
    activeCurveDraft?.project ??
    snapshot?.project ??
    null;
  const effectivePreviewShot = activeScenePreview
    ? activeScenePreview.previewProject.shots.find(
        ({ id }) => id === activeScenePreview.previewShotId,
      ) ?? shot
    : effectivePreviewProject?.shots.find(({ id }) => id === currentShotId) ??
      shot;
  const effectiveImageSnapshot = useMemo(
    () =>
      snapshot && activeScenePreview
        ? { ...snapshot, project: activeScenePreview.previewProject }
        : snapshot,
    [activeScenePreview, snapshot],
  );
  const editContextKey = snapshot && shot && projectInstanceId !== null
    ? JSON.stringify([projectInstanceId, snapshot.project.id, snapshot.projectRoot, shot.id])
    : null;
  const selectedFlaGraphicTarget = useMemo(
    () => resolveFlaGraphicEditTarget({
      project: snapshot?.project ?? null,
      projectRoot: snapshot?.projectRoot ?? null,
      projectInstanceId,
      shot,
      layerId: selectedLayerId,
    }),
    [projectInstanceId, selectedLayerId, shot, snapshot?.project, snapshot?.projectRoot],
  );
  const validFlaGraphicTargetKeys = useMemo(() => {
    if (!snapshot || !shot) return new Set<string>();
    return new Set(shot.layers.flatMap((layer) => {
      const target = resolveFlaGraphicEditTarget({
        project: snapshot.project,
        projectRoot: snapshot.projectRoot,
        projectInstanceId,
        shot,
        layerId: layer.id,
      });
      return target ? [target.key] : [];
    }));
  }, [projectInstanceId, shot, snapshot]);
  const flaGraphicEditActive = Boolean(
    !cameraViewActive && !cameraTool && selectedFlaGraphicTarget &&
      flaGraphicEditScope?.targetKey === selectedFlaGraphicTarget.key,
  );
  const flaGraphicEditMode = flaGraphicEditActive
    ? flaGraphicEditScope?.editMode ?? 'instance'
    : 'instance';
  const sharedTimelineAuthoringActive = Boolean(
    flaGraphicEditActive &&
      flaGraphicEditMode === 'definition' &&
      timelineUi.flaGraphicInternalContext?.timelineAuthoringActive,
  );
  const sharedInternalTimeMs =
    flaGraphicEditActive &&
    flaGraphicEditMode === 'definition' &&
    sharedTimelineAuthoringActive
      ? (timelineUi.flaGraphicInternalContext?.internalTimeMs ?? 0)
      : undefined;
  const flaGraphicEditPath = flaGraphicEditActive
    ? flaGraphicEditScope?.path ?? []
    : [];
  const selectedFlaGraphicNodePathKey = selectedFlaGraphicNodePath
    ? flaGraphicNodePathKey(selectedFlaGraphicNodePath)
    : null;
  const selectedFlaGraphicNode = flaGraphicEditActive && selectedFlaGraphicTarget &&
      selectedFlaGraphicNodePath &&
      selectedFlaGraphicNodePath.length > 0
    ? getFlaGraphicNodeAtPath(
        selectedFlaGraphicTarget.frame,
        selectedFlaGraphicNodePath,
        selectedFlaGraphicTarget.animation.structure,
        {
          shared: selectedFlaGraphicTarget.animation.flaGraphicSharedShapeOverrides,
          instance:
            flaGraphicEditMode === 'definition'
              ? undefined
              : selectedFlaGraphicTarget.layer.flaGraphicInstanceShapeOverrides,
        },
      )
    : null;
  const activeFlaGraphicEditDraftMatrices = selectedFlaGraphicTarget
    ? flaGraphicEditDrafts[selectedFlaGraphicTarget.key] ?? {}
    : {};
  const selectedStructuredNodeScales =
    selectedFlaGraphicNode && selectedFlaGraphicTarget && selectedFlaGraphicNodePath
      ? structuredChildTransformerScales(
          selectedFlaGraphicNode.localTransform,
          flaGraphicEditMode === 'definition'
            ? undefined
            : getFlaGraphicInstanceTransformOverride(
                selectedFlaGraphicTarget.layer.flaGraphicInstanceTransformOverrides,
                selectedFlaGraphicTarget.frameOrdinal,
                selectedFlaGraphicNodePath,
              ),
          activeFlaGraphicEditDraftMatrices[
            flaGraphicNodePathKey(selectedFlaGraphicNodePath)
          ],
        )
      : null;
  const structuredEditAssets = useMemo<CanvasImageAssetSource[]>(() => {
    if (!flaGraphicEditActive || !selectedFlaGraphicTarget || !snapshot) return [];
    return collectFlaGraphicStructureAssetIds(
      selectedFlaGraphicTarget.frame,
      selectedFlaGraphicTarget.animation.structure,
    )
      .flatMap((assetId) => {
        const asset = resolveImageAsset(snapshot.project, assetId);
        return asset?.sha256 ? [{ id: asset.id, sha256: asset.sha256 }] : [];
      });
  }, [flaGraphicEditActive, selectedFlaGraphicTarget, snapshot]);
  const projectImageDimensions = useMemo(() => {
    const dimensions = new Map<string, Pick<ImageAsset, 'width' | 'height'>>();
    for (const asset of snapshot?.project.assets ?? []) {
      if (asset.kind === 'image') dimensions.set(asset.id, asset);
    }
    return dimensions;
  }, [snapshot?.project.assets]);
  useEffect(() => {
    setFlaGraphicEditScope(null);
    setSelectedFlaGraphicNodePath(null);
    setFlaGraphicEditDrafts({});
  }, [editContextKey]);
  useEffect(() => {
    if (flaGraphicEditScope && !validFlaGraphicTargetKeys.has(flaGraphicEditScope.targetKey)) {
      if (
        flaGraphicEditScope.editMode === 'definition' &&
        selectedFlaGraphicTarget &&
        flaGraphicEditScope.sessionKey === selectedFlaGraphicTarget.sessionKey
      ) {
        const scopeStillValid =
          flaGraphicEditScope.path.length === 0 ||
          Boolean(
            getFlaGraphicNodeAtPath(
              selectedFlaGraphicTarget.frame,
              flaGraphicEditScope.path,
              selectedFlaGraphicTarget.animation.structure,
            ),
          );
        if (scopeStillValid) {
          setFlaGraphicEditScope({
            ...flaGraphicEditScope,
            targetKey: selectedFlaGraphicTarget.key,
          });
          setFlaGraphicEditDrafts((current) =>
            retainValidFlaGraphicEditDrafts(current, validFlaGraphicTargetKeys),
          );
          return;
        }
      }
      setFlaGraphicEditScope(null);
      setSelectedFlaGraphicNodePath(null);
    }
    setFlaGraphicEditDrafts((current) =>
      retainValidFlaGraphicEditDrafts(current, validFlaGraphicTargetKeys),
    );
  }, [flaGraphicEditScope, selectedFlaGraphicTarget, validFlaGraphicTargetKeys]);
  useEffect(() => {
    if (flaGraphicEditScope?.targetKey === selectedFlaGraphicTarget?.key) return;
    if (
      flaGraphicEditScope?.editMode === 'definition' &&
      selectedFlaGraphicTarget &&
      flaGraphicEditScope.sessionKey === selectedFlaGraphicTarget.sessionKey
    ) {
      return;
    }
    if (flaGraphicEditScope) {
      setFlaGraphicEditDrafts((current) =>
        clearFlaGraphicEditTargetDrafts(current, flaGraphicEditScope.targetKey),
      );
    }
    if (flaGraphicEditScope) setFlaGraphicEditScope(null);
    if (selectedFlaGraphicNodePath) setSelectedFlaGraphicNodePath(null);
  }, [flaGraphicEditScope, selectedFlaGraphicNodePath, selectedFlaGraphicTarget]);
  const updateFlaGraphicChildTransform = useCallback((
    nodePath: readonly string[],
    matrix: AffineMatrix2D,
  ) => {
    if (!selectedFlaGraphicTarget) return;
    setFlaGraphicEditDrafts((current) =>
      recordFlaGraphicEditDraft(
        current,
        selectedFlaGraphicTarget.key,
        nodePath,
        matrix,
      ),
    );
  }, [selectedFlaGraphicTarget]);
  useEffect(() => {
    if (flaGraphicEditActive && flaGraphicEditMode === 'definition' && selectedFlaGraphicTarget) {
      const existingContext = timelineUiStore.getSnapshot().flaGraphicInternalContext;
      const defaultAuthoringActive =
        existingContext &&
        existingContext.animationId === selectedFlaGraphicTarget.animation.id
          ? existingContext.timelineAuthoringActive
          : collectFlaGraphicTimelineDurationMs(
              selectedFlaGraphicTarget.animation.structure?.timeline,
              selectedFlaGraphicTarget.animation.structure,
            ) > 0;
      timelineUiStore.setFlaGraphicInternalContext({
        layerId: selectedFlaGraphicTarget.layerId,
        animationId: selectedFlaGraphicTarget.animation.id,
        frameOrdinal: selectedFlaGraphicTarget.frameOrdinal,
        selectedNodePath: selectedFlaGraphicNodePath,
        fps: Math.max(1, selectedFlaGraphicTarget.animation.source.sourceFps || 24),
        timelineAuthoringActive: defaultAuthoringActive,
      });
      return;
    }
    timelineUiStore.setFlaGraphicInternalContext(null);
  }, [
    flaGraphicEditActive,
    flaGraphicEditMode,
    selectedFlaGraphicNodePath,
    selectedFlaGraphicTarget,
  ]);
  const commitFlaGraphicChildTransform = useCallback((
    nodePath: readonly string[],
    matrix: AffineMatrix2D,
  ) => {
    if (!selectedFlaGraphicTarget) return;
    try {
      if (flaGraphicEditScope?.editMode === 'definition') {
        if (sharedTimelineAuthoringActive) {
          const internalTime = sharedInternalTimeMs ?? 0;
          const authoringState = resolveFlaGraphicInternalAuthoringState({
            structure: selectedFlaGraphicTarget.animation.structure,
            frameOrdinal: selectedFlaGraphicTarget.frameOrdinal,
            nodePath,
            internalTimeMs: internalTime,
            timelineAuthoringActive: true,
          });
          if (!authoringState.canEditTransform) {
            setInteractionStatus(
              authoringState.reason === 'trs-unsafe-readonly'
                ? '当前节点包含倾斜变换，内部时间轴暂不支持编辑。'
                : '当前时间点没有关键帧，请先添加关键帧后再编辑。',
            );
            return;
          }
          layerStore.updateFlaGraphicTimelineKeyframeTransform(
            selectedFlaGraphicTarget.layerId,
            selectedFlaGraphicTarget.frameOrdinal,
            nodePath,
            internalTime,
            matrix,
          );
        } else {
          layerStore.updateFlaGraphicSharedDefinitionTransform(
            selectedFlaGraphicTarget.layerId,
            selectedFlaGraphicTarget.frameOrdinal,
            nodePath,
            matrix,
          );
        }
      } else {
        layerStore.updateFlaGraphicInstanceTransform(
          selectedFlaGraphicTarget.layerId,
          selectedFlaGraphicTarget.frameOrdinal,
          nodePath,
          matrix,
        );
      }
    } catch (error) {
      setInteractionStatus(
        error instanceof Error ? error.message : 'Graphic instance transform could not be saved.',
      );
    } finally {
      setFlaGraphicEditDrafts((current) =>
        clearFlaGraphicEditDraft(
          current,
          selectedFlaGraphicTarget.key,
          nodePath,
        ),
      );
    }
  }, [
    flaGraphicEditScope?.editMode,
    selectedFlaGraphicTarget,
    sharedInternalTimeMs,
    sharedTimelineAuthoringActive,
  ]);
  const exitOrPopFlaGraphicScope = useCallback(() => {
    if (!selectedFlaGraphicTarget || !flaGraphicEditActive || !flaGraphicEditScope) return;
    setFlaGraphicEditDrafts((current) =>
      clearFlaGraphicEditTargetDrafts(current, selectedFlaGraphicTarget.key),
    );
    const transition = resolveFlaGraphicExitScopeTransition(
      selectedFlaGraphicTarget.frame,
      flaGraphicEditScope.path,
      selectedFlaGraphicTarget.animation.structure,
    );
    setSelectedFlaGraphicNodePath(
      transition.nextSelectedNodePath ? [...transition.nextSelectedNodePath] : null,
    );
    if (transition.nextScopePath) {
      setFlaGraphicEditScope({
        targetKey: selectedFlaGraphicTarget.key,
        sessionKey: flaGraphicEditScope.sessionKey ?? selectedFlaGraphicTarget.sessionKey,
        editMode: flaGraphicEditScope.editMode,
        frameOrdinal: selectedFlaGraphicTarget.frameOrdinal,
        path: transition.nextScopePath,
      });
    } else {
      setFlaGraphicEditScope(null);
      selectionStore.selectExplicit(selectedFlaGraphicTarget.layerId);
    }
    canvasStageElementRef.current?.focus({ preventScroll: true });
  }, [flaGraphicEditActive, flaGraphicEditScope, selectedFlaGraphicTarget]);
  const enterFlaGraphicScope = useCallback((path: readonly string[]) => {
    if (!selectedFlaGraphicTarget || !flaGraphicEditActive) return;
    setFlaGraphicEditScope({
      targetKey: selectedFlaGraphicTarget.key,
      sessionKey: flaGraphicEditScope?.sessionKey ?? selectedFlaGraphicTarget.sessionKey,
      editMode: flaGraphicEditScope?.editMode ?? 'instance',
      frameOrdinal: selectedFlaGraphicTarget.frameOrdinal,
      path: [...path],
    });
    setSelectedFlaGraphicNodePath(null);
    canvasStageElementRef.current?.focus({ preventScroll: true });
  }, [flaGraphicEditActive, flaGraphicEditScope?.editMode, flaGraphicEditScope?.sessionKey, selectedFlaGraphicTarget]);
  const enterSelectedFlaGraphicNode = useCallback(() => {
    if (
      !selectedFlaGraphicNode ||
      !isFlaGraphicNodeEnterable(selectedFlaGraphicNode, selectedFlaGraphicTarget?.animation.structure)
    ) return;
    enterFlaGraphicScope(selectedFlaGraphicNodePath ?? []);
  }, [enterFlaGraphicScope, selectedFlaGraphicNode, selectedFlaGraphicNodePath]);
  const enterFlaGraphicMode = useCallback((mode: 'instance' | 'definition') => {
    if (!selectedFlaGraphicTarget || selectedLayerId !== selectedFlaGraphicTarget.layerId) return;
    if (flaGraphicEditActive) {
      exitOrPopFlaGraphicScope();
      return;
    }
    setSelectedFlaGraphicNodePath(null);
    selectionStore.selectExplicit(selectedFlaGraphicTarget.layerId);
    setFlaGraphicEditScope({
      targetKey: selectedFlaGraphicTarget.key,
      sessionKey: selectedFlaGraphicTarget.sessionKey,
      editMode: mode,
      frameOrdinal: selectedFlaGraphicTarget.frameOrdinal,
      path: [],
    });
    canvasStageElementRef.current?.focus({ preventScroll: true });
  }, [
    exitOrPopFlaGraphicScope,
    flaGraphicEditActive,
    selectedFlaGraphicTarget,
    selectedLayerId,
  ]);
  const toggleFlaGraphicEditScope = useCallback(() => {
    enterFlaGraphicMode('instance');
  }, [enterFlaGraphicMode]);
  const toggleFlaGraphicSharedEditScope = useCallback(() => {
    enterFlaGraphicMode('definition');
  }, [enterFlaGraphicMode]);
  const handleFlaGraphicEditKeyDownCapture = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !flaGraphicEditActive) return;
    event.preventDefault();
    event.stopPropagation();
    exitOrPopFlaGraphicScope();
  }, [exitOrPopFlaGraphicScope, flaGraphicEditActive]);
  const activeOpacityPreview =
    !cameraViewActive && opacityPreview &&
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
    () => evaluateSubtitleAtTime(subtitleCues, effectivePreviewTimeMs),
    [subtitleCues, effectivePreviewTimeMs],
  );
  const temporalContextKey =
    snapshot && shot && editorProjectStore.getProjectInstanceId() !== null
      ? `${snapshot.project.id}:${snapshot.projectRoot}:${editorProjectStore.getProjectInstanceId()}:${shot.id}`
      : null;
  const continuityMode: EditorTemporalContinuityMode =
    cameraViewActive ? 'temporal' : editorTemporalContinuityMode(effectivePreviewTimeMs);
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
    for (const asset of structuredEditAssets) {
      assets.set(`${asset.id}:${asset.sha256}`, asset);
    }
    return [...assets.values()];
  }, [previousTemporalVisuals, structuredEditAssets]);
  const imageState = useCanvasImages(
    effectiveImageSnapshot,
    activeScenePreview ? effectivePreviewShot : shot,
    retainedAssets,
    effectivePreviewTimeMs,
  );
  const handleMoveFlaShapeVertex = useCallback((
    nodePath: readonly string[],
    regionRef: string,
    target: FlaShapeVertexTarget,
    x: number,
    y: number,
  ) => {
    if (!selectedFlaGraphicTarget) return;
    try {
      const node = getFlaGraphicNodeAtPath(
        selectedFlaGraphicTarget.frame,
        nodePath,
        selectedFlaGraphicTarget.animation.structure,
        {
          shared: selectedFlaGraphicTarget.animation.flaGraphicSharedShapeOverrides,
          instance:
            flaGraphicEditScope?.editMode === 'definition'
              ? undefined
              : selectedFlaGraphicTarget.layer.flaGraphicInstanceShapeOverrides,
        },
      );
      const fallbackAssetId = node?.type === 'opaque' ? node.fallbackAssetId : undefined;
      const svgText = fallbackAssetId
        ? imageState.svgTexts?.get(fallbackAssetId) ??
          getCachedFlaSvgAssetText(fallbackAssetId)
        : undefined;
      layerStore.moveFlaGraphicShapeRegionVertex({
        layerId: selectedFlaGraphicTarget.layerId,
        frameOrdinal: selectedFlaGraphicTarget.frameOrdinal,
        nodePath,
        regionRef,
        mode: flaGraphicEditScope?.editMode === 'definition' ? 'definition' : 'instance',
        target,
        x,
        y,
        svgText,
      });
    } catch (error) {
      setInteractionStatus(
        error instanceof Error ? error.message : '路径顶点更新失败。',
      );
    }
  }, [flaGraphicEditScope?.editMode, imageState.svgTexts, selectedFlaGraphicTarget]);
  useLayoutEffect(() => {
    if (!readAssemblyParts || !snapshot || !shot || positionAuthoringSession || flaGraphicEditScope) return;
    readAssemblyParts.current = (sourceSnapshot, address) => {
      if (sourceSnapshot !== snapshot || address.shotId !== shot.id || address.layerId !== selectedLayerId) return new Map();
      const displayed = evaluateEditorCanvasShot(snapshot.project, shot, timelineUi.currentTimeMs, activeCue?.id ?? null, dialogueSilence)
        .layers.find(({ id }) => id === address.layerId);
      return displayed ? resolveCharacterArmAssemblyParts(snapshot.project, address, displayed) : new Map();
    };
    return () => { readAssemblyParts.current = undefined; };
  }, [activeCue?.id, dialogueSilence, flaGraphicEditScope, positionAuthoringSession, readAssemblyParts, selectedLayerId, shot, snapshot, timelineUi.currentTimeMs]);

  const temporalCanvasModel = useMemo(
    () =>
      snapshot && shot && effectivePreviewProject && effectivePreviewShot
        ? buildEditorTemporalCanvasModel({
            activeDialogueId: activeCue?.id ?? null,
            cameraViewActive,
            dialogueSilence,
            currentTimeMs: effectivePreviewTimeMs,
            previousVisuals: previousTemporalVisuals,
            project: effectivePreviewProject,
            readyAssetIds: new Set(imageState.images.keys()),
            readyAssetSourceKeys: imageState.sourceKeys,
            readyResourceKeys: imageState.readyResourceKeys,
            missingAssetIds: imageState.missing,
            shot: effectivePreviewShot,
            positionDraft: !cameraViewActive && positionAuthoringSnapshot
              ? {
                  layerId: positionAuthoringSnapshot.layerId,
                  position: positionAuthoringSnapshot.draft,
                }
              : undefined,
          })
        : null,
    [
      activeCue?.id,
      cameraViewActive,
      dialogueSilence,
      effectivePreviewProject,
      effectivePreviewShot,
      effectivePreviewTimeMs,
      imageState.images,
      imageState.missing,
      imageState.readyResourceKeys,
      imageState.sourceKeys,
      previousTemporalVisuals,
      positionAuthoringSnapshot,
      shot,
      snapshot,
      temporalContextKey,
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
  const armVisualStatus = armAssembly && temporalCanvasModel?.visualStatusByLayer.get(armAssembly.target.layerId);
  // Continuity may display the previous pose while this frame's art loads.
  const waitingForArmVisual = armVisualStatus === 'previous-complete' || armVisualStatus === 'pending';
  const armVisualUnavailable = armVisualStatus === 'required-failed';

  function pickArmPart(layerId: string, partId: string | null): void {
    if (!armAssembly || waitingForArmVisual || armVisualUnavailable || layerId !== armAssembly.target.layerId || !partId) return;
    const index = armAssembly.chain.segments.findIndex(segment => !segment.partId);
    if (index >= 0) setAssembly?.(current => current === armAssembly
      ? updateArmAssemblyPart(current, index, partId) : current);
  }
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
      if (stageLayer.layer.source.kind === 'control') return true;
      if (!stageLayer.visual.parts.length) return false;
      const assetIds = visualAssetIds(stageLayer.visual, stageLayer.evaluated);
      const sourceKeys = temporalCanvasModel?.visualSourceKeysByLayer.get(
        stageLayer.layer.id,
      );
      if (sourceKeys && sourceKeys.size > 0) {
        return assetIds.every((assetId) => {
          const sourceKey = sourceKeys.get(assetId);
          return sourceKey
            ? imageState.readyResourceKeys.has(
                canvasImageResourceKey(assetId, sourceKey),
              )
            : Boolean(
                snapshot &&
                  isCurrentCanvasAssetReady(
                    snapshot.project,
                    assetId,
                    imageState,
                  ),
              );
        });
      }
      return Boolean(
        snapshot &&
          assetIds.every((assetId) =>
            isCurrentCanvasAssetReady(snapshot.project, assetId, imageState),
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
    if (cameraTool || pickingParent || stageLayer.evaluated.parentSpaceUnavailable) return false;
    if (stageLayer.layer.source.kind !== 'animation' && !isSupportedLayerMotionLayer(snapshot?.project, shot, stageLayer.layer)) {
      return currentTimeMs === 0 && (!cameraViewActive ||
        (timelineUi.currentTimeMs === currentTimeMs && directEditingEnabledForStageLayer(stageLayer)));
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
        currentLayer &&
        !currentLayer.locked &&
        editorProjectStore.getProjectInstanceId() === projectInstanceId &&
        current.project.id === snapshot.project.id &&
        current.projectRoot === snapshot.projectRoot &&
        current.revision === snapshot.revision &&
        shotStore.getCurrentShotId() === shot.id &&
        selectionStore.getSelectedLayerId() === stageLayer.layer.id &&
        (isSupportedLayerMotionLayer(current.project, currentShot, currentLayer)
          ? isLayerMotionTransformEditableAtTime(
              current.project,
              shot.id,
              stageLayer.layer.id,
              currentTimeMs,
            )
          : isAnimationBaseTransformEditableAtTime(
              current.project,
              shot.id,
              stageLayer.layer.id,
              currentTimeMs,
            )) &&
        evaluated?.visible &&
        (currentLayer.source.kind !== 'animation' || evaluated.assetId === currentFrameAssetId) &&
        stageLayer.render.visible &&
        isStageLayerVisualReady(stageLayer),
    );
  };
  const directEditingEnabledForStageLayer = (
    stageLayer: NonNullable<typeof stageModel>['layers'][number],
  ): boolean => {
    if (stageLayer.evaluated.parentSpaceUnavailable) return false;
    if (stageLayer.layer.source.kind !== 'animation' && !isSupportedLayerMotionLayer(snapshot?.project, shot, stageLayer.layer)) {
      if (!cameraViewActive) return directEditingEnabled;
      return timelineUi.currentTimeMs === 0 && !stageLayer.layer.locked &&
        !stageLayer.evaluated.characterAction && stageLayer.render.visible && isStageLayerVisualReady(stageLayer) &&
        !shot?.timelineEvents.some((event) => event.layerId === stageLayer.layer.id &&
          (event.type === 'move' || event.type === 'scale' || event.type === 'shake'));
    }
    const evaluated = shot && snapshot
      ? evaluateShotAtTime(
          shot,
          timelineUi.currentTimeMs,
          snapshot.project,
        ).layers.find((candidate) => candidate.id === stageLayer.layer.id)
      : undefined;
    return Boolean(
      snapshot &&
        shot &&
        evaluated?.visible &&
        (stageLayer.layer.source.kind !== 'animation' || evaluated.assetId === stageLayer.visual.parts[0]?.assetId) &&
        (isSupportedLayerMotionLayer(snapshot.project, shot, stageLayer.layer)
          ? isLayerMotionTransformEditableAtTime(
              snapshot.project,
              shot.id,
              stageLayer.layer.id,
              timelineUi.currentTimeMs,
            )
          : isAnimationBaseTransformEditableAtTime(
              snapshot.project,
              shot.id,
              stageLayer.layer.id,
              timelineUi.currentTimeMs,
            )) &&
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
    const sourceKey = firstPart?.assetId
      ? sourceKeys?.get(firstPart.assetId)
      : undefined;
    if (!firstPart?.assetId || !sourceKey) return imageForAsset(stageLayer.asset);
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
  const backgroundUsesStructuredVisual = Boolean(
    backgroundLayer?.visual?.kind === 'fla-graphic' &&
      backgroundLayer.visual.flaGraphic?.structureFrame,
  );
  const backgroundVisualReady = backgroundLayer
    ? backgroundUsesStructuredVisual
      ? isStageLayerVisualReady(backgroundLayer)
      : Boolean(backgroundAsset && backgroundImage)
    : false;
  const missingBackground = Boolean(shot) && Boolean(
    backgroundLayer?.render.visible && !backgroundVisualReady &&
    (temporalCanvasModel?.visualStatusByLayer.get(backgroundLayer.layer.id) === 'required-failed' ||
      backgroundLayer.visual.resources.required.some(({ assetId }) => imageState.missing.has(assetId))),
  );
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
  const hasExpressionOriginalFallback =
    nonBackgroundStatuses?.includes('expression-original-fallback') ?? false;
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
    hasExpressionOriginalFallback ||
    hasMouthVisualDegradation ||
    hasPendingVisual;
  const routineVisualPending =
    !missingBackground &&
    hasNonBackgroundVisualIssue &&
    !hasRequiredVisualFailure &&
    !hasExpressionOriginalFallback &&
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
  const selectedLayerProjection = selectedStageLayer
    ? resolveLayerCameraTransform(selectedStageLayer.evaluated, displayCamera, PROJECT_WIDTH, PROJECT_HEIGHT)
    : null;
  const canPickParent = shot && selectedStageLayer && !selectedStageLayer.layer.locked &&
    shot.backgroundLayerId !== selectedLayerId && !cameraViewActive && !cameraTool && !armAssembly &&
    !flaGraphicEditActive && validLayerParentTargets(shot, selectedStageLayer.layer.id).length > 0;
  const motionContextKey = JSON.stringify([projectInstanceId, snapshot?.revision, currentShotId, selectedLayerId, selectedCharacterNodeId, timelineUi.currentTimeMs, timelineUi.characterMotionAutoKey]);
  const motionCanvasForLayer = (motionLayer: Layer, view: CharacterView | null): CharacterMotionCanvas | undefined => {
    if (!snapshot || !shot || !view?.nodes.some(isCharacterNodeMotionEditable) || positionAuthoringSession) {
      return undefined;
    }
    const selectedOnLayer = selectedLayerId === motionLayer.id;
    const activeNode = selectedOnLayer
      ? view.nodes.find((node) => node.id === selectedCharacterNodeId)
      : undefined;
    const activeTargetId =
      activeNode?.motion === 'character-clip-v1'
        ? activeNode.partId
        : activeNode?.motion === 'character-clip-v3'
          ? activeNode.id
          : null;
    const nodeForTarget = (targetId: string) =>
      view.nodes.find((node) =>
        node.motion === 'character-clip-v1' ? node.partId === targetId : node.id === targetId,
      );
    return {
      selectedPartId: selectedOnLayer && !armAssembly ? selectedMotionPartId : null,
      selectedTargetId: armAssembly ? null : activeTargetId,
      contextKey: motionContextKey,
      enabled: !armAssembly && !motionLayer.locked && isValidFrameTime(timelineUi.currentTimeMs),
      capabilities: (targetId) =>
        nodeForTarget(targetId)?.capabilities ?? {
          position: false,
          rotation: false,
          uniformScale: false,
        },
      scaleBounds: (targetId) => {
        const node = nodeForTarget(targetId);
        if (node?.motion === 'character-clip-v3') {
          return characterNodeMotionScaleBounds(snapshot.project, {
            shotId: shot.id,
            layerId: motionLayer.id,
            nodeId: node.id,
            autoKey: timelineUi.characterMotionAutoKey,
          });
        }
        return { min: CHARACTER_PART_MIN_SCALE, max: CHARACTER_PART_MAX_SCALE };
      },
      pivot: (targetId) => {
        const node = nodeForTarget(targetId);
        if (node?.motion === 'character-clip-v3') {
          const pose = evaluateCompositeFacePoseAtTime(
            snapshot.project,
            motionLayer,
            timelineUi.currentTimeMs,
          );
          return pose ? { x: pose.offsetX, y: pose.offsetY } : { x: 0, y: 0 };
        }
        const clip = createCharacterPartAnimationClip(snapshot.project, shot.id, motionLayer.id);
        const basis = clip.targetBases.find((b) => b.target.partId === targetId)!;
        if (!basis) return { x: 0, y: 0 };
        const matrix = composeAnimatedCharacterPartTransform(
          basis,
          clip.fixedCharacterCenter,
          evaluateAnimationClipAtTime(clip, timelineUi.currentTimeMs),
        );
        return {
          x: matrix.a * basis.pivot.x + matrix.c * basis.pivot.y + matrix.tx,
          y: matrix.b * basis.pivot.x + matrix.d * basis.pivot.y + matrix.ty,
        };
      },
      select: (targetId) => {
        const node = nodeForTarget(targetId);
        if (armAssembly?.target.layerId === motionLayer.id) {
          if (node?.motion === 'character-clip-v1') pickArmPart(motionLayer.id, node.partId);
          return;
        }
        selectionStore.select(motionLayer.id);
        if (node?.motion === 'character-clip-v3') {
          selectionStore.selectCharacterNode(node.id);
        } else {
          selectionStore.selectCharacterPart(targetId);
        }
        timelineUiStore.revealCharacterMotionPart();
        onCharacterPartSelected?.();
      },
      error: setMotionError,
      begin: (targetId) => {
        setMotionError('');
        const node = nodeForTarget(targetId);
        if (node?.motion === 'character-clip-v3') {
          const nodeId = node.id;
          return new CharacterMotionGesture(
            editorProjectStore,
            {
              shotId: shot.id,
              layerId: motionLayer.id,
              nodeId,
              timeMs: timelineUi.currentTimeMs,
              autoKey: timelineUi.characterMotionAutoKey,
            },
            () =>
              shotStore.getCurrentShotId() === shot.id &&
              selectionStore.getSelectedLayerId() === motionLayer.id &&
              selectionStore.getSelectedCharacterNodeId() === nodeId &&
              timelineUiStore.getSnapshot().currentTimeMs === timelineUi.currentTimeMs &&
              timelineUiStore.getSnapshot().characterMotionAutoKey === timelineUi.characterMotionAutoKey,
          );
        }
        return new CharacterMotionGesture(
          editorProjectStore,
          {
            shotId: shot.id,
            layerId: motionLayer.id,
            partId: targetId,
            timeMs: timelineUi.currentTimeMs,
            autoKey: timelineUi.characterMotionAutoKey,
          },
          () =>
            shotStore.getCurrentShotId() === shot.id &&
            selectionStore.getSelectedLayerId() === motionLayer.id &&
            selectionStore.getSelectedCharacterPartId() === targetId &&
            timelineUiStore.getSnapshot().currentTimeMs === timelineUi.currentTimeMs &&
            timelineUiStore.getSnapshot().characterMotionAutoKey === timelineUi.characterMotionAutoKey,
        );
      },
    };
  };
  const selectedStructuredNodeReady = Boolean(
    selectedFlaGraphicTarget &&
      selectedFlaGraphicNode &&
      flaGraphicNodeHasReadyVisual(
        selectedFlaGraphicNode,
        currentReadyImages,
        projectImageDimensions,
        selectedFlaGraphicTarget.animation.structure,
      ),
  );
  const selectedStructuredAuthoringState =
    flaGraphicEditActive &&
    flaGraphicEditMode === 'definition' &&
    selectedFlaGraphicTarget &&
    selectedFlaGraphicNodePath
      ? resolveFlaGraphicInternalAuthoringState({
          structure: selectedFlaGraphicTarget.animation.structure,
          frameOrdinal: selectedFlaGraphicTarget.frameOrdinal,
          nodePath: selectedFlaGraphicNodePath,
          internalTimeMs: sharedInternalTimeMs ?? 0,
          timelineAuthoringActive: sharedTimelineAuthoringActive,
        })
      : null;
  const selectedStructuredNodeCanTransform = Boolean(
    selectedStructuredNodeReady &&
      selectedStageLayer?.layer.locked === false &&
      selectedFlaGraphicNode &&
      flaGraphicNodeCanTransform(selectedFlaGraphicNode) &&
      (!sharedTimelineAuthoringActive ||
        Boolean(selectedStructuredAuthoringState?.canEditTransform)),
  );
  const structuredTransformerVisible = Boolean(
    flaGraphicEditActive &&
      selectedStructuredNodeCanTransform &&
      !flaShapeVertexEditActive,
  );
  const layerTransformerVisible = !characterNodeSelected && !flaGraphicEditActive && isTransformerOverlayVisible({
    selected: Boolean(
      selectedStageLayer &&
        selectedStageLayer.render.visible &&
        directEditingEnabledForStageLayer(selectedStageLayer),
    ),
    isBackground: selectedStageLayer?.render.isBackground ?? false,
    locked: selectedStageLayer?.layer.locked ?? false,
    imageReady: selectedStageLayer
      ? isStageLayerVisualReady(selectedStageLayer)
      : false,
  });
  const transformerVisible = !armAssembly && !activeCurveMotion && (structuredTransformerVisible || layerTransformerVisible);
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
      {motionError ? <div role="alert">{motionError}</div> : null}
      {armAssembly && !armVisualUnavailable ? <div className="character-arm-assembly-prompt" role="status" data-testid="character-arm-assembly-prompt">
        {waitingForArmVisual ? '等待角色画面更新…' : characterArmAssemblyPrompt(armAssembly)}
      </div> : null}
      <CanvasViewport
        dropDisabled={!snapshot || !shot}
        dropInteractionDisabled={temporalInspection || assemblingArm || Boolean(displayCamera) || cameraTool || Boolean(pickingParent)}
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
        onViewportChromePointerDown={() => { if (!armAssembly) selectionStore.clear(); }}
        viewportOverlay={
          activeScenePreview ? (
            <div
              className="canvas-scene-preview-badge"
              data-testid="canvas-scene-preview-badge"
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                zIndex: 12,
                padding: '4px 10px',
                borderRadius: 999,
                background: 'rgba(18, 22, 30, 0.84)',
                color: '#f5f7fa',
                fontSize: 12,
                lineHeight: 1.4,
                pointerEvents: 'none',
              }}
            >
              自动布景只读预览 · {activeScenePreview.previewShotName}（
              {activeScenePreview.shotIndex + 1}/{activeScenePreview.shotCount}）
            </div>
          ) : empty ? (
            <CanvasEmptyState />
          ) : null
        }
        viewportChrome={(
          showToolbar || shot || selectedFlaGraphicTarget ? (
            <CanvasToolbar
              parentControl={canPickParent && shot && selectedLayerId ? (
                <button type="button" data-ui-button data-ui-variant="secondary" data-canvas-interactive-chrome="true"
                  style={{ pointerEvents: 'auto' }} aria-pressed={!!pickingParent}
                  onKeyDown={(event) => { if (event.key === 'Escape') setParentPick(null); }}
                  onClick={() => setParentPick(pickingParent ? null : { shotId: shot.id, childId: selectedLayerId, instance: projectInstanceId })}>
                  在舞台选父级
                </button>
              ) : null}
              cameraControl={shot && !armAssembly ? <ShotCameraControls
                key={editContextKey}
                shot={shot}
                timeMs={timelineUi.currentTimeMs}
                throughCamera={showCameraView}
                cameraTool={cameraTool}
                onCurveDraft={setCameraCurveDraft}
                onViewChange={(enabled) => { setCameraToolShotId(null); setShowCameraView(enabled); }}
                onToolChange={(enabled) => {
                  setCameraToolShotId(enabled ? shot.id : null);
                  if (enabled) setShowCameraView(false);
                }}
              /> : null}
              canEnterSelected={Boolean(
                flaGraphicEditActive &&
                  selectedStructuredNodeReady &&
                  selectedFlaGraphicNode &&
                  isFlaGraphicNodeEnterable(
                    selectedFlaGraphicNode,
                    selectedFlaGraphicTarget?.animation.structure,
                  ),
              )}
              flaGraphicEditActive={flaGraphicEditActive}
              flaGraphicEditAvailable={Boolean(selectedFlaGraphicTarget)}
              flaGraphicEditMode={flaGraphicEditMode}
              readOnlySelected={Boolean(
                flaGraphicEditActive &&
                  ((selectedFlaGraphicNode &&
                    !flaGraphicNodeCanTransform(selectedFlaGraphicNode) &&
                    selectedStructuredNodeReady) ||
                    (sharedTimelineAuthoringActive &&
                      selectedFlaGraphicNode &&
                      !selectedStructuredAuthoringState?.canEditTransform)),
              )}
              mode={viewport.mode}
              onEnterSelected={enterSelectedFlaGraphicNode}
              onFlaGraphicEditKeyDownCapture={handleFlaGraphicEditKeyDownCapture}
              onReturn={exitOrPopFlaGraphicScope}
              onToggleFlaGraphicEdit={toggleFlaGraphicEditScope}
              onToggleFlaGraphicSharedEdit={toggleFlaGraphicSharedEditScope}
              point={viewport.lastStagePoint}
              showStatus={showToolbar}
              transform={toolbarTransform}
            />
          ) : null
        )}
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
              data-direct-canvas-editing={String(directEditingEnabled && !activeScenePreview)}
              data-scene-preview-active={String(Boolean(activeScenePreview))}
              data-scene-preview-shot-id={activeScenePreview?.previewShotId ?? ''}
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
              data-stage-center="960,540"
              data-transformer-overlay="separate-konva-layer-after-content"
              data-transformer-visible={String(
                transformerVisible,
              )}
              data-testid="project-canvas-stage"
              data-camera-view={displayCamera ? JSON.stringify(displayCamera) : ''}
              data-camera-tool={cameraTool ? 'active' : undefined}
              id="project-canvas-stage"
              ref={canvasStageElementRef}
              onKeyDownCapture={(event) => {
                if (event.key === 'Escape' && pickingParent) setParentPick(null);
                else handleFlaGraphicEditKeyDownCapture(event);
              }}
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
                    fill={displayCamera ? 'black' : '#111914'}
                    height={PROJECT_HEIGHT}
                    listening
                    onClick={() => { if (!armAssembly) selectionStore.clear(); }}
                    onTap={() => { if (!armAssembly) selectionStore.clear(); }}
                    width={PROJECT_WIDTH}
                  />
                  <Group listening={!cameraTool && !activeScenePreview}>
                  {stageModel
                    ? [...stageModel.layers].sort((a, b) => compareCameraDrawingLayers(a.evaluated, b.evaluated)).map((stageLayer) => {
                        const { layer, render, visual } = stageLayer;
                        const projection = resolveLayerCameraTransform(stageLayer.evaluated, displayCamera, PROJECT_WIDTH, PROJECT_HEIGHT);
                        if (!projection) return null;
                        const characterView = snapshot && !positionAuthoringSession && !render.isBackground
                          ? resolveCharacterView(snapshot.project, layer, visual)
                          : null;
                        const image = imageForStageLayer(stageLayer);
                        const editProjection =
                          flaGraphicEditActive &&
                          flaGraphicEditScope &&
                          selectedFlaGraphicTarget?.layerId === layer.id
                            ? {
                                definition: selectedFlaGraphicTarget.animation,
                                frame: selectedFlaGraphicTarget.frame,
                                images: currentReadyImages,
                                svgTexts: imageState.svgTexts,
                                assets: projectImageDimensions,
                                scopePath: flaGraphicEditPath,
                                editMode: flaGraphicEditMode,
                                timelineAuthoringActive: sharedTimelineAuthoringActive,
                                internalTimeMs: sharedInternalTimeMs,
                                selectedNodePathKey: selectedFlaGraphicNodePathKey,
                                selectedRegionRef: selectedFlaGraphicRegionRef,
                                vertexEditActive: flaShapeVertexEditActive,
                                selectedVertexTarget: selectedFlaShapeVertex,
                                instanceTransformOverrides:
                                  flaGraphicEditMode === 'definition'
                                    ? undefined
                                    : layer.flaGraphicInstanceTransformOverrides,
                                instanceShapeOverrides:
                                  flaGraphicEditMode === 'definition'
                                    ? undefined
                                    : layer.flaGraphicInstanceShapeOverrides,
                                instanceColor: visual?.flaGraphic?.instanceColor,
                                instanceTextOverrides: layer.flaGraphicInstanceTextOverrides,
                                draftMatrices: activeFlaGraphicEditDraftMatrices,
                                layerLocked: layer.locked,
                                scopeParentNodeRef: flaGraphicEditParentNodeRef,
                                selectedNodeRef: flaGraphicEditSelectedNodeRef,
                                onSelect: setSelectedFlaGraphicNodePath,
                                onSelectRegion: selectionStore.setSelectedStructuredNodeSelection,
                                onSelectVertex: selectionStore.setSelectedFlaShapeVertex,
                                onMoveVertex: handleMoveFlaShapeVertex,
                                onEnter: enterFlaGraphicScope,
                                onTransformPreview: updateFlaGraphicChildTransform,
                                onCommitTransform: commitFlaGraphicChildTransform,
                                onError: setInteractionStatus,
                              }
                            : undefined;
                        return (
                          <StageLayerSpace key={render.id} space={stageLayer.evaluated.parentSpace} projection={displayCamera ? projection : undefined}>
                          <SelectableLayer
                            characterMotion={displayCamera || cameraTool || pickingParent ? undefined : motionCanvasForLayer(layer, characterView)}
                            characterView={characterView}
                            selectedCharacterNodeId={selectedLayerId === layer.id ? selectedCharacterNodeId : null}
                            directEditingEnabled={!armAssembly && !cameraTool && !pickingParent && directEditingEnabledForStageLayer(stageLayer)}
                            inheritedSpace={Boolean(stageLayer.evaluated.parentSpace)}
                            projected={cameraViewActive}
                            image={image}
                            images={currentReadyImages}
                            imagesByResourceKey={imageState.imagesByResourceKey}
                            layer={layer}
                            nodeRef={getLayerNodeRef(layer.id)}
                            flaGraphicEditProjection={editProjection}
                            onCommitPosition={(layerId, position) => {
                              if (!canCommitCanvasEdit(stageLayer)) {
                                throw new Error(
                                  rejectTemporalCanvasEdit(
                                    layer.source.kind === 'animation',
                                  ),
                                );
                              }
                              const current = editorProjectStore.getSnapshot();
                              const currentShot = current?.project.shots.find(
                                (candidate) => candidate.id === shot?.id,
                              );
                              const currentLayer = currentShot?.layers.find(
                                (candidate) => candidate.id === layerId,
                              );
                              if (
                                current &&
                                currentShot &&
                                currentLayer &&
                                isSupportedLayerMotionLayer(
                                  current.project,
                                  currentShot,
                                  currentLayer,
                                )
                              ) {
                                const liveUi = timelineUiStore.getSnapshot();
                                const currentEvaluated = evaluateShotAtTime(
                                  currentShot,
                                  liveUi.currentTimeMs,
                                  current.project,
                                ).layers.find((candidate) => candidate.id === layerId);
                                const rootPosition = currentEvaluated && (currentEvaluated.parentSpace || cameraViewActive)
                                  ? resolveCharacterActionRootPatch(currentEvaluated, position)
                                  : position;
                                const patch: { x?: number; y?: number } = {};
                                if (
                                  rootPosition.x !== undefined &&
                                  (!currentEvaluated || Math.abs(rootPosition.x - currentEvaluated.x) > 1e-6)
                                ) {
                                  patch.x = rootPosition.x;
                                }
                                if (
                                  rootPosition.y !== undefined &&
                                  (!currentEvaluated || Math.abs(rootPosition.y - currentEvaluated.y) > 1e-6)
                                ) {
                                  patch.y = rootPosition.y;
                                }
                                if (Object.keys(patch).length > 0) {
                                  layerStore.applyMotionTransform(
                                    layerId,
                                    liveUi.currentTimeMs,
                                    liveUi.layerMotionAutoKey,
                                    patch,
                                  );
                                }
                              } else {
                                layerStore.updatePosition(layerId, position);
                              }
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
                            onCommitAxisTransform={
                              isSupportedLayerMotionLayer(
                                snapshot?.project,
                                shot,
                                layer,
                              )
                                ? (layerId, transform) => {
                                    if (!canCommitCanvasEdit(stageLayer)) {
                                      throw new Error(
                                        rejectTemporalCanvasEdit(
                                          layer.source.kind === 'animation',
                                        ),
                                      );
                                    }
                                    const current = editorProjectStore.getSnapshot();
                                    const currentShot = current?.project.shots.find(
                                      (candidate) => candidate.id === shot?.id,
                                    );
                                    const currentLayer = currentShot?.layers.find(
                                      (candidate) => candidate.id === layerId,
                                    );
                                    if (
                                      !current ||
                                      !currentShot ||
                                      !currentLayer ||
                                      !isSupportedLayerMotionLayer(
                                        current.project,
                                        currentShot,
                                        currentLayer,
                                      )
                                    ) {
                                      throw new Error(
                                        rejectTemporalCanvasEdit(
                                          layer.source.kind === 'animation',
                                        ),
                                      );
                                    }
                                    const liveUi = timelineUiStore.getSnapshot();
                                    const currentEvaluated = evaluateShotAtTime(
                                      currentShot,
                                      liveUi.currentTimeMs,
                                      current.project,
                                    ).layers.find((candidate) => candidate.id === layerId);
                                    const root = currentEvaluated && cameraViewActive
                                      ? resolveCharacterActionRootPatch(currentEvaluated, transform)
                                      : transform;
                                    const patch: {
                                      x?: number;
                                      y?: number;
                                      scaleX?: number;
                                      scaleY?: number;
                                      rotationDeg?: number;
                                    } = {};
                                    if (
                                      root.x !== undefined &&
                                      (!currentEvaluated || Math.abs(root.x - currentEvaluated.x) > 1e-5)
                                    ) {
                                      patch.x = root.x;
                                    }
                                    if (
                                      root.y !== undefined &&
                                      (!currentEvaluated || Math.abs(root.y - currentEvaluated.y) > 1e-5)
                                    ) {
                                      patch.y = root.y;
                                    }
                                    if (
                                      root.scaleX !== undefined &&
                                      (!currentEvaluated || Math.abs(root.scaleX - currentEvaluated.scaleX) > 1e-5)
                                    ) {
                                      patch.scaleX = root.scaleX;
                                    }
                                    if (
                                      root.scaleY !== undefined &&
                                      (!currentEvaluated || Math.abs(root.scaleY - currentEvaluated.scaleY) > 1e-5)
                                    ) {
                                      patch.scaleY = root.scaleY;
                                    }
                                    if (
                                      !currentEvaluated ||
                                      Math.abs(
                                        transform.rotationDeg - currentEvaluated.rotationDeg,
                                      ) > 1e-5
                                    ) {
                                      patch.rotationDeg = transform.rotationDeg;
                                    }
                                    if (Object.keys(patch).length > 0) {
                                      layerStore.applyMotionTransform(
                                        layerId,
                                        liveUi.currentTimeMs,
                                        liveUi.layerMotionAutoKey,
                                        patch,
                                      );
                                    }
                                    setInteractionStatus(
                                      `图层变换已提交：缩放 ${transform.scaleX.toFixed(3)}×${transform.scaleY.toFixed(3)}，旋转 ${transform.rotationDeg.toFixed(1)}°。`,
                                    );
                                  }
                                : undefined
                            }
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
                            onSelect={(layerId, nodeId) => {
                              if (pickingParent) {
                                try {
                                  layerStore.setParent(pickingParent.childId, layerId, timelineUiStore.getSnapshot().currentTimeMs);
                                  setParentPick(null);
                                } catch (error) {
                                  setInteractionStatus(error instanceof Error ? error.message : '无法设置父级图层。');
                                }
                                return;
                              }
                              if (armAssembly?.target.layerId === layerId) {
                                pickArmPart(layerId, adaptivePartIdForNodeId(nodeId ?? null));
                                return;
                              }
                              if (flaGraphicEditScope && selectedFlaGraphicTarget?.layerId !== layerId) {
                                setFlaGraphicEditScope(null);
                                setSelectedFlaGraphicNodePath(null);
                              }
                              if (render.isBackground) {
                                selectionStore.selectExplicit(layerId);
                              } else {
                                selectionStore.select(layerId);
                              }
                              const target = nodeId ?? characterView?.nodes.find((node) => node.id === 'root')?.id;
                              if (target) selectionStore.selectCharacterNode(target);
                              if (nodeId) {
                                timelineUiStore.revealCharacterMotionPart();
                                onCharacterPartSelected?.();
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
                               !displayCamera && !cameraTool && !stageLayer.evaluated.parentSpace &&
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
                            effects={activeEffects?.layerId === layer.id ? activeEffects.effects : layer.visualEffects}
                            selected={selectedLayerId === layer.id}
                            visualSourceKeys={
                              temporalCanvasModel?.visualSourceKeysByLayer.get(
                                layer.id,
                              )
                            }
                            visual={visual}
                          />
                          </StageLayerSpace>
                        );
                      })
                    : null}
                  </Group>
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
                  {activeCurveMotion && !cameraTool && (!displayCamera || selectedLayerProjection) ? (
                    <StageLayerSpace projection={displayCamera ? selectedLayerProjection ?? undefined : undefined}>
                      <CurveMotionStageOverlay draft={activeCurveMotion} scale={transform.scale *
                        (displayCamera && selectedLayerProjection ? Math.abs(selectedLayerProjection.scaleX) : 1)} />
                    </StageLayerSpace>
                  ) : null}
                  {!activeScenePreview && !cameraTool && !pickingParent && transformerVisible && selectedStageLayer && selectedLayerProjection ? (
                    selectedStageLayer.evaluated.parentSpace && !structuredTransformerVisible ? (
                      <StageLayerSpace space={selectedStageLayer.evaluated.parentSpace} projection={displayCamera ? selectedLayerProjection : undefined}>
                        <ParentLayerTransformer
                          key={`${projectInstanceId}:${selectedStageLayer.layer.id}:${snapshot?.revision}:${timelineUi.currentTimeMs}`}
                          nodeRef={getLayerNodeRef(selectedStageLayer.layer.id)}
                          render={selectedStageLayer.render}
                          rootScale={selectedStageLayer.evaluated}
                          bounds={selectedStageLayer.visual.combinedLocalBounds}
                          onCommit={(patch) => {
                            if (!canCommitCanvasEdit(selectedStageLayer)) return;
                            try {
                              const live = timelineUiStore.getSnapshot();
                              layerStore.applyMotionTransform(
                                selectedStageLayer.layer.id,
                                live.currentTimeMs,
                                live.layerMotionAutoKey,
                                resolveCharacterActionRootPatch(selectedStageLayer.evaluated, patch),
                              );
                            } catch (error) {
                              setInteractionStatus(error instanceof Error ? error.message : '无法修改图层变换。');
                            }
                          }}
                        />
                      </StageLayerSpace>
                    ) : <LayerTransformer
                      locked={
                        selectedStageLayer.layer.locked ||
                        (structuredTransformerVisible && !selectedStructuredNodeCanTransform)
                      }
                      nodeBindingKey={structuredTransformerVisible
                        ? selectedFlaGraphicNodePathKey ?? ''
                        : selectedStageLayer.layer.id}
                      nodeRef={structuredTransformerVisible
                        ? flaGraphicEditSelectedNodeRef
                        : getLayerNodeRef(selectedStageLayer.layer.id)}
                      scale={structuredTransformerVisible
                        ? selectedStructuredNodeScales?.scaleX ?? selectedStageLayer.render.scaleX
                        : selectedStageLayer.render.scaleX}
                      scaleY={structuredTransformerVisible
                        ? selectedStructuredNodeScales?.scaleY
                        : Math.abs(selectedStageLayer.render.scaleY)}
                      selected
                    />
                  ) : null}
                </KonvaLayer>
                {cameraTool && snapshot && shot ? (
                  <KonvaLayer>
                    <ShotCameraFrame
                      key={`${projectInstanceId}:${shot.id}:${snapshot.revision}:${timelineUi.currentTimeMs}`}
                      pose={evaluateManualCamera(effectiveCameraShot ?? shot, effectiveCameraTimeMs)}
                      onCommit={(pose) => {
                        try {
                          commitCameraFrame(snapshot, shot.id, timelineUi.currentTimeMs, pose);
                        } catch {
                          setInteractionStatus('无法修改相机。请重试。');
                        }
                      }}
                    />
                  </KonvaLayer>
                ) : null}
              </Stage>
              {armAssembly && !waitingForArmVisual && !armVisualUnavailable ? <CharacterArmAssemblyOverlay assembly={armAssembly} scale={transform.scale}
                update={next => setAssembly?.(current => current === armAssembly ? next : current)} /> : null}
              {snapshot && shot && selectedLayerId && !armAssembly && !displayCamera && !cameraTool && !selectedStageLayer?.evaluated.parentSpace ? <CharacterArmHandle
                key={JSON.stringify([projectInstanceId, shot.id, selectedLayerId, timelineUi.currentTimeMs, snapshot.revision])}
                snapshot={snapshot}
                address={{ shotId: shot.id, layerId: selectedLayerId,
                  timeMs: resolveTimelineFrameTime(timelineUi.currentTimeMs, shot.durationMs) }}
              /> : null}
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
                className="canvas-stage-message canvas-stage-warning canvas-stage-pending"
                data-testid="canvas-background-warning"
                role="alert"
              >
                <strong>背景预览不可用</strong>
                <span>
                  请在素材库检查或替换背景素材。
                </span>
              </div>
            ) : null}
            {(hasRequiredVisualFailure || hasMouthVisualDegradation || hasExpressionOriginalFallback) ? (
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
                    : hasExpressionOriginalFallback
                      ? '表情素材不可用，已显示原脸。'
                    : hasMouthExpressionFallback
                      ? '张嘴表情不可用，已暂时显示当前表情'
                      : '张嘴表情不可用，正在准备当前表情'}
                </strong>
                {hasRequiredVisualFailure || !hasExpressionOriginalFallback ? <span>
                  {hasRequiredVisualFailure
                    ? hasRequiredCharacterFailure
                      ? '当前角色画面不可用，请检查素材后重试。'
                      : '当前画面素材不可用，请检查素材后重试。'
                    : hasMouthExpressionFallback
                      ? '素材恢复后会自动更新。'
                      : '当前表情准备完成后会自动更新。'}
                </span> : null}
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
