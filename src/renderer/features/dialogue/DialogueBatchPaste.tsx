import { useMemo, useState, useSyncExternalStore } from 'react';
import type { Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { dialogueStore } from '../../stores/dialogueStore';
import {
  parseDialoguePaste,
  resolveDialoguePaste,
  type DialogueLineStatus,
} from './parseDialoguePaste';
import type { DialogueAuthoringDraft } from './dialogueAuthoringDraft';

const STATUS_LABEL: Record<DialogueLineStatus, string> = {
  valid: '解析成功',
  malformed: '缺少“角色：台词”分隔符',
  invalid: '角色或台词为空',
  unknown: '未知角色',
  ambiguous: '角色重名需映射',
};

/**
 * State E content inside the one shared authoring shell. Parsing and speaker
 * mapping remain transient DialogueAuthoringDraft state; the existing
 * DialogueStore.createMany path performs the sole, atomic History commit.
 */
export function DialogueBatchPaste({
  draft,
  onCancel,
  onSuccess,
}: {
  draft: DialogueAuthoringDraft;
  onCancel: () => void;
  onSuccess: () => void;
}): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const characters: readonly Character[] = snapshot?.project.characters ?? [];
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
  const unknownLines = parsed.lines.filter(
    (line) => line.status === 'unknown' || line.status === 'ambiguous',
  );

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
        nextError instanceof Error ? nextError.message : '批量提交失败。',
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
      <section className="dialogue-authoring-section dialogue-batch-input-section">
        <label htmlFor="dialogue-batch-input">
          批量文本
          <small>每行：角色：台词</small>
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
        <p className="dialogue-authoring-hint" id="dialogue-batch-format-hint">
          空行会被忽略；角色名需与现有角色一致，未知角色可在下方映射。
        </p>
      </section>

      <section className="dialogue-authoring-section dialogue-batch-preview-section">
        <h4>
          解析结果
          <small>{`共 ${parsed.lines.length} 条`}</small>
        </h4>
        <div className="dialogue-batch-table-wrap">
          <table className="dialogue-batch-table" data-testid="dialogue-batch-preview">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">说话人</th>
                <th scope="col">台词内容</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {parsed.lines.map((line, index) => {
                const mapped =
                  line.status !== 'valid' &&
                  resolution.resolvedLines[index] !== null;
                return (
                  <tr
                    data-status={mapped ? 'mapped' : line.status}
                    data-testid="dialogue-batch-line"
                    key={line.lineNumber}
                  >
                    <td>{line.lineNumber}</td>
                    <td>{line.speaker || '—'}</td>
                    <td>{line.text || line.raw}</td>
                    <td>
                      {line.status === 'valid'
                        ? '✓ 解析成功'
                        : mapped
                          ? '✓ 已映射'
                          : STATUS_LABEL[line.status]}
                    </td>
                  </tr>
                );
              })}
              {parsed.lines.length === 0 ? (
                <tr>
                  <td className="dialogue-batch-empty" colSpan={4}>
                    粘贴内容后，此处会逐行显示解析结果。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {unknownLines.length > 0 ? (
        <section
          className="dialogue-authoring-section dialogue-batch-mapping"
          data-testid="dialogue-batch-mapping"
        >
          <h4>
            未知角色映射
            <small>{unknownLines.length}</small>
          </h4>
          <div className="dialogue-batch-mapping-list">
            {unknownLines.map((line) => (
              <label key={line.lineNumber}>
                <span>{`未知角色：${line.speaker}`}</span>
                <select
                  aria-label={`将未知角色 ${line.speaker} 映射为`}
                  data-testid={`dialogue-batch-map-${line.lineNumber}`}
                  value={draftState.batchMapping[line.lineNumber] ?? ''}
                  onChange={(event) => {
                    setCommitError(null);
                    draft.setBatchMapping(line.lineNumber, event.target.value);
                  }}
                >
                  <option value="">请选择现有角色</option>
                  {characters.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="dialogue-authoring-section dialogue-batch-stats"
        data-testid="dialogue-batch-stats"
      >
        <h4>
          解析统计
        </h4>
        <dl>
          <div>
            <dt>总行数</dt>
            <dd>{parsed.lines.length}</dd>
          </div>
          <div>
            <dt>可提交</dt>
            <dd>{resolution.readyCount}</dd>
          </div>
          <div>
            <dt>解析失败</dt>
            <dd>{resolution.failureCount}</dd>
          </div>
          <div>
            <dt>未知角色</dt>
            <dd>{resolution.unknownCount}</dd>
          </div>
        </dl>
        {parsed.ignoredEmpty > 0 ? (
          <p className="dialogue-authoring-hint">
            {`已忽略 ${parsed.ignoredEmpty} 个空行。`}
          </p>
        ) : null}
      </section>

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
          className="dialogue-authoring-cancel"
          data-testid="dialogue-authoring-cancel"
          type="button"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          className="dialogue-authoring-submit"
          data-testid="dialogue-batch-commit"
          disabled={!resolution.allResolved}
          type="button"
          onClick={handleCommit}
        >
          {`提交 ${resolution.readyCount} 条字幕`}
        </button>
      </footer>
    </div>
  );
}
