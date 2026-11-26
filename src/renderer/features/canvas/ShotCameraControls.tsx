import { useState } from 'react';
import { Camera } from 'lucide-react';
import {
  addShotCameraOverride, evaluateManualCamera, removeShotCameraKey, removeShotCameraOverride,
  resolveTimelineFrameTime, setShotCameraKey, setShotCameraMode, updateShotCameraOverride,
  type AnimationInterpolation, type Project, type Shot, type ShotCameraOverride,
} from '../../../domain';
import { ShotCameraModeSchema } from '../../../domain/models/shotCamera';
import { editorProjectStore } from '../../stores/EditorProjectStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';
import { formatTimecode } from '../timeline/timeGeometry';
import { timelineUiStore } from '../timeline/timelineUiStore';

const easingLabels: Readonly<Record<AnimationInterpolation, string>> = {
  linear: '线性', 'ease-in': '缓入', 'ease-out': '缓出', 'ease-in-out': '缓入缓出', step: '保持',
};

const poseFields = [
  ['centerX', '中心 X'], ['centerY', '中心 Y'], ['zoom', '倍率'], ['rotationDeg', '旋转 °'],
] as const;

const overrideTimeFields = [
  ['startMs', '开始 ms'], ['endMs', '结束 ms'], ['blendInMs', '入场 ms'], ['blendOutMs', '出场 ms'],
] as const;

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

export function ShotCameraControls({ shot, timeMs, throughCamera, onViewChange, cameraTool, onToolChange }: {
  shot: Shot;
  timeMs: number;
  throughCamera: boolean;
  onViewChange: (enabled: boolean) => void;
  cameraTool: boolean;
  onToolChange: (enabled: boolean) => void;
}): React.JSX.Element {
  const [error, setError] = useState('');
  const [selectedOverrideId, setSelectedOverrideId] = useState<string | null>(null);
  const time = resolveTimelineFrameTime(timeMs, shot.durationMs);
  const mode = shot.camera?.mode;
  const hasManualTrack = mode === 'manual' || mode === 'hybrid';
  const keys = shot.camera?.keys ?? [];
  const overrides = shot.camera?.overrides ?? [];
  const index = keys.findIndex((key) => key.timeMs === time);
  const key = keys[index];
  const pose = key ?? evaluateManualCamera(shot, time);
  const bezier = key?.curveToNext?.bezier ?? { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 };
  const activeOverride = overrides.find((override) => time >= override.startMs && time < override.endMs);
  const selectedOverride =
    overrides.find((override) => override.id === selectedOverrideId) ??
    activeOverride ??
    overrides[0];
  const newOverrideBounds = mode === 'hybrid' ? resolveNewOverrideBounds(shot, time, overrides) : null;

  function edit(change: (project: Project) => Project, label: string): boolean {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot || shot.id !== shotStore.getCurrentShotId() ||
        snapshot.project.shots.find((entry) => entry.id === shot.id) !== shot) return false;
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
    edit((project) => setShotCameraKey(project, shot.id, time, changes), '编辑相机关键帧');
  }

  return <details className="shot-camera-control" data-canvas-interactive-chrome="true">
    <summary title="镜头相机" aria-label="镜头相机"><Camera aria-hidden="true" size={17} /></summary>
    <div className="shot-camera-panel">
      <label>相机<select aria-label="相机模式" value={mode ?? 'default'} onChange={(event) => {
        const nextMode = ShotCameraModeSchema.parse(event.currentTarget.value);
        edit((project) => setShotCameraMode(project, shot.id, nextMode), '切换镜头相机');
      }}>
        {!shot.camera && <option value="default" disabled>跟随项目设置</option>}
        <option value="static">固定</option>
        <option value="speaker-focus">自动运镜</option>
        <option value="manual">手工运镜</option>
        <option value="hybrid">自动+手工接管</option>
      </select></label>
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
                setSelectedOverrideId(id);
              }
            }}>新增接管段</Button>
            <Button variant="secondary" disabled={!selectedOverride} onClick={() => {
              if (!selectedOverride) return;
              edit((project) => removeShotCameraOverride(project, shot.id, selectedOverride.id), '删除相机接管段');
              setSelectedOverrideId(null);
            }}>删除接管段</Button>
          </div>
          {overrides.length > 0 && selectedOverride && <>
            <label>接管段<select aria-label="接管段" value={selectedOverride.id} onChange={(event) => {
              const nextId = event.currentTarget.value;
              setSelectedOverrideId(nextId);
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
            edit((project) => removeShotCameraKey(project, shot.id, time), '删除相机关键帧');
          }}>删除关键帧</Button>
        </div>
        <label>关键帧<select value={key?.timeMs ?? ''} onChange={(event) => {
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
        {key && index < keys.length - 1 && <>
          <label>缓动<select value={key.curveToNext ? 'custom' : key.interpolationToNext} onChange={(event) => {
            const value = event.currentTarget.value;
            setKey(value === 'custom' ? { curveToNext: { bezier } }
              : { interpolationToNext: value as AnimationInterpolation, curveToNext: undefined });
          }}>
            {Object.entries(easingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            <option value="custom">自定义</option>
          </select></label>
          {key.curveToNext?.bezier && <div className="shot-camera-fields">
            {(['x1', 'y1', 'x2', 'y2'] as const).map((field) => <label key={field}>{field.toUpperCase()}
              <input defaultValue={bezier[field]} key={`${time}-${bezier[field]}`} type="number" min={0} max={1} step="any"
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                onBlur={(event) => {
                  const value = event.currentTarget.valueAsNumber;
                  const next = { ...bezier, [field]: value };
                  if (!Number.isFinite(value) || value < 0 || value > 1 || next.x1 > next.x2) {
                    event.currentTarget.value = String(bezier[field]);
                    setError('缓动控制点须在 0–1 内，且 X1 不能大于 X2。');
                  } else if (value !== bezier[field]) {
                    setKey({ curveToNext: { bezier: next } });
                  }
                }} />
            </label>)}
          </div>}
        </>}
      </>}
      {error && <div role="alert">{error}</div>}
    </div>
  </details>;
}
