import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';
import Konva from 'konva';
import {
  Image as KonvaImage,
  Layer as KonvaLayer,
  Line,
  Rect,
  Stage,
} from 'react-konva';
import {
  PROJECT_HEIGHT,
  PROJECT_WIDTH,
  calculateCoverTransform,
  calculateViewportTransform,
  isShotBackgroundLayer,
  listShotImageAssets,
  resolveLayerImageAsset,
  type Shot,
  type ViewportTransform,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import {
  canvasViewportStore,
} from '../../stores/canvasViewportStore';
import { shotStore } from '../../stores/shotStore';
import { CanvasToolbar } from './CanvasToolbar';
import { CanvasViewport } from './CanvasViewport';

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
  const shot =
    snapshot?.project.shots.find(
      (candidate) => candidate.id === currentShotId,
    ) ?? null;
  const imageState = useCanvasImages(snapshot, shot);
  const backgroundLayer =
    shot?.layers.find(isShotBackgroundLayer) ?? null;
  const backgroundAsset =
    snapshot && backgroundLayer
      ? resolveLayerImageAsset(snapshot.project, backgroundLayer)
      : null;
  const backgroundImage = backgroundAsset
    ? imageState.images.get(backgroundAsset.id)
    : undefined;
  const backgroundCover = backgroundAsset
    ? calculateCoverTransform(backgroundAsset, {
        width: PROJECT_WIDTH,
        height: PROJECT_HEIGHT,
      })
    : null;
  const empty = !shot || shot.layers.length === 0;
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
        mode={viewport.mode}
        onStagePoint={(point) =>
          canvasViewportStore.recordStagePoint(point)
        }
        onTransform={setToolbarTransform}
      >
        {(transform) => (
          <>
            <div
              data-background-listening="false"
              data-background-policy="cover-centered-no-stretch"
              data-background-ready={String(Boolean(backgroundImage))}
              data-background-scale-x={backgroundCover?.scale ?? ''}
              data-background-scale-y={backgroundCover?.scale ?? ''}
              data-center-guides="vertical,horizontal"
              data-layer-json={JSON.stringify(shot?.layers ?? [])}
              data-stage-center="960,540"
              data-testid="project-canvas-stage"
            >
              <Stage
                height={PROJECT_HEIGHT}
                listening={false}
                width={PROJECT_WIDTH}
              >
                <KonvaLayer listening={false}>
                  <Rect
                    fill="#111914"
                    height={PROJECT_HEIGHT}
                    listening={false}
                    width={PROJECT_WIDTH}
                  />
                  {backgroundCover && backgroundImage
                    ? (
                        <KonvaImage
                          height={backgroundCover.height}
                          image={backgroundImage}
                          listening={false}
                          width={backgroundCover.width}
                          x={backgroundCover.x}
                          y={backgroundCover.y}
                        />
                      )
                    : null}
                  {snapshot
                    ? shot?.layers
                        .filter(
                          (layer) =>
                            layer.visible &&
                            layer !== backgroundLayer,
                        )
                        .sort((left, right) => left.zIndex - right.zIndex)
                        .map((layer) => {
                          const asset = resolveLayerImageAsset(
                            snapshot.project,
                            layer,
                          );
                          const image = asset
                            ? imageState.images.get(asset.id)
                            : undefined;
                          if (!asset || !image) return null;
                          return (
                            <KonvaImage
                              height={asset.height}
                              image={image}
                              key={layer.id}
                              listening={false}
                              offsetX={asset.width / 2}
                              offsetY={asset.height / 2}
                              opacity={layer.opacity}
                              rotation={layer.rotationDeg}
                              scaleX={layer.scaleX}
                              scaleY={layer.scaleY}
                              width={asset.width}
                              x={layer.x}
                              y={layer.y}
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
    </section>
  );
}
