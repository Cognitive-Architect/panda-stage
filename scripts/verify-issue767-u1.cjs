#!/usr/bin/env node
/**
 * Issue #767 U1 — normal Electron FLA entry and unified shell evidence.
 *
 * The verifier uses the production Project Center and Asset Library button,
 * then injects only the chosen source path through the existing acceptance
 * seam. It never confirms or commits an asset. Sources, projects, screenshots,
 * and the isolated Electron profile live below the caller-provided acceptance
 * directory; the real bluehair source is read-only and SHA-checked.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} = require('node:fs');
const { basename, join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue767-u1';
const DEFAULT_BLUEHAIR_SOURCE = 'D:\\表情合集\\新人物\\蓝发修仙女.fla';
const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--bluehair-source') args.bluehairSource = argv[++index];
  }
  return args;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, data]);
  const result = Buffer.allocUnsafe(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBytes.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(payload), 8 + data.length);
  return result;
}

function createPng(color) {
  const width = 4;
  const height = 4;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3] ?? 255;
    }
  }
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    header,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

async function writeBitmapOnlyFla(path) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="320" height="240" frameRate="24">
  <media>
    <DOMBitmapItem name="issue767-red.png" href="issue767-red.png" frameRight="80" frameBottom="80"/>
    <DOMBitmapItem name="issue767-green.png" href="issue767-green.png" frameRight="80" frameBottom="80"/>
  </media>
  <timelines>
    <DOMTimeline name="issue767-bitmap-scene">
      <layers><DOMLayer name="scene-layer"><frames><DOMFrame index="0"><elements/></DOMFrame></frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  zip.file('LIBRARY/issue767-red.png', createPng([220, 80, 80]));
  zip.file('LIBRARY/issue767-green.png', createPng([80, 190, 110]));
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

function buildVectorFrames() {
  return Array.from({ length: 3 }, (_, frameIndex) => `
            <DOMFrame index="${frameIndex}">
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="${20 + frameIndex * 2}" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills><FillStyle index="1"><SolidColor color="#4d82c4" alpha="1"/></FillStyle></fills>
                    <strokes/>
                    <edges><Edge fillStyle1="1" cubics="${SIMPLE_RECT_CUBICS}"/></edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`).join('');
}

async function writeVectorOnlyFla(path) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
  <timelines>
    <DOMTimeline name="issue767-vector-scene">
      <layers><DOMLayer name="scene-layer"><frames>${buildVectorFrames()}</frames></DOMLayer></layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
}

const args = parseArgs(process.argv.slice(2));
const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
const bluehairSource = resolve(args.bluehairSource || DEFAULT_BLUEHAIR_SOURCE);
const runId = new Date().toISOString().replace(/[:.]/gu, '-');
const runRoot = join(acceptanceRoot, `run-${runId}`);
const projectParent = join(runRoot, 'projects');
const evidenceDir = join(runRoot, 'evidence');
const userData = join(runRoot, 'electron-user-data');
const receiptPath = join(runRoot, 'issue767-u1-receipt.json');
const inspectEvents = [];

mkdirSync(projectParent, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });
mkdirSync(userData, { recursive: true });
app.setPath('userData', userData);

function installInspectionCounter() {
  const modulePath = join(__dirname, '..', 'dist-electron', 'main', 'services', 'FlaImportService.js');
  const { FlaImportService } = require(modulePath);
  const original = FlaImportService.prototype.inspectSource;
  FlaImportService.prototype.inspectSource = async function countedInspectSource(sourcePath, requestId) {
    inspectEvents.push({ sourceBasename: basename(sourcePath) });
    return original.call(this, sourcePath, requestId);
  };
}

async function waitForMainWindow() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const window = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (window) {
      try {
        const ready = await window.webContents.executeJavaScript(
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect)',
        );
        if (ready) return window;
      } catch {
        // The production renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the production project/FLA APIs.');
}

async function evaluate(window, expression) {
  return window.webContents.executeJavaScript(expression);
}

async function waitForExpression(window, expression, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(window, expression)) return;
    } catch {
      // Continue while React and IPC settle.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for expression: ${expression}`);
}

async function click(window, selector) {
  await evaluate(window, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element ' + ${JSON.stringify(selector)});
    if (element instanceof HTMLButtonElement && element.disabled) throw new Error('Clickable element is disabled ' + ${JSON.stringify(selector)});
    setTimeout(() => element.click(), 0);
    return true;
  })()`);
  await delay(80);
}

async function setInput(window, selector, value) {
  await evaluate(window, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    input.focus();
    input.select();
    return true;
  })()`);
  try {
    await window.webContents.insertText(String(value));
  } catch {
    await evaluate(window, `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + ${JSON.stringify(selector)});
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!setter) throw new Error('Input value setter is unavailable');
      setter.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(String(value))} }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      return true;
    })()`);
  }
  await delay(100);
}

async function ensureProjectCenter(window) {
  const hasNewProjectButton = await evaluate(
    window,
    `Boolean(document.querySelector('[data-testid="new-project-button"]'))`,
  );
  if (hasNewProjectButton) return;
  await click(window, '[data-testid="compact-project-more"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="menu-open-project-center"]'))`);
  await click(window, '[data-testid="menu-open-project-center"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="project-center-screen"]'))`);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-button"]'))`);
}

async function createProject(window) {
  await ensureProjectCenter(window);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-button"]'))`);
  await click(window, '[data-testid="new-project-button"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-dialog"]'))`);
  const projectName = `Issue767 U1 ${runId}`;
  await setInput(window, '[data-testid="new-project-parent-directory"]', projectParent);
  await setInput(window, '[data-testid="new-project-name"]', projectName);
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="new-project-confirm"]') && !document.querySelector('[data-testid="new-project-confirm"]').disabled)`);
  await click(window, '[data-testid="new-project-confirm"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="editor-layout"]'))`);
  await waitForExpression(window, `Boolean(document.querySelector('[data-activity="assets"]'))`);
  await click(window, '[data-activity="assets"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]'))`);
  return {
    projectName,
    projectRoot: join(projectParent, `${projectName}.pandastage`),
  };
}

function readProjectState(projectRoot) {
  const filePath = join(projectRoot, 'project.json');
  const json = readFileSync(filePath, 'utf8');
  const project = JSON.parse(json);
  return {
    jsonSha256: createHash('sha256').update(json).digest('hex'),
    assetCount: Array.isArray(project.assets) ? project.assets.length : null,
    revision: project.revision ?? null,
  };
}

async function openFlaReview(window, sourcePath) {
  process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
  await waitForExpression(window, `(() => {
    const direct = document.querySelector('[data-testid="asset-import-fla"]');
    const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
    return Boolean((direct instanceof HTMLButtonElement && !direct.disabled) || (resource instanceof HTMLButtonElement && !resource.disabled));
  })()`);
  const actionSelector = await evaluate(window, `(() => {
    const direct = document.querySelector('[data-testid="asset-import-fla"]');
    return direct instanceof HTMLButtonElement && !direct.disabled
      ? '[data-testid="asset-import-fla"]'
      : '[data-testid="resource-asset-import-fla"]';
  })()`);
  await click(window, actionSelector);
  await waitForWorkbench(window);
}

async function waitForWorkbench(window, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(window, `(() => {
      const root = document.querySelector('[data-testid="fla-review-session"]');
      const blocked = document.querySelector('[data-testid="fla-stage-f3-blocked"]');
      return {
        ready: Boolean(root && !root.hasAttribute('data-stage-a-state') && root.querySelector('[data-testid="fla-import-workbench-tabs"]')),
        error: blocked?.textContent?.trim() || '',
      };
    })()`);
    if (state.error) throw new Error(`FLA inspection did not reach the workbench: ${state.error}`);
    if (state.ready) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for the unified FLA import workbench.');
}

async function readWorkbenchFacts(window, expectedSection, sourcePath) {
  return evaluate(window, `(() => {
    const root = document.querySelector('[data-testid="fla-review-session"]');
    const tabs = [...(root?.querySelectorAll('[data-testid="fla-import-workbench-tabs"] [role="tab"]') ?? [])];
    const selectedTab = tabs.find((tab) => tab.getAttribute('aria-selected') === 'true');
    const sourcePanel = document.querySelector('#fla-source-assets-panel');
    const compositionPanel = document.querySelector('#fla-composition-panel');
    const sourceChecks = [...(sourcePanel?.querySelectorAll('input[type="checkbox"]') ?? [])];
    const visiblePanels = [sourcePanel, compositionPanel].filter((panel) =>
      panel && !panel.hidden && panel.getBoundingClientRect().width > 0 && panel.getBoundingClientRect().height > 0,
    );
    const selectedCountText = document.querySelector('[data-testid="fla-review-selected-count"]')?.textContent?.trim() ?? '';
    const selectedCount = Number(selectedCountText.match(/[0-9]+/u)?.[0] ?? -1);
    const expectedTab = ${JSON.stringify(expectedSection === 'compositions' ? 'fla-workbench-tab-compositions' : 'fla-workbench-tab-source-assets')};
    const title = root?.querySelector('[data-testid="fla-review-header"] h2')?.textContent?.trim() ?? '';
    return {
      sourceBasename: ${JSON.stringify(basename(sourcePath))},
      title,
      tabLabels: tabs.map((tab) => tab.textContent?.trim() ?? ''),
      tabCount: tabs.length,
      selectedTabTestId: selectedTab?.getAttribute('data-testid') ?? '',
      expectedSectionSelected: selectedTab?.getAttribute('data-testid') === expectedTab,
      sourceAssetsTabDisabled: document.querySelector('[data-testid="fla-workbench-tab-source-assets"]')?.disabled ?? true,
      sourcePanelVisible: Boolean(sourcePanel && !sourcePanel.hidden),
      compositionPanelVisible: Boolean(compositionPanel && !compositionPanel.hidden),
      visibleSectionCount: visiblePanels.length,
      sourceBitmapCountText: document.querySelector('[data-testid="fla-review-media-count"]')?.textContent?.trim() ?? null,
      initiallySelectedSourceItems: sourceChecks.filter((input) => input.checked).length,
      selectedCount,
      confirmDisabled: document.querySelector('[data-testid="fla-review-confirm"]')?.disabled ?? null,
      compositionEntryVisible: Boolean(document.querySelector('[data-testid="fla-workbench-tab-compositions"]')),
      outerImportCount: root?.querySelectorAll('[data-testid="fla-review-commit-success"]').length ?? 0,
    };
  })()`);
}

async function capture(window, outputPath) {
  await delay(250);
  const image = await window.capturePage();
  writeFileSync(outputPath, image.toPNG());
  const size = image.getSize();
  return { path: outputPath, width: size.width, height: size.height };
}

async function closeReview(window) {
  await click(window, '[data-testid="fla-review-cancel"]');
  await waitForExpression(window, `Boolean(document.querySelector('[data-testid="asset-browser-view"]') && !document.querySelector('[data-testid="fla-review-session"]'))`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  assert(existsSync(bluehairSource), `Bluehair source is missing: ${bluehairSource}`);
  const sourcePaths = {
    bluehairMixed: bluehairSource,
    bitmapOnly: join(runRoot, 'bitmap-only.fla'),
    vectorOnly: join(runRoot, 'vector-only.fla'),
  };
  await writeBitmapOnlyFla(sourcePaths.bitmapOnly);
  await writeVectorOnlyFla(sourcePaths.vectorOnly);
  const sourceHashesBefore = Object.fromEntries(
    Object.entries(sourcePaths).map(([key, path]) => [key, sha256File(path)]),
  );

  process.env.VITE_DEV_SERVER_URL = '';
  installInspectionCounter();
  require('../dist-electron/main/index.js');
  const window = await waitForMainWindow();
  const project = await createProject(window);
  const projectBefore = readProjectState(project.projectRoot);
  assert(projectBefore.assetCount === 0, 'Acceptance project must begin with no assets.');
  const scenarios = [];

  for (const scenario of [
    { key: 'bluehairMixed', expectedSection: 'source-assets', screenshot: 'bluehair-mixed-workbench.png' },
    { key: 'bitmapOnly', expectedSection: 'source-assets', screenshot: 'bitmap-only-workbench.png' },
    { key: 'vectorOnly', expectedSection: 'compositions', screenshot: 'vector-only-workbench.png' },
  ]) {
    const sourcePath = sourcePaths[scenario.key];
    const before = readProjectState(project.projectRoot);
    const inspectCountBefore = inspectEvents.length;
    await openFlaReview(window, sourcePath);
    const initialFacts = await readWorkbenchFacts(window, scenario.expectedSection, sourcePath);
    const inspectCountAfterOpen = inspectEvents.length;
    assert(initialFacts.title === 'FLA 导入工作台', `${scenario.key}: unexpected shell title.`);
    assert(initialFacts.tabCount === 2, `${scenario.key}: expected both import sections in one shell.`);
    assert(initialFacts.expectedSectionSelected, `${scenario.key}: unexpected default section.`);
    assert(initialFacts.visibleSectionCount === 1, `${scenario.key}: expected one visible content section.`);
    assert(initialFacts.compositionEntryVisible, `${scenario.key}: composition entry is not discoverable.`);
    assert(inspectCountAfterOpen === inspectCountBefore + 1, `${scenario.key}: expected exactly one source inspection.`);
    if (scenario.expectedSection === 'source-assets') {
      assert(initialFacts.initiallySelectedSourceItems === 0, `${scenario.key}: source assets were auto-selected.`);
      assert(initialFacts.selectedCount === 0, `${scenario.key}: initial selection count must be zero.`);
      assert(initialFacts.confirmDisabled === true, `${scenario.key}: confirm must be disabled before selection.`);
    }

    const screenshotPath = join(evidenceDir, scenario.screenshot);
    const screenshot = await capture(window, screenshotPath);
    const result = {
      sourceClass: scenario.key,
      sourceBasename: basename(sourcePath),
      sourceSha256Before: sourceHashesBefore[scenario.key],
      sourceSha256After: sha256File(sourcePath),
      initial: initialFacts,
      inspectCountBefore,
      inspectCountAfterOpen,
      screenshots: [screenshot],
    };

    if (scenario.key === 'bluehairMixed') {
      await click(window, '[data-testid="fla-workbench-tab-compositions"]');
      await waitForExpression(window, `(() => {
        const panel = document.querySelector('#fla-composition-panel');
        const tab = document.querySelector('[data-testid="fla-workbench-tab-compositions"]');
        return Boolean(panel && !panel.hidden && tab?.getAttribute('aria-selected') === 'true' && panel.querySelector('[data-testid="fla-render-workbench"]'));
      })()`);
      const compositionFacts = await readWorkbenchFacts(window, 'compositions', sourcePath);
      assert(compositionFacts.visibleSectionCount === 1, 'bluehairMixed: switching exposed more than one content section.');
      assert(inspectEvents.length === inspectCountAfterOpen, 'bluehairMixed: switching sections repeated source inspection.');
      result.compositionSection = compositionFacts;
      result.inspectCountAfterSectionSwitch = inspectEvents.length;
      result.screenshots.push(await capture(
        window,
        join(evidenceDir, 'bluehair-mixed-compositions.png'),
      ));
    }

    await closeReview(window);
    const after = readProjectState(project.projectRoot);
    assert(after.assetCount === 0, `${scenario.key}: inspection created an asset.`);
    assert(after.revision === before.revision, `${scenario.key}: inspection changed project revision.`);
    assert(after.jsonSha256 === before.jsonSha256, `${scenario.key}: inspection changed project.json.`);
    result.projectBefore = before;
    result.projectAfter = after;
    result.noProjectMutation = true;

    if (scenario.key === 'bluehairMixed') {
      const reopenProjectBefore = readProjectState(project.projectRoot);
      const inspectCountBeforeReopen = inspectEvents.length;
      await openFlaReview(window, sourcePath);
      const reopenedFacts = await readWorkbenchFacts(window, 'source-assets', sourcePath);
      const inspectCountAfterReopen = inspectEvents.length;
      assert(reopenedFacts.title === 'FLA 导入工作台', 'bluehairMixed: reopened shell title changed.');
      assert(reopenedFacts.tabCount === 2, 'bluehairMixed: reopening did not restore both sections.');
      assert(reopenedFacts.expectedSectionSelected, 'bluehairMixed: reopening did not return to source assets.');
      assert(reopenedFacts.initiallySelectedSourceItems === 0, 'bluehairMixed: reopening retained a previous selection.');
      assert(reopenedFacts.selectedCount === 0, 'bluehairMixed: reopened selection count must be zero.');
      assert(reopenedFacts.confirmDisabled === true, 'bluehairMixed: reopened confirm must remain disabled.');
      assert(inspectCountAfterReopen === inspectCountBeforeReopen + 1, 'bluehairMixed: reopening did not create one fresh inspection.');
      const reopenScreenshot = await capture(
        window,
        join(evidenceDir, 'bluehair-mixed-reopened.png'),
      );
      await closeReview(window);
      const reopenProjectAfter = readProjectState(project.projectRoot);
      assert(reopenProjectAfter.assetCount === 0, 'bluehairMixed: reopening created an asset.');
      assert(reopenProjectAfter.revision === reopenProjectBefore.revision, 'bluehairMixed: reopening changed project revision.');
      assert(reopenProjectAfter.jsonSha256 === reopenProjectBefore.jsonSha256, 'bluehairMixed: reopening changed project.json.');
      result.reopenedSession = {
        initial: reopenedFacts,
        inspectCountBefore: inspectCountBeforeReopen,
        inspectCountAfter: inspectCountAfterReopen,
        screenshot: reopenScreenshot,
        noProjectMutation: true,
      };
      result.screenshots.push(reopenScreenshot);
    }

    result.sourceSha256After = sha256File(sourcePath);
    result.sourceUnchanged = result.sourceSha256Before === result.sourceSha256After;
    assert(result.sourceUnchanged, `${scenario.key}: source FLA changed during inspection.`);
    scenarios.push(result);
  }

  const receipt = {
    schemaVersion: 'issue767-u1-electron-shell/1',
    status: 'PASS',
    runId,
    acceptanceRoot: runRoot,
    sourcePathInjection: 'PANDA_STAGE_FLA_ACCEPTANCE_SOURCE; the production Asset Library import button was used.',
    project,
    initialProject: projectBefore,
    finalProject: readProjectState(project.projectRoot),
    inspectEvents,
    scenarios,
    assertions: {
      threeSourceClassesUseSameNamedShell: scenarios.length === 3 && scenarios.every((item) => item.initial.title === 'FLA 导入工作台'),
      mixedCompositionSectionReachable: Boolean(scenarios.find((item) => item.sourceClass === 'bluehairMixed')?.compositionSection?.expectedSectionSelected),
      mixedReopenResetsSelection: Boolean(scenarios.find((item) => item.sourceClass === 'bluehairMixed')?.reopenedSession?.initial.initiallySelectedSourceItems === 0),
      firstBitmapSelectionEmpty: scenarios.filter((item) => item.initial.sourcePanelVisible).every((item) => item.initial.initiallySelectedSourceItems === 0),
      noInspectionProjectMutation: scenarios.every((item) => item.noProjectMutation),
      sourceHashesUnchanged: scenarios.every((item) => item.sourceUnchanged),
      noImportCommitted: readProjectState(project.projectRoot).assetCount === 0,
    },
    note: 'Engineering evidence only. Owner U1 review remains required; U2/U3 were not started.',
  };
  assert(Object.values(receipt.assertions).every(Boolean), 'One or more Issue #767 U1 assertions failed.');
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify({ receiptPath, evidenceDir, assertions: receipt.assertions })}\n`);
}

app.whenReady()
  .then(main)
  .catch((error) => {
    const failure = {
      schemaVersion: 'issue767-u1-electron-shell/1',
      status: 'FAIL',
      runId,
      error: error instanceof Error ? error.message : String(error),
      inspectEvents,
    };
    try {
      writeFileSync(receiptPath, `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
    } catch {
      // Preserve the original failure when acceptance storage is unavailable.
    }
    process.stderr.write(`${JSON.stringify(failure)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    setTimeout(() => app.quit(), 100);
  });
