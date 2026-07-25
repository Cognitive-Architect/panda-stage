import { useState, useSyncExternalStore } from 'react';
import {
  projectDurationMs,
  ShotServiceError,
  type Project,
} from '../../../domain';
import type { EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { saveCurrentProject } from '../recovery/saveCurrentProject';
import { ShotEditor } from './ShotEditor';
import { ShotList } from './ShotList';

export interface ShotManagerProps {
  snapshot: EditorProjectSnapshot | null;
}

export function ShotManager({
  snapshot,
}: ShotManagerProps): React.JSX.Element {
  const selectedShotId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getCurrentShotId,
    shotStore.getCurrentShotId,
  );
  const [status, setStatus] = useState(
    '拖拽镜头卡片可写回项目顺序；所有修改会进入自动保存队列。',
  );
  const [busy, setBusy] = useState(false);
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
          : `${success} 修改已进入自动保存队列。`,
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

  const save = async (): Promise<void> => {
    if (!editorProjectStore.getSnapshot()?.dirty) {
      setStatus('当前镜头数据没有待保存修改。');
      return;
    }
    setBusy(true);
    try {
      const result = await saveCurrentProject(
        window.pandaStage.project,
        editorProjectStore,
      );
      setStatus(
        result.ok
          ? result.acknowledgement === 'current'
            ? '镜头顺序、名称和时长已保存到 project.json。'
            : '较新修改仍保留在编辑器中，请再次保存。'
          : result.error.message,
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '镜头保存失败。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="shot-manager" aria-labelledby="shot-manager-heading">
      <div className="shot-manager-heading">
        <div>
          <p className="eyebrow">Day 20 shot management · M2 gate</p>
          <h2 id="shot-manager-heading">镜头管理</h2>
        </div>
        <div>
          <span data-project-duration-ms={project ? projectDurationMs(project) : 0}>
            {project?.shots.length ?? 0} 个镜头 · 总时长{' '}
            {project ? projectDurationMs(project) : 0}ms · revision{' '}
            {snapshot?.revision ?? 0}
          </span>
          <button
            disabled={busy || !snapshot?.dirty}
            onClick={() => void save()}
            type="button"
          >
            {busy ? '正在保存…' : '保存镜头'}
          </button>
        </div>
      </div>
      <div className="shot-workspace">
        <ShotList
          disabled={busy || !snapshot}
          key={project?.id ?? 'no-project'}
          onCreate={(name, durationMs) => {
            return (
              mutate(
                () => shotStore.create({ name, durationMs }),
                `镜头“${name.trim()}”已创建。`,
              ) !== null
            );
          }}
          onMove={(shotId, targetIndex) => {
            mutate(
              () => shotStore.move(shotId, targetIndex),
              '镜头顺序已写回项目。',
              '镜头位置未变化，未新增待保存修改。',
            );
          }}
          onSelect={(shotId) => shotStore.select(shotId)}
          selectedShotId={effectiveSelectedId}
          shots={project?.shots ?? []}
        />
        <ShotEditor
          disabled={busy}
          index={selectedIndex}
          key={selectedShot?.id ?? 'empty'}
          onDuplicate={() => {
            if (!selectedShot) return;
            mutate(
              () => shotStore.duplicate(selectedShot.id),
              `镜头“${selectedShot.name}”已复制，所有子实体 ID 已重建。`,
            );
          }}
          onRemove={() => {
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
              setStatus('最后一个镜头已移除；请创建新镜头继续。修改已进入自动保存队列。');
            }
          }}
          onRename={(name) => {
            if (!selectedShot) return;
            mutate(
              () => shotStore.rename(selectedShot.id, name),
              '镜头名称已更新。',
            );
          }}
          onSetDuration={(durationMs) => {
            if (!selectedShot) return;
            mutate(
              () => shotStore.setDuration(selectedShot.id, durationMs),
              `镜头时长已更新为 ${durationMs}ms。`,
            );
          }}
          shot={selectedShot}
        />
      </div>
      <output className="shot-manager-status">{status}</output>
    </section>
  );
}
