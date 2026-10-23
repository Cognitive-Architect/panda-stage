const { readFile, mkdir, writeFile } = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { app, ipcMain } = require('electron');
const {
  createMainWindow,
} = require('../dist-electron/main/windows/main-window.js');
const {
  IPC_CHANNELS,
} = require('../dist-electron/shared/ipc/channels.js');
const {
  validatePngThumbnail,
} = require('../dist-electron/main/services/PngThumbnailValidator.js');
const exampleProject = require('../demo-project/project-v1.example.json');
const { migrateProject } = require('../dist-electron/domain/migrations/index.js');

const repositoryRoot = path.join(__dirname, '..');
const branch = process.env.GITHUB_HEAD_REF ||
  process.env.GITHUB_REF_NAME ||
  execFileSync('git', ['branch', '--show-current'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  }).trim();
const evidenceRelativeDirectory =
  `docs/evidence/issue-835-day18/run-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
const evidenceDirectory = path.join(
  repositoryRoot,
  evidenceRelativeDirectory,
);
const projectRoot = 'D:\\项目\\Day 18 素材库 🐼.pandastage';
const referencedAssetId =
  '10000000-0000-4000-8000-000000000002';
const multiReferenceAssetId =
  '18000000-0000-4000-8000-000000000098';
const blockedDeleteStatusMarker = 'Main Process 已阻止删除';
const fixtureAssetId = (index) =>
  `18000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const removableAssetId = fixtureAssetId(1);
const decodeErrorAssetId = fixtureAssetId(2);
const missingThumbnailAssetId = fixtureAssetId(99);
const fixtureAssets = Array.from({ length: 99 }, (_, offset) => {
  const index = offset + 1;
  return {
    id: fixtureAssetId(index),
    kind: 'image',
    name: `背景占位 ${String(index).padStart(3, '0')}`,
    relativePath: `assets/day18-background-${index}.png`,
    mimeType: 'image/png',
    width: 320,
    height: 180,
    sha256: String(index).padStart(64, '0'),
  };
});
let activeVerificationStage = 'boot';
function setVerificationStage(stage) {
  activeVerificationStage = stage;
  console.log(`[Day18] ${stage}`);
}

const migratedLibraryProject = migrateProject({
  ...exampleProject,
  assets: [...exampleProject.assets, ...fixtureAssets],
});
const libraryProject = {
  ...migratedLibraryProject,
  assets: migratedLibraryProject.assets.map((asset) =>
    asset.id === fixtureAssetId(3) && asset.kind === 'image'
      ? { ...asset, usage: 'background' }
      : asset,
  ),
  shots: migratedLibraryProject.shots.map((shot, shotIndex) =>
    shotIndex === 0
      ? {
          ...shot,
          layers: [
            ...shot.layers,
            ...[1, 2].map((number) => ({
              ...shot.layers[0],
              id: `60000000-0000-4000-8000-${String(number + 2).padStart(12, '0')}`,
              name: `Fixture multi reference ${number}`,
              source: { kind: 'asset', assetId: multiReferenceAssetId },
              zIndex: number + 1,
            })),
          ],
        }
      : shot,
  ),
};

app.on('window-all-closed', () => {});

function waitFor(expression, failureMessage) {
  return `
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 10000;
      const poll = () => {
        if (${expression}) return resolve();
        if (Date.now() >= deadline) {
          return reject(new Error(${JSON.stringify(failureMessage)}));
        }
        setTimeout(poll, 25);
      };
      poll();
    })
  `;
}

async function waitForRenderer(window, expression, failureMessage) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const ready = await window.webContents.executeJavaScript(
      `Boolean(${expression})`,
    );
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(failureMessage);
}

const assetPaginationSelector =
  '[data-testid="asset-library-pagination"]';

async function resetAssetBrowserToFirstPage(window) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const pagination = document.querySelector(
        ${JSON.stringify(assetPaginationSelector)},
      );
      const previous = pagination?.querySelector('button:first-of-type');
      const page = Number(pagination?.dataset.page ?? 1);
      if (!previous || previous.disabled) return { moved: false, page };
      previous.click();
      return { moved: true, page };
    })()`);
    if (!state.moved) return;
    const expectedPage = Math.max(1, state.page - 1);
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector(${JSON.stringify(assetPaginationSelector)})?.dataset.page === '${expectedPage}'`,
        `Asset browser did not return to page ${expectedPage}.`,
      ),
    );
  }
  throw new Error('Asset browser pagination did not settle at page one.');
}

async function revealAsset(window, assetId) {
  await resetAssetBrowserToFirstPage(window);
  const seenAssetIds = new Set();
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const card = document.querySelector(
        ${JSON.stringify(`[data-asset-id="${assetId}"]`)},
      );
      const pagination = document.querySelector(
        ${JSON.stringify(assetPaginationSelector)},
      );
      const cards = [...document.querySelectorAll('.asset-card')];
      const page = Number(pagination?.dataset.page ?? 1);
      const totalPages = Number(pagination?.dataset.totalPages ?? 1);
      if (card) {
        return {
          found: true,
          page,
          totalPages,
          assetIds: cards.map((item) => item.dataset.assetId),
        };
      }
      const next = pagination?.querySelector('button:last-of-type');
      if (!next || next.disabled) {
        return {
          found: false,
          exhausted: true,
          page,
          totalPages,
          assetIds: cards.map((item) => item.dataset.assetId),
        };
      }
      next.click();
      return {
        found: false,
        exhausted: false,
        page,
        totalPages,
        assetIds: cards.map((item) => item.dataset.assetId),
      };
    })()`);
    for (const id of state.assetIds ?? []) seenAssetIds.add(id);
    if (state.found) {
      return {
        ...state,
        seenAssetCount: seenAssetIds.size,
      };
    }
    if (state.exhausted) {
      throw new Error(`Asset ${assetId} was not found in the paged browser.`);
    }
    const nextPage = state.page + 1;
    await window.webContents.executeJavaScript(
      waitFor(
        `document.querySelector(${JSON.stringify(assetPaginationSelector)})?.dataset.page === '${nextPage}'`,
        `Asset browser did not advance to page ${nextPage}.`,
      ),
    );
  }
  throw new Error(`Asset ${assetId} pagination exceeded the safety limit.`);
}

async function closeAssetDetails(window) {
  const closed = await window.webContents.executeJavaScript(`(() => {
    const close = document.querySelector('[data-testid="asset-details-close"]');
    const back = document.querySelector('[data-testid="asset-details-back"]');
    const button = close ?? back;
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!closed) {
    const stillOpen = await window.webContents.executeJavaScript(
      "Boolean(document.querySelector('[data-testid=\"asset-details-overlay\"], [data-testid=\"asset-details-dialog\"], [data-testid=\"asset-details-view\"]'))",
    );
    if (stillOpen) {
      throw new Error('Asset details are open without a close or back control.');
    }
    return;
  }
  await window.webContents.executeJavaScript(
    waitFor(
      "document.querySelector('.asset-grid') && !document.querySelector('[data-testid=\"asset-details-overlay\"]') && !document.querySelector('[data-testid=\"asset-details-dialog\"]') && !document.querySelector('[data-testid=\"asset-details-view\"]')",
      'Asset details did not return to the browser.',
    ),
  );
}

async function capturePaintedPage(window) {
  // DOM checks can settle before Chromium paints the inactive verifier window.
  window.show();
  window.focus();
  window.webContents.focus();
  await window.webContents.executeJavaScript(
    'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
  return window.webContents.capturePage();
}

async function verifyDay18() {
  setVerificationStage('setup');
  const png = await readFile(
    path.join(repositoryRoot, 'tests/fixtures/assets/熊猫 图片.png'),
  );
  const thumbnailDataUrl =
    `data:image/png;base64,${png.toString('base64')}`;
  const pngValidation = {
    validCacheAccepted: Boolean(validatePngThumbnail(png)),
    truncatedSignatureBodyRejected:
      validatePngThumbnail(
        Buffer.concat([
          png.subarray(0, 8),
          Buffer.from('truncated cache body'),
        ]),
      ) === null,
    oversizedCacheCoveredBy:
      'tests/unit/asset-thumbnail-service.test.ts',
  };
  const deleteRequests = [];
  let thumbnailRequestCount = 0;
  let nextImportResponseFactory = null;
  let importRequestCount = 0;

  ipcMain.handle(IPC_CHANNELS.PROJECT_OPEN, () => ({
    ok: true,
    value: {
      projectRoot,
      projectFilePath: `${projectRoot}\\project.json`,
      project: libraryProject,
      migrated: true,
      sourceVersion: 1,
    },
  }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_TRACK, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_UPDATE, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.AUTOSAVE_STOP, () => ({ ok: true }));
  ipcMain.handle(IPC_CHANNELS.RECOVERY_DETECT, () => ({
    ok: true,
    candidate: null,
  }));
  ipcMain.handle(IPC_CHANNELS.RECENT_PROJECTS_LIST, () => ({
    ok: true,
    entries: [],
  }));
  ipcMain.handle(
    IPC_CHANNELS.ASSET_THUMBNAIL_READ,
    (_event, request) => {
      thumbnailRequestCount += 1;
      if (request.assetId === referencedAssetId) {
        return {
          ok: false,
          error: {
            code: 'ASSET_THUMBNAIL_SOURCE_MISSING',
            message: '源文件缺失，无法读取或重建缩略图。',
            assetId: request.assetId,
            relativePath: 'assets/day18-missing-source.png',
          },
        };
      }
      if (
        request.assetId === missingThumbnailAssetId ||
        !request.sha256
      ) {
        return {
          ok: true,
          status: 'missing',
          assetId: request.assetId,
        };
      }
      return {
        ok: true,
        status: 'ready',
        assetId: request.assetId,
        dataUrl: thumbnailDataUrl,
      };
    },
  );
  ipcMain.handle(IPC_CHANNELS.ASSET_DELETE, (_event, request) => {
    deleteRequests.push(request);
    if (request.assetId === referencedAssetId) {
      return {
        ok: false,
        error: {
          code: 'ASSET_DELETE_REFERENCED',
          message: 'Main Process 已阻止删除：素材仍被 1 处内容使用。',
          projectRoot,
          assetId: request.assetId,
          references: [
            {
              kind: 'shot-background',
              label: '镜头“Opening”的背景图层“Background”',
              path: 'shots[Opening].layers[Background].source.assetId',
            },
          ],
        },
      };
    }
    return {
      ok: true,
      project: {
        ...request.project,
        assets: request.project.assets.filter(
          (asset) => asset.id !== request.assetId,
        ),
        updatedAt: '2026-07-25T10:00:00.000Z',
      },
      baseRevision: request.baseRevision,
      savedRevision: request.baseRevision + 1,
      deletedAssetId: request.assetId,
      cleanupResidualPaths: [],
    };
  });
  ipcMain.handle(IPC_CHANNELS.ASSET_IMPORT_CHOOSE, (_event, request) => {
    importRequestCount += 1;
    const responseFactory = nextImportResponseFactory;
    nextImportResponseFactory = null;
    return responseFactory
      ? responseFactory(request)
      : { ok: true, status: 'cancelled' };
  });

    setVerificationStage('open asset library');
  const window = await createMainWindow({ show: false });
  try {
    window.setSize(1440, 1000);
    window.setSkipTaskbar(true);
    window.showInactive();
    await waitForRenderer(
      window,
      "document.querySelector('.recovery-open-row input')",
      'StartScreen did not render.',
    );
    const openPathInputResult = await window.webContents.executeJavaScript(`
      (() => {
        try {
          const input = document.querySelector('.recovery-open-row input');
          if (!(input instanceof HTMLInputElement)) {
            return { ok: false, error: 'The project path input disappeared.' };
          }
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            'value'
          ).set;
          setter.call(input, ${JSON.stringify(projectRoot)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return { ok: true };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      })()
    `);
    if (!openPathInputResult.ok) {
      throw new Error(`Could not set the verifier project path: ${openPathInputResult.error}`);
    }
    await waitForRenderer(
      window,
      "document.querySelector('[data-testid=\"open-project-path\"]')?.disabled === false",
      'The verifier project path did not become valid.',
    );
    await window.webContents.executeJavaScript(
      "document.querySelector('[data-testid=\"open-project-path\"]').click()",
    );
    await waitForRenderer(
      window,
      "document.querySelector('[data-testid=\"resource-activity-rail-assets\"], [data-testid=\"resource-activity-tabs\"] [data-activity=\"assets\"]')",
      'Resource activity asset navigation did not render.',
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('[data-testid="resource-activity-rail-assets"], ` +
        `[data-testid="resource-activity-tabs"] [data-activity="assets"]').click()`,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        "[...document.querySelectorAll('.asset-category-tabs button')].some(" +
          "(button) => button.textContent?.includes('未绑定'))",
        'Asset category navigation did not render.',
      ),
    );
    await window.webContents.executeJavaScript(`(() => {
      const backgroundCategory = [...document.querySelectorAll(
        '.asset-category-tabs button'
      )].find((button) => button.textContent?.includes('未绑定'));
      if (!backgroundCategory) {
        throw new Error('Unbound-role asset category did not render.');
      }
      if (backgroundCategory.getAttribute('aria-pressed') !== 'true') {
        backgroundCategory.click();
      }
      return true;
    })()`);
    const categoryLabels = await window.webContents.executeJavaScript(
      `([...document.querySelectorAll('.asset-category-tabs button')])` +
        `.map((button) => button.querySelector('span')?.textContent?.trim() ?? '')`,
    );
    const ensureAssetPanelVisible = async (context) => {
      await window.webContents.executeJavaScript(`(() => {
        const isVisiblyOnscreen = (element) => {
          if (!(element instanceof HTMLElement)) return false;
          const box = element.getBoundingClientRect();
          let ancestor = element;
          while (ancestor instanceof HTMLElement) {
            const style = getComputedStyle(ancestor);
            if (
              style.display === 'none' ||
              style.visibility === 'hidden' ||
              Number(style.opacity) <= 0 ||
              style.pointerEvents === 'none'
            ) return false;
            ancestor = ancestor.parentElement;
          }
          const x = Math.max(0, Math.min(
            document.documentElement.clientWidth - 1,
            box.left + box.width / 2,
          ));
          const y = Math.max(0, Math.min(
            document.documentElement.clientHeight - 1,
            box.top + box.height / 2,
          ));
          const hit = document.elementFromPoint(x, y);
          return Boolean(element.getClientRects().length &&
            box.width > 0 && box.height > 0 &&
            box.right > 0 && box.left < document.documentElement.clientWidth &&
            box.bottom > 0 && box.top < document.documentElement.clientHeight &&
            hit && (element.contains(hit) || hit.contains(element)));
        };
        const portraitAssetsTab = [...document.querySelectorAll(
          '[data-testid="editor-portrait-workspace-switcher"] [role="tab"]',
        )].find((button) => button.textContent?.includes('素材'));
        if (portraitAssetsTab && isVisiblyOnscreen(portraitAssetsTab)) {
          if (portraitAssetsTab.getAttribute('aria-selected') !== 'true') {
            portraitAssetsTab.click();
          }
          return true;
        }
        const assetsActivity = document.querySelector(
          '[data-testid="resource-activity-rail-assets"], ' +
            '[data-testid="resource-activity-tabs"] [data-activity="assets"]',
        );
        if (!(assetsActivity instanceof HTMLButtonElement)) {
          throw new Error('Asset workspace navigation did not render.');
        }
        if (
          !isVisiblyOnscreen(document.querySelector('.asset-library')) ||
          assetsActivity.getAttribute('aria-pressed') !== 'true' ||
          assetsActivity.getAttribute('aria-expanded') === 'false'
        ) {
          assetsActivity.click();
        }
        return true;
      })()`);
      await waitForRenderer(
        window,
        "document.querySelector('[data-testid=\"asset-library-filter-controls\"]') && " +
          "(() => { const library = document.querySelector('.asset-library'); " +
          "const box = library?.getBoundingClientRect(); " +
          "const style = library && getComputedStyle(library); " +
          "return Boolean(library?.getClientRects().length && box && style && " +
          "style.display !== 'none' && style.visibility !== 'hidden' && " +
          "Number(style.opacity) > 0 && box.width > 0 && box.height > 0 && " +
          "box.right > 0 && box.left < document.documentElement.clientWidth && " +
          "box.bottom > 0 && box.top < document.documentElement.clientHeight); })()",
        `The asset library did not become visible in the ${context} viewport.`,
      );
    };
    const usageFilterDefaultAudit = await window.webContents.executeJavaScript(`(async () => {
      const trigger = document.querySelector(
        '[data-testid="asset-library-usage-filter"]',
      );
      trigger.click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      const menu = document.querySelector(
        '[data-testid="asset-library-usage-filter-menu"]',
      );
      const triggerBox = trigger.getBoundingClientRect();
      const menuBox = menu.getBoundingClientRect();
      const selected = menu.querySelector('[aria-checked="true"]');
      const selectedText = selected.querySelector('span:first-child');
      const characterOption = menu.querySelector(
        '[data-usage-filter-value="character"]',
      );
      const hoverBox = characterOption.getBoundingClientRect();
      const checkSlots = [...menu.querySelectorAll(
        '.asset-library-usage-filter-check-slot',
      )].map((slot) => slot.getBoundingClientRect().width);
      return {
        values: [...menu.querySelectorAll('[data-usage-filter-value]')]
          .map((item) => item.dataset.usageFilterValue),
        labels: [...menu.querySelectorAll('[data-usage-filter-value]')]
          .map((item) => item.textContent.trim()),
        triggerRight: triggerBox.right,
        menuRight: menuBox.right,
        menuWidth: menuBox.width,
        selectedColor: getComputedStyle(selected).color,
        selectedBackground: getComputedStyle(selected).backgroundColor,
        selectedBorder: getComputedStyle(selected).borderColor,
        selectedTextAlign: getComputedStyle(selectedText).textAlign,
        checkSlots,
        hoverPoint: {
          x: Math.round(hoverBox.left + hoverBox.width / 2),
          y: Math.round(hoverBox.top + hoverBox.height / 2),
        },
      };
    })()`);
    const usageFilterDefaultScreenshot = await capturePaintedPage(window);
    window.webContents.sendInputEvent({
      type: 'mouseMove',
      x: usageFilterDefaultAudit.hoverPoint.x,
      y: usageFilterDefaultAudit.hoverPoint.y,
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const usageFilterHoverAudit = await window.webContents.executeJavaScript(`(() => {
      const option = document.querySelector(
        '[data-usage-filter-value="character"]',
      );
      return {
        hovered: option.matches(':hover'),
        background: getComputedStyle(option).backgroundColor,
      };
    })()`);
    const usageFilterHoverScreenshot = await capturePaintedPage(window);
    const usageFilterSelectedScreenshotAudit = await window.webContents.executeJavaScript(`(async () => {
      const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const settle = async () => {
        await nextFrame();
        await nextFrame();
      };
      const trigger = document.querySelector(
        '[data-testid="asset-library-usage-filter"]',
      );
      document.querySelector('[data-usage-filter-value="all"]').click();
      await settle();
      document.querySelectorAll('.asset-category-tabs button')[2].click();
      await settle();
      trigger.click();
      await settle();
      document.querySelector('[data-usage-filter-value="background"]').click();
      await settle();
      trigger.click();
      await settle();
      const selected = document.querySelector(
        '[data-usage-filter-value="background"]',
      );
      const menu = document.querySelector(
        '[data-testid="asset-library-usage-filter-menu"]',
      );
      return {
        assetLibraryVisible: Boolean(
          document.querySelector('.asset-library')?.getClientRects().length,
        ),
        menuVisible: Boolean(menu?.getClientRects().length),
        backgroundSelected: selected?.getAttribute('aria-checked') === 'true',
        menuWidth: menu?.getBoundingClientRect().width,
      };
    })()`);
    if (
      !usageFilterSelectedScreenshotAudit.assetLibraryVisible ||
      !usageFilterSelectedScreenshotAudit.menuVisible ||
      !usageFilterSelectedScreenshotAudit.backgroundSelected
    ) {
      throw new Error(
        `Selected usage-filter screenshot state did not render: ${JSON.stringify(usageFilterSelectedScreenshotAudit)}`,
      );
    }
    const usageFilterSelectedScreenshot = await capturePaintedPage(window);
    await window.webContents.executeJavaScript(`(async () => {
      const settle = () => new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      document.querySelector('[data-usage-filter-value="all"]').click();
      await settle();
      document.querySelector(
        '[data-testid="asset-library-usage-filter"]',
      ).click();
      await settle();
    })()`);
    const filterAudit = await window.webContents.executeJavaScript(`(async () => {
      const heading = document.querySelector('#asset-library-heading');
      const headingBox = heading?.closest('.asset-library-heading')
        ?.getBoundingClientRect();
      const activityHeading = document.querySelector(
        '#resource-activity-heading',
      );
      const activityHeadingVisible = Boolean(
        activityHeading?.getClientRects().length &&
        getComputedStyle(activityHeading).visibility !== 'hidden',
      );
      const search = document.querySelector('#asset-library-search-input');
      const trigger = document.querySelector(
        '[data-testid="asset-library-usage-filter"]',
      );
      if (!(search instanceof HTMLInputElement) ||
          !(trigger instanceof HTMLButtonElement)) {
        return {
          failure: 'The asset search field or usage filter trigger is missing.',
          searchFound: Boolean(search),
          triggerFound: Boolean(trigger),
        };
      }
      const searchBox = search?.getBoundingClientRect();
      const triggerBox = trigger?.getBoundingClientRect();
      const dragHintVisible = [...document.querySelectorAll('.asset-import-drop')]
        .some((element) => element.getClientRects().length > 0);

      const menu = document.querySelector(
        '[data-testid="asset-library-usage-filter-menu"]',
      );
      if (!(menu instanceof HTMLElement)) {
        return { failure: 'The usage filter menu did not open.' };
      }
      const menuValues = [...menu.querySelectorAll('[data-usage-filter-value]')]
        .map((item) => item.dataset.usageFilterValue);
      const selectedMenuItem = menu.querySelector(
        '[data-usage-filter-value="all"]',
      );
      selectedMenuItem?.focus();
      const firstFocus = document.activeElement?.dataset.usageFilterValue;
      const focusOutline = getComputedStyle(selectedMenuItem).outlineWidth;
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', bubbles: true,
      }));
      const arrowFocus = document.activeElement?.dataset.usageFilterValue;
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', bubbles: true,
      }));
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const escapeReturnedFocus = document.activeElement === trigger;

      trigger.click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      document.querySelector(
        '[data-usage-filter-value="uncategorized"]',
      ).click();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value',
      ).set;
      setter.call(search, '背景占位 001');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      const combinedSearchAndUsage =
        document.querySelectorAll('.asset-card').length === 1 &&
        document.querySelector('.asset-card')?.dataset.assetId ===
          '${fixtureAssetId(1)}';

      setter.call(search, '');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      const audio = [...document.querySelectorAll('.asset-category-tabs button')]
        .find((button) => button.textContent?.includes('音频'));
      audio.click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      const audioClearedUsage = trigger.dataset.active === 'false' &&
        trigger.getAttribute('aria-pressed') === 'false' &&
        trigger.disabled;
      const audioCardCount = document.querySelectorAll('.asset-card').length;
      trigger.click();
      const audioFilterStayedClosed = !document.querySelector(
        '[data-testid="asset-library-usage-filter-menu"]',
      );

      const unbound = [...document.querySelectorAll('.asset-category-tabs button')]
        .find((button) => button.textContent?.includes('未绑定'));
      unbound.click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      const unboundAllCount = document.querySelectorAll('.asset-card').length;
      trigger.click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      document.querySelector('[data-usage-filter-value="background"]').click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      const backgroundUsage =
        document.querySelectorAll('.asset-card').length === 1 &&
        document.querySelector('.asset-card')?.dataset.assetId ===
          '${fixtureAssetId(3)}';
      trigger.click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      const selectedBackgroundMenuItem = document.querySelector(
        '[data-usage-filter-value="background"]',
      );
      const currentMenu = document.querySelector(
        '[data-testid="asset-library-usage-filter-menu"]',
      );
      const selectedBackgroundMenu =
        selectedBackgroundMenuItem?.getAttribute('aria-checked') === 'true' &&
        Boolean(selectedBackgroundMenuItem?.querySelector(
          '.asset-library-usage-filter-check-slot svg',
        ));

      return {
        assetLibraryVisible: Boolean(
          document.querySelector('.asset-library')?.getClientRects().length,
        ),
        selectedMenuVisible: Boolean(currentMenu?.getClientRects().length),
        headingVisuallyHidden: Boolean(headingBox &&
          headingBox.width <= 1 && headingBox.height <= 1),
        assetWorkspaceHeadingHidden: !activityHeadingVisible,
        filterControlsAligned: Boolean(searchBox && triggerBox &&
          Math.abs(searchBox.top - triggerBox.top) <= 2),
        filterTriggerTouchTarget: Boolean(triggerBox &&
          triggerBox.width >= 44 && triggerBox.height >= 44),
        dragHintVisible,
        menuValues,
        menuLabels: [...menu.querySelectorAll('[data-usage-filter-value]')]
          .map((item) => item.textContent.trim()),
        menuRightAligned: Math.abs(
          currentMenu.getBoundingClientRect().right -
            trigger.getBoundingClientRect().right,
        ) <= 1,
        menuCompact: currentMenu.getBoundingClientRect().width < 240,
        selectedBackgroundContrast:
          getComputedStyle(selectedBackgroundMenuItem).color ===
            'rgb(238, 246, 240)' &&
          getComputedStyle(selectedBackgroundMenuItem).borderColor !==
            'rgba(0, 0, 0, 0)',
        firstFocus,
        arrowFocus,
        focusOutline,
        escapeReturnedFocus,
        combinedSearchAndUsage,
        audioClearedUsage,
        audioCardCount,
        audioFilterStayedClosed,
        backgroundUsage,
        unboundAllCount,
        selectedBackgroundMenu,
      };
    })()`);
    const filterRestoreAudit = await window.webContents.executeJavaScript(`(async () => {
      document.querySelector('[data-usage-filter-value="all"]').click();
      await new Promise((resolve) => requestAnimationFrame(
        () => requestAnimationFrame(resolve),
      ));
      return {
        active: document.querySelector(
          '[data-testid="asset-library-usage-filter"]',
        ).getAttribute('aria-pressed'),
        cardCount: document.querySelectorAll('.asset-card').length,
        firstAssetRestored: Boolean(document.querySelector(
          '[data-asset-id="${fixtureAssetId(1)}"]',
        )),
        menuClosed: !document.querySelector(
          '[data-testid="asset-library-usage-filter-menu"]',
        ),
      };
    })()`);
    filterAudit.menuRightAligned = usageFilterDefaultAudit.menuRight ===
      usageFilterDefaultAudit.triggerRight ||
      Math.abs(usageFilterDefaultAudit.menuRight -
        usageFilterDefaultAudit.triggerRight) <= 1;
    filterAudit.menuCompact = usageFilterDefaultAudit.menuWidth < 240;
    filterAudit.labelsUpdated =
      usageFilterDefaultAudit.labels.includes('全部') &&
      usageFilterDefaultAudit.labels.includes('人物') &&
      !usageFilterDefaultAudit.labels.includes('全部用途') &&
      !usageFilterDefaultAudit.labels.includes('人物图片');
    filterAudit.selectedContrast =
      usageFilterDefaultAudit.selectedColor === 'rgb(238, 246, 240)' &&
      usageFilterDefaultAudit.selectedBorder !== 'rgba(0, 0, 0, 0)';
    filterAudit.selectedScreenshotUiReady =
      usageFilterSelectedScreenshotAudit.assetLibraryVisible &&
      usageFilterSelectedScreenshotAudit.menuVisible &&
      usageFilterSelectedScreenshotAudit.backgroundSelected &&
      usageFilterSelectedScreenshotAudit.menuWidth < 240;
    filterAudit.rightAlignedText =
      usageFilterDefaultAudit.selectedTextAlign === 'right';
    filterAudit.stableCheckGap =
      usageFilterDefaultAudit.checkSlots.every((width) => width === 17);
    filterAudit.hoverVisible = usageFilterHoverAudit.hovered &&
      usageFilterHoverAudit.background !== 'rgba(0, 0, 0, 0)';
    filterAudit.backgroundRestoredAll =
      filterRestoreAudit.active === 'false' &&
      filterRestoreAudit.cardCount === filterAudit.unboundAllCount &&
      filterRestoreAudit.firstAssetRestored &&
      filterRestoreAudit.menuClosed;
    const responsiveAudit = {};
    const responsiveScreenshots = {};
    for (const viewport of [
      {
        name: 'narrow', width: 820, height: 620,
        expectedOrientation: 'landscape',
      },
      {
        name: 'touchPortrait', width: 820, height: 900,
        expectedOrientation: 'portrait',
      },
      {
        name: 'touchLandscape', width: 820, height: 620,
        expectedOrientation: 'landscape',
      },
    ]) {
      window.setSize(viewport.width, viewport.height);
      await waitForRenderer(
        window,
        `document.documentElement.clientWidth >= ${viewport.width - 40} && ` +
          `document.documentElement.clientHeight >= ${viewport.height - 80} && ` +
          `(document.documentElement.clientHeight > document.documentElement.clientWidth) === ${JSON.stringify(viewport.expectedOrientation === 'portrait')}`,
        `The ${viewport.name} verifier viewport did not resize.`,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      await ensureAssetPanelVisible(viewport.name);
      const layoutAudit = await window.webContents.executeJavaScript(`(() => {
          const library = document.querySelector(
            '[data-testid="asset-library"]',
          );
          const controls = document.querySelector(
            '[data-testid="asset-library-filter-controls"]',
          );
          const search = document.querySelector(
            '#asset-library-search-input',
          );
          const trigger = document.querySelector(
            '[data-testid="asset-library-usage-filter"]',
          );
          const libraryBox = library?.getBoundingClientRect();
          const controlsBox = controls?.getBoundingClientRect();
          const searchBox = search?.getBoundingClientRect();
          const triggerBox = trigger?.getBoundingClientRect();
          const visiblyOnscreen = (element, box) => {
            if (!(element instanceof HTMLElement) || !box) return false;
            let ancestor = element;
            while (ancestor instanceof HTMLElement) {
              const style = getComputedStyle(ancestor);
              if (
                style.display === 'none' ||
                style.visibility === 'hidden' ||
                Number(style.opacity) <= 0 ||
                style.pointerEvents === 'none'
              ) return false;
              ancestor = ancestor.parentElement;
            }
            const x = Math.max(0, Math.min(
              document.documentElement.clientWidth - 1,
              box.left + box.width / 2,
            ));
            const y = Math.max(0, Math.min(
              document.documentElement.clientHeight - 1,
              box.top + box.height / 2,
            ));
            const hit = document.elementFromPoint(x, y);
            return Boolean(element.getClientRects().length &&
              box.width > 0 && box.height > 0 &&
              box.right > 0 && box.left < document.documentElement.clientWidth &&
              box.bottom > 0 && box.top < document.documentElement.clientHeight &&
              hit && (element.contains(hit) || hit.contains(element)));
          };
          return {
            viewportWidth: document.documentElement.clientWidth,
            viewportHeight: document.documentElement.clientHeight,
            orientation: document.documentElement.clientHeight >
              document.documentElement.clientWidth ? 'portrait' : 'landscape',
            libraryFound: Boolean(library),
            libraryVisible: visiblyOnscreen(library, libraryBox),
            controlsFound: Boolean(controls),
            controlsVisible: visiblyOnscreen(controls, controlsBox),
            searchFound: Boolean(search),
            triggerFound: Boolean(trigger),
            triggerVisible: visiblyOnscreen(trigger, triggerBox),
            controlsWithinLibrary: Boolean(libraryBox && controlsBox &&
              controlsBox.left >= libraryBox.left - 1 &&
              controlsBox.right <= libraryBox.right + 1 &&
              controls.scrollWidth <= controls.clientWidth + 1),
            controlsAligned: Boolean(searchBox && triggerBox &&
              Math.abs(searchBox.top - triggerBox.top) <= 2),
            searchVisible: visiblyOnscreen(search, searchBox),
            triggerTouchTarget: Boolean(triggerBox &&
              triggerBox.width >= 44 && triggerBox.height >= 44),
          };
        })()`);
      responsiveAudit[viewport.name] = {
        ...layoutAudit,
        expectedOrientation: viewport.expectedOrientation,
      };
      responsiveScreenshots[viewport.name] = await capturePaintedPage(window);
    }
    window.setSize(1440, 1000);
    await waitForRenderer(
      window,
      'document.documentElement.clientWidth > 1000 && ' +
        'document.documentElement.clientHeight > 800',
      'The Day18 verifier window did not return to its standard size.',
    );
    await ensureAssetPanelVisible('standard');
    await window.webContents.executeJavaScript(`(() => {
      const unbound = [...document.querySelectorAll(
        '.asset-category-tabs button',
      )].find((button) => button.textContent?.includes('未绑定'));
      if (!unbound) throw new Error('Unbound asset category did not render.');
      if (unbound.getAttribute('aria-pressed') !== 'true') unbound.click();
    })()`);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.asset-grid') && " +
          "document.querySelectorAll('.asset-card').length === 8 && " +
          "document.querySelectorAll('.asset-card img').length === 8 && " +
          "document.querySelector(" +
          "'[data-testid=\\\"asset-library-pagination\\\"]'" +
          ")?.dataset.totalPages === '13'",
        'The first page of the 100-item thumbnail browser did not become ready.',
      ),
    );
    const initialPageScan = await revealAsset(
      window,
      missingThumbnailAssetId,
    );
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-asset-id=\"" +
          missingThumbnailAssetId +
          "\"] [data-thumbnail-status=\"missing\"]')",
        'The missing thumbnail page did not become ready.',
      ),
    );
    await resetAssetBrowserToFirstPage(window);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelectorAll('.asset-card').length === 8 && " +
          "document.querySelectorAll('.asset-card img').length === 8",
        'The first asset browser page did not restore after the scan.',
      ),
    );
    await window.webContents.executeJavaScript(`
      document.querySelector('.asset-library').scrollIntoView({
        block: 'start'
      });
      document.fonts.ready.then(
        () => new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
      )
    `);
    const gridScreenshot = await window.webContents.capturePage();
    await revealAsset(window, decodeErrorAssetId);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-asset-id=\"" +
          decodeErrorAssetId +
          "\"] img')",
        'The decode fallback asset did not become ready.',
      ),
    );

    const selectionBefore =
      await window.webContents.executeJavaScript(`(() => {
        const card = document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"]'
        );
        if (!card) throw new Error('Decode fallback card did not render.');
        card.click();
        return {
          imageCount: document.querySelectorAll('.asset-grid img').length,
        };
      })()`);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\"asset-details-view\"], " +
          "[data-testid=\"asset-details-overlay\"]')",
        'Selecting an asset did not open its details view.',
      ),
    );
    await closeAssetDetails(window);
    const decodeFallbackBefore =
      await window.webContents.executeJavaScript(`(() => {
        const card = document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"]'
        );
        const image = card?.querySelector('img');
        if (!card || !image) {
          throw new Error('Returning from asset details did not restore the image.');
        }
        image.dispatchEvent(new Event('error'));
        return {
          imageCount: ${JSON.stringify(selectionBefore.imageCount)},
        };
      })()`);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-asset-id=\"" +
          decodeErrorAssetId +
          "\"] [data-thumbnail-status=\"missing\"]') && " +
          "document.querySelector('[data-asset-id=\"" +
          decodeErrorAssetId +
          "\"] button')",
        'Browser decode failure did not fall back to rebuildable missing.',
      ),
    );
    const decodeFallback = await window.webContents.executeJavaScript(
      `(() => ({
        failedCardMissing: Boolean(document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"] ' +
          '[data-thumbnail-status="missing"]'
        )),
        failedCardHasRebuild: Boolean(document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"] button'
        )),
        failedCardStillSelected: document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"]'
        )?.classList.contains('asset-card-selected'),
        failedCardHasImage: Boolean(document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"] img'
        )),
        healthyCardStillHasImage: Boolean(document.querySelector(
          '[data-asset-id="${fixtureAssetId(3)}"] img'
        )),
        imageCountBefore: ${JSON.stringify(
          decodeFallbackBefore.imageCount,
        )},
        imageCountAfter: document.querySelectorAll(
          '.asset-grid img'
        ).length
      }))()`,
    );
    await window.webContents.executeJavaScript(`
      (() => {
        document.querySelector(
          '[data-asset-id="${decodeErrorAssetId}"]'
        ).scrollIntoView({ block: 'center' });
        return document.fonts.ready.then(
          () => new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
        );
      })()
    `);
    const decodeFallbackScreenshot =
      await window.webContents.capturePage();

    const performanceObservation =
      await window.webContents.executeJavaScript(`(async () => {
        const grid = document.querySelector('.asset-grid');
        const cards = [...grid.querySelectorAll('.asset-card')];
        const pagination = document.querySelector(
          '[data-testid="asset-library-pagination"]',
        );
        const scrollSurface =
          document.querySelector('.resource-activity-body') || grid;
        const startedAt = performance.now();
        scrollSurface.scrollTop = scrollSurface.scrollHeight;
        const scrollTop = scrollSurface.scrollTop;
        const scrollHeight = scrollSurface.scrollHeight;
        const clientHeight = scrollSurface.clientHeight;
        cards.at(-1).click();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        return {
          elapsedMs: performance.now() - startedAt,
          itemCount: ${JSON.stringify(initialPageScan.seenAssetCount)},
          pageCount: Number(pagination?.dataset.totalPages ?? 1),
          pageSize: cards.length,
          selectedName: document.querySelector(
            '[data-testid="asset-author-name"] input',
          )?.value?.trim(),
          scrollTop,
          scrollHeight,
          clientHeight
        };
      })()`);

    await closeAssetDetails(window);
    await revealAsset(window, removableAssetId);
    const dragEvidence = await window.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector(
          '[data-asset-id="${removableAssetId}"]'
        );
        card.scrollIntoView({ block: 'center' });
        const transfer = new DataTransfer();
        card.dispatchEvent(new DragEvent('dragstart', {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer
        }));
        document.querySelector('.asset-library').dispatchEvent(
          new DragEvent('dragover', {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer
          })
        );
        const raw = transfer.getData(
          'application/x-panda-stage-asset'
        );
        return {
          payload: JSON.parse(raw),
          types: [...transfer.types],
          rawContainsPath: raw.includes('assets/'),
          rawContainsAssetObject: raw.includes('relativePath')
        };
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.asset-library')" +
          ".classList.contains('asset-library-drag-over')",
        'Drag-over feedback did not render.',
      ),
    );
    const dragScreenshot = await window.webContents.capturePage();
    await window.webContents.executeJavaScript(`
      document.querySelector(
        '[data-asset-id="${removableAssetId}"]'
      ).dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    `);

    setVerificationStage('Undo/Redo T1-T3');
    const historyReconciliation = await (async () => {
      await revealAsset(window, fixtureAssetId(3));
      await window.webContents.executeJavaScript(`
        document.querySelector('[data-asset-id="${fixtureAssetId(3)}"]').click()
      `);
      await window.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\\\"asset-author-metadata-form\\\"]')",
          'The image metadata form did not render for history verification.',
        ),
      );
      const before = await window.webContents.executeJavaScript(
        "document.querySelector('[data-testid=\\\"asset-author-name\\\"] input').value",
      );
      const edited = `${before} - Day18 history synchronization`;
      await window.webContents.executeJavaScript(`
        (() => {
          const input = document.querySelector(
            '[data-testid="asset-author-name"] input',
          );
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value',
          ).set;
          setter.call(input, ${JSON.stringify(edited)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('.asset-metadata-save').click();
        })()
      `);
      await window.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\\\"history-controls\\\"]')?.dataset.undoCount !== '0'",
          'Saving image metadata did not create an undo entry.',
        ),
      );
      await window.webContents.executeJavaScript(`
        document.querySelector('[data-testid="history-controls"] button[aria-label="撤销"]').click();
        new Promise((resolve) => requestAnimationFrame(
          () => requestAnimationFrame(resolve),
        ));
      `);
      await window.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\\\"history-controls\\\"]')?.dataset.redoCount !== '0'",
          'Undo did not expose the redo action.',
        ),
      );
      const afterUndo = await window.webContents.executeJavaScript(
        "document.querySelector('[data-testid=\\\"asset-author-name\\\"] input')?.value ?? null",
      );
      if (afterUndo === null) {
        throw new Error('History undo closed the selected asset details.');
      }
      await window.webContents.executeJavaScript(`
        document.querySelector('[data-testid="history-controls"] button[aria-label="重做"]').click();
        new Promise((resolve) => requestAnimationFrame(
          () => requestAnimationFrame(resolve),
        ));
      `);
      await window.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\\\"history-controls\\\"]')?.dataset.undoCount !== '0'",
          'Redo did not restore the undo action.',
        ),
      );
      const afterRedo = await window.webContents.executeJavaScript(
        "document.querySelector('[data-testid=\\\"asset-author-name\\\"] input').value",
      );
      const dirtyDraft = 'Unsaved draft preserved during undo';
      await window.webContents.executeJavaScript(`
        (() => {
          const input = document.querySelector(
            '[data-testid="asset-author-name"] input',
          );
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value',
          ).set;
          setter.call(input, ${JSON.stringify(dirtyDraft)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('[data-testid="history-controls"] button[aria-label="撤销"]').click();
          return new Promise((resolve) => requestAnimationFrame(
            () => requestAnimationFrame(resolve),
          ));
        })()
      `);
      await window.webContents.executeJavaScript(
        waitFor(
          "document.querySelector('[data-testid=\\\"history-controls\\\"]')?.dataset.redoCount !== '0'",
          'The second undo did not expose the redo action.',
        ),
      );
      const afterDirtyUndo = await window.webContents.executeJavaScript(`(() => ({
        name: document.querySelector(
          '[data-testid="asset-author-name"] input',
        )?.value,
        conflictVisible: Boolean(document.querySelector(
          '[data-testid="asset-metadata-conflict"]',
        )),
      }))()`);

      const readProjectInteractionState = async () =>
        window.webContents.executeJavaScript(`(() => {
          const history = document.querySelector(
            '[data-testid="history-controls"]',
          );
          const canvas = document.querySelector(
            '[data-testid="project-canvas-stage"]',
          );
          const quickActions = document.querySelector(
            '[data-testid="quick-action-drawer"]',
          );
          return {
            revision: Number(canvas?.dataset.projectRevision ?? NaN),
            undoCount: Number(history?.dataset.undoCount ?? NaN),
            redoCount: Number(history?.dataset.redoCount ?? NaN),
            dirty: quickActions?.dataset.saveState === 'dirty',
          };
        })()`);
      const sameProjectInteractionState = (left, right) =>
        left.revision === right.revision &&
        left.undoCount === right.undoCount &&
        left.redoCount === right.redoCount &&
        left.dirty === right.dirty;
      const readDetailsIdentity = async () =>
        window.webContents.executeJavaScript(`(() => ({
          assetId: document.querySelector(
            '[data-testid="asset-details-overlay"]',
          )?.dataset.selectedAssetId ?? null,
          name: document.querySelector(
            '[data-testid="asset-author-name"] input',
          )?.value ?? null,
        }))()`);
      const setMetadataDraft = async (value) =>
        window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector(
            '[data-testid="asset-author-name"] input',
          );
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value',
          ).set;
          setter.call(input, ${JSON.stringify(value)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          return new Promise((resolve) => requestAnimationFrame(
            () => requestAnimationFrame(resolve),
          ));
        })()`);
      const pressEscape = async (confirmDiscard) =>
        window.webContents.executeJavaScript(`(() => {
          window.confirm = () => ${JSON.stringify(confirmDiscard)};
          document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape', bubbles: true,
          }));
          return new Promise((resolve) => requestAnimationFrame(
            () => requestAnimationFrame(resolve),
          ));
        })()`);
      const openAssetDetails = async (assetId, expectedName) => {
        const selector = `[data-asset-id="${assetId}"]`;
        await window.webContents.executeJavaScript(
          `document.querySelector(${JSON.stringify(selector)})?.click()`,
        );
        await window.webContents.executeJavaScript(
          waitFor(
            `document.querySelector('[data-testid="asset-details-overlay"]')?.dataset.selectedAssetId === ${JSON.stringify(assetId)} && ` +
              `document.querySelector('[data-testid="asset-author-name"] input')?.value === ${JSON.stringify(expectedName)}`,
            `Asset ${assetId} did not open with its saved metadata.`,
          ),
        );
      };

      const projectStateBeforeT3 = await readProjectInteractionState();
      await pressEscape(false);
      const afterCancelledEscape = await readDetailsIdentity();
      const projectStateAfterCancelledEscape =
        await readProjectInteractionState();
      const escapeCancelKeepsDraft =
        afterCancelledEscape.assetId === fixtureAssetId(3) &&
        afterCancelledEscape.name === dirtyDraft &&
        sameProjectInteractionState(
          projectStateBeforeT3,
          projectStateAfterCancelledEscape,
        );

      const switchedAssetId = fixtureAssetId(4);
      const switchedAssetSelector = `[data-asset-id="${switchedAssetId}"]`;
      const switchedAssetName = await window.webContents.executeJavaScript(
        `document.querySelector(${JSON.stringify(switchedAssetSelector)})` +
          `?.querySelector('.asset-card-name')?.textContent?.trim() ?? null`,
      );
      await window.webContents.executeJavaScript(`(() => {
        window.confirm = () => false;
        document.querySelector(${JSON.stringify(switchedAssetSelector)})?.click();
        return new Promise((resolve) => requestAnimationFrame(
          () => requestAnimationFrame(resolve),
        ));
      })()`);
      const afterCancelledAssetSwitch = await readDetailsIdentity();
      const projectStateAfterCancelledAssetSwitch =
        await readProjectInteractionState();
      const assetSwitchCancelKeepsDraft =
        afterCancelledAssetSwitch.assetId === fixtureAssetId(3) &&
        afterCancelledAssetSwitch.name === dirtyDraft &&
        sameProjectInteractionState(
          projectStateBeforeT3,
          projectStateAfterCancelledAssetSwitch,
        );

      await window.webContents.executeJavaScript(`(() => {
        window.confirm = () => true;
        document.querySelector(${JSON.stringify(switchedAssetSelector)})?.click();
      })()`);
      await window.webContents.executeJavaScript(
        waitFor(
          `document.querySelector('[data-testid="asset-details-overlay"]')?.dataset.selectedAssetId === ${JSON.stringify(switchedAssetId)} && ` +
            `document.querySelector('[data-testid="asset-author-name"] input')?.value === ${JSON.stringify(switchedAssetName)}`,
          'Switching assets did not load the new asset identity and metadata.',
        ),
      );
      const afterConfirmedAssetSwitch = await readDetailsIdentity();
      const projectStateAfterConfirmedAssetSwitch =
        await readProjectInteractionState();

      const cancelledDraft = 'Cancelled asset metadata draft';
      await setMetadataDraft(cancelledDraft);
      await window.webContents.executeJavaScript(
        "document.querySelector('.asset-metadata-cancel')?.click()",
      );
      await window.webContents.executeJavaScript(
        waitFor(
          '!document.querySelector(\'[data-testid="asset-details-overlay"]\')',
          'Cancel did not close the asset details editor.',
        ),
      );
      const projectStateAfterCancel = await readProjectInteractionState();
      const cardAfterCancel = await window.webContents.executeJavaScript(
        `(() => ({
          selectedAssetId: document.querySelector('.asset-card-selected')?.dataset.assetId ?? null,
          name: document.querySelector(${JSON.stringify(switchedAssetSelector)})` +
          `?.querySelector('.asset-card-name')?.textContent?.trim() ?? null,
        }))()`,
      );
      const cancelPreservesProjectState = sameProjectInteractionState(
        projectStateAfterConfirmedAssetSwitch,
        projectStateAfterCancel,
      );

      await openAssetDetails(switchedAssetId, switchedAssetName);
      const projectStateBeforeNoOpSave = await readProjectInteractionState();
      await window.webContents.executeJavaScript(
        "document.querySelector('.asset-metadata-save')?.click()",
      );
      await window.webContents.executeJavaScript(`new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
      const afterNoOpSave = await readDetailsIdentity();
      const projectStateAfterNoOpSave = await readProjectInteractionState();
      const noOpSavePreservesProjectState =
        sameProjectInteractionState(
          projectStateBeforeNoOpSave,
          projectStateAfterNoOpSave,
        ) && afterNoOpSave.assetId === switchedAssetId &&
        afterNoOpSave.name === switchedAssetName;

      await closeAssetDetails(window);
      await openAssetDetails(switchedAssetId, switchedAssetName);
      const afterDetailReopen = await readDetailsIdentity();
      const projectStateAfterDetailReopen =
        await readProjectInteractionState();
      const detailReopenPreservesSavedMetadata =
        afterDetailReopen.assetId === switchedAssetId &&
        afterDetailReopen.name === switchedAssetName &&
        sameProjectInteractionState(
          projectStateAfterNoOpSave,
          projectStateAfterDetailReopen,
        );

      const escapeDraft = 'Escape discard draft';
      await setMetadataDraft(escapeDraft);
      await pressEscape(false);
      const afterEscapeDeclined = await readDetailsIdentity();
      const projectStateAfterEscapeDeclined =
        await readProjectInteractionState();
      const escapeDeclineKeepsDraft =
        afterEscapeDeclined.assetId === switchedAssetId &&
        afterEscapeDeclined.name === escapeDraft &&
        sameProjectInteractionState(
          projectStateAfterDetailReopen,
          projectStateAfterEscapeDeclined,
        );
      await pressEscape(true);
      await window.webContents.executeJavaScript(
        waitFor(
          '!document.querySelector(\'[data-testid="asset-details-overlay"]\')',
          'Confirmed Escape did not close asset details.',
        ),
      );
      const projectStateAfterEscapeConfirmed =
        await readProjectInteractionState();
      await openAssetDetails(switchedAssetId, switchedAssetName);
      const afterEscapeReopen = await readDetailsIdentity();
      const escapeConfirmedDiscardsDraft =
        afterEscapeReopen.assetId === switchedAssetId &&
        afterEscapeReopen.name === switchedAssetName &&
        sameProjectInteractionState(
          projectStateAfterDetailReopen,
          projectStateAfterEscapeConfirmed,
        );

      const closeDraft = 'Close button discard draft';
      await setMetadataDraft(closeDraft);
      await window.webContents.executeJavaScript(`(() => {
        window.confirm = () => false;
        document.querySelector('[data-testid="asset-details-close"]')?.click();
        return new Promise((resolve) => requestAnimationFrame(
          () => requestAnimationFrame(resolve),
        ));
      })()`);
      const afterCloseDeclined = await readDetailsIdentity();
      const projectStateAfterCloseDeclined =
        await readProjectInteractionState();
      const closeDeclineKeepsDraft =
        afterCloseDeclined.assetId === switchedAssetId &&
        afterCloseDeclined.name === closeDraft &&
        sameProjectInteractionState(
          projectStateAfterDetailReopen,
          projectStateAfterCloseDeclined,
        );
      await window.webContents.executeJavaScript(`(() => {
        window.confirm = () => true;
        document.querySelector('[data-testid="asset-details-close"]')?.click();
      })()`);
      await window.webContents.executeJavaScript(
        waitFor(
          '!document.querySelector(\'[data-testid="asset-details-overlay"]\')',
          'Confirmed close did not close asset details.',
        ),
      );
      const projectStateAfterCloseConfirmed =
        await readProjectInteractionState();
      await openAssetDetails(switchedAssetId, switchedAssetName);
      const afterCloseReopen = await readDetailsIdentity();
      const closeConfirmedDiscardsDraft =
        afterCloseReopen.assetId === switchedAssetId &&
        afterCloseReopen.name === switchedAssetName &&
        sameProjectInteractionState(
          projectStateAfterDetailReopen,
          projectStateAfterCloseConfirmed,
        );

      await window.webContents.executeJavaScript(
        "(() => { window.confirm = () => true; })()",
      );
      await closeAssetDetails(window);
      const t3 = {
        escapeCancelKeepsDraft,
        assetSwitchCancelKeepsDraft,
        confirmedAssetSwitchLoadsCorrectIdentity:
          afterConfirmedAssetSwitch.assetId === switchedAssetId &&
          afterConfirmedAssetSwitch.name === switchedAssetName &&
          sameProjectInteractionState(
            projectStateBeforeT3,
            projectStateAfterConfirmedAssetSwitch,
          ),
        cancelPreservesProjectState,
        cancelReturnsSavedCardIdentity:
          cardAfterCancel.selectedAssetId === switchedAssetId &&
          cardAfterCancel.name === switchedAssetName,
        noOpSavePreservesProjectState,
        detailReopenPreservesSavedMetadata,
        escapeDeclineKeepsDraft,
        escapeConfirmedDiscardsDraft,
        closeDeclineKeepsDraft,
        closeConfirmedDiscardsDraft,
      };
      return {
        before,
        edited,
        afterUndo,
        afterRedo,
        dirtyDraft,
        afterDirtyUndoName: afterDirtyUndo.name,
        conflictVisible: afterDirtyUndo.conflictVisible,
        t3,
      };
    })();

    setVerificationStage('referenced asset delete protection');
    await revealAsset(window, referencedAssetId);
    setVerificationStage('referenced asset card click');
    await window.webContents.executeJavaScript(`
      (() => {
        window.confirm = () => true;
        const card = document.querySelector(
          '[data-asset-id="${referencedAssetId}"]'
        );
        card.scrollIntoView({ block: 'center' });
        card.click();
      })()
    `);
    setVerificationStage('wait for referenced asset details');
    await waitForRenderer(
      window,
      `document.querySelector('[data-testid="asset-details-overlay"]')?.dataset.selectedAssetId === ${JSON.stringify(referencedAssetId)} && ` +
        "document.querySelector('[data-testid=\"asset-details-dialog\"]')?.getClientRects().length > 0",
      'The referenced asset details dialog did not render for the referenced asset.',
    );
    const referenceCollapsedUi = await window.webContents.executeJavaScript(`(() => {
      const summaryCopy = document.querySelector('.asset-details-summary-copy');
      const disclosure = summaryCopy?.querySelector('.asset-details-disclosure');
      const summary = disclosure?.querySelector('summary');
      return {
        label: summaryCopy?.querySelector('span')?.textContent?.trim() ?? null,
        dimensions: summaryCopy?.querySelectorAll(':scope > span')[1]
          ?.textContent?.trim() ?? null,
        disclosureUnderSize: Boolean(
          summaryCopy?.querySelectorAll(':scope > span')[1]
            ?.nextElementSibling === disclosure,
        ),
        expanded: summary?.getAttribute('aria-expanded') ?? null,
        sourceWarning: Boolean(
          document.querySelector('.asset-details-source-error')?.getClientRects().length,
        ),
        technicalDetailsVisible: Boolean(
          document.querySelector('.asset-details-technical-list, [data-testid="asset-fla-snapshot-origin"]'),
        ),
      };
    })()`);
    const referenceCollapsedScreenshot = await capturePaintedPage(window);
    setVerificationStage('expand human-readable asset references by keyboard');
    await window.webContents.executeJavaScript(`
      (() => {
        const summary = document.querySelector(
          '.asset-details-summary-copy .asset-details-disclosure summary',
        );
        if (!(summary instanceof HTMLElement)) {
          throw new Error('The reference disclosure control was not found.');
        }
        summary.focus();
      })()
    `);
    window.show();
    window.focus();
    window.webContents.focus();
    await new Promise((resolve) => setTimeout(resolve, 100));
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    let referenceKeyboardState = await window.webContents.executeJavaScript(`(() => {
      const summary = document.querySelector(
        '.asset-details-summary-copy .asset-details-disclosure summary',
      );
      return {
        focused: document.activeElement === summary,
        expanded: summary?.getAttribute('aria-expanded') ?? null,
        detailsOpen: Boolean(summary?.closest('details')?.open),
      };
    })()`);
    if (!referenceKeyboardState.detailsOpen) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Space' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Space' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      referenceKeyboardState = await window.webContents.executeJavaScript(`(() => {
        const summary = document.querySelector(
          '.asset-details-summary-copy .asset-details-disclosure summary',
        );
        return {
          focused: document.activeElement === summary,
          expanded: summary?.getAttribute('aria-expanded') ?? null,
          detailsOpen: Boolean(summary?.closest('details')?.open),
        };
      })()`);
    }
    if (!referenceKeyboardState.detailsOpen) {
      throw new Error(
        `Keyboard activation did not open the reference disclosure: ${JSON.stringify(referenceKeyboardState)}`,
      );
    }
    await waitForRenderer(
      window,
      "document.querySelector('.asset-details-summary-copy .asset-details-disclosure summary')?.getAttribute('aria-expanded') === 'true' && " +
        "document.querySelector('.asset-details-reference-list')?.getClientRects().length > 0 && " +
        "document.querySelector('.asset-details-reference-list')?.textContent?.includes('Opening') && " +
        "!document.querySelector('.asset-details-reference-list')?.textContent?.includes('.source.assetId')",
      'Human-readable reference details did not render for the selected asset.',
    );
    const referenceDetailsScreenshot = await capturePaintedPage(window);
    const referenceSourceWarningAudit = await window.webContents.executeJavaScript(`(() => {
      const warning = document.querySelector('.asset-details-source-error');
      warning?.scrollIntoView({ block: 'end' });
      const warningRect = warning?.getBoundingClientRect();
      const dialogRect = document.querySelector(
        '[data-testid="asset-details-dialog"]',
      )?.getBoundingClientRect();
      return {
        referenceExpanded: document.querySelector(
          '.asset-details-summary-copy .asset-details-disclosure summary',
        )?.getAttribute('aria-expanded') === 'true',
        warningVisible: Boolean(warningRect && dialogRect &&
          warningRect.top >= dialogRect.top &&
          warningRect.bottom <= dialogRect.bottom),
        warningText: warning?.textContent?.trim() ?? null,
      };
    })()`);
    const referenceSourceWarningScreenshot = await capturePaintedPage(window);
    setVerificationStage('open referenced delete action');
    await window.webContents.executeJavaScript(`
      (() => {
        const more = document.querySelector('.asset-details-more > summary');
        if (!(more instanceof HTMLElement)) {
          throw new Error('The asset details more-actions control was not found.');
        }
        more.click();
        document.querySelector('.asset-details-delete-action')?.click();
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('.asset-library-status')" +
          `?.textContent?.includes(${JSON.stringify(blockedDeleteStatusMarker)})`,
        'Referenced deletion was not visibly blocked.',
      ),
    );
    await window.webContents.executeJavaScript(`(() => {
      document.querySelector('.asset-details-reference-list')?.scrollIntoView({
        block: 'center',
      });
    })()`);
    setVerificationStage('read referenced delete evidence');
    const referenceUi = await window.webContents.executeJavaScript(`(() => {
      const details = document.querySelector(
        '[data-testid="asset-details-overlay"]',
      );
      const referenceList = document.querySelector(
        '.asset-details-reference-list',
      );
      const summaryCopy = document.querySelector('.asset-details-summary-copy');
      const summary = summaryCopy?.querySelector(
        '.asset-details-disclosure summary',
      );
      const card = document.querySelector(
        '[data-asset-id="${referencedAssetId}"]',
      );
      const status = document.querySelector('.asset-library-status');
      return {
        selectedAssetId: details ? details.dataset.selectedAssetId ?? null : null,
        status: status ? status.textContent.trim() : '',
        warning: referenceList ? referenceList.textContent.trim() : '',
        referenceListVisible: Boolean(
          referenceList && referenceList.getClientRects().length,
        ),
        disclosureExpanded: summary?.getAttribute('aria-expanded') === 'true',
        disclosureUnderSize: Boolean(
          summaryCopy?.querySelectorAll(':scope > span')[1]
            ?.nextElementSibling === summary?.closest('details'),
        ),
        pathsHidden: !referenceList?.querySelector('code') &&
          !referenceList?.textContent?.includes('.source.assetId'),
        technicalDetailsHidden: !document.querySelector(
          '.asset-details-technical-list, [data-testid="asset-fla-snapshot-origin"]',
        ),
        sourceWarning: Boolean(
          document.querySelector('.asset-details-source-error[role="alert"]')
            ?.textContent?.includes('源文件缺失'),
        ),
        cardStillPresent: Boolean(card),
      };
    })()`);

    setVerificationStage('close referenced asset details');
    await closeAssetDetails(window);
    setVerificationStage('verify blocked delete status persists');
    await waitForRenderer(
      window,
      `!document.querySelector('[data-testid="asset-details-overlay"]') && document.querySelector('.asset-library-status')?.textContent?.includes(${JSON.stringify(blockedDeleteStatusMarker)})`,
      'The referenced-delete block did not remain visible after closing details.',
    );
    const referenceScreenshot = await capturePaintedPage(window);

    setVerificationStage('multiple human-readable asset references');
    await revealAsset(window, multiReferenceAssetId);
    await window.webContents.executeJavaScript(`(() => {
      document.querySelector('[data-asset-id="${multiReferenceAssetId}"]')?.click();
    })()`);
    await waitForRenderer(
      window,
      `document.querySelector('[data-testid="asset-details-overlay"]')?.dataset.selectedAssetId === ${JSON.stringify(multiReferenceAssetId)} && ` +
        "document.querySelector('.asset-details-summary-copy .asset-details-disclosure summary')?.textContent?.includes('被 2 处使用')",
      'The multi-reference asset disclosure did not show its reference count.',
    );
    const multiReferenceCollapsedScreenshot = await capturePaintedPage(window);
    const multiReferenceBefore = await window.webContents.executeJavaScript(`(() => ({
      revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision,
      dirty: document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState,
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount,
      redoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount,
    }))()`);
    await window.webContents.executeJavaScript(`(() => {
      document.querySelector(
        '.asset-details-summary-copy .asset-details-disclosure summary',
      )?.click();
    })()`);
    await waitForRenderer(
      window,
      "document.querySelector('.asset-details-summary-copy .asset-details-disclosure summary')?.getAttribute('aria-expanded') === 'true' && " +
        "document.querySelector('.asset-details-reference-list li:nth-child(2)')",
      'The multiple human-readable references did not expand.',
    );
    const multiReferenceExpandedScreenshot = await capturePaintedPage(window);
    const multiReferenceAfter = await window.webContents.executeJavaScript(`(() => ({
      revision: document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision,
      dirty: document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState,
      undoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.undoCount,
      redoCount: document.querySelector('[data-testid="history-controls"]')?.dataset.redoCount,
      labels: [...document.querySelectorAll('.asset-details-reference-list li')]
        .map((item) => item.textContent.trim()),
      hasPath: Boolean(document.querySelector('.asset-details-reference-list code')),
    }))()`);
    const multiReferenceUi = {
      countVisible: true,
      twoLabels: multiReferenceAfter.labels.length === 2 &&
        multiReferenceAfter.labels.some((label) => label.includes('Fixture multi reference 1')) &&
        multiReferenceAfter.labels.some((label) => label.includes('Fixture multi reference 2')),
      pathsHidden: !multiReferenceAfter.hasPath,
      projectUnchanged: multiReferenceBefore.revision === multiReferenceAfter.revision &&
        multiReferenceBefore.dirty === multiReferenceAfter.dirty &&
        multiReferenceBefore.undoCount === multiReferenceAfter.undoCount &&
        multiReferenceBefore.redoCount === multiReferenceAfter.redoCount,
    };
    await closeAssetDetails(window);

    setVerificationStage('unreferenced asset deletion');
    await revealAsset(window, removableAssetId);
    await window.webContents.executeJavaScript(`
      (() => {
        const card = document.querySelector(
          '[data-asset-id="${removableAssetId}"]'
        );
        card.scrollIntoView({ block: 'center' });
        card.click();
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-testid=\\\"asset-author-name\\\"] input')" +
          "?.value?.includes('背景占位 001')",
        'Unreferenced asset was not selected.',
      ),
    );
    const unreferencedDetailsUi = await window.webContents.executeJavaScript(`(() => ({
      summaryLabel: document.querySelector('.asset-details-summary-copy > span')
        ?.textContent?.trim() ?? null,
      noReferenceRow: !document.querySelector(
        '.asset-details-summary-copy .asset-details-disclosure',
      ),
      noUnreferencedRow: !document.querySelector('.asset-details-unreferenced'),
    }))()`);
    const unreferencedDetailsScreenshot = await capturePaintedPage(window);
    await window.webContents.executeJavaScript(`
      (() => {
        const more = document.querySelector('.asset-details-more > summary');
        if (!(more instanceof HTMLElement)) {
          throw new Error('The asset details more-actions control was not found.');
        }
        more.click();
        document.querySelector('.asset-details-delete-action')?.click();
      })()
    `);
    await window.webContents.executeJavaScript(
      waitFor(
        "!document.querySelector('[data-asset-id=\"" +
          removableAssetId +
          "\"]') && document.querySelector('.asset-library-status')" +
          "?.textContent?.includes('同步删除')",
        'Unreferenced asset did not disappear after successful deletion.',
      ),
    );
    await closeAssetDetails(window);
    const deletionUi = await window.webContents.executeJavaScript(`(() => ({
      status: document.querySelector('.asset-library-status')
        ?.textContent?.trim(),
      backgroundCount: document.querySelector(
        '.asset-category-tabs button[aria-pressed="true"] strong'
      )?.textContent?.trim(),
      total: document.querySelector('.asset-library-heading output')
        ?.textContent?.trim(),
      removedCardPresent: Boolean(document.querySelector(
        '[data-asset-id="${removableAssetId}"]'
      )),
      rendererHasNodeRequire: typeof window.require !== 'undefined',
      assetsApi: Object.keys(window.pandaStage.assets).sort()
    }))()`);
    const deletionScreenshot = await capturePaintedPage(window);

    setVerificationStage('thumbnail and renderer source audit');
    await revealAsset(window, missingThumbnailAssetId);
    await window.webContents.executeJavaScript(
      waitFor(
        "document.querySelector('[data-asset-id=\"" +
          missingThumbnailAssetId +
          "\"] [data-thumbnail-status=\"missing\"]')",
        'The missing thumbnail card did not remain rebuildable.',
      ),
    );
    const sourceAudit = await window.webContents.executeJavaScript(`(() => ({
      imageCount: document.querySelectorAll('.asset-grid img').length,
      nonDataImageSources: [...document.querySelectorAll('.asset-grid img')]
        .map((image) => image.getAttribute('src'))
        .filter((source) => !source?.startsWith('data:image/png;base64,')),
      missingHasRebuild: Boolean(
        document.querySelector(
          '[data-asset-id="${missingThumbnailAssetId}"] button'
        )
      )
    }))()`);

    setVerificationStage('asset import feedback F06');
    const importFeedback = await (async () => {
      await ensureAssetPanelVisible('import feedback');
      await resetAssetBrowserToFirstPage(window);

      const readInteractionState = () =>
        window.webContents.executeJavaScript(`(() => {
          const history = document.querySelector('[data-testid="history-controls"]');
          const canvas = document.querySelector('[data-testid="project-canvas-stage"]');
          const quickActions = document.querySelector('[data-testid="quick-action-drawer"]');
          const saveButton = quickActions?.querySelector('[data-testid="quick-action-save"]');
          const dirtyGrip = quickActions?.querySelector('.quick-action-drawer-grip');
          const dirtyGripBox = dirtyGrip?.getBoundingClientRect();
          const dirtyGripStyle = dirtyGrip && getComputedStyle(dirtyGrip);
          return {
            revision: Number(canvas?.dataset.projectRevision ?? NaN),
            undoCount: Number(history?.dataset.undoCount ?? NaN),
            redoCount: Number(history?.dataset.redoCount ?? NaN),
            dirty: quickActions?.dataset.saveState === 'dirty',
            saveStateText: quickActions?.querySelector('[data-testid="project-save-state"]')
              ?.textContent?.trim() ?? null,
            saveTitle: saveButton?.getAttribute('title') ?? null,
            saveAccessibleName: saveButton?.getAttribute('aria-label') ?? null,
            saveActionEnabled: saveButton instanceof HTMLButtonElement &&
              !saveButton.disabled,
            dirtyIndicatorVisible: Boolean(
              quickActions?.dataset.saveState === 'dirty' &&
              dirtyGrip?.getClientRects().length && dirtyGripBox &&
              dirtyGripBox.width >= 44 && dirtyGripBox.height >= 3 &&
              dirtyGripStyle?.visibility === 'visible' &&
              dirtyGripStyle.backgroundColor !== 'rgba(0, 0, 0, 0)',
            ),
          };
        })()`);
      const sameInteractionState = (left, right) =>
        left.revision === right.revision &&
        left.undoCount === right.undoCount &&
        left.redoCount === right.redoCount &&
        left.dirty === right.dirty;
      const readGridBounds = () =>
        window.webContents.executeJavaScript(`(() => {
          const rect = document.querySelector('.asset-grid')?.getBoundingClientRect();
          const content = document.querySelector('.asset-library-content');
          return rect ? {
            top: rect.top, left: rect.left, width: rect.width,
            height: rect.height, scrollTop: content?.scrollTop ?? 0,
          } : null;
        })()`);
      const makeImageAsset = (number) => ({
        id: `19000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
        name: `Import feedback image ${number}`,
        relativePath: `assets/issue835-feedback-${number}.png`,
        mimeType: 'image/png', kind: 'image', width: 64, height: 48,
        sha256: String(number).padStart(64, '0'),
        usage: 'uncategorized', keywords: [],
      });
      const makeResult = (sourceName, status, asset = null, duplicateId = null) => ({
        sourceName, status,
        sha256: status === 'imported' ? asset.sha256 : null,
        asset: status === 'imported' ? asset : null,
        duplicateOfAssetId: duplicateId,
        code: status === 'rejected'
          ? 'ASSET_IMPORT_UNSUPPORTED_TYPE'
          : status === 'failed' ? 'ASSET_IMPORT_SOURCE_UNREADABLE' : null,
        message: status === 'rejected'
          ? '不支持此文件格式，请选择 PNG、JPG、MP3 或 WAV。'
          : status === 'failed' ? '无法读取文件，请检查文件后重试。'
            : status === 'duplicate' ? '已复用已有素材。'
              : `已导入：${sourceName}`,
      });
      const completedResponse = (request, results, importedAssets = []) => ({
        ok: true,
        status: 'completed',
        project: importedAssets.length > 0
          ? {
              ...request.project,
              assets: [...request.project.assets, ...importedAssets],
              updatedAt: '2026-07-25T10:30:00.000Z',
            }
          : request.project,
        baseRevision: request.baseRevision,
        savedRevision: request.baseRevision + (importedAssets.length > 0 ? 1 : 0),
        projectChanged: importedAssets.length > 0,
        results,
      });
      const triggerImport = async (responseFactory, expectedKind) => {
        const previousCount = importRequestCount;
        nextImportResponseFactory = responseFactory;
        const clicked = await window.webContents.executeJavaScript(`(() => {
          const button = document.querySelector('[data-testid="resource-primary-action"]');
          if (!(button instanceof HTMLButtonElement) || button.disabled) return false;
          button.click();
          return true;
        })()`);
        if (!clicked) throw new Error('The asset import action was not available.');
        const deadline = Date.now() + 10000;
        while (importRequestCount === previousCount && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (importRequestCount === previousCount) {
          throw new Error('The simulated import request did not reach Main.');
        }
        if (expectedKind) {
          try {
            await waitForRenderer(
              window,
              `document.querySelector('[data-testid="asset-import-feedback"]')?.dataset.feedbackKind === ${JSON.stringify(expectedKind)} && ` +
                `document.querySelector('[data-testid="asset-import-feedback"]')?.getClientRects().length > 0`,
              `The ${expectedKind} import feedback did not become visible.`,
            );
          } catch (error) {
            const feedback = await readFeedback();
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `${message} Current feedback: ${JSON.stringify(feedback)}`,
              { cause: error },
            );
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      };
      const saveAssetNameDuringImport = async (nextName) => {
        await revealAsset(window, fixtureAssetId(3));
        const opened = await window.webContents.executeJavaScript(`(() => {
          const card = document.querySelector(
            '[data-asset-id="${fixtureAssetId(3)}"]',
          );
          if (!card) return false;
          card.click();
          return true;
        })()`);
        if (!opened) throw new Error('The pending-import edit asset was not visible.');
        await waitForRenderer(
          window,
          "document.querySelector('[data-testid=\"asset-author-name\"] input')",
          'The image metadata editor did not open during the pending import.',
        );
        await window.webContents.executeJavaScript(`(() => {
          const input = document.querySelector('[data-testid="asset-author-name"] input');
          const setter = Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype, 'value',
          ).set;
          setter.call(input, ${JSON.stringify(nextName)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await waitForRenderer(
          window,
          `document.querySelector('[data-testid="asset-author-name"] input')?.value === ${JSON.stringify(nextName)}`,
          'The pending-import metadata edit did not update its draft.',
        );
        await window.webContents.executeJavaScript(
          "document.querySelector('.asset-metadata-save')?.click()",
        );
        await new Promise((resolve) => setTimeout(resolve, 250));
        const savedState = await window.webContents.executeJavaScript(`(() => ({
          name: document.querySelector('[data-testid="asset-author-name"] input')?.value ?? null,
          formVisible: Boolean(document.querySelector('[data-testid="asset-author-metadata-form"]')),
          readonlyName: document.querySelector('.asset-details-readonly-name')?.textContent?.trim() ?? null,
          detailsView: Boolean(document.querySelector('[data-testid="asset-details-view"]')),
          overlayOpen: Boolean(document.querySelector('[data-testid="asset-details-overlay"]')),
          selectedAssetId: document.querySelector('[data-testid="asset-details-overlay"]')?.dataset.selectedAssetId ?? null,
          cardName: document.querySelector('[data-asset-id="${fixtureAssetId(3)}"] .asset-card-name')?.textContent?.trim() ?? null,
          revision: Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? NaN),
          saveState: document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState ?? null,
          saveTitle: document.querySelector('[data-testid="quick-action-save"]')?.getAttribute('title') ?? null,
        }))()`);
        if (
          savedState.name !== nextName &&
          savedState.readonlyName !== nextName &&
          savedState.cardName !== nextName
        ) {
          await closeAssetDetails(window);
          await ensureAssetPanelVisible('pending import edit review');
          await revealAsset(window, fixtureAssetId(3));
          await window.webContents.executeJavaScript(`(() => {
            document.querySelector('[data-asset-id="${fixtureAssetId(3)}"]')?.click();
          })()`);
          await waitForRenderer(
            window,
            `document.querySelector('[data-testid="asset-author-name"] input')?.value === ${JSON.stringify(nextName)}`,
            'The saved metadata edit did not persist in the pending import project.',
          );
        }
        const finalState = await window.webContents.executeJavaScript(`(() => ({
          name: document.querySelector('[data-testid="asset-author-name"] input')?.value ??
            document.querySelector('.asset-details-readonly-name')?.textContent?.trim() ??
            document.querySelector('[data-asset-id="${fixtureAssetId(3)}"] .asset-card-name')?.textContent?.trim() ?? null,
          revision: Number(document.querySelector('[data-testid="project-canvas-stage"]')?.dataset.projectRevision ?? NaN),
          saveState: document.querySelector('[data-testid="quick-action-drawer"]')?.dataset.saveState ?? null,
          saveTitle: document.querySelector('[data-testid="quick-action-save"]')?.getAttribute('title') ?? null,
        }))()`);
        if (
          finalState.name !== nextName ||
          finalState.saveState !== 'dirty'
        ) {
          throw new Error(
            `The metadata edit did not remain dirty during the pending import: ${JSON.stringify({ savedState, finalState })}`,
          );
        }
        return {
          ...finalState,
          dirty: finalState.saveState === 'dirty',
        };
      };
      const readFeedback = () =>
        window.webContents.executeJavaScript(`(() => {
          const feedback = document.querySelector('[data-testid="asset-import-feedback"]');
          const rect = feedback?.getBoundingClientRect();
          const toolbar = document.querySelector('.resource-activity-header-actions')?.getBoundingClientRect();
          const controls = document.querySelector('[data-testid="asset-library-filter-controls"]')?.getBoundingClientRect();
          const overlaps = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
          return {
            count: document.querySelectorAll('[data-testid="asset-import-feedback"]').length,
            kind: feedback?.dataset.feedbackKind ?? null,
            summary: feedback?.querySelector('.asset-import-feedback-summary')?.textContent?.trim() ?? null,
            role: feedback?.getAttribute('role') ?? null,
            ariaLive: feedback?.getAttribute('aria-live') ?? null,
            fixed: feedback ? getComputedStyle(feedback).position === 'fixed' : false,
            overlapsToolbar: overlaps(rect, toolbar),
            overlapsControls: overlaps(rect, controls),
            touchTargets: [...(feedback?.querySelectorAll('button') ?? [])].map((button) => {
              const box = button.getBoundingClientRect();
              return box.width >= 44 && box.height >= 44;
            }),
            details: feedback?.querySelector('[data-testid="asset-import-feedback-details"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
          };
        })()`);
      const openDetails = async () => {
        const opened = await window.webContents.executeJavaScript(`(() => {
          const button = document.querySelector('[data-testid="asset-import-feedback"] [aria-controls="asset-import-feedback-details"]');
          if (!(button instanceof HTMLButtonElement)) return false;
          button.click(); return true;
        })()`);
        if (!opened) throw new Error('The import feedback details action was missing.');
        await waitForRenderer(
          window,
          "document.querySelector('[data-testid=\"asset-import-feedback-details\"]')?.getClientRects().length > 0",
          'The import feedback details did not open.',
        );
      };
      const closeFeedback = async () => {
        const closed = await window.webContents.executeJavaScript(`(() => {
          const button = document.querySelector('[data-testid="asset-import-feedback-close"]');
          if (!(button instanceof HTMLButtonElement)) return false;
          button.focus(); button.click(); return true;
        })()`);
        if (!closed) throw new Error('The import feedback close action was missing.');
        await waitForRenderer(
          window,
          "!document.querySelector('[data-testid=\"asset-import-feedback\"]')",
          'The import feedback did not close on request.',
        );
      };
      const sameBounds = (left, right) => Boolean(left && right &&
        ['top', 'left', 'width', 'height', 'scrollTop'].every(
          (key) => Math.abs(left[key] - right[key]) <= 1,
        ));

      const beforeSuccessState = await readInteractionState();
      const beforeSuccessGrid = await readGridBounds();
      const successAssets = Array.from({ length: 4 }, (_, index) => makeImageAsset(index + 1));
      await triggerImport(
        (request) => completedResponse(
          request,
          successAssets.map((asset, index) => makeResult(`scene-${index + 1}.png`, 'imported', asset)),
          successAssets,
        ),
        'success',
      );
      const successShownAt = Date.now();
      const successUi = await readFeedback();
      const successGridWhileVisible = await readGridBounds();
      const successScreenshot = await capturePaintedPage(window);
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const successVisibleAt3500Ms = await window.webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-testid=\"asset-import-feedback\"]'))",
      );
      await new Promise((resolve) => setTimeout(resolve, 900));
      const successDismissed = await window.webContents.executeJavaScript(
        "!document.querySelector('[data-testid=\"asset-import-feedback\"]')",
      );
      const successGridAfterDismissal = await readGridBounds();
      const afterSuccessState = await readInteractionState();
      const successAudit = {
        oneFeedback: successUi.count === 1,
        fourFileSummary: successUi.summary?.includes('4') && successUi.summary?.includes('素材'),
        noPerFileResultList: await window.webContents.executeJavaScript(
          "document.querySelectorAll('.asset-import-results li').length === 0",
        ),
        floating: successUi.fixed,
        doesNotOverlapToolbar: !successUi.overlapsToolbar,
        doesNotOverlapLibraryControls: !successUi.overlapsControls,
        visibleAt3500Ms: successVisibleAt3500Ms,
        dismissedAfterTimeout: successDismissed,
        visibleForMs: Date.now() - successShownAt,
        listPositionUnchanged: sameBounds(beforeSuccessGrid, successGridWhileVisible) &&
          sameBounds(beforeSuccessGrid, successGridAfterDismissal),
        expectedImportRevisionOnly:
          afterSuccessState.revision === beforeSuccessState.revision + 1 &&
          afterSuccessState.undoCount === beforeSuccessState.undoCount &&
          afterSuccessState.redoCount === beforeSuccessState.redoCount &&
          afterSuccessState.dirty === beforeSuccessState.dirty,
      };

      setVerificationStage('pending import preserves intervening edit');
      const beforePendingImportState = await readInteractionState();
      let pendingImportRequest = null;
      let resolvePendingImport = null;
      const pendingSuccessAssets = [makeImageAsset(20)];
      await triggerImport((request) => new Promise((resolve) => {
        pendingImportRequest = request;
        resolvePendingImport = resolve;
      }), null);
      const pendingImportEdit = await saveAssetNameDuringImport(
        'Day18 edit preserved after pending import',
      );
      const pendingStateBeforeResponse = await readInteractionState();
      resolvePendingImport(completedResponse(
        pendingImportRequest,
        [makeResult('pending-edit.png', 'imported', pendingSuccessAssets[0])],
        pendingSuccessAssets,
      ));
      await waitForRenderer(
        window,
        "document.querySelector('[data-testid=\"asset-import-feedback\"]')?.dataset.feedbackKind === 'success' && document.querySelector('[data-testid=\"asset-import-feedback\"]')?.getClientRects().length > 0",
        'The delayed successful import did not complete after the intervening edit.',
      );
      const pendingSuccessUi = await readFeedback();
      const pendingSuccessState = await readInteractionState();
      await closeAssetDetails(window);
      await ensureAssetPanelVisible('pending import edit verification');
      await revealAsset(window, fixtureAssetId(3));
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-asset-id="${fixtureAssetId(3)}"]')?.click();
      })()`);
      await waitForRenderer(
        window,
        "document.querySelector('[data-testid=\"asset-author-name\"] input')?.value === 'Day18 edit preserved after pending import'",
        'The pending import response did not preserve the saved image metadata edit.',
      );
      const pendingSuccessName = await window.webContents.executeJavaScript(
        "document.querySelector('[data-testid=\"asset-author-name\"] input')?.value ?? null",
      );
      const pendingImportSuccessScreenshot = await capturePaintedPage(window);
      await closeAssetDetails(window);
      await ensureAssetPanelVisible('pending import asset verification');
      await revealAsset(window, pendingSuccessAssets[0].id);
      const pendingSuccessImportedAssetApplied =
        await window.webContents.executeJavaScript(
          `Boolean(document.querySelector('[data-asset-id="${pendingSuccessAssets[0].id}"]'))`,
        );
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const pendingSuccessDismissed = await window.webContents.executeJavaScript(
        "!document.querySelector('[data-testid=\"asset-import-feedback\"]')",
      );
      const pendingSuccessAfterDismissal = await readInteractionState();
      const pendingImportDirtyAfterToastScreenshot =
        await capturePaintedPage(window);
      const pendingImportSuccessAudit = {
        editMadeWhilePending: pendingImportEdit.name ===
          'Day18 edit preserved after pending import' &&
          pendingImportEdit.dirty,
        editPreservedAfterResponse: pendingSuccessName ===
          'Day18 edit preserved after pending import',
        importedAssetApplied: pendingSuccessImportedAssetApplied,
        revisionIncludesEditAndImport:
          pendingStateBeforeResponse.revision === beforePendingImportState.revision + 1 &&
          pendingSuccessState.revision === pendingStateBeforeResponse.revision + 1,
        remainsDirty: pendingSuccessState.dirty &&
          pendingSuccessAfterDismissal.dirty,
        oneOrdinarySuccessToast: pendingSuccessUi.count === 1 &&
          pendingSuccessUi.kind === 'success' &&
          pendingSuccessUi.summary === '已导入：pending-edit.png',
        successToastDismisses: pendingSuccessDismissed,
        persistentSaveActionCommunicatesDirty:
          pendingSuccessAfterDismissal.saveTitle === '保存项目（有未保存更改）' &&
          pendingSuccessAfterDismissal.saveAccessibleName === '保存项目（有未保存更改）' &&
          pendingSuccessAfterDismissal.dirtyIndicatorVisible &&
          pendingSuccessAfterDismissal.saveActionEnabled,
      };

      setVerificationStage('pending import exception preserves edit');
      await closeAssetDetails(window);
      const beforePendingFailureState = await readInteractionState();
      let rejectPendingImport = null;
      await triggerImport(() => new Promise((_resolve, reject) => {
        rejectPendingImport = reject;
      }), null);
      const pendingFailureEdit = await saveAssetNameDuringImport(
        'Day18 edit preserved after pending import failure',
      );
      rejectPendingImport(new Error('Simulated import response failure.'));
      await waitForRenderer(
        window,
        "document.querySelector('[data-testid=\"asset-import-feedback\"]')?.dataset.feedbackKind === 'error' && document.querySelector('[data-testid=\"asset-import-feedback\"]')?.getClientRects().length > 0",
        'The failed pending import did not show persistent error feedback.',
      );
      const pendingFailureUi = await readFeedback();
      const pendingFailureState = await readInteractionState();
      const pendingFailureName = await window.webContents.executeJavaScript(
        "document.querySelector('[data-testid=\"asset-author-name\"] input')?.value ?? null",
      );
      const pendingImportFailureScreenshot = await capturePaintedPage(window);
      const pendingImportFailureAudit = {
        editMadeWhilePending: pendingFailureEdit.name ===
          'Day18 edit preserved after pending import failure' &&
          pendingFailureEdit.dirty,
        editPreservedAfterException: pendingFailureName ===
          'Day18 edit preserved after pending import failure',
        errorFeedbackPersistent: pendingFailureUi.kind === 'error' &&
          pendingFailureUi.summary?.includes('Simulated import response failure.'),
        responseAddsNoRevision: pendingFailureState.revision ===
          pendingFailureEdit.revision &&
          pendingFailureState.dirty &&
          pendingFailureState.saveTitle === '保存项目（有未保存更改）' &&
          pendingFailureState.saveActionEnabled,
        errorDoesNotDiscardPriorDirtyState:
          pendingFailureState.dirty && beforePendingFailureState.dirty &&
          pendingFailureState.dirtyIndicatorVisible,
      };
      await closeFeedback();
      await closeAssetDetails(window);

      const duplicateResults = [
        makeResult('scene-copy-01.png', 'duplicate', null, successAssets[0].id),
        makeResult('scene-copy-02.png', 'duplicate', null, successAssets[1].id),
      ];
      const beforeDuplicateState = await readInteractionState();
      await triggerImport((request) => completedResponse(request, duplicateResults), 'info');
      const duplicateUi = await readFeedback();
      const focusEntered = await window.webContents.executeJavaScript(`(() => {
        const feedback = document.querySelector('[data-testid="asset-import-feedback"]');
        const close = document.querySelector('[data-testid="asset-import-feedback-close"]');
        if (!feedback || !close) return false;
        const simulateHeadlessFocus = !document.hasFocus();
        close.focus();
        if (simulateHeadlessFocus) {
          close.dispatchEvent(new FocusEvent('focusin', {
            bubbles: true, relatedTarget: document.body,
          }));
        }
        return feedback.contains(document.activeElement);
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const focusPaused = await window.webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-testid=\"asset-import-feedback\"]'))",
      );
      await window.webContents.executeJavaScript(`(() => {
        const close = document.querySelector('[data-testid="asset-import-feedback-close"]');
        if (!close) return;
        close.dispatchEvent(new FocusEvent('focusout', {
          bubbles: true, relatedTarget: document.body,
        }));
        close.blur();
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const focusResumedDismissal = await window.webContents.executeJavaScript(
        "!document.querySelector('[data-testid=\"asset-import-feedback\"]')",
      );

      await triggerImport((request) => completedResponse(request, duplicateResults), 'info');
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-testid="asset-import-feedback"]')?.dispatchEvent(
          new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse', pointerId: 1 }),
        );
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const hoverPaused = await window.webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-testid=\"asset-import-feedback\"]'))",
      );
      await window.webContents.executeJavaScript(`(() => {
        document.querySelector('[data-testid="asset-import-feedback"]')?.dispatchEvent(
          new PointerEvent('pointerout', {
            bubbles: true, pointerType: 'mouse', pointerId: 1,
            relatedTarget: document.body,
          }),
        );
      })()`);
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const hoverResumedDismissal = await window.webContents.executeJavaScript(
        "!document.querySelector('[data-testid=\"asset-import-feedback\"]')",
      );
      const afterDuplicateState = await readInteractionState();

      const partialAssets = Array.from({ length: 3 }, (_, index) => makeImageAsset(index + 5));
      const partialResults = [
        ...partialAssets.map((asset, index) => makeResult(`partial-${index + 1}.png`, 'imported', asset)),
        makeResult('unsupported.gif', 'rejected'),
      ];
      await triggerImport(
        (request) => completedResponse(request, partialResults, partialAssets),
        'warning',
      );
      await openDetails();
      const partialFailureUi = await readFeedback();
      const partialFailureScreenshot = await capturePaintedPage(window);
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const partialFailurePersistent = await window.webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-testid=\"asset-import-feedback\"] [data-testid=\"asset-import-feedback-details\"]'))",
      );
      await closeFeedback();

      const beforeCancelState = await readInteractionState();
      await triggerImport(() => ({ ok: true, status: 'cancelled' }), null);
      const cancellationClearedFeedback = await window.webContents.executeJavaScript(
        "!document.querySelector('[data-testid=\"asset-import-feedback\"]')",
      );
      const afterCancelState = await readInteractionState();

      ipcMain.handle(IPC_CHANNELS.ASSET_METADATA_REFRESH, (_event, request) => ({
        ok: false,
        error: {
          code: 'ASSET_METADATA_OPERATION_FAILED',
          message: '无法读取音频时长，可在素材详情中重试。',
          projectRoot: request.projectRoot,
          assetId: request.assetId,
          relativePath: 'assets/voice-with-error.wav',
        },
      }));
      const audioAsset = {
        id: '19000000-0000-4000-8000-000000000021',
        name: 'voice-with-error',
        relativePath: 'assets/voice-with-error.wav',
        mimeType: 'audio/wav', kind: 'audio',
        sha256: '20'.padStart(64, '0'),
      };
      const beforeAudioState = await readInteractionState();
      await triggerImport(
        (request) => completedResponse(
          request,
          [makeResult('voice-with-error.wav', 'imported', audioAsset)],
          [audioAsset],
        ),
        'warning',
      );
      await openDetails();
      const audioFailureUi = await readFeedback();
      const audioFailureScreenshot = await capturePaintedPage(window);
      await new Promise((resolve) => setTimeout(resolve, 4200));
      const audioFailurePersistent = await window.webContents.executeJavaScript(
        "Boolean(document.querySelector('[data-testid=\"asset-import-feedback\"]'))",
      );
      const afterAudioState = await readInteractionState();
      await closeFeedback();

      return {
        audit: {
          success: successAudit,
          pendingImportSuccess: pendingImportSuccessAudit,
          pendingImportFailure: pendingImportFailureAudit,
          duplicate: {
            singleNeutralNotice: duplicateUi.count === 1 && duplicateUi.kind === 'info',
            communicatesReuse: duplicateUi.summary?.includes('已存在') ?? false,
            focusEntered,
            hoverPaused,
            focusPaused,
            focusResumedDismissal,
            hoverResumedDismissal,
            projectStateUnchanged: sameInteractionState(beforeDuplicateState, afterDuplicateState),
          },
          partialFailure: {
            persistent: partialFailurePersistent,
            summaryIsPartial: partialFailureUi.summary?.includes('3') && partialFailureUi.summary?.includes('1'),
            detailNamesFile: partialFailureUi.details?.includes('unsupported.gif'),
            roleAndLive: partialFailureUi.role === 'alert' && partialFailureUi.ariaLive === 'assertive',
            actionTouchTargets: partialFailureUi.touchTargets.every(Boolean),
          },
          cancellation: {
            clearsPreviousNotice: cancellationClearedFeedback,
            projectStateUnchanged: sameInteractionState(beforeCancelState, afterCancelState),
          },
          audioMetadataFailure: {
            persistent: audioFailurePersistent,
            detailsNameFile: audioFailureUi.details?.includes('voice-with-error.wav'),
            detailsExplainError: audioFailureUi.details?.includes('无法读取音频时长'),
            feedbackDidNotAddRevisionOrHistory:
              afterAudioState.revision === beforeAudioState.revision + 1 &&
              afterAudioState.undoCount === beforeAudioState.undoCount &&
              afterAudioState.redoCount === beforeAudioState.redoCount &&
              afterAudioState.dirty === beforeAudioState.dirty,
          },
        },
        screenshots: {
          success: successScreenshot,
          pendingImportSuccess: pendingImportSuccessScreenshot,
          pendingImportDirtyAfterToast: pendingImportDirtyAfterToastScreenshot,
          pendingImportFailure: pendingImportFailureScreenshot,
          partialFailure: partialFailureScreenshot,
          audioFailure: audioFailureScreenshot,
        },
      };
    })();

    const evidence = {
      day: 18,
      workOrder: 'B-18/45',
      result: 'PASS',
      branch,
      executedAt: new Date().toISOString(),
      ui: {
        categories: categoryLabels,
        filterAudit,
        usageFilterDefaultAudit,
        usageFilterHoverAudit,
        filterRestoreAudit,
        responsiveAudit,
        backgroundItemsBeforeDelete: initialPageScan.seenAssetCount,
        pagedBrowserScan: initialPageScan,
        thumbnailRequestCount,
        performanceObservation,
        dragEvidence,
        historyReconciliation,
        referenceUi,
        referenceCollapsedUi,
        referenceSourceWarningAudit,
        multiReferenceUi,
        unreferencedDetailsUi,
        deletionUi,
        sourceAudit,
        decodeFallback,
        importFeedback: importFeedback.audit,
      },
      deletionProtocol: {
        referenceScanBeforeMutation: true,
        authoritativeSnapshotRecheckedBeforeCommit: true,
        referencesRescannedBeforeCommit: true,
        staleDuringStageRollsBackAllFiles: true,
        referencedDeleteBlocked: true,
        referencedAssetStillVisible: referenceUi.cardStillPresent,
        unreferencedDeleteApplied: !deletionUi.removedCardPresent,
        requests: deleteRequests.map((request) => ({
          assetId: request.assetId,
          baseRevision: request.baseRevision,
          projectRoot: request.projectRoot,
        })),
      },
      backendEvidence: {
        integrationTest: 'tests/integration/asset-delete.test.ts',
        verifiesRealAssetCacheAndProjectDeletion: true,
        verifiesStageFailureRollback: true,
        verifiesAtomicSaveFailureRollback: true,
        verifiesStaleRevisionBeforeMutation: true,
        verifiesStaleRevisionAfterStaging: true,
        verifiesStaleAtAtomicReplaceBoundary: true,
        verifiesRecoveryHashPreservedOnRace: true,
        pngValidation,
      },
      screenshots: [
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/asset-library-100.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/usage-filter-default.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/usage-filter-hover.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/usage-filter-selected.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/viewport-narrow.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/viewport-touch-portrait.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/viewport-touch-landscape.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/drag-feedback.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/thumbnail-decode-fallback.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/import-success.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/import-partial-failure.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/import-audio-metadata-failure.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/pending-import-preserved-edit.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/pending-import-dirty-after-toast.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/pending-import-exception.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/reference-details-collapsed.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/reference-details-expanded.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/reference-source-warning.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/multi-reference-collapsed.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/multi-reference-expanded.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/unreferenced-details.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/reference-blocked.png`,
        `${evidenceRelativeDirectory.replaceAll(path.sep, '/')}/unreferenced-deleted.png`,
      ],
    };

    if (
      performanceObservation.itemCount !== 100 ||
      performanceObservation.pageCount !== 13 ||
      performanceObservation.pageSize > 8 ||
      performanceObservation.elapsedMs >= 1_000 ||
      !filterAudit.headingVisuallyHidden ||
      !filterAudit.assetWorkspaceHeadingHidden ||
      !filterAudit.filterControlsAligned ||
      !filterAudit.filterTriggerTouchTarget ||
      filterAudit.dragHintVisible ||
      !filterAudit.assetLibraryVisible ||
      !filterAudit.selectedMenuVisible ||
      filterAudit.menuValues.length !== 6 ||
      filterAudit.firstFocus !== 'all' ||
      filterAudit.arrowFocus !== 'uncategorized' ||
      !filterAudit.escapeReturnedFocus ||
      Number.parseFloat(filterAudit.focusOutline) < 2 ||
      !filterAudit.menuRightAligned ||
      !filterAudit.menuCompact ||
      !filterAudit.labelsUpdated ||
      !filterAudit.selectedContrast ||
      !filterAudit.selectedScreenshotUiReady ||
      !filterAudit.rightAlignedText ||
      !filterAudit.stableCheckGap ||
      !filterAudit.hoverVisible ||
      !filterAudit.combinedSearchAndUsage ||
      !filterAudit.audioClearedUsage ||
      !filterAudit.audioFilterStayedClosed ||
      filterAudit.audioCardCount === 0 ||
      !filterAudit.backgroundUsage ||
      !filterAudit.selectedBackgroundMenu ||
      !filterAudit.backgroundRestoredAll ||
      Object.values(responsiveAudit).some((audit) =>
        !audit.controlsWithinLibrary ||
        !audit.libraryVisible ||
        !audit.controlsVisible ||
        !audit.controlsAligned ||
        !audit.searchVisible ||
        !audit.triggerVisible ||
        !audit.triggerTouchTarget ||
        !audit.libraryFound ||
        !audit.controlsFound ||
        !audit.searchFound ||
        !audit.triggerFound ||
        audit.orientation !== audit.expectedOrientation
      ) ||
      historyReconciliation.afterUndo !== historyReconciliation.before ||
      historyReconciliation.afterRedo !== historyReconciliation.edited ||
      historyReconciliation.afterDirtyUndoName !==
        historyReconciliation.dirtyDraft ||
      !historyReconciliation.conflictVisible ||
      Object.values(historyReconciliation.t3).some((passed) => !passed) ||
      dragEvidence.payload.assetId !== removableAssetId ||
      dragEvidence.payload.version !== 2 ||
      dragEvidence.payload.type !== 'asset-image' ||
      dragEvidence.rawContainsPath ||
      dragEvidence.rawContainsAssetObject ||
      !referenceUi.cardStillPresent ||
      referenceUi.selectedAssetId !== referencedAssetId ||
      !referenceUi.referenceListVisible ||
      !referenceUi.disclosureExpanded ||
      !referenceUi.disclosureUnderSize ||
      !referenceUi.pathsHidden ||
      !referenceUi.technicalDetailsHidden ||
      !referenceUi.sourceWarning ||
      !referenceSourceWarningAudit.referenceExpanded ||
      !referenceSourceWarningAudit.warningVisible ||
      !referenceSourceWarningAudit.warningText?.includes('源文件缺失') ||
      referenceCollapsedUi.expanded !== 'false' ||
      referenceCollapsedUi.label !== '图片' ||
      !referenceCollapsedUi.dimensions?.includes('px') ||
      !referenceCollapsedUi.disclosureUnderSize ||
      !referenceCollapsedUi.sourceWarning ||
      referenceCollapsedUi.technicalDetailsVisible ||
      !multiReferenceUi.countVisible ||
      !multiReferenceUi.twoLabels ||
      !multiReferenceUi.pathsHidden ||
      !multiReferenceUi.projectUnchanged ||
      unreferencedDetailsUi.summaryLabel !== '图片' ||
      !unreferencedDetailsUi.noReferenceRow ||
      !unreferencedDetailsUi.noUnreferencedRow ||
      deletionUi.removedCardPresent ||
      deletionUi.backgroundCount !== '99' ||
      deletionUi.rendererHasNodeRequire ||
      !deletionUi.assetsApi.includes('delete') ||
      !deletionUi.assetsApi.includes('readThumbnail') ||
      sourceAudit.nonDataImageSources.length > 0 ||
      !sourceAudit.missingHasRebuild ||
      !referenceUi.warning?.includes('Opening') ||
      !referenceUi.status?.includes(blockedDeleteStatusMarker) ||
      !importFeedback.audit.success.oneFeedback ||
      !importFeedback.audit.success.fourFileSummary ||
      !importFeedback.audit.success.noPerFileResultList ||
      !importFeedback.audit.success.floating ||
      !importFeedback.audit.success.doesNotOverlapToolbar ||
      !importFeedback.audit.success.doesNotOverlapLibraryControls ||
      !importFeedback.audit.success.visibleAt3500Ms ||
      !importFeedback.audit.success.dismissedAfterTimeout ||
      importFeedback.audit.success.visibleForMs > 5000 ||
      !importFeedback.audit.success.listPositionUnchanged ||
      !importFeedback.audit.success.expectedImportRevisionOnly ||
      Object.values(importFeedback.audit.pendingImportSuccess).some((passed) => !passed) ||
      Object.values(importFeedback.audit.pendingImportFailure).some((passed) => !passed) ||
      Object.values(importFeedback.audit.duplicate).some((passed) => !passed) ||
      Object.values(importFeedback.audit.partialFailure).some((passed) => !passed) ||
      Object.values(importFeedback.audit.cancellation).some((passed) => !passed) ||
      Object.values(importFeedback.audit.audioMetadataFailure).some((passed) => !passed) ||
      !decodeFallback.failedCardMissing ||
      !decodeFallback.failedCardHasRebuild ||
      !decodeFallback.failedCardStillSelected ||
      decodeFallback.failedCardHasImage ||
      !decodeFallback.healthyCardStillHasImage ||
      decodeFallback.imageCountAfter !==
        decodeFallback.imageCountBefore - 1 ||
      !pngValidation.validCacheAccepted ||
      !pngValidation.truncatedSignatureBodyRejected ||
      deleteRequests.length !== 2
    ) {
      throw new Error(
        `Day 18 UI verification failed: ${JSON.stringify(evidence)}`,
      );
    }

    await mkdir(evidenceDirectory, { recursive: true });
    await Promise.all([
      writeFile(
        path.join(evidenceDirectory, 'asset-library-100.png'),
        gridScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'usage-filter-default.png'),
        usageFilterDefaultScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'usage-filter-hover.png'),
        usageFilterHoverScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'usage-filter-selected.png'),
        usageFilterSelectedScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'viewport-narrow.png'),
        responsiveScreenshots.narrow.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'viewport-touch-portrait.png'),
        responsiveScreenshots.touchPortrait.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'viewport-touch-landscape.png'),
        responsiveScreenshots.touchLandscape.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'drag-feedback.png'),
        dragScreenshot.toPNG(),
      ),
      writeFile(
        path.join(
          evidenceDirectory,
          'thumbnail-decode-fallback.png',
        ),
        decodeFallbackScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'import-success.png'),
        importFeedback.screenshots.success.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'import-partial-failure.png'),
        importFeedback.screenshots.partialFailure.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'import-audio-metadata-failure.png'),
        importFeedback.screenshots.audioFailure.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'pending-import-preserved-edit.png'),
        importFeedback.screenshots.pendingImportSuccess.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'pending-import-dirty-after-toast.png'),
        importFeedback.screenshots.pendingImportDirtyAfterToast.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'pending-import-exception.png'),
        importFeedback.screenshots.pendingImportFailure.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'reference-details-collapsed.png'),
        referenceCollapsedScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'reference-details-expanded.png'),
        referenceDetailsScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'reference-source-warning.png'),
        referenceSourceWarningScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'multi-reference-collapsed.png'),
        multiReferenceCollapsedScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'multi-reference-expanded.png'),
        multiReferenceExpandedScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'unreferenced-details.png'),
        unreferencedDetailsScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'reference-blocked.png'),
        referenceScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'unreferenced-deleted.png'),
        deletionScreenshot.toPNG(),
      ),
      writeFile(
        path.join(evidenceDirectory, 'results.json'),
        `${JSON.stringify(evidence, null, 2)}\n`,
        'utf8',
      ),
    ]);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    window.destroy();
    for (const channel of [
      IPC_CHANNELS.PROJECT_OPEN,
      IPC_CHANNELS.AUTOSAVE_TRACK,
      IPC_CHANNELS.AUTOSAVE_UPDATE,
      IPC_CHANNELS.AUTOSAVE_STOP,
      IPC_CHANNELS.RECOVERY_DETECT,
      IPC_CHANNELS.RECENT_PROJECTS_LIST,
      IPC_CHANNELS.ASSET_THUMBNAIL_READ,
      IPC_CHANNELS.ASSET_DELETE,
      IPC_CHANNELS.ASSET_IMPORT_CHOOSE,
      IPC_CHANNELS.ASSET_METADATA_REFRESH,
    ]) {
      ipcMain.removeHandler(channel);
    }
  }
}

app
  .whenReady()
  .then(verifyDay18)
  .then(() => app.quit())
  .catch((error) => {
    console.error(`Day 18 verification stage: ${activeVerificationStage}`);
    console.error(error);
    app.exit(1);
  });
