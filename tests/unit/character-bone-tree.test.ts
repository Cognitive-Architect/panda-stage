import { describe, expect, it } from 'vitest';
import {
  CharacterBoneService,
  CharacterService,
  ProjectSchema,
  migrateProject,
  removeAdaptivePartFromDefinition,
  resolveCharacterBoneTree,
  type CharacterBone,
  type Project,
} from '../../src/domain';
import { adaptiveCharacterOf, buildBoneFixture, withBones, withClip } from '../helpers/boneTreeFixtures';

const BONE_ROOT = '00000000-0000-4000-8000-000000000301';
const BONE_CHILD = '00000000-0000-4000-8000-000000000302';
const BONE_LEAF = '00000000-0000-4000-8000-000000000303';
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000399';

function rootBone(partId?: string): CharacterBone {
  return {
    id: BONE_ROOT,
    name: '躯干',
    parentBoneId: null,
    ...(partId ? { partId } : {}),
    restLocal: { x: 320, y: 320, rotationDeg: 0 },
  };
}

function childBone(partId?: string): CharacterBone {
  return {
    id: BONE_CHILD,
    name: '上臂',
    parentBoneId: BONE_ROOT,
    ...(partId ? { partId } : {}),
    restLocal: { x: 120, y: 0, rotationDeg: 0 },
    length: 80,
    minDeg: -140,
    maxDeg: 140,
  };
}

function leafBone(): CharacterBone {
  return {
    id: BONE_LEAF,
    name: '前臂',
    parentBoneId: BONE_CHILD,
    restLocal: { x: 80, y: 0, rotationDeg: 0 },
  };
}

function fixtureWithTree(): {
  project: Project;
  characterId: string;
  partIds: readonly string[];
} {
  const { project, characterId, partIds } = buildBoneFixture(3);
  return {
    project: withBones(project, characterId, [
      rootBone(partIds[0]!),
      childBone(partIds[1]!),
      leafBone(),
    ]),
    characterId,
    partIds,
  };
}

