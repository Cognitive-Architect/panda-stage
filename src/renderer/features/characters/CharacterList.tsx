import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
  Character,
  CreateCharacterInput,
  CreateCompositeCharacterInput,
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
import { Button } from '../../ui';

export interface CharacterListProps {
  characters: readonly Character[];
  imageAssets: readonly ImageAsset[];
  selectedCharacterId: string | null;
  disabled?: boolean;
  onCreate: (input: CreateCharacterInput) => void;
  compositeDraft?: CreateCompositeCharacterInput | null;
  onBeginCompositeCreate?: (
    initialDraft: CreateCompositeCharacterInput,
  ) => boolean;
  onCommitCompositeCreate?: () => void;
  onCompositeDraftChange?: (
    draft: CreateCompositeCharacterInput,
  ) => void;
  onCancelCompositeCreate?: () => void;
  /**
   * Issue #1031 / CHAR-UNI-01 F01: the single Create entry offers FLA import as
   * a third creation way and hands off to the existing import flow. Absent when
   * the host has no FLA import capability.
   */
  onStartFlaCharacterImport?: () => void;
  onSelect: (characterId: string) => void;
  mode?: CharacterListMode;
  onBack?: () => void;
  modeSwitchTarget?: HTMLElement | null;
  showHeading?: boolean;
  presentation?: CharacterListPresentation;
  thumbnails?: Readonly<Record<string, ThumbnailState>>;
  onThumbnailError?: (assetId: string) => void;
}

export type CharacterListMode = 'legacy' | 'list' | 'create';
export type CharacterListPresentation = 'default' | 'landscape';
export type CharacterCreationMode = 'single-image' | 'composite' | 'fla-import';

function isUsableImageAsset(
  imageAssets: readonly ImageAsset[],
  assetId: string | undefined,
): boolean {
  return Boolean(assetId) &&
    imageAssets.some((asset) => asset.id === assetId && asset.kind === 'image');
}

/** Issue #1031 F03: a composite draft is only creatable once the user has
 *  explicitly chosen a body and a default face. */
function isCompositeDraftReady(
  draft: CreateCompositeCharacterInput | null,
  imageAssets: readonly ImageAsset[],
): boolean {
  if (!draft) return false;
  const faceAssetId =
    draft.expressions[draft.defaultExpressionIndex ?? 0]?.assetId;
  return (
    isUsableImageAsset(imageAssets, draft.bodyAssetId) &&
    isUsableImageAsset(imageAssets, faceAssetId)
  );
}

function createEmptyCompositeDraft(
  name: string,
): CreateCompositeCharacterInput {
  return {
    name,
    bodyAssetId: '',
    facePlacement: {
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
      flipX: false,
    },
    expressions: [],
    defaultExpressionIndex: 0,
    defaultScale: 1,
    defaultFlipX: false,
  };
}

