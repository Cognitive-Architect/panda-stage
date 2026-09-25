import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { calculateViewportTransform, type FacePlacement } from '../../../domain';
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
  getAssemblyPreviewExpressions,
  isCharacterAssemblyPending,
  isCharacterCreationSnapshot,
  type AssemblyFaceSelection,
  type CharacterAssemblySnapshotUnion,
} from './characterAssemblyPreview';

interface CharacterAssemblyWorkbenchProps {
  projectSnapshot: EditorProjectSnapshot;
  session: CharacterAssemblySnapshotUnion;
}

interface ActiveDrag {
  pointerId: number;
  startX: number;
  startY: number;
  placement: FacePlacement;
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
  const [transform, setTransform] = useState(() =>
    calculateViewportTransform(
      { width: 0, height: 0 },
      'fit',
      { width: project.width, height: project.height },
    ),
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ActiveDrag | null>(null);

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
  const imageAssets = useMemo(() => {
    const assetIds = new Set([
      session.draft.bodyAssetId,
      previewFaceAssetId,
    ]);
    return project.assets.flatMap((asset): CanvasImageAssetSource[] =>
      assetIds.has(asset.id) && asset.kind === 'image' && asset.sha256
        ? [{ id: asset.id, sha256: asset.sha256 }]
        : [],
    );
  }, [previewFaceAssetId, project.assets, session.draft.bodyAssetId]);
  const imageSourceKey = JSON.stringify([
    project.id,
    projectRoot,
    imageAssets.map(({ id, sha256 }) => [id, sha256]),
  ]);
  const [imageState, setImageState] = useState<CanvasImageState>(
    EMPTY_CANVAS_IMAGE_STATE,
  );

  useEffect(() => {
    const imageSession = new CanvasImageResourceSession();
    setImageState(EMPTY_CANVAS_IMAGE_STATE);
    imageSession.reconcile(
      {
        contextKey: `${project.id}\u0000${projectRoot}`,
        projectRoot,
        assets: imageAssets,
      },
      setImageState,
    );
    return () => imageSession.dispose();
  }, [imageSourceKey, imageAssets, project.id, projectRoot]);

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

  const pending = !isCreating && isCharacterAssemblyPending(project, session);
  const commit = (): void => {
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
    const result = characterAssemblySessionStore.begin(session.characterId);
    if (!result.ok) setMessage(result.error.message);
    else setMessage('');
  };

  const faceRect = facePart?.localRect;
  const bodyRect = bodyPart?.localRect;
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
      data-preview-face-asset-id={facePart?.assetId ?? ''}
      data-selected-face={selectedFace}
      data-session-kind={isCreating ? 'create' : 'edit'}
      data-testid="character-assembly-workbench"
    >
      <header className="character-assembly-workbench-header">
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
      </header>

      <div
        aria-label="身体和脸部预览"
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
          {visual?.parts.map((part) => {
            const image = imageState.images.get(part.assetId);
            return image ? (
              <img
                alt=""
                className={`character-assembly-part character-assembly-part-${part.slot}`}
                data-asset-id={part.assetId}
                draggable={false}
                key={part.partId}
                src={image.src}
                style={{
                  height: part.localRect.height,
                  left: left + part.localRect.x,
                  top: top + part.localRect.y,
                  width: part.localRect.width,
                }}
              />
            ) : null;
          })}
          {faceRect ? (
            <div
              aria-label="拖动脸部调整位置，使用方向键微调"
              aria-roledescription="可拖动脸部"
              className="character-assembly-face-hit-area"
              data-testid="character-assembly-face-drag-target"
              onKeyDown={(event) => {
                const step = event.shiftKey ? 10 : 1;
                if (event.key === 'ArrowLeft') moveFace(-step, 0);
                else if (event.key === 'ArrowRight') moveFace(step, 0);
                else if (event.key === 'ArrowUp') moveFace(0, -step);
                else if (event.key === 'ArrowDown') moveFace(0, step);
                else return;
                event.preventDefault();
              }}
              onLostPointerCapture={() => {
                dragRef.current = null;
              }}
              onPointerCancel={() => {
                dragRef.current = null;
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                dragRef.current = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  placement: { ...session.draft.facePlacement },
                };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag || drag.pointerId !== event.pointerId) return;
                const safeScale = Math.max(transform.scale, 0.0001);
                updateFacePlacement({
                  ...drag.placement,
                  offsetX:
                    drag.placement.offsetX +
                    (event.clientX - drag.startX) / safeScale,
                  offsetY:
                    drag.placement.offsetY +
                    (event.clientY - drag.startY) / safeScale,
                });
              }}
              onPointerUp={(event) => {
                dragRef.current = null;
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              }}
              role="group"
              style={{
                height: faceRect.height,
                left: left + faceRect.x,
                top: top + faceRect.y,
                width: faceRect.width,
              }}
              tabIndex={0}
            />
          ) : null}
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
          <button
            className="character-assembly-reset"
            data-testid="character-assembly-reset"
            onClick={resetPlacement}
            type="button"
          >
            重置
          </button>
        </div>
        <p>拖动脸部可调整位置，底部可微调大小</p>
        {!isCreating && pending ? (
          <div
            aria-live="polite"
            className="character-assembly-pending-actions"
            data-testid="character-assembly-pending"
            role="status"
          >
            <span>有未应用更改</span>
            <button onClick={revert} type="button">还原</button>
            <button onClick={commit} type="button">应用</button>
          </div>
        ) : null}
        {message ? (
          <output className="character-assembly-message" role="status">
            {message}
          </output>
        ) : null}
      </footer>
    </section>
  );
}
