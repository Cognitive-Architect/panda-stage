import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  AutoSubtitleAudioService,
  dialogueDraftSpeakerKey,
  formatAudioDurationMs,
  isAudioAssetReady,
  matchDialogueAudioRows,
  reconcileDialogueDraftRows,
  type AudioAsset,
  type Character,
  type DialogueAudioMatchRequest,
  type DialogueAudioScheduleRowInput,
  type DialogueDraftRowSeed,
  type StableDialogueDraftRow,
} from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueStore } from '../../stores/dialogueStore';
import { useTimelineUi } from '../timeline/timelineUiStore';
import {
  CharacterAvatar,
  CharacterIdentityPicker,
  getCharacterDefaultExpression,
  useCharacterAvatarThumbnails,
} from '../characters/CharacterIdentity';
import { CirclePlus, Mic, Volume2 } from 'lucide-react';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
  type ParsedDialogueLine,
} from './parseDialoguePaste';
import { NARRATOR_SPEAKER_NAME } from './dialogueSpeaker';
import type { DialogueAuthoringDraft } from './dialogueAuthoringDraft';

interface ManualAudioOverride {
  assetId: string | null;
  speakerKey: string;
}

const autoSubtitleAudioService = new AutoSubtitleAudioService();

function exceptionHeading(line: ParsedDialogueLine): string {
  if (line.status === 'malformed') return '这一行格式不对';
  if (line.status === 'invalid') {
    return line.reason === 'empty-speaker' ? '缺少角色名称' : '缺少台词内容';
  }
  return line.speaker ?? '未识别角色';
}

function exceptionDetail(line: ParsedDialogueLine): string | null {
  if (line.status === 'malformed') return '请写成「角色：台词」';
  if (line.status === 'unknown' || line.status === 'ambiguous') {
    return line.text ?? line.raw;
  }
  return null;
}

function mappingIssueCopy(line: ParsedDialogueLine): string {
  if (line.reason === 'narrator-name-conflict') {
    return '“旁白”与项目角色同名，请选择角色';
  }
  if (line.status === 'ambiguous') {
    return `“${line.speaker ?? '未识别角色'}”对应多个角色，请确认`;
  }
  return `未找到“${line.speaker ?? '未识别角色'}”`;
}

function formatAudioOptionLabel(asset: AudioAsset): string {
  if (!isAudioAssetReady(asset)) {
    return `${asset.name}（未就绪）`;
  }
  return `${asset.name}（${formatAudioDurationMs(asset.durationMs!)}）`;
}

/**
 * Production batch authoring surface. Parsing, speaker mapping, stable draft
 * row identity, audio matching, and real-duration timing preview remain
 * transient draft state; DialogueStore.createMany or DialogueStore.applyAudioBatch
 * performs the sole, atomic Project/History commit.
 */