export function CharacterList({
  characters,
  imageAssets,
  selectedCharacterId,
  disabled = false,
  onCreate,
  compositeDraft = null,
  onBeginCompositeCreate = () => false,
  onCommitCompositeCreate = () => undefined,
  onCompositeDraftChange = () => undefined,
  onCancelCompositeCreate = () => undefined,
  onStartFlaCharacterImport,
  onSelect,
  mode = 'legacy',
  onBack = () => undefined,
  modeSwitchTarget = null,
  showHeading = true,
  presentation = 'default',
  thumbnails = {},
  onThumbnailError = () => undefined,
}: CharacterListProps): React.JSX.Element {
  const compactLandscapeCreate =
    mode === 'create' && presentation === 'landscape';
  const [name, setName] = useState('新角色');
  const [normalAssetId, setNormalAssetId] = useState(
    imageAssets[0]?.id ?? '',
  );
  const [angryAssetId, setAngryAssetId] = useState(
    imageAssets[1]?.id ?? imageAssets[0]?.id ?? '',
  );
  const [mouthAssetId, setMouthAssetId] = useState('');
  const [creationMode, setCreationMode] = useState<CharacterCreationMode>(
    'single-image',
  );
  /**
   * Issue #1031 F03: composite creation starts from an empty, explicit choice.
   * Until a body and a default face are both chosen the draft stays in local UI
   * state only; the official assembly session (and the centre preview) starts
   * once the draft is complete, so no asset is silently borrowed from the list.
   */
  const [pendingCompositeDraft, setPendingCompositeDraft] =
    useState<CreateCompositeCharacterInput | null>(null);
  const activeCompositeDraft = compositeDraft ?? pendingCompositeDraft;
  const canCreate = useMemo(
    () =>
      !disabled &&
      (creationMode === 'composite'
        ? Boolean(activeCompositeDraft?.name.trim()) &&
          isCompositeDraftReady(activeCompositeDraft, imageAssets)
        : name.trim().length > 0 &&
          Boolean(normalAssetId) &&
          Boolean(angryAssetId) &&
          normalAssetId !== angryAssetId),
    [
      activeCompositeDraft,
      angryAssetId,
      creationMode,
      disabled,
      imageAssets,
      name,
      normalAssetId,
    ],
  );
  useEffect(() => {
    if (mode === 'list' && creationMode === 'composite') {
      setCreationMode('single-image');
      setPendingCompositeDraft(null);
    }
  }, [creationMode, mode]);

  const applyCompositeDraft = (next: CreateCompositeCharacterInput): void => {
    setPendingCompositeDraft(next);
    if (compositeDraft) {
      onCompositeDraftChange(next);
      return;
    }
    if (isCompositeDraftReady(next, imageAssets)) {
      onBeginCompositeCreate(next);
    }
  };

  const changeCreationMode = (nextMode: CharacterCreationMode): void => {
    if (nextMode === 'fla-import') {
      // Issue #1031 F01/F04: hand off to the existing FLA import flow and drop
      // any uncommitted composite draft first.
      onCancelCompositeCreate();
      setPendingCompositeDraft(null);
      onStartFlaCharacterImport?.();
      return;
    }
    if (nextMode === creationMode) return;
    if (nextMode === 'single-image') {
      onCancelCompositeCreate();
      setPendingCompositeDraft(null);
      setCreationMode('single-image');
      return;
    }

    onCancelCompositeCreate();
    setPendingCompositeDraft(createEmptyCompositeDraft(name));
    setCreationMode('composite');
  };

  const creationModeCount = onStartFlaCharacterImport ? 3 : 2;
  const modeSwitch = (
    <fieldset
      aria-label="角色类型"
      className="character-create-mode-switch"
      data-creation-mode-count={creationModeCount}
      disabled={disabled}
      data-testid="character-create-mode-switch"
    >
      <label>
        <input
          checked={creationMode === 'single-image'}
          name="character-create-mode"
          onChange={() => changeCreationMode('single-image')}
          type="radio"
          value="single-image"
        />
        <span>{compactLandscapeCreate ? '整图' : '整图角色'}</span>
      </label>
      <label>
        <input
          checked={creationMode === 'composite'}
          name="character-create-mode"
          onChange={() => changeCreationMode('composite')}
          type="radio"
          value="composite"
        />
        <span>{compactLandscapeCreate ? '身体+脸' : '身体 + 脸'}</span>
      </label>
      {onStartFlaCharacterImport ? (
        <label>
          <input
            checked={false}
            data-testid="character-create-fla-import"
            name="character-create-mode"
            onChange={() => changeCreationMode('fla-import')}
            type="radio"
            value="fla-import"
          />
          <span>{compactLandscapeCreate ? '导入FLA' : '导入 FLA'}</span>
        </label>
      ) : null}
    </fieldset>
  );
  const modeSwitchContent =
    compactLandscapeCreate && modeSwitchTarget
      ? createPortal(modeSwitch, modeSwitchTarget)
      : modeSwitch;

  return (
    <aside
      aria-label={
        showHeading
          ? undefined
          : mode === 'create'
            ? '创建角色'
            : '角色列表'
      }
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
      {!compactLandscapeCreate ? (
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
      ) : null}
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
                      {character.mode === 'adaptive-parts'
                        ? `${character.parts.length} 个零件`
                        : `${character.expressions.length} 个表情 · 默认 ${defaultExpression?.name ?? '未配置'}`}
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
          data-create-layout={
            compactLandscapeCreate ? 'compressed-v2' : undefined
          }
          data-creation-mode={creationMode}
          data-testid="character-create-view"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate) return;
            if (creationMode === 'composite') {
              onCommitCompositeCreate();
              return;
            }
            onCreate({
              name,
              expressions: [
                { name: 'normal', assetId: normalAssetId },
                { name: 'angry', assetId: angryAssetId },
              ],
              ...(mouthAssetId ? { mouthOpenAssetId: mouthAssetId } : {}),
              defaultScale: 1,
              defaultFlipX: false,
            });
          }}
        >
          {compactLandscapeCreate ? modeSwitchContent : null}
          {mode === 'legacy' && creationMode === 'single-image' ? (
            <strong>创建含普通 / 生气表情的角色</strong>
          ) : null}
          <label
            className={
              compactLandscapeCreate ? 'character-create-name-row' : undefined
            }
          >
            <span>角色名称</span>
            <input
              disabled={disabled}
              data-testid="character-create-name"
              maxLength={200}
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (creationMode === 'composite' && activeCompositeDraft) {
                  applyCompositeDraft({
                    ...activeCompositeDraft,
                    name: nextName,
                  });
                }
              }}
              value={
                creationMode === 'composite'
                  ? activeCompositeDraft?.name ?? name
                  : name
              }
            />
          </label>
          {!compactLandscapeCreate ? modeSwitchContent : null}
          {creationMode === 'composite' ? (
            <>
              {isCompositeDraftReady(activeCompositeDraft, imageAssets) ? null : (
                <small
                  className="character-create-hint"
                  data-testid="character-create-composite-hint"
                >
                  先选择身体和默认脸，选齐后开始组装预览。
                </small>
              )}
              <ImageAssetPicker
                assets={imageAssets}
                emptyState={{
                  description: '从项目图片中选择身体。',
                  label: '请选择图片',
                }}
                label={compactLandscapeCreate ? '身体' : '身体图片'}
                onChange={(assetId) => {
                  if (!activeCompositeDraft) return;
                  applyCompositeDraft({
                    ...activeCompositeDraft,
                    bodyAssetId: assetId ?? '',
                  });
                }}
                onThumbnailError={onThumbnailError}
                selectedAssetId={activeCompositeDraft?.bodyAssetId || null}
                testId="character-create-body-picker"
                thumbnails={thumbnails}
                disabled={disabled}
              />
              <ImageAssetPicker
                assets={imageAssets}
                emptyOption={{ label: '不添加头部', optional: true }}
                emptyActionLabel="选择"
                label="头部"
                onChange={(assetId) => {
                  if (!activeCompositeDraft) return;
                  const next = { ...activeCompositeDraft };
                  if (assetId) {
                    next.head = activeCompositeDraft.head
                      ? { ...activeCompositeDraft.head, assetId }
                      : {
                          assetId,
                          placement: {
                            offsetX: 0,
                            offsetY: 0,
                            scale: 1,
                            rotationDeg: 0,
                            flipX: false,
                          },
                          pivot: { x: 0, y: 0 },
                        };
                  } else {
                    delete next.head;
                  }
                  applyCompositeDraft(next);
                }}
                onThumbnailError={onThumbnailError}
                searchAndPaginate
                selectedAssetId={activeCompositeDraft?.head?.assetId ?? null}
                testId="character-create-head-picker"
                thumbnails={thumbnails}
                disabled={disabled}
              />
              <ImageAssetPicker
                assets={imageAssets}
                emptyState={{
                  description: '从项目图片中选择默认脸部。',
                  label: '请选择图片',
                }}
                label={compactLandscapeCreate ? '默认脸' : '默认表情图片'}
                onChange={(assetId) => {
                  if (!activeCompositeDraft) return;
                  const expressionIndex =
                    activeCompositeDraft.defaultExpressionIndex ?? 0;
                  const expressions = [...activeCompositeDraft.expressions];
                  const expression = expressions[expressionIndex];
                  if (expression) {
                    expressions[expressionIndex] = {
                      ...expression,
                      assetId: assetId ?? '',
                    };
                  } else if (assetId) {
                    expressions.push({
                      name: '表情1',
                      assetId,
                    });
                  }
                  applyCompositeDraft({
                    ...activeCompositeDraft,
                    expressions,
                    defaultExpressionIndex: 0,
                  });
                }}
                onThumbnailError={onThumbnailError}
                selectedAssetId={
                  activeCompositeDraft?.expressions[
                    activeCompositeDraft.defaultExpressionIndex ?? 0
                  ]?.assetId ?? null
                }
                testId="character-create-face-picker"
                thumbnails={thumbnails}
                disabled={disabled}
              />
              <ImageAssetPicker
                assets={imageAssets}
                emptyOption={{
                  label: '暂不配置',
                  ...(compactLandscapeCreate
                    ? {}
                    : {
                        description: '可以稍后再配置。',
                        optional: true,
                      }),
                }}
                label={compactLandscapeCreate ? '张嘴图' : '张嘴图（可选）'}
                onChange={(assetId) => {
                  if (!activeCompositeDraft) return;
                  const next = { ...activeCompositeDraft };
                  if (assetId) next.mouthOpenAssetId = assetId;
                  else delete next.mouthOpenAssetId;
                  applyCompositeDraft(next);
                }}
                onThumbnailError={onThumbnailError}
                selectedAssetId={activeCompositeDraft?.mouthOpenAssetId ?? null}
                testId="character-create-mouth-picker"
                thumbnails={thumbnails}
                disabled={disabled}
              />
              {compactLandscapeCreate ? (
                <div className="character-create-actions">
                  <Button
                    aria-label="返回角色列表"
                    className="character-create-back"
                    data-testid="character-create-back"
                    onClick={onBack}
                    type="button"
                    variant="secondary"
                  >
                    <span className="character-create-action-visual">
                      返回
                    </span>
                  </Button>
                  <Button
                    className="character-create-submit-compact"
                    data-testid="character-create-composite-submit"
                    disabled={!canCreate}
                    type="submit"
                    variant="primary"
                  >
                    <span className="character-create-action-visual">
                      创建角色
                    </span>
                  </Button>
                </div>
              ) : (
                <Button
                  className="character-create-submit-compact"
                  data-testid="character-create-composite-submit"
                  disabled={!canCreate}
                  type="submit"
                  variant="primary"
                >
                  创建角色
                </Button>
              )}
            </>
          ) : (
            <>
              <ImageAssetPicker
                assets={imageAssets}
                emptyState={{
                  description: '从项目图片中选择一张。',
                  label: '请选择图片',
                }}
                label={compactLandscapeCreate ? '普通表情' : '普通表情图片'}
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
                label={compactLandscapeCreate ? '生气表情' : '生气表情图片'}
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
                  label: '暂不配置',
                  ...(compactLandscapeCreate
                    ? {}
                    : {
                        description: '创建后也可以在角色详情中配置。',
                        optional: true,
                      }),
                }}
                label={compactLandscapeCreate ? '张嘴图' : '张嘴图（可选）'}
                onChange={(assetId) => setMouthAssetId(assetId ?? '')}
                onThumbnailError={onThumbnailError}
                selectedAssetId={mouthAssetId || null}
                testId="character-create-mouth-picker"
                thumbnails={thumbnails}
                disabled={disabled}
              />
              {compactLandscapeCreate ? (
                <div className="character-create-actions">
                  <Button
                    aria-label="返回角色列表"
                    className="character-create-back"
                    data-testid="character-create-back"
                    onClick={onBack}
                    type="button"
                    variant="secondary"
                  >
                    <span className="character-create-action-visual">
                      返回
                    </span>
                  </Button>
                  <Button
                    className="character-create-submit-compact"
                    data-testid="character-create-single-submit"
                    disabled={!canCreate}
                    type="submit"
                    variant="primary"
                  >
                    <span className="character-create-action-visual">
                      创建角色
                    </span>
                  </Button>
                </div>
              ) : (
                <button
                  className="character-create-submit-compact"
                  disabled={!canCreate}
                  type="submit"
                >
                  创建角色
                </button>
              )}
              {mode === 'legacy' && imageAssets.length < 2 ? (
                <small>至少需要两张不同的项目图片素材。</small>
              ) : null}
            </>
          )}
        </form>
      ) : null}
    </aside>
  );
}
