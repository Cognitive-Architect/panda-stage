import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  buildImportedProjectCandidate,
  buildProjectResourceImportCatalog,
  buildProjectResourceImportPreview,
  collectProjectResourceClosure,
  findProvablyReusableTargetAsset,
  isFlaGraphicDefinition,
  planMappedCharacterMotion,
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  ShotService,
  type Asset,
  type Character,
  type FlaGraphicDefinition,
  type ImageAsset,
  type Project,
} from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { commitCrossProjectResourceImport } from '../../src/renderer/features/assets/projectResourceImportFlow';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SHA_SVG = 'e'.repeat(64);
const SHA_BG = '1'.repeat(64);
const SHA_PROP = '2'.repeat(64);

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
  const now = '2026-11-27T00:00:00.000Z';
  return ProjectSchema.parse({
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id: randomUUID(),
    name: 'Test Project',
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

function createGraphicSourceProject(): {
  project: Project;
  characterId: string;
  graphicId: string;
  bitmapAssetId: string;
  fallbackAssetId: string;
  frameSvgAssetId: string;
  bgAssetId: string;
  propAssetId: string;
  sharedMouthAssetId: string;
} {
  const graphicId = randomUUID();
  const bitmapAssetId = randomUUID();
  const fallbackAssetId = randomUUID();
  const frameSvgAssetId = randomUUID();
  const bgAssetId = randomUUID();
  const propAssetId = randomUUID();
  const sharedMouthAssetId = randomUUID();
  const characterId = randomUUID();
  const voiceProfileId = randomUUID();
  const partBodyId = randomUUID();
  const partHeadId = randomUUID();
  const exprIdleId = randomUUID();
  const mouthRestId = randomUUID();
  const mouthOpenId = randomUUID();
  const bakedActionId = randomUUID();
  const layeredActionId = randomUUID();

  const bitmapAsset = makeImageAsset({
    id: bitmapAssetId,
    name: 'BodyBitmap',
    relativePath: 'assets/body.png',
    sha256: SHA_A,
  });
  const fallbackAsset = makeImageAsset({
    id: fallbackAssetId,
    name: 'FallbackSvg',
    relativePath: 'assets/fallback.svg',
    mimeType: 'image/svg+xml',
    sha256: SHA_B,
  });
  const frameSvgAsset = makeImageAsset({
    id: frameSvgAssetId,
    name: 'GraphicFrame0',
    relativePath: 'assets/frame-0.svg',
    mimeType: 'image/svg+xml',
    sha256: SHA_SVG,
    flaGraphicFrame: {
      definitionId: graphicId,
      ordinal: 0,
    },
  });
  const sharedMouthAsset = makeImageAsset({
    id: sharedMouthAssetId,
    name: 'MouthOpen',
    relativePath: 'assets/mouth-open.png',
    sha256: SHA_C,
  });
  const bgAsset = makeImageAsset({
    id: bgAssetId,
    name: 'BambooForest',
    relativePath: 'assets/bg.png',
    usage: 'background',
    width: 1920,
    height: 1080,
    sha256: SHA_BG,
  });
  const propAsset = makeImageAsset({
    id: propAssetId,
    name: 'TeaCup',
    relativePath: 'assets/teacup.png',
    usage: 'prop',
    width: 256,
    height: 256,
    sha256: SHA_PROP,
  });

  const graphicDef: FlaGraphicDefinition = {
    id: graphicId,
    name: 'PandaRigGraphic',
    kind: 'fla-graphic',
    durationMs: 1000 / 24,
    source: {
      basename: 'panda.fla',
      sha256: SHA_D,
      renderTargetId: 'symbol:PandaRig',
      targetKind: 'graphic-symbol',
      targetName: 'PandaRig',
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
      symbolDefinitions: {
        'def-head': {
          symbolRef: 'Lib/HeadSymbol',
          children: [
            {
              type: 'bitmap',
              id: 'node-head-bitmap',
              sourceAddress: 'L0/F0/HeadBitmap',
              drawOrder: 0,
              localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
              bitmapRef: 'bitmaps/head.png',
              assetId: bitmapAssetId,
            },
          ],
        },
      },
      frames: [
        {
          ordinal: 0,
          layers: [
            {
              name: 'Main',
              nodes: [
                {
                  type: 'symbol',
                  id: 'node-head-instance',
                  sourceAddress: 'L0/F0/HeadInst',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 20 },
                  symbolRef: 'Lib/HeadSymbol',
                  nestedDefinitionId: 'def-head',
                },
                {
                  type: 'opaque',
                  id: 'node-opaque-shape',
                  sourceAddress: 'L0/F0/OpaqueShape',
                  drawOrder: 1,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                  opaqueKind: 'shape',
                  fallbackScope: 'subtree',
                  fallbackAssetId,
                  fallbackViewBox: { x: 0, y: 0, width: 100, height: 100 },
                },
              ],
            },
          ],
        },
      ],
    },
  };

  const character: Character = {
    id: characterId,
    name: '小熊猫',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceProfileId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: partBodyId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-body-0',
          sourcePoseFrame: 0,
          effectiveFrame: 0,
        },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        drawOrder: 0,
        visible: true,
        displayName: '身体',
        visualSource: {
          kind: 'fla-graphic',
          animationId: graphicId,
          nodePath: ['node-opaque-shape'],
        },
      },
      {
        partId: partHeadId,
        source: {
          kind: 'source-instance',
          sourceId: 'src-head-1',
          sourcePoseFrame: 0,
          effectiveFrame: 0,
        },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: -40 },
        drawOrder: 1,
        visible: true,
        displayName: '头',
        visualSource: {
          kind: 'fla-graphic',
          animationId: graphicId,
          nodePath: ['node-head-instance'],
        },
      },
    ],
    faceBinding: {
      targetPartId: partHeadId,
      replacePartIds: [],
      anchorRect: { x: 0, y: 0, width: 100, height: 100 },
      placement: { offsetX: 0, offsetY: 0, scale: 1, rotationDeg: 0, flipX: false },
    },
    headMotionBinding: { partIds: [partHeadId] },
    expressions: [
      {
        id: exprIdleId,
        name: '默认',
        visualSource: { kind: 'fla-graphic', animationId: graphicId, firstFrame: 0 },
      },
    ],
    defaultExpressionId: exprIdleId,
    talkingAnimationId: graphicId,
    mouthPoseSet: {
      poses: [
        {
          id: mouthRestId,
          name: '闭嘴',
          source: { kind: 'fla-graphic', animationId: graphicId, firstFrame: 0 },
          target: { kind: 'mouth', partId: partHeadId },
        },
        {
          id: mouthOpenId,
          name: '张嘴',
          source: { kind: 'image', assetId: sharedMouthAssetId },
          target: { kind: 'face' },
        },
      ],
      restPoseId: mouthRestId,
      analyzerMapping: {
        rest: mouthRestId,
        open: mouthOpenId,
        wide: mouthOpenId,
        round: mouthOpenId,
        closed: mouthRestId,
      },
      driveMode: 'mouth-poses',
    },
    actions: [
      {
        id: bakedActionId,
        name: '招手',
        animationId: graphicId,
        placement: { offsetX: 0, offsetY: 0, scale: 1 },
      },
      {
        id: layeredActionId,
        name: '点头',
        kind: 'layered',
        headAnchorPartId: partHeadId,
        tracks: [
          {
            partId: partHeadId,
            property: 'transform.rotationDeg',
            keys: [
              { timeMs: 0, value: 0, interpolationToNext: 'linear' },
              { timeMs: 250, value: 12, interpolationToNext: 'linear' },
            ],
          },
        ],
      },
    ],
    bodyPoses: [
      {
        id: randomUUID(),
        name: '站姿',
        parts: [{ partId: partBodyId, properties: { 'transform.rotationDeg': 5 } }],
      },
    ],
  };

  const project = makeBaseProject({
    name: 'Source Studio Project',
    assets: [
      bitmapAsset,
      fallbackAsset,
      frameSvgAsset,
      sharedMouthAsset,
      bgAsset,
      propAsset,
    ],
    animations: [graphicDef],
    characters: [character],
    voiceProfiles: [
      {
        id: voiceProfileId,
        name: '小熊猫配音',
        characterId,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ],
  });

  return {
    project,
    characterId,
    graphicId,
    bitmapAssetId,
    fallbackAssetId,
    frameSvgAssetId,
    bgAssetId,
    propAssetId,
    sharedMouthAssetId,
  };
}

