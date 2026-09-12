import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import {
  CharacterIdentityPicker,
  useCharacterAvatarThumbnails,
} from '../characters/CharacterIdentity';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
  type ParsedDialogueLine,
} from './parseDialoguePaste';
import type { DialogueAuthoringDraft } from './dialogueAuthoringDraft';

function issueCopy(line: ParsedDialogueLine): React.JSX.Element | null {
  if (line.status === 'malformed') {
    return (
      <p className="dialogue-batch-row-issue">
        <strong>这一行格式不对</strong>
        <span>请写成「角色：台词」</span>
      </p>
    );
  }
  if (line.status === 'invalid') {
    return (
      <p className="dialogue-batch-row-issue">
        <strong>
          {line.speaker ? '这行还没有台词内容' : '这行还没有角色名称'}
        </strong>
      </p>
    );
  }
  return null;
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
  const needsAttention = resolution.failureCount + resolution.unknownCount;

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
          <p
            className="dialogue-batch-recognition"
            data-testid="dialogue-batch-recognition"
            role="status"
          >
            {needsAttention > 0
              ? `已识别 ${resolution.readyCount} 条 · ${needsAttention} 条需要确认`
              : `✓ 已识别 ${resolution.readyCount} 条字幕`}
            {parsed.ignoredEmpty > 0
              ? ` · 已忽略 ${parsed.ignoredEmpty} 个空行`
              : ''}
          </p>

          <ol
            aria-label="批量字幕识别结果"
            className="dialogue-batch-preview"
            data-testid="dialogue-batch-preview"
          >
            {parsed.lines.map((line, index) => {
              const resolved = resolution.resolvedLines[index];
              const resolvedSpeakerName = resolved
                ? characters.find(
                    (candidate) => candidate.id === resolved.characterId,
                  )?.name
                : undefined;
              const needsMapping =
                line.status === 'unknown' || line.status === 'ambiguous';
              const mapped = needsMapping && resolved !== null;
              return (
                <li
                  data-status={mapped ? 'mapped' : line.status}
                  data-testid="dialogue-batch-line"
                  key={line.lineNumber}
                >
                  <div className="dialogue-batch-row-copy">
                    <strong>
                      {resolvedSpeakerName || line.speaker || '未识别角色'}
                    </strong>
                    <span>{line.text || line.raw}</span>
                  </div>
                  {needsMapping && !mapped ? (
                    <div className="dialogue-batch-row-resolution">
                      <p className="dialogue-batch-row-issue">
                        <strong>没找到这个角色</strong>
                      </p>
                      <div className="dialogue-batch-character-mapping">
                        <span>对应为</span>
                        <CharacterIdentityPicker
                          ariaLabel={`将未知角色 ${line.speaker} 映射为`}
                          characters={characters}
                          className="dialogue-batch-character-picker"
                          emptySummaryDescription="选择要对应的角色"
                          emptySummaryLabel="选择角色"
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
                          selectedLabel="已映射角色"
                          showDefaultExpression={showDefaultExpression}
                          data-testid={`dialogue-batch-map-${line.lineNumber}`}
                          thumbnails={characterThumbnails}
                        />
                      </div>
                    </div>
                  ) : (
                    issueCopy(line)
                  )}
                </li>
              );
            })}
          </ol>

          {!resolution.allResolved ? (
            <p className="dialogue-batch-commit-hint">
              请先处理上方需要确认的字幕。
            </p>
          ) : null}
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
              className="dialogue-authoring-submit"
              data-testid="dialogue-batch-commit"
              disabled={!resolution.allResolved}
              type="button"
              onClick={handleCommit}
            >
              {`添加 ${resolution.readyCount} 条字幕`}
            </button>
          </footer>
        </>
      ) : null}
    </div>
  );
}
