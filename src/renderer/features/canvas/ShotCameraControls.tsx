import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { Camera } from 'lucide-react';
import {
  addShotCameraOverride,
  CAMERA_MOTION_PRESET_LABELS,
  DEFAULT_ANIMATION_BEZIER,
  DEFAULT_CAMERA_PRESET_DURATION_MS,
  DEFAULT_CAMERA_PRESET_PAN_X_PX,
  DEFAULT_CAMERA_PRESET_PAN_Y_PX,
  DEFAULT_CAMERA_PRESET_ZOOM_FACTOR,
  evaluateManualCamera,
  inspectAnimationCurve,
  planCameraMotionPreset,
  removeShotCameraKey,
  removeShotCameraOverride,
  resolveTimelineFrameTime,
  sampleAnimationEaseCurve,
  setShotCameraKey,
  setShotCameraMode,
  ShotService,
  updateShotCameraOverride,
  type AnimationBezier,
  type AnimationInterpolation,
  type ApplyCameraMotionPresetInput,
  type CameraMotionPresetId,
  type CameraPresetHybridAction,
  type Project,
  type Shot,
  type ShotCameraOverride,
} from '../../../domain';
import { ShotCameraModeSchema } from '../../../domain/models/shotCamera';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { resolveSelectedCameraOverride, shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { formatTimecode } from '../timeline/timeGeometry';
import { timelineUiStore } from '../timeline/timelineUiStore';
import { ShotAutoFramingControls } from './ShotAutoFramingControls';
import type { ShotCameraCurveDraft } from './ShotCameraCurveDraft';

const easingLabels: Readonly<Record<AnimationInterpolation, string>> = {
  linear: '线性', 'ease-in': '缓入', 'ease-out': '缓出', 'ease-in-out': '缓入缓出', step: '保持',
};

const poseFields = [
  ['centerX', '中心 X'], ['centerY', '中心 Y'], ['zoom', '倍率'], ['rotationDeg', '旋转 °'],
] as const;

const overrideTimeFields = [
  ['startMs', '开始 ms'], ['endMs', '结束 ms'], ['blendInMs', '入场 ms'], ['blendOutMs', '出场 ms'],
] as const;

const curveChart = { left: 20, top: 14, width: 280, height: 100 };
const toCurveX = (x: number): number => curveChart.left + x * curveChart.width;
const toCurveY = (y: number): number => curveChart.top + (1 - y) * curveChart.height;
const clampUnit = (value: number): number => Math.min(1, Math.max(0, value));
const shotService = new ShotService();

type CurveDragState = {
  pointer: number;
  handle: 'first' | 'second';
  revision: number;
  projectInstanceId: number | null;
  keyTimeMs: number;
  handles: AnimationBezier;
  draft?: ShotCameraCurveDraft;
};

function resolveNewOverrideBounds(
  shot: Shot,
  time: number,
  overrides: readonly ShotCameraOverride[],
): { startMs: number; endMs: number } | null {
  const nextOverride = overrides.find((override) => override.startMs > time);
  const activeOverride = overrides.find((override) => time >= override.startMs && time < override.endMs);
  if (!activeOverride && time < shot.durationMs) {
    const limit = nextOverride ? nextOverride.startMs : shot.durationMs;
    const endMs = Math.min(limit, time + 1_000);
    if (endMs > time) return { startMs: time, endMs };
  }
  let cursor = 0;
  for (const override of overrides) {
    if (override.startMs > cursor) {
      return { startMs: cursor, endMs: Math.min(override.startMs, cursor + 1_000) };
    }
    cursor = override.endMs;
  }
  if (cursor < shot.durationMs) {
    return { startMs: cursor, endMs: Math.min(shot.durationMs, cursor + 1_000) };
  }
  return null;
}

function defaultAmplitudeForPreset(preset: CameraMotionPresetId): number {
  switch (preset) {
    case 'push-in':
    case 'pull-out':
      return DEFAULT_CAMERA_PRESET_ZOOM_FACTOR;
    case 'pan-horizontal':
      return DEFAULT_CAMERA_PRESET_PAN_X_PX;
    case 'pan-vertical':
      return DEFAULT_CAMERA_PRESET_PAN_Y_PX;
    default:
      return DEFAULT_CAMERA_PRESET_ZOOM_FACTOR;
  }
}

export function ShotCameraControls({ shot, timeMs, throughCamera, onViewChange, cameraTool, onToolChange, onCurveDraft }: {
  shot: Shot;
  timeMs: number;
  throughCamera: boolean;
  onViewChange: (enabled: boolean) => void;
  cameraTool: boolean;
  onToolChange: (enabled: boolean) => void;
  onCurveDraft?: (draft: ShotCameraCurveDraft | null) => void;
}): React.JSX.Element {
  const [error, setError] = useState('');
  const selectedOverrideId = useSyncExternalStore(
    shotStore.subscribe,
    shotStore.getSelectedCameraOverrideId,
    shotStore.getSelectedCameraOverrideId,
  );
  const [dragHandles, setDragHandles] = useState<AnimationBezier | undefined>(undefined);
  const [presetId, setPresetId] = useState<CameraMotionPresetId>('push-in');
  const [presetDurationMs, setPresetDurationMs] = useState<number>(DEFAULT_CAMERA_PRESET_DURATION_MS);
  const [presetAmplitude, setPresetAmplitude] = useState<number>(DEFAULT_CAMERA_PRESET_ZOOM_FACTOR);
  const [presetEasing, setPresetEasing] = useState<AnimationInterpolation>('ease-in-out');
  const [presetStartLayerId, setPresetStartLayerId] = useState<string>('');
  const [presetTargetLayerId, setPresetTargetLayerId] = useState<string>('');
  const [presetReturnToStart, setPresetReturnToStart] = useState<boolean>(false);
  const [presetOverwrite, setPresetOverwrite] = useState<boolean>(false);
  const [presetHybridAction, setPresetHybridAction] = useState<CameraPresetHybridAction>('use-selected-override');

  const curveSvgRef = useRef<SVGSVGElement>(null);
  const curveDragRef = useRef<CurveDragState | null>(null);

  const time = resolveTimelineFrameTime(timeMs, shot.durationMs);
  const mode = shot.camera?.mode;
  const hasManualTrack = mode === 'manual' || mode === 'hybrid';
  const keys = shot.camera?.keys ?? [];
  const overrides = shot.camera?.overrides ?? [];
  const index = keys.findIndex((entry) => entry.timeMs === time);
  const key = keys[index];
  const nextKey = index >= 0 ? keys[index + 1] : undefined;
  const pose = key ?? evaluateManualCamera(shot, time);
  const inspectedCurve = key && nextKey
    ? inspectAnimationCurve(key.interpolationToNext, key.curveToNext)
    : null;
  const displayCurve = dragHandles ? { bezier: dragHandles } : key?.curveToNext;
  const handlePoints = dragHandles ?? inspectedCurve?.equivalentBezier ?? DEFAULT_ANIMATION_BEZIER;
  const curvePolyline = key && nextKey
    ? sampleAnimationEaseCurve(key.interpolationToNext, displayCurve, 64)
        .map((point) => `${toCurveX(point.x)},${toCurveY(point.y)}`)
        .join(' ')
    : '';
  const curveSelectValue = key?.curveToNext?.window
    ? 'window'
    : key?.curveToNext?.bezier
      ? 'custom'
      : (key?.interpolationToNext ?? 'linear');

  const selectedOverride = resolveSelectedCameraOverride(shot, selectedOverrideId, time) ?? overrides[0];
  const newOverrideBounds = mode === 'hybrid' ? resolveNewOverrideBounds(shot, time, overrides) : null;
  const targetableLayers = shot.layers.filter((layer) => layer.cameraSpace !== 'screen');

  useEffect(() => () => {
    curveDragRef.current = null;
    onCurveDraft?.(null);
  }, [onCurveDraft]);

  useEffect(() => {
    if (curveDragRef.current && curveDragRef.current.keyTimeMs !== time) {
      const active = curveDragRef.current;
      curveDragRef.current = null;
      if (curveSvgRef.current?.hasPointerCapture(active.pointer)) {
        curveSvgRef.current.releasePointerCapture(active.pointer);
      }
      onCurveDraft?.(null);
      setDragHandles(undefined);
    }
  }, [onCurveDraft, time]);

  function cancelCurveDrag(): void {
    const active = curveDragRef.current;
    curveDragRef.current = null;
    if (active && curveSvgRef.current?.hasPointerCapture(active.pointer)) {
      curveSvgRef.current.releasePointerCapture(active.pointer);
    }
    onCurveDraft?.(null);
    setDragHandles(undefined);
  }

  function currentSnapshot(expectedRevision?: number, expectedInstanceId?: number | null) {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot || shot.id !== shotStore.getCurrentShotId()) return null;
    if (expectedRevision !== undefined && snapshot.revision !== expectedRevision) return null;
    if (expectedInstanceId !== undefined && editorProjectStore.getProjectInstanceId() !== expectedInstanceId) {
      return null;
    }
    if (expectedRevision === undefined && snapshot.project.shots.find((entry) => entry.id === shot.id) !== shot) {
      return null;
    }
    return snapshot;
  }

  function edit(change: (project: Project) => Project, label: string): boolean {
    const snapshot = currentSnapshot();
    if (!snapshot) return false;
    try {
      editorProjectStore.updateProject(change(snapshot.project), label);
      setError('');
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '无法修改相机。请检查数值或稍后重试。');
      return false;
    }
  }

  function setKey(changes: Parameters<typeof setShotCameraKey>[3]): void {
    cancelCurveDrag();
    edit((project) => setShotCameraKey(project, shot.id, time, changes), '编辑相机关键帧');
  }

  function beginCurveDrag(event: PointerEvent<SVGCircleElement>, handle: CurveDragState['handle']): void {
    if (event.button !== 0 || !key || !nextKey || !inspectedCurve?.canDragHandles || !curveSvgRef.current) return;
    const snapshot = currentSnapshot();
    if (!snapshot) return;
    if (curveDragRef.current) cancelCurveDrag();
    event.preventDefault();
    event.currentTarget.focus();
    curveSvgRef.current.setPointerCapture(event.pointerId);
    curveDragRef.current = {
      pointer: event.pointerId,
      handle,
      revision: snapshot.revision,
      projectInstanceId: editorProjectStore.getProjectInstanceId(),
      keyTimeMs: key.timeMs,
      handles: handlePoints,
    };
  }

  function moveCurveDrag(event: PointerEvent<SVGSVGElement>): void {
    const active = curveDragRef.current;
    if (!active || event.pointerId !== active.pointer || !key || !nextKey) return;
    const snapshot = currentSnapshot(active.revision, active.projectInstanceId);
    const matrix = event.currentTarget.getScreenCTM();
    if (!snapshot || !matrix) {
      cancelCurveDrag();
      return;
    }
    const location = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const x = clampUnit((location.x - curveChart.left) / curveChart.width);
    const y = clampUnit(1 - (location.y - curveChart.top) / curveChart.height);
    const adjusted: AnimationBezier = active.handle === 'first'
      ? { ...active.handles, x1: Math.min(x, active.handles.x2), y1: y }
      : { ...active.handles, x2: Math.max(x, active.handles.x1), y2: y };
    if (
      adjusted.x1 === active.handles.x1 &&
      adjusted.x2 === active.handles.x2 &&
      adjusted.y1 === active.handles.y1 &&
      adjusted.y2 === active.handles.y2
    ) {
      return;
    }
    try {
      const previewProject = setShotCameraKey(snapshot.project, shot.id, key.timeMs, {
        curveToNext: { bezier: adjusted },
      });
      active.handles = adjusted;
      active.draft = {
        project: previewProject,
        projectInstanceId: active.projectInstanceId,
        revision: active.revision,
        shotId: shot.id,
        keyTimeMs: key.timeMs,
        timeMs: Math.round(key.timeMs + (nextKey.timeMs - key.timeMs) * Math.min(0.95, Math.max(0.05, x))),
      };
      setDragHandles(adjusted);
      onCurveDraft?.(active.draft);
      setError('');
    } catch (caught) {
      cancelCurveDrag();
      setError(caught instanceof Error ? caught.message : '无法调整相机缓动曲线。');
    }
  }

  function endCurveDrag(event: PointerEvent<SVGSVGElement>): void {
    const active = curveDragRef.current;
    if (!active || active.pointer !== event.pointerId) return;
    const snapshot = currentSnapshot(active.revision, active.projectInstanceId);
    cancelCurveDrag();
    if (snapshot && active.draft && active.draft.project !== snapshot.project) {
      editorProjectStore.updateProject(active.draft.project, '调整相机缓动曲线');
    }
  }

  const presetInput: ApplyCameraMotionPresetInput = {
    preset: presetId,
    startTimeMs: time,
    durationMs: presetDurationMs,
    easing: presetEasing,
    ...(presetId === 'push-in' || presetId === 'pull-out' || presetId === 'pan-horizontal' || presetId === 'pan-vertical'
      ? { amplitude: presetAmplitude }
      : {}),
    ...(presetId === 'a-to-b' && presetStartLayerId ? { startTargetLayerId: presetStartLayerId } : {}),
    ...((presetId === 'push-in' || presetId === 'pull-out' || presetId === 'a-to-b') && presetTargetLayerId
      ? { targetLayerId: presetTargetLayerId }
      : {}),
    returnToStart: presetReturnToStart,
    overwriteExisting: presetOverwrite,
    ...(mode === 'hybrid'
      ? {
          hybridAction: presetHybridAction,
          selectedOverrideId: selectedOverride?.id ?? null,
        }
      : {}),
  };

  let presetPlan: ReturnType<typeof planCameraMotionPreset> | null = null;
  let presetPlanError = '';
  const liveSnapshot = editorProjectStore.getSnapshot();
  if (hasManualTrack && liveSnapshot && liveSnapshot.project.shots.some((entry) => entry.id === shot.id)) {
    try {
      presetPlan = planCameraMotionPreset(liveSnapshot.project, shot.id, presetInput);
    } catch (caught) {
      presetPlanError = caught instanceof Error ? caught.message : '无法规划运镜预设。';
    }
  }

  const hasPresetConflict = Boolean(presetPlan && presetPlan.conflictingKeyTimes.length > 0);
  const canApplyPreset = Boolean(presetPlan && (!hasPresetConflict || presetOverwrite));

  return <details className="shot-camera-control" data-canvas-interactive-chrome="true" onKeyDown={(event) => {
    if (event.key === 'Escape' && curveDragRef.current) {
      event.stopPropagation();
      cancelCurveDrag();
    }
  }}>
    <summary title="镜头相机" aria-label="镜头相机"><Camera aria-hidden="true" size={17} /></summary>
    <div className="shot-camera-panel">
      <label>相机<select aria-label="相机模式" value={mode ?? 'default'} onChange={(event) => {
        cancelCurveDrag();
        const nextMode = ShotCameraModeSchema.parse(event.currentTarget.value);
        edit((project) => setShotCameraMode(project, shot.id, nextMode), '切换镜头相机');
      }}>
        {!shot.camera && <option value="default" disabled>跟随项目设置</option>}
        <option value="static">固定</option>
        <option value="speaker-focus">自动运镜</option>
        <option value="manual">手工运镜</option>
        <option value="hybrid">自动+手工接管</option>
      </select></label>
      {(mode === 'speaker-focus' || mode === 'hybrid' || !mode) && (
        <ShotAutoFramingControls shot={shot} onEdit={edit} onError={setError} />
      )}
      {hasManualTrack && <>
        <div className="shot-camera-actions">
          <Button variant={cameraTool ? 'primary' : 'secondary'} aria-pressed={cameraTool} onClick={() => onToolChange(!cameraTool)}>编辑相机框</Button>
          <Button variant={throughCamera ? 'primary' : 'secondary'} aria-pressed={throughCamera} onClick={() => onViewChange(!throughCamera)}>相机视角</Button>
        </div>
        {mode === 'hybrid' && <>
          <div className="shot-camera-actions">
            <Button variant="secondary" disabled={!newOverrideBounds} onClick={() => {
              if (!newOverrideBounds) return;
              const id = crypto.randomUUID();
              if (edit((project) => addShotCameraOverride(project, shot.id, { id, ...newOverrideBounds }), '添加相机接管段')) {
                shotStore.selectCameraOverride(id);
              }
            }}>新增接管段</Button>
            <Button variant="secondary" disabled={!selectedOverride} onClick={() => {
              if (!selectedOverride) return;
              edit((project) => removeShotCameraOverride(project, shot.id, selectedOverride.id), '删除相机接管段');
              shotStore.selectCameraOverride(null);
            }}>删除接管段</Button>
          </div>
          {overrides.length > 0 && selectedOverride && <>
            <label>接管段<select aria-label="接管段" value={selectedOverride.id} onChange={(event) => {
              const nextId = event.currentTarget.value;
              shotStore.selectCameraOverride(nextId);
              const target = overrides.find((override) => override.id === nextId);
              if (target) timelineUiStore.seek(target.startMs, shot.durationMs);
            }}>
              {overrides.map((override, overrideIndex) => (
                <option key={override.id} value={override.id}>
                  {`${overrideIndex + 1}. ${formatTimecode(override.startMs)}–${formatTimecode(override.endMs)}`}
                </option>
              ))}
            </select></label>
            <div className="shot-camera-fields">
              {overrideTimeFields.map(([field, label]) => <label key={field}>{label}
                <input key={`${selectedOverride.id}-${field}-${selectedOverride[field]}`} type="number" step="1" min={0}
                  max={shot.durationMs} defaultValue={selectedOverride[field]}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                  onBlur={(event) => {
                    const value = event.currentTarget.valueAsNumber;
                    if (!Number.isFinite(value) || value < 0) {
                      event.currentTarget.value = String(selectedOverride[field]);
                      setError('请输入有效的非负毫秒值。');
                    } else if (value !== selectedOverride[field]) {
                      const ok = edit(
                        (project) => updateShotCameraOverride(project, shot.id, selectedOverride.id, { [field]: Math.round(value) }),
                        '编辑相机接管段',
                      );
                      if (!ok) event.currentTarget.value = String(selectedOverride[field]);
                    }
                  }} />
              </label>)}
            </div>
          </>}
        </>}
        <div className="shot-camera-actions">
          <Button variant="secondary" disabled={!!key} onClick={() => setKey(undefined)}>添加关键帧</Button>
          <Button variant="secondary" disabled={!key} onClick={() => {
            cancelCurveDrag();
            edit((project) => removeShotCameraKey(project, shot.id, time), '删除相机关键帧');
          }}>删除关键帧</Button>
        </div>
        <label>关键帧<select value={key?.timeMs ?? ''} onChange={(event) => {
          cancelCurveDrag();
          timelineUiStore.seek(Number(event.currentTarget.value), shot.durationMs);
        }}>
          <option value="" disabled>{formatTimecode(time)}</option>
          {keys.map((entry) => <option key={entry.timeMs} value={entry.timeMs}>{formatTimecode(entry.timeMs)}</option>)}
        </select></label>
        <div className="shot-camera-fields">
          {poseFields.map(([field, label]) => <label key={field}>{label}
            <input key={`${time}-${pose[field]}`} type="number" step="any" defaultValue={pose[field]}
              onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
              onBlur={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (!Number.isFinite(value) || (field === 'zoom' && value <= 0)) {
                  event.currentTarget.value = String(pose[field]);
                  setError(field === 'zoom' ? '倍率必须大于 0。' : '请输入有效数值。');
                } else if (value !== pose[field]) {
                  setKey({ [field]: value });
                }
              }} />
          </label>)}
        </div>
        {key && nextKey && inspectedCurve && <div className="shot-camera-curve">
          <label>缓动<select aria-label="相机缓动" value={curveSelectValue} onChange={(event) => {
            const value = event.currentTarget.value;
            setKey(value === 'custom'
              ? { curveToNext: { bezier: inspectedCurve.equivalentBezier ?? DEFAULT_ANIMATION_BEZIER } }
              : { interpolationToNext: value as AnimationInterpolation, curveToNext: undefined });
          }}>
            {inspectedCurve.hasWindow && <option value="window" disabled>切分曲线</option>}
            {Object.entries(easingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="custom">自定义</option>
          </select></label>
          <svg
            ref={curveSvgRef}
            viewBox="0 0 320 128"
            aria-label="相机区段缓动曲线"
            className="animation-curve-graph"
            data-camera-curve-window={inspectedCurve.hasWindow ? 'true' : undefined}
            data-camera-curve-handles={inspectedCurve.canDragHandles ? 'true' : undefined}
            onPointerMove={moveCurveDrag}
            onPointerCancel={cancelCurveDrag}
            onLostPointerCapture={cancelCurveDrag}
            onPointerUp={endCurveDrag}
          >
            <rect x={curveChart.left} y={curveChart.top} width={curveChart.width} height={curveChart.height} />
            <polyline points={curvePolyline} className="animation-curve-line" />
            {inspectedCurve.canDragHandles && <>
              <line x1={toCurveX(0)} y1={toCurveY(0)} x2={toCurveX(handlePoints.x1)} y2={toCurveY(handlePoints.y1)} />
              <line x1={toCurveX(1)} y1={toCurveY(1)} x2={toCurveX(handlePoints.x2)} y2={toCurveY(handlePoints.y2)} />
              <circle
                cx={toCurveX(handlePoints.x1)}
                cy={toCurveY(handlePoints.y1)}
                r={7}
                data-curve-handle="first"
                tabIndex={-1}
                onPointerDown={(event) => beginCurveDrag(event, 'first')}
              />
              <circle
                cx={toCurveX(handlePoints.x2)}
                cy={toCurveY(handlePoints.y2)}
                r={7}
                data-curve-handle="second"
                tabIndex={-1}
                onPointerDown={(event) => beginCurveDrag(event, 'second')}
              />
            </>}
          </svg>
          {inspectedCurve.hasWindow && !inspectedCurve.canDragHandles && (
            <div className="shot-camera-actions">
              <Button variant="secondary" onClick={() => setKey({ curveToNext: { bezier: DEFAULT_ANIMATION_BEZIER } })}>
                替换为自定义曲线
              </Button>
            </div>
          )}
          {key.curveToNext && inspectedCurve.equivalentBezier && <div className="shot-camera-fields">
            {(['x1', 'y1', 'x2', 'y2'] as const).map((field) => <label key={field}>{field.toUpperCase()}
              <input
                defaultValue={Number(handlePoints[field].toFixed(4))}
                key={`${time}-${field}-${handlePoints[field]}`}
                type="number"
                min={0}
                max={1}
                step="any"
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                onBlur={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  const next = { ...handlePoints, [field]: value };
                  if (!Number.isFinite(value) || value < 0 || value > 1 || next.x1 > next.x2) {
                    event.currentTarget.value = String(Number(handlePoints[field].toFixed(4)));
                    setError('缓动控制点须在 0–1 内，且 X1 不能大于 X2。');
                  } else if (Math.abs(value - handlePoints[field]) > 1e-6) {
                    setKey({ curveToNext: { bezier: next } });
                  }
                }}
              />
            </label>)}
          </div>}
        </div>}
        <details className="shot-camera-presets">
          <summary>运镜预设</summary>
          <div className="shot-camera-presets-body">
            <label>类型<select aria-label="运镜预设" value={presetId} onChange={(event) => {
              const nextPreset = event.currentTarget.value as CameraMotionPresetId;
              setPresetId(nextPreset);
              setPresetAmplitude(defaultAmplitudeForPreset(nextPreset));
              setPresetOverwrite(false);
            }}>
              {(Object.entries(CAMERA_MOTION_PRESET_LABELS) as [CameraMotionPresetId, string][]).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select></label>
            <div className="shot-camera-fields">
              <label>时长 ms<input
                aria-label="预设时长"
                type="number"
                min={1}
                max={shot.durationMs}
                step={50}
                value={presetDurationMs}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(next) && next > 0) setPresetDurationMs(Math.round(next));
                }}
              /></label>
              {(presetId === 'push-in' || presetId === 'pull-out') && <label>倍率<input
                aria-label="缩放幅度"
                type="number"
                min={1.05}
                step={0.05}
                value={presetAmplitude}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(next)) setPresetAmplitude(next);
                }}
              /></label>}
              {(presetId === 'pan-horizontal' || presetId === 'pan-vertical') && <label>位移 px<input
                aria-label="平移幅度"
                type="number"
                step={20}
                value={presetAmplitude}
                onChange={(event) => {
                  const next = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(next)) setPresetAmplitude(next);
                }}
              /></label>}
            </div>
            {presetId === 'a-to-b' && <label>起始目标<select aria-label="起始目标图层" value={presetStartLayerId}
              onChange={(event) => setPresetStartLayerId(event.currentTarget.value)}>
              <option value="">当前构图</option>
              {targetableLayers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
            </select></label>}
            {(presetId === 'push-in' || presetId === 'pull-out' || presetId === 'a-to-b') && (
              <label>构图目标<select aria-label="构图目标图层" value={presetTargetLayerId}
                onChange={(event) => setPresetTargetLayerId(event.currentTarget.value)}>
                <option value="">保持当前</option>
                {targetableLayers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select></label>
            )}
            <label>缓动<select aria-label="预设缓动" value={presetEasing}
              onChange={(event) => setPresetEasing(event.currentTarget.value as AnimationInterpolation)}>
              {Object.entries(easingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            {mode === 'hybrid' && <label>接管段<select aria-label="预设接管方式" value={presetHybridAction}
              onChange={(event) => setPresetHybridAction(event.currentTarget.value as CameraPresetHybridAction)}>
              <option value="use-selected-override">复用当前接管段</option>
              <option value="create-override">新建接管段</option>
            </select></label>}
            <label className="shot-camera-checkbox">
              <input
                type="checkbox"
                checked={presetReturnToStart}
                onChange={(event) => setPresetReturnToStart(event.currentTarget.checked)}
              />
              <span>结束后回原构图</span>
            </label>
            {hasPresetConflict && presetPlan && <div className="shot-camera-conflict">
              <span>时段内已有 {presetPlan.conflictingKeyTimes.length} 个关键帧</span>
              <label className="shot-camera-checkbox">
                <input
                  type="checkbox"
                  checked={presetOverwrite}
                  onChange={(event) => setPresetOverwrite(event.currentTarget.checked)}
                />
                <span>覆盖已有关键帧</span>
              </label>
              {presetPlan.suggestedFreeStartMs !== null && presetPlan.suggestedFreeStartMs !== time && (
                <Button variant="secondary" onClick={() => {
                  setPresetOverwrite(false);
                  timelineUiStore.seek(presetPlan.suggestedFreeStartMs!, shot.durationMs);
                }}>
                  移到空闲段 ({formatTimecode(presetPlan.suggestedFreeStartMs)})
                </Button>
              )}
            </div>}
            {presetPlanError && <div className="shot-camera-conflict">{presetPlanError}</div>}
            <Button variant="primary" disabled={!canApplyPreset} onClick={() => {
              const newOverrideId = mode === 'hybrid' && presetHybridAction === 'create-override'
                ? crypto.randomUUID()
                : undefined;
              const ok = edit(
                (project) => shotService.applyCameraMotionPreset(project, shot.id, {
                  ...presetInput,
                  ...(newOverrideId ? { overrideId: newOverrideId } : {}),
                }),
                `应用运镜预设：${CAMERA_MOTION_PRESET_LABELS[presetId]}`,
              );
              if (ok) {
                setPresetOverwrite(false);
                if (newOverrideId) shotStore.selectCameraOverride(newOverrideId);
              }
            }}>应用运镜</Button>
          </div>
        </details>
      </>}
      {error && <div role="alert">{error}</div>}
    </div>
  </details>;
}
