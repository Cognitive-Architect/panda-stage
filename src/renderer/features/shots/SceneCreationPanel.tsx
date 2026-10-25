import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SceneCreationError,
  SceneCreationService,
  hasShotNameConflict,
  type Asset,
  type Character,
  type Project,
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
  commitSceneCreationPreview,
  isSceneCreationPreviewCurrent,
  prepareSceneCreationPreview,
  type SceneCreationPreviewPlan,
} from './createSceneFromStructuredInput';
import { useShotThumbnail } from './ShotThumbnailView';

export const EXTERNAL_SCENE_ORGANIZATION_PROMPT = [
  '请把我提供的场景意图整理成严格三行，只返回这三行，不要补充对白、解释或其他字段。',
  '镜头：简短的镜头名称',
  '背景：项目中已有的背景素材名称',
  '出场：项目中已有的已组装角色名称',
].join('\n');

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

function candidateAssets(
  project: Project | null,
  resolution: SceneCreationResolution | null,
): Asset[] {
  if (!project || !resolution) return [];
  const assetIds = new Set<string>();
  for (const candidate of resolution.backgroundCandidates) {
    if (candidate.value.kind === 'image') assetIds.add(candidate.value.id);
  }
  for (const candidate of resolution.characterCandidates) {
    const character = candidate.value;
    if (character.mode !== 'composite') continue;
    assetIds.add(character.bodyAssetId);
    if (character.head) assetIds.add(character.head.assetId);
    const expression = character.expressions.find(
      (item) => item.id === character.defaultExpressionId,
    );
    if (expression) assetIds.add(expression.assetId);
  }
  return [...assetIds]
    .map((assetId) => project.assets.find((asset) => asset.id === assetId))
    .filter((asset): asset is Asset => Boolean(asset));
}

function candidateImageAssets(
  project: Project,
  candidate: SceneCreationCandidate<Asset | Character>,
): Asset[] {
  if ('kind' in candidate.value) {
    return candidate.value.kind === 'image' ? [candidate.value] : [];
  }
  const character = candidate.value;
  if (character.mode !== 'composite') return [];
  const expression = character.expressions.find(
    (item) => item.id === character.defaultExpressionId,
  );
  return [character.bodyAssetId, character.head?.assetId, expression?.assetId]
    .filter((assetId): assetId is string => Boolean(assetId))
    .map((assetId) => project.assets.find((asset) => asset.id === assetId))
    .filter((asset): asset is Asset => asset?.kind === 'image');
}

