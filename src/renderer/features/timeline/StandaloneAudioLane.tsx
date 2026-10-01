import { useState } from 'react';
import { Music2, Volume2 } from 'lucide-react';
import type { Project, StandaloneAudioRole } from '../../../domain';
import { ASSET_DRAG_MIME, parseAssetDropPayload } from '../assets/AssetDropPayload';
import { audioClipStore } from '../../stores/audioClipStore';
import { StandaloneAudioClip } from './StandaloneAudioClip';
import { clampTime, pxToTime } from './timeGeometry';

export function standaloneAudioDrop(serialized: string, clientX: number, contentLeft: number, pixelsPerMs: number, durationMs: number): { assetId: string; startMs: number } {
  const payload = parseAssetDropPayload(serialized);
  if (payload.type !== 'audio') throw new Error('请拖入音频素材。');
  if (pixelsPerMs <= 0) throw new Error('时间轴尚未就绪，请重试。');
  return { assetId: payload.assetId, startMs: Math.round(clampTime(pxToTime(clientX - contentLeft, pixelsPerMs), durationMs)) };
}

export function StandaloneAudioLane({ role, project, shotId, trackWidth, pixelsPerMs, selectedClipId }: {
  role: StandaloneAudioRole; project: Project; shotId: string; trackWidth: number;
  pixelsPerMs: number; selectedClipId: string | null;
}): React.JSX.Element {
  const [hover, setHover] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shot = project.shots.find(candidate => candidate.id === shotId)!;
  const clips = shot.audioClips.filter(clip => clip.role === role);
  const title = role === 'sfx' ? '音效' : 'BGM';
  const Icon = role === 'sfx' ? Volume2 : Music2;
  return <div className="timeline-lane timeline-audio-lane standalone-audio-lane" data-testid={`timeline-${role}-track`} data-track-kind={role}>
    <span className="timeline-lane-label" data-track-label={role}><Icon aria-hidden="true" className="timeline-lane-icon" size={16} /><span className="timeline-lane-label-text">{title}</span></span>
    <div className="timeline-lane-content" data-drop-active={String(hover)} style={{ width: trackWidth }}
      onDragOver={event => {
        if (!event.dataTransfer.types.includes(ASSET_DRAG_MIME)) return;
        event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy'; setHover(true);
      }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHover(false); }}
      onDrop={event => {
        event.preventDefault(); event.stopPropagation(); setHover(false);
        try {
          const drop = standaloneAudioDrop(event.dataTransfer.getData(ASSET_DRAG_MIME), event.clientX, event.currentTarget.getBoundingClientRect().left, pixelsPerMs, shot.durationMs);
          audioClipStore.create(drop.assetId, role, drop.startMs); setError(null);
        } catch (reason) { setError(reason instanceof Error ? reason.message : '音频添加失败。'); }
      }}
    >
      {clips.map(clip => <StandaloneAudioClip key={clip.id} clip={clip} displayName={project.assets.find(asset => asset.id === clip.assetId)?.name ?? clip.name}
        shotId={shotId} pixelsPerMs={pixelsPerMs} selected={clip.id === selectedClipId} />)}
      {clips.length === 0 ? <span className="timeline-audio-empty">拖入{title}</span> : null}
      {error ? <span role="alert" className="standalone-audio-drop-error">{error}</span> : null}
    </div>
  </div>;
}
