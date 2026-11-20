import { useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Pencil, Play, Plus, RefreshCw, X } from 'lucide-react';
import { CharacterFloatHost } from './characterFloatHost';
import { CharacterSingleImagePreview } from './CharacterSingleImagePreview';
import { CharacterFloatPanel } from './CharacterFloatPanel';
import './character-float-detail.css';
import {
  isFlaGraphicDefinition,
  type Character,
  type CharacterDimensionWarning,
  type CompositeCharacterDefinition,
  type ExpressionCharacter,
  type ImageAsset,
  type Project,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import type { CharacterAssemblyEditTarget, CharacterAssemblySnapshot } from '../../stores/characterAssemblySessionStore';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { CharacterAssemblyWorkbench } from './CharacterAssemblyWorkbench';
import { Button } from '../../ui/Button';
import { CharacterCompactObjectRow } from './CharacterCompactObjectRow';
import { CharacterExpressionThumbnail } from './CharacterIdentity';
import { CharacterTalkingHeadMotionPreview } from './CharacterTalkingHeadMotionPreview';
import {
  CharacterResourceSwapDialog,
  type ResourceSwapValue,
} from './CharacterResourceSwapDialog';
import { CompactRowOverflowMenu } from './CompactRowOverflowMenu';
import { ExpressionEditor } from './ExpressionEditor';
import { GraphicFacePicker, GraphicFacePreview } from './GraphicFacePicker';
import type { CharacterFaceSource, CharacterFaceGraphicSource } from '../../../domain';
import {
  ImageAssetPicker,
  ImageAssetPickerSelectedSurface,
} from './ImageAssetPicker';
import {
  getThumbnailFallbackIconKind,
  ThumbnailStateIcon,
} from './ThumbnailStateIcon';

export type CharacterEditorView = 'full' | 'detail' | 'expression';
export type CharacterEditorPresentation = 'default' | 'landscape';
export type CharacterDetailWorkspace =
  | 'assembly'
  | 'expressions'
  | 'settings';

type HeadedCompositeCharacter = Extract<Character, { mode: 'composite' }> & {
  head: NonNullable<Extract<Character, { mode: 'composite' }>['head']>;
};

export function isDefaultTransformPending(
  character: Pick<ExpressionCharacter, 'defaultScale' | 'defaultFlipX'>,
  scale: number,
  flipX: boolean,
): boolean {
  return (
    Number.isFinite(scale) &&
    (scale !== character.defaultScale || flipX !== character.defaultFlipX)
  );
}

export function characterRenameValue(
  nextName: string,
  currentName: string,
): string | null {
  const trimmed = nextName.trim();
  return trimmed.length > 0 && trimmed !== currentName ? trimmed : null;
}

const MOUTH_OVERFLOW_MENU_WIDTH = 132;
const MOUTH_OVERFLOW_MENU_MIN_HEIGHT = 54;
const MOUTH_OVERFLOW_MENU_GAP = 4;
const MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN = 8;

// The native top-layer popover escapes row clipping while keeping Tab order beside its trigger.
function CharacterAssemblyMouthOverflowMenu({
  disabled,
  onClear,
}: {
  disabled: boolean;
  onClear: () => void;
}): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trigger = triggerRef.current;
    const popover = popoverRef.current;
    if (!trigger || !popover) return undefined;

    const positionPopover = (force = false): void => {
      if (!force && !popover.matches(':popover-open')) return;

      const anchor = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      if (
        viewportWidth <= 0 ||
        viewportHeight <= 0 ||
        anchor.bottom <= 0 ||
        anchor.top >= viewportHeight
      ) {
        if (popover.matches(':popover-open')) popover.hidePopover();
        return;
      }

      const computedWidth = Number.parseFloat(getComputedStyle(popover).width);
      const width = Math.min(
        Number.isFinite(computedWidth) ? computedWidth : MOUTH_OVERFLOW_MENU_WIDTH,
        Math.max(0, viewportWidth - MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN * 2),
      );
      const measuredHeight = popover.scrollHeight || MOUTH_OVERFLOW_MENU_MIN_HEIGHT;
      const height = Math.max(MOUTH_OVERFLOW_MENU_MIN_HEIGHT, measuredHeight);
      const spaceBelow = viewportHeight - anchor.bottom - MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN;
      const spaceAbove = anchor.top - MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN;
      const opensAbove =
        spaceBelow < height + MOUTH_OVERFLOW_MENU_GAP && spaceAbove > spaceBelow;
      const availableSpace = Math.max(
        0,
        (opensAbove ? spaceAbove : spaceBelow) - MOUTH_OVERFLOW_MENU_GAP,
      );
      const visibleHeight = Math.min(height, availableSpace);
      const maxLeft = Math.max(
        0,
        viewportWidth - width - MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN,
      );
      const left = Math.max(
        MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN,
        Math.min(anchor.right - width, maxLeft),
      );
      const top = opensAbove
        ? Math.max(
            MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN,
            anchor.top - MOUTH_OVERFLOW_MENU_GAP - visibleHeight,
          )
        : Math.min(
            viewportHeight - MOUTH_OVERFLOW_MENU_VIEWPORT_MARGIN - visibleHeight,
            anchor.bottom + MOUTH_OVERFLOW_MENU_GAP,
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
      const isOpen = popover.matches(':popover-open');
      setOpen(isOpen);
      if (isOpen) positionPopover(true);
    };
    const onViewportMove = (): void => positionPopover();
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (
        popover.matches(':popover-open') &&
        target instanceof Node &&
        !trigger.contains(target) &&
        !popover.contains(target)
      ) {
        popover.hidePopover();
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

  useEffect(() => {
    if (disabled && popoverRef.current?.matches(':popover-open')) {
      popoverRef.current.hidePopover();
    }
  }, [disabled]);

  const clearMouth = (): void => {
    const picker = triggerRef.current?.closest<HTMLElement>(
      '[data-testid="character-assembly-mouth-picker"]',
    );
    popoverRef.current?.hidePopover();
    onClear();
    window.requestAnimationFrame(() => {
      picker
        ?.querySelector<HTMLButtonElement>(
          '[data-testid="character-assembly-mouth-picker-selected"]',
        )
        ?.focus();
    });
  };

  return (
    <div
      className="character-assembly-mouth-overflow"
      onKeyDown={(event) => {
        if (
          event.key === 'Escape' &&
          popoverRef.current?.matches(':popover-open')
        ) {
          event.stopPropagation();
        }
      }}
    >
      <button
        aria-controls={id}
        aria-expanded={open}
        aria-label="张嘴脸更多操作"
        className="character-assembly-mouth-overflow-trigger"
        data-testid="character-assembly-mouth-overflow-trigger"
        disabled={disabled}
        popoverTarget={id}
        popoverTargetAction="toggle"
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <div
        aria-label="张嘴脸更多操作"
        className="character-assembly-mouth-overflow-menu"
        data-testid="character-assembly-mouth-overflow-menu"
        id={id}
        popover="auto"
        ref={popoverRef}
        role="group"
      >
        <button
          className="character-mouth-clear"
          data-testid="character-assembly-mouth-clear"
          disabled={disabled}
          onClick={clearMouth}
          type="button"
        >
          清除
        </button>
      </div>
    </div>
  );
}

function CompactRowAssetThumbnail({
  asset,
  assetConfigured,
  label,
  onThumbnailError,
  thumbnail,
}: {
  asset: ImageAsset | undefined;
  assetConfigured: boolean;
  label: string;
  onThumbnailError?: (assetId: string) => void;
  thumbnail?: ThumbnailState;
}): React.JSX.Element {
  if (asset && thumbnail?.status === 'ready') {
    return (
      <img
        alt=""
        onError={() => onThumbnailError?.(asset.id)}
        src={thumbnail.dataUrl}
      />
    );
  }
  const iconKind = getThumbnailFallbackIconKind(thumbnail, {
    assetConfigured,
    assetResolved: Boolean(asset),
  });
  return (
    <span
      aria-label={`${label}缩略图占位`}
      className="character-compact-row-thumb-fallback"
      data-thumbnail-icon={iconKind}
    >
      <ThumbnailStateIcon kind={iconKind} size={18} />
    </span>
  );
}

function CharacterThumbnailFallback({
  assetConfigured = true,
  assetResolved = true,
  thumbnail,
}: {
  assetConfigured?: boolean;
  assetResolved?: boolean;
  thumbnail?: ThumbnailState;
}): React.JSX.Element {
  const label =
    thumbnail?.status === 'loading'
      ? '加载中'
      : thumbnail?.status === 'missing' && thumbnail.reason === 'source'
        ? '源文件缺失'
        : thumbnail?.status === 'missing' && thumbnail.reason === 'error'
          ? '缩略图加载失败'
          : !assetConfigured
            ? '未配置默认表情'
            : !assetResolved
              ? '素材不可用'
              : '缩略图缺失';
  const state =
    thumbnail?.status ??
    (assetConfigured && assetResolved ? 'loading' : 'missing');
  const iconKind = getThumbnailFallbackIconKind(thumbnail, {
    assetConfigured,
    assetResolved,
  });
  return (
    <span
      aria-label={label}
      className="character-thumbnail-fallback"
      data-thumbnail-icon={iconKind}
      data-thumbnail-fallback={state}
    >
      <ThumbnailStateIcon
        className="character-thumbnail-fallback-icon"
        kind={iconKind}
        size={18}
      />
      <small>{label}</small>
    </span>
  );
}

export interface CharacterEditorProps {
  character: Character | null;
  project?: Project;
  imageAssets: readonly ImageAsset[];
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  warnings: readonly CharacterDimensionWarning[];
  disabled?: boolean;
  onRenameCharacter: (name: string) => void;
  onDeleteCharacter: () => void;
  onAddExpression: (name: string, assetId: string) => void;
  onRenameExpression: (expressionId: string, name: string) => void;
  onSetExpressionAsset: (expressionId: string, assetId: string) => void;
  onSetExpressionSource?: (expressionId: string, source: CharacterFaceSource) => void;
  onAddGraphicExpression?: (name: string, source: CharacterFaceGraphicSource) => void;
  onSetMouthSource?: (source: CharacterFaceSource | null) => void;
  onRemoveExpression: (expressionId: string) => void;
  onSetDefaultExpression: (expressionId: string) => void;
  onSetMouthOpenAsset: (assetId: string | null) => void;
  assemblyDraft?: CompositeCharacterDefinition | null;
  onOpenAssembly?: () => boolean;
  onLeaveAssembly?: () => boolean;
  onSetAssemblyHeadAsset?: (assetId: string | null) => void;
  assemblyEditTarget?: CharacterAssemblyEditTarget;
  onSelectAssemblyEditTarget?: (target: CharacterAssemblyEditTarget) => void;
  onSetAssemblyBodyAsset?: (assetId: string) => void;
  onSetAssemblyMouthAsset?: (assetId: string | null) => void;
  onSetAssemblyMouthSource?: (source: CharacterFaceSource | null) => void;
  onSetDefaultTransform: (scale: number, flipX: boolean) => void;
  onSetTalkingHeadMotionIntensityPercent?: (intensityPercent: number) => void;
  hasCurrentShot?: boolean;
  onPlaceInCurrentShot?: (defaultTransformPending: boolean) => void;
  onThumbnailError: (assetId: string) => void;
  view?: CharacterEditorView;
  presentation?: CharacterEditorPresentation;
  onOpenExpressions?: () => void;
  onBackToDetail?: () => void;
  onBackToList?: () => void;
  onCloseDrawer?: () => void;
  status?: string;
  floatEnabled?: boolean;
  projectSnapshot?: EditorProjectSnapshot;
  assemblySession?: CharacterAssemblySnapshot;
  assemblyPending?: boolean;
}

export function CharacterEditor({
  character,
  project,
  imageAssets,
  thumbnails,
  warnings,
  disabled = false,
  onRenameCharacter,
  onDeleteCharacter,
  onAddExpression,
  onRenameExpression,
  onSetExpressionAsset,
  onSetExpressionSource,
  onAddGraphicExpression,
  onSetMouthSource,
  onRemoveExpression,
  onSetDefaultExpression,
  onSetMouthOpenAsset,
  assemblyDraft = null,
  onOpenAssembly = () => false,
  onLeaveAssembly = () => true,
  onSetAssemblyHeadAsset = () => undefined,
  assemblyEditTarget = 'face',
  onSelectAssemblyEditTarget = () => undefined,
  onSetAssemblyBodyAsset = () => undefined,
  onSetAssemblyMouthAsset = () => undefined,
  onSetAssemblyMouthSource,
  onSetDefaultTransform,
  onSetTalkingHeadMotionIntensityPercent = () => undefined,
  hasCurrentShot = false,
  onPlaceInCurrentShot = () => undefined,
  onThumbnailError,
  view = 'full',
  presentation = 'default',
  onOpenExpressions = () => undefined,
  onBackToDetail = () => undefined,
  onBackToList = () => undefined,
  onCloseDrawer = () => undefined,
  status,
  floatEnabled = true,
  projectSnapshot,
  assemblySession,
  assemblyPending = false,
}: CharacterEditorProps): React.JSX.Element {
  const floatHost = useContext(CharacterFloatHost);
  const floatTarget = floatHost?.target ?? null;
  const setFloatMode = floatHost?.setMode;
  const floatMode = floatEnabled && floatTarget && view === 'detail' && character && character.mode !== 'adaptive-parts'
    ? character.mode : null;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  const [floatOperations, setFloatOperations] = useState<'parts' | 'expressions'>('parts');
  const [floatProperties, setFloatProperties] = useState<'part' | 'character'>('part');
  const [previewExpressionId, setPreviewExpressionId] = useState<string>();
  const [previewMouth, setPreviewMouth] = useState(false);
  const [precisionTarget, setPrecisionTarget] = useState<HTMLDivElement | null>(null);
  const storeSnapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
    editorProjectStore.getSnapshot,
  );
  const resolvedProject = project ?? projectSnapshot?.project ?? storeSnapshot?.project;
  const flaGraphicDefinitions = useMemo(
    () => resolvedProject?.animations.filter(isFlaGraphicDefinition) ?? [],
    [resolvedProject?.animations],
  );
  const [swapDialog, setSwapDialog] = useState<{
    title: string;
    currentValue: ResourceSwapValue;
    emptyOption?: { label: string; description?: string };
    allowGraphic: boolean;
    returnFocusTo: HTMLElement | null;
    onConfirm: (nextValue: ResourceSwapValue) => void;
  } | null>(null);
  const openAssemblyRef = useRef(onOpenAssembly);
  openAssemblyRef.current = onOpenAssembly;
  useEffect(() => {
    if (floatMode === 'composite' && !assemblyDraft) openAssemblyRef.current();
  }, [floatMode, assemblyDraft]);
  const leftHandle = useRef<HTMLButtonElement>(null);
  const rightHandle = useRef<HTMLButtonElement>(null);
  const floatId = useId();
  useLayoutEffect(() => {
    if (!floatMode || !setFloatMode) return;
    setFloatMode(floatMode);
    return () => setFloatMode(null);
  }, [floatMode, setFloatMode]);
  useLayoutEffect(() => {
    if (!floatMode || !floatTarget || !leftOpen || !rightOpen) return;
    const observer = new ResizeObserver(() => {
      if (floatTarget.clientWidth >= 740) return;
      if (floatTarget.querySelector('.character-float-panel-left')?.contains(document.activeElement)) {
        rightHandle.current?.focus();
      }
      setLeftOpen(false);
    });
    observer.observe(floatTarget);
    return () => observer.disconnect();
  }, [floatMode, floatTarget, leftOpen, rightOpen]);

  const isNarrowFloat = () => Boolean(floatTarget && floatTarget.clientWidth > 0 && floatTarget.clientWidth < 740);
  const openProperties = (context: 'part' | 'character'): void => {
    if (isNarrowFloat()) setLeftOpen(false);
    setFloatProperties(context);
    setRightOpen(true);
    rightHandle.current?.focus();
  };
  const [name, setName] = useState(character?.name ?? '');
  const [scale, setScale] = useState(character?.defaultScale ?? 1);
  const [flipX, setFlipX] = useState(character?.defaultFlipX ?? false);
  const [talkingHeadMotionIntensityPercent, setTalkingHeadMotionIntensityPercent] =
    useState(
      character?.mode === 'composite'
        ? character.talkingHeadMotionIntensityPercent
        : 100,
    );
  const [isTalkingHeadMotionPreviewing, setIsTalkingHeadMotionPreviewing] =
    useState(false);
  const [hasStartedTalkingHeadMotionPreview, setHasStartedTalkingHeadMotionPreview] =
    useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [expressionAddOpen, setExpressionAddOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] =
    useState<CharacterDetailWorkspace>(
      assemblyDraft ? 'assembly' : 'expressions',
    );
  const assemblyDraftWasOpen = useRef(Boolean(assemblyDraft));
  const persistedTalkingHeadMotionIntensityPercent =
    character?.mode === 'composite'
      ? character.talkingHeadMotionIntensityPercent
      : 100;
  const hasTalkingHeadMotionControl = Boolean(
    character?.mode === 'composite' && character.head,
  );
  const talkingHeadSettingsVisible =
    view !== 'expression' &&
    !(
      presentation === 'landscape' &&
      view === 'detail' &&
      (floatMode ? !rightOpen || floatProperties !== 'character' : activeWorkspace !== 'settings')
    );

  useEffect(() => {
    if (!character) return;
    setName(character.name);
    setRenameOpen(false);
    setExpressionAddOpen(false);
  }, [character?.id]);

  useEffect(() => {
    if (!character) return;
    setScale(character.defaultScale);
    setFlipX(character.defaultFlipX);
  }, [character?.defaultFlipX, character?.defaultScale, character?.id]);

  useEffect(() => {
    setTalkingHeadMotionIntensityPercent(
      persistedTalkingHeadMotionIntensityPercent,
    );
    setIsTalkingHeadMotionPreviewing(false);
    setHasStartedTalkingHeadMotionPreview(false);
  }, [character?.id, persistedTalkingHeadMotionIntensityPercent]);

  useEffect(() => {
    if (!talkingHeadSettingsVisible || !hasTalkingHeadMotionControl) {
      setIsTalkingHeadMotionPreviewing(false);
      setHasStartedTalkingHeadMotionPreview(false);
    }
    if (!hasTalkingHeadMotionControl) {
      setTalkingHeadMotionIntensityPercent(
        persistedTalkingHeadMotionIntensityPercent,
      );
    }
  }, [
    hasTalkingHeadMotionControl,
    persistedTalkingHeadMotionIntensityPercent,
    talkingHeadSettingsVisible,
  ]);

  useEffect(() => {
    const hasAssemblyDraft = Boolean(assemblyDraft);
    if (
      character?.mode === 'composite' &&
      activeWorkspace === 'assembly' &&
      assemblyDraftWasOpen.current &&
      !hasAssemblyDraft
    ) {
      setActiveWorkspace('expressions');
    }
    assemblyDraftWasOpen.current = hasAssemblyDraft;
  }, [activeWorkspace, assemblyDraft, character?.mode]);

  const landscapeDetail =
    presentation === 'landscape' && view === 'detail';
  const landscapeExpression =
    presentation === 'landscape' && view === 'expression';
  const landscapeCharacterNavigation =
    landscapeDetail || landscapeExpression;

  const adjustScale = (delta: number): void => {
    setScale((current) =>
      Math.min(10, Math.max(0.1, Number((current + delta).toFixed(1)))),
    );
  };

  if (!character || character.mode === 'adaptive-parts') {
    return (
      <div className="character-editor character-editor-empty">
        <strong>选择一个角色开始编辑</strong>
        <p>
          角色只保存项目素材 ID；不会复制图片、保存绝对路径或嵌入 Base64。
        </p>
        {view === 'detail' ? (
          <Button
            className="character-detail-place-action"
            data-testid="character-detail-place-current-shot"
            disabled
          >
            加入当前镜头
          </Button>
        ) : null}
      </div>
    );
  }

  const expressionCharacter = character;
  const headedCompositeCharacter: HeadedCompositeCharacter | null =
    character.mode === 'composite' && character.head
      ? (character as HeadedCompositeCharacter)
      : null;

  const formalDefaultExpression = expressionCharacter?.expressions.find(
    (expression) => expression.id === expressionCharacter.defaultExpressionId,
  );
  const defaultExpression =
    formalDefaultExpression ?? expressionCharacter?.expressions[0];
  const defaultExpressionAsset = defaultExpression
    ? imageAssets.find((asset) => asset.id === defaultExpression.assetId)
    : undefined;
  const defaultImageAssetId = defaultExpression?.assetId;
  const defaultThumbnail = defaultImageAssetId ? thumbnails[defaultImageAssetId] : undefined;
  const defaultAssetResolved = Boolean(defaultExpressionAsset || defaultExpression?.visualSource);
  const hasPendingTransform = isDefaultTransformPending(
    character,
    scale,
    flipX,
  );
  const placementBlockedByTransform = hasPendingTransform || !Number.isFinite(scale);
  const formalDefaultAssetAvailable = Boolean(
        formalDefaultExpression && (formalDefaultExpression.visualSource || imageAssets.some(
          (asset) => asset.id === formalDefaultExpression.assetId,
        )),
      );
  const placementUnavailableReason = disabled
    ? '请先打开项目'
    : !hasCurrentShot
      ? '请先选择镜头'
      : !formalDefaultAssetAvailable
        ? '默认表情素材不可用'
        : placementBlockedByTransform
          ? '先应用角色大小设置'
          : null;
  const nextRenameValue = characterRenameValue(name, character.name);
  const compositeCharacter = character.mode === 'composite';
  const singleImageCharacter = character.mode === 'single-image';
  const hasAssemblyWorkbench = compositeCharacter;
  const assemblyMouthAssetId = assemblyDraft
    ? assemblyDraft.mouthOpenAssetId ?? null
    : expressionCharacter?.mouthOpenAssetId ?? null;

  const switchFloatOperations = (next: 'parts' | 'expressions'): void => {
    if (next === floatOperations) return;
    if (floatMode === 'composite') {
      if (floatOperations === 'parts' && !onLeaveAssembly()) return;
      if (floatOperations === 'parts' && !onOpenAssembly()) return;
    }
    setFloatOperations(next);
    setSwapDialog(null);
    if (next === 'expressions') setFloatProperties('character');
  };
  const selectAssemblyObject = (target: CharacterAssemblyEditTarget): void => {
    onSelectAssemblyEditTarget(target);
    if (floatMode === 'composite' && rightOpen) setFloatProperties('part');
  };
  const showFloatRole = (): void => {
    if (floatMode === 'composite' && assemblyPending) {
      if (!onLeaveAssembly() || !onOpenAssembly()) return;
    }
    openProperties('character');
  };

  const switchDetailWorkspace = (
    nextWorkspace: CharacterDetailWorkspace,
  ): void => {
    if (floatMode === 'composite' && nextWorkspace === 'expressions') {
      switchFloatOperations('expressions');
      return;
    }
    if (nextWorkspace === activeWorkspace) return;
    if (
      hasAssemblyWorkbench &&
      activeWorkspace === 'assembly' &&
      nextWorkspace !== 'assembly' &&
      !onLeaveAssembly()
    ) {
      return;
    }
    if (
      hasAssemblyWorkbench &&
      nextWorkspace === 'assembly' &&
      !onOpenAssembly()
    ) {
      return;
    }
    if (activeWorkspace === 'expressions') setExpressionAddOpen(false);
    setActiveWorkspace(nextWorkspace);
  };

  const talkingHeadIntensityInputId =
    `character-talking-head-intensity-${character.id}`;
  const talkingHeadIntensityLabelId =
    `character-talking-head-label-${character.id}`;
  const talkingHeadSettings = headedCompositeCharacter ? (
    <section
      aria-labelledby={talkingHeadIntensityLabelId}
      className="character-settings-section character-talking-head-setting"
      data-intensity-pending={
        talkingHeadMotionIntensityPercent !==
        persistedTalkingHeadMotionIntensityPercent
      }
      data-testid="character-talking-head-settings"
    >
      <div className="character-talking-head-intensity-control">
        <div className="character-talking-head-field-heading">
          <label
            htmlFor={talkingHeadIntensityInputId}
            id={talkingHeadIntensityLabelId}
          >
            点头强度
          </label>
          <output
            aria-live="polite"
            className="character-talking-head-value"
            data-testid="character-talking-head-intensity-value"
            htmlFor={talkingHeadIntensityInputId}
          >
            {talkingHeadMotionIntensityPercent}%
          </output>
        </div>
        <input
          aria-label="点头强度"
          data-testid="character-talking-head-intensity"
          disabled={disabled}
          id={talkingHeadIntensityInputId}
          max={200}
          min={0}
          onChange={(event) =>
            setTalkingHeadMotionIntensityPercent(Number(event.target.value))
          }
          step={10}
          type="range"
          value={talkingHeadMotionIntensityPercent}
        />
      </div>
      <div
        aria-hidden="true"
        className="character-talking-head-scale-labels"
      >
        <span>静止</span>
        <span>标准</span>
        <span>明显</span>
      </div>
      <div className="character-talking-head-actions">
        <div>
          <button
            className="character-talking-head-preview-button"
            data-testid="character-talking-head-preview-toggle"
            disabled={disabled}
            onClick={() => {
              setHasStartedTalkingHeadMotionPreview(true);
              setIsTalkingHeadMotionPreviewing((playing) => !playing);
            }}
            type="button"
          >
            {isTalkingHeadMotionPreviewing ? '停止预览' : '预览'}
          </button>
          <button
            className="character-talking-head-default-button"
            data-testid="character-talking-head-restore-default"
            disabled={
              disabled || talkingHeadMotionIntensityPercent === 100
            }
            onClick={() => setTalkingHeadMotionIntensityPercent(100)}
            type="button"
          >
            恢复默认
          </button>
        </div>
      </div>
      {hasStartedTalkingHeadMotionPreview && project ? (
        <CharacterTalkingHeadMotionPreview
          character={headedCompositeCharacter}
          intensityPercent={talkingHeadMotionIntensityPercent}
          playing={isTalkingHeadMotionPreviewing}
          project={project}
          thumbnails={thumbnails}
        />
      ) : null}
      {talkingHeadMotionIntensityPercent !==
      persistedTalkingHeadMotionIntensityPercent ? (
        <div
          aria-live="polite"
          className="character-default-pending character-talking-head-pending"
          data-testid="character-talking-head-pending"
          role="status"
        >
          <div>
            <strong>● 有未应用更改</strong>
            <span>应用后保存到此角色</span>
          </div>
          <div className="character-default-action-row">
            <button
              className="character-default-revert"
              data-testid="character-talking-head-revert"
              disabled={disabled}
              onClick={() => {
                setTalkingHeadMotionIntensityPercent(
                  persistedTalkingHeadMotionIntensityPercent,
                );
                setIsTalkingHeadMotionPreviewing(false);
              }}
              type="button"
            >
              还原
            </button>
            <button
              className="character-default-apply"
              data-testid="character-talking-head-apply"
              disabled={disabled}
              onClick={() => {
                setIsTalkingHeadMotionPreviewing(false);
                onSetTalkingHeadMotionIntensityPercent(
                  talkingHeadMotionIntensityPercent,
                );
              }}
              type="button"
            >
              应用
            </button>
          </div>
        </div>
      ) : null}
    </section>
  ) : null;

  const structureContent = compositeCharacter ? (
              <>
                <ImageAssetPicker
                  assets={imageAssets}
                  emptyState={{
                    description: '从项目图片中选择身体。',
                    label: '请选择图片',
                  }}
                  label="身体"
                  onSelectedAssetActivate={
                    assemblyDraft?.bodyAssetId
                      ? () => selectAssemblyObject('body')
                      : undefined
                  }
                  onChange={(assetId) => {
                    if (assetId) onSetAssemblyBodyAsset(assetId);
                  }}
                  onRequestReplace={floatMode ? (trigger) => {
                    setSwapDialog({
                      title: '更换身体',
                      currentValue: { kind: 'image', assetId: assemblyDraft?.bodyAssetId ?? character.bodyAssetId },
                      allowGraphic: false,
                      returnFocusTo: trigger,
                      onConfirm: (next) => {
                        if (next.kind === 'image' && next.assetId) onSetAssemblyBodyAsset(next.assetId);
                      },
                    });
                  } : undefined}
                  onThumbnailError={onThumbnailError}
                  selectedAssetId={
                    assemblyDraft?.bodyAssetId ?? character.bodyAssetId
                  }
                  testId="character-assembly-body-picker"
                  thumbnails={thumbnails}
                  disabled={disabled}
                  selectedAssetActive={assemblyEditTarget === 'body'}
                  showEditTargetStatus={false}
                  selectedSurface
                />
                <ImageAssetPicker
                  assets={imageAssets}
                  emptyOption={{ label: '不添加头部', optional: true }}
                  emptyActionLabel="选择"
                  label="头部"
                  onChange={onSetAssemblyHeadAsset}
                  onRequestReplace={floatMode ? (trigger) => {
                    const currentHeadId = assemblyDraft
                      ? assemblyDraft.head?.assetId ?? null
                      : character.head?.assetId ?? null;
                    setSwapDialog({
                      title: '更换头部',
                      currentValue: { kind: 'image', assetId: currentHeadId },
                      emptyOption: { label: '不添加头部' },
                      allowGraphic: false,
                      returnFocusTo: trigger,
                      onConfirm: (next) => {
                        if (next.kind === 'image') onSetAssemblyHeadAsset(next.assetId);
                      },
                    });
                  } : undefined}
                  onThumbnailError={onThumbnailError}
                  onSelectedAssetActivate={
                    assemblyDraft?.head
                      ? () => selectAssemblyObject('head')
                      : undefined
                  }
                  searchAndPaginate
                  selectedAssetId={
                    assemblyDraft
                      ? assemblyDraft.head?.assetId ?? null
                      : character.head?.assetId ?? null
                  }
                  showEditTargetStatus={false}
                  showOptionalLabel={false}
                  testId="character-assembly-head-asset"
                  thumbnails={thumbnails}
                  disabled={disabled}
                  selectedAssetActive={assemblyEditTarget === 'head'}
                  selectedSurface
                />
                <div
                  className="character-assembly-default-face-summary image-asset-picker"
                  data-testid="character-assembly-default-face-summary"
                >
                  <div className="image-asset-picker-heading">
                    <strong>默认脸</strong>
                  </div>
                  {defaultExpression ? (
                    <ImageAssetPickerSelectedSurface>
                      <button
                        aria-label={`默认脸：${defaultExpression.name}，选择为编辑对象`}
                        aria-pressed={assemblyEditTarget === 'face'}
                        className="image-asset-picker-selected image-asset-picker-selected--compact-edit-target"
                        data-edit-target-selected={String(assemblyEditTarget === 'face')}
                        data-testid="character-assembly-default-face-select"
                        disabled={disabled || !assemblyDraft}
                        onClick={() => selectAssemblyObject('face')}
                        title={
                          defaultExpressionAsset
                            ? `${defaultExpression.name} · ${defaultExpressionAsset.name} · ${defaultExpressionAsset.width}×${defaultExpressionAsset.height}`
                            : defaultExpression.visualSource
                              ? `${defaultExpression.name} · 第 ${defaultExpression.visualSource.firstFrame + 1} 帧`
                              : `${defaultExpression.name} · 素材不可用`
                        }
                        type="button"
                      >
                        <CharacterExpressionThumbnail
                          className="image-asset-picker-selected-thumbnail"
                          expression={defaultExpression}
                          onThumbnailError={onThumbnailError}
                          thumbnail={defaultThumbnail}
                        />
                        <span className="image-asset-picker-selected-copy">
                          <strong>{defaultExpression.name}</strong>
                          <small>
                            {defaultExpressionAsset
                              ? (floatMode ? defaultExpressionAsset.name : `${defaultExpressionAsset.name} · ${defaultExpressionAsset.width}×${defaultExpressionAsset.height}`)
                              : defaultExpression.visualSource ? `第 ${defaultExpression.visualSource.firstFrame + 1} 帧` : '素材不可用'}
                          </small>
                        </span>
                      </button>
                      <button
                        aria-label={`管理默认脸：${defaultExpression.name}`}
                        className="image-asset-picker-selected-action character-assembly-selected-action-button"
                        data-testid="character-assembly-go-expressions"
                        disabled={disabled}
                        onClick={() => switchDetailWorkspace('expressions')}
                        type="button"
                      >
                        管理
                      </button>
                    </ImageAssetPickerSelectedSurface>
                  ) : null}
                </div>
                {(() => {
                  const mouthVisualSource = assemblyDraft
                    ? assemblyDraft.mouthOpenVisualSource
                    : character.mouthOpenVisualSource;
                  const mouthGraphicDef = mouthVisualSource
                    ? flaGraphicDefinitions.find((def) => def.id === mouthVisualSource.animationId)
                    : undefined;
                  const mouthPicker = (
                    <ImageAssetPicker
                      assets={imageAssets}
                      emptyOption={{
                        label: '暂不配置',
                      }}
                      label="张嘴脸"
                      onChange={onSetAssemblyMouthAsset}
                      onRequestReplace={floatMode ? (trigger) => {
                        setSwapDialog({
                          title: '更换张嘴脸',
                          currentValue: mouthVisualSource
                            ? { kind: 'fla-graphic', animationId: mouthVisualSource.animationId, firstFrame: mouthVisualSource.firstFrame }
                            : { kind: 'image', assetId: assemblyMouthAssetId },
                          emptyOption: { label: '暂不配置' },
                          allowGraphic: Boolean(onSetAssemblyMouthSource),
                          returnFocusTo: trigger,
                          onConfirm: (next) => {
                            if (next.kind === 'fla-graphic') {
                              onSetAssemblyMouthSource?.({
                                kind: 'fla-graphic',
                                animationId: next.animationId,
                                firstFrame: next.firstFrame ?? 0,
                              });
                            } else {
                              onSetAssemblyMouthAsset(next.assetId);
                            }
                          },
                        });
                      } : undefined}
                      onThumbnailError={onThumbnailError}
                      selectedAssetId={assemblyMouthAssetId}
                      selectedOverride={floatMode && mouthVisualSource ? {
                        label: mouthGraphicDef?.name ?? 'FLA 元件',
                        metadata: `第 ${mouthVisualSource.firstFrame + 1} 帧`,
                        preview: <GraphicFacePreview label="张嘴脸" source={mouthVisualSource} />,
                        tooltip: `${mouthGraphicDef?.name ?? 'FLA 元件'} · 第 ${mouthVisualSource.firstFrame + 1} 帧`,
                      } : undefined}
                      testId="character-assembly-mouth-picker"
                      thumbnails={thumbnails}
                      disabled={disabled}
                      selectedSurface
                      selectedAction={
                        assemblyMouthAssetId || (floatMode && mouthVisualSource) ? (
                          <CharacterAssemblyMouthOverflowMenu
                            disabled={disabled}
                            onClear={() => {
                              if (mouthVisualSource) onSetAssemblyMouthSource?.(null);
                              else onSetAssemblyMouthAsset(null);
                            }}
                          />
                        ) : undefined
                      }
                    />
                  );
                  return floatMode ? mouthPicker : (
                    <GraphicFacePicker source={mouthVisualSource} onChange={onSetAssemblyMouthSource} onClear={() => onSetAssemblyMouthSource?.(null)} testId="character-assembly-mouth-picker" disabled={disabled}>
                      {mouthPicker}
                    </GraphicFacePicker>
                  );
                })()}
              </>
            ) : singleImageCharacter && defaultExpression ? (
              <div
                className="character-single-structure-panel"
                data-testid="character-single-structure-panel"
              >
                {(() => {
                  const overallGraphicDef = defaultExpression.visualSource
                    ? flaGraphicDefinitions.find((def) => def.id === defaultExpression.visualSource?.animationId)
                    : undefined;
                  const singleStructurePicker = (
                    <ImageAssetPicker
                      assets={imageAssets}
                      emptyState={{
                        description: '从项目图片中选择整体图像。',
                        label: '请选择图片',
                      }}
                      label="整体图像"
                      onChange={(assetId) => {
                        if (assetId) {
                          onSetExpressionAsset(defaultExpression.id, assetId);
                        }
                      }}
                      onRequestReplace={floatMode ? (trigger) => {
                        setSwapDialog({
                          title: '更换整体图像',
                          currentValue: defaultExpression.visualSource
                            ? {
                                kind: 'fla-graphic',
                                animationId: defaultExpression.visualSource.animationId,
                                firstFrame: defaultExpression.visualSource.firstFrame,
                              }
                            : { kind: 'image', assetId: defaultExpression.assetId ?? null },
                          allowGraphic: Boolean(onSetExpressionSource),
                          returnFocusTo: trigger,
                          onConfirm: (next) => {
                            if (next.kind === 'fla-graphic') {
                              onSetExpressionSource?.(defaultExpression.id, {
                                kind: 'fla-graphic',
                                animationId: next.animationId,
                                firstFrame: next.firstFrame ?? 0,
                              });
                            } else if (next.assetId) {
                              onSetExpressionAsset(defaultExpression.id, next.assetId);
                            }
                          },
                        });
                      } : undefined}
                      onThumbnailError={onThumbnailError}
                      selectedAssetId={defaultExpression.assetId ?? null}
                      selectedOverride={floatMode && defaultExpression.visualSource ? {
                        label: overallGraphicDef?.name ?? 'FLA 元件',
                        metadata: `第 ${defaultExpression.visualSource.firstFrame + 1} 帧`,
                        preview: <GraphicFacePreview label="整体图像" source={defaultExpression.visualSource} />,
                        tooltip: `${overallGraphicDef?.name ?? 'FLA 元件'} · 第 ${defaultExpression.visualSource.firstFrame + 1} 帧`,
                      } : undefined}
                      testId="character-single-structure-image-picker"
                      thumbnails={thumbnails}
                      disabled={disabled}
                      selectedSurface
                    />
                  );
                  return floatMode ? singleStructurePicker : (
                    <GraphicFacePicker
                      source={defaultExpression.visualSource}
                      onChange={(source) => {
                        if (source && onSetExpressionSource) {
                          onSetExpressionSource(defaultExpression.id, source);
                        }
                      }}
                      testId="character-single-structure-image-picker"
                      disabled={disabled}
                    >
                      {singleStructurePicker}
                    </GraphicFacePicker>
                  );
                })()}
              </div>
            ) : null;
  const expressionContent = (<ExpressionEditor
                character={expressionCharacter}
                disabled={disabled}
                graphicDefinitions={flaGraphicDefinitions}
                imageAssets={imageAssets}
                isAddOpen={expressionAddOpen}
                onAdd={onAddExpression}
                onAddOpenChange={setExpressionAddOpen}
                onRemove={onRemoveExpression}
                onRename={onRenameExpression}
                onSetAsset={onSetExpressionAsset}
                onSetSource={onSetExpressionSource}
                onAddGraphic={onAddGraphicExpression}
                onRequestResourceSwap={floatMode ? (request) => {
                  setSwapDialog({
                    title: request.title,
                    currentValue: request.currentValue,
                    allowGraphic: Boolean(onSetExpressionSource || onAddGraphicExpression),
                    returnFocusTo: request.trigger,
                    onConfirm: request.onConfirm,
                  });
                } : undefined}
                onSetDefault={onSetDefaultExpression}
                onThumbnailError={onThumbnailError}
                compactDetailWorkspace
                onPreview={floatMode === 'single-image' ? (id) => {
                  setPreviewExpressionId(id);
                  setPreviewMouth(false);
                } : undefined}
                previewExpressionId={previewMouth ? undefined : previewExpressionId ?? defaultExpression?.id}
                presentation="landscape"
                thumbnails={thumbnails}
                warnings={warnings}
              />);
  const defaultProperties = (<><section
              className="character-settings-section character-default-presentation"
              data-default-transform-pending={hasPendingTransform}
            >
              <div className="character-section-heading">
                <div>
                  <h4 id="character-settings-workspace-heading">
                    初始角色大小
                  </h4>
                </div>
              </div>
              <div className="character-default-transform-controls">
                <div className="character-scale-control-group">
                  <div
                    aria-label="初始角色大小"
                    className="character-scale-stepper"
                    role="group"
                  >
                    <button
                      aria-label="减小初始角色大小"
                      disabled={disabled || scale <= 0.1}
                      onClick={() => adjustScale(-0.1)}
                      type="button"
                    >
                      −
                    </button>
                    <output aria-live="polite">{scale.toFixed(1)}×</output>
                    <button
                      aria-label="增大初始角色大小"
                      disabled={disabled || scale >= 10}
                      onClick={() => adjustScale(0.1)}
                      type="button"
                    >
                      +
                    </button>
                  </div>
                </div>
                <button
                  aria-checked={flipX}
                  className="character-flip-switch"
                  disabled={disabled}
                  onClick={() => setFlipX((current) => !current)}
                  role="switch"
                  type="button"
                >
                  <span>水平翻转</span>
                  <span aria-hidden="true" className="character-switch-track">
                    <span />
                  </span>
                </button>
              </div>
              {hasPendingTransform ? (
                <div
                  aria-live="polite"
                  className="character-default-pending"
                  data-testid="character-default-pending"
                  role="status"
                >
                  <div>
                    <strong>● 有未应用更改</strong>
                    <span>当前设置尚未应用到角色</span>
                  </div>
                  <div className="character-default-action-row">
                    <button
                      aria-label="还原未应用的默认表现"
                      className="character-default-revert"
                      data-testid="character-default-revert"
                      disabled={disabled}
                      onClick={() => {
                        setScale(character.defaultScale);
                        setFlipX(character.defaultFlipX);
                      }}
                      type="button"
                    >
                      还原
                    </button>
                    <button
                      className="character-default-apply"
                      data-pending="true"
                      disabled={
                        disabled ||
                        !Number.isFinite(scale) ||
                        scale < 0.1 ||
                        scale > 10
                      }
                      onClick={() => onSetDefaultTransform(scale, flipX)}
                      type="button"
                    >
                      应用
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
            {talkingHeadSettings}</>);
  const singleMouth = singleImageCharacter && expressionCharacter ? (() => {
            const mouthVisualSource = expressionCharacter.mouthOpenVisualSource;
            const mouthGraphicDef = mouthVisualSource
              ? flaGraphicDefinitions.find((def) => def.id === mouthVisualSource.animationId)
              : undefined;
            const mouthPicker = (
              <ImageAssetPicker
                assets={imageAssets}
                emptyActionLabel="选择图片"
                emptyOption={{
                  description: '设置张嘴图后，可在表情中使用。',
                  label: '未设置',
                }}
                label="张嘴图"
                onChange={onSetMouthOpenAsset}
                onRequestReplace={floatMode ? (trigger) => {
                  setSwapDialog({
                    title: '更换张嘴图',
                    currentValue: mouthVisualSource
                      ? { kind: 'fla-graphic', animationId: mouthVisualSource.animationId, firstFrame: mouthVisualSource.firstFrame }
                      : { kind: 'image', assetId: expressionCharacter.mouthOpenAssetId ?? null },
                    emptyOption: { label: '未设置', description: '设置张嘴图后，可在表情中使用。' },
                    allowGraphic: Boolean(onSetMouthSource),
                    returnFocusTo: trigger,
                    onConfirm: (next) => {
                      if (next.kind === 'fla-graphic') {
                        onSetMouthSource?.({
                          kind: 'fla-graphic',
                          animationId: next.animationId,
                          firstFrame: next.firstFrame ?? 0,
                        });
                      } else {
                        onSetMouthOpenAsset(next.assetId);
                      }
                    },
                  });
                } : undefined}
                onThumbnailError={onThumbnailError}
                selectedAssetId={expressionCharacter.mouthOpenAssetId ?? null}
                selectedOverride={floatMode && mouthVisualSource ? {
                  label: mouthGraphicDef?.name ?? 'FLA 元件',
                  metadata: `第 ${mouthVisualSource.firstFrame + 1} 帧`,
                  preview: <GraphicFacePreview label="张嘴图" source={mouthVisualSource} />,
                  tooltip: `${mouthGraphicDef?.name ?? 'FLA 元件'} · 第 ${mouthVisualSource.firstFrame + 1} 帧`,
                } : undefined}
                selectedSurface={Boolean(floatMode)}
                testId="character-detail-mouth-visual-picker"
                thumbnails={thumbnails}
                disabled={disabled}
                selectedAction={
                  expressionCharacter.mouthOpenAssetId || (floatMode && mouthVisualSource) ? (
                    <button
                      className="character-mouth-clear"
                      disabled={disabled}
                      onClick={() => {
                        if (mouthVisualSource) onSetMouthSource?.(null);
                        else onSetMouthOpenAsset(null);
                      }}
                      type="button"
                    >
                      清除
                    </button>
                  ) : undefined
                }
              />
            );
            return (
            <section className="character-settings-section character-mouth-setting-visual">
              <div
                className={`character-mouth-state${expressionCharacter.mouthOpenAssetId || expressionCharacter.mouthOpenVisualSource ? ' is-configured' : ''}`}
                data-mouth-configured={Boolean(expressionCharacter.mouthOpenAssetId || expressionCharacter.mouthOpenVisualSource)}
              >
                {floatMode ? mouthPicker : (
                  <GraphicFacePicker source={expressionCharacter.mouthOpenVisualSource} onChange={onSetMouthSource} onClear={() => onSetMouthSource?.(null)} testId="character-detail-mouth-visual-picker" disabled={disabled}>
                    {mouthPicker}
                  </GraphicFacePicker>
                )}
              </div>
              {floatMode === 'single-image' && (character.mouthOpenAssetId || character.mouthOpenVisualSource) ? (
                <Button aria-pressed={previewMouth} className="character-float-mouth-preview-button" onClick={() => setPreviewMouth(!previewMouth)} variant="secondary">预览张嘴</Button>
              ) : null}
            </section>
            );
          })() : null;
  const deleteProperties = floatMode ? (
    <Button className="character-float-delete" data-testid="character-delete-settings" disabled={disabled} onClick={onDeleteCharacter} variant="danger">删除角色</Button>
  ) : (<section
              aria-labelledby="character-danger-zone-heading"
              className="character-settings-section character-danger-zone"
              data-testid="character-danger-zone"
            >
              <div className="character-danger-zone-copy">
                <h4 id="character-danger-zone-heading">危险操作</h4>
                <p>
                  删除当前角色；如果角色被镜头或对白引用，删除会被阻止。
                </p>
              </div>
              <button
                className="character-delete-settings-action"
                data-testid="character-delete-settings"
                disabled={disabled}
                onClick={onDeleteCharacter}
                type="button"
              >
                删除角色
              </button>
            </section>);
  if (floatMode && floatTarget) {
    const shownExpression = character.expressions.find(expression => expression.id === previewExpressionId) ?? defaultExpression;
    const showMouth = previewMouth && Boolean(character.mouthOpenAssetId || character.mouthOpenVisualSource);
    const shownSource = showMouth ? character.mouthOpenVisualSource : shownExpression?.visualSource;
    const shownAssetId = showMouth ? character.mouthOpenAssetId : shownExpression?.assetId;
    const shownAsset = imageAssets.find(asset => asset.id === shownAssetId);
    const shownThumbnail = shownAssetId ? thumbnails[shownAssetId] : undefined;
    const leftId = floatId + '-operations';
    const rightId = floatId + '-properties';

    const bodyAssetId = compositeCharacter ? (assemblyDraft?.bodyAssetId ?? character.bodyAssetId) : '';
    const bodyAsset = bodyAssetId ? imageAssets.find((asset) => asset.id === bodyAssetId) : undefined;
    const headAssetId = compositeCharacter ? (assemblyDraft ? assemblyDraft.head?.assetId ?? null : character.head?.assetId ?? null) : null;
    const headAsset = headAssetId ? imageAssets.find((asset) => asset.id === headAssetId) : undefined;
    const hasAssemblyHead = Boolean(assemblyDraft ? assemblyDraft.head : character.mode === 'composite' && character.head);
    const defaultExpressionGraphicDef = defaultExpression?.visualSource
      ? flaGraphicDefinitions.find((def) => def.id === defaultExpression.visualSource?.animationId)
      : undefined;

    const openBodySwap = (trigger: HTMLElement | null): void => {
      if (!compositeCharacter) return;
      setSwapDialog({
        title: '更换身体',
        currentValue: { kind: 'image', assetId: bodyAssetId },
        allowGraphic: false,
        returnFocusTo: trigger,
        onConfirm: (next) => {
          if (next.kind === 'image' && next.assetId) onSetAssemblyBodyAsset(next.assetId);
        },
      });
    };

    const openHeadSwap = (trigger: HTMLElement | null): void => {
      if (!compositeCharacter) return;
      setSwapDialog({
        title: '更换头部',
        currentValue: { kind: 'image', assetId: headAssetId },
        emptyOption: { label: '不添加头部' },
        allowGraphic: false,
        returnFocusTo: trigger,
        onConfirm: (next) => {
          if (next.kind === 'image') onSetAssemblyHeadAsset(next.assetId);
        },
      });
    };

    const overallVisualSource = defaultExpression?.visualSource;
    const overallGraphicDef = overallVisualSource
      ? flaGraphicDefinitions.find((def) => def.id === overallVisualSource.animationId)
      : undefined;
    const openOverallSwap = (trigger: HTMLElement | null): void => {
      if (!defaultExpression) return;
      setSwapDialog({
        title: '更换整体图像',
        currentValue: overallVisualSource
          ? {
              kind: 'fla-graphic',
              animationId: overallVisualSource.animationId,
              firstFrame: overallVisualSource.firstFrame,
            }
          : { kind: 'image', assetId: defaultExpression.assetId ?? null },
        allowGraphic: Boolean(onSetExpressionSource),
        returnFocusTo: trigger,
        onConfirm: (next) => {
          if (next.kind === 'fla-graphic') {
            onSetExpressionSource?.(defaultExpression.id, {
              kind: 'fla-graphic',
              animationId: next.animationId,
              firstFrame: next.firstFrame ?? 0,
            });
          } else if (next.assetId) {
            onSetExpressionAsset(defaultExpression.id, next.assetId);
          }
        },
      });
    };

    const compositeMouthVisualSource = compositeCharacter
      ? (assemblyDraft ? assemblyDraft.mouthOpenVisualSource : character.mouthOpenVisualSource)
      : undefined;
    const compositeMouthGraphicDef = compositeMouthVisualSource
      ? flaGraphicDefinitions.find((def) => def.id === compositeMouthVisualSource.animationId)
      : undefined;
    const compositeMouthAsset = assemblyMouthAssetId
      ? imageAssets.find((asset) => asset.id === assemblyMouthAssetId)
      : undefined;
    const compositeMouthConfigured = Boolean(assemblyMouthAssetId || compositeMouthVisualSource);
    const openCompositeMouthSwap = (trigger: HTMLElement | null): void => {
      setSwapDialog({
        title: '更换张嘴脸',
        currentValue: compositeMouthVisualSource
          ? {
              kind: 'fla-graphic',
              animationId: compositeMouthVisualSource.animationId,
              firstFrame: compositeMouthVisualSource.firstFrame,
            }
          : { kind: 'image', assetId: assemblyMouthAssetId },
        emptyOption: { label: '暂不配置' },
        allowGraphic: Boolean(onSetAssemblyMouthSource),
        returnFocusTo: trigger,
        onConfirm: (next) => {
          if (next.kind === 'fla-graphic') {
            onSetAssemblyMouthSource?.({
              kind: 'fla-graphic',
              animationId: next.animationId,
              firstFrame: next.firstFrame ?? 0,
            });
          } else {
            onSetAssemblyMouthAsset(next.assetId);
          }
        },
      });
    };

    const singleMouthVisualSource = singleImageCharacter ? expressionCharacter.mouthOpenVisualSource : undefined;
    const singleMouthGraphicDef = singleMouthVisualSource
      ? flaGraphicDefinitions.find((def) => def.id === singleMouthVisualSource.animationId)
      : undefined;
    const singleMouthAssetId = singleImageCharacter ? (expressionCharacter.mouthOpenAssetId ?? null) : null;
    const singleMouthAsset = singleMouthAssetId
      ? imageAssets.find((asset) => asset.id === singleMouthAssetId)
      : undefined;
    const isSingleMouthConfigured = Boolean(singleMouthAssetId || singleMouthVisualSource);
    const openSingleMouthSwap = (trigger: HTMLElement | null): void => {
      setSwapDialog({
        title: '更换张嘴图',
        currentValue: singleMouthVisualSource
          ? {
              kind: 'fla-graphic',
              animationId: singleMouthVisualSource.animationId,
              firstFrame: singleMouthVisualSource.firstFrame,
            }
          : { kind: 'image', assetId: singleMouthAssetId },
        emptyOption: { label: '未设置', description: '设置张嘴图后，可在表情中使用。' },
        allowGraphic: Boolean(onSetMouthSource),
        returnFocusTo: trigger,
        onConfirm: (next) => {
          if (next.kind === 'fla-graphic') {
            onSetMouthSource?.({
              kind: 'fla-graphic',
              animationId: next.animationId,
              firstFrame: next.firstFrame ?? 0,
            });
          } else {
            onSetMouthOpenAsset(next.assetId);
          }
        },
      });
    };

    const floatPartsContent = compositeCharacter ? (
      <div className="character-compact-list" data-testid="character-assembly-parts-list">
        <CharacterCompactObjectRow
          actions={
            <button
              aria-label="更换身体"
              className="character-compact-icon-button"
              data-testid="character-assembly-body-picker-change-action"
              disabled={disabled}
              onClick={(event) => openBodySwap(event.currentTarget)}
              title="更换身体"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          }
          assetState={bodyAsset ? 'configured' : bodyAssetId ? 'missing' : 'empty'}
          disabled={disabled}
          onSelect={(trigger) =>
            assemblyDraft?.bodyAssetId ? selectAssemblyObject('body') : openBodySwap(trigger)
          }
          rowTestId="character-assembly-body-picker"
          selectAriaLabel={`身体：${bodyAsset?.name ?? '素材不可用'}，选择为编辑对象`}
          selectTestId="character-assembly-body-picker-selected"
          selected={assemblyEditTarget === 'body'}
          subtitle={bodyAsset?.name ?? '素材不可用'}
          thumbnail={
            <CompactRowAssetThumbnail
              asset={bodyAsset}
              assetConfigured={Boolean(bodyAssetId)}
              label="身体"
              onThumbnailError={onThumbnailError}
              thumbnail={bodyAssetId ? thumbnails[bodyAssetId] : undefined}
            />
          }
          title="身体"
          tooltip={bodyAsset ? `${bodyAsset.name} · ${bodyAsset.width}×${bodyAsset.height}` : undefined}
        />
        <CharacterCompactObjectRow
          actions={
            <button
              aria-label="更换头部"
              className="character-compact-icon-button"
              data-testid="character-assembly-head-asset-change-action"
              disabled={disabled}
              onClick={(event) => openHeadSwap(event.currentTarget)}
              title="更换头部"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          }
          assetState={headAsset ? 'configured' : headAssetId ? 'missing' : 'empty'}
          disabled={disabled}
          onSelect={(trigger) =>
            hasAssemblyHead ? selectAssemblyObject('head') : openHeadSwap(trigger)
          }
          rowTestId="character-assembly-head-asset"
          selectAriaLabel={
            hasAssemblyHead
              ? `头部：${headAsset?.name ?? '素材不可用'}，选择为编辑对象`
              : '头部：未添加头部，点击选择'
          }
          selectTestId="character-assembly-head-asset-selected"
          selected={hasAssemblyHead ? assemblyEditTarget === 'head' : undefined}
          subtitle={headAsset ? headAsset.name : headAssetId ? '素材不可用' : '未添加头部'}
          thumbnail={
            <CompactRowAssetThumbnail
              asset={headAsset}
              assetConfigured={Boolean(headAssetId)}
              label="头部"
              onThumbnailError={onThumbnailError}
              thumbnail={headAssetId ? thumbnails[headAssetId] : undefined}
            />
          }
          title="头部"
          tooltip={headAsset ? `${headAsset.name} · ${headAsset.width}×${headAsset.height}` : '头部'}
        />
        <CharacterCompactObjectRow
          actions={
            <button
              aria-label={defaultExpression ? `管理默认脸：${defaultExpression.name}` : '前往表情管理'}
              className="character-compact-icon-button"
              data-testid="character-assembly-go-expressions"
              disabled={disabled}
              onClick={() => switchDetailWorkspace('expressions')}
              title="前往表情管理"
              type="button"
            >
              <Pencil aria-hidden="true" size={16} />
            </button>
          }
          assetState={
            defaultExpression?.visualSource || defaultExpressionAsset
              ? 'configured'
              : defaultExpression?.assetId
                ? 'missing'
                : 'empty'
          }
          disabled={disabled || !assemblyDraft}
          onSelect={defaultExpression ? () => selectAssemblyObject('face') : undefined}
          rowTestId="character-assembly-default-face-summary"
          selectAriaLabel={
            defaultExpression
              ? `默认脸：${defaultExpression.name}，选择为编辑对象`
              : '默认脸'
          }
          selectTestId="character-assembly-default-face-select"
          selected={assemblyEditTarget === 'face'}
          subtitle={
            defaultExpression
              ? defaultExpressionAsset
                ? defaultExpressionAsset.name
                : defaultExpression.visualSource
                  ? `${defaultExpressionGraphicDef?.name ?? 'FLA 元件'} · 第 ${defaultExpression.visualSource.firstFrame + 1} 帧`
                  : '素材不可用'
              : '未配置'
          }
          thumbnail={
            defaultExpression ? (
              <CharacterExpressionThumbnail
                expression={defaultExpression}
                onThumbnailError={onThumbnailError}
                thumbnail={defaultThumbnail}
              />
            ) : (
              <CompactRowAssetThumbnail
                asset={undefined}
                assetConfigured={false}
                label="默认脸"
              />
            )
          }
          title="默认脸"
          tooltip={
            defaultExpression
              ? defaultExpressionAsset
                ? `${defaultExpression.name} · ${defaultExpressionAsset.name} · ${defaultExpressionAsset.width}×${defaultExpressionAsset.height}`
                : defaultExpression.visualSource
                  ? `${defaultExpression.name} · 第 ${defaultExpression.visualSource.firstFrame + 1} 帧`
                  : `${defaultExpression.name} · 素材不可用`
              : undefined
          }
        />
      </div>
    ) : singleImageCharacter && defaultExpression ? (
      <div className="character-compact-list" data-testid="character-single-structure-panel">
        <CharacterCompactObjectRow
          actions={
            <button
              aria-label="更换整体图像"
              className="character-compact-icon-button"
              data-testid="character-single-structure-image-picker-change-action"
              disabled={disabled}
              onClick={(event) => openOverallSwap(event.currentTarget)}
              title="更换整体图像"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
          }
          assetState={
            overallVisualSource || defaultExpressionAsset
              ? 'configured'
              : defaultExpression.assetId
                ? 'missing'
                : 'empty'
          }
          disabled={disabled}
          onSelect={openOverallSwap}
          rowTestId="character-single-structure-image-picker"
          selectAriaLabel="更换整体图像"
          selectTestId="character-single-structure-image-picker-selected"
          subtitle={
            overallVisualSource
              ? `${overallGraphicDef?.name ?? 'FLA 元件'} · 第 ${overallVisualSource.firstFrame + 1} 帧`
              : defaultExpressionAsset?.name ?? (defaultExpression.assetId ? '素材不可用' : '请选择图片')
          }
          thumbnail={
            overallVisualSource ? (
              <GraphicFacePreview label="整体图像" source={overallVisualSource} />
            ) : (
              <CompactRowAssetThumbnail
                asset={defaultExpressionAsset}
                assetConfigured={Boolean(defaultExpression.assetId)}
                label="整体图像"
                onThumbnailError={onThumbnailError}
                thumbnail={defaultThumbnail}
              />
            )
          }
          title="整体图像"
          tooltip={
            overallVisualSource
              ? `${overallGraphicDef?.name ?? 'FLA 元件'} · 第 ${overallVisualSource.firstFrame + 1} 帧`
              : defaultExpressionAsset
                ? `${defaultExpressionAsset.name} · ${defaultExpressionAsset.width}×${defaultExpressionAsset.height}`
                : '整体图像'
          }
        />
      </div>
    ) : null;

    const floatMouthRow = compositeCharacter ? (
      <CharacterCompactObjectRow
        actions={
          <>
            <button
              aria-label="更换张嘴脸"
              className="character-compact-icon-button"
              data-testid="character-assembly-mouth-picker-change-action"
              disabled={disabled}
              onClick={(event) => openCompositeMouthSwap(event.currentTarget)}
              title="更换张嘴脸"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} />
            </button>
            {compositeMouthConfigured ? (
              <CompactRowOverflowMenu
                ariaLabel="张嘴脸更多操作"
                disabled={disabled}
                items={[
                  {
                    label: '清除',
                    className: 'character-mouth-clear',
                    danger: true,
                    testId: 'character-assembly-mouth-clear',
                    onSelect: () => {
                      if (compositeMouthVisualSource) onSetAssemblyMouthSource?.(null);
                      else onSetAssemblyMouthAsset(null);
                    },
                  },
                ]}
                menuClassName="character-assembly-mouth-overflow-menu"
                menuTestId="character-assembly-mouth-overflow-menu"
                restoreFocusSelector='[data-testid="character-assembly-mouth-picker-selected"]'
                triggerClassName="character-assembly-mouth-overflow-trigger"
                triggerTestId="character-assembly-mouth-overflow-trigger"
              />
            ) : null}
          </>
        }
        assetState={
          compositeMouthVisualSource || compositeMouthAsset
            ? 'configured'
            : assemblyMouthAssetId
              ? 'missing'
              : 'empty'
        }
        disabled={disabled}
        onSelect={openCompositeMouthSwap}
        rowTestId="character-assembly-mouth-picker"
        selectAriaLabel="更换张嘴脸"
        selectTestId="character-assembly-mouth-picker-selected"
        subtitle={
          compositeMouthVisualSource
            ? `${compositeMouthGraphicDef?.name ?? 'FLA 元件'} · 第 ${compositeMouthVisualSource.firstFrame + 1} 帧`
            : compositeMouthAsset?.name ?? (assemblyMouthAssetId ? '素材不可用' : '暂不配置')
        }
        thumbnail={
          compositeMouthVisualSource ? (
            <GraphicFacePreview label="张嘴脸" source={compositeMouthVisualSource} />
          ) : (
            <CompactRowAssetThumbnail
              asset={compositeMouthAsset}
              assetConfigured={Boolean(assemblyMouthAssetId)}
              label="张嘴脸"
              onThumbnailError={onThumbnailError}
              thumbnail={assemblyMouthAssetId ? thumbnails[assemblyMouthAssetId] : undefined}
            />
          )
        }
        title="张嘴脸"
        tooltip={
          compositeMouthVisualSource
            ? `${compositeMouthGraphicDef?.name ?? 'FLA 元件'} · 第 ${compositeMouthVisualSource.firstFrame + 1} 帧`
            : compositeMouthAsset
              ? `${compositeMouthAsset.name} · ${compositeMouthAsset.width}×${compositeMouthAsset.height}`
              : '张嘴脸'
        }
      />
    ) : singleImageCharacter ? (
      <div
        className={`character-mouth-state${isSingleMouthConfigured ? ' is-configured' : ''}`}
        data-mouth-configured={isSingleMouthConfigured}
      >
        <CharacterCompactObjectRow
          actions={
            <>
              {isSingleMouthConfigured ? (
                <button
                  aria-label={previewMouth ? '停止预览张嘴' : '预览张嘴'}
                  aria-pressed={previewMouth}
                  className="character-compact-icon-button character-float-mouth-preview-button"
                  onClick={() => setPreviewMouth(!previewMouth)}
                  title={previewMouth ? '停止预览张嘴' : '预览张嘴'}
                  type="button"
                >
                  <Play aria-hidden="true" size={16} />
                </button>
              ) : null}
              <button
                aria-label="更换张嘴图"
                className="character-compact-icon-button"
                data-testid="character-detail-mouth-visual-picker-change-action"
                disabled={disabled}
                onClick={(event) => openSingleMouthSwap(event.currentTarget)}
                title="更换张嘴图"
                type="button"
              >
                <RefreshCw aria-hidden="true" size={16} />
              </button>
              {isSingleMouthConfigured ? (
                <CompactRowOverflowMenu
                  ariaLabel="张嘴图更多操作"
                  disabled={disabled}
                  items={[
                    {
                      label: '清除',
                      className: 'character-mouth-clear',
                      danger: true,
                      testId: 'character-detail-mouth-clear',
                      onSelect: () => {
                        setPreviewMouth(false);
                        if (singleMouthVisualSource) onSetMouthSource?.(null);
                        else onSetMouthOpenAsset(null);
                      },
                    },
                  ]}
                  menuTestId="character-detail-mouth-overflow-menu"
                  restoreFocusSelector='[data-testid="character-detail-mouth-visual-picker-selected"]'
                  triggerTestId="character-detail-mouth-overflow-trigger"
                />
              ) : null}
            </>
          }
          assetState={
            singleMouthVisualSource || singleMouthAsset
              ? 'configured'
              : singleMouthAssetId
                ? 'missing'
                : 'empty'
          }
          disabled={disabled}
          onSelect={openSingleMouthSwap}
          previewing={previewMouth && isSingleMouthConfigured}
          rowTestId="character-detail-mouth-visual-picker"
          selectAriaLabel="更换张嘴图"
          selectTestId="character-detail-mouth-visual-picker-selected"
          subtitle={
            singleMouthVisualSource
              ? `${singleMouthGraphicDef?.name ?? 'FLA 元件'} · 第 ${singleMouthVisualSource.firstFrame + 1} 帧`
              : singleMouthAsset?.name ?? (singleMouthAssetId ? '素材不可用' : '未设置')
          }
          thumbnail={
            singleMouthVisualSource ? (
              <GraphicFacePreview label="张嘴图" source={singleMouthVisualSource} />
            ) : (
              <CompactRowAssetThumbnail
                asset={singleMouthAsset}
                assetConfigured={Boolean(singleMouthAssetId)}
                label="张嘴图"
                onThumbnailError={onThumbnailError}
                thumbnail={singleMouthAssetId ? thumbnails[singleMouthAssetId] : undefined}
              />
            )
          }
          title="张嘴图"
          tooltip={
            singleMouthVisualSource
              ? `${singleMouthGraphicDef?.name ?? 'FLA 元件'} · 第 ${singleMouthVisualSource.firstFrame + 1} 帧`
              : singleMouthAsset
                ? `${singleMouthAsset.name} · ${singleMouthAsset.width}×${singleMouthAsset.height}`
                : '张嘴图'
          }
        />
      </div>
    ) : null;

    return createPortal(
      <article className="character-editor character-float-detail" data-testid="character-float-detail" data-mode={floatMode}>
        <header className="character-float-heading">
          <Button aria-label="返回角色列表" data-testid="character-detail-back" onClick={onBackToList} variant="secondary">
            <ArrowLeft aria-hidden="true" size={16} />
          </Button>
          <div className="character-float-title">
            <strong title={character.name}>{character.name}</strong>
            <Button aria-controls={rightId} aria-expanded={rightOpen && (floatMode === 'single-image' || floatProperties === 'character')} aria-label="角色属性" data-testid="character-float-role-edit" onClick={showFloatRole} variant="secondary">
              <Pencil size={16} aria-hidden="true" />
            </Button>
          </div>
          <div className="character-float-heading-actions">
            <Button disabled={placementUnavailableReason !== null} onClick={() => onPlaceInCurrentShot(placementBlockedByTransform)} title={placementUnavailableReason ?? undefined} data-testid="character-detail-place-current-shot" variant="secondary">
              <Plus aria-hidden="true" size={15} /> 加入镜头
            </Button>
            <Button aria-label="关闭角色工作台" data-testid="character-float-close" onClick={onCloseDrawer} variant="secondary">
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
        </header>
        <div className={'character-float-canvas character-assembly-preview-viewport' + (floatMode === 'composite' ? ' character-float-composite-canvas' : '')} data-testid="character-float-canvas">
          {floatMode === 'composite' ? (
            projectSnapshot && assemblySession ? <CharacterAssemblyWorkbench
              projectSnapshot={projectSnapshot}
              session={assemblySession}
              floatingComposite={{
                editable: floatOperations === 'parts',
                leftOpen,
                propertiesOpen: rightOpen,
                controlsOpen: rightOpen && floatProperties === 'part',
                propertyTarget: precisionTarget,
                onToggleControls: () => {
                  if (rightOpen && floatProperties === 'part') setRightOpen(false);
                  else openProperties('part');
                },
              }}
            /> : null
          ) : shownSource ? (
            <GraphicFacePreview source={shownSource} label={character.name} />
          ) : shownAsset && projectSnapshot ? (
            <CharacterSingleImagePreview asset={shownAsset} projectRoot={projectSnapshot.projectRoot} label={character.name} thumbnail={shownThumbnail} />
          ) : (
            <CharacterThumbnailFallback assetConfigured={Boolean(defaultExpression)} assetResolved={defaultAssetResolved} thumbnail={defaultThumbnail} />
          )}
        </div>
        <CharacterFloatPanel
          side="left" open={leftOpen} id={leftId} handle={leftHandle}
          onToggle={() => {
            if (!leftOpen && isNarrowFloat()) setRightOpen(false);
            setLeftOpen(!leftOpen);
          }}
        >
          <div className="character-float-operations">
            <nav aria-label="角色操作" className="character-float-left-nav">
              <Button aria-pressed={floatOperations === 'parts'} onClick={() => switchFloatOperations('parts')} variant="secondary">部件</Button>
              <Button aria-pressed={floatOperations === 'expressions'} onClick={() => switchFloatOperations('expressions')} variant="secondary">表情</Button>
            </nav>
            <div className="character-float-section-stack" hidden={floatOperations !== 'parts'}>
              {floatPartsContent}
            </div>
            <div className="character-float-section-stack" hidden={floatOperations !== 'expressions'}>
              {floatMouthRow}
              <div className="character-float-expression-heading">
                <strong id="character-expression-workspace-heading">表情</strong>
                <Button aria-expanded={expressionAddOpen} className="character-float-expression-add" onClick={() => setExpressionAddOpen(!expressionAddOpen)} variant="secondary">
                  <Plus aria-hidden="true" size={14} /> 添加
                </Button>
              </div>
              {expressionContent}
            </div>
          </div>
        </CharacterFloatPanel>
        <CharacterFloatPanel
          side="right" open={rightOpen} id={rightId} handle={rightHandle}
          onToggle={() => {
            if (rightOpen) setRightOpen(false);
            else openProperties(floatProperties);
          }}
        >
          {floatMode === 'composite' && floatProperties === 'part' && floatOperations === 'parts' ? (
            <div ref={setPrecisionTarget} className="character-float-precision" />
          ) : (
          <fieldset className="character-float-role-properties" disabled={disabled || assemblyPending}>
          <legend>角色属性</legend>
          {floatMode === 'single-image' && (showMouth || previewExpressionId) ? (
            <output className="character-float-preview-selection">{showMouth ? '张嘴图' : shownExpression?.name}</output>
          ) : null}
          <form className="character-float-rename" onSubmit={(event) => {
            event.preventDefault();
            if (nextRenameValue) onRenameCharacter(nextRenameValue);
          }}>
            <label>角色名称
              <input maxLength={200} onChange={(event) => setName(event.currentTarget.value)} value={name} />
            </label>
            <Button className="character-float-rename-submit" disabled={disabled || !nextRenameValue} type="submit" variant="secondary">重命名</Button>
          </form>
          {defaultProperties}
          <div className="character-float-danger-footer">{deleteProperties}</div>
          </fieldset>
          )}
          {floatProperties === 'character' && assemblyPending ? <p role="status">请先应用或取消组装更改。</p> : null}
        </CharacterFloatPanel>
        {status ? <output className="character-float-status" role="status">{status}</output> : null}
        {swapDialog ? (
          <CharacterResourceSwapDialog
            currentValue={swapDialog.currentValue}
            emptyOption={swapDialog.emptyOption}
            graphicDefinitions={swapDialog.allowGraphic ? flaGraphicDefinitions : []}
            graphicSelectionMode="frame"
            imageAssets={imageAssets}
            onCancel={() => setSwapDialog(null)}
            onConfirm={(next) => {
              const confirmFn = swapDialog.onConfirm;
              setSwapDialog(null);
              confirmFn(next);
            }}
            onThumbnailError={onThumbnailError}
            open
            returnFocusTo={swapDialog.returnFocusTo}
            thumbnails={thumbnails}
            title={swapDialog.title}
          />
        ) : null}
      </article>,
      floatTarget,
    );
  }

  return (
    <article
      className={`character-editor${view === 'expression' ? ' character-expression-view' : ''}`}
      data-character-editor-id={character.id}
      data-character-editor-presentation={presentation}
      aria-labelledby={landscapeDetail ? 'character-detail-title' : undefined}
      data-testid={
        view === 'detail'
          ? 'character-detail-view'
          : view === 'expression'
            ? 'character-expression-view'
            : undefined
      }
    >
      {landscapeCharacterNavigation ? (
        <div
          className={`character-detail-navigation${landscapeDetail ? ' character-detail-navigation-detail' : ''}`}
        >
          <button
            aria-label={landscapeDetail ? '返回角色列表' : undefined}
            className="character-back-button"
            data-testid={
              landscapeExpression
                ? 'character-expression-back'
                : 'character-detail-back'
            }
            onClick={
              landscapeExpression ? onBackToDetail : onBackToList
            }
            title={landscapeDetail ? '返回角色列表' : undefined}
            type="button"
          >
            {landscapeDetail ? (
              <span aria-hidden="true">←</span>
            ) : (
              '← 返回角色详情'
            )}
          </button>
          {landscapeDetail ? (
            <h1
              className="sr-only character-detail-navigation-title"
              id="character-detail-title"
            >
              角色详情
            </h1>
          ) : (
            <strong className="character-detail-navigation-title">
              {`${character.name} · 表情管理`}
            </strong>
          )}
          {landscapeDetail ? (
            <Button
              aria-label="加入当前镜头"
              className="character-detail-place-navigation-action"
              data-testid="character-detail-place-current-shot"
              disabled={placementUnavailableReason !== null}
              onClick={() =>
                onPlaceInCurrentShot(placementBlockedByTransform)
              }
              title={placementUnavailableReason ?? '加入当前镜头'}
              variant="secondary"
            >
              ＋ 加入镜头
            </Button>
          ) : null}
          <button
            aria-label="关闭角色抽屉"
            className="resource-activity-close character-detail-close"
            data-detail-close="true"
            data-testid="resource-activity-close"
            onClick={onCloseDrawer}
            type="button"
          >
            ×
          </button>
        </div>
      ) : (
        <div className="character-editor-heading">
          <div>
            <p className="eyebrow">角色定义</p>
            <h3>{character.name}</h3>
          </div>
          {view === 'expression' ? (
            <button
              className="character-back-button"
              data-testid="character-expression-back"
              onClick={onBackToDetail}
              type="button"
            >
              返回角色详情
            </button>
          ) : null}
          <button
            className="character-delete-button"
            disabled={disabled}
            onClick={onDeleteCharacter}
            type="button"
          >
            删除角色
          </button>
        </div>
      )}
      {landscapeDetail ? (
        <>
          <section className="character-detail-identity">
            <div
              aria-label={`${character.name} 角色预览`}
              className="character-detail-avatar"
              data-preview-fit="contain"
              data-thumbnail-status={
                defaultThumbnail?.status ??
                (defaultAssetResolved ? 'loading' : 'missing')
              }
            >
              {defaultExpression?.visualSource ? <GraphicFacePreview source={defaultExpression.visualSource} label={character.name} /> : defaultThumbnail?.status === 'ready' && defaultImageAssetId ? (
                <img
                  alt={character.name + ' 默认表情'}
                  onError={() =>
                    onThumbnailError(defaultImageAssetId)
                  }
                  src={defaultThumbnail.dataUrl}
                />
              ) : (
                <CharacterThumbnailFallback
                  assetConfigured={Boolean(defaultExpression)}
                  assetResolved={defaultAssetResolved}
                  thumbnail={defaultThumbnail}
                />
              )}
            </div>
            <div
              className={`character-detail-identity-copy${renameOpen ? ' is-renaming' : ''}`}
            >
              <div className="character-detail-identity-title-row">
                {renameOpen ? (
                  <form
                    className="character-inline-rename-form"
                    data-testid="character-inline-rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (disabled || !nextRenameValue) return;
                      onRenameCharacter(nextRenameValue);
                      setName(nextRenameValue);
                      setRenameOpen(false);
                    }}
                  >
                    <label
                      className="sr-only"
                      htmlFor="character-inline-rename-input"
                    >
                      角色名称
                    </label>
                    <input
                      autoFocus
                      data-testid="character-inline-rename-input"
                      disabled={disabled}
                      id="character-inline-rename-input"
                      maxLength={200}
                      onChange={(event) => setName(event.target.value)}
                      value={name}
                    />
                    <div className="character-inline-rename-actions">
                      <button
                        className="character-inline-rename-cancel"
                        data-testid="character-inline-rename-cancel"
                        onClick={() => {
                          setName(character.name);
                          setRenameOpen(false);
                        }}
                        type="button"
                      >
                        取消
                      </button>
                      <button
                        className="character-inline-rename-save"
                        data-testid="character-inline-rename-save"
                        disabled={disabled || !nextRenameValue}
                        type="submit"
                      >
                        保存
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <button
                      aria-label="编辑角色名称"
                      aria-expanded={false}
                      className="character-rename-trigger"
                      data-testid="character-rename-trigger"
                      onClick={() => {
                        setName(character.name);
                        setRenameOpen(true);
                      }}
                      type="button"
                    >
                      ✎
                    </button>
                    <h3>{character.name}</h3>
                  </>
                )}
              </div>
              <div className="character-detail-identity-actions">
                {expressionCharacter && activeWorkspace === 'expressions' ? (
                  <button
                    aria-expanded={expressionAddOpen}
                    className="character-detail-add-expression-trigger"
                    data-testid="expression-add-trigger"
                    disabled={disabled || (imageAssets.length === 0 && !project?.animations.some(animation => 'kind' in animation && animation.kind === 'fla-graphic'))}
                    onClick={() =>
                      setExpressionAddOpen((isOpen) => !isOpen)
                    }
                    type="button"
                  >
                    ＋ 添加表情
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}
      {view === 'detail' && !landscapeDetail ? (
        <Button
          className="character-detail-place-action"
          data-testid="character-detail-place-current-shot"
          disabled={placementUnavailableReason !== null}
          onClick={() => onPlaceInCurrentShot(placementBlockedByTransform)}
          title={placementUnavailableReason ?? '加入当前镜头'}
        >
          加入当前镜头
        </Button>
      ) : null}
      {view !== 'expression' && !landscapeDetail ? (
        <section className="character-settings">
          <label>
            角色名称
            <span className="character-name-edit-row">
              <input
                disabled={disabled}
                maxLength={200}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <button
                disabled={
                  disabled ||
                  !name.trim() ||
                  name.trim() === character.name
                }
                onClick={() => onRenameCharacter(name)}
                type="button"
              >
                应用名称修改
              </button>
            </span>
          </label>
          {expressionCharacter ? (
            <GraphicFacePicker source={expressionCharacter.mouthOpenVisualSource} onChange={onSetMouthSource} onClear={() => onSetMouthSource?.(null)} testId="character-detail-mouth-picker" disabled={disabled}>
            <ImageAssetPicker
              assets={imageAssets}
              emptyOption={{
                description: '安全降级为闭嘴。',
                label: '未配置',
                optional: true,
              }}
              label="张嘴图"
              onChange={onSetMouthOpenAsset}
              onThumbnailError={onThumbnailError}
              selectedAssetId={expressionCharacter.mouthOpenAssetId ?? null}
              testId="character-detail-mouth-picker"
              thumbnails={thumbnails}
              disabled={disabled}
            />
            </GraphicFacePicker>
          ) : null}
          <label>
            默认缩放
            <input
              disabled={disabled}
              max="10"
              min="0.1"
              onChange={(event) => setScale(Number(event.target.value))}
              step="0.05"
              type="number"
              value={scale}
            />
          </label>
          <label className="character-flip-setting">
            <input
              checked={flipX}
              disabled={disabled}
              onChange={(event) => setFlipX(event.target.checked)}
              type="checkbox"
            />
            默认水平翻转
          </label>
          <button
            disabled={
              disabled ||
              !Number.isFinite(scale) ||
              scale < 0.1 ||
              scale > 10
            }
            onClick={() => onSetDefaultTransform(scale, flipX)}
            type="button"
          >
            应用默认变换
          </button>
        </section>
      ) : null}
      {view !== 'expression' && !landscapeDetail ? talkingHeadSettings : null}
      {view === 'detail' && !landscapeDetail && expressionCharacter ? (
        <section
          aria-labelledby="character-expression-summary-heading"
          className="character-expression-summary"
        >
          <div className="character-section-heading">
            <div>
              <p className="eyebrow">角色详情</p>
              <h4 id="character-expression-summary-heading">表情映射</h4>
            </div>
            <button
              data-testid="character-expression-open"
              onClick={onOpenExpressions}
              type="button"
            >
              编辑表情映射
            </button>
          </div>
          <ul className="character-expression-summary-list">
            {expressionCharacter.expressions.map((expression) => {
              const asset = imageAssets.find(
                (candidate) => candidate.id === expression.assetId,
              );
              return (
                <li
                  data-expression-default={
                    expression.id === expressionCharacter.defaultExpressionId
                  }
                  key={expression.id}
                >
                  <CharacterExpressionThumbnail
                    className="character-expression-summary-preview"
                    expression={expression}
                    onThumbnailError={onThumbnailError}
                    thumbnail={expression.assetId ? thumbnails[expression.assetId] : undefined}
                  />
                  <span className="character-expression-summary-copy">
                    <strong>{expression.name}</strong>
                    <span>
                      {expression.visualSource
                        ? `第 ${expression.visualSource.firstFrame + 1} 帧`
                        : (asset?.name ?? expression.assetId)}
                    </span>
                  </span>
                  {expression.id === expressionCharacter.defaultExpressionId ? (
                    <em>默认表情</em>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {landscapeDetail ? (
        <>
          <nav
            aria-label="角色工作区"
            className="character-workspace-switcher"
            data-workspace-count={3}
            data-testid="character-workspace-switcher"
          >
            <button
              aria-controls="character-workspace-assembly"
              aria-pressed={activeWorkspace === 'assembly'}
              className={
                activeWorkspace === 'assembly'
                  ? 'character-workspace-tab is-active'
                  : 'character-workspace-tab'
              }
              data-testid="character-workspace-assembly-tab"
              onClick={() => switchDetailWorkspace('assembly')}
              type="button"
            >
              结构
            </button>
            <button
              aria-controls="character-workspace-expressions"
              aria-pressed={activeWorkspace === 'expressions'}
              className={
                activeWorkspace === 'expressions'
                  ? 'character-workspace-tab is-active'
                  : 'character-workspace-tab'
              }
              data-testid="character-workspace-expressions-tab"
              onClick={() => switchDetailWorkspace('expressions')}
              type="button"
            >
              <span>表情</span>
              {expressionCharacter ? (
                <span
                  aria-hidden="true"
                  className="character-workspace-tab-count"
                >
                  {expressionCharacter.expressions.length}
                </span>
              ) : null}
            </button>
            <button
              aria-controls="character-workspace-settings"
              aria-pressed={activeWorkspace === 'settings'}
              className={
                activeWorkspace === 'settings'
                  ? 'character-workspace-tab is-active'
                  : 'character-workspace-tab'
              }
              data-testid="character-workspace-settings-tab"
              onClick={() => switchDetailWorkspace('settings')}
              type="button"
            >
              设置
            </button>
          </nav>
          <section
            aria-label="角色结构"
            className="character-workspace-panel character-assembly-drawer-panel"
            data-testid="character-assembly-drawer-panel"
            data-workspace="assembly"
            hidden={activeWorkspace !== 'assembly'}
            id="character-workspace-assembly"
          >
            {structureContent}
          </section>
          <section
            aria-labelledby={
              expressionCharacter
                ? 'character-expression-workspace-heading'
                : undefined
            }
            aria-label={expressionCharacter ? undefined : '表情'}
            className="character-workspace-panel character-expression-workspace"
            data-testid="character-expression-workspace"
            data-workspace="expressions"
            hidden={activeWorkspace !== 'expressions'}
            id="character-workspace-expressions"
          >
            {expressionContent}
          </section>
          <section
            aria-labelledby="character-settings-workspace-heading"
            className="character-workspace-panel character-settings-workspace"
            data-testid="character-settings-workspace"
            data-workspace="settings"
            hidden={activeWorkspace !== 'settings'}
            id="character-workspace-settings"
          >
            {defaultProperties}
            {singleMouth}
            {deleteProperties}
          </section>
        </>
      ) : null}
      {(view === 'full' || view === 'expression') && expressionCharacter ? (
        <ExpressionEditor
          character={expressionCharacter}
          disabled={disabled}
          imageAssets={imageAssets}
          isAddOpen={expressionAddOpen}
          onAdd={onAddExpression}
          onAddOpenChange={setExpressionAddOpen}
          onRemove={onRemoveExpression}
          onRename={onRenameExpression}
          onSetAsset={onSetExpressionAsset}
          onSetSource={onSetExpressionSource}
          onAddGraphic={onAddGraphicExpression}
          onSetDefault={onSetDefaultExpression}
          onThumbnailError={onThumbnailError}
          presentation={presentation}
          thumbnails={thumbnails}
          warnings={warnings}
        />
      ) : null}
      {view === 'full' ? (
        <p className="voice-profile-notice">
          语音配置仅保留最小项目数据。本页面不提供语音合成、声音克隆或嘴型识别入口。
        </p>
      ) : null}
    </article>
  );
}
