import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Minus, Pencil, Plus, RotateCcw, X } from 'lucide-react';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  DEFAULT_BODY_PLACEMENT,
  calculateViewportTransform,
  characterPartTransformFromStaticAdjustment,
  transformVisualRectByPart,
  type AdaptivePartsCharacterDefinition,
  type CharacterPartStaticAdjustment,
  type LayerVisualPart,
  type BodyPlacement,
  type CharacterHead,
  type FacePlacement,
  type HeadPivot,
  type Project,
  type VisualLocalRect,
} from '../../../domain';
import type {
  EditorProjectSnapshot,
  SavedEditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import {
  characterAssemblySessionStore,
  type AdaptivePartsAssemblySessionHandle,
  type AdaptivePartsAssemblySnapshot,
  type CharacterAssemblyEditTarget,
  type CharacterAssemblySessionHandle,
  type CharacterCreationSessionHandle,
} from '../../stores/characterAssemblySessionStore';
import {
  CanvasImageResourceSession,
  EMPTY_CANVAS_IMAGE_STATE,
  type CanvasImageAssetSource,
  type CanvasImageState,
} from '../canvas/canvasImageResources';
import { ThumbnailStateIcon } from './ThumbnailStateIcon';
import {
  buildCharacterAssemblyPreviewVisual,
  buildAdaptivePartsAssemblyPreviewVisual,
  characterLocalPointerDelta,
  characterPartScaleFromPointerDistance,
  findVisibleImageBounds,
  getAssemblyPreviewExpressions,
  assemblyBoundsExceedFrame,
  calculateAssemblyFitViewportTransform,
  calculateAssemblyVisibleBounds,
  isAssemblyHeadMotionTestRunning,
  isCharacterAssemblyPending,
  isCharacterCreationSnapshot,
  isAdaptivePartsAssemblySnapshot,
  largestUnoccludedAssemblyViewportRect,
  parseAssemblyRotationInput,
  visibleImageRect,
  type AssemblyHeadMotionTestToken,
  type AssemblyFaceSelection,
  type AssemblyViewportRect,
  type CharacterAssemblySnapshotUnion,
  type NormalizedImageBounds,
} from './characterAssemblyPreview';
import {
  assessCharacterLayoutReuse,
  buildCharacterLayoutReuseUpdate,
  type CharacterLayoutReuseCandidate,
  type CharacterLayoutReuseFailureCode,
  type CharacterLayoutReuseImageAsset,
  type CharacterLayoutReuseImageDimensions,
  type CharacterLayoutReuseTarget,
} from './characterLayoutReuse';
import type { AdaptivePartsAssemblyActionsRef } from './CharacterManager';
import { shotStore } from '../../stores/shotStore';

interface CharacterAssemblyWorkbenchProps {
  projectSnapshot: EditorProjectSnapshot;
  savedProjectSnapshot?: SavedEditorProjectSnapshot | null;
  session: CharacterAssemblySnapshotUnion;
  adaptivePartsActionsRef?: AdaptivePartsAssemblyActionsRef;
}

interface ActiveDragStart {
  startX: number;
  startY: number;
}

interface ActiveScaleDragGeometry {
  centerX: number;
  centerY: number;
  startDistance: number;
}

type ActiveScaleDragDefinition = ActiveScaleDragGeometry &
  (
    | { kind: 'scale'; target: 'body'; placement: BodyPlacement }
    | { kind: 'scale'; target: 'face'; placement: FacePlacement }
    | { kind: 'scale'; target: 'head'; head: CharacterHead }
  );

type ActiveDragDefinition =
  | { kind: 'body'; placement: BodyPlacement }
  | { kind: 'face'; placement: FacePlacement }
  | { kind: 'head'; head: CharacterHead }
  | ActiveScaleDragDefinition
  | { kind: 'pivot'; pivot: HeadPivot };

type ActiveDrag = ActiveDragStart &
  ActiveDragDefinition & { pointerId: number };

interface CharacterLayoutReuseDraftBaseline {
  facePlacement: FacePlacement;
  head?: CharacterHead;
}

function layoutReuseFailureMessage(code: CharacterLayoutReuseFailureCode): string {
  switch (code) {
    case 'source-unsaved':
      return '请先保存项目。';
    case 'source-not-selected':
      return '';
    case 'same-character':
      return '请选择另一个角色。';
    case 'asset-missing':
    case 'resource-missing':
      return '素材不可用，请更换。';
    case 'asset-unverified':
      return '素材缺少校验信息，请重新导入。';
    case 'asset-error':
      return '素材状态异常，请修复素材。';
    case 'resource-loading':
      return '素材仍在读取，请稍候。';
    case 'resource-dimensions-mismatch':
      return '素材尺寸与记录不符，请修复素材。';
    case 'body-dimensions-mismatch':
      return '身体尺寸不同，无法套用。';
    case 'head-structure-mismatch':
      return '头部结构不同，无法套用。';
  }
}

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

function assemblyViewportFitArea(
  viewport: HTMLDivElement,
  fineTunePanel: HTMLDivElement | null,
): AssemblyViewportRect {
  const container = {
    width: viewport.clientWidth,
    height: viewport.clientHeight,
  };
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { x: 0, y: 0, ...container };
  }

  const viewportBounds = viewport.getBoundingClientRect();
  const originX = viewportBounds.left + viewport.clientLeft;
  const originY = viewportBounds.top + viewport.clientTop;
  const occlusions: DOMRect[] = [];
  const dock = document.querySelector<HTMLElement>(
    '[data-testid="resource-activity-dock"]',
  );
  const drawer = document.querySelector<HTMLElement>(
    '[data-testid="resource-activity-drawer"]',
  );
  const drawerStyle = drawer ? window.getComputedStyle(drawer) : null;
  if (
    dock?.dataset.resourceDrawerOpen === 'true' &&
    drawer &&
    drawerStyle?.display !== 'none' &&
    drawerStyle?.visibility === 'visible' &&
    Number(drawerStyle.opacity) > 0.01
  ) {
    occlusions.push(drawer.getBoundingClientRect());
  }
  if (fineTunePanel) {
    const panelStyle = window.getComputedStyle(fineTunePanel);
    if (
      panelStyle.display !== 'none' &&
      panelStyle.visibility === 'visible' &&
      Number(panelStyle.opacity) > 0.01
    ) {
      occlusions.push(fineTunePanel.getBoundingClientRect());
    }
  }
  const timeline = document.querySelector<HTMLElement>(
    '[data-testid="bottom-workspace"]',
  );
  if (timeline) {
    const timelineStyle = window.getComputedStyle(timeline);
    if (
      timelineStyle.display !== 'none' &&
      timelineStyle.visibility === 'visible' &&
      Number(timelineStyle.opacity) > 0.01
    ) {
      occlusions.push(timeline.getBoundingClientRect());
    }
  }

  const localOcclusions = occlusions.flatMap((bounds): AssemblyViewportRect[] => {
    const left = Math.max(0, bounds.left - originX);
    const top = Math.max(0, bounds.top - originY);
    const right = Math.min(container.width, bounds.right - originX);
    const bottom = Math.min(container.height, bounds.bottom - originY);
    return right > left && bottom > top
      ? [{ x: left, y: top, width: right - left, height: bottom - top }]
      : [];
  });
  return largestUnoccludedAssemblyViewportRect(container, localOcclusions);
}

function layoutReuseImageAssets(
  assets: Project['assets'],
): CharacterLayoutReuseImageAsset[] {
  return assets.flatMap((asset): CharacterLayoutReuseImageAsset[] =>
    asset.kind === 'image'
      ? [
          {
            id: asset.id,
            kind: 'image',
            width: asset.width,
            height: asset.height,
            ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
            ...(asset.metadata
              ? { metadata: { status: asset.metadata.status } }
              : {}),
          },
        ]
      : [],
  );
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
  savedProjectSnapshot,
  session,
  adaptivePartsActionsRef,
}: CharacterAssemblyWorkbenchProps): React.JSX.Element {
  if (isAdaptivePartsAssemblySnapshot(session)) {
    return (
      <AdaptivePartsAssemblyWorkbench
        adaptivePartsActionsRef={adaptivePartsActionsRef}
        projectSnapshot={projectSnapshot}
        session={session}
      />
    );
  }
  return (
    <CompositeCharacterAssemblyWorkbench
      projectSnapshot={projectSnapshot}
      savedProjectSnapshot={savedProjectSnapshot}
      session={session}
    />
  );
}

type AdaptivePartPointerDrag =
  | {
      kind: 'move';
      partId: string;
      pointerId: number;
      startX: number;
      startY: number;
      adjustment: CharacterPartStaticAdjustment;
    }
  | {
      kind: 'scale';
      partId: string;
      pointerId: number;
      centerX: number;
      centerY: number;
      startDistance: number;
      adjustment: CharacterPartStaticAdjustment;
    };

function partPoint(part: LayerVisualPart, x: number, y: number): { x: number; y: number } {
  const transform = part.imageTransform;
  if (!transform) return { x: part.localRect.x + x, y: part.localRect.y + y };
  return {
    x: transform.a * x + transform.c * y + transform.tx,
    y: transform.b * x + transform.d * y + transform.ty,
  };
}

type AdaptivePartsCharacterPart = AdaptivePartsCharacterDefinition['parts'][number];
type AdaptiveAdjustmentField = keyof CharacterPartStaticAdjustment;
export type AdaptivePartsUpdateResult = { ok: true } | { ok: false; message?: string };
export type AdaptivePartRenameCompletion =
  | { ok: true; value: string }
  | { ok: false; inputValue: string; error: string };

export function resolveAdaptivePartRename(
  inputValue: string,
  displayName: string,
  rename: (name: string) => AdaptivePartsUpdateResult,
): AdaptivePartRenameCompletion {
  const trimmed = inputValue.trim();
  if (!trimmed) {
    return {
      ok: false,
      inputValue,
      error: '\u540d\u79f0\u4e0d\u80fd\u4e3a\u7a7a\u3002',
    };
  }
  if (trimmed.length > 200) {
    return {
      ok: false,
      inputValue,
      error: '\u540d\u79f0\u4e0d\u80fd\u8d85\u8fc7 200 \u4e2a\u5b57\u7b26\u3002',
    };
  }
  if (trimmed === displayName) return { ok: true, value: trimmed };
  const result = rename(trimmed);
  if (!result.ok) {
    return {
      ok: false,
      inputValue,
      error: result.message ?? '\u96f6\u4ef6\u91cd\u547d\u540d\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5\u3002',
    };
  }
  return { ok: true, value: trimmed };
}
type AdaptiveAdjustmentDrafts = Record<
  string,
  Partial<Record<AdaptiveAdjustmentField, string>>
>;

function adaptiveAdjustmentInputValue(
  field: AdaptiveAdjustmentField,
  adjustment: CharacterPartStaticAdjustment,
): number {
  return field === 'scale' ? adjustment.scale * 100 : adjustment[field];
}

function adaptiveAdjustmentInputError(
  field: AdaptiveAdjustmentField,
  rawValue: string,
): string | null {
  if (!rawValue.trim()) return '请输入数值。';
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return '请输入有效数值。';
  if (field === 'scale') {
    const scale = value / 100;
    if (scale < CHARACTER_PART_MIN_SCALE || scale > CHARACTER_PART_MAX_SCALE) {
      return `大小需在 ${CHARACTER_PART_MIN_SCALE * 100}% 至 ${CHARACTER_PART_MAX_SCALE * 100}% 之间。`;
    }
  } else if (field === 'rotationDeg' && (value < -180 || value > 180)) {
    return '旋转范围为 −180° 至 180°。';
  } else if (
    (field === 'offsetX' || field === 'offsetY') &&
    Math.abs(value) > 1_000_000
  ) {
    return '偏移不能超出 ±1,000,000。';
  }
  return null;
}

function parseAdaptiveAdjustmentInput(
  field: AdaptiveAdjustmentField,
  rawValue: string,
): number | null {
  if (adaptiveAdjustmentInputError(field, rawValue)) return null;
  const value = Number(rawValue);
  return field === 'scale' ? value / 100 : value;
}

function formatAdaptiveAdjustmentInput(
  field: AdaptiveAdjustmentField,
  adjustment: CharacterPartStaticAdjustment,
): string {
  const value = adaptiveAdjustmentInputValue(field, adjustment);
  return String(Number(value.toFixed(1)));
}

