import { describe, expect, it } from 'vitest';
import {
  CharacterService,
  ProjectSchema,
  type CompositeCharacterDefinition,
  type Project,
} from '../../src/domain';
import { CharacterStore } from '../../src/renderer/stores/characterStore';
import {
  CharacterAssemblySessionStore,
} from '../../src/renderer/stores/characterAssemblySessionStore';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:\\bfm-s02.pandastage';

function compositeProject(): Project {
  const project = buildProject();
  return ProjectSchema.parse({
    ...project,
    characters: [
      {
        ...project.characters[0]!,
        mode: 'composite',
        bodyAssetId: IDS.assetBg,
        facePlacement: { offsetX: 8, offsetY: -4, scale: 1 },
      },
    ],
    shots: project.shots.map((shot) => ({
      ...shot,
      timelineEvents: [
        {
          id: '60000000-0000-4000-8000-000000000001',
          layerId: IDS.layerChar,
          startMs: 0,
          endMs: 1000,
          type: 'expression' as const,
          expressionId: IDS.expressionAngry,
        },
      ],
    })),
  });
}

function definition(project: Project): CompositeCharacterDefinition {
  const character = project.characters[0]!;
  if (character.mode !== 'composite') {
    throw new Error('Expected a composite fixture.');
  }
  return {
    bodyAssetId: character.bodyAssetId,
    facePlacement: { ...character.facePlacement },
    expressionAssets: character.expressions.map((expression) => ({
      expressionId: expression.id,
      assetId: expression.assetId,
    })),
    mouthOpenAssetId: character.mouthOpenAssetId ?? null,
  };
}

function harness(project = compositeProject()) {
  const editor = new EditorProjectStore();
  editor.open(PROJECT_ROOT, project);
  const characters = new CharacterStore(
    editor,
    new CharacterService({ now: () => new Date('2026-08-01T00:00:00.000Z') }),
  );
  const assembly = new CharacterAssemblySessionStore({
    editorStore: editor,
    characterStore: characters,
  });
  return { editor, characters, assembly, project };
}

function changedDefinition(project: Project): CompositeCharacterDefinition {
  const current = definition(project);
  return {
    ...current,
    bodyAssetId: IDS.assetChar2,
    facePlacement: { offsetX: 24, offsetY: -12, scale: 1.25 },
    expressionAssets: [
      { expressionId: IDS.expressionNormal, assetId: IDS.assetChar2 },
      { expressionId: IDS.expressionAngry, assetId: IDS.assetChar },
    ],
    mouthOpenAssetId: IDS.assetChar,
  };
}

