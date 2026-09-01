#!/usr/bin/env node
/**
 * Issue #399 real Windows/Electron Stage E acceptance, extended by Issue #400
 * with bounded default-range assertions and a separate manual handoff mode.
 *
 * Creates an external zero-raster FLA with a long render-target catalog and
 * drives the production sequence workbench through the real Electron UI. The
 * receipt contains only bounded UI/project metadata; source and rendered
 * visual bytes stay in the caller-provided acceptance directory.
 */

'use strict';

const { app, BrowserWindow } = require('electron');
const { createHash } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, resolve } = require('node:path');
const JSZip = require('jszip');

const DEFAULT_ACCEPTANCE_ROOT = 'D:\\PandaStage-Acceptance\\issue399-stage-e';
const SYNTHETIC_TARGET_COUNT = 25;
const RANGE_TARGET_FRAME_COUNT = 30;
const SIMPLE_RECT_CUBICS = '!0 0|100 0|100 100|0 100|0 0';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--source') args.source = argv[++index];
    else if (argv[index] === '--out') args.out = argv[++index];
    else if (argv[index] === '--acceptance-root') args.acceptanceRoot = argv[++index];
    else if (argv[index] === '--user-data') args.userData = argv[++index];
    else if (argv[index] === '--evidence-dir') args.evidenceDir = argv[++index];
    else if (argv[index] === '--manual') args.manual = true;
    else if (argv[index] === '--keep-open') args.keepOpen = true;
  }
  return args;
}

// Set the isolated Electron profile before Chromium starts. This prevents a
// previous manual acceptance app using the default profile from delaying the
// ready event or sharing profile locks with this verifier.
const startupArgs = parseArgs(process.argv.slice(1));
if (startupArgs.userData) {
  app.setPath('userData', resolve(startupArgs.userData));
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function buildSymbolXml(symbolName, color, offset, frameCount) {
  const frames = Array.from({ length: frameCount }, (_, frameIndex) => `
            <DOMFrame index="${frameIndex}">
              <DOMGroup>
                <matrix><Matrix a="2" d="2" tx="${offset + frameIndex * 2}" ty="20"/></matrix>
                <members>
                  <DOMShape>
                    <matrix><Matrix a="1" d="1" tx="0" ty="0"/></matrix>
                    <fills>
                      <FillStyle index="1"><SolidColor color="${color}" alpha="1"/></FillStyle>
                    </fills>
                    <strokes/>
                    <edges><Edge cubics="${SIMPLE_RECT_CUBICS}"/></edges>
                  </DOMShape>
                </members>
              </DOMGroup>
            </DOMFrame>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<DOMSymbolItem xmlns="http://ns.adobe.com/xfl/2008/" name="${symbolName}" symbolType="graphic">
  <timeline>
    <DOMTimeline name="${symbolName}-timeline">
      <layers>
        <DOMLayer name="${symbolName}-layer">
          <frames>${frames}
          </frames>
        </DOMLayer>
      </layers>
    </DOMTimeline>
  </timeline>
</DOMSymbolItem>`;
}

async function writeSyntheticZeroRasterFla(sourcePath) {
  const zip = new JSZip();
  const targetNames = Array.from({ length: SYNTHETIC_TARGET_COUNT }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    if (index === 0) return `issue399-target-${ordinal}-range-cap`;
    if (index === SYNTHETIC_TARGET_COUNT - 1) return `issue399-target-${ordinal}-long-readable-name`;
    return `issue399-target-${ordinal}`;
  });
  zip.file('DOMDocument.xml', `<?xml version="1.0" encoding="UTF-8"?>
 <DOMDocument xmlns="http://ns.adobe.com/xfl/2008/" width="640" height="360" frameRate="30">
   <timelines>
     <DOMTimeline name="scene1">
       <layers>
         <DOMLayer name="scene-layer">
           <frames>
             <DOMFrame index="0">
               <elements/>
             </DOMFrame>
           </frames>
         </DOMLayer>
       </layers>
     </DOMTimeline>
   </timelines>
 </DOMDocument>`);
  targetNames.forEach((targetName, index) => {
    zip.file(
      `LIBRARY/${targetName}.xml`,
      buildSymbolXml(
        targetName,
        index % 2 === 0 ? '#3d9b62' : '#4d82c4',
        index * 3,
        index === 0 ? RANGE_TARGET_FRAME_COUNT : 3,
      ),
    );
  });
  const bytes = await zip.generateAsync({ type: 'nodebuffer' });
  writeFileSync(sourcePath, bytes);
  return sha256(sourcePath);
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
          'Boolean(window.pandaStage?.project?.createAt && window.pandaStage?.fla?.chooseAndInspect && window.pandaStage?.fla?.frameSequenceRender && window.pandaStage?.fla?.frameSequenceCancel && window.pandaStage?.fla?.frameSequenceCommit && window.pandaStage?.fla?.frameSequenceProgressSubscribe)',
        );
        if (ready) return mainWindow;
      } catch {
        // The production renderer may still be loading.
      }
    }
    await delay(100);
  }
  throw new Error('Panda Stage main window did not expose the Issue #399 R2 APIs');
}

async function captureScreenshotAtMarker(mainWindow, marker, outputPath, pathState) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (pathState?.error) throw pathState.error;
    const currentMarker = await mainWindow.webContents.executeJavaScript(
      'document.documentElement.dataset.issue399CaptureMarker || ""',
    );
    if (currentMarker === marker) {
      const image = await mainWindow.capturePage();
      writeFileSync(outputPath, image.toPNG());
      await mainWindow.webContents.executeJavaScript(
        `document.documentElement.dataset.issue399CaptureDone = ${JSON.stringify(marker)}; true;`,
      );
      const size = image.getSize();
      return { path: outputPath, width: size.width, height: size.height };
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for Stage E screenshot marker ${marker}`);
}

async function sendRealInput(mainWindow, selector, value) {
  await mainWindow.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + ${JSON.stringify(selector)});
    input.focus();
    input.select();
    input.scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  })()`);
  // The renderer-side select() must remain active until
  // webContents.insertText replaces the value; a second mouse click would
  // collapse the selection and append to the controlled number.
  let inserted = false;
  try {
    await mainWindow.webContents.insertText(value);
    inserted = true;
  } catch {
    // Fall back to the explicit key sequence on older Electron builds.
  }
  if (!inserted) {
    for (const character of value) {
      mainWindow.webContents.sendInputEvent({ type: 'keyDown', keyCode: character });
      mainWindow.webContents.sendInputEvent({ type: 'char', keyCode: character });
      mainWindow.webContents.sendInputEvent({ type: 'keyUp', keyCode: character });
    }
  }
  await delay(75);
}

