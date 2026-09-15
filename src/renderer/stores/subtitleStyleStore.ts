import {
  SubtitleStyleService,
  type Project,
  type SubtitleStylePatch,
} from '../../domain';
import {
  editorProjectStore,
  type EditorProjectStore,
} from './EditorProjectStore';

/** Renderer adapter for the project-owned shared SubtitleStyle service. */
export class SubtitleStyleStore {
  constructor(
    private readonly editorStore: EditorProjectStore,
    private readonly service: SubtitleStyleService,
  ) {}

  update(styleId: string, patch: SubtitleStylePatch): Project {
    const snapshot = this.editorStore.getSnapshot();
    if (!snapshot) throw new Error('请先打开项目。');

    const next = this.service.update(snapshot.project, styleId, patch);
    if (next !== snapshot.project) {
      this.editorStore.updateProject(next, 'Edit subtitle style');
    }
    return next;
  }
}

export const subtitleStyleStore = new SubtitleStyleStore(
  editorProjectStore,
  new SubtitleStyleService(),
);