describe('ProjectResourceImportPlanner', () => {
  it('collects complete forward dependency closure for a Graphic character, background, and prop with shared dependency deduplication', () => {
    const src = createGraphicSourceProject();
    // Selecting BOTH the character and the Graphic it already depends on must deduplicate the Graphic and all its assets.
    const closure = collectProjectResourceClosure(src.project, [
      { kind: 'character', id: src.characterId },
      { kind: 'animation', id: src.graphicId },
      { kind: 'image', id: src.bgAssetId },
      { kind: 'image', id: src.propAssetId },
    ]);

    expect(closure.issues).toEqual([]);
    expect(closure.characters).toHaveLength(1);
    expect(closure.animations).toHaveLength(1);
    expect(closure.voiceProfiles).toHaveLength(1);
    // bitmapAsset + fallbackAsset + frameSvgAsset + sharedMouthAsset + bgAsset + propAsset = 6 unique assets
    expect(closure.assets).toHaveLength(6);
    expect(new Set(closure.assetIds)).toEqual(
      new Set([
        src.bitmapAssetId,
        src.fallbackAssetId,
        src.frameSvgAssetId,
        src.sharedMouthAssetId,
        src.bgAssetId,
        src.propAssetId,
      ]),
    );
  });

  it('performs two-phase project-level ID remapping while preserving local node/source identities and conflict-safe naming', () => {
    const src = createGraphicSourceProject();
    const existingTargetCharId = randomUUID();
    const existingTargetVoiceId = randomUUID();
    const existingTargetImgId = randomUUID();
    const existingTargetExprId = randomUUID();
    const targetProject = makeBaseProject({
      name: 'Target Project',
      assets: [
        makeImageAsset({
          id: existingTargetImgId,
          name: 'ExistingFace',
          relativePath: 'assets/existing-face.png',
          sha256: '9'.repeat(64),
        }),
      ],
      characters: [
        {
          id: existingTargetCharId,
          name: '小熊猫', // Intentional name conflict with source character
          mode: 'single-image',
          baseAssetId: existingTargetImgId,
          defaultVoiceProfileId: existingTargetVoiceId,
          expressions: [
            { id: existingTargetExprId, name: '默认', assetId: existingTargetImgId },
          ],
          defaultExpressionId: existingTargetExprId,
          defaultScale: 1,
          defaultFlipX: false,
        },
      ],
      voiceProfiles: [
        {
          id: existingTargetVoiceId,
          name: 'Existing Voice',
          characterId: existingTargetCharId,
          locale: 'zh-CN',
          rate: 1,
          pitch: 0,
        },
      ],
    });

    const closure = collectProjectResourceClosure(src.project, [
      { kind: 'character', id: src.characterId },
      { kind: 'image', id: src.bgAssetId },
    ]);

    const plannedAssets = closure.assets.map((asset: Asset, index) => ({
      sourceAsset: asset,
      targetId: randomUUID(),
      reused: false,
      targetRelativePath: `assets/copied-${index}${asset.mimeType === 'image/svg+xml' ? '.svg' : '.png'}`,
      sha256: asset.sha256,
    }));

    const candidate = buildImportedProjectCandidate({
      targetProject,
      sourceProject: src.project,
      closure,
      plannedAssets,
      createId: randomUUID,
      updatedAtIso: '2026-11-27T01:00:00.000Z',
    });

    // Candidate must pass full ProjectSchema + validateProjectReferences
    expect(() => ProjectSchema.parse(candidate.project)).not.toThrow();
    expect(candidate.importedCharacters).toHaveLength(1);
    const importedChar = candidate.importedCharacters[0]!;
    expect(importedChar.id).not.toBe(src.characterId);
    expect(importedChar.name).toBe('小熊猫 (2)');
    expect(candidate.nameConflicts).toEqual([
      { kind: 'character', sourceName: '小熊猫', resolvedName: '小熊猫 (2)' },
    ]);

    // Verify local source identities are preserved on adaptive parts
    expect(importedChar.mode).toBe('adaptive-parts');
    if (importedChar.mode === 'adaptive-parts') {
      expect(importedChar.parts.map((p) => p.source.sourceId)).toEqual([
        'src-body-0',
        'src-head-1',
      ]);
      // Verify FLA Graphic structure local node IDs and sourceAddresses are preserved, while bitmap/fallback assetIds are remapped
      const importedAnim = candidate.importedAnimations[0]!;
      expect(importedAnim.id).not.toBe(src.graphicId);
      expect(isFlaGraphicDefinition(importedAnim)).toBe(true);
      if (isFlaGraphicDefinition(importedAnim) && importedAnim.structure) {
        const defHead = importedAnim.structure.symbolDefinitions?.['def-head'];
        expect(defHead?.symbolRef).toBe('Lib/HeadSymbol');
        const bitmapNode = defHead?.children[0];
        expect(bitmapNode?.id).toBe('node-head-bitmap');
        expect(bitmapNode?.sourceAddress).toBe('L0/F0/HeadBitmap');
        if (bitmapNode?.type === 'bitmap') {
          expect(bitmapNode.assetId).toBe(candidate.assetIdMap.get(src.bitmapAssetId));
          expect(bitmapNode.assetId).not.toBe(src.bitmapAssetId);
        }
        const opaqueNode = importedAnim.structure.frames[0]?.layers[0]?.nodes[1];
        expect(opaqueNode?.id).toBe('node-opaque-shape');
        if (opaqueNode?.type === 'opaque') {
          expect(opaqueNode.fallbackAssetId).toBe(
            candidate.assetIdMap.get(src.fallbackAssetId),
          );
        }
      }
    }
  });

  it('only reuses provably compatible target assets (never by name or UUID alone)', () => {
    const sharedId = randomUUID();
    const sourceBg = makeImageAsset({
      id: sharedId,
      name: 'BambooForest',
      usage: 'background',
      width: 1920,
      height: 1080,
      sha256: SHA_BG,
    });
    // Target has same name AND same UUID, but DIFFERENT sha256 -> MUST NOT reuse!
    const targetDifferentHash = makeBaseProject({
      assets: [
        makeImageAsset({
          id: sharedId,
          name: 'BambooForest',
          usage: 'background',
          width: 1920,
          height: 1080,
          sha256: SHA_PROP,
        }),
      ],
    });
    expect(findProvablyReusableTargetAsset(targetDifferentHash, sourceBg)).toBeNull();

    // Target has different UUID & different name, but IDENTICAL sha256 + mimeType + dimensions -> provably reusable!
    const targetSameHashAsset = makeImageAsset({
      id: randomUUID(),
      name: 'ExistingForestCopy',
      usage: 'background',
      width: 1920,
      height: 1080,
      sha256: SHA_BG,
    });
    const targetSameHash = makeBaseProject({ assets: [targetSameHashAsset] });
    expect(
      findProvablyReusableTargetAsset(targetSameHash, sourceBg)?.id,
    ).toBe(targetSameHashAsset.id);

    // Preview reports reusableAssetCount accurately
    const src = createGraphicSourceProject();
    const preview = buildProjectResourceImportPreview(
      src.project,
      targetSameHash,
      [{ kind: 'image', id: src.bgAssetId }],
      true,
    );
    expect(preview.reusableAssetCount).toBe(1);
    expect(preview.newFileCount).toBe(0);
  });

  it('isolates unsupported items in catalog without blocking valid selectable items', () => {
    const src = createGraphicSourceProject();
    // Corrupt one extra character by omitting its voiceProfile (simulate partial unsupported item)
    const brokenCharId = randomUUID();
    const brokenSource = {
      ...src.project,
      characters: [
        ...src.project.characters,
        {
          ...src.project.characters[0]!,
          id: brokenCharId,
          name: '缺失配音角色',
          defaultVoiceProfileId: randomUUID(),
        },
      ],
    } as Project;

    const catalog = buildProjectResourceImportCatalog(
      brokenSource,
      makeBaseProject(),
    );
    const brokenItem = catalog.find((item) => item.id === brokenCharId);
    const validCharItem = catalog.find((item) => item.id === src.characterId);
    const validBgItem = catalog.find((item) => item.id === src.bgAssetId);

    expect(brokenItem?.supported).toBe(false);
    expect(brokenItem?.reason).toContain('配音档案');
    expect(validCharItem?.supported).toBe(true);
    expect(validBgItem?.supported).toBe(true);
  });

  it('commits via EditorProjectStore lease and records a single Undo/Redo command', async () => {
    const store = new EditorProjectStore();
    const targetProject = makeBaseProject({ name: 'Target' });
    store.open('D:\\Projects\\target.pandastage', targetProject);
    const openInstanceId = store.getProjectInstanceId()!;

    const importedBg = makeImageAsset({
      id: randomUUID(),
      name: 'ImportedBg',
      usage: 'background',
      sha256: SHA_BG,
    });
    const savedProject = ProjectSchema.parse({
      ...targetProject,
      assets: [importedBg],
      updatedAt: '2026-11-27T02:00:00.000Z',
    });

    const result = await commitCrossProjectResourceImport({
      sourceToken: randomUUID(),
      resources: [{ kind: 'image', id: importedBg.id }],
      reuseIdenticalAssets: false,
      store,
      api: {
        apply: async (request) => {
          expect(request.openInstanceId).toBe(openInstanceId);
          expect(request.baseRevision).toBe(0);
          return {
            ok: true,
            status: 'completed',
            projectRoot: request.projectRoot,
            projectId: request.project.id,
            openInstanceId,
            project: savedProject,
            baseRevision: 0,
            savedRevision: 1,
            sourceProjectName: 'Source',
            importedAssets: [importedBg],
            reusedAssetIds: [],
            importedAnimations: [],
            importedCharacters: [],
            importedVoiceProfiles: [],
            nameConflicts: [],
          };
        },
      },
    });

    expect(result.ok).toBe(true);
    expect(store.getSnapshot()?.project.assets).toHaveLength(1);
    expect(store.getSnapshot()?.revision).toBe(1);
    expect(store.getSnapshot()?.dirty).toBe(false);

    // Undo / Redo works as a single command
    expect(store.undo()).toBe(true);
    expect(store.getSnapshot()?.project.assets).toHaveLength(0);
    expect(store.redo()).toBe(true);
    expect(store.getSnapshot()?.project.assets).toHaveLength(1);
  });

  it('R6: remaps cross-character motionMappings completely when both characters are imported and drops dangling mappings while preserving generated actions when imported alone', () => {
    const src = createGraphicSourceProject();
    const sourceChar = src.project.characters[0]!;
    if (sourceChar.mode !== 'adaptive-parts') throw new Error('expected adaptive-parts');
    const sourceBodyPartId = sourceChar.parts[0]!.partId;
    const sourceLayeredActionId = randomUUID();
    const sourceCharWithAction: Character = {
      ...sourceChar,
      actions: [
        ...(sourceChar.actions ?? []),
        {
          id: sourceLayeredActionId,
          name: '挥臂',
          kind: 'layered',
          tracks: [
            {
              partId: sourceBodyPartId,
              property: 'transform.rotationDeg',
              keys: [
                { timeMs: 0, value: 0, interpolationToNext: 'linear' },
                { timeMs: 500, value: 18, interpolationToNext: 'linear' },
              ],
            },
          ],
        },
      ],
    };

    const targetCharId = randomUUID();
    const targetVoiceId = randomUUID();
    const targetBodyPartId = randomUUID();
    const targetGeneratedActionId = randomUUID();
    const targetChar: Character = {
      id: targetCharId,
      name: '徒弟熊猫',
      mode: 'adaptive-parts',
      defaultVoiceProfileId: targetVoiceId,
      defaultScale: 1,
      defaultFlipX: false,
      sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
      parts: [
        {
          partId: targetBodyPartId,
          source: {
            kind: 'source-instance',
            sourceId: 'src-apprentice-body',
            sourcePoseFrame: 0,
            effectiveFrame: 0,
          },
          restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
          drawOrder: 0,
          visible: true,
          displayName: '身体',
          visualSource: {
            kind: 'fla-graphic',
            animationId: src.graphicId,
            nodePath: ['node-opaque-shape'],
          },
        },
      ],
      actions: [
        {
          id: targetGeneratedActionId,
          name: '小熊猫 · 挥臂',
          kind: 'layered',
          tracks: [
            {
              partId: targetBodyPartId,
              property: 'transform.rotationDeg',
              keys: [
                { timeMs: 0, value: 0, interpolationToNext: 'linear' },
                { timeMs: 500, value: 18, interpolationToNext: 'linear' },
              ],
            },
          ],
        },
      ],
      motionMappings: [
        {
          sourceCharacterId: sourceChar.id,
          sourceActionId: sourceLayeredActionId,
          generatedActionId: targetGeneratedActionId,
          rules: [
            {
              sourcePartId: sourceBodyPartId,
              targetPartId: targetBodyPartId,
              mirror: false,
              translationScale: 1,
              pivotOffset: { x: 0, y: 0 },
              properties: ['transform.rotationDeg'],
            },
          ],
        },
      ],
    };

    const sourceProject = ProjectSchema.parse({
      ...src.project,
      characters: [sourceCharWithAction, targetChar],
      voiceProfiles: [
        ...src.project.voiceProfiles,
        {
          id: targetVoiceId,
          name: '徒弟配音',
          characterId: targetCharId,
          locale: 'zh-CN',
          rate: 1,
          pitch: 0,
        },
      ],
    });

    const targetLayerId = randomUUID();
    const emptyTarget = new ShotService().create(
      makeBaseProject({ name: 'Target With Mapping' }),
      { name: '镜头 1', durationMs: 3_000 },
    );
    const targetShotId = emptyTarget.shots[0]!.id;

    // Case 1: Import BOTH targetChar (listed first!) and sourceChar in the same batch.
    const bothClosure = collectProjectResourceClosure(sourceProject, [
      { kind: 'character', id: targetCharId },
      { kind: 'character', id: sourceChar.id },
    ]);
    const bothPlanned = bothClosure.assets.map((asset, idx) => ({
      sourceAsset: asset,
      targetId: randomUUID(),
      reused: false,
      targetRelativePath: `assets/both-${idx}${asset.mimeType === 'image/svg+xml' ? '.svg' : '.png'}`,
      sha256: asset.sha256,
    }));
    const bothCandidate = buildImportedProjectCandidate({
      targetProject: emptyTarget,
      sourceProject,
      closure: bothClosure,
      plannedAssets: bothPlanned,
      createId: randomUUID,
      updatedAtIso: '2026-11-27T02:00:00.000Z',
    });

    const reopenedBoth = ProjectSchema.parse(
      JSON.parse(JSON.stringify(bothCandidate.project)),
    );
    const importedSource = reopenedBoth.characters.find((c) => c.name === '小熊猫')!;
    const importedTarget = reopenedBoth.characters.find((c) => c.name === '徒弟熊猫')!;
    if (
      importedSource.mode !== 'adaptive-parts' ||
      importedTarget.mode !== 'adaptive-parts'
    ) {
      throw new Error('expected adaptive-parts');
    }
    expect(importedTarget.motionMappings).toHaveLength(1);
    const remappedMapping = importedTarget.motionMappings![0]!;
    const remappedSourceAction = importedSource.actions!.find(
      (a) => a.name === '挥臂',
    )!;
    const remappedGeneratedAction = importedTarget.actions!.find(
      (a) => a.name === '小熊猫 · 挥臂',
    )!;
    expect(remappedMapping.sourceCharacterId).toBe(importedSource.id);
    expect(remappedMapping.sourceCharacterId).not.toBe(sourceChar.id);
    expect(remappedMapping.sourceActionId).toBe(remappedSourceAction.id);
    expect(remappedMapping.sourceActionId).not.toBe(sourceLayeredActionId);
    expect(remappedMapping.generatedActionId).toBe(remappedGeneratedAction.id);
    expect(remappedMapping.generatedActionId).not.toBe(targetGeneratedActionId);
    expect(remappedMapping.rules[0]!.sourcePartId).toBe(
      importedSource.parts[0]!.partId,
    );
    expect(remappedMapping.rules[0]!.sourcePartId).not.toBe(sourceBodyPartId);
    expect(remappedMapping.rules[0]!.targetPartId).toBe(
      importedTarget.parts[0]!.partId,
    );
    expect(remappedMapping.rules[0]!.targetPartId).not.toBe(targetBodyPartId);

    // Formal consumer `planMappedCharacterMotion` must accept the remapped mapping and reuse generatedActionId!
    const projectWithLayer = ProjectSchema.parse({
      ...reopenedBoth,
      shots: reopenedBoth.shots.map((shot) => ({
        ...shot,
        layers: [
          ...shot.layers,
          {
            id: targetLayerId,
            name: importedTarget.name,
            source: { kind: 'character', characterId: importedTarget.id },
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
    const mappedRun = planMappedCharacterMotion(
      projectWithLayer,
      targetShotId,
      targetLayerId,
      0,
      {
        sourceCharacterId: remappedMapping.sourceCharacterId,
        sourceActionId: remappedMapping.sourceActionId,
        rules: remappedMapping.rules,
      },
    );
    expect(mappedRun.missingSourcePartIds).toEqual([]);
    const targetAfterRun = mappedRun.project.characters.find(
      (c) => c.id === importedTarget.id,
    )!;
    expect(targetAfterRun.actions).toHaveLength(1);
    expect(targetAfterRun.actions![0]!.id).toBe(remappedGeneratedAction.id);

    // Case 2: Import ONLY targetChar (source character NOT selected).
    const soloClosure = collectProjectResourceClosure(sourceProject, [
      { kind: 'character', id: targetCharId },
    ]);
    expect(soloClosure.characters).toHaveLength(1);
    const soloPlanned = soloClosure.assets.map((asset, idx) => ({
      sourceAsset: asset,
      targetId: randomUUID(),
      reused: false,
      targetRelativePath: `assets/solo-${idx}${asset.mimeType === 'image/svg+xml' ? '.svg' : '.png'}`,
      sha256: asset.sha256,
    }));
    const soloCandidate = buildImportedProjectCandidate({
      targetProject: emptyTarget,
      sourceProject,
      closure: soloClosure,
      plannedAssets: soloPlanned,
      createId: randomUUID,
      updatedAtIso: '2026-11-27T02:00:00.000Z',
    });
    const reopenedSolo = ProjectSchema.parse(
      JSON.parse(JSON.stringify(soloCandidate.project)),
    );
    const soloImportedTarget = reopenedSolo.characters[0]!;
    expect(soloImportedTarget.mode).toBe('adaptive-parts');
    if (soloImportedTarget.mode === 'adaptive-parts') {
      expect(soloImportedTarget.motionMappings).toBeUndefined();
      // Independent generated layered action remains intact and remapped to new partId!
      expect(soloImportedTarget.actions).toHaveLength(1);
      const action = soloImportedTarget.actions![0]!;
      expect('kind' in action && action.tracks[0]!.partId).toBe(
        soloImportedTarget.parts[0]!.partId,
      );
    }
  });
});
