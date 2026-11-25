import type {
  FlaVideoImportRequest,
  FlaVideoImportResponse,
} from '../../../shared/fla-video-api';
import {
  editorProjectStore,
  type EditorProjectSnapshot,
  type EditorProjectStore,
} from '../../stores/EditorProjectStore';
import { selectionStore } from '../../stores/selectionStore';

export interface ImportFlaEmbeddedVideoOptions {
  readonly sessionId: string;
  readonly videoName: string;
  readonly shotId: string;
  readonly playbackMode?: 'play-once' | 'loop' | 'single-frame';
  readonly startTimeMs?: number;
  readonly includeAudio?: boolean;
  readonly store?: EditorProjectStore;
  readonly syncAutosave?: (
    snapshot: EditorProjectSnapshot,
  ) => Promise<{ ok: boolean; error?: { message: string } } | null | undefined>;
  readonly importVideo?: (
    request: FlaVideoImportRequest,
  ) => Promise<FlaVideoImportResponse>;
  readonly selectLayer?: (layerId: string) => void;
}

/**
 * Coordinates FLA embedded-video import with the active in-memory editor
 * snapshot, operation lease, autosave sync, HistoryStore command, and layer
 * selection so unsaved edits are preserved and Undo/Redo remains consistent.
 */
export async function importFlaEmbeddedVideoToEditor(
  options: ImportFlaEmbeddedVideoOptions,
): Promise<FlaVideoImportResponse> {
  const store = options.store ?? editorProjectStore;
  const snapshot = store.getSnapshot();
  const openInstanceId = store.getProjectInstanceId();
  if (!snapshot || openInstanceId === null) {
    return {
      ok: false,
      error: {
        code: 'VIDEO_IMPORT_FAILED',
        message: '请先打开项目后再导入嵌入视频。',
        projectRoot: '(no open project)',
      },
    };
  }

  const lease = store.acquireProjectOperationLease({
    projectRoot: snapshot.projectRoot,
    projectId: snapshot.project.id,
    revision: snapshot.revision,
    openInstanceId,
  });

  try {
    const syncAutosave =
      options.syncAutosave ??
      (typeof window !== 'undefined' && typeof window.pandaStage?.autosave?.update === 'function'
        ? (current: EditorProjectSnapshot) =>
            window.pandaStage.autosave.update({
              projectRoot: current.projectRoot,
              project: current.project,
              revision: current.revision,
              dirty: current.dirty,
            })
        : undefined);
    if (syncAutosave) {
      const sync = await syncAutosave(snapshot);
      if (sync && !sync.ok) {
        return {
          ok: false,
          error: {
            code: 'VIDEO_IMPORT_FAILED',
            message: sync.error?.message || '同步当前项目状态失败，未执行视频导入。',
            projectRoot: snapshot.projectRoot,
          },
        };
      }
    }

    if (store.getSnapshot() !== snapshot) {
      return {
        ok: false,
        error: {
          code: 'STALE_PROJECT_REVISION',
          message: '项目状态已更新，请重试导入。',
          projectRoot: snapshot.projectRoot,
        },
      };
    }

    const invokeImport =
      options.importVideo ?? ((request: FlaVideoImportRequest) => window.pandaStage.fla.importVideo(request));
    const response = await invokeImport({
      sessionId: options.sessionId,
      videoName: options.videoName,
      projectRoot: snapshot.projectRoot,
      project: snapshot.project,
      baseRevision: snapshot.revision,
      shotId: options.shotId,
      ...(options.playbackMode ? { playbackMode: options.playbackMode } : {}),
      ...(options.startTimeMs !== undefined ? { startTimeMs: options.startTimeMs } : {}),
      ...(options.includeAudio !== undefined ? { includeAudio: options.includeAudio } : {}),
    });

    if (!response.ok) {
      return response;
    }

    store.acceptSavedProjectCommand(
      lease,
      response.project,
      response.savedRevision,
      '导入 FLA 嵌入视频',
    );
    const selectLayer = options.selectLayer ?? ((layerId: string) => selectionStore.select(layerId));
    selectLayer(response.layer.id);
    return response;
  } finally {
    store.releaseProjectOperationLease(lease);
  }
}
