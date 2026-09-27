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
import {
  isCharacterCreationSnapshot,
  resolveAssemblyExitDecision,
} from '../../src/renderer/features/characters/characterAssemblyPreview';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:\\s09-r04.pandastage';

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

/** begin + declare the UI continuity intent, as CharacterManager does. */
function beginOwned(
  assembly: CharacterAssemblySessionStore,
  characterId = IDS.character,
) {
  const result = assembly.begin(characterId);
  if (result.ok) assembly.setAssemblyContinuityOwner(characterId);
  return result;
}

function applyAssemblyChange(harnessValue: ReturnType<typeof harness>) {
  const { assembly, project } = harnessValue;
  const begin = beginOwned(assembly);
  expect(begin.ok).toBe(true);
  if (!begin.ok) throw new Error('Expected assembly session to begin.');
  expect(begin.session.updateDraft(changedDefinition(project)).ok).toBe(true);
  expect(begin.session.commit().status).toBe('committed');
}

describe('S09-R04 assembly exit decision', () => {
  it('leaves immediately when nothing is pending', () => {
    expect(resolveAssemblyExitDecision(false, false)).toBe('leave');
    expect(resolveAssemblyExitDecision(false, true)).toBe('leave');
  });

  it('leaves only on explicit discard confirmation when pending', () => {
    expect(resolveAssemblyExitDecision(true, true)).toBe('leave');
    expect(resolveAssemblyExitDecision(true, false)).toBe('stay');
  });

  it('discards an unapplied draft without a Project or History write', () => {
    const h = harness();
    const begin = beginOwned(h.assembly);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.session.updateDraft(changedDefinition(h.project)).ok).toBe(
      true,
    );
    const before = h.editor.getSnapshot()!;
    const beforeHistory = h.editor.history.getSnapshot();

    begin.session.cancel();

    expect(h.editor.getSnapshot()).toBe(before);
    expect(h.editor.getSnapshot()!.revision).toBe(before.revision);
    expect(h.editor.getSnapshot()!.dirty).toBe(before.dirty);
    expect(h.editor.history.getSnapshot()).toEqual(beforeHistory);
    expect(h.assembly.getSnapshot()).toBeNull();
    h.assembly.dispose();
  });
});

describe('S09-R04 assembly workspace continuity', () => {
  it('rebuilds a fresh session after Undo and keeps the old handle stale', () => {
    const h = harness();
    applyAssemblyChange(h);

    const applied = h.assembly.getActiveAssemblySessionHandle();
    expect(applied).not.toBeNull();
    expect(h.editor.undo()).toBe(true);
    const afterUndo = h.editor.getSnapshot()!;
    const historyAfterUndo = h.editor.history.getSnapshot();

    // The rebuild itself is read-only.
    expect(h.editor.getSnapshot()).toBe(afterUndo);
    expect(h.editor.history.getSnapshot()).toEqual(historyAfterUndo);

    const resumed = h.assembly.getSnapshot();
    expect(resumed).not.toBeNull();
    if (!resumed || isCharacterCreationSnapshot(resumed)) return;
    expect(resumed.characterId).toBe(IDS.character);
    expect(resumed.sessionId).not.toBe(applied!.sessionId);
    // The fresh session reads the Undo result as its baseline/draft.
    expect(resumed.draft).toEqual(definition(afterUndo.project));
    expect(applied!.commit(changedDefinition(h.project)).status).toBe('stale');
    expect(applied!.updateDraft({ bodyAssetId: IDS.assetChar }).ok).toBe(false);
    h.assembly.dispose();
  });

  it('rebuilds a fresh session after Redo and keeps the old handle stale', () => {
    const h = harness();
    applyAssemblyChange(h);
    expect(h.editor.undo()).toBe(true);

    const afterUndoSession = h.assembly.getActiveAssemblySessionHandle();
    expect(afterUndoSession).not.toBeNull();
    expect(h.editor.redo()).toBe(true);
    const afterRedo = h.editor.getSnapshot()!;
    const historyAfterRedo = h.editor.history.getSnapshot();

    expect(h.editor.getSnapshot()).toBe(afterRedo);
    expect(h.editor.history.getSnapshot()).toEqual(historyAfterRedo);

    const resumed = h.assembly.getSnapshot();
    expect(resumed).not.toBeNull();
    if (!resumed) return;
    expect(resumed.sessionId).not.toBe(afterUndoSession!.sessionId);
    expect(resumed.draft).toEqual(definition(afterRedo.project));
    expect(afterUndoSession!.commit(changedDefinition(h.project)).status).toBe(
      'stale',
    );
    h.assembly.dispose();
  });

  it('does not rebuild when the UI never declared assembly continuity', () => {
    const h = harness();
    // begin() without the UI continuity declaration, as a non-assembly surface.
    const begin = h.assembly.begin(IDS.character);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.session.updateDraft(changedDefinition(h.project)).ok).toBe(
      true,
    );
    expect(begin.session.commit().status).toBe('committed');
    expect(h.editor.undo()).toBe(true);
    expect(h.assembly.getSnapshot()).toBeNull();
    h.assembly.dispose();
  });

  it('does not trade a pending draft for workspace continuity', () => {
    const h = harness();
    const begin = beginOwned(h.assembly);
    expect(begin.ok).toBe(true);
    if (!begin.ok) return;
    expect(begin.session.updateDraft(changedDefinition(h.project)).ok).toBe(
      true,
    );
    h.editor.updateProject(
      ProjectSchema.parse({ ...h.project, name: 'External edit' }),
      'External edit',
    );
    expect(h.assembly.getSnapshot()).toBeNull();
    h.assembly.dispose();
  });

  it('does not rebuild after an explicit exit', () => {
    const h = harness();
    applyAssemblyChange(h);
    const applied = h.assembly.getActiveAssemblySessionHandle();
    applied?.exit();
    expect(h.assembly.getSnapshot()).toBeNull();
    expect(h.editor.undo()).toBe(true);
    expect(h.assembly.getSnapshot()).toBeNull();
    h.assembly.dispose();
  });

  it('does not rebuild after the UI switches to another Character', () => {
    const h = harness();
    applyAssemblyChange(h);
    h.assembly.setAssemblyContinuityOwner('some-other-character');
    expect(h.editor.undo()).toBe(true);
    expect(h.assembly.getSnapshot()).toBeNull();
    h.assembly.dispose();
  });

  it('does not rebuild after the Character is deleted', () => {
    const h = harness();
    applyAssemblyChange(h);
    const current = h.editor.getSnapshot()!;
    h.editor.updateProject(
      ProjectSchema.parse({
        ...current.project,
        characters: [],
        voiceProfiles: [],
        shots: current.project.shots.map((shot) => ({
          ...shot,
          layers: shot.layers.filter(
            (layer) =>
              layer.source.kind !== 'character' ||
              layer.source.characterId !== IDS.character,
          ),
          timelineEvents: [],
        })),
      }),
      'Delete character',
    );
    expect(h.assembly.getSnapshot()).toBeNull();
    h.assembly.dispose();
  });

  it('does not rebuild after the same path is reopened as a new lifetime', () => {
    const h = harness();
    applyAssemblyChange(h);
    const instanceBefore = h.editor.getProjectInstanceId();
    h.editor.open(PROJECT_ROOT, compositeProject());
    expect(h.editor.getProjectInstanceId()).not.toBe(instanceBefore);
    expect(h.assembly.getSnapshot()).toBeNull();
    h.assembly.dispose();
  });
});
