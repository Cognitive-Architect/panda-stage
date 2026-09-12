import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Character,
  CharacterExpression,
  ImageAsset,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import {
  thumbnailStateFromResponse,
  type ThumbnailState,
} from '../assets/AssetCard';

export function getCharacterDefaultExpression(
  character: Pick<Character, 'expressions' | 'defaultExpressionId'>,
): CharacterExpression | undefined {
  return (
    character.expressions.find(
      (expression) => expression.id === character.defaultExpressionId,
    ) ?? character.expressions[0]
  );
}

function thumbnailLabel(
  thumbnail?: ThumbnailState,
  hasDefaultExpression = false,
): string {
  if (thumbnail?.status === 'loading' || (!thumbnail && hasDefaultExpression)) {
    return '加载中';
  }
  if (thumbnail?.status === 'missing' && thumbnail.reason === 'source') {
    return '源文件缺失';
  }
  if (thumbnail?.status === 'missing') return '缩略图不可用';
  return '未配置默认表情';
}

/**
 * Read-only thumbnail loading shared by Character surfaces and Dialogue
 * identity surfaces. The project model remains the only source of identity;
 * this adapter only reads the existing thumbnail IPC for default expressions.
 */
export function useProjectImageThumbnails(
  projectRoot: string | null,
  imageAssets: readonly ImageAsset[],
): {
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onThumbnailError: (assetId: string) => void;
} {
  const [thumbnails, setThumbnails] = useState<
    Record<string, ThumbnailState>
  >({});

  useEffect(() => {
    let active = true;
    const next: Record<string, ThumbnailState> = {};
    for (const asset of imageAssets) {
      next[asset.id] = { status: 'loading' };
    }
    setThumbnails(next);

    if (!projectRoot) {
      return () => {
        active = false;
      };
    }

    for (const asset of imageAssets) {
      void window.pandaStage.assets
        .readThumbnail({
          projectRoot,
          assetId: asset.id,
          sha256: asset.sha256,
        })
        .then((response) => {
          if (!active) return;
          setThumbnails((current) => ({
            ...current,
            [asset.id]: thumbnailStateFromResponse(response),
          }));
        })
        .catch(() => {
          if (!active) return;
          setThumbnails((current) => ({
            ...current,
            [asset.id]: { status: 'missing', reason: 'error' },
          }));
        });
    }

    return () => {
      active = false;
    };
  }, [imageAssets, projectRoot]);

  const onThumbnailError = useCallback((assetId: string): void => {
    setThumbnails((current) => ({
      ...current,
      [assetId]: { status: 'missing', reason: 'error' },
    }));
  }, []);

  return { onThumbnailError, thumbnails };
}

/** Load only the image assets that can act as a Character avatar. */
export function useCharacterAvatarThumbnails(
  snapshot: EditorProjectSnapshot | null,
  characters: readonly Character[],
): {
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onThumbnailError: (assetId: string) => void;
} {
  const avatarAssetIds = useMemo(() => {
    const ids = new Set<string>();
    for (const character of characters) {
      const expression = getCharacterDefaultExpression(character);
      if (expression) ids.add(expression.assetId);
    }
    return ids;
  }, [characters]);
  const avatarAssets = useMemo(
    () =>
      (snapshot?.project.assets.filter(
        (asset): asset is ImageAsset =>
          asset.kind === 'image' && avatarAssetIds.has(asset.id),
      ) ?? []),
    [avatarAssetIds, snapshot?.project.assets],
  );

  return useProjectImageThumbnails(
    snapshot?.projectRoot ?? null,
    avatarAssets,
  );
}

export interface CharacterAvatarProps {
  character: Pick<Character, 'name' | 'expressions' | 'defaultExpressionId'>;
  thumbnail?: ThumbnailState;
  className?: string;
  onThumbnailError?: (assetId: string) => void;
}

