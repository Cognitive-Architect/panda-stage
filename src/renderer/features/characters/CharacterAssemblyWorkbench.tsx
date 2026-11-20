import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Eye, EyeOff, Minus, MoreHorizontal, Pencil, Plus, RotateCcw } from 'lucide-react';
import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  DEFAULT_CHARACTER_PART_STATIC_ADJUSTMENT,
  DEFAULT_BODY_PLACEMENT,
  calculateViewportTransform,
  characterPartPlacementForReplacement,
  characterPartSourceBounds,
  characterPartTransformFromStaticAdjustment,
  evaluateFlaGraphicVisual,
  hasRenderableFlaGraphicSubtree,
  isFlaGraphicDefinition,
  removeAdaptivePartFromDefinition,
  resolveCharacterPartVisualSource,
  scanAdaptivePartReferences,
  selectFlaGraphicSubtreeVisual,
  transformVisualRectByPart,
  type AdaptivePartsCharacterDefinition,
  type CharacterPartStaticAdjustment,
  type FlaGraphicDefinition,
  type ImageAsset,
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
import { renderFlaGraphicCanvas } from '../canvas/flaGraphicCanvasRenderer';
import { GraphicFacePreview } from './GraphicFacePicker';
import { CharacterResourceSwapDialog } from './CharacterResourceSwapDialog';
import { useProjectImageThumbnails } from './CharacterIdentity';
import { ThumbnailStateIcon } from './ThumbnailStateIcon';
import { measureImageVisibleBounds } from './measureImageVisibleBounds';
import { localizeDefaultAdaptivePartName } from './characterPartDisplayName';
import { VisibleBoundsThumbnail } from './VisibleBoundsThumbnail';
import {
  buildCharacterAssemblyPreviewVisual,
  buildAdaptivePartsAssemblyPreviewVisual,
  characterLocalPointerDelta,
  characterPartScaleFromPointerDistance,
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
import { AdaptiveCharacterManagement } from './AdaptiveCharacterManagement';
import {
  placeCharacterInCurrentShot,
  type AdaptivePartsAssemblyActionResult,
  type AdaptivePartsAssemblyActionsRef,
} from './CharacterManager';
import { characterStore } from '../../stores/characterStore';
import { shotStore } from '../../stores/shotStore';

interface CharacterAssemblyWorkbenchProps {
  projectSnapshot: EditorProjectSnapshot;
  savedProjectSnapshot?: SavedEditorProjectSnapshot | null;
  session: CharacterAssemblySnapshotUnion;
  adaptivePartsActionsRef?: AdaptivePartsAssemblyActionsRef;
  floatingComposite?: {
    editable: boolean;
    leftOpen: boolean;
    propertiesOpen: boolean;
    controlsOpen: boolean;
    propertyTarget: HTMLElement | null;
    onToggleControls: () => void;
  };
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

function assemblyViewportFitArea(
  viewport: HTMLDivElement,
  fineTunePanel: HTMLDivElement | null,
  floating = false,
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
  if (floating) {
    const root = viewport.closest('.character-float-detail');
    for (const panel of root?.querySelectorAll('.character-float-panel[data-expanded="true"]') ?? []) {
      const bounds = panel.getBoundingClientRect();
      occlusions.push(new DOMRect(bounds.x - 8, viewportBounds.top, bounds.width + 16, viewportBounds.height));
    }
  }
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
  if (fineTunePanel && !floating) {
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
  floatingComposite,
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
      floatingComposite={floatingComposite}
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

function adaptivePartCanvasCssMatrix(
  part: Pick<LayerVisualPart, 'localRect' | 'imageTransform'>,
  stageWidth: number,
  stageHeight: number,
): string | null {
  const transform = part.imageTransform;
  if (!transform) return null;
  const tx =
    stageWidth / 2 +
    transform.a * part.localRect.x +
    transform.c * part.localRect.y +
    transform.tx;
  const ty =
    stageHeight / 2 +
    transform.b * part.localRect.x +
    transform.d * part.localRect.y +
    transform.ty;
  return `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${tx}, ${ty})`;
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

const expiredAdaptivePartsDraftMessage = '\u7ec4\u88c5\u8349\u7a3f\u5df2\u5931\u6548\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u3002';

export function resolveAdaptivePartsDefinitionUpdate(
  handle: AdaptivePartsAssemblySessionHandle | null,
  update: (definition: AdaptivePartsCharacterDefinition) => AdaptivePartsCharacterDefinition,
): AdaptivePartsUpdateResult {
  if (!handle) return { ok: false, message: expiredAdaptivePartsDraftMessage };
  const current = handle.getSnapshot();
  if (!current) return { ok: false, message: expiredAdaptivePartsDraftMessage };
  const result = handle.setDraft(update(current.draft));
  if (!result.ok) return { ok: false, message: result.error.message };
  return { ok: true };
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

const ADAPTIVE_PART_OVERFLOW_MENU_WIDTH = 160;
const ADAPTIVE_PART_OVERFLOW_MENU_MIN_HEIGHT = 132;
const ADAPTIVE_PART_OVERFLOW_MENU_GAP = 4;
const ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN = 8;

function AdaptivePartsContextMenu({
  canRemove,
  canReplace,
  disabled,
  displayName,
  onRemove,
  onRename,
  onReplace,
}: {
  canRemove: boolean;
  canReplace: boolean;
  disabled: boolean;
  displayName: string;
  onRemove: () => void;
  onRename: () => void;
  onReplace: () => void;
}): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return undefined;

    const isPopoverOpen = (): boolean => {
      try {
        return popover.matches(':popover-open');
      } catch {
        return false;
      }
    };

    const hidePopoverSafely = (): void => {
      if (isPopoverOpen() && typeof popover.hidePopover === 'function') {
        popover.hidePopover();
      }
    };

    const positionPopover = (force = false): void => {
      if (!force && !isPopoverOpen()) return;
      const anchor = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if (
        viewportWidth <= 0 ||
        viewportHeight <= 0 ||
        anchor.bottom <= 0 ||
        anchor.top >= viewportHeight
      ) {
        hidePopoverSafely();
        return;
      }

      const computedWidth = Number.parseFloat(getComputedStyle(popover).width);
      const width = Math.min(
        Number.isFinite(computedWidth) && computedWidth > 0
          ? computedWidth
          : ADAPTIVE_PART_OVERFLOW_MENU_WIDTH,
        Math.max(0, viewportWidth - ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN * 2),
      );
      const measuredHeight = popover.scrollHeight || ADAPTIVE_PART_OVERFLOW_MENU_MIN_HEIGHT;
      const height = Math.max(ADAPTIVE_PART_OVERFLOW_MENU_MIN_HEIGHT, measuredHeight);
      const spaceBelow =
        viewportHeight - anchor.bottom - ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN;
      const spaceAbove = anchor.top - ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN;
      const opensAbove =
        spaceBelow < height + ADAPTIVE_PART_OVERFLOW_MENU_GAP && spaceAbove > spaceBelow;
      const availableSpace = Math.max(
        0,
        (opensAbove ? spaceAbove : spaceBelow) - ADAPTIVE_PART_OVERFLOW_MENU_GAP,
      );
      const visibleHeight = Math.min(height, availableSpace);
      const maxLeft = Math.max(
        0,
        viewportWidth - width - ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN,
      );
      const left = Math.max(
        ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN,
        Math.min(anchor.right - width, maxLeft),
      );
      const top = opensAbove
        ? Math.max(
            ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN,
            anchor.top - ADAPTIVE_PART_OVERFLOW_MENU_GAP - visibleHeight,
          )
        : Math.min(
            viewportHeight - ADAPTIVE_PART_OVERFLOW_MENU_VIEWPORT_MARGIN - visibleHeight,
            anchor.bottom + ADAPTIVE_PART_OVERFLOW_MENU_GAP,
          );

      popover.style.width = `${width}px`;
      popover.style.maxHeight = `${availableSpace}px`;
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
      popover.dataset.placement = opensAbove ? 'above' : 'below';
    };

    const onBeforeToggle = (event: Event): void => {
      if ((event as Event & { newState?: string }).newState === 'open') {
        positionPopover(true);
      }
    };
    const onToggle = (): void => {
      const nextOpen = isPopoverOpen();
      setOpen(nextOpen);
      if (nextOpen) positionPopover(true);
    };
    const onViewportMove = (): void => positionPopover();
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (
        isPopoverOpen() &&
        target instanceof Node &&
        !trigger.contains(target) &&
        !popover.contains(target)
      ) {
        hidePopoverSafely();
      }
    };

    popover.addEventListener('beforetoggle', onBeforeToggle);
    popover.addEventListener('toggle', onToggle);
    document.addEventListener('scroll', onViewportMove, true);
    document.addEventListener('focusin', onFocusIn, true);
    window.addEventListener('resize', onViewportMove);
    window.visualViewport?.addEventListener('resize', onViewportMove);
    window.visualViewport?.addEventListener('scroll', onViewportMove);
    return () => {
      popover.removeEventListener('beforetoggle', onBeforeToggle);
      popover.removeEventListener('toggle', onToggle);
      document.removeEventListener('scroll', onViewportMove, true);
      document.removeEventListener('focusin', onFocusIn, true);
      window.removeEventListener('resize', onViewportMove);
      window.visualViewport?.removeEventListener('resize', onViewportMove);
      window.visualViewport?.removeEventListener('scroll', onViewportMove);
    };
  }, []);

  const runAction = (action: () => void): void => {
    const popover = popoverRef.current;
    if (popover && typeof popover.hidePopover === 'function') {
      try {
        if (popover.matches(':popover-open')) popover.hidePopover();
      } catch {
        // Ignore in environments without native popover support.
      }
    }
    action();
  };

  return (
    <div
      className="adaptive-parts-row-overflow"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        const popover = popoverRef.current;
        try {
          if (popover?.matches(':popover-open')) {
            event.stopPropagation();
          }
        } catch {
          // Ignore in environments without native popover support.
        }
      }}
    >
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-label={`${displayName} 更多操作`}
        className="adaptive-parts-row-action adaptive-parts-row-overflow-trigger"
        data-testid="adaptive-parts-row-overflow-trigger"
        disabled={disabled}
        popoverTarget={id}
        popoverTargetAction="toggle"
        ref={triggerRef}
        title={`${displayName} 更多操作`}
        type="button"
      >
        <MoreHorizontal aria-hidden="true" size={18} />
      </button>
      <div
        aria-label={`${displayName} 更多操作`}
        className="adaptive-parts-row-overflow-menu"
        data-testid="adaptive-parts-row-overflow-menu"
        id={id}
        popover="auto"
        ref={popoverRef}
        role="group"
      >
        <button
          className="adaptive-parts-overflow-item"
          data-testid="adaptive-parts-rename-button"
          onClick={() => runAction(onRename)}
          type="button"
        >
          重命名
        </button>
        <button
          aria-label={`替换${displayName}素材`}
          className="adaptive-parts-overflow-item"
          data-testid="adaptive-parts-replace-button"
          disabled={!canReplace}
          onClick={() => runAction(onReplace)}
          title={canReplace ? '替换此零件素材' : '当前项目没有可替换的素材'}
          type="button"
        >
          替换素材
        </button>
        <button
          aria-label={`从角色移除${displayName}`}
          className="adaptive-parts-overflow-item adaptive-parts-overflow-item-danger"
          data-testid="adaptive-parts-remove-button"
          disabled={!canRemove}
          onClick={() => runAction(onRemove)}
          title={canRemove ? '从当前角色移除此零件（不删除源素材）' : '角色至少需要保留一个零件'}
          type="button"
        >
          从角色移除
        </button>
      </div>
    </div>
  );
}

