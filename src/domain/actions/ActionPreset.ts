/**
 * Data-driven action preset definitions for Day 25. Each preset maps to one
 * timeline event kind and describes the parameters it needs. This is plain
 * data (no plugin abstraction) consumed by `createPresetEvents`.
 */

export type ActionPresetId =
  | 'enter-left'
  | 'enter-right'
  | 'move-to'
  | 'scale-emphasis'
  | 'shake'
  | 'expression-switch'
  | 'fade-in'
  | 'fade-out';

export type ActionPresetEventType =
  | 'move'
  | 'scale'
  | 'opacity'
  | 'shake'
  | 'expression';

export type ActionPresetParameterField =
  | { name: 'startMs'; label: '起始时间 (ms)'; kind: 'integer' }
  | { name: 'durationMs'; label: '时长 (ms)'; kind: 'integer' }
  | { name: 'targetX'; label: '目标 X'; kind: 'number' }
  | { name: 'targetY'; label: '目标 Y'; kind: 'number' }
  | { name: 'scaleFactor'; label: '放大倍数'; kind: 'number' }
  | { name: 'amplitudeX'; label: '水平抖动幅度'; kind: 'number' }
  | { name: 'amplitudeY'; label: '垂直抖动幅度'; kind: 'number' }
  | { name: 'frequencyHz'; label: '抖动频率 (Hz)'; kind: 'number' }
  | { name: 'expressionId'; label: '表情'; kind: 'expression' };

export interface ActionPresetDefinition {
  id: ActionPresetId;
  label: string;
  description: string;
  eventType: ActionPresetEventType;
  /** Default duration in integer milliseconds. */
  defaultDurationMs: number;
  /** Whether the preset only applies to character layers. */
  requiresCharacter: boolean;
  parameterFields: readonly ActionPresetParameterField[];
}

export const ACTION_PRESETS: readonly ActionPresetDefinition[] = [
  {
    id: 'enter-left',
    label: '左入场',
    description: '从画布左侧外滑入到图层当前位置。',
    eventType: 'move',
    defaultDurationMs: 800,
    requiresCharacter: false,
    parameterFields: [{ name: 'durationMs', label: '时长 (ms)', kind: 'integer' }],
  },
  {
    id: 'enter-right',
    label: '右入场',
    description: '从画布右侧外滑入到图层当前位置。',
    eventType: 'move',
    defaultDurationMs: 800,
    requiresCharacter: false,
    parameterFields: [{ name: 'durationMs', label: '时长 (ms)', kind: 'integer' }],
  },
  {
    id: 'move-to',
    label: '移动到',
    description: '从图层当前位置移动到指定的逻辑坐标。',
    eventType: 'move',
    defaultDurationMs: 800,
    requiresCharacter: false,
    parameterFields: [
      { name: 'targetX', label: '目标 X', kind: 'number' },
      { name: 'targetY', label: '目标 Y', kind: 'number' },
      { name: 'durationMs', label: '时长 (ms)', kind: 'integer' },
    ],
  },
  {
    id: 'scale-emphasis',
    label: '放大强调',
    description: '从图层当前缩放放大到指定倍数再回落。',
    eventType: 'scale',
    defaultDurationMs: 800,
    requiresCharacter: false,
    parameterFields: [
      { name: 'scaleFactor', label: '放大倍数', kind: 'number' },
      { name: 'durationMs', label: '时长 (ms)', kind: 'integer' },
    ],
  },
  {
    id: 'shake',
    label: '抖动',
    description: '在图层当前位置叠加正弦抖动。',
    eventType: 'shake',
    defaultDurationMs: 600,
    requiresCharacter: false,
    parameterFields: [
      { name: 'amplitudeX', label: '水平抖动幅度', kind: 'number' },
      { name: 'amplitudeY', label: '垂直抖动幅度', kind: 'number' },
      { name: 'frequencyHz', label: '抖动频率 (Hz)', kind: 'number' },
      { name: 'durationMs', label: '时长 (ms)', kind: 'integer' },
    ],
  },
  {
    id: 'expression-switch',
    label: '表情切换',
    description: '在时间段内切换角色表情。',
    eventType: 'expression',
    defaultDurationMs: 1000,
    requiresCharacter: true,
    parameterFields: [
      { name: 'expressionId', label: '表情', kind: 'expression' },
      { name: 'durationMs', label: '时长 (ms)', kind: 'integer' },
    ],
  },
  {
    id: 'fade-in',
    label: '淡入',
    description: '透明度从 0 渐变到图层当前不透明度。',
    eventType: 'opacity',
    defaultDurationMs: 800,
    requiresCharacter: false,
    parameterFields: [{ name: 'durationMs', label: '时长 (ms)', kind: 'integer' }],
  },
  {
    id: 'fade-out',
    label: '淡出',
    description: '透明度从图层当前不透明度渐变到 0。',
    eventType: 'opacity',
    defaultDurationMs: 800,
    requiresCharacter: false,
    parameterFields: [{ name: 'durationMs', label: '时长 (ms)', kind: 'integer' }],
  },
];

const ACTION_PRESET_BY_ID_RECORD: Record<ActionPresetId, ActionPresetDefinition> =
  ACTION_PRESETS.reduce(
    (record, preset) => {
      record[preset.id] = preset;
      return record;
    },
    {} as Record<ActionPresetId, ActionPresetDefinition>,
  );

export function getActionPreset(id: ActionPresetId): ActionPresetDefinition {
  return ACTION_PRESET_BY_ID_RECORD[id];
}

export const ACTION_PRESET_BY_ID = ACTION_PRESET_BY_ID_RECORD;