export function CharacterAvatar({
  character,
  thumbnail,
  className,
  onThumbnailError = () => undefined,
}: CharacterAvatarProps): React.JSX.Element {
  const defaultExpression = getCharacterDefaultExpression(character);
  const status = thumbnail?.status ?? (defaultExpression ? 'loading' : 'missing');
  const label = thumbnailLabel(thumbnail, Boolean(defaultExpression));
  const classes = [
    'character-identity-avatar',
    className,
  ].filter(Boolean).join(' ');

  return (
    <span
      aria-label={`${character.name} 默认表情头像`}
      className={classes}
      data-character-avatar="true"
      data-thumbnail-status={status}
    >
      {thumbnail?.status === 'ready' && defaultExpression ? (
        <img
          alt={`${character.name} 默认表情`}
          decoding="async"
          loading="lazy"
          onError={() => onThumbnailError(defaultExpression.assetId)}
          src={thumbnail.dataUrl}
        />
      ) : (
        <span
          aria-label={label}
          className="character-thumbnail-fallback character-avatar-fallback"
          data-thumbnail-fallback={status}
        >
          <span aria-hidden="true" className="character-thumbnail-fallback-icon">
            ○
          </span>
          <small>{label}</small>
        </span>
      )}
    </span>
  );
}

export interface CharacterIdentityRowProps {
  character: Character;
  thumbnail?: ThumbnailState;
  selected?: boolean;
  selectedLabel?: string;
  showDefaultExpression?: boolean;
  className?: string;
  onThumbnailError?: (assetId: string) => void;
}

export function CharacterIdentityRow({
  character,
  thumbnail,
  selected = false,
  selectedLabel = '当前说话人',
  showDefaultExpression = true,
  className,
  onThumbnailError,
}: CharacterIdentityRowProps): React.JSX.Element {
  return (
    <span
      className={['character-identity-row', className].filter(Boolean).join(' ')}
      data-character-id={character.id}
    >
      <CharacterAvatar
        character={character}
        onThumbnailError={onThumbnailError}
        thumbnail={thumbnail}
      />
      <span className="character-identity-copy">
        <strong>{character.name}</strong>
        {showDefaultExpression ? (
          <small>
            默认表情：
            {getCharacterDefaultExpression(character)?.name ?? '未配置'}
          </small>
        ) : null}
      </span>
      {selected ? (
        <span
          aria-label={selectedLabel}
          className="character-identity-selected"
        >
          <span
            aria-hidden="true"
            className="character-identity-selected-check"
          >
            ✓
          </span>
          <small>{selectedLabel}</small>
        </span>
      ) : null}
    </span>
  );
}

export interface CharacterIdentityOptionListProps {
  characters: readonly Character[];
  selectedCharacterId: string | null;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
  onSelect: (characterId: string) => void;
  onThumbnailError?: (assetId: string) => void;
  ariaLabel?: string;
  emptyLabel?: string;
  selectedLabel?: string;
  showDefaultExpression?: boolean;
  testId?: string;
  disabled?: boolean;
  className?: string;
}

export function CharacterIdentityOptionList({
  characters,
  selectedCharacterId,
  thumbnails,
  onSelect,
  onThumbnailError,
  ariaLabel = '角色选择',
  emptyLabel = '暂无可用角色',
  selectedLabel = '当前说话人',
  showDefaultExpression = true,
  testId,
  disabled = false,
  className,
}: CharacterIdentityOptionListProps): React.JSX.Element {
  return (
    <div
      aria-label={ariaLabel}
      className={['character-identity-options', className]
        .filter(Boolean)
        .join(' ')}
      data-testid={testId}
      role="radiogroup"
    >
      {characters.length === 0 ? (
        <p className="character-identity-options-empty">{emptyLabel}</p>
      ) : (
        characters.map((character) => {
          const selected = character.id === selectedCharacterId;
          return (
            <button
              aria-checked={selected}
              className={`character-identity-option${selected ? ' is-selected' : ''}`}
              data-character-id={character.id}
              disabled={disabled}
              key={character.id}
              onClick={() => onSelect(character.id)}
              role="radio"
              type="button"
            >
              <CharacterIdentityRow
                character={character}
                onThumbnailError={onThumbnailError}
                selected={selected}
                selectedLabel={selectedLabel}
                showDefaultExpression={showDefaultExpression}
                thumbnail={thumbnails[getCharacterDefaultExpression(character)?.assetId ?? '']}
              />
            </button>
          );
        })
      )}
    </div>
  );
}

