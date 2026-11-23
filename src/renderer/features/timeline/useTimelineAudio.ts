import { useLayoutEffect, useRef, useState } from 'react';
import type { AudioClip } from '../../../domain';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { ProductPreviewAudioTransport, type EditorAudioClipSamples } from '../../shell/productPreviewAudio';

export function useTimelineAudio(shotId: string | null, clip: AudioClip | undefined, enabled: boolean) {
  const transport = useRef<ProductPreviewAudioTransport | null>(null);
  const project = editorProjectStore.getSnapshot()?.project;
  const asset = project?.assets.find(({ id }) => clip?.assetId === id);
  const instance = editorProjectStore.getProjectInstanceId();
  const clipId = clip?.id;
  const key = enabled && clip && asset && shotId ? JSON.stringify([
    instance, shotId, clipId, clip.assetId, asset.sha256, clip.startMs, clip.endMs, clip.offsetMs, clip.volume,
  ]) : null;
  const [read, setRead] = useState<{ key: string; samples: EditorAudioClipSamples | null; error: boolean }>();

  useLayoutEffect(() => {
    if (!enabled || instance === null) return;
    const owner = new ProductPreviewAudioTransport();
    transport.current = owner;
    return () => {
      transport.current = null;
      owner.dispose();
    };
  }, [enabled, instance]);

  useLayoutEffect(() => {
    const owner = transport.current;
    const current = editorProjectStore.getSnapshot();
    const active = current?.project.shots.find(({ id }) => id === shotId)?.audioClips.find(({ id }) => id === clipId);
    setRead(undefined);
    if (!owner || !current || !active || !key) return;
    const cancellation = new AbortController();
    void owner.readEditorClip(current, active, cancellation.signal).then((samples) => {
      if (!cancellation.signal.aborted) setRead({ key, samples, error: !samples });
    }, () => {
      if (!cancellation.signal.aborted) setRead({ key, samples: null, error: true });
    });
    return () => cancellation.abort();
  }, [key, shotId, clipId]);

  const selected = read?.key === key ? read : undefined;
  return {
    samples: selected?.samples ?? null,
    unavailable: Boolean(selected?.error || (enabled && clip && !asset)),
  };
}
