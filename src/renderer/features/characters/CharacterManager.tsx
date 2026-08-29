import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  CharacterService,
  CharacterServiceError,
  type CreateCharacterInput,
  type ImageAsset,
  type Project,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { characterStore } from '../../stores/characterStore';
import {
  thumbnailStateFromResponse,
  type ThumbnailState,
} from '../assets/AssetCard';
import { CharacterEditor } from './CharacterEditor';
import { CharacterList } from './CharacterList';

export type CharacterWorkspaceView =
  | 'legacy'
  | 'list'
  | 'create'
  | 'detail'
  | 'expression';

export type CharacterManagerPresentation = 'default' | 'landscape';

const CHARACTER_IDLE_STATUS =
  '局部修改会先应用到当前项目；请使用“保存整个项目”写入磁盘。';

export interface CharacterManagerProps {
  snapshot: EditorProjectSnapshot | null;
  view?: CharacterWorkspaceView;
  onViewChange?: (view: CharacterWorkspaceView) => void;
  /** Keep the landscape drawer's active label as the visible identity. */
  hideHeading?: boolean;
  /** Apply visual-first Character presentation without changing its owners. */
  presentation?: CharacterManagerPresentation;
  /** Keep drawer close owned by ResourceActivityDock while sharing the detail header. */
  onCloseDrawer?: () => void;
}

