import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  calculateViewportTransform,
  type CharacterHead,
  type FacePlacement,
  type HeadPivot,
  type ImageAsset,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import {
  characterAssemblySessionStore,
  type CharacterAssemblySessionHandle,
  type CharacterCreationSessionHandle,
} from '../../stores/characterAssemblySessionStore';
import {
  CanvasImageResourceSession,
  EMPTY_CANVAS_IMAGE_STATE,
  type CanvasImageAssetSource,
  type CanvasImageState,
} from '../canvas/canvasImageResources';
import {
  thumbnailStateFromResponse,
  type ThumbnailState,
} from '../assets/AssetCard';
import { ImageAssetPicker } from './ImageAssetPicker';
import {
  buildCharacterAssemblyPreviewVisual,
  getAssemblyPreviewExpressions,
  isAssemblyHeadMotionTestRunning,
  isCharacterAssemblyPending,
  isCharacterCreationSnapshot,
  type AssemblyHeadMotionTestToken,
  type AssemblyFaceSelection,
  type CharacterAssemblySnapshotUnion,
} from './characterAssemblyPreview';

interface CharacterAssemblyWorkbenchProps {
  projectSnapshot: EditorProjectSnapshot;
  session: CharacterAssemblySnapshotUnion;
}

interface ActiveDragStart {
  startX: number;
  startY: number;
}

type ActiveDragDefinition =
  | { kind: 'face'; placement: FacePlacement }
  | { kind: 'pivot'; pivot: HeadPivot };

type ActiveDrag = ActiveDragStart &
  ActiveDragDefinition & { pointerId: number };

function headWithAsset(
  current: CharacterHead | undefined,
  assetId: string,
): CharacterHead {
  return current
    ? { ...current, assetId }
    : {
        assetId,
        placement: { offsetX: 0, offsetY: 0, scale: 1 },
        pivot: { x: 0, y: 0 },
      };
}

function thumbnailFailure(): ThumbnailState {
  return { status: 'missing', reason: 'error' };
}

function readThumbnailState(
  projectRoot: string,
  asset: ImageAsset,
): Promise<ThumbnailState> {
  if (!asset.sha256) return Promise.resolve({ status: 'missing', reason: 'source' });
  return window.pandaStage.assets
    .readThumbnail({ projectRoot, assetId: asset.id, sha256: asset.sha256 })
    .then(thumbnailStateFromResponse)
    .catch(thumbnailFailure);
}

function activeCreationHandle(
  session: CharacterAssemblySnapshotUnion,
): CharacterCreationSessionHandle | null {
  if (!isCharacterCreationSnapshot(session)) return null;
  const handle = characterAssemblySessionStore.getActiveCreationSessionHandle();
  return handle?.sessionId === session.sessionId &&
    handle.generation === session.generation
    ? handle
    : null;
}

function activeAssemblyHandle(
  session: CharacterAssemblySnapshotUnion,
): CharacterAssemblySessionHandle | null {
  if (isCharacterCreationSnapshot(session)) return null;
  const handle = characterAssemblySessionStore.getActiveAssemblySessionHandle();
  return handle &&
    handle.sessionId === session.sessionId &&
    handle.generation === session.generation
    ? handle
    : null;
}

