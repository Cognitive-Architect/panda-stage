import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import Konva from 'konva';
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
import { LayerPositionPanel } from '../properties/LayerPositionPanel';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasViewport } from './CanvasViewport';
import { SelectableLayer } from './SelectableLayer';
import type { CanvasDropPreview } from './useCanvasDrop';

Konva.pixelRatio = 1;

interface CanvasImageState {
  images: ReadonlyMap<string, HTMLImageElement>;
  missing: ReadonlySet<string>;
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
    .join('|');
  const [state, setState] = useState<CanvasImageState>({
    images: new Map(),
    missing: new Set(),
  });

  useEffect(() => {
    let active = true;
    setState({
      images: new Map(),
      missing: new Set(
        assets.filter((asset) => !asset.sha256).map((asset) => asset.id),
      ),
    });
    if (!snapshot) return () => {
      active = false;
    };

    for (const asset of assets) {
      if (!asset.sha256) continue;
      void window.pandaStage.assets
        .readThumbnail({
          projectRoot: snapshot.projectRoot,
          assetId: asset.id,
          sha256: asset.sha256,
        })
        .then(
          (response) =>
            new Promise<HTMLImageElement | null>((resolve) => {
              if (!response.ok || response.status !== 'ready') {
                resolve(null);
                return;
              }
              const image = new window.Image();
              image.onload = () => resolve(image);
              image.onerror = () => resolve(null);
              image.src = response.dataUrl;
            }),
        )
        .then((image) => {
          if (!active) return;
          setState((current) => {
            const images = new Map(current.images);
            const missing = new Set(current.missing);
            if (image) {
              images.set(asset.id, image);
              missing.delete(asset.id);
            } else {
              missing.add(asset.id);
            }
            return { images, missing };
          });
        })
        .catch(() => {
          if (!active) return;
          setState((current) => ({
            images: current.images,
            missing: new Set(current.missing).add(asset.id),
          }));
        });
    }
    return () => {
      active = false;
    };
  }, [assets, snapshot, sourceKey]);

  return state;
}

export function CanvasStage(): React.JSX.Element {
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
  const backgroundLayer =
    stageModel?.layers.find((layer) => layer.render.isBackground) ?? null;
  const backgroundAsset = backgroundLayer?.asset ?? null;
  const backgroundImage = backgroundAsset
    ? imageState.images.get(backgroundAsset.id)
    : undefined;
  const empty = !stageModel || stageModel.layers.length === 0;
  const missingBackground =
    !empty &&
    (!backgroundLayer ||
      !backgroundAsset ||
      imageState.missing.has(backgroundAsset.id));

  return (
    <section className="project-canvas" aria-labelledby="canvas-heading">
      <div className="project-canvas-heading">
        <div>
          <p className="eyebrow">Day 21 canvas</p>
          <h2 id="canvas-heading">Shot canvas</h2>
        </div>
        <span>{shot ? shot.name : 'No shot selected'}</span>
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
      >
        {(transform) => (
          <>
            <div
              data-background-listening="false"
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
              data-rendered-asset-ids={JSON.stringify([
                ...imageState.images.keys(),
              ])}
              data-render-contract="shared-stage-layer-v1"
              data-selected-layer-id={selectedLayerId ?? ''}
              data-stage-center="960,540"
              data-testid="project-canvas-stage"
            >
              <Stage
                height={PROJECT_HEIGHT}
                listening
                width={PROJECT_WIDTH}
              >
                <KonvaLayer listening>
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
                        const image = imageState.images.get(asset.id);
                        if (!image) return null;
                        return (
                          <SelectableLayer
                            image={image}
                            key={render.id}
                            layer={layer}
                            onCommitPosition={(layerId, position) => {
                              layerStore.updatePosition(layerId, position);
                              setInteractionStatus(
                                `图层位置已提交为 (${position.x.toFixed(1)}, ${position.y.toFixed(1)})。`,
                              );
                            }}
                            onError={setInteractionStatus}
                            onSelect={(layerId) => {
                              selectionStore.select(layerId);
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
                <strong>This shot has no layers yet</strong>
                <span>Add a background or character from the project tools.</span>
              </div>
            ) : null}
            {missingBackground ? (
              <div
                className="canvas-stage-message canvas-stage-warning"
                data-testid="canvas-background-warning"
              >
                <strong>Background preview unavailable</strong>
                <span>
                  Add a background layer or rebuild its thumbnail in the asset
                  library.
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
      <LayerPositionPanel />
    </section>
  );
}
