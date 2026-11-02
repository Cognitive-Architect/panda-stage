import { useMemo, useSyncExternalStore } from 'react';
import type { AudioAsset, Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
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

/**
 * Production batch authoring surface. Parsing, role mapping, audio selection,
 * and the generation plan remain transient draft state; this surface does not
 * create Dialogue or AudioClip records.
 */
export function DialogueBatchPaste({
  draft,
  showDefaultExpression = true,
}: {
  draft: DialogueAuthoringDraft;
  showDefaultExpression?: boolean;
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
    () =>
      buildDialogueBatchPreview({
        parsed,
        resolution,
        characters,
        audioAssets,
        audioSelections: draftState.batchAudioSelections,
      }),
    [
      audioAssets,
      characters,
      draftState.batchAudioSelections,
      parsed,
      resolution,
    ],
  );
  const hasContent = draftState.batchRaw.trim().length > 0;
  const audioUse = new Map<string, number[]>();
  preview.rows.forEach((row) => {
    if (!row.audioAsset) return;
    const lineNumbers = audioUse.get(row.audioAsset.id) ?? [];
    lineNumbers.push(row.sourceLineNumber);
    audioUse.set(row.audioAsset.id, lineNumbers);
  });

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
          每行一条，格式：角色：台词
        </label>
        <textarea
          aria-describedby="dialogue-batch-format-hint"
          aria-label="批量字幕原始文本"
          className="dialogue-batch-input"
          data-testid="dialogue-batch-input"
          id="dialogue-batch-input"
          placeholder={'Panda：你好呀\n角色B：这是第二行台词'}
          rows={7}
          value={draftState.batchRaw}
          onChange={(event) => {
            draft.setBatchRaw(event.target.value);
          }}
        />
      </section>

      {hasContent ? (
        <>
          <div
            aria-label="批量字幕候选状态"
            className="dialogue-batch-recognition"
            data-testid="dialogue-batch-recognition"
          >
            <strong>候选预览</strong>
            <span className="dialogue-batch-recognition-ready">
              {`${preview.readyCount} 条可生成`}
            </span>
            <span className="dialogue-batch-recognition-pending">
              {`${preview.pendingCount} 条待处理`}
            </span>
            <span className="dialogue-batch-recognition-duration">
              {`${preview.allReady ? '总时长' : '已确认时长'} ${formatDialogueDuration(preview.totalDurationMs)}`}
            </span>
            {parsed.ignoredEmpty > 0 ? (
              <span className="dialogue-batch-recognition-ignored">
                {`已跳过 ${parsed.ignoredEmpty} 个空行`}
              </span>
            ) : null}
          </div>

          <ol
            aria-label="按粘贴顺序排列的字幕候选"
            className="dialogue-batch-preview"
            data-testid="dialogue-batch-preview"
          >
            {parsed.lines.map((line, index) => {
              const row = preview.rows[index]!;
              const resolved = resolution.resolvedLines[index];
              const needsMapping =
                line.status === 'unknown' || line.status === 'ambiguous';
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
                ? selection?.assetId === row.automaticAsset?.id && row.automaticAsset
                  ? AUTOMATIC_AUDIO_VALUE
                  : selection?.assetId ?? ''
                : selection
                  ? ''
                  : row.automaticAsset
                    ? AUTOMATIC_AUDIO_VALUE
                    : '';
              const mapped = needsMapping && resolvedRow;
              const rowStatus = !resolvedRow
                ? line.status
                : row.issue
                  ? 'audio-invalid'
                  : mapped
                    ? 'mapped'
                    : 'valid';
              const issueId = `dialogue-batch-issue-${line.lineNumber}`;

              return (
                <li
                  data-status={rowStatus}
                  data-audio-asset-id={row.audioAssetId ?? ''}
                  data-source-duration-ms={row.sourceDurationMs ?? ''}
                  data-clip-duration-ms={row.durationMs ?? ''}
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
                        >
                          ✓
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

                  {needsMapping && !resolvedRow ? (
                    <div className="dialogue-batch-row-resolution">
                      <p className="dialogue-batch-row-issue">
                        <strong>{mappingIssueCopy(line)}</strong>
                      </p>
                      <CharacterIdentityPicker
                        ariaLabel={`为「${line.speaker ?? '未识别角色'}」选择对应角色`}
                        characters={characters}
                        className="dialogue-batch-character-picker"
                        emptySummaryDescription={null}
                        emptySummaryLabel="请选择对应角色"
                        onClear={() => {
                          draft.setBatchMapping(line.lineNumber, '');
                        }}
                        onSelect={(characterId) => {
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

                  {resolvedRow ? (
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
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <footer
            className="dialogue-authoring-footer"
            data-testid="dialogue-authoring-footer"
          >
            <output
              aria-live="polite"
              className="dialogue-batch-generation-state"
              data-testid="dialogue-batch-generation-state"
            >
              {preview.allReady
                ? `可生成 ${preview.readyCount} 条字幕`
                : `还有 ${preview.pendingCount} 条待处理`}
            </output>
          </footer>
        </>
      ) : null}
    </div>
  );
}
