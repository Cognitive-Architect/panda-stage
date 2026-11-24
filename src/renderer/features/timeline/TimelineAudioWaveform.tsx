import { useLayoutEffect, useMemo, useRef } from 'react';
import type { AudioClip } from '../../../domain';
import type { EditorAudioClipSamples } from '../../shell/productPreviewAudio';
import { buildWaveformPeaks, projectWaveformViewport } from './audioWaveformGeometry';

export function TimelineAudioWaveform({ clip, samples, pixelsPerMs, scrollPx, viewportWidth, laneLabelWidth }: {
  clip: AudioClip;
  samples: EditorAudioClipSamples;
  pixelsPerMs: number;
  scrollPx: number;
  viewportWidth: number;
  laneLabelWidth: number;
}): React.JSX.Element | null {
  const canvas = useRef<HTMLCanvasElement>(null);
  const peaks = useMemo(() => buildWaveformPeaks(samples.buffer), [samples.buffer]);
  const view = projectWaveformViewport(clip, pixelsPerMs, scrollPx, viewportWidth, laneLabelWidth);
  const fromPx = view?.fromPx ?? 0;
  const width = view?.width ?? 0;
  const sourceMs = (view?.sourceStartMs ?? 0) - samples.sourceStartMs;
  useLayoutEffect(() => {
    const node = canvas.current;
    const graphics = node?.getContext('2d');
    if (!node || !graphics || width <= 0) return;
    const middle = node.height / 2;
    const msPerColumn = width / pixelsPerMs / node.width;
    graphics.clearRect(0, 0, node.width, node.height);
    graphics.fillStyle = getComputedStyle(node).color;
    for (let column = 0; column < node.width; column += 1) {
      const position = sourceMs + column * msPerColumn;
      const [min, max] = peaks(position, position + msPerColumn);
      const top = middle - Math.min(1, max) * middle;
      graphics.fillRect(column, top, 1, Math.max(1, (Math.min(1, max) - Math.max(-1, min)) * middle));
    }
  }, [peaks, sourceMs, width, pixelsPerMs]);
  if (!view) return null;
  return <canvas ref={canvas} className="timeline-audio-waveform" data-testid="timeline-audio-waveform"
    aria-hidden="true" width={Math.ceil(width)} height={24} style={{ left: fromPx, width }} />;
}
