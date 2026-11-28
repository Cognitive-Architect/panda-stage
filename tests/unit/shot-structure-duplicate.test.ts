import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  ShotService,
  resolveLayerAnimationTimeLink,
  type Project,
  type Shot,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import { ShotManager } from '../../src/renderer/features/shots/ShotManager';

const IDS = {
  project: 'a1000000-0000-4000-8000-000000000000',
  bgAsset: 'a1000000-0000-4000-8000-000000000101',
  charNeutralAsset: 'a1000000-0000-4000-8000-000000000102',
  charHappyAsset: 'a1000000-0000-4000-8000-000000000103',
  dialogueAudioAsset: 'a1000000-0000-4000-8000-000000000104',
  character: 'a1000000-0000-4000-8000-000000000105',
  voiceProfile: 'a1000000-0000-4000-8000-000000000106',
  exprNeutral: 'a1000000-0000-4000-8000-000000000107',
  exprHappy: 'a1000000-0000-4000-8000-000000000108',
  subtitleStyle: 'a1000000-0000-4000-8000-000000000109',
  shot: 'a1000000-0000-4000-8000-000000000110',
  bgLayer: 'a1000000-0000-4000-8000-000000000111',
  charLayer: 'a1000000-0000-4000-8000-000000000112',
  dialogueClip: 'a1000000-0000-4000-8000-000000000113',
  dialogue: 'a1000000-0000-4000-8000-000000000114',
  exprEvent: 'a1000000-0000-4000-8000-000000000115',
  svgAsset: 'a1000000-0000-4000-8000-000000000001',
  graphicDef: 'a1000000-0000-4000-8000-000000000002',
  bgmAsset: 'a1000000-0000-4000-8000-000000000003',
  sfxAsset: 'a1000000-0000-4000-8000-000000000004',
  propAsset: 'a1000000-0000-4000-8000-000000000005',
  mouthPoseRest: 'a1000000-0000-4000-8000-000000000006',
  mouthPoseOpen: 'a1000000-0000-4000-8000-000000000007',
  charAction: 'a1000000-0000-4000-8000-000000000008',
  graphicLayer: 'a1000000-0000-4000-8000-000000000009',
  brokenLinkGraphicLayer: 'a1000000-0000-4000-8000-000000000010',
  propLayer: 'a1000000-0000-4000-8000-000000000011',
  bgmClip: 'a1000000-0000-4000-8000-000000000012',
  sfxClip: 'a1000000-0000-4000-8000-000000000013',
  unboundDialogueClip: 'a1000000-0000-4000-8000-000000000014',
  narratorDialogue: 'a1000000-0000-4000-8000-000000000015',
  charActionEvent: 'a1000000-0000-4000-8000-000000000016',
  moveEvent: 'a1000000-0000-4000-8000-000000000017',
  graphicFrameEvent: 'a1000000-0000-4000-8000-000000000018',
  generatedMouthPoseEvent: 'a1000000-0000-4000-8000-000000000019',
  manualBoundMouthPoseEvent: 'a1000000-0000-4000-8000-000000000020',
  manualFreeMouthPoseEvent: 'a1000000-0000-4000-8000-000000000021',
  mouthCueEvent: 'a1000000-0000-4000-8000-000000000022',
  generationId: 'a1000000-0000-4000-8000-000000000023',
  cameraOverride: 'a1000000-0000-4000-8000-000000000024',
  missingEvent: 'a1000000-0000-4000-8000-000000000099',
} as const;

const NOW = '2026-11-27T09:00:00.000Z';

function predictableService(): ShotService {
  let counter = 0;
  return new ShotService({
    createId: () =>
      `e1416000-0000-4000-8000-${String(++counter).padStart(12, '0')}`,
    now: () => new Date('2026-11-27T10:00:00.000Z'),
  });
}

