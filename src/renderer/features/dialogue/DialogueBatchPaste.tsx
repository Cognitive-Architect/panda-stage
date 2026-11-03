import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AudioAsset, Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { CircleCheck, CirclePlus } from 'lucide-react';
import {
  CharacterAvatar,
  CharacterIdentityPicker,
  getCharacterDefaultExpression,
  useCharacterAvatarThumbnails,
} from '../characters/CharacterIdentity';
import {
  buildDialogueBatchPreview,
  dialogueAudioFileName,
  formatDialogueDuration,
  formatDialogueDurationInput,
} from './dialogueBatchPlan';
import type { DialogueAuthoringDraft } from './dialogueAuthoringDraft';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
  type ParsedDialogueLine,
} from './parseDialoguePaste';

const AUTOMATIC_AUDIO_VALUE = '__automatic__';

function exceptionHeading(line: ParsedDialogueLine): string {
  if (line.status === 'malformed') return '这一行格式不对';
  if (line.status === 'invalid') {
    if (line.reason === 'empty-speaker') return '缺少角色名称';
    if (line.reason === 'text-too-long') return '台词内容过长';
    return '缺少台词内容';
  }
  return line.speaker ?? '未识别角色';
}

function exceptionDetail(line: ParsedDialogueLine): string | null {
  if (line.status === 'malformed') return '请写成「角色：台词」。';
  if (line.status === 'invalid' && line.reason === 'text-too-long') {
    return '台词内容不能超过 10000 个字符。';
  }
  if (line.status === 'unknown' || line.status === 'ambiguous') {
    return line.text ?? line.raw;
  }
  return null;
}

function mappingIssueCopy(line: ParsedDialogueLine): string {
  if (line.status === 'ambiguous') {
    return `「${line.speaker ?? '未识别角色'}」对应多个角色，请确认。`;
  }
  return `未找到「${line.speaker ?? '未识别角色'}」`;
}

function audioState(asset: AudioAsset): string {
  if (asset.metadata?.status === 'error') return '不可用';
  if (asset.durationMs === undefined) return '尚未准备好';
  if (!Number.isSafeInteger(asset.durationMs) || asset.durationMs < 1) {
    return '时长无效';
  }
  return '可用';
}

function audioOptionLabel(asset: AudioAsset): string {
  return `${dialogueAudioFileName(asset)} · ${audioState(asset)}${asset.durationMs !== undefined ? ` · ${formatDialogueDuration(asset.durationMs)}` : ''}`;
}