async function pumpRealInputRequests(mainWindow, pathState) {
  let handledRequestId = null;
  const deadline = Date.now() + 180_000;
  while (!pathState.done && !pathState.error && Date.now() < deadline) {
    const request = await mainWindow.webContents.executeJavaScript(`(() => {
      const raw = document.documentElement.dataset.issue399InputRequest;
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    })()`);
    if (request && request.id !== handledRequestId) {
      await sendRealInput(mainWindow, request.selector, request.value);
      const applied = await mainWindow.webContents.executeJavaScript(`(() => {
        const input = document.querySelector(${JSON.stringify(request.selector)});
        const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
        const stateKey = ${JSON.stringify(request.selector)}.includes('fla-frame-sequence-start')
          ? 'rangeStart'
          : 'rangeEnd';
        return input instanceof HTMLInputElement && input.value === ${JSON.stringify(request.value)} &&
          range instanceof HTMLElement && range.dataset[stateKey] === ${JSON.stringify(request.value)};
      })()`);
      if (applied) {
        await mainWindow.webContents.executeJavaScript(
          `document.documentElement.dataset.issue399InputAck = ${JSON.stringify(request.id)}; true;`,
        );
        handledRequestId = request.id;
      }
    }
    await delay(50);
  }
}

async function runStageEPath(mainWindow, acceptanceRoot, projectName, { manualAcceptance = false } = {}) {
  return mainWindow.webContents.executeJavaScript(`
    (async () => {
      const acceptanceRoot = ${JSON.stringify(acceptanceRoot)};
      const projectName = ${JSON.stringify(projectName)};
      const isManualAcceptance = ${manualAcceptance ? 'true' : 'false'};
      const maxSequenceFrames = ${MAX_SEQUENCE_FRAMES_PLACEHOLDER};
      const delay = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

      const waitFor = async (selector, predicate = () => true, timeoutMs = 60_000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const element = document.querySelector(selector);
          if (element && predicate(element)) return element;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
        }
        if (selector.includes('fla-frame-sequence-render')) {
          const rangeStart = document.querySelector('[data-testid="fla-frame-sequence-start"]');
          const rangeEnd = document.querySelector('[data-testid="fla-frame-sequence-end"]');
          const rangeError = document.querySelector('[data-testid="fla-frame-sequence-range-error"]');
          const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
          const button = document.querySelector('[data-testid="fla-frame-sequence-render"]');
          const review = document.querySelector('[data-testid="fla-frame-sequence-review"]');
          throw new Error('Timed out waiting for ' + selector + '; range=' + JSON.stringify({
            start: rangeStart instanceof HTMLInputElement ? rangeStart.value : null,
            end: rangeEnd instanceof HTMLInputElement ? rangeEnd.value : null,
            error: rangeError?.textContent?.trim() ?? null,
            disabled: button instanceof HTMLButtonElement ? button.disabled : null,
            phase: review?.getAttribute('data-preview-state') ?? null,
            stateStart: range instanceof HTMLElement ? range.dataset.rangeStart : null,
            stateEnd: range instanceof HTMLElement ? range.dataset.rangeEnd : null,
          }));
        }
        throw new Error('Timed out waiting for ' + selector);
      };

      let inputRequestId = 0;
      const setControlledInput = async (selector, value) => {
        const input = document.querySelector(selector);
        if (!(input instanceof HTMLInputElement)) throw new Error('Missing input ' + selector);
        if (input.value === value) return;
        if (selector.includes('fla-frame-sequence-start') || selector.includes('fla-frame-sequence-end')) {
          const requestId = String(++inputRequestId);
          document.documentElement.dataset.issue399InputRequest = JSON.stringify({
            id: requestId,
            selector,
            value,
          });
          const deadline = Date.now() + 10_000;
          while (document.documentElement.dataset.issue399InputAck !== requestId) {
            if (Date.now() >= deadline) {
              throw new Error('Timed out applying real input ' + selector + '; value=' + input.value + '; ack=' + (document.documentElement.dataset.issue399InputAck ?? ''));
            }
            await delay(25);
          }
          await delay(250);
          const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
          const stateKey = selector.includes('fla-frame-sequence-start') ? 'rangeStart' : 'rangeEnd';
          if (!(range instanceof HTMLElement) || range.dataset[stateKey] !== value) {
            throw new Error('Real input was reset before completion ' + selector + '; requested=' + value + '; state=' + (range instanceof HTMLElement ? range.dataset[stateKey] : 'missing'));
          }
          delete document.documentElement.dataset.issue399InputRequest;
          delete document.documentElement.dataset.issue399InputAck;
          return;
        }
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Input value setter is unavailable');
        input.focus();
        input.select();
        const inserted = document.execCommand('insertText', false, value);
        if (!inserted || input.value !== value) {
          setter.call(input, value);
          input.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: value,
          }));
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.blur();
      };

      const click = (selector) => {
        const element = document.querySelector(selector);
        if (!(element instanceof HTMLElement)) throw new Error('Missing clickable element ' + selector);
        if (element instanceof HTMLButtonElement && element.disabled) {
          throw new Error('Clickable element is disabled ' + selector);
        }
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
          gridCount: Number(document.querySelector('[data-grid-count]')?.getAttribute('data-grid-count') ?? -1),
          maxRevision: revisions.length > 0 ? Math.max(...revisions) : null,
          revisions,
        };
      };

      const waitForCapture = async (marker) => {
        document.documentElement.dataset.issue399CaptureMarker = marker;
        while (document.documentElement.dataset.issue399CaptureDone !== marker) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
        }
        delete document.documentElement.dataset.issue399CaptureMarker;
        delete document.documentElement.dataset.issue399CaptureDone;
      };

      const createProjectThroughUi = async () => {
        await waitFor('[data-testid="new-project-button"]');
        click('[data-testid="new-project-button"]');
        await waitFor('[data-testid="new-project-dialog"]');
        await setControlledInput('[data-testid="new-project-parent-directory"]', acceptanceRoot);
        await setControlledInput('[data-testid="new-project-name"]', projectName);
        await waitFor('[data-testid="new-project-confirm"]', (element) => !element.disabled);
        click('[data-testid="new-project-confirm"]');
        await waitFor('[data-testid="editor-layout"]');
        await waitFor('[data-activity="assets"]');
        click('[data-activity="assets"]');
        await waitFor('[data-testid="asset-library"]');
        await waitFor('[data-testid="asset-browser-view"]');
      };

      const openSequenceReview = async () => {
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
        if (!(action instanceof HTMLButtonElement) || action.disabled) {
          throw new Error('No enabled FLA import action is available');
        }
        action.click();
        await waitFor('[data-testid="fla-review-zero-raster"]');
        await waitFor('[data-testid="fla-render-workbench"]');
        click('[data-testid="fla-render-mode-sequence"]');
        await waitFor('[data-testid="fla-frame-sequence-review"]');
        await waitFor('[data-testid="fla-frame-sequence-range"]');
        await waitFor('[data-testid="fla-frame-sequence-targets"]', (element) =>
          element.querySelectorAll('input[type="radio"][data-testid^="fla-frame-sequence-target-"]').length > 0,
        );
      };

      const readLayout = () => {
        const rectData = (element) => {
          if (!(element instanceof Element)) return null;
          const rect = element.getBoundingClientRect();
          return {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
        };
        const targetList = document.querySelector('[data-testid="fla-frame-sequence-targets"]');
        const targetRows = targetList ? [...targetList.querySelectorAll('li')].filter(
          (row) => row.querySelector('input[data-testid^="fla-frame-sequence-target-"]'),
        ) : [];
        const filmstrip = document.querySelector('[data-testid="fla-frame-sequence-filmstrip"]');
        const reviewBody = document.querySelector('[data-testid="fla-review-body"]');
        const listStyle = targetList ? getComputedStyle(targetList) : null;
        const bodyStyle = reviewBody ? getComputedStyle(reviewBody) : null;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          session: rectData(document.querySelector('[data-testid="fla-review-session"]')),
          workbench: rectData(document.querySelector('[data-testid="fla-render-workbench"]')),
          header: rectData(document.querySelector('[data-testid="fla-render-workbench-header"]')),
          range: rectData(document.querySelector('[data-testid="fla-frame-sequence-range"]')),
          preview: rectData(document.querySelector('[data-testid="fla-frame-sequence-preview-area"]')),
          actionBar: rectData(document.querySelector('[data-testid="fla-frame-sequence-action-bar"]')),
          targetList: {
            rect: rectData(targetList),
            scrollHeight: targetList?.scrollHeight ?? 0,
            clientHeight: targetList?.clientHeight ?? 0,
            scrollTop: targetList?.scrollTop ?? 0,
            overflowY: listStyle?.overflowY ?? '',
            firstTarget: rectData(targetRows[0]),
            lastTarget: rectData(targetRows[targetRows.length - 1]),
            rowCount: targetRows.length,
          },
          filmstrip: {
            rect: rectData(filmstrip),
            scrollWidth: filmstrip?.scrollWidth ?? 0,
            clientWidth: filmstrip?.clientWidth ?? 0,
            scrollLeft: filmstrip?.scrollLeft ?? 0,
            overflowX: filmstrip ? getComputedStyle(filmstrip).overflowX : '',
            firstFrame: rectData(document.querySelector('[data-testid="fla-frame-sequence-filmstrip-item-0"]')),
            lastFrame: rectData(document.querySelector('[data-testid="fla-frame-sequence-filmstrip-item-23"]')),
          },
          reviewBody: {
            rect: rectData(reviewBody),
            scrollHeight: reviewBody?.scrollHeight ?? 0,
            clientHeight: reviewBody?.clientHeight ?? 0,
            overflowY: bodyStyle?.overflowY ?? '',
          },
          documentScrollHeight: document.documentElement.scrollHeight,
          documentClientHeight: document.documentElement.clientHeight,
          primaryActionCount: document.querySelectorAll(
            '.fla-frame-sequence-action-bar .fla-render-primary-action',
          ).length,
        };
      };

      const reviewState = () => document.querySelector('[data-testid="fla-frame-sequence-review"]')?.getAttribute('data-preview-state') ?? '';
      const importButtonCount = () => document.querySelectorAll('[data-testid="fla-frame-sequence-import"]').length;
      const readRangeState = () => {
        const startInput = document.querySelector('[data-testid="fla-frame-sequence-start"]');
        const endInput = document.querySelector('[data-testid="fla-frame-sequence-end"]');
        const range = document.querySelector('[data-testid="fla-frame-sequence-range"]');
        const rangeError = document.querySelector('[data-testid="fla-frame-sequence-range-error"]');
        const renderButton = document.querySelector('[data-testid="fla-frame-sequence-render"]');
        const selectedRadio = document.querySelector('[data-testid^="fla-frame-sequence-target-"]:checked');
        const selectedRow = selectedRadio?.closest('li');
        const frameCountText = selectedRow?.querySelector('.fla-frame-sequence-target-copy small')?.textContent ?? '';
        const targetFrameCount = Number(frameCountText.match(/\\d+/u)?.[0] ?? NaN);
        const startValue = startInput instanceof HTMLInputElement ? startInput.value : '';
        const endValue = endInput instanceof HTMLInputElement ? endInput.value : '';
        const startFrameIndex = Number(startValue);
        const endFrameIndex = Number(endValue);
        const rangeValid = Number.isInteger(startFrameIndex) && Number.isInteger(endFrameIndex) &&
          startFrameIndex >= 0 && endFrameIndex >= startFrameIndex && endFrameIndex < targetFrameCount &&
          endFrameIndex - startFrameIndex + 1 <= maxSequenceFrames && rangeError === null;
        return {
          startFrameIndex,
          endFrameIndex,
          startValue,
          endValue,
          targetFrameCount,
          rangeValid,
          renderButtonEnabled: renderButton instanceof HTMLButtonElement && !renderButton.disabled,
          rangeError: rangeError?.textContent?.trim() ?? null,
          stateStart: range instanceof HTMLElement ? range.dataset.rangeStart ?? null : null,
          stateEnd: range instanceof HTMLElement ? range.dataset.rangeEnd ?? null : null,
        };
      };
      const importButtonEnabled = () => {
        const button = document.querySelector('[data-testid="fla-frame-sequence-import"]');
        return button instanceof HTMLButtonElement && !button.disabled;
      };
      const isViewportVisible = (rect) => Boolean(
        rect && rect.top >= -1 && rect.bottom <= window.innerHeight + 1 &&
        rect.left >= -1 && rect.right <= window.innerWidth + 1,
      );
      const isInside = (child, parent) => Boolean(
        child && parent && child.top >= parent.top - 1 && child.bottom <= parent.bottom + 1 &&
        child.left >= parent.left - 1 && child.right <= parent.right + 1,
      );

      await createProjectThroughUi();
      const initial = readProjectState();
      await openSequenceReview();
      await delay(100);
      const initialDefaultRange = readRangeState();

      if (isManualAcceptance) {
        await waitFor('[data-testid="fla-frame-sequence-render"]', (element) =>
          element instanceof HTMLButtonElement && !element.disabled,
          10_000,
        );
        const manualInitialRange = readRangeState();
        const selectedRadio = document.querySelector('[data-testid^="fla-frame-sequence-target-"]:checked');
        const selectedRow = selectedRadio?.closest('li');
        return {
          ok: manualInitialRange.rangeValid && manualInitialRange.renderButtonEnabled,
          acceptanceKind: 'maintainer-manual-acceptance',
          selectedTargetId: selectedRadio?.getAttribute('data-testid') ?? null,
          selectedTargetLabel: selectedRow?.querySelector('strong')?.textContent?.trim() ?? null,
          targetFrameCount: manualInitialRange.targetFrameCount,
          initialRange: manualInitialRange,
          projectName,
          projectRoot: acceptanceRoot + '\\\\' + projectName + '.pandastage',
          projectMutation: 'NO_PREVIEW; NO_IMPORT; MANUAL_ACCEPTANCE_WINDOW_LEFT_OPEN',
        };
      }

      const targetCount = Number((document.querySelector('[data-testid="fla-frame-sequence-target-count"]')?.textContent ?? '').match(/\\d+/u)?.[0] ?? 0);
      const targetLabels = [...document.querySelectorAll('[data-testid="fla-frame-sequence-targets"] li strong')]
        .map((element) => element.textContent?.trim() ?? '')
        .filter(Boolean);
      const supportedRadios = () => [...document.querySelectorAll('input[type="radio"][data-testid^="fla-frame-sequence-target-"]')]
        .filter((radio) => !radio.disabled);
      const supportedTargetCount = supportedRadios().length;

      const targetSearch = document.querySelector('[data-testid="fla-frame-sequence-target-search"]');
      const searchQuery = targetLabels[targetLabels.length - 1] ?? '';
      let searchMatches = false;
      if (targetSearch instanceof HTMLInputElement && searchQuery) {
        await setControlledInput('[data-testid="fla-frame-sequence-target-search"]', searchQuery);
        await waitFor('[data-testid="fla-frame-sequence-targets"]', (element) =>
          element.querySelectorAll('input[data-testid^="fla-frame-sequence-target-"]').length === 1,
        );
        searchMatches = document.querySelectorAll(
          '[data-testid="fla-frame-sequence-targets"] input[data-testid^="fla-frame-sequence-target-"]',
        ).length === 1;
        await setControlledInput('[data-testid="fla-frame-sequence-target-search"]', '');
        await waitFor('[data-testid="fla-frame-sequence-targets"]', (element) =>
          element.querySelectorAll('input[data-testid^="fla-frame-sequence-target-"]').length === targetCount,
        );
      }

      const topLayout = readLayout();
      document.documentElement.dataset.issue399CaptureMarker = 'top';
      await waitForCapture('top');
      const targetList = document.querySelector('[data-testid="fla-frame-sequence-targets"]');
      if (!(targetList instanceof HTMLElement)) throw new Error('Stage E target list is not scrollable');
      targetList.scrollTop = targetList.scrollHeight;
      targetList.dispatchEvent(new Event('scroll', { bubbles: true }));
      await delay(100);
      const bottomLayout = readLayout();
      await waitForCapture('bottom');

      const topListRect = topLayout.targetList.rect;
      const bottomListRect = bottomLayout.targetList.rect;
      const layoutChecks = {
        targetCountAtLeast25: targetCount >= ${SYNTHETIC_TARGET_COUNT},
        workbenchBounded: Boolean(
          topLayout.session && topLayout.workbench &&
          topLayout.workbench.height <= topLayout.session.height + 1 &&
          topLayout.workbench.bottom <= topLayout.session.bottom + 1,
        ),
        pageNotStretched: topLayout.reviewBody.overflowY === 'hidden' &&
          topLayout.reviewBody.scrollHeight <= topLayout.reviewBody.clientHeight + 1 &&
          topLayout.documentScrollHeight <= topLayout.documentClientHeight + 1,
        targetListOwnsScroll: topLayout.targetList.overflowY === 'auto' &&
          topLayout.targetList.scrollHeight > topLayout.targetList.clientHeight + 1,
        rangeVisibleWithoutListScroll: isViewportVisible(topLayout.range),
        previewVisibleAtTop: isViewportVisible(topLayout.preview),
        footerVisibleAtTop: isViewportVisible(topLayout.actionBar),
        previewStableWhileListScrolls: Boolean(
          topLayout.preview && bottomLayout.preview &&
          Math.abs(topLayout.preview.top - bottomLayout.preview.top) <= 1 &&
          Math.abs(topLayout.preview.bottom - bottomLayout.preview.bottom) <= 1,
        ),
        footerStableWhileListScrolls: Boolean(
          topLayout.actionBar && bottomLayout.actionBar &&
          Math.abs(topLayout.actionBar.top - bottomLayout.actionBar.top) <= 1 &&
          Math.abs(topLayout.actionBar.bottom - bottomLayout.actionBar.bottom) <= 1,
        ),
        firstTargetReachable: isInside(topLayout.targetList.firstTarget, topListRect),
        lastTargetReachable: isInside(bottomLayout.targetList.lastTarget, bottomListRect),
        onePrimaryActionBeforeRender: topLayout.primaryActionCount === 1,
        targetSearchWorks: searchMatches,
      };

      const modeBefore = document.querySelector('[data-testid="fla-render-workbench"]')?.getAttribute('data-render-mode') ?? '';
      click('[data-testid="fla-render-mode-snapshot"]');
      await waitFor('[data-testid="fla-snapshot-review"]');
      click('[data-testid="fla-render-mode-sequence"]');
      await waitFor('[data-testid="fla-frame-sequence-range"]');
      await delay(1_000);
      const modeSwitchPassed = modeBefore === 'sequence' &&
        document.querySelector('[data-testid="fla-snapshot-review"]') === null &&
        document.querySelector('[data-testid="fla-frame-sequence-review"]') !== null &&
        document.querySelector('[data-testid="fla-render-mode-sequence"]')?.getAttribute('aria-selected') === 'true';

      const firstRadio = supportedRadios()[0];
      if (!(firstRadio instanceof HTMLInputElement)) throw new Error('No supported Stage E target was exposed');
      const firstTargetId = firstRadio.getAttribute('data-testid');
      const firstTargetLabel = firstRadio.closest('li')?.querySelector('strong')?.textContent?.trim() ?? null;
      firstRadio.click();
      await delay(100);
      const endInput = await waitFor('[data-testid="fla-frame-sequence-end"]');
      if (!(endInput instanceof HTMLInputElement) || Number(endInput.max) < ${RANGE_TARGET_FRAME_COUNT} - 1) {
        throw new Error('Synthetic range-cap target did not expose the expected frame count');
      }

      await setControlledInput('[data-testid="fla-frame-sequence-start"]', '0');
      await setControlledInput('[data-testid="fla-frame-sequence-end"]', String(${MAX_SEQUENCE_FRAMES_PLACEHOLDER}));
      await waitFor('[data-testid="fla-frame-sequence-range-error"]');
      const overCapRange = {
        valid: false,
        renderDisabled: document.querySelector('[data-testid="fla-frame-sequence-render"]')?.disabled === true,
        importAbsent: importButtonCount() === 0,
        errorVisible: document.querySelector('[data-testid="fla-frame-sequence-range-error"]') !== null,
      };

      await setControlledInput('[data-testid="fla-frame-sequence-end"]', '29');
      await waitFor('[data-testid="fla-frame-sequence-range-error"]');
      const explicitThirtyFrameOverCapRange = {
        valid: false,
        requestedEndFrameIndex: 29,
        renderDisabled: document.querySelector('[data-testid="fla-frame-sequence-render"]')?.disabled === true,
        importAbsent: importButtonCount() === 0,
        errorVisible: document.querySelector('[data-testid="fla-frame-sequence-range-error"]') !== null,
      };

      await setControlledInput('[data-testid="fla-frame-sequence-end"]', '30');
      await waitFor('[data-testid="fla-frame-sequence-range-error"]');
      const outOfRange = {
        valid: false,
        renderDisabled: document.querySelector('[data-testid="fla-frame-sequence-render"]')?.disabled === true,
        importAbsent: importButtonCount() === 0,
        errorVisible: document.querySelector('[data-testid="fla-frame-sequence-range-error"]') !== null,
      };

      await setControlledInput('[data-testid="fla-frame-sequence-start"]', '2');
      await setControlledInput('[data-testid="fla-frame-sequence-end"]', '1');
      await waitFor('[data-testid="fla-frame-sequence-range-error"]');
      const reversedRange = {
        valid: false,
        renderDisabled: document.querySelector('[data-testid="fla-frame-sequence-render"]')?.disabled === true,
        importAbsent: importButtonCount() === 0,
        errorVisible: document.querySelector('[data-testid="fla-frame-sequence-range-error"]') !== null,
      };

      await setControlledInput('[data-testid="fla-frame-sequence-start"]', '0');
      await setControlledInput('[data-testid="fla-frame-sequence-end"]', '23');
      await delay(100);
      let renderButton;
      try {
        renderButton = await waitFor('[data-testid="fla-frame-sequence-render"]', (element) => !element.disabled, 5_000);
      } catch (error) {
        const rangeStart = document.querySelector('[data-testid="fla-frame-sequence-start"]');
        const rangeEnd = document.querySelector('[data-testid="fla-frame-sequence-end"]');
        const rangeError = document.querySelector('[data-testid="fla-frame-sequence-range-error"]');
        const button = document.querySelector('[data-testid="fla-frame-sequence-render"]');
        throw new Error(error.message + '; range=' + JSON.stringify({
          start: rangeStart instanceof HTMLInputElement ? rangeStart.value : null,
          end: rangeEnd instanceof HTMLInputElement ? rangeEnd.value : null,
          error: rangeError?.textContent?.trim() ?? null,
          disabled: button instanceof HTMLButtonElement ? button.disabled : null,
        }));
      }
      const beforePreview = readProjectState();
      const previewAbsentBefore = reviewState() === 'needs-preview' && importButtonCount() === 0 &&
        document.querySelector('[data-testid="fla-frame-sequence-filmstrip-empty"]') !== null;

      renderButton.click();
      const progress = await waitFor('[data-testid="fla-frame-sequence-progress"]');
      const progressVisibleDuringRender = Boolean(progress.textContent?.includes('/'));
      const renderingPrimaryAction = readLayout().primaryActionCount === 1 && importButtonCount() === 0;
      const cancel = await waitFor('[data-testid="fla-frame-sequence-cancel"]');
      cancel.click();
      await waitFor('[data-testid="fla-frame-sequence-cancelled"]');
      const cancelWorks = reviewState() === 'needs-preview' && importButtonCount() === 0 &&
        document.querySelector('[data-testid="fla-frame-sequence-cancelled"]') !== null &&
        readProjectState().assetCount === beforePreview.assetCount;

      await setControlledInput('[data-testid="fla-frame-sequence-start"]', '0');
      await setControlledInput('[data-testid="fla-frame-sequence-end"]', '23');
      await waitFor('[data-testid="fla-frame-sequence-render"]', (element) => !element.disabled);
      click('[data-testid="fla-frame-sequence-render"]');
      await waitFor('[data-testid="fla-frame-sequence-review"]', (element) =>
        element.getAttribute('data-preview-state') === 'valid',
      );
      await waitFor('[data-testid="fla-frame-sequence-preview-image"]',
        (element) => element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
      );
      await waitFor('[data-testid="fla-frame-sequence-filmstrip-item-23"]');
      const orderedIndices = [...document.querySelectorAll('[data-testid^="fla-frame-sequence-filmstrip-item-"]')]
        .map((element) => Number(element.getAttribute('data-frame-index')));
      const validRender = {
        state: reviewState(),
        previewVisible: document.querySelector('[data-testid="fla-frame-sequence-preview-image"]') !== null,
        filmstripCount: orderedIndices.length,
        ordered: orderedIndices.every((value, index) => value === index),
        importEnabled: importButtonEnabled(),
        onePrimaryAction: readLayout().primaryActionCount === 1,
      };

      const filmstrip = document.querySelector('[data-testid="fla-frame-sequence-filmstrip"]');
      if (!(filmstrip instanceof HTMLElement)) throw new Error('Stage E filmstrip is missing');
      filmstrip.scrollLeft = 0;
      await delay(50);
      const firstFrameVisible = isInside(
        readLayout().filmstrip.firstFrame,
        readLayout().filmstrip.rect,
      );
      filmstrip.scrollLeft = filmstrip.scrollWidth;
      await delay(50);
      const lastFrameVisible = isInside(
        readLayout().filmstrip.lastFrame,
        readLayout().filmstrip.rect,
      );
      const filmstripLayout = readLayout().filmstrip;
      const filmstripBounded = filmstripLayout.overflowX === 'auto' &&
        filmstripLayout.scrollWidth > filmstripLayout.clientWidth;

      const beforeFocus = readProjectState();
      click('[data-testid="fla-frame-sequence-filmstrip-item-23"]');
      await waitFor('[data-testid="fla-frame-sequence-filmstrip-item-23"]',
        (element) => element.getAttribute('aria-pressed') === 'true',
      );
      const focusOnly = readProjectState().assetCount === beforeFocus.assetCount &&
        readProjectState().maxRevision === beforeFocus.maxRevision &&
        importButtonEnabled() &&
        (document.querySelector('[data-testid="fla-frame-sequence-preview-image"]')?.getAttribute('alt') ?? '').includes('24');

      await setControlledInput('[data-testid="fla-frame-sequence-end"]', '22');
      await waitFor('[data-testid="fla-frame-sequence-review"]', (element) =>
        element.getAttribute('data-preview-state') === 'needs-preview',
      );
      const rangeInvalidation = {
        state: reviewState(),
        importAbsent: importButtonCount() === 0,
        filmstripCleared: document.querySelector('[data-testid="fla-frame-sequence-filmstrip-empty"]') !== null,
        projectUnchanged: readProjectState().assetCount === beforePreview.assetCount,
      };

      await setControlledInput('[data-testid="fla-frame-sequence-end"]', '23');
      await waitFor('[data-testid="fla-frame-sequence-render"]', (element) => !element.disabled);
      click('[data-testid="fla-frame-sequence-render"]');
      await waitFor('[data-testid="fla-frame-sequence-review"]', (element) =>
        element.getAttribute('data-preview-state') === 'valid',
      );
      await waitFor('[data-testid="fla-frame-sequence-filmstrip-item-23"]');

      const otherRadio = supportedRadios().find((radio) => radio.getAttribute('data-testid') !== firstTargetId);
      let targetInvalidation = {
        applicable: Boolean(otherRadio),
        state: 'not-applicable',
        importAbsent: true,
        projectUnchanged: true,
        changedTarget: false,
        targetFrameCount: null,
        defaultRange: null,
      };
      if (otherRadio) {
        const otherId = otherRadio.getAttribute('data-testid');
        otherRadio.click();
        await waitFor('[data-testid="fla-frame-sequence-review"]', (element) =>
          element.getAttribute('data-preview-state') === 'needs-preview',
        );
        targetInvalidation = {
          applicable: true,
          state: reviewState(),
          importAbsent: importButtonCount() === 0,
          projectUnchanged: readProjectState().assetCount === beforePreview.assetCount,
          changedTarget: document.querySelector('[data-testid="fla-frame-sequence-targets"] input:checked')?.getAttribute('data-testid') === otherId,
        };
        const switchedTargetRange = readRangeState();
        targetInvalidation.targetFrameCount = switchedTargetRange.targetFrameCount;
        targetInvalidation.defaultRange = {
          startFrameIndex: switchedTargetRange.startFrameIndex,
          endFrameIndex: switchedTargetRange.endFrameIndex,
          rangeValid: switchedTargetRange.rangeValid,
          renderButtonEnabled: switchedTargetRange.renderButtonEnabled,
        };
        const originalRadio = document.querySelector('[data-testid="' + firstTargetId + '"]');
        if (!(originalRadio instanceof HTMLInputElement)) throw new Error('Original Stage E target could not be restored');
        originalRadio.click();
        await setControlledInput('[data-testid="fla-frame-sequence-start"]', '0');
        await setControlledInput('[data-testid="fla-frame-sequence-end"]', '23');
        await waitFor('[data-testid="fla-frame-sequence-render"]', (element) => !element.disabled);
        click('[data-testid="fla-frame-sequence-render"]');
        await waitFor('[data-testid="fla-frame-sequence-review"]', (element) =>
          element.getAttribute('data-preview-state') === 'valid',
        );
        await waitFor('[data-testid="fla-frame-sequence-filmstrip-item-23"]');
      }

      click('[data-testid="fla-frame-sequence-rerender"]');
      await delay(25);
      const rerenderInvalidation = {
        phaseImmediatelyAfterClick: reviewState(),
        importAbsent: importButtonCount() === 0,
        primaryActionDuringRerender: readLayout().primaryActionCount === 1,
      };
      await waitFor('[data-testid="fla-frame-sequence-review"]', (element) =>
        element.getAttribute('data-preview-state') === 'valid',
      );
      await waitFor('[data-testid="fla-frame-sequence-filmstrip-item-23"]');

      const beforeImport = readProjectState();
      const finalSequenceReady = reviewState() === 'valid' && importButtonEnabled() &&
        document.querySelectorAll('[data-testid^="fla-frame-sequence-filmstrip-item-"]').length === 24;
      click('[data-testid="fla-frame-sequence-import"]');
      await waitFor('[data-testid="fla-frame-sequence-committed"]');
      await delay(500);
      const afterImport = readProjectState();
      const zeroRasterSequenceRoute = document.querySelector('[data-testid="fla-review-zero-raster"]') !== null;
      const addedAssets = beforeImport.assetCount !== null && afterImport.assetCount !== null
        ? afterImport.assetCount - beforeImport.assetCount
        : null;
      const revisionAdvanced = afterImport.maxRevision !== null &&
        (beforeImport.maxRevision === null || afterImport.maxRevision > beforeImport.maxRevision);
      const committedText = document.querySelector('[data-testid="fla-frame-sequence-committed"]')?.textContent?.trim() ?? '';
      click('[data-testid="fla-frame-sequence-close"]');
      await waitFor('[data-testid="asset-browser-view"]');
      const libraryAfterClose = readProjectState();

      const checks = {
        zeroRasterSequenceRoute,
        stageESharedMode: modeSwitchPassed,
        initialDefaultRange: initialDefaultRange.rangeValid &&
          initialDefaultRange.startFrameIndex === 0 &&
          initialDefaultRange.endFrameIndex === ${MAX_SEQUENCE_FRAMES_PLACEHOLDER - 1} &&
          initialDefaultRange.targetFrameCount === ${RANGE_TARGET_FRAME_COUNT} &&
          initialDefaultRange.renderButtonEnabled,
        targetSelectionWorks: targetInvalidation.applicable && targetInvalidation.changedTarget,
        stageELayout: Object.values(layoutChecks).every(Boolean),
        rangeValidation: overCapRange.valid === false && overCapRange.renderDisabled && overCapRange.importAbsent && overCapRange.errorVisible &&
          explicitThirtyFrameOverCapRange.valid === false && explicitThirtyFrameOverCapRange.renderDisabled &&
          explicitThirtyFrameOverCapRange.importAbsent && explicitThirtyFrameOverCapRange.errorVisible &&
          outOfRange.valid === false && outOfRange.renderDisabled && outOfRange.importAbsent && outOfRange.errorVisible &&
          reversedRange.valid === false && reversedRange.renderDisabled && reversedRange.importAbsent && reversedRange.errorVisible,
        previewAbsentBefore,
        progressVisibleDuringRender,
        renderingPrimaryAction,
        cancelWorks,
        validRender: validRender.state === 'valid' && validRender.previewVisible && validRender.filmstripCount === 24 &&
          validRender.ordered && validRender.importEnabled && validRender.onePrimaryAction,
        filmstripBounded,
        firstFilmstripFrameReachable: firstFrameVisible,
        lastFilmstripFrameReachable: lastFrameVisible,
        selectedFrameFocusOnly: focusOnly,
        rangeInvalidation: rangeInvalidation.state === 'needs-preview' && rangeInvalidation.importAbsent &&
          rangeInvalidation.filmstripCleared && rangeInvalidation.projectUnchanged,
        targetInvalidation: targetInvalidation.applicable && targetInvalidation.state === 'needs-preview' &&
          targetInvalidation.importAbsent && targetInvalidation.projectUnchanged,
        targetChangeDefaultRange: targetInvalidation.applicable &&
          targetInvalidation.defaultRange?.startFrameIndex === 0 &&
          targetInvalidation.defaultRange?.endFrameIndex === Math.min(targetInvalidation.targetFrameCount - 1, maxSequenceFrames - 1) &&
          targetInvalidation.defaultRange?.rangeValid && targetInvalidation.defaultRange?.renderButtonEnabled,
        rerenderInvalidation: rerenderInvalidation.importAbsent && rerenderInvalidation.primaryActionDuringRerender,
        staleLateGuard: rangeInvalidation.importAbsent && rerenderInvalidation.importAbsent && finalSequenceReady,
        explicitImportOnly: addedAssets === 24 && revisionAdvanced,
        libraryUpdated: libraryAfterClose.assetCount === afterImport.assetCount,
      };

      return {
        ok: Object.values(checks).every(Boolean),
        projectName,
        projectRoot: acceptanceRoot + '\\\\' + projectName + '.pandastage',
        route: 'v2r-target-discovery',
        mode: 'sequence',
        targetCount,
        supportedTargetCount,
        selectedTargetId: firstTargetId,
        selectedTargetLabel: firstTargetLabel,
        selectedRange: { startFrameIndex: 0, endFrameIndex: 23 },
        requestedFrameCount: 24,
        initialDefaultRange,
        checks,
        layout: {
          checks: layoutChecks,
          top: topLayout,
          bottom: bottomLayout,
          filmstrip: filmstripLayout,
          searchQuery,
        },
        rangeValidation: { overCapRange, explicitThirtyFrameOverCapRange, outOfRange, reversedRange },
        validRender,
        progress: { visibleDuringRender: progressVisibleDuringRender, renderingPrimaryAction },
        cancel: { works: cancelWorks },
        rangeInvalidation,
        targetInvalidation,
        rerenderInvalidation,
        initial,
        beforePreview,
        beforeImport,
        afterImport,
        libraryAfterClose,
        addedAssets,
        revisionAdvanced,
        committedText,
        projectMutation: 'PREVIEW_NONE; CANCELLED_SEQUENCE_NONE; COMMIT_ONE_EXPLICIT_24_FRAME_IMAGE_ASSET_SEQUENCE',
      };
    })()
  `);
}

