import { useState } from 'react';
import type {
  Character,
  CharacterDimensionWarning,
  ImageAsset,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import { ExpressionEditor } from './ExpressionEditor';

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
    >
      <div className="character-editor-heading">
        <div>
          <p className="eyebrow">Character definition</p>
          <h3>{character.name}</h3>
        </div>
        <button
          className="character-delete-button"
          disabled={disabled}
          onClick={onDeleteCharacter}
          type="button"
        >
          删除角色
        </button>
      </div>
      <section className="character-settings">
        <label>
          角色名称
          <input
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <button
          disabled={disabled || !name.trim() || name.trim() === character.name}
          onClick={() => onRenameCharacter(name)}
          type="button"
        >
          保存名称
        </button>
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
          保存默认变换
        </button>
      </section>
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
      <p className="voice-profile-notice">
        VoiceProfile 仅保留最小项目数据。本页面不提供 TTS、声音克隆或嘴型识别入口。
      </p>
    </article>
  );
}
