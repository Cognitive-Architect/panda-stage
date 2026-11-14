import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import * as graphicEvaluator from '../../src/domain/evaluate-fla-graphic';
import {
  CharacterService,
  CharacterSchema,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  adaptiveCharacterSourceAnchor,
  buildEditorStageRenderModel,
  characterPartPlacementForReplacement,
  characterPartSourceBounds,
  characterPartTransformFromStaticAdjustment,
  evaluateShotAtTime,
  listShotRuntimeImageAssets,
  migrateProject,
  resolveCharacterPartVisualSource,
  resolveLayerVisualParts,
  resolveShotVisualParts,
  scanAssetReferences,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import {
  resolveEditorTemporalAssetResolution,
  visualAssetIds,
} from '../../src/renderer/features/canvas/temporalVisualContinuity';
import { buildAdaptivePartsAssemblyPreviewVisual } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { shotThumbnailFingerprint } from '../../src/renderer/features/shots/shotThumbnail';
import { createStageCompositeCacheSignature } from '../../src/renderer/stage/compositeCacheSignature';
import { assetCategory, selectAssetLibraryEntries } from '../../src/renderer/stores/assetLibrarySelectors';
import type { AdaptivePartsAssemblySnapshot } from '../../src/renderer/stores/characterAssemblySessionStore';
import { adaptivePartsFixture, adaptivePartsSourceRootTransform } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

const GRAPHIC_DEF_ID = '91000000-0000-4000-8000-000000000001';
const UNSTRUCTURED_GRAPHIC_ID = '91000000-0000-4000-8000-000000000002';
const GRAPHIC_FRAME_ASSET_ID = '92000000-0000-4000-8000-000000000001';
const GRAPHIC_BITMAP_ASSET_ID = '92000000-0000-4000-8000-000000000002';
const GRAPHIC_OPAQUE_ASSET_ID = '92000000-0000-4000-8000-000000000003';
const UNSTRUCTURED_FRAME_ASSET_ID = '92000000-0000-4000-8000-000000000004';
const SECOND_CHARACTER_ID = '93000000-0000-4000-8000-000000000001';
const SECOND_VOICE_ID = '94000000-0000-4000-8000-000000000001';
const ADAPTIVE_LAYER_ID = '95000000-0000-4000-8000-000000000001';
const SECOND_LAYER_ID = '95000000-0000-4000-8000-000000000002';

function makeImageAsset(id: string, name: string, width = 120, height = 96, mimeType: 'image/png' | 'image/svg+xml' = 'image/png') {
  return {
    id,
    kind: 'image' as const,
    name,
    relativePath: `assets/${id}.${mimeType === 'image/svg+xml' ? 'svg' : 'png'}`,
    mimeType,
    sha256: 'a'.repeat(64),
    width,
    height,
    usage: 'character' as const,
    keywords: [] as string[],
  };
}

function makeStructuredGraphic(id = GRAPHIC_DEF_ID, name = '头部-愣住-静'): FlaGraphicDefinition {
  const frameDurationMs = 1_000 / 24;
  return {
    kind: 'fla-graphic',
    id,
    name,
    source: {
      basename: '原始人动作.fla',
      sha256: 'c'.repeat(64),
      renderTargetId: 'target-head-still',
      targetKind: 'graphic-symbol',
      targetName: `LIBRARY/头部文件夹/${name}.xml`,
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 160, height: 140 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    durationMs: frameDurationMs,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: GRAPHIC_FRAME_ASSET_ID,
        sha256: 'a'.repeat(64),
        sourceViewport: { x: 0, y: 0, width: 160, height: 140 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: frameDurationMs,
        createdBySequenceImport: false,
      },
    ],
    structure: {
      version: 1,
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Head',
              nodes: [
                {
                  id: 'bmp-ear',
                  type: 'bitmap',
                  drawOrder: 0,
                  bitmapRef: 'Ear Bitmap',
                  assetId: GRAPHIC_BITMAP_ASSET_ID,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 12, ty: 10 },
                },
                {
                  id: 'shape-face',
                  type: 'opaque',
                  drawOrder: 1,
                  opaqueKind: 'shape',
                  fallbackScope: 'subtree',
                  fallbackAssetId: GRAPHIC_OPAQUE_ASSET_ID,
                  fallbackViewBox: { x: 20, y: 18, width: 80, height: 80 },
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 20, ty: 18 },
                  reason: 'shape',
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function makeUnstructuredGraphic(id = UNSTRUCTURED_GRAPHIC_ID): FlaGraphicDefinition {
  const frameDurationMs = 1_000 / 24;
  return {
    kind: 'fla-graphic',
    id,
    name: '无结构静态序列',
    source: {
      basename: '原始人动作.fla',
      sha256: 'c'.repeat(64),
      renderTargetId: 'target-unstructured',
      targetKind: 'graphic-symbol',
      targetName: 'LIBRARY/无结构静态序列.xml',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 100, height: 100 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    durationMs: frameDurationMs,
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: UNSTRUCTURED_FRAME_ASSET_ID,
        sha256: 'a'.repeat(64),
        sourceViewport: { x: 0, y: 0, width: 100, height: 100 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: frameDurationMs,
        createdBySequenceImport: false,
      },
    ],
  };
}

function projectWithMixedAdaptiveParts(): {
  project: Project;
  characterId: string;
  bodyPartId: string;
  headPartId: string;
} {
  const base = buildProject();
  const withAssets: Project = ProjectSchema.parse({
    ...base,
    assets: [
      ...base.assets,
      { ...makeImageAsset(GRAPHIC_FRAME_ASSET_ID, 'Head Frame', 160, 140, 'image/svg+xml'), flaGraphicFrame: { definitionId: GRAPHIC_DEF_ID, ordinal: 0 } },
      { ...makeImageAsset(UNSTRUCTURED_FRAME_ASSET_ID, 'Unstructured Frame', 100, 100, 'image/svg+xml'), flaGraphicFrame: { definitionId: UNSTRUCTURED_GRAPHIC_ID, ordinal: 0 } },
      makeImageAsset(GRAPHIC_BITMAP_ASSET_ID, 'Ear Bitmap', 64, 48),
      makeImageAsset(GRAPHIC_OPAQUE_ASSET_ID, 'Face Vector', 80, 80, 'image/svg+xml'),
    ],
    animations: [
      makeStructuredGraphic(),
      makeUnstructuredGraphic(),
    ],
  });

  const allPngParts = adaptivePartsFixture(IDS.assetChar);
  const service = new CharacterService();
  const created = service.createAdaptiveParts(
    withAssets,
    {
      name: 'Mixed Adaptive Caveman',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: [
        allPngParts[0]!,
        {
          partId: allPngParts[5]!.partId,
          source: allPngParts[5]!.source,
          visualSource: {
            kind: 'fla-graphic',
            animationId: GRAPHIC_DEF_ID,
          },
          restTransform: allPngParts[5]!.restTransform,
          sourceRestTransform: allPngParts[5]!.restTransform,
          drawOrder: 1,
          visible: true,
          displayName: '头部',
        },
      ],
    },
  );
  const character = created.characters.find((candidate) => candidate.mode === 'adaptive-parts')!;
  return {
    project: created,
    characterId: character.id,
    bodyPartId: allPngParts[0]!.partId,
    headPartId: allPngParts[5]!.partId,
  };
}

describe('Adaptive Parts with structured FLA Graphic visual source (Issue #1100)', () => {
  it('models image and fla-graphic visual sources without faking assetId or imageMapping', () => {
    const { project, characterId } = projectWithMixedAdaptiveParts();
    const character = project.characters.find((candidate) => candidate.id === characterId)!;
    expect(character.mode).toBe('adaptive-parts');
    if (character.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');

    const bodyPart = character.parts[0]!;
    const headPart = character.parts[1]!;
    expect(bodyPart.assetId).toBe(IDS.assetChar);
    expect(bodyPart.imageMapping).toBeDefined();
    expect(resolveCharacterPartVisualSource(bodyPart)).toEqual({
      kind: 'image',
      assetId: IDS.assetChar,
      imageMapping: bodyPart.imageMapping,
    });

    expect(headPart.assetId).toBeUndefined();
    expect(headPart.imageMapping).toBeUndefined();
    expect(headPart.source).toEqual(adaptivePartsFixture(IDS.assetChar)[5]!.source);
    expect(resolveCharacterPartVisualSource(headPart)).toEqual({
      kind: 'fla-graphic',
      animationId: GRAPHIC_DEF_ID,
    });

    // Rejects fake assetId or imageMapping when visualSource.kind === 'fla-graphic'.
    const withFakeAssetId = CharacterSchema.safeParse({
      ...character,
      parts: [
        bodyPart,
        { ...headPart, assetId: IDS.assetChar },
      ],
    });
    expect(withFakeAssetId.success).toBe(false);

    const withFakeMapping = CharacterSchema.safeParse({
      ...character,
      parts: [
        bodyPart,
        { ...headPart, imageMapping: bodyPart.imageMapping },
      ],
    });
    expect(withFakeMapping.success).toBe(false);

    const withUnimplementedNodePath = CharacterSchema.safeParse({
      ...character,
      parts: [
        bodyPart,
        {
          ...headPart,
          visualSource: {
            kind: 'fla-graphic',
            animationId: GRAPHIC_DEF_ID,
            nodePath: ['bmp-ear'],
          },
        },
      ],
    });
    expect(withUnimplementedNodePath.success).toBe(false);

    // Rejects unknown or unstructured fla-graphic definitions.
    const service = new CharacterService();
    const currentDef = service.getAdaptivePartsDefinition(project, characterId);
    expect(() =>
      service.applyAdaptivePartsDefinition(project, characterId, {
        ...currentDef,
        parts: [
          bodyPart,
          {
            ...headPart,
            visualSource: { kind: 'fla-graphic', animationId: UNSTRUCTURED_GRAPHIC_ID },
          },
        ],
      }),
    ).toThrow(/unstructured FLA Graphic Definition/);
  });

  it('migrates v17 image-only adaptive-parts projects to v18 without mutating parts', () => {
    const base = buildProject();
    const service = new CharacterService();
    const withPngAdaptive = service.createAdaptiveParts(base, {
      name: 'Legacy PNG Parts',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptivePartsFixture(IDS.assetChar),
    });
    const v17Payload = {
      ...withPngAdaptive,
      schemaVersion: 17,
    };
    const migrated = migrateProject(v17Payload);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    const adaptive = migrated.characters.find((c) => c.mode === 'adaptive-parts');
    expect(adaptive?.mode).toBe('adaptive-parts');
    if (adaptive?.mode === 'adaptive-parts') {
      expect(adaptive.parts).toHaveLength(6);
      expect(adaptive.parts[0]?.assetId).toBe(IDS.assetChar);
      expect(adaptive.parts[0]?.visualSource).toBeUndefined();
    }
  });

  it('computes placement and static adjustments for Graphic parts and scans references safely', () => {
    const { project, characterId, bodyPartId, headPartId } = projectWithMixedAdaptiveParts();
    const service = new CharacterService();
    const def = service.getAdaptivePartsDefinition(project, characterId);
    const bodyPart = def.parts.find((p) => p.partId === bodyPartId)!;
    const headPart = def.parts.find((p) => p.partId === headPartId)!;

    const headBounds = characterPartSourceBounds(headPart, project.animations);
    expect(headBounds).toEqual({ x: 0, y: 0, width: 160, height: 140 });

    const replacement = characterPartPlacementForReplacement({
      sourceRootTransform: def.sourceRootTransform,
      oldRestTransform: bodyPart.restTransform,
      oldBounds: characterPartSourceBounds(bodyPart, project.animations)!,
      newBounds: headBounds!,
    });
    expect(replacement.staticAdjustment).toEqual({
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      rotationDeg: 0,
    });
    expect(replacement.restTransform).toEqual(replacement.sourceRestTransform);

    const adjusted = characterPartTransformFromStaticAdjustment(
      def.sourceRootTransform,
      headPart.sourceRestTransform!,
      headBounds!,
      { offsetX: 18, offsetY: -12, scale: 1.4, rotationDeg: 25 },
    );
    expect(adjusted.tx).not.toBe(headPart.restTransform.tx);

    // Reference scanner ignores non-image graphic part cleanly while finding image parts.
    expect(scanAssetReferences(project, IDS.assetChar).length).toBeGreaterThan(0);
    expect(scanAssetReferences(project, GRAPHIC_BITMAP_ASSET_ID).some((ref) => ref.kind === 'animation-structure')).toBe(true);

    // Asset library selectors safely ignore non-image parts.
    const pngAsset = project.assets.find((a) => a.id === IDS.assetChar)!;
    expect(assetCategory(project, pngAsset)).toBe('character');
    expect(selectAssetLibraryEntries(project, 'all').length).toBeGreaterThan(0);
  });

  it('resolves mixed PNG + FLA Graphic parts through stage, export, continuity, and thumbnails in drawOrder', () => {
    const { project: base, characterId, headPartId } = projectWithMixedAdaptiveParts();
    const withLayer = new LayerService().createFromAdaptiveCharacter(
      base,
      IDS.shot,
      characterId,
      { x: 960, y: 540 },
    ).project;
    const shot = withLayer.shots.find((s) => s.id === IDS.shot)!;
    const evaluated = evaluateShotAtTime(shot, 0, withLayer);
    const charLayer = evaluated.layers.find((layer) => {
      const src = shot.layers.find((candidate) => candidate.id === layer.id);
      return src?.source.kind === 'character' && src.source.characterId === characterId;
    })!;

    const visual = resolveLayerVisualParts(withLayer, shot, charLayer);
    expect(visual.kind).toBe('adaptive-parts-character');
    expect(visual.parts).toHaveLength(2);
    expect(visual.parts[0]?.assetId).toBe(IDS.assetChar);
    expect(visual.parts[0]?.flaGraphic).toBeUndefined();
    expect(visual.parts[1]?.assetId).toBeUndefined();
    expect(visual.parts[1]?.flaGraphic?.resourceAssetIds).toEqual([
      GRAPHIC_BITMAP_ASSET_ID,
      GRAPHIC_OPAQUE_ASSET_ID,
    ]);
    expect(visual.parts[1]?.drawOrder).toBe(1);
    expect(visual.flaGraphic).toBeUndefined();

    // Resources include BOTH PNG body asset and FLA Graphic subtree bitmaps/SVGs.
    const requiredIds = new Set(visual.resources.required.map((r) => r.assetId));
    expect(requiredIds.has(IDS.assetChar)).toBe(true);
    expect(requiredIds.has(GRAPHIC_BITMAP_ASSET_ID)).toBe(true);
    expect(requiredIds.has(GRAPHIC_OPAQUE_ASSET_ID)).toBe(true);

    const runtimeIds = new Set(listShotRuntimeImageAssets(withLayer, shot).map((a) => a.id));
    expect(runtimeIds.has(IDS.assetChar)).toBe(true);
    expect(runtimeIds.has(GRAPHIC_BITMAP_ASSET_ID)).toBe(true);
    expect(runtimeIds.has(GRAPHIC_OPAQUE_ASSET_ID)).toBe(true);

    const continuityIds = new Set(visualAssetIds(visual, charLayer));
    expect(continuityIds.has(IDS.assetChar)).toBe(true);
    expect(continuityIds.has(GRAPHIC_BITMAP_ASSET_ID)).toBe(true);
    expect(continuityIds.has(GRAPHIC_OPAQUE_ASSET_ID)).toBe(true);

    const exportMedia = collectExportPreparationMedia(withLayer);
    const exportAssetIds = new Set(exportMedia.map((entry) => entry.asset.id));
    expect(exportAssetIds.has(IDS.assetChar)).toBe(true);
    expect(exportAssetIds.has(GRAPHIC_BITMAP_ASSET_ID)).toBe(true);
    expect(exportAssetIds.has(GRAPHIC_OPAQUE_ASSET_ID)).toBe(true);

    // Build Stage Render Model including URL map for all assets.
    const assetUrls = Object.fromEntries(
      withLayer.assets
        .filter((a) => a.kind === 'image')
        .map((a) => [a.id, `asset:///${a.id}`]),
    );
    const stageModel = buildStageRenderModel(withLayer, evaluated, assetUrls);
    const stageCharLayer = stageModel.layers.find((l) => l.id === charLayer.id)!;
    expect(stageCharLayer.parts).toHaveLength(2);
    expect(stageCharLayer.parts[0]?.flaGraphic).toBeUndefined();
    expect(stageCharLayer.parts[1]?.flaGraphic).toBeDefined();
    expect(stageCharLayer.resources?.map((r) => r.asset.id).sort()).toEqual([
      GRAPHIC_BITMAP_ASSET_ID,
      GRAPHIC_OPAQUE_ASSET_ID,
    ].sort());

    // Thumbnail fingerprint tracks visibility & overrides on the Graphic part.
    const fpVisible = shotThumbnailFingerprint(withLayer, shot);
    const hiddenChar = new CharacterService().updateAdaptivePart(withLayer, characterId, headPartId, {
      visible: false,
    });
    const fpHidden = shotThumbnailFingerprint(
      hiddenChar,
      hiddenChar.shots.find((s) => s.id === IDS.shot)!,
    );
    expect(fpHidden).not.toBe(fpVisible);

    // Stage render model works even if parts[0] (bottom-most drawOrder) is a Graphic part.
    const graphicFirst = new CharacterService().createAdaptiveParts(withLayer, {
      name: 'Graphic Only Primary Part',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: [
        {
          partId: '96000000-0000-4000-8000-000000000003',
          source: { kind: 'manual', sourceId: 'manual-only-graphic' },
          visualSource: { kind: 'fla-graphic', animationId: GRAPHIC_DEF_ID },
          restTransform: adaptivePartsFixture(IDS.assetChar)[5]!.restTransform,
          sourceRestTransform: adaptivePartsFixture(IDS.assetChar)[5]!.restTransform,
          drawOrder: 0,
          visible: true,
        },
      ],
    });
    const graphicOnlyChar = graphicFirst.characters.find((c) => c.name === 'Graphic Only Primary Part')!;
    const withSecondLayer = new LayerService().createFromAdaptiveCharacter(
      graphicFirst,
      IDS.shot,
      graphicOnlyChar.id,
      { x: 960, y: 540 },
    ).project;
    const secondShot = withSecondLayer.shots.find((s) => s.id === IDS.shot)!;
    const secondEval = evaluateShotAtTime(secondShot, 0, withSecondLayer);
    const secondStage = buildStageRenderModel(withSecondLayer, secondEval, assetUrls);
    expect(secondStage.layers.at(-1)?.parts[0]?.flaGraphic).toBeDefined();
    expect(secondStage.layers.at(-1)?.sourceUrl).toBe('');
  });

  it('keeps multiple instances referencing the same FlaGraphicDefinition isolated', () => {
    const { project, characterId, headPartId } = projectWithMixedAdaptiveParts();
    const char1 = project.characters.find((c) => c.id === characterId)!;
    if (char1.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');

    const withSecondVoice: Project = ProjectSchema.parse({
      ...project,
      voiceProfiles: [
        ...project.voiceProfiles,
        {
          id: SECOND_VOICE_ID,
          name: 'Second Voice',
          characterId: SECOND_CHARACTER_ID,
          locale: 'zh-CN',
          rate: 1,
          pitch: 0,
        },
      ],
      characters: [
        ...project.characters,
        {
          ...char1,
          id: SECOND_CHARACTER_ID,
          name: 'Caveman Clone',
          defaultVoiceProfileId: SECOND_VOICE_ID,
          parts: [
            {
              ...char1.parts[0]!,
              partId: '96000000-0000-4000-8000-000000000001',
              source: { kind: 'manual', sourceId: 'clone-body-src' },
            },
            {
              ...char1.parts[1]!,
              partId: '96000000-0000-4000-8000-000000000002',
              source: { kind: 'manual', sourceId: 'clone-head-src' },
              visualSource: {
                kind: 'fla-graphic',
                animationId: GRAPHIC_DEF_ID,
                instanceTransformOverrides: {
                  '0': {
                    [JSON.stringify(['bmp-ear'])]: { a: 1, b: 0, c: 0, d: 1, tx: 55, ty: -10 },
                  },
                },
              },
              restTransform: { a: 1.5, b: 0, c: 0, d: 1.5, tx: 420, ty: 160 },
            },
          ],
        },
      ],
    });

    const withLayers: Project = ProjectSchema.parse({
      ...withSecondVoice,
      shots: withSecondVoice.shots.map((shot) =>
        shot.id === IDS.shot
          ? {
              ...shot,
              layers: [
                ...shot.layers,
                {
                  id: ADAPTIVE_LAYER_ID,
                  name: 'Char 1 Layer',
                  source: { kind: 'character' as const, characterId },
                  anchor: 'center' as const,
                  x: 500,
                  y: 540,
                  scaleX: 1,
                  scaleY: 1,
                  flipX: false,
                  rotationDeg: 0,
                  opacity: 1,
                  visible: true,
                  zIndex: 1,
                  locked: false,
                },
                {
                  id: SECOND_LAYER_ID,
                  name: 'Char 2 Layer',
                  source: { kind: 'character' as const, characterId: SECOND_CHARACTER_ID },
                  anchor: 'center' as const,
                  x: 1_200,
                  y: 540,
                  scaleX: 1,
                  scaleY: 1,
                  flipX: false,
                  rotationDeg: 0,
                  opacity: 1,
                  visible: true,
                  zIndex: 2,
                  locked: false,
                },
              ],
            }
          : shot,
      ),
    });

    const shot = withLayers.shots.find((s) => s.id === IDS.shot)!;
    const evaluated = evaluateShotAtTime(shot, 0, withLayers);
    const layer1Eval = evaluated.layers.find((l) => l.id === ADAPTIVE_LAYER_ID)!;
    const layer2Eval = evaluated.layers.find((l) => l.id === SECOND_LAYER_ID)!;

    const vis1 = resolveLayerVisualParts(withLayers, shot, layer1Eval);
    const vis2 = resolveLayerVisualParts(withLayers, shot, layer2Eval);

    const ear1 = vis1.parts[1]!.flaGraphic!.layers![0]!.nodes[0]!;
    const ear2 = vis2.parts[1]!.flaGraphic!.layers![0]!.nodes[0]!;
    expect(ear1.worldTransform.tx).toBe(12);
    expect(ear2.worldTransform.tx).toBe(55);
    expect(vis1.parts[1]!.imageTransform!.tx).not.toBe(vis2.parts[1]!.imageTransform!.tx);

    // Mutating headPart visibility on Character 1 does not alter Character 2 or shared Definition.
    const edited = new CharacterService().updateAdaptivePart(withLayers, characterId, headPartId, {
      visible: false,
    });
    const editedShot = edited.shots.find((s) => s.id === IDS.shot)!;
    const editedEval = evaluateShotAtTime(editedShot, 0, edited);
    const vis1After = resolveLayerVisualParts(edited, editedShot, editedEval.layers.find((l) => l.id === ADAPTIVE_LAYER_ID)!);
    const vis2After = resolveLayerVisualParts(edited, editedShot, editedEval.layers.find((l) => l.id === SECOND_LAYER_ID)!);
    expect(vis1After.parts[1]!.visible).toBe(false);
    expect(vis2After.parts[1]!.visible).toBe(true);
    expect(
      (edited.animations.find((a) => a.id === GRAPHIC_DEF_ID) as FlaGraphicDefinition).structure!.frames[0]!.layers[0]!.nodes[0]!.localTransform.tx,
    ).toBe(12);
  });

  it('builds CharacterAssembly preview visual and renders structured FLA Graphic selector options in Workbench', () => {
    const { project, characterId, headPartId } = projectWithMixedAdaptiveParts();
    const character = project.characters.find((c) => c.id === characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');
    const def = new CharacterService().getAdaptivePartsDefinition(project, characterId);
    const projectRoot = 'D:\\test-adaptive-fla.pandastage';

    const session: AdaptivePartsAssemblySnapshot = {
      status: 'active',
      kind: 'adaptive-parts',
      sessionId: 1,
      generation: 1,
      projectId: project.id,
      projectRoot,
      characterId,
      selectedPartId: headPartId,
      draft: def,
    };

    const previewVisual = buildAdaptivePartsAssemblyPreviewVisual(project, session);
    expect(previewVisual).not.toBeNull();
    expect(previewVisual?.parts).toHaveLength(2);
    expect(previewVisual?.parts[1]?.flaGraphic).toBeDefined();

    const projectSnapshot = {
      projectRoot,
      project,
      dirty: false,
      revision: 0,
    };

    const markup = renderToStaticMarkup(
      createElement(CharacterAssemblyWorkbench, {
        projectSnapshot,
        savedProjectSnapshot: { projectRoot, project },
        session,
      }),
    );
    expect(markup).toContain('data-testid="adaptive-parts-graphic-select"');
    expect(markup).toContain('data-source-kind="fla-graphic"');
    expect(markup).toContain('替换元件');
    expect(markup).toContain('选择已导入的 FLA 元件来源');
    expect(markup).toContain('头部-愣住-静');
    expect(markup).not.toContain('替换图形');
    expect(markup).not.toContain('选择已导入的 FLA 图形来源');
    // Unstructured graphic definitions must NOT be offered as Graphic Part targets.
    expect(markup).not.toContain('无结构静态序列');
  });

  it('projects shot time onto multi-frame and internal-timeline Graphic CharacterParts while keeping static parts invariant', () => {
    const frameDurationMs = 1_000 / 24;
    const frame1AssetId = '92000000-0000-4000-8000-000000000011';
    const frame1BitmapAssetId = '92000000-0000-4000-8000-000000000012';
    const nestedGraphicId = '91000000-0000-4000-8000-000000000011';
    const nestedFrameAssetId = '92000000-0000-4000-8000-000000000013';

    const { project: baseMixed, characterId, headPartId } = projectWithMixedAdaptiveParts();
    const baseHeadGraphic = baseMixed.animations.find((a) => a.id === GRAPHIC_DEF_ID) as FlaGraphicDefinition;
    const multiFrameGraphic: FlaGraphicDefinition = {
      ...baseHeadGraphic,
      source: {
        ...baseHeadGraphic.source,
        endFrameIndex: 1,
      },
      durationMs: frameDurationMs * 2,
      frames: [
        baseHeadGraphic.frames[0]!,
        {
          ordinal: 1,
          sourceFrameIndex: 1,
          assetId: frame1AssetId,
          sha256: 'b'.repeat(64),
          sourceViewport: { x: 0, y: 0, width: 160, height: 140 },
          offset: { x: 0, y: 0 },
          startMs: frameDurationMs,
          durationMs: frameDurationMs,
          createdBySequenceImport: false,
        },
      ],
      structure: {
        ...baseHeadGraphic.structure!,
        frames: [
          baseHeadGraphic.structure!.frames[0]!,
          {
            ordinal: 1,
            layers: [
              {
                name: 'Head',
                nodes: [
                  {
                    id: 'bmp-ear-f1',
                    type: 'bitmap',
                    drawOrder: 0,
                    bitmapRef: 'Ear Bitmap F1',
                    assetId: frame1BitmapAssetId,
                    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 34, ty: 22 },
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const nestedTimelineGraphic: FlaGraphicDefinition = {
      kind: 'fla-graphic',
      id: nestedGraphicId,
      name: '头部-眨眼-单帧内时间轴',
      source: {
        basename: '原始人动作.fla',
        sha256: 'c'.repeat(64),
        renderTargetId: 'target-head-blink',
        targetKind: 'graphic-symbol',
        targetName: 'LIBRARY/头部文件夹/头部-眨眼.xml',
        startFrameIndex: 0,
        endFrameIndex: 0,
        sourceFps: 24,
        canvas: { width: 160, height: 140 },
        anchor: { x: 0, y: 0 },
        documentCanvas: { width: 1920, height: 1080 },
      },
      durationMs: frameDurationMs,
      frames: [
        {
          ordinal: 0,
          sourceFrameIndex: 0,
          assetId: nestedFrameAssetId,
          sha256: 'a'.repeat(64),
          sourceViewport: { x: 0, y: 0, width: 160, height: 140 },
          offset: { x: 0, y: 0 },
          startMs: 0,
          durationMs: frameDurationMs,
          createdBySequenceImport: false,
        },
      ],
      structure: {
        version: 1,
        symbolDefinitions: {
          'sym-eye': {
            symbolRef: 'EyeClip',
            sourceFrameCount: 24,
            children: [
              {
                id: 'eye-bmp',
                sourceAddress: 'EyeClip/eye-bmp',
                type: 'bitmap',
                drawOrder: 0,
                bitmapRef: 'Eye Bitmap',
                assetId: GRAPHIC_BITMAP_ASSET_ID,
                localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
              },
            ],
            timeline: {
              tracks: [
                {
                  trackId: 'addr:EyeClip/eye-bmp',
                  keyframes: [
                    {
                      timeMs: 0,
                      transform: {
                        tx: 0,
                        ty: 0,
                        rotationDeg: 0,
                        scaleX: 1,
                        scaleY: 1,
                      },
                      easing: 'linear',
                    },
                    {
                      timeMs: 500,
                      transform: {
                        tx: 20,
                        ty: 0,
                        rotationDeg: 0,
                        scaleX: 1,
                        scaleY: 1,
                      },
                      easing: 'linear',
                    },
                  ],
                },
              ],
            },
          },
        },
        frames: [
          {
            ordinal: 0,
            layers: [
              {
                name: 'EyeLayer',
                nodes: [
                  {
                    id: 'inst-eye',
                    type: 'symbol',
                    drawOrder: 0,
                    symbolRef: 'EyeClip',
                    nestedDefinitionId: 'sym-eye',
                    localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 10 },
                    playbackMode: 'loop',
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    const withTemporalAssets: Project = ProjectSchema.parse({
      ...baseMixed,
      assets: [
        ...baseMixed.assets,
        {
          ...makeImageAsset(frame1AssetId, 'Head Frame 1', 160, 140, 'image/svg+xml'),
          flaGraphicFrame: { definitionId: GRAPHIC_DEF_ID, ordinal: 1 },
        },
        makeImageAsset(frame1BitmapAssetId, 'Ear Bitmap F1', 64, 48),
        {
          ...makeImageAsset(nestedFrameAssetId, 'Nested Frame 0', 160, 140, 'image/svg+xml'),
          flaGraphicFrame: { definitionId: nestedGraphicId, ordinal: 0 },
        },
      ],
      animations: [
        multiFrameGraphic,
        nestedTimelineGraphic,
        ...baseMixed.animations.filter((a) => a.id !== GRAPHIC_DEF_ID),
      ],
    });
    const withLayer = new LayerService().createFromAdaptiveCharacter(
      withTemporalAssets,
      IDS.shot,
      characterId,
      { x: 960, y: 540 },
    ).project;
    const shot = withLayer.shots.find((s) => s.id === IDS.shot)!;
    const layerId = shot.layers.at(-1)!.id;

    // 1. Preload & Export Preparation discover Frame 1 resources even when t=0 starts on Frame 0.
    const runtimeAssets = listShotRuntimeImageAssets(withLayer, shot);
    expect(runtimeAssets.some((a) => a.id === frame1BitmapAssetId)).toBe(true);
    const exportMedia = collectExportPreparationMedia(withLayer);
    expect(exportMedia.some((entry) => entry.asset.id === frame1BitmapAssetId)).toBe(true);

    // 2. Multi-frame Graphic advances from frameOrdinal 0 at t=0 -> 1 at t=60ms -> wraps to 0 at t=90ms.
    const eval0 = evaluateShotAtTime(shot, 0, withLayer);
    const eval60 = evaluateShotAtTime(shot, 60, withLayer);
    const eval90 = evaluateShotAtTime(shot, 90, withLayer);

    const stage0 = buildEditorStageRenderModel(withLayer, shot, eval0);
    const stage60 = buildEditorStageRenderModel(withLayer, shot, eval60);
    const stage90 = buildEditorStageRenderModel(withLayer, shot, eval90);
    const assetUrls = Object.fromEntries(withLayer.assets.map((a) => [a.id, `asset://${a.id}`]));
    const formal0 = buildStageRenderModel(withLayer, eval0, assetUrls);
    const formal60 = buildStageRenderModel(withLayer, eval60, assetUrls);

    const headAt0 = stage0.layers.at(-1)!.visual.parts[1]!;
    const headAt60 = stage60.layers.at(-1)!.visual.parts[1]!;
    const headAt90 = stage90.layers.at(-1)!.visual.parts[1]!;
    const formalHeadAt60 = formal60.layers.at(-1)!.parts[1]!;

    expect(headAt0.flaGraphic!.frameOrdinal).toBe(0);
    expect(headAt0.flaGraphic!.layers![0]!.nodes[0]!.worldTransform.tx).toBe(12);
    expect(headAt60.flaGraphic!.frameOrdinal).toBe(1);
    expect(headAt60.flaGraphic!.layers![0]!.nodes[0]!.source.type === 'bitmap' && headAt60.flaGraphic!.layers![0]!.nodes[0]!.source.assetId).toBe(frame1BitmapAssetId);
    expect(headAt60.flaGraphic!.layers![0]!.nodes[0]!.worldTransform.tx).toBe(34);
    expect(headAt90.flaGraphic!.frameOrdinal).toBe(0);
    // Formal Stage and Product Preview agree identically at t=60ms.
    expect(formalHeadAt60.flaGraphic?.frameOrdinal).toBe(1);
    expect(resolveShotVisualParts(withLayer, shot, eval60).at(-1)!.parts[1]!.flaGraphic!.frameOrdinal).toBe(1);

    // Character layer center pivot remains stable across animated frames.
    expect(stage0.layers.at(-1)!.visual.parts[0]!.imageTransform).toEqual(
      stage60.layers.at(-1)!.visual.parts[0]!.imageTransform,
    );

    // Temporal continuity & Stage composite cache signature react to frame changes.
    const readyAssetIds = new Set(withLayer.assets.map((a) => a.id));
    const readySourceKeys = new Map(withLayer.assets.map((a) => [a.id, a.sha256!]));
    const temporal60 = resolveEditorTemporalAssetResolution(
      withLayer,
      shot,
      eval60,
      readyAssetIds,
      new Map(),
      readySourceKeys,
    );
    expect(temporal60.visualsByLayer.get(layerId)?.parts[1]?.flaGraphic?.frameOrdinal).toBe(1);

    const sig0 = createStageCompositeCacheSignature({
      ownerLayerId: layerId,
      composite: true,
      complete: true,
      visualBounds: stage0.layers.at(-1)!.visual.combinedLocalBounds!,
      headGroup: null,
      orderedParts: formal0.layers.at(-1)!.parts,
      images: new Map(),
    });
    const sig60 = createStageCompositeCacheSignature({
      ownerLayerId: layerId,
      composite: true,
      complete: true,
      visualBounds: stage60.layers.at(-1)!.visual.combinedLocalBounds!,
      headGroup: null,
      orderedParts: formal60.layers.at(-1)!.parts,
      images: new Map(),
    });
    expect(sig0).not.toBe(sig60);

    // 3. Single-external-frame Graphic with internal nested symbol timeline advances across t=0 -> t=250ms.
    const nestedCharDef = new CharacterService().getAdaptivePartsDefinition(withLayer, characterId);
    const withNestedHead = new CharacterService().applyAdaptivePartsDefinition(withLayer, characterId, {
      ...nestedCharDef,
      parts: nestedCharDef.parts.map((part) =>
        part.partId === headPartId
          ? {
              ...part,
              visualSource: { kind: 'fla-graphic', animationId: nestedGraphicId },
            }
          : part,
      ),
    });
    const nestedShot = withNestedHead.shots.find((s) => s.id === IDS.shot)!;
    const nested0 = resolveLayerVisualParts(
      withNestedHead,
      nestedShot,
      evaluateShotAtTime(nestedShot, 0, withNestedHead).layers.at(-1)!,
      0,
    );
    const nested250 = resolveLayerVisualParts(
      withNestedHead,
      nestedShot,
      evaluateShotAtTime(nestedShot, 250, withNestedHead).layers.at(-1)!,
      250,
    );
    const eyeTx0 = nested0.parts[1]!.flaGraphic!.layers![0]!.nodes[0]!.children[0]!.worldTransform.tx;
    const eyeTx250 = nested250.parts[1]!.flaGraphic!.layers![0]!.nodes[0]!.children[0]!.worldTransform.tx;
    expect(eyeTx0).toBe(10);
    expect(eyeTx250).toBeGreaterThan(eyeTx0);

    // 4. Static single-frame Graphic stays pinned and reuses exact cached visual identity across timestamps.
    const staticShot = baseMixed.shots.find((s) => s.id === IDS.shot)!;
    const withStaticLayer = new LayerService().createFromAdaptiveCharacter(
      baseMixed,
      staticShot.id,
      characterId,
      { x: 960, y: 540 },
    ).project;
    const activeStaticShot = withStaticLayer.shots.find((s) => s.id === IDS.shot)!;
    const static0 = resolveLayerVisualParts(
      withStaticLayer,
      activeStaticShot,
      evaluateShotAtTime(activeStaticShot, 0, withStaticLayer).layers.at(-1)!,
      0,
    );
    const static500 = resolveLayerVisualParts(
      withStaticLayer,
      activeStaticShot,
      evaluateShotAtTime(activeStaticShot, 500, withStaticLayer).layers.at(-1)!,
      500,
    );
    expect(static0.parts[1]!.flaGraphic).toBe(static500.parts[1]!.flaGraphic);
  });

  it('keeps the Definition canvas pivot when Frame 0 is a cropped fallback (#1104)', () => {
    const { project: base, characterId, bodyPartId, headPartId } = projectWithMixedAdaptiveParts();
    const graphic = base.animations.find((a) => a.id === GRAPHIC_DEF_ID) as FlaGraphicDefinition;
    const frameDurationMs = 1_000 / 24;
    const croppedGraphic: FlaGraphicDefinition = {
      ...graphic,
      source: { ...graphic.source, endFrameIndex: 1 },
      durationMs: frameDurationMs * 2,
      frames: [
        {
          ...graphic.frames[0]!,
          sourceViewport: { x: 30, y: 20, width: 100, height: 80 },
          offset: { x: 30, y: 20 },
        },
        { ...graphic.frames[0]!, ordinal: 1, sourceFrameIndex: 1, startMs: frameDurationMs },
      ],
      structure: {
        ...graphic.structure!,
        frames: [{ ordinal: 0, layers: [] }, { ...graphic.structure!.frames[0]!, ordinal: 1 }],
      },
    };
    // Persisted structure frames must be contiguous from zero. Simulate missing
    // Frame 0 at the evaluator boundary while retaining a schema-valid save/reopen.
    const evaluate = graphicEvaluator.evaluateFlaGraphicVisual;
    const spy = vi.spyOn(graphicEvaluator, 'evaluateFlaGraphicVisual').mockImplementation((input) => evaluate({
      ...input,
      definition: input.definition.id === graphic.id ? {
        ...input.definition,
        structure: {
          ...input.definition.structure!,
          frames: input.definition.structure!.frames.filter((frame) => frame.ordinal !== 0),
        },
      } : input.definition,
    }));
    onTestFinished(() => spy.mockRestore());
    const project = ProjectSchema.parse({
      ...base,
      assets: base.assets.map((asset) => asset.id === GRAPHIC_FRAME_ASSET_ID
        ? { ...asset, width: 200, height: 160 }
        : asset),
      animations: base.animations.map((a) => a.id === graphic.id ? croppedGraphic : a),
      characters: base.characters.map((character) => character.id === characterId && character.mode === 'adaptive-parts'
        ? {
            ...character,
            sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
            parts: character.parts.map((part) => {
              // Keep the PNG inside the Graphic so the full canvas determines the source center.
              const restTransform = part.partId === bodyPartId
                ? { a: 0.05, b: 0, c: 0, d: 0.05, tx: 180, ty: 280 }
                : { a: 2, b: 0, c: 0, d: 1.5, tx: 100, ty: 200 };
              return { ...part, restTransform, sourceRestTransform: restTransform };
            }),
          }
        : character),
    });
    const character = project.characters.find((c) => c.id === characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');
    // Definition canvas 160x140 -> source bounds [110,220,320,210], center (270,325).
    expect(adaptiveCharacterSourceAnchor(project, character)).toEqual({ x: 270, y: 325 });
    const withLayer = new LayerService().createFromAdaptiveCharacter(
      project, IDS.shot, characterId, { x: 960, y: 540 },
    ).project;
    const sample = (current: Project, timeMs: number) => {
      const shot = current.shots.find((s) => s.id === IDS.shot)!;
      return buildEditorStageRenderModel(current, shot, evaluateShotAtTime(shot, timeMs, current))
        .layers.at(-1)!.visual.parts;
    };
    const fallback = sample(withLayer, 0);
    const structured = sample(withLayer, 60);
    const looped = sample(withLayer, 90);
    const headFallback = fallback[1]!;
    expect(headFallback.source).toEqual({
      kind: 'adaptive-part-fla-graphic', characterPartId: headPartId, animationId: graphic.id,
    });
    expect(headFallback.assetId).toBe(GRAPHIC_FRAME_ASSET_ID);
    expect(headFallback.flaGraphic).toBeUndefined();
    expect(headFallback.localRect).toEqual({ x: 0, y: 0, width: 200, height: 160 });
    // 200x160 image -> 100x80 at (30,20), then Part/root transforms minus the full-canvas center.
    expect(headFallback.imageTransform).toEqual({ a: 1, b: 0, c: 0, d: 0.75, tx: -100, ty: -75 });
    expect(structured[1]!.flaGraphic?.frameOrdinal).toBe(1);
    expect(structured[1]!.imageTransform).toEqual({ a: 2, b: 0, c: 0, d: 1.5, tx: -160, ty: -105 });
    expect(looped).toEqual(fallback);
    for (const parts of [fallback, structured, looped]) {
      expect(parts.map((part) => part.drawOrder)).toEqual([0, 1]);
      expect(parts[0]!.assetId).toBe(IDS.assetChar);
      expect(parts[0]!.imageTransform).toEqual({ a: 0.05, b: 0, c: 0, d: 0.05, tx: -80, ty: -25 });
    }
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(withLayer)));
    for (const timeMs of [0, 60, 90]) {
      expect(sample(reopened, timeMs)).toEqual(sample(withLayer, timeMs));
    }
  });

  it('falls back seamlessly to evaluated frame image when a Graphic CharacterPart frame lacks structureFrame (#1103)', () => {
    const frameDurationMs = 1_000 / 24;
    const frame0FallbackAssetId = '92000000-0000-4000-8000-000000000020';
    const frame1AssetId = '92000000-0000-4000-8000-000000000021';

    const { project: baseMixed, characterId, headPartId } = projectWithMixedAdaptiveParts();
    const baseHeadGraphic = baseMixed.animations.find((a) => a.id === GRAPHIC_DEF_ID) as FlaGraphicDefinition;
    const partialStructuredGraphic: FlaGraphicDefinition = {
      ...baseHeadGraphic,
      source: {
        ...baseHeadGraphic.source,
        endFrameIndex: 1,
      },
      durationMs: frameDurationMs * 2,
      frames: [
        baseHeadGraphic.frames[0]!,
        {
          ordinal: 1,
          sourceFrameIndex: 1,
          assetId: frame1AssetId,
          sha256: 'a'.repeat(64),
          sourceViewport: { x: 10, y: 12, width: 100, height: 80 },
          offset: { x: 10, y: 12 },
          startMs: frameDurationMs,
          durationMs: frameDurationMs,
          createdBySequenceImport: false,
        },
      ],
      structure: {
        ...baseHeadGraphic.structure!,
        // Frame 1 deliberately has no structureFrame entry and must fall back to frame1AssetId.
        frames: [baseHeadGraphic.structure!.frames[0]!],
      },
    };

    const projectWithFallbackFrame: Project = ProjectSchema.parse({
      ...baseMixed,
      assets: [
        ...baseMixed.assets,
        {
          ...makeImageAsset(frame1AssetId, 'Head Fallback Frame 1', 200, 160, 'image/svg+xml'),
          flaGraphicFrame: { definitionId: GRAPHIC_DEF_ID, ordinal: 1 },
        },
      ],
      animations: [
        partialStructuredGraphic,
        ...baseMixed.animations.filter((a) => a.id !== GRAPHIC_DEF_ID),
      ],
    });

    const withLayer = new LayerService().createFromAdaptiveCharacter(
      projectWithFallbackFrame,
      IDS.shot,
      characterId,
      { x: 960, y: 540 },
    ).project;
    const shot = withLayer.shots.find((s) => s.id === IDS.shot)!;
    const layerId = shot.layers.at(-1)!.id;

    // Resource discovery finds the fallback frame image asset for preload & export.
    const runtimeAssets = listShotRuntimeImageAssets(withLayer, shot);
    expect(runtimeAssets.some((a) => a.id === frame1AssetId)).toBe(true);
    const exportMedia = collectExportPreparationMedia(withLayer);
    expect(exportMedia.some((entry) => entry.asset.id === frame1AssetId)).toBe(true);

    const eval0 = evaluateShotAtTime(shot, 0, withLayer);
    const eval60 = evaluateShotAtTime(shot, 60, withLayer);
    const eval90 = evaluateShotAtTime(shot, 90, withLayer);

    const assetUrls = Object.fromEntries(withLayer.assets.map((a) => [a.id, `asset://${a.id}`]));
    const stage0 = buildEditorStageRenderModel(withLayer, shot, eval0);
    const stage60 = buildEditorStageRenderModel(withLayer, shot, eval60);
    const stage90 = buildEditorStageRenderModel(withLayer, shot, eval90);
    const formal60 = buildStageRenderModel(withLayer, eval60, assetUrls);
    const preview60 = resolveShotVisualParts(withLayer, shot, eval60);

    // Frame 0 uses structured Graphic rendering; PNG body part remains untouched.
    const bodyAt60 = stage60.layers.at(-1)!.visual.parts[0]!;
    expect(bodyAt60.assetId).toBe(IDS.assetChar);
    const headAt0 = stage0.layers.at(-1)!.visual.parts[1]!;
    expect(headAt0.flaGraphic?.frameOrdinal).toBe(0);
    expect(headAt0.assetId).toBeUndefined();

    // Frame 1 lacks structureFrame -> stays visible via fallback image asset with preserved identity & drawOrder.
    const headAt60 = stage60.layers.at(-1)!.visual.parts[1]!;
    expect(headAt60.visible).toBe(true);
    expect(headAt60.drawOrder).toBe(headAt0.drawOrder);
    expect(headAt60.source).toEqual({
      kind: 'adaptive-part-fla-graphic',
      characterPartId: headPartId,
      animationId: GRAPHIC_DEF_ID,
    });
    expect(headAt60.flaGraphic).toBeUndefined();
    expect(headAt60.assetId).toBe(frame1AssetId);
    expect(headAt60.localRect).toEqual({ x: 0, y: 0, width: 200, height: 160 });

    // Transform maps fallback bitmap pixels [0..200, 0..160] into frameOffset + frameViewport inside the part canvas.
    const compose = (
      left: { a: number; b: number; c: number; d: number; tx: number; ty: number },
      right: { a: number; b: number; c: number; d: number; tx: number; ty: number },
    ) => ({
      a: left.a * right.a + left.c * right.b,
      b: left.b * right.a + left.d * right.b,
      c: left.a * right.c + left.c * right.d,
      d: left.b * right.c + left.d * right.d,
      tx: left.a * right.tx + left.c * right.ty + left.tx,
      ty: left.b * right.tx + left.d * right.ty + left.ty,
    });
    const expectedHeadFallbackTransform = compose(headAt0.imageTransform!, {
      a: 100 / 200,
      b: 0,
      c: 0,
      d: 80 / 160,
      tx: 10,
      ty: 12,
    });
    expect(headAt60.imageTransform).toEqual(expectedHeadFallbackTransform);

    // Stage formal model, Product Preview, Shot Thumbnail, required resources, and temporal continuity all agree on fallback at t=60ms.
    const formalHead60 = formal60.layers.at(-1)!.parts[1]!;
    const previewHead60 = preview60.at(-1)!.parts[1]!;
    expect(formalHead60.flaGraphic).toBeUndefined();
    expect(formalHead60.asset.id).toBe(frame1AssetId);
    expect(formalHead60.sourceUrl).toBe(`asset://${frame1AssetId}`);
    expect(previewHead60.flaGraphic).toBeUndefined();
    expect(previewHead60.assetId).toBe(frame1AssetId);
    expect(previewHead60.imageTransform).toEqual(headAt60.imageTransform);
    expect(shotThumbnailFingerprint(withLayer, shot)).toBeTruthy();
    expect(stage60.layers.at(-1)!.visual.resources.required.some((r) => r.assetId === frame1AssetId)).toBe(true);
    expect(visualAssetIds(stage60.layers.at(-1)!.visual, eval60.layers.at(-1)!)).toContain(frame1AssetId);

    const readyAssetIds = new Set(withLayer.assets.map((a) => a.id));
    const readySourceKeys = new Map(withLayer.assets.map((a) => [a.id, a.sha256!]));
    const temporal60 = resolveEditorTemporalAssetResolution(
      withLayer,
      shot,
      eval60,
      readyAssetIds,
      new Map(),
      readySourceKeys,
    );
    expect(temporal60.visualsByLayer.get(layerId)?.parts[1]?.assetId).toBe(frame1AssetId);
    expect(
      createStageCompositeCacheSignature({
        ownerLayerId: layerId,
        composite: true,
        complete: true,
        visualBounds: stage0.layers.at(-1)!.visual.combinedLocalBounds!,
        headGroup: null,
        orderedParts: buildStageRenderModel(withLayer, eval0, assetUrls).layers.at(-1)!.parts,
        images: new Map(),
      }),
    ).not.toBe(
      createStageCompositeCacheSignature({
        ownerLayerId: layerId,
        composite: true,
        complete: true,
        visualBounds: stage60.layers.at(-1)!.visual.combinedLocalBounds!,
        headGroup: null,
        orderedParts: formal60.layers.at(-1)!.parts,
        images: new Map(),
      }),
    );

    // Looping back to Frame 0 returns to structured Graphic rendering.
    const headAt90 = stage90.layers.at(-1)!.visual.parts[1]!;
    expect(headAt90.flaGraphic?.frameOrdinal).toBe(0);
    expect(headAt90.assetId).toBeUndefined();

    // Persisted save/reopen JSON round-trip preserves structured <-> fallback behavior identically.
    const serialized = JSON.parse(JSON.stringify(withLayer)) as unknown;
    const reopenedProject = ProjectSchema.parse(serialized);
    const reopenedShot = reopenedProject.shots.find((s) => s.id === IDS.shot)!;
    const reopenedHead60 = buildEditorStageRenderModel(
      reopenedProject,
      reopenedShot,
      evaluateShotAtTime(reopenedShot, 60, reopenedProject),
    ).layers.at(-1)!.visual.parts[1]!;
    expect(reopenedHead60.flaGraphic).toBeUndefined();
    expect(reopenedHead60.assetId).toBe(frame1AssetId);
    expect(reopenedHead60.imageTransform).toEqual(headAt60.imageTransform);

    // Frame 0 itself lacking structureFrame works in Workbench assembly preview & row rendering.
    const frame0FallbackGraphic: FlaGraphicDefinition = {
      ...baseHeadGraphic,
      source: {
        ...baseHeadGraphic.source,
        endFrameIndex: 1,
      },
      durationMs: frameDurationMs * 2,
      frames: [
        {
          ...baseHeadGraphic.frames[0]!,
          assetId: frame0FallbackAssetId,
        },
        partialStructuredGraphic.frames[1]!,
      ],
      structure: {
        ...baseHeadGraphic.structure!,
        frames: [
          {
            ordinal: 1,
            layers: baseHeadGraphic.structure!.frames[0]!.layers,
          },
        ],
      },
    };
    const frame0FallbackProject: Project = {
      ...baseMixed,
      assets: [
        ...baseMixed.assets,
        {
          ...makeImageAsset(frame0FallbackAssetId, 'Head Fallback Frame 0', 160, 140, 'image/svg+xml'),
          flaGraphicFrame: { definitionId: GRAPHIC_DEF_ID, ordinal: 0 },
        },
        {
          ...makeImageAsset(frame1AssetId, 'Head Frame 1', 200, 160, 'image/svg+xml'),
          flaGraphicFrame: { definitionId: GRAPHIC_DEF_ID, ordinal: 1 },
        },
      ],
      animations: [
        frame0FallbackGraphic,
        ...baseMixed.animations.filter((a) => a.id !== GRAPHIC_DEF_ID),
      ],
    };
    const isolatedOverride = {
      '0': {
        [JSON.stringify(['bmp-ear'])]: { a: 1, b: 0, c: 0, d: 1, tx: 15, ty: -8 },
      },
    };
    const isolatedInstancesProject = new CharacterService().createAdaptiveParts(projectWithFallbackFrame, {
      name: '混装角色-隔离副本',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: new CharacterService()
        .getAdaptivePartsDefinition(projectWithFallbackFrame, characterId)
        .parts.map((part) =>
          part.partId === headPartId && part.visualSource?.kind === 'fla-graphic'
            ? {
                ...part,
                visualSource: {
                  ...part.visualSource,
                  instanceTransformOverrides: isolatedOverride,
                },
              }
            : part,
        ),
    });
    const createdSecondCharId = isolatedInstancesProject.characters.find((c) => c.name === '混装角色-隔离副本')!.id;
    const assemblyChar = new CharacterService().getAdaptivePartsDefinition(frame0FallbackProject, characterId);
    const assemblySession: AdaptivePartsAssemblySnapshot = {
      status: 'active',
      kind: 'adaptive-parts',
      sessionId: 1,
      generation: 1,
      projectId: frame0FallbackProject.id,
      projectRoot: 'f:\\temp\\project',
      characterId,
      selectedPartId: headPartId,
      draft: assemblyChar,
    };
    const assemblyVisual = buildAdaptivePartsAssemblyPreviewVisual(frame0FallbackProject, assemblySession);
    expect(assemblyVisual?.parts[1]?.flaGraphic).toBeUndefined();
    expect(assemblyVisual?.parts[1]?.assetId).toBe(frame0FallbackAssetId);
    expect(assemblyVisual?.parts[1]?.source).toEqual({
      kind: 'adaptive-part-fla-graphic',
      characterPartId: headPartId,
      animationId: GRAPHIC_DEF_ID,
    });
    const markup = renderToStaticMarkup(
      createElement(CharacterAssemblyWorkbench, {
        projectSnapshot: {
          projectRoot: 'f:\\temp\\project',
          project: frame0FallbackProject,
          dirty: false,
          revision: 0,
        },
        savedProjectSnapshot: {
          projectRoot: 'f:\\temp\\project',
          project: frame0FallbackProject,
        },
        session: assemblySession,
      }),
    );
    expect(markup).toContain('data-source-kind="fla-graphic"');
    expect(markup).not.toContain('角色尚未加载或部件无效');

    // Original character definition keeps empty overrides isolated from second character instance.
    const originalHead = new CharacterService().getAdaptivePartsDefinition(isolatedInstancesProject, characterId).parts[1]!;
    const secondHead = new CharacterService().getAdaptivePartsDefinition(isolatedInstancesProject, createdSecondCharId).parts[1]!;
    expect(resolveCharacterPartVisualSource(originalHead)).toEqual({
      kind: 'fla-graphic',
      animationId: GRAPHIC_DEF_ID,
    });
    expect(resolveCharacterPartVisualSource(secondHead)).toEqual({
      kind: 'fla-graphic',
      animationId: GRAPHIC_DEF_ID,
      instanceTransformOverrides: isolatedOverride,
    });
  });
});
