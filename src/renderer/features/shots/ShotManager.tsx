import { useState, useSyncExternalStore } from 'react';
import {
  projectDurationMs,
  ShotServiceError,
  type Project,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { ShotCreateForm } from './ShotCreateForm';
import { ShotEditor } from './ShotEditor';
import { nextAvailableShotName, ShotList } from './ShotList';
import { ShotQuickActions } from './ShotQuickActions';

export type ShotWorkspaceView = 'list' | 'create';
export type ShotManagerPresentation = 'default' | 'landscape';
export type ShotEditorPresentation = 'default' | 'portrait';

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
  const [status, setStatus] = useState('');
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

  const mutate = (action: () => Project): Project | null => {
    try {
      const next = action();
      setStatus('');
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

  const createShot = (name: string, durationMs: number): boolean => {
    const next = mutate(() => shotStore.create({ name, durationMs }));
    return next !== null;
  };

  const duplicateSelectedShot = (): void => {
    if (!selectedShot) return;
    mutate(() => shotStore.duplicate(selectedShot.id));
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
    mutate(() => shotStore.remove(selectedShot.id));
  };

  const renameSelectedShot = (name: string): void => {
    if (!selectedShot) return;
    mutate(() => shotStore.rename(selectedShot.id, name));
  };

  const setSelectedShotDuration = (durationMs: number): void => {
    if (!selectedShot) return;
    mutate(() => shotStore.setDuration(selectedShot.id, durationMs));
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
              mutate(() => shotStore.move(shotId, targetIndex));
            }}
            onSelect={(shotId) => shotStore.select(shotId)}
            project={project}
            projectRoot={snapshot?.projectRoot}
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
            inlineEmptyCopy={presentation === 'landscape'}
            showStoryboardCue={presentation === 'landscape'}
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
              project={project}
              projectRoot={snapshot?.projectRoot}
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
