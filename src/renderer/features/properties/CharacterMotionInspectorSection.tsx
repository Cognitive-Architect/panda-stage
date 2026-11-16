import { useId, useSyncExternalStore } from 'react';
import { Plus } from 'lucide-react';
import { type Project, type Shot } from '../../../domain';
import { characterMotionParts } from '../canvas/characterMotionContext';
import { selectionStore } from '../../stores/selectionStore';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { Button } from '../../ui/Button';
import { DecorativeIcon } from '../../ui';

export function CharacterMotionInspectorSection({ project, shot, layerId }: { project: Project; shot: Shot; layerId: string | null }) {
  const selectorId = useId();
  const partId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterPartId);
  const ui = useTimelineUi();
  const layer = shot.layers.find(l => l.id === layerId);
  const source = layer?.source;
  const character = source?.kind === 'character' ? project.characters.find(c => c.id === source.characterId) : null;
  if (!layer || character?.mode !== 'adaptive-parts') return null;
  const parts = characterMotionParts(project, layer);
  return <details className="right-inspector-section character-motion-inspector-section" data-testid="character-motion-inspector-section" open>
    <summary>动作</summary>
    <div className="character-motion-controls" role="group" aria-label="人物动作">
    <label htmlFor={selectorId}>部位</label>
    <select id={selectorId} aria-label="人物动作部件" title={parts.find(p => p.partId === partId)?.name ?? '角色整体'} value={parts.some(p => p.partId === partId) ? partId! : ''}
      onChange={event => selectionStore.selectCharacterPart(event.target.value || null)}>
      <option value="">角色整体</option>
      {parts.map(part => <option value={part.partId} key={part.partId}>{part.name}</option>)}
    </select>
    <Button variant={ui.characterMotionAutoKey ? 'primary' : 'secondary'} aria-pressed={ui.characterMotionAutoKey}
      disabled={!partId || layer.locked} title={ui.characterMotionAutoKey ? '修改部位时记录当前时间' : '修改默认姿势，不记录关键帧'}
      onClick={() => timelineUiStore.setCharacterMotionAutoKey(!ui.characterMotionAutoKey)}><DecorativeIcon icon={Plus} size={16} />自动关键帧</Button>
    </div>
  </details>;
}
