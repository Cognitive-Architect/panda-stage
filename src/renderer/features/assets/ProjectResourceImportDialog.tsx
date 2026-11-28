import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, X } from 'lucide-react';
import type {
  ProjectResourceImportOption,
  ProjectResourceImportPreviewResponse,
  ProjectResourceImportSelection,
} from '../../../shared/project-resource-import-api';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import {
  commitCrossProjectResourceImport,
  type CrossProjectResourceImportCommitResult,
} from './projectResourceImportFlow';
import './project-resource-import-dialog.css';

export interface ProjectResourceImportSessionState {
  sourceToken: string;
  sourceProjectName: string;
  items: readonly ProjectResourceImportOption[];
}

export interface ProjectResourceImportDialogProps {
  snapshot: EditorProjectSnapshot;
  session: ProjectResourceImportSessionState;
  onClose: () => void;
  onImported: (
    result: Extract<CrossProjectResourceImportCommitResult, { ok: true }>,
  ) => void;
}

type PreviewData = Extract<ProjectResourceImportPreviewResponse, { ok: true }>;

function optionKey(option: { kind: string; id: string }): string {
  return `${option.kind}:${option.id}`;
}

function optionTypeLabel(option: ProjectResourceImportOption): string {
  if (option.kind === 'character') {
    if (option.mode === 'adaptive-parts') return '分件角色';
    if (option.mode === 'composite') return '组合角色';
    return '单图角色';
  }
  if (option.kind === 'animation') {
    return option.animationKind === 'fla-graphic' ? 'Graphic' : '帧动画';
  }
  return option.usage === 'background' ? '背景' : '道具';
}

function dependencyLabel(option: ProjectResourceImportOption): string {
  const parts: string[] = [];
  if (option.dependencyAnimationCount > 0) {
    parts.push(`${option.dependencyAnimationCount} 个 Graphic/动画`);
  }
  if (option.dependencyAssetCount > 0) {
    parts.push(`${option.dependencyAssetCount} 个素材`);
  }
  return parts.length > 0 ? `依赖：${parts.join('、')}` : '无额外文件依赖';
}