// Kept as a named constant in the host source so the embedded UI script has
// no dependency on Node variables. The value is replaced below before the
// JavaScript string is evaluated.
const MAX_SEQUENCE_FRAMES_PLACEHOLDER = 24;

async function main() {
  const args = parseArgs(process.argv.slice(1));
  const acceptanceRoot = resolve(args.acceptanceRoot || DEFAULT_ACCEPTANCE_ROOT);
  const outPath = resolve(args.out || join(acceptanceRoot, 'issue399-stage-e-receipt.json'));
  const evidenceDir = resolve(args.evidenceDir || join(acceptanceRoot, 'layout-evidence'));
  const userData = resolve(args.userData || join(acceptanceRoot, 'electron-user-data'));
  const sourcePath = resolve(args.source || join(acceptanceRoot, 'issue399-stage-e-zero-raster.fla'));
  const projectName = `${args.manual ? 'Issue400 Stage E Manual' : 'Issue399 Stage E UI'} ${Date.now()}`;
  mkdirSync(acceptanceRoot, { recursive: true });
  mkdirSync(resolve(outPath, '..'), { recursive: true });
  mkdirSync(evidenceDir, { recursive: true });
  mkdirSync(userData, { recursive: true });

  let sourceWasGenerated = false;
  let response = null;
  try {
    if (!args.source) {
      await writeSyntheticZeroRasterFla(sourcePath);
      sourceWasGenerated = true;
    }
    if (!existsSync(sourcePath)) throw new Error(`FLA source is missing: ${sourcePath}`);
    app.setPath('userData', userData);
    process.env.VITE_DEV_SERVER_URL = '';
    process.env.PANDA_STAGE_FLA_ACCEPTANCE_SOURCE = sourcePath;
    require('../dist-electron/main/index.js');
    const sourceSha256Before = sha256(sourcePath);
    const mainWindow = await waitForMainWindow();
    const pathState = { error: null };
    const inputPump = pumpRealInputRequests(mainWindow, pathState);
    const pathPromise = runStageEPath(mainWindow, acceptanceRoot, projectName, {
      manualAcceptance: Boolean(args.manual),
    }).catch((error) => {
      pathState.error = error;
      throw error;
    });
    void pathPromise.then(
      () => { pathState.done = true; },
      () => { pathState.done = true; },
    );
    const layoutEvidence = args.manual
      ? null
      : {
        top: await captureScreenshotAtMarker(
          mainWindow,
          'top',
          join(evidenceDir, 'stage-e-top-target.png'),
          pathState,
        ),
        bottom: await captureScreenshotAtMarker(
          mainWindow,
          'bottom',
          join(evidenceDir, 'stage-e-bottom-target.png'),
          pathState,
        ),
      };
    response = await pathPromise;
    pathState.done = true;
    await inputPump;
    response.layoutEvidence = layoutEvidence;
    const sourceSha256After = sha256(sourcePath);
    const projectFile = join(acceptanceRoot, `${projectName}.pandastage`, 'project.json');
    const persistedProject = existsSync(projectFile)
      ? JSON.parse(readFileSync(projectFile, 'utf8'))
      : null;
    const receipt = {
      schemaVersion: args.manual
        ? 'issue400-stage-e-manual-electron-acceptance/1'
        : 'issue399-stage-e-electron-acceptance/1',
      acceptance: {
        kind: args.manual ? 'maintainer-manual-acceptance' : 'automated-synthetic-verifier',
        sourceKind: sourceWasGenerated ? 'synthetic' : 'external',
        sourceBasename: sourcePath.split(/[\\/]/u).pop(),
        selectedTargetId: response?.selectedTargetId ?? null,
        selectedTargetLabel: response?.selectedTargetLabel ?? null,
        initialRange: response?.initialRange ?? response?.initialDefaultRange ?? null,
        rangeValid: response?.initialRange?.rangeValid ?? response?.initialDefaultRange?.rangeValid ?? null,
        renderButtonEnabled: response?.initialRange?.renderButtonEnabled ?? response?.initialDefaultRange?.renderButtonEnabled ?? null,
        dedicatedUserData: Boolean(args.userData),
      },
      source: {
        basename: sourcePath.split(/[\\/]/u).pop(),
        generatedByVerifier: sourceWasGenerated,
        sha256Before: sourceSha256Before,
        sha256After: sourceSha256After,
        hashInvariant: sourceSha256Before === sourceSha256After,
      },
      project: {
        projectRoot: response?.projectRoot ?? join(acceptanceRoot, `${projectName}.pandastage`),
        persistedAssetCount: Array.isArray(persistedProject?.assets)
          ? persistedProject.assets.length
          : null,
        privateVisualBytesRecorded: false,
      },
      parserPath: 'real Windows Electron Main + production Renderer UI -> V2-R catalog -> shared bounded Stage D/E Workbench -> sequence range/filmstrip review -> explicit ImageAsset commit',
      response,
    };
    writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
    const expectedPersistedAssetCount = args.manual ? 0 : 24;
    if (!receipt.source.hashInvariant || !response?.ok || receipt.project.persistedAssetCount !== expectedPersistedAssetCount) {
      process.exitCode = 1;
    }
  } catch (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught));
    const receipt = {
      schemaVersion: args.manual
        ? 'issue400-stage-e-manual-electron-acceptance/1'
        : 'issue399-stage-e-electron-acceptance/1',
      acceptance: {
        kind: args.manual ? 'maintainer-manual-acceptance' : 'automated-synthetic-verifier',
        sourceKind: sourceWasGenerated ? 'synthetic' : 'external',
        sourceBasename: sourcePath.split(/[\\/]/u).pop(),
        dedicatedUserData: Boolean(args.userData),
      },
      source: {
        basename: sourcePath.split(/[\\/]/u).pop(),
        generatedByVerifier: sourceWasGenerated,
        privateVisualBytesRecorded: false,
      },
      project: { projectRoot: null, persistedAssetCount: null, privateVisualBytesRecorded: false },
      response,
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
  .then(() => {
    if (startupArgs.keepOpen) return;
    setTimeout(() => app.exit(process.exitCode || 0), 300);
  })
  .catch((caught) => {
    process.stderr.write(`${caught.stack || caught.message}\n`);
    setTimeout(() => app.exit(1), 300);
  });
