import { useState } from 'react';
import { Camera } from 'lucide-react';
import {
  evaluateManualCamera, removeShotCameraKey, resolveTimelineFrameTime, setShotCameraKey, setShotCameraMode,
  type AnimationInterpolation, type Project, type Shot,
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

export function ShotCameraControls({ shot, timeMs, throughCamera, onViewChange, cameraTool, onToolChange }: {
  shot: Shot;
  timeMs: number;
  throughCamera: boolean;
  onViewChange: (enabled: boolean) => void;
  cameraTool: boolean;
  onToolChange: (enabled: boolean) => void;
}): React.JSX.Element {
  const [error, setError] = useState('');
  const time = resolveTimelineFrameTime(timeMs, shot.durationMs);
  const keys = shot.camera?.keys ?? [];
  const index = keys.findIndex((key) => key.timeMs === time);
  const key = keys[index];
  const pose = key ?? evaluateManualCamera(shot, time);
  const bezier = key?.curveToNext?.bezier ?? { x1: 1 / 3, y1: 1 / 3, x2: 2 / 3, y2: 2 / 3 };

  function edit(change: (project: Project) => Project, label: string): void {
    const snapshot = editorProjectStore.getSnapshot();
    if (!snapshot || shot.id !== shotStore.getCurrentShotId() ||
        snapshot.project.shots.find((entry) => entry.id === shot.id) !== shot) return;
    try {
      editorProjectStore.updateProject(change(snapshot.project), label);
      setError('');
    } catch {
      setError('无法修改相机。请检查数值或稍后重试。');
    }
  }

  function setKey(changes: Parameters<typeof setShotCameraKey>[3]): void {
    edit((project) => setShotCameraKey(project, shot.id, time, changes), '编辑相机关键帧');
  }

  return <details className="shot-camera-control" data-canvas-interactive-chrome="true">
    <summary title="镜头相机" aria-label="镜头相机"><Camera aria-hidden="true" size={17} /></summary>
    <div className="shot-camera-panel">
      <label>相机<select aria-label="相机模式" value={shot.camera?.mode ?? 'default'} onChange={(event) => {
        const mode = ShotCameraModeSchema.parse(event.currentTarget.value);
        edit((project) => setShotCameraMode(project, shot.id, mode), '切换镜头相机');
      }}>
        {!shot.camera && <option value="default" disabled>跟随项目设置</option>}
        <option value="static">固定</option>
        <option value="speaker-focus">自动运镜</option>
        <option value="manual">手工运镜</option>
      </select></label>
      {shot.camera?.mode === 'manual' && <>
        <div className="shot-camera-actions">
          <Button variant="secondary" aria-pressed={cameraTool} onClick={() => onToolChange(!cameraTool)}>编辑相机框</Button>
          <Button variant="secondary" aria-pressed={throughCamera} onClick={() => onViewChange(!throughCamera)}>相机视角</Button>
        </div>
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
