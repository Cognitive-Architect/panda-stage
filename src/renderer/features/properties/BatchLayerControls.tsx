import { useState, useSyncExternalStore } from 'react';
import { LayerMotionService, LayerService, layerHasNonNeutralMotion, type Layer, type Project } from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { BatchRenameFields } from './BatchRenameFields';

const service = new LayerService();
const motion = new LayerMotionService();

export function BatchLayerControls({ snapshot, shotId, layers }: {
  snapshot: EditorProjectSnapshot;
  shotId: string;
  layers: readonly Layer[];
}): React.JSX.Element {
  const selectedIds = useSyncExternalStore(selectionStore.subscribe, selectionStore.getBatchLayerIds);
  const [error, setError] = useState('');
  const [deleteSelection, setDeleteSelection] = useState<{ revision: number; ids: readonly string[] }>();
  const selected = layers.filter((layer) => selectedIds.includes(layer.id));
  const editable = selected.filter((layer) => !layer.locked);
  const duplicable = editable.filter((layer) => layer.source.kind === 'animation' && layer.animationPlayback);
  const recenterable = editable.flatMap((layer) => {
    if (layer.animationClip?.version !== 2) return [];
    const basis = layer.animationClip.targetBases[0]!;
    const x = basis.sourceCanvas.width / 2;
    const y = basis.sourceCanvas.height / 2;
    if ((basis.pivot.x === x && basis.pivot.y === y) || layerHasNonNeutralMotion(layer.animationClip, basis.target)) return [];
    return [{ id: layer.id, x, y }];
  });
  const pendingDelete = deleteSelection?.revision === snapshot.revision &&
    editable.length > 0 && editable.length === deleteSelection.ids.length &&
    editable.every(({ id }, index) => id === deleteSelection.ids[index]);

  function apply(label: string, edit: (project: Project) => Project): void {
    if (editorProjectStore.getSnapshot() !== snapshot || shotStore.getCurrentShotId() !== shotId) {
      setError('镜头已变更，请重新选择图层。');
      return;
    }
    try {
      const project = edit(snapshot.project);
      if (project !== snapshot.project) editorProjectStore.updateProject(project, label);
      setError('');
      setDeleteSelection(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量操作失败。');
    }
  }

  return <details data-testid="batch-layer-controls" onKeyDown={(event) => {
    if (event.key === 'Delete' || event.key === 'Backspace') event.stopPropagation();
  }} onToggle={(event) => {
    if (event.currentTarget.open) return;
    selectionStore.clearBatchLayers();
    setDeleteSelection(undefined);
  }}>
    <summary>批量管理图层{selected.length ? `（${selected.length}）` : ''}</summary>
    <ul>{layers.map((layer) => <li key={layer.id}>
      <label><input type="checkbox" checked={selectedIds.includes(layer.id)}
        onChange={() => selectionStore.toggleBatchLayer(layer.id)} />{layer.name}{layer.locked ? '（已锁定）' : ''}</label>
    </li>)}</ul>
    <BatchRenameFields entries={editable} onApply={(names) => apply('批量改名图层',
      (project) => service.renameContentLayers(project, shotId, names))} />
    <div className="layer-order-actions">
      <button type="button" disabled={!duplicable.length} onClick={() => apply('批量复制动画实例',
        (project) => duplicable.reduce((next, layer) => service.duplicateAnimationLayer(next, shotId, layer.id).project, project)
      )}>复制动画实例（{duplicable.length}）</button>
      <button type="button" disabled={!editable.length} onClick={() => apply('批量锁定图层',
        (project) => editable.reduce((next, layer) => service.setLocked(next, shotId, layer.id, true), project)
      )}>锁定（{editable.length}）</button>
      <button type="button" disabled={editable.length === selected.length} onClick={() => apply('批量解锁图层',
        (project) => selected.reduce((next, layer) => service.setLocked(next, shotId, layer.id, false), project)
      )}>解锁（{selected.length - editable.length}）</button>
      <button type="button" disabled={!recenterable.length} onClick={() => apply('?????????',
        (project) => recenterable.reduce((next, { id, x, y }) =>
          motion.recalibratePivot(next, { shotId, layerId: id }, { space: 'target-local', x, y }), project)
      )}>????????{recenterable.length}?</button>
      <button type="button" disabled={!editable.length} onClick={() => {
        if (!pendingDelete) {
          setDeleteSelection({ revision: snapshot.revision, ids: editable.map(({ id }) => id) });
          return;
        }
        apply('批量删除图层',
          (project) => editable.reduce((next, layer) => service.deleteLayer(next, shotId, layer.id), project));
      }}>{pendingDelete ? '确认删除图层' : '删除图层'}（{editable.length}）</button>
      {pendingDelete ? <button type="button" onClick={() => setDeleteSelection(undefined)}>取消删除</button> : null}
    </div>
    {pendingDelete ? <p role="alert">将从当前镜头移除 {editable.map(({ name }) => name).join('、')}。</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </details>;
}
