import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject, ShotService } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('LayerSelectionStore project boundary', () => {
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
