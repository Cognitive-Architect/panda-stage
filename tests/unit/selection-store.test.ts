import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject, ShotService } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import exampleProject from '../../demo-project/project-v1.example.json';
import { characterPartAnimationFixture } from '../helpers/characterPartAnimationFixture';
import { buildProject, IDS } from './domain/testProject';

describe('LayerSelectionStore project boundary', () => {
  it('selects a single-image root and keeps the adaptive Part API as an alias for the Node', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const selection = new LayerSelectionStore(editor, shots);
    try {
      editor.open('D:/root-selection.pandastage', buildProject());
      selection.select(IDS.layerChar);
      expect(selection.getSelectedCharacterNodeId()).toBe('root');
      expect(selection.getSelectedCharacterPartId()).toBeNull();
      expect(() => selection.selectCharacterNode('face')).toThrow();

      const fixture = characterPartAnimationFixture();
      editor.open('D:/part-selection.pandastage', fixture.project);
      expect(selection.getSelectedCharacterNodeId()).toBeNull();
      selection.select(fixture.layerId);
      const before = editor.getSnapshot();
      selection.selectCharacterPart(fixture.imagePartId);
      expect(selection.getSelectedCharacterNodeId()).toBe(`part:${fixture.imagePartId}`);
      selection.selectCharacterNode(`part:${fixture.graphicPartId}`);
      expect(selection.getSelectedCharacterPartId()).toBe(fixture.graphicPartId);
      expect(editor.getSnapshot()).toBe(before);
      expect(editor.history.getSnapshot().undoCount).toBe(0);
      selection.select(IDS.layerAsset);
      expect(selection.getSelectedCharacterNodeId()).toBeNull();
      expect(selection.getSelectedCharacterPartId()).toBeNull();
    } finally {
      selection.dispose();
      shots.dispose();
    }
  });

  it('shares structured selection without revising the project and clears it with layer/context changes', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const selection = new LayerSelectionStore(editor, shots);
    const project = migrateProject(exampleProject);
    editor.open('D:/structured-selection.pandastage', project);
    const layerId = project.shots[0]!.layers[1]!.id;
    selection.select(layerId);
    const before = editor.getSnapshot();
    const scope = { targetKey: 'target', editMode: 'instance' as const, frameOrdinal: 0, path: [] };
    selection.setStructuredEditScope(scope);
    selection.setSelectedStructuredNodePath(['group', 'head']);
    expect(selection.getStructuredEditScope()).toBe(scope);
    expect(selection.getSelectedStructuredNodePath()).toEqual(['group', 'head']);
    expect(editor.getSnapshot()).toBe(before);
    selection.select(layerId);
    expect(selection.getStructuredEditScope()).toBe(scope);
    selection.clear();
    expect(selection.getStructuredEditScope()).toBeNull();
    expect(selection.getSelectedStructuredNodePath()).toBeNull();
    selection.select(layerId);
    selection.setStructuredEditScope(scope);
    editor.open('D:/structured-selection.pandastage', project);
    expect(selection.getSelectedLayerId()).toBe(layerId);
    expect(selection.getStructuredEditScope()).toBeNull();
    selection.setStructuredEditScope(scope);
    editor.open('D:/other-structured-selection.pandastage', project);
    expect(selection.getStructuredEditScope()).toBeNull();
    selection.dispose(); shots.dispose();
  });
  it('preserves selection for the same project but clears it for a different root', () => {
    const editor = new EditorProjectStore();
    const shots = new ShotStore(editor, new ShotService());
    const selection = new LayerSelectionStore(editor, shots);
    const project = migrateProject(exampleProject);
    const layerId = project.shots[0]!.layers[1]!.id;

    editor.open('D:\\selection-a.pandastage', project);
    selection.select(layerId);
    expect(selection.getSelectedLayerId()).toBe(layerId);

    editor.updateProject({ ...project, name: 'Selection A edited' });
    expect(selection.getSelectedLayerId()).toBe(layerId);

    const reusedIds = ProjectSchema.parse({
      ...structuredClone(project),
      name: 'Selection B',
    });
    editor.open('D:\\selection-b.pandastage', reusedIds);
    expect(selection.getSelectedLayerId()).toBeNull();

    selection.dispose();
    shots.dispose();
  });
});
