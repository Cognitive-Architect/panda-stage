import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  CharacterService,
  CharacterServiceError,
  countLegacyCharacterImageLayers,
  type CreateCharacterInput,
  type CreateCompositeCharacterInput,
  type CompositeCharacterDefinition,
  type ImageAsset,
  type Project,
} from '../../../domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import { characterStore } from '../../stores/characterStore';
import {
  characterAssemblySessionStore,
  type CharacterAssemblySessionHandle,
  type CharacterCreationSessionHandle,
} from '../../stores/characterAssemblySessionStore';
import {
  thumbnailStateFromResponse,
  type ThumbnailState,
} from '../assets/AssetCard';
import { CharacterEditor } from './CharacterEditor';
import { CharacterList } from './CharacterList';
import {
  isCharacterAssemblyPending,
  isCharacterCreationSnapshot,
} from './characterAssemblyPreview';

export type CharacterWorkspaceView =
  | 'legacy'
  | 'list'
  | 'create'
  | 'detail'
  | 'expression';

export type CharacterManagerPresentation = 'default' | 'landscape';

const CHARACTER_IDLE_STATUS =
  '局部修改会先应用到当前项目；请使用“保存整个项目”写入磁盘。';
const CHARACTER_BINDING_REMINDER_DURATION_MS = 5_500;

export interface CharacterManagerProps {
  snapshot: EditorProjectSnapshot | null;
  view?: CharacterWorkspaceView;
  onViewChange?: (view: CharacterWorkspaceView) => void;
  /** Keep the landscape drawer's active label as the visible identity. */
  hideHeading?: boolean;
  /** Apply visual-first Character presentation without changing its owners. */
  presentation?: CharacterManagerPresentation;
  /** Portal the landscape Create mode selector into its shared drawer header. */
  modeSwitchTarget?: HTMLElement | null;
  /** Keep drawer close owned by ResourceActivityDock while sharing the detail header. */
  onCloseDrawer?: () => void;
}