function candidateUnavailableReason(
  candidate: SceneCreationCandidate<Asset | Character>,
  imageAssets: Asset[],
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
  const failed = imageAssets
    .map((asset) => thumbnails[asset.id])
    .find((thumbnail) => thumbnail?.status === 'missing');
  if (failed?.status === 'missing') {
    return failed.reason === 'source' ? '素材源文件不可用' : '缩略图不可用';
  }
  if (imageAssets.length === 0) return '没有可预览的图片素材';
  if (imageAssets.some((asset) => thumbnails[asset.id]?.status !== 'ready')) {
    return '正在读取缩略图';
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
  if (error instanceof SceneCreationError && error.lineNumber) {
    return `第 ${error.lineNumber} 行：${error.message}`;
  }
  return error instanceof Error ? error.message : '无法检查这份输入。';
}

function makeCandidateLabel(
  kind: 'background' | 'character',
  name: string,
  index: number,
  count: number,
): string {
  if (count === 1) return kind === 'background' ? `背景 ${name}` : `角色 ${name}`;
  return kind === 'background'
    ? `背景候选 ${index + 1}：${name}`
    : `角色候选 ${index + 1}：${name}`;
}

function CandidateOptions<T extends Asset | Character>({
  candidates,
  kind,
  onSelect,
  project,
  selectedId,
  stale,
  thumbnails,
}: {
  candidates: SceneCreationCandidate<T>[];
  kind: 'background' | 'character';
  onSelect: (id: string) => void;
  project: EditorProjectSnapshot['project'];
  selectedId: string | null;
  stale: boolean;
  thumbnails: Readonly<Record<string, ThumbnailState>>;
}): React.JSX.Element | null {
  if (candidates.length === 0) return null;
  return (
    <div className="scene-creation-candidate-grid">
      {candidates.map((candidate, index) => {
        const value = candidate.value;
        const assets = candidateImageAssets(project, candidate);
        const unavailable = candidateUnavailableReason(
          candidate,
          assets,
          thumbnails,
        );
        const selected = selectedId === value.id;
        const accessibleLabel = makeCandidateLabel(
          kind,
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
              {assets.map((asset, assetIndex) => {
                const thumbnail = thumbnails[asset.id];
                return thumbnail?.status === 'ready' ? (
                  <img
                    alt={`${accessibleLabel} ${kind === 'character' ? `部件 ${assetIndex + 1}` : '缩略图'}`}
                    key={asset.id}
                    src={thumbnail.dataUrl}
                  />
                ) : (
                  <span
                    aria-label={thumbnailLabel(thumbnail)}
                    className="scene-creation-candidate-thumbnail-fallback"
                    data-thumbnail-status={thumbnail?.status ?? 'loading'}
                    key={asset.id}
                  >
                    {thumbnailLabel(thumbnail) || '读取中'}
                  </span>
                );
              })}
              {assets.length === 0 ? (
                <span className="scene-creation-candidate-thumbnail-fallback">
                  暂无图片
                </span>
              ) : null}
            </span>
            <span className="scene-creation-candidate-name">{accessibleLabel}</span>
            {kind === 'character' ? (
              <span className="scene-creation-candidate-kind">合成角色</span>
            ) : null}
            {unavailable ? (
              <span className="scene-creation-candidate-reason">{unavailable}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function ScenePreview({
  disabled,
  onConfirm,
  plan,
  stale,
}: {
  disabled: boolean;
  onConfirm: () => void;
  plan: SceneCreationPreviewPlan;
  stale: boolean;
}): React.JSX.Element {
  const shot = plan.result.project.shots.find(
    (candidate) => candidate.id === plan.result.shotId,
  );
  if (!shot) throw new Error('预览镜头不存在。');
  const thumbnail = useShotThumbnail(
    plan.identity.projectRoot,
    plan.result.project,
    shot,
  );
  const ready = thumbnail.status === 'ready';
  const thumbnailUnavailable =
    thumbnail.status === 'missing' || thumbnail.status === 'error';
  return (
    <section
      aria-label="布景预览"
      className="scene-creation-preview"
      data-preview-status={thumbnail.status}
      data-testid="scene-creation-preview"
    >
      <div className="scene-creation-preview-heading">
        <h4>{shot.name}</h4>
        <span>背景：{plan.result.project.assets.find((asset) => asset.id === plan.result.backgroundAssetId)?.name}</span>
        <span>出场：{plan.result.project.characters.find((character) => character.id === plan.result.characterId)?.name}</span>
      </div>
      {ready ? (
        <img
          alt={`${shot.name} 的背景和角色预览`}
          className="scene-creation-preview-image"
          data-testid="scene-creation-preview-image"
          src={thumbnail.dataUrl}
        />
      ) : (
        <div
          aria-live={thumbnail.status === 'loading' ? 'polite' : undefined}
          className="scene-creation-preview-placeholder"
          role={thumbnailUnavailable ? 'alert' : undefined}
        >
          {thumbnail.status === 'loading'
            ? '正在准备预览'
            : thumbnail.status === 'empty'
              ? '暂无可预览画面'
              : thumbnail.message || '素材源文件不可用'}
        </div>
      )}
      <button
        className="scene-creation-confirm"
        data-testid="scene-creation-confirm"
        disabled={disabled || stale || !ready}
        onClick={onConfirm}
        type="button"
      >
        确认生成镜头
      </button>
    </section>
  );
}

export function SceneCreationPanel({
  snapshot,
  onBack,
  editorStore = editorProjectStore,
  shotStore: activeShotStore = shotStore,
  service = new SceneCreationService(),
}: SceneCreationPanelProps): React.JSX.Element {
  const [rawInput, setRawInput] = useState('');
  const [inspection, setInspection] = useState<SceneInspection | null>(null);
  const [previewPlan, setPreviewPlan] = useState<SceneCreationPreviewPlan | null>(null);
  const [thumbnailStates, setThumbnailStates] = useState<
    Record<string, ThumbnailState>
  >({});
  const [errorMessage, setErrorMessage] = useState('');
  const [copyMessage, setCopyMessage] = useState('');
  const [copyMessageIsError, setCopyMessageIsError] = useState(false);
  const [committing, setCommitting] = useState(false);
  const commitInProgress = useRef(false);
  const copyMessageTimerRef = useRef<number | null>(null);
  const copyRequestIdRef = useRef(0);
  const currentProject = snapshot?.project ?? null;
  const resolvedCandidateAssets = useMemo(
    () => candidateAssets(currentProject, inspection?.resolution ?? null),
    [currentProject, inspection?.resolution],
  );
  const candidateAssetKey = resolvedCandidateAssets
    .map((asset) => `${asset.id}:${asset.sha256 ?? ''}`)
    .join('|');
  const inspectionStale = Boolean(
    inspection && !isIdentityCurrent(inspection.identity, editorStore),
  );
  const previewStale = Boolean(
    previewPlan && !isSceneCreationPreviewCurrent(previewPlan, editorStore),
  );
  const stale = inspectionStale || previewStale;
  const inspectionMatchesInput = inspection?.rawInput === rawInput;
  const shotNameConflict = Boolean(
    inspectionMatchesInput &&
      inspection &&
      snapshot &&
      hasShotNameConflict(
        snapshot.project.shots,
        inspection.resolution.input.shotName,
      ),
  );

  const clearCopyMessageTimer = (): void => {
    if (copyMessageTimerRef.current !== null) {
      window.clearTimeout(copyMessageTimerRef.current);
      copyMessageTimerRef.current = null;
    }
  };

  const clearCopyFeedback = (): void => {
    copyRequestIdRef.current += 1;
    clearCopyMessageTimer();
    setCopyMessage('');
    setCopyMessageIsError(false);
  };

  useEffect(
    () => () => {
      copyRequestIdRef.current += 1;
      if (copyMessageTimerRef.current !== null) {
        window.clearTimeout(copyMessageTimerRef.current);
        copyMessageTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    const nextStates = Object.fromEntries(
      resolvedCandidateAssets.map((asset) => [
        asset.id,
        { status: 'loading' as const },
      ]),
    );
    setThumbnailStates(nextStates);
    if (!snapshot?.projectRoot) return () => {
      active = false;
    };
    for (const asset of resolvedCandidateAssets) {
      if (asset.kind !== 'image' || asset.metadata?.status === 'error') {
        setThumbnailStates((current) => ({
          ...current,
          [asset.id]: {
            status: 'missing',
            reason: 'error',
            message: '素材当前不可用',
          },
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
              [asset.id]: thumbnailStateFromResponse(response),
            }));
          }
        })
        .catch((error: unknown) => {
          if (!active) return;
          setThumbnailStates((current) => ({
            ...current,
            [asset.id]: {
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
  }, [candidateAssetKey, resolvedCandidateAssets, snapshot?.projectRoot]);

  const inspectInput = (): void => {
    clearCopyFeedback();
    if (!snapshot) {
      setErrorMessage('请先打开项目。');
      return;
    }
    try {
      const resolution = service.resolve(snapshot.project, rawInput);
      const selectUnique = <T extends Asset | Character>(
        candidates: SceneCreationCandidate<T>[],
      ): string | null =>
        candidates.length === 1 && candidates[0]!.selectable
          ? candidates[0]!.value.id
          : null;
      setInspection({
        rawInput,
        identity: captureIdentity(snapshot, editorStore),
        resolution,
        selectedBackgroundId: selectUnique(resolution.backgroundCandidates),
        selectedCharacterId: selectUnique(resolution.characterCandidates),
      });
      setPreviewPlan(null);
      setErrorMessage('');
    } catch (error) {
      setInspection(null);
      setPreviewPlan(null);
      setErrorMessage(sceneErrorMessage(error));
    }
  };

  const previewScene = (): void => {
    if (!inspection || !inspectionMatchesInput || stale || shotNameConflict) return;
    if (!inspection.selectedBackgroundId || !inspection.selectedCharacterId) return;
    clearCopyFeedback();
    try {
      const plan = prepareSceneCreationPreview(
        inspection.rawInput,
        {
          backgroundAssetId: inspection.selectedBackgroundId,
          characterId: inspection.selectedCharacterId,
        },
        { editorStore, shotStore: activeShotStore, service },
      );
      setPreviewPlan(plan);
      setErrorMessage('');
    } catch (error) {
      setPreviewPlan(null);
      setErrorMessage(sceneErrorMessage(error));
    }
  };

  const confirmScene = (): void => {
    const plan = previewPlan;
    if (!plan || stale || commitInProgress.current) return;
    clearCopyFeedback();
    commitInProgress.current = true;
    setCommitting(true);
    try {
      commitSceneCreationPreview(plan, {
        editorStore,
        shotStore: activeShotStore,
        service,
      });
      setPreviewPlan(null);
      setInspection(null);
      onBack();
    } catch (error) {
      setErrorMessage(sceneErrorMessage(error));
      if (error instanceof Error && 'code' in error && error.code === 'PROJECT_CHANGED') {
        setPreviewPlan(null);
        setInspection(null);
      }
    } finally {
      commitInProgress.current = false;
      setCommitting(false);
    }
  };

  const copyExternalPrompt = async (): Promise<void> => {
    const requestId = copyRequestIdRef.current + 1;
    copyRequestIdRef.current = requestId;
    clearCopyMessageTimer();
    setCopyMessage('');
    setCopyMessageIsError(false);
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('此环境无法访问剪贴板。');
      }
      await navigator.clipboard.writeText(EXTERNAL_SCENE_ORGANIZATION_PROMPT);
      if (copyRequestIdRef.current !== requestId) return;
      setCopyMessage('整理提示词已复制。');
      copyMessageTimerRef.current = window.setTimeout(() => {
        if (copyRequestIdRef.current === requestId) {
          setCopyMessage('');
          copyMessageTimerRef.current = null;
        }
      }, 3_000);
    } catch (error) {
      if (copyRequestIdRef.current !== requestId) return;
      setCopyMessage(
        error instanceof Error
          ? `${error.message}可手动复制提示词。`
          : '无法复制提示词，请手动选择复制。',
      );
      setCopyMessageIsError(true);
    }
  };

  const selectBackground = (assetId: string): void => {
    clearCopyFeedback();
    setInspection((current) =>
      current ? { ...current, selectedBackgroundId: assetId } : current,
    );
    setPreviewPlan(null);
    setErrorMessage('');
  };

  const selectCharacter = (characterId: string): void => {
    clearCopyFeedback();
    setInspection((current) =>
      current ? { ...current, selectedCharacterId: characterId } : current,
    );
    setPreviewPlan(null);
    setErrorMessage('');
  };

  const backgroundMissing =
    inspectionMatchesInput && inspection?.resolution.backgroundCandidates.length === 0;
  const characterMissing =
    inspectionMatchesInput && inspection?.resolution.characterCandidates.length === 0;

  return (
    <section
      aria-labelledby="scene-creation-heading"
      className="scene-creation-panel"
      data-testid="scene-creation-panel"
    >
      <header className="scene-creation-heading">
        <h3 id="scene-creation-heading">自动布景</h3>
      </header>

      <label className="scene-creation-input-label" htmlFor="scene-creation-input">
        粘贴布景信息
        <textarea
          aria-describedby="scene-creation-format"
          data-testid="scene-creation-input"
          disabled={!snapshot}
          id="scene-creation-input"
          maxLength={2_000}
          onChange={(event) => {
            setRawInput(event.target.value);
            setInspection(null);
            setPreviewPlan(null);
            setErrorMessage('');
            clearCopyFeedback();
          }}
          placeholder={'镜头：花园相遇\n背景：花园\n出场：张三'}
          spellCheck={false}
          value={rawInput}
        />
      </label>
      <details className="scene-creation-format-details">
        <summary>格式示例</summary>
        <pre id="scene-creation-format">{'镜头：花园相遇\n背景：花园\n出场：张三'}</pre>
      </details>

      <div className="scene-creation-actions">
        <button
          data-testid="scene-creation-inspect"
          disabled={!snapshot || !rawInput.trim()}
          onClick={inspectInput}
          type="button"
        >
          检查素材
        </button>
      </div>
      <details className="scene-creation-prompt-details">
        <summary>用外部 AI 整理文本</summary>
        <p className="scene-creation-prompt-guidance">
          将提示词复制到外部工具整理，再把三行结果粘贴回来。Panda Stage 不会调用 AI。
        </p>
        <pre>{EXTERNAL_SCENE_ORGANIZATION_PROMPT}</pre>
        <button
          className="scene-creation-prompt-action"
          data-testid="scene-creation-copy-prompt"
          onClick={() => void copyExternalPrompt()}
          type="button"
        >
          复制提示词
        </button>
      </details>
      {copyMessage ? (
        <output
          aria-live={copyMessageIsError ? 'assertive' : 'polite'}
          className={`scene-creation-copy-status${copyMessageIsError ? ' scene-creation-copy-status-error' : ''}`}
          role={copyMessageIsError ? 'alert' : 'status'}
        >
          {copyMessage}
        </output>
      ) : null}

      {errorMessage ? (
        <p className="scene-creation-error" data-testid="scene-creation-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {stale ? (
        <div className="scene-creation-stale" role="alert">
          <span>工程已变化，当前预览已失效。</span>
          <button onClick={inspectInput} type="button">
            重新检查素材
          </button>
        </div>
      ) : null}

      {inspectionMatchesInput && inspection && snapshot && !stale ? (
        <div className="scene-creation-candidates" data-testid="scene-creation-candidates">
          <fieldset>
            <legend>背景 · {inspection.resolution.input.backgroundName}</legend>
            {backgroundMissing ? (
              <p className="scene-creation-error" role="alert">工程中找不到这个背景名称。</p>
            ) : (
              <CandidateOptions
                candidates={inspection.resolution.backgroundCandidates}
                kind="background"
                onSelect={selectBackground}
                project={snapshot!.project}
                selectedId={inspection.selectedBackgroundId}
                stale={stale}
                thumbnails={thumbnailStates}
              />
            )}
          </fieldset>
          <fieldset>
            <legend>出场 · {inspection.resolution.input.characterName}</legend>
            {characterMissing ? (
              <p className="scene-creation-error" role="alert">工程中找不到这个角色。</p>
            ) : (
              <CandidateOptions
                candidates={inspection.resolution.characterCandidates}
                kind="character"
                onSelect={selectCharacter}
                project={snapshot!.project}
                selectedId={inspection.selectedCharacterId}
                stale={stale}
                thumbnails={thumbnailStates}
              />
            )}
          </fieldset>
          {shotNameConflict ? (
            <p className="scene-creation-error" role="alert">
              已有同名镜头，请修改“镜头”字段后重新检查。
            </p>
          ) : null}
          <button
            className="scene-creation-preview-action"
            data-testid="scene-creation-preview-action"
            disabled={
              stale ||
              shotNameConflict ||
              !inspection.selectedBackgroundId ||
              !inspection.selectedCharacterId ||
              !inspection.resolution.backgroundCandidates.some(
                (candidate) =>
                  candidate.value.id === inspection.selectedBackgroundId &&
                  !candidateUnavailableReason(
                    candidate,
                    candidateImageAssets(snapshot.project, candidate),
                    thumbnailStates,
                  ),
              ) ||
              !inspection.resolution.characterCandidates.some(
                (candidate) =>
                  candidate.value.id === inspection.selectedCharacterId &&
                  !candidateUnavailableReason(
                    candidate,
                    candidateImageAssets(snapshot.project, candidate),
                    thumbnailStates,
                  ),
              )
            }
            onClick={previewScene}
            type="button"
          >
            预览布景
          </button>
        </div>
      ) : null}

      {previewPlan && !previewStale ? (
        <ScenePreview
          disabled={committing}
          onConfirm={confirmScene}
          plan={previewPlan}
          stale={previewStale}
        />
      ) : null}
    </section>
  );
}