describe('character bone tree schema', () => {
  it('parses, resolves parent-first, and round-trips through JSON and migrateProject', () => {
    const { project, characterId } = fixtureWithTree();
    const character = adaptiveCharacterOf(project, characterId);
    const resolution = resolveCharacterBoneTree(character);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) return;
    expect(resolution.order).toEqual([BONE_ROOT, BONE_CHILD, BONE_LEAF]);
    expect([...resolution.boneByPart.entries()]).toEqual([
      [expect.any(String), BONE_ROOT],
      [expect.any(String), BONE_CHILD],
    ]);

    const reopened = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(adaptiveCharacterOf(reopened, characterId).bones).toEqual(character.bones);
    expect(ProjectSchema.parse({ ...project })).toEqual(project);
  });

  it('rejects duplicate ids, missing parents, cycles, multiple roots and bad limits', () => {
    const { project, characterId, partIds } = buildBoneFixture(3);
    expect(() => withBones(project, characterId, [
      rootBone(partIds[0]),
      { ...childBone(partIds[1]), id: BONE_ROOT },
    ])).toThrow(/Duplicate Bone identity/);
    expect(() => withBones(project, characterId, [
      rootBone(partIds[0]),
      { ...childBone(partIds[1]), parentBoneId: UNKNOWN_ID },
    ])).toThrow(/unknown Bone identity/);
    expect(() => withBones(project, characterId, [
      { ...rootBone(partIds[0]), parentBoneId: BONE_CHILD },
      childBone(partIds[1]),
    ])).toThrow(/cycle/);
    expect(() => withBones(project, characterId, [
      rootBone(partIds[0]),
      { ...childBone(partIds[1]), parentBoneId: null },
    ])).toThrow(/at most one root/);
    expect(() => withBones(project, characterId, [
      rootBone(partIds[0]),
      { ...childBone(partIds[1]), minDeg: 40, maxDeg: -40 },
    ])).toThrow(/minimum angle/);
  });

  it('rejects unknown Parts, duplicate Part bindings, and non-existent parents', () => {
    const { project, characterId, partIds } = buildBoneFixture(3);
    expect(() => withBones(project, characterId, [
      rootBone(partIds[0]),
      { ...childBone(UNKNOWN_ID) },
    ])).toThrow(/unknown Part identity/);
    expect(() => withBones(project, characterId, [
      rootBone(partIds[0]),
      childBone(partIds[0]),
    ])).toThrow(/already bound to another Bone/);
    expect(resolveCharacterBoneTree({
      ...adaptiveCharacterOf(project, characterId),
      bones: [{ ...leafBone(), parentBoneId: UNKNOWN_ID }],
    })).toMatchObject({ ok: false, code: 'missing-parent' });
  });

  it('keeps legacy part-only tracks strict and accepts Bone pose tracks without a basis', () => {
    const { project, characterId, partIds, shotId, layerId } = buildBoneFixture(3) as ReturnType<typeof buildBoneFixture>;
    const withTree = withClip(withBones(project, characterId, [rootBone(partIds[0])]), shotId, layerId);
    const clip = withTree.shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip!;
    if (clip.version !== 1) throw new Error('Expected Clip v1');
    const boneTrack = {
      target: { kind: 'character-bone' as const, layerId, boneId: BONE_ROOT },
      property: 'transform.rotationDeg' as const,
      keys: [
        { timeMs: 0, value: 0, interpolationToNext: 'linear' as const },
        { timeMs: 1000, value: 45, interpolationToNext: 'linear' as const },
      ],
    };
    const withBoneTrack = ProjectSchema.parse({
      ...withTree,
      shots: withTree.shots.map((shot) => shot.id === shotId ? {
        ...shot,
        layers: shot.layers.map((layer) =>
          layer.id === layerId ? { ...layer, animationClip: { ...clip, tracks: [...clip.tracks, boneTrack] } } : layer),
      } : shot),
    });
    expect(withBoneTrack).not.toBe(withTree);
    // A Part target still requires its frozen basis.
    expect(() => ProjectSchema.parse({
      ...withTree,
      shots: withTree.shots.map((shot) => shot.id === shotId ? {
        ...shot,
        layers: shot.layers.map((layer) => layer.id === layerId ? {
          ...layer,
          animationClip: { ...clip, tracks: [{ ...boneTrack, target: { kind: 'character-part', layerId, partId: UNKNOWN_ID } }] },
        } : layer),
      } : shot),
    })).toThrow(/matching target basis/);
  });
});

