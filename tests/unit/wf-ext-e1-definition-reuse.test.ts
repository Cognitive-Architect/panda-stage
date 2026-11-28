import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  analyzeProjectResourceReuse,
  buildImportedProjectCandidate,
  buildProjectResourceImportPreview,
  collectEffectiveImportScope,
  collectProjectResourceClosure,
  planMappedCharacterMotion,
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  ShotService,
  resolveDefinitionReusePlan,
  type Asset,
  type Character,
  type FlaGraphicDefinition,
  type ImageAsset,
  type PlannedAssetTransfer,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { commitCrossProjectResourceImport } from '../../src/renderer/features/assets/projectResourceImportFlow';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SHA_SVG = 'e'.repeat(64);

function makeImageAsset(
  overrides: Partial<ImageAsset> & { id: string; name: string },
): ImageAsset {
  return {
    kind: 'image',
    relativePath: `assets/${overrides.name}.png`,
    mimeType: 'image/png',
    width: 128,
    height: 128,
    usage: 'character',
    keywords: [],
    sha256: SHA_A,
    ...overrides,
  };
}

function makeBaseProject(overrides: Partial<Project> = {}): Project {
  const now = '2026-11-28T00:00:00.000Z';
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name: 'Target Project',
    width: PROJECT_WIDTH,
    height: PROJECT_HEIGHT,
    fps: PROJECT_FPS,
    assets: [],
    animations: [],
    characters: [],
    voiceProfiles: [],
    subtitleStyles: [
      {
        id: randomUUID(),
        name: 'Default',
        fontFamily: 'Microsoft YaHei',
        fontSize: 44,
        textColor: '#fffdf6',
        backgroundColor: '#0a141100',
        position: 'bottom',
        align: 'center',
        maxWidth: 1600,
      },
    ],
    shots: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

function planFreshAssets(assets: readonly Asset[]): PlannedAssetTransfer[] {
  return assets.map((asset, index) => ({
    sourceAsset: asset,
    targetId: randomUUID(),
    reused: false,
    targetRelativePath: `assets/imported-${index}-${asset.name.toLowerCase()}.png`,
    sha256: asset.sha256,
  }));
}

function buildSourceProjectWithTwoCharacters(): {
  project: Project;
  graphicId: string;
  charAId: string;
  charBId: string;
  charAPartBodyId: string;
  charAPartHeadId: string;
  charAActionId: string;
  charBPartBodyId: string;
  charBGeneratedActionId: string;
  bitmapAssetId: string;
} {
  const graphicId = randomUUID();
  const bitmapAssetId = randomUUID();
  const frameSvgAssetId = randomUUID();
  const charBExtraAssetId = randomUUID();
  const charAId = randomUUID();
  const charBId = randomUUID();
  const voiceAId = randomUUID();
  const voiceBId = randomUUID();
  const charAPartBodyId = randomUUID();
  const charAPartHeadId = randomUUID();
  const charAActionId = randomUUID();
  const charBPartBodyId = randomUUID();
  const charBGeneratedActionId = randomUUID();
  const exprAId = randomUUID();
  const exprBId = randomUUID();

  const bitmapAsset = makeImageAsset({
    id: bitmapAssetId,
    name: 'BodyBitmap',
    relativePath: 'assets/body.png',
    sha256: SHA_A,
  });
  const frameSvgAsset = makeImageAsset({
    id: frameSvgAssetId,
    name: 'GraphicFrame0',
    relativePath: 'assets/frame-0.svg',
    mimeType: 'image/svg+xml',
    sha256: SHA_SVG,
    flaGraphicFrame: { definitionId: graphicId, ordinal: 0 },
  });
  const charBExtraAsset = makeImageAsset({
    id: charBExtraAssetId,
    name: 'CharBExtra',
    relativePath: 'assets/char-b.png',
    sha256: SHA_B,
  });

  const graphic: FlaGraphicDefinition = {
    id: graphicId,
    name: 'SharedRigGraphic',
    kind: 'fla-graphic',
    durationMs: 1000 / 24,
    source: {
      basename: 'shared.fla',
      sha256: SHA_D,
      renderTargetId: 'symbol:SharedRig',
      targetKind: 'graphic-symbol',
      targetName: 'SharedRig',
      startFrameIndex: 0,
      endFrameIndex: 0,
      sourceFps: 24,
      canvas: { width: 400, height: 400 },
      anchor: { x: 0, y: 0 },
      documentCanvas: { width: 1920, height: 1080 },
    },
    frames: [
      {
        ordinal: 0,
        sourceFrameIndex: 0,
        assetId: frameSvgAssetId,
        sha256: SHA_SVG,
        sourceViewport: { x: 0, y: 0, width: 400, height: 400 },
        offset: { x: 0, y: 0 },
        startMs: 0,
        durationMs: 1000 / 24,
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
              name: 'Main',
              nodes: [
                {
                  type: 'bitmap',
                  id: 'node-body',
                  sourceAddress: 'L0/F0/Body',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                  bitmapRef: 'bitmaps/body.png',
                  assetId: bitmapAssetId,
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const charA: Character = {
    id: charAId,
    name: '大师兄',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceAId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: charAPartBodyId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-a-body',
          sourcePoseFrame: 0,
          effectiveFrame: 0,
        },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        drawOrder: 0,
        visible: true,
        displayName: '身体',
        visualSource: { kind: 'fla-graphic', animationId: graphicId },
      },
      {
        partId: charAPartHeadId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-a-head',
          sourcePoseFrame: 0,
          effectiveFrame: 0,
        },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: -40 },
        drawOrder: 1,
        visible: true,
        displayName: '头部',
        visualSource: { kind: 'fla-graphic', animationId: graphicId },
      },
    ],
    expressions: [
      {
        id: exprAId,
        name: '正常',
        visualSource: { kind: 'fla-graphic', animationId: graphicId, firstFrame: 0 },
      },
    ],
    defaultExpressionId: exprAId,
    actions: [
      {
        id: charAActionId,
        kind: 'layered',
        name: '点头',
        tracks: [
          {
            partId: charAPartHeadId,
            property: 'transform.rotationDeg',
            keys: [
              { timeMs: 0, value: 0, interpolationToNext: 'linear' },
              { timeMs: 500, value: 15, interpolationToNext: 'linear' },
            ],
          },
        ],
      },
    ],
  };

  const charB: Character = {
    id: charBId,
    name: '小师弟',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceBId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: charBPartBodyId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-b-body',
          sourcePoseFrame: 0,
          effectiveFrame: 0,
        },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        drawOrder: 0,
        visible: true,
        displayName: '身体',
        visualSource: { kind: 'fla-graphic', animationId: graphicId },
      },
    ],
    expressions: [
      {
        id: exprBId,
        name: '正常',
        assetId: charBExtraAssetId,
      },
    ],
    defaultExpressionId: exprBId,
    actions: [
      {
        id: charBGeneratedActionId,
        kind: 'layered',
        name: '联动点头',
        tracks: [
          {
            partId: charBPartBodyId,
            property: 'transform.rotationDeg',
            keys: [
              { timeMs: 0, value: 0, interpolationToNext: 'linear' },
              { timeMs: 500, value: 15, interpolationToNext: 'linear' },
            ],
          },
        ],
      },
    ],
    motionMappings: [
      {
        sourceCharacterId: charAId,
        sourceActionId: charAActionId,
        generatedActionId: charBGeneratedActionId,
        rules: [
          {
            sourcePartId: charAPartHeadId,
            targetPartId: charBPartBodyId,
            mirror: false,
            translationScale: 1,
            pivotOffset: { x: 0, y: 0 },
            properties: ['transform.rotationDeg'],
          },
        ],
      },
    ],
  };

  const project = makeBaseProject({
    name: 'Source Project',
    assets: [bitmapAsset, frameSvgAsset, charBExtraAsset],
    animations: [graphic],
    characters: [charA, charB],
    voiceProfiles: [
      {
        id: voiceAId,
        name: '大师兄配音',
        characterId: charAId,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
      {
        id: voiceBId,
        name: '小师弟配音',
        characterId: charBId,
        locale: 'zh-CN',
        rate: 1.05,
        pitch: 0.1,
      },
    ],
  });

  return {
    project,
    graphicId,
    charAId,
    charBId,
    charAPartBodyId,
    charAPartHeadId,
    charAActionId,
    charBPartBodyId,
    charBGeneratedActionId,
    bitmapAssetId,
  };
}