export interface CharacterIdentityPickerProps
  extends Omit<CharacterIdentityOptionListProps, 'testId' | 'className'> {
  defaultOpen?: boolean;
  testId?: string;
  'data-testid'?: string;
  className?: string;
  id?: string;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean;
  emptySummaryLabel?: string;
  emptySummaryDescription?: string | null;
  onClear?: () => void;
  clearLabel?: string;
}

export function CharacterIdentityPicker({
  characters,
  selectedCharacterId,
  thumbnails,
  onSelect,
  onThumbnailError,
  ariaLabel = '角色选择',
  emptyLabel = '暂无可用角色',
  selectedLabel = '当前说话人',
  defaultOpen = false,
  testId,
  'data-testid': dataTestId,
  className,
  id,
  ariaDescribedBy,
  ariaInvalid,
  emptySummaryLabel = '选择角色',
  emptySummaryDescription = '从项目角色中选择说话人',
  onClear,
  clearLabel = '清除选择',
  showDefaultExpression = true,
  disabled = false,
}: CharacterIdentityPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  const selectedCharacter = characters.find(
    (character) => character.id === selectedCharacterId,
  );

  return (
    <details
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid || undefined}
      aria-label={ariaLabel}
      className={['character-identity-picker', className]
        .filter(Boolean)
        .join(' ')}
      data-testid={dataTestId ?? testId}
      id={id}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="character-identity-picker-summary">
        {selectedCharacter ? (
          <CharacterIdentityRow
            character={selectedCharacter}
            onThumbnailError={onThumbnailError}
            selected
            selectedLabel={selectedLabel}
            showDefaultExpression={showDefaultExpression}
            thumbnail={
              thumbnails[
                getCharacterDefaultExpression(selectedCharacter)?.assetId ?? ''
              ]
            }
          />
        ) : (
          <span className="character-identity-empty-summary">
            <span aria-hidden="true" className="character-identity-empty-icon">
              ○
            </span>
            <span>
              <strong>{emptySummaryLabel}</strong>
              {emptySummaryDescription ? (
                <small>{emptySummaryDescription}</small>
              ) : null}
            </span>
          </span>
        )}
        <span aria-hidden="true" className="character-identity-picker-chevron">
          {open ? '▲' : '▼'}
        </span>
      </summary>
      <div className="character-identity-menu">
        <CharacterIdentityOptionList
          ariaLabel={ariaLabel}
          characters={characters}
          disabled={disabled}
          emptyLabel={emptyLabel}
          onSelect={(characterId) => {
            onSelect(characterId);
            setOpen(false);
          }}
          onThumbnailError={onThumbnailError}
          selectedCharacterId={selectedCharacterId}
          selectedLabel={selectedLabel}
          showDefaultExpression={showDefaultExpression}
          thumbnails={thumbnails}
        />
        {selectedCharacter && onClear ? (
          <button
            className="character-identity-clear"
            disabled={disabled}
            onClick={() => {
              onClear();
              setOpen(false);
            }}
            type="button"
          >
            {clearLabel}
          </button>
        ) : null}
      </div>
    </details>
  );
}

export interface CharacterExpressionThumbnailProps {
  expression: CharacterExpression;
  thumbnail?: ThumbnailState;
  onThumbnailError?: (assetId: string) => void;
  className?: string;
}

export function CharacterExpressionThumbnail({
  expression,
  thumbnail,
  onThumbnailError = () => undefined,
  className,
}: CharacterExpressionThumbnailProps): React.JSX.Element {
  const status = thumbnail?.status ?? 'missing';
  return (
    <span
      className={['character-expression-thumbnail', className]
        .filter(Boolean)
        .join(' ')}
      data-thumbnail-status={status}
    >
      {thumbnail?.status === 'ready' ? (
        <img
          alt={`${expression.name} 表情缩略图`}
          decoding="async"
          loading="lazy"
          onError={() => onThumbnailError(expression.assetId)}
          src={thumbnail.dataUrl}
        />
      ) : (
        <span
          aria-label={thumbnailLabel(thumbnail)}
          className="character-thumbnail-fallback"
          data-thumbnail-fallback={status}
        >
          <span aria-hidden="true" className="character-thumbnail-fallback-icon">
            ○
          </span>
          <small>{thumbnailLabel(thumbnail)}</small>
        </span>
      )}
    </span>
  );
}
