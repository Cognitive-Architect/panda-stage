import { useMemo, useState } from 'react';
import type {
  Character,
  CreateCharacterInput,
  ImageAsset,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import characterEmptyAngry from './assets/character-empty-angry.png';
import characterEmptyNormal from './assets/character-empty-normal.png';
import {
  CharacterAvatar,
  getCharacterDefaultExpression,
} from './CharacterIdentity';
import { ImageAssetPicker } from './ImageAssetPicker';

export interface CharacterListProps {
  characters: readonly Character[];
  imageAssets: readonly ImageAsset[];
  selectedCharacterId: string | null;
  disabled?: boolean;
  onCreate: (input: CreateCharacterInput) => void;
  onSelect: (characterId: string) => void;
  mode?: CharacterListMode;
  onBack?: () => void;
  showHeading?: boolean;
  presentation?: CharacterListPresentation;
  thumbnails?: Readonly<Record<string, ThumbnailState>>;
  onThumbnailError?: (assetId: string) => void;
}

export type CharacterListMode = 'legacy' | 'list' | 'create';
export type CharacterListPresentation = 'default' | 'landscape';

export function CharacterList({
  characters,
  imageAssets,
  selectedCharacterId,
  disabled = false,
  onCreate,
  onSelect,
  mode = 'legacy',
  onBack = () => undefined,
  showHeading = true,
  presentation = 'default',
  thumbnails = {},
  onThumbnailError = () => undefined,
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
    <aside
      aria-label={showHeading ? undefined : '角色列表'}
      className={`character-list character-list-${mode}`}
      data-character-list-presentation={presentation}
      data-testid={
        mode === 'list'
          ? 'character-list-view'
          : mode === 'create'
            ? 'character-create-view'
            : 'character-legacy-view'
      }
    >
      <div
        className={
          showHeading
            ? 'character-list-heading'
            : 'character-list-heading character-list-heading-visually-hidden'
        }
      >
        <div>
          <p className="eyebrow">角色资源</p>
          <strong>{mode === 'create' ? '新建角色' : '角色列表'}</strong>
        </div>
        {mode === 'create' ? (
          <button
            data-testid="character-create-back"
            onClick={onBack}
            type="button"
          >
            返回角色列表
          </button>
        ) : (
          <span>{characters.length}</span>
        )}
      </div>
      {mode !== 'create' ? (
        <div className="character-list-items">
          {characters.length === 0 ? (
            presentation === 'landscape' && mode === 'list' ? (
              <div
                className="character-empty-state"
                data-testid="character-empty-state"
              >
                <div className="character-empty-state-copy">
                  <strong>还没有角色</strong>
                  <p>先准备 2 张角色图片，就能创建角色了。</p>
                </div>
                <p className="character-empty-state-bridge">
                  例如这样的两张图片
                </p>
                <div
                  aria-label="普通和生气表情示意"
                  className="character-empty-state-examples"
                  role="group"
                >
                  <figure className="character-empty-state-example">
                    <img
                      alt="普通表情示意图"
                      draggable={false}
                      src={characterEmptyNormal}
                    />
                    <figcaption>普通</figcaption>
                  </figure>
                  <figure className="character-empty-state-example">
                    <img
                      alt="生气表情示意图"
                      draggable={false}
                      src={characterEmptyAngry}
                    />
                    <figcaption>生气</figcaption>
                  </figure>
                </div>
              </div>
            ) : (
              <p>
                <strong>还没有角色</strong>
                <br />
                先准备 2 张角色图片，就能创建角色了。
              </p>
            )
          ) : (
            characters.map((character) => {
              const defaultExpression = getCharacterDefaultExpression(character);
              const thumbnail = defaultExpression
                ? thumbnails[defaultExpression.assetId]
                : undefined;
              const selected = selectedCharacterId === character.id;
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? 'character-list-active' : ''}
                  data-character-id={character.id}
                  key={character.id}
                  onClick={() => onSelect(character.id)}
                  type="button"
                >
                  <CharacterAvatar
                    character={character}
                    className="character-list-avatar"
                    onThumbnailError={onThumbnailError}
                    thumbnail={thumbnail}
                  />
                  <span className="character-list-copy">
                    <strong>{character.name}</strong>
                    <small>
                      {character.expressions.length} 个表情 · 默认{' '}
                      {defaultExpression?.name ?? '未配置'}
                    </small>
                  </span>
                  {selected ? (
                    <span
                      aria-label="当前选择"
                      className="character-list-selected-badge"
                    >
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
      {mode !== 'list' ? (
        <form
          className="character-create-form"
          data-testid="character-create-view"
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
          {mode === 'legacy' ? (
            <strong>创建含普通 / 生气表情的角色</strong>
          ) : null}
          <label>
            角色名称
            <input
              disabled={disabled}
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <ImageAssetPicker
            assets={imageAssets}
            emptyState={{
              description: '从项目图片中选择一张。',
              label: '请选择图片',
            }}
            label="普通表情图片"
            onChange={(assetId) => setNormalAssetId(assetId ?? '')}
            onThumbnailError={onThumbnailError}
            selectedAssetId={normalAssetId || null}
            testId="character-create-normal-picker"
            thumbnails={thumbnails}
            disabled={disabled}
          />
          <ImageAssetPicker
            assets={imageAssets}
            emptyState={{
              description: '不能与普通表情使用同一素材。',
              label: '请选择不同图片',
            }}
            getDisabledReason={(asset) =>
              asset.id === normalAssetId ? '已用于普通表情' : undefined
            }
            label="生气表情图片"
            onChange={(assetId) => setAngryAssetId(assetId ?? '')}
            onThumbnailError={onThumbnailError}
            selectedAssetId={angryAssetId || null}
            selectionConflict={
              normalAssetId && angryAssetId === normalAssetId
                ? '已用于普通表情，请选择另一张图片。'
                : undefined
            }
            testId="character-create-angry-picker"
            thumbnails={thumbnails}
            disabled={disabled}
          />
          <ImageAssetPicker
            assets={imageAssets}
            emptyOption={{
              description: '创建后也可以在角色详情中配置。',
              label: '暂不配置',
              optional: true,
            }}
            label="张嘴图（可选）"
            onChange={(assetId) => setMouthAssetId(assetId ?? '')}
            onThumbnailError={onThumbnailError}
            selectedAssetId={mouthAssetId || null}
            testId="character-create-mouth-picker"
            thumbnails={thumbnails}
            disabled={disabled}
          />
          <button disabled={!canCreate} type="submit">
            创建角色
          </button>
          {mode === 'legacy' && imageAssets.length < 2 ? (
            <small>至少需要两张不同的项目图片素材。</small>
          ) : null}
        </form>
      ) : null}
    </aside>
  );
}
