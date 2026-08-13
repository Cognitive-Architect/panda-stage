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
  Line,
  Rect,
  Stage,
} from 'react-konva';
import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  calculateViewportTransform,
  buildEditorStageRenderModel,
  listShotImageAssets,
  type Shot,
  type ViewportTransform,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import {
  canvasViewportStore,
} from '../../stores/canvasViewportStore';
import { layerStore } from '../../stores/layerStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasViewport } from './CanvasViewport';
import { EditorActionPreviewOverlay } from '../actions/EditorActionPreviewOverlay';
import { useEditorActionPreview } from '../actions/useEditorActionPreview';
import {
  isTransformerOverlayVisible,
  LayerTransformer,
} from './LayerTransformer';
import { SelectableLayer } from './SelectableLayer';
import type { CanvasDropPreview } from './useCanvasDrop';
import {
  configureKonvaScenePixelRatio,
  resolveEditorCanvasPixelRatio,
} from '../../stage/konva-pixel-ratio';
import {
  buildEditorImageResourceHandoff,
  type EditorImageResource,
} from './editorImageResourceHandoff';

// Keep the editor backing store sharp on Windows 125%/150% scaling without
// allowing an unbounded DPR to multiply canvas memory.
const editorDevicePixelRatio =
  typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
const editorCanvasPixelRatio = resolveEditorCanvasPixelRatio(
  editorDevicePixelRatio,
);

interface CanvasImageState {
  images: ReadonlyMap<string, HTMLImageElement>;
  sourceKeys: ReadonlyMap<string, string>;
  missing: ReadonlySet<string>;
}

interface CanvasImageContext {
  projectId: string | null;
  projectRoot: string | null;
  shotId: string | null;
}

export interface EditorLayerAuthority {
  draw(): unknown;
}

/**
 * Publish one committed editor content tree to Konva's scene and hit canvases.
 *
 * Konva Layer.draw() synchronously redraws both surfaces. Calling it at the
 * complete atomic image-handoff boundary prevents a newly mounted visible
 * layer from temporarily retaining an older underlying hit target.
 */
export function synchronizeEditorLayerAuthority(
  layer: EditorLayerAuthority,
): void {
  layer.draw();
}

function disposeCanvasImageResource(resource: EditorImageResource): void {
  if (resource.disposed) return;
  resource.disposed = true;
  resource.image.onload = null;
  resource.image.onerror = null;
  resource.image.src = '';
  URL.revokeObjectURL(resource.objectUrl);
}