export function CharacterManager({
  snapshot,
  view = 'legacy',
  onViewChange = () => undefined,
  hideHeading = false,
  presentation = 'default',
  onCloseDrawer = () => undefined,
}: CharacterManagerProps): React.JSX.Element {
  const service = useMemo(() => new CharacterService(), []);
  const [selectedCharacterId, setSelectedCharacterId] =
    useState<string | null>(snapshot?.project.characters[0]?.id ?? null);
  const [status, setStatus] = useState(CHARACTER_IDLE_STATUS);
  const [thumbnails, setThumbnails] = useState<
    Record<string, ThumbnailState>
  >({});
  const project = snapshot?.project ?? null;
  const imageAssets = useMemo(
    () =>
      (project?.assets.filter(
        (asset): asset is ImageAsset => asset.kind === 'image',
      ) ?? []),
    [project],
  );
  const selectedCharacter =
    project?.characters.find(
      (character) => character.id === selectedCharacterId,
    ) ?? null;
  const warnings =
    project && selectedCharacter
      ? service.dimensionWarnings(project, selectedCharacter.id)
      : [];
  const visibleStatus =
    presentation === 'landscape' && status === CHARACTER_IDLE_STATUS
      ? ''
      : status;

  useEffect(() => {
    if (
      selectedCharacterId &&
      project?.characters.some(
        (character) => character.id === selectedCharacterId,
      )
    ) {
      return;
    }
    setSelectedCharacterId(project?.characters[0]?.id ?? null);
  }, [project, selectedCharacterId]);

  useEffect(() => {
    if (!snapshot) {
      setThumbnails({});
      return;
    }
    let cancelled = false;
    const next: Record<string, ThumbnailState> = {};
    for (const asset of imageAssets) {
      next[asset.id] = { status: 'loading' };
    }
    setThumbnails(next);
    for (const asset of imageAssets) {
      void window.pandaStage.assets
        .readThumbnail({
          projectRoot: snapshot.projectRoot,
          assetId: asset.id,
          sha256: asset.sha256,
        })
        .then((response) => {
          if (cancelled) return;
          setThumbnails((current) => ({
            ...current,
            [asset.id]: thumbnailStateFromResponse(response),
          }));
        })
        .catch(() => {
          if (!cancelled) {
            setThumbnails((current) => ({
              ...current,
              [asset.id]: { status: 'missing', reason: 'error' },
            }));
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [imageAssets, snapshot?.projectRoot]);

  const reportError = (error: unknown): void => {
    if (error instanceof CharacterServiceError) {
      const locations = error.references
        .map((reference) => reference.label)
        .join('；');
      setStatus(locations ? `${error.message} ${locations}` : error.message);
      return;
    }
    setStatus(error instanceof Error ? error.message : '角色修改失败。');
  };

  const markThumbnailError = (assetId: string): void => {
    setThumbnails((current) => ({
      ...current,
      [assetId]: { status: 'missing', reason: 'error' },
    }));
  };

  const mutate = (
    action: () => Project,
    success: string,
  ): Project | null => {
    try {
      const next = action();
      setStatus(`${success} 修改已应用，项目尚未保存。`);
      return next;
    } catch (error) {
      reportError(error);
      return null;
    }
  };

  const createCharacter = (input: CreateCharacterInput): void => {
    const next = mutate(
      () => characterStore.create(input),
      '角色与普通 / 生气表情已创建。',
    );
    if (next) {
      setSelectedCharacterId(next.characters.at(-1)!.id);
      onViewChange('detail');
    }
  };

  return (
    <section
      className="character-manager"
      aria-labelledby="character-manager-heading"
      data-character-presentation={presentation}
      data-testid="character-manager"
    >
      <div
        className={
          hideHeading
            ? 'character-manager-heading character-manager-heading-visually-hidden'
            : 'character-manager-heading'
        }
      >
        <div>
          <p className="eyebrow">角色定义</p>
          <h2 id="character-manager-heading">角色与表情</h2>
        </div>
        <div>
          <span data-project-revision={snapshot?.revision ?? 0}>
            {snapshot
              ? `${snapshot.project.characters.length} 个角色`
              : '尚未打开项目'}
          </span>
        </div>
      </div>
      <div className="character-workspace">
        {view === 'legacy' ? (
          <CharacterList
            characters={project?.characters ?? []}
            disabled={!snapshot}
            imageAssets={imageAssets}
            mode="legacy"
            onCreate={createCharacter}
            onSelect={setSelectedCharacterId}
            onThumbnailError={markThumbnailError}
            presentation={presentation}
            selectedCharacterId={selectedCharacterId}
            showHeading={!hideHeading}
            thumbnails={thumbnails}
          />
        ) : view === 'list' ? (
          <CharacterList
            characters={project?.characters ?? []}
            disabled={!snapshot}
            imageAssets={imageAssets}
            mode="list"
            onCreate={createCharacter}
            onSelect={(characterId) => {
              setSelectedCharacterId(characterId);
              onViewChange('detail');
            }}
            onThumbnailError={markThumbnailError}
            presentation={presentation}
            selectedCharacterId={selectedCharacterId}
            showHeading={view !== 'list' || !hideHeading}
            thumbnails={thumbnails}
          />
        ) : view === 'create' ? (
          <CharacterList
            characters={project?.characters ?? []}
            disabled={!snapshot}
            imageAssets={imageAssets}
            mode="create"
            onBack={() => onViewChange('list')}
            onCreate={createCharacter}
            onSelect={setSelectedCharacterId}
            onThumbnailError={markThumbnailError}
            presentation={presentation}
            selectedCharacterId={selectedCharacterId}
            showHeading={!hideHeading}
            thumbnails={thumbnails}
          />
        ) : null}
        {view === 'legacy' || view === 'detail' || view === 'expression' ? (
          <CharacterEditor
          character={selectedCharacter}
          disabled={!snapshot}
          imageAssets={imageAssets}
          key={selectedCharacter?.id ?? 'empty'}
          onAddExpression={(name, assetId) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.addExpression(selectedCharacter.id, {
                  name,
                  assetId,
                }),
              `表情“${name.trim()}”已添加。`,
            );
          }}
          onDeleteCharacter={() => {
            if (
              !selectedCharacter ||
              !window.confirm(
                `确认删除角色“${selectedCharacter.name}”？被镜头或对白引用时会阻止删除。`,
              )
            ) {
              return;
            }
            const next = mutate(
              () => characterStore.deleteCharacter(selectedCharacter.id),
              `角色“${selectedCharacter.name}”已删除。`,
            );
            if (next) {
              setSelectedCharacterId(next.characters[0]?.id ?? null);
              onViewChange('list');
            }
          }}
          onRemoveExpression={(expressionId) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.removeExpression(
                  selectedCharacter.id,
                  expressionId,
                ),
              '表情已删除。',
            );
          }}
          onRenameCharacter={(name) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.renameCharacter(
                  selectedCharacter.id,
                  name,
                ),
              '角色名称已更新。',
            );
          }}
          onRenameExpression={(expressionId, name) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.renameExpression(
                  selectedCharacter.id,
                  expressionId,
                  name,
                ),
              '表情名称已更新。',
            );
          }}
          onSetDefaultExpression={(expressionId) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.setDefaultExpression(
                  selectedCharacter.id,
                  expressionId,
                ),
              '默认表情已替换。',
            );
          }}
          onSetExpressionAsset={(expressionId, assetId) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.setExpressionAsset(
                  selectedCharacter.id,
                  expressionId,
                  assetId,
                ),
              '表情图片已更新，原有镜头与时间轴引用保持不变。',
            );
          }}
          onSetDefaultTransform={(scale, flipX) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.setDefaultTransform(
                  selectedCharacter.id,
                  scale,
                  flipX,
                ),
              '默认缩放与翻转已更新。',
            );
          }}
          onSetMouthOpenAsset={(assetId) => {
            if (!selectedCharacter) return;
            mutate(
              () =>
                characterStore.setMouthOpenAsset(
                  selectedCharacter.id,
                  assetId,
                ),
              assetId ? '张嘴图已更新。' : '张嘴图已清除。',
            );
          }}
          onThumbnailError={markThumbnailError}
          presentation={presentation}
          thumbnails={thumbnails}
          view={
            view === 'legacy'
              ? 'full'
              : view === 'expression'
                ? 'expression'
                : 'detail'
          }
          warnings={warnings}
          onBackToDetail={() => onViewChange('detail')}
          onBackToList={() => onViewChange('list')}
          onCloseDrawer={onCloseDrawer}
          onOpenExpressions={() => onViewChange('expression')}
          />
        ) : null}
      </div>
      {visibleStatus ? (
        <output className="character-manager-status">{visibleStatus}</output>
      ) : null}
    </section>
  );
}
