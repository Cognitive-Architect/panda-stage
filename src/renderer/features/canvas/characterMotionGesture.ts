import { CharacterMotionService, characterMotionValues, type CharacterMotionInput, type CharacterMotionValues } from '../../../domain';
import type { EditorProjectStore, EditorProjectSnapshot } from '../../stores/EditorProjectStore';

/** #979 gesture boundary: retain before, preview locally, commit one ProjectCommand. */
export class CharacterMotionGesture {
  private readonly before: EditorProjectSnapshot;
  private readonly instanceId;
  private finished = false;
  readonly values: CharacterMotionValues;
  constructor(private readonly editor: EditorProjectStore, private readonly input: CharacterMotionInput, private readonly isCurrent: () => boolean) {
    const before = editor.getSnapshot();
    if (!before) throw new Error('请先打开项目。');
    this.before = before;
    this.instanceId = editor.getProjectInstanceId();
    this.values = characterMotionValues(this.before.project, input);
  }
  commit(changes: Partial<CharacterMotionValues>): void {
    if (this.finished) return;
    this.finished = true;
    const current = this.editor.getSnapshot();
    if (current !== this.before || this.instanceId !== this.editor.getProjectInstanceId() || !this.isCurrent()) throw new Error('工程、镜头、部件或时间已变化，操作已取消。');
    const next = new CharacterMotionService().apply(this.before!.project, this.input, changes);
    this.editor.updateProject(next, this.input.autoKey ? '编辑部件动作' : '编辑角色默认姿势');
  }
}
