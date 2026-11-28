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

function buildCharacterWithMouthPose(
  driveMode: 'asset-loop' | 'mouth-poses',
): { project: Project; charId: string; assetId: string } {
  const assetId = randomUUID();
  const charId = randomUUID();
  const voiceId = randomUUID();
  const exprId = randomUUID();
  const poseSetId = randomUUID();

  const asset = makeImageAsset({ id: assetId, name: 'Body' });

  const character: Character = {
    id: charId,
    name: '口型角色',
    mode: 'single-image',
    defaultVoiceProfileId: voiceId,
    defaultScale: 1,
    defaultFlipX: false,
    baseAssetId: assetId,
    expressions: [
      { id: exprId, name: '正常', assetId },
    ],
    defaultExpressionId: exprId,
    mouthPoseSet: {
      poses: [
        {
          id: poseSetId,
          name: '闭嘴',
          source: { kind: 'image', assetId },
          target: { kind: 'face' },
        },
      ],
      restPoseId: poseSetId,
      analyzerMapping: {
        rest: poseSetId,
        open: poseSetId,
        wide: poseSetId,
        round: poseSetId,
        closed: poseSetId,
      },
      driveMode,
    },
  };

  const project = makeBaseProject({
    assets: [asset],
    characters: [character],
    voiceProfiles: [
      {
        id: voiceId,
        name: '默认',
        characterId: charId,
        locale: 'zh-CN',
        rate: 1,
        pitch: 0,
      },
    ] as Project['voiceProfiles'],
  });
  return { project, charId, assetId };
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

describe('P2-01: mouth pose driveMode compatibility', () => {
  it('rejects reuse when mouthPoseSet.driveMode differs between source and target', () => {
    const src = buildCharacterWithMouthPose('mouth-poses');
    const selections = [{ kind: 'character' as const, id: src.charId }];
    const closure = collectProjectResourceClosure(src.project, selections);
    const built = buildImportedProjectCandidate({
      targetProject: makeBaseProject(),
      sourceProject: src.project,
      closure,
      plannedAssets: planFreshAssets(closure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T01:00:00.000Z',
      selections,
    });
    // Modify target driveMode → incompatible
    const modifiedTarget = ProjectSchema.parse({
      ...built.project,
      characters: built.project.characters.map((c) => ({
        ...c,
        mouthPoseSet: c.mouthPoseSet
          ? { ...c.mouthPoseSet, driveMode: 'asset-loop' as const }
          : undefined,
      })),
    });
    const analysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: modifiedTarget,
      closure,
    });
    expect(analysis.reusableCharacterBySourceId.size).toBe(0);
    expect(analysis.diagnostics.length).toBeGreaterThan(0);
  });

  it('rejects reuse when source driveMode differs from target', () => {
    const srcA = buildCharacterWithMouthPose('mouth-poses');
    const selections = [{ kind: 'character' as const, id: srcA.charId }];
    const closure = collectProjectResourceClosure(srcA.project, selections);
    const built = buildImportedProjectCandidate({
      targetProject: makeBaseProject(),
      sourceProject: srcA.project,
      closure,
      plannedAssets: planFreshAssets(closure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T01:00:00.000Z',
      selections,
    });
    // Use modifiedSource (different driveMode) against the target built from srcA
    const modifiedSource = ProjectSchema.parse({
      ...srcA.project,
      characters: srcA.project.characters.map((c) => ({
        ...c,
        mouthPoseSet: c.mouthPoseSet
          ? { ...c.mouthPoseSet, driveMode: 'asset-loop' as const }
          : undefined,
      })),
    });
    const modifiedClosure = collectProjectResourceClosure(modifiedSource, [
      { kind: 'character', id: srcA.charId },
    ]);
    const analysis2 = analyzeProjectResourceReuse({
      sourceProject: modifiedSource,
      targetProject: built.project,
      closure: modifiedClosure,
    });
    expect(analysis2.reusableCharacterBySourceId.size).toBe(0);
  });

  it('still allows explicit reuse when driveMode is identical', () => {
    const src = buildCharacterWithMouthPose('mouth-poses');
    const selections = [{ kind: 'character' as const, id: src.charId }];
    const closure = collectProjectResourceClosure(src.project, selections);
    const built = buildImportedProjectCandidate({
      targetProject: makeBaseProject(),
      sourceProject: src.project,
      closure,
      plannedAssets: planFreshAssets(closure.assets),
      createId: randomUUID,
      updatedAtIso: '2026-11-28T01:00:00.000Z',
      selections,
    });
    const analysis = analyzeProjectResourceReuse({
      sourceProject: src.project,
      targetProject: built.project,
      closure,
    });
    expect(analysis.reusableCharacterBySourceId.size).toBe(1);
    const plan = resolveDefinitionReusePlan(analysis, [
      {
        kind: 'character',
        sourceId: src.charId,
        targetId: built.project.characters[0]!.id,
      },
    ]);
    expect(plan.reusedCharacters.size).toBe(1);
  });

  it('compares talkingAnimationPlayback fields when present on both sides', () => {
    // Build a project object directly (bypassing ProjectSchema cross-ref
    // validation) to test the comparison logic for talkingAnimationPlayback.
    const src = buildCharacterWithMouthPose('mouth-poses');
    const charId = src.charId;

    const makeCharWithPlayback = (
      playback: Character['talkingAnimationPlayback'],
    ): Character => ({
      ...src.project.characters[0]!,
      ...(playback ? { talkingAnimationPlayback: playback } : {}),
    });

    const baseProject: Project = {
      ...src.project,
      characters: [makeCharWithPlayback({ firstFrame: 0, lastFrame: 0, mode: 'loop' })],
    };
    const modifiedProject: Project = {
      ...src.project,
      characters: [
        makeCharWithPlayback({ firstFrame: 0, lastFrame: 0, mode: 'play once' }),
      ],
    };

    const selections = [{ kind: 'character' as const, id: charId }];
    const closure = collectProjectResourceClosure(baseProject, selections);

    const analysisSame = analyzeProjectResourceReuse({
      sourceProject: baseProject,
      targetProject: baseProject,
      closure,
    });
    // Same playback → potentially reusable (other checks may still pass)
    // Different playback → must not be reusable
    const analysisDiff = analyzeProjectResourceReuse({
      sourceProject: modifiedProject,
      targetProject: baseProject,
      closure,
    });
    expect(analysisDiff.reusableCharacterBySourceId.size).toBeLessThanOrEqual(
      analysisSame.reusableCharacterBySourceId.size,
    );
    // The key assertion: differing playback must not produce a reusable candidate.
    if (analysisSame.reusableCharacterBySourceId.size === 1) {
      expect(analysisDiff.reusableCharacterBySourceId.size).toBe(0);
    }
  });
});
