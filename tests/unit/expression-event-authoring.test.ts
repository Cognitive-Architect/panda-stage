import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  ShotService,
  deleteExpressionEvent,
  evaluateShotAtTime,
  upsertExpressionEventAtTime,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';

const EVENT_ID = '90000000-0000-4000-8000-000000000027';
const SECOND_EVENT_ID = '90000000-0000-4000-8000-000000000028';

function projectWithTime() {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((shot) => ({ ...shot, durationMs: 6_000 })),
  });
}

describe('Issue #627 formal Expression authoring', () => {
  it('holds A before 3s and B from 3s onward without changing the Character or root', () => {
    const project = projectWithTime();
    const authored = upsertExpressionEventAtTime(
      project, IDS.shot, IDS.layerChar, IDS.expressionAngry, 3_000, () => EVENT_ID,
    );
    const shot = authored.shots[0]!;
    const event = shot.timelineEvents[0]!;
    expect(event).toMatchObject({
      id: EVENT_ID,
      type: 'expression',
      layerId: IDS.layerChar,
      startMs: 3_000,
      endMs: 3_000,
      expressionId: IDS.expressionAngry,
    });
    expect(authored.characters).toEqual(project.characters);
    expect(shot.layers).toEqual(project.shots[0]!.layers);
    for (const timeMs of [0, 2_999]) {
      expect(evaluateShotAtTime(shot, timeMs, authored).layers.find(
        (layer) => layer.id === IDS.layerChar,
      )?.currentExpressionId).toBe(IDS.expressionNormal);
    }
    for (const timeMs of [3_000, 5_000]) {
      const layer = evaluateShotAtTime(shot, timeMs, authored).layers.find(
        (candidate) => candidate.id === IDS.layerChar,
      )!;
      expect(layer.currentExpressionId).toBe(IDS.expressionAngry);
      expect(layer).toMatchObject({ id: IDS.layerChar, x: 500, y: 600, scaleX: 0.5, scaleY: 0.5 });
    }
  });

  it('supports a 0:00 switch, same-time replace/no-op, and deletion fallback', () => {
    const base = projectWithTime();
    const atZero = upsertExpressionEventAtTime(
      base, IDS.shot, IDS.layerChar, IDS.expressionAngry, 0, () => EVENT_ID,
    );
    expect(evaluateShotAtTime(atZero.shots[0]!, 0, atZero).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )?.currentExpressionId).toBe(IDS.expressionAngry);
    const replaced = upsertExpressionEventAtTime(
      atZero, IDS.shot, IDS.layerChar, IDS.expressionNormal, 0,
    );
    expect(replaced.shots[0]!.timelineEvents).toHaveLength(1);
    expect(replaced.shots[0]!.timelineEvents[0]).toMatchObject({ id: EVENT_ID, expressionId: IDS.expressionNormal });
    expect(upsertExpressionEventAtTime(
      replaced, IDS.shot, IDS.layerChar, IDS.expressionNormal, 0,
    )).toBe(replaced);
    const deleted = deleteExpressionEvent(replaced, IDS.shot, IDS.layerChar, EVENT_ID);
    expect(deleted.shots[0]!.timelineEvents).toHaveLength(0);
    expect(evaluateShotAtTime(deleted.shots[0]!, 0, deleted).layers.find(
      (layer) => layer.id === IDS.layerChar,
    )?.currentExpressionId).toBe(IDS.expressionNormal);
  });

  it('keeps older same-time event ordering while replacing only the effective event', () => {
    const base = projectWithTime();
    const older = upsertExpressionEventAtTime(
      base, IDS.shot, IDS.layerChar, IDS.expressionNormal, 3_000, () => EVENT_ID,
    );
    const legacy = ProjectSchema.parse({
      ...older,
      shots: older.shots.map((shot) => ({
        ...shot,
        timelineEvents: [
          ...shot.timelineEvents,
          { ...shot.timelineEvents[0]!, id: SECOND_EVENT_ID, expressionId: IDS.expressionAngry },
        ],
      })),
    });
    const changed = upsertExpressionEventAtTime(
      legacy, IDS.shot, IDS.layerChar, IDS.expressionNormal, 3_000,
    );
    expect(changed.shots[0]!.timelineEvents).toHaveLength(2);
    expect(changed.shots[0]!.timelineEvents[0]).toEqual(legacy.shots[0]!.timelineEvents[0]);
    expect(changed.shots[0]!.timelineEvents[1]).toMatchObject({ id: SECOND_EVENT_ID, expressionId: IDS.expressionNormal });
  });

  it('normalizes frame time and rejects invalid targets, references, and shot end', () => {
    const base = projectWithTime();
    const authored = upsertExpressionEventAtTime(
      base, IDS.shot, IDS.layerChar, IDS.expressionAngry, 3_010, () => EVENT_ID,
    );
    expect(authored.shots[0]!.timelineEvents[0]!.startMs).toBe(3_000);
    for (const timeMs of [-1, Number.NaN, 6_000, 6_010]) {
      expect(() => upsertExpressionEventAtTime(
        base, IDS.shot, IDS.layerChar, IDS.expressionAngry, timeMs,
      )).toThrow();
    }
    expect(() => upsertExpressionEventAtTime(
      base, IDS.shot, IDS.layerAsset, IDS.expressionAngry, 3_000,
    )).toThrow();
    expect(() => upsertExpressionEventAtTime(
      base, IDS.shot, IDS.layerChar, IDS.unknownExpression, 3_000,
    )).toThrow();
    expect(() => upsertExpressionEventAtTime(
      base, '50000000-0000-4000-8000-000000000099', IDS.layerChar, IDS.expressionAngry, 3_000,
    )).toThrow();
    const locked = ProjectSchema.parse({
      ...base,
      shots: base.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === IDS.layerChar ? { ...layer, locked: true } : layer,
        ),
      })),
    });
    expect(() => upsertExpressionEventAtTime(
      locked, IDS.shot, IDS.layerChar, IDS.expressionAngry, 3_000,
    )).toThrow();
    expect(() => deleteExpressionEvent(base, IDS.shot, IDS.layerChar, EVENT_ID)).toThrow();
  });

  it('copies an authored switch to the copied Character Layer identity', () => {
    const authored = upsertExpressionEventAtTime(
      projectWithTime(), IDS.shot, IDS.layerChar, IDS.expressionAngry, 3_000, () => EVENT_ID,
    );
    const duplicated = new ShotService().duplicate(authored, IDS.shot);
    const copied = duplicated.shots[1]!;
    const copiedLayer = copied.layers.find((layer) => layer.source.kind === 'character')!;
    const event = copied.timelineEvents.find((candidate) => candidate.type === 'expression')!;
    expect(copiedLayer.id).not.toBe(IDS.layerChar);
    expect(event.layerId).toBe(copiedLayer.id);
    expect(event.id).not.toBe(EVENT_ID);
    expect(evaluateShotAtTime(copied, 3_000, duplicated).layers.find(
      (layer) => layer.id === copiedLayer.id,
    )?.currentExpressionId).toBe(IDS.expressionAngry);
  });
});
