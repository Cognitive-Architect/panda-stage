import { useState } from 'react';
import { clearGraphicFrameAtTime, findGraphicFrameKey, setGraphicFrameAtTime, type FlaGraphicDefinition, type Project, type Shot } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui/Button';
import { GraphicFrameChoices } from '../characters/GraphicFacePicker';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { formatTimecode } from '../timeline/timeGeometry';

export function GraphicFrameAtTimeControl({ definition, shot, layerId, locked }: {
  definition: FlaGraphicDefinition;
  shot: Shot;
  layerId: string;
  locked: boolean;
}): React.JSX.Element {
  const instance = editorProjectStore.getProjectInstanceId();
  const { currentTimeMs } = useTimelineUi();
  const [open, setOpen] = useState(false);
  const [frameIndex, setFrameIndex] = useState<number>();
  const [error, setError] = useState('');
  const key = findGraphicFrameKey(shot, layerId, definition.id, currentTimeMs);

  const edit = (description: string, change: (project: Project, timeMs: number) => Project): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (locked || !snapshot ||
        instance !== editorProjectStore.getProjectInstanceId() ||
        shotStore.getCurrentShotId() !== shot.id || selectionStore.getSelectedLayerId() !== layerId) return;
    try {
      const next = change(snapshot.project, timelineUiStore.getSnapshot().currentTimeMs);
      if (next !== snapshot.project) editorProjectStore.updateProject(next, description);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法修改元件显示帧。');
    }
  };

  return <section className="graphic-face-picker" data-testid="graphic-frame-at-time">
    <Button variant="secondary" aria-expanded={open} disabled={locked} onClick={() => setOpen(!open)}>选择显示帧</Button>
    {open ? <>
      <GraphicFrameChoices definition={definition} selectedIndex={frameIndex ?? -1} onSelect={(_, index) => setFrameIndex(index)}
        disabled={locked} includeInternalFrames sourceAddresses testId="graphic-instance" />
      <div className="graphic-face-pagination">
        <time>{formatTimecode(currentTimeMs)}</time>
        <Button disabled={locked || frameIndex === undefined} onClick={() => {
          if (frameIndex === undefined) return;
          edit('设置元件显示帧', (project, time) => setGraphicFrameAtTime(project, shot.id, layerId,
            definition.id, definition.source.startFrameIndex + frameIndex, time));
        }}>应用到播放头</Button>
        {key ? <Button variant="secondary" disabled={locked} onClick={() =>
          edit('清除元件显示帧切换', (project, time) =>
            clearGraphicFrameAtTime(project, shot.id, layerId, definition.id, time, key.id))
        }>清除这次切换</Button> : null}
      </div>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
