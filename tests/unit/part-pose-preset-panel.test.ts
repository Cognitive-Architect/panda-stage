// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CharacterService,
  LayerService,
  ShotService,
} from '../../src/domain';
import {
  PartPoseEditorPanel,
  readableError,
} from '../../src/renderer/features/properties/PartPoseEditorPanel';
import type { PartPoseEditorUi } from '../../src/renderer/features/part-pose/partPoseEditorTypes';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/part-pose-preset-panel.pandastage';

function editorUi(): PartPoseEditorUi {
  return {
    activeLayerId: selectionStore.getSelectedLayerId(),
    selectedPartId: null,
    calibratingPivot: false,
    pivotDraft: null,
    onStart: () => undefined,
    onExit: () => undefined,
    onSelectPart: () => undefined,
    onStartPivot: () => undefined,
    onCancelPivot: () => undefined,
    onSetPivot: () => undefined,
    onPivotUsed: () => undefined,
  };
}

let container: HTMLDivElement;
let root: Root;

function setup(): { characterId: string; partId: string } {
  let project = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Preset Panel Character',
    parts: adaptivePartsFixture(IDS.assetChar),
  });
  const character = project.characters.at(-1)!;
  if (character.mode !== 'adaptive-parts') {
    throw new Error('Expected an Adaptive Parts Character.');
  }
  const placed = new LayerService().createFromAdaptiveCharacter(
    project,
    IDS.shot,
    character.id,
    { x: 700, y: 500 },
  );
  project = placed.project;
  editorProjectStore.open(PROJECT_ROOT, project);
  shotStore.select(IDS.shot);
  selectionStore.select(placed.layer.id);
  const { shot } = currentShot();
  timelineUiStore.seek(0, shot.durationMs);
  return { characterId: character.id, partId: character.parts[0]!.partId };
}

function currentShot() {
  const project = editorProjectStore.getSnapshot()?.project;
  const shotId = shotStore.getCurrentShotId();
  const shot = project?.shots.find((candidate) => candidate.id === shotId);
  if (!project || !shot) throw new Error('Preset panel fixture Shot is missing.');
  return { project, shot };
}

function renderPanel(): void {
  const { project, shot } = currentShot();
  const layerId = selectionStore.getSelectedLayerId();
  const layer = shot.layers.find((candidate) => candidate.id === layerId)!;
  void act(() => {
    root.render(
      createElement(PartPoseEditorPanel, {
        project,
        shot,
        layer,
        editor: editorUi(),
      }),
    );
  });
}

function button(testId: string): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(
    `[data-testid="${testId}"]`,
  );
  if (!element) throw new Error(`Missing button: ${testId}`);
  return element;
}

describe('Part pose action preset panel', () => {
  it('keeps preset incompatibility reasons ahead of the generic changed copy', () => {
    expect(
      readableError(
        new Error(
          'Part arm rest pose changed since this preset was saved; refusing an incompatible apply.',
        ),
      ),
    ).toBe('人物静止姿势已变化，预设可能不兼容，已拒绝应用。');
    expect(
      readableError(
        new Error(
          'The Character source pose bounds changed since this preset was saved; refusing an incompatible apply.',
        ),
      ),
    ).toBe('人物零件布局已变化，预设动作不再对齐，已拒绝应用。');
    expect(
      readableError(
        new Error(
          'The Character source root transform changed since this preset was saved; refusing an incompatible apply.',
        ),
      ),
    ).toBe('人物整体结构已变化，预设与当前人物不兼容，已拒绝应用。');
    expect(readableError(new Error('The project snapshot is stale.'))).toBe(
      '工程或镜头已变化，操作已取消。',
    );
  });
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    editorProjectStore.clear();
  });

  it('saves and applies a preset through single history commits', () => {
    const { partId } = setup();
    renderPanel();

    const saveButton = button('part-pose-preset-save');
    const applyButton = button('part-pose-preset-apply');
    expect(saveButton.disabled).toBe(true);
    expect(applyButton.disabled).toBe(true);

    // Author a 0 -> raise motion on the source instance.
    const layerId = selectionStore.getSelectedLayerId()!;
    act(() => {
      layerStore.createPartPoseAnimation(layerId);
    });
    act(() => {
      layerStore.setPartPoseKeyframe(layerId, partId, {
        timeMs: 1_000,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 90,
        scale: 1,
        easingToNext: 'ease-in-out',
      });
    });
    renderPanel();
    expect(saveButton.disabled).toBe(false);

    const nameInput = container.querySelector<HTMLInputElement>(
      '[data-testid="part-pose-preset-name"]',
    )!;
    const setNativeValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    act(() => {
      setNativeValue.call(nameInput, '抬手');
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const revisionBeforeSave = editorProjectStore.getSnapshot()!.revision;
    act(() => {
      saveButton.click();
    });
    const afterSave = editorProjectStore.getSnapshot()!;
    expect(afterSave.project.partPosePresets).toHaveLength(1);
    expect(afterSave.revision).toBe(revisionBeforeSave + 1);

    // Second instance of the same Character in a new Shot.
    const withShot = new ShotService().create(afterSave.project, {
      name: '镜头二',
      durationMs: 3_000,
    });
    const secondShot = withShot.shots.at(-1)!;
    const placed = new LayerService().createFromAdaptiveCharacter(
      withShot,
      secondShot.id,
      afterSave.project.partPosePresets![0]!.characterId,
      { x: 700, y: 500 },
    );
    act(() => {
      editorProjectStore.updateProject(placed.project, '测试夹具：新建第二实例');
      shotStore.select(secondShot.id);
      selectionStore.select(placed.layer.id);
    });
    renderPanel();
    expect(applyButton.disabled).toBe(false);

    const revisionBeforeApply = editorProjectStore.getSnapshot()!.revision;
    act(() => {
      applyButton.click();
    });
    const afterApply = editorProjectStore.getSnapshot()!;
    expect(afterApply.revision).toBe(revisionBeforeApply + 1);
    const targetLayer = afterApply.project.shots
      .find((candidate) => candidate.id === secondShot.id)!
      .layers.find((candidate) => candidate.id === placed.layer.id)!;
    const arm = targetLayer.poseAnimation!.tracks.find(
      (track) => track.partId === partId,
    )!;
    expect(arm.keys.map((key) => key.timeMs)).toEqual([0, 1_000]);
    expect(arm.keys[1]!.rotationDeg).toBe(90);
  });
});
