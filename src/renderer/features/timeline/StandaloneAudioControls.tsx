import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { AudioClip } from '../../../domain';
import { audioClipStore } from '../../stores/audioClipStore';
import { audioClipSelectionStore } from '../../stores/audioClipSelectionStore';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { IconButton } from '../../ui';

/** Contextual controls do not reserve another Timeline row or grow its height. */
export function StandaloneAudioControls({ clip, displayName }: { clip: AudioClip; displayName: string }): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const volumeOrigin = useRef<{ instance: number | null; revision: number } | null>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
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
  const cancel = (): void => {
    volumeOrigin.current = null;
    setDraft(null);
  };
  const identity = `${clip.role === 'bgm' ? 'BGM' : '音效'} · ${displayName}`;
  return <div className="standalone-audio-controls" role="group" aria-label="音频片段操作" data-testid="standalone-audio-controls" data-audio-clip-id={clip.id}>
    <span className="standalone-audio-identity" data-testid="standalone-audio-identity" title={identity}>{identity}</span>
    <label>音量 <output>{Math.round((draft ?? clip.volume) * 100)}%</output>
      <input aria-label="音频片段音量" type="range" min={0} max={2} step={0.01} value={draft ?? clip.volume}
        onChange={event => {
          volumeOrigin.current ??= { instance, revision: editorProjectStore.getSnapshot()?.revision ?? -1 };
          setDraft(Number(event.currentTarget.value));
        }}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit}
        onPointerCancel={cancel}
        onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } }} />
    </label>
    <IconButton aria-label="删除音频片段" title="删除音频片段" variant="danger" icon={<Trash2 size={16} />} onClick={() => apply(() => audioClipStore.remove(clip.id))} />
    {error ? <span role="alert">{error}</span> : null}
  </div>;
}
