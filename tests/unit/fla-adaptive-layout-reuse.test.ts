// @vitest-environment happy-dom
import { randomUUID } from 'node:crypto';
import { createElement, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAdaptivePartsFromFlaGraphicSubtrees,
  CharacterService,
  LayerService,
  ProjectSchema,
  resolveLayerVisualParts,
  type AdaptivePartsCharacter,
  type FlaGraphicAuthorPoseResolution,
  type FlaGraphicDefinition,
  type FlaGraphicSavedLayoutResolution,
  type FlaGraphicStructure,
  type Project,
} from '../../src/domain';
import { buildProject, IDS } from './domain/testProject';
import {
  createAdaptiveCharacterFromFlaGraphic,
  formatFlaGraphicSkippedSummary,
} from '../../src/renderer/features/fla-import/createAdaptiveCharacterFromGraphic';
import { CharacterManager } from '../../src/renderer/features/characters/CharacterManager';
import { FlaGraphicInstanceWorkbench } from '../../src/renderer/fla-import/FlaGraphicInstanceWorkbench';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { characterStore } from '../../src/renderer/stores/characterStore';
import { characterAssemblySessionStore } from '../../src/renderer/stores/characterAssemblySessionStore';
import type { FlaCharacterImportAttempt } from '../../src/renderer/features/fla-import/FlaCharacterImportFlow';
import {
  FLA_PARSER_COMMIT,
  FLA_PARSER_ENTRYPOINT,
  FLA_PARSER_PACKAGE,
  type FlaInspectionResponse,
} from '../../src/shared/fla-import-api';
import type { FlaPartPreviewResponse } from '../../src/shared/fla-part-preview-api';
import type {
  FlaRenderTarget,
  FlaRenderableTargetCatalogResponse,
} from '../../src/shared/fla-static-snapshot-api';

const IDENTITY = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } as const;
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const GRAPHIC_MAIN_ID = '71000000-0000-4000-8000-000000000001';
const GRAPHIC_ALT_ID = '71000000-0000-4000-8000-000000000002';
const TEMPLATE_CHAR_A_ID = '21000000-0000-4000-8000-000000000001';
const TEMPLATE_CHAR_B_ID = '21000000-0000-4000-8000-000000000002';

let activeRoot: Root | null = null;
let activeContainer: HTMLDivElement | null = null;

function makeBaseProject(): Project {
  const base = buildProject();
  return {
    ...base,
    assets: base.assets.map((asset) =>
      asset.kind === 'image' && !('sha256' in asset && asset.sha256)
        ? { ...asset, sha256: SHA_B }
        : asset,
    ),
  };
}

function shapeLeaf(
  id: string,
  drawOrder: number,
  sourceRef: string | undefined,
  localTransform: { a: number; b: number; c: number; d: number; tx: number; ty: number } = IDENTITY,
  fallbackViewBox = { x: 0, y: 0, width: 40, height: 40 },
) {
  return {
    id,
    sourceAddress: `graphic/${id}`,
    drawOrder,
    localTransform: { ...localTransform },
    type: 'opaque' as const,
    opaqueKind: 'shape' as const,
    ...(sourceRef ? { sourceRef } : {}),
    fallbackScope: 'subtree' as const,
    fallbackAssetId: IDS.assetBg,
    fallbackViewBox: { ...fallbackViewBox },
  };
}

function makeGraphicDefinition(
  id: string,
  name: string,
  structure: FlaGraphicStructure,
  sha256 = SHA_A,
): FlaGraphicDefinition {
  const durationMs = Math.max(1, structure.frames.length) * 100;
  const frames = structure.frames.map((_frame, index) => ({
    ordinal: index,
    sourceFrameIndex: index,
    assetId: IDS.assetBg,
    sha256: SHA_B,
    sourceViewport: { x: 0, y: 0, width: 800, height: 800 },
    offset: { x: 0, y: 0 },
    startMs: index * 100,
    durationMs: 100,
    createdBySequenceImport: false,
  }));
  return {
    id,
    name,
    kind: 'fla-graphic',
    source: {
      basename: 'layout-reuse.fla',
      sha256,
      renderTargetId: `fla-render-target-${id}`,
      targetKind: 'graphic-symbol',
      targetName: name,
      startFrameIndex: 0,
      endFrameIndex: Math.max(0, frames.length - 1),
      sourceFps: 10,
      canvas: { width: 800, height: 800 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1280, height: 720 },
    },
    durationMs,
    structure,
    frames,
  };
}

function makeScatteredSingleFrameStructure(): FlaGraphicStructure {
  return {
    version: 1,
    symbolDefinitions: {
      head_sym: {
        symbolRef: 'parts/head',
        children: [shapeLeaf('def-head', 0, 'shape-head', IDENTITY, { x: -20, y: -20, width: 40, height: 40 })],
      },
      torso_sym: {
        symbolRef: 'parts/torso',
        children: [shapeLeaf('def-torso', 0, 'shape-torso', IDENTITY, { x: -25, y: -35, width: 50, height: 70 })],
      },
      arm_l_sym: {
        symbolRef: 'parts/arm_l',
        children: [shapeLeaf('def-arm-l', 0, 'shape-arm-l', IDENTITY, { x: -10, y: -30, width: 20, height: 60 })],
      },
      arm_r_sym: {
        symbolRef: 'parts/arm_r',
        children: [shapeLeaf('def-arm-r', 0, 'shape-arm-r', IDENTITY, { x: -10, y: -30, width: 20, height: 60 })],
      },
    },
    frames: [
      {
        ordinal: 0,
        layers: [
          {
            name: 'Scattered',
            nodes: [
              {
                id: 'f0-head',
                sourceAddress: 'f0/head',
                drawOrder: 0,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 40, ty: 40 },
                type: 'symbol',
                symbolRef: 'parts/head',
                nestedDefinitionId: 'head_sym',
              },
              {
                id: 'f0-torso',
                sourceAddress: 'f0/torso',
                drawOrder: 1,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 160, ty: 40 },
                type: 'symbol',
                symbolRef: 'parts/torso',
                nestedDefinitionId: 'torso_sym',
              },
              {
                id: 'f0-arm-l',
                sourceAddress: 'f0/arm-l',
                drawOrder: 2,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 280, ty: 40 },
                type: 'symbol',
                symbolRef: 'parts/arm_l',
                nestedDefinitionId: 'arm_l_sym',
              },
              {
                id: 'f0-arm-r',
                sourceAddress: 'f0/arm-r',
                drawOrder: 3,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 40 },
                type: 'symbol',
                symbolRef: 'parts/arm_r',
                nestedDefinitionId: 'arm_r_sym',
              },
            ],
          },
        ],
      },
    ],
  };
}

