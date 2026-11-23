import { useId, useState } from 'react';
import type { Character, CharacterAction, CharacterActionDraft, Project } from '../../../domain';
import { AnimationPreview } from '../assets/AnimationLibraryPanel';
import './character-action-editor.css';

interface CharacterActionEditorProps {
  character: Character | null;
  project: Project | null;
  projectRoot: string | null;
  disabled: boolean;
  onSave: (draft: CharacterActionDraft) => CharacterAction | null;
  onDelete: (actionId: string) => boolean;
}

/** Draft locally; only the Save action writes to the formal Project. */
export function CharacterActionEditor({
  character,
  project,
  projectRoot,
  disabled,
  onSave,
  onDelete,
}: CharacterActionEditorProps): React.JSX.Element | null {
  const titleId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [animationId, setAnimationId] = useState('');
  const [offsetX, setOffsetX] = useState('0');
  const [offsetY, setOffsetY] = useState('0');
  const [scale, setScale] = useState('1');
  const [error, setError] = useState('');
  const actions = character?.actions ?? [];
  const animations = project?.animations.filter((animation) => animation.frames.length > 0) ?? [];
  const selectedAnimation = animations.find((animation) => animation.id === animationId);

  if (!character || !project) return null;

  const beginNew = (): void => {
    setEditingId(null);
    setName('');
    setAnimationId(animations[0]?.id ?? '');
    setOffsetX('0');
    setOffsetY('0');
    setScale('1');
    setError('');
    setEditing(true);
  };
  const beginEdit = (action: CharacterAction): void => {
    setEditingId(action.id);
    setName(action.name);
    setAnimationId(action.animationId);
    setOffsetX(String(action.placement.offsetX));
    setOffsetY(String(action.placement.offsetY));
    setScale(String(action.placement.scale));
    setError('');
    setEditing(true);
  };
  const save = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const x = Number(offsetX);
    const y = Number(offsetY);
    const zoom = Number(scale);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
      setError('请填写有效的动作位置和缩放。');
      return;
    }
    const saved = onSave({
      ...(editingId ? { id: editingId } : {}),
      name,
      animationId,
      placement: { offsetX: x, offsetY: y, scale: zoom },
    });
    if (!saved) return;
    setEditingId(saved.id);
    setName(saved.name);
    setAnimationId(saved.animationId);
    setOffsetX(String(saved.placement.offsetX));
    setOffsetY(String(saved.placement.offsetY));
    setScale(String(saved.placement.scale));
    setEditing(false);
    setError('');
  };

  return (
    <section className="character-action-library" data-testid="character-action-library">
      <header className="character-action-library-heading">
        <h3>动作</h3>
        <button type="button" disabled={disabled || animations.length === 0} onClick={beginNew}>新增</button>
      </header>
      {actions.length > 0 ? <div className="character-action-list" role="list">
        {actions.map((action) => {
          const source = project.animations.find((animation) => animation.id === action.animationId);
          return <button type="button" role="listitem" key={action.id}
            aria-pressed={editing && editingId === action.id}
            className="character-action-item" onClick={() => beginEdit(action)}>
            <span>{action.name}</span><small>{source?.name ?? '未知动画'}</small>
          </button>;
        })}
      </div> : null}
      {animations.length === 0 ? <p className="character-action-empty">暂无可用动画素材</p> : null}
      {editing ? <form className="character-action-form" onSubmit={save}>
        <label>名称<input autoFocus maxLength={64} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label>动画<select value={animationId} onChange={(event) => setAnimationId(event.target.value)}>
          {animations.map((animation) => <option key={animation.id} value={animation.id}>{animation.name}</option>)}
        </select></label>
        <div className="character-action-placement">
          <label>偏移 X<input type="number" min={-1_000_000} max={1_000_000} step={1} value={offsetX} onChange={(event) => setOffsetX(event.target.value)} /></label>
          <label>偏移 Y<input type="number" min={-1_000_000} max={1_000_000} step={1} value={offsetY} onChange={(event) => setOffsetY(event.target.value)} /></label>
          <label>缩放<input type="number" min={0.05} max={20} step={0.05} value={scale} onChange={(event) => setScale(event.target.value)} /></label>
        </div>
        {selectedAnimation && projectRoot ? <AnimationPreview
          animation={selectedAnimation}
          project={project}
          projectRoot={projectRoot}
          titleId={titleId}
        /> : null}
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          {editingId ? <button type="button" disabled={disabled} onClick={() => {
            if (onDelete(editingId)) { setEditing(false); setEditingId(null); }
          }}>删除</button> : null}
          <button type="button" onClick={() => { setEditing(false); setError(''); }}>取消</button>
          <button type="submit" disabled={disabled || !name.trim() || !animationId}>保存</button>
        </footer>
      </form> : null}
    </section>
  );
}
