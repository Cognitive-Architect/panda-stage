import { useMemo, useState } from 'react';
import type {
  Character,
  CreateCharacterInput,
  ImageAsset,
} from '../../../domain';

export interface CharacterListProps {
  characters: readonly Character[];
  imageAssets: readonly ImageAsset[];
  selectedCharacterId: string | null;
  disabled?: boolean;
  onCreate: (input: CreateCharacterInput) => void;
  onSelect: (characterId: string) => void;
}

export function CharacterList({
  characters,
  imageAssets,
  selectedCharacterId,
  disabled = false,
  onCreate,
  onSelect,
}: CharacterListProps): React.JSX.Element {
  const [name, setName] = useState('新角色');
  const [normalAssetId, setNormalAssetId] = useState(
    imageAssets[0]?.id ?? '',
  );
  const [angryAssetId, setAngryAssetId] = useState(
    imageAssets[1]?.id ?? imageAssets[0]?.id ?? '',
  );
  const [mouthAssetId, setMouthAssetId] = useState('');
  const canCreate = useMemo(
    () =>
      !disabled &&
      name.trim().length > 0 &&
      Boolean(normalAssetId) &&
      Boolean(angryAssetId) &&
      normalAssetId !== angryAssetId,
    [angryAssetId, disabled, name, normalAssetId],
  );

  return (
    <aside className="character-list">
      <div className="character-list-heading">
        <strong>角色</strong>
        <span>{characters.length}</span>
      </div>
      <div className="character-list-items">
        {characters.length === 0 ? (
          <p>还没有角色。请先准备至少两张图片素材。</p>
        ) : (
          characters.map((character) => (
            <button
              aria-pressed={selectedCharacterId === character.id}
              className={
                selectedCharacterId === character.id
                  ? 'character-list-active'
                  : ''
              }
              data-character-id={character.id}
              key={character.id}
              onClick={() => onSelect(character.id)}
              type="button"
            >
              <strong>{character.name}</strong>
              <span>{character.expressions.length} 个表情</span>
            </button>
          ))
        )}
      </div>
      <form
        className="character-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canCreate) return;
          onCreate({
            name,
            expressions: [
              { name: 'normal', assetId: normalAssetId },
              { name: 'angry', assetId: angryAssetId },
            ],
            ...(mouthAssetId
              ? { mouthOpenAssetId: mouthAssetId }
              : {}),
            defaultScale: 1,
            defaultFlipX: false,
          });
        }}
      >
        <strong>创建含普通 / 生气表情的角色</strong>
        <label>
          角色名称
          <input
            disabled={disabled}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label>
          普通表情图片
          <select
            disabled={disabled}
            onChange={(event) => setNormalAssetId(event.target.value)}
            value={normalAssetId}
          >
            <option value="">请选择图片</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.width}×{asset.height}
              </option>
            ))}
          </select>
        </label>
        <label>
          生气表情图片
          <select
            disabled={disabled}
            onChange={(event) => setAngryAssetId(event.target.value)}
            value={angryAssetId}
          >
            <option value="">请选择不同图片</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.width}×{asset.height}
              </option>
            ))}
          </select>
        </label>
        <label>
          张嘴图（可选）
          <select
            disabled={disabled}
            onChange={(event) => setMouthAssetId(event.target.value)}
            value={mouthAssetId}
          >
            <option value="">暂不配置</option>
            {imageAssets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} · {asset.width}×{asset.height}
              </option>
            ))}
          </select>
        </label>
        <button disabled={!canCreate} type="submit">
          创建角色
        </button>
        {imageAssets.length < 2 ? (
          <small>至少需要两张不同的项目图片素材。</small>
        ) : null}
      </form>
    </aside>
  );
}