export function DialogueBatchPaste({
  draft,
  onSuccess,
  showDefaultExpression = true,
}: {
  draft: DialogueAuthoringDraft;
  onSuccess: () => void;
  showDefaultExpression?: boolean;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const timelineUi = useTimelineUi();
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const audioAssets: readonly AudioAsset[] = useMemo(
    () =>
      (snapshot?.project.assets ?? []).filter(
        (asset): asset is AudioAsset => asset.kind === 'audio',
      ),
    [snapshot?.project.assets],
  );
  const {
    onThumbnailError: onCharacterThumbnailError,
    thumbnails: characterThumbnails,
  } = useCharacterAvatarThumbnails(snapshot, characters);
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [manualAudioByRowId, setManualAudioByRowId] = useState<
    Record<string, ManualAudioOverride>
  >({});
  const [confirmedExtensionToMs, setConfirmedExtensionToMs] = useState<
    number | null
  >(null);
  const previousStableRowsRef = useRef<readonly StableDialogueDraftRow[]>([]);
  const confirmedAudioByRowIdRef = useRef<
    Record<string, { assetId: string; speakerKey: string }>
  >({});
  const sessionKey = `${snapshot?.projectRoot ?? ''}::${currentShotId ?? ''}`;

  useEffect(() => {
    previousStableRowsRef.current = [];
    confirmedAudioByRowIdRef.current = {};
    setManualAudioByRowId({});
    setConfirmedExtensionToMs(null);
    setCommitError(null);
  }, [sessionKey]);

  const parsed = useMemo(
    () => parseDialoguePaste(draftState.batchRaw, characters),
    [draftState.batchRaw, characters],
  );
  const resolution = useMemo(
    () => resolveDialoguePaste(parsed, draftState.batchMapping, characters),
    [characters, draftState.batchMapping, parsed],
  );
  const hasContent = draftState.batchRaw.trim().length > 0;
  const pendingCount = Math.max(parsed.lines.length - resolution.readyCount, 0);

  const stableDraftRows = useMemo(() => {
    const seeds: DialogueDraftRowSeed[] = [];
    parsed.lines.forEach((line, index) => {
      const resolved = resolution.resolvedLines[index];
      if (!resolved) return;
      const isNarrator = resolved.speakerType === 'narrator';
      const character = resolved.characterId
        ? characters.find((candidate) => candidate.id === resolved.characterId)
        : undefined;
      if (!isNarrator && !character) return;
      seeds.push({
        sourceLineNumber: line.lineNumber,
        text: resolved.text,
        speakerType: isNarrator ? 'narrator' : 'character',
        ...(character ? { characterId: character.id } : {}),
        speakerName: isNarrator ? NARRATOR_SPEAKER_NAME : character!.name,
      });
    });
    const reconciled = reconcileDialogueDraftRows(
      previousStableRowsRef.current,
      seeds,
    );
    previousStableRowsRef.current = reconciled;
    return reconciled;
  }, [characters, parsed.lines, resolution.resolvedLines]);

  const matchReport = useMemo(() => {
    if (!snapshot || audioAssets.length === 0 || stableDraftRows.length === 0) {
      return null;
    }
    const requests: DialogueAudioMatchRequest[] = stableDraftRows.map(
      (row, index) => {
        const speakerKey = dialogueDraftSpeakerKey(row);
        const manual = manualAudioByRowId[row.draftRowId];
        const activeManual =
          manual && manual.speakerKey === speakerKey ? manual : undefined;
        const confirmed = confirmedAudioByRowIdRef.current[row.draftRowId];
        const activeConfirmedAssetId =
          row.confirmedAudioAssetId ??
          (confirmed && confirmed.speakerKey === speakerKey
            ? confirmed.assetId
            : undefined);
        return {
          draftRowId: row.draftRowId,
          ordinal: index + 1,
          sourceLineNumber: row.sourceLineNumber,
          text: row.text,
          speakerType: row.speakerType,
          ...(row.characterId ? { characterId: row.characterId } : {}),
          speakerName: row.speakerName,
          ...(row.existingDialogueId
            ? { existingDialogueId: row.existingDialogueId }
            : {}),
          ...(activeConfirmedAssetId !== undefined
            ? { confirmedAudioAssetId: activeConfirmedAssetId }
            : {}),
          ...(activeManual !== undefined
            ? { manualAudioAssetId: activeManual.assetId }
            : {}),
        };
      },
    );
    return matchDialogueAudioRows(snapshot.project, requests, {
      shotId: currentShotId ?? undefined,
    });
  }, [
    audioAssets.length,
    currentShotId,
    manualAudioByRowId,
    snapshot,
    stableDraftRows,
  ]);

  useEffect(() => {
    if (!matchReport) return;
    const nextConfirmed = { ...confirmedAudioByRowIdRef.current };
    for (const row of matchReport.rows) {
      if (row.ready && row.audioAssetId) {
        nextConfirmed[row.draftRowId] = {
          assetId: row.audioAssetId,
          speakerKey: dialogueDraftSpeakerKey(row),
        };
      }
    }
    confirmedAudioByRowIdRef.current = nextConfirmed;
  }, [matchReport]);

  const matchRowByLineNumber = useMemo(() => {
    const map = new Map<
      number,
      NonNullable<typeof matchReport>['rows'][number]
    >();
    matchReport?.rows.forEach((row) => {
      map.set(row.sourceLineNumber, row);
    });
    return map;
  }, [matchReport]);

  const readyScheduleRows: readonly DialogueAudioScheduleRowInput[] = useMemo(
    () =>
      (matchReport?.readyRows ?? []).map((row) => ({
        draftRowId: row.draftRowId,
        sourceLineNumber: row.sourceLineNumber,
        text: row.text,
        speakerType: row.speakerType,
        ...(row.characterId ? { characterId: row.characterId } : {}),
        ...(row.existingDialogueId
          ? { existingDialogueId: row.existingDialogueId }
          : {}),
        audioAssetId: row.audioAssetId!,
        sourceStartMs: row.sourceStartMs ?? 0,
        sourceEndMs: row.sourceEndMs ?? row.durationMs!,
      })),
    [matchReport],
  );

  const schedulePlan = useMemo(() => {
    if (!snapshot || !currentShotId || readyScheduleRows.length === 0) {
      return null;
    }
    return autoSubtitleAudioService.plan(snapshot.project, {
      shotId: currentShotId,
      startMs: timelineUi.currentTimeMs,
      rows: readyScheduleRows,
    });
  }, [currentShotId, readyScheduleRows, snapshot, timelineUi.currentTimeMs]);

  const plannedRowByDraftId = useMemo(() => {
    const map = new Map<
      string,
      NonNullable<typeof schedulePlan>['rows'][number]
    >();
    schedulePlan?.rows.forEach((row) => {
      map.set(row.draftRowId, row);
    });
    return map;
  }, [schedulePlan]);

  useEffect(() => {
    if (
      confirmedExtensionToMs !== null &&
      confirmedExtensionToMs !== schedulePlan?.extensionToMs
    ) {
      setConfirmedExtensionToMs(null);
    }
  }, [confirmedExtensionToMs, schedulePlan?.extensionToMs]);

  const handleCommit = (): void => {
    if (!resolution.allResolved) return;
    try {
      dialogueStore.createMany(
        resolution.resolvedLines.filter(
          (line): line is NonNullable<typeof line> => line !== null,
        ),
      );
      setCommitError(null);
      onSuccess();
    } catch (nextError) {
      setCommitError(
        nextError instanceof Error ? nextError.message : '批量添加失败。',
      );
    }
  };

  const handleAudioCommit = (): void => {
    if (!schedulePlan || !schedulePlan.ready || !matchReport) return;
    if (
      schedulePlan.needsShotExtension &&
      confirmedExtensionToMs !== schedulePlan.extensionToMs
    ) {
      return;
    }
    try {
      dialogueStore.applyAudioBatch({
        startMs: schedulePlan.startMs,
        rows: readyScheduleRows,
        ...(schedulePlan.needsShotExtension &&
        schedulePlan.extensionToMs !== null
          ? { extendShotToMs: schedulePlan.extensionToMs }
          : {}),
      });
      setCommitError(null);
      setConfirmedExtensionToMs(null);

      const committedLineNumbers = new Set(
        schedulePlan.rows.map((row) => row.sourceLineNumber),
      );
      const remainingLines = parsed.lines.filter(
        (line) => !committedLineNumbers.has(line.lineNumber),
      );
      if (remainingLines.length === 0) {
        onSuccess();
      } else {
        // Keep uncommitted/unready lines in draft while dropping committed rows.
        draft.setBatchRaw(remainingLines.map((line) => line.raw).join('\n'));
      }
    } catch (nextError) {
      setCommitError(
        nextError instanceof Error
          ? nextError.message
          : '生成字幕与配音失败。',
      );
    }
  };

  const extensionConfirmed =
    !schedulePlan?.needsShotExtension ||
    confirmedExtensionToMs === schedulePlan.extensionToMs;
  const canCommitAudio =
    Boolean(schedulePlan?.ready) &&
    readyScheduleRows.length > 0 &&
    extensionConfirmed;
  const hasAudioMode = audioAssets.length > 0;

  return (
    <div
      aria-labelledby="dialogue-authoring-tab-batch"
      className="dialogue-authoring-mode dialogue-authoring-batch"
      data-testid="dialogue-batch"
      id="dialogue-authoring-panel-batch"
      role="tabpanel"
    >
      <section className="dialogue-batch-input-section">
        <label id="dialogue-batch-format-hint" htmlFor="dialogue-batch-input">
          每行一条，格式：角色：台词 或 旁白：台词
        </label>
        <textarea
          aria-describedby="dialogue-batch-format-hint"
          aria-label="批量字幕原始文本"
          className="dialogue-batch-input"
          data-testid="dialogue-batch-input"
          id="dialogue-batch-input"
          placeholder={'Panda：你好呀\n旁白：十年前……'}
          rows={7}
          value={draftState.batchRaw}
          onChange={(event) => {
            setCommitError(null);
            draft.setBatchRaw(event.target.value);
          }}
        />
      </section>

      {hasContent ? (
        <>
          <div
            aria-label="批量字幕识别结果"
            className="dialogue-batch-recognition"
            data-testid="dialogue-batch-recognition"
            role="status"
          >
            <strong>识别结果</strong>
            <span className="dialogue-batch-recognition-ready">
              <span aria-hidden="true">✓</span>
              {`${resolution.readyCount} 条已识别`}
            </span>
            <span className="dialogue-batch-recognition-pending">
              <span aria-hidden="true">⚠</span>
              {`${pendingCount} 条待确认`}
            </span>
            {matchReport && matchReport.readyCount > 0 ? (
              <span
                className="dialogue-batch-recognition-audio"
                data-testid="dialogue-batch-audio-summary"
              >
                {`已配音 ${matchReport.readyCount} 条 · ${formatAudioDurationMs(matchReport.totalDurationMs)}`}
              </span>
            ) : null}
            {parsed.ignoredEmpty > 0 ? (
              <span className="dialogue-batch-recognition-ignored">
                {`已忽略 ${parsed.ignoredEmpty} 个空行`}
              </span>
            ) : null}
          </div>

          <ol
            aria-label="批量字幕识别结果"
            className="dialogue-batch-preview"
            data-testid="dialogue-batch-preview"
          >
            {parsed.lines.map((line, index) => {
              const resolved = resolution.resolvedLines[index];
              const needsMapping =
                line.status === 'unknown' || line.status === 'ambiguous';
              const resolvedNarration = resolved?.speakerType === 'narrator';
              const resolvedCharacter = resolved?.characterId
                ? characters.find(
                    (candidate) => candidate.id === resolved.characterId,
                  )
                : undefined;
              const resolvedRow =
                resolved && (resolvedNarration || resolvedCharacter)
                  ? { character: resolvedCharacter, line: resolved }
                  : null;
              const matchRow = matchRowByLineNumber.get(line.lineNumber);
              const plannedRow = matchRow
                ? plannedRowByDraftId.get(matchRow.draftRowId)
                : undefined;
              const rowSpeakerKey = matchRow
                ? dialogueDraftSpeakerKey(matchRow)
                : '';

              return (
                <li
                  data-audio-ready={
                    matchRow ? String(matchRow.ready) : undefined
                  }
                  data-status={
                    resolvedRow
                      ? needsMapping
                        ? 'mapped'
                        : 'valid'
                      : line.status
                  }
                  data-testid="dialogue-batch-line"
                  key={matchRow?.draftRowId ?? `line-${line.lineNumber}`}
                >
                  {resolvedRow ? (
                    <div className="dialogue-batch-row-result dialogue-batch-row-result-resolved">
                      <span
                        aria-label="已识别"
                        className="dialogue-batch-row-status"
                      >
                        ✓
                      </span>
                      {resolvedRow.character ? (
                        <CharacterAvatar
                          character={resolvedRow.character}
                          className="dialogue-batch-row-avatar"
                          onThumbnailError={onCharacterThumbnailError}
                          thumbnail={
                            characterThumbnails[
                              getCharacterDefaultExpression(
                                resolvedRow.character,
                              )?.assetId ?? ''
                            ]
                          }
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          className="dialogue-batch-row-avatar dialogue-batch-row-avatar-narrator"
                        >
                          <Mic size={16} strokeWidth={1.8} />
                        </span>
                      )}
                      <div className="dialogue-batch-row-copy">
                        <strong>
                          {resolvedRow.character?.name ?? NARRATOR_SPEAKER_NAME}
                        </strong>
                        <span>{resolvedRow.line.text}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="dialogue-batch-row-result dialogue-batch-row-result-exception">
                      <span
                        aria-hidden="true"
                        className="dialogue-batch-row-status"
                      >
                        ⚠
                      </span>
                      <div className="dialogue-batch-row-copy">
                        <strong>{exceptionHeading(line)}</strong>
                        {exceptionDetail(line) ? (
                          <span>{exceptionDetail(line)}</span>
                        ) : null}
                      </div>
                    </div>
                  )}

                  {hasAudioMode && matchRow ? (
                    <div
                      className="dialogue-batch-audio-row"
                      data-testid={`dialogue-batch-audio-row-${line.lineNumber}`}
                    >
                      <Volume2
                        aria-hidden="true"
                        className="dialogue-batch-audio-icon"
                        size={14}
                        strokeWidth={1.8}
                      />
                      <select
                        aria-label={`第 ${line.lineNumber} 行配音`}
                        className="dialogue-batch-audio-select"
                        data-testid={`dialogue-batch-audio-${line.lineNumber}`}
                        value={matchRow.audioAssetId ?? ''}
                        onChange={(event) => {
                          setCommitError(null);
                          const value = event.target.value;
                          setManualAudioByRowId((prev) => ({
                            ...prev,
                            [matchRow.draftRowId]: {
                              assetId: value === '' ? null : value,
                              speakerKey: rowSpeakerKey,
                            },
                          }));
                        }}
                      >
                        <option value="">未选择配音（留草稿）</option>
                        {audioAssets.map((asset) => (
                          <option key={asset.id} value={asset.id}>
                            {formatAudioOptionLabel(asset)}
                          </option>
                        ))}
                      </select>
                      {matchRow.ready && matchRow.durationMs !== null ? (
                        <span
                          className="dialogue-batch-audio-timing"
                          data-testid={`dialogue-batch-audio-timing-${line.lineNumber}`}
                        >
                          {plannedRow
                            ? `${formatAudioDurationMs(plannedRow.startMs)}–${formatAudioDurationMs(plannedRow.endMs)} · ${formatAudioDurationMs(matchRow.durationMs)}`
                            : formatAudioDurationMs(matchRow.durationMs)}
                        </span>
                      ) : matchRow.issueMessage ? (
                        <span
                          className="dialogue-batch-audio-issue"
                          data-testid={`dialogue-batch-audio-issue-${line.lineNumber}`}
                        >
                          {matchRow.issueMessage}
                        </span>
                      ) : null}
                    </div>
                  ) : null}

                  {needsMapping && !resolvedRow ? (
                    <div className="dialogue-batch-row-resolution">
                      <p className="dialogue-batch-row-issue">
                        <strong>{mappingIssueCopy(line)}</strong>
                      </p>
                      <CharacterIdentityPicker
                        ariaLabel={`为${line.speaker ?? '未识别角色'}选择对应角色`}
                        characters={characters}
                        className="dialogue-batch-character-picker"
                        emptySummaryDescription={null}
                        emptySummaryLabel="请选择对应角色"
                        onClear={() => {
                          setCommitError(null);
                          draft.setBatchMapping(line.lineNumber, '');
                        }}
                        onSelect={(characterId) => {
                          setCommitError(null);
                          draft.setBatchMapping(line.lineNumber, characterId);
                        }}
                        onThumbnailError={onCharacterThumbnailError}
                        selectedCharacterId={
                          draftState.batchMapping[line.lineNumber] ?? null
                        }
                        selectedLabel="当前绑定"
                        showDefaultExpression={showDefaultExpression}
                        data-testid={`dialogue-batch-map-${line.lineNumber}`}
                        thumbnails={characterThumbnails}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {schedulePlan && schedulePlan.blockers.length > 0 ? (
            <div
              className="dialogue-batch-audio-alerts"
              data-testid="dialogue-batch-audio-conflict"
              role="alert"
            >
              {schedulePlan.blockers.map((blocker, idx) => (
                <p key={`${blocker.code}-${blocker.sourceLineNumber ?? idx}`}>
                  {blocker.message}
                </p>
              ))}
            </div>
          ) : null}

          {schedulePlan?.needsShotExtension &&
          schedulePlan.extensionToMs !== null ? (
            <label
              className="dialogue-batch-extend-confirm"
              data-testid="dialogue-batch-extend-confirm"
            >
              <input
                checked={
                  confirmedExtensionToMs === schedulePlan.extensionToMs
                }
                type="checkbox"
                onChange={(event) => {
                  setCommitError(null);
                  setConfirmedExtensionToMs(
                    event.target.checked ? schedulePlan.extensionToMs : null,
                  );
                }}
              />
              <span>
                {`当前镜头时长 ${formatAudioDurationMs(schedulePlan.shotDurationMs)} 不足，确认延长至 ${formatAudioDurationMs(schedulePlan.extensionToMs)}`}
              </span>
            </label>
          ) : null}

          {matchReport &&
          matchReport.hasCommitableSubset &&
          matchReport.draftCount > 0 ? (
            <p
              className="dialogue-batch-subset-note"
              data-testid="dialogue-batch-subset-note"
            >
              {`可先生成 ${matchReport.readyCount} 条就绪配音，其余 ${matchReport.draftCount} 条将保留在草稿。`}
            </p>
          ) : null}

          {commitError ? (
            <p className="dialogue-authoring-error" role="alert">
              {commitError}
            </p>
          ) : null}

          <footer
            className="dialogue-authoring-footer dialogue-batch-footer-actions"
            data-testid="dialogue-authoring-footer"
          >
            {hasAudioMode ? (
              <button
                className="dialogue-authoring-submit dialogue-batch-submit dialogue-batch-audio-submit"
                data-testid="dialogue-batch-audio-commit"
                disabled={!canCommitAudio}
                type="button"
                onClick={handleAudioCommit}
              >
                <Volume2
                  aria-hidden="true"
                  className="ui-icon"
                  focusable="false"
                  size={18}
                />
                <span>
                  {matchReport && matchReport.readyCount > 0
                    ? matchReport.draftCount > 0
                      ? `生成 ${matchReport.readyCount} 条有效字幕与配音`
                      : `生成 ${matchReport.readyCount} 条字幕与配音`
                    : '生成字幕与配音'}
                </span>
              </button>
            ) : null}
            <button
              className={`dialogue-authoring-submit dialogue-batch-submit${
                hasAudioMode ? ' dialogue-batch-plain-submit' : ''
              }`}
              data-testid="dialogue-batch-commit"
              disabled={!resolution.allResolved}
              type="button"
              onClick={handleCommit}
            >
              {resolution.allResolved ? (
                <>
                  <CirclePlus
                    aria-hidden="true"
                    className="ui-icon"
                    focusable="false"
                    size={18}
                  />
                  <span>{`添加 ${resolution.readyCount} 条字幕`}</span>
                </>
              ) : (
                <span>{`还有 ${pendingCount} 条待确认`}</span>
              )}
            </button>
          </footer>
        </>
      ) : null}
    </div>
  );
}
