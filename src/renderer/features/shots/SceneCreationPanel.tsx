import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import {
  SceneCreationError,
  SceneCreationService,
  hasShotNameConflict,
  type Asset,
  type Character,
  type SceneCreationCandidate,
  type SceneCreationResolution,
} from '../../../domain';
import type { ThumbnailState } from '../assets/AssetCard';
import { thumbnailStateFromResponse } from '../assets/AssetCard';
import type { EditorProjectSnapshot, EditorProjectStore } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import type { ShotStore } from '../../stores/shotStore';
import { shotStore } from '../../stores/shotStore';
import {
  EMPTY_SCENE_CREATION_DRAFT,
  commitSceneCreationPreview,
  isSceneCreationPreviewCurrent,
  prepareSceneCreationPreview,
  toSceneCreationCanvasPreview,
  type SceneCreationCanvasPreview,
  type SceneCreationCanvasPreviewStatus,
  type SceneCreationDraft,
  type SceneCreationPreviewPlan,
} from './createSceneFromStructuredInput';
import { createCompositeCharacterThumbnailDataUrl } from './shotThumbnail';
import { DecorativeIcon } from '../../ui/DecorativeIcon';
import { Button, IconButton } from '../../ui/Button';

interface ProjectIdentity {
  projectRoot: string;
  projectId: string;
  projectInstanceId: number | null;
  revision: number;
  projectFingerprint: string;
}

interface SceneInspection {
  rawInput: string;
  identity: ProjectIdentity;
  resolution: SceneCreationResolution;
  selectedBackgroundId: string | null;
  selectedCharacterId: string | null;
}

export interface SceneCreationPanelProps {
  snapshot: EditorProjectSnapshot | null;
  onBack: () => void;
  draft?: SceneCreationDraft;
  onDraftChange?: (draft: SceneCreationDraft) => void;
  onCanvasPreviewChange?: (
    preview: SceneCreationCanvasPreview | null,
  ) => void;
  canvasPreviewStatus?: SceneCreationCanvasPreviewStatus | null;
  previewActive?: boolean;
  onNavigateToAssets?: () => void;
  onNavigateToCharacters?: () => void;
  editorStore?: EditorProjectStore;
  shotStore?: Pick<ShotStore, 'getCurrentShotId' | 'select'>;
  service?: SceneCreationService;
}

function captureIdentity(
  snapshot: EditorProjectSnapshot,
  editorStore: EditorProjectStore,
): ProjectIdentity {
  return {
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.project.id,
    projectInstanceId: editorStore.getProjectInstanceId(),
    revision: snapshot.revision,
    projectFingerprint: JSON.stringify(snapshot.project),
  };
}

function isIdentityCurrent(
  identity: ProjectIdentity,
  editorStore: EditorProjectStore,
): boolean {
  const current = editorStore.getSnapshot();
  return Boolean(
    current &&
      current.projectRoot === identity.projectRoot &&
      current.project.id === identity.projectId &&
      current.revision === identity.revision &&
      editorStore.getProjectInstanceId() === identity.projectInstanceId &&
      JSON.stringify(current.project) === identity.projectFingerprint,
  );
}

function candidateThumbnailKey(
  kind: 'background' | 'character',
  candidate: SceneCreationCandidate<Asset | Character>,
): string {
  return kind === 'background'
    ? candidate.value.id
    : `character:${candidate.value.id}`;
}

function candidateUnavailableReason(
  candidate: SceneCreationCandidate<Asset | Character>,
  kind: 'background' | 'character',
  thumbnails: Readonly<Record<string, ThumbnailState>>,
): string | null {
  if (!candidate.selectable) {
    if (candidate.errorCode === 'BACKGROUND_NOT_USABLE') {
      return '不是可用的背景图片素材';
    }
    if (candidate.errorCode === 'CHARACTER_NOT_ASSEMBLED') {
      return '还不是已组装的角色';
    }
    return '角色引用的素材不可用';
  }
  const thumbnail = thumbnails[candidateThumbnailKey(kind, candidate)];
  if (thumbnail?.status === 'missing') {
    return kind === 'background' ? '背景缩略图不可用' : '角色预览不可用';
  }
  if (thumbnail?.status !== 'ready') {
    return kind === 'background' ? '正在读取缩略图' : '正在合成角色预览';
  }
  return null;
}

function thumbnailLabel(thumbnail: ThumbnailState | undefined): string {
  if (!thumbnail || thumbnail.status === 'loading') return '读取中';
  if (thumbnail.status === 'missing') {
    return thumbnail.reason === 'source' ? '源文件不可用' : '缩略图不可用';
  }
  return '';
}

