import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  ProjectSchema,
  type Project,
} from '../../src/domain';
import { ProjectService } from '../../src/main/services/ProjectService';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import {
  CharacterStore,
  CharacterStoreStaleError,
} from '../../src/renderer/stores/characterStore';
import {
  adaptivePartsFixture,
  adaptivePartsSourceRootTransform,
} from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from '../unit/domain/testProject';

const temporaryParents: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryParents.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

async function savedBaseProject(): Promise<{
  projectRoot: string;
  projectService: ProjectService;
  project: Project;
}> {
  const parent = await mkdtemp(
    path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'panda-adaptive-parts-'),
  );
  temporaryParents.push(parent);
  const projectRoot = path.join(parent, 'Static Parts Lifecycle.pandastage');
  const projectService = new ProjectService();
  const created = await projectService.create(projectRoot, {
    name: 'Static Parts Lifecycle',
  });
  const project = ProjectSchema.parse({
    ...buildProject(),
    id: created.project.id,
    name: created.project.name,
    createdAt: created.project.createdAt,
    updatedAt: created.project.updatedAt,
  });
  await projectService.save(projectRoot, project, 1);
  return { projectRoot, projectService, project };
}

describe('Adaptive Parts Character lifecycle', () => {
  it('applies one atomic history step, replays it, and saves/reopens all six Parts', async () => {
    const { projectRoot, projectService, project } = await savedBaseProject();
    const editor = new EditorProjectStore();
    editor.open(projectRoot, project);
    const characters = new CharacterStore(editor, new CharacterService());
    const initialSnapshot = editor.getSnapshot()!;

    characters.createAdaptiveParts(
      {
        name: 'Synthetic Static Parts',
        sourceRootTransform: adaptivePartsSourceRootTransform(),
        parts: adaptivePartsFixture(IDS.assetChar),
      },
      initialSnapshot,
    );
    const createdSnapshot = editor.getSnapshot()!;
    const character = createdSnapshot.project.characters.find(
      (candidate) => candidate.name === 'Synthetic Static Parts',
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts test Character.');
    }
    expect(character.parts.map((part) => part.assetId)).toEqual(
      Array.from({ length: 6 }, () => IDS.assetChar),
    );
    expect(new Set(character.parts.map((part) => part.partId)).size).toBe(6);
    expect(character.sourceRootTransform).toEqual(
      adaptivePartsSourceRootTransform(),
    );
    expect(createdSnapshot).toMatchObject({ dirty: true, revision: 1 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });

    const draft = characters.getAdaptivePartsDefinition(character.id);
    expect(editor.getSnapshot()).toBe(createdSnapshot);
    expect(editor.history.getSnapshot().undoCount).toBe(1);
    draft.parts[0]!.displayName = 'Canceled draft';
    expect(editor.getSnapshot()).toBe(createdSnapshot);

    const noOp = characters.getAdaptivePartsDefinition(character.id);
    expect(characters.applyAdaptivePartsDefinition(character.id, noOp)).toBe(
      createdSnapshot.project,
    );
    expect(editor.getSnapshot()).toBe(createdSnapshot);
    expect(editor.history.getSnapshot().undoCount).toBe(1);

    characters.updateAdaptivePart(character.id, character.parts[0]!.partId, {
      visible: false,
    });
    const updatedSnapshot = editor.getSnapshot()!;
    expect(updatedSnapshot).toMatchObject({ dirty: true, revision: 2 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 0 });

    const appliedDefinition = characters.getAdaptivePartsDefinition(character.id);
    appliedDefinition.parts[0]!.displayName = 'Applied com6';
    characters.applyAdaptivePartsDefinition(character.id, appliedDefinition);
    const appliedSnapshot = editor.getSnapshot()!;
    expect(appliedSnapshot).toMatchObject({ dirty: true, revision: 3 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });

    const invalidDefinition = characters.getAdaptivePartsDefinition(character.id);
    invalidDefinition.parts[1]!.partId = invalidDefinition.parts[0]!.partId;
    expect(() =>
      characters.applyAdaptivePartsDefinition(character.id, invalidDefinition),
    ).toThrow();
    expect(editor.getSnapshot()).toBe(appliedSnapshot);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });

    const invalidAsset = characters.getAdaptivePartsDefinition(character.id);
    invalidAsset.parts[0]!.assetId = IDS.assetBg;
    expect(() =>
      characters.applyAdaptivePartsDefinition(character.id, invalidAsset),
    ).toThrow();
    expect(editor.getSnapshot()).toBe(appliedSnapshot);
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, revision: 3 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });

    const missingAsset = characters.getAdaptivePartsDefinition(character.id);
    missingAsset.parts[0]!.assetId = '71000000-0000-4000-8000-000000000099';
    expect(() =>
      characters.applyAdaptivePartsDefinition(character.id, missingAsset),
    ).toThrow();
    expect(editor.getSnapshot()).toBe(appliedSnapshot);
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, revision: 3 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });

    const invalidMatrix = characters.getAdaptivePartsDefinition(character.id);
    invalidMatrix.parts[0]!.restTransform = {
      a: 0,
      b: 0,
      c: 0,
      d: 0,
      tx: 0,
      ty: 0,
    };
    expect(() =>
      characters.applyAdaptivePartsDefinition(character.id, invalidMatrix),
    ).toThrow();
    expect(editor.getSnapshot()).toBe(appliedSnapshot);
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, revision: 3 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 3, redoCount: 0 });

    expect(editor.undo()).toBe(true);
    const undone = editor.getSnapshot()!;
    const undoneCharacter = undone.project.characters.find(
      (candidate) => candidate.id === character.id,
    );
    expect(undoneCharacter?.mode).toBe('adaptive-parts');
    if (undoneCharacter?.mode === 'adaptive-parts') {
      expect(undoneCharacter.parts[0]!.displayName).toBe('com6');
      expect(undoneCharacter.parts[0]!.visible).toBe(false);
    }
    expect(editor.redo()).toBe(true);
    const redone = editor.getSnapshot()!;
    const redoneCharacter = redone.project.characters.find(
      (candidate) => candidate.id === character.id,
    );
    expect(redoneCharacter?.mode).toBe('adaptive-parts');
    if (redoneCharacter?.mode === 'adaptive-parts') {
      expect(redoneCharacter.parts).toHaveLength(6);
      expect(redoneCharacter.parts[0]!.displayName).toBe('Applied com6');
      expect(redoneCharacter.parts[0]!.visible).toBe(false);
      expect(redoneCharacter.parts[0]!.partId).toBe(character.parts[0]!.partId);
      expect(redoneCharacter.parts[5]!.displayName).toBe('Body + arm composite');
      expect(redoneCharacter.sourceRootTransform).toEqual(
        adaptivePartsSourceRootTransform(),
      );
    }

    await projectService.save(projectRoot, redone.project, redone.revision);
    const serialized = JSON.parse(
      await readFile(path.join(projectRoot, 'project.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(serialized).not.toHaveProperty('history');
    expect(serialized).not.toHaveProperty('undoStack');
    editor.clear();

    const reopened = await projectService.open(projectRoot);
    const reopenedCharacter = reopened.project.characters.find(
      (candidate) => candidate.id === character.id,
    );
    expect(reopenedCharacter?.mode).toBe('adaptive-parts');
    if (reopenedCharacter?.mode === 'adaptive-parts') {
      expect(reopenedCharacter.parts).toEqual(redoneCharacter?.mode === 'adaptive-parts'
        ? redoneCharacter.parts
        : []);
      expect(reopenedCharacter.sourceRootTransform).toEqual(
        adaptivePartsSourceRootTransform(),
      );
    }
  });

  it('rejects a draft snapshot after switching projects without writing history', () => {
    const project = buildProject();
    const editor = new EditorProjectStore();
    editor.open('D:\\adaptive-parts-a.pandastage', project);
    const characters = new CharacterStore(editor, new CharacterService());
    const initialSnapshot = editor.getSnapshot()!;
    characters.createAdaptiveParts({
      name: 'Synthetic Static Parts',
      sourceRootTransform: adaptivePartsSourceRootTransform(),
      parts: adaptivePartsFixture(IDS.assetChar),
    }, initialSnapshot);
    const staleSnapshot = editor.getSnapshot()!;
    const character = staleSnapshot.project.characters.find(
      (candidate) => candidate.name === 'Synthetic Static Parts',
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts test Character.');
    }
    const draft = characters.getAdaptivePartsDefinition(character.id);
    draft.parts[0]!.visible = false;

    const nextProject = ProjectSchema.parse({
      ...project,
      id: '00000000-0000-4000-8000-000000000099',
      name: 'Second project',
    });
    editor.open('D:\\adaptive-parts-b.pandastage', nextProject);
    const currentSnapshot = editor.getSnapshot()!;
    expect(() =>
      characters.applyAdaptivePartsDefinition(
        character.id,
        draft,
      ),
    ).toThrow(CharacterStoreStaleError);
    expect(editor.getSnapshot()).toBe(currentSnapshot);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
    expect(currentSnapshot).toMatchObject({ dirty: false, revision: 0 });
  });

  it('rejects a definition read before a same-project edit while immediate updates use current state', () => {
    const project = buildProject();
    const editor = new EditorProjectStore();
    editor.open('D:\\adaptive-parts-edit.pandastage', project);
    const characters = new CharacterStore(editor, new CharacterService());
    characters.createAdaptiveParts(
      {
        name: 'Synthetic Static Parts',
        sourceRootTransform: adaptivePartsSourceRootTransform(),
        parts: adaptivePartsFixture(IDS.assetChar),
      },
      editor.getSnapshot()!,
    );
    const createdSnapshot = editor.getSnapshot()!;
    const character = createdSnapshot.project.characters.find(
      (candidate) => candidate.name === 'Synthetic Static Parts',
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts test Character.');
    }

    const staleDraft = characters.getAdaptivePartsDefinition(character.id);
    staleDraft.parts[0]!.visible = false;
    const copiedDraft = structuredClone(staleDraft);
    expect(() =>
      characters.applyAdaptivePartsDefinition(character.id, copiedDraft),
    ).toThrow(CharacterStoreStaleError);
    expect(editor.getSnapshot()).toBe(createdSnapshot);
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });

    characters.updateAdaptivePart(character.id, character.parts[0]!.partId, {
      visible: false,
    });
    const currentSnapshot = editor.getSnapshot()!;
    expect(currentSnapshot).toMatchObject({ dirty: true, revision: 2 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 0 });

    expect(() =>
      characters.applyAdaptivePartsDefinition(character.id, staleDraft),
    ).toThrow(CharacterStoreStaleError);
    expect(editor.getSnapshot()).toBe(currentSnapshot);
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, revision: 2 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 2, redoCount: 0 });
  });

  it.each([
    ['the same root', 'D:\\adaptive-parts-reopen.pandastage'],
    ['a different root with the same project ID', 'D:\\adaptive-parts-reopen-copy.pandastage'],
  ])('rejects a definition read before close/reopen at %s', (_label, reopenedRoot) => {
    const project = buildProject();
    const originalRoot = 'D:\\adaptive-parts-reopen.pandastage';
    const editor = new EditorProjectStore();
    editor.open(originalRoot, project);
    const characters = new CharacterStore(editor, new CharacterService());
    characters.createAdaptiveParts(
      {
        name: 'Synthetic Static Parts',
        sourceRootTransform: adaptivePartsSourceRootTransform(),
        parts: adaptivePartsFixture(IDS.assetChar),
      },
      editor.getSnapshot()!,
    );
    const createdSnapshot = editor.getSnapshot()!;
    const character = createdSnapshot.project.characters.find(
      (candidate) => candidate.name === 'Synthetic Static Parts',
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts test Character.');
    }
    const draft = characters.getAdaptivePartsDefinition(character.id);
    draft.parts[0]!.visible = false;

    editor.clear();
    editor.open(reopenedRoot, createdSnapshot.project);
    const currentSnapshot = editor.getSnapshot()!;
    expect(currentSnapshot.project.id).toBe(createdSnapshot.project.id);
    expect(() =>
      characters.applyAdaptivePartsDefinition(character.id, draft),
    ).toThrow(CharacterStoreStaleError);
    expect(editor.getSnapshot()).toBe(currentSnapshot);
    expect(editor.getSnapshot()).toMatchObject({ dirty: false, revision: 0 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });
  });

  it('keeps edits to discarded definition drafts out of project, dirty state, revision, and history', () => {
    const project = buildProject();
    const editor = new EditorProjectStore();
    editor.open('D:\\adaptive-parts-discard.pandastage', project);
    const characters = new CharacterStore(editor, new CharacterService());
    characters.createAdaptiveParts(
      {
        name: 'Synthetic Static Parts',
        sourceRootTransform: adaptivePartsSourceRootTransform(),
        parts: adaptivePartsFixture(IDS.assetChar),
      },
      editor.getSnapshot()!,
    );
    const character = editor.getSnapshot()!.project.characters.find(
      (candidate) => candidate.name === 'Synthetic Static Parts',
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Expected the Adaptive Parts test Character.');
    }
    const before = editor.getSnapshot()!;
    const cancelDraft = characters.getAdaptivePartsDefinition(character.id);
    cancelDraft.parts[0]!.displayName = 'Canceled change';
    const escapeDraft = characters.getAdaptivePartsDefinition(character.id);
    escapeDraft.parts[1]!.visible = false;

    expect(editor.getSnapshot()).toBe(before);
    expect(editor.getSnapshot()).toMatchObject({ dirty: true, revision: 1 });
    expect(editor.history.getSnapshot()).toMatchObject({ undoCount: 1, redoCount: 0 });
  });
});
