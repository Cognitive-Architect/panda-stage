import { useEffect, useState } from 'react';
import type {
  Character,
  CharacterDimensionWarning,
  ImageAsset,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import { ExpressionEditor } from './ExpressionEditor';

export type CharacterEditorView = 'full' | 'detail' | 'expression';
export type CharacterEditorPresentation = 'default' | 'landscape';

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

function CharacterThumbnailFallback({
  thumbnail,
}: {
  thumbnail?: ThumbnailState;
}): React.JSX.Element {
  const label =
    thumbnail?.status === 'loading'
      ? '加载中'
      : thumbnail?.status === 'missing' && thumbnail.reason === 'source'
        ? '源文件缺失'
        : '缩略图缺失';
  const state = thumbnail?.status ?? 'missing';
  return (
    <span
      aria-label={label}
      className="character-thumbnail-fallback"
      data-thumbnail-fallback={state}
    >
      <span aria-hidden="true" className="character-thumbnail-fallback-icon">
        ▧
      </span>
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

  useEffect(() => {
    if (!character) return;
    setScale(character.defaultScale);
    setFlipX(character.defaultFlipX);
  }, [character?.defaultFlipX, character?.defaultScale, character?.id]);

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
  const mouthAsset = character.mouthOpenAssetId
    ? imageAssets.find(
        (asset) => asset.id === character.mouthOpenAssetId,
      ) ?? null
    : null;
  const mouthThumbnail = character.mouthOpenAssetId
    ? thumbnails[character.mouthOpenAssetId]
    : undefined;
  const hasPendingTransform = isDefaultTransformPending(
    character,
    scale,
    flipX,
  );

  return (
    <article
      className={`character-editor${view === 'expression' ? ' character-expression-view' : ''}`}
      data-character-editor-id={character.id}
      data-character-editor-presentation={presentation}
      data-testid={
        view === 'detail'
          ? 'character-detail-view'
          : view === 'expression'
            ? 'character-expression-view'
            : undefined
      }
    >
      {landscapeCharacterNavigation ? (
        <div className="character-detail-navigation">
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
            {landscapeExpression ? '← 返回角色详情' : '← 角色列表'}
          </button>
          <strong className="character-detail-navigation-title">
            {landscapeExpression
              ? `${character.name} · 表情管理`
              : character.name}
          </strong>
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
                defaultThumbnail?.status ?? 'missing'
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
                <CharacterThumbnailFallback thumbnail={defaultThumbnail} />
              )}
            </div>
            <div className="character-detail-identity-copy">
              <p className="eyebrow">角色</p>
              <h3>{character.name}</h3>
              <span>{character.expressions.length} 个表情</span>
              <button
                aria-expanded={renameOpen}
                className="character-rename-trigger"
                onClick={() => setRenameOpen((open) => !open)}
                type="button"
              >
                编辑名称
              </button>
            </div>
          </section>
          {renameOpen ? (
            <form
              className="character-rename-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!name.trim() || name.trim() === character.name) return;
                onRenameCharacter(name.trim());
                setRenameOpen(false);
              }}
            >
              <label>
                角色名称
                <input
                  autoFocus
                  disabled={disabled}
                  maxLength={200}
                  onChange={(event) => setName(event.target.value)}
                  value={name}
                />
              </label>
              <div>
                <button
                  onClick={() => {
                    setName(character.name);
                    setRenameOpen(false);
                  }}
                  type="button"
                >
                  取消
                </button>
                <button
                  disabled={
                    disabled ||
                    !name.trim() ||
                    name.trim() === character.name
                  }
                  type="submit"
                >
                  应用名称修改
                </button>
              </div>
            </form>
          ) : null}
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
          <label>
            张嘴图
            <select
              disabled={disabled}
              onChange={(event) =>
                onSetMouthOpenAsset(event.target.value || null)
              }
              value={character.mouthOpenAssetId ?? ''}
            >
              <option value="">未配置（安全降级为闭嘴）</option>
              {imageAssets.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} · {asset.width}×{asset.height}
                </option>
              ))}
            </select>
          </label>
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
                <li key={expression.id}>
                  <strong>{expression.name}</strong>
                  <span>{asset?.name ?? expression.assetId}</span>
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
          <section
            aria-labelledby="character-expression-summary-heading"
            className="character-expression-summary character-expression-summary-visual"
          >
            <div className="character-section-heading">
              <h4 id="character-expression-summary-heading">表情</h4>
              <button
                data-testid="character-expression-open"
                onClick={onOpenExpressions}
                type="button"
              >
                管理全部表情
              </button>
            </div>
            <ul className="character-expression-visual-list">
              {character.expressions.map((expression) => {
                const thumbnail = thumbnails[expression.assetId];
                const isDefault =
                  expression.id === character.defaultExpressionId;
                return (
                  <li
                    className={isDefault ? 'character-expression-default' : ''}
                    data-expression-id={expression.id}
                    data-expression-default={isDefault}
                    key={expression.id}
                  >
                    <div
                      className="character-expression-preview"
                      data-thumbnail-status={thumbnail?.status ?? 'missing'}
                    >
                      {thumbnail?.status === 'ready' ? (
                        <img
                          alt={`${expression.name} 表情缩略图`}
                          onError={() =>
                            onThumbnailError(expression.assetId)
                          }
                          src={thumbnail.dataUrl}
                        />
                      ) : (
                        <CharacterThumbnailFallback thumbnail={thumbnail} />
                      )}
                    </div>
                    <strong>{expression.name}</strong>
                    <span>{isDefault ? '默认 ✓' : '表情'}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <section
            className="character-default-presentation"
            data-default-transform-pending={hasPendingTransform}
          >
            <div className="character-section-heading">
              <h4>默认表现</h4>
              {hasPendingTransform ? (
                <span
                  aria-live="polite"
                  className="character-default-pending"
                  data-testid="character-default-pending"
                >
                  ● 未应用
                </span>
              ) : null}
            </div>
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
            <div className="character-default-action-row">
              <button
                className="character-default-apply"
                data-pending={hasPendingTransform}
                disabled={
                  disabled ||
                  !Number.isFinite(scale) ||
                  scale < 0.1 ||
                  scale > 10 ||
                  !hasPendingTransform
                }
                onClick={() => onSetDefaultTransform(scale, flipX)}
                type="button"
              >
                应用默认表现
              </button>
              {hasPendingTransform ? (
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
              ) : null}
            </div>
          </section>
          <section className="character-mouth-setting-visual">
            <div className="character-section-heading">
              <h4>嘴型</h4>
            </div>
            <div className="character-mouth-state">
              <div
                className="character-mouth-preview"
                data-thumbnail-status={mouthThumbnail?.status ?? 'missing'}
              >
                {mouthThumbnail?.status === 'ready' &&
                character.mouthOpenAssetId ? (
                  <img
                    alt="张嘴图预览"
                    onError={() =>
                      onThumbnailError(character.mouthOpenAssetId!)
                    }
                    src={mouthThumbnail.dataUrl}
                  />
                ) : character.mouthOpenAssetId ? (
                  <CharacterThumbnailFallback thumbnail={mouthThumbnail} />
                ) : (
                  <span aria-hidden="true" className="character-mouth-empty">
                    +
                  </span>
                )}
              </div>
              <div className="character-mouth-copy">
                <strong>
                  {mouthAsset?.name ??
                    (character.mouthOpenAssetId
                      ? '素材不可用'
                      : '未配置 · 张嘴图')}
                </strong>
                {character.mouthOpenAssetId ? <span>张嘴图</span> : null}
              </div>
              <details className="character-mouth-picker">
                <summary>
                  {character.mouthOpenAssetId ? '更换' : '选择'}
                </summary>
                <label>
                  张嘴图素材
                  <select
                    disabled={disabled}
                    onChange={(event) =>
                      onSetMouthOpenAsset(event.target.value || null)
                    }
                    value={character.mouthOpenAssetId ?? ''}
                  >
                    <option value="">未配置</option>
                    {imageAssets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.name} · {asset.width}×{asset.height}
                      </option>
                    ))}
                  </select>
                </label>
              </details>
              {character.mouthOpenAssetId ? (
                <button
                  className="character-mouth-clear"
                  disabled={disabled}
                  onClick={() => onSetMouthOpenAsset(null)}
                  type="button"
                >
                  清除
                </button>
              ) : null}
            </div>
          </section>
          <section className="character-danger-zone">
            <h4>危险操作</h4>
            <button
              className="character-delete-button"
              disabled={disabled}
              onClick={onDeleteCharacter}
              type="button"
            >
              删除角色
            </button>
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
