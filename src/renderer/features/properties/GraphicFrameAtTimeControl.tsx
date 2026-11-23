import { useState } from 'react';
import { setGraphicFrameAtTime, type FlaGraphicDefinition } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui/Button';
import { GraphicFrameChoices } from '../characters/GraphicFacePicker';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { formatTimecode } from '../timeline/timeGeometry';

export function GraphicFrameAtTimeControl({ definition, shotId, layerId, locked }: {
  definition: FlaGraphicDefinition;
  shotId: string;
  layerId: string;
  locked: boolean;
}): React.JSX.Element {
  const instance = editorProjectStore.getProjectInstanceId();
  const { currentTimeMs } = useTimelineUi();
  const [open, setOpen] = useState(false);
  const [frameIndex, setFrameIndex] = useState<number>();
  const [error, setError] = useState('');

  const apply = (): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (locked || frameIndex === undefined || !snapshot ||
        instance !== editorProjectStore.getProjectInstanceId() ||
        shotStore.getCurrentShotId() !== shotId || selectionStore.getSelectedLayerId() !== layerId) return;
    try {
      const next = setGraphicFrameAtTime(snapshot.project, shotId, layerId, definition.id,
        definition.source.startFrameIndex + frameIndex, timelineUiStore.getSnapshot().currentTimeMs);
      if (next !== snapshot.project) editorProjectStore.updateProject(next, '设置元件显示帧');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法应用元件帧。');
    }
  };

  return <section className="graphic-face-picker" data-testid="graphic-frame-at-time">
    <Button variant="secondary" aria-expanded={open} disabled={locked} onClick={() => setOpen(!open)}>选择显示帧</Button>
    {open ? <>
      <GraphicFrameChoices definition={definition} selectedIndex={frameIndex ?? -1} onSelect={(_, index) => setFrameIndex(index)}
        disabled={locked} includeInternalFrames sourceAddresses testId="graphic-instance" />
      <div className="graphic-face-pagination">
        <time>{formatTimecode(currentTimeMs)}</time>
        <Button disabled={locked || frameIndex === undefined} onClick={apply}>应用到播放头</Button>
      </div>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
