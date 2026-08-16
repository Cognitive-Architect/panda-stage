import {
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Character } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { dialogueSelectionStore } from '../../stores/dialogueSelectionStore';
import { dialogueStore } from '../../stores/dialogueStore';
import {
  DialogueAuthoringDraft,
} from './dialogueAuthoringDraft';
import { DialogueBatchPaste } from './DialogueBatchPaste';

/**
 * Dialogue Sheet: lists the current shot's dialogues, offers a single-line add
 * form and a batch-paste entry point. Rendered as a child of the single
 * TimelineDock so there is exactly one Timeline surface. Selecting a dialogue
 * here clears the layer selection and routes the RightInspector to the
 * DialogueInspector.
 *
 * All uncommitted authoring inputs live in a single draft bound to the
 * (projectRoot, shotId) identity; switching shot or project clears the draft so
 * a Shot A draft can never be committed into Shot B.
 */
export function DialogueSheet(): React.JSX.Element {
  const snapshot = useSyncExternalStore(
    editorProjectStore.subscribe,
    editorProjectStore.getSnapshot,
  );
  const currentShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
  );
  const selectedDialogueId = useSyncExternalStore(
    dialogueSelectionStore.subscribe,
    dialogueSelectionStore.getSelectedDialogueId,
  );
  const [draft] = useState(() => new DialogueAuthoringDraft());
  const draftState = useSyncExternalStore(draft.subscribe, draft.getSnapshot);
  const [authoringError, setAuthoringError] = useState<string | null>(null);

  const projectRoot = snapshot?.projectRoot ?? '';
  const shotId = currentShotId ?? null;
  useEffect(() => {
    draft.bindIdentity({ projectRoot, shotId });
  }, [draft, projectRoot, shotId]);

  const characters: readonly Character[] = snapshot?.project.characters ?? [];
  const shot = snapshot?.project.shots.find(
    (candidate) => candidate.id === currentShotId,
  );
  const dialogues = shot?.dialogues ?? [];
  const canAdd =
    draftState.singleCharacterId !== '' &&
    draftState.singleText.trim().length > 0;

  if (!shot) {
    return (
      <div className="dialogue-sheet" data-testid="dialogue-sheet">
        <p>请选择一个镜头以编辑对白。</p>
      </div>
    );
  }

  const handleAdd = (): void => {
    if (!canAdd) return;
    try {
      dialogueStore.create(draftState.singleCharacterId, draftState.singleText.trim());
      draft.setSingleText('');
      setAuthoringError(null);
    } catch (error) {
      setAuthoringError(error instanceof Error ? error.message : '对白时间段无效。');
    }
  };

  const characterName = (id: string): string =>
    characters.find((candidate) => candidate.id === id)?.name ?? id;

  return (
    <div className="dialogue-sheet" data-testid="dialogue-sheet">
      <header className="dialogue-sheet-header">
        <h3>对白表</h3>
        <button
          type="button"
          data-testid="dialogue-batch-open"
          onClick={() => draft.openBatch()}
        >
          批量粘贴
        </button>
      </header>
      <ul className="dialogue-list" data-testid="dialogue-list">
        {dialogues.map((dialogue) => (
          <li
            key={dialogue.id}
            data-testid="dialogue-list-item"
            data-selected={dialogue.id === selectedDialogueId}
            className={
              dialogue.id === selectedDialogueId
                ? 'dialogue-list-item selected'
                : 'dialogue-list-item'
            }
            onClick={() => dialogueSelectionStore.select(dialogue.id)}
          >
            <span className="dialogue-speaker">
              {characterName(dialogue.characterId)}
            </span>
            <span className="dialogue-text">{dialogue.text}</span>
          </li>
        ))}
        {dialogues.length === 0 && (
          <li className="dialogue-empty">暂无对白，粘贴或新增一条开始。</li>
        )}
      </ul>
      <div className="dialogue-add">
        <select
          data-testid="dialogue-add-speaker"
          value={draftState.singleCharacterId}
          onChange={(event) => draft.setSingleCharacterId(event.target.value)}
        >
          <option value="">选择角色…</option>
          {characters.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        <input
          data-testid="dialogue-add-text"
          value={draftState.singleText}
          placeholder="输入台词…"
          onChange={(event) => draft.setSingleText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && canAdd) handleAdd();
          }}
        />
        <button
          type="button"
          data-testid="dialogue-add"
          disabled={!canAdd}
          onClick={handleAdd}
        >
          新增
        </button>
      </div>
      {authoringError ? (
        <p className="dialogue-editor-error" data-testid="dialogue-authoring-error" role="alert">
          {authoringError}
        </p>
      ) : null}
      {draftState.batchOpen && (
        <DialogueBatchPaste draft={draft} onClose={() => draft.closeBatch()} />
      )}
    </div>
  );
}
