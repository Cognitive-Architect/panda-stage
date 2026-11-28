import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ProjectSchema,
  buildImportedProjectCandidate,
  characterBonePartDeltas,
  characterBoneTargetRef,
  collectProjectResourceClosure,
  resolveCharacterBoneTree,
  type CharacterBone,
  type Project,
} from '../../src/domain';
import { adaptiveCharacterOf, buildBoneFixture, withBones } from '../helpers/boneTreeFixtures';
import { buildProject } from './domain/testProject';

const PELVIS = '00000000-0000-4000-8000-000000000601';
const THIGH = '00000000-0000-4000-8000-000000000602';
const SHIN = '00000000-0000-4000-8000-000000000603';
const ACTION_ID = '71000000-0000-4000-8000-000000000010';
const COPY_ID = '71000000-0000-4000-8000-000000000011';

interface BoneSourceFixture {
  project: Project;
  characterId: string;
  sourceLayerId: string;
  sourcePartIds: readonly string[];
  bones: readonly CharacterBone[];
}

/** Adaptive-parts Character with a bound Bone tree plus one instance action copy. */
function boneSourceFixture(): BoneSourceFixture {
  const base = buildBoneFixture(3);
  const [firstPartId, secondPartId] = base.partIds as [string, string, string];
  const bones: CharacterBone[] = [
    { id: PELVIS, parentBoneId: null, restLocal: { x: 0, y: 0, rotationDeg: 0 } },
    {
      id: THIGH,
      parentBoneId: PELVIS,
      restLocal: { x: 120, y: 0, rotationDeg: 0 },
      partId: firstPartId,
    },
    {
      id: SHIN,
      parentBoneId: THIGH,
      restLocal: { x: 120, y: 0, rotationDeg: 0 },
      partId: secondPartId,
    },
  ];
  const withBoneTree = withBones(base.project, base.characterId, bones);
  const project = ProjectSchema.parse({
    ...withBoneTree,
    characters: withBoneTree.characters.map((character) => character.id !== base.characterId ? character : {
      ...character,
      actions: [
        {
          id: ACTION_ID,
          name: '招手',
          kind: 'layered' as const,
          tracks: [{
            partId: firstPartId,
            property: 'transform.rotationDeg' as const,
            keys: [
              { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
              { timeMs: 500, value: 20, interpolationToNext: 'linear' as const },
            ],
          }],
        },
        {
          id: COPY_ID,
          name: '招手 副本',
          kind: 'layered' as const,
          originActionId: ACTION_ID,
          instanceScope: { layerId: base.layerId },
          tracks: [{
            partId: firstPartId,
            property: 'transform.rotationDeg' as const,
            keys: [
              { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
              { timeMs: 500, value: 45, interpolationToNext: 'linear' as const },
            ],
          }],
        },
      ],
    }),
  });
  return {
    project,
    characterId: base.characterId,
    sourceLayerId: base.layerId,
    sourcePartIds: base.partIds,
    bones,
  };
}

function importCharacter(sourceProject: Project, characterId: string) {
  const closure = collectProjectResourceClosure(sourceProject, [{ kind: 'character', id: characterId }]);
  expect(closure.issues).toEqual([]);
  const plannedAssets = closure.assets.map((asset, index) => ({
    sourceAsset: asset,
    targetId: randomUUID(),
    reused: false,
    targetRelativePath: `assets/bones-import-${index}.png`,
    sha256: asset.sha256,
  }));
  return buildImportedProjectCandidate({
    targetProject: buildProject(),
    sourceProject,
    closure,
    plannedAssets,
    createId: randomUUID,
    updatedAtIso: '2026-11-28T00:00:00.000Z',
  });
}

describe('cross-project import bone tree remap (#1455 x #1449)', () => {
  it('remaps bones[].partId to the imported Parts and keeps the tree plus FK binding valid', () => {
    const fixture = boneSourceFixture();
    const sourceSnapshot = JSON.stringify(fixture.project);
    const candidate = importCharacter(fixture.project, fixture.characterId);
    // Importing must never mutate the source project or character.
    expect(JSON.stringify(fixture.project)).toBe(sourceSnapshot);

    const imported = candidate.importedCharacters[0]!;
    if (imported.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts character.');
    expect(imported.bones).toHaveLength(fixture.bones.length);
    const importedPartIds = new Set(imported.parts.map((part) => part.partId));
    // No Bone may still point at the source project's Part ids.
    for (const bone of imported.bones!) {
      if (bone.partId === undefined) continue;
      expect(importedPartIds.has(bone.partId)).toBe(true);
      expect(fixture.sourcePartIds).not.toContain(bone.partId);
    }
    // Parent identity and tree shape are preserved.
    expect(imported.bones!.map((bone) => [bone.id, bone.parentBoneId])).toEqual(
      fixture.bones.map((bone) => [bone.id, bone.parentBoneId]),
    );
    expect(imported.bones!.map((bone) => bone.partId)).toEqual([
      undefined,
      imported.parts[0]!.partId,
      imported.parts[1]!.partId,
    ]);
    const tree = resolveCharacterBoneTree(imported);
    expect(tree.ok).toBe(true);
    if (!tree.ok) throw new Error('Expected a valid Bone tree.');
    const boundBone = imported.bones!.find((bone) => bone.partId !== undefined)!;
    expect(tree.boneByPart.get(boundBone.partId!)).toBe(boundBone.id);

    // FK + Part binding still work through the formal bone-pose path.
    const deltas = characterBonePartDeltas({
      character: imported,
      values: [{
        target: characterBoneTargetRef(fixture.sourceLayerId, boundBone.id),
        property: 'transform.rotationDeg',
        value: 30,
      }],
      fixedCharacterCenter: { x: 0, y: 0 },
    });
    const boundDelta = deltas.get(boundBone.partId!);
    expect(boundDelta).toBeDefined();
    expect(boundDelta).not.toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });

    // #1469 F2 / #1449: instance isolation is the default. Only the shared
    // action is imported; the private modified copy is never promoted into the
    // target project's shared library and no dangling owner is carried over.
    const importedActions = imported.actions ?? [];
    expect(importedActions.map((action) => action.name)).toEqual(['招手']);
    expect(importedActions.some((action) => 'instanceScope' in action)).toBe(false);
    expect(importedActions.some((action) => 'originActionId' in action)).toBe(false);
    const importedShared = importedActions.find((action) => 'kind' in action)!;
    if ('kind' in importedShared) {
      expect(importedShared.tracks[0]!.partId).toBe(imported.parts[0]!.partId);
      expect(importedShared.tracks[0]!.keys.map((key) => key.value)).toEqual([0, 20]);
    }
    expect(() => ProjectSchema.parse(candidate.project)).not.toThrow();
  });

  it('keeps the imported project formally valid when the character is opened standalone', () => {
    const fixture = boneSourceFixture();
    const character = adaptiveCharacterOf(fixture.project, fixture.characterId);
    expect(character.bones?.length).toBe(fixture.bones.length);
    const candidate = importCharacter(fixture.project, fixture.characterId);
    // Building the candidate already validates against the formal schema; a
    // second round-trip proves the persisted JSON keeps the remapped bindings.
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(candidate.project)));
    const imported = reopened.characters.find((entry) => entry.id === candidate.importedCharacters[0]!.id)!;
    if (imported.mode !== 'adaptive-parts') throw new Error('Expected adaptive-parts character.');
    const partIds = new Set(imported.parts.map((part) => part.partId));
    for (const bone of imported.bones ?? []) {
      if (bone.partId !== undefined) expect(partIds.has(bone.partId)).toBe(true);
    }
  });
});