function useCanvasImages(
  snapshot: EditorProjectSnapshot | null,
  shot: Shot | null,
): CanvasImageState {
  const assets = useMemo(
    () =>
      snapshot && shot
        ? listShotImageAssets(snapshot.project, shot.layers)
        : [],
    [shot, snapshot],
  );
  const sourceKey = assets
    .map((asset) => `${asset.id}:${asset.sha256 ?? 'missing'}`)
    .sort()
    .join('|');
  const resourceSpecs = useMemo(
    () =>
      assets.map((asset) => ({
        assetId: asset.id,
        sha256: asset.sha256,
      })),
    [sourceKey],
  );
  const projectId = snapshot?.project.id ?? null;
  const projectRoot = snapshot?.projectRoot ?? null;
  const shotId = shot?.id ?? null;
  const [state, setState] = useState<CanvasImageState>({
    images: new Map(),
    sourceKeys: new Map(),
    missing: new Set(),
  });
  const resourcesRef = useRef(new Map<string, EditorImageResource>());
  const resourceContextRef = useRef<CanvasImageContext | null>(null);
  const retiredResourcesRef = useRef<EditorImageResource[]>([]);

  useLayoutEffect(() => {
    const retired = retiredResourcesRef.current;
    retiredResourcesRef.current = [];
    for (const resource of retired) {
      disposeCanvasImageResource(resource);
    }
  });

  useLayoutEffect(() => {
    const previousContext = resourceContextRef.current;
    const nextContext: CanvasImageContext = {
      projectId,
      projectRoot,
      shotId,
    };
    const contextChanged =
      previousContext !== null &&
      (previousContext.projectId !== nextContext.projectId ||
        previousContext.projectRoot !== nextContext.projectRoot ||
        previousContext.shotId !== nextContext.shotId);

    if (contextChanged) {
      const previousResources = resourcesRef.current;
      resourcesRef.current = new Map();
      retiredResourcesRef.current.push(...previousResources.values());
      setState({
        images: new Map(),
        sourceKeys: new Map(),
        missing: new Set(
          resourceSpecs
            .filter((asset) => !asset.sha256 || !projectRoot)
            .map((asset) => asset.assetId),
        ),
      });
    }
    resourceContextRef.current = nextContext;
  }, [projectId, projectRoot, resourceSpecs, shotId, sourceKey]);

  useEffect(() => {
    let active = true;
    const pendingResources = new Map<string, EditorImageResource>();

    const cleanup = (): void => {
      active = false;
      for (const resource of pendingResources.values()) {
        disposeCanvasImageResource(resource);
      }
      pendingResources.clear();
    };
    if (!projectId || !projectRoot || !shotId || resourceSpecs.length === 0) {
      setState({
        images: new Map(),
        sourceKeys: new Map(),
        missing: new Set(
          resourceSpecs
            .filter((asset) => !asset.sha256 || !projectRoot)
            .map((asset) => asset.assetId),
        ),
      });
      return cleanup;
    }

    const loadAsset = async (
      asset: (typeof resourceSpecs)[number],
    ): Promise<EditorImageResource | null> => {
      if (!asset.sha256) return null;
      const currentResource = resourcesRef.current.get(asset.assetId);
      if (currentResource?.sourceKey === asset.sha256) {
        return currentResource;
      }
      try {
        const response = await window.pandaStage.assets.readCanvasImage({
          projectRoot,
          assetId: asset.assetId,
          sha256: asset.sha256,
        });
        if (
          !active ||
          !response.ok ||
          response.status !== 'ready'
        ) {
          return null;
        }
        const objectUrl = URL.createObjectURL(
          new Blob([response.bytes], { type: response.mimeType }),
        );
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return null;
        }
        const image = new window.Image();
        const resource: EditorImageResource = {
          image,
          objectUrl,
          sourceKey: asset.sha256,
          disposed: false,
        };
        pendingResources.set(asset.assetId, resource);
        return await new Promise<EditorImageResource | null>((resolve) => {
          image.onload = () => {
            if (!active) {
              pendingResources.delete(asset.assetId);
              disposeCanvasImageResource(resource);
              resolve(null);
              return;
            }
            resolve(resource);
          };
          image.onerror = () => {
            pendingResources.delete(asset.assetId);
            disposeCanvasImageResource(resource);
            resolve(null);
          };
          image.src = objectUrl;
        });
      } catch {
        return null;
      }
    };

    void Promise.all(
      resourceSpecs.map(async (asset) => [asset, await loadAsset(asset)] as const),
    ).then((entries) => {
      if (!active) return;

      const previousResources = resourcesRef.current;
      const loaded = new Map<string, EditorImageResource | null>();
      for (const [asset, resource] of entries) {
        loaded.set(asset.assetId, resource);
      }
      const handoff = buildEditorImageResourceHandoff(resourceSpecs, loaded);

      if (!handoff.ready) {
        for (const resource of pendingResources.values()) {
          disposeCanvasImageResource(resource);
        }
        pendingResources.clear();
        setState((current) => ({
          ...current,
          // A failed replacement must not turn a still-visible previous
          // resource into a transient missing-background warning.
          missing: new Set(
            [...handoff.missing].filter(
              (assetId) => !current.images.has(assetId),
            ),
          ),
        }));
        return;
      }

      resourcesRef.current = new Map(handoff.resources);
      resourceContextRef.current = { projectId, projectRoot, shotId };
      const nextResourceSet = new Set(handoff.resources.values());
      for (const resource of previousResources.values()) {
        if (!nextResourceSet.has(resource)) {
          retiredResourcesRef.current.push(resource);
        }
      }
      for (const resource of pendingResources.values()) {
        if (!nextResourceSet.has(resource)) {
          disposeCanvasImageResource(resource);
        }
      }
      pendingResources.clear();
      setState({
        images: handoff.images,
        sourceKeys: handoff.sourceKeys,
        missing: handoff.missing,
      });
    });

    return cleanup;
  }, [projectId, projectRoot, resourceSpecs, shotId, sourceKey]);

  useEffect(() => {
    return () => {
      for (const resource of resourcesRef.current.values()) {
        disposeCanvasImageResource(resource);
      }
      resourcesRef.current.clear();
      for (const resource of retiredResourcesRef.current) {
        disposeCanvasImageResource(resource);
      }
      retiredResourcesRef.current = [];
    };
  }, []);

  return state;
}