describe('BFM-S02 Character commands', () => {
  it('creates a legal composite Character without changing expression identity', () => {
    const project = ProjectSchema.parse({
      ...buildProject(),
      characters: [],
      voiceProfiles: [],
      shots: [],
    });
    const service = new CharacterService({
      createId: (() => {
        let index = 0;
        const ids = [
          '70000000-0000-4000-8000-000000000001',
          '70000000-0000-4000-8000-000000000002',
          '70000000-0000-4000-8000-000000000003',
          '70000000-0000-4000-8000-000000000004',
        ];
        return () => ids[index++]!;
      })(),
      now: () => new Date('2026-08-01T00:00:00.000Z'),
    });

    const created = service.createComposite(project, {
      name: 'Composite Panda',
      bodyAssetId: IDS.assetBg,
      facePlacement: { offsetX: 5, offsetY: -3, scale: 0.9 },
      expressions: [
        { name: 'Normal', assetId: IDS.assetChar },
        { name: 'Angry', assetId: IDS.assetChar2 },
      ],
    });
    const character = created.characters[0]!;

    expect(character).toMatchObject({
      mode: 'composite',
      bodyAssetId: IDS.assetBg,
      facePlacement: { offsetX: 5, offsetY: -3, scale: 0.9 },
      baseAssetId: IDS.assetChar,
    });
    expect(character.expressions.map(({ id }) => id)).toEqual([
      '70000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000002',
    ]);
  });

  it('routes composite creation through one existing EditorProjectStore history unit', () => {
    const project = ProjectSchema.parse({
      ...buildProject(),
      characters: [],
      voiceProfiles: [],
      shots: [],
    });
    const editor = new EditorProjectStore();
    editor.open(PROJECT_ROOT, project);
    const characters = new CharacterStore(editor, new CharacterService());

    const created = characters.createComposite({
      name: 'Composite Panda',
      bodyAssetId: IDS.assetBg,
      facePlacement: { offsetX: 0, offsetY: 0, scale: 1 },
      expressions: [{ name: 'Normal', assetId: IDS.assetChar }],
    });

    expect(created.characters[0]?.mode).toBe('composite');
    expect(editor.getSnapshot()).toMatchObject({ revision: 1, dirty: true });
    expect(editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
  });

  it('applies one complete definition as one History unit and preserves authored identities', () => {
    const input = harness();
    const before = input.editor.getSnapshot()!;
    const beforeProject = before.project;
    const next = changedDefinition(beforeProject);

    input.characters.applyCompositeDefinition(IDS.character, next);

    const after = input.editor.getSnapshot()!;
    const character = after.project.characters[0]!;
    expect(after.revision).toBe(before.revision + 1);
    expect(after.dirty).toBe(true);
    expect(input.editor.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    expect(character).toMatchObject({
      id: IDS.character,
      mode: 'composite',
      bodyAssetId: IDS.assetChar2,
      facePlacement: next.facePlacement,
      baseAssetId: IDS.assetChar2,
      mouthOpenAssetId: IDS.assetChar,
    });
    expect(character.expressions.map(({ id }) => id)).toEqual([
      IDS.expressionNormal,
      IDS.expressionAngry,
    ]);
    expect(after.project.voiceProfiles).toEqual(beforeProject.voiceProfiles);
    expect(after.project.shots).toEqual(beforeProject.shots);

    expect(input.editor.undo()).toBe(true);
    expect(input.editor.getSnapshot()!.project).toEqual(beforeProject);
    expect(input.editor.redo()).toBe(true);
    expect(input.editor.getSnapshot()!.project.characters[0]).toEqual(
      character,
    );
    input.assembly.dispose();
  });

  it('keeps exact Apply, Body, Face, Expression, and Mouth no-ops at zero writes', () => {
    const input = harness();
    const before = input.editor.getSnapshot()!;
    const history = input.editor.history.getSnapshot();
    const current = input.characters.getCompositeDefinition(IDS.character);

    expect(
      input.characters.applyCompositeDefinition(IDS.character, current),
    ).toBe(before.project);
    expect(input.characters.replaceBodyAsset(IDS.character, IDS.assetBg)).toBe(
      before.project,
    );
    expect(
      input.characters.setFacePlacement(
        IDS.character,
        current.facePlacement,
      ),
    ).toBe(before.project);
    expect(
      input.characters.setCompositeExpressionAssets(
        IDS.character,
        current.expressionAssets,
      ),
    ).toBe(before.project);
    expect(
      input.characters.setCompositeMouthOpenAsset(
        IDS.character,
        current.mouthOpenAssetId,
      ),
    ).toBe(before.project);

    expect(input.editor.getSnapshot()).toBe(before);
    expect(input.editor.history.getSnapshot()).toEqual(history);
    input.assembly.dispose();
  });

  it('rejects an invalid composite definition before changing the Project', () => {
    const input = harness();
    const before = input.editor.getSnapshot()!;
    const invalid = changedDefinition(before.project);
    invalid.facePlacement.scale = 0;

    expect(() =>
      input.characters.applyCompositeDefinition(IDS.character, invalid),
    ).toThrow(expect.objectContaining({ code: 'INVALID_FACE_PLACEMENT' }));
    expect(input.editor.getSnapshot()).toBe(before);
    expect(input.editor.history.getSnapshot().undoCount).toBe(0);
    input.assembly.dispose();
  });

  it('keeps draft and preview changes out of Project and commits once on Apply', () => {
    const input = harness();
    const before = input.editor.getSnapshot()!;
    const begin = input.assembly.begin(IDS.character);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;

    const update = begin.session.updateDraft({
      bodyAssetId: IDS.assetChar2,
      facePlacement: { offsetX: 18, offsetY: 7, scale: 1.1 },
      mouthOpenAssetId: IDS.assetChar,
    });
    expect(update.ok).toBe(true);
    expect(input.editor.getSnapshot()).toBe(before);
    expect(input.editor.history.getSnapshot().undoCount).toBe(0);

    const committed = begin.session.commit();
    expect(committed.status).toBe('committed');
    expect(input.editor.getSnapshot()!.revision).toBe(1);
    expect(input.editor.history.getSnapshot().undoCount).toBe(1);
    input.assembly.dispose();
  });

  it('treats unchanged Apply and Cancel as zero-write operations', () => {
    const input = harness();
    const before = input.editor.getSnapshot()!;
    const begin = input.assembly.begin(IDS.character);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;

    const current = input.characters.getCompositeDefinition(IDS.character);
    expect(
      begin.session.setDraft({
        ...current,
        facePlacement: {
          scale: current.facePlacement.scale,
          offsetY: current.facePlacement.offsetY,
          offsetX: current.facePlacement.offsetX,
        },
        expressionAssets: [...current.expressionAssets].reverse(),
      }).ok,
    ).toBe(true);
    expect(begin.session.commit().status).toBe('no-op');
    expect(input.editor.getSnapshot()).toBe(before);
    expect(input.editor.history.getSnapshot().undoCount).toBe(0);

    begin.session.cancel();
    expect(input.assembly.getSnapshot()).toBeNull();
    expect(input.editor.getSnapshot()).toBe(before);
    input.assembly.dispose();
  });

  it('invalidates stale callbacks for reopen, replacement, deletion, Undo/Redo, and Draft A to B', () => {
    const reopened = harness();
    const reopenBegin = reopened.assembly.begin(IDS.character);
    expect(reopenBegin.ok).toBe(true);
    if (reopenBegin.ok) {
      const before = reopened.editor.getSnapshot()!;
      reopened.editor.open(PROJECT_ROOT, structuredClone(before.project));
      expect(reopenBegin.session.commit(changedDefinition(before.project)).status).toBe(
        'stale',
      );
      expect(reopened.editor.getSnapshot()!.revision).toBe(0);
      expect(reopened.editor.history.getSnapshot().undoCount).toBe(0);
    }
    reopened.assembly.dispose();

    const replaced = harness();
    const replaceBegin = replaced.assembly.begin(IDS.character);
    expect(replaceBegin.ok).toBe(true);
    if (replaceBegin.ok) {
      const before = replaced.editor.getSnapshot()!;
      replaced.editor.open('D:\\bfm-s02-other.pandastage', {
        ...before.project,
        id: '00000000-0000-4000-8000-000000000099',
      });
      expect(replaceBegin.session.commit(changedDefinition(before.project)).status).toBe(
        'stale',
      );
      expect(replaced.editor.getSnapshot()!.dirty).toBe(false);
      expect(replaced.editor.history.getSnapshot().undoCount).toBe(0);
    }
    replaced.assembly.dispose();

    const deleted = harness();
    const deleteBegin = deleted.assembly.begin(IDS.character);
    expect(deleteBegin.ok).toBe(true);
    if (deleteBegin.ok) {
      const before = deleted.editor.getSnapshot()!;
      const project = before.project;
      const withoutCharacter = ProjectSchema.parse({
        ...project,
        characters: [],
        voiceProfiles: [],
        shots: project.shots.map((shot) => ({
          ...shot,
          layers: shot.layers.filter(
            (layer) =>
              layer.source.kind !== 'character' ||
              layer.source.characterId !== IDS.character,
          ),
          timelineEvents: shot.timelineEvents.filter(
            (event) => event.layerId !== IDS.layerChar,
          ),
        })),
      });
      deleted.editor.updateProject(withoutCharacter, 'Delete character');
      const afterDelete = deleted.editor.getSnapshot()!;
      expect(deleteBegin.session.commit(changedDefinition(project)).status).toBe(
        'stale',
      );
      expect(deleted.editor.getSnapshot()).toBe(afterDelete);
    }
    deleted.assembly.dispose();

    const undo = harness();
    const undoBegin = undo.assembly.begin(IDS.character);
    expect(undoBegin.ok).toBe(true);
    if (undoBegin.ok) {
      undo.editor.updateProject(
        ProjectSchema.parse({
          ...undo.project,
          name: 'External edit',
        }),
        'External edit',
      );
      expect(undo.editor.undo()).toBe(true);
      const afterUndo = undo.editor.getSnapshot()!;
      expect(undoBegin.session.commit(changedDefinition(undo.project)).status).toBe(
        'stale',
      );
      expect(undo.editor.getSnapshot()).toBe(afterUndo);
      expect(undo.editor.history.getSnapshot().redoCount).toBe(1);
    }
    undo.assembly.dispose();

    const replacedDraft = harness();
    const first = replacedDraft.assembly.begin(IDS.character);
    expect(first.ok).toBe(true);
    if (first.ok) {
      const second = replacedDraft.assembly.begin(IDS.character);
      expect(second.ok).toBe(true);
      if (second.ok) {
        expect(first.session.commit(changedDefinition(replacedDraft.project)).status).toBe(
          'stale',
        );
        expect(second.session.updateDraft({ bodyAssetId: IDS.assetChar2 }).ok).toBe(
          true,
        );
        expect(second.session.commit().status).toBe('committed');
      }
    }
    replacedDraft.assembly.dispose();
  });

  it('rejects a same-path reopen race before the command can create History', () => {
    const project = compositeProject();
    const editor = new EditorProjectStore();
    editor.open(PROJECT_ROOT, project);
    const service = new CharacterService({
      now: () => {
        editor.open(PROJECT_ROOT, structuredClone(project));
        return new Date('2026-08-01T00:00:00.000Z');
      },
    });
    const characters = new CharacterStore(editor, service);
    const assembly = new CharacterAssemblySessionStore({
      editorStore: editor,
      characterStore: characters,
    });
    const begin = assembly.begin(IDS.character);
    expect(begin.ok).toBe(true);
    if (begin.ok) {
      const result = begin.session.commit(changedDefinition(project));
      expect(result.status).toBe('stale');
      expect(editor.getSnapshot()!.revision).toBe(0);
      expect(editor.getSnapshot()!.dirty).toBe(false);
      expect(editor.history.getSnapshot()).toMatchObject({
        undoCount: 0,
        redoCount: 0,
      });
      expect(editor.getSnapshot()!.project).toEqual(project);
    }
    assembly.dispose();
  });
});