describe('WF-EXT-E1: cross-project definition-level compatibility & safe reuse (#1441)', () => {
  it('AC-1: identifies compatible unmodified character/animation on repeat import, supports explicit reuse without duplicates, and preserves copy option', () => {
    const src = buildSourceProjectWithTwoCharacters();
    const emptyTarget = makeBaseProject();

    // First import: bring Character A (and SharedRigGraphic) into Target.
    const firstSelections = [{ kind: 'character' as const, id: src.charAId }];
    const firstClosure = collectProjectResourceClosure(
      src.project,
      firstSelections,
    );
    const firstBuilt = buildImportedProjectCandidate({
      targetProject: emptyTarget,
      sourceProject: src.project,
      closure: firstClosure,
      plannedAssets: planFreshAssets(firstClosure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T01:00:00.000Z',
      selections: firstSelections,
    });
    const targetAfterFirst = firstBuilt.project;
    expect(targetAfterFirst.characters).toHaveLength(1);
    expect(targetAfterFirst.animations).toHaveLength(1);

    const targetCharA = targetAfterFirst.characters[0]!;
    const targetGraphic = targetAfterFirst.animations[0]!;
    expect(targetCharA.importProvenance).toMatchObject({
      sourceProjectId: src.project.id,
      sourceDefinitionId: src.charAId,
      importedName: '大师兄',
    });
    expect(targetGraphic.importProvenance).toMatchObject({
      sourceProjectId: src.project.id,
      sourceDefinitionId: src.graphicId,
      importedName: 'SharedRigGraphic',
    });

    // Repeat import preview (default copy mode): reports reusable candidates
    // without auto-merging them.
    const defaultPreview = buildProjectResourceImportPreview(
      src.project,
      targetAfterFirst,
      firstSelections,
      false,
    );
    expect(defaultPreview.reusableDefinitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'character',
          sourceId: src.charAId,
          targetId: targetCharA.id,
        }),
        expect.objectContaining({
          kind: 'animation',
          sourceId: src.graphicId,
          targetId: targetGraphic.id,
        }),
      ]),
    );
    expect(defaultPreview.reusedCharacterCount).toBe(0);
    expect(defaultPreview.characterCount).toBe(1);
    expect(defaultPreview.nameConflicts).toHaveLength(2);

    // Explicit reuse choice: zero new definitions, zero new files, zero conflicts.
    const reuseChoices = [
      { kind: 'character' as const, sourceId: src.charAId, targetId: targetCharA.id },
      { kind: 'animation' as const, sourceId: src.graphicId, targetId: targetGraphic.id },
    ];
    const reusePreview = buildProjectResourceImportPreview(
      src.project,
      targetAfterFirst,
      firstSelections,
      false,
      reuseChoices,
    );
    expect(reusePreview.reusedCharacterCount).toBe(1);
    expect(reusePreview.reusedAnimationCount).toBe(1);
    expect(reusePreview.characterCount).toBe(0);
    expect(reusePreview.animationCount).toBe(0);
    expect(reusePreview.newFileCount).toBe(0);
    expect(reusePreview.nameConflicts).toEqual([]);

    const analysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: targetAfterFirst,
      closure: firstClosure,
    });
    const plan = resolveDefinitionReusePlan(analysis, reuseChoices);
    const secondBuilt = buildImportedProjectCandidate({
      targetProject: targetAfterFirst,
      sourceProject: src.project,
      closure: firstClosure,
      plannedAssets: [],
      createId: randomUUID,
      updatedAtIso: '2026-11-28T02:00:00.000Z',
      reusedAnimations: plan.reusedAnimations,
      reusedCharacters: plan.reusedCharacters,
      selections: firstSelections,
    });
    expect(secondBuilt.project).toBe(targetAfterFirst);
    expect(secondBuilt.importedCharacters).toHaveLength(0);
    expect(secondBuilt.importedAnimations).toHaveLength(0);
    expect(secondBuilt.reusedCharacterIds).toEqual([targetCharA.id]);
    expect(secondBuilt.reusedAnimationIds).toEqual([targetGraphic.id]);

    // Original copy option still works and produces an independent auto-numbered copy.
    const copyBuilt = buildImportedProjectCandidate({
      targetProject: targetAfterFirst,
      sourceProject: src.project,
      closure: firstClosure,
      plannedAssets: planFreshAssets(firstClosure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T02:00:00.000Z',
      selections: firstSelections,
    });
    expect(copyBuilt.project.characters).toHaveLength(2);
    expect(copyBuilt.importedCharacters[0]!.name).toBe('大师兄 (2)');
  });

  it('AC-2: refuses silent merge when target was refined, source/dependency changed, name-only match, or internal identity is ambiguous', () => {
    const src = buildSourceProjectWithTwoCharacters();
    const selections = [{ kind: 'character' as const, id: src.charAId }];
    const closure = collectProjectResourceClosure(src.project, selections);

    const firstBuilt = buildImportedProjectCandidate({
      targetProject: makeBaseProject(),
      sourceProject: src.project,
      closure,
      plannedAssets: planFreshAssets(closure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T01:00:00.000Z',
      selections,
    });
    const baseTarget = firstBuilt.project;

    // 1. Target character independently refined (defaultScale changed):
    const refinedTarget = ProjectSchema.parse({
      ...baseTarget,
      characters: baseTarget.characters.map((c) => ({
        ...c,
        defaultScale: 1.25,
      })),
    });
    const refinedAnalysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: refinedTarget,
      closure,
    });
    expect(refinedAnalysis.reusableCharacterBySourceId.size).toBe(0);
    expect(refinedAnalysis.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'character',
          sourceId: src.charAId,
          code: 'TARGET_MODIFIED',
        }),
      ]),
    );

    // 2. Source dependency asset content changed -> disqualifies BOTH graphic and owning character (Blender append rule):
    const modifiedSource = ProjectSchema.parse({
      ...src.project,
      assets: src.project.assets.map((a) =>
        a.id === src.bitmapAssetId ? { ...a, sha256: SHA_C } : a,
      ),
    });
    const depChangedClosure = collectProjectResourceClosure(
      modifiedSource,
      selections,
    );
    const depChangedAnalysis = analyzeProjectResourceReuse({
      sourceProject: modifiedSource,
      targetProject: baseTarget,
      closure: depChangedClosure,
    });
    expect(depChangedAnalysis.reusableAnimationBySourceId.size).toBe(0);
    expect(depChangedAnalysis.reusableCharacterBySourceId.size).toBe(0);
    expect(depChangedAnalysis.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'animation',
          sourceId: src.graphicId,
          code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        }),
        expect.objectContaining({
          kind: 'character',
          sourceId: src.charAId,
          code: 'SOURCE_OR_DEPENDENCY_CHANGED',
        }),
      ]),
    );

    // 3. Name-only match (same name, no provenance): never treated as reusable.
    const nameOnlyTarget = ProjectSchema.parse({
      ...baseTarget,
      characters: baseTarget.characters.map((c) => {
        const copy = { ...c };
        delete copy.importProvenance;
        return copy;
      }),
      animations: baseTarget.animations.map((a) => {
        const copy = { ...a };
        delete copy.importProvenance;
        return copy;
      }),
    });
    const nameOnlyAnalysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: nameOnlyTarget,
      closure,
    });
    expect(nameOnlyAnalysis.reusableDefinitions).toEqual([]);
    expect(nameOnlyAnalysis.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'character', code: 'NAME_ONLY_MATCH' }),
        expect.objectContaining({ kind: 'animation', code: 'NAME_ONLY_MATCH' }),
      ]),
    );

    // 4. Ambiguous/missing internal partIdMap -> INTERNAL_IDENTITY_AMBIGUOUS.
    const brokenPartMapTarget = ProjectSchema.parse({
      ...baseTarget,
      characters: baseTarget.characters.map((c) => ({
        ...c,
        importProvenance: c.importProvenance
          ? {
              sourceProjectId: c.importProvenance.sourceProjectId,
              sourceDefinitionId: c.importProvenance.sourceDefinitionId,
              importedName: c.importProvenance.importedName,
              ...(c.importProvenance.actionIdMap
                ? { actionIdMap: c.importProvenance.actionIdMap }
                : {}),
            }
          : undefined,
      })),
    });
    const brokenPartAnalysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: brokenPartMapTarget,
      closure,
    });
    expect(brokenPartAnalysis.reusableCharacterBySourceId.size).toBe(0);
    expect(brokenPartAnalysis.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'character',
          code: 'INTERNAL_IDENTITY_AMBIGUOUS',
        }),
      ]),
    );
  });

  it('AC-3: mixes reused character/graphic with a newly imported character carrying cross-character motionMappings and maps all internal part/action IDs cleanly', () => {
    const src = buildSourceProjectWithTwoCharacters();
    const sourceSnapshotBefore = JSON.stringify(src.project);

    // Batch 1: import Character A (and SharedRigGraphic) into Target.
    const batch1Selections = [{ kind: 'character' as const, id: src.charAId }];
    const batch1Closure = collectProjectResourceClosure(
      src.project,
      batch1Selections,
    );
    const batch1Built = buildImportedProjectCandidate({
      targetProject: makeBaseProject(),
      sourceProject: src.project,
      closure: batch1Closure,
      plannedAssets: planFreshAssets(batch1Closure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T01:00:00.000Z',
      selections: batch1Selections,
    });
    const targetAfterBatch1 = batch1Built.project;
    const targetCharA = targetAfterBatch1.characters[0]!;
    const targetGraphic = targetAfterBatch1.animations[0]!;

    // Batch 2: select Character A + Character B; reuse Character A and SharedRigGraphic,
    // while creating Character B as a new character referencing both!
    const batch2Selections = [
      { kind: 'character' as const, id: src.charAId },
      { kind: 'character' as const, id: src.charBId },
    ];
    const batch2Closure = collectProjectResourceClosure(
      src.project,
      batch2Selections,
    );
    const analysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: targetAfterBatch1,
      closure: batch2Closure,
    });
    const reusePlan = resolveDefinitionReusePlan(analysis, [
      { kind: 'character', sourceId: src.charAId, targetId: targetCharA.id },
      { kind: 'animation', sourceId: src.graphicId, targetId: targetGraphic.id },
    ]);
    const effectiveScope = collectEffectiveImportScope(
      src.project,
      batch2Selections,
      batch2Closure,
      reusePlan.reusedAnimations,
      reusePlan.reusedCharacters,
    );
    // Only Character B's own unique expression asset should be transferred (not SharedRigGraphic's assets).
    expect(effectiveScope.charactersToCreate.map((c) => c.id)).toEqual([
      src.charBId,
    ]);
    expect(effectiveScope.animationsToCreate).toEqual([]);
    expect(effectiveScope.assetsToTransfer).toHaveLength(1);

    const batch2Built = buildImportedProjectCandidate({
      targetProject: targetAfterBatch1,
      sourceProject: src.project,
      closure: batch2Closure,
      plannedAssets: planFreshAssets(effectiveScope.assetsToTransfer),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T02:00:00.000Z',
      reusedAnimations: reusePlan.reusedAnimations,
      reusedCharacters: reusePlan.reusedCharacters,
      selections: batch2Selections,
    });

    // Zero duplicate Character A or SharedRigGraphic created!
    expect(batch2Built.project.characters).toHaveLength(2);
    expect(batch2Built.project.animations).toHaveLength(1);
    expect(batch2Built.reusedCharacterIds).toEqual([targetCharA.id]);
    expect(batch2Built.reusedAnimationIds).toEqual([targetGraphic.id]);
    expect(batch2Built.importedCharacters).toHaveLength(1);

    const importedCharB = batch2Built.importedCharacters[0]!;
    expect(importedCharB.mode).toBe('adaptive-parts');
    if (importedCharB.mode !== 'adaptive-parts' || targetCharA.mode !== 'adaptive-parts') {
      throw new Error('Expected adaptive-parts characters');
    }

    // Character B's part visualSource points directly to the existing reused SharedRigGraphic.
    expect(importedCharB.parts[0]!.visualSource).toEqual({
      kind: 'fla-graphic',
      animationId: targetGraphic.id,
    });

    // Character B's motionMapping points to the existing reused Character A, its real
    // target action ID, and its real target part IDs!
    expect(importedCharB.motionMappings).toHaveLength(1);
    const mapping = importedCharB.motionMappings![0]!;
    expect(mapping.sourceCharacterId).toBe(targetCharA.id);
    expect(mapping.sourceActionId).toBe(targetCharA.actions![0]!.id);
    expect(mapping.rules[0]!.sourcePartId).toBe(
      targetCharA.importProvenance!.partIdMap![src.charAPartHeadId],
    );
    expect(mapping.rules[0]!.targetPartId).toBe(importedCharB.parts[0]!.partId);

    // Real domain motion mapping planner succeeds against the mixed-reuse project!
    const projectWithShot = new ShotService().create(batch2Built.project, {
      name: '验证镜头',
      durationMs: 3_000,
    });
    const shotId = projectWithShot.shots[0]!.id;
    const layerId = randomUUID();
    const projectWithLayer = ProjectSchema.parse({
      ...projectWithShot,
      shots: projectWithShot.shots.map((shot) => ({
        ...shot,
        layers: [
          ...shot.layers,
          {
            id: layerId,
            name: importedCharB.name,
            source: { kind: 'character', characterId: importedCharB.id },
            x: 960,
            y: 540,
            scaleX: 1,
            scaleY: 1,
            flipX: false,
            rotationDeg: 0,
            anchor: 'center',
            opacity: 1,
            zIndex: 1,
            visible: true,
            locked: false,
          },
        ],
      })),
    });
    const plannedMotion = planMappedCharacterMotion(
      projectWithLayer,
      shotId,
      layerId,
      0,
      {
        sourceCharacterId: mapping.sourceCharacterId,
        sourceActionId: mapping.sourceActionId,
        rules: mapping.rules,
      },
    );
    expect(plannedMotion.missingSourcePartIds).toEqual([]);
    const charBAfterRun = plannedMotion.project.characters.find(
      (c) => c.id === importedCharB.id,
    )!;
    expect(charBAfterRun.actions).toHaveLength(1);
    expect(charBAfterRun.actions![0]!.id).toBe(mapping.generatedActionId);

    // Source project was never mutated.
    expect(JSON.stringify(src.project)).toBe(sourceSnapshotBefore);
  });

  it('skips creating a no-op History entry when 100% of selected definitions are reused', async () => {
    const store = new EditorProjectStore();
    const target = makeBaseProject();
    store.open('D:/e1-noop-reuse.pandastage', target);
    const revisionBefore = store.getSnapshot()!.revision;

    const result = await commitCrossProjectResourceImport({
      sourceToken: randomUUID(),
      resources: [{ kind: 'character', id: randomUUID() }],
      reuseIdenticalAssets: false,
      reuseDefinitions: [
        { kind: 'character', sourceId: randomUUID(), targetId: randomUUID() },
      ],
      store,
      api: {
        apply: async (request) => ({
          ok: true,
          status: 'completed',
          projectRoot: request.projectRoot,
          projectId: request.project.id,
          openInstanceId: request.openInstanceId,
          project: request.project,
          baseRevision: request.baseRevision,
          savedRevision: request.baseRevision,
          sourceProjectName: 'Source Project',
          importedAssets: [],
          reusedAssetIds: [],
          importedAnimations: [],
          reusedAnimationIds: [randomUUID()],
          importedCharacters: [],
          reusedCharacterIds: [randomUUID()],
          importedVoiceProfiles: [],
          nameConflicts: [],
        }),
      },
    });

    expect(result).toMatchObject({
      ok: true,
      importedCharacterCount: 0,
      reusedCharacterCount: 1,
      importedAnimationCount: 0,
      reusedAnimationCount: 1,
    });
    expect(store.getSnapshot()!.revision).toBe(revisionBefore);
    expect(store.undo()).toBe(false);
  });
});
