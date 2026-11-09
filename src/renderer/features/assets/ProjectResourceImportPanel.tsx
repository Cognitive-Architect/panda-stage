import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type {
  ProjectResourceImportOption,
  ProjectResourceImportSelection,
  ProjectResourceImportTarget,
} from '../../../shared/project-resource-import-api';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { DecorativeIcon } from '../../ui';

interface SelectionState {
  sourceToken: string;
  sourceProjectName: string;
  items: ProjectResourceImportOption[];
  target: ProjectResourceImportTarget;
}

export interface ProjectResourceImportPanelProps {
  snapshot: EditorProjectSnapshot | null;
  disabled?: boolean;
  onImported: () => void;
  onStatus: (message: string) => void;
}

export function ProjectResourceImportPanel({
  snapshot,
  disabled = false,
  onImported,
  onStatus,
}: ProjectResourceImportPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState('');
  const operationId = useRef(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const wasOpen = useRef(false);
  const activeProjectIdentity = useRef(
    `${snapshot?.projectRoot ?? ''}\u0000${snapshot?.project.id ?? ''}`,
  );

  const closeSelection = useCallback((): void => {
    if (busy) return;
    setSelection(null);
    setSelectedKeys(new Set());
    setError('');
  }, [busy]);

  useEffect(() => {
    const identity = `${snapshot?.projectRoot ?? ''}\u0000${snapshot?.project.id ?? ''}`;
    const activeIdentity = activeProjectIdentity.current;
    if (activeIdentity === identity) return;
    activeProjectIdentity.current = identity;
    operationId.current += 1;
    setBusy(false);
    setSelection(null);
    setSelectedKeys(new Set());
    setError('');
  }, [snapshot?.project.id, snapshot?.projectRoot]);

  useEffect(() => {
    if (!selection) {
      if (wasOpen.current) triggerRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const firstControl = dialogRef.current?.querySelector<HTMLElement>(
      'input:not(:disabled), button:not(:disabled)',
    );
    firstControl?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        closeSelection();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'input:not(:disabled), button:not(:disabled)',
        ),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, closeSelection, selection]);

  const chooseSource = async (): Promise<void> => {
    const current = editorProjectStore.getSnapshot();
    if (!current) return;
    const requestId = ++operationId.current;
    const target: ProjectResourceImportTarget = {
      projectRoot: current.projectRoot,
      project: current.project,
      baseRevision: current.revision,
    };
    setBusy(true);
    setError('');
    try {
      const response = await window.pandaStage.assets.chooseProjectResources(target);
      if (operationId.current !== requestId) return;
      const latest = editorProjectStore.getSnapshot();
      if (
        !latest ||
        latest.projectRoot !== target.projectRoot ||
        latest.project.id !== target.project.id
      ) {
        return;
      }
      if (!response.ok) {
        setError(formatImportError(response.error));
        return;
      }
      if (response.status === 'cancelled') return;
      if (response.status !== 'selected') return;
      setSelection({
        sourceToken: response.sourceToken,
        sourceProjectName: response.sourceProjectName,
        items: response.items,
        target,
      });
      setSelectedKeys(new Set());
    } catch (cause) {
      if (operationId.current === requestId) {
        setError(cause instanceof Error ? cause.message : '无法读取来源项目。');
      }
    } finally {
      if (operationId.current === requestId) setBusy(false);
    }
  };

  const updateSelection = (
    item: ProjectResourceImportOption,
    checked: boolean,
  ): void => {
    const key = resourceKey(item);
    if (checked && selectedKeys.size >= 100) {
      setError('一次最多选择 100 项。');
      return;
    }
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      setError('');
      return next;
    });
  };

  const importSelected = async (): Promise<void> => {
    if (!selection || selectedKeys.size === 0) return;
    const current = editorProjectStore.getSnapshot();
    if (
      !current ||
      current.projectRoot !== selection.target.projectRoot ||
      current.project.id !== selection.target.project.id ||
      current.revision !== selection.target.baseRevision ||
      JSON.stringify(current.project) !== JSON.stringify(selection.target.project)
    ) {
      setError('目标项目已发生变化，请关闭此窗口后重新选择来源项目。');
      return;
    }
    const requestId = ++operationId.current;
    const resources: ProjectResourceImportSelection[] = selection.items
      .filter((item) => selectedKeys.has(resourceKey(item)))
      .map(({ kind, id }) => ({ kind, id }));
    setBusy(true);
    setError('');
    try {
      const response = await window.pandaStage.assets.importProjectResources({
        ...selection.target,
        sourceToken: selection.sourceToken,
        resources,
      });
      if (operationId.current !== requestId) return;
      if (!response.ok) {
        setError(formatImportError(response.error));
        return;
      }
      if (response.status !== 'completed') return;
      const latest = editorProjectStore.getSnapshot();
      if (
        !latest ||
        latest.projectRoot !== selection.target.projectRoot ||
        latest.project.id !== selection.target.project.id
      ) {
        onStatus(`已保存到项目“${selection.target.project.name}”，当前工作区已切换。`);
        closeSelectionAfterCommit();
        return;
      }
      editorProjectStore.applyProjectResourceImport(
        response.project,
        response.importedAssets,
        response.importedCharacters,
        response.importedVoiceProfiles,
        response.baseRevision,
        response.savedRevision,
      );
      onImported();
      onStatus(
        `已从“${response.sourceProjectName}”导入 ${response.importedCharacters.length} 个角色和 ${response.importedAssets.length} 张图片。`,
      );
      closeSelectionAfterCommit();
    } catch (cause) {
      if (operationId.current === requestId) {
        setError(cause instanceof Error ? cause.message : '跨项目导入失败。');
      }
    } finally {
      if (operationId.current === requestId) setBusy(false);
    }
  };

  const closeSelectionAfterCommit = (): void => {
    setSelection(null);
    setSelectedKeys(new Set());
    setError('');
  };

  return (
    <>
      <button
        className="asset-import-fla-button asset-resource-import-trigger"
        data-testid="project-resource-import-trigger"
        disabled={!snapshot || disabled || busy}
        onClick={() => void chooseSource()}
        ref={triggerRef}
        type="button"
      >
        <DecorativeIcon icon={FolderOpen} size={18} />
        <span>从其他项目导入</span>
      </button>
      {error && !selection ? (
        <span className="project-resource-import-inline-error" role="alert">
          {error}
        </span>
      ) : null}
      {selection ? (
        <section
          aria-label="从其他项目导入资源"
          className="asset-details-overlay"
          data-testid="project-resource-import-overlay"
          onClick={(event) => {
            if (event.target === event.currentTarget && !busy) closeSelection();
          }}
          role="presentation"
        >
          <div
            aria-labelledby="project-resource-import-title"
            aria-modal="true"
            className="asset-details-dialog project-resource-import-dialog"
            onClick={(event) => event.stopPropagation()}
            ref={dialogRef}
            role="dialog"
            tabIndex={-1}
          >
            <header className="project-resource-import-heading">
              <div>
                <h2 id="project-resource-import-title">从其他项目导入</h2>
                <p>{selection.sourceProjectName}</p>
              </div>
              <button
                aria-label="关闭导入窗口"
                className="asset-details-close-icon"
                disabled={busy}
                onClick={closeSelection}
                type="button"
              >
                <DecorativeIcon icon={X} size={18} />
              </button>
            </header>
            {selection.items.length > 0 ? (
              <ul className="project-resource-import-list">
                {selection.items.map((item) => {
                  const key = resourceKey(item);
                  return (
                    <li key={key}>
                      <label
                        className="project-resource-import-option"
                        data-supported={item.supported}
                      >
                        <input
                          checked={selectedKeys.has(key)}
                          disabled={busy || !item.supported}
                          onChange={(event) =>
                            updateSelection(item, event.target.checked)
                          }
                          type="checkbox"
                        />
                        <span className="project-resource-import-option-copy">
                          <strong>{item.name}</strong>
                          <span>{describeOption(item)}</span>
                          {item.reason ? <small>{item.reason}</small> : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="project-resource-import-empty">
                没有可导入的角色、背景或道具。
              </p>
            )}
            {error ? (
              <p className="project-resource-import-error" role="alert">
                {error}
              </p>
            ) : null}
            <footer className="project-resource-import-actions">
              <button disabled={busy} onClick={closeSelection} type="button">
                取消
              </button>
              <button
                disabled={busy || selectedKeys.size === 0}
                onClick={() => void importSelected()}
                type="button"
              >
                {busy ? '正在导入…' : `导入${selectedKeys.size ? `（${selectedKeys.size}）` : ''}`}
              </button>
            </footer>
          </div>
        </section>
      ) : null}
    </>
  );
}

function resourceKey(resource: { kind: string; id: string }): string {
  return `${resource.kind}:${resource.id}`;
}

function describeOption(item: ProjectResourceImportOption): string {
  if (item.kind === 'image') return item.usage === 'background' ? '背景' : '道具';
  const mode = {
    'single-image': '单图角色',
    composite: '复合角色',
    'adaptive-parts': '自适应零件角色',
  }[item.mode];
  return `${mode} · ${item.dependencyCount} 张依赖图片`;
}

function formatImportError(error: {
  message: string;
  residualPaths?: string[];
}): string {
  return error.residualPaths?.length
    ? `${error.message} ${error.residualPaths.join('、')}`
    : error.message;
}
