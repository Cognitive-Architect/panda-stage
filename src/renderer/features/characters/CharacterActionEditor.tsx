import { useId, useMemo, useState } from 'react';
import type { Character, CharacterAction, CharacterActionDraft, Project } from '../../../domain';
import { resolveFlaGraphicPreviewTimeline } from '../../../domain/selectors/animationSourceTimeline';
import { AnimationPreview, matchesAnimationSearch } from '../assets/AnimationLibraryPanel';
import './character-action-editor.css';

interface CharacterActionEditorProps {
  character: Character | null;
  project: Project | null;
  projectRoot: string | null;
  disabled: boolean;
  disabledReason?: string;
  onSave: (draft: CharacterActionDraft) => void;
  onDelete: (actionId: string) => void;
}

/** Draft locally; only the Save action writes to the formal Project. */
export function CharacterActionEditor({
  character,
  project,
  projectRoot,
  disabled,
  disabledReason,
  onSave,
  onDelete,
}: CharacterActionEditorProps): React.JSX.Element | null {
  const titleId = useId();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [animationId, setAnimationId] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [search, setSearch] = useState('');
  const [choosingSource, setChoosingSource] = useState(false);
  const [offsetX, setOffsetX] = useState('0');
  const [offsetY, setOffsetY] = useState('0');
  const [scale, setScale] = useState('1');
  const [error, setError] = useState('');
  const actions = character?.actions ?? [];
  const currentAction = actions.find(({ id }) => id === editingId);
  const editingLayered = currentAction && 'kind' in currentAction;
  const animations = project?.animations.filter((animation) => animation.frames.length > 0) ?? [];
  const selectedAnimation = animations.find((animation) => animation.id === animationId);
  const previewAnimation = choosingSource
    ? animations.find((animation) => animation.id === previewId)
    : selectedAnimation;
  const previewPlayback = useMemo(() => previewAnimation ? {
    mode: 'play once' as const,
    firstFrame: 0,
    lastFrame: resolveFlaGraphicPreviewTimeline(previewAnimation, true).totalFrames - 1,
  } : undefined, [previewAnimation]);
  const query = search.trim().toLocaleLowerCase('zh-CN');
  const visibleAnimations = animations.filter((animation) => matchesAnimationSearch(animation, query));

  if (!character || !project) return null;

  const beginNew = (): void => {
    setEditingId(null);
    setName('');
    setAnimationId('');
    setPreviewId('');
    setSearch('');
    setChoosingSource(true);
    setOffsetX('0');
    setOffsetY('0');
    setScale('1');
    setError('');
    setEditing(true);
  };
  const beginEdit = (action: CharacterAction): void => {
    setEditingId(action.id);
    setName(action.name);
    if ('kind' in action) {
      setError('');
      setEditing(true);
      return;
    }
    setAnimationId(action.animationId);
    setPreviewId('');
    setSearch('');
    setChoosingSource(false);
    setOffsetX(String(action.placement.offsetX));
    setOffsetY(String(action.placement.offsetY));
    setScale(String(action.placement.scale));
    setError('');
    setEditing(true);
  };
  const save = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (disabled || !name.trim() || !selectedAnimation || choosingSource) return;
    const x = Number(offsetX);
    const y = Number(offsetY);
    const zoom = Number(scale);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom)) {
      setError('请填写有效的动作位置和缩放。');
      return;
    }
    try {
      onSave({
        ...(editingId ? { id: editingId } : {}),
        name,
        animationId,
        placement: { offsetX: x, offsetY: y, scale: zoom },
      });
      setEditing(false);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法保存动作。');
    }
  };

  return (
    <section className="character-action-library" data-testid="character-action-library">
      <header className="character-action-library-heading">
        <h3>动作</h3>
        <button type="button" disabled={disabled || animations.length === 0} onClick={beginNew}>新增</button>
      </header>
      {disabledReason ? <p className="character-action-empty" role="status">{disabledReason}</p> : null}
      {actions.length > 0 ? <ul className="character-action-list">
        {actions.map((action) => {
          const sourceName = 'kind' in action ? '分件动作'
            : project.animations.find((animation) => animation.id === action.animationId)?.name ?? '未知动画';
          return <li key={action.id}><button type="button"
            aria-pressed={editing && editingId === action.id}
            className="character-action-item" onClick={() => beginEdit(action)}>
            <span>{action.name}</span><small>{sourceName}</small>
          </button></li>;
        })}
      </ul> : null}
      {animations.length === 0 ? <p className="character-action-empty">暂无可用动画素材</p> : null}
      {editing && editingLayered ? <div className="character-action-form">
        <strong>{currentAction.name}</strong>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          <button type="button" disabled={disabled} onClick={() => {
            try {
              onDelete(currentAction.id);
              setEditing(false);
              setEditingId(null);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '无法删除动作。');
            }
          }}>删除</button>
          <button type="button" onClick={() => setEditing(false)}>关闭</button>
        </footer>
      </div> : editing ? <form className="character-action-form" onSubmit={save}>
        <label>名称<input autoFocus maxLength={64} value={name} onChange={(event) => setName(event.target.value)} /></label>
        {choosingSource ? <>
          <input type="search" aria-label="搜索动作动画" placeholder="搜索动画" value={search}
            onChange={(event) => { setSearch(event.target.value); setPreviewId(''); }} />
          {visibleAnimations.length ? <ul className="character-action-list character-action-sources">
            {visibleAnimations.map((animation) => <li key={animation.id}>
              <button type="button" className="character-action-item" aria-pressed={previewId === animation.id}
                onClick={() => setPreviewId(animation.id)}>{animation.name}</button>
            </li>)}
          </ul> : <p className="character-action-empty">没有匹配的动画</p>}
        </> : <div className="character-action-item">
          <span>{selectedAnimation?.name ?? '请选择动画'}</span>
          <button type="button" onClick={() => { setSearch(''); setPreviewId(animationId); setChoosingSource(true); }}>
            {selectedAnimation ? '更换' : '选择动画'}
          </button>
        </div>}
        {previewAnimation && projectRoot ? <AnimationPreview
          key={previewAnimation.id}
          animation={previewAnimation}
          project={project}
          projectRoot={projectRoot}
          titleId={titleId}
          playback={previewPlayback}
        /> : null}
        {choosingSource && previewAnimation ? <button type="button" onClick={() => {
          setAnimationId(previewAnimation.id); setChoosingSource(false);
        }}>使用此动画</button> : null}
        <details key={editingId ?? 'new'}>
          <summary>位置微调</summary>
          <div className="character-action-placement">
            <label>偏移 X<input type="number" min={-1_000_000} max={1_000_000} step="any" value={offsetX} onChange={(event) => setOffsetX(event.target.value)} /></label>
            <label>偏移 Y<input type="number" min={-1_000_000} max={1_000_000} step="any" value={offsetY} onChange={(event) => setOffsetY(event.target.value)} /></label>
            <label>缩放<input type="number" min={0.05} max={20} step="any" value={scale} onChange={(event) => setScale(event.target.value)} /></label>
          </div>
        </details>
        {error ? <p role="alert">{error}</p> : null}
        <footer>
          {editingId ? <button type="button" disabled={disabled} onClick={() => {
            if (disabled) return;
            try {
              onDelete(editingId);
              setEditing(false);
              setEditingId(null);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : '无法删除动作。');
            }
          }}>删除</button> : null}
          <button type="button" onClick={() => { setEditing(false); setError(''); }}>取消</button>
          <button type="submit" disabled={disabled || !name.trim() || !selectedAnimation || choosingSource}>保存</button>
        </footer>
      </form> : null}
    </section>
  );
}
