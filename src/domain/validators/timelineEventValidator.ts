import type { Project, TimelineEvent } from '../models';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/**
 * Validates candidate timeline events before they are committed to a project.
 * Out-of-bounds events are rejected with a Chinese reason (never silently
 * clamped or truncated). Invalid expression references, duplicate ids, and
 * invalid layers are also rejected. This is the single gate that prevents
 * illegal presets from entering history.
 */
export function validatePresetApplication(
  project: Project,
  shotId: string,
  layerId: string,
  events: readonly TimelineEvent[],
): ValidationResult {
  const errors: string[] = [];
  const shot = project.shots.find((candidate) => candidate.id === shotId);
  if (!shot) {
    return { ok: false, errors: [`找不到镜头：${shotId}`] };
  }
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer) {
    return { ok: false, errors: [`镜头中找不到图层：${layerId}`] };
  }
  if (shot.backgroundLayerId === layerId) {
    return { ok: false, errors: ['背景图层不能应用动作预设。'] };
  }

  // Seed the seen set with ids already present on the shot so that a newly
  // applied event cannot collide with an existing timeline event.
  const seenIds = new Set(shot.timelineEvents.map((event) => event.id));
  for (const event of events) {
    if (seenIds.has(event.id)) {
      errors.push(`事件 ID 重复：${event.id}`);
    }
    seenIds.add(event.id);

    if (event.layerId !== layerId) {
      errors.push(`事件“${event.type}”(${event.id}) 的 layerId 与所选图层不一致。`);
    }

    if (event.endMs > shot.durationMs) {
      errors.push(
        `事件“${event.type}”(${event.id}) 在 ${event.endMs}ms 结束，` +
          `超出镜头时长 ${shot.durationMs}ms，无法应用。`,
      );
    }

    if (event.type === 'opacity') {
      if (
        event.from < 0 ||
        event.from > 1 ||
        event.to < 0 ||
        event.to > 1
      ) {
        errors.push(`不透明度事件“${event.id}”的取值超出 0–1 范围。`);
      }
    }

    if (event.type === 'expression') {
      if (layer.source.kind !== 'character') {
        errors.push('表情事件只能用于角色图层。');
      } else {
        const characterId = layer.source.characterId;
        const character = project.characters.find(
          (candidate) => candidate.id === characterId,
        );
        if (!character) {
          errors.push('找不到该图层所属的角色。');
        } else if (
          !character.expressions.some(
            (expression) => expression.id === event.expressionId,
          )
        ) {
          errors.push(
            `表情事件引用了角色“${character.name}”不存在的表情：` +
              `${event.expressionId}。`,
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
