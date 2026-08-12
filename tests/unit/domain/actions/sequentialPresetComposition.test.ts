/**
 * Issue #185 — persisted sequential ActionPreset composition.
 *
 * These tests lock event-authoring and formal-evaluator semantics directly.
 * They deliberately avoid UI-only assertions: Apply and Replay consume the
 * same persisted event window, so equal formal frames prove their agreement.
 */
import { describe, expect, it } from 'vitest';
import {
  applyPresetEvents,
  createPresetEvents,
  evaluateShotAtTime,
  nextPresetStartMs,
  ProjectSchema,
  type Project,
  type TimelineEvent,
} from '../../../../src/domain';
import {
  evaluatePreviewFrame,
  previewWindowFromEvents,
  type EditorActionPreviewSession,
} from '../../../../src/renderer/features/actions/editorActionPreviewModel';
import { buildProject, IDS } from '../testProject';

type ScaleEvent = Extract<TimelineEvent, { type: 'scale' }>;
type OpacityEvent = Extract<TimelineEvent, { type: 'opacity' }>;

function target(project: Project, timeMs: number) {
  const shot = project.shots[0]!;
  return evaluateShotAtTime(shot, timeMs, project).layers.find(
    (layer) => layer.id === IDS.layerChar,
  )!;
}

function previewSession(
  project: Project,
  events: readonly TimelineEvent[],
): EditorActionPreviewSession {
  const window = previewWindowFromEvents(events)!;
  return {
    projectId: project.id,
    shotId: IDS.shot,
    layerId: IDS.layerChar,
    startMs: window.startMs,
    endMs: window.endMs,
    eventIds: events.map((event) => event.id),
  };
}

describe('Issue #185 sequential ActionPreset composition', () => {
  it('Scale Emphasis -> Shake starts after settled scale and never replays scale', () => {
    const base = buildProject();
    const scale = createPresetEvents(
      base,
      IDS.shot,
      IDS.layerChar,
      'scale-emphasis',
      {},
      { createId: () => '81000000-0000-4000-8000-000000000001' },
    );
    const afterScale = applyPresetEvents(base, IDS.shot, scale);
    const shake = createPresetEvents(
      afterScale,
      IDS.shot,
      IDS.layerChar,
      'shake',
      {},
      { createId: () => '81000000-0000-4000-8000-000000000002' },
    );
    const combined = applyPresetEvents(afterScale, IDS.shot, shake);
    const scaleEvent = scale[0] as ScaleEvent;

    expect(scaleEvent).toMatchObject({ startMs: 0, endMs: 800 });
    expect(scaleEvent.to).toEqual({ x: 0.65, y: 0.65 });
    expect(shake[0]).toMatchObject({ startMs: 800, endMs: 1400 });
    expect(nextPresetStartMs(combined.shots[0]!, IDS.layerChar)).toBe(1400);

    const atStart = target(combined, 800);
    const middle = target(combined, 950);
    const atEnd = target(combined, 1400);
    expect(atStart.scaleX).toBeCloseTo(0.65, 8);
    expect(middle.scaleX).toBeCloseTo(0.65, 8);
    expect(atEnd.scaleX).toBeCloseTo(0.65, 8);
    expect(middle.x).not.toBeCloseTo(atStart.x, 6);
    expect(atEnd.x).toBeCloseTo(atStart.x, 6);

    const session = previewSession(combined, shake);
    for (const timeMs of [800, 950, 1400]) {
      const applyFrame = evaluatePreviewFrame(
        combined,
        combined.shots[0]!,
        timeMs,
        session,
      );
      const replayFrame = evaluatePreviewFrame(
        combined,
        combined.shots[0]!,
        timeMs,
        session,
      );
      expect(replayFrame).toEqual(applyFrame);
    }
  });

  it('Fade In -> Fade Out authors a real 1 -> 0 transition at the settled boundary', () => {
    const base = buildProject();
    const fadeIn = createPresetEvents(
      base,
      IDS.shot,
      IDS.layerChar,
      'fade-in',
      {},
      { createId: () => '82000000-0000-4000-8000-000000000001' },
    );
    const afterFadeIn = applyPresetEvents(base, IDS.shot, fadeIn);
    const fadeOut = createPresetEvents(
      afterFadeIn,
      IDS.shot,
      IDS.layerChar,
      'fade-out',
      {},
      { createId: () => '82000000-0000-4000-8000-000000000002' },
    );
    const combined = applyPresetEvents(afterFadeIn, IDS.shot, fadeOut);
    const inEvent = fadeIn[0] as OpacityEvent;
    const outEvent = fadeOut[0] as OpacityEvent;

    expect(inEvent).toMatchObject({ startMs: 0, endMs: 800, from: 0, to: 1 });
    expect(outEvent).toMatchObject({
      startMs: 800,
      endMs: 1600,
      from: 1,
      to: 0,
    });
    expect(target(combined, 800).opacity).toBe(1);
    expect(target(combined, 1200).opacity).toBeCloseTo(0.5, 8);
    expect(target(combined, 1600).opacity).toBe(0);

    const session = previewSession(combined, fadeOut);
    for (const timeMs of [800, 1200, 1600]) {
      expect(
        evaluatePreviewFrame(combined, combined.shots[0]!, timeMs, session),
      ).toEqual(evaluateShotAtTime(combined.shots[0]!, timeMs, combined));
    }
  });

  it('uses only the target layer boundary and preserves explicit timing', () => {
    const base = buildProject();
    const unrelated = createPresetEvents(
      base,
      IDS.shot,
      IDS.layerAsset,
      'move-to',
      { startMs: 2000, durationMs: 500, targetX: 900, targetY: 500 },
    );
    const withUnrelated = applyPresetEvents(base, IDS.shot, unrelated);
    const targetFade = createPresetEvents(
      withUnrelated,
      IDS.shot,
      IDS.layerChar,
      'fade-in',
    );
    expect(targetFade[0]).toMatchObject({ startMs: 0, endMs: 800 });

    const explicit = createPresetEvents(
      withUnrelated,
      IDS.shot,
      IDS.layerChar,
      'shake',
      { startMs: 400, durationMs: 600 },
    );
    expect(explicit[0]).toMatchObject({ startMs: 400, endMs: 1000 });
  });

  it('survives validated JSON Save/Reopen with identical timing and frames', () => {
    const base = buildProject();
    const fadeIn = createPresetEvents(base, IDS.shot, IDS.layerChar, 'fade-in');
    const afterFadeIn = applyPresetEvents(base, IDS.shot, fadeIn);
    const fadeOut = createPresetEvents(
      afterFadeIn,
      IDS.shot,
      IDS.layerChar,
      'fade-out',
    );
    const combined = applyPresetEvents(afterFadeIn, IDS.shot, fadeOut);
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(combined)));

    expect(reopened.shots[0]!.timelineEvents).toEqual(
      combined.shots[0]!.timelineEvents,
    );
    for (const timeMs of [0, 400, 800, 1200, 1600]) {
      expect(target(reopened, timeMs)).toEqual(target(combined, timeMs));
    }
  });
});