function buildMinimalProjectWithoutCameraOrBgm(): Project {
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: IDS.project,
    name: 'WF06 Base Project',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    fps: PROJECT_FPS,
    assets: [
      {
        id: IDS.bgAsset,
        kind: 'image',
        name: 'Bamboo Background',
        relativePath: 'assets/images/bamboo-bg.png',
        mimeType: 'image/png',
        sha256: '1'.repeat(64),
        width: 1920,
        height: 1080,
        usage: 'background',
        keywords: [],
      },
      {
        id: IDS.charNeutralAsset,
        kind: 'image',
        name: 'Panda Neutral',
        relativePath: 'assets/images/panda-neutral.png',
        mimeType: 'image/png',
        sha256: '2'.repeat(64),
        width: 512,
        height: 512,
        usage: 'character',
        keywords: [],
      },
      {
        id: IDS.charHappyAsset,
        kind: 'image',
        name: 'Panda Happy',
        relativePath: 'assets/images/panda-happy.png',
        mimeType: 'image/png',
        sha256: '3'.repeat(64),
        width: 512,
        height: 512,
        usage: 'character',
        keywords: [],
      },
      {
        id: IDS.dialogueAudioAsset,
        kind: 'audio',
        name: 'Opening Dialogue',
        relativePath: 'assets/audio/opening.wav',
        mimeType: 'audio/wav',
        sha256: '4'.repeat(64),
        durationMs: 3_000,
      },
    ],
    animations: [],
    characters: [
      {
        id: IDS.character,
        name: 'Panda',
        mode: 'single-image',
        baseAssetId: IDS.charNeutralAsset,
        defaultExpressionId: IDS.exprNeutral,
        defaultVoiceProfileId: IDS.voiceProfile,
        defaultScale: 1,
        defaultFlipX: false,
        expressions: [
          { id: IDS.exprNeutral, name: 'Neutral', assetId: IDS.charNeutralAsset },
          { id: IDS.exprHappy, name: 'Happy', assetId: IDS.charHappyAsset },
        ],
      },
    ],
    voiceProfiles: [
      {
        id: IDS.voiceProfile,
        characterId: IDS.character,
        name: 'Default',
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
    subtitleStyles: [
      {
        id: IDS.subtitleStyle,
        name: 'Default',
        fontFamily: 'Microsoft YaHei',
        fontSize: 42,
        textColor: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 4,
        backgroundColor: '#00000080',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [
      {
        id: IDS.shot,
        name: 'Opening',
        durationMs: 3_000,
        defaultSubtitleStyleId: IDS.subtitleStyle,
        backgroundLayerId: IDS.bgLayer,
        layers: [
          {
            id: IDS.bgLayer,
            name: 'Background',
            source: { kind: 'asset', assetId: IDS.bgAsset },
            anchor: 'center',
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: true,
            flipX: false,
            zIndex: 0,
          },
          {
            id: IDS.charLayer,
            name: 'Panda',
            source: {
              kind: 'character',
              characterId: IDS.character,
              expressionId: IDS.exprNeutral,
            },
            anchor: 'center',
            x: 820,
            y: 620,
            scaleX: 1,
            scaleY: 1,
            rotationDeg: 0,
            opacity: 1,
            visible: true,
            locked: false,
            flipX: false,
            zIndex: 1,
          },
        ],
        audioClips: [
          {
            id: IDS.dialogueClip,
            name: 'Opening Voice',
            assetId: IDS.dialogueAudioAsset,
            role: 'dialogue',
            startMs: 100,
            endMs: 1_200,
            offsetMs: 0,
            volume: 1,
          },
        ],
        dialogues: [
          {
            id: IDS.dialogue,
            characterId: IDS.character,
            voiceProfileId: IDS.voiceProfile,
            audioClipId: IDS.dialogueClip,
            subtitleStyleId: IDS.subtitleStyle,
            startMs: 100,
            endMs: 1_200,
            text: '你好，欢迎来到熊猫舞台！',
          },
        ],
        timelineEvents: [
          {
            id: IDS.exprEvent,
            layerId: IDS.charLayer,
            type: 'expression',
            expressionId: IDS.exprHappy,
            startMs: 300,
            endMs: 1_500,
          },
        ],
      },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function buildRichProject(): Project {
  const base = buildMinimalProjectWithoutCameraOrBgm();
  const baseShot = base.shots[0]!;
  const character = base.characters[0]!;
  const charLayer = baseShot.layers.find((l) => l.source.kind === 'character')!;
  const existingDialogue = baseShot.dialogues[0]!;

  const svgFrameAsset = {
    id: IDS.svgAsset,
    kind: 'image' as const,
    name: 'MagicAura Frame 0',
    relativePath: 'assets/images/magic-aura-0.svg',
    mimeType: 'image/svg+xml' as const,
    sha256: 'a'.repeat(64),
    width: 300,
    height: 300,
    usage: 'effect' as const,
    keywords: [] as string[],
    flaGraphicFrame: {
      definitionId: IDS.graphicDef,
      ordinal: 0,
    },
  };

  const bgmAsset = {
    id: IDS.bgmAsset,
    kind: 'audio' as const,
    name: 'Theme BGM',
    relativePath: 'assets/audio/theme-bgm.wav',
    mimeType: 'audio/wav' as const,
    sha256: 'b'.repeat(64),
    durationMs: 3_000,
  };

  const sfxAsset = {
    id: IDS.sfxAsset,
    kind: 'audio' as const,
    name: 'Whoosh SFX',
    relativePath: 'assets/audio/whoosh-sfx.wav',
    mimeType: 'audio/wav' as const,
    sha256: 'c'.repeat(64),
    durationMs: 1_500,
  };

  const propAsset = {
    id: IDS.propAsset,
    kind: 'image' as const,
    name: 'Teacup Prop',
    relativePath: 'assets/images/teacup.png',
    mimeType: 'image/png' as const,
    sha256: 'd'.repeat(64),
    width: 256,
    height: 256,
    usage: 'prop' as const,
    keywords: [] as string[],
  };

  const frameDurationMs = 1_000 / 24;
  const graphicDefinition = {
    id: IDS.graphicDef,
    kind: 'fla-graphic' as const,
    name: 'MagicAura',
    durationMs: frameDurationMs,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: IDS.svgAsset,
        sha256: 'a'.repeat(64),
        sourceViewport: { x: 0, y: 0, width: 300, height: 300 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: frameDurationMs,
        createdBySequenceImport: false,
      },
    ],
    source: {
      basename: 'magic-aura.fla',
      sha256: 'e'.repeat(64),
      renderTargetId: 'symbol:MagicAura',
      targetKind: 'graphic-symbol' as const,
      targetName: 'MagicAura',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 300, height: 300 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
  };

  const updatedCharacter = {
    ...character,
    mouthPoseSet: {
      poses: [
        {
          id: IDS.mouthPoseRest,
          name: '闭嘴',
          source: { kind: 'image' as const, assetId: IDS.charNeutralAsset },
          target: { kind: 'face' as const },
        },
        {
          id: IDS.mouthPoseOpen,
          name: '张嘴',
          source: { kind: 'image' as const, assetId: IDS.charHappyAsset },
          target: { kind: 'face' as const },
        },
      ],
      restPoseId: IDS.mouthPoseRest,
      analyzerMapping: {
        rest: IDS.mouthPoseRest,
        open: IDS.mouthPoseOpen,
        wide: IDS.mouthPoseOpen,
        round: IDS.mouthPoseOpen,
        closed: IDS.mouthPoseRest,
      },
      driveMode: 'mouth-poses' as const,
    },
    actions: [
      {
        id: IDS.charAction,
        name: '挥手',
        animationId: IDS.graphicDef,
        placement: { offsetX: 0, offsetY: 0, scale: 1 },
      },
    ],
  };

  const enrichedCharLayer = {
    ...charLayer,
    depth: 10,
    depthKeys: [
      { timeMs: 0, value: 10, interpolationToNext: 'linear' as const },
      { timeMs: 1_000, value: 25, interpolationToNext: 'ease-in-out' as const },
    ],
    layerMotionTracks: [
      {
        target: { kind: 'layer' as const, layerId: charLayer.id },
        property: 'transform.offsetX' as const,
        keys: [
          { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
          { timeMs: 1_000, value: 80, interpolationToNext: 'linear' as const },
        ],
      },
    ],
    visualEffects: {
      blend: 'multiply' as const,
      blur: 2,
      glow: { radius: 4, color: '#fff4ad' },
      outline: { radius: 1, color: '#000000' },
      feather: 0,
    },
  };

  const graphicLayer = {
    id: IDS.graphicLayer,
    name: 'MagicAura Layer',
    source: { kind: 'animation' as const, animationId: IDS.graphicDef },
    anchor: 'center' as const,
    x: 640,
    y: 420,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 15,
    opacity: 0.9,
    visible: true,
    locked: false,
    flipX: false,
    zIndex: 2,
    startTimeMs: 200,
    animationFirstFrame: 0,
    animationPlayback: { mode: 'loop' as const, endBehavior: 'hold' as const },
    parentLayerId: charLayer.id,
    parentKeys: [
      { timeMs: 0, parentLayerId: charLayer.id },
      { timeMs: 1_500, parentLayerId: null },
    ],
    depth: -5,
    animationTimeLink: {
      kind: 'character-action' as const,
      sourceLayerId: charLayer.id,
      eventId: IDS.charActionEvent,
      offsetMs: 100,
    },
    flaGraphicInstanceTransformOverrides: {
      '0': {
        '["node-0"]': { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: -8 },
      },
    },
    animationClip: {
      version: 2 as const,
      targetBases: [
        {
          target: { kind: 'layer' as const, layerId: IDS.graphicLayer },
          animationId: IDS.graphicDef,
          baseTransform: { x: 640, y: 420, scaleX: 1, scaleY: 1, rotationDeg: 15 },
          sourceCanvas: { width: 300, height: 300 },
          pivot: { space: 'target-local' as const, x: 150, y: 150 },
        },
      ],
      tracks: [
        {
          target: { kind: 'layer' as const, layerId: IDS.graphicLayer },
          property: 'transform.rotationDeg' as const,
          keys: [
            { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
            { timeMs: 1_000, value: 45, interpolationToNext: 'linear' as const },
          ],
        },
      ],
    },
    visualEffects: {
      blend: 'screen' as const,
      blur: 3,
      glow: { radius: 0, color: '#fff4ad' },
      outline: { radius: 0, color: '#000000' },
      feather: 1,
    },
  };

  const brokenLinkGraphicLayer = {
    id: IDS.brokenLinkGraphicLayer,
    name: 'Detached Effect',
    source: { kind: 'animation' as const, animationId: IDS.graphicDef },
    anchor: 'center' as const,
    x: 1200,
    y: 500,
    scaleX: 1,
    scaleY: 1,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    zIndex: 3,
    startTimeMs: 400,
    animationPlayback: { mode: 'once' as const, endBehavior: 'hide' as const },
    animationTimeLink: {
      kind: 'character-action' as const,
      sourceLayerId: charLayer.id,
      eventId: IDS.missingEvent,
    },
  };

  const propLayer = {
    id: IDS.propLayer,
    name: 'Teacup',
    source: { kind: 'asset' as const, assetId: IDS.propAsset },
    anchor: 'center' as const,
    x: 960,
    y: 780,
    scaleX: 0.5,
    scaleY: 0.5,
    rotationDeg: 0,
    opacity: 1,
    visible: true,
    locked: false,
    flipX: false,
    zIndex: 4,
    cameraSpace: 'screen' as const,
  };

  const enrichedShot: Shot = {
    ...baseShot,
    layers: [
      ...baseShot.layers.map((layer) =>
        layer.id === charLayer.id ? enrichedCharLayer : layer,
      ),
      graphicLayer,
      brokenLinkGraphicLayer,
      propLayer,
    ],
    audioClips: [
      ...baseShot.audioClips,
      {
        id: IDS.unboundDialogueClip,
        name: 'Orphan Voice',
        assetId: IDS.dialogueAudioAsset,
        role: 'dialogue' as const,
        startMs: 1_500,
        endMs: 2_000,
        offsetMs: 0,
        volume: 1,
      },
      {
        id: IDS.bgmClip,
        name: 'Theme BGM',
        assetId: IDS.bgmAsset,
        role: 'bgm' as const,
        startMs: 0,
        endMs: 3_000,
        offsetMs: 0,
        volume: 0.5,
      },
      {
        id: IDS.sfxClip,
        name: 'Whoosh SFX',
        assetId: IDS.sfxAsset,
        role: 'sfx' as const,
        startMs: 500,
        endMs: 1_200,
        offsetMs: 100,
        volume: 0.8,
      },
    ],
    dialogues: [
      ...baseShot.dialogues,
      {
        id: IDS.narratorDialogue,
        speakerType: 'narrator' as const,
        subtitleStyleId: baseShot.defaultSubtitleStyleId,
        startMs: 2_100,
        endMs: 2_800,
        text: '旁白测试台词',
      },
    ],
    timelineEvents: [
      ...baseShot.timelineEvents,
      {
        id: IDS.charActionEvent,
        layerId: charLayer.id,
        type: 'character-action' as const,
        actionId: IDS.charAction,
        startMs: 200,
        endMs: 1_200,
      },
      {
        id: IDS.moveEvent,
        layerId: propLayer.id,
        type: 'move' as const,
        startMs: 0,
        endMs: 1_000,
        from: { x: 960, y: 780 },
        to: { x: 1060, y: 740 },
        easing: 'ease-in-out' as const,
      },
      {
        id: IDS.graphicFrameEvent,
        layerId: graphicLayer.id,
        type: 'graphic-frame' as const,
        animationId: IDS.graphicDef,
        sourceFrameIndex: 0,
        startMs: 500,
        endMs: 500,
      },
      {
        id: IDS.generatedMouthPoseEvent,
        layerId: charLayer.id,
        type: 'mouth-pose' as const,
        poseId: IDS.mouthPoseOpen,
        origin: 'generated' as const,
        dialogueId: existingDialogue.id,
        generationId: IDS.generationId,
        startMs: existingDialogue.startMs,
        endMs: existingDialogue.startMs + 200,
      },
      {
        id: IDS.manualBoundMouthPoseEvent,
        layerId: charLayer.id,
        type: 'mouth-pose' as const,
        poseId: IDS.mouthPoseRest,
        origin: 'manual' as const,
        dialogueId: existingDialogue.id,
        startMs: existingDialogue.startMs + 200,
        endMs: existingDialogue.startMs + 400,
      },
      {
        id: IDS.manualFreeMouthPoseEvent,
        layerId: charLayer.id,
        type: 'mouth-pose' as const,
        poseId: IDS.mouthPoseOpen,
        origin: 'manual' as const,
        startMs: 1_500,
        endMs: 1_800,
      },
      {
        id: IDS.mouthCueEvent,
        layerId: charLayer.id,
        type: 'mouth-cue' as const,
        state: 'open' as const,
        startMs: 1_900,
        endMs: 1_900,
      },
    ],
    camera: {
      mode: 'hybrid' as const,
      keys: [
        {
          timeMs: 0,
          centerX: 960,
          centerY: 540,
          zoom: 1,
          rotationDeg: 0,
          interpolationToNext: 'ease-in-out' as const,
          curveToNext: { bezier: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 } },
        },
        {
          timeMs: 1_500,
          centerX: 880,
          centerY: 500,
          zoom: 1.25,
          rotationDeg: 4,
          interpolationToNext: 'linear' as const,
        },
      ],
      overrides: [
        {
          id: IDS.cameraOverride,
          startMs: 250,
          endMs: 1_600,
          blendInMs: 200,
          blendOutMs: 250,
          easingIn: 'ease-out' as const,
          easingOut: 'ease-in' as const,
        },
      ],
      autoFraming: {
        zoom: 1.35,
        targetU: 0.45,
        targetV: 0.42,
      },
    },
  };

  return ProjectSchema.parse({
    ...base,
    assets: [...base.assets, svgFrameAsset, bgmAsset, sfxAsset, propAsset],
    animations: [...base.animations, graphicDefinition],
    characters: [updatedCharacter],
    shots: [enrichedShot],
  });
}

function collectShotEntityIds(shot: Shot): Set<string> {
  return new Set([
    shot.id,
    ...shot.layers.map((layer) => layer.id),
    ...shot.audioClips.map((clip) => clip.id),
    ...shot.dialogues.map((dialogue) => dialogue.id),
    ...shot.timelineEvents.map((event) => event.id),
    ...(shot.camera?.overrides?.map((override) => override.id) ?? []),
  ]);
}

describe('WF-06 structure-only shot duplication (Issue #1416)', () => {
  it('duplicates staging, Graphic, parenting, depth, visual effects, camera, and independent actions while excluding dialogues and bound audio', () => {
    const project = buildRichProject();
    const sourceShotId = project.shots[0]!.id;
    const duplicated = predictableService().duplicate(project, sourceShotId, {
      mode: 'structure-only',
    });

    expect(ProjectSchema.parse(duplicated)).toEqual(duplicated);
    expect(duplicated.shots).toHaveLength(2);
    // Project definitions and assets are shared without duplicating files or entries.
    expect(duplicated.assets).toEqual(project.assets);
    expect(duplicated.animations).toEqual(project.animations);
    expect(duplicated.characters).toEqual(project.characters);

    const source = duplicated.shots[0]!;
    const copy = duplicated.shots[1]!;
    expect(copy.name).toBe('Opening 结构副本');
    expect(copy.durationMs).toBe(source.durationMs);

    // Globally unique IDs, zero overlap with source (including camera overrides).
    const sourceIds = collectShotEntityIds(source);
    const copyIds = collectShotEntityIds(copy);
    for (const id of copyIds) {
      expect(sourceIds.has(id)).toBe(false);
    }

    // Dialogues and all audio clips excluded by default.
    expect(copy.dialogues).toEqual([]);
    expect(copy.audioClips).toEqual([]);

    // Layer order, background, Graphic, parenting, depth, visual effects preserved & remapped.
    expect(copy.layers.map((l) => l.name)).toEqual(source.layers.map((l) => l.name));
    expect(copy.layers.map((l) => l.zIndex)).toEqual(source.layers.map((l) => l.zIndex));
    expect(copy.backgroundLayerId).not.toBeNull();
    expect(copy.backgroundLayerId).not.toBe(source.backgroundLayerId);
    expect(copy.layers.some((l) => l.id === copy.backgroundLayerId)).toBe(true);

    const copyCharLayer = copy.layers.find((l) => l.source.kind === 'character')!;
    const copyGraphicLayer = copy.layers.find((l) => l.name === 'MagicAura Layer')!;
    const copyDetachedGraphicLayer = copy.layers.find((l) => l.name === 'Detached Effect')!;

    expect(copyCharLayer.depth).toBe(10);
    expect(copyCharLayer.depthKeys).toEqual(
      source.layers.find((l) => l.source.kind === 'character')!.depthKeys,
    );
    expect(copyCharLayer.layerMotionTracks?.[0]?.target.layerId).toBe(copyCharLayer.id);
    expect(copyCharLayer.visualEffects).toEqual({
      blend: 'multiply',
      blur: 2,
      glow: { radius: 4, color: '#fff4ad' },
      outline: { radius: 1, color: '#000000' },
      feather: 0,
    });

    expect(copyGraphicLayer.parentLayerId).toBe(copyCharLayer.id);
    expect(copyGraphicLayer.parentKeys).toEqual([
      { timeMs: 0, parentLayerId: copyCharLayer.id },
      { timeMs: 1_500, parentLayerId: null },
    ]);
    expect(copyGraphicLayer.animationClip?.version).toBe(2);
    expect(copyGraphicLayer.animationClip?.targetBases[0]?.target.layerId).toBe(
      copyGraphicLayer.id,
    );
    expect(copyGraphicLayer.animationClip?.tracks[0]?.target.layerId).toBe(
      copyGraphicLayer.id,
    );
    expect(copyGraphicLayer.flaGraphicInstanceTransformOverrides).toEqual({
      '0': {
        '["node-0"]': { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: -8 },
      },
    });

    // Valid animationTimeLink remapped to new character layer + new character-action event.
    const resolvedLink = resolveLayerAnimationTimeLink(copy, copyGraphicLayer);
    expect(resolvedLink.status).toBe('active');
    expect(copyGraphicLayer.animationTimeLink?.sourceLayerId).toBe(copyCharLayer.id);
    expect(copyGraphicLayer.animationTimeLink?.offsetMs).toBe(100);
    expect(
      copy.timelineEvents.some(
        (e) =>
          e.type === 'character-action' &&
          e.id === copyGraphicLayer.animationTimeLink?.eventId &&
          e.layerId === copyCharLayer.id,
      ),
    ).toBe(true);

    // Broken animationTimeLink cleanly detached while keeping independent playback settings.
    expect(copyDetachedGraphicLayer.animationTimeLink).toBeUndefined();
    expect(copyDetachedGraphicLayer.startTimeMs).toBe(400);
    expect(copyDetachedGraphicLayer.animationPlayback).toEqual({
      mode: 'once',
      endBehavior: 'hide',
    });

    // Camera mode, keys/curves, autoFraming preserved; override IDs remapped.
    expect(copy.camera?.mode).toBe('hybrid');
    expect(copy.camera?.keys).toEqual(source.camera?.keys);
    expect(copy.camera?.autoFraming).toEqual(source.camera?.autoFraming);
    expect(copy.camera?.overrides).toHaveLength(1);
    expect(copy.camera?.overrides?.[0]?.id).not.toBe(source.camera?.overrides?.[0]?.id);
    expect(copy.camera?.overrides?.[0]?.startMs).toBe(250);
    expect(copy.camera?.overrides?.[0]?.endMs).toBe(1_600);

    // Dialogue-bound mouth-pose events excluded; independent events retained.
    const retainedTypes = copy.timelineEvents.map((e) => e.type);
    expect(retainedTypes).toContain('expression');
    expect(retainedTypes).toContain('character-action');
    expect(retainedTypes).toContain('move');
    expect(retainedTypes).toContain('graphic-frame');
    expect(retainedTypes).toContain('mouth-cue');
    const copyMouthPoses = copy.timelineEvents.filter((e) => e.type === 'mouth-pose');
    expect(copyMouthPoses).toHaveLength(1);
    expect(copyMouthPoses[0]).toMatchObject({
      origin: 'manual',
      startMs: 1_500,
      endMs: 1_800,
    });
    expect(copyMouthPoses[0]?.dialogueId).toBeUndefined();

    // Source isolation: mutating nested objects in copy must not affect source.
    copyGraphicLayer.flaGraphicInstanceTransformOverrides!['0']!['["node-0"]']!.tx = 999;
    copy.camera!.keys[0]!.zoom = 3.5;
    copy.camera!.overrides![0]!.endMs = 2_000;
    expect(
      source.layers.find((l) => l.name === 'MagicAura Layer')!
        .flaGraphicInstanceTransformOverrides!['0']!['["node-0"]']!.tx,
    ).toBe(12);
    expect(source.camera!.keys[0]!.zoom).toBe(1);
    expect(source.camera!.overrides![0]!.endMs).toBe(1_600);
  });

  it('retains only BGM/SFX clips when includeNonDialogueAudio is true, excluding all dialogue clips', () => {
    const project = buildRichProject();
    const duplicated = predictableService().duplicate(
      project,
      project.shots[0]!.id,
      {
        mode: 'structure-only',
        includeNonDialogueAudio: true,
      },
    );

    expect(ProjectSchema.parse(duplicated)).toEqual(duplicated);
    const source = duplicated.shots[0]!;
    const copy = duplicated.shots[1]!;

    expect(copy.dialogues).toEqual([]);
    expect(copy.audioClips.map((c) => c.role)).toEqual(['bgm', 'sfx']);
    expect(copy.audioClips.map((c) => c.name)).toEqual(['Theme BGM', 'Whoosh SFX']);
    for (const clip of copy.audioClips) {
      expect(source.audioClips.some((src) => src.id === clip.id)).toBe(false);
    }
  });

  it('does not rebuild a default camera when source shot has no camera', () => {
    const base = buildMinimalProjectWithoutCameraOrBgm();
    expect(base.shots[0]!.camera).toBeUndefined();

    const duplicated = predictableService().duplicate(base, base.shots[0]!.id, {
      mode: 'structure-only',
    });

    expect(duplicated.shots[1]!.camera).toBeUndefined();
    expect(duplicated.shots[1]!.dialogues).toEqual([]);
    expect(duplicated.shots[1]!.audioClips).toEqual([]);
  });

  it('keeps full duplicate behavior unchanged while remapping camera override IDs', () => {
    const project = buildRichProject();
    const duplicated = predictableService().duplicate(project, project.shots[0]!.id);
    const source = duplicated.shots[0]!;
    const copy = duplicated.shots[1]!;

    expect(ProjectSchema.parse(duplicated)).toEqual(duplicated);
    expect(copy.name).toBe('Opening 副本');
    expect(copy.dialogues).toHaveLength(source.dialogues.length);
    expect(copy.audioClips).toHaveLength(source.audioClips.length);
    expect(copy.timelineEvents).toHaveLength(source.timelineEvents.length);
    expect(copy.camera?.overrides?.[0]?.id).not.toBe(source.camera?.overrides?.[0]?.id);
  });

  it('commits structure-only duplicate as one EditorProjectStore Undo/Redo entry and selects the new shot', () => {
    const editor = new EditorProjectStore();
    const store = new ShotStore(editor, predictableService());
    const project = buildRichProject();
    editor.open('D:\\wf06.pandastage', project);

    const sourceId = project.shots[0]!.id;
    store.duplicate(sourceId, { mode: 'structure-only' });

    const afterDuplicate = editor.getSnapshot()!;
    expect(afterDuplicate.revision).toBe(1);
    expect(afterDuplicate.project.shots).toHaveLength(2);
    const copyId = afterDuplicate.project.shots[1]!.id;
    expect(store.getCurrentShotId()).toBe(copyId);
    expect(afterDuplicate.project.shots[1]!.dialogues).toEqual([]);

    expect(editor.undo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots).toHaveLength(1);
    expect(store.getCurrentShotId()).toBe(sourceId);

    expect(editor.redo()).toBe(true);
    expect(editor.getSnapshot()!.project.shots).toHaveLength(2);
    expect(editor.getSnapshot()!.project.shots[1]!.id).toBe(copyId);
    store.dispose();
  });

  it('exposes structure-only duplicate actions in ShotManager (both default and landscape) and gates BGM/SFX option on presence', () => {
    const projectWithAudio = buildRichProject();
    const projectWithoutNonDialogue = buildMinimalProjectWithoutCameraOrBgm();

    const landscapeWithAudio = renderToStaticMarkup(
      createElement(ShotManager, {
        presentation: 'landscape',
        snapshot: {
          projectRoot: 'D:\\wf06.pandastage',
          project: projectWithAudio,
          dirty: false,
          revision: 0,
        },
      }),
    );
    expect(landscapeWithAudio).toContain('data-testid="shot-quick-duplicate"');
    expect(landscapeWithAudio).toContain('data-testid="shot-quick-duplicate-structure"');
    expect(landscapeWithAudio).toContain('仅复制布景与动作');
    expect(landscapeWithAudio).toContain('data-testid="shot-quick-duplicate-structure-with-audio"');
    expect(landscapeWithAudio).toContain('复制结构并保留 BGM/音效');

    const landscapeNoBgm = renderToStaticMarkup(
      createElement(ShotManager, {
        presentation: 'landscape',
        snapshot: {
          projectRoot: 'D:\\wf06.pandastage',
          project: projectWithoutNonDialogue,
          dirty: false,
          revision: 0,
        },
      }),
    );
    expect(landscapeNoBgm).toContain('data-testid="shot-quick-duplicate-structure"');
    expect(landscapeNoBgm).not.toContain('data-testid="shot-quick-duplicate-structure-with-audio"');

    const defaultEditorMarkup = renderToStaticMarkup(
      createElement(ShotManager, {
        snapshot: {
          projectRoot: 'D:\\wf06.pandastage',
          project: projectWithAudio,
          dirty: false,
          revision: 0,
        },
      }),
    );
    expect(defaultEditorMarkup).toContain('复制镜头');
    expect(defaultEditorMarkup).toContain('data-testid="shot-duplicate-structure-button"');
    expect(defaultEditorMarkup).toContain('data-testid="shot-duplicate-structure-with-audio-button"');
  });
});