export function CharacterAssemblyWorkbench({
  projectSnapshot,
  session,
}: CharacterAssemblyWorkbenchProps): React.JSX.Element {
  const { project, projectRoot } = projectSnapshot;
  const isCreating = isCharacterCreationSnapshot(session);
  const expressions = useMemo(
    () => getAssemblyPreviewExpressions(project, session),
    [project, session],
  );
  const defaultExpressionId = useMemo(() => {
    if (isCharacterCreationSnapshot(session)) {
      const index = session.draft.defaultExpressionIndex ?? 0;
      return expressions[index]?.id ?? expressions[0]?.id ?? '';
    }
    const character = project.characters.find(
      (candidate) => candidate.id === session.characterId,
    );
    return (
      expressions.find(
        (expression) => expression.id === character?.defaultExpressionId,
      )?.id ?? expressions[0]?.id ?? ''
    );
  }, [expressions, project.characters, session]);
  const [selectedFace, setSelectedFace] = useState('');
  const [message, setMessage] = useState('');
  const [headPickerOpen, setHeadPickerOpen] = useState(false);
  const [headMotionTestToken, setHeadMotionTestToken] =
    useState<AssemblyHeadMotionTestToken | null>(null);
  const isTestingHeadMotion = isAssemblyHeadMotionTestRunning(
    headMotionTestToken,
    session,
  );
  const [transform, setTransform] = useState(() =>
    calculateViewportTransform(
      { width: 0, height: 0 },
      'fit',
      { width: project.width, height: project.height },
    ),
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    setSelectedFace(defaultExpressionId);
    setMessage('');
  }, [defaultExpressionId, session.sessionId]);

  const activeExpression = expressions.find(
    (expression) => expression.id === selectedFace,
  );
  const hasMouth = isCharacterCreationSnapshot(session)
    ? Boolean(session.draft.mouthOpenAssetId)
    : Boolean(session.draft.mouthOpenAssetId);
  const faceSelection: AssemblyFaceSelection =
    selectedFace === '$mouth' && hasMouth
      ? { kind: 'mouth' }
      : {
          kind: 'expression',
        expressionId: activeExpression?.id ?? defaultExpressionId,
      };
  const previewFaceAssetId =
    faceSelection.kind === 'mouth'
      ? session.draft.mouthOpenAssetId ?? ''
      : activeExpression?.assetId ??
        expressions.find((expression) => expression.id === defaultExpressionId)
          ?.assetId ??
        '';
  useEffect(() => {
    if (selectedFace === '$mouth' && !hasMouth) {
      setSelectedFace(defaultExpressionId);
    }
  }, [defaultExpressionId, hasMouth, selectedFace]);
  const visual = useMemo(
    () => buildCharacterAssemblyPreviewVisual(project, session, faceSelection),
    [faceSelection, project, session],
  );
  const facePart = visual?.parts.find((part) => part.slot === 'face') ?? null;
  const bodyPart = visual?.parts.find((part) => part.slot === 'body') ?? null;
  const headPart = visual?.headPart ?? null;
  const faceRect = facePart?.localRect;
  const bodyRect = bodyPart?.localRect;
  const head = session.draft.head;
  const imageAssetCandidates = useMemo(
    () => project.assets.filter((asset): asset is ImageAsset => asset.kind === 'image'),
    [project.assets],
  );
  const imageAssets = useMemo(() => {
    const assetIds = new Set([
      session.draft.bodyAssetId,
      previewFaceAssetId,
      ...(head ? [head.assetId] : []),
    ]);
    return project.assets.flatMap((asset): CanvasImageAssetSource[] =>
      assetIds.has(asset.id) && asset.kind === 'image' && asset.sha256
        ? [{ id: asset.id, sha256: asset.sha256 }]
        : [],
    );
  }, [head, previewFaceAssetId, project.assets, session.draft.bodyAssetId]);
  const imageAssetKey = JSON.stringify(
    imageAssetCandidates.map(({ id, sha256 }) => [id, sha256]),
  );
  const imageSourceKey = JSON.stringify([
    project.id,
    projectRoot,
    imageAssets.map(({ id, sha256 }) => [id, sha256]),
  ]);
  const contextKey = `${project.id}\u0000${projectRoot}`;
  const [thumbnailEntries, setThumbnailEntries] = useState<
    Record<string, { resourceKey: string; state: ThumbnailState }>
  >({});
  const thumbnailReadsInFlight = useRef(new Set<string>());
  const visibleThumbnails = useMemo(
    () =>
      Object.fromEntries(
        imageAssetCandidates.map((asset) => {
          const resourceKey = `${contextKey}\u0000${asset.id}\u0000${asset.sha256 ?? ''}`;
          const entry = thumbnailEntries[asset.id];
          return [
            asset.id,
            entry?.resourceKey === resourceKey
              ? entry.state
              : { status: 'loading' as const },
          ];
        }),
      ),
    [contextKey, imageAssetCandidates, thumbnailEntries],
  );
  const imageSessionRef = useRef<CanvasImageResourceSession | null>(null);
  const [imageResult, setImageResult] = useState<{
    contextKey: string | null;
    state: CanvasImageState;
  }>({ contextKey: null, state: EMPTY_CANVAS_IMAGE_STATE });
  const imageState = imageResult.contextKey === contextKey
    ? imageResult.state
    : EMPTY_CANVAS_IMAGE_STATE;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!headPickerOpen) return undefined;
    for (const asset of imageAssetCandidates) {
      const resourceKey = `${contextKey}\u0000${asset.id}\u0000${asset.sha256 ?? ''}`;
      const existing = thumbnailEntries[asset.id];
      if (
        existing?.resourceKey === resourceKey &&
        existing.state.status !== 'loading'
      ) {
        continue;
      }
      if (thumbnailReadsInFlight.current.has(resourceKey)) continue;
      thumbnailReadsInFlight.current.add(resourceKey);
      setThumbnailEntries((current) => ({
        ...current,
        [asset.id]: { resourceKey, state: { status: 'loading' } },
      }));
      void readThumbnailState(projectRoot, asset)
        .then((state) => {
          if (!mountedRef.current) return;
          setThumbnailEntries((current) =>
            current[asset.id]?.resourceKey === resourceKey
              ? { ...current, [asset.id]: { resourceKey, state } }
              : current,
          );
        })
        .finally(() => thumbnailReadsInFlight.current.delete(resourceKey));
    }
    return undefined;
  }, [
    contextKey,
    headPickerOpen,
    imageAssetCandidates,
    imageAssetKey,
    projectRoot,
    thumbnailEntries,
  ]);

  useEffect(() => {
    const imageSession = new CanvasImageResourceSession();
    imageSessionRef.current = imageSession;
    return () => {
      imageSessionRef.current = null;
      imageSession.dispose();
    };
  }, []);

  useEffect(() => {
    imageSessionRef.current?.reconcile(
      {
        contextKey,
        projectRoot,
        assets: imageAssets,
      },
      (state) => setImageResult({ contextKey, state }),
    );
  }, [contextKey, imageSourceKey, imageAssets, projectRoot]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = (): void => {
      setTransform(
        calculateViewportTransform(
          { width: viewport.clientWidth, height: viewport.clientHeight },
          'fit',
          { width: project.width, height: project.height },
        ),
      );
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    update();
    return () => observer.disconnect();
  }, [project.height, project.width]);

  const updateFacePlacement = (placement: FacePlacement): void => {
    const result = isCreating
      ? activeCreationHandle(session)?.updateDraft({ facePlacement: placement })
      : activeAssemblyHandle(session)?.updateDraft({ facePlacement: placement });
    if (!result) {
      setMessage('装配草稿已失效，请重新打开角色装配。');
      return;
    }
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setMessage('');
  };

  const updateHead = (nextHead: CharacterHead | null): void => {
    const result = isCreating
      ? activeCreationHandle(session)?.updateDraft({ head: nextHead })
      : activeAssemblyHandle(session)?.updateDraft({ head: nextHead });
    if (!result) {
      setHeadMotionTestToken(null);
      setMessage('装配草稿已失效，请重新打开角色装配。');
      return;
    }
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setMessage('');
  };

  const chooseHeadAsset = (assetId: string | null): void => {
    updateHead(assetId ? headWithAsset(head, assetId) : null);
  };

  const adjustHeadScale = (delta: number): void => {
    if (!head) return;
    const scale = Number(
      Math.max(0.05, head.placement.scale + delta).toFixed(2),
    );
    updateHead({
      ...head,
      placement: { ...head.placement, scale },
    });
  };

  const nudgeHead = (dx: number, dy: number): void => {
    if (!head) return;
    updateHead({
      ...head,
      placement: {
        ...head.placement,
        offsetX: head.placement.offsetX + dx,
        offsetY: head.placement.offsetY + dy,
      },
    });
  };

  const nudgePivot = (dx: number, dy: number): void => {
    if (!head) return;
    updateHead({
      ...head,
      pivot: { x: head.pivot.x + dx, y: head.pivot.y + dy },
    });
  };

  const beginPointerDrag = (
    event: React.PointerEvent<HTMLElement>,
    definition: ActiveDragDefinition,
  ): void => {
    if (event.button !== 0 || isTestingHeadMotion) return;
    dragRef.current = {
      ...definition,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePointerDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || isTestingHeadMotion) return;
    const safeScale = Math.max(transform.scale, 0.0001);
    const dx = (event.clientX - drag.startX) / safeScale;
    const dy = (event.clientY - drag.startY) / safeScale;
    if (drag.kind === 'face') {
      updateFacePlacement({
        ...drag.placement,
        offsetX: drag.placement.offsetX + dx,
        offsetY: drag.placement.offsetY + dy,
      });
    } else {
      if (!head) return;
      updateHead({
        ...head,
        pivot: { x: drag.pivot.x + dx, y: drag.pivot.y + dy },
      });
    }
  };

  const endPointerDrag = (event: React.PointerEvent<HTMLElement>): void => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const stopPointerDrag = (): void => {
    dragRef.current = null;
  };

  const toggleHeadMotionTest = (): void => {
    if (!head) return;
    setHeadMotionTestToken(
      isTestingHeadMotion
        ? null
        : { sessionId: session.sessionId, generation: session.generation },
    );
  };

  const handleThumbnailError = (assetId: string): void => {
    const asset = imageAssetCandidates.find((candidate) => candidate.id === assetId);
    if (!asset) return;
    const resourceKey = `${contextKey}\u0000${asset.id}\u0000${asset.sha256 ?? ''}`;
    setThumbnailEntries((current) =>
      current[assetId]?.resourceKey === resourceKey
        ? { ...current, [assetId]: { resourceKey, state: thumbnailFailure() } }
        : current,
    );
  };

  const moveFace = (dx: number, dy: number): void => {
    updateFacePlacement({
      ...session.draft.facePlacement,
      offsetX: session.draft.facePlacement.offsetX + dx,
      offsetY: session.draft.facePlacement.offsetY + dy,
    });
  };

  const adjustScale = (delta: number): void => {
    const scale = Number(
      Math.max(0.05, session.draft.facePlacement.scale + delta).toFixed(2),
    );
    updateFacePlacement({ ...session.draft.facePlacement, scale });
  };

  const resetPlacement = (): void => {
    updateFacePlacement({ offsetX: 0, offsetY: 0, scale: 1 });
  };

  useEffect(() => {
    setHeadPickerOpen(false);
    setHeadMotionTestToken(null);
    dragRef.current = null;
  }, [session.generation, session.sessionId]);

  const pending = !isCreating && isCharacterAssemblyPending(project, session);
  const commit = (): void => {
    setHeadMotionTestToken(null);
    dragRef.current = null;
    const result = activeAssemblyHandle(session)?.commit();
    if (!result) {
      setMessage('装配草稿已失效，请重新打开角色装配。');
      return;
    }
    if (result.status === 'rejected' || result.status === 'stale') {
      setMessage(result.error.message);
      return;
    }
    if (result.status === 'no-op') {
      setMessage('');
      return;
    }
    setMessage('');
  };

  const revert = (): void => {
    if (isCreating) return;
    setHeadMotionTestToken(null);
    dragRef.current = null;
    const result = characterAssemblySessionStore.begin(session.characterId);
    if (!result.ok) setMessage(result.error.message);
    else setMessage('');
  };

  const left = project.width / 2;
  const top = project.height / 2;

  return (
    <section
      aria-label="角色装配工作区"
      className="character-assembly-workbench"
      data-body-asset-id={session.draft.bodyAssetId}
      data-face-offset-x={session.draft.facePlacement.offsetX}
      data-face-offset-y={session.draft.facePlacement.offsetY}
      data-face-scale={session.draft.facePlacement.scale}
      data-head-asset-id={head?.assetId ?? ''}
      data-head-offset-x={head?.placement.offsetX ?? ''}
      data-head-offset-y={head?.placement.offsetY ?? ''}
      data-head-scale={head?.placement.scale ?? ''}
      data-head-pivot-x={head?.pivot.x ?? ''}
      data-head-pivot-y={head?.pivot.y ?? ''}
      data-head-motion-test-running={isTestingHeadMotion}
      data-preview-face-asset-id={facePart?.assetId ?? ''}
      data-selected-face={selectedFace}
      data-session-kind={isCreating ? 'create' : 'edit'}
      data-testid="character-assembly-workbench"
    >
      <header className="character-assembly-workbench-header">
        <div className="character-assembly-header-tools">
          {!isCreating ? (
            <nav aria-label="预览表情" className="character-assembly-face-choices">
              {expressions.map((expression) => (
                <button
                  aria-pressed={selectedFace === expression.id}
                  key={expression.id}
                  onClick={() => setSelectedFace(expression.id)}
                  type="button"
                >
                  {expression.name}
                </button>
              ))}
              {hasMouth ? (
                <button
                  aria-pressed={selectedFace === '$mouth'}
                  onClick={() => setSelectedFace('$mouth')}
                  type="button"
                >
                  张嘴
                </button>
              ) : null}
            </nav>
          ) : (
            <nav aria-label="预览表情" className="character-assembly-face-choices">
              <button
                aria-pressed={selectedFace !== '$mouth'}
                onClick={() => setSelectedFace(defaultExpressionId)}
                type="button"
              >
                默认
              </button>
              {hasMouth ? (
                <button
                  aria-pressed={selectedFace === '$mouth'}
                  onClick={() => setSelectedFace('$mouth')}
                  type="button"
                >
                  张嘴
                </button>
              ) : null}
            </nav>
          )}
          <div className="character-assembly-head-picker" data-testid="character-assembly-head-picker">
            <ImageAssetPicker
              assets={imageAssetCandidates}
              emptyOption={{ label: '不添加头部', optional: true }}
              emptyActionLabel="选择"
              label="头部"
              onChange={chooseHeadAsset}
              onOpenChange={setHeadPickerOpen}
              onThumbnailError={handleThumbnailError}
              presentation="inline"
              searchAndPaginate
              selectedAssetId={head?.assetId ?? null}
              testId="character-assembly-head-asset"
              thumbnails={visibleThumbnails}
            />
          </div>
        </div>
      </header>

      <div
        aria-label="角色装配预览"
        className="character-assembly-preview-viewport"
        data-testid="character-assembly-preview"
        ref={viewportRef}
        role="group"
      >
        <div
          className="character-assembly-preview-stage"
          style={{
            height: project.height,
            left: transform.offsetX,
            top: transform.offsetY,
            transform: `scale(${transform.scale})`,
            width: project.width,
          }}
        >
          {bodyPart && imageState.images.get(bodyPart.assetId) ? (
            <img
              alt=""
              className="character-assembly-part character-assembly-part-body"
              data-asset-id={bodyPart.assetId}
              draggable={false}
              src={imageState.images.get(bodyPart.assetId)!.src}
              style={{
                height: bodyPart.localRect.height,
                left: left + bodyPart.localRect.x,
                top: top + bodyPart.localRect.y,
                width: bodyPart.localRect.width,
              }}
            />
          ) : null}
          <div
            aria-label={head ? '头部、脸部与张嘴图' : '脸部与张嘴图'}
            className={`character-assembly-head-group${isTestingHeadMotion ? ' is-head-motion-test-running' : ''}`}
            data-testid="character-assembly-head-group"
            style={{
              transformOrigin: head
                ? `${left + head.pivot.x}px ${top + head.pivot.y}px`
                : undefined,
            }}
          >
            {headPart && imageState.images.get(headPart.assetId) ? (
              <img
                alt=""
                className="character-assembly-part character-assembly-part-head"
                data-asset-id={headPart.assetId}
                draggable={false}
                src={imageState.images.get(headPart.assetId)!.src}
                style={{
                  height: headPart.localRect.height,
                  left: left + headPart.localRect.x,
                  top: top + headPart.localRect.y,
                  width: headPart.localRect.width,
                }}
              />
            ) : null}
            {facePart && imageState.images.get(facePart.assetId) ? (
              <img
                alt=""
                className="character-assembly-part character-assembly-part-face"
                data-asset-id={facePart.assetId}
                draggable={false}
                src={imageState.images.get(facePart.assetId)!.src}
                style={{
                  height: facePart.localRect.height,
                  left: left + facePart.localRect.x,
                  top: top + facePart.localRect.y,
                  width: facePart.localRect.width,
                }}
              />
            ) : null}
            {faceRect ? (
              <div
                aria-label="拖动脸部调整位置，使用方向键微调"
                aria-roledescription="可拖动脸部"
                aria-disabled={isTestingHeadMotion}
                className="character-assembly-face-hit-area"
                data-testid="character-assembly-face-drag-target"
                onKeyDown={(event) => {
                  if (isTestingHeadMotion) return;
                  const step = event.shiftKey ? 10 : 1;
                  if (event.key === 'ArrowLeft') moveFace(-step, 0);
                  else if (event.key === 'ArrowRight') moveFace(step, 0);
                  else if (event.key === 'ArrowUp') moveFace(0, -step);
                  else if (event.key === 'ArrowDown') moveFace(0, step);
                  else return;
                  event.preventDefault();
                }}
                onLostPointerCapture={stopPointerDrag}
                onPointerCancel={stopPointerDrag}
                onPointerDown={(event) =>
                  beginPointerDrag(event, {
                    kind: 'face',
                    placement: { ...session.draft.facePlacement },
                  })
                }
                onPointerMove={movePointerDrag}
                onPointerUp={endPointerDrag}
                role="group"
                style={{
                  height: faceRect.height,
                  left: left + faceRect.x,
                  pointerEvents: isTestingHeadMotion ? 'none' : undefined,
                  top: top + faceRect.y,
                  width: faceRect.width,
                }}
                tabIndex={isTestingHeadMotion ? -1 : 0}
              />
            ) : null}
            {head ? (
              <button
                aria-label="拖动头部旋转中心到颈部，使用方向键微调"
                aria-roledescription="可拖动旋转中心"
                className="character-assembly-pivot-handle"
                data-testid="character-assembly-head-pivot"
                disabled={isTestingHeadMotion}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 10 : 1;
                  if (event.key === 'ArrowLeft') nudgePivot(-step, 0);
                  else if (event.key === 'ArrowRight') nudgePivot(step, 0);
                  else if (event.key === 'ArrowUp') nudgePivot(0, -step);
                  else if (event.key === 'ArrowDown') nudgePivot(0, step);
                  else return;
                  event.preventDefault();
                }}
                onLostPointerCapture={stopPointerDrag}
                onPointerCancel={stopPointerDrag}
                onPointerDown={(event) =>
                  beginPointerDrag(event, {
                    kind: 'pivot',
                    pivot: { ...head.pivot },
                  })
                }
                onPointerMove={movePointerDrag}
                onPointerUp={endPointerDrag}
                style={{
                  left: left + head.pivot.x,
                  top: top + head.pivot.y,
                }}
                type="button"
              >
                <span aria-hidden="true" />
              </button>
            ) : null}
          </div>
          {!bodyRect || !faceRect ? (
            <span className="character-assembly-preview-empty">
              选择身体和默认表情
            </span>
          ) : null}
        </div>
      </div>

      <footer className="character-assembly-workbench-footer">
        <div
          aria-label="脸部位置与大小"
          className="character-assembly-placement-controls"
          data-testid="character-assembly-placement-controls"
          role="group"
        >
          <div aria-label="左右" className="character-assembly-control-set" role="group">
            <span className="character-assembly-control-label">左右</span>
            <button
              aria-label="向左移动脸部"
              data-testid="character-assembly-left-step"
              onClick={() => moveFace(-1, 0)}
              type="button"
            >
              −
            </button>
            <output
              aria-label="左右偏移"
              data-testid="character-assembly-offset-x"
            >
              {session.draft.facePlacement.offsetX.toFixed(1)}
            </output>
            <button
              aria-label="向右移动脸部"
              data-testid="character-assembly-right-step"
              onClick={() => moveFace(1, 0)}
              type="button"
            >
              +
            </button>
          </div>
          <div aria-label="上下" className="character-assembly-control-set" role="group">
            <span className="character-assembly-control-label">上下</span>
            <button
              aria-label="向上移动脸部"
              data-testid="character-assembly-up-step"
              onClick={() => moveFace(0, -1)}
              type="button"
            >
              −
            </button>
            <output
              aria-label="上下偏移"
              data-testid="character-assembly-offset-y"
            >
              {session.draft.facePlacement.offsetY.toFixed(1)}
            </output>
            <button
              aria-label="向下移动脸部"
              data-testid="character-assembly-down-step"
              onClick={() => moveFace(0, 1)}
              type="button"
            >
              +
            </button>
          </div>
          <div aria-label="大小" className="character-assembly-control-set" role="group">
            <span className="character-assembly-control-label">大小</span>
            <button
              aria-label="缩小脸部"
              data-testid="character-assembly-scale-down"
              onClick={() => adjustScale(-0.05)}
              type="button"
            >
              −
            </button>
            <output
              aria-label="脸部大小"
              data-testid="character-assembly-scale"
            >
              {session.draft.facePlacement.scale.toFixed(2)}×
            </output>
            <button
              aria-label="放大脸部"
              data-testid="character-assembly-scale-up"
              onClick={() => adjustScale(0.05)}
              type="button"
            >
              +
            </button>
          </div>
          <div
            aria-label="头部调节"
            className="character-assembly-head-controls"
            data-testid="character-assembly-head-controls"
            role="group"
          >
            <div aria-label="头部左右位置" className="character-assembly-control-set" role="group">
              <span className="character-assembly-control-label">头部左右</span>
              <button
                aria-label="向左移动头部"
                data-testid="character-assembly-head-left-step"
                disabled={!head || isTestingHeadMotion}
                onClick={() => nudgeHead(-1, 0)}
                type="button"
              >
                −
              </button>
              <output aria-label="头部水平位置" data-testid="character-assembly-head-offset-x">
                {head ? head.placement.offsetX.toFixed(1) : '—'}
              </output>
              <button
                aria-label="向右移动头部"
                data-testid="character-assembly-head-right-step"
                disabled={!head || isTestingHeadMotion}
                onClick={() => nudgeHead(1, 0)}
                type="button"
              >
                +
              </button>
            </div>
            <div aria-label="头部上下位置" className="character-assembly-control-set" role="group">
              <span className="character-assembly-control-label">头部上下</span>
              <button
                aria-label="向上移动头部"
                data-testid="character-assembly-head-up-step"
                disabled={!head || isTestingHeadMotion}
                onClick={() => nudgeHead(0, -1)}
                type="button"
              >
                −
              </button>
              <output aria-label="头部垂直位置" data-testid="character-assembly-head-offset-y">
                {head ? head.placement.offsetY.toFixed(1) : '—'}
              </output>
              <button
                aria-label="向下移动头部"
                data-testid="character-assembly-head-down-step"
                disabled={!head || isTestingHeadMotion}
                onClick={() => nudgeHead(0, 1)}
                type="button"
              >
                +
              </button>
            </div>
            <div aria-label="头部大小" className="character-assembly-control-set" role="group">
              <span className="character-assembly-control-label">头部大小</span>
              <button
                aria-label="缩小头部"
                data-testid="character-assembly-head-scale-down"
                disabled={!head || isTestingHeadMotion}
                onClick={() => adjustHeadScale(-0.05)}
                type="button"
              >
                −
              </button>
              <output aria-label="头部大小" data-testid="character-assembly-head-scale">
                {head ? `${head.placement.scale.toFixed(2)}×` : '—'}
              </output>
              <button
                aria-label="放大头部"
                data-testid="character-assembly-head-scale-up"
                disabled={!head || isTestingHeadMotion}
                onClick={() => adjustHeadScale(0.05)}
                type="button"
              >
                +
              </button>
            </div>
            <button
              aria-pressed={isTestingHeadMotion}
              data-testid="character-assembly-test-head-motion"
              disabled={!head}
              onClick={toggleHeadMotionTest}
              type="button"
            >
              {isTestingHeadMotion ? '停止摇头' : '测试摇头'}
            </button>
          </div>
          <button
            className="character-assembly-reset"
            data-testid="character-assembly-reset"
            disabled={isTestingHeadMotion}
            onClick={resetPlacement}
            type="button"
          >
            重置
          </button>
          {!isCreating && pending ? (
            <div
              aria-label="待应用操作"
              className="character-assembly-pending-actions"
              data-testid="character-assembly-pending"
              role="group"
            >
              <button onClick={revert} type="button">还原</button>
              <button onClick={commit} type="button">应用</button>
            </div>
          ) : null}
        </div>
        {message ? (
          <output className="character-assembly-message" role="status">
            {message}
          </output>
        ) : null}
      </footer>
    </section>
  );
}