function AdaptivePartsAssemblyRow({
  displayName,
  imageMissing,
  imageSrc,
  onMessage,
  onRename,
  onRestore,
  onSelect,
  onToggleVisibility,
  part,
  selected,
}: {
  displayName: string;
  imageMissing: boolean;
  imageSrc?: string;
  onMessage: (message: string) => void;
  onRename: (name: string) => AdaptivePartsUpdateResult;
  onRestore: () => void;
  onSelect: () => void;
  onToggleVisibility: () => void;
  part: AdaptivePartsCharacterPart;
  selected: boolean;
}): React.JSX.Element {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFinishedRef = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(displayName);
  const [renameError, setRenameError] = useState('');
  const visible = part.visible !== false;

  useEffect(() => {
    if (!renaming) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [renaming]);

  const finishRename = (): boolean => {
    const completion = resolveAdaptivePartRename(renameValue, displayName, onRename);
    if (!completion.ok) {
      setRenameError(completion.error);
      onMessage(completion.error);
      return false;
    }
    renameFinishedRef.current = true;
    setRenameError('');
    setRenaming(false);
    onMessage('');
    return true;
  };
  const startRename = (): void => {
    renameFinishedRef.current = false;
    setRenameValue(displayName);
    setRenameError('');
    onMessage('');
    setRenaming(true);
  };

  return (
    <div
      className="adaptive-parts-assembly-row"
      data-draw-order={part.drawOrder}
      data-part-id={part.partId}
      data-selected={selected}
      data-testid="adaptive-parts-assembly-row"

    >
      {renaming ? (
        <div className="adaptive-parts-assembly-row-edit">
          <span
            aria-label={imageMissing ? '素材不可用' : undefined}
            className="adaptive-parts-assembly-thumbnail"
            data-thumbnail-status={imageSrc ? 'ready' : imageMissing ? 'missing' : 'loading'}
            title={imageMissing ? '素材不可用' : undefined}
          >
            {imageSrc ? (
              <img alt="" src={imageSrc} />
            ) : imageMissing ? (
              <ThumbnailStateIcon kind="error" size={16} />
            ) : (
              <span aria-hidden="true">▧</span>
            )}
          </span>
          <div className="adaptive-parts-assembly-rename">
            <input
              aria-describedby={renameError ? `adaptive-part-rename-error-${part.partId}` : undefined}
              aria-invalid={Boolean(renameError)}
              aria-label={`重命名${displayName}`}
              className="adaptive-parts-assembly-name"
              data-testid="adaptive-parts-rename-input"
              maxLength={200}
              onBlur={() => {
                if (!renameFinishedRef.current) finishRename();
              }}
              onChange={(event) => {
                setRenameValue(event.currentTarget.value);
                if (renameError) setRenameError('');
                onMessage('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  if (finishRename()) event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  renameFinishedRef.current = true;
                  setRenameValue(displayName);
                  setRenameError('');
                  setRenaming(false);
                  onMessage('');
                }
              }}
              ref={renameInputRef}
              type="text"
              value={renameValue}
            />
            {renameError ? (
              <span
                className="adaptive-parts-assembly-rename-error"
                id={`adaptive-part-rename-error-${part.partId}`}
                role="alert"
              >
                {renameError}
              </span>
            ) : null}
          </div>
        </div>
      ) : (
        <button
          aria-pressed={selected}
          className="adaptive-parts-assembly-row-select"
          data-part-visible={visible}
          data-testid="adaptive-parts-assembly-row-select"
          onClick={onSelect}
          type="button"
        >
          <span
            aria-label={imageMissing ? '素材不可用' : undefined}
            className="adaptive-parts-assembly-thumbnail"
            data-thumbnail-status={imageSrc ? 'ready' : imageMissing ? 'missing' : 'loading'}
            title={imageMissing ? '素材不可用' : undefined}
          >
            {imageSrc ? (
              <img alt="" src={imageSrc} />
            ) : imageMissing ? (
              <ThumbnailStateIcon kind="error" size={16} />
            ) : (
              <span aria-hidden="true">▧</span>
            )}
          </span>
          <span aria-label={displayName} className="adaptive-parts-assembly-name" title={displayName}>{displayName}</span>
        </button>
      )}
      <button
        aria-label={`${visible ? '隐藏' : '显示'}${displayName}`}
        aria-pressed={visible}
        className="adaptive-parts-visibility-toggle"
        data-testid="adaptive-parts-visibility-toggle"
        onClick={onToggleVisibility}
        title={`${visible ? '隐藏' : '显示'}${displayName}`}
        type="button"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M2.5 12s3.2-6 9.5-6 9.5 6 9.5 6-3.2 6-9.5 6-9.5-6-9.5-6Z" />
          {visible ? <circle cx="12" cy="12" r="2.7" /> : <path d="M4 4 20 20" />}
        </svg>
      </button>
      <button
        aria-label={`重命名${displayName}`}
        className="adaptive-parts-row-action"
        data-testid="adaptive-parts-rename-button"
        onClick={startRename}
        title={`重命名${displayName}`}
        type="button"
      >
        <Pencil aria-hidden="true" size={18} />
      </button>
      <button
        aria-label={`恢复${displayName}原始源姿势`}
        className="adaptive-parts-row-action"
        data-testid="adaptive-parts-restore-button"
        disabled={!part.sourceRestTransform}
        onClick={onRestore}
        title={part.sourceRestTransform ? '恢复原始源姿势' : '此零件没有可信的原始位置记录'}
        type="button"
      >
        <RotateCcw aria-hidden="true" size={18} />
      </button>
    </div>
  );
}

function AdaptivePartsAssemblyWorkbench({
  projectSnapshot,
  session,
  adaptivePartsActionsRef,
}: {
  projectSnapshot: EditorProjectSnapshot;
  session: AdaptivePartsAssemblySnapshot;
  adaptivePartsActionsRef?: AdaptivePartsAssemblyActionsRef;
}): React.JSX.Element {
  const { project, projectRoot } = projectSnapshot;
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
    shotStore.getCurrentShotId,
  );
  const hasCurrentShot = project.shots.some((shot) => shot.id === currentShotId);
  const assemblyCharacterName = project.characters.find(
    (character) => character.id === session.characterId,
  )?.name ?? '角色';
  const workbenchRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const dragRef = useRef<AdaptivePartPointerDrag | null>(null);
  const [transform, setTransform] = useState(() =>
    calculateViewportTransform({ width: 0, height: 0 }, 'fit', {
      width: project.width,
      height: project.height,
    }),
  );
  const [imageState, setImageState] = useState(EMPTY_CANVAS_IMAGE_STATE);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorPosition, setInspectorPosition] = useState({
    left: 0,
    top: 0,
    width: 44,
    corner: 'top-right',
  });
  const [numericDrafts, setNumericDrafts] = useState<AdaptiveAdjustmentDrafts>({});
  const numericInitialValuesRef = useRef<
    Record<string, Partial<Record<AdaptiveAdjustmentField, number>>>
  >({});
  const [message, setMessage] = useState('');
  const visual = useMemo(
    () => buildAdaptivePartsAssemblyPreviewVisual(project, session),
    [project, session],
  );
  const imageAssets = useMemo(() => {
    const ids = new Set(session.draft.parts.map((part) => part.assetId));
    return project.assets.flatMap((asset): CanvasImageAssetSource[] =>
      asset.kind === 'image' && ids.has(asset.id)
        ? [{ id: asset.id, ...(asset.sha256 ? { sha256: asset.sha256 } : {}) }]
        : [],
    );
  }, [project.assets, session.draft.parts]);
  const contextKey = `${project.id}\u0000${projectRoot}`;
  const imageSessionRef = useRef<CanvasImageResourceSession | null>(null);
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
      { contextKey, projectRoot, assets: imageAssets },
      (state) => setImageState(state),
    );
  }, [contextKey, imageAssets, projectRoot]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = (): void => setTransform(calculateViewportTransform(
      { width: viewport.clientWidth, height: viewport.clientHeight },
      'fit',
      { width: project.width, height: project.height },
    ));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [project.height, project.width]);

  const activeHandle = (): AdaptivePartsAssemblySessionHandle | null => {
    const handle = characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle();
    return handle?.sessionId === session.sessionId && handle.generation === session.generation
      ? handle
      : null;
  };
  const setDefinition = (
    update: (definition: AdaptivePartsCharacterDefinition) => AdaptivePartsCharacterDefinition,
  ): AdaptivePartsUpdateResult => {
    const handle = activeHandle();
    if (!handle) {
      setMessage('组装草稿已失效，请重新打开。');
      return { ok: false };
    }
    const current = handle.getSnapshot();
    if (!current) {
      setMessage('组装草稿已失效，请重新打开。');
      return { ok: false };
    }
    // Read the current session draft instead of the last React render. Rapid
    // edits to different Parts can arrive before React commits a rerender.
    const result = handle.setDraft(update(current.draft));
    if (!result.ok) {
      setMessage(result.error.message);
      return { ok: false, message: result.error.message };
    }
    setMessage('');
    return { ok: true };
  };
  const updatePart = (
    partId: string,
    update: (part: AdaptivePartsCharacterDefinition['parts'][number]) => AdaptivePartsCharacterDefinition['parts'][number],
  ): AdaptivePartsUpdateResult => setDefinition((definition) => ({
    ...definition,
    parts: definition.parts.map((part) => part.partId === partId ? update(part) : part),
  }));
  const adjustmentOf = (partId: string): CharacterPartStaticAdjustment => {
    const part = session.draft.parts.find((candidate) => candidate.partId === partId);
    return { ...(part?.staticAdjustment ?? DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT) };
  };
  const setAdjustment = (partId: string, adjustment: CharacterPartStaticAdjustment): AdaptivePartsUpdateResult => {
    const current = activeHandle()?.getSnapshot()?.draft;
    if (!current) return { ok: false };
    const part = current.parts.find((candidate) => candidate.partId === partId);
    if (!part) return { ok: false };
    try {
      const sourceRestTransform = part.sourceRestTransform ?? part.restTransform;
      const restTransform = characterPartTransformFromStaticAdjustment(
        current.sourceRootTransform,
        sourceRestTransform,
        part.imageMapping,
        adjustment,
      );
      return updatePart(partId, (current) => ({
        ...current,
        sourceRestTransform: { ...sourceRestTransform },
        staticAdjustment: { ...adjustment },
        restTransform,
      }));
    } catch {
      const message = '\u8c03\u6574\u5931\u8d25\uff0c\u96f6\u4ef6\u4f4d\u7f6e\u672a\u66f4\u6539\u3002';
      setMessage(message);
      return { ok: false, message };
    }
  };  const selectedPart = session.draft.parts.find(
    (part) => part.partId === session.selectedPartId,
  ) ?? null;
  const selectedAdjustment = selectedPart
    ? adjustmentOf(selectedPart.partId)
    : null;
  const selectedCanvasPart = (visual?.parts ?? []).find((part) =>
    part.source.kind === 'adaptive-part' &&
    part.source.characterPartId === session.selectedPartId &&
    part.visible !== false,
  ) ?? null;
  const selectedCanvasImage = selectedCanvasPart
    ? imageState.images.get(selectedCanvasPart.assetId)
    : null;
  const selectedCanvasTransform = selectedCanvasPart?.imageTransform;
  const selectedCanvasMatrix = selectedCanvasTransform
    ? `matrix(${selectedCanvasTransform.a}, ${selectedCanvasTransform.b}, ${selectedCanvasTransform.c}, ${selectedCanvasTransform.d}, ${project.width / 2 + selectedCanvasTransform.tx}, ${project.height / 2 + selectedCanvasTransform.ty})`
    : null;
  const rows = [...session.draft.parts].sort(
    (left, right) => right.drawOrder - left.drawOrder,
  );
  const hasPendingChanges = isCharacterAssemblyPending(project, session);
  const invalidAdjustmentDrafts = Object.entries(numericDrafts).flatMap(
    ([partId, fields]) =>
      (Object.entries(fields) as [AdaptiveAdjustmentField, string][]).flatMap(
        ([field, rawValue]) => adaptiveAdjustmentInputError(field, rawValue)
          ? [{ partId, field, rawValue }]
          : [],
      ),
  );
  const hasInvalidAdjustmentDraft = invalidAdjustmentDrafts.length > 0;
  const hasCurrentSession = Boolean(activeHandle()?.getSnapshot());
  const canApply =
    hasPendingChanges &&
    hasCurrentSession &&
    !hasInvalidAdjustmentDraft &&
    !message;
  const assetNames = new Map(
    project.assets.flatMap((asset) => asset.kind === 'image' ? [[asset.id, asset.name] as const] : []),
  );

  const writeAdjustmentField = (
    partId: string,
    field: AdaptiveAdjustmentField,
    value: number,
  ): AdaptivePartsUpdateResult => {
    const currentPart = activeHandle()?.getSnapshot()?.draft.parts.find(
      (part) => part.partId === partId,
    );
    if (!currentPart) return { ok: false };
    const currentAdjustment = {
      ...(currentPart.staticAdjustment ?? DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT),
    };
    if (Object.is(currentAdjustment[field], value)) return { ok: true };
    return setAdjustment(partId, {
      ...currentAdjustment,
      [field]: value,
    } as CharacterPartStaticAdjustment);
  };
  const setNumericDraft = (
    partId: string,
    field: AdaptiveAdjustmentField,
    rawValue: string,
  ): void => {
    setNumericDrafts((current) => ({
      ...current,
      [partId]: { ...current[partId], [field]: rawValue },
    }));
    const inputError = adaptiveAdjustmentInputError(field, rawValue);
    if (inputError) {
      setMessage(inputError);
      return;
    }
    const value = parseAdaptiveAdjustmentInput(field, rawValue);
    if (value === null) return;
    const result = writeAdjustmentField(partId, field, value);
    if (result.ok) setMessage('');
    else if (result.message) setMessage(result.message);
  };
  const adjustmentStep = (field: AdaptiveAdjustmentField, large: boolean): number => {
    if (field === 'scale') return large ? 5 : 1;
    return large ? 10 : 1;
  };
  const canStepAdjustment = (
    partId: string,
    field: AdaptiveAdjustmentField,
    direction: -1 | 1,
    large = false,
  ): boolean => {
    const part = activeHandle()?.getSnapshot()?.draft.parts.find(
      (candidate) => candidate.partId === partId,
    );
    if (!part) return false;
    const adjustment = part.staticAdjustment ?? DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT;
    const rawValue = numericDrafts[partId]?.[field] ??
      String(adaptiveAdjustmentInputValue(field, adjustment));
    if (adaptiveAdjustmentInputError(field, rawValue)) return false;
    const nextValue = Number(rawValue) + direction * adjustmentStep(field, large);
    return !adaptiveAdjustmentInputError(field, String(nextValue));
  };
  const stepAdjustment = (
    partId: string,
    field: AdaptiveAdjustmentField,
    direction: -1 | 1,
    large: boolean,
  ): void => {
    const part = activeHandle()?.getSnapshot()?.draft.parts.find(
      (candidate) => candidate.partId === partId,
    );
    if (!part) {
      setMessage('组装草稿已失效，请重新打开。');
      return;
    }
    const adjustment = part.staticAdjustment ?? DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT;
    const rawValue = numericDrafts[partId]?.[field] ??
      String(adaptiveAdjustmentInputValue(field, adjustment));
    const inputError = adaptiveAdjustmentInputError(field, rawValue);
    if (inputError) {
      setMessage(inputError);
      return;
    }
    const nextRawValue = String(Number(rawValue) + direction * adjustmentStep(field, large));
    const nextError = adaptiveAdjustmentInputError(field, nextRawValue);
    if (nextError) {
      setMessage(nextError);
      return;
    }
    const value = parseAdaptiveAdjustmentInput(field, nextRawValue);
    if (value === null) return;
    const result = writeAdjustmentField(partId, field, value);
    if (!result.ok) {
      if (result.message) setMessage(result.message);
      return;
    }
    setNumericDrafts((current) => ({
      ...current,
      [partId]: { ...current[partId], [field]: nextRawValue },
    }));
    setMessage('');
  };
  const beginNumericDraft = (
    partId: string,
    field: AdaptiveAdjustmentField,
  ): void => {
    const currentPart = activeHandle()?.getSnapshot()?.draft.parts.find(
      (part) => part.partId === partId,
    );
    if (!currentPart) return;
    const currentAdjustment = {
      ...(currentPart.staticAdjustment ?? DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT),
    };
    const originalValue = currentAdjustment[field];
    const partInitialValues = numericInitialValuesRef.current[partId] ?? {};
    if (partInitialValues[field] !== undefined) return;
    numericInitialValuesRef.current[partId] = {
      ...partInitialValues,
      [field]: originalValue,
    };
    setNumericDrafts((current) => ({
      ...current,
      [partId]: {
        ...current[partId],
        [field]: String(adaptiveAdjustmentInputValue(field, currentAdjustment)),
      },
    }));
  };
  const finishNumericDraft = (
    partId: string,
    field: AdaptiveAdjustmentField,
  ): boolean => {
    const rawValue = numericDrafts[partId]?.[field];
    if (rawValue === undefined) return true;
    const inputError = adaptiveAdjustmentInputError(field, rawValue);
    if (inputError) {
      setMessage(inputError);
      return false;
    }
    const value = parseAdaptiveAdjustmentInput(field, rawValue);
    if (value === null) return false;
    const result = writeAdjustmentField(partId, field, value);
    if (!result.ok) {
      if (result.message) setMessage(result.message);
      return false;
    }
    setNumericDrafts((current) => {
      const partDrafts = { ...current[partId] };
      delete partDrafts[field];
      const next = { ...current };
      if (Object.keys(partDrafts).length > 0) next[partId] = partDrafts;
      else delete next[partId];
      return next;
    });
    if (numericInitialValuesRef.current[partId]) {
      delete numericInitialValuesRef.current[partId]![field];
      if (Object.keys(numericInitialValuesRef.current[partId]!).length === 0) {
        delete numericInitialValuesRef.current[partId];
      }
    }
    setMessage('');
    return true;
  };  const cancelNumericDraft = (
    partId: string,
    field: AdaptiveAdjustmentField,
  ): void => {
    const originalValue = numericInitialValuesRef.current[partId]?.[field];
    if (originalValue !== undefined) {
      const result = writeAdjustmentField(partId, field, originalValue);
      if (!result.ok) {
        if (result.message) setMessage(result.message);
        return;
      }
      delete numericInitialValuesRef.current[partId]![field];
      if (Object.keys(numericInitialValuesRef.current[partId]!).length === 0) {
        delete numericInitialValuesRef.current[partId];
      }
    }
    setNumericDrafts((current) => {
      const partDrafts = { ...current[partId] };
      delete partDrafts[field];
      const next = { ...current };
      if (Object.keys(partDrafts).length > 0) next[partId] = partDrafts;
      else delete next[partId];
      return next;
    });
    setMessage('');
  };  const clearNumericDraftsForPart = (partId: string): void => {
    delete numericInitialValuesRef.current[partId];
    setNumericDrafts((current) => {
      const next = { ...current };
      delete next[partId];
      return next;
    });
  };
  const restorePartToSourcePose = (partId: string): void => {
    const currentPart = activeHandle()?.getSnapshot()?.draft.parts.find(
      (part) => part.partId === partId,
    );
    if (!currentPart) {
      setMessage('\u7ec4\u88c5\u8349\u7a3f\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u3002');
      return;
    }
    const invalidDraft = invalidAdjustmentDrafts.find((draft) => draft.partId === partId);
    if (invalidDraft) {
      setMessage(adaptiveAdjustmentInputError(invalidDraft.field, invalidDraft.rawValue) ?? '\u8bf7\u5148\u4fee\u6b63\u65e0\u6548\u6570\u503c\u3002');
      return;
    }
    if (!currentPart.sourceRestTransform) {
      setMessage('\u65e0\u6cd5\u83b7\u53d6\u6b64\u96f6\u4ef6\u7684\u53ef\u4fe1\u539f\u59cb\u4f4d\u7f6e\uff0c\u65e0\u6cd5\u6062\u590d\u539f\u4f4d\u3002');
      return;
    }
    const sourceRestTransform = currentPart.sourceRestTransform;
    const result = updatePart(partId, (part) => ({
      ...part,
      sourceRestTransform: { ...sourceRestTransform },
      restTransform: { ...sourceRestTransform },
      staticAdjustment: { ...DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT },
    }));
    if (!result.ok) {
      if (result.message) setMessage(result.message);
      return;
    }
    clearNumericDraftsForPart(partId);
    setMessage('');
  };
  useLayoutEffect(() => {
    const workbench = workbenchRef.current;
    const viewport = viewportRef.current;
    const inspector = inspectorRef.current;
    if (!workbench || !viewport || !inspector) return undefined;
    let frame = 0;
    const placeInspector = (): void => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
      const workbenchBounds = workbench.getBoundingClientRect();
      const viewportBounds = viewport.getBoundingClientRect();
      if (viewportBounds.width <= 0 || viewportBounds.height <= 0) return;

      const margin = 8;
      const listBounds = workbench
        .querySelector<HTMLElement>('.adaptive-parts-assembly-list')
        ?.getBoundingClientRect();
      const preferredWidth = window.innerWidth <= 900
        ? Math.min(264, Math.max(44, (listBounds?.width ?? viewportBounds.width) - margin * 2))
        : 296;
      const width = Math.min(
        inspectorOpen ? preferredWidth : 44,
        Math.max(44, viewportBounds.width - margin * 2),
      );
      const height = Math.min(
        Math.max(inspectorOpen ? inspector.scrollHeight : 44, 44),
        Math.max(44, viewportBounds.height - margin * 2),
      );
      const partElements = [
        ...viewport.querySelectorAll<HTMLElement>(
          '[data-testid="adaptive-parts-assembly-canvas-part"]',
        ),
      ];
      const selectedElement = session.selectedPartId
        ? partElements.find((element) => element.dataset.partId === session.selectedPartId)
        : undefined;
      const toolbarButton = viewport.querySelector<HTMLButtonElement>(
        '.adaptive-parts-assembly-canvas-toolbar button',
      );
      const obstacles = [
        ...partElements.map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            weight: element === selectedElement ? 4 : 1,
          };
        }),
        ...(toolbarButton
          ? (() => {
              const bounds = toolbarButton.getBoundingClientRect();
              return [{
                left: bounds.left,
                right: bounds.right,
                top: bounds.top,
                bottom: bounds.bottom,
                weight: 2,
              }];
            })()
          : []),
      ];
      const candidates = [
        {
          corner: 'top-right',
          left: viewportBounds.right - width - margin,
          top: viewportBounds.top + margin,
        },
        {
          corner: 'top-left',
          left: viewportBounds.left + margin,
          top: viewportBounds.top + margin,
        },
        {
          corner: 'bottom-right',
          left: viewportBounds.right - width - margin,
          top: viewportBounds.bottom - height - margin,
        },
        {
          corner: 'bottom-left',
          left: viewportBounds.left + margin,
          top: viewportBounds.bottom - height - margin,
        },
        ...(window.innerWidth <= 900 && listBounds
          ? [{
              corner: 'list-column',
              left: listBounds.left + margin,
              top: viewportBounds.top + margin,
            }]
          : []),
      ];
      const score = (candidate: (typeof candidates)[number]): number =>
        obstacles.reduce((total, obstacle) => {
          const overlapWidth = Math.max(
            0,
            Math.min(candidate.left + width, obstacle.right) -
              Math.max(candidate.left, obstacle.left),
          );
          const overlapHeight = Math.max(
            0,
            Math.min(candidate.top + height, obstacle.bottom) -
              Math.max(candidate.top, obstacle.top),
          );
          const overlap = overlapWidth * overlapHeight;
          const obstacleArea = Math.max(
            1,
            (obstacle.right - obstacle.left) * (obstacle.bottom - obstacle.top),
          );
          return total + overlap / obstacleArea * obstacle.weight;
        }, 0);
      const best = candidates.reduce((currentBest, candidate) =>
        score(candidate) < score(currentBest) ? candidate : currentBest,
      );
      const horizontalBounds = best.corner === 'list-column'
        ? workbenchBounds
        : viewportBounds;
      const left = Math.max(
        horizontalBounds.left + margin,
        Math.min(best.left, horizontalBounds.right - width - margin),
      );
      const top = Math.max(
        viewportBounds.top + margin,
        Math.min(best.top, viewportBounds.bottom - height - margin),
      );
      setInspectorPosition({
        left: left - workbenchBounds.left,
        top: top - workbenchBounds.top,
        width,
        corner: best.corner,
      });
      });
    };
    placeInspector();
    const observer = new ResizeObserver(placeInspector);
    observer.observe(viewport);
    window.addEventListener('resize', placeInspector);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', placeInspector);
    };
  }, [
    inspectorOpen,
    numericDrafts,
    project.height,
    project.width,
    session.selectedPartId,
    transform,
  ]);

  const pointerToLocal = (clientX: number, clientY: number): { x: number; y: number } => {
    const bounds = viewportRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: (clientX - bounds.left - transform.offsetX) / Math.max(0.0001, transform.scale) - project.width / 2,
      y: (clientY - bounds.top - transform.offsetY) / Math.max(0.0001, transform.scale) - project.height / 2,
    };
  };
  const pointerToLocalRef = useRef(pointerToLocal);
  pointerToLocalRef.current = pointerToLocal;
  const setAdjustmentRef = useRef(setAdjustment);
  setAdjustmentRef.current = setAdjustment;
  const beginMove = (event: React.PointerEvent, part: LayerVisualPart): void => {
    if (part.source.kind !== 'adaptive-part') return;
    const partId = part.source.characterPartId;
    const handle = activeHandle();
    if (!handle?.selectPart(partId)) return;
    event.preventDefault();
    const point = pointerToLocal(event.clientX, event.clientY);
    dragRef.current = {
      kind: 'move',
      partId,
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      adjustment: adjustmentOf(partId),
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const beginScale = (event: React.PointerEvent, part: LayerVisualPart): void => {
    if (part.source.kind !== 'adaptive-part') return;
    const partId = part.source.characterPartId;
    const handle = activeHandle();
    if (!handle?.selectPart(partId)) return;
    event.preventDefault();
    event.stopPropagation();
    const center = partPoint(part, part.localRect.width / 2, part.localRect.height / 2);
    const point = pointerToLocal(event.clientX, event.clientY);
    dragRef.current = {
      kind: 'scale',
      partId,
      pointerId: event.pointerId,
      centerX: center.x,
      centerY: center.y,
      startDistance: Math.hypot(point.x - center.x, point.y - center.y),
      adjustment: adjustmentOf(partId),
    };
  };
  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const point = pointerToLocalRef.current(event.clientX, event.clientY);
      if (drag.kind === 'move') {
        setAdjustmentRef.current(drag.partId, {
          ...drag.adjustment,
          offsetX: drag.adjustment.offsetX + point.x - drag.startX,
          offsetY: drag.adjustment.offsetY + point.y - drag.startY,
        });
      } else {
        const scale = characterPartScaleFromPointerDistance(
          drag.adjustment.scale,
          drag.startDistance,
          Math.hypot(point.x - drag.centerX, point.y - drag.centerY),
        );
        setAdjustmentRef.current(drag.partId, { ...drag.adjustment, scale });
      }
    };
    const onEnd = (event: PointerEvent): void => {
      if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [project.height, project.width, transform]);

  const applyDraft = (): void => {
    if (hasInvalidAdjustmentDraft) {
      setMessage('请先修正无效数值，再应用组装更改。');
      return;
    }
    if (!hasPendingChanges) return;
    const handle = activeHandle();
    if (!handle) {
      setMessage('组装草稿已失效，请重新打开。');
      return;
    }
    const result = handle.commit();
    if (result.status === 'rejected' || result.status === 'stale') {
      setMessage(result.error.message);
    } else {
      setMessage('');
    }
  };
  const cancelDraft = (): void => {
    if (isCharacterAssemblyPending(project, session) &&
      !window.confirm('组装更改尚未应用，取消将放弃这些更改。继续吗？')) return;
    activeHandle()?.cancel();
  };
  const returnToCharacterList = (): void => {
    const result = adaptivePartsActionsRef?.current?.backToCharacterList();
    if (result === undefined) {
      setMessage('\u8fd4\u56de\u89d2\u8272\u5217\u8868\u64cd\u4f5c\u4e0d\u53ef\u7528\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u89d2\u8272\u3002');
    }
  };
  const joinCurrentShot = (): void => {
    const result = adaptivePartsActionsRef?.current?.joinCurrentShot();
    if (result?.message) setMessage(result.message);
  };
  const renderAdaptiveAdjustmentField = (
    field: AdaptiveAdjustmentField,
    label: string,
    ariaLabel: string,
    testId: string,
    suffix = '',
  ): React.JSX.Element => {
    const partId = selectedPart!.partId;
    const rawValue = numericDrafts[partId]?.[field] ??
      formatAdaptiveAdjustmentInput(field, selectedAdjustment!);
    const error = adaptiveAdjustmentInputError(field, rawValue);
    const errorId = `${testId}-error`;
    const inputId = `${testId}-input`;
    return (
      <div className="adaptive-parts-inspector-field">
        <span className="adaptive-parts-inspector-label">{label}</span>
        <div className="adaptive-parts-inspector-field-controls">
          <button
            aria-controls={inputId}
            aria-label={`\u51cf\u5c11${ariaLabel}\uff0c\u6309 Shift \u4f7f\u7528\u5927\u6b65\u957f`}
            className="adaptive-parts-inspector-step"
            data-testid={`${testId}-step-down`}
            disabled={Boolean(error) || !canStepAdjustment(partId, field, -1)}
            onClick={(event) => stepAdjustment(partId, field, -1, event.shiftKey)}
            onMouseDown={(event) => event.preventDefault()}
            title={`\u51cf\u5c11${ariaLabel}\uff1b\u6309 Shift \u51cf\u5c11\u8f83\u5927\u6b65\u957f`}
            type="button"
          >
            <Minus aria-hidden="true" size={16} />
          </button>
          <span className="adaptive-parts-inspector-input-wrap">
            <input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={Boolean(error)}
              aria-label={ariaLabel}
              autoComplete="off"
              data-testid={testId}
              id={inputId}
              inputMode="decimal"
              onBlur={() => finishNumericDraft(partId, field)}
              onChange={(event) => setNumericDraft(partId, field, event.currentTarget.value)}
              onFocus={() => beginNumericDraft(partId, field)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.preventDefault();
                cancelNumericDraft(partId, field);
              }}
              type="text"
              value={rawValue}
            />
            {suffix ? <span aria-hidden="true">{suffix}</span> : null}
          </span>
          <button
            aria-controls={inputId}
            aria-label={`\u589e\u52a0${ariaLabel}\uff0c\u6309 Shift \u4f7f\u7528\u5927\u6b65\u957f`}
            className="adaptive-parts-inspector-step"
            data-testid={`${testId}-step-up`}
            disabled={Boolean(error) || !canStepAdjustment(partId, field, 1)}
            onClick={(event) => stepAdjustment(partId, field, 1, event.shiftKey)}
            onMouseDown={(event) => event.preventDefault()}
            title={`\u589e\u52a0${ariaLabel}\uff1b\u6309 Shift \u589e\u52a0\u8f83\u5927\u6b65\u957f`}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
          </button>
        </div>
        {error ? <small className="adaptive-parts-inspector-field-error" id={errorId}>{error}</small> : null}
      </div>
    );
  };  return (
    <section
      aria-label="Adaptive Parts 角色组装工作区"
      className="character-assembly-workbench adaptive-parts-assembly-workbench"
      data-character-id={session.characterId}
      data-project-revision={projectSnapshot.revision}
      data-project-dirty={projectSnapshot.dirty}
      data-testid="adaptive-parts-assembly-workbench"
      ref={workbenchRef}
    >
      <header className="adaptive-parts-assembly-header" data-testid="adaptive-parts-assembly-header">
        <button
          aria-label={'\u8fd4\u56de\u89d2\u8272\u5217\u8868'}
          className="adaptive-parts-assembly-back"
          data-testid="adaptive-parts-back-to-list"
          onClick={returnToCharacterList}
          title={'\u8fd4\u56de\u89d2\u8272\u5217\u8868'}
          type="button"
        >
          <span aria-hidden="true">&#8592;</span>
          {'\u8fd4\u56de\u89d2\u8272\u5217\u8868'}
        </button>
        <strong title={assemblyCharacterName}>{assemblyCharacterName}</strong>
      </header>
      <aside className="adaptive-parts-assembly-list" aria-label="部件列表">
        <h2 data-testid="adaptive-parts-assembly-count">部件 · {rows.length}</h2>
        <button
          className="adaptive-parts-assembly-join-shot"
          data-testid="adaptive-parts-join-current-shot"
          disabled={!hasCurrentShot}
          onClick={joinCurrentShot}
          title={hasCurrentShot ? '\u5c06\u6b64\u89d2\u8272\u52a0\u5165\u5f53\u524d\u955c\u5934' : '\u8bf7\u5148\u9009\u62e9\u955c\u5934'}
          type="button"
        >
          {'\uff0b \u52a0\u5165\u955c\u5934'}
        </button>
        <div className="adaptive-parts-assembly-rows">
          {rows.map((part, index) => {
            const matchingAssetParts = session.draft.parts.filter((candidate) => candidate.assetId === part.assetId).length;
            const baseName = part.displayName ?? assetNames.get(part.assetId) ?? `部件 ${index + 1}`;
            const name = matchingAssetParts > 1 && !part.displayName
              ? `${baseName} · 部件 ${index + 1}`
              : baseName;
            const image = imageState.images.get(part.assetId);
            const imageMissing = imageState.missing.has(part.assetId);
            return (
              <AdaptivePartsAssemblyRow
                displayName={name}
                imageMissing={imageMissing}
                imageSrc={image?.src}
                key={part.partId}
                onMessage={setMessage}
                onRename={(displayName) => updatePart(part.partId, (current) => ({
                  ...current,
                  displayName,
                }))}
                onRestore={() => restorePartToSourcePose(part.partId)}
                onSelect={() => activeHandle()?.selectPart(part.partId)}
                onToggleVisibility={() => updatePart(part.partId, (current) => ({
                  ...current,
                  visible: current.visible === false,
                }))}
                part={part}
                selected={session.selectedPartId === part.partId}
              />
            );
          })}
        </div>
      </aside>

      <div
        aria-label="角色部件画布"
        className="character-assembly-preview-viewport adaptive-parts-assembly-viewport"
        ref={viewportRef}
        role="group"
        data-testid="adaptive-parts-assembly-canvas"
      >
        <div
          className="character-assembly-preview-stage"
          style={{
            height: project.height,
            left: transform.offsetX,
            top: transform.offsetY,
            transform: `scale(${transform.scale})`,
            transformOrigin: 'top left',
            width: project.width,
          }}
        >
          {[...(visual?.parts ?? [])]
            .filter((part) => part.visible !== false)
            .sort((left, right) => left.drawOrder - right.drawOrder)
            .map((part) => {
              const image = imageState.images.get(part.assetId);
              const imageTransform = part.imageTransform;
              if (!image || !imageTransform || part.source.kind !== 'adaptive-part') return null;
              const partId = part.source.characterPartId;
              const selected = session.selectedPartId === partId;
              const sourcePart = session.draft.parts.find((candidate) => candidate.partId === partId);
              const matrix = `matrix(${imageTransform.a}, ${imageTransform.b}, ${imageTransform.c}, ${imageTransform.d}, ${project.width / 2 + imageTransform.tx}, ${project.height / 2 + imageTransform.ty})`;
              return (
                <div
                  className={`adaptive-parts-assembly-canvas-part${selected ? ' is-selected' : ''}`}
                  data-part-id={partId}
                  data-testid="adaptive-parts-assembly-canvas-part"
                  key={part.partId}
                  style={{
                    height: part.localRect.height,
                    left: 0,
                    top: 0,
                    transform: matrix,
                    transformOrigin: 'top left',
                    width: part.localRect.width,
                  }}
                  onPointerDown={(event) => beginMove(event, part)}
                  role="button"
                  tabIndex={0}
                  aria-label={`选择并拖动${sourcePart?.displayName ?? assetNames.get(part.assetId) ?? '部件'}`}
                >
                  <img alt="" draggable={false} src={image.src} />

                </div>
              );
            })}
          {selectedCanvasPart && selectedCanvasImage && selectedCanvasMatrix ? (
            <div
              className="adaptive-parts-assembly-selection-outline"
              data-part-id={selectedCanvasPart.source.kind === 'adaptive-part' ? selectedCanvasPart.source.characterPartId : undefined}
              data-testid="adaptive-parts-assembly-selection-outline"
              style={{
                height: selectedCanvasPart.localRect.height,
                left: 0,
                top: 0,
                transform: selectedCanvasMatrix,
                transformOrigin: 'top left',
                width: selectedCanvasPart.localRect.width,
              }}
            >
              <button
                aria-label="调整选中部件大小"
                className="adaptive-parts-assembly-scale-handle"
                onPointerDown={(event) => beginScale(event, selectedCanvasPart)}
                type="button"
              />
            </div>
          ) : null}
        </div>
        <div className="adaptive-parts-assembly-canvas-toolbar">
          <button type="button" onClick={() => setTransform(calculateViewportTransform(
            { width: viewportRef.current?.clientWidth ?? 0, height: viewportRef.current?.clientHeight ?? 0 },
            'fit',
            { width: project.width, height: project.height },
          ))}>查看全貌</button>
        </div>
      </div>

      <aside
        aria-label="部件检查器"
        className="adaptive-parts-assembly-inspector"
        data-position={inspectorPosition.corner}
        ref={inspectorRef}
        style={{
          left: inspectorPosition.left,
          top: inspectorPosition.top,
          width: inspectorPosition.width,
        }}
      >
        {!inspectorOpen ? (
          <button
            aria-label={'\u7cbe\u8c03\u5f53\u524d\u96f6\u4ef6'}
            aria-expanded={false}
            className="adaptive-parts-inspector-toggle"
            data-testid="adaptive-parts-inspector-toggle"
            disabled={!selectedPart}
            onClick={() => setInspectorOpen(true)}
            type="button"
          >
            {'\u7cbe\u8c03'}
          </button>
        ) : selectedPart && selectedAdjustment ? (
          <div className="adaptive-parts-inspector-fields" data-testid="adaptive-parts-inspector-fields">
            <div className="adaptive-parts-inspector-heading">
              <strong title={selectedPart.displayName ?? assetNames.get(selectedPart.assetId) ?? '\u96f6\u4ef6'}>
                {selectedPart.displayName ?? assetNames.get(selectedPart.assetId) ?? '\u96f6\u4ef6'}
              </strong>
              <button
                aria-label={'\u5173\u95ed\u7cbe\u8c03\u9762\u677f'}
                className="adaptive-parts-inspector-close"
                data-testid="adaptive-parts-inspector-close"
                onClick={() => setInspectorOpen(false)}
                title={'\u5173\u95ed\u7cbe\u8c03\u9762\u677f'}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {renderAdaptiveAdjustmentField('offsetX', 'X', 'X \u504f\u79fb', 'adaptive-parts-offset-x')}
            {renderAdaptiveAdjustmentField('offsetY', 'Y', 'Y \u504f\u79fb', 'adaptive-parts-offset-y')}
            {renderAdaptiveAdjustmentField('scale', '\u5927\u5c0f', '\u5927\u5c0f\u767e\u5206\u6bd4', 'adaptive-parts-scale-percent', '%')}
            {renderAdaptiveAdjustmentField('rotationDeg', '\u65cb\u8f6c', '\u65cb\u8f6c\u89d2\u5ea6', 'adaptive-parts-rotation-deg', '\u00b0')}
          </div>
        ) : null}
      </aside>

      <footer className="character-assembly-workbench-footer adaptive-parts-assembly-footer">
        {message ? <span role="status" aria-live="polite">{message}</span> : null}
        <div className="adaptive-parts-assembly-footer-actions">
          <button data-testid="adaptive-parts-assembly-cancel" type="button" onClick={cancelDraft}>取消</button>
          <button
            data-testid="adaptive-parts-assembly-apply"
            disabled={!canApply}
            onClick={applyDraft}
            type="button"
          >
            应用更改
          </button>
        </div>
      </footer>
    </section>
  );
}

