import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACTION_PRESETS } from '../../src/domain';

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * Issue #164 focused owner-contract test.
 *
 * Ports only the formal owner integration contract from the old Stage 3-B
 * work onto current main: `RightInspector` is the single formal owner of
 * `ActionPresetPanel`. It must be mounted exactly once in the formal surface
 * and removed from the legacy workspace. The eight presets and their existing
 * guards/history wiring must remain intact.
 */
describe('Issue 164 ActionPresetPanel formal owner restore', () => {
  it('mounts exactly one ActionPresetPanel in the formal RightInspector', () => {
    const inspector = readSource('src/renderer/shell/RightInspector.tsx');
    const legacy = readSource('src/renderer/shell/LegacyWorkspace.tsx');

    expect(inspector.match(/<ActionPresetPanel/gu)).toHaveLength(1);
    expect(legacy.match(/<ActionPresetPanel/gu) ?? []).toHaveLength(0);
  });

  it('keeps all eight presets rendered from ACTION_PRESETS', () => {
    const panel = readSource(
      'src/renderer/features/actions/ActionPresetPanel.tsx',
    );

    expect(ACTION_PRESETS).toHaveLength(8);
    expect(panel).toContain('data-testid="action-preset-panel"');
    // The panel renders every preset through one map over ACTION_PRESETS, so
    // the per-preset markup is asserted once against that single source form.
    expect(panel).toContain('ACTION_PRESETS.map((preset)');
    expect(panel).toContain('data-preset-id={preset.id}');
    expect(panel).toContain('preset-${preset.id}');
  });

  it('preserves existing guard + history wiring (apply routes through store)', () => {
    const panel = readSource(
      'src/renderer/features/actions/ActionPresetPanel.tsx',
    );

    expect(panel).toContain('actionPresetStore.apply');
    expect(panel).toContain('presetDisabled');
  });
});
