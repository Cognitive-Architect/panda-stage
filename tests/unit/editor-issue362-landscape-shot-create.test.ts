import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canSubmitShotCreate,
  formatShotCreateDuration,
  getShotCreateDurationError,
  isShotCreateDurationValid,
  parseShotCreateDuration,
  SHOT_CREATE_DURATION_PRESETS_MS,
  SHOT_CREATE_DURATION_STEP_MS,
  ShotCreateForm,
  stepShotCreateDuration,
} from '../../src/renderer/features/shots/ShotCreateForm';

function source(path: string): string {
  return readFileSync(path, 'utf8').replaceAll('\r\n', '\n');
}

function renderCreate(presentation: 'default' | 'landscape'): string {
  return renderToStaticMarkup(
    createElement(ShotCreateForm, {
      onBack: () => undefined,
      onCreate: () => true,
      presentation,
      suggestedName: '镜头 3',
    }),
  );
}

describe('Issue #362 landscape Shot quick-create', () => {
  it('renders one focused landscape create surface with seconds, presets, and a single primary CTA', () => {
    const markup = renderCreate('landscape');

    expect(markup).toContain('data-shot-create-presentation="landscape"');
    expect(markup).toContain('新建镜头');
    expect(markup).toContain('名称');
    expect(markup).toContain('data-testid="shot-create-name"');
    expect(markup).toContain('data-testid="shot-create-duration-decrease"');
    expect(markup).toContain('data-testid="shot-create-duration-increase"');
    expect(markup).toContain('data-testid="shot-create-duration-input"');
    expect(markup).toContain('value="3.0"');
    expect(markup).toContain('aria-hidden="true">秒</span>');
    expect(markup).toContain('1 秒');
    expect(markup).toContain('5 秒');
    expect(markup).toContain('10 秒');
    expect(markup).toContain('data-testid="shot-create-submit"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).not.toContain('data-testid="shot-create-back"');
    expect(markup).not.toContain('镜头管理');
    expect(markup).not.toContain('时长（毫秒）');
    expect(markup).not.toContain('ms');
  });

  it('keeps the existing default create presentation on the millisecond path', () => {
    const markup = renderCreate('default');

    expect(markup).toContain('data-shot-create-presentation="default"');
    expect(markup).toContain('data-testid="shot-create-back"');
    expect(markup).toContain('镜头管理');
    expect(markup).toContain('时长（毫秒）');
    expect(markup).toContain('500ms');
    expect(markup).not.toContain('data-testid="shot-create-duration-decrease"');
    expect(markup).not.toContain('data-testid="shot-create-preset-');
  });

  it('covers presentation conversion, step boundaries, presets, validation, and submit eligibility', () => {
    expect(formatShotCreateDuration(500)).toBe('0.5');
    expect(formatShotCreateDuration(3_000)).toBe('3.0');
    expect(parseShotCreateDuration('3.25')).toBe(3_250);
    expect(Number.isNaN(parseShotCreateDuration(''))).toBe(true);
    expect(Number.isNaN(parseShotCreateDuration('not-a-duration'))).toBe(true);

    expect(SHOT_CREATE_DURATION_STEP_MS).toBe(500);
    expect(stepShotCreateDuration(1_000, -SHOT_CREATE_DURATION_STEP_MS)).toBe(500);
    expect(stepShotCreateDuration(500, -SHOT_CREATE_DURATION_STEP_MS)).toBe(500);
    expect(stepShotCreateDuration(3_000, SHOT_CREATE_DURATION_STEP_MS)).toBe(3_500);
    expect(SHOT_CREATE_DURATION_PRESETS_MS).toEqual([1_000, 3_000, 5_000, 10_000]);

    expect(isShotCreateDurationValid(500)).toBe(true);
    expect(isShotCreateDurationValid(499)).toBe(false);
    expect(isShotCreateDurationValid(500.5)).toBe(false);
    expect(getShotCreateDurationError('0.1', true)).toBe('最短 0.5 秒。');
    expect(getShotCreateDurationError('', true)).toBe('请输入时长。');
    expect(getShotCreateDurationError('3.0', true)).toBeNull();

    expect(canSubmitShotCreate('镜头 3', 3_000)).toBe(true);
    expect(canSubmitShotCreate('   ', 3_000)).toBe(false);
    expect(canSubmitShotCreate('镜头 3', 499)).toBe(false);
    expect(canSubmitShotCreate('镜头 3', 3_000, true)).toBe(false);
  });

  it('keeps navigation and mutation ownership outside local create-form state', () => {
    const create = source('src/renderer/features/shots/ShotCreateForm.tsx');
    const manager = source('src/renderer/features/shots/ShotManager.tsx');
    const dock = source('src/renderer/shell/ResourceActivityDock.tsx');
    const styles = source('src/renderer/styles.css');

    expect(create).toContain('onClick={() => selectPreset(presetMs)}');
    expect(create).toContain('if (onCreate(name, landscapeDurationMs)) onBack();');
    expect(manager).toContain('presentation={presentation}');
    expect(manager).toContain('shotStore.create');
    expect(dock).toContain(
      "data-resource-shot-view={activeActivity === 'shots' ? shotView : undefined}",
    );
    expect(styles).toContain(
      ".resource-activity-dock-landscape[data-resource-shot-view='create']",
    );
    expect(styles).toContain('.shot-create-duration-stepper');
    expect(styles).toContain('.shot-create-preset-selected');
    expect(styles).toContain('.shot-create-primary-action');
  });
});
