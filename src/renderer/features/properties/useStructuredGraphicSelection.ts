import { useSyncExternalStore } from 'react';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { resolveFlaGraphicEditTarget } from '../canvas/flaGraphicEditScope';

export function useStructuredGraphicSelection() {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  const shotId = useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  const layerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  const scope = useSyncExternalStore(selectionStore.subscribe, selectionStore.getStructuredEditScope);
  const path = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedStructuredNodePath);
  const target = resolveFlaGraphicEditTarget({ project: snapshot?.project ?? null,
    projectRoot: snapshot?.projectRoot ?? null, projectInstanceId: editorProjectStore.getProjectInstanceId(),
    shot: snapshot?.project.shots.find(shot => shot.id === shotId) ?? null, layerId });
  return { snapshot, target, scope: target && scope?.targetKey === target.key ? scope : null, path };
}