export function CharacterManager({
  snapshot,
  view = 'legacy',
  onViewChange = () => undefined,
  hideHeading = false,
  presentation = 'default',
  modeSwitchTarget = null,
  onCloseDrawer = () => undefined,
}: CharacterManagerProps): React.JSX.Element {
  const service = useMemo(() => new CharacterService(), []);
  const [selectedCharacterId, setSelectedCharacterId] = useState<
    string | null
  >(() => {
    const activeSession = characterAssemblySessionStore.getSnapshot();
    const resumableCharacterId =
      activeSession &&
      !isCharacterCreationSnapshot(activeSession) &&
      activeSession.projectId === snapshot?.project.id &&
      activeSession.projectRoot === snapshot?.projectRoot &&
      snapshot.project.characters.some(
        (character) => character.id === activeSession.characterId,
      )
        ? activeSession.characterId
        : null;
    return resumableCharacterId ?? snapshot?.project.characters[0]?.id ?? null;
  });
  const [status, setStatus] = useState(CHARACTER_IDLE_STATUS);
  const [bindingReminderCount, setBindingReminderCount] = useState<
    number | null
  >(null);
  const [thumbnails, setThumbnails] = useState<
    Record<string, ThumbnailState>
  >({});
  const assemblySnapshot = useSyncExternalStore(
    characterAssemblySessionStore.subscribe,
    characterAssemblySessionStore.getSnapshot,
    characterAssemblySessionStore.getSnapshot,
  );
  const creationHandleRef = useRef<CharacterCreationSessionHandle | null>(null);
  const ownedSessionIdRef = useRef<number | null>(null);
  const creationBaselineIdsRef = useRef<Set<string> | null>(null);
  const creationStartViewRef = useRef<CharacterWorkspaceView | null>(null);
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
  const editAssemblySnapshot =
    assemblySnapshot &&
    !isCharacterCreationSnapshot(assemblySnapshot) &&
    assemblySnapshot.characterId === selectedCharacter?.id
      ? assemblySnapshot
      : null;
  const assemblyDraft: CompositeCharacterDefinition | null =
    editAssemblySnapshot?.draft ?? null;
  const assemblyPending = Boolean(
    editAssemblySnapshot &&
      project &&
      isCharacterAssemblyPending(project, editAssemblySnapshot),
  );
  const createAssemblySnapshot =
    assemblySnapshot &&
    isCharacterCreationSnapshot(assemblySnapshot) &&
    assemblySnapshot.sessionId === ownedSessionIdRef.current
      ? assemblySnapshot
      : null;
  const warnings =
    project && selectedCharacter
      ? service.dimensionWarnings(project, selectedCharacter.id)
      : [];
  const visibleStatus =
    presentation === 'landscape' && status === CHARACTER_IDLE_STATUS
      ? ''
      : status;

  useEffect(() => {
    if (bindingReminderCount === null) return undefined;
    const timeoutId = window.setTimeout(
      () => setBindingReminderCount(null),
      CHARACTER_BINDING_REMINDER_DURATION_MS,
    );
    return () => window.clearTimeout(timeoutId);
  }, [bindingReminderCount]);

  useEffect(() => {
    setBindingReminderCount(null);
  }, [snapshot?.projectRoot]);

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

  const showBindingReminder = (
    next: Project,
    boundAssetIds: Iterable<string>,
  ): void => {
    const count = countLegacyCharacterImageLayers(next, boundAssetIds);
    setBindingReminderCount(count > 0 ? count : null);
  };

  const createCharacter = (input: CreateCharacterInput): void => {
    const next = mutate(
      () => characterStore.create(input),
      '角色与普通 / 生气表情已创建。',
    );
    if (next) {
      const createdCharacter = next.characters.at(-1);
      if (!createdCharacter) return;
      showBindingReminder(
        next,
        createdCharacter.expressions.map((expression) => expression.assetId),
      );
      setSelectedCharacterId(createdCharacter.id);
      onViewChange('detail');
    }
  };

  const beginCompositeCreation = (
    initialDraft: CreateCompositeCharacterInput,
  ): boolean => {
    const result = characterAssemblySessionStore.beginCreate(initialDraft);
    if (!result.ok) {
      setStatus(result.error.message);
      return false;
    }
    creationHandleRef.current = result.session;
    ownedSessionIdRef.current = result.session.sessionId;
    creationBaselineIdsRef.current = new Set(
      project?.characters.map((character) => character.id) ?? [],
    );
    creationStartViewRef.current = view;
    setStatus('');
    return true;
  };

  const updateCompositeCreation = (
    draft: CreateCompositeCharacterInput,
  ): void => {
    const result = creationHandleRef.current?.setDraft(draft);
    if (!result) {
      setStatus('角色创建草稿已失效，请重新开始。');
      return;
    }
    if (!result.ok) setStatus(result.error.message);
  };

  const commitCompositeCreation = (): void => {
    const result = creationHandleRef.current?.commit();
    if (!result) {
      setStatus('角色创建草稿已失效，请重新开始。');
      return;
    }
    if (result.status === 'rejected' || result.status === 'stale') {
      setStatus(result.error.message);
      return;
    }
    setStatus('');
  };

  const cancelOwnedSession = (): void => {
    if (creationHandleRef.current) {
      creationHandleRef.current.cancel();
      creationHandleRef.current = null;
    } else {
      const current = characterAssemblySessionStore.getSnapshot();
      if (
        current &&
        current.sessionId === ownedSessionIdRef.current
      ) {
        characterAssemblySessionStore
          .getActiveSessionHandle()
          ?.cancel();
      }
    }
    ownedSessionIdRef.current = null;
    creationBaselineIdsRef.current = null;
    creationStartViewRef.current = null;
  };

  const openAssembly = (): boolean => {
    if (!selectedCharacter || selectedCharacter.mode !== 'composite') {
      return false;
    }
    const result = characterAssemblySessionStore.begin(selectedCharacter.id);
    if (!result.ok) {
      setStatus(result.error.message);
      return false;
    }
    ownedSessionIdRef.current = result.session.sessionId;
    setStatus('');
    return true;
  };

  const leaveAssembly = (): boolean => {
    if (!editAssemblySnapshot) return true;
    if (assemblyPending) {
      setStatus('请先应用或还原装配更改。');
      return false;
    }
    const active = characterAssemblySessionStore.getActiveAssemblySessionHandle();
    if (active?.sessionId === editAssemblySnapshot.sessionId) active.cancel();
    ownedSessionIdRef.current = null;
    setStatus('');
    return true;
  };

  const updateAssembly = (
    update: Parameters<CharacterAssemblySessionHandle['updateDraft']>[0],
  ): void => {
    const active = characterAssemblySessionStore.getActiveAssemblySessionHandle();
    if (
      !active ||
      !editAssemblySnapshot ||
      active.sessionId !== editAssemblySnapshot?.sessionId ||
      active.generation !== editAssemblySnapshot.generation
    ) {
      setStatus('角色装配草稿已失效，请重新打开装配。');
      return;
    }
    const result = active.updateDraft(update);
    if (!result.ok) setStatus(result.error.message);
    else setStatus('');
  };

  const requestCloseDrawer = (): void => {
    if (
      assemblyPending &&
      !window.confirm('装配更改尚未应用，关闭将放弃这些更改。继续吗？')
    ) {
      return;
    }
    cancelOwnedSession();
    onCloseDrawer();
  };

  useEffect(() => {
    if (
      !assemblySnapshot ||
      !isCharacterCreationSnapshot(assemblySnapshot)
    ) {
      return;
    }
    if (
      assemblySnapshot.sessionId === ownedSessionIdRef.current &&
      creationStartViewRef.current !== null &&
      creationStartViewRef.current !== view
    ) {
      cancelOwnedSession();
    }
  }, [assemblySnapshot, view]);

  useEffect(() => {
    if (
      !assemblySnapshot ||
      isCharacterCreationSnapshot(assemblySnapshot)
    ) {
      return;
    }
    if (assemblySnapshot.characterId === selectedCharacterId) {
      ownedSessionIdRef.current = assemblySnapshot.sessionId;
    }
    const active = characterAssemblySessionStore.getActiveAssemblySessionHandle();
    if (active && active.sessionId === ownedSessionIdRef.current) {
      // Keep the latest generation for safe cleanup after an Apply.
      ownedSessionIdRef.current = active.sessionId;
    }
  }, [assemblySnapshot, selectedCharacterId]);

  useEffect(() => {
    const baselineIds = creationBaselineIdsRef.current;
    if (!baselineIds) return;
    if (assemblySnapshot && isCharacterCreationSnapshot(assemblySnapshot)) return;
    if (assemblySnapshot?.sessionId === ownedSessionIdRef.current) return;
    const currentSnapshot = editorProjectStore.getSnapshot();
    const currentProject =
      currentSnapshot &&
      snapshot &&
      currentSnapshot.projectRoot === snapshot.projectRoot
        ? currentSnapshot.project
        : null;
    const created = currentProject?.characters.find(
      (character) => !baselineIds.has(character.id),
    );
    creationBaselineIdsRef.current = null;
    creationHandleRef.current = null;
    ownedSessionIdRef.current = null;
    creationStartViewRef.current = null;
    if (created) {
      setSelectedCharacterId(created.id);
      onViewChange('detail');
    }
  }, [assemblySnapshot, onViewChange, snapshot?.projectRoot]);

  const hideLandscapeCreateHeading =
    hideHeading && presentation === 'landscape' && view === 'create';

  return (
    <section
      className="character-manager"
      aria-label={hideLandscapeCreateHeading ? '创建角色' : undefined}
      aria-labelledby={
        hideLandscapeCreateHeading ? undefined : 'character-manager-heading'
      }
      data-character-presentation={presentation}
      data-testid="character-manager"
    >
      {!hideLandscapeCreateHeading ? (
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
            <span>
              {snapshot
                ? `${snapshot.project.characters.length} 个角色`
                : '尚未打开项目'}
            </span>
          </div>
        </div>
      ) : null}
      <div
        className="character-workspace"
        data-project-revision={snapshot?.revision ?? 0}
      >
        {view === 'legacy' ? (
          <CharacterList
            characters={project?.characters ?? []}
            disabled={!snapshot}
            imageAssets={imageAssets}
            mode="legacy"
            compositeDraft={createAssemblySnapshot?.draft ?? null}
            onBeginCompositeCreate={beginCompositeCreation}
            onCommitCompositeCreate={commitCompositeCreation}
            onCancelCompositeCreate={cancelOwnedSession}
            onCompositeDraftChange={updateCompositeCreation}
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
            compositeDraft={createAssemblySnapshot?.draft ?? null}
            modeSwitchTarget={modeSwitchTarget}
            onBack={() => {
              cancelOwnedSession();
              onViewChange('list');
            }}
            onBeginCompositeCreate={beginCompositeCreation}
            onCommitCompositeCreate={commitCompositeCreation}
            onCancelCompositeCreate={cancelOwnedSession}
            onCompositeDraftChange={updateCompositeCreation}
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
            const next = mutate(
              () =>
                characterStore.addExpression(selectedCharacter.id, {
                  name,
                  assetId,
                }),
              `表情“${name.trim()}”已添加。`,
            );
            if (next) showBindingReminder(next, [assetId]);
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
            const next = mutate(
              () =>
                characterStore.setExpressionAsset(
                  selectedCharacter.id,
                  expressionId,
                  assetId,
                ),
              '表情图片已更新，原有镜头与时间轴引用保持不变。',
            );
            if (next) showBindingReminder(next, [assetId]);
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
          assemblyDraft={assemblyDraft}
          onOpenAssembly={openAssembly}
          onLeaveAssembly={leaveAssembly}
          onSetAssemblyBodyAsset={(assetId) =>
            updateAssembly({ bodyAssetId: assetId })
          }
          onSetAssemblyMouthAsset={(assetId) =>
            updateAssembly({ mouthOpenAssetId: assetId })
          }
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
          onBackToList={() => {
            if (leaveAssembly()) onViewChange('list');
          }}
          onCloseDrawer={requestCloseDrawer}
          onOpenExpressions={() => onViewChange('expression')}
          />
        ) : null}
      </div>
      {bindingReminderCount !== null ? (
        <output
          aria-atomic="true"
          aria-live="polite"
          className="character-binding-reminder"
          data-testid="character-binding-reminder"
          role="status"
        >
          ⓘ {bindingReminderCount} 个已有图层仍是普通图片
        </output>
      ) : null}
      {visibleStatus ? (
        <output className="character-manager-status">{visibleStatus}</output>
      ) : null}
    </section>
  );
}
