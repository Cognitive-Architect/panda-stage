import { useId, useSyncExternalStore } from 'react';
import { Plus } from 'lucide-react';
import { type Project, type Shot } from '../../../domain';
import { resolveCharacterView, type CharacterNode } from '../characters/characterView';
import { selectionStore } from '../../stores/selectionStore';
import { timelineUiStore, useTimelineUi } from '../timeline/timelineUiStore';
import { Button } from '../../ui/Button';
import { DecorativeIcon } from '../../ui';

function optionValue(node: CharacterNode): string {
  return node.role === 'part' ? node.partId : node.id;
}

export function CharacterMotionInspectorSection({ project, shot, layerId }: { project: Project; shot: Shot; layerId: string | null }) {
  const selectorId = useId();
  const nodeId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSelectedCharacterNodeId);
  const ui = useTimelineUi();
  const layer = shot.layers.find(l => l.id === layerId);
  const view = resolveCharacterView(project, layer);
  if (!layer || !view?.nodes.length) return null;
  const hasV1Motion = view.nodes.some((node) => node.motion === 'character-clip-v1');
  const active = view.nodes.find((node) => node.id === nodeId);
  return <details className="right-inspector-section character-motion-inspector-section" data-testid="character-motion-inspector-section" open>
    <summary>动作</summary>
    <div className="character-motion-controls" role="group" aria-label="人物动作">
    <label htmlFor={selectorId}>部位</label>
    <select id={selectorId} aria-label="人物动作部件" title={active?.name ?? '角色整体'} value={active ? optionValue(active) : hasV1Motion ? '' : 'root'}
      onChange={event => selectionStore.selectCharacterNode(view.nodes.find((node) => optionValue(node) === event.target.value)?.id ?? null)}>
      {hasV1Motion ? <option value="">角色整体</option> : null}
      {view.nodes.map((node) => <option value={optionValue(node)} key={node.id}>{node.name}</option>)}
    </select>
    {hasV1Motion ? <Button variant={ui.characterMotionAutoKey ? 'primary' : 'secondary'} aria-pressed={ui.characterMotionAutoKey}
      disabled={active?.motion !== 'character-clip-v1' || layer.locked} title={ui.characterMotionAutoKey ? '修改部位时记录当前时间' : '修改默认姿势，不记录关键帧'}
      onClick={() => timelineUiStore.setCharacterMotionAutoKey(!ui.characterMotionAutoKey)}><DecorativeIcon icon={Plus} size={16} />自动关键帧</Button> : null}
    </div>
  </details>;
}