function makeTemplateVoiceProfile(characterId: string, voiceProfileId: string) {
  return {
    id: voiceProfileId,
    name: '模板配音',
    characterId,
    locale: 'zh-CN',
    rate: 1,
    pitch: 0,
  };
}

function makeSavedTemplateCharacter(input: {
  readonly id: string;
  readonly name: string;
  readonly animationId: string;
  readonly voiceProfileId?: string;
  readonly headTx: number;
  readonly headTy: number;
  readonly torsoTx: number;
  readonly torsoTy: number;
  readonly armLTx: number;
  readonly armLTy: number;
  readonly armRTx: number;
  readonly armRTy: number;
}): AdaptivePartsCharacter {
  return {
    id: input.id,
    name: input.name,
    mode: 'adaptive-parts',
    defaultVoiceProfileId: input.voiceProfileId ?? `31000000-0000-4000-8000-${input.id.slice(-12)}`,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { ...IDENTITY },
    parts: [
      {
        partId: `${input.id.slice(0, 8)}-0000-4000-8000-000000000001`.slice(0, 36),
        source: { kind: 'source-instance', sourceId: 'tpl-head', sourcePoseFrame: 0, effectiveFrame: 0 },
        visualSource: { kind: 'fla-graphic', animationId: input.animationId, nodePath: ['f0-head'], poseFrameOrdinal: 0 },
        sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.headTx, ty: input.headTy },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.headTx, ty: input.headTy },
        staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
        drawOrder: 0,
        visible: true,
        displayName: 'Head',
      },
      {
        partId: `${input.id.slice(0, 8)}-0000-4000-8000-000000000002`.slice(0, 36),
        source: { kind: 'source-instance', sourceId: 'tpl-torso', sourcePoseFrame: 0, effectiveFrame: 0 },
        visualSource: { kind: 'fla-graphic', animationId: input.animationId, nodePath: ['f0-torso'], poseFrameOrdinal: 0 },
        sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.torsoTx, ty: input.torsoTy },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.torsoTx, ty: input.torsoTy },
        staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
        drawOrder: 1,
        visible: true,
        displayName: 'Torso',
      },
      {
        partId: `${input.id.slice(0, 8)}-0000-4000-8000-000000000003`.slice(0, 36),
        source: { kind: 'source-instance', sourceId: 'tpl-arml', sourcePoseFrame: 0, effectiveFrame: 0 },
        visualSource: { kind: 'fla-graphic', animationId: input.animationId, nodePath: ['f0-arm-l'], poseFrameOrdinal: 0 },
        sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.armLTx, ty: input.armLTy },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.armLTx, ty: input.armLTy },
        staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
        drawOrder: 2,
        visible: true,
        displayName: 'Arm L',
      },
      {
        partId: `${input.id.slice(0, 8)}-0000-4000-8000-000000000004`.slice(0, 36),
        source: { kind: 'source-instance', sourceId: 'tpl-armr', sourcePoseFrame: 0, effectiveFrame: 0 },
        visualSource: { kind: 'fla-graphic', animationId: input.animationId, nodePath: ['f0-arm-r'], poseFrameOrdinal: 0 },
        sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.armRTx, ty: input.armRTy },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: input.armRTx, ty: input.armRTy },
        staticAdjustment: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0 },
        drawOrder: 3,
        visible: true,
        displayName: 'Arm R',
      },
    ],
  };
}

afterEach(async () => {
  characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
  if (activeRoot) {
    const r = activeRoot;
    activeRoot = null;
    await act(async () => r.unmount());
  }
  activeContainer?.remove();
  activeContainer = null;
  vi.restoreAllMocks();
});

