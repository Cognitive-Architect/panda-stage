import { useSyncExternalStore } from 'react';
import { characterCompositeKeyTimes, type Shot, type Project } from '../../../domain';
import { selectionStore } from '../../stores/selectionStore';
import { timelineUiStore } from './timelineUiStore';

export function CharacterMotionLane({ project, shot, layerId, pixelsPerMs, currentTimeMs }: { project: Project; shot: Shot; layerId: string | null; pixelsPerMs: number; currentTimeMs: number }) {
  const partId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterPartId);
  const layer = shot.layers.find(l => l.id === layerId);
  if (!layer || !partId) return null;
  const source = layer.source;
  const character = source.kind === 'character' ? project.characters.find(c => c.id === source.characterId) : null;
  const name = layer.animationClip?.targetBases.find(b => b.target.partId === partId)?.displayName
    ?? (character?.mode === 'adaptive-parts' ? character.parts.find(p => p.partId === partId)?.displayName : undefined) ?? '部件动作';
  const times = characterCompositeKeyTimes(layer, partId);
  return <div className="timeline-lane character-motion-lane" aria-label="部件动作关键帧">
    <span className="timeline-lane-label" title={name}>{name}</span>
    <div className="character-motion-keys">
      {times.map(time => <button type="button" key={time} aria-label={`动作关键帧 ${time}ms`} aria-current={time === currentTimeMs ? 'true' : undefined}
        style={{ left: time * pixelsPerMs }} onPointerDown={event => event.stopPropagation()}
        onClick={() => timelineUiStore.seek(time, shot.durationMs)}>◆</button>)}
    </div>
  </div>;
}
