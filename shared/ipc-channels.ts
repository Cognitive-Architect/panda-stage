export const IpcChannels = {
  // Project
  PROJECT_CREATE: 'project:create',
  PROJECT_OPEN: 'project:open',
  PROJECT_SAVE: 'project:save',
  PROJECT_MIGRATE: 'project:migrate',

  // Asset
  ASSET_IMPORT: 'asset:import',
  ASSET_DELETE: 'asset:delete',

  // Export
  EXPORT_START: 'export:start',
  EXPORT_CANCEL: 'export:cancel',
  EXPORT_PROGRESS: 'export:progress',
  EXPORT_COMPLETE: 'export:complete',
  EXPORT_ERROR: 'export:error',

  // FFmpeg
  FFMPEG_GET_VERSION: 'ffmpeg:getVersion',
  FFMPEG_VALIDATE_PATH: 'ffmpeg:validatePath',
  FFMPEG_SET_PATH: 'ffmpeg:setPath',

  // Internal: main process <-> hidden export window
  RENDER_FRAME: 'render:frame',
  RENDER_FRAME_DONE: 'render:frame-done',
  RENDER_READY: 'render:ready',
  RENDER_CANCEL: 'render:cancel',
  RENDER_ERROR: 'render:error',
} as const;

export type IpcChannel = typeof IpcChannels[keyof typeof IpcChannels];
