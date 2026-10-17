import { describe, expect, it } from 'vitest';
import {
  flaSequencePlaybackReducer,
  FLA_SEQUENCE_PREVIEW_INTERVAL_MS,
  initialFlaSequencePlaybackState,
} from '../../src/renderer/fla-import/fla-frame-sequence-playback-state';

function withFrames(frameCount: number) {
  return flaSequencePlaybackReducer(initialFlaSequencePlaybackState, { type: 'load', frameCount });
}

describe('Issue #782 sequence preview playback', () => {
  it('uses an approximately 12 FPS preview cadence', () => {
    expect(FLA_SEQUENCE_PREVIEW_INTERVAL_MS).toBeCloseTo(1000 / 12);
  });

  it('starts on the selected frame and advances only on the next playback tick', () => {
    let state = withFrames(4);
    state = flaSequencePlaybackReducer(state, { type: 'select', selectedIndex: 2 });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });

    expect(state).toMatchObject({ selectedIndex: 2, isPlaying: true });
    state = flaSequencePlaybackReducer(state, {
      type: 'tick',
      sessionKey: 'sequence-a',
      generation: state.generation,
    });
    expect(state.selectedIndex).toBe(3);
  });

  it('pauses on the current frame and resumes from it', () => {
    let state = flaSequencePlaybackReducer(withFrames(5), { type: 'play', sessionKey: 'sequence-a' });
    state = flaSequencePlaybackReducer(state, {
      type: 'tick', sessionKey: 'sequence-a', generation: state.generation,
    });
    const pausedIndex = state.selectedIndex;
    state = flaSequencePlaybackReducer(state, { type: 'pause' });
    expect(state).toMatchObject({ selectedIndex: pausedIndex, isPlaying: false });

    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });
    expect(state.selectedIndex).toBe(pausedIndex);
    state = flaSequencePlaybackReducer(state, {
      type: 'tick', sessionKey: 'sequence-a', generation: state.generation,
    });
    expect(state.selectedIndex).toBe(pausedIndex + 1);
  });

  it('loops at the end on an automatic tick', () => {
    let state = flaSequencePlaybackReducer(withFrames(3), { type: 'select', selectedIndex: 2 });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });
    state = flaSequencePlaybackReducer(state, {
      type: 'tick', sessionKey: 'sequence-a', generation: state.generation,
    });
    expect(state.selectedIndex).toBe(0);
  });

  it('clamps manual steps at each edge and pauses before changing frame', () => {
    let state = flaSequencePlaybackReducer(withFrames(3), { type: 'step', direction: -1 });
    expect(state.selectedIndex).toBe(0);

    state = flaSequencePlaybackReducer(state, { type: 'select', selectedIndex: 2 });
    state = flaSequencePlaybackReducer(state, { type: 'step', direction: 1 });
    expect(state).toMatchObject({ selectedIndex: 2, isPlaying: false, activeSessionKey: null });

    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });
    state = flaSequencePlaybackReducer(state, { type: 'step', direction: -1 });
    expect(state).toMatchObject({ selectedIndex: 1, isPlaying: false, activeSessionKey: null });
  });

  it('keeps a single generated frame previewable but never starts playback', () => {
    const state = withFrames(1);
    expect(flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'single-frame' })).toBe(state);
    expect(flaSequencePlaybackReducer(state, { type: 'step', direction: 1 }).selectedIndex).toBe(0);
  });

  it('ignores stale ticks after pause and an A→B→A candidate focus cycle', () => {
    let state = withFrames(4);
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'candidate-a' });
    const firstGeneration = state.generation;
    state = flaSequencePlaybackReducer(state, { type: 'invalidate' });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'candidate-b' });
    state = flaSequencePlaybackReducer(state, { type: 'invalidate' });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'candidate-a' });
    const currentGeneration = state.generation;

    const afterOldTick = flaSequencePlaybackReducer(state, {
      type: 'tick', sessionKey: 'candidate-a', generation: firstGeneration,
    });
    expect(afterOldTick).toBe(state);

    const afterCurrentTick = flaSequencePlaybackReducer(state, {
      type: 'tick', sessionKey: 'candidate-a', generation: currentGeneration,
    });
    expect(afterCurrentTick.selectedIndex).toBe(1);
  });

  it('makes repeated play idempotent and repeated pause safe', () => {
    let state = flaSequencePlaybackReducer(withFrames(3), { type: 'play', sessionKey: 'sequence-a' });
    const firstGeneration = state.generation;
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });
    expect(state.generation).toBe(firstGeneration);

    state = flaSequencePlaybackReducer(state, { type: 'pause' });
    const paused = state;
    expect(flaSequencePlaybackReducer(state, { type: 'pause' })).toBe(paused);
  });
});
