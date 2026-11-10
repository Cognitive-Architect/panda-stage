// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CharacterService,
  LayerService,
  PartPoseAnimationService,
  type Project,
} from '../../src/domain';
import { PortraitPropertiesSections } from '../../src/renderer/shell/PortraitPropertiesSections';
import { PartPoseEditorPanel } from '../../src/renderer/features/properties/PartPoseEditorPanel';
import {
  createPartPoseGestureContextKey,
  type PartPoseEditorUi,
  type PartPoseGestureContextIdentity,
} from '../../src/renderer/features/part-pose/partPoseEditorTypes';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { layerStore } from '../../src/renderer/stores/layerStore';
import { positionAuthoringSessionStore } from '../../src/renderer/stores/positionAuthoringSessionStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { timelineUiStore } from '../../src/renderer/features/timeline/timelineUiStore';
import { adaptivePartsFixture } from '../helpers/adaptivePartsFixtures';
import { buildProject, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/part-pose-editor.pandastage';

function adaptiveLayerProject(): {
  project: Project;
  layerId: string;
  partIds: string[];
} {
  const project = new CharacterService().createAdaptiveParts(buildProject(), {
    name: 'Part pose editor Character',
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
  return {
    project: placed.project,
    layerId: placed.layer.id,
    partIds: character.parts.map((part) => part.partId),
  };
}

function currentShot() {
  const project = editorProjectStore.getSnapshot()?.project;
  const shot = project?.shots.find((candidate) => candidate.id === IDS.shot);
  if (!project || !shot) throw new Error('Pose editor fixture Shot is missing.');
  return { project, shot };
}

function currentLayer(layerId: string) {
  const { shot } = currentShot();
  const layer = shot.layers.find((candidate) => candidate.id === layerId);
  if (!layer) throw new Error('Pose editor fixture Layer is missing.');
  return layer;
}

function editorUi(
  layerId: string | null,
  partId: string | null,
): PartPoseEditorUi {
  return {
    actionSectionOpen: false,
    onActionSectionOpenChange: () => undefined,
    activeLayerId: layerId,
    selectedPartId: partId,
    calibratingPivot: false,
    pivotDraft: null,
    onStart: () => undefined,
    onExit: () => undefined,
    onSelectPart: () => undefined,
    onStartPivot: () => undefined,
    onCancelPivot: () => undefined,
    onSetPivot: () => undefined,
    onCommitPivotDrag: () => undefined,
    onPivotUsed: () => undefined,
  };
}

function context(): PartPoseGestureContextIdentity {
  return {
    projectInstanceId: 1,
    projectId: 'project',
    projectRoot: PROJECT_ROOT,
    revision: 0,
    shotId: IDS.shot,
    selectedLayerId: 'layer',
    activeLayerId: 'layer',
    selectedPartId: 'arm',
    timeMs: 1_000,
  };
}

let container: HTMLDivElement;
let root: Root;
let fixture: ReturnType<typeof adaptiveLayerProject>;

describe('Part pose editor UI', () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    fixture = adaptiveLayerProject();
    editorProjectStore.open(PROJECT_ROOT, fixture.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    const { shot } = currentShot();
    timelineUiStore.seek(0, shot.durationMs);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    editorProjectStore.clear();
  });

  it('shows inline controls only for Adaptive Parts and keeps inspection read-only', async () => {
    const { project, shot } = currentShot();
    const layer = currentLayer(fixture.layerId);
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer,
      editor: editorUi(null, null),
    })));
    expect(container.querySelector('[data-testid="part-pose-part-select"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-testid="part-pose-edit-action"]'))
      .toBeNull();

    const ordinaryLayer = {
      ...layer,
      source: { kind: 'asset' as const, assetId: project.assets[0]!.id },
    };
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: ordinaryLayer,
      editor: editorUi(null, null),
    })));
    expect(container.querySelector('[data-testid="part-pose-part-select"]'))
      .toBeNull();

    timelineUiStore.seek(1_000, shot.durationMs);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('keeps Action expansion passive and starts pose editing through explicit part controls', async () => {
    const { project, shot } = currentShot();
    const layer = currentLayer(fixture.layerId);
    const selectedPartId = fixture.partIds[0]!;
    const onStart = vi.fn();
    const onStartPivot = vi.fn();
    const onActionSectionOpenChange = vi.fn();

    await act(async () => root.render(createElement(PortraitPropertiesSections, {
      backgroundLayerSelected: false,
      layer,
      partPoseEditor: {
        ...editorUi(null, selectedPartId),
        onStart,
        onStartPivot,
        onActionSectionOpenChange,
      },
      presentation: 'landscape',
      project,
      shot,
    })));

    const sections = container.querySelector<HTMLDivElement>(
      '[data-testid="right-inspector-compact-sections"]',
    )!;
    const action = sections.querySelector<HTMLDetailsElement>(
      '[data-testid="right-inspector-action-section"]',
    )!;
    expect(action.parentElement).toBe(sections);
    expect(sections.querySelector('[data-testid="right-inspector-transform-section"]')?.parentElement)
      .toBe(sections);
    expect(action.querySelector('[data-testid="right-inspector-action-position"]'))
      .not.toBeNull();
    expect(action.querySelector('[data-testid="right-inspector-action-position"]')?.getAttribute('aria-label'))
      .toBe('移动');
    expect(action.querySelector('[data-testid="part-pose-part-select"]'))
      .not.toBeNull();
    expect(action.querySelector('[data-testid="part-pose-editor"]')?.getAttribute('aria-label'))
      .toBe('部位');
    expect(action.querySelector('[data-testid="part-pose-pivot-status"]')?.textContent)
      .toContain('未设置');
    expect(container.textContent).not.toContain('编辑动作');
    expect(container.textContent).not.toContain('返回');
    expect(action.open).toBe(false);

    await act(async () => action.querySelector('summary')?.click());

    expect(onStart).not.toHaveBeenCalled();
    expect(onActionSectionOpenChange).toHaveBeenLastCalledWith(true);
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.disabled).toBe(false);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.click());
    expect(onStartPivot).toHaveBeenCalledWith(fixture.layerId, selectedPartId);

    const selector = container.querySelector<HTMLSelectElement>(
      '[data-testid="part-pose-part-select"]',
    )!;
    selector.value = fixture.partIds[1]!;
    await act(async () => selector.dispatchEvent(new Event('change', { bubbles: true })));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onStart).toHaveBeenCalledWith(fixture.layerId, fixture.partIds[1]);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 0,
      redoCount: 0,
    });
  });

  it('keeps Position actions for ordinary image Layers without showing part controls', async () => {
    const baseProject = buildProject();
    const placed = new LayerService().createFromAsset(
      baseProject,
      IDS.shot,
      {
        version: 2,
        type: 'asset-image',
        assetId: IDS.assetBg,
        position: { x: 700, y: 500 },
      },
    );
    editorProjectStore.clear();
    editorProjectStore.open(PROJECT_ROOT, placed.project);
    shotStore.select(IDS.shot);
    selectionStore.select(placed.layer.id);
    const shot = currentShot().shot;
    timelineUiStore.seek(1_000, shot.durationMs);

    await act(async () => root.render(createElement(PortraitPropertiesSections, {
      backgroundLayerSelected: false,
      layer: placed.layer,
      partPoseEditor: editorUi(null, null),
      presentation: 'landscape',
      project: placed.project,
      shot,
    })));

    const action = container.querySelector<HTMLDetailsElement>(
      '[data-testid="right-inspector-action-section"]',
    )!;
    expect(action).not.toBeNull();
    expect(action.querySelector('[data-testid="right-inspector-action-position"]'))
      .not.toBeNull();
    expect(action.querySelector('[data-testid="part-pose-part-select"]'))
      .toBeNull();
    const hold = action.querySelector<HTMLButtonElement>(
      '[data-testid="position-authoring-hold"]',
    );
    expect(hold?.getAttribute('aria-label')).toBe('保持当前位置');
    expect(hold?.title).toBe('保持当前位置');
    expect(hold?.disabled).toBe(false);
    await act(async () => hold?.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(1);
  });

  it('keeps Position finish neutral and cancels drafts when handing off or collapsing Action', async () => {
    const { shot } = currentShot();
    const selectedPartId = fixture.partIds[0]!;
    const layer = currentLayer(fixture.layerId);
    const onStart = vi.fn();
    const onStartPivot = vi.fn();
    const onExit = vi.fn();
    const onActionSectionOpenChange = vi.fn();
    const partPoseEditor: PartPoseEditorUi = {
      ...editorUi(null, selectedPartId),
      onStart,
      onStartPivot,
      onExit,
      onActionSectionOpenChange,
    };
    timelineUiStore.seek(1_000, shot.durationMs);
    expect(positionAuthoringSessionStore.createHold().status).toBe('committed');

    const positionSnapshot = editorProjectStore.getSnapshot()!;
    const positionRevision = positionSnapshot.revision;
    const positionEvents = positionSnapshot.project.shots.find(
      (candidate) => candidate.id === IDS.shot,
    )!.timelineEvents;

    await act(async () => root.render(createElement(PortraitPropertiesSections, {
      backgroundLayerSelected: false,
      layer: currentLayer(fixture.layerId),
      partPoseEditor,
      presentation: 'landscape',
      project: positionSnapshot.project,
      shot: currentShot().shot,
    })));
    const action = container.querySelector<HTMLDetailsElement>(
      '[data-testid="right-inspector-action-section"]',
    )!;
    await act(async () => action.querySelector('summary')?.click());

    const startButton = container.querySelector<HTMLButtonElement>(
      '[data-testid="position-authoring-start"]',
    );
    expect(startButton?.getAttribute('aria-label')).toBe('调整位置');
    expect(startButton?.title).toBe('调整位置');

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="position-authoring-start"]',
    )?.click());
    expect(onExit).not.toHaveBeenCalled();
    expect(positionAuthoringSessionStore.getSnapshot()?.layerId)
      .toBe(fixture.layerId);
    await act(async () => {
      positionAuthoringSessionStore.updateActiveDraft({
        x: layer.x + 25,
        y: layer.y + 15,
      });
    });
    expect(editorProjectStore.getSnapshot()?.revision).toBe(positionRevision);

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="position-authoring-finish"]',
    )?.click());
    expect(positionAuthoringSessionStore.getSnapshot()).toBeNull();
    expect(onStart).not.toHaveBeenCalled();

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="position-authoring-start"]',
    )?.click());
    expect(positionAuthoringSessionStore.getSnapshot()?.layerId)
      .toBe(fixture.layerId);
    await act(async () => {
      positionAuthoringSessionStore.updateActiveDraft({
        x: layer.x + 40,
        y: layer.y + 20,
      });
    });

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.click());
    expect(onStartPivot).toHaveBeenCalledWith(fixture.layerId, selectedPartId);
    expect(positionAuthoringSessionStore.getSnapshot()).toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: positionRevision,
      dirty: true,
    });

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="position-authoring-start"]',
    )?.click());
    await act(async () => {
      positionAuthoringSessionStore.updateActiveDraft({
        x: layer.x + 35,
        y: layer.y + 22,
      });
    });

    const selector = container.querySelector<HTMLSelectElement>(
      '[data-testid="part-pose-part-select"]',
    )!;
    selector.value = fixture.partIds[1]!;
    await act(async () => selector.dispatchEvent(new Event('change', { bubbles: true })));
    expect(onStart).toHaveBeenCalledWith(fixture.layerId, fixture.partIds[1]);
    expect(positionAuthoringSessionStore.getSnapshot()).toBeNull();
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: positionRevision,
      dirty: true,
    });

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="position-authoring-start"]',
    )?.click());
    await act(async () => {
      positionAuthoringSessionStore.updateActiveDraft({
        x: layer.x + 30,
        y: layer.y + 18,
      });
    });
    await act(async () => action.querySelector('summary')?.click());

    expect(action.open).toBe(false);
    expect(onActionSectionOpenChange).toHaveBeenLastCalledWith(false);
    expect(positionAuthoringSessionStore.getSnapshot()).toBeNull();
    expect(onExit).not.toHaveBeenCalled();
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: positionRevision,
      dirty: true,
    });
    expect(editorProjectStore.getSnapshot()?.project.shots.find(
      (candidate) => candidate.id === IDS.shot,
    )?.timelineEvents).toEqual(positionEvents);
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
  });

  it('uses one part selector, marks hidden parts, translates known names, and syncs selection', async () => {
    const baseProject = currentShot().project;
    const character = baseProject.characters.find(
      (candidate) => candidate.mode === 'adaptive-parts',
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Adaptive Parts fixture Character is missing.');
    }
    const displayNames = [
      'Torso',
      'Head',
      'Upper arm',
      'Forearm',
      '很长的零件名称用于检查下拉省略和完整名称提示',
      'Body + arm composite',
    ] as const;
    const project: Project = {
      ...baseProject,
      characters: baseProject.characters.map((candidate) =>
        candidate.id === character.id && candidate.mode === 'adaptive-parts'
          ? {
              ...candidate,
              parts: candidate.parts.map((part, index) => ({
                ...part,
                displayName: displayNames[index] ?? part.displayName,
                ...(index === 2 ? { visible: false } : {}),
              })),
            }
          : candidate,
      ),
    };
    editorProjectStore.clear();
    editorProjectStore.open(PROJECT_ROOT, project);
    const { shot } = currentShot();
    const onSelectPart = vi.fn();
    const onExit = vi.fn();

    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: {
        ...editorUi(fixture.layerId, fixture.partIds[0]!),
        onSelectPart,
        onExit,
      },
    })));

    const selector = container.querySelector<HTMLSelectElement>(
      '[data-testid="part-pose-part-select"]',
    );
    expect(selector).not.toBeNull();
    expect(container.querySelectorAll('.part-pose-editor-part')).toHaveLength(0);
    expect(selector!.options[0]?.textContent).toBe('身体');
    expect(selector!.options[1]?.textContent).toBe('头部');
    expect(selector!.options[2]?.textContent).toBe('上臂（隐藏）');
    expect(selector!.options[3]?.textContent).toBe('前臂');
    expect(selector!.options[4]?.textContent)
      .toBe('很长的零件名称用于检查下拉省略和完整名称提示');
    selector!.value = fixture.partIds[2]!;
    await act(async () => {
      selector!.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onSelectPart).toHaveBeenCalledWith(fixture.partIds[2]);

    const onStartInactive = vi.fn();
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: {
        ...editorUi(null, fixture.partIds[0]!),
        onStart: onStartInactive,
      },
    })));
    const inactiveSelector = container.querySelector<HTMLSelectElement>(
      '[data-testid="part-pose-part-select"]',
    )!;
    inactiveSelector.value = fixture.partIds[1]!;
    await act(async () => inactiveSelector.dispatchEvent(new Event('change', { bubbles: true })));
    expect(onStartInactive).toHaveBeenCalledWith(fixture.layerId, fixture.partIds[1]);

    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, fixture.partIds[4]!),
    })));
    expect(container.querySelector<HTMLSelectElement>(
      '[data-testid="part-pose-part-select"]',
    )?.title).toBe('很长的零件名称用于检查下拉省略和完整名称提示');

    const onCancelPivot = vi.fn();
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: {
        ...editorUi(fixture.layerId, fixture.partIds[0]!),
        calibratingPivot: true,
        onCancelPivot,
        onExit,
      },
    })));
    expect(container.querySelector('[data-testid="part-pose-cancel-pivot"]'))
      .not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-cancel-pivot"]',
    )?.click());
    expect(onCancelPivot).toHaveBeenCalledOnce();

    expect(container.querySelector('[data-testid="part-pose-editor-back"]'))
      .toBeNull();
    expect(onExit).not.toHaveBeenCalled();
  });

  it('shows disabled key actions with nearby locked or out-of-range reasons', async () => {
    const { project, shot } = currentShot();
    const layer = currentLayer(fixture.layerId);
    timelineUiStore.seek(1_000, shot.durationMs);

    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: { ...layer, locked: true },
      editor: editorUi(fixture.layerId, fixture.partIds[0]!),
    })));
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    )?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="part-pose-key-reason"]')?.textContent)
      .toContain('图层已锁定');

    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot: { ...shot, durationMs: 500 },
      layer,
      editor: editorUi(fixture.layerId, fixture.partIds[0]!),
    })));
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    )?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="part-pose-key-reason"]')?.textContent)
      .toContain('超出镜头范围');
  });

  it('keeps fine controls collapsed and confirms the undoable clear action', async () => {
    const { shot } = currentShot();
    timelineUiStore.seek(1_000, shot.durationMs);
    expect(positionAuthoringSessionStore.createHold().status).toBe('committed');
    const positionEventsBeforeClear = currentShot().shot.timelineEvents;
    const partId = fixture.partIds[0]!;
    const renderActivePanel = async (): Promise<void> => {
      const { project: currentProject, shot: currentShotValue } = currentShot();
      await act(async () => root.render(createElement(PartPoseEditorPanel, {
        project: currentProject,
        shot: currentShotValue,
        layer: currentLayer(fixture.layerId),
        editor: editorUi(fixture.layerId, partId),
      })));
    };

    await renderActivePanel();
    expect(container.querySelector('[data-testid="part-pose-key-row"]')?.textContent)
      .toContain('01.000 秒');
    expect(container.querySelector('[data-testid="part-pose-fine"]')?.hasAttribute('open'))
      .toBe(false);
    expect(container.querySelectorAll('.part-pose-editor-adjustments button'))
      .toHaveLength(4);
    expect(container.querySelector('[role="status"]')).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    )?.click());
    await renderActivePanel();

    expect(container.querySelector('[data-testid="part-pose-key-present"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="part-pose-key-present"]')?.textContent)
      .toContain('已有关键帧');
    expect(container.querySelector('[data-testid="part-pose-key-present"]')?.getAttribute('data-ui-button'))
      .toBeNull();
    expect(container.querySelector('[data-testid="part-pose-add-key"]')).toBeNull();
    expect(container.querySelector('[data-testid="part-pose-pivot-fixed"]')).not.toBeNull();
    const fixedPivotAction = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    );
    expect(fixedPivotAction?.disabled).toBe(true);
    expect(fixedPivotAction?.title).toContain('已有动作姿势，旋转点已固定');
    expect(fixedPivotAction?.getAttribute('aria-label'))
      .toContain('已有动作姿势，旋转点已固定');
    expect(container.querySelector('[data-testid="part-pose-more"]')).toBeNull();
    expect(container.querySelector('[data-testid="part-pose-clear"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="part-pose-clear"]')?.textContent)
      .toContain('清除全部零件动作');

    const fine = container.querySelector<HTMLDetailsElement>(
      '[data-testid="part-pose-fine"]',
    )!;
    await act(async () => fine.querySelector('summary')?.click());
    expect(fine.open).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-rotation-controls"] button',
    )?.click());
    await renderActivePanel();
    expect(currentLayer(fixture.layerId).poseAnimation!.tracks.find(
      (track) => track.partId === partId,
    )!.keys.find((key) => key.timeMs === 1_000)?.rotationDeg).toBe(-15);
    expect(editorProjectStore.getSnapshot()?.revision).toBe(3);

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-clear"]',
    )?.click());
    expect(container.querySelector('[data-testid="part-pose-clear-confirm"]')?.textContent)
      .toContain('清除当前镜头当前人物实例的所有零件姿势');
    expect(container.querySelector('[data-testid="part-pose-clear-confirm"]')?.textContent)
      .toContain('恢复角色库当前默认姿势');
    expect(container.querySelector('[data-testid="part-pose-clear-confirm"]')?.textContent)
      .toContain('恢复结果可能与冻结的旧镜头不同');
    expect(container.querySelector('[data-testid="part-pose-confirm-clear"]')?.textContent)
      .toContain('确认清除');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(editorProjectStore.getSnapshot()?.revision).toBe(3);
    expect(currentLayer(fixture.layerId).poseAnimation).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-cancel-clear"]',
    )?.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(3);
    expect(currentLayer(fixture.layerId).poseAnimation).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-clear"]',
    )?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-confirm-clear"]',
    )?.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(4);
    expect(currentLayer(fixture.layerId).poseAnimation).toBeUndefined();
    expect(currentShot().shot.timelineEvents).toEqual(positionEventsBeforeClear);
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 4,
      redoCount: 0,
    });

    await act(async () => {
      expect(editorProjectStore.undo()).toBe(true);
    });
    expect(currentLayer(fixture.layerId).poseAnimation).not.toBeNull();
    expect(currentLayer(fixture.layerId).poseAnimation!.tracks.find(
      (track) => track.partId === partId,
    )!.keys.find((key) => key.timeMs === 1_000)?.rotationDeg).toBe(-15);
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 3,
      redoCount: 1,
    });
  });

  it('clears only the selected Character instance and preserves Position keys', async () => {
    const initialProject = currentShot().project;
    const firstLayer = currentLayer(fixture.layerId);
    if (firstLayer.source.kind !== 'character') {
      throw new Error('Adaptive Parts fixture Layer has no Character source.');
    }
    const secondPlacement = new LayerService().createFromAdaptiveCharacter(
      initialProject,
      IDS.shot,
      firstLayer.source.characterId,
      { x: firstLayer.x + 120, y: firstLayer.y },
    );
    editorProjectStore.clear();
    editorProjectStore.open(PROJECT_ROOT, secondPlacement.project);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    timelineUiStore.seek(1_000, currentShot().shot.durationMs);
    const partId = fixture.partIds[0]!;

    expect(positionAuthoringSessionStore.createHold().status).toBe('committed');
    const positionEventsBeforeClear = currentShot().shot.timelineEvents;
    selectionStore.select(secondPlacement.layer.id);
    layerStore.addPartPoseKeyframe(secondPlacement.layer.id, partId, 1_000);
    const otherInstancePose = currentLayer(secondPlacement.layer.id).poseAnimation;
    selectionStore.select(fixture.layerId);
    layerStore.addPartPoseKeyframe(fixture.layerId, partId, 1_000);

    const { project, shot } = currentShot();
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, partId),
    })));
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-clear"]',
    )?.click());
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-confirm-clear"]',
    )?.click());

    expect(currentLayer(fixture.layerId).poseAnimation).toBeUndefined();
    expect(currentLayer(secondPlacement.layer.id).poseAnimation).toEqual(otherInstancePose);
    expect(currentShot().shot.timelineEvents).toEqual(positionEventsBeforeClear);
    await act(async () => expect(editorProjectStore.undo()).toBe(true));
    expect(currentLayer(fixture.layerId).poseAnimation).not.toBeNull();
    expect(currentLayer(secondPlacement.layer.id).poseAnimation).toEqual(otherInstancePose);
    expect(currentShot().shot.timelineEvents).toEqual(positionEventsBeforeClear);
  });

  it('starts pose editing on demand for pivot and first-key actions', async () => {
    const { shot } = currentShot();
    timelineUiStore.seek(1_000, shot.durationMs);
    const firstPartId = fixture.partIds[0]!;
    const onStart = vi.fn();
    const onStartPivot = vi.fn();
    const props = {
      project: fixture.project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: {
        ...editorUi(null, firstPartId),
        onStart,
        onStartPivot,
      },
    };
    await act(async () => root.render(createElement(PartPoseEditorPanel, props)));

    const setPivot = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    );
    expect(setPivot?.disabled).toBe(false);
    await act(async () => setPivot?.click());
    expect(onStartPivot).toHaveBeenCalledWith(fixture.layerId, firstPartId);

    const addKey = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    );
    expect(addKey?.disabled).toBe(false);
    await act(async () => addKey?.click());
    expect(onStart).toHaveBeenCalledWith(fixture.layerId, firstPartId);

    const snapshot = editorProjectStore.getSnapshot()!;
    expect(snapshot).toMatchObject({ revision: 1, dirty: true });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({
      undoCount: 1,
      redoCount: 0,
    });
    const layer = currentLayer(fixture.layerId);
    expect(layer.poseAnimation!.tracks.every(
      (track) => track.keys[0]!.timeMs === 0,
    )).toBe(true);
    expect(layer.poseAnimation!.tracks.find(
      (track) => track.partId === firstPartId,
    )!.keys.map((key) => key.timeMs)).toEqual([0, 1_000]);

    const secondPartId = fixture.partIds[1]!;
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      ...props,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, secondPartId),
    })));
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.disabled).toBe(false);

    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      ...props,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, firstPartId),
    })));
    expect(container.querySelector('[data-testid="part-pose-set-pivot"]'))
      .not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="part-pose-pivot-fixed"]'))
      .not.toBeNull();
  });

  it('marks only a non-default pivot as calibrated and keeps reset visibly locked after a pose', async () => {
    const partId = fixture.partIds[0]!;
    const initial = currentShot();
    const characterLayer = currentLayer(fixture.layerId);
    const character = initial.project.characters.find(
      (candidate) =>
        characterLayer.source.kind === 'character' &&
        candidate.id === characterLayer.source.characterId,
    );
    if (character?.mode !== 'adaptive-parts') {
      throw new Error('Expected the pivot test fixture to use Adaptive Parts.');
    }
    const part = character.parts.find((candidate) => candidate.partId === partId)!;
    const crop = part.imageMapping.crop;
    const customPivot = {
      x: crop.x + crop.width / 2 + 1,
      y: crop.y + crop.height / 2 + 1,
    };

    await act(async () => {
      layerStore.createPartPoseAnimation(fixture.layerId);
    });
    const renderCurrent = async (): Promise<void> => {
      const { project, shot } = currentShot();
      await act(async () => root.render(createElement(PartPoseEditorPanel, {
        project,
        shot,
        layer: currentLayer(fixture.layerId),
        editor: editorUi(fixture.layerId, partId),
      })));
    };
    await renderCurrent();

    expect(container.querySelector('[data-testid="part-pose-pivot-status"]')?.textContent)
      .toContain('未设置');
    expect(container.querySelector('[data-testid="part-pose-pivot-calibrated"]'))
      .toBeNull();
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.getAttribute('aria-label')).toBe('设置旋转点');

    await act(async () => {
      layerStore.setPartPosePivot(fixture.layerId, partId, customPivot);
    });
    await renderCurrent();
    expect(container.querySelector('[data-testid="part-pose-pivot-calibrated"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-testid="part-pose-set-pivot"]')?.getAttribute('aria-label'))
      .toBe('重新设置旋转点');
    expect(container.textContent).not.toContain('已设置');

    const { shot } = currentShot();
    timelineUiStore.seek(1_000, shot.durationMs);
    await act(async () => {
      layerStore.addPartPoseKeyframe(fixture.layerId, partId, 1_000);
    });
    await renderCurrent();
    expect(container.querySelector('[data-testid="part-pose-pivot-fixed"]'))
      .not.toBeNull();
    expect(container.querySelector('[data-testid="part-pose-pivot-calibrated"]'))
      .not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.disabled).toBe(true);
  });

  it('blocks pose writes during pivot calibration and restores legal actions after cancel or selection', async () => {
    const { shot } = currentShot();
    timelineUiStore.seek(1_000, shot.durationMs);
    const partId = fixture.partIds[0]!;
    const onCancelPivot = vi.fn();
    const onSetPivot = vi.fn();
    const pivot = { x: 31, y: 47 };
    const renderPart = async (
      editor: PartPoseEditorUi,
    ): Promise<void> => {
      const { project } = currentShot();
      await act(async () => root.render(createElement(PartPoseEditorPanel, {
        project,
        shot,
        layer: currentLayer(fixture.layerId),
        editor,
      })));
    };

    await renderPart({
      ...editorUi(fixture.layerId, partId),
      calibratingPivot: true,
      onCancelPivot,
      onSetPivot,
    });
    const addKeyWhileCalibrating = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    );
    expect(addKeyWhileCalibrating?.disabled).toBe(true);
    expect(container.querySelector('[data-testid="part-pose-key-reason"]')?.textContent)
      .toContain('正在校准旋转点，请先完成或取消');
    expect([...container.querySelectorAll<HTMLButtonElement>(
      '[data-testid="part-pose-rotation-controls"] button, .part-pose-editor-scale-stepper button',
    )].every((button) => button.disabled)).toBe(true);
    await act(async () => addKeyWhileCalibrating?.click());
    expect(editorProjectStore.getSnapshot()).toMatchObject({ revision: 0, dirty: false });
    expect(editorProjectStore.history.getSnapshot()).toMatchObject({ undoCount: 0, redoCount: 0 });

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-cancel-pivot"]',
    )?.click());
    expect(onCancelPivot).toHaveBeenCalledOnce();
    await renderPart(editorUi(fixture.layerId, partId));
    const addKeyAfterCancel = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    );
    expect(addKeyAfterCancel?.disabled).toBe(false);
    await act(async () => addKeyAfterCancel?.click());
    expect(currentLayer(fixture.layerId).poseAnimation?.tracks.find(
      (track) => track.partId === partId,
    )?.keys.map((key) => key.timeMs)).toEqual([0, 1_000]);

    await renderPart({
      ...editorUi(fixture.layerId, partId),
      calibratingPivot: true,
      onCancelPivot,
    });
    const rotateWhileCalibrating = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-rotation-controls"] button',
    );
    expect(rotateWhileCalibrating?.disabled).toBe(true);
    const revisionDuringCalibration = editorProjectStore.getSnapshot()?.revision;
    await act(async () => rotateWhileCalibrating?.click());
    expect(editorProjectStore.getSnapshot()?.revision).toBe(revisionDuringCalibration);
    expect(currentLayer(fixture.layerId).poseAnimation?.tracks.find(
      (track) => track.partId === partId,
    )?.keys.find((key) => key.timeMs === 1_000)?.rotationDeg).toBe(0);

    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-cancel-pivot"]',
    )?.click());
    await renderPart(editorUi(fixture.layerId, partId));
    const rotateAfterCancel = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-rotation-controls"] button',
    );
    expect(rotateAfterCancel?.disabled).toBe(false);
    await act(async () => rotateAfterCancel?.click());
    expect(currentLayer(fixture.layerId).poseAnimation?.tracks.find(
      (track) => track.partId === partId,
    )?.keys.find((key) => key.timeMs === 1_000)?.rotationDeg).toBe(-15);

    const secondPartId = fixture.partIds[1]!;
    await renderPart({
      ...editorUi(fixture.layerId, secondPartId),
      calibratingPivot: true,
      onCancelPivot,
      onSetPivot,
    });
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    )?.disabled).toBe(true);
    await act(async () => onSetPivot(fixture.layerId, secondPartId, pivot));
    await renderPart({
      ...editorUi(fixture.layerId, secondPartId),
      pivotDraft: { layerId: fixture.layerId, partId: secondPartId, point: pivot },
    });
    const addKeyAfterPivot = container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    );
    expect(addKeyAfterPivot?.disabled).toBe(false);
    await act(async () => addKeyAfterPivot?.click());
    expect(currentLayer(fixture.layerId).poseAnimation?.tracks.find(
      (track) => track.partId === secondPartId,
    )?.keys.map((key) => key.timeMs)).toEqual([0, 1_000]);
    expect(onSetPivot).toHaveBeenCalledWith(fixture.layerId, secondPartId, pivot);
  });

  it('keeps editing an instance snapshot after its Character Part is removed', async () => {
    const character = fixture.project.characters.find(
      (candidate) => candidate.mode === 'adaptive-parts',
    );
    if (!character || character.mode !== 'adaptive-parts') {
      throw new Error('Adaptive Parts fixture Character is missing.');
    }
    const secondInstance = new LayerService().createFromAdaptiveCharacter(
      fixture.project,
      IDS.shot,
      character.id,
      { x: 950, y: 500 },
    );
    const captured = new PartPoseAnimationService().create(
      secondInstance.project,
      { shotId: IDS.shot, layerId: fixture.layerId },
    );
    const updatedLibrary = new CharacterService().updateAdaptivePartsDefinition(
      captured,
      character.id,
      {
        sourceRootTransform: character.sourceRootTransform,
        parts: character.parts.slice(1).map((part, index) => ({
          ...part,
          drawOrder: index,
        })),
      },
    );
    const originalPartId = fixture.partIds[0]!;
    const characterBeforeEdit = updatedLibrary.characters.find(
      (candidate) => candidate.id === character.id,
    );
    const otherInstanceBeforeEdit = updatedLibrary.shots
      .find((candidate) => candidate.id === IDS.shot)!
      .layers.find((candidate) => candidate.id === secondInstance.layer.id)!;

    editorProjectStore.clear();
    editorProjectStore.open(PROJECT_ROOT, updatedLibrary);
    shotStore.select(IDS.shot);
    selectionStore.select(fixture.layerId);
    const { project, shot } = currentShot();
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project,
      shot,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, originalPartId),
    })));

    timelineUiStore.seek(1_000, shot.durationMs);
    await act(async () => root.render(createElement(PartPoseEditorPanel, {
      project: editorProjectStore.getSnapshot()!.project,
      shot: currentShot().shot,
      layer: currentLayer(fixture.layerId),
      editor: editorUi(fixture.layerId, originalPartId),
    })));
    const partSelector = container.querySelector<HTMLSelectElement>(
      '[data-testid="part-pose-part-select"]',
    );
    expect(partSelector?.value).toBe(originalPartId);
    expect(partSelector?.selectedOptions[0]?.textContent).toContain('com6');
    expect(container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-set-pivot"]',
    )?.disabled).toBe(false);

    const pivotSource = { x: 123, y: 234 };
    await act(async () => {
      layerStore.setPartPosePivot(fixture.layerId, originalPartId, pivotSource);
    });
    await act(async () => container.querySelector<HTMLButtonElement>(
      '[data-testid="part-pose-add-key"]',
    )?.click());

    const snapshot = editorProjectStore.getSnapshot()!;
    const editedLayer = currentLayer(fixture.layerId);
    const editedTrack = editedLayer.poseAnimation!.tracks.find(
      (track) => track.partId === originalPartId,
    )!;
    const finalCharacter = snapshot.project.characters.find(
      (candidate) => candidate.id === character.id,
    );
    const finalOtherInstance = currentShot().shot.layers.find(
      (candidate) => candidate.id === secondInstance.layer.id,
    );

    expect(editedTrack.pivotSource).toEqual(pivotSource);
    expect(editedTrack.keys.map((key) => key.timeMs)).toEqual([0, 1_000]);
    expect(finalCharacter).toEqual(characterBeforeEdit);
    expect(finalOtherInstance).toEqual(otherInstanceBeforeEdit);
  });
});

describe('Part pose gesture context', () => {
  it('changes when the project session, revision, selection, or time changes', () => {
    const initial = context();
    const initialKey = createPartPoseGestureContextKey(initial);
    expect(createPartPoseGestureContextKey({ ...initial, revision: 1 }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, projectInstanceId: 2 }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, selectedLayerId: 'other' }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, selectedPartId: 'other' }))
      .not.toBe(initialKey);
    expect(createPartPoseGestureContextKey({ ...initial, timeMs: 500 }))
      .not.toBe(initialKey);
  });
});
