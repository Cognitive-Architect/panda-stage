import { useEffect, useState } from 'react';
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
  /** Select the compact visual workflow only for the landscape drawer. */
  presentation?: 'default' | 'landscape';
  onAdd: (name: string, assetId: string) => void;
  onRename: (expressionId: string, name: string) => void;
  onSetAsset: (expressionId: string, assetId: string) => void;
  onRemove: (expressionId: string) => void;
  onSetDefault: (expressionId: string) => void;
  onThumbnailError: (assetId: string) => void;
}

function thumbnailLabel(thumbnail?: ThumbnailState): string {
  if (thumbnail?.status === 'loading') return '加载中';
  if (thumbnail?.status === 'missing') {
    if (thumbnail.reason === 'source') return '源文件缺失';
    if (thumbnail.reason === 'error') return '缩略图加载失败';
  }
  return '缩略图缺失';
}

function ExpressionThumbnail({
  className,
  expressionName,
  onThumbnailError,
  thumbnail,
  assetId,
}: {
  className: string;
  expressionName: string;
  onThumbnailError: (assetId: string) => void;
  thumbnail?: ThumbnailState;
  assetId: string;
}): React.JSX.Element {
  const label = thumbnailLabel(thumbnail);
  return (
    <div
      className={className}
      data-thumbnail-reason={
        thumbnail?.status === 'missing' ? thumbnail.reason : undefined
      }
      data-thumbnail-status={thumbnail?.status ?? 'missing'}
    >
      {thumbnail?.status === 'ready' ? (
        <img
          alt={`${expressionName} 表情缩略图`}
          onError={() => onThumbnailError(assetId)}
          src={thumbnail.dataUrl}
        />
      ) : (
        <span
          aria-label={label}
          className="expression-thumbnail-fallback"
          data-thumbnail-fallback={thumbnail?.status ?? 'missing'}
        >
          <span aria-hidden="true">▧</span>
          <small>{label}</small>
        </span>
      )}
    </div>
  );
}

function expressionAssetLabel(
  asset: ImageAsset | undefined,
  assetId: string,
): string {
  return asset
    ? `${asset.name} · ${asset.width}×${asset.height}`
    : `素材不可用 · ${assetId}`;
}

export function expressionRenameValue(
  draftName: string,
  persistedName: string,
): string | null {
  const nextName = draftName.trim();
  return nextName && nextName !== persistedName ? nextName : null;
}

function ExpressionWarning({
  compact,
  warning,
}: {
  compact?: boolean;
  warning: CharacterDimensionWarning;
}): React.JSX.Element {
  if (compact) {
    return (
      <span
        aria-label="尺寸差异警告"
        className="expression-warning-badge"
        title={`${warning.label}：${warning.candidate.width}×${warning.candidate.height}`}
      >
        ⚠ 尺寸差异
      </span>
    );
  }
  return (
    <div
      className="expression-card-warning"
      data-warning-expression-id={warning.expressionId}
      role="alert"
    >
      <strong>⚠ 与默认表情尺寸差异较大</strong>
      <span>
        默认：{warning.baseline.width}×{warning.baseline.height}，当前：
        {warning.candidate.width}×{warning.candidate.height}
      </span>
      <small>切换表情时保持角色中心位置不变。</small>
    </div>
  );
}

