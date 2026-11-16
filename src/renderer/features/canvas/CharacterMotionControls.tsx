import { useSyncExternalStore } from 'react';
import { characterCompositeKeyTimes, type Project, type Shot } from '../../../domain';
import { selectionStore } from '../../stores/selectionStore';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { Button } from '../../ui/Button';

export function CharacterMotionControls({ project, shot, layerId }: { project: Project; shot: Shot; layerId: string | null }) {
  const partId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterPartId);
  const ui = useTimelineUi();
  const layer = shot.layers.find(l => l.id === layerId);
  const source = layer?.source;
  const character = source?.kind === 'character' ? project.characters.find(c => c.id === source.characterId) : null;
  if (!layer || character?.mode !== 'adaptive-parts') return null;
  const parts = layer.animationClip?.targetBases.map(b => ({ partId: b.target.partId, displayName: b.displayName })) ?? character.parts;
  const present = partId !== null && characterCompositeKeyTimes(layer, partId).includes(ui.currentTimeMs);
  return <div className="character-motion-controls" role="group" aria-label="人物动作">
    <select aria-label="人物动作部件" value={parts.some(p => p.partId === partId) ? partId! : ''}
      onChange={event => selectionStore.selectCharacterPart(event.target.value || null)}>
      <option value="">角色整体</option>
      {parts.map((part, index) => <option value={part.partId} key={part.partId}>{part.displayName ?? `部件 ${index + 1}`}</option>)}
    </select>
    <Button variant={ui.characterMotionAutoKey ? 'primary' : 'secondary'} aria-pressed={ui.characterMotionAutoKey}
      disabled={!partId || layer.locked} title={ui.characterMotionAutoKey ? '在当前帧记录动作' : '修改角色默认姿势，不写动画关键帧'}
      onClick={() => timelineUiStore.setCharacterMotionAutoKey(!ui.characterMotionAutoKey)}>Auto-Key</Button>
    <output aria-label={present ? '当前帧有动作关键帧' : '当前帧无动作关键帧'} data-testid="character-motion-key-state">{present ? '◆' : '◇'}</output>
  </div>;
}