export function CanvasStage(): React.JSX.Element {
  const editorContentLayerRef = useRef<Konva.Layer | null>(null);
  const configureEditorLayer = useCallback((layer: Konva.Layer | null) => {
    if (layer) {
      configureKonvaScenePixelRatio(layer, editorCanvasPixelRatio);
    }
  }, []);
  const configureEditorContentLayer = useCallback(
    (layer: Konva.Layer | null) => {
      editorContentLayerRef.current = layer;
      configureEditorLayer(layer);
    },
    [configureEditorLayer],
  );
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
  const preview = useEditorActionPreview();
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
  const stageModel = useMemo(
    () =>
      snapshot && shot
        ? buildEditorStageRenderModel(snapshot.project, shot)
        : null,
    [shot, snapshot],
  );
  const imageState = useCanvasImages(snapshot, shot);
  const imageForAsset = (asset: {
    id: string;
    sha256?: string;
  }): HTMLImageElement | undefined => imageState.images.get(asset.id);
  const backgroundLayer =
    stageModel?.layers.find((layer) => layer.render.isBackground) ?? null;
  const backgroundAsset = backgroundLayer?.asset ?? null;
  const backgroundImage = backgroundAsset
    ? imageForAsset(backgroundAsset)
    : undefined;
  const empty = !stageModel || stageModel.layers.length === 0;
  const missingBackground =
    !empty &&
    (!backgroundLayer ||
      !backgroundAsset ||
      imageState.missing.has(backgroundAsset.id));
  const selectedStageLayer =
    stageModel?.layers.find(
      ({ layer }) => layer.id === selectedLayerId,
    ) ?? null;
  const transformerVisible = isTransformerOverlayVisible({
    selected: Boolean(selectedStageLayer),
    isBackground: selectedStageLayer?.render.isBackground ?? false,
    locked: selectedStageLayer?.layer.locked ?? false,
    imageReady: selectedStageLayer
      ? Boolean(imageForAsset(selectedStageLayer.asset))
      : false,
  });
  const backgroundSelected =
    Boolean(backgroundLayer && selectedLayerId === backgroundLayer.render.id);
  const backgroundListening =
    backgroundSelected && backgroundLayer?.layer.locked === false;
  const completeEditorScene = Boolean(
    stageModel &&
      stageModel.layers.every(({ asset }) => imageState.images.has(asset.id)),
  );

  useLayoutEffect(() => {
    const layer = editorContentLayerRef.current;
    if (!layer || !completeEditorScene) return;

    // React-Konva has committed the complete atomic image map and layer tree.
    // Publish both canvases synchronously before the browser can dispatch the
    // next real pointer event. This is scoped to the content layer; transformer
    // chrome keeps its independent normal React-Konva lifecycle.
    synchronizeEditorLayerAuthority(layer);
  }, [completeEditorScene, imageState.images, stageModel]);

  return (
    <section
      className="project-canvas"
      aria-labelledby="canvas-heading"
      style={{ position: 'relative' }}
    >
      <div className="project-canvas-heading">
        <div>
          <p className="eyebrow">画布</p>
          <h2 id="canvas-heading">镜头画布</h2>
        </div>
        <span>{shot ? shot.name : '未选择镜头'}</span>
      </div>
      <CanvasViewport
        dropDisabled={!snapshot || !shot}
        mode={viewport.mode}
        onAssetDrop={(payload, point) => {
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
        overlay={
          // Issue #168 (B): mounted inside the viewport box so the bounded
          // preview replaces exactly the canvas the user is looking at. As a
          // sibling of `.project-canvas` it used to stretch across the whole
          // panel (heading included) and render its own 16:9 box, which read as
          // a second, offset stage next to the editor canvas.
          preview.active ? (
            <EditorActionPreviewOverlay
              project={snapshot?.project ?? null}
              projectRoot={snapshot?.projectRoot ?? ''}
              selectedLayerId={selectedLayerId}
              shotId={currentShotId}
            />
          ) : null
        }
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
              data-center-guides="vertical,horizontal"
              data-interaction-status={interactionStatus}
              data-layer-json={JSON.stringify(shot?.layers ?? [])}
              data-project-revision={snapshot?.revision ?? -1}
              data-render-source="project-assets-original"
              data-rendered-asset-intrinsic-sizes={JSON.stringify(
                [...imageState.images.entries()].map(([assetId, image]) => ({
                  assetId,
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                })),
              )}
              data-rendered-asset-ids={JSON.stringify([
                ...imageState.images.keys(),
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
                <KonvaLayer listening ref={configureEditorContentLayer}>
                  <Rect
                    fill="#111914"
                    height={PROJECT_HEIGHT}
                    listening
                    onClick={() => selectionStore.clear()}
                    onTap={() => selectionStore.clear()}
                    width={PROJECT_WIDTH}
                  />
                  {stageModel
                    ? stageModel.layers.map(({ layer, asset, render }) => {
                        const image = imageForAsset(asset);
                        if (!image) return null;
                        return (
                          <SelectableLayer
                            image={image}
                            key={render.id}
                            layer={layer}
                            nodeRef={getLayerNodeRef(layer.id)}
                            onCommitPosition={(layerId, position) => {
                              layerStore.updatePosition(layerId, position);
                              setInteractionStatus(
                                `图层位置已提交为 (${position.x.toFixed(1)}, ${position.y.toFixed(1)})。`,
                              );
                            }}
                            onCommitTransform={(layerId, transform) => {
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
                            selected={selectedLayerId === layer.id}
                          />
                        );
                      })
                    : null}
                  <Line
                    listening={false}
                    points={[PROJECT_WIDTH / 2, 0, PROJECT_WIDTH / 2, PROJECT_HEIGHT]}
                    stroke="rgba(255, 225, 125, 0.55)"
                    strokeWidth={2}
                  />
                  <Line
                    listening={false}
                    points={[0, PROJECT_HEIGHT / 2, PROJECT_WIDTH, PROJECT_HEIGHT / 2]}
                    stroke="rgba(255, 225, 125, 0.55)"
                    strokeWidth={2}
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
                      scale={selectedStageLayer.layer.scaleX}
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
            {empty ? (
              <div
                className="canvas-stage-message"
                data-testid="canvas-empty-guidance"
              >
                <strong>当前镜头还没有图层</strong>
                <span>请从项目工具中添加背景或角色。</span>
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
            <span
              hidden
              data-transform-mode={transform.mode}
              data-testid="canvas-transform-contract"
            />
          </>
        )}
      </CanvasViewport>
      <CanvasToolbar
        mode={viewport.mode}
        onModeChange={(mode) => canvasViewportStore.setMode(mode)}
        point={viewport.lastStagePoint}
        transform={toolbarTransform}
      />
      <output
        className="canvas-interaction-status"
        data-testid="canvas-interaction-status"
      >
        {interactionStatus}
      </output>
    </section>
  );
}
