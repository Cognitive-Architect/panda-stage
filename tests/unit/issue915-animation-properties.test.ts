// @vitest-environment happy-dom
import {
  act,
  createElement,
  Fragment,
  type FunctionComponent,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectSchema } from '../../src/domain';
import {
  LayerBackgroundControl,
  type LayerBackgroundControlProps,
} from '../../src/renderer/features/properties/LayerBackgroundControl';
import {
  LayerTransformPanel,
  useLayerTransformController,
  type LayerTransformPanelProps,
} from '../../src/renderer/features/properties/LayerTransformPanel';
import { editorProjectStore } from '../../src/renderer/stores/EditorProjectStore';
import { selectionStore } from '../../src/renderer/stores/selectionStore';
import { shotStore } from '../../src/renderer/stores/shotStore';
import { buildProjectWithAnimation, IDS } from './domain/testProject';

const PROJECT_ROOT = 'D:/issue915-properties.pandastage';
const PRECISE_SCALE = 1.79986731171;
const TransformPanel: FunctionComponent<LayerTransformPanelProps> =
  LayerTransformPanel;
const BackgroundControl: FunctionComponent<LayerBackgroundControlProps> =
  LayerBackgroundControl;

function projectWithAnimationLayer() {
  const project = buildProjectWithAnimation();
  const shot = project.shots.find((candidate) => candidate.id === IDS.shot);
  const imageLayer = shot?.layers.find(
    (candidate) => candidate.id === IDS.layerAsset,
  );
  if (!shot || !imageLayer) {
    throw new Error('Issue #915 Properties fixture is missing its target layers.');
  }
  const animationLayer = {
    ...imageLayer,
    id: IDS.animationLayer,
    name: 'Animation',
    source: { kind: 'animation' as const, animationId: IDS.animation },
    startTimeMs: 0,
    animationPlayback: { mode: 'once' as const, endBehavior: 'hold' as const },
  };
  return ProjectSchema.parse({
    ...project,
    shots: project.shots.map((candidate) =>
      candidate.id === IDS.shot
        ? {
            ...candidate,
            layers: [
              ...candidate.layers.map((layer) =>
                layer.id === IDS.layerAsset
                  ? { ...layer, scaleX: PRECISE_SCALE, scaleY: PRECISE_SCALE }
                  : layer,
              ),
              animationLayer,
            ],
          }
        : candidate,
    ),
  });
}

function PropertiesHarness() {
  const controller = useLayerTransformController({ compact: true });
  return createElement(
    Fragment,
    null,
    createElement(TransformPanel, {
      compact: true,
      controller,
      showResetTransform: true,
    }),
    createElement(BackgroundControl, {
      compact: true,
      presentation: 'landscape',
      transformController: controller,
    }),
  );
}

let container: HTMLDivElement;
let root: Root;

async function renderHarness(): Promise<void> {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(PropertiesHarness)));
}

function input(testId: string): HTMLInputElement {
  const element = container.querySelector<HTMLInputElement>(
    `[data-testid="${testId}"]`,
  );
  if (!element) throw new Error(`Missing Issue #915 input: ${testId}.`);
  return element;
}

async function changeInputValue(
  element: HTMLInputElement,
  value: string,
  blur = false,
): Promise<void> {
  await act(async () => element.focus());
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set;
    if (!setter) throw new Error('HTMLInputElement.value setter is missing.');
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  if (blur) await act(async () => element.blur());
}

function selectedLayer() {
  return editorProjectStore
    .getSnapshot()
    ?.project.shots.find((candidate) => candidate.id === IDS.shot)
    ?.layers.find((candidate) => candidate.id === IDS.layerAsset);
}

describe('Issue #915 animation Properties', () => {
  beforeEach(async () => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    editorProjectStore.open(PROJECT_ROOT, projectWithAnimationLayer());
    shotStore.select(IDS.shot);
    selectionStore.select(IDS.layerAsset);
    await renderHarness();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    selectionStore.clear();
    editorProjectStore.clear();
  });

  it('rounds scale for display without mutating it during unrelated edits or reopen', async () => {
    const scaleInput = container.querySelector<HTMLInputElement>(
      '[data-testid="layer-transform-scale"] input',
    );
    if (!scaleInput) throw new Error('Compact scale input is not mounted.');
    expect(scaleInput.value).toBe('180');
    expect(selectedLayer()?.scaleX).toBe(PRECISE_SCALE);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });

    await changeInputValue(input('layer-transform-x'), '525', true);
    expect(selectedLayer()?.x).toBe(525);
    expect(selectedLayer()?.scaleX).toBe(PRECISE_SCALE);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 1,
      dirty: true,
    });

    const serialized = JSON.parse(
      JSON.stringify(editorProjectStore.getSnapshot()!.project),
    );
    await act(async () => {
      editorProjectStore.open(PROJECT_ROOT, ProjectSchema.parse(serialized));
      shotStore.select(IDS.shot);
      selectionStore.select(IDS.layerAsset);
    });
    expect(selectedLayer()?.scaleX).toBe(PRECISE_SCALE);
    expect(
      container.querySelector<HTMLInputElement>(
        '[data-testid="layer-transform-scale"] input',
      )?.value,
    ).toBe('180');
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 0,
      dirty: false,
    });

    await changeInputValue(
      container.querySelector<HTMLInputElement>(
        '[data-testid="layer-transform-scale"] input',
      )!,
      '180.5',
      true,
    );
    expect(selectedLayer()?.scaleX).toBe(1.805);
    expect(selectedLayer()?.scaleY).toBe(1.805);
    expect(editorProjectStore.getSnapshot()).toMatchObject({
      revision: 1,
      dirty: true,
    });
  });

  it('keeps opacity for animation and character selections while hiding inapplicable backgrounds', async () => {
    await act(async () => selectionStore.select(IDS.animationLayer));
    expect(container.querySelector('[data-testid="layer-opacity-range"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="layer-canvas-background"]')).toBeNull();
    expect(container.querySelector('[data-testid="current-background-name"]')).toBeNull();
    expect(container.querySelector('[data-testid="set-current-shot-background"]')).toBeNull();

    await act(async () => selectionStore.select(IDS.layerChar));
    expect(container.querySelector('[data-testid="layer-opacity-range"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="layer-canvas-background"]')).toBeNull();

    await act(async () => selectionStore.selectBackground());
    expect(container.querySelector('[data-testid="layer-opacity-range"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="layer-canvas-background"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="fill-current-shot-background"]')).not.toBeNull();

    await act(async () => selectionStore.select(IDS.layerAsset));
    const setBackground = container.querySelector<HTMLButtonElement>(
      '[data-testid="set-current-shot-background"]',
    );
    expect(setBackground?.disabled).toBe(false);
    await act(async () => setBackground?.click());
    expect(
      editorProjectStore.getSnapshot()?.project.shots[0]?.backgroundLayerId,
    ).toBe(IDS.layerAsset);
    expect(container.querySelector('[data-testid="layer-canvas-background"]')).not.toBeNull();
  });
});
