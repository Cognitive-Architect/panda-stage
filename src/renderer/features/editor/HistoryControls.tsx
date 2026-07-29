import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  editorProjectStore,
  historyStore,
} from '../../stores/EditorProjectStore';
import { useHistoryShortcuts } from './useHistoryShortcuts';

export function HistoryControls(): React.JSX.Element {
  const history = useSyncExternalStore(
    historyStore.subscribe,
    historyStore.getSnapshot,
  );
  const [status, setStatus] = useState(
    'Ctrl+Z 撤销；Ctrl+Y 或 Ctrl+Shift+Z 重做。',
  );
  const undo = useCallback(() => {
    const label = historyStore.getSnapshot().nextUndoLabel;
    setStatus(
      editorProjectStore.undo()
        ? `已撤销：${label ?? '编辑操作'}`
        : '没有可撤销的操作。',
    );
  }, []);
  const redo = useCallback(() => {
    const label = historyStore.getSnapshot().nextRedoLabel;
    setStatus(
      editorProjectStore.redo()
        ? `已重做：${label ?? '编辑操作'}`
        : '没有可重做的操作。',
    );
  }, []);
  useEffect(() => {
    if (history.undoCount === 0 && history.redoCount === 0) {
      setStatus('当前项目尚无可撤销操作。');
    }
  }, [history.redoCount, history.undoCount]);
  useHistoryShortcuts(undo, redo);

  return (
    <section
      className="history-controls"
      data-history-depth={historyStore.maxDepth}
      data-redo-count={history.redoCount}
      data-testid="history-controls"
      data-undo-count={history.undoCount}
    >
      <div>
        <p className="eyebrow">编辑历史</p>
        <h3>编辑历史</h3>
      </div>
      <div className="history-actions">
        <button
          disabled={history.undoCount === 0}
          onClick={undo}
          title={history.nextUndoLabel ?? '没有可撤销的操作'}
          type="button"
        >
          撤销
        </button>
        <button
          disabled={history.redoCount === 0}
          onClick={redo}
          title={history.nextRedoLabel ?? '没有可重做的操作'}
          type="button"
        >
          重做
        </button>
        <span>
          {history.undoCount} 可撤销 · {history.redoCount} 可重做
        </span>
      </div>
      <output data-testid="history-status">{status}</output>
    </section>
  );
}
