import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { findDialogueText, type DialogueTextMatch, type Project } from '../../../domain';
import { dialogueStore } from '../../stores/dialogueStore';
import { Button, IconButton } from '../../ui';
import { formatTimecode } from '../timeline/timeGeometry';

const PAGE_SIZE = 40;

export function DialogueFindReplace({ project, shotId, onLocate, onClose }: {
  project: Project;
  shotId: string;
  onLocate: (match: DialogueTextMatch) => void;
  onClose: () => void;
}): React.JSX.Element {
  const headingId = useId();
  const queryInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [scope, setScope] = useState<'shot' | 'project'>('shot');
  const [selected, setSelected] = useState<DialogueTextMatch | null>(null);
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const hits = useMemo(() => [...findDialogueText(project, { query, shotId: scope === 'shot' ? shotId : null })],
    [project, query, scope, shotId]);
  const shots = useMemo(() => new Map(project.shots.map((shot) => [shot.id, {
    name: shot.name,
    dialogues: new Map(shot.dialogues.map((dialogue) => [dialogue.id, dialogue.startMs])),
  }])), [project]);
  const currentMatch = selected && hits.find((hit) => hit.shotId === selected.shotId &&
    hit.dialogueId === selected.dialogueId && hit.offset === selected.offset && hit.text === selected.text);
  const lastPage = Math.max(0, Math.ceil(hits.length / PAGE_SIZE) - 1);
  const visiblePage = Math.min(page, lastPage);

  useEffect(() => { queryInput.current?.focus(); }, []);

  const resetMatches = (): void => {
    setSelected(null);
    setError('');
    setPage(0);
  };
  const replace = (match?: DialogueTextMatch): void => {
    try {
      dialogueStore.replaceText(scope, query, replacement, match);
      setSelected(null);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法替换台词。');
    }
  };

  return createPortal(
    <section className="dialogue-find-replace" role="dialog" aria-labelledby={headingId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onClose();
      }}>
      <header>
        <h3 id={headingId}>台词查找替换</h3>
        <IconButton aria-label="关闭台词查找替换" variant="secondary" icon={<X size={16} />} onClick={onClose} />
      </header>
      <label>
        范围
        <select value={scope} onChange={(event) => {
          setScope(event.target.value === 'project' ? 'project' : 'shot');
          resetMatches();
        }}>
          <option value="shot">当前镜头</option>
          <option value="project">全片</option>
        </select>
      </label>
      <label>
        查找
        <input ref={queryInput} value={query} maxLength={10_000} onChange={(event) => {
          setQuery(event.target.value);
          resetMatches();
        }} />
      </label>
      <label>
        替换为
        <input value={replacement} maxLength={10_000} onChange={(event) => {
          setReplacement(event.target.value);
          setError('');
        }} />
      </label>
      <div className="dialogue-find-actions">
        <Button variant="secondary" disabled={!currentMatch || query === replacement}
          onClick={() => { if (currentMatch) replace(currentMatch); }}>替换此处</Button>
        <Button disabled={!hits.length || query === replacement} onClick={() => replace()}>全部替换</Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {query ? <output aria-live="polite">{hits.length} 处命中</output> : null}
      {hits.length ? <ul className="dialogue-find-results">
        {hits.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE).map((match) => {
          const shot = shots.get(match.shotId);
          const snippetStart = Math.max(0, match.offset - 16);
          const matchEnd = match.offset + query.length;
          const snippetEnd = Math.min(match.text.length, matchEnd + 24);
          return <li key={JSON.stringify([match.shotId, match.dialogueId, match.offset])}>
            <Button variant="secondary" aria-pressed={match === currentMatch} onClick={() => {
              setSelected(match);
              setError('');
              onLocate(match);
            }}>
              <small>{shot?.name} · {formatTimecode(shot?.dialogues.get(match.dialogueId) ?? 0)}</small>
              <span>{snippetStart > 0 ? '…' : ''}{match.text.slice(snippetStart, match.offset)}
                <mark>{match.text.slice(match.offset, matchEnd)}</mark>
                {match.text.slice(matchEnd, snippetEnd)}{snippetEnd < match.text.length ? '…' : ''}</span>
            </Button>
          </li>;
        })}
      </ul> : null}
      {lastPage > 0 ? <div className="dialogue-find-actions">
        <Button variant="secondary" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>上一页</Button>
        <span>{visiblePage + 1} / {lastPage + 1}</span>
        <Button variant="secondary" disabled={visiblePage === lastPage} onClick={() => setPage(visiblePage + 1)}>下一页</Button>
      </div> : null}
    </section>,
    document.body,
  );
}
