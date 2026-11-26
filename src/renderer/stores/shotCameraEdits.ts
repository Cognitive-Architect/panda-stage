import { setShotCameraKey } from '../../domain';
import type { ManualCameraPose } from '../../domain/models/shotCamera';
import { editorProjectStore, type EditorProjectSnapshot } from './EditorProjectStore';
import { shotStore } from './shotStore';

export function commitCameraFrame(snapshot: EditorProjectSnapshot, shotId: string, timeMs: number, pose: ManualCameraPose): void {
  if (editorProjectStore.getSnapshot() !== snapshot || shotStore.getCurrentShotId() !== shotId) return;
  editorProjectStore.updateProject(setShotCameraKey(snapshot.project, shotId, timeMs, pose), '编辑相机框');
}
