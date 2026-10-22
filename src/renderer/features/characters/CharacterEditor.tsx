import { useEffect, useId, useRef, useState } from 'react';
import type {
  Character,
  CharacterDimensionWarning,
  CompositeCharacterDefinition,
  ImageAsset,
  Project,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import type { CharacterAssemblyEditTarget } from '../../stores/characterAssemblySessionStore';
import { Button } from '../../ui/Button';
import { CharacterExpressionThumbnail } from './CharacterIdentity';
import { CharacterTalkingHeadMotionPreview } from './CharacterTalkingHeadMotionPreview';
import { ExpressionEditor } from './ExpressionEditor';
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
  character: Pick<Character, 'defaultScale' | 'defaultFlipX'>,
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
}: CharacterEditorProps): React.JSX.Element {
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
      activeWorkspace !== 'settings'
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
      activeWorkspace === 'assembly' &&
      assemblyDraftWasOpen.current &&
      !hasAssemblyDraft
    ) {
      setActiveWorkspace('expressions');
    }
    assemblyDraftWasOpen.current = hasAssemblyDraft;
  }, [activeWorkspace, assemblyDraft]);

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

  if (!character) {
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

  const headedCompositeCharacter: HeadedCompositeCharacter | null =
    character.mode === 'composite' && character.head
      ? (character as HeadedCompositeCharacter)
      : null;

  const formalDefaultExpression = character.expressions.find(
    (expression) => expression.id === character.defaultExpressionId,
  );
  const defaultExpression =
    formalDefaultExpression ?? character.expressions[0];
  const defaultExpressionAsset = defaultExpression
    ? imageAssets.find((asset) => asset.id === defaultExpression.assetId)
    : undefined;
  const defaultThumbnail = defaultExpression
    ? thumbnails[defaultExpression.assetId]
    : undefined;
  const defaultAssetResolved = Boolean(defaultExpressionAsset);
  const hasPendingTransform = isDefaultTransformPending(
    character,
    scale,
    flipX,
  );
  const placementBlockedByTransform = hasPendingTransform || !Number.isFinite(scale);
  const formalDefaultAssetAvailable = Boolean(
    formalDefaultExpression && imageAssets.some(
      (asset) => asset.id === formalDefaultExpression.assetId,
    ),
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
  const assemblyMouthAssetId = assemblyDraft
    ? assemblyDraft.mouthOpenAssetId ?? null
    : character.mouthOpenAssetId ?? null;

  const switchDetailWorkspace = (
    nextWorkspace: CharacterDetailWorkspace,
  ): void => {
    if (nextWorkspace === activeWorkspace) return;
    if (
      activeWorkspace === 'assembly' &&
      nextWorkspace !== 'assembly' &&
      !onLeaveAssembly()
    ) {
      return;
    }
    if (nextWorkspace === 'assembly' && !onOpenAssembly()) return;
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
              {defaultThumbnail?.status === 'ready' && defaultExpression ? (
                <img
                  alt={`${character.name} 默认表情`}
                  onError={() =>
                    onThumbnailError(defaultExpression.assetId)
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
                {activeWorkspace === 'expressions' ? (
                  <button
                    aria-expanded={expressionAddOpen}
                    className="character-detail-add-expression-trigger"
                    data-testid="expression-add-trigger"
                    disabled={disabled || imageAssets.length === 0}
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
            selectedAssetId={character.mouthOpenAssetId ?? null}
            testId="character-detail-mouth-picker"
            thumbnails={thumbnails}
            disabled={disabled}
          />
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
      {view === 'detail' && !landscapeDetail ? (
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
            {character.expressions.map((expression) => {
              const asset = imageAssets.find(
                (candidate) => candidate.id === expression.assetId,
              );
              return (
                <li
                  data-expression-default={
                    expression.id === character.defaultExpressionId
                  }
                  key={expression.id}
                >
                  <CharacterExpressionThumbnail
                    className="character-expression-summary-preview"
                    expression={expression}
                    onThumbnailError={onThumbnailError}
                    thumbnail={thumbnails[expression.assetId]}
                  />
                  <span className="character-expression-summary-copy">
                    <strong>{expression.name}</strong>
                    <span>{asset?.name ?? expression.assetId}</span>
                  </span>
                  {expression.id === character.defaultExpressionId ? (
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
            data-workspace-count={compositeCharacter ? 3 : 2}
            data-testid="character-workspace-switcher"
          >
            {compositeCharacter ? (
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
                组装
              </button>
            ) : null}
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
              <span
                aria-hidden="true"
                className="character-workspace-tab-count"
              >
                {character.expressions.length}
              </span>
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
          {compositeCharacter ? (
            <section
              aria-label="角色组装素材"
              className="character-workspace-panel character-assembly-drawer-panel"
              data-testid="character-assembly-drawer-panel"
              data-workspace="assembly"
              hidden={activeWorkspace !== 'assembly'}
              id="character-workspace-assembly"
            >
              <ImageAssetPicker
                assets={imageAssets}
                emptyState={{
                  description: '从项目图片中选择身体。',
                  label: '请选择图片',
                }}
                label="身体"
                onSelectedAssetActivate={
                  assemblyDraft?.bodyAssetId
                    ? () => onSelectAssemblyEditTarget('body')
                    : undefined
                }
                onChange={(assetId) => {
                  if (assetId) onSetAssemblyBodyAsset(assetId);
                }}
                onThumbnailError={onThumbnailError}
                selectedAssetId={
                  assemblyDraft?.bodyAssetId ??
                  (character.mode === 'composite'
                    ? character.bodyAssetId
                    : '')
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
                onThumbnailError={onThumbnailError}
                onSelectedAssetActivate={
                  assemblyDraft?.head
                    ? () => onSelectAssemblyEditTarget('head')
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
                      onClick={() => onSelectAssemblyEditTarget('face')}
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
                            ? `${defaultExpressionAsset.name} · ${defaultExpressionAsset.width}×${defaultExpressionAsset.height}`
                            : '素材不可用'}
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
              <ImageAssetPicker
                assets={imageAssets}
                emptyOption={{
                  label: '暂不配置',
                }}
                label="张嘴脸"
                onChange={onSetAssemblyMouthAsset}
                onThumbnailError={onThumbnailError}
                selectedAssetId={assemblyMouthAssetId}
                testId="character-assembly-mouth-picker"
                thumbnails={thumbnails}
                disabled={disabled}
                selectedSurface
                selectedAction={
                  assemblyMouthAssetId ? (
                    <CharacterAssemblyMouthOverflowMenu
                      disabled={disabled}
                      onClear={() => onSetAssemblyMouthAsset(null)}
                    />
                  ) : undefined
                }
              />
            </section>
          ) : null}
          <section
            aria-labelledby="character-expression-workspace-heading"
            className="character-workspace-panel character-expression-workspace"
            data-testid="character-expression-workspace"
            data-workspace="expressions"
            hidden={activeWorkspace !== 'expressions'}
            id="character-workspace-expressions"
          >
            <ExpressionEditor
              character={character}
              disabled={disabled}
              imageAssets={imageAssets}
              isAddOpen={expressionAddOpen}
              onAdd={onAddExpression}
              onAddOpenChange={setExpressionAddOpen}
              onRemove={onRemoveExpression}
              onRename={onRenameExpression}
              onSetAsset={onSetExpressionAsset}
              onSetDefault={onSetDefaultExpression}
              onThumbnailError={onThumbnailError}
              compactDetailWorkspace
              presentation="landscape"
              thumbnails={thumbnails}
              warnings={warnings}
            />
          </section>
          <section
            aria-labelledby="character-settings-workspace-heading"
            className="character-workspace-panel character-settings-workspace"
            data-testid="character-settings-workspace"
            data-workspace="settings"
            hidden={activeWorkspace !== 'settings'}
            id="character-workspace-settings"
          >
            <section
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
            {talkingHeadSettings}
            {!compositeCharacter ? (
            <section className="character-settings-section character-mouth-setting-visual">
              <div
                className={`character-mouth-state${character.mouthOpenAssetId ? ' is-configured' : ''}`}
                data-mouth-configured={Boolean(character.mouthOpenAssetId)}
              >
                <ImageAssetPicker
                  assets={imageAssets}
                  emptyActionLabel="选择图片"
                  emptyOption={{
                    description: '设置张嘴图后，可在表情中使用。',
                    label: '未设置',
                  }}
                  label="张嘴图"
                  onChange={onSetMouthOpenAsset}
                  onThumbnailError={onThumbnailError}
                  selectedAssetId={character.mouthOpenAssetId ?? null}
                  testId="character-detail-mouth-visual-picker"
                  thumbnails={thumbnails}
                  disabled={disabled}
                  selectedAction={
                    character.mouthOpenAssetId ? (
                      <button
                        className="character-mouth-clear"
                        disabled={disabled}
                        onClick={() => onSetMouthOpenAsset(null)}
                        type="button"
                      >
                        清除
                      </button>
                    ) : undefined
                  }
                />
              </div>
            </section>
            ) : null}
            <section
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
            </section>
          </section>
        </>
      ) : null}
      {view === 'full' || view === 'expression' ? (
        <ExpressionEditor
          character={character}
          disabled={disabled}
          imageAssets={imageAssets}
          isAddOpen={expressionAddOpen}
          onAdd={onAddExpression}
          onAddOpenChange={setExpressionAddOpen}
          onRemove={onRemoveExpression}
          onRename={onRenameExpression}
          onSetAsset={onSetExpressionAsset}
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
