import { useState } from 'react';
import { clearGraphicFrameAtTime, findGraphicFrameKey, isFlaGraphicDefinition, setGraphicFrameAtTime, type FlaGraphicDefinition, type Layer, type Project, type Shot } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui/Button';
import { GraphicFrameChoices } from '../characters/GraphicFacePicker';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { formatTimecode } from '../timeline/timeGeometry';

export function GraphicFrameAtTimeControl({ project, shot, selection }: {
  project: Project;
  shot: Shot;
  selection: Layer | null;
}): React.JSX.Element | null {
  const [fixed, setFixed] = useState<{ layerId: string; animationId: string }>();
  const fixedLayer = fixed && shot.layers.find((entry) => entry.id === fixed.layerId);
  const fixedDefinition = fixed && project.animations.find((entry) => entry.id === fixed.animationId);
  const targetIsFixed = Boolean(fixedLayer && !fixedLayer.locked && fixedLayer.source.kind === 'animation' &&
    fixedLayer.source.animationId === fixed?.animationId && fixedDefinition && isFlaGraphicDefinition(fixedDefinition));
  if (fixed && !targetIsFixed) setFixed(undefined);

  const layer = targetIsFixed ? fixedLayer : selection;
  const source = layer?.source;
  const definition = source?.kind === 'animation'
    ? project.animations.find((entry) => entry.id === source.animationId)
    : undefined;
  if (!layer || !definition || !isFlaGraphicDefinition(definition)) return null;

  return <GraphicFrameEditor key={JSON.stringify([layer.id, definition.id])}
    definition={definition} shot={shot} layer={layer} fixed={targetIsFixed}
    onToggleFixed={() => setFixed(targetIsFixed ? undefined : { layerId: layer.id, animationId: definition.id })} />;
}

function GraphicFrameEditor({ definition, shot, layer, fixed, onToggleFixed }: {
  definition: FlaGraphicDefinition;
  shot: Shot;
  layer: Layer;
  fixed: boolean;
  onToggleFixed: () => void;
}): React.JSX.Element {
  const { id: layerId, locked } = layer;
  const instance = editorProjectStore.getProjectInstanceId();
  const { currentTimeMs } = useTimelineUi();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const key = findGraphicFrameKey(shot, layerId, definition.id, currentTimeMs);

  const edit = (description: string, change: (project: Project, timeMs: number) => Project): void => {
    const snapshot = editorProjectStore.getSnapshot();
    if (locked || !snapshot ||
        instance !== editorProjectStore.getProjectInstanceId() ||
        shotStore.getCurrentShotId() !== shot.id || (!fixed && selectionStore.getSelectedLayerId() !== layerId)) return;
    const liveLayer = snapshot.project.shots.find((entry) => entry.id === shot.id)?.layers.find((entry) => entry.id === layerId);
    if (!liveLayer || liveLayer.locked || liveLayer.source.kind !== 'animation' ||
        liveLayer.source.animationId !== definition.id) return;
    try {
      const next = change(snapshot.project, timelineUiStore.getSnapshot().currentTimeMs);
      if (next !== snapshot.project) editorProjectStore.updateProject(next, description);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法修改元件显示帧。');
    }
  };

  return <section className="graphic-face-picker" data-testid="graphic-frame-at-time">
    <div className="graphic-face-pagination">
      <Button variant="secondary" aria-expanded={open} disabled={locked} onClick={() => setOpen(!open)}>选择显示帧</Button>
      {open || fixed ? <Button variant="secondary" aria-pressed={fixed} disabled={locked} onClick={onToggleFixed}>
        {fixed ? `取消固定 · ${layer.name}` : '固定目标'}
      </Button> : null}
    </div>
    {open ? <>
      <GraphicFrameChoices definition={definition} selectedIndex={key ? key.sourceFrameIndex - definition.source.startFrameIndex : -1}
        onSelect={(_, index) => edit('设置元件显示帧', (project, time) => setGraphicFrameAtTime(project, shot.id, layerId,
          definition.id, definition.source.startFrameIndex + index, time))}
        disabled={locked} requireReady includeInternalFrames sourceAddresses testId="graphic-instance" />
      <div className="graphic-face-pagination">
        <time>{formatTimecode(currentTimeMs)}</time>
        {key ? <Button variant="secondary" disabled={locked} onClick={() =>
          edit('清除元件显示帧切换', (project, time) =>
            clearGraphicFrameAtTime(project, shot.id, layerId, definition.id, time, key.id))
        }>清除这次切换</Button> : null}
      </div>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
