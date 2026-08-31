import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  projectDurationMs,
  ShotServiceError,
  type Project,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { ShotCreateForm } from './ShotCreateForm';
import { formatShotDuration, ShotEditor } from './ShotEditor';
import { nextAvailableShotName, ShotList } from './ShotList';
import { ShotQuickActions } from './ShotQuickActions';

export type ShotWorkspaceView = 'list' | 'create';
export type ShotManagerPresentation = 'default' | 'landscape';
export type ShotEditorPresentation = 'default' | 'portrait';

const SHOT_STATUS_GUIDANCE =
  '局部修改会先应用到当前项目；请使用“保存整个项目”写入磁盘。';

export interface ShotManagerProps {
  snapshot: EditorProjectSnapshot | null;
  view?: ShotWorkspaceView;
  onViewChange?: (view: ShotWorkspaceView) => void;
  /** Portrait shell keeps the dock's concise 镜头 heading as the visible identity. */
  hideHeading?: boolean;
  /** Keep the landscape drawer focused on the existing Shot list owner. */
  presentation?: ShotManagerPresentation;
  /** Presentation-only seam for the selected Shot detail surface. */
  shotEditorPresentation?: ShotEditorPresentation;
}

export function ShotManager({
  snapshot,
  view = 'list',
  onViewChange = () => undefined,
  hideHeading = false,
  presentation = 'default',
  shotEditorPresentation = 'default',
}: ShotManagerProps): React.JSX.Element {
  const selectedShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
    shotStore.getCurrentShotId,
  );
  const [status, setStatus] = useState(
    presentation === 'landscape' ? '' : SHOT_STATUS_GUIDANCE,
  );
  useEffect(() => {
    setStatus(presentation === 'landscape' ? '' : SHOT_STATUS_GUIDANCE);
  }, [presentation]);
  const project = snapshot?.project ?? null;
  const effectiveSelectedId =
    project?.shots.some((shot) => shot.id === selectedShotId)
      ? selectedShotId
      : project?.shots[0]?.id ?? null;
  const selectedIndex =
    project?.shots.findIndex((shot) => shot.id === effectiveSelectedId) ??
    -1;
  const selectedShot =
    selectedIndex >= 0 ? project?.shots[selectedIndex] ?? null : null;

  const mutate = (
    action: () => Project,
    success: string,
    unchanged?: string,
  ): Project | null => {
    const current = editorProjectStore.getSnapshot()?.project;
    try {
      const next = action();
      setStatus(
        unchanged && next === current
          ? unchanged
          : presentation === 'landscape'
            ? success
            : `${success} 修改已应用，项目尚未保存。`,
      );
      return next;
    } catch (error) {
      setStatus(
        error instanceof ShotServiceError || error instanceof Error
          ? error.message
          : '镜头修改失败。',
      );
      return null;
    }
  };

  const createShot = (name: string, durationMs: number): boolean =>
    mutate(
      () => shotStore.create({ name, durationMs }),
      `镜头“${name.trim()}”已创建。`,
    ) !== null;

  const duplicateSelectedShot = (): void => {
    if (!selectedShot) return;
    mutate(
      () => shotStore.duplicate(selectedShot.id),
      `镜头“${selectedShot.name}”已复制，所有子实体 ID 已重建。`,
    );
  };

  const removeSelectedShot = (): void => {
    if (
      !selectedShot ||
      !window.confirm(
        `确认移除镜头“${selectedShot.name}”？项目素材和角色不会被删除。`,
      )
    ) {
      return;
    }
    const next = mutate(
      () => shotStore.remove(selectedShot.id),
      `镜头“${selectedShot.name}”已移除。`,
    );
    if (next?.shots.length === 0) {
      setStatus(
        presentation === 'landscape'
          ? '最后一个镜头已移除，请创建新镜头。'
          : '最后一个镜头已移除；请创建新镜头继续。项目尚未保存。',
      );
    }
  };

  const renameSelectedShot = (name: string): void => {
    if (!selectedShot) return;
    mutate(
      () => shotStore.rename(selectedShot.id, name),
      '镜头名称已更新。',
    );
  };

  const setSelectedShotDuration = (durationMs: number): void => {
    if (!selectedShot) return;
    mutate(
      () => shotStore.setDuration(selectedShot.id, durationMs),
      `镜头时长已更新为 ${formatShotDuration(durationMs)}。`,
    );
  };

  return (
    <section
      className="shot-manager"
      aria-label={hideHeading ? '镜头' : undefined}
      aria-labelledby="shot-manager-heading"
      data-shot-editor-presentation={shotEditorPresentation}
      data-testid="shot-manager"
    >
      <div
        className={
          hideHeading
            ? 'shot-manager-heading shot-manager-heading-visually-hidden'
            : 'shot-manager-heading'
        }
      >
        <div>
          <p className="eyebrow">镜头编排</p>
          <h2 id="shot-manager-heading">镜头管理</h2>
        </div>
        <div>
          <span
            data-project-duration-ms={project ? projectDurationMs(project) : 0}
            data-project-revision={snapshot?.revision ?? 0}
          >
            {project?.shots.length ?? 0} 个镜头 · 总时长{' '}
            {project ? projectDurationMs(project) : 0}ms
          </span>
        </div>
      </div>
      {view === 'create' ? (
        <ShotCreateForm
          disabled={!snapshot}
          onBack={() => onViewChange('list')}
          onCreate={createShot}
          presentation={presentation}
          suggestedName={nextAvailableShotName(project?.shots ?? [])}
        />
      ) : (
        <div className="shot-workspace">
          <ShotList
            disabled={!snapshot}
            key={project?.id ?? 'no-project'}
            onCreate={createShot}
            onMove={(shotId, targetIndex) => {
              mutate(
                () => shotStore.move(shotId, targetIndex),
                '镜头顺序已写回项目。',
                presentation === 'landscape'
                  ? '镜头位置未变化。'
                  : '镜头位置未变化，未新增待保存修改。',
              );
            }}
            onSelect={(shotId) => shotStore.select(shotId)}
            selectedShotId={effectiveSelectedId}
            selectedActions={
              presentation === 'landscape' && selectedShot ? (
                <ShotQuickActions
                  disabled={!snapshot}
                  index={selectedIndex}
                  onDuplicate={duplicateSelectedShot}
                  onRemove={removeSelectedShot}
                  onRename={renameSelectedShot}
                  onSetDuration={setSelectedShotDuration}
                  shot={selectedShot}
                />
              ) : undefined
            }
            compactDuration={presentation === 'landscape'}
            showHeading={!hideHeading}
            showCreateForm={false}
            shots={project?.shots ?? []}
          />
          {presentation === 'landscape' ? null : (
            <ShotEditor
              disabled={!snapshot}
              index={selectedIndex}
              key={selectedShot?.id ?? 'empty'}
              onDuplicate={duplicateSelectedShot}
              onRemove={removeSelectedShot}
              onRename={renameSelectedShot}
              onSetDuration={setSelectedShotDuration}
              shot={selectedShot}
            />
          )}
        </div>
      )}
      {status ? (
        <output aria-live="polite" className="shot-manager-status">
          {status}
        </output>
      ) : null}
    </section>
  );
}
