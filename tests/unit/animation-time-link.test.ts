import { describe, expect, it } from 'vitest';
import {
  evaluateShotAtTime,
  FlaGraphicDefinitionSchema,
  listAvailableCharacterActionLinks,
  ProjectSchema,
  resolveLayerAnimationTimeLink,
  setLayerAnimationTimeLink,
  ShotService,
  type Layer,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { evaluateExportShotAtTime } from '../../src/export-renderer/evaluateExportShotAtTime';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const ACTION_ID = '80000000-0000-4000-8000-000000000001';
const ACTION_EVENT_1 = '80000000-0000-4000-8000-000000000011';
const ACTION_EVENT_2 = '80000000-0000-4000-8000-000000000012';
const GRAPHIC_PLAYBACK_EVENT = '80000000-0000-4000-8000-000000000021';
const GRAPHIC_FRAME_EVENT = '80000000-0000-4000-8000-000000000022';
const MOVE_EVENT = '80000000-0000-4000-8000-000000000023';
const VISIBILITY_EVENT = '80000000-0000-4000-8000-000000000024';
const FRAME_ASSET_0 = '10000000-0000-4000-8000-000000000100';
const FRAME_ASSET_1 = '10000000-0000-4000-8000-000000000101';
const FRAME_ASSET_2 = '10000000-0000-4000-8000-000000000102';
const FRAME_ASSET_3 = '10000000-0000-4000-8000-000000000103';
const AUDIO_ASSET_ID = '10000000-0000-4000-8000-000000000201';
const AUDIO_CLIP_ID = '90000000-0000-4000-8000-000000000001';
const DIALOGUE_ID = '90000000-0000-4000-8000-000000000002';

const FRAME_SHA = 'a'.repeat(64);

function makeFrameAsset(id: string, name: string, flaGraphicOrdinal?: number) {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: flaGraphicOrdinal !== undefined ? `assets/${name}.svg` : `assets/${name}.png`,
    mimeType: flaGraphicOrdinal !== undefined ? 'image/svg+xml' : 'image/png',
    sha256: FRAME_SHA,
    width: 256,
    height: 256,
    usage: 'uncategorized' as const,
    keywords: [],
    ...(flaGraphicOrdinal !== undefined
      ? {
          flaGraphicFrame: {
            definitionId: IDS.animation,
            ordinal: flaGraphicOrdinal,
          },
        }
      : {}),
  };
}

/**
 * Builds a 6000ms shot with:
 * - A character layer with a named action ("挥剑") triggered twice: [1000, 2000) and [4000, 5000).
 * - A 4-frame 4fps (250ms/frame, 1000ms total) animation layer ("剑光") initially at startTimeMs=250.
 */
