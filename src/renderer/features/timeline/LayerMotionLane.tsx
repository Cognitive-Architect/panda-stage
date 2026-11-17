import { useEffect, useState } from 'react';
import {
  frameTimeMs,
  hasLayerCompositeKeyOutgoingInterval,
  layerCompositeKeyEasing,
  layerCompositeKeyTimes,
  LayerMotionService,
  TIMELINE_FPS,
  type Layer,
  type Shot,
} from '../../../domain';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
} from '../../stores/EditorProjectStore';
import { isSupportedLayerMotionLayer } from '../properties/layerTransformTemporalGuard';
import { MotionKeyLaneControl } from './MotionKeyLaneControl';

export interface LayerMotionLaneProps {
  snapshot: EditorProjectSnapshot;
  shot: Shot;
  layerId: string | null;
  pixelsPerMs: number;
  currentTimeMs: number;
  trackWidth: number;
  toolbarHost?: HTMLElement | null;
  productPreviewOpen?: boolean;
}

interface LayerPoseClipboard {
  scopeKey: string;
  fromTimeMs: number;
}

const layerMotionService = new LayerMotionService();

function commitMotionProject(next: EditorProjectSnapshot['project'], label: string): void {
  const current = editorProjectStore.getSnapshot();
  if (!current || next === current.project) return;
  editorProjectStore.updateProject(next, label);
}

/**
 * Single「对象动作」Timeline lane for a selected standalone FLA Graphic Layer.
 * Shares key marker / multi-select / touch capture UX via MotionKeyLaneControl.
 */
export function LayerMotionLane({
  snapshot,
  shot,
  layerId,
  pixelsPerMs,
  currentTimeMs,
  trackWidth,
  toolbarHost = null,
  productPreviewOpen = false,
}: LayerMotionLaneProps): React.JSX.Element | null {
  const layer: Layer | undefined = shot.layers.find(
    (candidate) => candidate.id === layerId,
  );
  const supported = isSupportedLayerMotionLayer(snapshot.project, shot, layer);
  const instanceId = editorProjectStore.getProjectInstanceId();
  const scopeKey = `${instanceId ?? 'none'}:${shot.id}:${layer?.id ?? 'none'}`;
  const [clipboard, setClipboard] = useState<LayerPoseClipboard | null>(null);

  useEffect(() => {
    setClipboard((current) =>
      current && current.scopeKey === scopeKey ? current : null,
    );
  }, [scopeKey]);

  if (!supported || !layer) return null;

  const timesMs = layerCompositeKeyTimes(layer);
  const hasClipboard = Boolean(
    clipboard &&
      clipboard.scopeKey === scopeKey &&
      timesMs.includes(clipboard.fromTimeMs),
  );

  return (
    <MotionKeyLaneControl
      currentTimeMs={currentTimeMs}
      hasClipboard={hasClipboard}
      hasOutgoingInterval={(timeMs) =>
        hasLayerCompositeKeyOutgoingInterval(layer, timeMs)
      }
      instanceId={instanceId}
      label="对象动作"
      laneClassName="layer-motion-lane"
      laneTestId="layer-motion-lane"
      layer={layer}
      onCopyPose={(timeMs) => {
        setClipboard({ scopeKey, fromTimeMs: timeMs });
      }}
      onDeleteKey={(timeMs) => {
        const next = layerMotionService.deleteKey(snapshot.project, {
          shotId: shot.id,
          layerId: layer.id,
          timeMs,
        });
        commitMotionProject(next, '删除对象动作关键帧');
      }}
      onPastePose={(targetTimeMs) => {
        if (!clipboard || clipboard.scopeKey !== scopeKey) return;
        const next = layerMotionService.pasteKeys(snapshot.project, {
          shotId: shot.id,
          layerId: layer.id,
          fromTimeMs: clipboard.fromTimeMs,
          toTimeMs: targetTimeMs,
        });
        commitMotionProject(next, '粘贴对象姿势');
      }}
      onRetimeKeys={(fromTimesMs, deltaFrames) => {
        if (fromTimesMs.length === 1) {
          const fromTimeMs = fromTimesMs[0]!;
          const toTimeMs = frameTimeMs(
            Math.round((fromTimeMs * TIMELINE_FPS) / 1_000) + deltaFrames,
          );
          const next = layerMotionService.retimeKey(snapshot.project, {
            shotId: shot.id,
            layerId: layer.id,
            fromTimeMs,
            toTimeMs,
          });
          commitMotionProject(next, '调整对象动作关键帧时间');
          return [toTimeMs];
        }
        const next = layerMotionService.retimeKeys(snapshot.project, {
          shotId: shot.id,
          layerId: layer.id,
          fromTimesMs,
          deltaFrames,
        });
        commitMotionProject(next, '批量移动对象动作关键帧');
        return fromTimesMs.map((timeMs) =>
          frameTimeMs(Math.round((timeMs * TIMELINE_FPS) / 1_000) + deltaFrames),
        );
      }}
      onSetEasing={(timeMs, easing) => {
        const next = layerMotionService.setKeyEasing(
          snapshot.project,
          { shotId: shot.id, layerId: layer.id, timeMs },
          easing,
        );
        commitMotionProject(next, '修改对象动作关键帧补间');
      }}
      pixelsPerMs={pixelsPerMs}
      productPreviewOpen={productPreviewOpen}
      readEasing={(timeMs) => layerCompositeKeyEasing(layer, timeMs)}
      scopeKey={scopeKey}
      shot={shot}
      snapshot={snapshot}
      testIdPrefix="layer-motion"
      timesMs={timesMs}
      toolbarHost={toolbarHost}
      toolbarTestId="layer-motion-toolbar"
      trackWidth={trackWidth}
    />
  );
}