function LegacyExpressionEditor({
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

function LandscapeExpressionEditor({
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
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newAssetId, setNewAssetId] = useState(imageAssets[0]?.id ?? '');
  const [editingExpressionId, setEditingExpressionId] = useState<string | null>(
    null,
  );
  const [editingName, setEditingName] = useState('');
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);

  useEffect(() => {
    if (newAssetId && imageAssets.some((asset) => asset.id === newAssetId)) {
      return;
    }
    setNewAssetId(imageAssets[0]?.id ?? '');
  }, [imageAssets, newAssetId]);

  useEffect(() => {
    if (
      !editingExpressionId ||
      character.expressions.some(
        (expression) => expression.id === editingExpressionId,
      )
    ) {
      return;
    }
    setEditingExpressionId(null);
    setEditingName('');
    setAssetPickerOpen(false);
  }, [character.expressions, editingExpressionId]);

  const cancelExpressionEdit = (): void => {
    setEditingExpressionId(null);
    setEditingName('');
    setAssetPickerOpen(false);
  };

  const startExpressionEdit = (expression: Character['expressions'][number]): void => {
    setEditingExpressionId(expression.id);
    setEditingName(expression.name);
    setAssetPickerOpen(false);
  };

  const applyExpressionName = (
    expression: Character['expressions'][number],
  ): void => {
    const nextName = expressionRenameValue(editingName, expression.name);
    if (!nextName) return;
    onRename(expression.id, nextName);
    cancelExpressionEdit();
  };

  const cancelAdd = (): void => {
    setIsAddOpen(false);
    setNewName('');
    setNewAssetId(imageAssets[0]?.id ?? '');
  };

  const expressionWarnings = (expressionId: string): CharacterDimensionWarning[] =>
    warnings.filter((warning) => warning.expressionId === expressionId);
  const unscopedWarnings = warnings.filter((warning) => !warning.expressionId);

  return (
    <section
      aria-label="表情管理"
      className="expression-editor expression-editor-landscape"
      data-expression-editor-presentation="landscape"
    >
      <div className="expression-editor-landscape-heading">
        <div>
          <p className="eyebrow">角色表情</p>
          <h4>表情管理</h4>
          <span>先查看表情，再按需编辑。</span>
        </div>
        <button
          aria-expanded={isAddOpen}
          className="expression-add-trigger"
          data-testid="expression-add-trigger"
          disabled={disabled || imageAssets.length === 0}
          onClick={() => setIsAddOpen((open) => !open)}
          type="button"
        >
          ＋ 添加表情
        </button>
      </div>
      {isAddOpen ? (
        <form
          className="expression-add-form-landscape"
          data-testid="expression-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!newName.trim() || !newAssetId) return;
            onAdd(newName.trim(), newAssetId);
            cancelAdd();
          }}
        >
          <strong>新表情</strong>
          <label>
            名称
            <input
              autoFocus
              disabled={disabled}
              maxLength={200}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="例如 surprised"
              value={newName}
            />
          </label>
          <label>
            素材
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
          <div className="expression-form-actions">
            <button onClick={cancelAdd} type="button">
              取消
            </button>
            <button
              data-testid="expression-add-submit"
              disabled={disabled || !newName.trim() || !newAssetId}
              type="submit"
            >
              添加表情
            </button>
          </div>
        </form>
      ) : null}
      <ul className="expression-card-list">
        {character.expressions.map((expression) => {
          const asset = imageAssets.find(
            (candidate) => candidate.id === expression.assetId,
          );
          const thumbnail = thumbnails[expression.assetId];
          const isDefault =
            expression.id === character.defaultExpressionId;
          const isEditing = editingExpressionId === expression.id;
          const cardWarnings = expressionWarnings(expression.id);
          return (
            <li
              className={`expression-card${isDefault ? ' expression-default' : ''}${isEditing ? ' expression-card-editing' : ''}`}
              data-expression-default={isDefault}
              data-expression-editing={isEditing}
              data-expression-id={expression.id}
              key={expression.id}
            >
              <div className="expression-card-main">
                <ExpressionThumbnail
                  assetId={expression.assetId}
                  className="expression-card-preview"
                  expressionName={expression.name}
                  onThumbnailError={onThumbnailError}
                  thumbnail={thumbnail}
                />
                <div className="expression-card-copy">
                  <div className="expression-card-title-row">
                    <strong>{expression.name}</strong>
                    {isDefault ? (
                      <span className="expression-default-badge">默认 ✓</span>
                    ) : null}
                    {cardWarnings[0] ? (
                      <ExpressionWarning
                        compact
                        warning={cardWarnings[0]}
                      />
                    ) : null}
                  </div>
                  <span className="expression-card-asset">
                    {expressionAssetLabel(asset, expression.assetId)}
                  </span>
                </div>
              </div>
              <div className="expression-card-actions">
                {!isDefault ? (
                  <button
                    data-testid={`expression-default-${expression.id}`}
                    disabled={disabled}
                    onClick={() => onSetDefault(expression.id)}
                    type="button"
                  >
                    设为默认
                  </button>
                ) : null}
                <button
                  aria-expanded={isEditing}
                  className="expression-edit-trigger"
                  data-testid={`expression-edit-${expression.id}`}
                  disabled={disabled}
                  onClick={() =>
                    isEditing
                      ? cancelExpressionEdit()
                      : startExpressionEdit(expression)
                  }
                  type="button"
                >
                  {isEditing ? '收起' : '编辑'}
                </button>
                <details className="expression-overflow">
                  <summary aria-label={`${expression.name} 更多操作`}>⋯</summary>
                  <div className="expression-overflow-menu">
                    <button
                      data-testid={`expression-delete-${expression.id}`}
                      disabled={disabled || isDefault}
                      onClick={() => onRemove(expression.id)}
                      title={
                        isDefault
                          ? '请先选择替代表情，再删除默认表情。'
                          : '删除表情'
                      }
                      type="button"
                    >
                      删除表情
                    </button>
                  </div>
                </details>
              </div>
              {isEditing ? (
                <div
                  className="expression-edit-panel"
                  data-testid={`expression-edit-panel-${expression.id}`}
                >
                  <label>
                    名称
                    <input
                      aria-label={`${expression.name} 表情名称`}
                      data-testid={`expression-name-${expression.id}`}
                      disabled={disabled}
                      maxLength={200}
                      onChange={(event) => setEditingName(event.target.value)}
                      value={editingName}
                    />
                  </label>
                  <div className="expression-current-asset">
                    <span className="expression-edit-label">当前素材</span>
                    <div className="expression-current-asset-row">
                      <ExpressionThumbnail
                        assetId={expression.assetId}
                        className="expression-current-asset-preview"
                        expressionName={expression.name}
                        onThumbnailError={onThumbnailError}
                        thumbnail={thumbnail}
                      />
                      <div className="expression-current-asset-copy">
                        <strong>{asset?.name ?? '素材不可用'}</strong>
                        <small>
                          {asset
                            ? `${asset.width}×${asset.height}`
                            : '当前素材不可用'}
                        </small>
                      </div>
                      <button
                        aria-expanded={assetPickerOpen}
                        className="expression-asset-picker-trigger"
                        data-testid={`expression-asset-picker-${expression.id}`}
                        disabled={disabled || imageAssets.length === 0}
                        onClick={() => setAssetPickerOpen((open) => !open)}
                        type="button"
                      >
                        更换素材
                      </button>
                    </div>
                    {assetPickerOpen ? (
                      <label className="expression-asset-picker">
                        选择已有图片素材
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
                        <small>更换素材会立即应用；名称修改请点击应用。</small>
                      </label>
                    ) : null}
                  </div>
                  {cardWarnings.map((warning) => (
                    <ExpressionWarning
                      key={`${warning.expressionId}-${warning.assetId}`}
                      warning={warning}
                    />
                  ))}
                  <div className="expression-form-actions">
                    <button
                      data-testid={`expression-cancel-${expression.id}`}
                      onClick={cancelExpressionEdit}
                      type="button"
                    >
                      取消
                    </button>
                    <button
                      data-testid={`expression-apply-${expression.id}`}
                      disabled={
                        disabled ||
                        !editingName.trim() ||
                        editingName.trim() === expression.name
                      }
                      onClick={() => applyExpressionName(expression)}
                      type="button"
                    >
                      应用
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {unscopedWarnings.length > 0 ? (
        <div className="expression-unscoped-warning" role="alert">
          <strong>其他尺寸提示</strong>
          {unscopedWarnings.map((warning) => (
            <span key={`${warning.assetId}-${warning.label}`}>
              {warning.label}：{warning.candidate.width}×
              {warning.candidate.height}。请人工确认视觉缩放。
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function ExpressionEditor({
  presentation = 'default',
  ...props
}: ExpressionEditorProps): React.JSX.Element {
  return presentation === 'landscape' ? (
    <LandscapeExpressionEditor {...props} presentation={presentation} />
  ) : (
    <LegacyExpressionEditor {...props} presentation={presentation} />
  );
}
