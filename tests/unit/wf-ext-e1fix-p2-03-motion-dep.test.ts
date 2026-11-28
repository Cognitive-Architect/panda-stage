import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  analyzeProjectResourceReuse,
  buildImportedProjectCandidate,
  collectProjectResourceClosure,
  PROJECT_FPS,
  PROJECT_HEIGHT,
  PROJECT_SCHEMA_VERSION,
  PROJECT_WIDTH,
  ProjectSchema,
  resolveDefinitionReusePlan,
  type Character,
  type FlaGraphicDefinition,
  type ImageAsset,
  type Project,
} from '../../src/domain';

const SHA_A = 'a'.repeat(64);

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
    name: 'Target',
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

function buildTwoCharacterProjectWithMotionMapping(): {
  project: Project;
  charAId: string;
  charBId: string;
  charAPartId: string;
  charBPartId: string;
  charAActionId: string;
  charBActionId: string;
  assetAId: string;
  assetBId: string;
  graphicId: string;
} {
  const graphicId = randomUUID();
  const frameSvgAssetId = randomUUID();
  const assetAId = randomUUID();
  const assetBId = randomUUID();
  const charAId = randomUUID();
  const charBId = randomUUID();
  const voiceAId = randomUUID();
  const voiceBId = randomUUID();
  const charAPartId = randomUUID();
  const charBPartId = randomUUID();
  const charAActionId = randomUUID();
  const charBActionId = randomUUID();
  const exprAId = randomUUID();
  const exprBId = randomUUID();

  const assetA = makeImageAsset({ id: assetAId, name: 'BodyA' });
  const assetB = makeImageAsset({ id: assetBId, name: 'BodyB' });
  const frameSvgAsset = makeImageAsset({
    id: frameSvgAssetId,
    name: 'GraphicFrame0',
    relativePath: 'assets/frame-0.svg',
    mimeType: 'image/svg+xml',
    sha256: SHA_A,
    flaGraphicFrame: { definitionId: graphicId, ordinal: 0 },
  });

  const graphic: FlaGraphicDefinition = {
    id: graphicId,
    name: 'SharedGraphic',
    kind: 'fla-graphic',
    durationMs: 1000 / 24,
    source: {
      basename: 'shared.fla',
      sha256: SHA_A,
      renderTargetId: 'symbol:Shared',
      targetKind: 'graphic-symbol',
      targetName: 'Shared',
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
        sha256: SHA_A,
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
                  id: 'node-1',
                  sourceAddress: 'L0/F0/Body',
                  drawOrder: 0,
                  localTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
                  bitmapRef: 'bitmaps/body.png',
                  assetId: assetAId,
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
    name: '角色A',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceAId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: charAPartId,
        source: { kind: 'source-instance', sourceId: 'src-a', sourcePoseFrame: 0, effectiveFrame: 0 },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        drawOrder: 0,
        visible: true,
        displayName: '身体',
        visualSource: { kind: 'fla-graphic', animationId: graphicId },
      },
    ],
    expressions: [{ id: exprAId, name: '正常', assetId: assetAId }],
    defaultExpressionId: exprAId,
    actions: [
      {
        id: charAActionId,
        kind: 'layered',
        name: '点头',
        tracks: [
          {
            partId: charAPartId,
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
    name: '角色B',
    mode: 'adaptive-parts',
    defaultVoiceProfileId: voiceBId,
    defaultScale: 1,
    defaultFlipX: false,
    sourceRootTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
    parts: [
      {
        partId: charBPartId,
        source: { kind: 'source-instance', sourceId: 'src-b', sourcePoseFrame: 0, effectiveFrame: 0 },
        restTransform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 },
        drawOrder: 0,
        visible: true,
        displayName: '身体',
        visualSource: { kind: 'fla-graphic', animationId: graphicId },
      },
    ],
    expressions: [{ id: exprBId, name: '正常', assetId: assetBId }],
    defaultExpressionId: exprBId,
    actions: [
      {
        id: charBActionId,
        kind: 'layered',
        name: '联动点头',
        tracks: [
          {
            partId: charBPartId,
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
        generatedActionId: charBActionId,
        rules: [
          {
            sourcePartId: charAPartId,
            targetPartId: charBPartId,
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
    assets: [assetA, assetB, frameSvgAsset],
    animations: [graphic],
    characters: [charA, charB],
    voiceProfiles: [
      { id: voiceAId, name: '声A', characterId: charAId, locale: 'zh-CN', rate: 1, pitch: 0 },
      { id: voiceBId, name: '声B', characterId: charBId, locale: 'zh-CN', rate: 1, pitch: 0 },
    ] as Project['voiceProfiles'],
  });
  return {
    project,
    charAId,
    charBId,
    charAPartId,
    charBPartId,
    charAActionId,
    charBActionId,
    assetAId,
    assetBId,
    graphicId,
  };
}

function planFreshAssets(
  assets: readonly { id: string; name: string; relativePath: string }[],
): never[] {
  return assets.map((a) => ({
    sourceAsset: a,
    targetId: randomUUID(),
    reused: false,
    targetRelativePath: `assets/copy-${a.name}.png`,
  })) as never[];
}

function importBoth(
  srcProject: Project,
  charAId: string,
  charBId: string,
  mutateTarget?: (p: Project) => Project,
) {
  const selections = [
    { kind: 'character' as const, id: charAId },
    { kind: 'character' as const, id: charBId },
  ];
  const closure = collectProjectResourceClosure(srcProject, selections);
  const built = buildImportedProjectCandidate({
    targetProject: makeBaseProject(),
    sourceProject: srcProject,
    closure,
    plannedAssets: planFreshAssets(closure.assets),
    createId: randomUUID,
    updatedAtIso: '2026-11-28T01:00:00.000Z',
    selections,
  });
  const target = mutateTarget ? mutateTarget(built.project) : built.project;
  return { closure, target, built };
}

describe('P2-03: cross-character motion mapping dependency consistency', () => {
  it('degrades B to independent copy when its dependency A is copied (not reused)', () => {
    const src = buildTwoCharacterProjectWithMotionMapping();
    const { closure, target } = importBoth(src.project, src.charAId, src.charBId);

    // Modify target A's action content → A is no longer compatible → will be copied.
    // B is still compatible → would be reused, but its motionMapping depends on A.
    const modifiedTarget = ProjectSchema.parse({
      ...target,
      characters: target.characters.map((c) => {
        if (c.mode !== 'adaptive-parts') return c;
        const hasActionChange = c.actions?.some((a) => a.id && a.name === '点头');
        return hasActionChange
          ? {
              ...c,
              actions: c.actions!.map((a) =>
                a.name === '点头'
                  ? {
                      ...a,
                      tracks: [
                        {
                          partId: c.parts[0]!.partId,
                          property: 'transform.rotationDeg',
                          keys: [
                            { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
                            { timeMs: 500, value: 45, interpolationToNext: 'linear' as const },
                          ],
                        },
                      ],
                    }
                  : a,
              ),
            }
          : c;
      }),
    });

    const analysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: modifiedTarget,
      closure,
    });

    // A should not be reusable (action content changed).
    expect(analysis.reusableCharacterBySourceId.has(src.charAId)).toBe(false);
    // B might still be compatible on its own.
    // But since B's motionMapping depends on A (which is copied), B must be degraded.
    const reuseChoices = [
      { kind: 'character' as const, sourceId: src.charAId, targetId: 'irrelevant' },
      ...(analysis.reusableCharacterBySourceId.has(src.charBId)
        ? [
            {
              kind: 'character' as const,
              sourceId: src.charBId,
              targetId: analysis.reusableCharacterBySourceId.get(src.charBId)!
                .targetId,
            },
          ]
        : []),
    ];
    const plan = resolveDefinitionReusePlan(analysis, reuseChoices, closure);
    // B must NOT be in the reused set because its dependency A is being copied.
    expect(plan.reusedCharacters.has(src.charBId)).toBe(false);
  });

  it('allows B to be reused when both A and B are compatible and explicitly reused', () => {
    const src = buildTwoCharacterProjectWithMotionMapping();
    const { closure, target } = importBoth(src.project, src.charAId, src.charBId);

    const analysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: target,
      closure,
    });

    // Both A and B should be reusable.
    expect(analysis.reusableCharacterBySourceId.has(src.charAId)).toBe(true);
    expect(analysis.reusableCharacterBySourceId.has(src.charBId)).toBe(true);

    const plan = resolveDefinitionReusePlan(
      analysis,
      [
        {
          kind: 'character',
          sourceId: src.charAId,
          targetId: analysis.reusableCharacterBySourceId.get(src.charAId)!
            .targetId,
        },
        {
          kind: 'character',
          sourceId: src.charBId,
          targetId: analysis.reusableCharacterBySourceId.get(src.charBId)!
            .targetId,
        },
      ],
      closure,
    );
    expect(plan.reusedCharacters.size).toBe(2);
  });

  it('degrades B when A is explicitly chosen for independent copy', () => {
    const src = buildTwoCharacterProjectWithMotionMapping();
    const { closure, target } = importBoth(src.project, src.charAId, src.charBId);

    const analysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: target,
      closure,
    });

    // User explicitly chooses to copy A (no reuse choice for A), but reuse B.
    const plan = resolveDefinitionReusePlan(
      analysis,
      [
        {
          kind: 'character',
          sourceId: src.charBId,
          targetId: analysis.reusableCharacterBySourceId.get(src.charBId)!
            .targetId,
        },
      ],
      closure,
    );
    // B must be degraded because A is not in the reused set.
    expect(plan.reusedCharacters.has(src.charBId)).toBe(false);
  });

  it('handles circular dependency with finite convergence', () => {
    const src = buildTwoCharacterProjectWithMotionMapping();
    // Make A also depend on B (circular).
    const circularProject = ProjectSchema.parse({
      ...src.project,
      characters: src.project.characters.map((c) => {
        if (c.id !== src.charAId || c.mode !== 'adaptive-parts') return c;
        return {
          ...c,
          motionMappings: [
            {
              sourceCharacterId: src.charBId,
              sourceActionId: src.charBActionId,
              generatedActionId: src.charAActionId,
              rules: [
                {
                  sourcePartId: src.charBPartId,
                  targetPartId: src.charAPartId,
                  mirror: false,
                  translationScale: 1,
                  pivotOffset: { x: 0, y: 0 },
                  properties: ['transform.rotationDeg'],
                },
              ],
            },
          ],
        };
      }),
    });

    const selections = [
      { kind: 'character' as const, id: src.charAId },
      { kind: 'character' as const, id: src.charBId },
    ];
    const closure = collectProjectResourceClosure(circularProject, selections);
    const built = buildImportedProjectCandidate({
      targetProject: makeBaseProject(),
      sourceProject: circularProject,
      closure,
      plannedAssets: planFreshAssets(closure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T01:00:00.000Z',
      selections,
    });

    const analysis = analyzeProjectResourceReuse({
      sourceProject: circularProject,
      targetProject: built.project,
      closure,
    });

    // Try to reuse both — circular dependency must converge (both degraded).
    const plan = resolveDefinitionReusePlan(
      analysis,
      [
        {
          kind: 'character',
          sourceId: src.charAId,
          targetId: analysis.reusableCharacterBySourceId.get(src.charAId)
            ?.targetId ?? 'x',
        },
        {
          kind: 'character',
          sourceId: src.charBId,
          targetId: analysis.reusableCharacterBySourceId.get(src.charBId)
            ?.targetId ?? 'x',
        },
      ],
      closure,
    );
    // In a circular dependency where both are reused, each references the other
    // correctly (both are in the reused set), so both can be safely reused.
    // The algorithm must converge finitely without infinite degradation.
    expect(plan.reusedCharacters.size).toBe(2);
  });
});
