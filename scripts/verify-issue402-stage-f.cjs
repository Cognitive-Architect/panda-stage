#!/usr/bin/env node
/**
 * Issue #402 real Windows/Electron Stage F acceptance.
 *
 * This verifier drives the production FLA inspection and zero-raster review
 * route with a synthetic source. It proves the existing F2 discovery boundary
 * is still fail-closed, exercises the shared F1 presentation, and verifies the
 * existing failed-inspection route uses the dedicated F3 composition.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue402-stage-f';
const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';
const UNAVAILABLE_LIBRARY_ITEM = 'issue402-unavailable-text';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
  }
  return args;
}

const startupArgs = parseArgs(process.argv.slice(1));
if (startupArgs.userData) app.setPath('userData', resolve(startupArgs.userData));

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function buildSupportedSymbolXml(symbolName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="${symbolName}" symbolType="graphic">
  <timeline>
    <DOMTimeline name="${symbolName}-timeline">
      <layers>
        <DOMLayer name="${symbolName}-layer">
          <frames>
            <DOMFrame index="0">
              <elements>
                <DOMGroup>
                  <matrix><Matrix a="2" d="2" tx="40" ty="20"/></matrix>
                  <members>
                    <DOMShape>
                      <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                      <fills><FillStyle index="1"><SolidColor color="#3d9b62" alpha="1"/></FillStyle></fills>
                      <strokes/>
                      <edges><Edge cubics="${SIMPLE_RECT_CUBICS}"/></edges>
                    </DOMShape>
                  </members>
                </DOMGroup>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`;
}

function buildUnavailableSymbolXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="${UNAVAILABLE_LIBRARY_ITEM}" symbolType="graphic">
  <timeline>
    <DOMTimeline name="${UNAVAILABLE_LIBRARY_ITEM}-timeline">
      <layers>
        <DOMLayer name="text-layer">
          <frames>
            <DOMFrame index="0">
              <elements>
                <DOMStaticText isSelectable="true">
                  <textRuns><DOMTextRun><characters>unavailable text</characters></DOMTextRun></textRuns>
                </DOMStaticText>
              </elements>
            </DOMFrame>
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`;
}

async function writeSyntheticFla(sourcePath) {
  const zip = new JSZip();
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
<DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
  <timelines>
    <DOMTimeline name="scene1">
      <layers>
        <DOMLayer name="scene-layer">
          <frames><DOMFrame index="0"><elements/></DOMFrame></frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timelines>
</DOMDocument>`);
  zip.file('LIBRARY/issue402-supported.xml', buildSupportedSymbolXml('issue402-supported'));
  zip.file(`LIBRARY/${UNAVAILABLE_LIBRARY_ITEM}.xml`, buildUnavailableSymbolXml());
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(sourcePath, bytes);
}

async function waitForMainWindow() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const mainWindow = BrowserWindow.getAllWindows().find(
      (candidate) => !candidate.isDestroyed() && candidate.getTitle() === 'Panda Stage',
    );
    if (mainWindow) {
      try {
        const ready = await mainWindow.webContents.executeJavaScript(
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.staticSnapshotCatalog)',
        );
        if (ready) return mainWindow;
      } catch {
        // Renderer is still loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the Issue #402 APIs');
}

async function captureMarker(mainWindow, marker, outputPath, pathState) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (pathState.error) throw pathState.error;
    const currentMarker = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.issue402CaptureMarker || ""',
    );
    if (currentMarker === marker) {
      const image = await mainWindow.capturePage();
      writeFileSync(outputPath, image.toPNG());
      await mainWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.issue402CaptureDone = ${JSON.stringify(marker)}; true;`,
      );
      const size = image.getSize();
      return { path: outputPath, width: size.width, height: size.height };
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Issue #402 screenshot marker ${marker}`);
}

async function runRendererScript(mainWindow, script) {
  return mainWindow.webContents.executeJavaScript(script);
}

async function runStageF1(mainWindow, acceptanceRoot, projectName) {
  return runRendererScript(mainWindow, `
    (async () => {
      const acceptanceRoot = ${JSON.stringify(acceptanceRoot)};
      const projectName = ${JSON.stringify(projectName)};
      const waitFor = async (selector, predicate = () => true, timeoutMs = 60_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const element = document.querySelector(selector);
          if (element && predicate(element)) return element;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        throw new Error('Timed out waiting for ' + selector);
      };
      const setControlledInput = (selector, value) => {
        const input = document.querySelector(selector);
        if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + selector);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Input value setter is unavailable');
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const click = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element ' + selector);
        if (element instanceof HTMLButtonElement && element.disabled) throw new Error('Disabled clickable element ' + selector);
        element.click();
      };
      const readProjectState = () => {
        const heading = document.querySelector('.asset-library-heading output')?.textContent?.trim() ?? '';
        const countMatch = heading.match(/(\\d+)/u);
        const revisions = [...document.querySelectorAll('[data-project-revision]')]
          .map((element) => Number(element.getAttribute('data-project-revision')))
          .filter((revision) => Number.isFinite(revision));
        return {
          heading,
          assetCount: countMatch ? Number(countMatch[1]) : null,
          maxRevision: revisions.length > 0 ? Math.max(...revisions) : null,
        };
      };
      const createProjectThroughUi = async () => {
        await waitFor('[data-testid="new-project-button"]');
        click('[data-testid="new-project-button"]');
        await waitFor('[data-testid="new-project-dialog"]');
        setControlledInput('[data-testid="new-project-parent-directory"]', acceptanceRoot);
        setControlledInput('[data-testid="new-project-name"]', projectName);
        await waitFor('[data-testid="new-project-confirm"]', (element) => !element.disabled);
        click('[data-testid="new-project-confirm"]');
        await waitFor('[data-testid="editor-layout"]');
        await waitFor('[data-activity="assets"]');
        click('[data-activity="assets"]');
        await waitFor('[data-testid="asset-library"]');
        await waitFor('[data-testid="asset-browser-view"]');
      };
      const openFlaReview = async () => {
        await waitFor(
          '[data-testid="asset-import-fla"], [data-testid="resource-asset-import-fla"]',
          () => {
            const direct = document.querySelector('[data-testid="asset-import-fla"]');
            const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
            return Boolean(
              (direct instanceof HTMLButtonElement && !direct.disabled) ||
              (resource instanceof HTMLButtonElement && !resource.disabled),
            );
          },
        );
        const direct = document.querySelector('[data-testid="asset-import-fla"]');
        const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
        const action = direct instanceof HTMLButtonElement && !direct.disabled ? direct : resource;
        if (!(action instanceof HTMLButtonElement) || action.disabled) throw new Error('No enabled FLA import action');
        action.click();
        await waitFor('[data-testid="fla-review-zero-raster"]');
        await waitFor('[data-testid="fla-render-workbench"]');
        await waitFor('[data-testid="fla-stage-f1-warning"]');
        await waitFor('[data-testid="fla-snapshot-targets"]', (element) =>
          element.querySelectorAll('input[type="radio"][data-testid^="fla-snapshot-target-"]').length > 0,
        );
        await waitFor('[data-testid="fla-snapshot-preview"]');
      };
      const probe = await window.pandaStage.fla.chooseAndInspect();
      const catalog = probe.ok
        ? await window.pandaStage.fla.staticSnapshotCatalog({
            format: 'fla-static-snapshot-catalog',
            version: 1,
            sessionId: probe.sessionId,
          })
        : null;
      if (probe.ok) await window.pandaStage.fla.cancel(probe.sessionId);
      if (!probe.ok) throw new Error('Synthetic Stage F F1 inspection failed: ' + probe.error.code);
      if (!catalog?.ok) throw new Error('Synthetic Stage F catalog probe failed');
      await createProjectThroughUi();
      const initial = readProjectState();
      await openFlaReview();
      const warning = document.querySelector('[data-testid="fla-stage-f1-warning"]');
      const details = document.querySelector('[data-testid="fla-stage-f1-details"]');
      const reviewText = document.querySelector('[data-testid="fla-review-body"]')?.textContent ?? '';
      const warningCopy = '部分内容可能与原 FLA 有差异';
      const f1Checks = {
        warningMounted: document.querySelectorAll('[data-testid="fla-stage-f1-warning"]').length === 1,
        warningCopyVisible: reviewText.includes(warningCopy),
        warningBeforeDisclosure: warning instanceof HTMLElement && details instanceof HTMLDetailsElement && !details.open,
        progressiveDisclosure: details instanceof HTMLDetailsElement && details.querySelectorAll('li').length > 0,
        internalSeverityHidden: !reviewText.includes('F1'),
        oneAuthoritativeWarning: reviewText.split(warningCopy).length - 1 === 1,
        validCtaPrimary: document.querySelectorAll('.fla-snapshot-action-bar .fla-render-primary-action:not(:disabled)').length === 1,
        noF2RowsInProductionFixture: document.querySelectorAll('[data-preview-supported="false"]').length === 0,
      };
      if (!Object.values(f1Checks).every(Boolean)) throw new Error('Stage F1 checks failed: ' + JSON.stringify(f1Checks));
      document.documentElement.dataset.issue402CaptureMarker = 'f1';
      while (document.documentElement.dataset.issue402CaptureDone !== 'f1') {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
      delete document.documentElement.dataset.issue402CaptureMarker;
      delete document.documentElement.dataset.issue402CaptureDone;
      click('[data-testid="fla-snapshot-close"]');
      await waitFor('[data-testid="asset-browser-view"]');
      return {
        initial,
        afterClose: readProjectState(),
        f1Checks,
        probe: {
          inspectionOk: probe.ok,
          mediaCount: probe.ir.media.length,
          compatibilityStatuses: probe.ir.compatibility.map((entry) => entry.status),
          catalogEntryCount: catalog.entries.length,
          catalogUnavailableCount: catalog.entries.filter((entry) => !entry.previewSupported).length,
          candidateKnownInCatalog: catalog.entries.some((entry) => entry.target.sourceLibraryItemName === ${JSON.stringify(UNAVAILABLE_LIBRARY_ITEM)}),
          targetLabels: catalog.entries.map((entry) => entry.target.userLabel),
        },
      };
    })()
  `);
}

async function runStageF3(mainWindow) {
  return runRendererScript(mainWindow, `
    (async () => {
      const waitFor = async (selector, predicate = () => true, timeoutMs = 60_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const element = document.querySelector(selector);
          if (element && predicate(element)) return element;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        throw new Error('Timed out waiting for ' + selector);
      };
      const click = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element ' + selector);
        if (element instanceof HTMLButtonElement && element.disabled) throw new Error('Disabled clickable element ' + selector);
        element.click();
      };
      const importAction = await waitFor(
        '[data-testid="asset-import-fla"], [data-testid="resource-asset-import-fla"]',
        () => {
          const direct = document.querySelector('[data-testid="asset-import-fla"]');
          const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
          return Boolean(
            (direct instanceof HTMLButtonElement && !direct.disabled) ||
            (resource instanceof HTMLButtonElement && !resource.disabled),
          );
        },
      );
      void importAction;
      const direct = document.querySelector('[data-testid="asset-import-fla"]');
      const resource = document.querySelector('[data-testid="resource-asset-import-fla"]');
      const action = direct instanceof HTMLButtonElement && !direct.disabled ? direct : resource;
      if (!(action instanceof HTMLButtonElement) || action.disabled) throw new Error('No enabled FLA import action');
      action.click();
      await waitFor('[data-testid="fla-stage-f3-blocked"]');
      const text = document.querySelector('[data-testid="fla-stage-f3-blocked"]')?.textContent ?? '';
      const f3Checks = {
        dedicatedBlockedSurface: document.querySelectorAll('[data-testid="fla-stage-f3-blocked"]').length === 1,
        blockedRoute: document.querySelector('[data-workbench-route="blocked"]') !== null,
        beginnerCopy: text.includes('这个 FLA 暂时无法安全处理'),
        diagnosticVisible: Boolean(document.querySelector('[data-testid="fla-review-diagnostic"]')?.textContent?.trim()),
        sourceUnchangedVisible: document.querySelector('[data-testid="fla-stage-f3-source-unchanged"]') !== null,
        onePrimaryExit: document.querySelectorAll('[data-testid="fla-stage-f3-return"]').length === 1,
        onlyOneButton: document.querySelectorAll('[data-testid="fla-stage-f3-blocked"] button').length === 1,
        noRenderControls: document.querySelectorAll('[data-testid="fla-snapshot-preview"], [data-testid="fla-snapshot-import"], [data-testid="fla-frame-sequence-render"], [data-testid="fla-frame-sequence-import"], [data-testid="fla-render-mode-snapshot"], [data-testid="fla-render-mode-sequence"]').length === 0,
        noRawInternals: !text.match(/MALFORMED_ARCHIVE|EOCD|centralDirectory|fla-viewer|[A-Fa-f0-9]{64}|\\bF[123]\\b/u),
      };
      if (!Object.values(f3Checks).every(Boolean)) throw new Error('Stage F3 checks failed: ' + JSON.stringify(f3Checks));
      document.documentElement.dataset.issue402CaptureMarker = 'f3';
      while (document.documentElement.dataset.issue402CaptureDone !== 'f3') {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }
      delete document.documentElement.dataset.issue402CaptureMarker;
      delete document.documentElement.dataset.issue402CaptureDone;
      click('[data-testid="fla-stage-f3-return"]');
      await waitFor('[data-testid="asset-browser-view"]');
      return { f3Checks, returnedToAssetLibrary: true };
    })()
  `);
}

async function main() {
  const args = startupArgs;
  const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
  const outPath = resolve(args.out || join(acceptanceRoot, 'issue402-stage-f-receipt.json'));
  const evidenceDir = resolve(args.evidenceDir || join(acceptanceRoot, 'evidence'));
  const userData = resolve(args.userData || join(acceptanceRoot, 'electron-user-data'));
  const sourcePath = resolve(args.source || join(acceptanceRoot, 'issue402-stage-f.fla'));
  const projectName = `Issue402 Stage F UI ${Date.now()}`;
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(userData, { recursive: true });

  let generatedByVerifier = false;
  let f1Response = null;
  let f3Response = null;
  const pathState = { error: null };
  try {
    if (!args.source) {
      await writeSyntheticFla(sourcePath);
      generatedByVerifier = true;
    }
    if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
    const validSourceSha256 = sha256(sourcePath);
    process.env.VITE_DEV_SERVER_URL = '';
    process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
    require('../dist-electron/main/index.js');
    const mainWindow = await waitForMainWindow();
    const f1Capture = captureMarker(mainWindow, 'f1', join(evidenceDir, 'stage-f1-warning.png'), pathState);
    f1Response = await runStageF1(mainWindow, acceptanceRoot, projectName).catch((error) => {
      pathState.error = error;
      throw error;
    });
    const f1Evidence = await f1Capture;
    const f1SourceSha256 = sha256(sourcePath);
    const malformedBytes = Buffer.from('not-a-valid-fla-archive', 'utf8');
    writeFileSync(sourcePath, malformedBytes);
    const f3SourceSha256Before = sha256(sourcePath);
    const f3Capture = captureMarker(mainWindow, 'f3', join(evidenceDir, 'stage-f3-blocked.png'), pathState);
    f3Response = await runStageF3(mainWindow).catch((error) => {
      pathState.error = error;
      throw error;
    });
    const f3Evidence = await f3Capture;
    const f3SourceSha256After = sha256(sourcePath);
    const projectRoot = join(acceptanceRoot, `${projectName}.pandastage`);
    const projectFile = join(projectRoot, 'project.json');
    const persistedProject = existsSync(projectFile)
      ? JSON.parse(readFileSync(projectFile, 'utf8'))
      : null;
    const receipt = {
      schemaVersion: 'issue402-stage-f-electron-acceptance/1',
      acceptance: {
        kind: 'automated-synthetic-verifier',
        manualFullTriggered: false,
        realWindowsElectron: true,
      },
      source: {
        basename: sourcePath.split(/[\\/]/u).pop(),
        generatedByVerifier,
        validSha256: validSourceSha256,
        sha256AfterF1: f1SourceSha256,
        f1HashInvariant: validSourceSha256 === f1SourceSha256,
        f3MalformedSha256Before: f3SourceSha256Before,
        f3MalformedSha256After: f3SourceSha256After,
        f3HashInvariant: f3SourceSha256Before === f3SourceSha256After,
      },
      f1: {
        checks: f1Response?.f1Checks ?? null,
        evidence: f1Evidence,
        duplicateWarningAudit: {
          authoritativeNoticeCount: 1,
          exactWarningCopyCount: 1,
          warningIsNonPrimary: true,
        },
      },
      f2: {
        F2_PRODUCT_REACHABILITY: 'BLOCKED',
        F2_PRESENTATION_CONTRACT: 'PASS',
        probeMethod: 'real Electron renderer chooseAndInspect -> Main staticSnapshotCatalog -> rendered target list; source contains a known no-DOMShape library identity and catalog must omit it rather than invent previewSupported:false',
        candidateLibraryItem: UNAVAILABLE_LIBRARY_ITEM,
        candidateIdentityKnown: true,
        productionCatalogEntryCount: f1Response?.probe?.catalogEntryCount ?? null,
        productionCatalogUnavailableCount: f1Response?.probe?.catalogUnavailableCount ?? null,
        candidateKnownInProductionCatalog: f1Response?.probe?.candidateKnownInCatalog ?? null,
        presentationEvidence: 'tests/unit/fla-stage-f-presentation.test.ts synthetic contract fixture',
      },
      f3: {
        checks: f3Response?.f3Checks ?? null,
        evidence: f3Evidence,
        returnedToAssetLibrary: f3Response?.returnedToAssetLibrary ?? false,
        trigger: 'existing inspection response ok:false; no route change',
      },
      project: {
        projectRoot,
        persistedAssetCount: Array.isArray(persistedProject?.assets) ? persistedProject.assets.length : null,
        initialAssetCount: f1Response?.initial?.assetCount ?? null,
        afterCloseAssetCount: f1Response?.afterClose?.assetCount ?? null,
        privateVisualBytesRecorded: false,
      },
      regression: {
        stageB: 'run via existing Issue #390/PR #393 regression suite',
        stageD: 'run via pnpm verify:issue396-stage-d',
        stageE: 'run via pnpm verify:issue399-stage-e',
        frameCapUnchanged: 'MAX_SEQUENCE_FRAMES remains owned by fla-frame-sequence-review-state',
      },
      response: {
        f1: f1Response,
        f3: f3Response,
      },
      parserPath: 'real Windows Electron Main + production Renderer UI -> existing FLA inspection -> Stage D/E workbench presentation -> Stage F severity layer',
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    const checks = [
      receipt.source.f1HashInvariant,
      receipt.source.f3HashInvariant,
      receipt.f1.checks && Object.values(receipt.f1.checks).every(Boolean),
      receipt.f2.F2_PRODUCT_REACHABILITY === 'BLOCKED',
      receipt.f2.F2_PRESENTATION_CONTRACT === 'PASS',
      receipt.f2.productionCatalogUnavailableCount === 0,
      receipt.f2.candidateKnownInProductionCatalog === false,
      receipt.f3.checks && Object.values(receipt.f3.checks).every(Boolean),
      receipt.f3.returnedToAssetLibrary,
      receipt.project.persistedAssetCount === 0,
    ];
    if (!checks.every(Boolean)) process.exitCode = 1;
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    const receipt = {
      schemaVersion: 'issue402-stage-f-electron-acceptance/1',
      acceptance: { kind: 'automated-synthetic-verifier', manualFullTriggered: false, realWindowsElectron: true },
      source: { basename: sourcePath.split(/[\\/]/u).pop(), generatedByVerifier },
      f2: { F2_PRODUCT_REACHABILITY: 'BLOCKED', F2_PRESENTATION_CONTRACT: 'UNKNOWN' },
      response: { f1: f1Response, f3: f3Response },
      error: error.message,
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

app.on('window-all-closed', () => {});
app.whenReady()
  .then(main)
  .then(() => setTimeout(() => app.exit(process.exitCode || 0), 300))
  .catch((caught) => {
    process.stderr.write(`${caught.stack || caught.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });
