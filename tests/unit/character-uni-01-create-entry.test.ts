// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import exampleProject from '../../demo-project/project-v1.example.json';
import {
  migrateProject,
  type CreateCompositeCharacterInput,
  type ImageAsset,
} from '../../src/domain';
import { CharacterList } from '../../src/renderer/features/characters/CharacterList';

/**
 * Issue #1031 / CHAR-UNI-01
 *
 * F01 – one Create entry offering 整图 / 身体+脸 / 导入 FLA
 * F02 – the Create form keeps the left resource panel visible
 * F03 – composite creation starts without implicit body/face assets
 * F04 – switching or cancelling leaves no session behind
 */

const project = migrateProject(exampleProject);
const imageAssets = project.assets.filter(
  (asset): asset is ImageAsset => asset.kind === 'image',
);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

interface RecordedCalls {
  begin: CreateCompositeCharacterInput[];
  draft: CreateCompositeCharacterInput[];
  cancel: number;
  flaImport: number;
}

interface HarnessOptions {
  withFlaImport?: boolean;
  compositeDraft?: CreateCompositeCharacterInput | null;
}

function renderCreateView(
  options: HarnessOptions = {},
): { calls: RecordedCalls; beginResult: boolean } {
  const calls: RecordedCalls = {
    begin: [],
    draft: [],
    cancel: 0,
    flaImport: 0,
  };
  act(() => {
    root.render(
      createElement(CharacterList, {
        characters: [],
        imageAssets,
        mode: 'create',
        selectedCharacterId: null,
        onBack: () => undefined,
        onCreate: () => undefined,
        onSelect: () => undefined,
        onThumbnailError: () => undefined,
        compositeDraft: options.compositeDraft ?? null,
        onBeginCompositeCreate: (draft: CreateCompositeCharacterInput) => {
          calls.begin.push(draft);
          return true;
        },
        onCompositeDraftChange: (draft: CreateCompositeCharacterInput) => {
          calls.draft.push(draft);
        },
        onCancelCompositeCreate: () => {
          calls.cancel += 1;
        },
        ...(options.withFlaImport
          ? {
              onStartFlaCharacterImport: () => {
                calls.flaImport += 1;
              },
            }
          : {}),
      }),
    );
  });
  const harness = { calls, beginResult: true };
  return harness;
}

function click(element: Element | null): void {
  expect(element).not.toBeNull();
  act(() => {
    (element as HTMLElement).click();
  });
}

function radio(value: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(
    `input[name="character-create-mode"][value="${value}"]`,
  );
}

/** Open an ImageAssetPicker and choose the candidate with the given name. */
function chooseAsset(
  pickerTestId: string,
  asset: ImageAsset,
): void {
  click(container.querySelector(`[data-testid="${pickerTestId}-selected"]`));
  const option = Array.from(
    container.querySelectorAll(
      `[data-testid="${pickerTestId}-candidates"] [role="option"]`,
    ),
  ).find((candidate) =>
    (candidate.getAttribute('aria-label') ?? '').startsWith(asset.name),
  );
  click(option ?? null);
}

describe('Issue #1031 F01 – one Create entry, three creation ways', () => {
  it('offers 整图 / 身体+脸 / 导入 FLA from the same Create surface', () => {
    const { calls } = renderCreateView({ withFlaImport: true });
    expect(container.querySelector('[aria-label="角色类型"]')).not.toBeNull();
    expect(container.querySelectorAll('input[name="character-create-mode"]')).toHaveLength(3);
    expect(container.textContent).toContain('整图角色');
    expect(container.textContent).toContain('身体 + 脸');
    expect(container.textContent).toContain('导入 FLA');

    click(radio('fla-import'));
    expect(calls.flaImport).toBe(1);
  });

  it('keeps the two-way switch when the host has no FLA import capability', () => {
    renderCreateView();
    expect(container.querySelectorAll('input[name="character-create-mode"]')).toHaveLength(2);
    expect(container.querySelector('[data-testid="character-create-fla-import"]')).toBeNull();
    expect(container.textContent).not.toContain('导入 FLA');
  });
});

describe('Issue #1031 F03 – composite creation starts from an explicit choice', () => {
  it('does not borrow the first two image assets when entering 身体+脸', () => {
    const { calls } = renderCreateView();
    click(radio('composite'));

    expect(calls.begin).toHaveLength(0);
    expect(calls.cancel).toBe(1);
    expect(
      container
        .querySelector('[data-testid="character-create-body-picker"]')
        ?.getAttribute('data-selected-asset-id'),
    ).toBe('');
    expect(
      container
        .querySelector('[data-testid="character-create-face-picker"]')
        ?.getAttribute('data-selected-asset-id'),
    ).toBe('');
    expect(
      container.querySelector('[data-testid="character-create-composite-hint"]'),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(
        '[data-testid="character-create-composite-submit"]',
      )?.disabled,
    ).toBe(true);
  });

  it('starts the official draft only once a body and a default face exist', () => {
    const { calls } = renderCreateView();
    click(radio('composite'));

    chooseAsset('character-create-body-picker', imageAssets[0]!);
    expect(calls.begin).toHaveLength(0);

    chooseAsset('character-create-face-picker', imageAssets[1]!);
    expect(calls.begin).toHaveLength(1);
    const draft = calls.begin[0]!;
    expect(draft.bodyAssetId).toBe(imageAssets[0]!.id);
    expect(draft.expressions[0]?.assetId).toBe(imageAssets[1]!.id);
  });
});

describe('Issue #1031 F04 – switching away leaves no draft behind', () => {
  it('cancels the composite draft when switching back to 整图', () => {
    const { calls } = renderCreateView();
    click(radio('composite'));
    chooseAsset('character-create-body-picker', imageAssets[0]!);
    chooseAsset('character-create-face-picker', imageAssets[1]!);
    expect(calls.begin).toHaveLength(1);

    click(radio('single-image'));
    expect(calls.cancel).toBe(2);
    expect(radio('single-image')?.checked).toBe(true);
    expect(radio('composite')?.checked).toBe(false);
  });

  it('cancels the composite draft before handing over to FLA import', () => {
    const { calls } = renderCreateView({ withFlaImport: true });
    click(radio('composite'));
    chooseAsset('character-create-body-picker', imageAssets[0]!);
    chooseAsset('character-create-face-picker', imageAssets[1]!);

    click(radio('fla-import'));
    expect(calls.cancel).toBe(2);
    expect(calls.flaImport).toBe(1);
  });
});

describe('Issue #1031 F02 – the left Create form is never hidden by kind=create', () => {
  it('scopes the assembly surface takeover to the adaptive-parts workbench', () => {
    const assemblySurface = readFileSync(
      'src/renderer/styles/shell/layout/s17-02--character-assembly-surface.css',
      'utf8',
    ).replaceAll('\r\n', '\n');
    const shell = readFileSync(
      'src/renderer/shell/EditorShell.tsx',
      'utf8',
    ).replaceAll('\r\n', '\n');

    expect(assemblySurface).toContain(
      ".editor-shell[data-character-assembly-active='true'][data-character-assembly-kind='adaptive-parts']",
    );
    expect(assemblySurface).not.toContain(
      "[data-character-assembly-kind='create']\n  .resource-activity-dock",
    );
    expect(shell).toContain(
      "const assemblyHidesResourceDrawer = assemblyKind === 'adaptive-parts';",
    );
  });

  it('removes the parallel 导入角色 primary action from the character list', () => {
    const dock = readFileSync(
      'src/renderer/shell/ResourceActivityDock.tsx',
      'utf8',
    ).replaceAll('\r\n', '\n');

    expect(dock).not.toContain('resource-character-import-fla');
    expect(dock).not.toContain('导入角色');
    expect(dock).toContain('startCharacterImportFromCreate');
    expect(dock).toContain('onStartFlaCharacterImport=');
  });
});