function buildTimeLinkProject(options?: {
  flaGraphic?: boolean;
  layerPatch?: Partial<Layer>;
  shotDurationMs?: number;
}): Project {
  const base = buildProjectWithAnimation();
  const frameAssets = [
    makeFrameAsset(FRAME_ASSET_0, 'slash-0', options?.flaGraphic ? 0 : undefined),
    makeFrameAsset(FRAME_ASSET_1, 'slash-1', options?.flaGraphic ? 1 : undefined),
    makeFrameAsset(FRAME_ASSET_2, 'slash-2', options?.flaGraphic ? 2 : undefined),
    makeFrameAsset(FRAME_ASSET_3, 'slash-3', options?.flaGraphic ? 3 : undefined),
  ];
  const frameDurationMs = 250;
  const frames = frameAssets.map((asset, ordinal) => ({
    ordinal,
    sourceFrameIndex: ordinal,
    assetId: asset.id,
    sha256: FRAME_SHA,
    offset: { x: 0, y: 0 },
    sourceViewport: { x: 0, y: 0, width: 256, height: 256 },
    startMs: ordinal * frameDurationMs,
    durationMs: frameDurationMs,
    createdBySequenceImport: !options?.flaGraphic,
  }));

  const baseSource = {
    ...base.animations[0]!.source,
    sourceFps: 4,
    startFrameIndex: 0,
    endFrameIndex: 3,
    canvas: { width: 256, height: 256 },
    documentCanvas: { width: 256, height: 256 },
    anchor: { x: 0, y: 0 },
  };
  const animation = options?.flaGraphic
    ? FlaGraphicDefinitionSchema.parse({
        id: IDS.animation,
        kind: 'fla-graphic',
        name: '剑光 Graphic',
        durationMs: 1_000,
        source: baseSource,
        frames,
      })
    : {
        ...base.animations[0]!,
        id: IDS.animation,
        name: '剑光序列',
        durationMs: 1_000,
        source: baseSource,
        frames,
      };

  const baseShot = base.shots[0]!;
  const baseCharacter = base.characters[0]!;
  const animationLayer: Layer = {
    id: IDS.animationLayer,
    name: '剑光特效',
    source: { kind: 'animation', animationId: IDS.animation },
    anchor: 'center',
    x: 960,
    y: 540,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    zIndex: 3,
    locked: false,
    flipX: false,
    startTimeMs: 250,
    animationPlayback: { mode: 'once', endBehavior: 'hold' },
    ...options?.layerPatch,
  };
  const updatedLayers = [...baseShot.layers, animationLayer];

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, ...frameAssets],
    animations: [animation],
    characters: [
      {
        ...baseCharacter,
        actions: [
          {
            id: ACTION_ID,
            name: '挥剑',
            animationId: IDS.animation,
            placement: { offsetX: 0, offsetY: 0, scale: 1 },
          },
        ],
      },
    ],
    shots: [
      {
        ...baseShot,
        durationMs: options?.shotDurationMs ?? 6_000,
        layers: updatedLayers,
        timelineEvents: [
          {
            id: ACTION_EVENT_1,
            layerId: IDS.layerChar,
            type: 'character-action',
            actionId: ACTION_ID,
            startMs: 1_000,
            endMs: 2_000,
          },
          {
            id: ACTION_EVENT_2,
            layerId: IDS.layerChar,
            type: 'character-action',
            actionId: ACTION_ID,
            startMs: 4_000,
            endMs: 5_000,
          },
        ],
      },
    ],
  });
}

function evaluatedAnimation(project: Project, timeMs: number, graphicFrameTimeMs?: number) {
  const shot = project.shots[0]!;
  const evaluated = evaluateShotAtTime(shot, timeMs, project, {
    ...(graphicFrameTimeMs !== undefined ? { graphicFrameTimeMs } : {}),
  });
  return evaluated.layers.find((layer) => layer.id === IDS.animationLayer)!;
}