function CompositeCharacterAssemblyWorkbench({
  projectSnapshot,
  savedProjectSnapshot,
  session,
}: CharacterAssemblyWorkbenchProps & {
  session: Exclude<CharacterAssemblySnapshotUnion, AdaptivePartsAssemblySnapshot>;
}): React.JSX.Element {
  const { project, projectRoot } = projectSnapshot;
  const resolvedSavedProjectSnapshot =
    savedProjectSnapshot === undefined
      ? projectSnapshot.dirty
        ? null
        : { projectRoot, project }
      : savedProjectSnapshot;
  const savedSourceProject =
    resolvedSavedProjectSnapshot?.projectRoot === projectRoot &&
    resolvedSavedProjectSnapshot.project.id === project.id
      ? resolvedSavedProjectSnapshot.project
      : null;
  const isCreating = isCharacterCreationSnapshot(session);
  const head = session.draft.head;
  const headAssetId = head?.assetId;
  const targetCharacterId = isCreating ? null : session.characterId;
  const targetCharacter = targetCharacterId
    ? project.characters.find(
        (candidate) =>
          candidate.id === targetCharacterId && candidate.mode === 'composite',
      )
    : undefined;
  const layoutReuseSources = useMemo(
    () =>
      (savedSourceProject?.characters ?? []).flatMap((candidate): CharacterLayoutReuseCandidate[] =>
        candidate.mode === 'composite' && candidate.id !== targetCharacterId
          ? [
              {
                characterId: candidate.id,
                name: candidate.name,
                bodyAssetId: candidate.bodyAssetId,
                bodyPlacement: { ...candidate.bodyPlacement },
                facePlacement: candidate.facePlacement,
                ...(candidate.head ? { head: candidate.head } : {}),
              },
            ]
          : [],
      ),
    [savedSourceProject, targetCharacterId],
  );
  const layoutReuseTarget: CharacterLayoutReuseTarget | null =
    targetCharacter && !isCreating
      ? {
          characterId: targetCharacter.id,
          name: targetCharacter.name,
          bodyAssetId: session.draft.bodyAssetId,
          bodyPlacement: {
            ...(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT),
          },
          ...(session.draft.head ? { head: session.draft.head } : {}),
        }
      : null;
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
        (expression) =>
          expression.id ===
          (character?.mode === 'adaptive-parts'
            ? undefined
            : character?.defaultExpressionId),
      )?.id ?? expressions[0]?.id ?? ''
    );
  }, [expressions, project.characters, session]);
  const [selectedFace, setSelectedFace] = useState('');
  const [message, setMessage] = useState('');
  const [isLayoutReuseOpen, setIsLayoutReuseOpen] = useState(false);
  const [layoutReuseSourceId, setLayoutReuseSourceId] = useState('');
  const [layoutPreviewSourceId, setLayoutPreviewSourceId] =
    useState<string | null>(null);
  const [isExpressionPreviewOpen, setIsExpressionPreviewOpen] = useState(false);
  const layoutReuseBaselineRef = useRef<CharacterLayoutReuseDraftBaseline | null>(
    null,
  );
  const [isEditingNeckPivot, setIsEditingNeckPivot] = useState(false);
  const [isFineTuneOpen, setIsFineTuneOpen] = useState(false);
  const [headMotionTestToken, setHeadMotionTestToken] =
    useState<AssemblyHeadMotionTestToken | null>(null);
  const activeEditTarget =
    session.editTarget === 'head' && !head ? 'face' : session.editTarget;
  const activeEditTargetLabel =
    activeEditTarget === 'body'
      ? '身体'
      : activeEditTarget === 'head'
        ? '头部'
        : '脸部';
  const activeRotationDeg =
    activeEditTarget === 'head' && head
      ? head.placement.rotationDeg
      : activeEditTarget === 'face'
        ? session.draft.facePlacement.rotationDeg
        : 0;
  const activeFlipX =
    activeEditTarget === 'head' && head
      ? head.placement.flipX
      : activeEditTarget === 'face'
        ? session.draft.facePlacement.flipX
        : false;
  const [rotationInput, setRotationInput] = useState('0');
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
  const cameraSessionKey = `${project.id}\u0000${projectRoot}\u0000${session.sessionId}`;
  const [cameraFitMode, setCameraFitMode] = useState<'frame' | 'content'>('frame');
  const viewportRef = useRef<HTMLDivElement>(null);
  const fineTuneTriggerRef = useRef<HTMLButtonElement>(null);
  const fineTunePanelRef = useRef<HTMLDivElement>(null);
  const expressionPreviewTriggerRef = useRef<HTMLButtonElement>(null);
  const expressionPreviewPanelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<ActiveDrag | null>(null);
  const mountedRef = useRef(true);
  const cameraFitModeRef = useRef<'frame' | 'content'>('frame');
  const cameraFitBoundsRef = useRef<VisualLocalRect | null>(null);
  const latestAssemblyBoundsRef = useRef<VisualLocalRect | null>(null);
  const autoFitAttemptedForRef = useRef<string | null>(null);
  const cameraSessionKeyRef = useRef(cameraSessionKey);

  useEffect(() => {
    setRotationInput(String(activeRotationDeg));
  }, [activeEditTarget, activeRotationDeg, session.sessionId]);

  useLayoutEffect(() => {
    if (!isFineTuneOpen) return;
    const viewport = viewportRef.current;
    const panel = fineTunePanelRef.current;
    if (!viewport || !panel) return;

    const placePanel = (): void => {
      const viewportBounds = viewport.getBoundingClientRect();
      const dock = document.querySelector<HTMLElement>(
        '[data-testid="resource-activity-dock"]',
      );
      const drawer = document.querySelector<HTMLElement>(
        '[data-testid="resource-activity-drawer"]',
      );
      const drawerBounds = drawer?.getBoundingClientRect();
      const drawerStyle = drawer ? window.getComputedStyle(drawer) : null;
      const drawerOverlapsViewport = Boolean(
        drawerBounds &&
          drawerBounds.left < viewportBounds.right &&
          drawerBounds.right > viewportBounds.left &&
          drawerBounds.top < viewportBounds.bottom &&
          drawerBounds.bottom > viewportBounds.top,
      );
      const drawerCoversCanvas = Boolean(
        dock?.dataset.resourceDrawerOpen === 'true' &&
          drawerBounds &&
          drawerStyle?.display !== 'none' &&
          drawerStyle?.visibility === 'visible' &&
          Number(drawerStyle.opacity) >= 0.99 &&
          drawerBounds.width > 0 &&
          drawerBounds.height > 0 &&
          drawerOverlapsViewport,
      );
      const visibleCanvasLeft = drawerCoversCanvas && drawerBounds
        ? Math.max(viewportBounds.left, drawerBounds.right)
        : viewportBounds.left;
      const visibleCanvasRight = viewportBounds.right;
      const visibleCanvasWidth = Math.max(
        0,
        visibleCanvasRight - visibleCanvasLeft,
      );
      const contentBounds = [
        ...viewport.querySelectorAll<HTMLElement>(
          '.character-assembly-part, [data-testid="character-assembly-body-drag-target"], [data-testid="character-assembly-face-drag-target"], [data-testid="character-assembly-head-drag-fallback"], [data-testid="character-assembly-body-scale-handle"], [data-testid="character-assembly-face-scale-handle"], [data-testid="character-assembly-head-scale-handle"], [data-testid="character-assembly-head-pivot-marker"]',
        ),
      ].reduce((right, element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0
          ? {
              left: Math.min(right.left, bounds.left),
              right: Math.max(right.right, bounds.right),
            }
          : right;
      }, { left: viewportBounds.right, right: viewportBounds.left });
      const freeRightWidth = Math.floor(
        visibleCanvasRight - contentBounds.right - 16,
      );
      const freeLeftWidth = Math.floor(
        contentBounds.left - visibleCanvasLeft - 16,
      );
      const side = freeRightWidth >= 72
        ? 'right'
        : freeLeftWidth >= 72
          ? 'left'
          : 'right';
      const freeSideWidth = side === 'right' ? freeRightWidth : freeLeftWidth;
      const constrained = freeSideWidth < 72;
      const width = constrained
        ? Math.min(280, Math.max(0, visibleCanvasWidth - 16))
        : Math.min(280, freeSideWidth);
      panel.style.width = `${width}px`;
      panel.style.left = side === 'left'
        ? `${visibleCanvasLeft - viewportBounds.left + 8}px`
        : 'auto';
      panel.style.right = side === 'right' ? '8px' : 'auto';
      panel.dataset.overlaySide = side;
      panel.dataset.overlayLayout =
        constrained
          ? 'constrained'
          : width < 160
            ? 'narrow'
            : 'regular';
    };

    placePanel();
    const observer = new ResizeObserver(placePanel);
    observer.observe(viewport);
    const drawer = document.querySelector<HTMLElement>(
      '[data-testid="resource-activity-drawer"]',
    );
    if (drawer) observer.observe(drawer);
    window.addEventListener('resize', placePanel);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', placePanel);
    };
  }, [activeEditTarget, head, isFineTuneOpen, transform.offsetX, transform.offsetY, transform.scale]);

  useEffect(() => {
    if (!isFineTuneOpen && !isExpressionPreviewOpen) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (
        isFineTuneOpen &&
        !fineTunePanelRef.current?.contains(event.target) &&
        !fineTuneTriggerRef.current?.contains(event.target)
      ) {
        setIsFineTuneOpen(false);
      }
      if (
        isExpressionPreviewOpen &&
        !expressionPreviewPanelRef.current?.contains(event.target) &&
        !expressionPreviewTriggerRef.current?.contains(event.target)
      ) {
        setIsExpressionPreviewOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (isFineTuneOpen) {
        setIsFineTuneOpen(false);
        window.requestAnimationFrame(() => fineTuneTriggerRef.current?.focus());
      }
      if (isExpressionPreviewOpen) {
        setIsExpressionPreviewOpen(false);
        window.requestAnimationFrame(() => expressionPreviewTriggerRef.current?.focus());
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isExpressionPreviewOpen, isFineTuneOpen]);

  useEffect(() => {
    setSelectedFace(defaultExpressionId);
    setMessage('');
    setIsLayoutReuseOpen(false);
    setLayoutReuseSourceId('');
    setLayoutPreviewSourceId(null);
    setIsExpressionPreviewOpen(false);
    setIsFineTuneOpen(false);
    layoutReuseBaselineRef.current = null;
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
  const selectedLayoutReuseSource = layoutReuseSources.find(
    (candidate) => candidate.characterId === layoutReuseSourceId,
  ) ?? null;
  const imageAssets = useMemo(() => {
    const assetIds = new Set([
      session.draft.bodyAssetId,
      previewFaceAssetId,
      ...(head ? [head.assetId] : []),
      ...(savedSourceProject && selectedLayoutReuseSource
        ? [
            selectedLayoutReuseSource.bodyAssetId,
            ...(selectedLayoutReuseSource.head
              ? [selectedLayoutReuseSource.head.assetId]
              : []),
          ]
        : []),
    ]);
    const assetsById = new Map<string, CanvasImageAssetSource>();
    for (const asset of [
      ...project.assets,
      ...(savedSourceProject?.assets ?? []),
    ]) {
      if (!assetIds.has(asset.id) || asset.kind !== 'image') continue;
      assetsById.set(asset.id, {
        id: asset.id,
        ...(asset.sha256 ? { sha256: asset.sha256 } : {}),
      });
    }
    return [...assetsById.values()];
  }, [
    head,
    previewFaceAssetId,
    project.assets,
    savedSourceProject,
    selectedLayoutReuseSource,
    session.draft.bodyAssetId,
  ]);
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
  const assemblyImageAssetIds = [
    bodyPart?.assetId,
    headPart?.assetId,
    facePart?.assetId,
  ].filter((assetId): assetId is string => Boolean(assetId));
  const imageBoundsByAssetId = useMemo(() => {
    const bounds = new Map<string, NormalizedImageBounds | null>();
    for (const assetId of new Set(assemblyImageAssetIds)) {
      const image = imageState.images.get(assetId);
      if (image) bounds.set(assetId, measureImageVisibleBounds(image));
    }
    return bounds;
  }, [bodyPart?.assetId, facePart?.assetId, headPart?.assetId, imageState.images]);
  const bodyContentRect = bodyPart
    ? visibleImageRect(
        bodyPart.localRect,
        imageBoundsByAssetId.get(bodyPart.assetId),
      )
    : null;
  const faceContentRect = facePart
    ? visibleImageRect(
        facePart.localRect,
        imageBoundsByAssetId.get(facePart.assetId),
      )
    : null;
  const assemblyVisibleBounds = useMemo(
    () => calculateAssemblyVisibleBounds(visual, imageBoundsByAssetId),
    [imageBoundsByAssetId, visual],
  );
  latestAssemblyBoundsRef.current = assemblyVisibleBounds;
  const assemblyImagesSettled = assemblyImageAssetIds.length > 0 &&
    assemblyImageAssetIds.every(
      (assetId) => imageState.images.has(assetId) || imageState.missing.has(assetId),
    );
  const currentLayoutReuseAssets = useMemo(
    () => layoutReuseImageAssets(project.assets),
    [project.assets],
  );
  const savedLayoutReuseAssets = useMemo(
    () =>
      savedSourceProject
        ? layoutReuseImageAssets(savedSourceProject.assets)
        : [],
    [savedSourceProject],
  );
  const loadedLayoutImageDimensions = useMemo(() => {
    const dimensions = new Map<string, CharacterLayoutReuseImageDimensions>();
    for (const [assetId, image] of imageState.images) {
      dimensions.set(assetId, {
        width: image.naturalWidth,
        height: image.naturalHeight,
      });
    }
    return dimensions;
  }, [imageState.images]);
  const layoutReuseAssessment = useMemo(
    () =>
      layoutReuseTarget
        ? assessCharacterLayoutReuse({
            sourceIsSaved: Boolean(savedSourceProject && selectedLayoutReuseSource),
            source: selectedLayoutReuseSource,
            target: layoutReuseTarget,
            assets: [...savedLayoutReuseAssets, ...currentLayoutReuseAssets],
            sourceAssets: savedLayoutReuseAssets,
            targetAssets: currentLayoutReuseAssets,
            loadedImages: loadedLayoutImageDimensions,
            missingAssetIds: imageState.missing,
          })
        : null,
    [
      imageState.missing,
      currentLayoutReuseAssets,
      layoutReuseTarget,
      loadedLayoutImageDimensions,
      selectedLayoutReuseSource,
      savedLayoutReuseAssets,
      savedSourceProject,
    ],
  );
  const layoutReuseStatusMessage = !savedSourceProject
    ? '请先保存项目。'
    : layoutReuseSources.length === 0
      ? '暂无可用角色。'
      : !layoutReuseSourceId
        ? ''
        : !selectedLayoutReuseSource
          ? '所选来源已不可用，请重新选择。'
          : layoutReuseAssessment && !layoutReuseAssessment.ok
            ? layoutReuseFailureMessage(layoutReuseAssessment.code)
            : '';
  const headImageBounds = headPart
    ? imageBoundsByAssetId.get(headPart.assetId) ?? null
    : null;
  const headContentRect = headPart && headImageBounds
    ? visibleImageRect(headPart.localRect, headImageBounds)
    : null;

  const getAssemblyCameraTransform = useCallback(
    (mode: 'frame' | 'content', bounds: VisualLocalRect | null) => {
      const viewport = viewportRef.current;
      const logicalFrame = { width: project.width, height: project.height };
      if (!viewport) {
        return calculateViewportTransform(
          { width: 0, height: 0 },
          'fit',
          logicalFrame,
        );
      }
      const container = {
        width: viewport.clientWidth,
        height: viewport.clientHeight,
      };
      if (mode === 'content' && bounds) {
        return calculateAssemblyFitViewportTransform(
          container,
          logicalFrame,
          bounds,
          assemblyViewportFitArea(viewport, fineTunePanelRef.current),
        );
      }
      return calculateViewportTransform(container, 'fit', logicalFrame);
    },
    [project.height, project.width],
  );

  const markCameraInteraction = useCallback(() => {
    autoFitAttemptedForRef.current = cameraSessionKey;
  }, [cameraSessionKey]);

  const showAllParts = (): void => {
    autoFitAttemptedForRef.current = cameraSessionKey;
    const bounds = latestAssemblyBoundsRef.current;
    const mode = bounds ? 'content' : 'frame';
    cameraFitModeRef.current = mode;
    cameraFitBoundsRef.current = mode === 'content' ? bounds : null;
    setCameraFitMode(mode);
    setTransform(getAssemblyCameraTransform(mode, bounds));
  };

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
    if (cameraSessionKeyRef.current === cameraSessionKey) return;
    cameraSessionKeyRef.current = cameraSessionKey;
    autoFitAttemptedForRef.current = null;
    cameraFitModeRef.current = 'frame';
    cameraFitBoundsRef.current = null;
    setCameraFitMode('frame');
    setTransform(getAssemblyCameraTransform('frame', null));
  }, [cameraSessionKey, getAssemblyCameraTransform]);

  useLayoutEffect(() => {
    if (autoFitAttemptedForRef.current === cameraSessionKey) return;
    if (!visual || !assemblyImagesSettled) return;
    autoFitAttemptedForRef.current = cameraSessionKey;
    if (
      !assemblyBoundsExceedFrame(assemblyVisibleBounds, {
        width: project.width,
        height: project.height,
      })
    ) {
      return;
    }
    cameraFitModeRef.current = 'content';
    cameraFitBoundsRef.current = assemblyVisibleBounds;
    setCameraFitMode('content');
    setTransform(getAssemblyCameraTransform('content', assemblyVisibleBounds));
  }, [
    assemblyImagesSettled,
    assemblyVisibleBounds,
    cameraSessionKey,
    getAssemblyCameraTransform,
    project.height,
    project.width,
    visual,
  ]);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const update = (): void => {
      if (cameraFitModeRef.current === 'content') {
        const bounds = latestAssemblyBoundsRef.current ?? cameraFitBoundsRef.current;
        if (bounds) cameraFitBoundsRef.current = bounds;
        setTransform(getAssemblyCameraTransform('content', bounds));
        return;
      }
      setTransform(getAssemblyCameraTransform('frame', null));
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [getAssemblyCameraTransform]);

  const updateFacePlacement = (placement: FacePlacement): boolean => {
    const result = isCreating
      ? activeCreationHandle(session)?.updateDraft({ facePlacement: placement })
      : activeAssemblyHandle(session)?.updateDraft({ facePlacement: placement });
    if (!result) {
      setMessage('组装草稿已失效，请重新打开角色组装。');
      return false;
    }
    if (!result.ok) {
      setMessage(result.error.message);
      return false;
    }
    setMessage('');
    return true;
  };

  const updateBodyPlacement = (placement: BodyPlacement): boolean => {
    const result = isCreating
      ? activeCreationHandle(session)?.updateDraft({ bodyPlacement: placement })
      : activeAssemblyHandle(session)?.updateDraft({ bodyPlacement: placement });
    if (!result) {
      setMessage('组装草稿已失效，请重新打开角色组装。');
      return false;
    }
    if (!result.ok) {
      setMessage(result.error.message);
      return false;
    }
    setMessage('');
    return true;
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
      dragRef.current = null;
    }
    return true;
  };

  const adjustHeadScale = (delta: number): void => {
    if (!head) return;
    const scale = Number(
      Math.min(
        CHARACTER_PART_MAX_SCALE,
        Math.max(CHARACTER_PART_MIN_SCALE, head.placement.scale + delta),
      ).toFixed(2),
    );
    updateHead({
      ...head,
      placement: { ...head.placement, scale },
    });
  };

  const adjustBodyScale = (delta: number): void => {
    const placement = session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT;
    const scale = Number(
      Math.min(
        CHARACTER_PART_MAX_SCALE,
        Math.max(CHARACTER_PART_MIN_SCALE, placement.scale + delta),
      ).toFixed(2),
    );
    updateBodyPlacement({ ...placement, scale });
  };

  const nudgeBody = (dx: number, dy: number): void => {
    const placement = session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT;
    updateBodyPlacement({
      ...placement,
      offsetX: placement.offsetX + dx,
      offsetY: placement.offsetY + dy,
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

  const toggleNeckPivotEditing = (): void => {
    if (!head || isTestingHeadMotion) return;
    dragRef.current = null;
    setIsExpressionPreviewOpen(false);
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
    const target = definition.kind === 'scale'
      ? definition.target
      : definition.kind;
    if (target === 'pivot') {
      if (!isEditingNeckPivot) return;
    } else if (activeEditTarget !== target || isEditingNeckPivot) {
      return;
    }
    dragRef.current = {
      ...definition,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const beginPartScaleDrag = (
    event: React.PointerEvent<HTMLElement>,
    target: CharacterAssemblyEditTarget,
  ): void => {
    const viewportElement = viewportRef.current;
    if (!viewportElement) return;
    if (target === 'head' && !head) return;
    const viewport = viewportElement.getBoundingClientRect();
    const safeScale = Math.max(transform.scale, 0.0001);
    const placement = target === 'body'
      ? session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT
      : target === 'head' && head
        ? head.placement
        : session.draft.facePlacement;
    const centerX =
      viewport.left + viewportElement.clientLeft + transform.offsetX +
      (project.width / 2 + placement.offsetX) * safeScale;
    const centerY =
      viewport.top + viewportElement.clientTop + transform.offsetY +
      (project.height / 2 + placement.offsetY) * safeScale;
    const geometry = {
      centerX,
      centerY,
      startDistance: Math.max(
        1,
        Math.hypot(event.clientX - centerX, event.clientY - centerY),
      ),
    };
    const definition: ActiveScaleDragDefinition = target === 'body'
      ? {
          kind: 'scale',
          target,
          placement: { ...(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT) },
          ...geometry,
        }
      : target === 'face'
        ? {
            kind: 'scale',
            target,
            placement: { ...session.draft.facePlacement },
            ...geometry,
          }
        : {
            kind: 'scale',
            target,
            head: {
              ...head!,
              placement: { ...head!.placement },
              pivot: { ...head!.pivot },
            },
            ...geometry,
          };
    beginPointerDrag(event, definition);
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
    } else if (drag.kind === 'body') {
      updateBodyPlacement({
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
    } else if (drag.kind === 'scale') {
      const currentDistance = Math.hypot(
        event.clientX - drag.centerX,
        event.clientY - drag.centerY,
      );
      if (drag.target === 'body') {
        updateBodyPlacement({
          ...drag.placement,
          scale: characterPartScaleFromPointerDistance(
            drag.placement.scale,
            drag.startDistance,
            currentDistance,
          ),
        });
      } else if (drag.target === 'face') {
        updateFacePlacement({
          ...drag.placement,
          scale: characterPartScaleFromPointerDistance(
            drag.placement.scale,
            drag.startDistance,
            currentDistance,
          ),
        });
      } else {
        updateHead({
          ...drag.head,
          placement: {
            ...drag.head.placement,
            scale: characterPartScaleFromPointerDistance(
              drag.head.placement.scale,
              drag.startDistance,
              currentDistance,
            ),
          },
        });
      }
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
      Math.min(
        CHARACTER_PART_MAX_SCALE,
        Math.max(
          CHARACTER_PART_MIN_SCALE,
          session.draft.facePlacement.scale + delta,
        ),
      ).toFixed(2),
    );
    updateFacePlacement({ ...session.draft.facePlacement, scale });
  };

  const adjustPartScale = (
    target: CharacterAssemblyEditTarget,
    delta: number,
  ): void => {
    if (target === 'body') {
      adjustBodyScale(delta);
    } else if (target === 'head') {
      adjustHeadScale(delta);
    } else {
      adjustScale(delta);
    }
  };

  const setTargetRotation = (rotationDeg: number): boolean => {
    if (
      activeEditTarget === 'body' ||
      !Number.isFinite(rotationDeg) ||
      rotationDeg < -180 ||
      rotationDeg > 180
    ) {
      return false;
    }
    const updated =
      activeEditTarget === 'head' && head
        ? updateHead({
            ...head,
            placement: { ...head.placement, rotationDeg },
          })
        : updateFacePlacement({
            ...session.draft.facePlacement,
            rotationDeg,
          });
    if (updated) setRotationInput(String(rotationDeg));
    return updated;
  };

  const toggleTargetFlipX = (): void => {
    if (activeEditTarget === 'body') return;
    if (activeEditTarget === 'head' && head) {
      updateHead({
        ...head,
        placement: { ...head.placement, flipX: !head.placement.flipX },
      });
      return;
    }
    updateFacePlacement({
      ...session.draft.facePlacement,
      flipX: !session.draft.facePlacement.flipX,
    });
  };

  const resetPlacement = (): void => {
    if (activeEditTarget === 'body') {
      updateBodyPlacement({ ...DEFAULT_BODY_PLACEMENT });
      return;
    }
    if (activeEditTarget === 'head' && head) {
      updateHead({
        ...head,
        placement: {
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          rotationDeg: 0,
          flipX: false,
        },
      });
      return;
    }
    updateFacePlacement({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
    });
  };

  useEffect(() => {
    setHeadMotionTestToken(null);
    dragRef.current = null;
    setIsEditingNeckPivot(false);
    setIsFineTuneOpen(false);
  }, [session.generation, session.sessionId]);

  useLayoutEffect(() => {
    dragRef.current = null;
    setHeadMotionTestToken(null);
    setIsEditingNeckPivot(false);
  }, [headAssetId, session.editTarget]);

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
      layoutReuseBaselineRef.current = null;
      setLayoutPreviewSourceId(null);
      setMessage('');
      return;
    }
    layoutReuseBaselineRef.current = null;
    setLayoutPreviewSourceId(null);
    setMessage('');
  };

  const revert = (): void => {
    if (isCreating) return;
    layoutReuseBaselineRef.current = null;
    setLayoutPreviewSourceId(null);
    setIsLayoutReuseOpen(false);
    setLayoutReuseSourceId('');
    setHeadMotionTestToken(null);
    dragRef.current = null;
    const result = characterAssemblySessionStore.begin(session.characterId);
    if (!result.ok) setMessage(result.error.message);
    else setMessage('');
  };

  const previewCharacterLayout = (): void => {
    if (!layoutReuseTarget || !selectedLayoutReuseSource) {
      setMessage(layoutReuseStatusMessage);
      return;
    }
    if (!layoutReuseAssessment?.ok) {
      setMessage(layoutReuseAssessment?.reason ?? layoutReuseStatusMessage);
      return;
    }
    const handle = activeAssemblyHandle(session);
    if (!handle) {
      setMessage('组装草稿已失效，请重新打开角色组装。');
      return;
    }
    const baseline: CharacterLayoutReuseDraftBaseline = {
      facePlacement: { ...session.draft.facePlacement },
      ...(session.draft.head
        ? {
            head: {
              assetId: session.draft.head.assetId,
              placement: { ...session.draft.head.placement },
              pivot: { ...session.draft.head.pivot },
            },
          }
        : {}),
    };
    const result = handle.updateDraft(
      buildCharacterLayoutReuseUpdate(
        selectedLayoutReuseSource,
        layoutReuseTarget,
      ),
    );
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    layoutReuseBaselineRef.current ??= baseline;
    setLayoutPreviewSourceId(selectedLayoutReuseSource.characterId);
    setMessage('');
  };

  const cancelCharacterLayoutPreview = (): void => {
    const baseline = layoutReuseBaselineRef.current;
    if (!baseline) {
      setLayoutPreviewSourceId(null);
      return;
    }
    const handle = activeAssemblyHandle(session);
    if (!handle) {
      setMessage('组装草稿已失效，请重新打开角色组装。');
      return;
    }
    const result = handle.updateDraft({
      facePlacement: { ...baseline.facePlacement },
      ...(baseline.head
        ? {
            head: {
              assetId: baseline.head.assetId,
              placement: { ...baseline.head.placement },
              pivot: { ...baseline.head.pivot },
            },
          }
        : {}),
    });
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    layoutReuseBaselineRef.current = null;
    setLayoutPreviewSourceId(null);
    setMessage('');
  };

  const left = project.width / 2;
  const top = project.height / 2;
  const bodyHandlePoint = bodyContentRect
    ? {
        x: bodyContentRect.x + bodyContentRect.width,
        y: bodyContentRect.y + bodyContentRect.height,
      }
    : null;
  const faceHandleRect = facePart
    ? transformVisualRectByPart(
        faceContentRect ?? facePart.localRect,
        facePart,
      )
    : null;
  const faceHandlePoint = faceHandleRect
    ? {
        x: faceHandleRect.x + faceHandleRect.width,
        y: faceHandleRect.y + faceHandleRect.height,
      }
    : null;
  const headHandleRect = headPart
    ? transformVisualRectByPart(
        headContentRect ?? headPart.localRect,
        headPart,
      )
    : null;
  const headHandlePoint =
    headHandleRect
      ? {
          x: headHandleRect.x + headHandleRect.width,
          y: headHandleRect.y + headHandleRect.height,
        }
      : null;

  return (
    <section
      aria-label="角色组装工作区"
      className="character-assembly-workbench"
      data-camera-fit-bounds={assemblyVisibleBounds
        ? [
            assemblyVisibleBounds.x,
            assemblyVisibleBounds.y,
            assemblyVisibleBounds.width,
            assemblyVisibleBounds.height,
          ].join(',')
        : ''}
      data-camera-fit-mode={cameraFitMode}
      data-camera-fit-scale={transform.scale}
      data-body-asset-id={session.draft.bodyAssetId}
      data-body-offset-x={(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT).offsetX}
      data-body-offset-y={(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT).offsetY}
      data-body-scale={(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT).scale}
      data-character-id={isCreating ? '' : session.characterId}
      data-face-offset-x={session.draft.facePlacement.offsetX}
      data-face-offset-y={session.draft.facePlacement.offsetY}
      data-face-scale={session.draft.facePlacement.scale}
      data-face-rotation-deg={session.draft.facePlacement.rotationDeg}
      data-face-flip-x={session.draft.facePlacement.flipX}
      data-head-asset-id={head?.assetId ?? ''}
      data-head-offset-x={head?.placement.offsetX ?? ''}
      data-head-offset-y={head?.placement.offsetY ?? ''}
      data-head-scale={head?.placement.scale ?? ''}
      data-head-rotation-deg={head?.placement.rotationDeg ?? ''}
      data-head-flip-x={head?.placement.flipX ?? ''}
      data-head-pivot-x={head?.pivot.x ?? ''}
      data-head-pivot-y={head?.pivot.y ?? ''}
      data-head-motion-test-running={isTestingHeadMotion}
      data-project-revision={projectSnapshot.revision}
      data-project-dirty={projectSnapshot.dirty}
      data-edit-target={activeEditTarget}
      data-neck-pivot-editing={isEditingNeckPivot}
      data-layout-preview-source-id={layoutPreviewSourceId ?? ''}
      data-layout-reuse-open={isLayoutReuseOpen}
      data-has-head={Boolean(head)}
      data-preview-face-asset-id={facePart?.assetId ?? ''}
      data-selected-face={selectedFace}
      data-session-kind={isCreating ? 'create' : 'edit'}
      data-testid="character-assembly-workbench"
      onKeyDownCapture={(event) => {
        if (event.key !== 'Tab') markCameraInteraction();
      }}
      onPointerDownCapture={markCameraInteraction}
    >
      <div
        aria-label="角色组装预览"
        className="character-assembly-preview-viewport"
        data-camera-fit-mode={cameraFitMode}
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
          {activeEditTarget === 'body' && !isEditingNeckPivot && bodyPart && bodyContentRect ? (
            <div
              aria-label="拖动身体调整位置，使用方向键微调"
              aria-roledescription="可拖动身体"
              aria-disabled={isTestingHeadMotion}
              className="character-assembly-body-hit-area"
              data-testid="character-assembly-body-drag-target"
              onKeyDown={(event) => {
                if (isTestingHeadMotion) return;
                const step = event.shiftKey ? 10 : 1;
                if (event.key === 'ArrowLeft') nudgeBody(-step, 0);
                else if (event.key === 'ArrowRight') nudgeBody(step, 0);
                else if (event.key === 'ArrowUp') nudgeBody(0, -step);
                else if (event.key === 'ArrowDown') nudgeBody(0, step);
                else return;
                event.preventDefault();
              }}
              onLostPointerCapture={stopPointerDrag}
              onPointerCancel={stopPointerDrag}
              onPointerDown={(event) =>
                beginPointerDrag(event, {
                  kind: 'body',
                  placement: {
                    ...(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT),
                  },
                })
              }
              onPointerMove={movePointerDrag}
              onPointerUp={endPointerDrag}
              role="group"
              style={{
                height: bodyContentRect.height,
                left: left + bodyContentRect.x,
                pointerEvents: isTestingHeadMotion ? 'none' : undefined,
                top: top + bodyContentRect.y,
                width: bodyContentRect.width,
              }}
              tabIndex={isTestingHeadMotion ? -1 : 0}
            />
          ) : null}
          {activeEditTarget === 'body' && !isEditingNeckPivot && bodyHandlePoint ? (
            <button
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
              aria-label="调整身体大小；拖动右下角方块等比例缩放，方向键微调"
              className="character-assembly-scale-handle"
              data-scale={(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT).scale}
              data-testid="character-assembly-body-scale-handle"
              disabled={isTestingHeadMotion}
              onKeyDown={(event) => {
                const step = event.shiftKey ? 0.25 : 0.05;
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === '+') {
                  adjustPartScale('body', step);
                } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === '-') {
                  adjustPartScale('body', -step);
                } else return;
                event.preventDefault();
              }}
              onLostPointerCapture={stopPointerDrag}
              onPointerCancel={stopPointerDrag}
              onPointerDown={(event) => beginPartScaleDrag(event, 'body')}
              onPointerMove={movePointerDrag}
              onPointerUp={endPointerDrag}
              style={{
                left: left + bodyHandlePoint.x,
                top: top + bodyHandlePoint.y,
                transform: `translate(-50%, -50%) scale(${1 / Math.max(transform.scale, 0.0001)})`,
              }}
              type="button"
            >
              <span aria-hidden="true" />
            </button>
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
                  transform: `rotate(${headPart.rotationDeg}deg) scaleX(${headPart.flipX ? -1 : 1})`,
                  transformOrigin: 'center',
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
                  transform: `rotate(${facePart.rotationDeg}deg) scaleX(${facePart.flipX ? -1 : 1})`,
                  transformOrigin: 'center',
                  width: facePart.localRect.width,
                }}
              />
            ) : null}
            {activeEditTarget === 'face' && !isEditingNeckPivot && facePart && faceContentRect ? (
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
                  height: faceContentRect.height,
                  left: left + faceContentRect.x,
                  pointerEvents: isTestingHeadMotion ? 'none' : undefined,
                  top: top + faceContentRect.y,
                  transform: `rotate(${facePart.rotationDeg}deg) scaleX(${facePart.flipX ? -1 : 1})`,
                  transformOrigin: `${facePart.localRect.x + facePart.localRect.width / 2 - faceContentRect.x}px ${facePart.localRect.y + facePart.localRect.height / 2 - faceContentRect.y}px`,
                  width: faceContentRect.width,
                }}
                tabIndex={isTestingHeadMotion ? -1 : 0}
              />
            ) : null}
            {activeEditTarget === 'face' && !isEditingNeckPivot && faceHandlePoint ? (
              <button
                aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
                aria-label="调整脸部大小；拖动右下角方块等比例缩放，方向键微调"
                className="character-assembly-scale-handle"
                data-scale={session.draft.facePlacement.scale}
                data-testid="character-assembly-face-scale-handle"
                disabled={isTestingHeadMotion}
                onKeyDown={(event) => {
                  const step = event.shiftKey ? 0.25 : 0.05;
                  if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === '+') {
                    adjustPartScale('face', step);
                  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === '-') {
                    adjustPartScale('face', -step);
                  } else return;
                  event.preventDefault();
                }}
                onLostPointerCapture={stopPointerDrag}
                onPointerCancel={stopPointerDrag}
                onPointerDown={(event) => beginPartScaleDrag(event, 'face')}
                onPointerMove={movePointerDrag}
                onPointerUp={endPointerDrag}
                style={{
                  left: left + faceHandlePoint.x,
                  top: top + faceHandlePoint.y,
                  transform: `translate(-50%, -50%) scale(${1 / Math.max(transform.scale, 0.0001)})`,
                }}
                type="button"
              >
                <span aria-hidden="true" />
              </button>
            ) : null}
            {head && activeEditTarget === 'head' && !isEditingNeckPivot ? (
              <>
                {headContentRect && headPart ? (
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
                      transform: `rotate(${head.placement.rotationDeg}deg) scaleX(${head.placement.flipX ? -1 : 1})`,
                      transformOrigin: `${headPart.localRect.x + headPart.localRect.width / 2 - headContentRect.x}px ${headPart.localRect.y + headPart.localRect.height / 2 - headContentRect.y}px`,
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
                {headHandleRect && headHandlePoint ? (
                  <button
                    aria-label="调整头部大小，拖动或用方向键微调"
                    className="character-assembly-scale-handle character-assembly-head-scale-handle"
                    data-scale={head.placement.scale}
                    data-testid="character-assembly-head-scale-handle"
                    disabled={isTestingHeadMotion}
                    onKeyDown={(event) => {
                      const step = event.shiftKey ? 0.25 : 0.05;
                      if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === '+') {
                        adjustPartScale('head', step);
                      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === '-') {
                        adjustPartScale('head', -step);
                      } else return;
                      event.preventDefault();
                    }}
                    onLostPointerCapture={stopPointerDrag}
                    onPointerCancel={stopPointerDrag}
                    onPointerDown={(event) => beginPartScaleDrag(event, 'head')}
                    onPointerMove={movePointerDrag}
                    onPointerUp={endPointerDrag}
                    style={{
                      left: left + headHandlePoint.x,
                      top: top + headHandlePoint.y,
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
          {isFineTuneOpen && !isEditingNeckPivot ? (
            <div
              aria-label={`${activeEditTargetLabel}精调`}
              className="character-assembly-fine-tune-panel"
              id="character-assembly-fine-tune-panel"
              data-testid="character-assembly-fine-tune-panel"
              ref={fineTunePanelRef}
              role="group"
            >
              {activeEditTarget === 'body' ? (
                <>
                  <div aria-label="身体左右位置" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">身体左右</span>
                    <button aria-label="向左移动身体" data-testid="character-assembly-body-left-step" disabled={isTestingHeadMotion} onClick={() => nudgeBody(-1, 0)} type="button">−</button>
                    <output aria-label="身体水平位置" data-testid="character-assembly-body-offset-x">{(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT).offsetX.toFixed(1)}</output>
                    <button aria-label="向右移动身体" data-testid="character-assembly-body-right-step" disabled={isTestingHeadMotion} onClick={() => nudgeBody(1, 0)} type="button">+</button>
                  </div>
                  <div aria-label="身体上下位置" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">身体上下</span>
                    <button aria-label="向上移动身体" data-testid="character-assembly-body-up-step" disabled={isTestingHeadMotion} onClick={() => nudgeBody(0, -1)} type="button">−</button>
                    <output aria-label="身体垂直位置" data-testid="character-assembly-body-offset-y">{(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT).offsetY.toFixed(1)}</output>
                    <button aria-label="向下移动身体" data-testid="character-assembly-body-down-step" disabled={isTestingHeadMotion} onClick={() => nudgeBody(0, 1)} type="button">+</button>
                  </div>
                  <div aria-label="身体大小" className="character-assembly-control-set" role="group">
                    <span className="character-assembly-control-label">身体大小</span>
                    <button aria-label="缩小身体" data-testid="character-assembly-body-scale-down" disabled={isTestingHeadMotion} onClick={() => adjustBodyScale(-0.05)} type="button">−</button>
                    <output aria-label="身体大小" data-testid="character-assembly-body-scale">{(session.draft.bodyPlacement ?? DEFAULT_BODY_PLACEMENT).scale.toFixed(2)}×</output>
                    <button aria-label="放大身体" data-testid="character-assembly-body-scale-up" disabled={isTestingHeadMotion} onClick={() => adjustBodyScale(0.05)} type="button">+</button>
                  </div>
                </>
              ) : activeEditTarget === 'head' && head ? (
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
              {activeEditTarget !== 'body' ? <div
                aria-label={`${activeEditTargetLabel}角度`}
                className="character-assembly-control-set character-assembly-angle-control"
                data-testid="character-assembly-angle-control"
                role="group"
              >
                <span className="character-assembly-control-label">角度</span>
                <button
                  aria-label="逆时针旋转1度，按住 Shift 旋转10度"
                  data-testid={
                    activeEditTarget === 'head'
                      ? 'character-assembly-head-rotation-down'
                    : 'character-assembly-face-rotation-down'
                  }
                  disabled={isTestingHeadMotion}
                  onClick={(event) =>
                    setTargetRotation(
                      activeRotationDeg - (event.shiftKey ? 10 : 1),
                    )
                  }
                  type="button"
                >
                  −
                </button>
                <input
                  aria-keyshortcuts="ArrowLeft ArrowRight Shift+ArrowLeft Shift+ArrowRight"
                  aria-label={`${activeEditTargetLabel}角度，−180度至180度`}
                  data-testid={
                    activeEditTarget === 'head'
                      ? 'character-assembly-head-rotation'
                      : 'character-assembly-face-rotation'
                  }
                  disabled={isTestingHeadMotion}
                  max={180}
                  min={-180}
                  onBlur={() => setRotationInput(String(activeRotationDeg))}
                  onChange={(event) => {
                    const raw = event.currentTarget.value;
                    setRotationInput(raw);
                    const value = parseAssemblyRotationInput(raw);
                    if (value !== null) {
                      setTargetRotation(value);
                    }
                  }}
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 10 : 1;
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
                      event.preventDefault();
                      setTargetRotation(activeRotationDeg - step);
                    } else if (
                      event.key === 'ArrowRight' ||
                      event.key === 'ArrowUp'
                    ) {
                      event.preventDefault();
                      setTargetRotation(activeRotationDeg + step);
                    }
                  }}
                  step={1}
                  type="number"
                  value={rotationInput}
                />
                <button
                  aria-label="顺时针旋转1度，按住 Shift 旋转10度"
                  data-testid={
                    activeEditTarget === 'head'
                      ? 'character-assembly-head-rotation-up'
                      : 'character-assembly-face-rotation-up'
                  }
                  disabled={isTestingHeadMotion}
                  onClick={(event) =>
                    setTargetRotation(
                      activeRotationDeg + (event.shiftKey ? 10 : 1),
                    )
                  }
                  type="button"
                >
                  +
                </button>
              </div> : null}
              {activeEditTarget !== 'body' ? <button
                aria-label={`${activeEditTargetLabel}水平翻转`}
                aria-pressed={activeFlipX}
                className="character-assembly-flip-toggle"
                data-testid={
                  activeEditTarget === 'head'
                    ? 'character-assembly-head-flip-x'
                    : 'character-assembly-face-flip-x'
                }
                disabled={isTestingHeadMotion}
                onClick={toggleTargetFlipX}
                type="button"
              >
                {activeFlipX ? '已翻转' : '水平翻转'}
              </button> : null}
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
              aria-label="查看角色全貌"
              className="character-assembly-view-all-toggle"
              data-testid="character-assembly-view-all"
              onClick={showAllParts}
              type="button"
            >
              查看全貌
            </button>
            <button
              aria-expanded={isFineTuneOpen}
              aria-controls="character-assembly-fine-tune-panel"
              className="character-assembly-fine-tune-toggle"
              data-testid="character-assembly-fine-tune-toggle"
              ref={fineTuneTriggerRef}
              disabled={isEditingNeckPivot || isTestingHeadMotion}
              onClick={() => {
                setIsExpressionPreviewOpen(false);
                setIsFineTuneOpen((open) => !open);
              }}
              type="button"
            >
              精调
            </button>
            {layoutReuseTarget ? (
              <button
                aria-expanded={isLayoutReuseOpen}
                className="character-assembly-layout-reuse-toggle"
                data-testid="character-assembly-layout-reuse-toggle"
                disabled={isEditingNeckPivot || isTestingHeadMotion}
                onClick={() => setIsLayoutReuseOpen((open) => !open)}
                type="button"
              >
                套用布局
              </button>
            ) : null}
            {head ? (
              <>
                <button
                  aria-pressed={isTestingHeadMotion}
                  className="character-assembly-test-head-motion-toggle"
                  data-testid="character-assembly-test-head-motion"
                  onClick={toggleHeadMotionTest}
                  type="button"
                >
                  {isTestingHeadMotion ? '■ 停止测试' : '▶ 预览点头'}
                </button>
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
          <div className="character-assembly-expression-preview">
            <button
              aria-controls="character-assembly-expression-preview-options"
              aria-expanded={isExpressionPreviewOpen}
              className="character-assembly-expression-preview-toggle"
              data-testid="character-assembly-expression-preview-toggle"
              ref={expressionPreviewTriggerRef}
              onClick={() => {
                setIsFineTuneOpen(false);
                setIsExpressionPreviewOpen((open) => !open);
              }}
              type="button"
            >
              预览表情
            </button>
            {isExpressionPreviewOpen ? (
              <div
                aria-label="预览表情"
                className="character-assembly-expression-preview-options"
                data-testid="character-assembly-expression-preview-options"
                id="character-assembly-expression-preview-options"
                ref={expressionPreviewPanelRef}
                role="group"
              >
                {isCreating ? (
                  <button
                    aria-pressed={selectedFace !== '$mouth'}
                    data-testid="character-assembly-expression-choice"
                    onClick={() => {
                      setSelectedFace(defaultExpressionId);
                      setIsExpressionPreviewOpen(false);
                      window.requestAnimationFrame(() => expressionPreviewTriggerRef.current?.focus());
                    }}
                    type="button"
                  >
                    默认
                  </button>
                ) : (
                  expressions.map((expression) => (
                    <button
                      aria-pressed={selectedFace === expression.id}
                      data-expression-id={expression.id}
                      data-testid="character-assembly-expression-choice"
                      key={expression.id}
                      onClick={() => {
                        setSelectedFace(expression.id);
                        setIsExpressionPreviewOpen(false);
                        window.requestAnimationFrame(() => expressionPreviewTriggerRef.current?.focus());
                      }}
                      type="button"
                    >
                      {expression.name}
                    </button>
                  ))
                )}
                {hasMouth ? (
                  <button
                    aria-pressed={selectedFace === '$mouth'}
                    data-testid="character-assembly-expression-mouth"
                    onClick={() => {
                      setSelectedFace('$mouth');
                      setIsExpressionPreviewOpen(false);
                      window.requestAnimationFrame(() => expressionPreviewTriggerRef.current?.focus());
                    }}
                    type="button"
                  >
                    张嘴
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          </div>
          {isLayoutReuseOpen && layoutReuseTarget ? (
            <div
              aria-label="套用已有角色布局"
              className="character-assembly-layout-reuse-panel"
              data-testid="character-assembly-layout-reuse-panel"
              role="group"
            >
              <label htmlFor="character-assembly-layout-reuse-source">
                已保存角色
              </label>
              <select
                aria-label="布局来源角色"
                data-testid="character-assembly-layout-reuse-source"
                disabled={!savedSourceProject || layoutReuseSources.length === 0}
                id="character-assembly-layout-reuse-source"
                onChange={(event) => {
                  setLayoutReuseSourceId(event.currentTarget.value);
                  setMessage('');
                }}
                value={layoutReuseSourceId}
              >
                <option value="">选择同项目角色</option>
                {layoutReuseSources.map((candidate) => (
                  <option
                    data-character-id={candidate.characterId}
                    key={candidate.characterId}
                    value={candidate.characterId}
                  >
                    {candidate.name}
                    {candidate.head ? '（含头部）' : '（无头部）'}
                  </option>
                ))}
              </select>
              <button
                aria-label="预览所选角色布局"
                data-testid="character-assembly-layout-reuse-preview"
                disabled={
                  !layoutReuseAssessment?.ok ||
                  isEditingNeckPivot ||
                  isTestingHeadMotion
                }
                onClick={previewCharacterLayout}
                type="button"
              >
                预览布局
              </button>
              {layoutPreviewSourceId ? (
                <button
                  data-testid="character-assembly-layout-reuse-cancel"
                  onClick={cancelCharacterLayoutPreview}
                  type="button"
                >
                  取消预览
                </button>
              ) : null}
              <output
                aria-live="polite"
                className="character-assembly-layout-reuse-status"
                data-testid="character-assembly-layout-reuse-status"
                role="status"
              >
                {layoutPreviewSourceId ? (
                  <span data-testid="character-assembly-layout-reuse-active-preview">
                    预览中
                  </span>
                ) : null}
                {layoutReuseStatusMessage ? (
                  <span data-testid="character-assembly-layout-reuse-compatibility">
                    {layoutReuseStatusMessage}
                  </span>
                ) : null}
              </output>
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
