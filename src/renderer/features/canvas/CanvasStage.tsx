import {
  createRef,
  useCallback,
  useEffect,
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
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  calculateViewportTransform,
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
  type CanvasImageAssetSource,
  type CanvasImageState,
} from './canvasImageResources';
import {
  buildEditorTemporalCanvasModel,
} from './editorTemporalCanvasModel';
import type { EditorTemporalVisual } from './temporalVisualContinuity';

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
}

export function CanvasStage({
  showHeading = true,
  showToolbar = true,
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
  const [interactionStatus, setInteractionStatus] = useState(
    '从素材库拖入图片，或点击普通图层进行选择。',
  );
  const selectedLayerId = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSelectedLayerId,
  );
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
  const temporalContinuityRef = useRef<{
    contextKey: string | null;
    visuals: ReadonlyMap<string, EditorTemporalVisual>;
  }>({
    contextKey: null,
    visuals: new Map(),
  });
  const previousTemporalVisuals =
    temporalContinuityRef.current.contextKey === temporalContextKey
      ? temporalContinuityRef.current.visuals
      : new Map<string, EditorTemporalVisual>();
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
      timelineUi.currentTimeMs,
    ],
  );
  useEffect(() => {
    if (!temporalCanvasModel) {
      temporalContinuityRef.current = {
        contextKey: temporalContextKey,
        visuals: new Map(),
      };
      return;
    }
    temporalContinuityRef.current = {
      contextKey: temporalContextKey,
      visuals: temporalCanvasModel.lastValidVisuals,
    };
  }, [temporalCanvasModel, temporalContextKey]);
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
  const rejectTemporalCanvasEdit = (): void => {
    setInteractionStatus('时间轴预览中 · 回到 0:00 可调整图层');
  };
  const canCommitCanvasEdit = (): boolean =>
    timelineUiStore.getSnapshot().currentTimeMs === 0;
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
  const baseRequiredVisualFailure =
    stageModel?.layers.some((stageLayer) => {
      if (stageLayer.render.isBackground) return false;
      const activeMouthId =
        stageLayer.visual.activeFace?.source === 'mouth'
          ? stageLayer.visual.activeFace.assetId
          : null;
      return stageLayer.visual.resources.required.some(
        ({ assetId }) =>
          imageState.missing.has(assetId) && assetId !== activeMouthId,
      );
    }) ?? false;
  const hasRequiredVisualFailure =
    baseRequiredVisualFailure ||
    (nonBackgroundStatuses?.includes('required-failed') ?? false);
  const hasMouthVisualDegradation = nonBackgroundStatuses?.some(
    (status) =>
      status === 'mouth-expression-fallback' ||
      status === 'mouth-fallback-pending',
  ) ?? false;
  const hasMouthExpressionFallback = nonBackgroundStatuses?.some(
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
  const selectedStageLayer =
    stageModel?.layers.find(
      ({ layer }) => layer.id === selectedLayerId,
    ) ?? null;
  const transformerVisible = isTransformerOverlayVisible({
    selected: directEditingEnabled && Boolean(selectedStageLayer),
    isBackground: selectedStageLayer?.render.isBackground ?? false,
    locked: selectedStageLayer?.layer.locked ?? false,
    imageReady: selectedStageLayer
      ? isStageLayerVisualReady(selectedStageLayer)
      : false,
  });
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
        mode={viewport.mode}
        onAssetDrop={(payload, point) => {
          if (!canCommitCanvasEdit()) {
            rejectTemporalCanvasEdit();
            return;
          }
          try {
            const layer = layerStore.createFromAsset({
              ...payload,
              position: point,
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
                backgroundLayer?.render.opacity ?? ''
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
                            directEditingEnabled={directEditingEnabled}
                            image={image}
                            images={currentReadyImages}
                            imagesByResourceKey={imageState.imagesByResourceKey}
                            key={render.id}
                            layer={layer}
                            nodeRef={getLayerNodeRef(layer.id)}
                             onCommitPosition={(layerId, position) => {
                              if (!canCommitCanvasEdit()) {
                                rejectTemporalCanvasEdit();
                                return;
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
                              if (!canCommitCanvasEdit()) {
                                rejectTemporalCanvasEdit();
                                return;
                              }
                              layerStore.updateTransform(layerId, transform);
                              setInteractionStatus(
                                `图层变换已提交：缩放 ${transform.scale.toFixed(3)}，旋转 ${transform.rotationDeg.toFixed(1)}°。`,
                              );
                            }}
                             onError={setInteractionStatus}
                             onSelect={(layerId) => {
                              if (render.isBackground) {
                                selectionStore.selectExplicit(layerId);
                              } else {
                                selectionStore.select(layerId);
                              }
                              setInteractionStatus('已选择图层。');
                            }}
                             render={render}
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
                    ? 'Body / Face read failed'
                    : hasMouthExpressionFallback
                      ? 'Mouth unavailable; current Expression is shown'
                      : 'Mouth unavailable; current Expression is still preparing'}
                </strong>
                <span>
                  {hasRequiredVisualFailure
                    ? 'The complete Character visual is unavailable. A retained visual is not treated as ready.'
                    : hasMouthExpressionFallback
                      ? 'The Character keeps its Body and current Expression while the Mouth resource is unavailable.'
                      : 'The Mouth resource is unavailable and the current Expression is not ready yet.'}
                </span>
              </div>
            ) : null}
            {!missingBackground &&
            hasNonBackgroundVisualIssue &&
            !hasRequiredVisualFailure &&
            !hasMouthVisualDegradation ? (
              <div
                className="canvas-stage-message canvas-stage-warning"
                data-testid="canvas-visual-warning"
                data-visual-warning-kind={
                  hasRequiredVisualFailure
                    ? 'failed'
                    : hasMouthVisualDegradation
                      ? 'degraded'
                      : 'pending'
                }
              >
                <strong>画面仍在准备</strong>
                <span>
                  正在读取完整角色画面；准备完成前不会显示不完整的 Body 或 Face。
                </span>
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
