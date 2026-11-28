import { useSyncExternalStore } from 'react';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import type { AnimationCurveDraft } from './AnimationCurveDraft';
import { AnimationCurvePanel, hasAnimationCurveTracks } from './AnimationCurvePanel';

export function DockedAnimationCurve({ onDraft }: { onDraft(draft: AnimationCurveDraft | null): void }) {
  const snapshot = useSyncExternalStore(editorProjectStore.subscribe, editorProjectStore.getSnapshot);
  const shotId = useSyncExternalStore(shotStore.subscribe, shotStore.getCurrentShotId);
  const layerId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedLayerId);
  const shot = snapshot?.project.shots.find(({ id }) => id === shotId);
  const layer = shot?.layers.find(({ id }) => id === layerId);
  if (!snapshot || !shot || !layer || !hasAnimationCurveTracks(shot, layer)) {
    return <p className="workbench-empty">请选择包含属性关键帧的图层。</p>;
  }
  return <AnimationCurvePanel key={JSON.stringify([editorProjectStore.getProjectInstanceId(), shot.id, layer.id])}
    snapshot={snapshot} shot={shot} layer={layer} onDraft={onDraft} />;
}
