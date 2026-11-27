import { useState } from 'react';
import {
  availableAnimationPropertyFrames, editAnimationPropertyRange, placeAnimationPropertyKeys, resolveTimelineFrameTime,
  type AnimationKey, type AnimationPropertyRangeEdit, type AnimationTrack,
} from '../../../domain';
import { editorProjectStore, type EditorProjectSnapshot } from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';
import { shotStore } from '../../stores/shotStore';
import { Button } from '../../ui';

export function AnimationKeyRangeControls({
  track, snapshot, shotId, durationMs, startMs, endMs, currentTimeMs, disabled,
}: {
  track: AnimationTrack;
  snapshot: EditorProjectSnapshot;
  shotId: string;
  durationMs: number;
  startMs: number;
  endMs: number;
  currentTimeMs: number;
  disabled: boolean;
}): React.JSX.Element {
  const [count, setCount] = useState(1);
  const [copy, setCopy] = useState<{ property: AnimationTrack['property']; keys: readonly AnimationKey[] }>();
  const [overwriteAt, setOverwriteAt] = useState<{ timeMs: number; track: AnimationTrack; revision: number }>();
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<{ revision: number; track: AnimationTrack; startMs: number; endMs: number }>();
  const selected = track.keys.filter(({ timeMs }) => timeMs >= startMs && timeMs <= endMs);
  const interior = selected.filter(({ timeMs }) => timeMs > startMs && timeMs < endMs);
  const capacity = availableAnimationPropertyFrames(track.keys, startMs, endMs).length;
  const confirmDelete = deleting?.revision === snapshot.revision && deleting.track === track &&
    deleting.startMs === startMs && deleting.endMs === endMs;
  const destination = resolveTimelineFrameTime(currentTimeMs, durationMs);
  const pasted = copy?.property === track.property ? placeAnimationPropertyKeys(copy.keys, destination) : [];
  const pasteEnd = pasted.at(-1)?.timeMs ?? destination;
  const collisionCount = pasted.length ? track.keys.filter(({ timeMs }) => timeMs >= destination && timeMs <= pasteEnd).length : 0;
  const overwrite = overwriteAt?.timeMs === destination && overwriteAt.track === track && overwriteAt.revision === snapshot.revision;
  const validPasteRange = destination > 0 && pasteEnd <= durationMs;
  const instance = editorProjectStore.getProjectInstanceId();

  function apply(edit: AnimationPropertyRangeEdit, label: string): void {
    try {
      if (disabled || editorProjectStore.getSnapshot() !== snapshot || editorProjectStore.getProjectInstanceId() !== instance ||
        shotStore.getCurrentShotId() !== shotId || selectionStore.getSelectedLayerId() !== track.target.layerId) {
        throw new Error('属性轨已变更，请重新选择。');
      }
      const project = editAnimationPropertyRange(snapshot.project, { shotId, target: track.target, property: track.property }, edit);
      if (project !== snapshot.project) editorProjectStore.updateProject(project, label);
      setDeleting(undefined);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法编辑属性选段。');
    }
  }

  return <fieldset data-testid="animation-key-range-controls">
    <legend>选段关键帧</legend>
    <label>补帧数（最多 {capacity}）<input type="number" min={1} max={capacity} step={1} value={count}
      onChange={(event) => setCount(Number(event.target.value))} /></label>
    <Button disabled={disabled || !Number.isSafeInteger(count) || count < 1 || count > capacity}
      onClick={() => apply({ kind: 'insert', startMs, endMs, count }, '补齐选段关键帧')}>补帧</Button>
    <Button disabled={disabled || !interior.length} onClick={() => {
      if (!confirmDelete) {
        setDeleting({ revision: snapshot.revision, track, startMs, endMs });
        return;
      }
      apply({ kind: 'delete', startMs, endMs }, '删除区段内关键帧');
    }}>{confirmDelete ? '确认删除' : '删除区段内关键帧'}（{interior.length}）</Button>
    {confirmDelete ? <Button variant="secondary" onClick={() => setDeleting(undefined)}>取消删除</Button> : null}
    <Button disabled={disabled || selected.length < 2} onClick={() => {
      setCopy({ property: track.property, keys: selected });
      setOverwriteAt(undefined);
      setError('');
    }}>复制选段（{selected.length} 帧）</Button>
    {copy?.property === track.property ? <>
      {validPasteRange && collisionCount > 0 ? (
        <label><input type="checkbox" checked={overwrite} onChange={(event) => setOverwriteAt(event.target.checked
          ? { timeMs: destination, track, revision: snapshot.revision } : undefined)} />覆盖目标区段 {collisionCount} 枚关键帧</label>
      ) : null}
      <Button disabled={disabled || !validPasteRange || (collisionCount > 0 && !overwrite)}
        onClick={() => apply({ kind: 'paste', timeMs: destination, keys: copy.keys, overwrite }, '粘贴属性关键帧')}>
        粘贴 {copy.keys.length} 帧到播放头
      </Button>
    </> : null}
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}