describe('FLA Graphic V2-B Saved Layout / Template Reuse + Joint A->B (#1207)', () => {
  it('places >=2 parts automatically from a saved same-source AdaptiveParts character when FLA lacks an author pose', () => {
    const definition = makeGraphicDefinition(
      GRAPHIC_MAIN_ID,
      'ScatteredHeroNoRef',
      makeScatteredSingleFrameStructure(),
    );
    // Saved template character arranged all 4 parts coherently (head moved +260,+80, etc.).
    const templateChar = makeSavedTemplateCharacter({
      id: TEMPLATE_CHAR_A_ID,
      name: '已拼好英雄模板',
      animationId: GRAPHIC_MAIN_ID,
      headTx: 260,
      headTy: 80,
      torsoTx: 140,
      torsoTy: 150,
      armLTx: -10,
      armLTy: 145,
      armRTx: -60,
      armRTy: 145,
    });
    const base = makeBaseProject();
    const project: Project = {
      ...base,
      animations: [definition],
      characters: [...base.characters, templateChar],
      voiceProfiles: [
        ...base.voiceProfiles,
        makeTemplateVoiceProfile(templateChar.id, templateChar.defaultVoiceProfileId),
      ],
    };

    let aRes: FlaGraphicAuthorPoseResolution | null = null;
    let bRes: FlaGraphicSavedLayoutResolution | null = null;
    const result = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: [
        { nodePath: ['f0-head'], label: 'Head' },
        { nodePath: ['f0-torso'], label: 'Torso' },
        { nodePath: ['f0-arm-l'], label: 'Arm L' },
        { nodePath: ['f0-arm-r'], label: 'Arm R' },
      ],
      applyAuthorPose: true,
      onAuthorPoseResolved: (r) => {
        aRes = r;
      },
      applySavedLayoutReuse: true,
      onSavedLayoutResolved: (r) => {
        bRes = r;
      },
    });

    expect(aRes!.matchedCount).toBe(0);
    expect(bRes!.matchedCount).toBe(4);
    expect(bRes!.selectedTemplate?.templateCharacterId).toBe(TEMPLATE_CHAR_A_ID);

    expect(result.parts[0]!.restTransform.tx).toBeCloseTo(260, 4);
    expect(result.parts[0]!.restTransform.ty).toBeCloseTo(80, 4);
    expect(result.parts[1]!.restTransform.tx).toBeCloseTo(140, 4);
    expect(result.parts[1]!.restTransform.ty).toBeCloseTo(150, 4);
    expect(result.parts[2]!.restTransform.tx).toBeCloseTo(-10, 4);
    expect(result.parts[3]!.restTransform.tx).toBeCloseTo(-60, 4);

    // Saved character, persisted Shot layer, and original Graphic Definition remain valid and independent.
    const saved = ProjectSchema.parse(new CharacterService().createAdaptiveParts(project, result));
    const createdChar = saved.characters.find((c) => c.name === result.name)!;
    const withLayer = new LayerService().createFromAdaptiveCharacter(
      saved,
      saved.shots[0]!.id,
      createdChar.id,
      { x: 640, y: 360 },
    ).project;
    const visual = resolveLayerVisualParts(withLayer, withLayer.shots[0]!, {
      id: withLayer.shots[0]!.layers.at(-1)!.id,
      assetId: '',
      currentExpressionId: null,
      mouthOverrideAssetId: null,
      anchor: 'center',
      x: 640,
      y: 360,
      scaleX: 1,
      scaleY: 1,
      flipX: false,
      rotationDeg: 0,
      opacity: 1,
      visible: true,
      zIndex: 0,
    });
    expect(visual.kind).toBe('adaptive-parts-character');
    expect(visual.parts).toHaveLength(4);
    expect(withLayer.characters.find((c) => c.id === TEMPLATE_CHAR_A_ID)).toEqual(templateChar);
    expect(withLayer.animations[0]).toEqual(definition);
  });

  it('enforces A -> B priority so B only fills parts left unmatched by A and never overwrites A placements', () => {
    // Graphic has 2 frames: Frame 1 (author pose) ONLY has Head + Torso placed at (200, 100) and (200, 170).
    // Saved template character has ALL 4 parts placed with Head at (900, 900), Arm L at (150, 165), Arm R at (250, 165).
    const scatteredAndPartialRef: FlaGraphicStructure = {
      ...makeScatteredSingleFrameStructure(),
      frames: [
        ...makeScatteredSingleFrameStructure().frames,
        {
          ordinal: 1,
          layers: [
            {
              name: 'PartialAuthorPose',
              nodes: [
                {
                  id: 'f1-head',
                  sourceAddress: 'f1/head',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 200, ty: 100 },
                  type: 'symbol',
                  symbolRef: 'parts/head',
                  nestedDefinitionId: 'head_sym',
                },
                {
                  id: 'f1-torso',
                  sourceAddress: 'f1/torso',
                  drawOrder: 1,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 200, ty: 170 },
                  type: 'symbol',
                  symbolRef: 'parts/torso',
                  nestedDefinitionId: 'torso_sym',
                },
              ],
            },
          ],
        },
      ],
    };

    const definition = makeGraphicDefinition(GRAPHIC_MAIN_ID, 'PartialAuthorPoseHero', scatteredAndPartialRef);
    const templateChar = makeSavedTemplateCharacter({
      id: TEMPLATE_CHAR_A_ID,
      name: '全套模板角色',
      animationId: GRAPHIC_MAIN_ID,
      headTx: 500, // Differs from A's delta (+160, +60); B MUST NOT overwrite Head!
      headTy: 500,
      torsoTx: 380,
      torsoTy: 570,
      armLTx: 150,
      armLTy: 165,
      armRTx: 250,
      armRTy: 165,
    });
    const base = makeBaseProject();
    const project: Project = {
      ...base,
      animations: [definition],
      characters: [...base.characters, templateChar],
      voiceProfiles: [
        ...base.voiceProfiles,
        makeTemplateVoiceProfile(templateChar.id, templateChar.defaultVoiceProfileId),
      ],
    };

    let aRes: FlaGraphicAuthorPoseResolution | null = null;
    let bRes: FlaGraphicSavedLayoutResolution | null = null;
    const result = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition,
      frameOrdinal: 0,
      selections: [
        { nodePath: ['f0-head'], label: 'Head' },
        { nodePath: ['f0-torso'], label: 'Torso' },
        { nodePath: ['f0-arm-l'], label: 'Arm L' },
        { nodePath: ['f0-arm-r'], label: 'Arm R' },
      ],
      applyAuthorPose: true,
      onAuthorPoseResolved: (r) => {
        aRes = r;
      },
      applySavedLayoutReuse: true,
      onSavedLayoutResolved: (r) => {
        bRes = r;
      },
    });

    expect(aRes!.matchedCount).toBe(2);
    expect(bRes!.matchedCount).toBe(2);
    expect(bRes!.skippedReasons.get(0)).toBe('locked-by-author-pose');
    expect(bRes!.skippedReasons.get(1)).toBe('locked-by-author-pose');

    // Head and Torso keep A's deltas (+160/+60 and +40/+130), NOT B's +500/+500.
    expect(result.parts[0]!.restTransform.tx).toBeCloseTo(160, 4);
    expect(result.parts[0]!.restTransform.ty).toBeCloseTo(60, 4);
    expect(result.parts[1]!.restTransform.tx).toBeCloseTo(40, 4);
    expect(result.parts[1]!.restTransform.ty).toBeCloseTo(130, 4);

    // Arm L and Arm R moved out of IDENTITY using B's saved template alignment!
    expect(result.parts[2]!.restTransform.tx).not.toBe(0);
    expect(result.parts[3]!.restTransform.tx).not.toBe(0);
  });

  it('rejects same-name different-source, duplicate symbolRefs, extreme size mismatch, missing bounds, and singular template transforms locally', () => {
    const targetDef = makeGraphicDefinition(GRAPHIC_MAIN_ID, 'TargetVariant', {
      version: 1,
      symbolDefinitions: {
        head_sym: {
          symbolRef: 'parts/head',
          children: [shapeLeaf('d-head', 0, 's-head', IDENTITY, { x: -20, y: -20, width: 40, height: 40 })],
        },
        torso_sym: {
          symbolRef: 'parts/torso',
          children: [shapeLeaf('d-torso', 0, 's-torso', IDENTITY, { x: -25, y: -35, width: 50, height: 70 })],
        },
        sleeve_sym: {
          symbolRef: 'parts/sleeve',
          children: [shapeLeaf('d-sleeve', 0, 's-sleeve', IDENTITY, { x: -10, y: -20, width: 20, height: 40 })],
        },
        hair_a_sym: {
          symbolRef: 'parts/hair_a',
          children: [shapeLeaf('d-hair-a', 0, 's-hair-a', IDENTITY, { x: -20, y: -20, width: 40, height: 40 })],
        },
        giant_prop_sym: {
          symbolRef: 'parts/prop',
          // Target is 200x20 wide horizontal bar
          children: [shapeLeaf('d-prop-tgt', 0, 's-prop-tgt', IDENTITY, { x: -100, y: -10, width: 200, height: 20 })],
        },
        singular_sym: {
          symbolRef: 'parts/badge',
          children: [shapeLeaf('d-badge', 0, 's-badge', IDENTITY, { x: -10, y: -10, width: 20, height: 20 })],
        },
      },
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Layer 1',
              nodes: [
                { id: 't-head', sourceAddress: 't/0', drawOrder: 0, localTransform: { ...IDENTITY, tx: 20, ty: 20 }, type: 'symbol', symbolRef: 'parts/head', nestedDefinitionId: 'head_sym' },
                { id: 't-torso', sourceAddress: 't/1', drawOrder: 1, localTransform: { ...IDENTITY, tx: 100, ty: 20 }, type: 'symbol', symbolRef: 'parts/torso', nestedDefinitionId: 'torso_sym' },
                { id: 't-sleeve-l', sourceAddress: 't/2', drawOrder: 2, localTransform: { ...IDENTITY, tx: 180, ty: 20 }, type: 'symbol', symbolRef: 'parts/sleeve', nestedDefinitionId: 'sleeve_sym' },
                { id: 't-sleeve-r', sourceAddress: 't/3', drawOrder: 3, localTransform: { ...IDENTITY, tx: 240, ty: 20 }, type: 'symbol', symbolRef: 'parts/sleeve', nestedDefinitionId: 'sleeve_sym' },
                { id: 't-hair', sourceAddress: 't/4', drawOrder: 4, localTransform: { ...IDENTITY, tx: 300, ty: 20 }, type: 'symbol', symbolRef: 'parts/hair_a', nestedDefinitionId: 'hair_a_sym' },
                { id: 't-prop', sourceAddress: 't/5', drawOrder: 5, localTransform: { ...IDENTITY, tx: 420, ty: 20 }, type: 'symbol', symbolRef: 'parts/prop', nestedDefinitionId: 'giant_prop_sym' },
                { id: 't-badge', sourceAddress: 't/6', drawOrder: 6, localTransform: { ...IDENTITY, tx: 560, ty: 20 }, type: 'symbol', symbolRef: 'parts/badge', nestedDefinitionId: 'singular_sym' },
              ],
            },
          ],
        },
      ],
    });

    const templateDef = makeGraphicDefinition(GRAPHIC_ALT_ID, 'TemplateSource', {
      version: 1,
      symbolDefinitions: {
        head_sym: {
          symbolRef: 'parts/head',
          children: [shapeLeaf('tp-head', 0, 's-head', IDENTITY, { x: -20, y: -20, width: 40, height: 40 })],
        },
        torso_sym: {
          symbolRef: 'parts/torso',
          children: [shapeLeaf('tp-torso', 0, 's-torso', IDENTITY, { x: -25, y: -35, width: 50, height: 70 })],
        },
        sleeve_sym: {
          symbolRef: 'parts/sleeve',
          children: [shapeLeaf('tp-sleeve', 0, 's-sleeve', IDENTITY, { x: -10, y: -20, width: 20, height: 40 })],
        },
        hair_b_sym: {
          symbolRef: 'parts/hair_b',
          children: [shapeLeaf('tp-hair-b', 0, 's-hair-b', IDENTITY, { x: -20, y: -20, width: 40, height: 40 })],
        },
        prop_tall_sym: {
          symbolRef: 'parts/prop',
          // Template is 20x200 tall vertical pole (severe aspect distortion!)
          children: [shapeLeaf('tp-prop', 0, 's-prop-tpl', IDENTITY, { x: -10, y: -100, width: 20, height: 200 })],
        },
        singular_sym: {
          symbolRef: 'parts/badge',
          children: [shapeLeaf('tp-badge', 0, 's-badge', IDENTITY, { x: -10, y: -10, width: 20, height: 20 })],
        },
      },
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Layer 1',
              nodes: [
                { id: 'r-head', sourceAddress: 'r/0', drawOrder: 0, localTransform: { ...IDENTITY, tx: 20, ty: 20 }, type: 'symbol', symbolRef: 'parts/head', nestedDefinitionId: 'head_sym' },
                { id: 'r-torso', sourceAddress: 'r/1', drawOrder: 1, localTransform: { ...IDENTITY, tx: 100, ty: 20 }, type: 'symbol', symbolRef: 'parts/torso', nestedDefinitionId: 'torso_sym' },
                { id: 'r-sleeve-1', sourceAddress: 'r/2', drawOrder: 2, localTransform: { ...IDENTITY, tx: 180, ty: 20 }, type: 'symbol', symbolRef: 'parts/sleeve', nestedDefinitionId: 'sleeve_sym' },
                { id: 'r-sleeve-2', sourceAddress: 'r/3', drawOrder: 3, localTransform: { ...IDENTITY, tx: 240, ty: 20 }, type: 'symbol', symbolRef: 'parts/sleeve', nestedDefinitionId: 'sleeve_sym' },
                { id: 'r-hair', sourceAddress: 'r/4', drawOrder: 4, localTransform: { ...IDENTITY, tx: 300, ty: 20 }, type: 'symbol', symbolRef: 'parts/hair_b', nestedDefinitionId: 'hair_b_sym' },
                { id: 'r-prop', sourceAddress: 'r/5', drawOrder: 5, localTransform: { ...IDENTITY, tx: 420, ty: 20 }, type: 'symbol', symbolRef: 'parts/prop', nestedDefinitionId: 'prop_tall_sym' },
                { id: 'r-badge', sourceAddress: 'r/6', drawOrder: 6, localTransform: { ...IDENTITY, tx: 560, ty: 20 }, type: 'symbol', symbolRef: 'parts/badge', nestedDefinitionId: 'singular_sym' },
              ],
            },
          ],
        },
      ],
    }, SHA_C);

    const templateChar: AdaptivePartsCharacter = {
      id: TEMPLATE_CHAR_A_ID,
      name: '杂项对照模板',
      mode: 'adaptive-parts',
      defaultVoiceProfileId: IDS.voiceProfile,
      defaultScale: 1,
      defaultFlipX: false,
      sourceRootTransform: { ...IDENTITY },
      parts: [
        {
          partId: '21000000-0000-4000-8000-000000000101',
          source: { kind: 'source-instance', sourceId: 'tp-h', sourcePoseFrame: 0, effectiveFrame: 0 },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_ALT_ID, nodePath: ['r-head'], poseFrameOrdinal: 0 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 200 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 200 },
          drawOrder: 0,
          visible: true,
          displayName: 'Head',
        },
        {
          partId: '21000000-0000-4000-8000-000000000102',
          source: { kind: 'source-instance', sourceId: 'tp-t', sourcePoseFrame: 0, effectiveFrame: 0 },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_ALT_ID, nodePath: ['r-torso'], poseFrameOrdinal: 0 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 260 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 220, ty: 260 },
          drawOrder: 1,
          visible: true,
          displayName: 'Torso',
        },
        {
          partId: '21000000-0000-4000-8000-000000000103',
          source: { kind: 'source-instance', sourceId: 'tp-s1', sourcePoseFrame: 0, effectiveFrame: 0 },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_ALT_ID, nodePath: ['r-sleeve-1'], poseFrameOrdinal: 0 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 90, ty: 250 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 90, ty: 250 },
          drawOrder: 2,
          visible: true,
          displayName: '未命名 7',
        },
        {
          partId: '21000000-0000-4000-8000-000000000104',
          source: { kind: 'source-instance', sourceId: 'tp-s2', sourcePoseFrame: 0, effectiveFrame: 0 },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_ALT_ID, nodePath: ['r-sleeve-2'], poseFrameOrdinal: 0 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 350, ty: 250 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 350, ty: 250 },
          drawOrder: 3,
          visible: true,
          displayName: '未命名 7',
        },
        {
          partId: '21000000-0000-4000-8000-000000000105',
          source: { kind: 'source-instance', sourceId: 'tp-hr', sourcePoseFrame: 0, effectiveFrame: 0 },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_ALT_ID, nodePath: ['r-hair'], poseFrameOrdinal: 0 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 180 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 300, ty: 180 },
          drawOrder: 4,
          visible: true,
          displayName: 'Hair',
        },
        {
          partId: '21000000-0000-4000-8000-000000000106',
          source: { kind: 'source-instance', sourceId: 'tp-pr', sourcePoseFrame: 0, effectiveFrame: 0 },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_ALT_ID, nodePath: ['r-prop'], poseFrameOrdinal: 0 },
          sourceRestTransform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 400 },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 400, ty: 400 },
          drawOrder: 5,
          visible: true,
          displayName: 'Prop',
        },
        {
          partId: '21000000-0000-4000-8000-000000000107',
          source: { kind: 'source-instance', sourceId: 'tp-bd', sourcePoseFrame: 0, effectiveFrame: 0 },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_ALT_ID, nodePath: ['r-badge'], poseFrameOrdinal: 0 },
          sourceRestTransform: { a: 0, b: 0, c: 0, d: 0, tx: 100, ty: 100 },
          restTransform: { a: 0, b: 0, c: 0, d: 0, tx: 100, ty: 100 },
          drawOrder: 6,
          visible: true,
          displayName: 'Badge',
        },
      ],
    };

    const base = makeBaseProject();
    const project: Project = {
      ...base,
      animations: [targetDef, templateDef],
      characters: [...base.characters, templateChar],
    };

    let bRes: FlaGraphicSavedLayoutResolution | null = null;
    const built = buildAdaptivePartsFromFlaGraphicSubtrees({
      project,
      definition: targetDef,
      frameOrdinal: 0,
      selections: [
        { nodePath: ['t-head'], label: 'Head' },
        { nodePath: ['t-torso'], label: 'Torso' },
        { nodePath: ['t-sleeve-l'], label: '未命名 7' },
        { nodePath: ['t-sleeve-r'], label: '未命名 7' },
        { nodePath: ['t-hair'], label: 'Hair' },
        { nodePath: ['t-prop'], label: 'Prop' },
        { nodePath: ['t-badge'], label: 'Badge' },
      ],
      applyAuthorPose: true,
      applySavedLayoutReuse: true,
      onSavedLayoutResolved: (r) => {
        bRes = r;
      },
    });

    expect(bRes!.matchedCount).toBe(2); // ONLY Head + Torso match!
    expect(bRes!.skippedReasons.get(2)).toBe('ambiguous-identity');
    expect(bRes!.skippedReasons.get(3)).toBe('ambiguous-identity');
    expect(bRes!.skippedReasons.get(4)).toBe('unmatched'); // Same name 'Hair', different symbolRef hair_a vs hair_b
    expect(bRes!.skippedReasons.get(5)).toBe('size-mismatch'); // 200x20 vs 20x200 aspect distortion
    expect(bRes!.skippedReasons.get(6)).toBe('non-invertible-transform');

    expect(built.parts[0]!.restTransform).not.toEqual(IDENTITY);
    expect(built.parts[1]!.restTransform).not.toEqual(IDENTITY);
    expect(built.parts[2]!.restTransform).toEqual(IDENTITY);
    expect(built.parts[3]!.restTransform).toEqual(IDENTITY);
    expect(built.parts[4]!.restTransform).toEqual(IDENTITY);
    expect(built.parts[5]!.restTransform).toEqual(IDENTITY);
    expect(built.parts[6]!.restTransform).toEqual(IDENTITY);
  });

  it('shares identical B placement & notice across 主入口 and 快捷入口 and supports lightweight template switching in CharacterAssemblyWorkbench', async () => {
    const definition = makeGraphicDefinition(
      GRAPHIC_MAIN_ID,
      'ScatteredNoAuthorPose',
      makeScatteredSingleFrameStructure(),
    );
    const tplA = makeSavedTemplateCharacter({
      id: TEMPLATE_CHAR_A_ID,
      name: '站姿模板 A',
      animationId: GRAPHIC_MAIN_ID,
      headTx: 200,
      headTy: 100,
      torsoTx: 80,
      torsoTy: 170,
      armLTx: -90,
      armLTy: 165,
      armRTx: -110,
      armRTy: 165,
    });
    const tplB = makeSavedTemplateCharacter({
      id: TEMPLATE_CHAR_B_ID,
      name: '挥手模板 B',
      animationId: GRAPHIC_MAIN_ID,
      headTx: 300,
      headTy: 120,
      torsoTx: 180,
      torsoTy: 190,
      armLTx: 10,
      armLTy: 90,
      armRTx: -10,
      armRTy: 185,
    });
    const base = makeBaseProject();
    const projectWithoutDef: Project = { ...base };
    const projectWithTemplates: Project = {
      ...base,
      animations: [definition],
      characters: [...base.characters, tplA, tplB],
      voiceProfiles: [
        ...base.voiceProfiles,
        makeTemplateVoiceProfile(tplA.id, tplA.defaultVoiceProfileId),
        makeTemplateVoiceProfile(tplB.id, tplB.defaultVoiceProfileId),
      ],
    };

    const pngBytes = new Uint8Array([137, 80, 78, 71]);
    const preview: Extract<
      FlaPartPreviewResponse,
      { ok: true; status: 'PREVIEW_READY'; capability: 'GRAPHIC_INSTANCES_READY' }
    > & { sessionId: string; generation: number } = {
      ok: true,
      status: 'PREVIEW_READY',
      capability: 'GRAPHIC_INSTANCES_READY',
      requestId: '00000000-0000-4000-8000-000000000952',
      sessionId: '00000000-0000-4000-8000-000000000950',
      generation: 1,
      planId: '00000000-0000-4000-8000-000000000951',
      poseIdentity: SHA_C,
      target: {
        renderTargetId: 'fla-render-target-scene000001',
        userLabel: '主场景',
        frameCount: 1,
        selectedFrameIndex: 0,
      },
      stage: { width: 1280, height: 720, pixelCount: 921600 },
      nativePreview: {
        width: 200,
        height: 200,
        pixelCount: 40000,
        sha256: SHA_B,
        byteLength: pngBytes.byteLength,
        bytes: pngBytes,
      },
      partPreviews: [
        {
          unitId: 'part-001-graphic0001',
          occurrenceId: 'occ-11111111111111111111111111111111',
          sourceKind: 'graphic-symbol-occurrence',
          sourceSymbolId: 'ScatteredNoAuthorPose',
          sourceAddress: 'scene/0/0',
          adapterIdentity: 'ScatteredNoAuthorPose',
          sourceDefinitionFrameCount: 1,
          layerName: 'Stage',
          drawOrder: 0,
          graphicInstanceImportable: true,
          image: {
            width: 200,
            height: 200,
            pixelCount: 40000,
            sha256: SHA_B,
            byteLength: pngBytes.byteLength,
            bytes: pngBytes,
          },
        },
      ],
      reassembledPreview: null,
      metrics: {
        preparedSourceCacheHit: false,
        sourcePreparationCountForRequest: 0,
        displayListResolveCount: 1,
        rasterCount: 1,
        unitCount: 1,
        totalPngBytes: pngBytes.byteLength,
        elapsedMs: 1,
      },
    };
    const catalogResponse: FlaRenderableTargetCatalogResponse = {
      ok: true,
      sessionId: '00000000-0000-4000-8000-000000000950',
      omittedCandidateCount: 0,
      summary: 'ok',
      entries: [
        {
          target: {
            renderTargetId: 'fla-render-target-scene000001',
            kind: 'scene',
            userLabel: '主场景 · 第 1 帧',
            sourceTimelineIndex: 0,
            frameCount: 1,
            selectedFrameIndex: 0,
            compatibility: ['degraded'],
          },
          catalogRole: 'scene',
          previewSupported: true,
          isBlank: false,
        },
      ],
    };
    const inspectionResponse: FlaInspectionResponse = {
      ok: true,
      sessionId: '00000000-0000-4000-8000-000000000950',
      ir: {
        source: {
          format: 'fla',
          basename: 'layout-reuse.fla',
          byteLength: 100,
          sha256: SHA_A,
          parser: {
            package: FLA_PARSER_PACKAGE,
            entrypoint: FLA_PARSER_ENTRYPOINT,
            commit: FLA_PARSER_COMMIT,
          },
        },
        document: { width: 1280, height: 720, frameRate: 24, backgroundColor: '#FFFFFF' },
        media: [],
        timelines: [],
        compatibility: [],
        summary: { placedInstanceCount: 1, libraryOnlyMediaCount: 0 },
      },
      diagnostics: [],
    };
    const commitGraphicInstance = vi.fn(async () => {
      const snap = editorProjectStore.getSnapshot()!;
      return {
        ok: true as const,
        status: 'completed' as const,
        requestId: randomUUID(),
        projectRoot: snap.projectRoot,
        projectId: snap.project.id,
        openInstanceId: editorProjectStore.getProjectInstanceId()!,
        baseRevision: snap.revision,
        savedRevision: snap.revision + 1,
        projectChanged: true,
        project: {
          ...snap.project,
          animations: projectWithTemplates.animations,
          characters: projectWithTemplates.characters,
          voiceProfiles: projectWithTemplates.voiceProfiles,
        },
        animationId: GRAPHIC_MAIN_ID,
        layerId: null,
      };
    });

    Object.defineProperty(window, 'pandaStage', {
      configurable: true,
      value: {
        assets: {
          readThumbnail: vi.fn(async () => ({
            ok: false,
            error: { code: 'NOT_FOUND', message: 'not mocked' },
          })),
        },
        fla: {
          chooseAndInspect: vi.fn(),
          onInspectionStarted: vi.fn(() => () => undefined),
          cancel: vi.fn(async () => undefined),
          staticSnapshotCatalog: vi.fn(async () => catalogResponse),
          staticSnapshotCancel: vi.fn(async () => ({ accepted: true })),
          partPreview: vi.fn(async () => preview),
          partPreviewCancel: vi.fn(async () => ({ accepted: true })),
          commitGraphicInstance,
        },
      },
    });

    activeContainer = document.createElement('div');
    document.body.append(activeContainer);
    activeRoot = createRoot(activeContainer);

    // Entry 1: 主入口
    editorProjectStore.open('D:\\Temp\\V2BEntry1', projectWithoutDef);
    const attempt: FlaCharacterImportAttempt = {
      lifecycle: { cancel: vi.fn(async () => undefined) } as unknown as FlaCharacterImportAttempt['lifecycle'],
      operation: {
        requestId: randomUUID(),
        inspectionStarted: Promise.resolve(),
        response: Promise.resolve(inspectionResponse),
      },
    };
    function Entry1Host() {
      const snap = useSyncExternalStore(
        editorProjectStore.subscribe,
        editorProjectStore.getSnapshot,
        editorProjectStore.getSnapshot,
      );
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        flaCharacterImportAttempt: attempt,
        onCreateFlaCharacter: vi.fn(),
        onCreateCharacterFromGraphic: (input) =>
          createAdaptiveCharacterFromFlaGraphic({
            ...input,
            api: { commitGraphicInstance },
            store: editorProjectStore,
            characters: characterStore,
          }),
        onQueryFlaCharacterCreateStatus: vi.fn(),
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(Entry1Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-character-import-create"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const entry1Notice = activeContainer.querySelector('.character-manager-status')?.textContent;
    expect(entry1Notice).toBe('已按已保存布局自动摆放 4/4 个零件');
    const char1 = editorProjectStore.getSnapshot()!.project.characters.at(-1)!;

    // Entry 2: 快捷入口
    characterAssemblySessionStore.getActiveSessionHandle()?.cancel();
    editorProjectStore.open('D:\\Temp\\V2BEntry2', projectWithoutDef);
    let entry2Created: { characterId: string; notice?: string; nonce: number } | null = null;
    function Entry2Host() {
      const snap = useSyncExternalStore(
        editorProjectStore.subscribe,
        editorProjectStore.getSnapshot,
        editorProjectStore.getSnapshot,
      );
      if (!entry2Created) {
        return createElement(FlaGraphicInstanceWorkbench, {
          enabled: true,
          sessionId: '00000000-0000-4000-8000-000000000950',
          source: { basename: 'layout-reuse.fla', sha256: SHA_A },
          targetRenderTargetId: 'fla-render-target-scene000001' as FlaRenderTarget['renderTargetId'],
          targetLookupPending: false,
          importDisabledReason: null,
          onCreateCharacterFromGraphic: (input) =>
            createAdaptiveCharacterFromFlaGraphic({
              ...input,
              api: { commitGraphicInstance },
              store: editorProjectStore,
              characters: characterStore,
            }),
          onCharacterCreated: (result) => {
            entry2Created = {
              characterId: result.characterId,
              notice: formatFlaGraphicSkippedSummary(
                result.partCount,
                result.skipped,
                result.warnings,
                {
                  autoPlacedCount: result.autoPlacedCount,
                  authorPosePlacedCount: result.authorPosePlacedCount,
                  savedLayoutPlacedCount: result.savedLayoutPlacedCount,
                  autoPlacedOrigin: result.autoPlacedOrigin,
                },
              ),
              nonce: 1,
            };
          },
        });
      }
      return createElement(CharacterManager, {
        snapshot: snap,
        view: 'list',
        externalCreatedCharacter: entry2Created,
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(Entry2Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-candidate-part-001-graphic0001"]')!.click();
    });
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="fla-graphic-instance-create-character"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    await act(async () => {
      activeRoot!.render(createElement(Entry2Host));
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
    expect(activeContainer.querySelector('.character-manager-status')?.textContent).toBe(entry1Notice);
    const char2 = editorProjectStore.getSnapshot()!.project.characters.find((c) => c.id === entry2Created!.characterId)!;
    if (char1.mode === 'adaptive-parts' && char2.mode === 'adaptive-parts') {
      expect(char2.parts.map((p) => p.restTransform)).toEqual(
        char1.parts.map((p) => p.restTransform),
      );
    }

    // Lightweight multi-template switcher inside CharacterAssemblyWorkbench
    function WorkbenchHost() {
      const snap = useSyncExternalStore(
        editorProjectStore.subscribe,
        editorProjectStore.getSnapshot,
        editorProjectStore.getSnapshot,
      );
      const assemblySession = useSyncExternalStore(
        characterAssemblySessionStore.subscribe,
        characterAssemblySessionStore.getSnapshot,
        characterAssemblySessionStore.getSnapshot,
      );
      if (!snap || !assemblySession) return null;
      return createElement(CharacterAssemblyWorkbench, {
        projectSnapshot: snap,
        savedProjectSnapshot: null,
        session: assemblySession,
      });
    }
    await act(async () => {
      activeRoot!.render(createElement(WorkbenchHost));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const selectEl = activeContainer.querySelector<HTMLSelectElement>(
      '[data-testid="adaptive-parts-template-select"]',
    );
    const applyBtn = activeContainer.querySelector<HTMLButtonElement>(
      '[data-testid="adaptive-parts-template-apply"]',
    );
    expect(selectEl).not.toBeNull();
    expect(applyBtn).not.toBeNull();
    expect(selectEl!.options).toHaveLength(2);

    // Switch to Template B and apply cleanly, verify Undo/Redo & Apply persistence
    await act(async () => {
      selectEl!.value = TEMPLATE_CHAR_B_ID;
      selectEl!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      applyBtn!.click();
    });
    const afterTemplateB = characterAssemblySessionStore.getSnapshot();
    expect(afterTemplateB?.kind).toBe('adaptive-parts');
    if (afterTemplateB?.kind === 'adaptive-parts') {
      expect(afterTemplateB.draft.parts[0]!.restTransform.tx).toBeCloseTo(300, 4);
      expect(afterTemplateB.draft.parts[0]!.restTransform.ty).toBeCloseTo(120, 4);
    }
    // Commit Template B to Project, verify Save/Reopen schema roundtrip, then Undo/Redo in History.
    await act(async () => {
      activeContainer!.querySelector<HTMLButtonElement>('[data-testid="adaptive-parts-assembly-apply"]')!.click();
    });
    const persistedAfterApply = ProjectSchema.parse(
      JSON.parse(JSON.stringify(editorProjectStore.getSnapshot()!.project)),
    );
    const updatedChar = persistedAfterApply.characters.find((c) => c.id === char2.id)!;
    expect(updatedChar.mode === 'adaptive-parts' && updatedChar.parts[0]!.restTransform.tx).toBeCloseTo(300, 4);

    // Project Undo reverts Template B back to initial Template A cleanly; Redo restores Template B cleanly.
    editorProjectStore.history.undo();
    const afterProjectUndo = editorProjectStore.getSnapshot()!.project.characters.find((c) => c.id === char2.id)!;
    expect(afterProjectUndo.mode === 'adaptive-parts' && afterProjectUndo.parts[0]!.restTransform.tx).toBeCloseTo(200, 4);
    editorProjectStore.history.redo();
    const afterProjectRedo = editorProjectStore.getSnapshot()!.project.characters.find((c) => c.id === char2.id)!;
    expect(afterProjectRedo.mode === 'adaptive-parts' && afterProjectRedo.parts[0]!.restTransform.tx).toBeCloseTo(300, 4);
  });
});
