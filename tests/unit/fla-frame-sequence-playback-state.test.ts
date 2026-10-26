import { describe, expect, it } from 'vitest';
import {
  flaSequencePlaybackReducer,
  initialFlaSequencePlaybackState,
} from '../../src/renderer/fla-import/fla-frame-sequence-playback-state';

function withFrames(frameCount: number) {
  return flaSequencePlaybackReducer(initialFlaSequencePlaybackState, { type: 'load', frameCount });
}

describe('sequence preview playback', () => {
  it('starts on the selected frame and follows the sampled source-time frame', () => {
    let state = withFrames(4);
    state = flaSequencePlaybackReducer(state, { type: 'select', selectedIndex: 2 });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });

    expect(state).toMatchObject({ selectedIndex: 2, isPlaying: true });
    state = flaSequencePlaybackReducer(state, {
      type: 'sample',
      sessionKey: 'sequence-a',
      generation: state.generation,
      selectedIndex: 3,
    });
    expect(state.selectedIndex).toBe(3);
  });

  it('pauses on the current frame and resumes from it', () => {
    let state = flaSequencePlaybackReducer(withFrames(5), { type: 'play', sessionKey: 'sequence-a' });
    state = flaSequencePlaybackReducer(state, {
      type: 'sample', sessionKey: 'sequence-a', generation: state.generation, selectedIndex: 1,
    });
    const pausedIndex = state.selectedIndex;
    state = flaSequencePlaybackReducer(state, { type: 'pause' });
    expect(state).toMatchObject({ selectedIndex: pausedIndex, isPlaying: false });

    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });
    expect(state.selectedIndex).toBe(pausedIndex);
    state = flaSequencePlaybackReducer(state, {
      type: 'sample', sessionKey: 'sequence-a', generation: state.generation, selectedIndex: 2,
    });
    expect(state.selectedIndex).toBe(2);
  });

  it('loops at the end on a source-time sample', () => {
    let state = flaSequencePlaybackReducer(withFrames(3), { type: 'select', selectedIndex: 2 });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'sequence-a' });
    state = flaSequencePlaybackReducer(state, {
      type: 'sample', sessionKey: 'sequence-a', generation: state.generation, selectedIndex: 0,
    });
    expect(state.selectedIndex).toBe(0);
  });

  it('samples the source-timed frame and ignores stale playback generations', () => {
    let state = flaSequencePlaybackReducer(withFrames(21), { type: 'play', sessionKey: 'sequence-a' });
    const generation = state.generation;
    state = flaSequencePlaybackReducer(state, {
      type: 'sample',
      sessionKey: 'sequence-a',
      generation,
      selectedIndex: 20,
    });
    expect(state.selectedIndex).toBe(20);

    const stale = flaSequencePlaybackReducer(state, {
      type: 'sample',
      sessionKey: 'sequence-a',
      generation: generation - 1,
      selectedIndex: 4,
    });
    expect(stale).toBe(state);
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

  it('ignores stale samples after pause and an A→B→A candidate focus cycle', () => {
    let state = withFrames(4);
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'candidate-a' });
    const firstGeneration = state.generation;
    state = flaSequencePlaybackReducer(state, { type: 'invalidate' });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'candidate-b' });
    state = flaSequencePlaybackReducer(state, { type: 'invalidate' });
    state = flaSequencePlaybackReducer(state, { type: 'play', sessionKey: 'candidate-a' });
    const currentGeneration = state.generation;

    const afterOldSample = flaSequencePlaybackReducer(state, {
      type: 'sample', sessionKey: 'candidate-a', generation: firstGeneration, selectedIndex: 3,
    });
    expect(afterOldSample).toBe(state);

    const afterCurrentSample = flaSequencePlaybackReducer(state, {
      type: 'sample', sessionKey: 'candidate-a', generation: currentGeneration, selectedIndex: 1,
    });
    expect(afterCurrentSample.selectedIndex).toBe(1);
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
