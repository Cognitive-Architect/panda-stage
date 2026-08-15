import { useMemo, useSyncExternalStore } from 'react';
import type { Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import {
  parseDialoguePaste,
  type DialogueLineStatus,
} from './parseDialoguePaste';
import type { DialogueAuthoringDraft } from './dialogueAuthoringDraft';

const STATUS_LABEL: Record<DialogueLineStatus, string> = {
  valid: '有效',
  malformed: '缺少“角色：台词”分隔符',
  invalid: '角色或台词为空',
  unknown: '未知角色',
  ambiguous: '角色重名需手动指定',
};

/**
 * Batch paste surface. Parsing and preview are pure UI state and never touch the
 * project, the History or the dirty flag. Unknown speakers are mapped manually;
 * only when every line is resolved does the commit button enable, and the whole
 * batch becomes a single History command. The draft (raw text + manual mapping)
 * is owned by the DialogueAuthoringDraft bound to the current shot, so it is
 * cleared on shot/project switch and on close.
 */
export function DialogueBatchPaste({
  draft,
  onClose,
}: {
  draft: DialogueAuthoringDraft;
  onClose: () => void;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);

  const parsed = useMemo(
    () => parseDialoguePaste(draftState.batchRaw, characters),
    [draftState.batchRaw, characters],
  );

  const resolvedLines = parsed.lines.map((line) => {
    if (line.status === 'valid') {
      return { characterId: line.characterId!, text: line.text! };
    }
    if (
      (line.status === 'unknown' || line.status === 'ambiguous') &&
      draftState.batchMapping[line.lineNumber]
    ) {
      return {
        characterId: draftState.batchMapping[line.lineNumber]!,
        text: line.text!,
      };
    }
    return null;
  });
  const allResolved =
    parsed.lines.length > 0 && resolvedLines.every((line) => line !== null);
  const resolvedCount = resolvedLines.filter((line) => line !== null).length;

  const handleCommit = (): void => {
    if (!allResolved) return;
    dialogueStore.createMany(
      resolvedLines as { characterId: string; text: string }[],
    );
    onClose();
  };

  return (
    <div className="dialogue-batch" data-testid="dialogue-batch">
      <header className="dialogue-batch-header">
        <h4>批量粘贴对白</h4>
        <button
          type="button"
          data-testid="dialogue-batch-close"
          onClick={onClose}
        >
          关闭
        </button>
      </header>
      <textarea
        data-testid="dialogue-batch-input"
        className="dialogue-batch-input"
        rows={8}
        placeholder="每行：角色名：台词"
        value={draftState.batchRaw}
        onChange={(event) => draft.setBatchRaw(event.target.value)}
      />
      <p className="dialogue-batch-summary" data-testid="dialogue-batch-summary">
        {`共 ${parsed.lines.length} 行，有效 ${parsed.validCount} 行，忽略空行 ${parsed.ignoredEmpty} 行。`}
      </p>
      <ul
        className="dialogue-batch-preview"
        data-testid="dialogue-batch-preview"
      >
        {parsed.lines.map((line) => (
          <li
            key={line.lineNumber}
            data-status={line.status}
            data-testid="dialogue-batch-line"
          >
            <span className="dialogue-batch-lineno">{line.lineNumber}</span>
            {line.status === 'valid' ? (
              <span className="dialogue-batch-valid">
                {`${line.speaker}：${line.text}`}
              </span>
            ) : (
              <>
                <span className="dialogue-batch-issue">
                  {`${STATUS_LABEL[line.status]}：${line.raw}`}
                </span>
                {(line.status === 'unknown' ||
                  line.status === 'ambiguous') && (
                  <select
                    data-testid={`dialogue-batch-map-${line.lineNumber}`}
                    className="dialogue-batch-map"
                    value={draftState.batchMapping[line.lineNumber] ?? ''}
                    onChange={(event) =>
                      draft.setBatchMapping(line.lineNumber, event.target.value)
                    }
                  >
                    <option value="">手动映射到…</option>
                    {characters.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                )}
              </>
            )}
          </li>
        ))}
        {parsed.lines.length === 0 && (
          <li className="dialogue-batch-empty">粘贴内容后此处显示预览。</li>
        )}
      </ul>
      <button
        type="button"
        className="dialogue-batch-commit"
        data-testid="dialogue-batch-commit"
        disabled={!allResolved}
        onClick={handleCommit}
      >
        {`提交 ${resolvedCount} 条`}
      </button>
    </div>
  );
}