function AdaptivePartsAssemblyRow({
  displayName,
  imageMissing,
  imageCacheKey,
  imageSrc,
  onEdit,
  onMessage,
  onRenameEnd,
  onRename,
  onRestore,
  onSelect,
  onToggleVisibility,
  part,
  renaming,
  selected,
}: {
  displayName: string;
  imageMissing: boolean;
  imageCacheKey: string;
  imageSrc?: string;
  onEdit: () => void;
  onRenameEnd: () => void;
  onMessage: (message: string) => void;
  onRename: (name: string) => AdaptivePartsUpdateResult;
  onRestore: () => void;
  onSelect: () => void;
  onToggleVisibility: () => void;
  part: AdaptivePartsCharacterPart;
  renaming: boolean;
  selected: boolean;
}): React.JSX.Element {
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFinishedRef = useRef(false);
  const [renameValue, setRenameValue] = useState(displayName);
  const [renameError, setRenameError] = useState('');
  const visible = part.visible !== false;

  useEffect(() => {
    if (!renaming) return;
    renameFinishedRef.current = false;
    setRenameValue(displayName);
    setRenameError('');
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [displayName, renaming]);

  const finishRename = (): boolean => {
    const completion = resolveAdaptivePartRename(renameValue, displayName, onRename);
    if (!completion.ok) {
      setRenameError(completion.error);
      onMessage(completion.error);
      return false;
    }
    renameFinishedRef.current = true;
    setRenameError('');
    onRenameEnd();
    onMessage('');
    return true;
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
              <VisibleBoundsThumbnail
                alt=""
                cacheKey={imageCacheKey}
                src={imageSrc}
              />
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
                  event.stopPropagation();
                  renameFinishedRef.current = true;
                  setRenameValue(displayName);
                  setRenameError('');
                  onRenameEnd();
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
              <VisibleBoundsThumbnail
                alt=""
                cacheKey={imageCacheKey}
                src={imageSrc}
              />
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
        {visible ? (
          <Eye aria-hidden="true" size={18} />
        ) : (
          <EyeOff aria-hidden="true" size={18} />
        )}
      </button>
      <button
        aria-label={`精调${displayName}`}
        className="adaptive-parts-row-action"
        data-testid="adaptive-parts-edit-button"
        onClick={onEdit}
        title={`精调${displayName}`}
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

function adaptiveCharacterPartIdOf(part: LayerVisualPart): string | null {
  return part.source.kind === 'adaptive-part' ||
    part.source.kind === 'adaptive-part-fla-graphic'
    ? part.source.characterPartId
    : null;
}

function renderAdaptivePartsAssemblyGraphicDataUrl(
  rendered: ReturnType<typeof renderFlaGraphicCanvas>,
): string | null {
  if (!rendered) return null;
  try {
    return rendered.canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

const EMPTY_SWAP_IMAGE_ASSETS: readonly ImageAsset[] = [];

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
  const assemblyCharacter = project.characters.find(
    (character) => character.id === session.characterId,
  );
  const assemblyCharacterName = assemblyCharacter?.name ?? '角色';
  const viewportRef = useRef<HTMLDivElement>(null);
  const operationsRef = useRef<HTMLElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const operationsHandleRef = useRef<HTMLButtonElement>(null);
  const inspectorHandleRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const dragRef = useRef<AdaptivePartPointerDrag | null>(null);
  const [transform, setTransform] = useState(() =>
    calculateViewportTransform({ width: 0, height: 0 }, 'fit', {
      width: project.width,
      height: project.height,
    }),
  );
  const [imageState, setImageState] = useState(EMPTY_CANVAS_IMAGE_STATE);
  const [operationsOpen, setOperationsOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [inspectorContext, setInspectorContext] = useState<'part' | 'character'>('part');
  const [renamingPartId, setRenamingPartId] = useState<string | null>(null);
  const [numericDrafts, setNumericDrafts] = useState<AdaptiveAdjustmentDrafts>({});
  const numericInitialValuesRef = useRef<
    Record<string, Partial<Record<AdaptiveAdjustmentField, number>>>
  >({});
  const [message, setMessage] = useState('');
  const [replacingPartId, setReplacingPartId] = useState<string | null>(null);
  const replaceTriggerRef = useRef<HTMLElement | null>(null);
  const projectImageAssets = useMemo(
    () =>
      project.assets.filter(
        (asset): asset is ImageAsset => asset.kind === 'image',
      ),
    [project.assets],
  );
  const {
    thumbnails: adaptiveSwapThumbnails,
    onThumbnailError: onAdaptiveSwapThumbnailError,
  } = useProjectImageThumbnails(
    projectRoot,
    replacingPartId ? projectImageAssets : EMPTY_SWAP_IMAGE_ASSETS,
    project,
  );
  const structuredGraphics = useMemo(
    () =>
      project.animations.filter(
        (animation): animation is FlaGraphicDefinition =>
          isFlaGraphicDefinition(animation) && Boolean(animation.structure),
      ),
    [project.animations],
  );
  const structuredGraphicById = useMemo(
    () => new Map(structuredGraphics.map((graphic) => [graphic.id, graphic] as const)),
    [structuredGraphics],
  );
  const visual = useMemo(
    () => buildAdaptivePartsAssemblyPreviewVisual(project, session),
    [project, session],
  );
  const imageAssets = useMemo(() => {
    const ids = new Set<string>();
    for (const part of session.draft.parts) {
      const visualSource = resolveCharacterPartVisualSource(part);
      if (visualSource.kind === 'image') {
        ids.add(visualSource.assetId);
      } else {
        const definition = structuredGraphicById.get(visualSource.animationId);
        if (definition) {
          const evaluatedGraphic = evaluateFlaGraphicVisual({
            definition,
            frameOrdinal:
              visualSource.poseFrameOrdinal ?? (definition.frames[0]?.ordinal ?? 0),
            mode: 'instance',
            instanceTransformOverrides: visualSource.instanceTransformOverrides,
          });
          const resolvedGraphic =
            evaluatedGraphic && visualSource.nodePath
              ? selectFlaGraphicSubtreeVisual(evaluatedGraphic, visualSource.nodePath)
              : evaluatedGraphic;
          for (const assetId of resolvedGraphic?.resourceAssetIds ?? []) {
            ids.add(assetId);
          }
        }
      }
    }
    return project.assets.flatMap((asset): CanvasImageAssetSource[] =>
      asset.kind === 'image' && ids.has(asset.id)
        ? [{ id: asset.id, ...(asset.sha256 ? { sha256: asset.sha256 } : {}) }]
        : [],
    );
  }, [project.assets, session.draft.parts, structuredGraphicById]);
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
  const readVisibleBounds = useRef<() => VisualLocalRect | null>(() => null);
  const refitAfterNarrowCollapse = useRef(false);
  const fitPreview = useCallback((): void => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const container = { width: viewport.clientWidth, height: viewport.clientHeight };
    const occlusions = [operationsRef.current, inspectorRef.current].flatMap((panel) => {
      if (!panel || panel.dataset.expanded !== 'true') return [];
      const width = panel.offsetWidth + 8;
      return [{
        x: panel === operationsRef.current ? 0 : Math.max(0, container.width - width),
        y: 0,
        width,
        height: container.height,
      }];
    });
    const area = largestUnoccludedAssemblyViewportRect(container, occlusions);
    const logicalFrame = { width: project.width, height: project.height };
    const visibleBounds = inspectorRef.current?.dataset.expanded === 'true' ? readVisibleBounds.current() : null;
    if (visibleBounds) {
      setTransform(calculateAssemblyFitViewportTransform(container, logicalFrame, visibleBounds, area));
      return;
    }
    const next = calculateViewportTransform(area, 'fit', logicalFrame);
    setTransform({ ...next, container, offsetX: next.offsetX + area.x, offsetY: next.offsetY + area.y });
  }, [project.height, project.width]);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    fitPreview();
    const observer = new ResizeObserver(() => {
      if (viewport.clientWidth < 720 &&
          inspectorRef.current?.dataset.expanded === 'true' &&
          operationsRef.current?.dataset.expanded === 'true') {
        if (operationsRef.current?.contains(document.activeElement)) inspectorHandleRef.current?.focus();
        refitAfterNarrowCollapse.current = true;
        setOperationsOpen(false);
        return;
      }
      fitPreview();
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [fitPreview]);
  const previousPanels = useRef({ operationsOpen: true, inspectorOpen: false });
  useLayoutEffect(() => {
    const previous = previousPanels.current;
    previousPanels.current = { operationsOpen, inspectorOpen };
    if (refitAfterNarrowCollapse.current ||
        (operationsOpen && !previous.operationsOpen) || (inspectorOpen && !previous.inspectorOpen)) {
      refitAfterNarrowCollapse.current = false;
      fitPreview();
    }
  }, [fitPreview, inspectorOpen, operationsOpen]);

  const isNarrow = (): boolean => {
    const width = viewportRef.current?.clientWidth ?? 0;
    return width > 0 && width < 720;
  };
  const openInspector = (context: 'part' | 'character', focus = true): void => {
    if (isNarrow()) setOperationsOpen(false);
    setInspectorContext(context);
    setInspectorOpen(true);
    if (focus) inspectorHandleRef.current?.focus();
  };
  const toggleOperations = (): void => {
    if (!operationsOpen && isNarrow()) setInspectorOpen(false);
    setOperationsOpen(!operationsOpen);
  };

  const activeHandle = (): AdaptivePartsAssemblySessionHandle | null => {
    const handle = characterAssemblySessionStore.getActiveAdaptivePartsAssemblySessionHandle();
    return handle?.sessionId === session.sessionId && handle.generation === session.generation
      ? handle
      : null;
  };
  const setDefinition = (
    update: (definition: AdaptivePartsCharacterDefinition) => AdaptivePartsCharacterDefinition,
  ): AdaptivePartsUpdateResult => {
    const result = resolveAdaptivePartsDefinitionUpdate(activeHandle(), update);
    if (!result.ok) {
      if (result.message) setMessage(result.message);
      return result;
    }
    setMessage('');
    return result;
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
    const bounds = characterPartSourceBounds(part, project.animations, project.assets);
    if (!bounds) return { ok: false };
    try {
      const sourceRestTransform = part.sourceRestTransform ?? part.restTransform;
      const restTransform = characterPartTransformFromStaticAdjustment(
        current.sourceRootTransform,
        sourceRestTransform,
        bounds,
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
  };
  const replacePartWithGraphic = (partId: string, animationId: string): void => {
    if (!animationId) return;
    const definition = structuredGraphicById.get(animationId);
    if (!definition) {
      setMessage('\u672a\u627e\u5230\u53ef\u7528\u7684\u7ed3\u6784\u5316 FLA \u5143\u4ef6\u3002');
      return;
    }
    const current = activeHandle()?.getSnapshot()?.draft;
    const existingPart = current?.parts.find((candidate) => candidate.partId === partId);
    if (!current || !existingPart) return;
    const oldBounds = characterPartSourceBounds(existingPart, project.animations, project.assets);
    if (!oldBounds) return;
    const replacementPlacement = characterPartPlacementForReplacement({
      sourceRootTransform: current.sourceRootTransform,
      oldRestTransform: existingPart.restTransform,
      oldBounds,
      newBounds: {
        x: 0,
        y: 0,
        width: definition.source.canvas.width,
        height: definition.source.canvas.height,
      },
    });
    const result = updatePart(partId, (candidate) => {
      const nextPart: typeof candidate = {
        ...candidate,
        visualSource: {
          kind: 'fla-graphic',
          animationId: definition.id,
        },
        sourceRestTransform: replacementPlacement.sourceRestTransform,
        restTransform: replacementPlacement.restTransform,
        staticAdjustment: replacementPlacement.staticAdjustment,
      };
      delete nextPart.assetId;
      delete nextPart.imageMapping;
      return nextPart;
    });
    if (result.ok) {
      setNumericDrafts((drafts) => {
        if (!(partId in drafts)) return drafts;
        const next = { ...drafts };
        delete next[partId];
        return next;
      });
      delete numericInitialValuesRef.current[partId];
      setReplacingPartId((currentPartId) => (currentPartId === partId ? null : currentPartId));
      setMessage('');
    }
  };
  const replacePartWithImage = (partId: string, assetId: string): void => {
    if (!assetId) return;
    const asset = projectImageAssets.find((candidate) => candidate.id === assetId);
    if (!asset) {
      setMessage('未找到可用的图片素材。');
      return;
    }
    const current = activeHandle()?.getSnapshot()?.draft;
    const existingPart = current?.parts.find((candidate) => candidate.partId === partId);
    if (!current || !existingPart) return;
    const oldBounds = characterPartSourceBounds(existingPart, project.animations, project.assets);
    if (!oldBounds) return;
    const replacementPlacement = characterPartPlacementForReplacement({
      sourceRootTransform: current.sourceRootTransform,
      oldRestTransform: existingPart.restTransform,
      oldBounds,
      newBounds: {
        x: 0,
        y: 0,
        width: asset.width,
        height: asset.height,
      },
    });
    const result = updatePart(partId, (candidate) => {
      const nextPart: typeof candidate = {
        ...candidate,
        assetId: asset.id,
        imageMapping: {
          sourceWidth: asset.width,
          sourceHeight: asset.height,
          crop: {
            x: 0,
            y: 0,
            width: asset.width,
            height: asset.height,
          },
          exportScale: 1,
        },
        sourceRestTransform: replacementPlacement.sourceRestTransform,
        restTransform: replacementPlacement.restTransform,
        staticAdjustment: replacementPlacement.staticAdjustment,
      };
      delete nextPart.visualSource;
      return nextPart;
    });
    if (result.ok) {
      setNumericDrafts((drafts) => {
        if (!(partId in drafts)) return drafts;
        const next = { ...drafts };
        delete next[partId];
        return next;
      });
      delete numericInitialValuesRef.current[partId];
      setReplacingPartId((currentPartId) => (currentPartId === partId ? null : currentPartId));
      setMessage('');
    }
  };
  const removePart = (partId: string): void => {
    const current = activeHandle()?.getSnapshot()?.draft;
    if (!current) {
      setMessage(expiredAdaptivePartsDraftMessage);
      return;
    }
    if (current.parts.length <= 1) {
      setMessage('角色至少需要保留一个零件。');
      return;
    }
    const refs = scanAdaptivePartReferences(project, session.characterId, partId);
    if (refs.layerCount > 0 || refs.animatedLayerCount > 0) {
      const scope = refs.keyframeCount > 0
        ? `此零件当前被 ${refs.shotCount} 个镜头使用，并包含 ${refs.keyframeCount} 个关键帧。`
        : `此零件当前被 ${refs.shotCount} 个镜头使用。`;
      if (
        !window.confirm(
          `${scope}从角色移除后，应用更改将同步清理相关动画轨道，不会删除源素材。确认移除？`,
        )
      ) {
        return;
      }
    }
    const result = setDefinition((definition) =>
      removeAdaptivePartFromDefinition(definition, partId),
    );
    if (result.ok) {
      setNumericDrafts((drafts) => {
        if (!(partId in drafts)) return drafts;
        const next = { ...drafts };
        delete next[partId];
        return next;
      });
      delete numericInitialValuesRef.current[partId];
      setReplacingPartId((currentPartId) => (currentPartId === partId ? null : currentPartId));
      setMessage('');
    }
  };
  const selectedPart = session.draft.parts.find(
    (part) => part.partId === session.selectedPartId,
  ) ?? null;
  const selectedPartVisualSource = selectedPart
    ? resolveCharacterPartVisualSource(selectedPart)
    : null;
  const selectedAdjustment = selectedPart
    ? adjustmentOf(selectedPart.partId)
    : null;
  const selectedCanvasPart = (visual?.parts ?? []).find((part) =>
    adaptiveCharacterPartIdOf(part) === session.selectedPartId &&
    part.visible !== false,
  ) ?? null;
  const graphicPartRasters = useMemo(() => {
    const result = new Map<
      string,
      {
        readonly rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
        readonly dataUrl: string;
        readonly canvasWidth: number;
        readonly visibleRect: VisualLocalRect | null;
      }
    >();
    const sourceByPartId = new Map(
      session.draft.parts.map((draftPart) => [
        draftPart.partId,
        resolveCharacterPartVisualSource(draftPart),
      ]),
    );
    for (const part of visual?.parts ?? []) {
      const characterPartId = adaptiveCharacterPartIdOf(part);
      if (!characterPartId || !part.flaGraphic) continue;
      const partSource = sourceByPartId.get(characterPartId);
      if (
        partSource?.kind === 'fla-graphic' &&
        partSource.nodePath &&
        !hasRenderableFlaGraphicSubtree(part.flaGraphic)
      ) {
        continue;
      }
      const rendered = renderFlaGraphicCanvas(part.flaGraphic, imageState.images);
      if (
        partSource?.kind === 'fla-graphic' &&
        partSource.nodePath &&
        !rendered?.visibleRect
      ) {
        continue;
      }
      const dataUrl = renderAdaptivePartsAssemblyGraphicDataUrl(rendered);
      if (rendered && dataUrl) {
        result.set(characterPartId, {
          rect: rendered.rect,
          dataUrl,
          canvasWidth: part.flaGraphic.canvas.width,
          visibleRect: rendered.visibleRect,
        });
      }
    }
    return result;
  }, [visual?.parts, imageState.images, session.draft.parts]);
  readVisibleBounds.current = () => {
    if (!visual) return null;
    const imageBounds = new Map<string, NormalizedImageBounds | null>();
    const parts = visual.parts.flatMap((part) => {
      if (part.visible === false) return [];
      if (part.flaGraphic) {
        const partId = adaptiveCharacterPartIdOf(part);
        const bounds = partId ? graphicPartRasters.get(partId)?.visibleRect : null;
        if (!bounds) return [];
        return [{
          ...part,
          assetId: undefined,
          localRect: {
            ...bounds,
            x: bounds.x + part.flaGraphic.canvas.width / 2,
            y: bounds.y + part.flaGraphic.canvas.height / 2,
          },
        }];
      }
      const image = part.assetId ? imageState.images.get(part.assetId) : undefined;
      if (!image || !part.assetId) return [];
      imageBounds.set(part.assetId, measureImageVisibleBounds(image));
      return [part];
    });
    return calculateAssemblyVisibleBounds({ ...visual, parts, headPart: null }, imageBounds);
  };
  const selectedCanvasReady = selectedCanvasPart
    ? selectedCanvasPart.flaGraphic
      ? graphicPartRasters.has(session.selectedPartId ?? '')
      : Boolean(selectedCanvasPart.assetId && imageState.images.get(selectedCanvasPart.assetId))
    : false;
  const selectedCanvasMatrix = selectedCanvasPart
    ? adaptivePartCanvasCssMatrix(selectedCanvasPart, project.width, project.height)
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
  const assetThumbnailKeys = new Map(
    project.assets.flatMap((asset) => asset.kind === 'image'
      ? [[
          asset.id,
          asset.sha256
            ? `sha256:${asset.sha256}`
            : `asset:${project.id}:${asset.id}`,
        ] as const]
      : []),
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
  const selectPart = (partId: string, edit = false): boolean => {
    if (!activeHandle()?.selectPart(partId)) return false;
    if (edit) openInspector('part');
    else if (inspectorOpen) setInspectorContext('part');
    return true;
  };
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
    const partId = adaptiveCharacterPartIdOf(part);
    if (!partId) return;
    if (!selectPart(partId)) return;
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
    const partId = adaptiveCharacterPartIdOf(part);
    if (!partId) return;
    if (!selectPart(partId)) return;
    event.preventDefault();
    event.stopPropagation();
    const center = partPoint(
      part,
      part.localRect.x + part.localRect.width / 2,
      part.localRect.y + part.localRect.height / 2,
    );
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
    if (result !== undefined) return;
    if (adaptivePartsActionsRef) {
      if (
        isCharacterAssemblyPending(project, session) &&
        !window.confirm('组装更改尚未应用，返回将放弃这些更改。继续吗？')
      ) {
        return;
      }
      activeHandle()?.cancel();
      return;
    }
    setMessage('\u8fd4\u56de\u89d2\u8272\u5217\u8868\u64cd\u4f5c\u4e0d\u53ef\u7528\uff0c\u8bf7\u91cd\u65b0\u6253\u5f00\u89d2\u8272\u3002');
  };
  const fallbackJoinCurrentShot = (): AdaptivePartsAssemblyActionResult => {
    let joinMessage = '';
    const joined = placeCharacterInCurrentShot({
      characterId: session.characterId,
      getCurrentCharacterId: () => session.characterId,
      defaultTransformPending: false,
      leaveAssembly: () =>
        !isCharacterAssemblyPending(project, session) ||
        window.confirm('组装更改尚未应用，加入镜头前将放弃这些更改。继续吗？'),
      reportStatus: (nextMessage) => {
        joinMessage = nextMessage;
        setMessage(nextMessage);
      },
    });
    if (!joined) return { ok: false, ...(joinMessage ? { message: joinMessage } : {}) };
    activeHandle()?.cancel();
    return { ok: true };
  };
  const joinCurrentShot = (): void => {
    const joinAction =
      adaptivePartsActionsRef?.current?.joinCurrentShot ??
      (adaptivePartsActionsRef ? fallbackJoinCurrentShot : undefined);
    if (!joinAction) {
      setMessage('\u52a0\u5165\u955c\u5934\u64cd\u4f5c\u4e0d\u53ef\u7528\uff0c\u8bf7\u8fd4\u56de\u89d2\u8272\u5217\u8868\u540e\u91cd\u8bd5\u3002');
      return;
    }
    const result = joinAction();
    if (!result?.ok) {
      if (result?.message) setMessage(result.message);
      return;
    }
    setMessage('');
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
                event.stopPropagation();
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
  };
  const partsListPanel = (
    <aside
      aria-label="部件列表"
      className="adaptive-parts-float adaptive-parts-float-operations"
      data-expanded={operationsOpen}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !operationsOpen) return;
        event.stopPropagation();
        setOperationsOpen(false);
        operationsHandleRef.current?.focus();
      }}
      ref={operationsRef}
    >
      <button
        aria-controls={panelId + '-operations'}
        aria-expanded={operationsOpen}
        aria-label={operationsOpen ? '收起零件操作' : '展开零件操作'}
        className="adaptive-parts-float-handle"
        data-testid="adaptive-parts-operations-toggle"
        onClick={toggleOperations}
        ref={operationsHandleRef}
        title={operationsOpen ? '收起零件操作' : '展开零件操作'}
        type="button"
      >
        <span className="quick-action-drawer-grip" aria-hidden="true" />
      </button>
      <div className="adaptive-parts-assembly-list" id={panelId + '-operations'} inert={!operationsOpen}>
        <div className="adaptive-parts-list-heading">
          <h2 data-testid="adaptive-parts-assembly-count">部件 · {rows.length}</h2>
          <AdaptivePartsContextMenu
            canRemove={rows.length > 1}
            canReplace={projectImageAssets.length > 0 || structuredGraphics.length > 0}
            disabled={!selectedPart}
            displayName={selectedPart?.displayName ? localizeDefaultAdaptivePartName(selectedPart.displayName) : '零件'}
            onRemove={() => { if (selectedPart) removePart(selectedPart.partId); }}
            onRename={() => setRenamingPartId(selectedPart?.partId ?? null)}
            onReplace={() => {
              if (!selectedPart) return;
              replaceTriggerRef.current =
                operationsRef.current?.querySelector<HTMLElement>(
                  '[data-testid="adaptive-parts-row-overflow-trigger"]',
                ) ?? null;
              setReplacingPartId(selectedPart.partId);
            }}
          />
        </div>
        <div className="adaptive-parts-assembly-rows">
          {rows.map((part) => {
            const visualSource = resolveCharacterPartVisualSource(part);
            const matchingAssetParts = session.draft.parts.filter((candidate) => {
              const candidateSource = resolveCharacterPartVisualSource(candidate);
              if (visualSource.kind === 'image' && candidateSource.kind === 'image') {
                return candidateSource.assetId === visualSource.assetId;
              }
              if (
                visualSource.kind === 'fla-graphic' &&
                candidateSource.kind === 'fla-graphic'
              ) {
                return candidateSource.animationId === visualSource.animationId;
              }
              return false;
            }).length;
            const sourceLabel =
              visualSource.kind === 'image'
                ? assetNames.get(visualSource.assetId)
                : structuredGraphicById.get(visualSource.animationId)?.name;
            const baseName = part.displayName ?? sourceLabel ?? `Part ${part.drawOrder + 1}`;
            const name = matchingAssetParts > 1 && !part.displayName
              ? `${localizeDefaultAdaptivePartName(baseName)} · 零件 ${part.drawOrder + 1}`
              : localizeDefaultAdaptivePartName(baseName);
            const graphicRaster = graphicPartRasters.get(part.partId);
            const visualPart = (visual?.parts ?? []).find(
              (candidate) => adaptiveCharacterPartIdOf(candidate) === part.partId,
            );
            const fallbackImageId =
              visualSource.kind === 'fla-graphic' && !visualPart?.flaGraphic
                ? visualPart?.assetId
                : undefined;
            const effectiveImageId =
              visualSource.kind === 'image' ? visualSource.assetId : fallbackImageId;
            const image = effectiveImageId
              ? imageState.images.get(effectiveImageId)
              : undefined;
            const subtreeMissing = Boolean(
              visualSource.kind === 'fla-graphic' &&
                visualSource.nodePath &&
                (!visualPart?.flaGraphic ||
                  !hasRenderableFlaGraphicSubtree(visualPart.flaGraphic)),
            );
            const imageMissing =
              visualSource.kind === 'image'
                ? imageState.missing.has(visualSource.assetId)
                : !structuredGraphicById.has(visualSource.animationId) ||
                  subtreeMissing ||
                  (fallbackImageId
                    ? imageState.missing.has(fallbackImageId)
                    : Boolean(
                        visualPart?.flaGraphic?.resourceAssetIds.some((id) =>
                          imageState.missing.has(id),
                        ),
                      ));
            const imageCacheKey =
              visualSource.kind === 'image'
                ? assetThumbnailKeys.get(visualSource.assetId) ??
                  `asset:${project.id}:${visualSource.assetId}`
                : fallbackImageId
                  ? assetThumbnailKeys.get(fallbackImageId) ??
                    `asset:${project.id}:${fallbackImageId}`
                  : `fla-graphic:${project.id}:${visualSource.animationId}:${visualSource.poseFrameOrdinal ?? 0}:${JSON.stringify(visualSource.nodePath ?? null)}:${(visualPart?.flaGraphic?.resourceAssetIds ?? []).map((id) => assetThumbnailKeys.get(id) ?? id).join(',')}`;
            return (
              <AdaptivePartsAssemblyRow
                displayName={name}
                imageMissing={imageMissing}
                imageCacheKey={imageCacheKey}
                imageSrc={effectiveImageId ? image?.src : graphicRaster?.dataUrl}
                key={part.partId}
                onEdit={() => selectPart(part.partId, true)}
                onMessage={setMessage}
                onRenameEnd={() => setRenamingPartId(null)}
                onRename={(displayName) => updatePart(part.partId, (current) => ({
                  ...current,
                  displayName,
                }))}
                onRestore={() => restorePartToSourcePose(part.partId)}
                onSelect={() => selectPart(part.partId)}
                renaming={renamingPartId === part.partId}
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
      </div>
    </aside>
  );

  return (
    <section
      aria-label="Adaptive Parts 角色组装工作区"
      className="character-assembly-workbench adaptive-parts-assembly-workbench"
      data-character-id={session.characterId}
      data-project-revision={projectSnapshot.revision}
      data-project-dirty={projectSnapshot.dirty}
      data-testid="adaptive-parts-assembly-workbench"
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
          <ArrowLeft aria-hidden="true" size={18} />
        </button>
        <div className="adaptive-parts-assembly-title">
          <strong title={assemblyCharacterName}>{assemblyCharacterName}</strong>
          {assemblyCharacter?.mode === 'adaptive-parts' && adaptivePartsActionsRef ? (
            <button
              aria-controls={panelId + '-properties'}
              aria-expanded={inspectorOpen && inspectorContext === 'character'}
              aria-label="角色属性"
              className="adaptive-parts-row-action adaptive-character-management-trigger"
              data-testid="adaptive-character-management"
              onClick={() => openInspector('character')}
              title="角色属性"
              type="button"
            >
              <MoreHorizontal aria-hidden="true" size={18} />
            </button>
          ) : null}
        </div>
        <button
          className="adaptive-parts-assembly-join-shot"
          data-testid="adaptive-parts-join-current-shot"
          disabled={!hasCurrentShot}
          onClick={joinCurrentShot}
          title={hasCurrentShot ? '\u5c06\u6b64\u89d2\u8272\u52a0\u5165\u5f53\u524d\u955c\u5934' : '\u8bf7\u5148\u9009\u62e9\u955c\u5934'}
          type="button"
        >
          <Plus aria-hidden="true" size={16} />
          <span>{'\u52a0\u5165\u955c\u5934'}</span>
        </button>
      </header>
      {partsListPanel}

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
              const partId = adaptiveCharacterPartIdOf(part);
              const imageTransform = part.imageTransform;
              if (!partId || !imageTransform) return null;
              const image = part.assetId ? imageState.images.get(part.assetId) : undefined;
              const graphicRaster = part.flaGraphic
                ? graphicPartRasters.get(partId)
                : undefined;
              if (part.flaGraphic ? !graphicRaster : !image) return null;
              const selected = session.selectedPartId === partId;
              const sourcePart = session.draft.parts.find((candidate) => candidate.partId === partId);
              const partSource = sourcePart
                ? resolveCharacterPartVisualSource(sourcePart)
                : null;
              const sourceName =
                partSource?.kind === 'fla-graphic'
                  ? structuredGraphicById.get(partSource.animationId)?.name
                  : part.assetId
                    ? assetNames.get(part.assetId)
                    : undefined;
              const matrix =
                adaptivePartCanvasCssMatrix(part, project.width, project.height) ??
                `matrix(${imageTransform.a}, ${imageTransform.b}, ${imageTransform.c}, ${imageTransform.d}, ${project.width / 2 + imageTransform.tx}, ${project.height / 2 + imageTransform.ty})`;
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
                  aria-label={`选择并拖动${sourcePart?.displayName ?? sourceName ?? '部件'}`}
                >
                  {part.flaGraphic && graphicRaster ? (
                    <img
                      alt=""
                      draggable={false}
                      src={graphicRaster.dataUrl}
                      style={{
                        height: graphicRaster.rect.height,
                        left:
                          graphicRaster.rect.x +
                          part.flaGraphic.canvas.width / 2 -
                          part.localRect.x,
                        maxHeight: 'none',
                        maxWidth: 'none',
                        pointerEvents: 'none',
                        position: 'absolute',
                        top:
                          graphicRaster.rect.y +
                          part.flaGraphic.canvas.height / 2 -
                          part.localRect.y,
                        width: graphicRaster.rect.width,
                      }}
                    />
                  ) : (
                    <img alt="" draggable={false} src={image!.src} />
                  )}

                </div>
              );
            })}
          {selectedCanvasPart && selectedCanvasReady && selectedCanvasMatrix ? (
            <div
              className="adaptive-parts-assembly-selection-outline"
              data-part-id={adaptiveCharacterPartIdOf(selectedCanvasPart) ?? undefined}
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
          <button type="button" onClick={fitPreview}>查看全貌</button>
        </div>
      </div>

      <aside
        aria-label="属性"
        className="adaptive-parts-float adaptive-parts-float-properties"
        data-expanded={inspectorOpen}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !inspectorOpen) return;
          event.stopPropagation();
          setInspectorOpen(false);
          inspectorHandleRef.current?.focus();
        }}
        ref={inspectorRef}
      >
        <button
          aria-controls={panelId + '-properties'}
          aria-expanded={inspectorOpen}
          aria-label={inspectorOpen ? '收起属性' : '展开属性'}
          className="adaptive-parts-float-handle"
          data-testid="adaptive-parts-inspector-toggle"
          onClick={() => {
            if (inspectorOpen) setInspectorOpen(false);
            else openInspector(inspectorContext, false);
          }}
          ref={inspectorHandleRef}
          title={inspectorOpen ? '收起属性' : '展开属性'}
          type="button"
        >
          <span className="quick-action-drawer-grip" aria-hidden="true" />
        </button>
        <div className="adaptive-parts-properties-body" id={panelId + '-properties'} inert={!inspectorOpen}>
          {assemblyCharacter?.mode === 'adaptive-parts' && adaptivePartsActionsRef ? (
            <div hidden={inspectorContext !== 'character'}>
              <AdaptiveCharacterManagement
                key={JSON.stringify([assemblyCharacter.id, assemblyCharacter.name, assemblyCharacter.defaultScale, assemblyCharacter.defaultFlipX])}
                character={assemblyCharacter}
                onManage={(action) => {
                  if (adaptivePartsActionsRef.current) {
                    return adaptivePartsActionsRef.current.manage(action);
                  }
                  if (isCharacterAssemblyPending(project, session)) {
                    return { ok: false, message: '请先应用或取消零件组装更改。' };
                  }
                  try {
                    switch (action.kind) {
                      case 'rename':
                        characterStore.renameCharacter(assemblyCharacter.id, action.name);
                        break;
                      case 'transform':
                        characterStore.setDefaultTransform(
                          assemblyCharacter.id,
                          action.scale,
                          action.flipX,
                        );
                        break;
                      case 'delete': {
                        if (!window.confirm(`确认删除角色“${assemblyCharacter.name}”？`)) {
                          return { ok: false };
                        }
                        characterStore.deleteCharacter(assemblyCharacter.id);
                        activeHandle()?.cancel();
                        break;
                      }
                    }
                    setMessage('');
                    return { ok: true };
                  } catch (error) {
                    return {
                      ok: false,
                      message: error instanceof Error ? error.message : '角色操作失败。',
                    };
                  }
                }}
              />
            </div>
          ) : null}
          {inspectorContext === 'part' && selectedPart && selectedAdjustment ? (
            <div className="adaptive-parts-inspector-fields" data-testid="adaptive-parts-inspector-fields">
              <div className="adaptive-parts-inspector-heading">
                <strong>{localizeDefaultAdaptivePartName(
                  selectedPart.displayName ??
                    (selectedPartVisualSource?.kind === 'fla-graphic'
                      ? structuredGraphicById.get(selectedPartVisualSource.animationId)?.name
                      : selectedPart.assetId ? assetNames.get(selectedPart.assetId) : undefined) ??
                    `Part ${selectedPart.drawOrder + 1}`,
                )}</strong>
              </div>
              {renderAdaptiveAdjustmentField('offsetX', 'X', 'X \u504f\u79fb', 'adaptive-parts-offset-x')}
              {renderAdaptiveAdjustmentField('offsetY', 'Y', 'Y \u504f\u79fb', 'adaptive-parts-offset-y')}
              {renderAdaptiveAdjustmentField('scale', '\u5927\u5c0f', '\u5927\u5c0f\u767e\u5206\u6bd4', 'adaptive-parts-scale-percent', '%')}
              {renderAdaptiveAdjustmentField('rotationDeg', '\u65cb\u8f6c', '\u65cb\u8f6c\u89d2\u5ea6', 'adaptive-parts-rotation-deg', '\u00b0')}
            </div>
          ) : inspectorContext === 'part' ? <span>选择零件</span> : null}
        </div>
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
      {replacingPartId && session.draft.parts.some((part) => part.partId === replacingPartId) ? (() => {
        const targetPart = session.draft.parts.find((part) => part.partId === replacingPartId)!;
        const targetSource = resolveCharacterPartVisualSource(targetPart);
        const targetLabel = localizeDefaultAdaptivePartName(
          targetPart.displayName ??
            (targetSource.kind === 'image'
              ? assetNames.get(targetSource.assetId)
              : structuredGraphicById.get(targetSource.animationId)?.name) ??
            `Part ${targetPart.drawOrder + 1}`,
        );
        return (
          <CharacterResourceSwapDialog
            currentValue={
              targetSource.kind === 'image'
                ? { kind: 'image', assetId: targetSource.assetId }
                : { kind: 'fla-graphic', animationId: targetSource.animationId }
            }
            graphicDefinitions={structuredGraphics}
            graphicSelectionMode="definition"
            imageAssets={projectImageAssets}
            onCancel={() => setReplacingPartId(null)}
            onConfirm={(next) => {
              if (next.kind === 'image' && next.assetId) {
                replacePartWithImage(targetPart.partId, next.assetId);
              } else if (next.kind === 'fla-graphic') {
                replacePartWithGraphic(targetPart.partId, next.animationId);
              } else {
                setReplacingPartId(null);
              }
            }}
            onThumbnailError={onAdaptiveSwapThumbnailError}
            open
            returnFocusTo={replaceTriggerRef.current}
            thumbnails={adaptiveSwapThumbnails}
            title={`替换素材 · ${targetLabel}`}
          />
        );
      })() : null}
    </section>
  );
}

function CompositeCharacterAssemblyWorkbench({
  floatingComposite,
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
  const [legacyFineTuneOpen, setIsFineTuneOpen] = useState(false);
  const isFineTuneOpen = floatingComposite ? floatingComposite.controlsOpen : legacyFineTuneOpen;
  const canEditAssembly = floatingComposite?.editable ?? true;
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
    if (!isFineTuneOpen || floatingComposite) return;
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
  }, [activeEditTarget, floatingComposite, head, isFineTuneOpen, transform.offsetX, transform.offsetY, transform.scale]);

  useEffect(() => {
    if ((!isFineTuneOpen || floatingComposite) && !isExpressionPreviewOpen) return;

    const handlePointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return;
      if (
        !floatingComposite && isFineTuneOpen &&
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
  }, [floatingComposite, isExpressionPreviewOpen, isFineTuneOpen]);

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
    : Boolean(session.draft.mouthOpenAssetId || session.draft.mouthOpenVisualSource);
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
  const faceGraphicSource = facePart?.source.kind === 'character-face-fla-graphic' ? facePart.source : null;
  const faceGraphicCanvas = faceGraphicSource ? project.animations.find(candidate => candidate.id === faceGraphicSource.animationId)?.source.canvas : null;
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
      ...(facePart?.assetId ? [facePart.assetId] : []),
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
    facePart?.assetId,
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
  const bodyContentRect = bodyPart?.assetId
    ? visibleImageRect(
        bodyPart.localRect,
        imageBoundsByAssetId.get(bodyPart.assetId),
      )
    : null;
  const faceContentRect = facePart
    ? facePart.imageTransform
      ? transformVisualRectByPart(
          facePart.assetId
            ? visibleImageRect(
                facePart.localRect,
                imageBoundsByAssetId.get(facePart.assetId),
              )
            : facePart.localRect,
          facePart,
        )
      : facePart.assetId
        ? visibleImageRect(
            facePart.localRect,
            imageBoundsByAssetId.get(facePart.assetId),
          )
        : null
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

  const floatingLayout = floatingComposite ? (floatingComposite.leftOpen ? 1 : 0) + (floatingComposite.propertiesOpen ? 2 : 0) : null;
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
      if (floatingLayout !== null && floatingLayout > 0) {
        const availableArea = assemblyViewportFitArea(viewport, null, true);
        const focusBounds = bounds ?? latestAssemblyBoundsRef.current;
        if (focusBounds) return calculateAssemblyFitViewportTransform(container, logicalFrame, focusBounds, availableArea);
        const fit = calculateViewportTransform(availableArea, 'fit', logicalFrame);
        return { ...fit, container, offsetX: fit.offsetX + availableArea.x, offsetY: fit.offsetY + availableArea.y };
      }
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
    [floatingLayout, project.height, project.width],
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
      floatingLayout === null && !assemblyBoundsExceedFrame(assemblyVisibleBounds, {
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
    floatingLayout,
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
    if (!canEditAssembly) return;
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
    ? facePart.imageTransform
      ? faceContentRect ?? transformVisualRectByPart(facePart.localRect, facePart)
      : transformVisualRectByPart(
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

  const fineTunePanel = canEditAssembly && isFineTuneOpen && !isEditingNeckPivot ? (
            <div
              aria-label={`${activeEditTargetLabel}精调`}
              className="character-assembly-fine-tune-panel"
              id="character-assembly-fine-tune-panel"
              data-testid="character-assembly-fine-tune-panel"
              ref={fineTunePanelRef}
              role="group"
            >
              {floatingComposite ? <strong className="character-float-precision-title">{activeEditTargetLabel}</strong> : null}
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
                {(() => {
                  const angleInput = (
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
                  );
                  return floatingComposite ? (
                    <span className="character-float-angle-input-wrap">
                      {angleInput}
                      <span aria-hidden="true" className="character-float-angle-unit">°</span>
                    </span>
                  ) : angleInput;
                })()}
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
              {(() => {
                const flipButton = activeEditTarget !== 'body' ? <button
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
                </button> : null;
                const resetButton = (
                  <button
                    className="character-assembly-reset"
                    data-testid="character-assembly-reset"
                    disabled={isTestingHeadMotion}
                    onClick={resetPlacement}
                    type="button"
                  >
                    重置
                  </button>
                );
                return floatingComposite ? (
                  <div className="character-float-precision-actions">
                    {flipButton}
                    {resetButton}
                  </div>
                ) : (
                  <>
                    {flipButton}
                    {resetButton}
                  </>
                );
              })()}
            </div>
  ) : null;

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
      data-floating-composite={floatingComposite ? true : undefined}
      data-editable={canEditAssembly}
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
          {bodyPart?.assetId && imageState.images.get(bodyPart.assetId) ? (
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
            {faceGraphicSource && faceGraphicCanvas ? (
              <div className="character-assembly-part character-assembly-graphic-face" style={{ left: left + session.draft.facePlacement.offsetX - faceGraphicCanvas.width * session.draft.facePlacement.scale / 2, top: top + session.draft.facePlacement.offsetY - faceGraphicCanvas.height * session.draft.facePlacement.scale / 2, width: faceGraphicCanvas.width * session.draft.facePlacement.scale, height: faceGraphicCanvas.height * session.draft.facePlacement.scale, transform: `rotate(${session.draft.facePlacement.rotationDeg}deg) scaleX(${session.draft.facePlacement.flipX ? -1 : 1})`, transformOrigin: 'center' }}>
                <GraphicFacePreview source={{ kind: 'fla-graphic', animationId: faceGraphicSource.animationId, firstFrame: faceGraphicSource.firstFrame }} />
              </div>
            ) : facePart?.assetId && imageState.images.get(facePart.assetId) ? (
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
        {fineTunePanel && (floatingComposite
          ? floatingComposite.propertyTarget && createPortal(fineTunePanel, floatingComposite.propertyTarget)
          : fineTunePanel)}
      </div>

      <footer className="character-assembly-workbench-footer">
        <div
          className="character-assembly-placement-controls"
          data-testid="character-assembly-placement-controls"
        >
          <div className="character-assembly-assembly-actions">
            {head && canEditAssembly ? (
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
            {canEditAssembly ? <button
              aria-expanded={isFineTuneOpen}
              aria-controls="character-assembly-fine-tune-panel"
              className="character-assembly-fine-tune-toggle"
              data-testid="character-assembly-fine-tune-toggle"
              ref={fineTuneTriggerRef}
              disabled={isEditingNeckPivot || isTestingHeadMotion}
              onClick={() => {
                setIsExpressionPreviewOpen(false);
                if (floatingComposite) floatingComposite.onToggleControls();
                else setIsFineTuneOpen((open) => !open);
              }}
              type="button"
            >
              精调
            </button> : null}
            {canEditAssembly && layoutReuseTarget ? (
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