export function ProjectResourceImportDialog({
  snapshot,
  session,
  onClose,
  onImported,
}: ProjectResourceImportDialogProps): React.JSX.Element {
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [reuseIdenticalAssets, setReuseIdenticalAssets] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);

  const selectedResources = useMemo<ProjectResourceImportSelection[]>(() => {
    const out: ProjectResourceImportSelection[] = [];
    for (const item of session.items) {
      if (item.supported && selectedKeys.has(optionKey(item))) {
        out.push({ kind: item.kind, id: item.id });
      }
    }
    return out;
  }, [selectedKeys, session.items]);

  const grouped = useMemo(() => {
    const characters = session.items.filter((item) => item.kind === 'character');
    const animations = session.items.filter((item) => item.kind === 'animation');
    const images = session.items.filter((item) => item.kind === 'image');
    return [
      { key: 'characters', title: '角色', items: characters },
      { key: 'animations', title: 'Graphic 与动画', items: animations },
      { key: 'images', title: '背景与道具', items: images },
    ].filter((group) => group.items.length > 0);
  }, [session.items]);

  useEffect(() => {
    if (selectedResources.length === 0) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void window.pandaStage.projectResourceImport
      .preview({
        projectRoot: snapshot.projectRoot,
        project: snapshot.project,
        baseRevision: snapshot.revision,
        sourceToken: session.sourceToken,
        resources: selectedResources,
        reuseIdenticalAssets,
      })
      .then((response) => {
        if (cancelled) return;
        if (!response.ok) {
          setPreview(null);
          setError(response.error.message);
          return;
        }
        setError(null);
        setPreview(response);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setError(err instanceof Error ? err.message : '预览依赖失败。');
      });
    return () => {
      cancelled = true;
    };
  }, [
    reuseIdenticalAssets,
    selectedResources,
    session.sourceToken,
    snapshot.project,
    snapshot.projectRoot,
    snapshot.revision,
  ]);

  const toggleItem = (item: ProjectResourceImportOption): void => {
    if (!item.supported || committing) return;
    const key = optionKey(item);
    setSelectedKeys((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = async (): Promise<void> => {
    if (selectedResources.length === 0 || committing) return;
    setCommitting(true);
    setError(null);
    const result = await commitCrossProjectResourceImport({
      sourceToken: session.sourceToken,
      resources: selectedResources,
      reuseIdenticalAssets,
    });
    setCommitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onImported(result);
  };

  const canConfirm =
    selectedResources.length > 0 &&
    !committing &&
    (!preview || preview.issues.length === 0);

  return createPortal(
    <div
      className="project-resource-import-backdrop"
      data-testid="project-resource-import-dialog"
      role="presentation"
    >
      <div
        aria-labelledby="project-resource-import-title"
        aria-modal="true"
        className="project-resource-import-dialog"
        role="dialog"
      >
        <header className="project-resource-import-header">
          <h2
            className="project-resource-import-title"
            id="project-resource-import-title"
          >
            从“{session.sourceProjectName}”导入
          </h2>
          <button
            aria-label="关闭跨项目导入"
            className="project-resource-import-close"
            disabled={committing}
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="project-resource-import-body">
          {grouped.length === 0 ? (
            <p className="project-resource-import-item-meta">
              来源工程中没有可导入的角色、Graphic、背景或道具。
            </p>
          ) : (
            grouped.map((group) => (
              <section key={group.key}>
                <h3 className="project-resource-import-group-title">
                  {group.title}
                </h3>
                <ul className="project-resource-import-list">
                  {group.items.map((item) => {
                    const key = optionKey(item);
                    const checked = selectedKeys.has(key);
                    return (
                      <li key={key}>
                        <label
                          className="project-resource-import-item"
                          data-disabled={!item.supported}
                        >
                          <input
                            checked={checked}
                            disabled={!item.supported || committing}
                            onChange={() => toggleItem(item)}
                            type="checkbox"
                          />
                          <div className="project-resource-import-item-main">
                            <div className="project-resource-import-item-row">
                              <span className="project-resource-import-item-name">
                                {item.name}
                              </span>
                              <span className="project-resource-import-badge">
                                {optionTypeLabel(item)}
                              </span>
                              {item.hasNameConflict ? (
                                <span className="project-resource-import-badge project-resource-import-badge-conflict">
                                  重名将自动编号
                                </span>
                              ) : null}
                            </div>
                            {item.supported ? (
                              <span className="project-resource-import-item-meta">
                                {dependencyLabel(item)}
                              </span>
                            ) : (
                              <span className="project-resource-import-item-reason">
                                {item.reason ?? '暂不支持导入'}
                              </span>
                            )}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>

        <div className="project-resource-import-summary">
          {preview ? (
            <>
              <div>
                已选 {preview.selectedCount} 项 · 含 {preview.characterCount}{' '}
                个角色、{preview.animationCount} 个 Graphic/动画、
                预计复制 {preview.newFileCount} 个素材文件
              </div>
              {preview.reusableAssetCount > 0 ? (
                <label className="project-resource-import-reuse-option">
                  <input
                    checked={reuseIdenticalAssets}
                    disabled={committing}
                    onChange={(event) =>
                      setReuseIdenticalAssets(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    复用目标工程中内容相同的已有素材（{preview.reusableAssetCount} 个候选）
                  </span>
                </label>
              ) : null}
              {preview.nameConflicts.length > 0 ? (
                <div>
                  名称冲突自动编号：
                  {preview.nameConflicts
                    .slice(0, 3)
                    .map((c) => `${c.sourceName} → ${c.resolvedName}`)
                    .join('；')}
                  {preview.nameConflicts.length > 3
                    ? ` 等 ${preview.nameConflicts.length} 项`
                    : ''}
                </div>
              ) : null}
              {preview.issues.length > 0 ? (
                <div className="project-resource-import-error" role="alert">
                  <AlertCircle aria-hidden="true" size={16} />
                  <span>{preview.issues[0]}</span>
                </div>
              ) : null}
            </>
          ) : (
            <div>勾选需要复用的角色、Graphic、背景或道具以预览依赖。</div>
          )}
          {error ? (
            <div className="project-resource-import-error" role="alert">
              <AlertCircle aria-hidden="true" size={16} />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <footer className="project-resource-import-footer">
          <button
            className="project-resource-import-cancel"
            disabled={committing}
            onClick={onClose}
            type="button"
          >
            取消
          </button>
          <button
            className="project-resource-import-confirm"
            data-testid="project-resource-import-confirm"
            disabled={!canConfirm}
            onClick={() => void handleConfirm()}
            type="button"
          >
            {committing ? '正在导入…' : '导入所选素材'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
