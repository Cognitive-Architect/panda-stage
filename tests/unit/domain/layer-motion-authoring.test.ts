import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AnimationClipSchema,
  AnimationTargetRefSchema,
  AnimationTrackSchema,
  LayerAnimationClipSchema,
  LayerAnimationTrackSchema,
  LayerMotionService,
  LayerSchema,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  PositionProjectService,
  ProjectSchema,
  ProjectV20Schema,
  ProjectV21Schema,
  ShotService,
  editAnimationPropertyKey,
  evaluateAnimationEase,
  evaluateCubicBezier2D,
  evaluateLayerMotionAtTime,
  evaluateShotAtTime,
  frameTimeMs,
  isValidFrameTime,
  layerCompositeKeyEasing,
  layerCompositeKeyTimes,
  hasLayerCompositeKeyOutgoingInterval,
  migrateProject,
  normalizeAngleDeg360,
  recognizePositionChain,
  resolveLayerVisualParts,
  sampleCubicBezierBySteps,
  samplePathArrayLayout,
  sampleRadialArrayLayout,
  sampleRadialBurstInstances,
  type CubicBezier2D,
  type FlaGraphicDefinition,
  type Project,
  type TimelineEvent,
} from '../../../src/domain';
import { animationCoreFixture } from '../../helpers/animationCoreFixture';
import { FACE_GRAPHIC_ID, graphicFaceProject } from '../../helpers/graphicFaceProject';
import { buildProjectWithAnimation, IDS } from './testProject';

const service = new LayerMotionService();

function zeroCharacterGraphicProject(nestedTimeline = false): {
  project: Project;
  shotId: string;
  layerId: string;
  definitionId: string;
} {
  const base = graphicFaceProject();
  const definition = base.animations[0] as FlaGraphicDefinition;
  definition.source.sourceFps = 4;
  definition.durationMs = 1_000;
  definition.frames = definition.frames.map((frame, ordinal) => ({
    ...frame,
    startMs: ordinal * 250,
    durationMs: 250,
  }));
  if (nestedTimeline) {
    definition.structure!.frames.forEach((frame) => {
      frame.layers[0]!.nodes[0]!.sourceAddress = 'root/face';
    });
    definition.structure!.timeline = {
      tracks: [
        {
          trackId: 'addr:root/face',
          keyframes: [
            {
              timeMs: 0,
              transform: { tx: 10, ty: 20, rotationDeg: 0, scaleX: 1, scaleY: 1 },
              easing: 'linear',
            },
            {
              timeMs: 1_000,
              transform: { tx: 110, ty: 20, rotationDeg: 0, scaleX: 1, scaleY: 1 },
              easing: 'linear',
            },
          ],
        },
      ],
    };
  }

  // Strictly Character=0 (no characters, no voice profiles).
  const noCharProject = ProjectSchema.parse({
    ...base,
    characters: [],
    voiceProfiles: [],
    shots: base.shots.map((shot) => ({
      ...shot,
      dialogues: [],
      timelineEvents: [],
      layers: shot.layers.filter((l) => l.id === shot.backgroundLayerId),
    })),
  });

  const placed = new LayerService().createFromAnimation(noCharProject, IDS.shot, {
    animationId: FACE_GRAPHIC_ID,
    position: { x: 400, y: 300 },
    startTimeMs: 0,
    playback: { mode: 'loop', endBehavior: 'hold' },
  });

  return {
    project: placed.project,
    shotId: IDS.shot,
    layerId: placed.layer.id,
    definitionId: FACE_GRAPHIC_ID,
  };
}

describe('native background tiles (#1286)', () => {
  it('bakes static tiles and covers the stage through off-grid screen-off recycling in four directions', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const layerService = new LayerService();
    const shot = project.shots[0]!;
    const source = shot.layers.find((layer) => layer.id === layerId)!;
    source.animationPlayback = { mode: 'single-frame', endBehavior: 'hold' };
    source.scaleX = 3.2;
    source.scaleY = 2;
    const staticResult = layerService.generateBackgroundTiles(project, shotId, layerId, { mode: 'static' });
    expect(staticResult.layers.map(({ x, y, animationClip }) => [x, y, animationClip])).toEqual(
      [180, 540, 900].flatMap((y) => [320, 960, 1600].map((x) => [x, y, undefined])),
    );
    expect(staticResult.project.shots[0]!.layers.find((layer) => layer.id === layerId)).toEqual(source);
    expect(staticResult.project.shots[0]!.backgroundLayerId).toBe(shot.backgroundLayerId);
    for (const direction of ['left', 'right', 'up', 'down'] as const) {
      const horizontal = direction === 'left' || direction === 'right';
      const length = horizontal ? 1920 : 1080;
      const reverse = direction === 'right' || direction === 'down';
      for (const periodFrames of [1, 24]) {
        const result = layerService.generateBackgroundTiles(project, shotId, layerId, { mode: 'loop', direction, periodFrames });
        expect(result.layers).toHaveLength(15);
        const loopShot = result.project.shots[0]!;
        const frames = [0, 1, 6, 12, 23, 24, 25].map((frame) => frameTimeMs(frame));
        const firstStrip = new Set(result.layers.filter((layer) => horizontal ? layer.y === 180 : layer.x === 320).map((layer) => layer.id));
        for (const timeMs of [...frames, frameTimeMs(periodFrames) - 6, loopShot.durationMs]) {
          const evaluated = evaluateShotAtTime(loopShot, timeMs, result.project);
          const intervals = evaluated.layers.filter((layer) => firstStrip.has(layer.id)).map((layer) => {
            const bounds = resolveLayerVisualParts(result.project, loopShot, layer, timeMs).combinedLocalBounds;
            const start = horizontal ? layer.x + bounds.x * layer.scaleX : layer.y + bounds.y * layer.scaleY;
            const span = horizontal ? bounds.width * layer.scaleX : bounds.height * layer.scaleY;
            return { start, end: start + span };
          }).filter(({ start, end }) => start < length - 1e-6 && end > 1e-6).sort((a, b) => a.start - b.start);
          expect(intervals[0]!.start).toBeLessThanOrEqual(1e-6);
          expect(intervals.at(-1)!.end).toBeGreaterThanOrEqual(length - 1e-6);
          for (let index = 1; index < intervals.length; index += 1) {
            expect(intervals[index]!.start).toBeCloseTo(intervals[index - 1]!.end, 5);
          }
        }
        const firstTile = result.layers[0]!;
        const beforeRecycle = evaluateShotAtTime(loopShot, frameTimeMs(periodFrames) - 6, result.project).layers.find((layer) => layer.id === firstTile.id)!;
        const afterRecycle = evaluateShotAtTime(loopShot, frameTimeMs(periodFrames), result.project).layers.find((layer) => layer.id === firstTile.id)!;
        const axis = horizontal ? 'x' : 'y';
        const edge = (horizontal ? 640 : 360) / 2;
        expect(reverse ? beforeRecycle[axis] - edge : -beforeRecycle[axis] - edge).toBeGreaterThanOrEqual(length * Number(reverse) - 1e-6);
        expect(reverse ? -afterRecycle[axis] - edge : afterRecycle[axis] - edge).toBeGreaterThanOrEqual(length * Number(!reverse) - 1e-6);
      }
    }
  });
});

describe('native orbit flight (#1287)', () => {
  it('keeps one copy visible at the expected anchor and reference depth through band switches', () => {
    const { project, shotId, layerId, definitionId } = zeroCharacterGraphicProject();
    const layerService = new LayerService();
    const addReference = (base: Project, x: number) => layerService.createFromAnimation(base, shotId, {
      animationId: definitionId, position: { x, y: 540 }, startTimeMs: 0,
    });
    const back = addReference(project, 960);
    const front = addReference(back.project, 1000);
    for (const referenceLayerIds of [[back.layer.id], [back.layer.id, front.layer.id]]) {
      const result = layerService.generateOrbitFlight(front.project, shotId, layerId, {
        referenceLayerIds, radiusX: 240, radiusY: 100, count: 1, startAngleDeg: 0,
        direction: 'clockwise', orientation: 'tangent', startFrame: 1, durationFrames: 48,
      });
      const shot = result.project.shots[0]!;
      const ids = new Set(result.layers.map((layer) => layer.id));
      const at = (timeMs: number) => evaluateShotAtTime(shot, timeMs, result.project).layers
        .filter((layer) => ids.has(layer.id) && layer.visible);
      expect(result.layers).toHaveLength(referenceLayerIds.length + 1);
      expect(at(41)).toHaveLength(0);
      for (const [index, [x, y]] of ([[1200, 540], [960, 640], [720, 540], [960, 440], [1200, 540]] as const).entries()) {
        const layers = at(frameTimeMs(1 + index * 12));
        expect(layers).toHaveLength(1);
        expect(layers[0]!.x).toBeCloseTo(x, 5);
        expect(layers[0]!.y).toBeCloseTo(y, 5);
        if (index === 3) expect(layers[0]!.zIndex).toBeLessThan(shot.layers.find((layer) => layer.id === back.layer.id)!.zIndex);
        if (index === 1) expect(layers[0]!.zIndex).toBeGreaterThan(shot.layers.find((layer) => layer.id === referenceLayerIds.at(-1))!.zIndex);
      }
      for (let frame = 1; frame < 49; frame += 1) {
        const early = at(frameTimeMs(frame) + 5);
        expect(early).toHaveLength(1);
        expect(Math.abs(at(frameTimeMs(frame + 1))[0]!.rotationDeg - early[0]!.rotationDeg)).toBeLessThan(30);
      }
      expect(at(frameTimeMs(50))).toHaveLength(0);
    }
  });
});

describe('native converging flight (#1288)', () => {
  it('bakes deterministic equal-length curves with staggered launch, exact arrival and optional hiding', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const layerService = new LayerService();
    const input = {
      count: 12, target: { x: 960, y: 540 }, radius: 360, bend: 100, startAngleDeg: 0,
      startFrame: 0, durationFrames: 24, staggerFrames: 2, seed: 42, orientation: 'tangent' as const,
      hideAfterArrival: true,
    };
    const run = (seed: number) => layerService.generateConvergingFlight(project, shotId, layerId, { ...input, seed });
    const result = run(42);
    const tracks = (bake: typeof result) => bake.layers.map((layer) =>
      layer.animationClip?.version === 2 && layer.animationClip.tracks.map(({ property, keys }) => ({ property, keys })));
    expect(tracks(result)).toEqual(tracks(run(42)));
    expect(tracks(result)).not.toEqual(tracks(run(0)));
    const shot = result.project.shots[0]!;
    expect(result.layers).toHaveLength(12);
    const distribution = sampleRadialBurstInstances({
      count: input.count, center: input.target, radius: input.radius, seed: input.seed, startAngleDeg: 0, maxRotationDeg: 0,
    });
    for (const [index, layer] of result.layers.entries()) {
      const launch = 2 * index;
      const sample = distribution[index]!;
      const at = (timeMs: number) => evaluateShotAtTime(shot, timeMs, result.project).layers.find((entry) => entry.id === layer.id)!;
      if (launch) expect(at(frameTimeMs(launch) - 1).visible).toBe(false);
      const start = at(frameTimeMs(launch));
      expect(start.visible).toBe(true);
      expect(start.x).toBeCloseTo(sample.endPoint.x, 6);
      expect(start.y).toBeCloseTo(sample.endPoint.y, 6);
      expect(sample.distance).toBeGreaterThanOrEqual(270);
      expect(sample.distance).toBeLessThanOrEqual(360);
      const dx = 960 - start.x;
      const dy = 540 - start.y;
      const bend = 0.75 * input.bend * (2 * sample.w - 1) / sample.distance;
      const middle = at(frameTimeMs(launch + 12));
      expect(middle.x).toBeCloseTo(start.x + dx / 2 - dy * bend, 5);
      expect(middle.y).toBeCloseTo(start.y + dy / 2 + dx * bend, 5);
      const end = at(frameTimeMs(launch + 24));
      expect(end).toMatchObject({ visible: true, x: 960, y: 540 });
      expect(at(frameTimeMs(launch + 25)).visible).toBe(false);
    }
  });
});

describe('native diffusion ghosts (#1289)', () => {
  it('holds a common anchor under pivot-compensated scaling, with phased fades and layer order', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const source = project.shots[0]!.layers.find((layer) => layer.id === layerId)!;
    source.scaleX = 2;
    source.scaleY = 1.3;
    source.flipX = true;
    source.rotationDeg = 35;
    const withPivot = service.recalibratePivot(project, { shotId, layerId }, { space: 'target-local', x: 140, y: 104 });
    const layerService = new LayerService();
    const input = { count: 4, startFrame: 1, durationFrames: 12, staggerFrames: 2, maxScale: 1.8, decay: 0.7 };
    const result = layerService.generateDiffusionGhosts(withPivot, shotId, layerId, input);
    const shot = result.project.shots[0]!;
    expect(result.layers).toHaveLength(4);
    expect(result.layers.map((layer) => layer.zIndex)).toEqual([4, 3, 2, 1]);
    for (const [index, layer] of result.layers.entries()) {
      const start = 1 + index * 2;
      const alpha = 0.7 ** (index + 1);
      const at = (timeMs: number) => evaluateShotAtTime(shot, timeMs, result.project).layers.find((entry) => entry.id === layer.id)!;
      expect(at(frameTimeMs(start) - 1).visible).toBe(false);
      for (const [step, multiplier, expectedAlpha] of [[0, 1, alpha], [6, 1.4, alpha / 2], [12, 1.8, 0]] as const) {
        const evaluated = at(frameTimeMs(start + step));
        expect(evaluated.x).toBeCloseTo(source.x, 5);
        expect(evaluated.y).toBeCloseTo(source.y, 5);
        expect(evaluated.scaleX).toBeCloseTo(multiplier * 2, 5);
        expect(evaluated.scaleY).toBeCloseTo(multiplier * 1.3, 5);
        expect(evaluated.opacity).toBeCloseTo(expectedAlpha, 5);
        expect(evaluated.visible).toBe(step !== 12);
      }
      expect(at(frameTimeMs(start + 13)).visible).toBe(false);
    }
    expect(() => layerService.generateDiffusionGhosts(withPivot, shotId, layerId, { ...input, maxScale: 11 })).toThrow();
  });
});

describe('AnimationTargetRef and v21 migration contract (#1140)', () => {
  it('supports layer targets without partId and prevents mixing v1/v2 targets', () => {
    expect(AnimationTargetRefSchema.parse({ kind: 'layer', layerId: IDS.layerAsset })).toEqual({
      kind: 'layer',
      layerId: IDS.layerAsset,
    });
    expect(
      AnimationTargetRefSchema.safeParse({
        kind: 'layer',
        layerId: IDS.layerAsset,
        partId: IDS.layerChar,
      }).success,
    ).toBe(false);

    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const authored = service.applyKeys(
      project,
      { shotId, layerId, timeMs: 500 },
      { 'transform.offsetX': 60, 'transform.rotationDeg': 45 },
    );
    const layer = authored.shots[0]!.layers.find((l) => l.id === layerId)!;
    const clip = layer.animationClip!;
    expect(clip.version).toBe(2);
    expect(clip).not.toHaveProperty('fixedCharacterCenter');
    expect(clip).not.toHaveProperty('characterContext');
    expect(AnimationClipSchema.parse(clip)).toEqual(clip);
    expect(LayerAnimationClipSchema.parse(clip)).toEqual(clip);

    // Mixing character-part track into v2 fails.
    expect(
      LayerAnimationClipSchema.safeParse({
        ...clip,
        tracks: [
          {
            target: { kind: 'character-part', layerId, partId: IDS.layerChar },
            property: 'transform.offsetX',
            keys: [{ timeMs: 0, value: 0, interpolationToNext: 'linear' }],
          },
        ],
      }).success,
    ).toBe(false);

    // Non-fla-graphic animation layer cannot carry Clip v2.
    const seqProject = buildProjectWithAnimation();
    const seqPlaced = new LayerService().createFromAnimation(seqProject, IDS.shot, {
      animationId: IDS.animation,
      position: { x: 500, y: 400 },
      startTimeMs: 0,
    });
    const fakeSeqProject = structuredClone(seqPlaced.project);
    const seqLayer = fakeSeqProject.shots[0]!.layers.find((l) => l.id === seqPlaced.layer.id)!;
    seqLayer.animationClip = {
      version: 2,
      targetBases: [
        {
          target: { kind: 'layer', layerId: seqLayer.id },
          animationId: IDS.animation,
          baseTransform: { x: 500, y: 400, scaleX: 1, scaleY: 1, rotationDeg: 0 },
          sourceCanvas: { width: 1000, height: 1000 },
          pivot: { space: 'target-local', x: 500, y: 500 },
        },
      ],
      tracks: [],
    };
    expect(ProjectSchema.safeParse(fakeSeqProject).success).toBe(false);

    // Clip v2 cannot attach to an asset layer.
    const assetLayer = authored.shots[0]!.layers.find((l) => l.source.kind === 'asset')!;
    expect(
      LayerSchema.safeParse({
        ...assetLayer,
        animationClip: {
          ...clip,
          targetBases: [{ ...clip.targetBases[0], target: { kind: 'layer', layerId: assetLayer.id } }],
          tracks: clip.tracks.map((t) => ({ ...t, target: { kind: 'layer', layerId: assetLayer.id } })),
        },
      }).success,
    ).toBe(false);
  });

  it('upgrades v21 Character Clip v1 losslessly to the current Project version and keeps v21 closed to Layer Clip v2', () => {
    const currentCharacter = animationCoreFixture().project;
    const v21Character = { ...structuredClone(currentCharacter), schemaVersion: 21 };
    expect(ProjectV21Schema.parse(v21Character)).toEqual(v21Character);
    expect(ProjectV20Schema.safeParse({ ...currentCharacter, schemaVersion: 20 }).success).toBe(false);

    const migrated = migrateProject(v21Character);
    expect(migrated).toEqual({ ...v21Character, schemaVersion: PROJECT_SCHEMA_VERSION });
    expect(migrateProject(migrated)).toEqual(migrated);

    // Existing Character v1 path continues evaluating properly post-migration.
    const charLayer = migrated.shots[0]!.layers.find((l) => l.animationClip?.version === 1)!;
    const evaluated = evaluateShotAtTime(migrated.shots[0]!, 500, migrated).layers.find(
      (l) => l.id === charLayer.id,
    )!;
    expect(evaluated.animationValues?.[0]?.value).toBe(135);

    // Frozen v21 reader rejects Layer Clip v2.
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const withV2Clip = service.applyKeys(
      project,
      { shotId, layerId, timeMs: 500 },
      { 'transform.offsetX': 25 },
    );
    expect(ProjectV21Schema.safeParse({ ...withV2Clip, schemaVersion: 21 }).success).toBe(false);
    expect(() => migrateProject({ ...withV2Clip, schemaVersion: 21 })).toThrow();
  });
});

