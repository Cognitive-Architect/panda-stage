export const IPC_CHANNELS = Object.freeze({
  APP_PING: 'app:ping',
  HIDDEN_READY: 'hidden:ready',
} as const);

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
