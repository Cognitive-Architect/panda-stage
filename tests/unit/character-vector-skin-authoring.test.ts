// @vitest-environment happy-dom
import { randomUUID } from 'node:crypto';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHARACTER_VECTOR_SKIN_MAX_COUNT,
  CharacterBoneService,
  CharacterService,
  CharacterVectorSkinService,
  PROJECT_SCHEMA_VERSION,
  ProjectSchema,
  buildImportedProjectCandidate,
  collectProjectResourceClosure,
  migrateProject,
  removeAdaptivePartFromDefinition,
  type Project,
} from '../../src/domain';
import { CharacterVectorSkinControl } from '../../src/renderer/features/properties/CharacterVectorSkinControl';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { buildProject } from './domain/testProject';
import {
  VECTOR_SKIN_BONE_A_ID,
  VECTOR_SKIN_BONE_B_ID,
  buildVectorSkinFixture,
  withVectorSkin,
  withVectorSkinClip,
  type VectorSkinFixture,
} from '../helpers/vectorSkinFixtures';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
afterEach(() => {
  editorProjectStore.clear();
  timelineUiStore.seek(0, 3_000);
});

const SKIN_ID = 'b1000000-0000-4000-8000-000000000001';

function skin(
  fixture: VectorSkinFixture,
  overrides: Partial<{ id: string; partId: string; boneIds: [string, string] }> = {},
) {
  return {
    id: overrides.id ?? SKIN_ID,
    partId: overrides.partId ?? fixture.sleevePartId,
    boneIds: overrides.boneIds ?? [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
  };
}

function projectWithVectorSkins(
  fixture: VectorSkinFixture,
  skins: readonly unknown[],
): Project {
  return ProjectSchema.parse({
    ...fixture.project,
    characters: fixture.project.characters.map((character) =>
      character.id === fixture.characterId
        ? { ...character, vectorSkins: skins }
        : character),
  });
}

describe('vector skin schema', () => {
  it('keeps Schema v47 and round-trips through JSON with no rest geometry', () => {
    expect(PROJECT_SCHEMA_VERSION).toBe(47);
    const fixture = buildVectorSkinFixture();
    const withSkin = withVectorSkin(fixture);
    const reopened = ProjectSchema.parse(JSON.parse(JSON.stringify(withSkin.project)));
    const character = reopened.characters.find(({ id }) => id === fixture.characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
    expect(character.vectorSkins).toEqual([{
      id: 'a4000000-0000-4000-8000-000000000001',
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    }]);
    expect(JSON.stringify(reopened)).toBe(JSON.stringify(withSkin.project));
    // The migration entry point keeps the optional current-version field.
    const migrated = migrateProject(JSON.parse(JSON.stringify(withSkin.project)));
    const migratedCharacter = migrated.characters.find(({ id }) => id === fixture.characterId)!;
    if (migratedCharacter.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
    expect(migratedCharacter.vectorSkins).toEqual(character.vectorSkins);
  });

  it('rejects unknown Parts, unknown Bones, and non-vector Parts', () => {
    const fixture = buildVectorSkinFixture();
    expect(() => projectWithVectorSkins(fixture, [skin(fixture, {
      partId: 'b2000000-0000-4000-8000-000000000099',
    })])).toThrow(/unknown Part identity/u);
    expect(() => projectWithVectorSkins(fixture, [skin(fixture, {
      boneIds: [VECTOR_SKIN_BONE_A_ID, 'b3000000-0000-4000-8000-000000000099'],
    })])).toThrow(/unknown Bone identity/u);
    expect(() => projectWithVectorSkins(fixture, [skin(fixture, {
      partId: fixture.imagePartId,
    })])).toThrow(/FLA Graphic vector Part/u);
  });

  it('rejects duplicate skins, duplicate ids, identical Bones, and too many skins', () => {
    const fixture = buildVectorSkinFixture();
    expect(() => projectWithVectorSkins(fixture, [skin(fixture)])).not.toThrow();
    expect(() => projectWithVectorSkins(fixture, [skin(fixture), skin(fixture)])).toThrow();
    expect(() => projectWithVectorSkins(fixture, [skin(fixture), skin(fixture, {
      id: SKIN_ID,
    })])).toThrow();
    expect(() => projectWithVectorSkins(fixture, [skin(fixture, {
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_A_ID],
    })])).toThrow(/two distinct Bones/u);
    const tooMany = Array.from({ length: CHARACTER_VECTOR_SKIN_MAX_COUNT + 1 }, (_, index) => ({
      id: `b1000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    }));
    expect(() => projectWithVectorSkins(fixture, tooMany)).toThrow();
  });

  it('rejects anchor overrides that do not normalize or reference foreign Bones', () => {
    const fixture = buildVectorSkinFixture();
    expect(() => projectWithVectorSkins(fixture, [{
      ...skin(fixture),
      anchorWeights: [{
        anchorKey: '0:0:0',
        weights: [{ boneId: VECTOR_SKIN_BONE_A_ID, weight: 0.4 }],
      }],
    }])).toThrow(/must sum to 1/u);
    expect(() => projectWithVectorSkins(fixture, [{
      ...skin(fixture),
      anchorWeights: [{
        anchorKey: '0:0:0',
        weights: [{ boneId: 'b3000000-0000-4000-8000-000000000099', weight: 1 }],
      }],
    }])).toThrow(/Bone outside its skin/u);
  });
});

describe('vector skin authoring service', () => {
  it('creates and deletes one skin per confirmed Project update', () => {
    const fixture = buildVectorSkinFixture();
    const service = new CharacterVectorSkinService({ createId: () => SKIN_ID });
    const created = service.create(fixture.project, fixture.characterId, {
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    });
    expect(created).not.toBe(fixture.project);
    expect(service.list(created, fixture.characterId)).toEqual([skin(fixture)]);
    expect(() => ProjectSchema.parse(JSON.parse(JSON.stringify(created)))).not.toThrow();
    const deleted = service.delete(created, fixture.characterId, SKIN_ID);
    expect(service.list(deleted, fixture.characterId)).toEqual([]);
    expect(() => service.delete(deleted, fixture.characterId, SKIN_ID)).toThrow('未找到要删除的蒙皮。');
  });

  it('refuses invalid bindings with actionable Chinese errors', () => {
    const fixture = buildVectorSkinFixture();
    const service = new CharacterVectorSkinService({ createId: () => SKIN_ID });
    expect(() => service.create(fixture.project, fixture.characterId, {
      partId: fixture.imagePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    })).toThrow('请选择矢量元件部件。');
    expect(() => service.create(fixture.project, fixture.characterId, {
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_A_ID],
    })).toThrow('请选择两根不同的骨骼。');
    expect(() => service.create(fixture.project, fixture.characterId, {
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, 'b3000000-0000-4000-8000-000000000099'],
    })).toThrow('未找到所选骨骼。');
    const once = service.create(fixture.project, fixture.characterId, {
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    });
    expect(() => service.create(once, fixture.characterId, {
      partId: fixture.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    })).toThrow('该部件已有蒙皮');
    const gradient = buildVectorSkinFixture({ style: 'gradient' });
    expect(() => service.create(gradient.project, gradient.characterId, {
      partId: gradient.sleevePartId,
      boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID],
    })).toThrow('渐变或图案填充');
  });

  it('refuses protected face/mouth Parts', () => {
    const fixture = buildVectorSkinFixture();
    const withFace = new CharacterService().setAdaptivePartsFaceBinding(
      fixture.project,
      fixture.characterId,
      { targetPartId: fixture.sleevePartId },
    );
    expect(() => new CharacterVectorSkinService({ createId: () => SKIN_ID }).create(
      withFace,
      fixture.characterId,
      { partId: fixture.sleevePartId, boneIds: [VECTOR_SKIN_BONE_A_ID, VECTOR_SKIN_BONE_B_ID] },
    )).toThrow('不能创建矢量蒙皮');
  });

  it('describes computed weights count and fallback reason at Shot time', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const service = new CharacterVectorSkinService();
    // Before a Character Clip exists the binding is authorable but cannot pose.
    const before = service.describe(skinned.project, {
      shotId: fixture.shotId, layerId: fixture.layerId, timeMs: 0,
    });
    expect(before).toHaveLength(1);
    expect(before[0]!.partName).toBe('袖子');
    expect(before[0]!.boneNames).toEqual(['上臂', '前臂']);
    expect(before[0]!.requiresAnimationClip).toBe(true);
    expect(before[0]!.status).toBeUndefined();

    let project = withVectorSkinClip(skinned.project, fixture);
    project = new CharacterBoneService().applyBonePose(project, {
      shotId: fixture.shotId,
      layerId: fixture.layerId,
      boneId: VECTOR_SKIN_BONE_A_ID,
      timeMs: 1_000,
    }, { 'transform.rotationDeg': 25 });
    const posed = service.describe(project, {
      shotId: fixture.shotId, layerId: fixture.layerId, timeMs: 1_000,
    });
    expect(posed[0]!.requiresAnimationClip).toBe(false);
    expect(posed[0]!.status).toMatchObject({ anchorCount: 9, pointCount: 11, deformed: true });
    expect(posed[0]!.status!.fallback).toBeUndefined();
    const rest = service.describe(project, {
      shotId: fixture.shotId, layerId: fixture.layerId, timeMs: 0,
    });
    expect(rest[0]!.status).toMatchObject({ anchorCount: 9, deformed: false });
  });
});

describe('vector skin cascade and import remap', () => {
  it('drops a skin when its Bone is deleted', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const deleted = new CharacterBoneService().deleteBone(
      skinned.project,
      fixture.characterId,
      VECTOR_SKIN_BONE_B_ID,
    );
    const character = deleted.characters.find(({ id }) => id === fixture.characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
    expect(character.bones?.map(({ id }) => id)).toEqual([VECTOR_SKIN_BONE_A_ID]);
    expect(character.vectorSkins).toBeUndefined();
    expect(() => ProjectSchema.parse(JSON.parse(JSON.stringify(deleted)))).not.toThrow();
  });

  it('drops a skin when its Part is removed through the assembly path', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const characterService = new CharacterService();
    const definition = characterService.getAdaptivePartsDefinition(
      skinned.project,
      fixture.characterId,
    );
    const applied = characterService.applyAdaptivePartsDefinition(
      skinned.project,
      fixture.characterId,
      removeAdaptivePartFromDefinition(definition, fixture.sleevePartId),
    );
    const character = applied.characters.find(({ id }) => id === fixture.characterId)!;
    if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
    expect(character.parts.map(({ partId }) => partId)).toEqual([fixture.imagePartId]);
    expect(character.vectorSkins).toBeUndefined();
    expect(() => ProjectSchema.parse(JSON.parse(JSON.stringify(applied)))).not.toThrow();
  });

  it('remaps the skin Part across projects while keeping Character-local Bone ids', () => {
    const fixture = buildVectorSkinFixture();
    const skinned = withVectorSkin(fixture);
    const closure = collectProjectResourceClosure(skinned.project, [{
      kind: 'character' as const,
      id: fixture.characterId,
    }]);
    expect(closure.issues).toEqual([]);
    const plannedAssets = closure.assets.map((asset, index) => ({
      sourceAsset: asset,
      targetId: randomUUID(),
      reused: false,
      targetRelativePath: `assets/vector-skin-import-${index}.png`,
      sha256: asset.sha256,
    }));
    const candidate = buildImportedProjectCandidate({
      targetProject: buildProject(),
      sourceProject: skinned.project,
      closure,
      plannedAssets,
      createId: randomUUID,
      updatedAtIso: '2026-11-28T00:00:00.000Z',
    });
    const imported = candidate.importedCharacters[0]!;
    if (imported.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
    const importedPartIds = imported.parts.map(({ partId }) => partId);
    expect(imported.vectorSkins).toHaveLength(1);
    expect(importedPartIds).toContain(imported.vectorSkins![0]!.partId);
    expect(imported.vectorSkins![0]!.partId).not.toBe(fixture.sleevePartId);
    expect(imported.vectorSkins![0]!.boneIds).toEqual([
      VECTOR_SKIN_BONE_A_ID,
      VECTOR_SKIN_BONE_B_ID,
    ]);
    expect(() => ProjectSchema.parse(candidate.project)).not.toThrow();
  });
});

describe('vector skin Inspector authoring', () => {
  it('keeps drafts out of the Project and commits exactly one undo per confirm', async () => {
    const fixture = buildVectorSkinFixture();
    editorProjectStore.open('D:/vector-skin-ui', fixture.project);
    const element = document.createElement('div');
    document.body.append(element);
    const root = createRoot(element);
    const render = () => {
      const snapshot = editorProjectStore.getSnapshot()!;
      const shot = snapshot.project.shots.find(({ id }) => id === fixture.shotId)!;
      const layer = shot.layers.find(({ id }) => id === fixture.layerId)!;
      root.render(createElement(CharacterVectorSkinControl, { snapshot, shot, layer }));
    };
    try {
      await act(async () => render());
      const section = element.querySelector('[data-testid="character-vector-skin"]');
      expect(section).not.toBeNull();
      expect(element.querySelector('[data-testid="character-vector-skin-list"]')).toBeNull();
      const revisionBefore = editorProjectStore.getSnapshot()!.revision;
      const selects = section!.querySelectorAll('select');
      expect(selects).toHaveLength(3);
      // Changing a draft selector never dirties the Project.
      await act(async () => {
        selects[0]!.value = selects[0]!.options[0]!.value;
        selects[0]!.dispatchEvent(new Event('change', { bubbles: true }));
        selects[1]!.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(editorProjectStore.getSnapshot()!.revision).toBe(revisionBefore);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(0);

      const createButton = Array.from(section!.querySelectorAll('button'))
        .find((button) => button.textContent === '创建蒙皮');
      expect(createButton).toBeDefined();
      await act(async () => createButton!.click());
      const afterCreate = editorProjectStore.getSnapshot()!;
      expect(afterCreate.revision).toBe(revisionBefore + 1);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(1);
      const character = afterCreate.project.characters.find(({ id }) => id === fixture.characterId)!;
      if (character.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
      expect(character.vectorSkins).toHaveLength(1);

      await act(async () => render());
      const list = element.querySelector('[data-testid="character-vector-skin-list"]');
      expect(list).not.toBeNull();
      expect(list!.textContent).toContain('袖子');
      const deleteButton = Array.from(list!.querySelectorAll('button'))
        .find((button) => button.textContent === '删除蒙皮');
      expect(deleteButton).toBeDefined();
      await act(async () => deleteButton!.click());
      expect(editorProjectStore.getSnapshot()!.revision).toBe(revisionBefore + 2);
      expect(editorProjectStore.history.getSnapshot().undoCount).toBe(2);
      const afterDelete = editorProjectStore.getSnapshot()!.project.characters
        .find(({ id }) => id === fixture.characterId)!;
      if (afterDelete.mode !== 'adaptive-parts') throw new Error('Expected adaptive parts.');
      expect(afterDelete.vectorSkins).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      element.remove();
    }
  });
});