function sceneErrorMessage(error: unknown): string {
  if (error instanceof SceneCreationError) {
    if (error.code === 'MISSING_FIELD' && error.field) {
      return `缺少“${error.field}”字段，请补充一行“${error.field}：内容”。`;
    }
    if (error.code === 'EMPTY_FIELD' && error.field) {
      return error.lineNumber
        ? `第 ${error.lineNumber} 行“${error.field}”为空，请补充名称。`
        : `“${error.field}”字段为空，请补充名称。`;
    }
    if (error.lineNumber) return `第 ${error.lineNumber} 行：${error.message}`;
  }
  return error instanceof Error ? error.message : '无法检查这份输入。';
}

function makeCandidateLabel(
  name: string,
  index: number,
  count: number,
): string {
  if (count === 1) return name;
  return `候选 ${index + 1}：${name}`;
}

export function CandidateOptions<T extends Asset | Character>({
  candidates,
  kind,
  onSelect,
  compact = false,
  onReplace,
  selectedId,
  stale,
  thumbnails,
}: {
  candidates: SceneCreationCandidate<T>[];
  kind: 'background' | 'character';
  onSelect: (id: string) => void;
  compact?: boolean;
  onReplace?: () => void;
  selectedId: string | null;
  stale: boolean;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
}): React.JSX.Element | null {
  if (candidates.length === 0) return null;
  const selectedCandidate = candidates.length === 1 &&
    candidates[0]!.value.id === selectedId
    ? candidates[0]!
    : null;
  if (compact && selectedCandidate) {
    const value = selectedCandidate.value;
    const key = candidateThumbnailKey(kind, selectedCandidate);
    const thumbnail = thumbnails[key];
    const unavailable = candidateUnavailableReason(
      selectedCandidate,
      kind,
      thumbnails,
    );
    const matched = !stale && selectedCandidate.selectable && unavailable === null;
    return (
      <div
        className="scene-creation-match-row"
        data-candidate-id={value.id}
        data-candidate-kind={kind}
        data-candidate-matched={String(matched)}
        data-candidate-selectable={String(selectedCandidate.selectable)}
        data-testid={`scene-creation-${kind}-match`}
      >
        <span className="scene-creation-match-thumbnail">
          {thumbnail?.status === 'ready' ? (
            <img
              alt=""
              src={thumbnail.dataUrl}
            />
          ) : (
            <span aria-hidden="true">{thumbnailLabel(thumbnail) || '…'}</span>
          )}
        </span>
        <span
          aria-hidden={matched ? undefined : 'true'}
          aria-label={matched ? `${kind === 'background' ? '背景' : '角色'}已匹配` : undefined}
          className="scene-creation-match-indicator"
          data-matched={String(matched)}
          role={matched ? 'img' : undefined}
        >
          {matched ? <DecorativeIcon icon={Check} size={17} /> : null}
        </span>
        <span className="scene-creation-match-name" title={value.name}>{value.name}</span>
        {unavailable ? (
          <span className="scene-creation-match-status">{unavailable}</span>
        ) : null}
        {onReplace ? (
          <IconButton
            aria-label={`${kind === 'background' ? '更换背景' : '更换角色'}：${value.name}`}
            className="scene-creation-change-match"
            disabled={stale}
            icon={<DecorativeIcon icon={RefreshCw} size={19} />}
            onClick={onReplace}
            title="更换"
            type="button"
            variant="secondary"
          />
        ) : null}
      </div>
    );
  }
  return (
    <div className="scene-creation-candidate-list">
      {candidates.map((candidate, index) => {
        const value = candidate.value;
        const thumbnail = thumbnails[candidateThumbnailKey(kind, candidate)];
        const unavailable = candidateUnavailableReason(
          candidate,
          kind,
          thumbnails,
        );
        const selected = selectedId === value.id;
        const accessibleLabel = makeCandidateLabel(
          value.name,
          index,
          candidates.length,
        );
        return (
          <button
            aria-pressed={selected}
            className={`scene-creation-candidate${selected ? ' scene-creation-candidate-selected' : ''}`}
            data-candidate-id={value.id}
            data-candidate-kind={kind}
            data-testid={`scene-creation-${kind}-candidate`}
            disabled={Boolean(unavailable) || stale}
            key={value.id}
            onClick={() => onSelect(value.id)}
            type="button"
          >
            <span className="scene-creation-candidate-thumbnails">
              {thumbnail?.status === 'ready' ? (
                <img
                  alt=""
                  src={thumbnail.dataUrl}
                />
              ) : (
                <span className="scene-creation-candidate-thumbnail-fallback">
                  {thumbnailLabel(thumbnail) || '读取中'}
                </span>
              )}
            </span>
            <span className="scene-creation-candidate-name">{accessibleLabel}</span>
            <span className="scene-creation-candidate-kind">
              {kind === 'background' ? '背景' : '角色'}{selected ? ' · 已选择' : ''}
            </span>
            {unavailable ? (
              <span className="scene-creation-candidate-reason">{unavailable}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function candidateById<T extends Asset | Character>(
  candidates: readonly SceneCreationCandidate<T>[],
  id: string | null,
): SceneCreationCandidate<T> | null {
  if (!id) return null;
  return candidates.find((candidate) => candidate.value.id === id) ?? null;
}

function replaceShotName(rawInput: string, name: string): string {
  const lines = rawInput.replace(/\r\n?/gu, '\n').split('\n');
  const lineIndex = lines.findIndex((line) => {
    const asciiColon = line.indexOf(':');
    const fullWidthColon = line.indexOf('：');
    const separator = asciiColon < 0
      ? fullWidthColon
      : fullWidthColon < 0
        ? asciiColon
        : Math.min(asciiColon, fullWidthColon);
    return separator >= 0 && line.slice(0, separator).trim() === '镜头';
  });
  if (lineIndex < 0) return rawInput;
  const line = lines[lineIndex]!;
  const asciiColon = line.indexOf(':');
  const fullWidthColon = line.indexOf('：');
  const separator = asciiColon < 0
    ? fullWidthColon
    : fullWidthColon < 0
      ? asciiColon
      : Math.min(asciiColon, fullWidthColon);
  const valuePrefix = line.slice(separator + 1).match(/^\s*/u)?.[0] ?? '';
  lines[lineIndex] = `${line.slice(0, separator + 1)}${valuePrefix}${name}`;
  return lines.join('\n');
}

export function SceneCreationPanel({
  snapshot,
  onBack,
  draft,
  onDraftChange,
  onCanvasPreviewChange,
  canvasPreviewStatus = null,
  previewActive = true,
  onNavigateToAssets,
  onNavigateToCharacters,
  editorStore = editorProjectStore,
  shotStore: activeShotStore = shotStore,
  service,
}: SceneCreationPanelProps): React.JSX.Element {
  const [localDraft, setLocalDraft] = useState(EMPTY_SCENE_CREATION_DRAFT);
  const currentDraft = draft ?? localDraft;
  const draftRef = useRef(currentDraft);
  draftRef.current = currentDraft;
  const updateDraft = useCallback(
    (next: SceneCreationDraft): void => {
      if (onDraftChange) onDraftChange(next);
      else setLocalDraft(next);
    },
    [onDraftChange],
  );
  const clearPreview = useCallback((): void => {
    setPreviewPlan(null);
    onCanvasPreviewChange?.(null);
  }, [onCanvasPreviewChange]);
  const activeService = useMemo(
    () => service ?? new SceneCreationService(),
    [service],
  );
  const [inspection, setInspection] = useState<SceneInspection | null>(null);
  const [previewPlan, setPreviewPlan] =
    useState<SceneCreationPreviewPlan | null>(null);
  const [thumbnailStates, setThumbnailStates] = useState<
    Record<string, ThumbnailState>
  >({});
  const [parseError, setParseError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [pickerKind, setPickerKind] = useState<
    'background' | 'character' | null
  >(null);
  const [committing, setCommitting] = useState(false);
  const commitInProgress = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const currentProject = snapshot?.project ?? null;
  const rawInput = currentDraft.rawInput;
  const availableBackgroundCandidates = useMemo(
    () =>
      currentProject
        ? activeService.listBackgroundCandidates(currentProject)
        : [],
    [activeService, currentProject],
  );
  const availableCharacterCandidates = useMemo(
    () =>
      currentProject
        ? activeService.listCharacterCandidates(currentProject)
        : [],
    [activeService, currentProject],
  );
  const inspectionMatchesInput = inspection?.rawInput === rawInput;
  const namedBackgroundCandidates =
    inspectionMatchesInput && inspection
      ? inspection.resolution.backgroundCandidates
      : [];
  const namedCharacterCandidates =
    inspectionMatchesInput && inspection
      ? inspection.resolution.characterCandidates
      : [];
  const selectedBackgroundCandidate = candidateById(
    availableBackgroundCandidates,
    inspectionMatchesInput ? inspection?.selectedBackgroundId ?? null : null,
  );
  const selectedCharacterCandidate = candidateById(
    availableCharacterCandidates,
    inspectionMatchesInput ? inspection?.selectedCharacterId ?? null : null,
  );
  const visibleBackgroundCandidates = useMemo(() => {
    const candidates = new Map<string, SceneCreationCandidate<Asset>>();
    namedBackgroundCandidates.forEach((candidate) =>
      candidates.set(candidate.value.id, candidate),
    );
    if (selectedBackgroundCandidate) {
      candidates.set(selectedBackgroundCandidate.value.id, selectedBackgroundCandidate);
    }
    if (pickerKind === 'background') {
      availableBackgroundCandidates
        .filter((candidate) => candidate.selectable)
        .forEach((candidate) => candidates.set(candidate.value.id, candidate));
    }
    return [...candidates.values()];
  }, [
    availableBackgroundCandidates,
    namedBackgroundCandidates,
    pickerKind,
    selectedBackgroundCandidate,
  ]);
  const visibleCharacterCandidates = useMemo(() => {
    const candidates = new Map<string, SceneCreationCandidate<Character>>();
    namedCharacterCandidates.forEach((candidate) =>
      candidates.set(candidate.value.id, candidate),
    );
    if (selectedCharacterCandidate) {
      candidates.set(selectedCharacterCandidate.value.id, selectedCharacterCandidate);
    }
    if (pickerKind === 'character') {
      availableCharacterCandidates
        .filter((candidate) => candidate.selectable)
        .forEach((candidate) => candidates.set(candidate.value.id, candidate));
    }
    return [...candidates.values()];
  }, [
    availableCharacterCandidates,
    namedCharacterCandidates,
    pickerKind,
    selectedCharacterCandidate,
  ]);
  const backgroundCandidateKey = visibleBackgroundCandidates
    .map((candidate) => candidate.value.id + ':' + (
      candidate.value.kind === 'image' ? candidate.value.sha256 ?? '' : ''
    ))
    .join('|');
  const characterCandidateKey = visibleCharacterCandidates
    .map((candidate) => candidate.value.id + ':' + candidate.selectable)
    .join('|');
  const inspectionStale = Boolean(
    inspection && !isIdentityCurrent(inspection.identity, editorStore),
  );
  const previewStale = Boolean(
    previewPlan && !isSceneCreationPreviewCurrent(previewPlan, editorStore),
  );
  const stale = inspectionStale || previewStale;
  const shotNameConflict = Boolean(
    inspectionMatchesInput &&
      inspection &&
      snapshot &&
      hasShotNameConflict(
        snapshot.project.shots,
        inspection.resolution.input.shotName,
      ),
  );
  const suggestedShotName = useMemo(() => {
    if (!shotNameConflict || !snapshot || !inspection) return null;
    try {
      return activeService.suggestUniqueShotName(
        snapshot.project,
        inspection.resolution.input.shotName,
      );
    } catch {
      return null;
    }
  }, [activeService, inspection, shotNameConflict, snapshot]);

  const runInspection = useCallback((): void => {
    if (!snapshot) {
      setInspection(null);
      clearPreview();
      setParseError('请先打开项目。');
      return;
    }
    if (!rawInput.trim()) {
      setInspection(null);
      clearPreview();
      setParseError('');
      setErrorMessage('');
      return;
    }
    const latestDraft = draftRef.current;
    const identity = captureIdentity(snapshot, editorStore);
    try {
      const resolution = activeService.resolve(snapshot.project, rawInput);
      const allBackgrounds = activeService.listBackgroundCandidates(snapshot.project);
      const allCharacters = activeService.listCharacterCandidates(snapshot.project);
      const explicitBackground = candidateById(
        allBackgrounds,
        latestDraft.backgroundAssetId,
      );
      const explicitCharacter = candidateById(
        allCharacters,
        latestDraft.characterId,
      );
      const legalNamedBackgrounds =
        resolution.backgroundCandidates.filter((candidate) => candidate.selectable);
      const legalNamedCharacters =
        resolution.characterCandidates.filter((candidate) => candidate.selectable);
      const selectedBackgroundId = explicitBackground?.selectable
        ? explicitBackground.value.id
        : legalNamedBackgrounds.length === 1
          ? legalNamedBackgrounds[0]!.value.id
          : null;
      const selectedCharacterId = explicitCharacter?.selectable
        ? explicitCharacter.value.id
        : legalNamedCharacters.length === 1
          ? legalNamedCharacters[0]!.value.id
          : null;
      if (!isIdentityCurrent(identity, editorStore)) return;
      if (
        (latestDraft.backgroundAssetId && !explicitBackground?.selectable) ||
        (latestDraft.characterId && !explicitCharacter?.selectable)
      ) {
        updateDraft({
          ...latestDraft,
          backgroundAssetId: explicitBackground?.selectable
            ? latestDraft.backgroundAssetId
            : null,
          characterId: explicitCharacter?.selectable
            ? latestDraft.characterId
            : null,
        });
      }
      setInspection({
        rawInput,
        identity,
        resolution,
        selectedBackgroundId,
        selectedCharacterId,
      });
      clearPreview();
      setParseError('');
      setErrorMessage('');
    } catch (error) {
      setInspection(null);
      clearPreview();
      setParseError(sceneErrorMessage(error));
      setErrorMessage('');
    }
  }, [
    activeService,
    clearPreview,
    editorStore,
    rawInput,
    snapshot,
    updateDraft,
  ]);

  useEffect(() => {
    if (!snapshot || !rawInput.trim()) {
      setInspection(null);
      clearPreview();
      setParseError('');
      return undefined;
    }
    const timeout = window.setTimeout(runInspection, 380);
    return () => window.clearTimeout(timeout);
  }, [
    rawInput,
    runInspection,
    clearPreview,
    snapshot?.project.id,
    snapshot?.projectRoot,
    snapshot?.revision,
  ]);

  useEffect(() => {
    let active = true;
    const backgroundEntries = visibleBackgroundCandidates.map((candidate) => [
      candidateThumbnailKey('background', candidate),
      { status: 'loading' as const },
    ] as const);
    const characterEntries = visibleCharacterCandidates.map((candidate) => [
      candidateThumbnailKey('character', candidate),
      { status: 'loading' as const },
    ] as const);
    setThumbnailStates(Object.fromEntries([...backgroundEntries, ...characterEntries]));
    if (!snapshot?.projectRoot || !currentProject) {
      return () => {
        active = false;
      };
    }

    for (const candidate of visibleBackgroundCandidates) {
      const key = candidateThumbnailKey('background', candidate);
      const asset = candidate.value;
      if (!candidate.selectable || asset.kind !== 'image') {
        setThumbnailStates((current) => ({
          ...current,
          [key]: { status: 'missing', reason: 'error', message: '不是可用的背景图片素材' },
        }));
        continue;
      }
      void window.pandaStage.assets
        .readThumbnail({
          projectRoot: snapshot.projectRoot,
          assetId: asset.id,
          sha256: asset.sha256,
        })
        .then((response) => {
          if (active) {
            setThumbnailStates((current) => ({
              ...current,
              [key]: thumbnailStateFromResponse(response),
            }));
          }
        })
        .catch((error: unknown) => {
          if (!active) return;
          setThumbnailStates((current) => ({
            ...current,
            [key]: {
              status: 'missing',
              reason: 'error',
              message: error instanceof Error ? error.message : undefined,
            },
          }));
        });
    }
    for (const candidate of visibleCharacterCandidates) {
      const key = candidateThumbnailKey('character', candidate);
      if (!candidate.selectable) {
        setThumbnailStates((current) => ({
          ...current,
          [key]: {
            status: 'missing',
            reason: 'error',
            message: candidate.errorCode,
          },
        }));
        continue;
      }
      void createCompositeCharacterThumbnailDataUrl({
        projectRoot: snapshot.projectRoot,
        project: currentProject,
        character: candidate.value,
      })
        .then((dataUrl) => {
          if (active) {
            setThumbnailStates((current) => ({
              ...current,
              [key]: { status: 'ready', dataUrl },
            }));
          }
        })
        .catch((error: unknown) => {
          if (!active) return;
          setThumbnailStates((current) => ({
            ...current,
            [key]: {
              status: 'missing',
              reason: 'error',
              message: error instanceof Error ? error.message : undefined,
            },
          }));
        });
    }
    return () => {
      active = false;
    };
  }, [
    backgroundCandidateKey,
    characterCandidateKey,
    currentProject,
    snapshot?.projectRoot,
    visibleBackgroundCandidates,
    visibleCharacterCandidates,
  ]);

  const inspectInput = (): void => runInspection();

  const confirmScene = (): void => {
    const plan = previewPlan;
    if (
      !plan ||
      !previewActive ||
      canvasPreviewStatus !== 'ready' ||
      stale ||
      commitInProgress.current
    ) return;
    commitInProgress.current = true;
    setCommitting(true);
    try {
      commitSceneCreationPreview(plan, {
        editorStore,
        shotStore: activeShotStore,
        service: activeService,
      });
      clearPreview();
      setInspection(null);
      updateDraft(EMPTY_SCENE_CREATION_DRAFT);
      onBack();
    } catch (error) {
      setErrorMessage(sceneErrorMessage(error));
      if (error instanceof Error && 'code' in error && error.code === 'PROJECT_CHANGED') {
        clearPreview();
        setInspection(null);
      }
    } finally {
      commitInProgress.current = false;
      setCommitting(false);
    }
  };

  const selectBackground = (assetId: string): void => {
    const candidate = candidateById(availableBackgroundCandidates, assetId);
    if (!candidate?.selectable) return;
    updateDraft({ ...currentDraft, backgroundAssetId: assetId });
    setInspection((current) =>
      current ? { ...current, selectedBackgroundId: assetId } : current,
    );
    clearPreview();
    setErrorMessage('');
    setPickerKind(null);
  };

  const selectCharacter = (characterId: string): void => {
    const candidate = candidateById(availableCharacterCandidates, characterId);
    if (!candidate?.selectable) return;
    updateDraft({ ...currentDraft, characterId });
    setInspection((current) =>
      current ? { ...current, selectedCharacterId: characterId } : current,
    );
    clearPreview();
    setErrorMessage('');
    setPickerKind(null);
  };

  const updateRawInput = (nextInput: string): void => {
    updateDraft({
      rawInput: nextInput,
      backgroundAssetId: null,
      characterId: null,
    });
    setInspection(null);
    clearPreview();
    setParseError('');
    setErrorMessage('');
    setPickerKind(null);
  };

  const focusShotName = (): void => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const lines = rawInput.replace(/\r\n?/gu, '\n').split('\n');
    let offset = 0;
    for (const line of lines) {
      const asciiColon = line.indexOf(':');
      const fullWidthColon = line.indexOf('：');
      const separator = asciiColon < 0
        ? fullWidthColon
        : fullWidthColon < 0
          ? asciiColon
          : Math.min(asciiColon, fullWidthColon);
      if (separator >= 0 && line.slice(0, separator).trim() === '镜头') {
        input.setSelectionRange(offset + separator + 1, offset + line.length);
        return;
      }
      offset += line.length + 1;
    }
  };

  const applySuggestedShotName = (): void => {
    if (!suggestedShotName) return;
    updateRawInput(replaceShotName(rawInput, suggestedShotName));
  };

  const namedBackgroundMatches = namedBackgroundCandidates.filter(
    (candidate) => candidate.selectable,
  );
  const namedCharacterMatches = namedCharacterCandidates.filter(
    (candidate) => candidate.selectable,
  );
  const backgroundMissing =
    inspectionMatchesInput &&
    !selectedBackgroundCandidate &&
    namedBackgroundCandidates.length === 0;
  const characterMissing =
    inspectionMatchesInput &&
    !selectedCharacterCandidate &&
    namedCharacterCandidates.length === 0;
  const backgroundUnavailable =
    inspectionMatchesInput &&
    !selectedBackgroundCandidate &&
    namedBackgroundCandidates.length > 0 &&
    namedBackgroundMatches.length === 0;
  const characterUnavailable =
    inspectionMatchesInput &&
    !selectedCharacterCandidate &&
    namedCharacterCandidates.length > 0 &&
    namedCharacterMatches.length === 0;
  const backgroundCanPreview = Boolean(
    selectedBackgroundCandidate &&
      !candidateUnavailableReason(
        selectedBackgroundCandidate,
        'background',
        thumbnailStates,
      ),
  );
  const characterCanPreview = Boolean(
    selectedCharacterCandidate &&
      !candidateUnavailableReason(
        selectedCharacterCandidate,
        'character',
        thumbnailStates,
      ),
  );
  const pickerBackgroundCandidates = availableBackgroundCandidates.filter(
    (candidate) => candidate.selectable,
  );
  const pickerCharacterCandidates = availableCharacterCandidates.filter(
    (candidate) => candidate.selectable,
  );

  const previewCanBePrepared = Boolean(
    previewActive &&
      inspection &&
      inspectionMatchesInput &&
      snapshot &&
      !stale &&
      !shotNameConflict &&
      pickerKind === null &&
      selectedBackgroundCandidate?.selectable &&
      selectedCharacterCandidate?.selectable &&
      backgroundCanPreview &&
      characterCanPreview,
  );

  useEffect(() => {
    if (
      !previewCanBePrepared ||
      !inspection ||
      !snapshot ||
      !selectedBackgroundCandidate ||
      !selectedCharacterCandidate
    ) {
      clearPreview();
      return;
    }
    try {
      const plan = prepareSceneCreationPreview(
        inspection.rawInput,
        {
          backgroundAssetId: selectedBackgroundCandidate.value.id,
          characterId: selectedCharacterCandidate.value.id,
        },
        { editorStore, shotStore: activeShotStore, service: activeService },
      );
      if (!isSceneCreationPreviewCurrent(plan, editorStore)) return;
      setPreviewPlan(plan);
      setErrorMessage('');
      onCanvasPreviewChange?.(toSceneCreationCanvasPreview(plan));
    } catch (error) {
      clearPreview();
      setErrorMessage(sceneErrorMessage(error));
    }
  }, [
    activeService,
    activeShotStore,
    backgroundCanPreview,
    characterCanPreview,
    clearPreview,
    editorStore,
    inspection,
    onCanvasPreviewChange,
    previewCanBePrepared,
    selectedBackgroundCandidate,
    selectedCharacterCandidate,
    snapshot,
  ]);

  useEffect(
    () => () => onCanvasPreviewChange?.(null),
    [onCanvasPreviewChange],
  );

  const canvasPreviewMessage = !previewActive
    ? ''
    : stale
      ? '项目变更，正在刷新匹配'
      : !rawInput.trim()
        ? '填写镜头、背景和出场后，主画布会显示预览'
        : parseError
          ? '修正格式后，主画布会显示预览'
          : shotNameConflict
            ? '处理镜头重名后可以创建'
            : !inspectionMatchesInput
              ? '正在匹配素材'
              : pickerKind !== null || !selectedBackgroundCandidate || !selectedCharacterCandidate
                ? '请选择背景和角色后显示预览'
                : canvasPreviewStatus === 'ready'
                  ? '主画布预览已就绪'
                  : canvasPreviewStatus === 'unavailable'
                    ? '所选素材无法在画布显示，请更换或检查素材'
                    : '正在主画布准备预览';

  const canCreateScene = Boolean(
    previewPlan &&
      previewActive &&
      !stale &&
      !shotNameConflict &&
      canvasPreviewStatus === 'ready',
  );

  return (
    <section
      aria-label="自动布景"
      className="scene-creation-panel"
      data-testid="scene-creation-panel"
    >
      <div className="scene-creation-content">
      <div className="scene-creation-input-heading">
        <label htmlFor="scene-creation-input">粘贴布景信息</label>
      </div>
      <div className="scene-creation-input-label">
        <textarea
          aria-label="粘贴布景信息"
          data-testid="scene-creation-input"
          disabled={!snapshot}
          id="scene-creation-input"
          maxLength={2_000}
          ref={inputRef}
          rows={5}
          onChange={(event) => updateRawInput(event.target.value)}
          placeholder={'格式示例\n镜头：花园相遇\n背景：花园\n出场：张三'}
          spellCheck={false}
          value={rawInput}
        />
      </div>
      {parseError ? (
        <p
          className="scene-creation-error"
          data-testid="scene-creation-parse-error"
          role="alert"
        >
          {parseError}
        </p>
      ) : null}
      {shotNameConflict && inspection ? (
        <div
          className="scene-creation-name-conflict"
          data-testid="scene-creation-name-conflict"
          role="alert"
        >
          <span>『{inspection.resolution.input.shotName}』已经存在</span>
          {suggestedShotName ? (
            <button
              data-testid="scene-creation-use-suggested-name"
              onClick={applySuggestedShotName}
              type="button"
            >
              使用『{suggestedShotName}』
            </button>
          ) : null}
          <button
            data-testid="scene-creation-edit-name"
            onClick={focusShotName}
            type="button"
          >
            自己修改
          </button>
        </div>
      ) : null}

      <div className="scene-creation-actions">
        <Button
          data-testid="scene-creation-inspect"
          disabled={!snapshot || !rawInput.trim()}
          onClick={inspectInput}
          variant="secondary"
        >
          重新匹配
        </Button>
      </div>

      {stale ? (
        <div className="scene-creation-stale" role="alert">
          <span>工程已变化，正在刷新匹配结果。</span>
          <button onClick={inspectInput} type="button">
            重新匹配
          </button>
        </div>
      ) : null}
      {errorMessage ? (
        <p className="scene-creation-error" data-testid="scene-creation-error" role="alert">
          {errorMessage}
        </p>
      ) : null}

      {inspectionMatchesInput && inspection && snapshot && !stale ? (
        <div className="scene-creation-candidates" data-testid="scene-creation-candidates">
          <section aria-label="背景素材" className="scene-creation-resource">
            {selectedBackgroundCandidate ? (
              <CandidateOptions
                candidates={[selectedBackgroundCandidate]}
                compact
                kind="background"
                onReplace={() => {
                  clearPreview();
                  setPickerKind('background');
                }}
                onSelect={selectBackground}
                selectedId={inspection.selectedBackgroundId}
                stale={stale}
                thumbnails={thumbnailStates}
              />
            ) : backgroundMissing ? (
              <div className="scene-creation-resource-error" role="alert">
                <span>没找到『{inspection.resolution.input.backgroundName}』背景</span>
                <div className="scene-creation-resource-actions">
                  <button onClick={() => setPickerKind('background')} type="button">
                    选择已有背景
                  </button>
                  {onNavigateToAssets ? (
                    <button
                      onClick={() => {
                        clearPreview();
                        onNavigateToAssets();
                      }}
                      type="button"
                    >
                      导入背景
                    </button>
                  ) : null}
                </div>
              </div>
            ) : backgroundUnavailable ? (
              <div className="scene-creation-resource-error" role="alert">
                <span>『{inspection.resolution.input.backgroundName}』背景当前不可用</span>
                <button onClick={() => setPickerKind('background')} type="button">
                  选择已有背景
                </button>
              </div>
            ) : namedBackgroundMatches.length > 1 ? (
              <div className="scene-creation-resource-choice">
                <p>有多个同名背景，请选择要使用的素材。</p>
                <CandidateOptions
                  candidates={namedBackgroundMatches}
                  kind="background"
                  onSelect={selectBackground}
                  selectedId={inspection.selectedBackgroundId}
                  stale={stale}
                  thumbnails={thumbnailStates}
                />
              </div>
            ) : null}
            {pickerKind === 'background' ? (
              <div className="scene-creation-resource-picker" data-testid="scene-creation-background-picker">
                <div className="scene-creation-picker-heading">
                  <strong>选择背景</strong>
                  <button onClick={() => setPickerKind(null)} type="button">
                    取消
                  </button>
                </div>
                {pickerBackgroundCandidates.length > 0 ? (
                  <CandidateOptions
                    candidates={pickerBackgroundCandidates}
                    kind="background"
                    onSelect={selectBackground}
                    selectedId={inspection.selectedBackgroundId}
                    stale={stale}
                    thumbnails={thumbnailStates}
                  />
                ) : (
                  <p role="status">项目里没有可用的背景图片素材。</p>
                )}
              </div>
            ) : null}
          </section>

          <section aria-label="出场角色" className="scene-creation-resource">
            {selectedCharacterCandidate ? (
              <CandidateOptions
                candidates={[selectedCharacterCandidate]}
                compact
                kind="character"
                onReplace={() => {
                  clearPreview();
                  setPickerKind('character');
                }}
                onSelect={selectCharacter}
                selectedId={inspection.selectedCharacterId}
                stale={stale}
                thumbnails={thumbnailStates}
              />
            ) : characterMissing ? (
              <div className="scene-creation-resource-error" role="alert">
                <span>没找到『{inspection.resolution.input.characterName}』这个角色</span>
                <div className="scene-creation-resource-actions">
                  <button onClick={() => setPickerKind('character')} type="button">
                    选择其他角色
                  </button>
                  {onNavigateToCharacters ? (
                    <button
                      onClick={() => {
                        clearPreview();
                        onNavigateToCharacters();
                      }}
                      type="button"
                    >
                      去角色库
                    </button>
                  ) : null}
                </div>
              </div>
            ) : characterUnavailable ? (
              <div className="scene-creation-resource-error" role="alert">
                <span>『{inspection.resolution.input.characterName}』不是可用的已组装角色</span>
                <div className="scene-creation-resource-actions">
                  <button onClick={() => setPickerKind('character')} type="button">
                    选择其他角色
                  </button>
                  {onNavigateToCharacters ? (
                    <button
                      onClick={() => {
                        clearPreview();
                        onNavigateToCharacters();
                      }}
                      type="button"
                    >
                      去角色库
                    </button>
                  ) : null}
                </div>
              </div>
            ) : namedCharacterMatches.length > 1 ? (
              <div className="scene-creation-resource-choice">
                <p>有多个同名角色，请选择要使用的角色。</p>
                <CandidateOptions
                  candidates={namedCharacterMatches}
                  kind="character"
                  onSelect={selectCharacter}
                  selectedId={inspection.selectedCharacterId}
                  stale={stale}
                  thumbnails={thumbnailStates}
                />
              </div>
            ) : null}
            {pickerKind === 'character' ? (
              <div className="scene-creation-resource-picker" data-testid="scene-creation-character-picker">
                <div className="scene-creation-picker-heading">
                  <strong>选择角色</strong>
                  <button onClick={() => setPickerKind(null)} type="button">
                    取消
                  </button>
                </div>
                {pickerCharacterCandidates.length > 0 ? (
                  <CandidateOptions
                    candidates={pickerCharacterCandidates}
                    kind="character"
                    onSelect={selectCharacter}
                    selectedId={inspection.selectedCharacterId}
                    stale={stale}
                    thumbnails={thumbnailStates}
                  />
                ) : (
                  <p role="status">项目里没有可用的已组装角色。</p>
                )}
              </div>
            ) : null}
          </section>

        </div>
      ) : null}
      </div>
      <div className="scene-creation-footer">
        <span
          aria-live="polite"
          className="scene-creation-preview-status"
          data-testid="scene-creation-preview-status"
          role="status"
        >
          {canvasPreviewMessage}
        </span>
        <button
          className="scene-creation-confirm"
          data-testid="scene-creation-confirm"
          disabled={!canCreateScene || committing}
          onClick={confirmScene}
          type="button"
        >
          创建镜头
        </button>
      </div>
    </section>
  );
}
