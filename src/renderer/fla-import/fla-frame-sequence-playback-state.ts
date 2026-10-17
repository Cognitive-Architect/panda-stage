export const FLA_SEQUENCE_PREVIEW_INTERVAL_MS = 1000 / 12;

export interface FlaSequencePlaybackState {
  frameCount: number;
  selectedIndex: number;
  isPlaying: boolean;
  activeSessionKey: string | null;
  generation: number;
}

export type FlaSequencePlaybackAction =
  | { type: 'load'; frameCount: number; selectedIndex?: number }
  | { type: 'play'; sessionKey: string }
  | { type: 'pause' }
  | { type: 'tick'; sessionKey: string; generation: number }
  | { type: 'step'; direction: -1 | 1 }
  | { type: 'select'; selectedIndex: number }
  | { type: 'invalidate' };

export const initialFlaSequencePlaybackState: FlaSequencePlaybackState = {
  frameCount: 0,
  selectedIndex: 0,
  isPlaying: false,
  activeSessionKey: null,
  generation: 0,
};

function stopPlayback(state: FlaSequencePlaybackState): FlaSequencePlaybackState {
  if (!state.isPlaying && state.activeSessionKey === null) return state;
  return {
    ...state,
    isPlaying: false,
    activeSessionKey: null,
    generation: state.generation + 1,
  };
}

function clampIndex(index: number, frameCount: number): number {
  if (frameCount <= 0) return 0;
  return Math.min(frameCount - 1, Math.max(0, Math.trunc(index)));
}

export function flaSequencePlaybackReducer(
  state: FlaSequencePlaybackState,
  action: FlaSequencePlaybackAction,
): FlaSequencePlaybackState {
  switch (action.type) {
    case 'load': {
      const frameCount = Math.max(0, Math.trunc(action.frameCount));
      return {
        frameCount,
        selectedIndex: clampIndex(action.selectedIndex ?? 0, frameCount),
        isPlaying: false,
        activeSessionKey: null,
        generation: state.generation + 1,
      };
    }
    case 'play':
      if (!action.sessionKey || state.frameCount < 2) return state;
      if (state.isPlaying && state.activeSessionKey === action.sessionKey) return state;
      return {
        ...state,
        isPlaying: true,
        activeSessionKey: action.sessionKey,
        generation: state.generation + 1,
      };
    case 'pause':
      return stopPlayback(state);
    case 'tick':
      if (!state.isPlaying || state.activeSessionKey !== action.sessionKey ||
        state.generation !== action.generation || state.frameCount < 2) return state;
      return {
        ...state,
        selectedIndex: (clampIndex(state.selectedIndex, state.frameCount) + 1) % state.frameCount,
      };
    case 'step': {
      if (state.frameCount <= 0) return state;
      const selectedIndex = clampIndex(state.selectedIndex + action.direction, state.frameCount);
      const stopped = stopPlayback(state);
      return selectedIndex === stopped.selectedIndex ? stopped : { ...stopped, selectedIndex };
    }
    case 'select': {
      if (state.frameCount <= 0) return state;
      const selectedIndex = clampIndex(action.selectedIndex, state.frameCount);
      const stopped = stopPlayback(state);
      return selectedIndex === stopped.selectedIndex ? stopped : { ...stopped, selectedIndex };
    }
    case 'invalidate':
      return stopPlayback(state);
  }
}
