import { describe, expect, it } from 'vitest';
import {
  commitStageVisualFrame,
  selectStageVisualFrame,
  type StageVisualFrame,
} from '../../src/renderer/stage/stageVisualFrame';

interface TestModel {
  timeMs: number;
  x: number;
}

function frame(
  timeMs: number,
  x: number,
  caption: string,
): StageVisualFrame<TestModel> {
  return {
    model: { timeMs, x },
    caption,
  };
}

describe('Stage visual-frame ownership', () => {
  it('retains the immediately preceding complete frame during a source replacement', () => {
    const frame0 = frame(0, 0, 'A');
    const frame1 = frame(100, 100, 'B');
    const frame2 = frame(200, 120, 'B');

    let committed = commitStageVisualFrame<TestModel>(null, frame0, true);
    committed = commitStageVisualFrame(committed, frame1, true);

    const fallback = selectStageVisualFrame(committed, frame2, false);
    expect(fallback).toEqual(frame1);
    expect(fallback).not.toEqual(frame0);
    expect(fallback?.model).toMatchObject({ x: 100, timeMs: 100 });
    expect(fallback?.caption).toBe('B');

    expect(commitStageVisualFrame(committed, frame2, true)).toEqual(frame2);
  });
});
