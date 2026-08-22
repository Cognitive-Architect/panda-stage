export const IPC_CHANNELS = Object.freeze({
  APP_PING: 'app:ping',
  HIDDEN_READY: 'hidden:ready',
  EXPORT_LOAD_PROBE: 'export:load-probe',
  EXPORT_PROBE_LOADED: 'export:probe-loaded',
  EXPORT_RENDER_FRAME: 'export:render-frame',
  EXPORT_FRAME_READY: 'export:frame-ready',
  EXPORT_FRAME_FAILED: 'export:frame-failed',
  EXPORT_CANCEL_RENDER: 'export:cancel-render',
  EXPORT_START_PROBE: 'export:start-probe',
  EXPORT_CANCEL_JOB: 'export:cancel-job',
  EXPORT_JOB_UPDATE: 'export:job-update',
  PROJECT_CREATE: 'project:create',
  PROJECT_CREATE_AT: 'project:create-at',
  PROJECT_CHOOSE_DIRECTORY: 'project:choose-directory',
  PROJECT_OPEN_FOLDER: 'project:open-folder',
  PROJECT_CONFIRM_SWITCH: 'project:confirm-switch',
  PROJECT_OPEN: 'project:open',
  PROJECT_SAVE: 'project:save',
  ASSET_IMPORT_CHOOSE: 'asset-import:choose',
  ASSET_IMPORT_DROPPED: 'asset-import:dropped',
  ASSET_METADATA_REFRESH: 'asset-metadata:refresh',
  ASSET_METADATA_CANCEL: 'asset-metadata:cancel',
  ASSET_DELETE: 'asset:delete',
  ASSET_THUMBNAIL_READ: 'asset-thumbnail:read',
  ASSET_CANVAS_IMAGE_READ: 'asset-canvas-image:read',
  RECENT_PROJECTS_LIST: 'recent-projects:list',
  RECENT_PROJECTS_OPEN: 'recent-projects:open',
  RECENT_PROJECTS_REMOVE: 'recent-projects:remove',
  RECENT_PROJECTS_RELOCATE: 'recent-projects:relocate',
  AUTOSAVE_TRACK: 'autosave:track',
  AUTOSAVE_UPDATE: 'autosave:update',
  AUTOSAVE_STOP: 'autosave:stop',
  AUTOSAVE_ERROR: 'autosave:error',
  NATIVE_CLOSE_SYNC_REQUEST: 'native-close:sync-request',
  NATIVE_CLOSE_SYNC_RESPONSE: 'native-close:sync-response',
  RECOVERY_DETECT: 'recovery:detect',
  RECOVERY_RESTORE: 'recovery:restore',
  RECOVERY_IGNORE: 'recovery:ignore',
  FLA_INSPECT_CHOOSE: 'fla:inspect-choose',
  FLA_CANCEL: 'fla:cancel',
  FLA_COMMIT_SELECTED: 'fla:commit-selected',
  FLA_WORKER_READY: 'fla:worker-ready',
  FLA_WORKER_START: 'fla:worker-start',
  FLA_WORKER_CANCEL: 'fla:worker-cancel',
  FLA_WORKER_PROGRESS: 'fla:worker-progress',
  FLA_WORKER_RESULT: 'fla:worker-result',
  FLA_WORKER_ERROR: 'fla:worker-error',
  // V2-R1 Static Snapshot (Issue #287).  Preview/commit/cancel reuse the
  // same trusted-sender boundary as the V1/V1.5 FLA IPC.  The renderer only
  // ever sends serialized R1 contract objects; the sandboxed rasterizer
  // never sees the FLA source bytes, only the Main-built SVG.
  FLA_SNAPSHOT_CATALOG: 'fla:snapshot-catalog',
  FLA_SNAPSHOT_PREVIEW: 'fla:snapshot-preview',
  FLA_SNAPSHOT_COMMIT: 'fla:snapshot-commit',
  FLA_SNAPSHOT_CANCEL: 'fla:snapshot-cancel',
  FLA_SNAPSHOT_RENDERER_READY: 'fla:snapshot-renderer-ready',
  FLA_SNAPSHOT_RENDER: 'fla:snapshot-render',
  FLA_SNAPSHOT_RENDER_CANCEL: 'fla:snapshot-render-cancel',
  FLA_SNAPSHOT_RENDER_RESULT: 'fla:snapshot-render-result',
  FLA_SNAPSHOT_RENDER_ERROR: 'fla:snapshot-render-error',
  // V2-R2 Frame Sequence (Issue #294).  Bounded contiguous frame range
  // preview, per-session cancel, and N-frame ImageAsset commit.  The
  // renderer only sends serialized R2 contract objects (the FLA source
  // bytes never cross this boundary).  Reuses the V2-R1 sandboxed
  // rasterizer for every per-frame raster, so the rasterizer security
  // boundary is unchanged from R1.
  FLA_FRAME_SEQUENCE_RENDER: 'fla:frame-sequence-render',
  FLA_FRAME_SEQUENCE_CANCEL: 'fla:frame-sequence-cancel',
  FLA_FRAME_SEQUENCE_COMMIT: 'fla:frame-sequence-commit',
} as const);

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
