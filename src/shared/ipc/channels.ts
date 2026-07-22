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
} as const);

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
