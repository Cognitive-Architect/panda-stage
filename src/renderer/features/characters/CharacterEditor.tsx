import { useEffect, useRef, useState } from 'react';
import type {
  Character,
  CharacterDimensionWarning,
  CompositeCharacterDefinition,
  ImageAsset,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import { CharacterExpressionThumbnail } from './CharacterIdentity';
import { ExpressionEditor } from './ExpressionEditor';
import { ImageAssetPicker } from './ImageAssetPicker';
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
  onSetAssemblyBodyAsset?: (assetId: string) => void;
  onSetAssemblyMouthAsset?: (assetId: string | null) => void;
  onSetDefaultTransform: (scale: number, flipX: boolean) => void;
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
  onSetAssemblyBodyAsset = () => undefined,
  onSetAssemblyMouthAsset = () => undefined,
  onSetDefaultTransform,
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
  const [renameOpen, setRenameOpen] = useState(false);
  const [activeWorkspace, setActiveWorkspace] =
    useState<CharacterDetailWorkspace>(
      assemblyDraft ? 'assembly' : 'expressions',
    );
  const assemblyDraftWasOpen = useRef(Boolean(assemblyDraft));

  useEffect(() => {
    if (!character) return;
    setName(character.name);
    setRenameOpen(false);
  }, [character?.id]);

  useEffect(() => {
    if (!character) return;
    setScale(character.defaultScale);
    setFlipX(character.defaultFlipX);
  }, [character?.defaultFlipX, character?.defaultScale, character?.id]);

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
      </div>
    );
  }

  const defaultExpression =
    character.expressions.find(
      (expression) => expression.id === character.defaultExpressionId,
    ) ?? character.expressions[0];
  const defaultThumbnail = defaultExpression
    ? thumbnails[defaultExpression.assetId]
    : undefined;
  const defaultAssetResolved = Boolean(
    defaultExpression &&
      imageAssets.some((asset) => asset.id === defaultExpression.assetId),
  );
  const hasPendingTransform = isDefaultTransformPending(
    character,
    scale,
    flipX,
  );
  const nextRenameValue = characterRenameValue(name, character.name);
  const compositeCharacter = character.mode === 'composite';

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
    setActiveWorkspace(nextWorkspace);
  };

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
            className="character-back-button"
            data-testid={
              landscapeExpression
                ? 'character-expression-back'
                : 'character-detail-back'
            }
            onClick={
              landscapeExpression ? onBackToDetail : onBackToList
            }
            type="button"
          >
            {landscapeExpression ? '← 返回角色详情' : '返回角色列表'}
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
                <h3>{character.name}</h3>
              )}
              <div className="character-detail-identity-actions">
                {!renameOpen ? (
                  <button
                    aria-expanded={false}
                    className="character-rename-trigger"
                    data-testid="character-rename-trigger"
                    onClick={() => {
                      setName(character.name);
                      setRenameOpen(true);
                    }}
                    type="button"
                  >
                    编辑名称
                  </button>
                ) : null}
                <details className="character-identity-overflow">
                  <summary
                    aria-label={`${character.name} 更多操作`}
                    data-testid="character-identity-overflow"
                  >
                    ⋯
                  </summary>
                  <div className="character-identity-overflow-menu">
                    <button
                      className="character-delete-menu-action"
                      data-testid="character-delete-overflow"
                      disabled={disabled}
                      onClick={onDeleteCharacter}
                      type="button"
                    >
                      删除角色
                    </button>
                  </div>
                </details>
              </div>
            </div>
          </section>
        </>
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
                装配
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
              aria-label="角色装配素材"
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
                label="身体图片"
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
              />
              <div
                className="character-assembly-default-face-summary"
                data-testid="character-assembly-default-face-summary"
              >
                <span className="character-assembly-field-label">默认表情</span>
                {defaultExpression ? (
                  <div className="character-assembly-default-face-content">
                    <CharacterExpressionThumbnail
                      className="character-assembly-default-face-thumbnail"
                      expression={defaultExpression}
                      onThumbnailError={onThumbnailError}
                      thumbnail={defaultThumbnail}
                    />
                    <span>
                      <strong>{defaultExpression.name}</strong>
                      <small>
                        {imageAssets.find(
                          (asset) => asset.id === defaultExpression.assetId,
                        )?.name ?? defaultExpression.assetId}
                      </small>
                    </span>
                    <button
                      className="character-assembly-expression-bridge"
                      data-testid="character-assembly-go-expressions"
                      onClick={() =>
                        switchDetailWorkspace('expressions')
                      }
                      type="button"
                    >
                      去表情
                    </button>
                  </div>
                ) : null}
              </div>
              <ImageAssetPicker
                assets={imageAssets}
                emptyOption={{
                  description: '可以稍后再配置。',
                  label: '暂不配置',
                  optional: true,
                }}
                label="张嘴图"
                onChange={onSetAssemblyMouthAsset}
                onThumbnailError={onThumbnailError}
                selectedAssetId={
                  assemblyDraft?.mouthOpenAssetId ??
                  character.mouthOpenAssetId ??
                  null
                }
                testId="character-assembly-mouth-picker"
                thumbnails={thumbnails}
                disabled={disabled}
                selectedAction={
                  (assemblyDraft?.mouthOpenAssetId ??
                    character.mouthOpenAssetId) ? (
                    <button
                      className="character-mouth-clear"
                      disabled={disabled}
                      onClick={() => onSetAssemblyMouthAsset(null)}
                      type="button"
                    >
                      清除
                    </button>
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
              onAdd={onAddExpression}
              onRemove={onRemoveExpression}
              onRename={onRenameExpression}
              onSetAsset={onSetExpressionAsset}
              onSetDefault={onSetDefaultExpression}
              onThumbnailError={onThumbnailError}
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
                    默认大小与方向
                  </h4>
                </div>
              </div>
              <div className="character-default-transform-controls">
                <div className="character-scale-control-group">
                  <div
                    aria-label="默认缩放"
                    className="character-scale-stepper"
                    role="group"
                  >
                    <button
                      aria-label="减小默认缩放"
                      disabled={disabled || scale <= 0.1}
                      onClick={() => adjustScale(-0.1)}
                      type="button"
                    >
                      −
                    </button>
                    <output aria-live="polite">{scale.toFixed(1)}×</output>
                    <button
                      aria-label="增大默认缩放"
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
          </section>
        </>
      ) : null}
      {view === 'full' || view === 'expression' ? (
        <ExpressionEditor
          character={character}
          disabled={disabled}
          imageAssets={imageAssets}
          onAdd={onAddExpression}
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
