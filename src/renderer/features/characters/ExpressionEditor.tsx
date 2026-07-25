import { useState } from 'react';
import type {
  Character,
  CharacterDimensionWarning,
  ImageAsset,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';

export interface ExpressionEditorProps {
  character: Character;
  imageAssets: readonly ImageAsset[];
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  warnings: readonly CharacterDimensionWarning[];
  disabled?: boolean;
  onAdd: (name: string, assetId: string) => void;
  onRename: (expressionId: string, name: string) => void;
  onSetAsset: (expressionId: string, assetId: string) => void;
  onRemove: (expressionId: string) => void;
  onSetDefault: (expressionId: string) => void;
  onThumbnailError: (assetId: string) => void;
}

export function ExpressionEditor({
  character,
  imageAssets,
  thumbnails,
  warnings,
  disabled = false,
  onAdd,
  onRename,
  onSetAsset,
  onRemove,
  onSetDefault,
  onThumbnailError,
}: ExpressionEditorProps): React.JSX.Element {
  const [newName, setNewName] = useState('');
  const [newAssetId, setNewAssetId] = useState(imageAssets[0]?.id ?? '');

  return (
    <section className="expression-editor" aria-label="表情管理">
      <div className="character-section-heading">
        <h4>表情映射</h4>
        <span>中心锚点固定，不按图片尺寸自动偏移</span>
      </div>
      <ul className="expression-list">
        {character.expressions.map((expression) => {
          const asset = imageAssets.find(
            (candidate) => candidate.id === expression.assetId,
          );
          const thumbnail = thumbnails[expression.assetId];
          const isDefault =
            expression.id === character.defaultExpressionId;
          return (
            <li
              className={isDefault ? 'expression-default' : ''}
              data-expression-id={expression.id}
              key={expression.id}
            >
              <div className="expression-thumbnail">
                {thumbnail?.status === 'ready' ? (
                  <img
                    alt={`${expression.name} 表情缩略图`}
                    onError={() => onThumbnailError(expression.assetId)}
                    src={thumbnail.dataUrl}
                  />
                ) : (
                  <span aria-label="缩略图缺失">图</span>
                )}
              </div>
              <div className="expression-fields">
                <label>
                  表情名称
                  <input
                    defaultValue={expression.name}
                    disabled={disabled}
                    maxLength={200}
                    onBlur={(event) => {
                      if (event.target.value.trim() !== expression.name) {
                        onRename(expression.id, event.target.value);
                      }
                    }}
                  />
                </label>
                <span>
                  {asset
                    ? `${asset.name} · ${asset.width}×${asset.height}`
                    : expression.assetId}
                </span>
                <label>
                  图片素材
                  <select
                    aria-label={`${expression.name} 表情图片素材`}
                    disabled={disabled}
                    onChange={(event) =>
                      onSetAsset(expression.id, event.target.value)
                    }
                    value={expression.assetId}
                  >
                    {imageAssets.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} · {candidate.width}×
                        {candidate.height}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="expression-actions">
                {isDefault ? (
                  <strong>默认表情</strong>
                ) : (
                  <button
                    disabled={disabled}
                    onClick={() => onSetDefault(expression.id)}
                    type="button"
                  >
                    设为默认
                  </button>
                )}
                <button
                  disabled={disabled || isDefault}
                  onClick={() => onRemove(expression.id)}
                  title={
                    isDefault
                      ? '请先选择替代表情，再删除默认表情。'
                      : '删除表情'
                  }
                  type="button"
                >
                  删除
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <form
        className="expression-add-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!newName.trim() || !newAssetId) return;
          onAdd(newName, newAssetId);
          setNewName('');
        }}
      >
        <label>
          新表情名称
          <input
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="例如 surprised"
            value={newName}
          />
        </label>
        <label>
          图片素材
          <select
            disabled={disabled}
            onChange={(event) => setNewAssetId(event.target.value)}
            value={newAssetId}
          >
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.width}×{asset.height}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={disabled || !newName.trim() || !newAssetId}
          type="submit"
        >
          添加表情
        </button>
      </form>
      {warnings.length > 0 ? (
        <div className="character-size-warning" role="alert">
          <strong>图片尺寸差异超过 30%</strong>
          <ul>
            {warnings.map((warning) => (
              <li key={`${warning.expressionId ?? 'mouth'}-${warning.assetId}`}>
                {warning.label}：{warning.candidate.width}×
                {warning.candidate.height}；默认基准为{' '}
                {warning.baseline.width}×{warning.baseline.height}。中心位置
                保持不变，请人工确认视觉缩放。
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
