import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  CharacterSchema,
  LayerService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  characterPartPlacementForReplacement,
  characterPartSourceBounds,
  characterPartTransformFromStaticAdjustment,
  evaluateShotAtTime,
  listShotRuntimeImageAssets,
  migrateProject,
  resolveCharacterPartVisualSource,
  resolveLayerVisualParts,
  scanAssetReferences,
  type FlaGraphicDefinition,
  type Project,
} from '../../src/domain';
import { collectExportPreparationMedia } from '../../src/domain/export-preparation';
import { buildStageRenderModel } from '../../src/shared/stage/render-model';
import { visualAssetIds } from '../../src/renderer/features/canvas/temporalVisualContinuity';
import { buildAdaptivePartsAssemblyPreviewVisual } from '../../src/renderer/features/characters/characterAssemblyPreview';
import { CharacterAssemblyWorkbench } from '../../src/renderer/features/characters/CharacterAssemblyWorkbench';
import { shotThumbnailFingerprint } from '../../src/renderer/features/shots/shotThumbnail';
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
    expect(markup).toContain('头部-愣住-静');
    // Unstructured graphic definitions must NOT be offered as Graphic Part targets.
    expect(markup).not.toContain('无结构静态序列');
  });
});
