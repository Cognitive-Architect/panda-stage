import {
  CHARACTER_PART_MAX_SCALE,
  CHARACTER_PART_MIN_SCALE,
  CharacterMotionService,
  CharacterNodeMotionService,
  characterMotionValues,
  characterNodeMotionResetValues,
  characterNodeMotionScaleBounds,
  characterNodeMotionValues,
  NEUTRAL_CHARACTER_MOTION,
  type CharacterMotionInput,
  type CharacterMotionValues,
  type CharacterNodeMotionInput,
} from '../../../domain';
import type { EditorProjectStore, EditorProjectSnapshot } from '../../stores/EditorProjectStore';

export type CharacterMotionGestureInput = CharacterMotionInput | CharacterNodeMotionInput;

export function isCharacterNodeMotionInput(
  input: CharacterMotionGestureInput,
): input is CharacterNodeMotionInput {
  return 'nodeId' in input;
}

/** #979 gesture boundary: retain before, preview locally, commit one ProjectCommand. */
export class CharacterMotionGesture {
  private readonly before: EditorProjectSnapshot;
  private readonly instanceId;
  private finished = false;
  readonly values: CharacterMotionValues;
  readonly minScale: number;
  readonly maxScale: number;
  readonly resetValues: CharacterMotionValues;
  constructor(
    private readonly editor: EditorProjectStore,
    private readonly input: CharacterMotionGestureInput,
    private readonly isCurrent: () => boolean,
  ) {
    const before = editor.getSnapshot();
    if (!before) throw new Error('请先打开项目。');
    this.before = before;
    this.instanceId = editor.getProjectInstanceId();
    if (isCharacterNodeMotionInput(input)) {
      this.values = characterNodeMotionValues(this.before.project, input);
      const bounds = characterNodeMotionScaleBounds(this.before.project, input);
      this.minScale = bounds.min;
      this.maxScale = bounds.max;
      this.resetValues = characterNodeMotionResetValues(this.before.project, input);
    } else {
      this.values = characterMotionValues(this.before.project, input);
      this.minScale = CHARACTER_PART_MIN_SCALE;
      this.maxScale = CHARACTER_PART_MAX_SCALE;
      this.resetValues = { ...NEUTRAL_CHARACTER_MOTION };
    }
  }
  commit(changes: Partial<CharacterMotionValues>): void {
    if (this.finished) return;
    this.finished = true;
    const current = this.editor.getSnapshot();
    if (current !== this.before || this.instanceId !== this.editor.getProjectInstanceId() || !this.isCurrent()) throw new Error('工程、镜头、部件或时间已变化，操作已取消。');
    if (isCharacterNodeMotionInput(this.input)) {
      const next = new CharacterNodeMotionService().apply(this.before.project, this.input, changes);
      if (next !== this.before.project) {
        this.editor.updateProject(next, this.input.autoKey ? '编辑脸部动作' : '编辑脸部默认姿势');
      }
      return;
    }
    const next = new CharacterMotionService().apply(this.before.project, this.input, changes);
    if (next !== this.before.project) {
      this.editor.updateProject(next, this.input.autoKey ? '编辑部件动作' : '编辑角色默认姿势');
    }
  }
}