describe('LayerMotionService Character=0 authoring, pivot & ownership (#1140)', () => {
  it('authors 500ms move/rotate/scale with Character=0 & no partId, evaluating deterministically', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    expect(project.characters).toHaveLength(0);

    const before = structuredClone(project);
    const next = service.applyKeys(
      project,
      { shotId, layerId, timeMs: 500 },
      {
        'transform.offsetX': 120,
        'transform.offsetY': -40,
        'transform.rotationDeg': 90,
        'transform.scaleX': 1.5,
        'transform.scaleY': 2,
      },
    );
    expect(project).toEqual(before);
    expect(next.characters).toHaveLength(0);
    expect(next.animations).toEqual(before.animations);
    expect(JSON.stringify(next)).not.toMatch(/partId|fixedCharacterCenter|characterContext/);

    const shot = next.shots[0]!;
    const layerAfter = shot.layers.find((l) => l.id === layerId)!;
    // Static layer unchanged (no double-write).
    expect({
      x: layerAfter.x,
      y: layerAfter.y,
      scaleX: layerAfter.scaleX,
      scaleY: layerAfter.scaleY,
      rotationDeg: layerAfter.rotationDeg,
    }).toEqual({ x: 400, y: 300, scaleX: 1, scaleY: 1, rotationDeg: 0 });

    const at0 = evaluateShotAtTime(shot, 0, next).layers.find((l) => l.id === layerId)!;
    expect(at0).toMatchObject({ x: 400, y: 300, scaleX: 1, scaleY: 1, rotationDeg: 0 });

    const at250 = evaluateShotAtTime(shot, 250, next).layers.find((l) => l.id === layerId)!;
    expect(at250.x).toBeCloseTo(460);
    expect(at250.y).toBeCloseTo(280);
    expect(at250.rotationDeg).toBeCloseTo(45);
    expect(at250.scaleX).toBeCloseTo(1.25);
    expect(at250.scaleY).toBeCloseTo(1.5);

    const at500 = evaluateShotAtTime(shot, 500, next).layers.find((l) => l.id === layerId)!;
    expect(at500).toMatchObject({ x: 520, y: 260, scaleX: 1.5, scaleY: 2, rotationDeg: 90 });

    // Out-of-order repeated seeks stay identical.
    evaluateShotAtTime(shot, 900, next);
    evaluateShotAtTime(shot, 100, next);
    expect(evaluateShotAtTime(shot, 500, next).layers.find((l) => l.id === layerId)!).toEqual(at500);
  });

  it('isolates two Layer Instances of the same Graphic Definition and duplicates Shot cleanly', () => {
    const base = zeroCharacterGraphicProject();
    const second = new LayerService().createFromAnimation(base.project, base.shotId, {
      animationId: base.definitionId,
      position: { x: 1100, y: 700 },
      startTimeMs: 0,
    });
    const layerA = base.layerId;
    const layerB = second.layer.id;
    const beforeDefs = structuredClone(second.project.animations);

    let authored = service.applyKeys(
      second.project,
      { shotId: base.shotId, layerId: layerA, timeMs: 500 },
      { 'transform.offsetX': 80, 'transform.rotationDeg': 45 },
    );
    authored = service.applyKeys(
      authored,
      { shotId: base.shotId, layerId: layerB, timeMs: 500 },
      { 'transform.offsetY': -90, 'transform.scaleX': 2 },
    );

    expect(authored.animations).toEqual(beforeDefs);
    const evalA = evaluateShotAtTime(authored.shots[0]!, 500, authored).layers.find((l) => l.id === layerA)!;
    const evalB = evaluateShotAtTime(authored.shots[0]!, 500, authored).layers.find((l) => l.id === layerB)!;
    expect(evalA).toMatchObject({ x: 480, y: 300, rotationDeg: 45, scaleX: 1 });
    expect(evalB).toMatchObject({ x: 1100, y: 610, rotationDeg: 0, scaleX: 2 });

    // Shot duplicate remaps clip target layerId independently.
    const duped = new ShotService().duplicate(authored, base.shotId);
    const dupLayerA = duped.shots[1]!.layers.find((l) => l.name === authored.shots[0]!.layers.find((x) => x.id === layerA)!.name)!;
    expect(dupLayerA.id).not.toBe(layerA);
    expect(dupLayerA.animationClip?.targetBases[0]?.target.layerId).toBe(dupLayerA.id);
    expect(dupLayerA.animationClip?.tracks.every((t) => t.target.layerId === dupLayerA.id)).toBe(true);
  });

  it('composes rotation & scale cleanly around a non-zero pivot even with base rotation & scale', () => {
    const base = zeroCharacterGraphicProject();
    // Give the layer existing base rotation=30 deg and base scale=(2, 1.5).
    const withBase = new LayerService().updatePosition(
      ProjectSchema.parse({
        ...base.project,
        shots: base.project.shots.map((shot) => ({
          ...shot,
          layers: shot.layers.map((l) =>
            l.id === base.layerId
              ? { ...l, x: 500, y: 400, scaleX: 2, scaleY: 1.5, rotationDeg: 30 }
              : l,
          ),
        })),
      }),
      base.shotId,
      base.layerId,
      { x: 500, y: 400 },
    );

    // Definition canvas is 200x180 (center = 100,90). Set custom source-local pivot (140, 110) => local offset (+40, +20).
    let authored = service.recalibratePivot(
      withBase,
      { shotId: base.shotId, layerId: base.layerId },
      { space: 'target-local', x: 140, y: 110 },
    );
    authored = service.applyKeys(
      authored,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 500 },
      { 'transform.rotationDeg': 60, 'transform.scaleX': 1.5, 'transform.scaleY': 2 },
    );

    const shot = authored.shots[0]!;
    const eval0 = evaluateShotAtTime(shot, 0, authored).layers.find((l) => l.id === base.layerId)!;
    const eval500 = evaluateShotAtTime(shot, 500, authored).layers.find((l) => l.id === base.layerId)!;

    // Verify world position of the pivot point stays pinned (zero drift across rotation/scale)!
    const worldPoint = (ev: typeof eval0, lx: number, ly: number) => {
      const r = (ev.rotationDeg * Math.PI) / 180;
      const sx = ev.scaleX * lx;
      const sy = ev.scaleY * ly;
      return {
        x: ev.x + sx * Math.cos(r) - sy * Math.sin(r),
        y: ev.y + sx * Math.sin(r) + sy * Math.cos(r),
      };
    };
    const p0 = worldPoint(eval0, 40, 20);
    const p500 = worldPoint(eval500, 40, 20);
    expect(p500.x).toBeCloseTo(p0.x, 8);
    expect(p500.y).toBeCloseTo(p0.y, 8);
    expect(eval500.rotationDeg).toBeCloseTo(90);
    expect(eval500.scaleX).toBeCloseTo(3);
    expect(eval500.scaleY).toBeCloseTo(3);
  });

  it('prevents double-write in Auto-Key ON/OFF, sparse tracks, and syncs Basis with OFF', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();

    // Auto-Key ON changing only rotation creates ONLY transform.rotationDeg track.
    const onlyRot = service.applyTransform(
      project,
      { shotId, layerId, timeMs: 500, autoKey: true },
      { rotationDeg: 45 },
    );
    const rotLayer = onlyRot.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(rotLayer.rotationDeg).toBe(0);
    expect(rotLayer.animationClip?.version).toBe(2);
    expect(rotLayer.animationClip?.tracks.map((t) => t.property)).toEqual(['transform.rotationDeg']);

    // Auto-Key OFF without Clip updates static Layer without creating Clip.
    const noClipStatic = service.applyTransform(
      project,
      { shotId, layerId, timeMs: 0, autoKey: false },
      { x: 650, y: 420 },
    );
    const noClipLayer = noClipStatic.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(noClipLayer.x).toBe(650);
    expect(noClipLayer.y).toBe(420);
    expect(noClipLayer.animationClip).toBeUndefined();

    // Auto-Key OFF WITH Clip at non-0ms back-solves existing key and updates BOTH static Layer & Basis together.
    const shifted = service.applyTransform(
      onlyRot,
      { shotId, layerId, timeMs: 500, autoKey: false },
      { x: 550, y: 380, rotationDeg: 60 },
    );
    const shiftedLayer = shifted.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(shiftedLayer.x).toBe(550);
    expect(shiftedLayer.y).toBe(380);
    expect(shiftedLayer.rotationDeg).toBe(15); // 60 displayed - 45 relative track
    expect(shiftedLayer.animationClip?.version).toBe(2);
    if (shiftedLayer.animationClip?.version !== 2) throw new Error('v2');
    expect(shiftedLayer.animationClip.targetBases[0]!.baseTransform).toMatchObject({
      x: 550,
      y: 380,
      rotationDeg: 15,
    });
    // Evaluated pose shifts cleanly across the timeline (0ms -> 15deg, 500ms -> 60deg).
    expect(evaluateShotAtTime(shifted.shots[0]!, 0, shifted).layers.find((l) => l.id === layerId)!).toMatchObject({
      x: 550,
      y: 380,
      rotationDeg: 15,
    });
    expect(evaluateShotAtTime(shifted.shots[0]!, 500, shifted).layers.find((l) => l.id === layerId)!).toMatchObject({
      x: 550,
      y: 380,
      rotationDeg: 60,
    });
  });

  it('composes Move + Shake + Scale + Layer Track keys at the same time and respects legacy ownership', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const events: TimelineEvent[] = [
      {
        id: randomUUID(),
        type: 'move',
        layerId,
        startMs: 0,
        endMs: 1_000,
        from: { x: 200, y: 200 },
        to: { x: 600, y: 400 },
        easing: 'linear',
      },
      {
        id: randomUUID(),
        type: 'shake',
        layerId,
        startMs: 0,
        endMs: 1_000,
        amplitudeX: 30,
        amplitudeY: 20,
        frequencyHz: 1,
      },
      {
        id: randomUUID(),
        type: 'scale',
        layerId,
        startMs: 0,
        endMs: 1_000,
        from: { x: 1, y: 1 },
        to: { x: 3, y: 2 },
        easing: 'linear',
      },
    ];
    // Wait: at t=500ms with freq=1Hz -> sin(2*PI*1*0.5)=0; use freq=0.5Hz => sin(PI/2)=1!
    (events[1] as Extract<TimelineEvent, { type: 'shake' }>).frequencyHz = 0.5;
    const withLegacy = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        timelineEvents: events,
      })),
    });

    const authored = service.applyKeys(
      withLegacy,
      { shotId, layerId, timeMs: 500 },
      {
        'transform.offsetX': 50,
        'transform.offsetY': -25,
        'transform.rotationDeg': 30,
        'transform.scaleX': 1.5,
        'transform.scaleY': 2,
      },
    );

    const shot = authored.shots[0]!;
    const layer = shot.layers.find((l) => l.id === layerId)!;
    const legacyMotion = evaluateLayerMotionAtTime(layer, events, 500);
    // Move at 500ms: (400, 300). Shake at 500ms: (+30, +20). Track offset: (+50, -25).
    expect(legacyMotion.mainPosition).toEqual({ x: 400, y: 300 });
    expect(legacyMotion.shakeOffset.x).toBeCloseTo(30);
    expect(legacyMotion.shakeOffset.y).toBeCloseTo(20);

    const ev = evaluateShotAtTime(shot, 500, authored).layers.find((l) => l.id === layerId)!;
    expect(ev.x).toBeCloseTo(480); // 400 + 30 + 50
    expect(ev.y).toBeCloseTo(295); // 300 + 20 - 25
    expect(ev.scaleX).toBeCloseTo(2 * 1.5); // legacy 2 * rel 1.5 = 3
    expect(ev.scaleY).toBeCloseTo(1.5 * 2); // legacy 1.5 * rel 2 = 3
    expect(ev.rotationDeg).toBeCloseTo(30);
    // Legacy events remain untouched.
    expect(shot.timelineEvents).toEqual(events);

    // Auto-Key ON display edit back-solves relative keys cleanly against active Move+Shake+Scale.
    const editedDisplay = service.applyTransform(
      authored,
      { shotId, layerId, timeMs: 500, autoKey: true },
      { x: 530, scaleX: 4 },
    );
    expect(editedDisplay.shots[0]!.timelineEvents).toEqual(events);
    const ev2 = evaluateShotAtTime(editedDisplay.shots[0]!, 500, editedDisplay).layers.find(
      (l) => l.id === layerId,
    )!;
    expect(ev2.x).toBeCloseTo(530);
    expect(ev2.scaleX).toBeCloseTo(4);

    // Auto-Key OFF refuses to modify Move/Scale-controlled properties and never rewrites event.from/to.
    expect(() =>
      service.applyTransform(
        authored,
        { shotId, layerId, timeMs: 500, autoKey: false },
        { x: 550 },
      ),
    ).toThrow(/时间轴移动事件/);
    expect(() =>
      service.applyTransform(
        authored,
        { shotId, layerId, timeMs: 500, autoKey: false },
        { scaleX: 2 },
      ),
    ).toThrow(/时间轴缩放事件/);
    expect(authored.shots[0]!.timelineEvents).toEqual(events);
  });

  it('shares the exact Shot clock between Graphic internal timeline and outer Layer keys', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject(true);
    const authored = service.applyKeys(
      project,
      { shotId, layerId, timeMs: 500 },
      { 'transform.offsetX': 150, 'transform.rotationDeg': 45 },
    );
    const beforeDefs = structuredClone(authored.animations);
    const shot = authored.shots[0]!;
    const eval500 = evaluateShotAtTime(shot, 500, authored).layers.find((l) => l.id === layerId)!;
    expect(eval500.x).toBe(550);
    expect(eval500.rotationDeg).toBe(45);
    expect(eval500.animationFrame?.frameOrdinal).toBe(2);
    expect(eval500.animationFrame?.internalTimeMs).toBe(500);

    const visual = resolveLayerVisualParts(authored, shot, eval500, 500);
    expect(visual.flaGraphic?.layers?.[0]?.nodes[0]?.localTransform.tx).toBeCloseTo(60); // 10 -> 110 @ 500ms = 60
    expect(authored.animations).toEqual(beforeDefs);
  });

  it('enforces 0ms protection, atomic batch retime, easing outgoing rule, delete, paste, and locked checks', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    let authored = service.applyKeys(
      project,
      { shotId, layerId, timeMs: 250 },
      { 'transform.offsetX': 40, 'transform.rotationDeg': 20 },
    );
    authored = service.applyKeys(
      authored,
      { shotId, layerId, timeMs: 500 },
      { 'transform.offsetX': 100 },
    );
    authored = service.applyKeys(
      authored,
      { shotId, layerId, timeMs: 1_000 },
      { 'transform.offsetX': 200 },
    );
    const layer = () => authored.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(layerCompositeKeyTimes(layer())).toEqual([0, 250, 500, 1_000]);

    // 0ms protected from delete & retime
    expect(() => service.deleteKey(authored, { shotId, layerId, timeMs: 0 })).toThrow(/0 ms/);
    expect(() => service.retimeKey(authored, { shotId, layerId, fromTimeMs: 0, toTimeMs: 125 })).toThrow(/0 ms/);

    // Batch retime atomic rejections leave project pristine
    for (const bad of [
      { fromTimesMs: [0, 250], deltaMs: 250 },
      { fromTimesMs: [250, 500], deltaMs: 43 }, // off-grid
      { fromTimesMs: [250, 500], deltaMs: 500 }, // 500 -> 1000 collides with stationary 1000
      { fromTimesMs: [500, 1_000], deltaMs: 2_500 }, // > shot duration (3000ms)
    ]) {
      const snap = structuredClone(authored);
      expect(() => service.retimeKeys(authored, { shotId, layerId, ...bad })).toThrow();
      expect(authored).toEqual(snap);
    }

    // Valid batch frame shift (+3 frames at 24fps = +125ms)
    authored = service.retimeKeys(authored, { shotId, layerId, fromTimesMs: [250, 500], deltaFrames: 3 });
    expect(layerCompositeKeyTimes(layer())).toEqual([0, 375, 625, 1_000]);

    // Outgoing easing check
    expect(hasLayerCompositeKeyOutgoingInterval(layer(), 625)).toBe(true);
    expect(hasLayerCompositeKeyOutgoingInterval(layer(), 1_000)).toBe(false);
    expect(() => service.setKeyEasing(authored, { shotId, layerId, timeMs: 1_000 }, 'ease-in-out')).toThrow();
    authored = service.setKeyEasing(authored, { shotId, layerId, timeMs: 375 }, 'ease-in-out');
    expect(layerCompositeKeyEasing(layer(), 375)).toBe('ease-in-out');

    // Paste & Delete
    authored = service.pasteKeys(authored, { shotId, layerId, fromTimeMs: 375, toTimeMs: 750 });
    expect(layerCompositeKeyTimes(layer())).toEqual([0, 375, 625, 750, 1_000]);
    authored = service.deleteKey(authored, { shotId, layerId, timeMs: 750 });
    expect(layerCompositeKeyTimes(layer())).toEqual([0, 375, 625, 1_000]);

    // Illegal scale & locked guards
    expect(() =>
      service.applyKeys(authored, { shotId, layerId, timeMs: 500 }, { 'transform.scaleX': 0.049 }),
    ).toThrow();
    const locked = ProjectSchema.parse({
      ...authored,
      shots: authored.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === layerId ? { ...l, locked: true } : l)),
      })),
    });
    expect(() =>
      service.applyKeys(locked, { shotId, layerId, timeMs: 500 }, { 'transform.offsetX': 1 }),
    ).toThrow(/锁定/);
  });
});

