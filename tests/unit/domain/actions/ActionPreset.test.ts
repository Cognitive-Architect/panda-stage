import { describe, expect, it } from 'vitest';
import {
  ACTION_PRESETS,
  ACTION_PRESET_BY_ID,
  getActionPreset,
  type ActionPresetId,
} from '../../../../src/domain';

const EXPECTED_IDS: readonly ActionPresetId[] = [
  'enter-left',
  'enter-right',
  'move-to',
  'scale-emphasis',
  'shake',
  'expression-switch',
  'fade-in',
  'fade-out',
];

describe('T04 ActionPreset data definitions', () => {
  it('defines exactly 8 presets with the expected ids', () => {
    expect(ACTION_PRESETS).toHaveLength(8);
    expect(ACTION_PRESETS.map((preset) => preset.id)).toEqual([
      ...EXPECTED_IDS,
    ]);
  });

  it('covers the five supported event kinds', () => {
    const kinds = new Set(ACTION_PRESETS.map((preset) => preset.eventType));
    expect(kinds).toEqual(
      new Set(['move', 'scale', 'opacity', 'shake', 'expression']),
    );
  });

  it('only expression-switch requires a character layer', () => {
    for (const preset of ACTION_PRESETS) {
      if (preset.id === 'expression-switch') {
        expect(preset.requiresCharacter).toBe(true);
      } else {
        expect(preset.requiresCharacter).toBe(false);
      }
    }
  });

  it('uses positive integer default durations', () => {
    for (const preset of ACTION_PRESETS) {
      expect(Number.isInteger(preset.defaultDurationMs)).toBe(true);
      expect(preset.defaultDurationMs).toBeGreaterThan(0);
    }
  });

  it('getActionPreset / ACTION_PRESET_BY_ID resolve every preset', () => {
    for (const preset of ACTION_PRESETS) {
      expect(getActionPreset(preset.id)).toBe(preset);
      expect(ACTION_PRESET_BY_ID[preset.id]).toBe(preset);
    }
  });

  it('fade presets expose only the duration field', () => {
    expect(getActionPreset('fade-in').parameterFields.map((f) => f.name)).toEqual(
      ['durationMs'],
    );
    expect(
      getActionPreset('fade-out').parameterFields.map((f) => f.name),
    ).toEqual(['durationMs']);
  });

  it('expression-switch exposes the expression field', () => {
    expect(
      getActionPreset('expression-switch').parameterFields.map((f) => f.name),
    ).toEqual(['expressionId', 'durationMs']);
  });
});
