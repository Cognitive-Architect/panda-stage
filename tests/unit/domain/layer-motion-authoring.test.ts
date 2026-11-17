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
  ProjectSchema,
  ProjectV20Schema,
  ProjectV21Schema,
  ShotService,
  evaluateLayerMotionAtTime,
  evaluateShotAtTime,
  layerCompositeKeyEasing,
  layerCompositeKeyTimes,
  hasLayerCompositeKeyOutgoingInterval,
  migrateProject,
  resolveLayerVisualParts,
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

describe('Schema v22 + AnimationTargetRef + v21 migration contract (#1140)', () => {
  it('supports layer targets without partId and prevents mixing v1/v2 targets', () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(22);
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

  it('upgrades v21 Character Clip v1 losslessly to v22 and keeps v21 closed to Layer Clip v2', () => {
    const v22Character = animationCoreFixture().project;
    const v21Character = { ...structuredClone(v22Character), schemaVersion: 21 };
    expect(ProjectV21Schema.parse(v21Character)).toEqual(v21Character);
    expect(ProjectV20Schema.safeParse({ ...v22Character, schemaVersion: 20 }).success).toBe(false);

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
});