describe('Layer Clip v2 scale multiplier contract (#1142)', () => {
  it('separates Layer v2 positive finite multipliers from Character v1 0.05..20 bounds at Track Schema level', () => {
    const { project, layerId } = zeroCharacterGraphicProject();
    const layerTarget = { kind: 'layer' as const, layerId };
    for (const multiplier of [0.0025, 0.05, 1, 20, 400]) {
      const candidate = {
        target: layerTarget,
        property: 'transform.scaleX' as const,
        keys: [
          { timeMs: 0, value: 1, interpolationToNext: 'linear' as const },
          { timeMs: 500, value: multiplier, interpolationToNext: 'linear' as const },
        ],
      };
      expect(LayerAnimationTrackSchema.parse(candidate)).toEqual(candidate);
      expect(AnimationTrackSchema.parse(candidate)).toEqual(candidate);
    }
    for (const invalid of [0, -1, NaN, Infinity, -Infinity]) {
      expect(
        LayerAnimationTrackSchema.safeParse({
          target: layerTarget,
          property: 'transform.scaleX',
          keys: [{ timeMs: 0, value: invalid, interpolationToNext: 'linear' }],
        }).success,
      ).toBe(false);
    }

    // Character v1 Track schema keeps the historical 0.05..20 contract unchanged.
    const charClip = animationCoreFixture().clip;
    const partTarget = charClip.targetBases[0]!.target;
    for (const illegalCharScale of [0.0025, 0.049, 20.001, 400]) {
      expect(
        AnimationTrackSchema.safeParse({
          target: partTarget,
          property: 'transform.scaleX',
          keys: [{ timeMs: 0, value: illegalCharScale, interpolationToNext: 'linear' }],
        }).success,
      ).toBe(false);
    }
    expect(project.characters).toHaveLength(0);
  });

  it('allows base=20 -> final=0.05 (multiplier=0.0025) and base=0.05 -> final=20 (multiplier=400)', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const base20 = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === layerId ? { ...l, scaleX: 20, scaleY: 20 } : l)),
      })),
    });

    const shrunk = service.applyTransform(
      base20,
      { shotId, layerId, timeMs: 500, autoKey: true },
      { scaleX: 0.05 },
    );
    const clip = shrunk.shots[0]!.layers.find((l) => l.id === layerId)!.animationClip!;
    expect(clip.version).toBe(2);
    const key500 = clip.tracks[0]!.keys.find((k) => k.timeMs === 500)!;
    expect(key500.value).toBeCloseTo(0.0025, 10);
    const evShrunk = evaluateShotAtTime(shrunk.shots[0]!, 500, shrunk).layers.find(
      (l) => l.id === layerId,
    )!;
    expect(evShrunk.scaleX).toBeCloseTo(0.05, 10);
    expect(evShrunk.scaleY).toBe(20);

    // Non-exact ratio base (0.7 -> 0.05) succeeds cleanly despite IEEE-754 rounding.
    const base07 = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === layerId ? { ...l, scaleX: 0.7 } : l)),
      })),
    });
    const toMin = service.applyTransform(
      base07,
      { shotId, layerId, timeMs: 500, autoKey: true },
      { scaleX: 0.05 },
    );
    expect(
      evaluateShotAtTime(toMin.shots[0]!, 500, toMin).layers.find((l) => l.id === layerId)!.scaleX,
    ).toBeCloseTo(0.05, 10);

    // Inverse extreme: base=0.05 -> final=20 via multiplier=400.
    const baseMin = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === layerId ? { ...l, scaleX: 0.05 } : l)),
      })),
    });
    const grown = service.applyTransform(
      baseMin,
      { shotId, layerId, timeMs: 500, autoKey: true },
      { scaleX: 20 },
    );
    const grownKey = grown.shots[0]!.layers.find((l) => l.id === layerId)!.animationClip!.tracks[0]!.keys.find(
      (k) => k.timeMs === 500,
    )!;
    expect(grownKey.value).toBeCloseTo(400, 10);
    expect(
      evaluateShotAtTime(grown.shots[0]!, 500, grown).layers.find((l) => l.id === layerId)!.scaleX,
    ).toBeCloseTo(20, 10);
  });

  it('rejects out-of-bounds final scale at both applyTransform and applyKeys (e.g. base 20 x rel 20 = 400)', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const base20 = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === layerId ? { ...l, scaleX: 20, scaleY: 1 } : l)),
      })),
    });
    const snapshot = structuredClone(base20);

    // Direct applyKeys with base=20 * multiplier=20 -> final=400 must be rejected.
    expect(() =>
      service.applyKeys(base20, { shotId, layerId, timeMs: 500 }, { 'transform.scaleX': 20 }),
    ).toThrow(/超出合法范围/);
    expect(base20).toEqual(snapshot);

    // Direct applyKeys with base=20 * multiplier=0.002 -> final=0.04 (< 0.05) must be rejected.
    expect(() =>
      service.applyKeys(base20, { shotId, layerId, timeMs: 500 }, { 'transform.scaleX': 0.002 }),
    ).toThrow(/超出合法范围/);
    expect(base20).toEqual(snapshot);

    // Auto-Key applyTransform targeting >20 or <0.05 must be rejected.
    expect(() =>
      service.applyTransform(base20, { shotId, layerId, timeMs: 500, autoKey: true }, { scaleX: 400 }),
    ).toThrow(/图层缩放/);
    expect(() =>
      service.applyTransform(base20, { shotId, layerId, timeMs: 500, autoKey: true }, { scaleX: 0.049 }),
    ).toThrow(/图层缩放/);
    expect(base20).toEqual(snapshot);

    // Low-level applyKeys allows multiplier=0.0025 directly when final=0.05 is valid,
    // and Auto-Key OFF rejects lowering static scale when an existing key would drop below 0.05!
    const validMin = service.applyKeys(
      base20,
      { shotId, layerId, timeMs: 500 },
      { 'transform.scaleX': 0.0025 },
    );
    expect(
      evaluateShotAtTime(validMin.shots[0]!, 500, validMin).layers.find((l) => l.id === layerId)!.scaleX,
    ).toBeCloseTo(0.05, 10);

    const validSnap = structuredClone(validMin);
    expect(() =>
      service.applyTransform(
        validMin,
        { shotId, layerId, timeMs: 0, autoKey: false },
        { scaleX: 1 },
      ),
    ).toThrow(/超出合法范围/);
    expect(validMin).toEqual(validSnap);
  });

  it('validates Layer v2 scale multipliers against pre-track legacy ScaleEvent values', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    // Static scaleX=20, but ScaleEvent sets pre-track scale at 500ms to 1 (and up to 5 at 1000ms).
    const scaleEvent: TimelineEvent = {
      id: randomUUID(),
      type: 'scale',
      layerId,
      startMs: 0,
      endMs: 1_000,
      from: { x: 1, y: 1 },
      to: { x: 5, y: 5 },
      easing: 'linear',
    };
    const withScaleEvent = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        timelineEvents: [scaleEvent],
        layers: s.layers.map((l) => (l.id === layerId ? { ...l, scaleX: 20, scaleY: 20 } : l)),
      })),
    });

    // At 500ms, ScaleEvent evaluates to pre-track scale=3; multiplier=0.02 gives 0.06 (>= 0.05)!
    const validAt500 = service.applyKeys(
      withScaleEvent,
      { shotId, layerId, timeMs: 500 },
      { 'transform.scaleX': 0.02 },
    );
    expect(
      evaluateShotAtTime(validAt500.shots[0]!, 500, validAt500).layers.find((l) => l.id === layerId)!.scaleX,
    ).toBeCloseTo(0.06, 10);

    // At 1000ms, ScaleEvent evaluates to pre-track scale=5; multiplier=5 gives final=25 (> 20) -> REJECT!
    expect(() =>
      service.applyKeys(validAt500, { shotId, layerId, timeMs: 1_000 }, { 'transform.scaleX': 5 }),
    ).toThrow(/超出合法范围/);
  });

  it('rejects intermediate frame-grid final-scale overflow between legal endpoints (ScaleEvent x Scale Track #1143)', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    // 0ms..1000ms: ScaleEvent 0.05 -> 20, Layer Track 400 -> 0.0025.
    // Endpoints are both legal (0ms=20, 1000ms=0.05), but midpoint ~500ms hits ~2005!
    const extremeRamp: TimelineEvent = {
      id: randomUUID(),
      type: 'scale',
      layerId,
      startMs: 0,
      endMs: 1_000,
      from: { x: 0.05, y: 1 },
      to: { x: 20, y: 1 },
      easing: 'linear',
    };
    const baseExtreme = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        timelineEvents: [extremeRamp],
      })),
    });

    // Step 1: key 1000ms to 0.0025 (0ms stays neutral 1 => [0.05..5.025..0.05], valid everywhere).
    const atEnd = service.applyKeys(
      baseExtreme,
      { shotId, layerId, timeMs: 1_000 },
      { 'transform.scaleX': 0.0025 },
    );
    const snapshotBefore = structuredClone(atEnd);
    // Step 2: raise 0ms to 400. Endpoints are both legal (0ms=20, 1000ms=0.05),
    // yet intermediate 24fps frames exceed 20 (~2005 at 500ms) -> REJECT!
    expect(() =>
      service.applyKeys(
        atEnd,
        { shotId, layerId, timeMs: 0 },
        { 'transform.scaleX': 400 },
      ),
    ).toThrow(/超出合法范围/);
    expect(atEnd).toEqual(snapshotBefore);

    // Legal overlapping interval stays accepted and evaluates accurately on every frame.
    const gentleRamp: TimelineEvent = {
      id: randomUUID(),
      type: 'scale',
      layerId,
      startMs: 0,
      endMs: 1_000,
      from: { x: 0.5, y: 1 },
      to: { x: 2, y: 1 },
      easing: 'linear',
    };
    const baseGentle = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((s) => ({
        ...s,
        timelineEvents: [gentleRamp],
      })),
    });
    const gentle0 = service.applyKeys(
      baseGentle,
      { shotId, layerId, timeMs: 0 },
      { 'transform.scaleX': 2 },
    );
    const gentle1000 = service.applyKeys(
      gentle0,
      { shotId, layerId, timeMs: 1_000 },
      { 'transform.scaleX': 0.5 },
    );
    expect(
      evaluateShotAtTime(gentle1000.shots[0]!, 500, gentle1000).layers.find((l) => l.id === layerId)!.scaleX,
    ).toBeCloseTo(1.5625, 10);
  });

  it('aggregates mixed outgoing easing per real outgoing key and leaves terminal or spanning tracks untouched (#1146)', () => {
    const { project, shotId, layerId } = zeroCharacterGraphicProject();
    const service = new LayerMotionService();

    // Build:
    // - offsetX:    0 -> 500(ease-in-out) -> 1000 (outgoing at 500)
    // - rotationDeg:0 -> 500(linear)      -> 1000 (outgoing at 500 -> mixed!)
    // - scaleX:     0 -> 500 (terminal at 500!)
    // - offsetY:    0 -> 1500 (spanning 500 without a key at 500!)
    let authored = service.applyKeys(project, { shotId, layerId, timeMs: 500 }, {
      'transform.offsetX': 100,
      'transform.rotationDeg': 30,
      'transform.scaleX': 1.5,
    });
    authored = service.applyKeys(authored, { shotId, layerId, timeMs: 1_000 }, {
      'transform.offsetX': 220,
      'transform.rotationDeg': 60,
    });
    authored = service.applyKeys(authored, { shotId, layerId, timeMs: 1_500 }, {
      'transform.offsetY': 90,
    });

    const layerBefore = authored.shots[0]!.layers.find((l) => l.id === layerId)!;
    const clipBefore = layerBefore.animationClip!;
    if (clipBefore.version !== 2) throw new Error('Expected Clip v2.');
    // Author ease-in-out only on offsetX@500 while rotationDeg@500 stays linear.
    const mixedProject = ProjectSchema.parse({
      ...authored,
      shots: authored.shots.map((s) =>
        s.id === shotId
          ? {
              ...s,
              layers: s.layers.map((l) =>
                l.id === layerId
                  ? {
                      ...l,
                      animationClip: {
                        ...clipBefore,
                        tracks: clipBefore.tracks.map((track) =>
                          track.property === 'transform.offsetX'
                            ? {
                                ...track,
                                keys: track.keys.map((k) =>
                                  k.timeMs === 500
                                    ? { ...k, interpolationToNext: 'ease-in-out' as const }
                                    : k,
                                ),
                              }
                            : track,
                        ),
                      },
                    }
                  : l,
              ),
            }
          : s,
      ),
    });

    const mixedLayer = mixedProject.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(hasLayerCompositeKeyOutgoingInterval(mixedLayer, 500)).toBe(true);
    expect(layerCompositeKeyEasing(mixedLayer, 500)).toBeNull();
    // Terminal key at 1500 has zero outgoing intervals even though other keys existed.
    expect(hasLayerCompositeKeyOutgoingInterval(mixedLayer, 1_500)).toBe(false);
    expect(layerCompositeKeyEasing(mixedLayer, 1_500)).toBeNull();

    // Setting easing at 500 to 'ease-out' updates ONLY offsetX@500 and rotationDeg@500.
    // scaleX@500 is terminal (stays 'linear'); offsetY spans without a 500ms key (stays 'linear' @ 0ms).
    const unified = service.setKeyEasing(
      mixedProject,
      { shotId, layerId, timeMs: 500 },
      'ease-out',
    );
    const unifiedLayer = unified.shots[0]!.layers.find((l) => l.id === layerId)!;
    expect(layerCompositeKeyEasing(unifiedLayer, 500)).toBe('ease-out');
    if (unifiedLayer.animationClip?.version === 2) {
      const byProp = new Map(
        unifiedLayer.animationClip.tracks.map((t) => [t.property, t.keys]),
      );
      expect(byProp.get('transform.offsetX')?.find((k) => k.timeMs === 500)?.interpolationToNext).toBe('ease-out');
      expect(byProp.get('transform.rotationDeg')?.find((k) => k.timeMs === 500)?.interpolationToNext).toBe('ease-out');
      expect(byProp.get('transform.scaleX')?.find((k) => k.timeMs === 500)?.interpolationToNext).toBe('linear');
      expect(byProp.get('transform.offsetY')?.map((k) => k.timeMs)).toEqual([0, 1_500]);
      expect(byProp.get('transform.offsetY')?.find((k) => k.timeMs === 0)?.interpolationToNext).toBe('linear');
    }

    // No-op easing update returns exact project identity.
    expect(service.setKeyEasing(unified, { shotId, layerId, timeMs: 500 }, 'ease-out')).toBe(
      unified,
    );
  });

  it('duplicates an FLA Graphic layer with v2 Clip ownership, basis offset, curves, overrides, events, and independent editing', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();
    const childPath = ['face', 'face-0'];
    const childMatrix = { a: 0.35, b: 0, c: 0, d: 0.35, tx: 36, ty: 24 };

    let project = layerService.updateAnimationPlayback(
      base.project,
      base.shotId,
      base.layerId,
      { startTimeMs: 250, mode: 'loop', endBehavior: 'hide' },
    );
    project = layerService.updateFlaGraphicInstanceTransform(
      project,
      base.shotId,
      base.layerId,
      0,
      childPath,
      childMatrix,
    );
    project = service.recalibratePivot(
      project,
      { shotId: base.shotId, layerId: base.layerId },
      { space: 'target-local', x: 130, y: 110 },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 0 },
      { 'transform.offsetX': 0, 'transform.offsetY': 0 },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 500 },
      {
        'transform.offsetX': 100,
        'transform.offsetY': -40,
        'transform.rotationDeg': 45,
        'transform.scaleX': 1.5,
      },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 1_000 },
      {
        'transform.offsetX': 220,
        'transform.offsetY': 20,
        'transform.rotationDeg': 90,
        'transform.scaleX': 2,
      },
    );
    project = editAnimationPropertyKey(
      project,
      {
        shotId: base.shotId,
        target: { kind: 'layer', layerId: base.layerId },
        property: 'transform.offsetX',
        keyTimeMs: 0,
      },
      {
        interpolationToNext: 'ease-in-out',
        curveToNext: {
          bezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
          window: [0, 1],
        },
      },
    );
    const sourceEvent: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000501',
      type: 'opacity',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: 1,
      to: 0.4,
      easing: 'ease-in-out',
    };
    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === base.shotId
          ? { ...shot, timelineEvents: [...shot.timelineEvents, sourceEvent] }
          : shot,
      ),
    });

    const beforeProject = structuredClone(project);
    const beforeSource = beforeProject.shots[0]!.layers.find((l) => l.id === base.layerId)!;

    const duplicated = layerService.duplicateAnimationLayer(
      project,
      base.shotId,
      base.layerId,
    );
    const parsed = ProjectSchema.parse(duplicated.project);
    const shot = parsed.shots.find((s) => s.id === base.shotId)!;
    const sourceAfter = shot.layers.find((l) => l.id === base.layerId)!;
    const dupAfter = shot.layers.find((l) => l.id === duplicated.layer.id)!;

    expect(shot.layers).toHaveLength(beforeProject.shots[0]!.layers.length + 1);
    expect(dupAfter.id).not.toBe(base.layerId);
    expect(dupAfter.source).toEqual(beforeSource.source);
    expect(dupAfter.startTimeMs).toBe(250);
    expect(dupAfter.animationPlayback).toEqual({ mode: 'loop', endBehavior: 'hide' });
    expect(dupAfter.flaGraphicInstanceTransformOverrides).toEqual(
      beforeSource.flaGraphicInstanceTransformOverrides,
    );
    expect(dupAfter.x).toBe(beforeSource.x + 24);
    expect(dupAfter.y).toBe(beforeSource.y + 24);
    expect(dupAfter.zIndex).toBe(beforeSource.zIndex + 1);

    expect(dupAfter.animationClip?.version).toBe(2);
    if (dupAfter.animationClip?.version !== 2 || beforeSource.animationClip?.version !== 2) {
      throw new Error('Expected Layer Clip v2');
    }
    expect(dupAfter.animationClip.targetBases).toHaveLength(1);
    expect(dupAfter.animationClip.targetBases[0]!.target).toEqual({
      kind: 'layer',
      layerId: dupAfter.id,
    });
    expect(dupAfter.animationClip.targetBases[0]!.animationId).toBe(base.definitionId);
    expect(dupAfter.animationClip.targetBases[0]!.baseTransform).toEqual({
      x: beforeSource.x + 24,
      y: beforeSource.y + 24,
      scaleX: beforeSource.scaleX,
      scaleY: beforeSource.scaleY,
      rotationDeg: beforeSource.rotationDeg,
    });
    expect(dupAfter.animationClip.targetBases[0]!.pivot).toEqual(
      beforeSource.animationClip.targetBases[0]!.pivot,
    );
    expect(dupAfter.animationClip.tracks.length).toBe(beforeSource.animationClip.tracks.length);
    expect(dupAfter.animationClip.tracks.every((t) => t.target.layerId === dupAfter.id)).toBe(true);
    expect(
      dupAfter.animationClip.tracks.find((t) => t.property === 'transform.offsetX')?.keys[0],
    ).toEqual(
      beforeSource.animationClip.tracks.find((t) => t.property === 'transform.offsetX')?.keys[0],
    );

    const dupEvents = shot.timelineEvents.filter((e) => e.layerId === dupAfter.id);
    expect(dupEvents).toHaveLength(1);
    expect(dupEvents[0]!.id).not.toBe(sourceEvent.id);
    expect(shot.timelineEvents.filter((e) => e.layerId === base.layerId)).toEqual([sourceEvent]);

    expect(sourceAfter).toEqual(beforeSource);
    expect(parsed.animations).toEqual(beforeProject.animations);
    expect(parsed.assets).toEqual(beforeProject.assets);

    // Evaluate at start, middle, and end timestamps: duplicate matches source + (+24, +24) offset.
    for (const timeMs of [0, 250, 500, 1_000]) {
      const evaluated = evaluateShotAtTime(shot, timeMs, parsed);
      const evalSource = evaluated.layers.find((l) => l.id === base.layerId)!;
      const evalDup = evaluated.layers.find((l) => l.id === dupAfter.id)!;
      expect(evalDup.x).toBeCloseTo(evalSource.x + 24);
      expect(evalDup.y).toBeCloseTo(evalSource.y + 24);
      expect(evalDup.rotationDeg).toBeCloseTo(evalSource.rotationDeg);
      expect(evalDup.scaleX).toBeCloseTo(evalSource.scaleX);
      expect(evalDup.scaleY).toBeCloseTo(evalSource.scaleY);
      expect(evalDup.opacity).toBeCloseTo(evalSource.opacity);
    }

    // Independent editing: editing duplicate keyframe does not change source, and vice versa.
    const dup500Before = evaluateShotAtTime(shot, 500, parsed).layers.find(
      (l) => l.id === dupAfter.id,
    )!;
    const source500Before = evaluateShotAtTime(shot, 500, parsed).layers.find(
      (l) => l.id === base.layerId,
    )!;
    const afterDupEdit = service.applyKeys(
      parsed,
      { shotId: base.shotId, layerId: dupAfter.id, timeMs: 500 },
      { 'transform.offsetX': 300 },
    );
    expect(
      evaluateShotAtTime(afterDupEdit.shots[0]!, 500, afterDupEdit).layers.find(
        (l) => l.id === base.layerId,
      )!.x,
    ).toBeCloseTo(source500Before.x);
    expect(
      evaluateShotAtTime(afterDupEdit.shots[0]!, 500, afterDupEdit).layers.find(
        (l) => l.id === dupAfter.id,
      )!.x,
    ).toBeCloseTo(dup500Before.x + 200);

    const dup1000Before = evaluateShotAtTime(afterDupEdit.shots[0]!, 1_000, afterDupEdit).layers.find(
      (l) => l.id === dupAfter.id,
    )!;
    const source1000Before = evaluateShotAtTime(afterDupEdit.shots[0]!, 1_000, afterDupEdit).layers.find(
      (l) => l.id === base.layerId,
    )!;
    const afterSourceEdit = service.applyKeys(
      afterDupEdit,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 1_000 },
      { 'transform.offsetY': -150 },
    );
    expect(
      evaluateShotAtTime(afterSourceEdit.shots[0]!, 1_000, afterSourceEdit).layers.find(
        (l) => l.id === dupAfter.id,
      )!.y,
    ).toBeCloseTo(dup1000Before.y);
    expect(
      evaluateShotAtTime(afterSourceEdit.shots[0]!, 1_000, afterSourceEdit).layers.find(
        (l) => l.id === base.layerId,
      )!.y,
    ).toBeCloseTo(source1000Before.y - 170);

    // Boundary clamp fallback (-24, -24) syncs Clip baseTransform cleanly.
    const cornerProject = layerService.updatePosition(
      parsed,
      base.shotId,
      base.layerId,
      { x: 1920, y: 1080 },
    );
    const cornerDup = layerService.duplicateAnimationLayer(
      cornerProject,
      base.shotId,
      base.layerId,
    );
    expect(cornerDup.layer).toMatchObject({ x: 1896, y: 1056 });
    expect(
      cornerDup.layer.animationClip?.version === 2
        ? cornerDup.layer.animationClip.targetBases[0]?.baseTransform
        : null,
    ).toMatchObject({ x: 1896, y: 1056 });
    expect(
      evaluateShotAtTime(cornerDup.project.shots[0]!, 0, cornerDup.project).layers.find(
        (l) => l.id === cornerDup.layer.id,
      ),
    ).toMatchObject({ x: 1896, y: 1056 });

    // Locked source layer fails without mutating project.
    const lockedProject = layerService.setLocked(parsed, base.shotId, base.layerId, true);
    expect(() =>
      layerService.duplicateAnimationLayer(lockedProject, base.shotId, base.layerId),
    ).toThrow(expect.objectContaining({ code: 'LAYER_LOCKED' }));
  });

  it('translates duplicated MoveEvents by the actual Base delta, preserves editable/playback-only PositionChain semantics, and handles canvas-edge clamps (#1266 P2-01)', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();
    const positionService = new PositionProjectService();

    // Build an editable 2-segment Move chain starting from Base (400, 300) + v2 Clip + Shake + Scale + Opacity.
    const move1: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000601',
      type: 'move',
      layerId: base.layerId,
      startMs: 0,
      endMs: 500,
      from: { x: 400, y: 300 },
      to: { x: 600, y: 380 },
      easing: 'linear',
    };
    const move2: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000602',
      type: 'move',
      layerId: base.layerId,
      startMs: 500,
      endMs: 1_000,
      from: { x: 600, y: 380 },
      to: { x: 700, y: 420 },
      easing: 'linear',
    };
    const shakeEvent: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000603',
      type: 'shake',
      layerId: base.layerId,
      startMs: 0,
      endMs: 1_000,
      amplitudeX: 16,
      amplitudeY: 8,
      frequencyHz: 0.5,
    };
    const opacityEvent: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000604',
      type: 'opacity',
      layerId: base.layerId,
      startMs: 0,
      endMs: 1_000,
      from: 1,
      to: 0.5,
      easing: 'linear',
    };
    let project = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((shot) =>
        shot.id === base.shotId
          ? {
              ...shot,
              durationMs: 2_000,
              timelineEvents: [move1, move2, shakeEvent, opacityEvent],
            }
          : shot,
      ),
    });
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 0 },
      { 'transform.offsetX': 0, 'transform.offsetY': 0 },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 500 },
      {
        'transform.offsetX': 40,
        'transform.offsetY': -20,
        'transform.rotationDeg': 30,
        'transform.scaleX': 1.5,
      },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 1_000 },
      {
        'transform.offsetX': 80,
        'transform.offsetY': 10,
        'transform.rotationDeg': 60,
        'transform.scaleX': 2,
      },
    );

    const beforeProject = structuredClone(project);
    expect(
      recognizePositionChain({
        shot: project.shots[0]!,
        layer: project.shots[0]!.layers.find((l) => l.id === base.layerId)!,
      }).status,
    ).toBe('editable');

    const duplicated = layerService.duplicateAnimationLayer(
      project,
      base.shotId,
      base.layerId,
    );
    const shot = duplicated.project.shots[0]!;
    const srcLayer = shot.layers.find((l) => l.id === base.layerId)!;
    const dupLayer = shot.layers.find((l) => l.id === duplicated.layer.id)!;

    // Source layer, source Clip, and source events remain untouched.
    expect(srcLayer).toEqual(beforeProject.shots[0]!.layers.find((l) => l.id === base.layerId)!);
    expect(shot.timelineEvents.filter((e) => e.layerId === base.layerId)).toEqual(
      beforeProject.shots[0]!.timelineEvents,
    );

    // Duplicated MoveEvents shifted by actual Base delta (+24, +24); Shake/Opacity semantics preserved.
    const dupMoves = shot.timelineEvents
      .filter((e): e is Extract<TimelineEvent, { type: 'move' }> => e.layerId === dupLayer.id && e.type === 'move')
      .sort((a, b) => a.startMs - b.startMs);
    expect(dupMoves).toHaveLength(2);
    expect(dupMoves[0]).toMatchObject({
      startMs: 0,
      endMs: 500,
      from: { x: 424, y: 324 },
      to: { x: 624, y: 404 },
      easing: 'linear',
    });
    expect(dupMoves[1]).toMatchObject({
      startMs: 500,
      endMs: 1_000,
      from: { x: 624, y: 404 },
      to: { x: 724, y: 444 },
      easing: 'linear',
    });

    // Evaluate at start, middle, end, and post-end hold: duplicate stays offset by (+24, +24).
    for (const timeMs of [0, 250, 500, 1_000, 1_500]) {
      const evaluated = evaluateShotAtTime(shot, timeMs, duplicated.project);
      const evalSrc = evaluated.layers.find((l) => l.id === base.layerId)!;
      const evalDup = evaluated.layers.find((l) => l.id === dupLayer.id)!;
      expect(evalDup.x).toBeCloseTo(evalSrc.x + 24);
      expect(evalDup.y).toBeCloseTo(evalSrc.y + 24);
      expect(evalDup.rotationDeg).toBeCloseTo(evalSrc.rotationDeg);
      expect(evalDup.scaleX).toBeCloseTo(evalSrc.scaleX);
      expect(evalDup.scaleY).toBeCloseTo(evalSrc.scaleY);
      expect(evalDup.opacity).toBeCloseTo(evalSrc.opacity);
    }

    // Duplicated PositionChain remains editable (no base-mismatch) and edits independently.
    expect(recognizePositionChain({ shot, layer: dupLayer }).status).toBe('editable');
    const editedDupChain = positionService.applyOperation(
      duplicated.project,
      base.shotId,
      dupLayer.id,
      { type: 'update', input: { timeMs: 500, position: { x: 800, y: 500 } } },
    ).project;
    expect(
      editedDupChain.shots[0]!.timelineEvents.filter((e) => e.layerId === base.layerId),
    ).toEqual(beforeProject.shots[0]!.timelineEvents);
    expect(
      editedDupChain.shots[0]!.timelineEvents.find(
        (e) => e.layerId === dupLayer.id && e.type === 'move' && e.startMs === 0,
      ),
    ).toMatchObject({ to: { x: 800, y: 500 } });

    // Single-axis edge clamp: (1910, 300) -> (1920, 324), actual delta = (+10, +24).
    const edgeProject = layerService.updatePosition(
      project,
      base.shotId,
      base.layerId,
      { x: 1910, y: 300 },
    );
    const edgeDup = layerService.duplicateAnimationLayer(
      edgeProject,
      base.shotId,
      base.layerId,
    );
    expect(edgeDup.layer).toMatchObject({ x: 1920, y: 324 });
    const edgeDupMoves = edgeDup.project.shots[0]!.timelineEvents
      .filter((e): e is Extract<TimelineEvent, { type: 'move' }> => e.layerId === edgeDup.layer.id && e.type === 'move')
      .sort((a, b) => a.startMs - b.startMs);
    expect(edgeDupMoves[0]).toMatchObject({
      from: { x: 1920, y: 324 },
      to: { x: 610, y: 404 },
    });
    expect(edgeDupMoves[1]).toMatchObject({
      from: { x: 610, y: 404 },
      to: { x: 710, y: 444 },
    });
    expect(
      recognizePositionChain({
        shot: edgeDup.project.shots[0]!,
        layer: edgeDup.layer,
      }).status,
    ).toBe('editable');
    for (const timeMs of [0, 500, 1_500]) {
      const evaluated = evaluateShotAtTime(edgeDup.project.shots[0]!, timeMs, edgeDup.project);
      const evalSrc = evaluated.layers.find((l) => l.id === base.layerId)!;
      const evalDup = evaluated.layers.find((l) => l.id === edgeDup.layer.id)!;
      expect(evalDup.x).toBeCloseTo(evalSrc.x + 10);
      expect(evalDup.y).toBeCloseTo(evalSrc.y + 24);
    }

    // Playback-only MoveEvent (non-linear easing, startMs > 0) stays playback-only while still translating by delta.
    const playbackOnlyMove: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000605',
      type: 'move',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: { x: 300, y: 200 },
      to: { x: 500, y: 350 },
      easing: 'ease-in-out',
    };
    const playbackOnlyProject = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) =>
        s.id === base.shotId ? { ...s, timelineEvents: [playbackOnlyMove] } : s,
      ),
    });
    const playbackOnlyDup = layerService.duplicateAnimationLayer(
      playbackOnlyProject,
      base.shotId,
      base.layerId,
    );
    expect(
      recognizePositionChain({
        shot: playbackOnlyDup.project.shots[0]!,
        layer: playbackOnlyDup.layer,
      }).status,
    ).toBe('playback-only');
    expect(
      playbackOnlyDup.project.shots[0]!.timelineEvents.find(
        (e) => e.layerId === playbackOnlyDup.layer.id && e.type === 'move',
      ),
    ).toMatchObject({
      startMs: 250,
      endMs: 750,
      from: { x: 324, y: 224 },
      to: { x: 524, y: 374 },
      easing: 'ease-in-out',
    });
  });

  it('preserves same-startMs event tie-break priority for Opacity and Move events even when createId emits descending IDs (#1266 P2-02)', () => {
    const base = zeroCharacterGraphicProject();
    const opacityLow: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000001',
      type: 'opacity',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: 1,
      to: 0.2,
      easing: 'linear',
    };
    const opacityHigh: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000002',
      type: 'opacity',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: 1,
      to: 0.85,
      easing: 'linear',
    };
    const moveFirst: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000003',
      type: 'move',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: { x: 400, y: 300 },
      to: { x: 500, y: 320 },
      easing: 'linear',
    };
    const moveSecond: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000004',
      type: 'move',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: { x: 400, y: 300 },
      to: { x: 760, y: 460 },
      easing: 'linear',
    };
    const project = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((shot) =>
        shot.id === base.shotId
          ? { ...shot, timelineEvents: [opacityLow, opacityHigh, moveFirst, moveSecond] }
          : shot,
      ),
    });

    // Inject descending IDs so naive sequential allocation reverses localeCompare order.
    const generatedIds = [
      'f3000000-0000-4000-8000-000000000099', // duplicate layer ID
      'f3000000-0000-4000-8000-000000000009',
      'f3000000-0000-4000-8000-000000000008',
      'f3000000-0000-4000-8000-000000000007',
      'f3000000-0000-4000-8000-000000000006',
    ];
    let index = 0;
    const layerService = new LayerService({
      createId: () => generatedIds[index++]!,
    });

    const duplicated = layerService.duplicateAnimationLayer(
      project,
      base.shotId,
      base.layerId,
    );
    const shot = duplicated.project.shots[0]!;
    const dupEvents = shot.timelineEvents.filter((e) => e.layerId === duplicated.layer.id);
    expect(dupEvents).toHaveLength(4);
    expect(new Set(dupEvents.map((e) => e.id)).size).toBe(4);
    for (const dupEvent of dupEvents) {
      expect([opacityLow.id, opacityHigh.id, moveFirst.id, moveSecond.id]).not.toContain(
        dupEvent.id,
      );
    }

    for (const timeMs of [500, 750, 1_000]) {
      const evaluated = evaluateShotAtTime(shot, timeMs, duplicated.project);
      const evalSrc = evaluated.layers.find((l) => l.id === base.layerId)!;
      const evalDup = evaluated.layers.find((l) => l.id === duplicated.layer.id)!;
      expect(evalDup.opacity).toBeCloseTo(evalSrc.opacity);
      expect(evalDup.x).toBeCloseTo(evalSrc.x + 24);
      expect(evalDup.y).toBeCloseTo(evalSrc.y + 24);
    }
  });

  it('generates a 3x4 editable rectangular grid array preserving Clip, MoveEvent, same-startMs priority, single-axis layouts, 1x1 no-op, boundaries, and 100-instance scale (#1268 A01)', () => {
    const base = zeroCharacterGraphicProject();
    const positionService = new PositionProjectService();
    const childPath = ['face', 'face-0'];
    const childMatrix = { a: 0.3, b: 0, c: 0, d: 0.3, tx: 24, ty: 18 };
    const defaultService = new LayerService();

    let project = defaultService.updateAnimationPlayback(
      base.project,
      base.shotId,
      base.layerId,
      { startTimeMs: 125, mode: 'loop', endBehavior: 'hide' },
    );
    project = defaultService.updateFlaGraphicInstanceTransform(
      project,
      base.shotId,
      base.layerId,
      0,
      childPath,
      childMatrix,
    );
    project = service.recalibratePivot(
      project,
      { shotId: base.shotId, layerId: base.layerId },
      { space: 'target-local', x: 125, y: 105 },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 0 },
      { 'transform.offsetX': 0, 'transform.offsetY': 0 },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 500 },
      { 'transform.offsetX': 40, 'transform.offsetY': -20, 'transform.rotationDeg': 30, 'transform.scaleX': 1.5 },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 1_000 },
      { 'transform.offsetX': 80, 'transform.offsetY': 10, 'transform.rotationDeg': 60, 'transform.scaleX': 2 },
    );
    project = editAnimationPropertyKey(
      project,
      {
        shotId: base.shotId,
        target: { kind: 'layer', layerId: base.layerId },
        property: 'transform.offsetX',
        keyTimeMs: 0,
      },
      {
        interpolationToNext: 'ease-in-out',
        curveToNext: {
          bezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
          window: [0, 1],
        },
      },
    );
    const moveEvent: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000801',
      type: 'move',
      layerId: base.layerId,
      startMs: 0,
      endMs: 1_000,
      from: { x: 400, y: 300 },
      to: { x: 520, y: 360 },
      easing: 'linear',
    };
    const opacityLow: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000802',
      type: 'opacity',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: 1,
      to: 0.2,
      easing: 'linear',
    };
    const opacityHigh: TimelineEvent = {
      id: '93000000-0000-4000-8000-000000000803',
      type: 'opacity',
      layerId: base.layerId,
      startMs: 250,
      endMs: 750,
      from: 1,
      to: 0.85,
      easing: 'linear',
    };
    project = ProjectSchema.parse({
      ...project,
      shots: project.shots.map((shot) =>
        shot.id === base.shotId
          ? { ...shot, durationMs: 2_000, timelineEvents: [moveEvent, opacityLow, opacityHigh] }
          : shot,
      ),
    });

    const beforeProject = structuredClone(project);
    const beforeSource = beforeProject.shots[0]!.layers.find((l) => l.id === base.layerId)!;

    // Descending ID generator verifies same-startMs event priority across every grid replica.
    let seq = 999_999;
    const gridService = new LayerService({
      createId: () => `f3000000-0000-4000-8000-${String(seq--).padStart(12, '0')}`,
    });

    const grid = gridService.duplicateAnimationLayerGrid(
      project,
      base.shotId,
      base.layerId,
      { rows: 3, cols: 4, spacingX: 100, spacingY: 80 },
    );
    const parsed = ProjectSchema.parse(grid.project);
    const shot = parsed.shots[0]!;
    expect(grid.layers).toHaveLength(11);
    expect(shot.layers).toHaveLength(beforeProject.shots[0]!.layers.length + 11);
    expect(parsed.animations).toEqual(beforeProject.animations);
    expect(parsed.assets).toEqual(beforeProject.assets);
    expect(shot.layers.find((l) => l.id === base.layerId)).toEqual(beforeSource);
    expect(shot.timelineEvents.filter((e) => e.layerId === base.layerId)).toEqual(
      beforeProject.shots[0]!.timelineEvents,
    );

    // Verify all 12 anchor coordinates in row-major order and monotonic zIndex.
    const expectedGridPoints: { x: number; y: number }[] = [];
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        if (r === 0 && c === 0) continue;
        expectedGridPoints.push({ x: 400 + c * 100, y: 300 + r * 80 });
      }
    }
    expect(grid.layers.map((l) => ({ x: l.x, y: l.y }))).toEqual(expectedGridPoints);
    expect(new Set([base.layerId, ...grid.layers.map((l) => l.id)]).size).toBe(12);
    expect(grid.layers.map((l) => l.zIndex)).toEqual(
      Array.from({ length: 11 }, (_, idx) => beforeSource.zIndex + 1 + idx),
    );

    // Every replica owns its own v2 Clip, events, and preserves overrides/playback/pivot/curves.
    const allEventIds = shot.timelineEvents.map((e) => e.id);
    expect(new Set(allEventIds).size).toBe(allEventIds.length);
    for (const replica of grid.layers) {
      expect(replica.source).toEqual(beforeSource.source);
      expect(replica.startTimeMs).toBe(125);
      expect(replica.animationPlayback).toEqual({ mode: 'loop', endBehavior: 'hide' });
      expect(replica.flaGraphicInstanceTransformOverrides).toEqual(
        beforeSource.flaGraphicInstanceTransformOverrides,
      );
      expect(replica.animationClip?.version).toBe(2);
      if (replica.animationClip?.version !== 2 || beforeSource.animationClip?.version !== 2) {
        throw new Error('Expected v2 Clip');
      }
      expect(replica.animationClip.targetBases[0]!.target.layerId).toBe(replica.id);
      expect(replica.animationClip.targetBases[0]!.baseTransform).toMatchObject({
        x: replica.x,
        y: replica.y,
      });
      expect(replica.animationClip.targetBases[0]!.pivot).toEqual(
        beforeSource.animationClip.targetBases[0]!.pivot,
      );
      expect(replica.animationClip.tracks.every((t) => t.target.layerId === replica.id)).toBe(true);
      expect(replica.animationClip.tracks.length).toBe(beforeSource.animationClip.tracks.length);
      expect(recognizePositionChain({ shot, layer: replica }).status).toBe('editable');
    }

    // Evaluate two distinct grid positions: (r=0, c=3) -> (+300, 0) and (r=2, c=2) -> (+200, +160).
    const cellTopRight = grid.layers[2]!; // (700, 300)
    const cellBottomMid = grid.layers[9]!; // (600, 460)
    for (const timeMs of [0, 500, 1_000, 1_500]) {
      const evaluated = evaluateShotAtTime(shot, timeMs, parsed);
      const evalSrc = evaluated.layers.find((l) => l.id === base.layerId)!;
      const evalTR = evaluated.layers.find((l) => l.id === cellTopRight.id)!;
      const evalBM = evaluated.layers.find((l) => l.id === cellBottomMid.id)!;
      expect(evalTR.x).toBeCloseTo(evalSrc.x + 300);
      expect(evalTR.y).toBeCloseTo(evalSrc.y);
      expect(evalTR.rotationDeg).toBeCloseTo(evalSrc.rotationDeg);
      expect(evalTR.scaleX).toBeCloseTo(evalSrc.scaleX);
      expect(evalTR.opacity).toBeCloseTo(evalSrc.opacity);

      expect(evalBM.x).toBeCloseTo(evalSrc.x + 200);
      expect(evalBM.y).toBeCloseTo(evalSrc.y + 160);
      expect(evalBM.rotationDeg).toBeCloseTo(evalSrc.rotationDeg);
      expect(evalBM.scaleX).toBeCloseTo(evalSrc.scaleX);
      expect(evalBM.opacity).toBeCloseTo(evalSrc.opacity);
    }

    // Independent editing: edit keyframe, edit editable PositionChain, and delete one replica.
    const editedKey = service.applyKeys(
      parsed,
      { shotId: base.shotId, layerId: cellTopRight.id, timeMs: 500 },
      { 'transform.offsetX': 240 },
    );
    expect(
      evaluateShotAtTime(editedKey.shots[0]!, 500, editedKey).layers.find((l) => l.id === base.layerId)!.x,
    ).toBeCloseTo(
      evaluateShotAtTime(shot, 500, parsed).layers.find((l) => l.id === base.layerId)!.x,
    );
    const editedChain = positionService.applyOperation(
      editedKey,
      base.shotId,
      cellBottomMid.id,
      { type: 'update', input: { timeMs: 1_000, position: { x: 900, y: 600 } } },
    ).project;
    expect(
      editedChain.shots[0]!.timelineEvents.filter((e) => e.layerId === base.layerId),
    ).toEqual(beforeProject.shots[0]!.timelineEvents);
    const afterDelete = defaultService.deleteLayer(editedChain, base.shotId, cellTopRight.id);
    expect(afterDelete.shots[0]!.layers.some((l) => l.id === cellTopRight.id)).toBe(false);
    expect(afterDelete.shots[0]!.layers.some((l) => l.id === base.layerId)).toBe(true);
    expect(afterDelete.shots[0]!.layers.some((l) => l.id === cellBottomMid.id)).toBe(true);

    // 1x1 is a no-op returning exact project reference.
    const noop = defaultService.duplicateAnimationLayerGrid(
      project,
      base.shotId,
      base.layerId,
      { rows: 1, cols: 1, spacingX: 0, spacingY: 0 },
    );
    expect(noop.project).toBe(project);
    expect(noop.layers).toEqual([]);

    // Single-row (1x4) ignores spacingY; single-column (3x1) ignores spacingX.
    const singleRow = defaultService.duplicateAnimationLayerGrid(
      base.project,
      base.shotId,
      base.layerId,
      { rows: 1, cols: 4, spacingX: 100, spacingY: Number.NaN },
    );
    expect(singleRow.layers.map((l) => ({ x: l.x, y: l.y }))).toEqual([
      { x: 500, y: 300 },
      { x: 600, y: 300 },
      { x: 700, y: 300 },
    ]);
    const singleCol = defaultService.duplicateAnimationLayerGrid(
      base.project,
      base.shotId,
      base.layerId,
      { rows: 3, cols: 1, spacingX: 0, spacingY: 80 },
    );
    expect(singleCol.layers.map((l) => ({ x: l.x, y: l.y }))).toEqual([
      { x: 400, y: 380 },
      { x: 400, y: 460 },
    ]);

    // Exact legal canvas edge (1920, 1080) succeeds; 1px over rejects without clamping.
    const edgeOkSource = defaultService.updatePosition(
      base.project,
      base.shotId,
      base.layerId,
      { x: 1720, y: 920 },
    );
    const edgeOk = defaultService.duplicateAnimationLayerGrid(
      edgeOkSource,
      base.shotId,
      base.layerId,
      { rows: 3, cols: 3, spacingX: 100, spacingY: 80 },
    );
    expect(edgeOk.layers.at(-1)).toMatchObject({ x: 1920, y: 1080 });

    const edgeOverSource = defaultService.updatePosition(
      base.project,
      base.shotId,
      base.layerId,
      { x: 1721, y: 920 },
    );
    expect(() =>
      defaultService.duplicateAnimationLayerGrid(
        edgeOverSource,
        base.shotId,
        base.layerId,
        { rows: 3, cols: 3, spacingX: 100, spacingY: 80 },
      ),
    ).toThrow(expect.objectContaining({ code: 'INVALID_POSITION' }));

    // Invalid parameters, count > 100, locked source, and non-Graphic animation layer are rejected.
    expect(() =>
      defaultService.duplicateAnimationLayerGrid(base.project, base.shotId, base.layerId, {
        rows: 1.5,
        cols: 2,
        spacingX: 100,
        spacingY: 80,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_GRID_ARRAY' }));
    expect(() =>
      defaultService.duplicateAnimationLayerGrid(base.project, base.shotId, base.layerId, {
        rows: 10,
        cols: 11,
        spacingX: 10,
        spacingY: 10,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_GRID_ARRAY' }));
    expect(() =>
      defaultService.duplicateAnimationLayerGrid(base.project, base.shotId, base.layerId, {
        rows: 2,
        cols: 2,
        spacingX: 0,
        spacingY: 80,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_GRID_ARRAY' }));
    const locked = defaultService.setLocked(base.project, base.shotId, base.layerId, true);
    expect(() =>
      defaultService.duplicateAnimationLayerGrid(locked, base.shotId, base.layerId, {
        rows: 2,
        cols: 2,
        spacingX: 100,
        spacingY: 80,
      }),
    ).toThrow(expect.objectContaining({ code: 'LAYER_LOCKED' }));

    const rasterProject = buildProjectWithAnimation();
    const rasterPlaced = defaultService.createFromAnimation(rasterProject, IDS.shot, {
      animationId: IDS.animation,
      position: { x: 400, y: 300 },
      startTimeMs: 0,
    });
    expect(() =>
      defaultService.duplicateAnimationLayerGrid(
        rasterPlaced.project,
        IDS.shot,
        rasterPlaced.layer.id,
        { rows: 2, cols: 2, spacingX: 100, spacingY: 80 },
      ),
    ).toThrow(expect.objectContaining({ code: 'FLA_GRAPHIC_REQUIRED' }));

    // Max scale (10x10 = 100 total, 99 added) completes cleanly in one commit.
    const maxScaleSource = defaultService.updatePosition(
      base.project,
      base.shotId,
      base.layerId,
      { x: 100, y: 100 },
    );
    const maxScale = defaultService.duplicateAnimationLayerGrid(
      maxScaleSource,
      base.shotId,
      base.layerId,
      { rows: 10, cols: 10, spacingX: 100, spacingY: 80 },
    );
    expect(maxScale.layers).toHaveLength(99);
    expect(() => ProjectSchema.parse(maxScale.project)).not.toThrow();
  });

  it('samples cubic Bézier paths by arc-length independently verified against fine reference integration (#1269 A02 math)', () => {
    // Independent fine polygonal arc-length reference (N = 20,000, not sharing the sampler's LUT).
    function referenceArcProfile(curve: CubicBezier2D, samples = 20_000) {
      const cum = new Float64Array(samples + 1);
      let prev = evaluateCubicBezier2D(curve, 0);
      for (let i = 1; i <= samples; i += 1) {
        const pt = evaluateCubicBezier2D(curve, i / samples);
        cum[i] = cum[i - 1]! + Math.hypot(pt.x - prev.x, pt.y - prev.y);
        prev = pt;
      }
      const total = cum[samples]!;
      const arcAtPoint = (target: { x: number; y: number }, minIdx: number) => {
        let bestIdx = minIdx;
        let bestDist = Infinity;
        for (let i = minIdx; i <= samples; i += 1) {
          const pt = evaluateCubicBezier2D(curve, i / samples);
          const d = Math.hypot(pt.x - target.x, pt.y - target.y);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        return { idx: bestIdx, arc: cum[bestIdx]!, dist: bestDist };
      };
      return { total, arcAtPoint };
    }

    // 1. Standard arch: P0=(400,300), P1=(450,80), P2=(850,80), P3=(900,300), 24 intervals (25 samples).
    const arch: CubicBezier2D = {
      p0: { x: 400, y: 300 },
      p1: { x: 450, y: 80 },
      p2: { x: 850, y: 80 },
      p3: { x: 900, y: 300 },
    };
    const archRef = referenceArcProfile(arch);
    const archConst = sampleCubicBezierBySteps(arch, 24, 'constant');
    expect(archConst.points).toHaveLength(25);
    expect(archConst.points[0]).toEqual(arch.p0);
    expect(archConst.points[24]).toEqual(arch.p3);
    const targetStep = archRef.total / 24;
    const tol = Math.max(0.5, targetStep * 0.02);
    let cursor = 0;
    let prevArc = 0;
    for (let i = 1; i <= 24; i += 1) {
      const hit = archRef.arcAtPoint(archConst.points[i]!, cursor);
      expect(hit.dist).toBeLessThan(0.1);
      const stepArc = hit.arc - prevArc;
      expect(Math.abs(stepArc - targetStep)).toBeLessThanOrEqual(tol);
      cursor = hit.idx;
      prevArc = hit.arc;
    }

    // 2. Non-uniformly parameterized straight line (proves not uniform t!).
    const skewedLine: CubicBezier2D = {
      p0: { x: 200, y: 300 },
      p1: { x: 201, y: 300 },
      p2: { x: 202, y: 300 },
      p3: { x: 1000, y: 300 },
    };
    const lineConst = sampleCubicBezierBySteps(skewedLine, 24, 'constant');
    for (let i = 0; i <= 24; i += 1) {
      expect(lineConst.points[i]!.x).toBeCloseTo(200 + (800 * i) / 24, 3);
      expect(lineConst.points[i]!.y).toBeCloseTo(300, 3);
    }

    // 3. Closed non-zero-length loop is accepted and sampled evenly along its perimeter.
    const loop: CubicBezier2D = {
      p0: { x: 500, y: 500 },
      p1: { x: 200, y: 100 },
      p2: { x: 800, y: 100 },
      p3: { x: 500, y: 500 },
    };
    const loopRef = referenceArcProfile(loop);
    const loopConst = sampleCubicBezierBySteps(loop, 24, 'constant');
    expect(loopConst.totalLength).toBeCloseTo(loopRef.total, 1);
    expect(loopConst.points[0]).toEqual(loop.p0);
    expect(loopConst.points[24]).toEqual(loop.p3);

    // 4. Ease-in-out mode: same endpoints, strictly monotonic arc progress, clear accel/decel.
    const archEase = sampleCubicBezierBySteps(arch, 24, 'ease-in-out');
    expect(archEase.points[0]).toEqual(arch.p0);
    expect(archEase.points[24]).toEqual(arch.p3);
    const easeSteps: number[] = [];
    cursor = 0;
    prevArc = 0;
    for (let i = 1; i <= 24; i += 1) {
      const hit = archRef.arcAtPoint(archEase.points[i]!, cursor);
      expect(hit.arc).toBeGreaterThan(prevArc);
      easeSteps.push(hit.arc - prevArc);
      cursor = hit.idx;
      prevArc = hit.arc;
    }
    expect(easeSteps[11]!).toBeGreaterThan(easeSteps[0]! * 3);
    expect(easeSteps[12]!).toBeGreaterThan(easeSteps[23]! * 3);
  });

  it('bakes single-segment cubic Bézier into native v2 offsetX/Y tracks with pivot/flipX/rotation/scale compensation, boundaries, conflicts, and editability (#1269 A02)', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();

    // Setup non-zero Base, flipX, non-default pivot, existing rotation/scale tracks, and non-conflicting opacity event.
    let project = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((shot) => ({
        ...shot,
        durationMs: 2_000,
        layers: shot.layers.map((l) =>
          l.id === base.layerId
            ? { ...l, x: 500, y: 400, scaleX: 1.5, scaleY: 1.2, rotationDeg: 20, flipX: true }
            : l,
        ),
        timelineEvents: [
          {
            id: '93000000-0000-4000-8000-000000000881',
            type: 'opacity',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            from: 1,
            to: 0.6,
            easing: 'linear',
          },
        ],
      })),
    });
    project = service.recalibratePivot(
      project,
      { shotId: base.shotId, layerId: base.layerId },
      { space: 'target-local', x: 140, y: 110 },
    );
    project = service.applyKeys(
      project,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 1_000 },
      { 'transform.rotationDeg': 70, 'transform.scaleX': 1.4 },
    );

    const beforeProject = structuredClone(project);
    const p0AtStart = evaluateShotAtTime(project.shots[0]!, 0, project).layers.find(
      (l) => l.id === base.layerId,
    )!;
    const p1 = { x: 450, y: 80 };
    const p2 = { x: 850, y: 80 };
    const p3 = { x: 900, y: 300 };

    const baked = service.applyCurveMotion(project, {
      shotId: base.shotId,
      layerId: base.layerId,
      startFrame: 0,
      endFrame: 24,
      p1,
      p2,
      p3,
      speedMode: 'constant',
    });
    const bakedShot = baked.shots[0]!;
    const bakedLayer = bakedShot.layers.find((l) => l.id === base.layerId)!;
    expect(baked.animations).toEqual(beforeProject.animations);
    expect(baked.assets).toEqual(beforeProject.assets);
    expect(bakedShot.layers).toHaveLength(beforeProject.shots[0]!.layers.length);
    expect(bakedShot.timelineEvents).toEqual(beforeProject.shots[0]!.timelineEvents);
    expect({
      x: bakedLayer.x,
      y: bakedLayer.y,
      scaleX: bakedLayer.scaleX,
      scaleY: bakedLayer.scaleY,
      rotationDeg: bakedLayer.rotationDeg,
      flipX: bakedLayer.flipX,
    }).toEqual({ x: 500, y: 400, scaleX: 1.5, scaleY: 1.2, rotationDeg: 20, flipX: true });

    if (bakedLayer.animationClip?.version !== 2) throw new Error('Expected v2 Clip');
    const offsetXTrack = bakedLayer.animationClip.tracks.find((t) => t.property === 'transform.offsetX')!;
    const offsetYTrack = bakedLayer.animationClip.tracks.find((t) => t.property === 'transform.offsetY')!;
    expect(offsetXTrack.target).toEqual({ kind: 'layer', layerId: base.layerId });
    expect(offsetYTrack.target).toEqual({ kind: 'layer', layerId: base.layerId });
    expect(offsetXTrack.keys).toHaveLength(25);
    expect(offsetYTrack.keys).toHaveLength(25);
    expect(offsetXTrack.keys.every((k) => isValidFrameTime(k.timeMs) && k.interpolationToNext === 'linear')).toBe(true);
    expect(offsetYTrack.keys.every((k) => isValidFrameTime(k.timeMs) && k.interpolationToNext === 'linear')).toBe(true);
    // Preserved existing rotation & scale tracks.
    expect(bakedLayer.animationClip.tracks.some((t) => t.property === 'transform.rotationDeg')).toBe(true);
    expect(bakedLayer.animationClip.tracks.some((t) => t.property === 'transform.scaleX')).toBe(true);

    const expectedSamples = sampleCubicBezierBySteps(
      { p0: { x: p0AtStart.x, y: p0AtStart.y }, p1, p2, p3 },
      24,
      'constant',
    ).points;
    for (const frame of [0, 1, 6, 12, 18, 24]) {
      const ev = evaluateShotAtTime(bakedShot, frameTimeMs(frame), baked).layers.find(
        (l) => l.id === base.layerId,
      )!;
      expect(Math.abs(ev.x - expectedSamples[frame]!.x)).toBeLessThan(0.1);
      expect(Math.abs(ev.y - expectedSamples[frame]!.y)).toBeLessThan(0.1);
    }

    // Replacement boundaries fall between the only two surviving authored position keys.
    const sparse = ProjectSchema.parse({
      ...baked,
      shots: baked.shots.map((shot) => ({
        ...shot,
        layers: shot.layers.map((layer) => layer.id === base.layerId && layer.animationClip ? {
          ...layer,
          animationClip: {
            ...layer.animationClip,
            tracks: layer.animationClip.tracks.map((track) =>
              track.property === 'transform.offsetX' || track.property === 'transform.offsetY'
                ? { ...track, keys: [
                    { ...track.keys[0]!, interpolationToNext: 'ease-in-out' },
                    track.keys.at(-1)!,
                  ] } : track),
          },
        } : layer),
      })),
    });
    const replacement = service.applyCurveMotion(sparse, {
      shotId: base.shotId, layerId: base.layerId, startFrame: 5, endFrame: 19,
      p1: { x: 620, y: 650 }, p2: { x: 720, y: 700 }, p3: { x: 200, y: 100 },
      speedMode: 'constant', replacePosition: true,
    });
    const poseAt = (state: Project, frame: number) => evaluateShotAtTime(state.shots[0]!, frameTimeMs(frame), state)
      .layers.find(({ id }) => id === base.layerId)!;
    for (const frame of [0, 1, 4, 5, 19, 20, 23, 24]) {
      expect(poseAt(replacement, frame).x).toBeCloseTo(poseAt(sparse, frame).x, 6);
      expect(poseAt(replacement, frame).y).toBeCloseTo(poseAt(sparse, frame).y, 6);
    }
    expect(poseAt(replacement, 12).y).toBeGreaterThan(poseAt(sparse, 12).y + 100);
    expect(poseAt(replacement, 12).rotationDeg).toBe(poseAt(sparse, 12).rotationDeg);
    expect(replacement.shots[0]!.timelineEvents).toEqual(sparse.shots[0]!.timelineEvents);
    expect(replacement.shots[0]!.layers.find(({ id }) => id === base.layerId)!.animationClip!.tracks
      .filter(({ property }) => property === 'transform.offsetX' || property === 'transform.offsetY')
      .every(({ keys }) => keys[0]!.timeMs === 0 && keys.every(({ timeMs }) => isValidFrameTime(timeMs)))).toBe(true);

    // Native editing: manual edit on generated key updates evaluation cleanly.
    const handEdited = service.applyKeys(
      baked,
      { shotId: base.shotId, layerId: base.layerId, timeMs: frameTimeMs(12) },
      { 'transform.offsetX': 0 },
    );
    expect(
      evaluateShotAtTime(handEdited.shots[0]!, frameTimeMs(12), handEdited).layers.find(
        (l) => l.id === base.layerId,
      )!.x,
    ).not.toBeCloseTo(expectedSamples[12]!.x);

    // Non-zero start frame (6..18): neutral before frame 6, exact P0/P3, holds final offset after frame 18.
    const delayed = service.applyCurveMotion(base.project, {
      shotId: base.shotId,
      layerId: base.layerId,
      startFrame: 6,
      endFrame: 18,
      p1: { x: 450, y: 120 },
      p2: { x: 750, y: 120 },
      p3: { x: 800, y: 300 },
      speedMode: 'constant',
    });
    const delayedShot = delayed.shots[0]!;
    expect(evaluateShotAtTime(delayedShot, 0, delayed).layers.find((l) => l.id === base.layerId)).toMatchObject({
      x: 400,
      y: 300,
    });
    expect(evaluateShotAtTime(delayedShot, frameTimeMs(3), delayed).layers.find((l) => l.id === base.layerId)).toMatchObject({
      x: 400,
      y: 300,
    });
    expect(evaluateShotAtTime(delayedShot, frameTimeMs(6), delayed).layers.find((l) => l.id === base.layerId)).toMatchObject({
      x: 400,
      y: 300,
    });
    const atEnd = evaluateShotAtTime(delayedShot, frameTimeMs(18), delayed).layers.find((l) => l.id === base.layerId)!;
    expect(atEnd.x).toBeCloseTo(800, 3);
    expect(atEnd.y).toBeCloseTo(300, 3);
    const afterEnd = evaluateShotAtTime(delayedShot, 1_500, delayed).layers.find((l) => l.id === base.layerId)!;
    expect(afterEnd.x).toBeCloseTo(800, 3);
    expect(afterEnd.y).toBeCloseTo(300, 3);

    // 1-frame span and very short horizontal curve keep explicit equal-Y keys.
    const oneFrame = service.applyCurveMotion(base.project, {
      shotId: base.shotId,
      layerId: base.layerId,
      startFrame: 0,
      endFrame: 1,
      p1: { x: 400, y: 300 },
      p2: { x: 400.5, y: 300 },
      p3: { x: 401, y: 300 },
      speedMode: 'constant',
    });
    const oneFrameLayer = oneFrame.shots[0]!.layers.find((l) => l.id === base.layerId)!;
    if (oneFrameLayer.animationClip?.version !== 2) throw new Error('Expected v2 Clip');
    expect(
      oneFrameLayer.animationClip.tracks.find((t) => t.property === 'transform.offsetY')!.keys,
    ).toHaveLength(2);

    // Rejections: degenerate zero-length path, off-grid shot tail, existing X/Y track, Move/Shake events, locked source.
    expect(() =>
      service.applyCurveMotion(base.project, {
        shotId: base.shotId,
        layerId: base.layerId,
        startFrame: 0,
        endFrame: 12,
        p1: { x: 400, y: 300 },
        p2: { x: 400, y: 300 },
        p3: { x: 400, y: 300 },
        speedMode: 'constant',
      }),
    ).toThrow(/长度为 0/);

    const offGridShot = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({ ...s, durationMs: 1_010 })),
    });
    expect(() =>
      service.applyCurveMotion(offGridShot, {
        shotId: base.shotId,
        layerId: base.layerId,
        startFrame: 0,
        endFrame: 25,
        p1,
        p2,
        p3,
        speedMode: 'constant',
      }),
    ).toThrow(/合法帧/);

    expect(() =>
      service.applyCurveMotion(baked, {
        shotId: base.shotId,
        layerId: base.layerId,
        startFrame: 0,
        endFrame: 12,
        p1,
        p2,
        p3,
        speedMode: 'constant',
      }),
    ).toThrow(/已有 X\/Y 位移关键帧/);

    const withMove = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({
        ...s,
        timelineEvents: [
          {
            id: '93000000-0000-4000-8000-000000000882',
            type: 'move',
            layerId: base.layerId,
            startMs: 0,
            endMs: 250,
            from: { x: 400, y: 300 },
            to: { x: 500, y: 300 },
            easing: 'linear',
          },
        ],
      })),
    });
    expect(() =>
      service.applyCurveMotion(withMove, {
        shotId: base.shotId,
        layerId: base.layerId,
        startFrame: 12,
        endFrame: 24,
        p1,
        p2,
        p3,
        speedMode: 'constant',
      }),
    ).toThrow(/移动或抖动事件/);

    const withShake = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({
        ...s,
        timelineEvents: [
          {
            id: '93000000-0000-4000-8000-000000000883',
            type: 'shake',
            layerId: base.layerId,
            startMs: 0,
            endMs: 250,
            amplitudeX: 10,
            amplitudeY: 10,
            frequencyHz: 1,
          },
        ],
      })),
    });
    expect(() =>
      service.applyCurveMotion(withShake, {
        shotId: base.shotId,
        layerId: base.layerId,
        startFrame: 12,
        endFrame: 24,
        p1,
        p2,
        p3,
        speedMode: 'constant',
      }),
    ).toThrow(/移动或抖动事件/);

    const locked = layerService.setLocked(base.project, base.shotId, base.layerId, true);
    expect(() =>
      service.applyCurveMotion(locked, {
        shotId: base.shotId,
        layerId: base.layerId,
        startFrame: 0,
        endFrame: 24,
        p1,
        p2,
        p3,
        speedMode: 'constant',
      }),
    ).toThrow(/已锁定/);
  });

  it('generates native position afterimages with exact historical anchors, opacity decay, visibility gating, zIndex ordering, hybrid Move/Shake/pivot compensation, and strict rejections (#1271 A03)', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();

    // Add a sibling layer below and above source to verify relative layer order preservation.
    const belowSibling = layerService.createFromAnimation(base.project, base.shotId, {
      animationId: base.definitionId,
      position: { x: 100, y: 100 },
      startTimeMs: 0,
    });
    let project = layerService.reorder(belowSibling.project, base.shotId, belowSibling.layer.id, 'back');
    const aboveSibling = layerService.createFromAnimation(project, base.shotId, {
      animationId: base.definitionId,
      position: { x: 1800, y: 900 },
      startTimeMs: 0,
    });
    project = ProjectSchema.parse({
      ...aboveSibling.project,
      shots: aboveSibling.project.shots.map((s) => ({ ...s, durationMs: 2_000 })),
    });

    // Bake A02 curve motion on source (0..24 frames).
    project = service.applyCurveMotion(project, {
      shotId: base.shotId,
      layerId: base.layerId,
      startFrame: 0,
      endFrame: 24,
      p1: { x: 450, y: 80 },
      p2: { x: 850, y: 80 },
      p3: { x: 900, y: 300 },
      speedMode: 'constant',
    });

    const beforeProject = structuredClone(project);
    const result = layerService.generateAfterimages(project, base.shotId, base.layerId, {
      count: 4,
      delayFrames: 2,
      decay: 0.6,
      startFrame: 0,
      endFrame: 24,
    });
    const parsed = ProjectSchema.parse(result.project);
    const shot = parsed.shots[0]!;
    expect(result.layers).toHaveLength(4);
    expect(parsed.animations).toEqual(beforeProject.animations);
    expect(parsed.assets).toEqual(beforeProject.assets);

    // Ordering: background(0) < belowSibling < replica4 < replica3 < replica2 < replica1 < source < aboveSibling.
    const orderedIds = [...shot.layers]
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((l) => l.id);
    const bgId = shot.backgroundLayerId!;
    expect(orderedIds).toEqual([
      bgId,
      belowSibling.layer.id,
      result.layers[0]!.id, // i=4 (farthest, lowest)
      result.layers[1]!.id, // i=3
      result.layers[2]!.id, // i=2
      result.layers[3]!.id, // i=1 (closest to source)
      base.layerId,
      aboveSibling.layer.id,
    ]);

    // Static opacity=1 -> target alphas for i=1..4 are 0.6, 0.36, 0.216, 0.1296.
    const replicaByIndex = [
      result.layers[3]!, // i=1
      result.layers[2]!, // i=2
      result.layers[1]!, // i=3
      result.layers[0]!, // i=4
    ];
    const expectedAlphas = [0.6, 0.36, 0.216, 0.1296];
    replicaByIndex.forEach((replica, idx) => {
      expect(replica.opacity).toBeCloseTo(expectedAlphas[idx]!, 6);
    });

    // Verify at f=12: replicas i=1,2,3,4 match source at f=10,8,6,4 within 0.1px and exact alpha.
    const eval12 = evaluateShotAtTime(shot, frameTimeMs(12), parsed);
    for (let idx = 0; idx < 4; idx += 1) {
      const i = idx + 1;
      const replica = replicaByIndex[idx]!;
      const histSrc = evaluateShotAtTime(shot, frameTimeMs(12 - i * 2), parsed).layers.find(
        (l) => l.id === base.layerId,
      )!;
      const repAt12 = eval12.layers.find((l) => l.id === replica.id)!;
      expect(repAt12.visible).toBe(true);
      expect(Math.abs(repAt12.x - histSrc.x)).toBeLessThan(0.1);
      expect(Math.abs(repAt12.y - histSrc.y)).toBeLessThan(0.1);
      expect(repAt12.opacity).toBeCloseTo(Math.pow(0.6, i), 5);

      // Hidden before first active frame (2*i - 1), visible on first active frame (2*i) and end frame (24), hidden at f=25.
      expect(
        evaluateShotAtTime(shot, frameTimeMs(i * 2 - 1), parsed).layers.find((l) => l.id === replica.id)!.visible,
      ).toBe(false);
      expect(
        evaluateShotAtTime(shot, frameTimeMs(i * 2), parsed).layers.find((l) => l.id === replica.id)!.visible,
      ).toBe(true);
      expect(
        evaluateShotAtTime(shot, frameTimeMs(24), parsed).layers.find((l) => l.id === replica.id)!.visible,
      ).toBe(true);
      expect(
        evaluateShotAtTime(shot, frameTimeMs(25), parsed).layers.find((l) => l.id === replica.id)!.visible,
      ).toBe(false);
    }

    // Independent editing & deletion of one replica does not alter source or sibling replicas.
    const editedReplica = service.applyKeys(
      parsed,
      { shotId: base.shotId, layerId: replicaByIndex[0]!.id, timeMs: frameTimeMs(12) },
      { 'transform.offsetX': 0 },
    );
    expect(
      evaluateShotAtTime(editedReplica.shots[0]!, frameTimeMs(12), editedReplica).layers.find(
        (l) => l.id === base.layerId,
      )!.x,
    ).toBeCloseTo(eval12.layers.find((l) => l.id === base.layerId)!.x, 5);
    const afterDelete = layerService.deleteLayer(editedReplica, base.shotId, replicaByIndex[0]!.id);
    expect(afterDelete.shots[0]!.layers.some((l) => l.id === base.layerId)).toBe(true);
    expect(afterDelete.shots[0]!.layers.some((l) => l.id === replicaByIndex[1]!.id)).toBe(true);

    // Hybrid Move/Shake + non-default pivot + rotation/scale + flipX + competing same-startMs OpacityEvents + hidden gap.
    let hybrid = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({
        ...s,
        durationMs: 1_010, // off-grid tail (last legal frame = 24 at 1000ms)
        layers: s.layers.map((l) =>
          l.id === base.layerId ? { ...l, x: 400, y: 300, scaleX: 1.4, scaleY: 1.2, rotationDeg: 15, flipX: true } : l,
        ),
        timelineEvents: [
          {
            id: '93000000-0000-4000-8000-000000000911',
            type: 'move',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            from: { x: 400, y: 300 },
            to: { x: 900, y: 500 },
            easing: 'linear',
          },
          {
            id: '93000000-0000-4000-8000-000000000912',
            type: 'shake',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            amplitudeX: 20,
            amplitudeY: 12,
            frequencyHz: 1,
          },
          {
            id: '93000000-0000-4000-8000-000000000913',
            type: 'opacity',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            from: 1,
            to: 0.1,
            easing: 'linear',
          },
          {
            id: '93000000-0000-4000-8000-000000000914',
            type: 'opacity',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            from: 1,
            to: 0.5,
            easing: 'linear',
          },
          {
            id: '93000000-0000-4000-8000-000000000915',
            type: 'visibility',
            layerId: base.layerId,
            startMs: frameTimeMs(8),
            endMs: frameTimeMs(8),
            visible: false,
          },
          {
            id: '93000000-0000-4000-8000-000000000916',
            type: 'visibility',
            layerId: base.layerId,
            startMs: frameTimeMs(12),
            endMs: frameTimeMs(12),
            visible: true,
          },
        ],
      })),
    });
    hybrid = service.recalibratePivot(
      hybrid,
      { shotId: base.shotId, layerId: base.layerId },
      { space: 'target-local', x: 135, y: 105 },
    );
    hybrid = service.applyKeys(
      hybrid,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 1_000 },
      { 'transform.rotationDeg': 60, 'transform.scaleX': 1.3 },
    );

    const hybridAfter = layerService.generateAfterimages(hybrid, base.shotId, base.layerId, {
      count: 3,
      delayFrames: 2,
      decay: 0.5,
      startFrame: 4,
      endFrame: 24, // last legal frame of off-grid 1010ms shot
    });
    const hybridShot = hybridAfter.project.shots[0]!;
    const closestHybridRep = hybridAfter.layers[2]!; // i=1
    // At f=10 (hist h=8, where source was hidden) -> replica hidden; at f=16 (hist h=14, visible) -> visible, exact pos & winning opacity * 0.5.
    expect(
      evaluateShotAtTime(hybridShot, frameTimeMs(10), hybridAfter.project).layers.find(
        (l) => l.id === closestHybridRep.id,
      )!.visible,
    ).toBe(false);
    const repAt16 = evaluateShotAtTime(hybridShot, frameTimeMs(16), hybridAfter.project).layers.find(
      (l) => l.id === closestHybridRep.id,
    )!;
    const srcAt14 = evaluateShotAtTime(hybridShot, frameTimeMs(14), hybridAfter.project).layers.find(
      (l) => l.id === base.layerId,
    )!;
    expect(repAt16.visible).toBe(true);
    expect(Math.abs(repAt16.x - srcAt14.x)).toBeLessThan(0.1);
    expect(Math.abs(repAt16.y - srcAt14.y)).toBeLessThan(0.1);
    expect(repAt16.opacity).toBeCloseTo(srcAt14.opacity * 0.5, 4);
    // At last legal frame f=24 (1000ms) -> still visible through off-grid tail 1010ms.
    expect(
      evaluateShotAtTime(hybridShot, 1_000, hybridAfter.project).layers.find(
        (l) => l.id === closestHybridRep.id,
      )!.visible,
    ).toBe(true);

    // Rejections: stationary source, count out of 3..8, invalid decay, too-short span, off-grid end, locked source.
    expect(() =>
      layerService.generateAfterimages(base.project, base.shotId, base.layerId, {
        count: 4,
        delayFrames: 2,
        decay: 0.6,
        startFrame: 0,
        endFrame: 24,
      }),
    ).toThrow(/没有有效位移/);
    expect(() =>
      layerService.generateAfterimages(project, base.shotId, base.layerId, {
        count: 2,
        delayFrames: 2,
        decay: 0.6,
        startFrame: 0,
        endFrame: 24,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AFTERIMAGE' }));
    expect(() =>
      layerService.generateAfterimages(project, base.shotId, base.layerId, {
        count: 4,
        delayFrames: 2,
        decay: 1,
        startFrame: 0,
        endFrame: 24,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AFTERIMAGE' }));
    expect(() =>
      layerService.generateAfterimages(project, base.shotId, base.layerId, {
        count: 4,
        delayFrames: 2,
        decay: 0.6,
        startFrame: 0,
        endFrame: 7, // 7 < 4*2=8
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_AFTERIMAGE' }));
    const locked = layerService.setLocked(project, base.shotId, base.layerId, true);
    expect(() =>
      layerService.generateAfterimages(locked, base.shotId, base.layerId, {
        count: 4,
        delayFrames: 2,
        decay: 0.6,
        startFrame: 0,
        endFrame: 24,
      }),
    ).toThrow(expect.objectContaining({ code: 'LAYER_LOCKED' }));
  });

  it('samples deterministic radial burst distributions with stable per-index draws across seed/count/parameter variations (#1273 A04 math)', () => {
    const a = sampleRadialBurstInstances({
      count: 12,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 42,
    });
    const b = sampleRadialBurstInstances({
      count: 12,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 42,
    });
    expect(a).toEqual(b);

    const diffSeed = sampleRadialBurstInstances({
      count: 12,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 43,
    });
    expect(diffSeed.map((s) => s.endPoint)).not.toEqual(a.map((s) => s.endPoint));

    // Changing radius/center/angle/maxRotation preserves raw (u, v, w) draws.
    const changedGeom = sampleRadialBurstInstances({
      count: 12,
      center: { x: 300, y: 200 },
      radius: 500,
      startAngleDeg: 45,
      maxRotationDeg: 90,
      seed: 42,
    });
    expect(changedGeom.map(({ u, v, w }) => ({ u, v, w }))).toEqual(
      a.map(({ u, v, w }) => ({ u, v, w })),
    );

    // Changing count N keeps raw (u, v, w) identical for common indices while recomputing sectors.
    const smaller = sampleRadialBurstInstances({
      count: 6,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 42,
    });
    expect(smaller.map(({ u, v, w }) => ({ u, v, w }))).toEqual(
      a.slice(0, 6).map(({ u, v, w }) => ({ u, v, w })),
    );
    expect(smaller[1]!.angleDeg).toBeCloseTo((360 * (1 + smaller[1]!.u)) / 6, 8);

    // Seed=0 and max uint32 seed=4294967295 are valid and deterministic.
    const zeroSeed = sampleRadialBurstInstances({
      count: 4,
      center: { x: 960, y: 540 },
      radius: 200,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 0,
    });
    const maxSeed = sampleRadialBurstInstances({
      count: 4,
      center: { x: 960, y: 540 },
      radius: 200,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 4_294_967_295,
    });
    expect(zeroSeed).toHaveLength(4);
    expect(maxSeed).toHaveLength(4);
    expect(zeroSeed.map((s) => s.u)).not.toEqual(maxSeed.map((s) => s.u));
  });

  it('generates radial burst replicas with exact sectors, ease-out trajectories, pivot compensation, clean appearance, fade/hold, and strict rejections (#1273 A04)', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();

    // Standard contract case: C=(960,540), N=12, R=240, θ0=0°, Ω=180°, S=0, D=12, K=1, seed=42.
    const proj = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({ ...s, durationMs: 2_000 })),
    });
    const beforeProj = structuredClone(proj);
    const burst = layerService.generateRadialBurst(proj, base.shotId, base.layerId, {
      count: 12,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      startFrame: 0,
      durationFrames: 12,
      staggerFrames: 1,
      seed: 42,
      fadeOut: true,
    });
    const parsed = ProjectSchema.parse(burst.project);
    const shot = parsed.shots[0]!;
    expect(burst.layers).toHaveLength(12);
    expect(parsed.animations).toEqual(beforeProj.animations);
    expect(parsed.assets).toEqual(beforeProj.assets);
    expect(shot.layers.find((l) => l.id === base.layerId)).toEqual(
      beforeProj.shots[0]!.layers.find((l) => l.id === base.layerId),
    );

    const expectedSamples = sampleRadialBurstInstances({
      count: 12,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 42,
    });

    for (let i = 0; i < 12; i += 1) {
      const rep = burst.layers[i]!;
      const sample = expectedSamples[i]!;
      expect(sample.angleDeg).toBeGreaterThanOrEqual((360 * i) / 12);
      expect(sample.angleDeg).toBeLessThan((360 * (i + 1)) / 12);
      expect(sample.distance).toBeGreaterThanOrEqual(240 * 0.75);
      expect(sample.distance).toBeLessThanOrEqual(240);
      expect(Math.abs(sample.rotationDeltaDeg)).toBeLessThanOrEqual(180);

      const launchFrame = i;
      const midFrame = i + 6;
      const endFrame = i + 12;
      if (launchFrame > 0) {
        expect(
          evaluateShotAtTime(shot, frameTimeMs(launchFrame - 1), parsed).layers.find(
            (l) => l.id === rep.id,
          )!.visible,
        ).toBe(false);
      }
      const atLaunch = evaluateShotAtTime(shot, frameTimeMs(launchFrame), parsed).layers.find(
        (l) => l.id === rep.id,
      )!;
      expect(atLaunch.visible).toBe(true);
      expect(Math.abs(atLaunch.x - 960)).toBeLessThan(0.1);
      expect(Math.abs(atLaunch.y - 540)).toBeLessThan(0.1);
      expect(atLaunch.opacity).toBeCloseTo(1, 5);

      const midProgress = evaluateAnimationEase(6 / 12, 'ease-out');
      const atMid = evaluateShotAtTime(shot, frameTimeMs(midFrame), parsed).layers.find(
        (l) => l.id === rep.id,
      )!;
      expect(Math.abs(atMid.x - (960 + (sample.endPoint.x - 960) * midProgress))).toBeLessThan(0.1);
      expect(Math.abs(atMid.y - (540 + (sample.endPoint.y - 540) * midProgress))).toBeLessThan(0.1);
      expect(atMid.rotationDeg).toBeCloseTo(sample.rotationDeltaDeg * midProgress, 3);

      const atEnd = evaluateShotAtTime(shot, frameTimeMs(endFrame), parsed).layers.find(
        (l) => l.id === rep.id,
      )!;
      expect(Math.abs(atEnd.x - sample.endPoint.x)).toBeLessThan(0.1);
      expect(Math.abs(atEnd.y - sample.endPoint.y)).toBeLessThan(0.1);
      expect(atEnd.opacity).toBeCloseTo(0, 5);

      expect(
        evaluateShotAtTime(shot, frameTimeMs(endFrame + 1), parsed).layers.find(
          (l) => l.id === rep.id,
        )!.visible,
      ).toBe(false);
    }

    // K=0, Ω=0, fadeOut=false, and max N=32.
    const maxBurst = layerService.generateRadialBurst(proj, base.shotId, base.layerId, {
      count: 32,
      center: { x: 960, y: 540 },
      radius: 200,
      startAngleDeg: 0,
      maxRotationDeg: 0,
      startFrame: 4,
      durationFrames: 10,
      staggerFrames: 0,
      seed: 7,
      fadeOut: false,
    });
    expect(maxBurst.layers).toHaveLength(32);
    const firstMax = maxBurst.layers[0]!;
    if (firstMax.animationClip?.version !== 2) throw new Error('Expected v2 Clip');
    expect(firstMax.animationClip.tracks.some((t) => t.property === 'transform.rotationDeg')).toBe(false);
    // Holds endpoint & opacity after T_i when fadeOut=false.
    const heldAfter = evaluateShotAtTime(
      maxBurst.project.shots[0]!,
      frameTimeMs(20),
      maxBurst.project,
    ).layers.find((l) => l.id === firstMax.id)!;
    expect(heldAfter.visible).toBe(true);
    expect(heldAfter.opacity).toBeCloseTo(1, 5);

    // Dirty source (Move/Shake, v2 tracks, non-default pivot, flipX, dynamic opacity, graphic-frame, overrides) -> clean replicas & cross-edge trajectory without clamping!
    let dirty = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({
        ...s,
        durationMs: 1_010, // off-grid tail, last legal frame = 24
        layers: s.layers.map((l) =>
          l.id === base.layerId ? { ...l, x: 400, y: 300, scaleX: 1.5, scaleY: 1.2, rotationDeg: 25, flipX: true } : l,
        ),
        timelineEvents: [
          {
            id: '93000000-0000-4000-8000-000000000971',
            type: 'move',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            from: { x: 400, y: 300 },
            to: { x: 800, y: 500 },
            easing: 'linear',
          },
          {
            id: '93000000-0000-4000-8000-000000000972',
            type: 'opacity',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            from: 0.8,
            to: 0.2,
            easing: 'linear',
          },
          {
            id: '93000000-0000-4000-8000-000000000973',
            type: 'graphic-frame',
            layerId: base.layerId,
            animationId: base.definitionId,
            startMs: 0,
            endMs: 0,
            sourceFrameIndex: 8,
          },
        ],
      })),
    });
    dirty = layerService.updateFlaGraphicInstanceTransform(
      dirty,
      base.shotId,
      base.layerId,
      0,
      ['face-0'],
      { a: 0.3, b: 0, c: 0, d: 0.3, tx: 22, ty: 14 },
    );
    expect(
      dirty.shots[0]!.layers.find((l) => l.id === base.layerId)!
        .flaGraphicInstanceTransformOverrides,
    ).toBeDefined();
    dirty = service.recalibratePivot(
      dirty,
      { shotId: base.shotId, layerId: base.layerId },
      { space: 'target-local', x: 140, y: 110 },
    );
    dirty = service.applyKeys(
      dirty,
      { shotId: base.shotId, layerId: base.layerId, timeMs: 1_000 },
      { 'transform.offsetX': 120, 'transform.rotationDeg': 90 },
    );

    const edgeBurst = layerService.generateRadialBurst(dirty, base.shotId, base.layerId, {
      count: 4,
      center: { x: 1860, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      startFrame: 9,
      durationFrames: 12,
      staggerFrames: 1, // last end frame = 9 + 3 + 12 = 24 (exact last legal frame of 1010ms shot!)
      seed: 42,
      fadeOut: true,
    });
    const edgeShot = edgeBurst.project.shots[0]!;
    const rep0 = edgeBurst.layers[0]!;
    expect(rep0.flaGraphicInstanceTransformOverrides).toBeDefined();
    expect(edgeShot.timelineEvents.some((e) => e.layerId === rep0.id && e.type === 'graphic-frame')).toBe(true);
    expect(edgeShot.timelineEvents.some((e) => e.layerId === rep0.id && e.type === 'move')).toBe(false);

    // Verify exact straight radial line even with non-default pivot + flipX + rotation AND x > 1920 not clamped!
    const edgeSample0 = sampleRadialBurstInstances({
      count: 4,
      center: { x: 1860, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      maxRotationDeg: 180,
      seed: 42,
    })[0]!;
    expect(edgeSample0.endPoint.x).toBeGreaterThan(1920);
    const rep0End = evaluateShotAtTime(edgeShot, frameTimeMs(21), edgeBurst.project).layers.find(
      (l) => l.id === rep0.id,
    )!;
    expect(Math.abs(rep0End.x - edgeSample0.endPoint.x)).toBeLessThan(0.1);
    expect(Math.abs(rep0End.y - edgeSample0.endPoint.y)).toBeLessThan(0.1);

    // Strict rejections: count=0/33, radius<=0, stagger<0, lastEndFrame>maxFrame, hidden source at S, locked source.
    expect(() =>
      layerService.generateRadialBurst(proj, base.shotId, base.layerId, {
        count: 0,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        maxRotationDeg: 180,
        startFrame: 0,
        durationFrames: 12,
        staggerFrames: 1,
        seed: 42,
        fadeOut: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RADIAL_BURST' }));
    expect(() =>
      layerService.generateRadialBurst(proj, base.shotId, base.layerId, {
        count: 33,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        maxRotationDeg: 180,
        startFrame: 0,
        durationFrames: 12,
        staggerFrames: 0,
        seed: 42,
        fadeOut: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RADIAL_BURST' }));
    expect(() =>
      layerService.generateRadialBurst(dirty, base.shotId, base.layerId, {
        count: 4,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        maxRotationDeg: 180,
        startFrame: 10,
        durationFrames: 12,
        staggerFrames: 1, // 10 + 3 + 12 = 25 > 24
        seed: 42,
        fadeOut: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RADIAL_BURST' }));
    const hiddenSource = ProjectSchema.parse({
      ...proj,
      shots: proj.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) => (l.id === base.layerId ? { ...l, visible: false } : l)),
      })),
    });
    expect(() =>
      layerService.generateRadialBurst(hiddenSource, base.shotId, base.layerId, {
        count: 4,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        maxRotationDeg: 180,
        startFrame: 0,
        durationFrames: 12,
        staggerFrames: 1,
        seed: 42,
        fadeOut: true,
      }),
    ).toThrow(/不可见或完全透明/);
  });

  it('normalizes extreme finite startAngleDeg (1e308) without NaN/zero-silencing and rejects non-finite derived burst transforms (#1281 P3-01)', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();
    const extremeAngle = 1e308;
    const normalizedAngle = normalizeAngleDeg360(extremeAngle);
    expect(Number.isFinite(normalizedAngle)).toBe(true);
    expect(normalizedAngle).toBeGreaterThanOrEqual(0);
    expect(normalizedAngle).toBeLessThan(360);

    // Same seed + extremeAngle matches normalizedAngle identically and preserves sector spacing.
    const extremeSamples = sampleRadialBurstInstances({
      count: 8,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: extremeAngle,
      maxRotationDeg: 180,
      seed: 42,
    });
    const normalizedSamples = sampleRadialBurstInstances({
      count: 8,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: normalizedAngle,
      maxRotationDeg: 180,
      seed: 42,
    });
    expect(extremeSamples).toEqual(normalizedSamples);
    for (let i = 0; i < extremeSamples.length; i += 1) {
      expect(Number.isFinite(extremeSamples[i]!.endPoint.x)).toBe(true);
      expect(Number.isFinite(extremeSamples[i]!.endPoint.y)).toBe(true);
      if (i > 0) {
        expect(extremeSamples[i]!.angleDeg).toBeGreaterThan(extremeSamples[i - 1]!.angleDeg);
      }
    }

    // Domain generateRadialBurst with extremeAngle produces finite non-zero keys identical to normalizedAngle.
    const proj = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({ ...s, durationMs: 2_000 })),
    });
    const burstExtreme = layerService.generateRadialBurst(proj, base.shotId, base.layerId, {
      count: 6,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: extremeAngle,
      maxRotationDeg: 180,
      startFrame: 0,
      durationFrames: 12,
      staggerFrames: 1,
      seed: 42,
      fadeOut: true,
    });
    const burstNorm = layerService.generateRadialBurst(proj, base.shotId, base.layerId, {
      count: 6,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: normalizedAngle,
      maxRotationDeg: 180,
      startFrame: 0,
      durationFrames: 12,
      staggerFrames: 1,
      seed: 42,
      fadeOut: true,
    });
    for (let i = 0; i < 6; i += 1) {
      const endMs = frameTimeMs(i + 12);
      const evalExtreme = evaluateShotAtTime(burstExtreme.project.shots[0]!, endMs, burstExtreme.project).layers.find(
        (l) => l.id === burstExtreme.layers[i]!.id,
      )!;
      const evalNorm = evaluateShotAtTime(burstNorm.project.shots[0]!, endMs, burstNorm.project).layers.find(
        (l) => l.id === burstNorm.layers[i]!.id,
      )!;
      expect(evalExtreme.x).toBeCloseTo(evalNorm.x, 6);
      expect(evalExtreme.y).toBeCloseTo(evalNorm.y, 6);
    }

    // Non-finite derived transform (non-default pivot + maxRotationDeg=1e308 overflows rad -> cos(Infinity)=NaN in pivot solver) must throw INVALID_RADIAL_BURST, never silently write 0.
    const pivotedProj = service.recalibratePivot(
      proj,
      { shotId: base.shotId, layerId: base.layerId },
      { space: 'target-local', x: 140, y: 110 },
    );
    expect(() =>
      layerService.generateRadialBurst(pivotedProj, base.shotId, base.layerId, {
        count: 4,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        maxRotationDeg: 1e308,
        startFrame: 0,
        durationFrames: 12,
        staggerFrames: 0,
        seed: 42,
        fadeOut: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RADIAL_BURST' }));
  });

  it('generates static radial arrays with exact geometry, orientation bias, rich copy semantics, boundary counts, and strict rejections (#1281 B01 radial)', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();

    // Standard AC case: C=(960,540), R=240, N=8, θ0=0°.
    const beforeProj = structuredClone(base.project);
    const keepResult = layerService.duplicateAnimationLayerRadial(base.project, base.shotId, base.layerId, {
      count: 8,
      center: { x: 960, y: 540 },
      radius: 240,
      startAngleDeg: 0,
      orientation: 'keep',
    });
    const parsedKeep = ProjectSchema.parse(keepResult.project);
    expect(keepResult.layers).toHaveLength(8);
    expect(parsedKeep.animations).toEqual(beforeProj.animations);
    expect(parsedKeep.assets).toEqual(beforeProj.assets);
    expect(parsedKeep.shots[0]!.layers.find((l) => l.id === base.layerId)).toEqual(
      beforeProj.shots[0]!.layers.find((l) => l.id === base.layerId),
    );
    expect(keepResult.layers[0]!.x).toBeCloseTo(1_200, 4);
    expect(keepResult.layers[0]!.y).toBeCloseTo(540, 4);
    expect(keepResult.layers[4]!.x).toBeCloseTo(720, 4);
    expect(keepResult.layers[4]!.y).toBeCloseTo(540, 4);
    for (let i = 0; i < 8; i += 1) {
      const rep = keepResult.layers[i]!;
      const dist = Math.hypot(rep.x - 960, rep.y - 540);
      expect(Math.abs(dist - 240)).toBeLessThan(0.1);
      const angle = ((Math.atan2(rep.y - 540, rep.x - 960) * 180) / Math.PI + 360) % 360;
      expect(angle).toBeCloseTo(i * 45, 4);
      expect(rep.rotationDeg).toBe(0);
    }

    // Negative / non-zero / extreme startAngleDeg, N=2 & N=100, exact stage edge (0,240)&(240,0).
    const edgeResult = layerService.duplicateAnimationLayerRadial(base.project, base.shotId, base.layerId, {
      count: 4,
      center: { x: 240, y: 240 },
      radius: 240,
      startAngleDeg: -90,
      orientation: 'align',
    });
    expect(edgeResult.layers[0]!.x).toBeCloseTo(240, 4);
    expect(edgeResult.layers[0]!.y).toBeCloseTo(0, 4);
    expect(edgeResult.layers[3]!.x).toBeCloseTo(0, 4);
    expect(edgeResult.layers[3]!.y).toBeCloseTo(240, 4);

    const n2 = layerService.duplicateAnimationLayerRadial(base.project, base.shotId, base.layerId, {
      count: 2,
      center: { x: 960, y: 540 },
      radius: 100,
      startAngleDeg: 1e308,
      orientation: 'keep',
    });
    expect(n2.layers).toHaveLength(2);
    expect(Math.hypot(n2.layers[1]!.x - n2.layers[0]!.x, n2.layers[1]!.y - n2.layers[0]!.y)).toBeCloseTo(200, 4);

    const n100 = layerService.duplicateAnimationLayerRadial(base.project, base.shotId, base.layerId, {
      count: 100,
      center: { x: 960, y: 540 },
      radius: 200,
      startAngleDeg: 15,
      orientation: 'align',
    });
    expect(n100.layers).toHaveLength(100);

    // Rich source with base rotation=30, flipX, pivot, v2 Clip, Move, same-startMs Opacity, graphic-frame, overrides.
    let rich = ProjectSchema.parse({
      ...base.project,
      shots: base.project.shots.map((s) => ({
        ...s,
        layers: s.layers.map((l) =>
          l.id === base.layerId ? { ...l, x: 400, y: 300, rotationDeg: 30, flipX: true } : l,
        ),
        timelineEvents: [
          {
            id: '94000000-0000-4000-8000-000000000981',
            type: 'move',
            layerId: base.layerId,
            startMs: 0,
            endMs: 1_000,
            from: { x: 400, y: 300 },
            to: { x: 600, y: 400 },
            easing: 'linear',
          },
          {
            id: '94000000-0000-4000-8000-000000000982',
            type: 'opacity',
            layerId: base.layerId,
            startMs: 0,
            endMs: 500,
            from: 1,
            to: 0.4,
            easing: 'linear',
          },
          {
            id: '94000000-0000-4000-8000-000000000983',
            type: 'graphic-frame',
            layerId: base.layerId,
            animationId: base.definitionId,
            startMs: 0,
            endMs: 0,
            sourceFrameIndex: 8,
          },
        ],
      })),
    });
    rich = layerService.updateFlaGraphicInstanceTransform(rich, base.shotId, base.layerId, 0, ['face-0'], {
      a: 0.3,
      b: 0,
      c: 0,
      d: 0.3,
      tx: 22,
      ty: 14,
    });
    rich = service.recalibratePivot(rich, { shotId: base.shotId, layerId: base.layerId }, { space: 'target-local', x: 140, y: 110 });
    rich = service.applyKeys(rich, { shotId: base.shotId, layerId: base.layerId, timeMs: 500 }, { 'transform.offsetX': 50 });

    const aligned = layerService.duplicateAnimationLayerRadial(rich, base.shotId, base.layerId, {
      count: 4,
      center: { x: 960, y: 540 },
      radius: 200,
      startAngleDeg: 0,
      orientation: 'align',
    });
    const alignedShot = aligned.project.shots[0]!;
    // Source base rotation=30 acts as bias: outward 0/90/180/270 -> 30 / 120 / -150 / -60.
    expect(aligned.layers.map((l) => l.rotationDeg)).toEqual([30, 120, -150, -60]);
    const rep0 = aligned.layers[0]!;
    expect(rep0.flipX).toBe(true);
    expect(rep0.flaGraphicInstanceTransformOverrides).toBeDefined();
    expect(rep0.animationClip?.version).toBe(2);
    if (rep0.animationClip?.version !== 2) throw new Error('Expected v2 Clip');
    expect(rep0.animationClip.targetBases[0]!.target).toEqual({ kind: 'layer', layerId: rep0.id });
    expect(rep0.animationClip.targetBases[0]!.baseTransform.rotationDeg).toBe(30);
    // No extra layout rotationDeg track added.
    expect(rep0.animationClip.tracks.some((t) => t.property === 'transform.rotationDeg')).toBe(false);
    // MoveEvent translated by actual delta (1160 - 400, 540 - 300).
    const rep0Move = alignedShot.timelineEvents.find((e) => e.layerId === rep0.id && e.type === 'move');
    expect(rep0Move?.type === 'move' && rep0Move.from).toEqual({ x: 1_160, y: 540 });
    expect(rep0Move?.type === 'move' && rep0Move.to).toEqual({ x: 1_360, y: 640 });
    expect(alignedShot.timelineEvents.some((e) => e.layerId === rep0.id && e.type === 'graphic-frame')).toBe(true);

    // Rejections: count=1, count=101, radius<=0, out-of-bounds, locked.
    expect(() =>
      layerService.duplicateAnimationLayerRadial(base.project, base.shotId, base.layerId, {
        count: 1,
        center: { x: 960, y: 540 },
        radius: 200,
        startAngleDeg: 0,
        orientation: 'keep',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RADIAL_ARRAY' }));
    expect(() =>
      layerService.duplicateAnimationLayerRadial(base.project, base.shotId, base.layerId, {
        count: 101,
        center: { x: 960, y: 540 },
        radius: 200,
        startAngleDeg: 0,
        orientation: 'keep',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_RADIAL_ARRAY' }));
    expect(() =>
      layerService.duplicateAnimationLayerRadial(base.project, base.shotId, base.layerId, {
        count: 8,
        center: { x: 100, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        orientation: 'keep',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_POSITION' }));
    const locked = layerService.setLocked(base.project, base.shotId, base.layerId, true);
    expect(() =>
      layerService.duplicateAnimationLayerRadial(locked, base.shotId, base.layerId, {
        count: 8,
        center: { x: 960, y: 540 },
        radius: 240,
        startAngleDeg: 0,
        orientation: 'keep',
      }),
    ).toThrow(expect.objectContaining({ code: 'LAYER_LOCKED' }));
    // Keep direct math sanity check.
    expect(sampleRadialArrayLayout({ count: 4, center: { x: 500, y: 500 }, radius: 100, startAngleDeg: 0, orientation: 'align' }).map((s) => s.directionAngleDeg)).toEqual([0, 90, 180, 270]);
  });

  it('generates along-path arrays by equal arc length (not equal t), handles closed loops and degenerate endpoints, and rejects zero-length curves (#1281 B01 path)', () => {
    const base = zeroCharacterGraphicProject();
    const layerService = new LayerService();

    // Open AC curve: P0=(400,300), P1=(450,80), P2=(850,80), P3=(900,300), N=6.
    const openCurve: CubicBezier2D = {
      p0: { x: 400, y: 300 },
      p1: { x: 450, y: 80 },
      p2: { x: 850, y: 80 },
      p3: { x: 900, y: 300 },
    };
    const sampledOpen = samplePathArrayLayout({ count: 6, curve: openCurve, orientation: 'align' });
    if (!sampledOpen.ok) throw new Error('Expected valid open path');
    expect(sampledOpen.isClosed).toBe(false);
    expect(sampledOpen.samples[0]!.position).toEqual(openCurve.p0);
    expect(sampledOpen.samples[5]!.position).toEqual(openCurve.p3);

    // Independent fine reference integration (2000 steps) proves equal arc-length spacing <= max(0.5px, 2%).
    const refSteps = 2_000;
    const refPts = Array.from({ length: refSteps + 1 }, (_, k) => evaluateCubicBezier2D(openCurve, k / refSteps));
    const refCum = [0];
    for (let k = 1; k <= refSteps; k += 1) {
      refCum.push(refCum[k - 1]! + Math.hypot(refPts[k]!.x - refPts[k - 1]!.x, refPts[k]!.y - refPts[k - 1]!.y));
    }
    const refTotal = refCum[refSteps]!;
    const targetGap = refTotal / 5;
    const sampleArcs = sampledOpen.samples.map((s) => {
      let bestK = 0;
      let bestDist = Infinity;
      for (let k = 0; k <= refSteps; k += 1) {
        const d = Math.hypot(refPts[k]!.x - s.position.x, refPts[k]!.y - s.position.y);
        if (d < bestDist) {
          bestDist = d;
          bestK = k;
        }
      }
      return refCum[bestK]!;
    });
    for (let i = 1; i < sampleArcs.length; i += 1) {
      const gap = sampleArcs[i]! - sampleArcs[i - 1]!;
      expect(Math.abs(gap - targetGap)).toBeLessThanOrEqual(Math.max(0.5, targetGap * 0.02));
    }

    // Non-uniformly parameterized straight line proves equal arc-length (NOT equal t)!
    const nonUniformLine: CubicBezier2D = {
      p0: { x: 200, y: 300 },
      p1: { x: 200, y: 300 }, // degenerate start derivative -> also tests secant fallback!
      p2: { x: 210, y: 300 },
      p3: { x: 800, y: 300 },
    };
    const lineSampled = samplePathArrayLayout({ count: 5, curve: nonUniformLine, orientation: 'align' });
    if (!lineSampled.ok) throw new Error('Expected valid non-uniform line');
    // Arc-length positions must be 200, 350, 500, 650, 800 (whereas t=0.5 would be ~278.75!).
    expect(lineSampled.samples.map((s) => Math.round(s.position.x))).toEqual([200, 350, 500, 650, 800]);
    for (const s of lineSampled.samples) {
      expect(Number.isFinite(s.directionAngleDeg!)).toBe(true);
      expect(s.directionAngleDeg!).toBeCloseTo(0, 3);
    }

    // Degenerate end derivative (P2 === P3) resolves incoming tangent cleanly at t=1.
    const degenEnd: CubicBezier2D = {
      p0: { x: 200, y: 300 },
      p1: { x: 500, y: 300 },
      p2: { x: 800, y: 300 },
      p3: { x: 800, y: 300 },
    };
    const degenEndSampled = samplePathArrayLayout({ count: 3, curve: degenEnd, orientation: 'align' });
    if (!degenEndSampled.ok) throw new Error('Expected valid degen-end line');
    expect(degenEndSampled.samples[2]!.directionAngleDeg).toBeCloseTo(0, 3);

    // Closed single-segment curve (P0 === P3) samples i/N without duplicate endpoint.
    const closedCurve: CubicBezier2D = {
      p0: { x: 600, y: 400 },
      p1: { x: 900, y: 100 },
      p2: { x: 300, y: 100 },
      p3: { x: 600, y: 400 },
    };
    const closedResult = layerService.duplicateAnimationLayerAlongPath(base.project, base.shotId, base.layerId, {
      count: 6,
      curve: closedCurve,
      orientation: 'align',
    });
    expect(closedResult.layers).toHaveLength(6);
    expect(closedResult.layers[0]!.x).toBeCloseTo(600, 4);
    expect(closedResult.layers[0]!.y).toBeCloseTo(400, 4);
    // Last replica is at 5/6 arc-length, NOT overlapping P0=(600,400).
    expect(Math.hypot(closedResult.layers[5]!.x - 600, closedResult.layers[5]!.y - 400)).toBeGreaterThan(20);

    // Open domain generation with N=2 and zero-length rejection.
    const n2 = layerService.duplicateAnimationLayerAlongPath(base.project, base.shotId, base.layerId, {
      count: 2,
      curve: openCurve,
      orientation: 'keep',
    });
    expect(n2.layers).toHaveLength(2);
    expect(n2.layers[0]!.x).toBeCloseTo(400, 4);
    expect(n2.layers[1]!.x).toBeCloseTo(900, 4);

    expect(() =>
      layerService.duplicateAnimationLayerAlongPath(base.project, base.shotId, base.layerId, {
        count: 4,
        curve: {
          p0: { x: 400, y: 300 },
          p1: { x: 400, y: 300 },
          p2: { x: 400, y: 300 },
          p3: { x: 400, y: 300 },
        },
        orientation: 'keep',
      }),
    ).toThrow(expect.objectContaining({ code: 'INVALID_PATH_ARRAY' }));
  });
});
