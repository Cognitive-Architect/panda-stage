import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import {
  CharacterAvatar,
  CharacterIdentityPicker,
  getCharacterDefaultExpression,
  useCharacterAvatarThumbnails,
} from '../characters/CharacterIdentity';
import { CirclePlus } from 'lucide-react';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
  type ParsedDialogueLine,
} from './parseDialoguePaste';
import type { DialogueAuthoringDraft } from './dialogueAuthoringDraft';

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
  if (line.status === 'ambiguous') {
    return `“${line.speaker ?? '未识别角色'}”对应多个角色，请确认`;
  }
  return `未找到“${line.speaker ?? '未识别角色'}”`;
}

/**
 * Production batch authoring surface. Parsing and explicit speaker mapping
 * remain transient draft state; DialogueStore.createMany performs the sole,
 * atomic Project/History commit.
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
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const {
    onThumbnailError: onCharacterThumbnailError,
    thumbnails: characterThumbnails,
  } = useCharacterAvatarThumbnails(snapshot, characters);
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [commitError, setCommitError] = useState<string | null>(null);

  const parsed = useMemo(
    () => parseDialoguePaste(draftState.batchRaw, characters),
    [draftState.batchRaw, characters],
  );
  const resolution = useMemo(
    () =>
      resolveDialoguePaste(parsed, draftState.batchMapping, characters),
    [characters, draftState.batchMapping, parsed],
  );
  const hasContent = draftState.batchRaw.trim().length > 0;
  const pendingCount = Math.max(parsed.lines.length - resolution.readyCount, 0);

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
            {parsed.ignoredEmpty > 0
              ? (
                <span className="dialogue-batch-recognition-ignored">
                  {`已忽略 ${parsed.ignoredEmpty} 个空行`}
                </span>
              )
              : null}
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
              const resolvedCharacter = resolved
                ? characters.find(
                    (candidate) => candidate.id === resolved.characterId,
                  )
                : undefined;
              const resolvedRow =
                resolved && resolvedCharacter
                  ? { character: resolvedCharacter, line: resolved }
                  : null;
              return (
                <li
                  data-status={
                    resolvedRow ? (needsMapping ? 'mapped' : 'valid') : line.status
                  }
                  data-testid="dialogue-batch-line"
                  key={line.lineNumber}
                >
                  {resolvedRow ? (
                    <div className="dialogue-batch-row-result dialogue-batch-row-result-resolved">
                      <span
                        aria-label="已识别"
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

          {commitError ? (
            <p className="dialogue-authoring-error" role="alert">
              {commitError}
            </p>
          ) : null}
          <footer
            className="dialogue-authoring-footer"
            data-testid="dialogue-authoring-footer"
          >
            <button
              className="dialogue-authoring-submit dialogue-batch-submit"
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