function DialogueBatchAudioPreview({
  asset,
  projectRoot,
}: {
  asset: AudioAsset;
  projectRoot: string;
}): React.JSX.Element {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  useEffect(
    () => () => {
      requestVersion.current += 1;
    },
    [],
  );
  useEffect(
    () => () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    },
    [audioUrl],
  );

  const loadPreview = async (): Promise<void> => {
    if (!asset.sha256) {
      setError('这段配音暂时无法试听。');
      return;
    }
    const currentRequest = ++requestVersion.current;
    setLoading(true);
    setError(null);
    try {
      const response = await window.pandaStage.assets.readAudio({
        projectRoot,
        assetId: asset.id,
        sha256: asset.sha256,
      });
      if (currentRequest !== requestVersion.current) return;
      if (!response.ok) {
        setError('无法读取这段配音，请检查素材是否仍可用。');
        return;
      }
      const bytes = response.bytes.slice().buffer as ArrayBuffer;
      setAudioUrl(URL.createObjectURL(new Blob([bytes], { type: response.mimeType })));
    } catch {
      if (currentRequest === requestVersion.current) {
        setError('无法读取这段配音，请检查素材是否仍可用。');
      }
    } finally {
      if (currentRequest === requestVersion.current) setLoading(false);
    }
  };

  return (
    <div className="dialogue-batch-audio-preview" data-testid="dialogue-batch-audio-preview">
      <button
        aria-label={`试听${dialogueAudioFileName(asset)}`}
        className="dialogue-batch-audio-preview-load"
        data-testid="dialogue-batch-audio-preview-load"
        disabled={loading || !asset.sha256}
        onClick={() => void loadPreview()}
        type="button"
      >
        {loading ? '准备试听…' : audioUrl ? '重新载入试听' : '载入试听'}
      </button>
      {audioUrl ? (
        <audio
          aria-label={`试听${dialogueAudioFileName(asset)}`}
          controls
          data-testid="dialogue-batch-audio-player"
          src={audioUrl}
        />
      ) : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}

/**
 * Production batch authoring surface. Parsing, role mapping, audio selection,
 * and the audio generation plan remain transient draft state. Only the
 * explicit subtitle-only action below creates untimed Dialogue records.
 */
export function DialogueBatchPaste({
  draft,
  onSuccess,
  showDefaultExpression = true,
  presentation = 'subtitle-only',
}: {
  draft: DialogueAuthoringDraft;
  onSuccess?: () => void;
  showDefaultExpression?: boolean;
  presentation?: 'subtitle-only' | 'auto-subtitle';
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const audioAssets: readonly AudioAsset[] =
    snapshot?.project.assets.filter(
      (candidate): candidate is AudioAsset => candidate.kind === 'audio',
    ) ?? [];
  const {
    onThumbnailError: onCharacterThumbnailError,
    thumbnails: characterThumbnails,
  } = useCharacterAvatarThumbnails(snapshot, characters);
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [roleEditLine, setRoleEditLine] = useState<number | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [expandedLine, setExpandedLine] = useState<number | null>(null);
  const [inputExpanded, setInputExpanded] = useState(true);
  const autoSubtitle = presentation === 'auto-subtitle';

  const parsed = useMemo(
    () => parseDialoguePaste(draftState.batchRaw, characters),
    [draftState.batchRaw, characters],
  );
  const resolution = useMemo(
    () =>
      resolveDialoguePaste(parsed, draftState.batchMapping, characters),
    [characters, draftState.batchMapping, parsed],
  );
  const preview = useMemo(
    () => {
      if (!autoSubtitle) return null;
      return buildDialogueBatchPreview({
        parsed,
        resolution,
        characters,
        audioAssets,
        audioSelections: draftState.batchAudioSelections,
      });
    },
    [
      audioAssets,
      autoSubtitle,
      characters,
      draftState.batchAudioSelections,
      parsed,
      resolution,
    ],
  );
  const hasContent = draftState.batchRaw.trim().length > 0;
  const handleAddSubtitles = (): void => {
    if (!resolution.allResolved) return;
    try {
      dialogueStore.createMany(
        resolution.resolvedLines.filter(
          (line): line is NonNullable<typeof line> => line !== null,
        ),
      );
      setCommitError(null);
      onSuccess?.();
    } catch (error) {
      setCommitError(
        error instanceof Error ? error.message : '批量添加字幕失败。',
      );
    }
  };
  const audioUse = new Map<string, number[]>();
  (preview?.rows ?? []).forEach((row) => {
    if (!row.audioAsset) return;
    const lineNumbers = audioUse.get(row.audioAsset.id) ?? [];
    lineNumbers.push(row.sourceLineNumber);
    audioUse.set(row.audioAsset.id, lineNumbers);
  });

  return (
    <div
      aria-labelledby={autoSubtitle ? 'project-tools-heading' : 'dialogue-authoring-tab-batch'}
      className={`dialogue-authoring-mode dialogue-authoring-batch${autoSubtitle ? ' dialogue-batch-auto-subtitle' : ''}`}
      data-presentation={presentation}
      data-testid={autoSubtitle ? 'auto-subtitle-batch' : 'dialogue-batch'}
      id={autoSubtitle ? 'auto-subtitle-batch-panel' : 'dialogue-authoring-panel-batch'}
      role={autoSubtitle ? 'region' : 'tabpanel'}
    >
      {autoSubtitle ? (
        <div className="auto-subtitle-input-heading">
          <h3>对白</h3>
          <button
            aria-controls="auto-subtitle-input-section"
            aria-expanded={inputExpanded}
            className="auto-subtitle-input-toggle"
            data-testid="auto-subtitle-input-toggle"
            onClick={() => setInputExpanded((expanded) => !expanded)}
            type="button"
          >
            {inputExpanded ? '收起' : '编辑对白'}
          </button>
        </div>
      ) : null}
      <section
        className="dialogue-batch-input-section"
        hidden={autoSubtitle && !inputExpanded}
        id={autoSubtitle ? 'auto-subtitle-input-section' : undefined}
      >
        <label id="dialogue-batch-format-hint" htmlFor="dialogue-batch-input">
          每行一条，格式：角色：台词
        </label>
        <textarea
          aria-describedby="dialogue-batch-format-hint"
          aria-label={autoSubtitle ? '自动字幕对白' : '批量字幕原始文本'}
          className="dialogue-batch-input"
          data-testid="dialogue-batch-input"
          id="dialogue-batch-input"
          placeholder={'Panda：你好呀\n角色B：这是第二行台词'}
          rows={autoSubtitle ? 4 : 7}
          value={draftState.batchRaw}
          onChange={(event) => {
            setCommitError(null);
            setRoleEditLine(null);
            setExpandedLine(null);
            draft.setBatchRaw(event.target.value);
          }}
        />
      </section>

      {hasContent ? (
        <>
          {autoSubtitle ? (
            <div
              aria-label="自动字幕匹配状态"
              className="dialogue-batch-recognition"
              data-testid="dialogue-batch-recognition"
              role="status"
            >
              <span
                className="auto-subtitle-phase-state"
                data-testid="auto-subtitle-phase-a-status"
              >
                待生成
              </span>
              <span className="dialogue-batch-recognition-ready">
                {`已匹配 ${preview?.readyCount ?? 0} 条配音`}
              </span>
              <span className="dialogue-batch-recognition-pending">
                {`待处理 ${preview?.pendingCount ?? parsed.lines.length} 条`}
              </span>
              <span className="dialogue-batch-recognition-duration">
                {`${preview?.allReady ? '总时长' : '已确认时长'} ${formatDialogueDuration(preview?.totalDurationMs ?? 0)}`}
              </span>
              {parsed.ignoredEmpty > 0 ? (
                <span className="dialogue-batch-recognition-ignored">
                  {`已跳过 ${parsed.ignoredEmpty} 个空行`}
                </span>
              ) : null}
            </div>
          ) : null}

          <ol
            aria-label={autoSubtitle ? '自动字幕匹配结果' : '按粘贴顺序排列的字幕'}
            className="dialogue-batch-preview"
            data-testid="dialogue-batch-preview"
          >
            {parsed.lines.map((line, index) => {
              const row = preview?.rows[index];
              const resolved = resolution.resolvedLines[index];
              const needsMapping =
                line.status === 'unknown' || line.status === 'ambiguous';
              const canChooseRole = line.status !== 'malformed';
              const resolvedCharacter = resolved
                ? characters.find(
                    (candidate) => candidate.id === resolved.characterId,
                  )
                : undefined;
              const resolvedRow =
                resolved && resolvedCharacter
                  ? { character: resolvedCharacter, text: resolved.text }
                  : null;
              const selection = draftState.batchAudioSelections[line.lineNumber];
              const selectionMatchesCharacter =
                Boolean(selection && resolvedRow) &&
                selection?.characterId === resolvedRow?.character.id;
              const selectedAudioValue = selectionMatchesCharacter
                ? selection?.assetId === row?.automaticAsset?.id && row?.automaticAsset
                  ? AUTOMATIC_AUDIO_VALUE
                  : selection?.assetId ?? ''
                : selection
                  ? ''
                  : row?.automaticAsset
                    ? AUTOMATIC_AUDIO_VALUE
                    : '';
              const mapped = needsMapping && resolvedRow;
              const roleWasChanged =
                line.status === 'valid' &&
                resolvedRow !== null &&
                resolvedRow.character.id !== line.characterId;
              const rowStatus = !resolvedRow
                ? line.status
                : row?.issue
                  ? 'audio-invalid'
                  : mapped || roleWasChanged
                    ? 'mapped'
                    : 'valid';
              const issueId = `dialogue-batch-issue-${line.lineNumber}`;
              const rowExpanded = expandedLine === line.lineNumber;
              const summaryAsset = row?.audioAsset ?? row?.suggestedAudioAsset ?? null;
              const summaryDuration =
                row?.audioReady &&
                row.sourceDurationMs !== null &&
                row.durationMs !== null
                  ? row.durationMs === row.sourceDurationMs
                    ? formatDialogueDuration(row.sourceDurationMs)
                    : `片段 ${formatDialogueDuration(row.durationMs)} / 原长 ${formatDialogueDuration(row.sourceDurationMs)}`
                  : null;

              return (
                <li
                  data-status={rowStatus}
                  data-audio-asset-id={row?.audioAssetId ?? ''}
                  data-source-duration-ms={row?.sourceDurationMs ?? ''}
                  data-clip-duration-ms={row?.durationMs ?? ''}
                  data-testid="dialogue-batch-line"
                  key={line.lineNumber}
                >
                  <div className="dialogue-batch-line-heading">
                    <span className="dialogue-batch-row-number">
                      {`第 ${line.lineNumber} 行`}
                    </span>
                    {resolvedRow ? (
                      <div className="dialogue-batch-row-result dialogue-batch-row-result-resolved">
                        <span
                          aria-label="角色已确认"
                          className="dialogue-batch-row-status"
                          role="img"
                        >
                          {autoSubtitle ? (
                            <CircleCheck
                              aria-hidden="true"
                              focusable="false"
                              size={15}
                              strokeWidth={2.6}
                            />
                          ) : (
                            '✓'
                          )}
                        </span>
                        <CharacterAvatar
                          character={resolvedRow.character}
                          className="dialogue-batch-row-avatar"
                          onThumbnailError={onCharacterThumbnailError}
                          thumbnail={
                            characterThumbnails[
                              getCharacterDefaultExpression(resolvedRow.character)
                                ?.assetId ?? ''
                            ]
                          }
                        />
                        <div className="dialogue-batch-row-copy">
                          <strong>{resolvedRow.character.name}</strong>
                          <span>{resolvedRow.text}</span>
                        </div>
                        {autoSubtitle ? (
                          <button
                            aria-expanded={rowExpanded}
                            aria-label={`${rowExpanded ? '收起' : '编辑'}第 ${line.lineNumber} 行自动字幕`}
                            className="dialogue-batch-role-edit auto-subtitle-row-edit"
                            data-testid={`auto-subtitle-row-edit-${line.lineNumber}`}
                            type="button"
                            onClick={() => {
                              setExpandedLine((current) =>
                                current === line.lineNumber ? null : line.lineNumber,
                              );
                              setRoleEditLine(null);
                            }}
                          >
                            {rowExpanded ? '收起' : '编辑'}
                          </button>
                        ) : (
                          <button
                            aria-expanded={roleEditLine === line.lineNumber}
                            aria-label={`更换第 ${line.lineNumber} 行角色`}
                            className="dialogue-batch-role-edit"
                            data-testid={`dialogue-batch-role-edit-${line.lineNumber}`}
                            type="button"
                            onClick={() => {
                              setCommitError(null);
                              setRoleEditLine((current) =>
                                current === line.lineNumber ? null : line.lineNumber,
                              );
                            }}
                          >
                            更换角色
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="dialogue-batch-row-result dialogue-batch-row-result-exception">
                        <span
                          aria-hidden="true"
                          className="dialogue-batch-row-status"
                        >
                          !
                        </span>
                        <div className="dialogue-batch-row-copy">
                          <strong>{exceptionHeading(line)}</strong>
                          {exceptionDetail(line) ? (
                            <span>{exceptionDetail(line)}</span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>

                  {autoSubtitle ? (
                    <div
                      className="auto-subtitle-row-audio-summary"
                      data-testid="auto-subtitle-row-audio-summary"
                    >
                      {summaryAsset ? (
                        <span
                          className="auto-subtitle-row-audio-name"
                          title={dialogueAudioFileName(summaryAsset)}
                        >
                          {dialogueAudioFileName(summaryAsset)}
                        </span>
                      ) : null}
                      <span>
                        {summaryDuration ?? row?.issueMessage ?? (resolvedRow ? '待匹配配音' : '先确认角色')}
                      </span>
                    </div>
                  ) : null}

                  {canChooseRole &&
                  (!resolvedRow ||
                    (autoSubtitle
                      ? rowExpanded && roleEditLine === line.lineNumber
                      : roleEditLine === line.lineNumber)) ? (
                    <div className="dialogue-batch-row-resolution">
                      {needsMapping && !resolvedRow ? (
                        <p className="dialogue-batch-row-issue">
                          <strong>{mappingIssueCopy(line)}</strong>
                        </p>
                      ) : null}
                      <CharacterIdentityPicker
                        ariaLabel={`为第 ${line.lineNumber} 行「${line.speaker || '未填写角色'}」选择角色`}
                        characters={characters}
                        className="dialogue-batch-character-picker"
                        emptySummaryDescription={null}
                        emptySummaryLabel="请选择对应角色"
                        onClear={() => {
                          setCommitError(null);
                          if (draftState.batchMapping[line.lineNumber]) {
                            draft.setBatchMapping(line.lineNumber, '');
                          }
                          setRoleEditLine(null);
                        }}
                        onSelect={(characterId) => {
                          setCommitError(null);
                          if (resolvedRow?.character.id !== characterId) {
                            draft.setBatchMapping(line.lineNumber, characterId);
                          }
                          setRoleEditLine(null);
                        }}
                        onThumbnailError={onCharacterThumbnailError}
                        selectedCharacterId={
                          draftState.batchMapping[line.lineNumber] ||
                          (line.status === 'valid' ? line.characterId ?? null : null)
                        }
                        selectedLabel="当前绑定"
                        showDefaultExpression={showDefaultExpression}
                        data-testid={`dialogue-batch-map-${line.lineNumber}`}
                        thumbnails={characterThumbnails}
                      />
                    </div>
                  ) : null}

                  {autoSubtitle && rowExpanded && resolvedRow ? (
                    <div className="auto-subtitle-row-edit-actions">
                      <button
                        aria-expanded={roleEditLine === line.lineNumber}
                        aria-label={`更换第 ${line.lineNumber} 行角色`}
                        className="dialogue-batch-role-edit"
                        data-testid={`dialogue-batch-role-edit-${line.lineNumber}`}
                        type="button"
                        onClick={() => {
                          setCommitError(null);
                          setRoleEditLine((current) =>
                            current === line.lineNumber ? null : line.lineNumber,
                          );
                        }}
                      >
                        更换角色
                      </button>
                    </div>
                  ) : null}

                  {autoSubtitle && rowExpanded && resolvedRow && row ? (
                    <div className="dialogue-batch-audio-row">
                      <label htmlFor={`dialogue-batch-audio-${line.lineNumber}`}>
                        配音
                        <select
                          aria-describedby={row.issueMessage ? issueId : undefined}
                          aria-invalid={Boolean(row.issue)}
                          data-testid={`dialogue-batch-audio-${line.lineNumber}`}
                          id={`dialogue-batch-audio-${line.lineNumber}`}
                          value={selectedAudioValue}
                          onChange={(event) => {
                            setCommitError(null);
                            const value = event.target.value;
                            if (value === AUTOMATIC_AUDIO_VALUE) {
                              draft.clearBatchAudioSelection(line.lineNumber);
                              return;
                            }
                            const asset = audioAssets.find(
                              (candidate) => candidate.id === value,
                            );
                            draft.setBatchAudioSelection(line.lineNumber, {
                              assetId: value || null,
                              characterId: resolvedRow.character.id,
                              durationSeconds: asset
                                ? formatDialogueDurationInput(asset.durationMs ?? 0)
                                : '',
                            });
                          }}
                        >
                          <option value="">选择配音</option>
                          {row.automaticAsset ? (
                            <option value={AUTOMATIC_AUDIO_VALUE}>
                              {`自动匹配 · ${audioOptionLabel(row.automaticAsset)}`}
                            </option>
                          ) : null}
                          {audioAssets
                            .filter(
                              (asset) => asset.id !== row.automaticAsset?.id,
                            )
                            .map((asset) => {
                              const usedElsewhere =
                                audioUse
                                  .get(asset.id)
                                  ?.find(
                                    (lineNumber) =>
                                      lineNumber !== row.sourceLineNumber,
                                  ) ?? null;
                              return (
                                <option
                                  disabled={
                                    usedElsewhere !== null ||
                                    !Number.isSafeInteger(asset.durationMs) ||
                                    (asset.durationMs ?? 0) < 1 ||
                                    asset.metadata?.status === 'error'
                                  }
                                  key={asset.id}
                                  value={asset.id}
                                >
                                  {`${audioOptionLabel(asset)}${usedElsewhere !== null ? ` · 已用于第 ${usedElsewhere} 行` : ''}`}
                                </option>
                              );
                            })}
                        </select>
                      </label>

                      {row.audioAsset ? (
                        <div className="dialogue-batch-audio-details">
                          <span
                            className="dialogue-batch-audio-state"
                            data-audio-state={audioState(row.audioAsset)}
                          >
                            {audioState(row.audioAsset)}
                          </span>
                          {row.audioReady && row.sourceDurationMs !== null ? (
                            <label
                              className="dialogue-batch-duration-field"
                              htmlFor={`dialogue-batch-duration-${line.lineNumber}`}
                            >
                              <span>片段时长</span>
                              <input
                                aria-describedby={row.issueMessage ? issueId : undefined}
                                aria-invalid={
                                  row.issue === 'duration-invalid' ||
                                  row.issue === 'duration-out-of-range'
                                }
                                data-testid={`dialogue-batch-duration-${line.lineNumber}`}
                                id={`dialogue-batch-duration-${line.lineNumber}`}
                                max={formatDialogueDurationInput(row.sourceDurationMs)}
                                min="0.001"
                                step="0.001"
                                type="number"
                                value={row.durationSeconds ?? ''}
                                onChange={(event) => {
                                  setCommitError(null);
                                  draft.setBatchAudioSelection(line.lineNumber, {
                                    assetId: row.audioAsset!.id,
                                    characterId: resolvedRow.character.id,
                                    durationSeconds: event.target.value,
                                  });
                                }}
                              />
                              <span>秒</span>
                            </label>
                          ) : null}
                        </div>
                      ) : row.suggestedAudioAsset ? (
                        <span className="dialogue-batch-audio-suggestion">
                          {`${dialogueAudioFileName(row.suggestedAudioAsset)} · ${audioState(row.suggestedAudioAsset)}${row.suggestedAudioAsset.durationMs !== undefined ? ` · ${formatDialogueDuration(row.suggestedAudioAsset.durationMs)}` : ''}`}
                        </span>
                      ) : null}

                      {row.issueMessage ? (
                        <p
                          className="dialogue-batch-row-issue"
                          data-testid={`dialogue-batch-issue-${line.lineNumber}`}
                          id={issueId}
                        >
                          {row.issueMessage}
                        </p>
                      ) : null}
                      {row.audioAsset && snapshot?.projectRoot ? (
                        <DialogueBatchAudioPreview
                          asset={row.audioAsset}
                          key={`${row.audioAsset.id}:${row.audioAsset.sha256 ?? ''}`}
                          projectRoot={snapshot.projectRoot}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {!autoSubtitle && commitError ? (
            <p className="dialogue-authoring-error" role="alert">
              {commitError}
            </p>
          ) : null}
          {!autoSubtitle ? (
            <footer
              className="dialogue-authoring-footer"
              data-testid="dialogue-authoring-footer"
            >
              <button
                className="dialogue-authoring-submit dialogue-batch-subtitle-only"
                data-testid="dialogue-batch-add-subtitles"
                disabled={!resolution.allResolved}
                type="button"
                onClick={handleAddSubtitles}
              >
                <CirclePlus
                  aria-hidden="true"
                  className="ui-icon"
                  focusable="false"
                  size={18}
                />
                <span>添加字幕</span>
              </button>
            </footer>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
