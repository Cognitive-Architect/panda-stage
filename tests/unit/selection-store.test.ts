import { describe, expect, it } from 'vitest';
import { ProjectSchema, migrateProject, ShotService } from '../../src/domain';
import { EditorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { LayerSelectionStore } from '../../src/renderer/stores/selectionStore';
import { ShotStore } from '../../src/renderer/stores/shotStore';
import exampleProject from '../../demo-project/project-v1.example.json';

describe('LayerSelectionStore project boundary', () => {
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