describe('PARENT-06 character-action interval time-link (#1380)', () => {
  it('distinguishes multiple occurrences of the same action and tracks moves/trims automatically', () => {
    const project = buildTimeLinkProject();
    const shot = project.shots[0]!;
    const available = listAvailableCharacterActionLinks(project, shot);

    expect(available).toHaveLength(2);
    expect(available[0]).toMatchObject({
      sourceLayerId: IDS.layerChar,
      sourceLayerName: '角色',
      eventId: ACTION_EVENT_1,
      actionName: '挥剑',
      startMs: 1_000,
      endMs: 2_000,
    });
    expect(available[1]).toMatchObject({
      sourceLayerId: IDS.layerChar,
      sourceLayerName: '角色',
      eventId: ACTION_EVENT_2,
      actionName: '挥剑',
      startMs: 4_000,
      endMs: 5_000,
    });

    // Link strictly to the second occurrence [4000, 5000).
    const linked = setLayerAnimationTimeLink(project, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_2,
    });

    // Original independent startTimeMs is preserved for unlink/fallback.
    const linkedLayer = linked.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(linkedLayer.startTimeMs).toBe(250);
    expect(resolveLayerAnimationTimeLink(linked.shots[0]!, linkedLayer)).toMatchObject({
      status: 'active',
      startMs: 4_000,
      endMs: 5_000,
    });

    // Hidden during the first occurrence [1000, 2000) and before 4000ms.
    expect(evaluatedAnimation(linked, 500).visible).toBe(false);
    expect(evaluatedAnimation(linked, 1_500).visible).toBe(false);
    expect(evaluatedAnimation(linked, 3_999).visible).toBe(false);

    // Active during [4000, 5000) with source clock starting at 4000ms (250ms per frame).
    expect(evaluatedAnimation(linked, 4_000)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_0,
    });
    expect(evaluatedAnimation(linked, 4_250)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_1,
    });
    expect(evaluatedAnimation(linked, 4_750)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_3,
    });

    // Hidden at and after endMs (half-open [startMs, endMs)).
    expect(evaluatedAnimation(linked, 5_000).visible).toBe(false);
    expect(evaluatedAnimation(linked, 5_500).visible).toBe(false);

    // Moving & trimming the linked action event to [2500, 3250) automatically shifts the effect.
    const moved: Project = ProjectSchema.parse({
      ...linked,
      shots: [
        {
          ...linked.shots[0]!,
          timelineEvents: linked.shots[0]!.timelineEvents.map((event) =>
            event.id === ACTION_EVENT_2
              ? { ...event, startMs: 2_500, endMs: 3_250 }
              : event,
          ),
        },
      ],
    });
    expect(evaluatedAnimation(moved, 2_499).visible).toBe(false);
    expect(evaluatedAnimation(moved, 2_500)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_0,
    });
    expect(evaluatedAnimation(moved, 3_000)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_2,
    });
    expect(evaluatedAnimation(moved, 3_250).visible).toBe(false);
    expect(evaluatedAnimation(moved, 4_500).visible).toBe(false);
  });

  it('supports loop, once+hold, once+hide, single-frame, firstFrame, sourceRange, author visibility, and unlink restore', () => {
    // 1) loop inside a 2000ms window [1000, 3000)
    const loopBase = buildTimeLinkProject({
      layerPatch: {
        animationPlayback: { mode: 'loop', endBehavior: 'hold' },
        animationFirstFrame: 1,
      },
    });
    const loopExtended: Project = ProjectSchema.parse({
      ...loopBase,
      shots: [
        {
          ...loopBase.shots[0]!,
          timelineEvents: loopBase.shots[0]!.timelineEvents.map((event) =>
            event.id === ACTION_EVENT_1 ? { ...event, startMs: 1_000, endMs: 3_000 } : event,
          ),
        },
      ],
    });
    const loopLinked = setLayerAnimationTimeLink(loopExtended, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });
    // firstFrame=1 -> available frames are [1, 2, 3] (750ms cycle)
    expect(evaluatedAnimation(loopLinked, 1_000)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
    expect(evaluatedAnimation(loopLinked, 1_500)).toMatchObject({ visible: true, assetId: FRAME_ASSET_3 });
    expect(evaluatedAnimation(loopLinked, 1_750)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
    expect(evaluatedAnimation(loopLinked, 3_000).visible).toBe(false);

    // 2) once + hold vs once + hide inside a 2000ms window (animation is 1000ms)
    const onceHold = setLayerAnimationTimeLink(
      ProjectSchema.parse({
        ...loopExtended,
        shots: [
          {
            ...loopExtended.shots[0]!,
            layers: loopExtended.shots[0]!.layers.map((layer) =>
              layer.id === IDS.animationLayer
                ? { ...layer, animationFirstFrame: 0, animationPlayback: { mode: 'once', endBehavior: 'hold' } }
                : layer,
            ),
          },
        ],
      }),
      IDS.shot,
      IDS.animationLayer,
      { kind: 'character-action', sourceLayerId: IDS.layerChar, eventId: ACTION_EVENT_1 },
    );
    expect(evaluatedAnimation(onceHold, 2_500)).toMatchObject({ visible: true, assetId: FRAME_ASSET_3 });
    expect(evaluatedAnimation(onceHold, 3_000).visible).toBe(false);

    const onceHide = setLayerAnimationTimeLink(
      ProjectSchema.parse({
        ...loopExtended,
        shots: [
          {
            ...loopExtended.shots[0]!,
            layers: loopExtended.shots[0]!.layers.map((layer) =>
              layer.id === IDS.animationLayer
                ? { ...layer, animationFirstFrame: 0, animationPlayback: { mode: 'once', endBehavior: 'hide' } }
                : layer,
            ),
          },
        ],
      }),
      IDS.shot,
      IDS.animationLayer,
      { kind: 'character-action', sourceLayerId: IDS.layerChar, eventId: ACTION_EVENT_1 },
    );
    expect(evaluatedAnimation(onceHide, 1_500)).toMatchObject({ visible: true, assetId: FRAME_ASSET_2 });
    expect(evaluatedAnimation(onceHide, 2_250).visible).toBe(false);

    // 3) single-frame + animationSourceRange
    const singleFrame = setLayerAnimationTimeLink(
      buildTimeLinkProject({
        layerPatch: {
          animationPlayback: { mode: 'single-frame', endBehavior: 'hold' },
          animationSourceRange: { firstFrame: 2, lastFrame: 3 },
        },
      }),
      IDS.shot,
      IDS.animationLayer,
      { kind: 'character-action', sourceLayerId: IDS.layerChar, eventId: ACTION_EVENT_1 },
    );
    expect(evaluatedAnimation(singleFrame, 1_000)).toMatchObject({ visible: true, assetId: FRAME_ASSET_2 });
    expect(evaluatedAnimation(singleFrame, 1_750)).toMatchObject({ visible: true, assetId: FRAME_ASSET_2 });
    expect(evaluatedAnimation(singleFrame, 2_000).visible).toBe(false);

    // 4) Author visible:false and visibility events still win inside active window
    const hiddenAuthor = setLayerAnimationTimeLink(
      buildTimeLinkProject({ layerPatch: { visible: false } }),
      IDS.shot,
      IDS.animationLayer,
      { kind: 'character-action', sourceLayerId: IDS.layerChar, eventId: ACTION_EVENT_1 },
    );
    expect(evaluatedAnimation(hiddenAuthor, 1_250).visible).toBe(false);

    const hiddenByEvent = ProjectSchema.parse({
      ...onceHold,
      shots: [
        {
          ...onceHold.shots[0]!,
          timelineEvents: [
            ...onceHold.shots[0]!.timelineEvents,
            {
              id: VISIBILITY_EVENT,
              layerId: IDS.animationLayer,
              type: 'visibility',
              startMs: 1_500,
              endMs: 1_500,
              visible: false,
            },
          ],
        },
      ],
    });
    expect(evaluatedAnimation(hiddenByEvent, 1_250).visible).toBe(true);
    expect(evaluatedAnimation(hiddenByEvent, 1_600).visible).toBe(false);

    // 5) Unlinking restores original independent startTimeMs (250ms)
    const unlinked = setLayerAnimationTimeLink(onceHold, IDS.shot, IDS.animationLayer, undefined);
    expect(evaluatedAnimation(unlinked, 200).visible).toBe(false);
    expect(evaluatedAnimation(unlinked, 250)).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });
    expect(evaluatedAnimation(unlinked, 500)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
  });

  it('preserves explicit graphic-playback and graphic-frame priority inside the active window', () => {
    const base = buildTimeLinkProject({
      flaGraphic: true,
      layerPatch: { startTimeMs: 3_500 },
    });
    const withEvents: Project = ProjectSchema.parse({
      ...base,
      shots: [
        {
          ...base.shots[0]!,
          timelineEvents: [
            ...base.shots[0]!.timelineEvents,
            {
              id: GRAPHIC_FRAME_EVENT,
              layerId: IDS.animationLayer,
              type: 'graphic-frame',
              animationId: IDS.animation,
              startMs: 1_250,
              endMs: 1_250,
              sourceFrameIndex: 3,
            },
            {
              id: GRAPHIC_PLAYBACK_EVENT,
              layerId: IDS.animationLayer,
              type: 'graphic-playback',
              animationId: IDS.animation,
              startMs: 1_500,
              endMs: 1_800,
              playbackStartMs: 1_500,
              firstFrame: 1,
              range: { firstFrame: 1, lastFrame: 2 },
              playback: { mode: 'loop', endBehavior: 'hold' },
            },
          ],
        },
      ],
    });
    const linked = setLayerAnimationTimeLink(withEvents, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });

    // At 1000ms: default linked start -> frame 0
    expect(evaluatedAnimation(linked, 1_000)).toMatchObject({ visible: true, assetId: FRAME_ASSET_0 });
    // At 1250ms: graphic-frame overrides to frame 3
    expect(evaluatedAnimation(linked, 1_250)).toMatchObject({ visible: true, assetId: FRAME_ASSET_3 });
    // At 1500ms: graphic-playback overrides graphic-frame (starts at frame 1)
    expect(evaluatedAnimation(linked, 1_500)).toMatchObject({ visible: true, assetId: FRAME_ASSET_1 });
    // At 1750ms: graphic-playback advances to frame 2
    expect(evaluatedAnimation(linked, 1_750)).toMatchObject({ visible: true, assetId: FRAME_ASSET_2 });
    // Outside [1000, 2000): hidden
    expect(evaluatedAnimation(linked, 2_000).visible).toBe(false);
  });

  it('is deterministic across random seek/replay and does not rewrite root motion, depth, audio/dialogue, or spatial parent', () => {
    const base = buildTimeLinkProject({
      layerPatch: {
        parentLayerId: IDS.layerAsset,
        depth: 0.4,
        depthKeys: [
          { timeMs: 0, value: 0.2, interpolationToNext: 'linear' },
          { timeMs: 2_000, value: 0.8, interpolationToNext: 'linear' },
        ],
      },
    });
    const withMotionAndAudio: Project = ProjectSchema.parse({
      ...base,
      assets: [
        ...base.assets,
        {
          id: AUDIO_ASSET_ID,
          kind: 'audio',
          name: 'voice',
          relativePath: 'assets/voice.wav',
          mimeType: 'audio/wav',
          durationMs: 3_000,
        },
      ],
      shots: [
        {
          ...base.shots[0]!,
          audioClips: [
            {
              id: AUDIO_CLIP_ID,
              name: '台词音频',
              role: 'dialogue',
              assetId: AUDIO_ASSET_ID,
              startMs: 500,
              endMs: 2_500,
              offsetMs: 0,
              volume: 1,
            },
          ],
          dialogues: [
            {
              id: DIALOGUE_ID,
              characterId: IDS.character,
              voiceProfileId: IDS.voiceProfile,
              subtitleStyleId: IDS.subtitle,
              audioClipId: AUDIO_CLIP_ID,
              startMs: 500,
              endMs: 2_500,
              text: '测试台词',
            },
          ],
          timelineEvents: [
            ...base.shots[0]!.timelineEvents,
            {
              id: MOVE_EVENT,
              layerId: IDS.animationLayer,
              type: 'move',
              startMs: 0,
              endMs: 2_000,
              from: { x: 100, y: 200 },
              to: { x: 500, y: 200 },
              easing: 'linear',
            },
          ],
        },
      ],
    });

    const linked = setLayerAnimationTimeLink(withMotionAndAudio, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });

    // At t=1000ms: animation source starts at frame 0 (t - 1000 = 0),
    // while root motion move [0, 2000] is at midpoint x=300 and depth is at midpoint 0.5!
    const at1000 = evaluatedAnimation(linked, 1_000);
    expect(at1000.visible).toBe(true);
    expect(at1000.assetId).toBe(FRAME_ASSET_0);
    expect(at1000.x).toBeCloseTo(300, 3);
    expect(at1000.effectiveDepth).toBeCloseTo(0.5, 3);
    expect(at1000.parentSpace).toBeDefined();

    // Random seek order produces identical snapshots (no stateful playback dependency).
    const sampleTimes = [4_500, 1_250, 0, 1_750, 1_000, 2_000, 1_250, 1_000];
    const firstPass = sampleTimes.map((t) => evaluatedAnimation(linked, t));
    const secondPass = [...sampleTimes].reverse().map((t) => evaluatedAnimation(linked, t)).reverse();
    expect(secondPass).toEqual(firstPass);

    // Changing spatial parent does NOT alter animationTimeLink.
    const reparented: Project = ProjectSchema.parse({
      ...linked,
      shots: [
        {
          ...linked.shots[0]!,
          layers: linked.shots[0]!.layers.map((layer) =>
            layer.id === IDS.animationLayer
              ? { ...layer, parentLayerId: IDS.layerChar }
              : layer,
          ),
        },
      ],
    });
    const reparentedLayer = reparented.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(reparentedLayer.animationTimeLink).toEqual({
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });
  });

  it('falls back cleanly to independent playback when source action or character layer is deleted and stays repairable', () => {
    const linked = setLayerAnimationTimeLink(
      buildTimeLinkProject(),
      IDS.shot,
      IDS.animationLayer,
      {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_2,
      },
    );

    // Delete ACTION_EVENT_2
    const brokenEventProject: Project = ProjectSchema.parse({
      ...linked,
      shots: [
        {
          ...linked.shots[0]!,
          timelineEvents: linked.shots[0]!.timelineEvents.filter(
            (event) => event.id !== ACTION_EVENT_2,
          ),
        },
      ],
    });
    const brokenLayer = brokenEventProject.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(resolveLayerAnimationTimeLink(brokenEventProject.shots[0]!, brokenLayer)).toEqual({
      status: 'broken',
      link: {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_2,
      },
    });

    // Falls back to independent startTimeMs=250 without throwing.
    expect(evaluatedAnimation(brokenEventProject, 200).visible).toBe(false);
    expect(evaluatedAnimation(brokenEventProject, 250)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_0,
    });
    expect(evaluatedAnimation(brokenEventProject, 500)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_1,
    });

    // Repairable by re-linking to ACTION_EVENT_1.
    const repaired = setLayerAnimationTimeLink(
      brokenEventProject,
      IDS.shot,
      IDS.animationLayer,
      {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_1,
      },
    );
    expect(evaluatedAnimation(repaired, 500).visible).toBe(false);
    expect(evaluatedAnimation(repaired, 1_000)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_0,
    });

    // Deleting source character layer also resolves as broken & falls back cleanly.
    const deletedCharLayer: Project = ProjectSchema.parse({
      ...repaired,
      shots: [
        {
          ...repaired.shots[0]!,
          layers: repaired.shots[0]!.layers.filter((l) => l.id !== IDS.layerChar),
          timelineEvents: repaired.shots[0]!.timelineEvents.filter((e) => e.layerId !== IDS.layerChar),
        },
      ],
    });
    const brokenByLayer = deletedCharLayer.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(resolveLayerAnimationTimeLink(deletedCharLayer.shots[0]!, brokenByLayer).status).toBe('broken');
    expect(evaluatedAnimation(deletedCharLayer, 250)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_0,
    });
  });

  it('remaps sourceLayerId and eventId when duplicating a Shot', () => {
    const linked = setLayerAnimationTimeLink(
      buildTimeLinkProject(),
      IDS.shot,
      IDS.animationLayer,
      {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_2,
      },
    );

    const shotService = new ShotService();
    const duplicated = shotService.duplicate(linked, IDS.shot);
    expect(duplicated.shots).toHaveLength(2);

    const originalShot = duplicated.shots[0]!;
    const copiedShot = duplicated.shots[1]!;
    const copiedAnimLayer = copiedShot.layers.find((l) => l.source.kind === 'animation')!;
    const copiedCharLayer = copiedShot.layers.find((l) => l.source.kind === 'character')!;

    expect(copiedAnimLayer.animationTimeLink).toBeDefined();
    expect(copiedAnimLayer.animationTimeLink!.sourceLayerId).toBe(copiedCharLayer.id);
    expect(copiedAnimLayer.animationTimeLink!.sourceLayerId).not.toBe(IDS.layerChar);
    expect(copiedAnimLayer.animationTimeLink!.eventId).not.toBe(ACTION_EVENT_2);

    const resolvedCopy = resolveLayerAnimationTimeLink(copiedShot, copiedAnimLayer);
    expect(resolvedCopy).toMatchObject({
      status: 'active',
      startMs: 4_000,
      endMs: 5_000,
    });

    // Original shot stays intact and independent.
    const originalAnimLayer = originalShot.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(originalAnimLayer.animationTimeLink).toEqual({
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_2,
    });
  });

  it('respects 24fps graphic authoring grid vs 60fps export and collects media for delayed linked effects', () => {
    const delayed = setLayerAnimationTimeLink(
      buildTimeLinkProject({
        flaGraphic: true,
        layerPatch: { startTimeMs: 0 },
      }),
      IDS.shot,
      IDS.animationLayer,
      {
        kind: 'character-action',
        sourceLayerId: IDS.layerChar,
        eventId: ACTION_EVENT_2, // [4000, 5000) — hidden at t=0!
      },
    );

    // At 60fps export time 3983ms, 24fps authoring grid is 3958ms (< 4000) -> hidden.
    const beforeWindow = evaluateExportShotAtTime(delayed, delayed.shots[0]!, 3_983);
    expect(beforeWindow.layers.find((l) => l.id === IDS.animationLayer)!.visible).toBe(false);

    // At 60fps export time 4017ms, 24fps authoring grid is 4000ms -> frame 0 visible.
    const atWindowStart = evaluateExportShotAtTime(delayed, delayed.shots[0]!, 4_017);
    expect(atWindowStart.layers.find((l) => l.id === IDS.animationLayer)).toMatchObject({
      visible: true,
      assetId: FRAME_ASSET_0,
    });

    // Export preparation collects all delayed linked effect frames even though layer is hidden at t=0.
    const collectedAssetIds = new Set(
      collectExportPreparationMedia(delayed).map((entry) => entry.asset.id),
    );
    expect(collectedAssetIds.has(FRAME_ASSET_0)).toBe(true);
    expect(collectedAssetIds.has(FRAME_ASSET_1)).toBe(true);
    expect(collectedAssetIds.has(FRAME_ASSET_2)).toBe(true);
    expect(collectedAssetIds.has(FRAME_ASSET_3)).toBe(true);
  });

  it('persists across save/reopen and supports Undo/Redo through EditorProjectStore', () => {
    const initial = buildTimeLinkProject();
    const store = new EditorProjectStore();
    store.open('D:/PandaStage-Acceptance/time-link-test', initial);

    const linked = setLayerAnimationTimeLink(initial, IDS.shot, IDS.animationLayer, {
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });
    store.updateProject(linked, '设置动画动作联动');

    // Save/reopen round-trip
    const persistedJson = JSON.stringify(store.getSnapshot()!.project);
    const reopened = ProjectSchema.parse(JSON.parse(persistedJson));
    const reopenedLayer = reopened.shots[0]!.layers.find((l) => l.id === IDS.animationLayer)!;
    expect(reopenedLayer.animationTimeLink).toEqual({
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });

    // Undo clears the link and restores independent state.
    expect(store.undo()).toBe(true);
    const afterUndo = store.getSnapshot()!.project.shots[0]!.layers.find(
      (l) => l.id === IDS.animationLayer,
    )!;
    expect(afterUndo.animationTimeLink).toBeUndefined();
    expect(afterUndo.startTimeMs).toBe(250);

    // Redo restores the link.
    expect(store.redo()).toBe(true);
    const afterRedo = store.getSnapshot()!.project.shots[0]!.layers.find(
      (l) => l.id === IDS.animationLayer,
    )!;
    expect(afterRedo.animationTimeLink).toEqual({
      kind: 'character-action',
      sourceLayerId: IDS.layerChar,
      eventId: ACTION_EVENT_1,
    });
  });
});
