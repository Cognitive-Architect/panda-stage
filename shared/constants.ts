export const CANVAS_WIDTH = 1920;
export const CANVAS_HEIGHT = 1080;
export const FPS = 24;
export const MS_PER_FRAME = 1000 / FPS; // 41.666...
export const AUTO_SAVE_INTERVAL_MS = 30000;
export const MAX_EXPORT_PENDING_FRAMES = 5;
export const EXPORT_FRAME_RETRY_MAX = 2;

export const MOUTH_OPEN_FREQUENCY_HZ = 8; // M0.5: fixed frequency
export const MOUTH_OPEN_PERIOD_MS = 1000 / MOUTH_OPEN_FREQUENCY_HZ; // 125ms

export const SUBTITLE_SAFE_BOTTOM = 120; // pixels from bottom
export const SUBTITLE_MAX_LINES = 2;

export const ACTION_PRESETS = [
  { id: 'enter-left', name: '从左进入', type: 'preset' },
  { id: 'enter-right', name: '从右进入', type: 'preset' },
  { id: 'move', name: '移动', type: 'preset' },
  { id: 'zoom-in', name: '放大强调', type: 'preset' },
  { id: 'shake', name: '抖动', type: 'preset' },
  { id: 'expression', name: '表情切换', type: 'preset' },
  { id: 'fade-in', name: '淡入', type: 'preset' },
  { id: 'fade-out', name: '淡出', type: 'preset' },
] as const;
