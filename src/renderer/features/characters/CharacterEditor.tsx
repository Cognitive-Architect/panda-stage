import { useState } from 'react';
import type {
  Character,
  CharacterDimensionWarning,
  ImageAsset,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import { ExpressionEditor } from './ExpressionEditor';

export type CharacterEditorView = 'full' | 'detail' | 'expression';

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
  onOpenExpressions?: () => void;
  onBackToDetail?: () => void;
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
  onOpenExpressions = () => undefined,
  onBackToDetail = () => undefined,
}: CharacterEditorProps): React.JSX.Element {
  const [name, setName] = useState(character?.name ?? '');
  const [scale, setScale] = useState(character?.defaultScale ?? 1);
  const [flipX, setFlipX] = useState(character?.defaultFlipX ?? false);

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

  return (
    <article
      className="character-editor"
      data-character-editor-id={character.id}
      data-testid={
        view === 'detail'
          ? 'character-detail-view'
          : view === 'expression'
            ? 'character-expression-view'
            : undefined
      }
    >
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
      {view !== 'expression' ? (
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
      {view === 'detail' ? (
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
