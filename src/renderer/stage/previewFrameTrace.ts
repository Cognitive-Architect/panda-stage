import type { EvaluatedShot, Project } from '../../domain';
import {
  previewFrameDiagnosticsEnabled,
  type PreviewFrameTraceContext,
} from './previewDiagnostics';

export interface ResolvedPreviewAnimationFrame {
  instanceId: string;
  animationId: string;
  frameIndex: number;
  cycleIndex: number;
  frameId: string;
  assetId: string;
}

export function resolvePreviewAnimationFrame(
  project: Project,
  evaluatedShot: Pick<EvaluatedShot, 'shotId' | 'timeMs' | 'layers'>,
  instanceId?: string,
): ResolvedPreviewAnimationFrame | null {
  const shot = project.shots.find(
    (candidate) => candidate.id === evaluatedShot.shotId,
  );
  if (!shot) return null;

  for (const layer of shot.layers) {
    if (instanceId && layer.id !== instanceId) continue;
    if (layer.source.kind !== 'animation') continue;
    const animationId = layer.source.animationId;
    const evaluatedLayer = evaluatedShot.layers.find(
      (candidate) => candidate.id === layer.id,
    );
    const animation = project.animations.find(
      (candidate) => candidate.id === animationId,
    );
    if (!evaluatedLayer?.animationFrame || !animation || animation.frames.length === 0) {
      continue;
    }
    if (!evaluatedLayer.visible) return null;

    const elapsedMs = evaluatedShot.timeMs - (layer.startTimeMs ?? 0);
    const elapsedFrames = Math.floor(
      Math.max(0, elapsedMs) * animation.source.sourceFps / 1_000,
    );
    const cycleIndex = layer.animationPlayback?.mode === 'loop'
      ? Math.floor(elapsedFrames / animation.frames.length)
      : 0;
    const frameIndex = layer.animationPlayback?.mode === 'loop'
      ? elapsedFrames % animation.frames.length
      : Math.min(animation.frames.length - 1, elapsedFrames);
    const frame = animation.frames[frameIndex];
    if (!frame || frame.assetId !== evaluatedLayer.assetId) continue;
    return {
      instanceId: layer.id,
      animationId: animation.id,
      frameIndex,
      cycleIndex,
      frameId: `${animation.id}:frame-${frameIndex}`,
      assetId: frame.assetId,
    };
  }
  return null;
}

export function createPreviewFrameTraceContext(
  frame: ResolvedPreviewAnimationFrame,
  shotId: string,
  shotTimeMs: number,
  playbackGeneration: number,
  seekGeneration: number,
  targetEpoch = 0,
): PreviewFrameTraceContext | null {
  if (!previewFrameDiagnosticsEnabled()) return null;
  const traceId = JSON.stringify([
    shotId,
    frame.instanceId,
    frame.assetId,
    playbackGeneration,
    seekGeneration,
    targetEpoch,
    frame.cycleIndex,
    frame.frameIndex,
  ]);
  return {
    traceId,
    instanceId: frame.instanceId,
    playbackGeneration,
    seekGeneration,
    targetEpoch,
    shotId,
    shotTimeMs,
    cycleIndex: frame.cycleIndex,
    frameIndex: frame.frameIndex,
    targetFrameId: frame.frameId,
    targetAssetId: frame.assetId,
    requestedAt: performance.now(),
  };
}