describe('character bone service', () => {
  it('creates one root, children, and cascades deletion with clear Chinese errors', () => {    const { project, characterId, partIds } = buildBoneFixture(3);
    let next = new CharacterBoneService().createBone(project, characterId, {
      parentBoneId: null,
      name: '躯干',
      partId: partIds[0],
    });
    const root = adaptiveCharacterOf(next, characterId).bones![0]!;
    expect(root.restLocal).toEqual({ x: 320, y: 320, rotationDeg: 0 });
    expect(() => new CharacterBoneService().createBone(next, characterId, { parentBoneId: null }))
      .toThrow('骨骼树已有根骨骼');
    next = new CharacterBoneService().createBone(next, characterId, {
      parentBoneId: root.id,
      partId: partIds[1],
    });
    const child = adaptiveCharacterOf(next, characterId).bones![1]!;
    expect(child.restLocal).toEqual({ x: 120, y: 0, rotationDeg: 0 });
    const deleted = new CharacterBoneService().deleteBone(next, characterId, root.id);
    expect(adaptiveCharacterOf(deleted, characterId).bones).toBeUndefined();
  });

  it('rejects duplicate Part binding, protected Parts, and invalid limits', () => {
    const { project, characterId, partIds } = buildBoneFixture(3);
    const withRoot = new CharacterBoneService().createBone(project, characterId, {
      parentBoneId: null,
      partId: partIds[0],
    });
    const root = adaptiveCharacterOf(withRoot, characterId).bones![0]!;
    const withChild = new CharacterBoneService().createBone(withRoot, characterId, {
      parentBoneId: root.id,
      partId: partIds[1],
    });
    const child = adaptiveCharacterOf(withChild, characterId).bones![1]!;
    expect(() => new CharacterBoneService().bindBonePart(withChild, characterId, child.id, partIds[0]!))
      .toThrow('该部件已绑定到其他骨骼');

    const withHead = new CharacterService().setAdaptivePartsHeadMotionBinding(withChild, characterId, [partIds[2]!]);
    expect(() => new CharacterBoneService().bindBonePart(withHead, characterId, child.id, partIds[2]!))
      .toThrow('不能绑定骨骼');

    expect(() => new CharacterBoneService().updateBone(withChild, characterId, child.id, { minDeg: 30, maxDeg: -30 }))
      .toThrow('最小角度不能大于最大角度');
    const updated = new CharacterBoneService().updateBone(withChild, characterId, child.id, {
      restLocal: { x: 200, y: 10, rotationDeg: 15 },
      length: 90,
      minDeg: -90,
      maxDeg: 90,
    });
    const saved = adaptiveCharacterOf(updated, characterId).bones!.find(({ id }) => id === child.id)!;
    expect(saved.restLocal).toEqual({ x: 200, y: 10, rotationDeg: 15 });
    expect(saved.length).toBe(90);
    // Unbinding keeps the Bone but releases the Part.
    const unbound = new CharacterBoneService().bindBonePart(updated, characterId, child.id, null);
    expect(adaptiveCharacterOf(unbound, characterId).bones!.find(({ id }) => id === child.id)!.partId)
      .toBeUndefined();
  });

  it('drops only the Bone binding when a bound Part is removed through the assembly path', () => {
    const { project, characterId, partIds } = buildBoneFixture(3);
    const characterService = new CharacterService();
    let next = new CharacterBoneService().createBone(project, characterId, {
      parentBoneId: null,
      partId: partIds[0],
    });
    const root = adaptiveCharacterOf(next, characterId).bones![0]!;
    next = new CharacterBoneService().createBone(next, characterId, {
      parentBoneId: root.id,
      partId: partIds[1],
    });
    const child = adaptiveCharacterOf(next, characterId).bones![1]!;
    const definition = characterService.getAdaptivePartsDefinition(next, characterId);
    const applied = characterService.applyAdaptivePartsDefinition(
      next,
      characterId,
      removeAdaptivePartFromDefinition(definition, partIds[1]!),
    );
    const character = adaptiveCharacterOf(applied, characterId);
    expect(character.parts.map(({ partId }) => partId)).toEqual([partIds[0], partIds[2]]);
    // The Bone survives, only its binding to the removed Part is released.
    expect(character.bones?.map(({ id }) => id)).toEqual([root.id, child.id]);
    expect(character.bones?.[0]?.partId).toBe(partIds[0]);
    expect(character.bones?.[1]?.partId).toBeUndefined();
  });
});

describe('bone pose track contract', () => {
  it('writes and deletes Bone keys with one Project update and persists across reparse', () => {
    const { project, characterId, partIds, shotId, layerId } = buildBoneFixture(3) as ReturnType<typeof buildBoneFixture>;
    const withTree = withBones(project, characterId, [rootBone(partIds[0])]);
    const service = new CharacterBoneService();
    const posed = service.applyBonePose(withTree, {
      shotId, layerId, boneId: BONE_ROOT, timeMs: 0,
    }, { 'transform.rotationDeg': 30 });
    const clip = posed.shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip!;
    if (clip.version !== 1) throw new Error('Expected Clip v1');
    expect(clip.tracks).toContainEqual(expect.objectContaining({
      target: { kind: 'character-bone', layerId, boneId: BONE_ROOT },
      property: 'transform.rotationDeg',
    }));
    expect(migrateProject(JSON.parse(JSON.stringify(posed))).shots[0]!.layers
      .find(({ id }) => id === layerId)!.animationClip).toEqual(clip);
    const keyed = service.applyBonePose(posed, {
      shotId, layerId, boneId: BONE_ROOT, timeMs: 1000,
    }, { 'transform.rotationDeg': 75 });
    expect(service.deleteBoneKey(keyed, {
      shotId, layerId, boneId: BONE_ROOT, timeMs: 1000,
    }).shots[0]!.layers.find(({ id }) => id === layerId)!.animationClip?.tracks
      .find((track) => track.target.kind === 'character-bone')!.keys).toEqual([
      { timeMs: 0, value: 30, interpolationToNext: 'linear' },
    ]);
  });
});
