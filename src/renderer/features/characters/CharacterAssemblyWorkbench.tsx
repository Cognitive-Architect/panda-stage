import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  calculateViewportTransform,
  type CharacterHead,
  type FacePlacement,
  type HeadPivot,
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
  buildCharacterAssemblyPreviewVisual,
  characterLocalPointerDelta,
  findVisibleImageBounds,
  getAssemblyPreviewExpressions,
  headScaleFromPointerDistance,
  isAssemblyHeadMotionTestRunning,
  isCharacterAssemblyPending,
  isCharacterCreationSnapshot,
  type AssemblyHeadMotionTestToken,
  type AssemblyFaceSelection,
  type CharacterAssemblySnapshotUnion,
  type NormalizedImageBounds,
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
  | { kind: 'head'; head: CharacterHead }
  | {
      kind: 'head-scale';
      head: CharacterHead;
      centerX: number;
      centerY: number;
      startDistance: number;
    }
  | { kind: 'pivot'; pivot: HeadPivot };

type ActiveDrag = ActiveDragStart &
  ActiveDragDefinition & { pointerId: number };

function measureImageVisibleBounds(
  image: HTMLImageElement | null,
): NormalizedImageBounds | null {
  if (
    !image ||
    !image.complete ||
    image.naturalWidth < 1 ||
    image.naturalHeight < 1 ||
    typeof document === 'undefined'
  ) {
    return null;
  }

  const maxEdge = 256;
  const sampleScale = Math.min(
    1,
    maxEdge / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const sampleWidth = Math.max(1, Math.round(image.naturalWidth * sampleScale));
  const sampleHeight = Math.max(1, Math.round(image.naturalHeight * sampleScale));
  const canvas = document.createElement('canvas');
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  try {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight);
    return findVisibleImageBounds(pixels.data, sampleWidth, sampleHeight);
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
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
  const head = session.draft.head;
  const headAssetId = head?.assetId;
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
  const [editTarget, setEditTarget] = useState<'head' | 'face'>(
    head ? 'head' : 'face',
  );
  const [isEditingNeckPivot, setIsEditingNeckPivot] = useState(false);
  const [isFineTuneOpen, setIsFineTuneOpen] = useState(false);
  const [headMotionTestToken, setHeadMotionTestToken] =
    useState<AssemblyHeadMotionTestToken | null>(null);
  const activeEditTarget = head ? editTarget : 'face';
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
  const imageSourceKey = JSON.stringify([
    project.id,
    projectRoot,
    imageAssets.map(({ id, sha256 }) => [id, sha256]),
  ]);
  const contextKey = `${project.id}\u0000${projectRoot}`;
  const imageSessionRef = useRef<CanvasImageResourceSession | null>(null);
  const [imageResult, setImageResult] = useState<{
    contextKey: string | null;
    state: CanvasImageState;
  }>({ contextKey: null, state: EMPTY_CANVAS_IMAGE_STATE });
  const imageState = imageResult.contextKey === contextKey
    ? imageResult.state
    : EMPTY_CANVAS_IMAGE_STATE;
  const headImage = head ? imageState.images.get(head.assetId) ?? null : null;
  const headImageBounds = useMemo(
    () => measureImageVisibleBounds(headImage),
    [headImage],
  );
  const headContentRect = useMemo(() => {
    if (!headPart || !headImageBounds) return null;
    return {
      x: headPart.localRect.x + headPart.localRect.width * headImageBounds.x,
      y: headPart.localRect.y + headPart.localRect.height * headImageBounds.y,
      width: headPart.localRect.width * headImageBounds.width,
      height: headPart.localRect.height * headImageBounds.height,
    };
  }, [headImageBounds, headPart]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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
      setMessage('组装草稿已失效，请重新打开角色组装。');
      return;
    }
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setMessage('');
  };

  const updateHead = (nextHead: CharacterHead | null): boolean => {
    const result = isCreating
      ? activeCreationHandle(session)?.updateDraft({ head: nextHead })
      : activeAssemblyHandle(session)?.updateDraft({ head: nextHead });
    if (!result) {
      setHeadMotionTestToken(null);
      setMessage('组装草稿已失效，请重新打开角色组装。');
      dragRef.current = null;
      return false;
    }
    if (!result.ok) {
      setMessage(result.error.message);
      return false;
    }
    setMessage('');
    if (!nextHead) {
      setHeadMotionTestToken(null);
      setIsEditingNeckPivot(false);
      setEditTarget('face');
      dragRef.current = null;
    }
    return true;
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

  const selectEditTarget = (target: 'head' | 'face'): void => {
    if (target === 'head' && !head) return;
    dragRef.current = null;
    setEditTarget(target);
    setIsEditingNeckPivot(false);
  };

  const toggleNeckPivotEditing = (): void => {
    if (!head || isTestingHeadMotion) return;
    dragRef.current = null;
    setIsEditingNeckPivot((current) => {
      const next = !current;
      if (next) setIsFineTuneOpen(false);
      return next;
    });
  };

  const beginPointerDrag = (
    event: React.PointerEvent<HTMLElement>,
    definition: ActiveDragDefinition,
  ): void => {
    if (event.button !== 0 || isTestingHeadMotion) return;
    if (definition.kind === 'face' && (activeEditTarget !== 'face' || isEditingNeckPivot)) {
      return;
    }
    if (
      (definition.kind === 'head' || definition.kind === 'head-scale') &&
      (activeEditTarget !== 'head' || isEditingNeckPivot)
    ) {
      return;
    }
    if (definition.kind === 'pivot' && !isEditingNeckPivot) return;
    dragRef.current = {
      ...definition,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginHeadScaleDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const viewportElement = viewportRef.current;
    if (
      !head ||
      !headPart ||
      !viewportElement ||
      event.button !== 0 ||
      isTestingHeadMotion ||
      isEditingNeckPivot ||
      activeEditTarget !== 'head'
    ) {
      return;
    }
    const viewport = viewportElement.getBoundingClientRect();
    const safeScale = Math.max(transform.scale, 0.0001);
    const centerX =
      viewport.left + viewportElement.clientLeft + transform.offsetX +
      (project.width / 2 + head.placement.offsetX) * safeScale;
    const centerY =
      viewport.top + viewportElement.clientTop + transform.offsetY +
      (project.height / 2 + head.placement.offsetY) * safeScale;
    dragRef.current = {
      kind: 'head-scale',
      head: { ...head, placement: { ...head.placement }, pivot: { ...head.pivot } },
      centerX,
      centerY,
      startDistance: Math.max(
        1,
        Math.hypot(event.clientX - centerX, event.clientY - centerY),
      ),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePointerDrag = (event: React.PointerEvent<HTMLElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || isTestingHeadMotion) return;
    const { x: dx, y: dy } = characterLocalPointerDelta(
      drag.startX,
      drag.startY,
      event.clientX,
      event.clientY,
      transform.scale,
    );
    if (drag.kind === 'face') {
      updateFacePlacement({
        ...drag.placement,
        offsetX: drag.placement.offsetX + dx,
        offsetY: drag.placement.offsetY + dy,
      });
    } else if (drag.kind === 'head') {
      updateHead({
        ...drag.head,
        placement: {
          ...drag.head.placement,
          offsetX: drag.head.placement.offsetX + dx,
          offsetY: drag.head.placement.offsetY + dy,
        },
      });
    } else if (drag.kind === 'head-scale') {
      const currentDistance = Math.hypot(
        event.clientX - drag.centerX,
        event.clientY - drag.centerY,
      );
      updateHead({
        ...drag.head,
        placement: {
          ...drag.head.placement,
          scale: headScaleFromPointerDistance(
            drag.head.placement.scale,
            drag.startDistance,
            currentDistance,
          ),
        },
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
    dragRef.current = null;
    setIsFineTuneOpen(false);
    setHeadMotionTestToken(
      isTestingHeadMotion
        ? null
        : { sessionId: session.sessionId, generation: session.generation },
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
    if (activeEditTarget === 'head' && head) {
      updateHead({
        ...head,
        placement: { offsetX: 0, offsetY: 0, scale: 1 },
      });
      return;
    }
    updateFacePlacement({ offsetX: 0, offsetY: 0, scale: 1 });
  };

  useEffect(() => {
    setHeadMotionTestToken(null);
    dragRef.current = null;
    setEditTarget(session.draft.head ? 'head' : 'face');
    setIsEditingNeckPivot(false);
    setIsFineTuneOpen(false);
  }, [session.generation, session.sessionId]);

  useEffect(() => {
    if (headAssetId) {
      setEditTarget('head');
      setIsEditingNeckPivot(false);
      return;
    }
    setHeadMotionTestToken(null);
    setEditTarget('face');
    setIsEditingNeckPivot(false);
    dragRef.current = null;
  }, [headAssetId]);

  const pending = !isCreating && isCharacterAssemblyPending(project, session);
  const commit = (): void => {
    setHeadMotionTestToken(null);
    dragRef.current = null;
    const result = activeAssemblyHandle(session)?.commit();
    if (!result) {
      setMessage('组装草稿已失效，请重新打开角色组装。');
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
  const headHandleRect = headContentRect ?? headPart?.localRect ?? null;

  return (
    <section
      aria-label="角色组装工作区"
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
      data-edit-target={activeEditTarget}
      data-neck-pivot-editing={isEditingNeckPivot}
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
          {head ? (
            <nav aria-label="编辑目标" className="character-assembly-edit-targets">
              <button
                aria-pressed={activeEditTarget === 'head'}
                data-testid="character-assembly-edit-head"
                disabled={isEditingNeckPivot || isTestingHeadMotion}
                onClick={() => selectEditTarget('head')}
                type="button"
              >
                头部
              </button>
              <button
                aria-pressed={activeEditTarget === 'face'}
                data-testid="character-assembly-edit-face"
                disabled={isEditingNeckPivot || isTestingHeadMotion}
                onClick={() => selectEditTarget('face')}
                type="button"
              >
                脸部
              </button>
            </nav>
          ) : null}
          {head && isEditingNeckPivot ? (
            <div
              className="character-assembly-pivot-guidance"
              data-testid="character-assembly-pivot-guidance"
              role="status"
            >
              <span>把十字拖到角色脖子附近</span>
              <button
                data-testid="character-assembly-pivot-done"
                onClick={() => {
                  dragRef.current = null;
                  setIsEditingNeckPivot(false);
                }}
                type="button"
              >
                完成转轴
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <div
        aria-label="角色组装预览"
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
            {activeEditTarget === 'face' && !isEditingNeckPivot && faceRect ? (
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
            {head && activeEditTarget === 'head' && !isEditingNeckPivot ? (
              <>
                {headContentRect ? (
                  <div
                    aria-label="拖动头部调整位置，使用方向键微调"
                    aria-roledescription="可拖动头部"
                    aria-disabled={isTestingHeadMotion}
                    className="character-assembly-head-hit-area"
                    data-testid="character-assembly-head-drag-target"
                    onKeyDown={(event) => {
                      if (isTestingHeadMotion) return;
                      const step = event.shiftKey ? 10 : 1;
                      if (event.key === 'ArrowLeft') nudgeHead(-step, 0);
                      else if (event.key === 'ArrowRight') nudgeHead(step, 0);
                      else if (event.key === 'ArrowUp') nudgeHead(0, -step);
                      else if (event.key === 'ArrowDown') nudgeHead(0, step);
                      else return;
                      event.preventDefault();
                    }}
                    onLostPointerCapture={stopPointerDrag}
                    onPointerCancel={stopPointerDrag}
                    onPointerDown={(event) =>
                      beginPointerDrag(event, {
                        kind: 'head',
                        head: { ...head, placement: { ...head.placement }, pivot: { ...head.pivot } },
                      })
                    }
                    onPointerMove={movePointerDrag}
                    onPointerUp={endPointerDrag}
                    role="group"
                    style={{
                      height: headContentRect.height,
                      left: left + headContentRect.x,
                      pointerEvents: isTestingHeadMotion ? 'none' : undefined,
                      top: top + headContentRect.y,
                      width: headContentRect.width,
                    }}
                    tabIndex={isTestingHeadMotion ? -1 : 0}
                  />
                ) : headPart ? (
                  <button
                    aria-label="拖动头部调整位置，使用方向键微调"
                    className="character-assembly-head-drag-fallback"
                    data-testid="character-assembly-head-drag-fallback"
                    disabled={isTestingHeadMotion}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 10 : 1;
                      if (event.key === 'ArrowLeft') nudgeHead(-step, 0);
                      else if (event.key === 'ArrowRight') nudgeHead(step, 0);
                      else if (event.key === 'ArrowUp') nudgeHead(0, -step);
                      else if (event.key === 'ArrowDown') nudgeHead(0, step);
                      else return;
                      event.preventDefault();
                    }}
                    onLostPointerCapture={stopPointerDrag}
                    onPointerCancel={stopPointerDrag}
                    onPointerDown={(event) =>
                      beginPointerDrag(event, {
                        kind: 'head',
                        head: { ...head, placement: { ...head.placement }, pivot: { ...head.pivot } },
                      })
                    }
                    onPointerMove={movePointerDrag}
                    onPointerUp={endPointerDrag}
                    style={{
                      left: left + headPart.localRect.x + headPart.localRect.width / 2,
                      top: top + headPart.localRect.y + headPart.localRect.height / 2,
                      transform: `translate(-50%, -50%) scale(${1 / Math.max(transform.scale, 0.0001)})`,
                    }}
                    type="button"
                  >
                    <span aria-hidden="true" />
                  </button>
                ) : null}
                {headHandleRect ? (
                  <button
                    aria-label="调整头部大小，拖动或用方向键微调"
                    className="character-assembly-head-scale-handle"
                    data-testid="character-assembly-head-scale-handle"
                    disabled={isTestingHeadMotion}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === '+') {
                        adjustHeadScale(0.05);
                      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === '-') {
                        adjustHeadScale(-0.05);
                      } else return;
                      event.preventDefault();
                    }}
                    onLostPointerCapture={stopPointerDrag}
                    onPointerCancel={stopPointerDrag}
                    onPointerDown={beginHeadScaleDrag}
                    onPointerMove={movePointerDrag}
                    onPointerUp={endPointerDrag}
                    style={{
                      left: left + headHandleRect.x + headHandleRect.width,
                      top: top + headHandleRect.y + headHandleRect.height,
                      transform: `translate(-50%, -50%) scale(${1 / Math.max(transform.scale, 0.0001)})`,
                    }}
                    type="button"
                  >
                    <span aria-hidden="true" />
                  </button>
                ) : null}
              </>
            ) : null}
            {head && !isEditingNeckPivot ? (
              <span
                aria-hidden="true"
                className="character-assembly-pivot-marker"
                data-testid="character-assembly-head-pivot-marker"
                style={{
                  left: left + head.pivot.x,
                  top: top + head.pivot.y,
                }}
              />
            ) : null}
            {head && isEditingNeckPivot ? (
              <button
                aria-label="拖动脖子转轴到角色脖子附近，使用方向键微调"
                aria-roledescription="可拖动脖子转轴"
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
                  transform: `translate(-50%, -50%) scale(${1 / Math.max(transform.scale, 0.0001)})`,
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
          className="character-assembly-placement-controls"
          data-testid="character-assembly-placement-controls"
        >
          <div className="character-assembly-assembly-actions">
            {head ? (
              <button
                aria-pressed={isEditingNeckPivot}
                className="character-assembly-pivot-mode-toggle"
                data-testid="character-assembly-pivot-mode-toggle"
                disabled={isTestingHeadMotion}
                onClick={toggleNeckPivotEditing}
                type="button"
              >
                {isEditingNeckPivot ? '完成转轴' : '调整脖子转轴'}
              </button>
            ) : null}
            <button
              aria-expanded={isFineTuneOpen}
              className="character-assembly-fine-tune-toggle"
              data-testid="character-assembly-fine-tune-toggle"
              disabled={isEditingNeckPivot || isTestingHeadMotion}
              onClick={() => setIsFineTuneOpen((open) => !open)}
              type="button"
            >
              精调
            </button>
            {head ? (
              <>
                <button
                  aria-pressed={isTestingHeadMotion}
                  data-testid="character-assembly-test-head-motion"
                  onClick={toggleHeadMotionTest}
                  type="button"
                >
                  {isTestingHeadMotion ? '■ 停止测试' : '▶ 测试摇头'}
                </button>
                {isTestingHeadMotion ? (
                  <span
                    className="character-assembly-motion-test-cue"
                    data-testid="character-assembly-motion-test-cue"
                    role="status"
                  >
                    观察头和脸是否贴合，转轴是否像从脖子处转动
                  </span>
                ) : null}
              </>
            ) : null}
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
          {isFineTuneOpen && !isEditingNeckPivot ? (
            <div
              aria-label={`${activeEditTarget === 'head' ? '头部' : '脸部'}精调`}
              className="character-assembly-fine-tune-panel"
              data-testid="character-assembly-fine-tune-panel"
              role="group"
            >
              {activeEditTarget === 'head' && head ? (
                <>
                  <div aria-label="头部左右位置" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">头部左右</span>
                    <button aria-label="向左移动头部" data-testid="character-assembly-head-left-step" disabled={isTestingHeadMotion} onClick={() => nudgeHead(-1, 0)} type="button">−</button>
                    <output aria-label="头部水平位置" data-testid="character-assembly-head-offset-x">{head.placement.offsetX.toFixed(1)}</output>
                    <button aria-label="向右移动头部" data-testid="character-assembly-head-right-step" disabled={isTestingHeadMotion} onClick={() => nudgeHead(1, 0)} type="button">+</button>
                  </div>
                  <div aria-label="头部上下位置" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">头部上下</span>
                    <button aria-label="向上移动头部" data-testid="character-assembly-head-up-step" disabled={isTestingHeadMotion} onClick={() => nudgeHead(0, -1)} type="button">−</button>
                    <output aria-label="头部垂直位置" data-testid="character-assembly-head-offset-y">{head.placement.offsetY.toFixed(1)}</output>
                    <button aria-label="向下移动头部" data-testid="character-assembly-head-down-step" disabled={isTestingHeadMotion} onClick={() => nudgeHead(0, 1)} type="button">+</button>
                  </div>
                  <div aria-label="头部大小" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">头部大小</span>
                    <button aria-label="缩小头部" data-testid="character-assembly-head-scale-down" disabled={isTestingHeadMotion} onClick={() => adjustHeadScale(-0.05)} type="button">−</button>
                    <output aria-label="头部大小" data-testid="character-assembly-head-scale">{head.placement.scale.toFixed(2)}×</output>
                    <button aria-label="放大头部" data-testid="character-assembly-head-scale-up" disabled={isTestingHeadMotion} onClick={() => adjustHeadScale(0.05)} type="button">+</button>
                  </div>
                </>
              ) : (
                <>
                  <div aria-label="左右" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">左右</span>
                    <button aria-label="向左移动脸部" data-testid="character-assembly-left-step" disabled={isTestingHeadMotion} onClick={() => moveFace(-1, 0)} type="button">−</button>
                    <output aria-label="左右偏移" data-testid="character-assembly-offset-x">{session.draft.facePlacement.offsetX.toFixed(1)}</output>
                    <button aria-label="向右移动脸部" data-testid="character-assembly-right-step" disabled={isTestingHeadMotion} onClick={() => moveFace(1, 0)} type="button">+</button>
                  </div>
                  <div aria-label="上下" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">上下</span>
                    <button aria-label="向上移动脸部" data-testid="character-assembly-up-step" disabled={isTestingHeadMotion} onClick={() => moveFace(0, -1)} type="button">−</button>
                    <output aria-label="上下偏移" data-testid="character-assembly-offset-y">{session.draft.facePlacement.offsetY.toFixed(1)}</output>
                    <button aria-label="向下移动脸部" data-testid="character-assembly-down-step" disabled={isTestingHeadMotion} onClick={() => moveFace(0, 1)} type="button">+</button>
                  </div>
                  <div aria-label="大小" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">大小</span>
                    <button aria-label="缩小脸部" data-testid="character-assembly-scale-down" disabled={isTestingHeadMotion} onClick={() => adjustScale(-0.05)} type="button">−</button>
                    <output aria-label="脸部大小" data-testid="character-assembly-scale">{session.draft.facePlacement.scale.toFixed(2)}×</output>
                    <button aria-label="放大脸部" data-testid="character-assembly-scale-up" disabled={isTestingHeadMotion} onClick={() => adjustScale(0.05)} type="button">+</button>
                  </div>
                </>
              )}
              <button
                className="character-assembly-reset"
                data-testid="character-assembly-reset"
                disabled={isTestingHeadMotion}
                onClick={resetPlacement}
                type="button"
              >
                重置
              </button>
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
