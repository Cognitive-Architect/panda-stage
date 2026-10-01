import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2 } from 'lucide-react';
import type { AudioClip } from '../../../domain';
import { audioClipStore } from '../../stores/audioClipStore';
import { audioClipSelectionStore } from '../../stores/audioClipSelectionStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { IconButton } from '../../ui';

/** Contextual controls do not reserve another Timeline row or grow its height. */
export function StandaloneAudioControls({ clip }: { clip: AudioClip }): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const active = useRef(true);
  const volumeOrigin = useRef<{ instance: number | null; revision: number } | null>(null);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  useLayoutEffect(() => {
    const rect = anchor.current?.parentElement?.getBoundingClientRect();
    if (!rect) return;
    const next = { left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)), top: Math.max(8, rect.top - 64) };
    setPosition(previous => previous.left === next.left && previous.top === next.top ? previous : next);
  });
  useLayoutEffect(() => {
    const header = anchor.current?.parentElement;
    if (!header) return;
    const measure = (): void => {
      const rect = header.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 280)), top: Math.max(8, rect.top - 64) });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  const instance = editorProjectStore.getProjectInstanceId();
  const apply = (action: () => void): void => {
    if (!active.current || instance !== editorProjectStore.getProjectInstanceId() || audioClipSelectionStore.getSelectedAudioClipId() !== clip.id) return;
    try { action(); setError(null); } catch (reason) { setError(reason instanceof Error ? reason.message : '音频调整失败。'); }
  };
  const commit = (): void => {
    const origin = volumeOrigin.current;
    if (draft !== null && origin?.instance === editorProjectStore.getProjectInstanceId() && origin?.revision === editorProjectStore.getSnapshot()?.revision) apply(() => audioClipStore.setVolume(clip.id, draft));
    volumeOrigin.current = null;
    setDraft(null);
  };
  return <><span ref={anchor} aria-hidden="true" />{createPortal(<div style={position} className="standalone-audio-controls" role="group" aria-label="音频片段操作" data-testid="standalone-audio-controls">
    <label>音量 <output>{Math.round((draft ?? clip.volume) * 100)}%</output>
      <input aria-label="音频片段音量" type="range" min={0} max={2} step={0.01} value={draft ?? clip.volume}
        onChange={event => {
          volumeOrigin.current ??= { instance, revision: editorProjectStore.getSnapshot()?.revision ?? -1 };
          setDraft(Number(event.currentTarget.value));
        }}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit}
        onPointerCancel={() => setDraft(null)}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); setDraft(null); } }} />
    </label>
    <IconButton aria-label="删除音频片段" title="删除音频片段" variant="danger" icon={<Trash2 size={16} />} onClick={() => apply(() => audioClipStore.remove(clip.id))} />
    {error ? <span role="alert">{error}</span> : null}
  </div>, document.body)}</>;
}
